/**
 * HUMANE Authenticator — Background Service Worker
 *
 * Beheert de privésleutel veilig in chrome.storage.local
 * Verwerkt signing requests van content scripts
 * Communiceert met de popup
 */

// ── Crypto helpers ───────────────────────────────────────────────

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2)
    b[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return b
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function toBase58(bytes) {
  let num = BigInt('0x' + bufToHex(bytes))
  let out = ''
  while (num > 0n) { out = BASE58[Number(num % 58n)] + out; num /= 58n }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break }
  return out
}

// ── Sleutelbeheer ────────────────────────────────────────────────

async function generateIdentity(label, passphrase) {
  // Genereer Ed25519 sleutelpaar
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  )

  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

  const publicKeyHex = bufToHex(pubRaw)
  const did = 'did:humane:' + toBase58(new Uint8Array(pubRaw))

  // Versleutel de privésleutel met het wachtwoord
  const encryptedPrivKey = await encryptKey(JSON.stringify(privJwk), passphrase)

  const identity = {
    did,
    publicKeyHex,
    encryptedPrivKey,
    label: label || 'Mijn HUMANE identiteit',
    created: new Date().toISOString(),
    keyVersion: 1
  }

  // Sla op in chrome.storage.local — veilig, buiten normale webpage storage
  const existing = await getIdentities()
  existing[did] = identity
  await chrome.storage.local.set({ humane_identities: existing })

  return { did, publicKeyHex, label: identity.label, created: identity.created }
}

async function getIdentities() {
  const result = await chrome.storage.local.get('humane_identities')
  return result.humane_identities || {}
}

async function getActiveIdentity() {
  const result = await chrome.storage.local.get('humane_active_did')
  const identities = await getIdentities()
  const activeDid = result.humane_active_did
  if (activeDid && identities[activeDid]) return identities[activeDid]
  const all = Object.values(identities)
  return all.length > 0 ? all[0] : null
}

async function signChallenge(challenge, passphrase) {
  const identity = await getActiveIdentity()
  if (!identity) throw new Error('Geen HUMANE identiteit gevonden')

  // Ontsleutel de privésleutel
  const privJwkStr = await decryptKey(identity.encryptedPrivKey, passphrase)
  const privJwk = JSON.parse(privJwkStr)

  const privateKey = await crypto.subtle.importKey(
    'jwk', privJwk, { name: 'Ed25519' }, false, ['sign']
  )

  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(challenge)
  )

  return {
    signature: bufToHex(sig),
    did: identity.did,
    publicKeyHex: identity.publicKeyHex
  }
}

// ── AES-GCM versleuteling ────────────────────────────────────────

async function encryptKey(text, passphrase) {
  const pwHash = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(passphrase)
  )
  const key = await crypto.subtle.importKey(
    'raw', pwHash, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  )
  return {
    iv: bufToHex(iv),
    data: bufToHex(encrypted)
  }
}

async function decryptKey(encrypted, passphrase) {
  const pwHash = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(passphrase)
  )
  const key = await crypto.subtle.importKey(
    'raw', pwHash, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  )
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(encrypted.iv) },
    key,
    hexToBytes(encrypted.data)
  )
  return new TextDecoder().decode(decrypted)
}

// ── Pending sign requests ────────────────────────────────────────

const pendingRequests = new Map()

// ── Message handler ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message })
  })
  return true // async response
})

async function handleMessage(message, sender) {
  switch (message.type) {

    case 'GET_STATUS': {
      const identity = await getActiveIdentity()
      return {
        hasIdentity: !!identity,
        did: identity?.did,
        label: identity?.label
      }
    }

    case 'GET_IDENTITIES': {
      const identities = await getIdentities()
      return Object.values(identities).map(id => ({
        did: id.did,
        label: id.label,
        publicKeyHex: id.publicKeyHex,
        created: id.created,
        keyVersion: id.keyVersion
      }))
    }

    case 'CREATE_IDENTITY': {
      const { label, passphrase } = message
      if (!passphrase || passphrase.length < 8)
        throw new Error('Wachtwoord moet minimaal 8 tekens zijn')
      const identity = await generateIdentity(label, passphrase)
      // Stel in als actief
      await chrome.storage.local.set({ humane_active_did: identity.did })
      return identity
    }

    case 'SIGN_REQUEST': {
      // Content script vraagt om signing — sla op als pending en open popup
      const { challenge, siteName, tabId } = message
      const requestId = crypto.randomUUID()
      pendingRequests.set(requestId, {
        challenge, siteName, tabId: sender.tab?.id,
        timestamp: Date.now()
      })
      // Open popup voor bevestiging
      await chrome.action.openPopup()
      return { requestId }
    }

    case 'CONFIRM_SIGN': {
      // Gebruiker heeft bevestigd in popup
      const { requestId, passphrase } = message
      const request = pendingRequests.get(requestId)
      if (!request) throw new Error('Request niet gevonden of verlopen')

      // Controleer timeout (60 seconden)
      if (Date.now() - request.timestamp > 60000) {
        pendingRequests.delete(requestId)
        throw new Error('Request verlopen')
      }

      const result = await signChallenge(request.challenge, passphrase)
      pendingRequests.delete(requestId)
      return result
    }

    case 'CANCEL_SIGN': {
      const { requestId } = message
      pendingRequests.delete(requestId)
      return { cancelled: true }
    }

    case 'GET_PENDING_REQUEST': {
      // Popup vraagt of er een pending request is
      const requests = Array.from(pendingRequests.entries())
      if (requests.length === 0) return { pending: false }
      const [requestId, request] = requests[0]
      return { pending: true, requestId, ...request }
    }

    case 'DELETE_IDENTITY': {
      const { did } = message
      const identities = await getIdentities()
      delete identities[did]
      await chrome.storage.local.set({ humane_identities: identities })
      return { deleted: true }
    }

    case 'EXPORT_IDENTITY': {
      // Exporteer backup zonder wachtwoord — gebruiker bewaart zelf
      const identity = await getActiveIdentity()
      if (!identity) throw new Error('Geen identiteit gevonden')
      return {
        did: identity.did,
        publicKeyHex: identity.publicKeyHex,
        encryptedPrivKey: identity.encryptedPrivKey,
        label: identity.label,
        created: identity.created,
        keyVersion: identity.keyVersion,
        format: 'humane-extension-v1'
      }
    }

    case 'IMPORT_IDENTITY': {
      const { backup, passphrase } = message
      // Verifieer dat het wachtwoord klopt door te ontsleutelen
      await decryptKey(backup.encryptedPrivKey, passphrase)
      const identities = await getIdentities()
      identities[backup.did] = backup
      await chrome.storage.local.set({
        humane_identities: identities,
        humane_active_did: backup.did
      })
      return { did: backup.did, label: backup.label }
    }

    default:
      throw new Error('Onbekend bericht type: ' + message.type)
  }
}

// Ruim verlopen requests op
setInterval(() => {
  const now = Date.now()
  for (const [id, req] of pendingRequests.entries()) {
    if (now - req.timestamp > 60000) pendingRequests.delete(id)
  }
}, 10000)
