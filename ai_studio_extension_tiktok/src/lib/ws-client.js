// Reconnecting WebSocket client for the MV3 service worker.
//
// Note: MV3 service workers can be suspended when idle, which drops the socket.
// background.js pairs this with a chrome.alarms keepalive that calls ensure()
// to re-open the connection whenever the worker wakes up.

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;

export class ReconnectingWS {
  /**
   * @param {() => Promise<string>} urlProvider resolves the ws:// URL
   * @param {{onOpen?: Function, onMessage?: (obj:any)=>void, onClose?: Function}} handlers
   */
  constructor(urlProvider, handlers = {}) {
    this.urlProvider = urlProvider;
    this.handlers = handlers;
    this.ws = null;
    this.backoff = INITIAL_BACKOFF_MS;
    this.connecting = false;
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async ensure() {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    try {
      const url = await this.urlProvider();
      // Probe the app over HTTP first. When it's closed we skip opening the
      // WebSocket entirely — so a not-running app produces no connection errors
      // on the extension's card (the common "app isn't open yet" state).
      if (!(await this._appReachable(url))) {
        this.connecting = false;
        this._scheduleReconnect();
        return;
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.backoff = INITIAL_BACKOFF_MS;
        this.connecting = false;
        this.handlers.onOpen?.();
      });

      ws.addEventListener("message", (ev) => {
        let obj;
        try {
          obj = JSON.parse(ev.data);
        } catch (e) {
          console.debug("[AutoGT] bad message", e);
          return;
        }
        this.handlers.onMessage?.(obj);
      });

      ws.addEventListener("close", () => {
        this.connecting = false;
        this.ws = null;
        this.handlers.onClose?.();
        this._scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        // close handler will follow and schedule the retry
        try {
          ws.close();
        } catch (_) {}
      });
    } catch (e) {
      this.connecting = false;
      this._scheduleReconnect();
    }
  }

  /** Is the desktop app up? A quick HTTP health check, silent on failure. */
  async _appReachable(wsUrl) {
    const healthUrl = wsUrl
      .replace(/^ws(s?):/, "http$1:")
      .replace(/\/ws\/extension$/, "/api/health");
    try {
      const res = await fetch(healthUrl, { method: "GET", cache: "no-store" });
      return res.ok;
    } catch (_) {
      return false; // connection refused = app not running
    }
  }

  _scheduleReconnect() {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    setTimeout(() => this.ensure(), delay);
  }

  send(obj) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
}
