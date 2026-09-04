# AutoGT Pro Chrome Extension

This extension connects the browser to AutoGT Pro through a localhost WebSocket.
It intentionally has no custom logo/icon in the manifest. Chrome will show its default extension icon.

## Load it

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this `extension/` folder.
5. Start AutoGT Pro. The popup will show `Connected` when the bridge is ready.

## Connection

Extension WebSocket:

`ws://127.0.0.1:8788/ws/extension`

App status endpoint:

`GET http://127.0.0.1:8788/api/extension-status`

## Shopee Affiliate live capture

Shopee product search and link checks reuse one persistent tab at
`https://affiliate.shopee.co.th/offer/product_offer`. The tab is intentionally
left open. While it is open, the extension captures same-origin Shopee Affiliate
`/api/*` fetch/XHR responses in real time, keeps the latest captures in
`chrome.storage.local`, and forwards them to AutoGT Pro.

Latest captures from the desktop server:

`GET http://127.0.0.1:8788/api/shopee-affiliate-capture/latest?limit=20`

## Files

- `manifest.json` - Chrome extension manifest without custom icon/logo.
- `src/background.js` - service worker, WebSocket bridge, cookie/session capture.
- `src/content/dom.js` - shared DOM helpers.
- `src/content/google-labs.js` - Google Flow/Labs automation.
- `src/content/grok.js` and `src/content/grok-api.js` - Grok automation/API helpers.
- `src/content/tiktok.js` - TikTok automation.
- `src/content/overlay.js` - on-page HUD without logo.
- `src/popup/*` - extension popup without logo.
