# HUMANE Authenticator

> Your digital identity. On every domain. Always yours.

The HUMANE Authenticator is a browser extension that manages your [HUMANE](https://humaneworld.network) decentralized identity. It allows you to log in to any HUMANE-enabled application without a password, email, or any central authority.

---

## What it does

- **Creates** a cryptographic Ed25519 identity in your browser
- **Stores** your private key securely in `chrome.storage.local` — never on a server
- **Signs** authentication challenges automatically when you log in
- **Works** on every domain — install once, use everywhere

## How it works

```
Website generates a challenge
        ↓
HUMANE Authenticator signs it with your private key (locally)
        ↓
Website verifies the signature against your public DID
        ↓
You're in — no password, no email, no central database
```

Your private key **never leaves your device**. The extension only sends your public DID and a cryptographic signature to the website. Nothing else.

---

## Installation

### From Chrome Web Store
*Coming soon*

### Load unpacked (developer mode)

1. Download or clone this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `humane-extension` folder

---

## Usage

### Creating a new identity

1. Click the HUMANE icon in your browser toolbar
2. Click **Create identity**
3. Choose a label (optional) and a passphrase (minimum 8 characters)
4. Your HUMANE DID is created — store your passphrase safely

### Logging in to a HUMANE-enabled site

1. Visit a site that supports HUMANE login
2. Click **Log in with HUMANE**
3. The extension shows a confirmation dialog
4. Enter your passphrase and click **Confirm**
5. You're in

### Importing an existing identity

If you already have a HUMANE identity from the [humaneworld.network](https://humaneworld.network) web app or the Node.js CLI:

1. Export your identity as a backup file
2. Open the HUMANE Authenticator
3. Click **Import backup**
4. Select your backup file and enter your passphrase

---

## For developers

### Integrating HUMANE login

Add the HUMANE auth widget to your site:

```html
<script src="https://humaneworld.network/humane-auth-widget.js"></script>
```

Then trigger the login flow:

```javascript
const humane = new HumaneAuthWidget()
const identities = await humane.list()

if (identities.length > 0) {
  const challenge = generateChallenge() // generate on your server
  const signature = await humane.sign(challenge, identities[0].did)
  
  // Send to your server for verification
  await loginWithHumane({ did: identities[0].did, challenge, signature })
}
```

Full documentation at [humaneworld.network/developers](https://humaneworld.network/developers).

### How the extension communicates with websites

The extension listens for `window.postMessage` events:

```javascript
// Request signing from the extension
window.postMessage({
  type: 'HUMANE_SIGN_REQUEST',
  challenge: 'your-challenge-string',
  siteName: 'Your App Name',
  requestId: 'unique-request-id'
}, '*')

// Listen for the response
window.addEventListener('message', (event) => {
  if (event.data.type === 'HUMANE_SIGN_RESPONSE') {
    const { signature, did, publicKeyHex } = event.data
    // verify on your server
  }
})
```

---

## File structure

```
humane-extension/
├── manifest.json      — Chrome extension manifest (V3)
├── background.js      — Service worker: key management and signing
├── content.js         — Content script: injected on every page
├── popup.html         — Extension popup UI
├── popup.js           — Popup logic
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## Security

- **Private key storage**: `chrome.storage.local` — local to your device, never synced
- **Encryption**: AES-256-GCM with a passphrase-derived key (SHA-256)
- **Signing**: Ed25519 via the WebCrypto API
- **No telemetry**: The extension never phones home or tracks usage

---

## Privacy

The HUMANE Authenticator collects no personal data. See the full [Privacy Policy](https://humaneworld.network/privacy).

---

## Contributing

HUMANE is open source and owned by nobody. Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

Please open an issue first for major changes.

---

## Related repositories

| Repository | Description |
|---|---|
| [humane-did](https://github.com/svendijkstra-lab/humane-did) | HUMANE protocol — Node.js reference implementation |
| [mirro-app](https://github.com/svendijkstra-lab/mirro-app) | Mirro — first HUMANE-enabled application |
| [humane-extension](https://github.com/svendijkstra-lab/humane-extension) | This repository |

---

## Links

- Website: [humaneworld.network](https://humaneworld.network)
- Developer docs: [humaneworld.network/developers](https://humaneworld.network/developers)
- Protocol repo: [github.com/svendijkstra-lab/humane-did](https://github.com/svendijkstra-lab/humane-did)
- Privacy policy: [humaneworld.network/privacy](https://humaneworld.network/privacy)

---

*HUMANE — Owned by nobody. Available to everyone.*

*Genesis: 23 June 2026.*
