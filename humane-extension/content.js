/**
 * HUMANE Authenticator — Content Script
 *
 * Draait op elke webpagina.
 * Detecteert HUMANE login verzoeken en faciliteert de signing flow.
 * Injecteert de HUMANE knop als een site HUMANE ondersteunt.
 */

;(function() {
  'use strict'

  // ── Detecteer HUMANE-ready pagina's ─────────────────────────────
  // Sites signaleren HUMANE support via een meta tag:
  // <meta name="humane-auth" content="true">
  // Of via window.HUMANE_CHALLENGE

  function isHumaneReady() {
    return !!(
      document.querySelector('meta[name="humane-auth"]') ||
      window.__HUMANE_CHALLENGE ||
      document.querySelector('[data-humane-login]')
    )
  }

  // ── Luister naar berichten van de pagina ────────────────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return
    if (!event.data?.type?.startsWith('HUMANE_')) return

    switch (event.data.type) {

      case 'HUMANE_SIGN_REQUEST': {
        const { challenge, siteName, requestId } = event.data

        // Vraag status op bij background
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })

        if (!status.hasIdentity) {
          window.postMessage({
            type: 'HUMANE_SIGN_RESPONSE',
            requestId,
            error: 'Geen HUMANE identiteit. Installeer de extensie en maak een identiteit aan.'
          }, '*')
          return
        }

        // Stuur sign request naar background — opent popup voor bevestiging
        const result = await chrome.runtime.sendMessage({
          type: 'SIGN_REQUEST',
          challenge,
          siteName: siteName || document.title || location.hostname
        })

        if (result.error) {
          window.postMessage({
            type: 'HUMANE_SIGN_RESPONSE',
            requestId,
            error: result.error
          }, '*')
          return
        }

        // Wacht op bevestiging via popup (polling)
        pollForSignResult(requestId, result.requestId)
        break
      }

      case 'HUMANE_STATUS_REQUEST': {
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
        window.postMessage({
          type: 'HUMANE_STATUS_RESPONSE',
          hasIdentity: status.hasIdentity,
          did: status.did,
          label: status.label
        }, '*')
        break
      }
    }
  })

  // ── Poll voor sign resultaat ─────────────────────────────────────
  async function pollForSignResult(pageRequestId, bgRequestId, attempts = 0) {
    if (attempts > 60) { // 30 seconden timeout
      window.postMessage({
        type: 'HUMANE_SIGN_RESPONSE',
        requestId: pageRequestId,
        error: 'Timeout: gebruiker heeft niet bevestigd'
      }, '*')
      return
    }

    await new Promise(r => setTimeout(r, 500))

    const pending = await chrome.runtime.sendMessage({ type: 'GET_PENDING_REQUEST' })

    if (!pending.pending) {
      // Request is verwerkt — haal resultaat op
      // Background stuurt resultaat terug via storage
      const result = await chrome.storage.local.get('humane_last_signature')
      if (result.humane_last_signature?.requestId === bgRequestId) {
        window.postMessage({
          type: 'HUMANE_SIGN_RESPONSE',
          requestId: pageRequestId,
          signature: result.humane_last_signature.signature,
          did: result.humane_last_signature.did,
          publicKeyHex: result.humane_last_signature.publicKeyHex
        }, '*')
        await chrome.storage.local.remove('humane_last_signature')
        return
      }
    }

    pollForSignResult(pageRequestId, bgRequestId, attempts + 1)
  }

  // ── Injecteer HUMANE widget op ondersteunde pagina's ─────────────
  function injectWidget() {
    if (!isHumaneReady()) return
    if (document.getElementById('humane-ext-widget')) return

    const widget = document.createElement('div')
    widget.id = 'humane-ext-widget'
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, sans-serif;
    `
    widget.innerHTML = `
      <button id="humane-ext-btn" style="
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: linear-gradient(135deg, #C9A84C, #a07820);
        border: none;
        border-radius: 20px;
        color: #0a0a14;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(201,168,76,0.3);
        transition: all 0.2s;
      ">
        <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
          <path d="M20 5 A11 11 0 1 0 20 23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>
          <circle cx="20" cy="5" r="3" fill="currentColor"/>
          <circle cx="20" cy="23" r="3" fill="currentColor"/>
        </svg>
        Inloggen met HUMANE
      </button>
    `

    document.body.appendChild(widget)

    document.getElementById('humane-ext-btn').addEventListener('click', () => {
      // Trigger de HUMANE login flow op de pagina
      window.postMessage({ type: 'HUMANE_TRIGGER_LOGIN' }, '*')
    })
  }

  // Wacht tot DOM klaar is
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWidget)
  } else {
    injectWidget()
  }

  // Observeer DOM wijzigingen voor SPAs
  const observer = new MutationObserver(() => {
    if (isHumaneReady()) injectWidget()
  })
  observer.observe(document.body, { childList: true, subtree: true })

})()
