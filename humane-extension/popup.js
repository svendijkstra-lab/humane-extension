/**
 * HUMANE Authenticator — Popup JavaScript
 */

let currentScreen = 'home'
let pendingRequestId = null

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await updateStatus()
  await checkPendingRequest()
  await renderHome()
})

async function updateStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
  const dot = document.getElementById('status-dot')
  const text = document.getElementById('status-text')
  if (status.hasIdentity) {
    dot.className = 'dot dot-active'
    text.textContent = status.label || 'Actief'
  } else {
    dot.className = 'dot dot-inactive'
    text.textContent = 'Geen identiteit'
  }
}

async function checkPendingRequest() {
  const pending = await chrome.runtime.sendMessage({ type: 'GET_PENDING_REQUEST' })
  if (pending.pending) {
    pendingRequestId = pending.requestId
    showConfirmScreen(pending)
  }
}

async function renderHome() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
  const container = document.getElementById('home-content')

  if (status.hasIdentity) {
    const identities = await chrome.runtime.sendMessage({ type: 'GET_IDENTITIES' })
    const id = identities[0]
    container.innerHTML = `
      <div class="id-card">
        <div class="id-label">JOUW HUMANE IDENTITEIT</div>
        <div class="id-name">${id.label}</div>
        <div class="id-did">${id.did}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;text-align:center">
        Aangemaakt ${new Date(id.created).toLocaleDateString('nl-NL', {day:'numeric',month:'long',year:'numeric'})}
      </div>
      <button class="btn btn-primary" id="btn-open-identity">
        Bekijk identiteitsketen
      </button>
      <button class="btn btn-secondary" id="btn-open-mirro">
        Open Mirro
      </button>
    `
  } else {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✦</div>
        <div class="empty-title">Geen identiteit gevonden</div>
        <div class="empty-sub">Maak je HUMANE identiteit aan. Één keer. Op elk domein beschikbaar.</div>
        <button class="btn btn-primary" id="btn-goto-create">Identiteit aanmaken</button>
        <button class="btn btn-secondary" id="btn-goto-import-empty" style="margin-top:4px">Importeer backup</button>
      </div>
    `
  }
}

// ── Navigatie ────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById('screen-' + name).classList.add('active')
  currentScreen = name

  // Footer nav updaten
  document.querySelectorAll('.footer-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name)
  })
}

function navTo(name) {
  if (name === 'home') renderHome().then(() => showScreen('home'))
  else showScreen(name)
}

// ── Bevestigingsscherm ───────────────────────────────────────────
function showConfirmScreen(request) {
  document.getElementById('confirm-site').textContent = request.siteName || 'Onbekende site'

  // DID ophalen voor weergave
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(status => {
    document.getElementById('confirm-did').textContent =
      status.did ? status.did.slice(0, 42) + '...' : '—'
  })

  showScreen('confirm')
}

// ── Event listeners ──────────────────────────────────────────────

// Bevestigen
document.getElementById('btn-confirm-sign').addEventListener('click', async () => {
  const passphrase = document.getElementById('confirm-passphrase').value
  const errorEl = document.getElementById('confirm-error')
  errorEl.style.display = 'none'

  if (!passphrase) {
    errorEl.textContent = 'Voer je wachtwoord in'
    errorEl.style.display = 'block'
    return
  }

  const btn = document.getElementById('btn-confirm-sign')
  btn.textContent = 'Bezig...'
  btn.disabled = true

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CONFIRM_SIGN',
      requestId: pendingRequestId,
      passphrase
    })

    if (result.error) throw new Error(result.error)

    // Sla resultaat op zodat content script het kan ophalen
    await chrome.storage.local.set({
      humane_last_signature: {
        requestId: pendingRequestId,
        signature: result.signature,
        did: result.did,
        publicKeyHex: result.publicKeyHex
      }
    })

    // Sluit popup
    window.close()
  } catch (err) {
    errorEl.textContent = err.message
    errorEl.style.display = 'block'
    btn.textContent = '✓ Bevestigen en inloggen'
    btn.disabled = false
  }
})

// Annuleren
document.getElementById('btn-confirm-cancel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CANCEL_SIGN', requestId: pendingRequestId })
  window.close()
})

// Identiteit aanmaken
document.getElementById('btn-create').addEventListener('click', async () => {
  const label = document.getElementById('create-label').value
  const passphrase = document.getElementById('create-passphrase').value
  const confirm = document.getElementById('create-passphrase-confirm').value
  const errorEl = document.getElementById('create-error')
  const successEl = document.getElementById('create-success')

  errorEl.style.display = 'none'
  successEl.style.display = 'none'

  if (passphrase.length < 8) {
    errorEl.textContent = 'Wachtwoord moet minimaal 8 tekens zijn'
    errorEl.style.display = 'block'
    return
  }
  if (passphrase !== confirm) {
    errorEl.textContent = 'Wachtwoorden komen niet overeen'
    errorEl.style.display = 'block'
    return
  }

  const btn = document.getElementById('btn-create')
  btn.textContent = 'Aanmaken...'
  btn.disabled = true

  try {
    const identity = await chrome.runtime.sendMessage({
      type: 'CREATE_IDENTITY',
      label: label || 'Mijn HUMANE identiteit',
      passphrase
    })

    successEl.textContent = `Identiteit aangemaakt! DID: ${identity.did.slice(0, 24)}...`
    successEl.style.display = 'block'

    await updateStatus()
    setTimeout(() => navTo('home'), 1500)
  } catch (err) {
    errorEl.textContent = err.message
    errorEl.style.display = 'block'
    btn.textContent = 'Identiteit aanmaken'
    btn.disabled = false
  }
})

document.getElementById('btn-create-cancel').addEventListener('click', () => navTo('home'))

// Importeren
document.getElementById('btn-import').addEventListener('click', async () => {
  const file = document.getElementById('import-file').files[0]
  const passphrase = document.getElementById('import-passphrase').value
  const errorEl = document.getElementById('import-error')
  const successEl = document.getElementById('import-success')

  errorEl.style.display = 'none'
  successEl.style.display = 'none'

  if (!file) {
    errorEl.textContent = 'Selecteer een backup bestand'
    errorEl.style.display = 'block'
    return
  }

  try {
    const text = await file.text()
    const backup = JSON.parse(text)

    const result = await chrome.runtime.sendMessage({
      type: 'IMPORT_IDENTITY',
      backup,
      passphrase
    })

    successEl.textContent = `Geïmporteerd: ${result.label}`
    successEl.style.display = 'block'

    await updateStatus()
    setTimeout(() => navTo('home'), 1500)
  } catch (err) {
    errorEl.textContent = 'Import mislukt: ' + err.message
    errorEl.style.display = 'block'
  }
})

document.getElementById('btn-import-cancel').addEventListener('click', () => navTo('home'))

// Export backup
document.getElementById('btn-export').addEventListener('click', async () => {
  const backup = await chrome.runtime.sendMessage({ type: 'EXPORT_IDENTITY' })
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `humane-backup-${new Date().toISOString().slice(0,10)}.json`
  a.click()
  URL.revokeObjectURL(url)
})

// Naar import
document.getElementById('btn-goto-import').addEventListener('click', () => showScreen('import'))

// Naar humaneworld.network
document.getElementById('btn-goto-humane').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://humaneworld.network' })
})

// Verwijderen
document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!confirm('Weet je zeker dat je je identiteit uit deze extensie wilt verwijderen? Download eerst een backup.')) return
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
  if (status.did) {
    await chrome.runtime.sendMessage({ type: 'DELETE_IDENTITY', did: status.did })
    await updateStatus()
    navTo('home')
  }
})

// ── Extra event listeners (geen inline handlers) ──────────────────

// Footer nav
document.getElementById('nav-btn-home')?.addEventListener('click', () => navTo('home'))
document.getElementById('nav-btn-settings')?.addEventListener('click', () => navTo('settings'))

// Lege state knoppen
document.getElementById('btn-goto-create')?.addEventListener('click', () => showScreen('create'))
document.getElementById('btn-goto-import-empty')?.addEventListener('click', () => showScreen('import'))

// Home knoppen (dynamisch — via event delegation)
document.getElementById('home-content').addEventListener('click', (e) => {
  if (e.target.id === 'btn-open-identity' || e.target.closest('#btn-open-identity')) {
    chrome.tabs.create({ url: 'https://humaneworld.network/identity' })
  }
  if (e.target.id === 'btn-open-mirro' || e.target.closest('#btn-open-mirro')) {
    chrome.tabs.create({ url: 'https://getmirro.com' })
  }
  if (e.target.id === 'btn-goto-create' || e.target.closest('#btn-goto-create')) {
    showScreen('create')
  }
  if (e.target.id === 'btn-goto-import-empty' || e.target.closest('#btn-goto-import-empty')) {
    showScreen('import')
  }
})
