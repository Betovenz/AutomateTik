// Runs in Shopee Affiliate's MAIN world so it can observe the page's own API
// traffic. The isolated bridge forwards these events to the extension worker.
(() => {
  if (window.__autogtShopeeAffiliateCaptureInstalled) return;
  window.__autogtShopeeAffiliateCaptureInstalled = true;

  const MESSAGE_SOURCE = "autogt-shopee-affiliate-api";
  const MAX_TEXT_LENGTH = 350000;

  const isAffiliateApi = (rawUrl) => {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      return url.hostname === "affiliate.shopee.co.th" && /^\/api\//.test(url.pathname);
    } catch (_) {
      return false;
    }
  };

  const trimText = (value) => {
    const text = String(value ?? "");
    return text.length > MAX_TEXT_LENGTH
      ? `${text.slice(0, MAX_TEXT_LENGTH)}\n...[truncated ${text.length - MAX_TEXT_LENGTH} chars]`
      : text;
  };

  const parseText = (value) => {
    const text = trimText(value);
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  };

  const requestBody = (value) => {
    if (value == null) return null;
    if (typeof value === "string") return parseText(value);
    if (value instanceof URLSearchParams) return value.toString();
    if (value instanceof FormData) {
      const out = {};
      for (const [key, item] of value.entries()) {
        out[key] = typeof item === "string" ? trimText(item) : `[${item?.constructor?.name || "File"}]`;
      }
      return out;
    }
    if (value instanceof Blob) return `[Blob ${value.type || "unknown"} ${value.size} bytes]`;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `[Binary ${value.byteLength || value.length || 0} bytes]`;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return trimText(value); }
  };

  const emit = (capture) => {
    try {
      window.postMessage({
        source: MESSAGE_SOURCE,
        capture: {
          capturedAt: new Date().toISOString(),
          pageUrl: location.href,
          ...capture,
        },
      }, location.origin);
    } catch (_) {
      /* Capturing must never affect the Shopee page. */
    }
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function autogtShopeeFetch(input, init) {
      const rawUrl = input?.url || input;
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      const startedAt = Date.now();
      const promise = Reflect.apply(originalFetch, this, arguments);
      if (!isAffiliateApi(rawUrl)) return promise;
      promise.then((response) => {
        response.clone().text()
          .then((text) => emit({
            transport: "fetch",
            method,
            url: response.url || new URL(String(rawUrl), location.href).href,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            requestBody: requestBody(init?.body),
            responseBody: parseText(text),
          }))
          .catch(() => {});
      }).catch((error) => emit({
        transport: "fetch",
        method,
        url: new URL(String(rawUrl), location.href).href,
        status: 0,
        ok: false,
        durationMs: Date.now() - startedAt,
        requestBody: requestBody(init?.body),
        error: String(error?.message || error),
      }));
      return promise;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function autogtShopeeXhrOpen(method, url) {
    this.__autogtShopeeCapture = {
      method: String(method || "GET").toUpperCase(),
      url: new URL(String(url || ""), location.href).href,
    };
    return Reflect.apply(originalOpen, this, arguments);
  };
  XMLHttpRequest.prototype.send = function autogtShopeeXhrSend(body) {
    const meta = this.__autogtShopeeCapture;
    if (meta && isAffiliateApi(meta.url)) {
      const startedAt = Date.now();
      const onDone = () => {
        this.removeEventListener("loadend", onDone);
        let responseBody = null;
        try {
          responseBody = this.responseType === "json" ? this.response : parseText(this.responseText || "");
        } catch (_) {
          responseBody = `[${this.responseType || "binary"} response]`;
        }
        emit({
          transport: "xhr",
          method: meta.method,
          url: this.responseURL || meta.url,
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          durationMs: Date.now() - startedAt,
          requestBody: requestBody(body),
          responseBody,
        });
      };
      this.addEventListener("loadend", onDone);
    }
    return Reflect.apply(originalSend, this, arguments);
  };

  window.postMessage({ source: MESSAGE_SOURCE, ready: true, pageUrl: location.href }, location.origin);
})();
