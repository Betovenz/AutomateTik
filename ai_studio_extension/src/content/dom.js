// Shared DOM helpers for AutoGT Pro content scripts.
// Loaded first in every content_scripts group, so site scripts can use `TB`.
// (Content scripts are not ES modules, so message-type strings are inlined here
//  and must stay in sync with src/lib/protocol.js.)

(function () {
  if (window.TB) return; // injected once per frame

  const CONTENT_PING = "__tb_ping";

  const TB = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    /** Wait until `selector` matches, or throw after `timeout` ms. */
    async waitFor(selector, { timeout = 30000, root = document, visible = true } = {}) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const el = root.querySelector(selector);
        if (el && (!visible || TB.isVisible(el))) return el;
        await TB.sleep(200);
      }
      throw new Error(`timeout waiting for: ${selector}`);
    },

    /** Wait until at least one of `selectors` matches; returns the element. */
    async waitForAny(selectors, opts = {}) {
      const deadline = Date.now() + (opts.timeout ?? 30000);
      while (Date.now() < deadline) {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && TB.isVisible(el)) return el;
        }
        await TB.sleep(200);
      }
      throw new Error(`timeout waiting for any: ${selectors.join(", ")}`);
    },

    isVisible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    },

    /** Set a React-controlled input/textarea value so the framework notices. */
    type(el, text) {
      el.focus();
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },

    /** Type into a contenteditable element (chat boxes, TikTok caption).
     *  Returns true if the text actually landed. execCommand('insertText') is the
     *  primary path (verified working on labs.google Flow's Lexical composer); if
     *  a stricter rich editor ignores it, fall back to a direct textContent set.
     *  Callers should still verify the field holds the prompt before submitting. */
    typeContentEditable(el, text) {
      el.focus();
      // execCommand keeps the framework's selection/state consistent.
      document.execCommand("selectAll", false, null);
      try {
        document.execCommand("insertText", false, text);
      } catch (_) {
        /* fall through to the textContent fallback below */
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const probe = text.slice(0, Math.min(12, text.length));
      if ((el.innerText || el.textContent || "").includes(probe)) return true;
      // execCommand was ignored — set the text directly as a last resort.
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
      return (el.innerText || el.textContent || "").includes(probe);
    },

    click(el) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    },

    // ---- robust element finding (resilient to selector churn) ---------------
    // These pick elements by *role + accessible label + geometry* rather than a
    // single brittle CSS selector, so they survive most class-name/markup changes.
    // The per-site scripts still pass explicit selector fallbacks for the rare
    // case heuristics miss — verify against the live DOM before trusting fully.

    _area(el) {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    },

    // Negative/positive label signals for prompt-field detection. `search` is a
    // NEGATIVE signal: on labs.google Flow the search box (388x38) is physically
    // larger than the collapsed prompt composer (566x20), so a naive "largest
    // field wins" picks search by mistake. We drop search/auth inputs and prefer
    // an explicit prompt label, then a contenteditable composer, then area.
    _PROMPT_NEG: /search|filter|comment|reply|email|password|\botp\b|\burl\b/i,
    _PROMPT_POS:
      /prompt|describe|message|chat|\bask\b|idea|imagine|create|generate|write|caption|story|scene|what.*(do|create|make)|คุณต้องการสร้างอะไร|สร้างอะไร/i,

    _promptSig(el) {
      const slatePlaceholder = el.querySelector?.('[data-slate-placeholder="true"]')?.textContent;
      return [
        el.placeholder,
        el.getAttribute("aria-label"),
        el.getAttribute("data-placeholder"), // contenteditable composers use this
        slatePlaceholder,
        el.title,
        el.getAttribute("data-testid"),
        el.name,
      ]
        .filter(Boolean)
        .join(" ");
    },

    _slatePromptField() {
      const placeholders = [
        ...document.querySelectorAll('[data-slate-placeholder="true"], [data-slate-editor="true"]'),
      ];
      for (const el of placeholders) {
        const sig = `${el.textContent || ""} ${TB._promptSig(el)}`;
        if (!TB._PROMPT_POS.test(sig)) continue;
        const editor = el.closest?.(
          '[contenteditable="true"], [contenteditable=""], [role="textbox"], [data-slate-editor="true"]'
        );
        if (editor && TB.isVisible(editor)) return editor;
      }
      return null;
    },

    /** The most likely prompt field: a visible, enabled textarea / contenteditable
     *  / text input. Prefers an explicit prompt-ish label (placeholder /
     *  aria-label / data-placeholder / visible placeholder text), then a
     *  contenteditable composer, then the largest by area — while excluding
     *  search/filter/auth inputs (see _PROMPT_NEG). */
    findPromptField() {
      const slate = TB._slatePromptField();
      if (slate) return slate;
      const cands = [
        ...document.querySelectorAll(
          'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-slate-editor="true"], input[type="text"], input:not([type])'
        ),
      ].filter((el) => {
        if (!TB.isVisible(el) || el.disabled) return false;
        if (el.getAttribute("aria-hidden") === "true" || el.getAttribute("readonly") !== null)
          return false;
        if (el.type === "search") return false;
        // Never drop a contenteditable composer; for plain inputs skip search/auth.
        return el.isContentEditable || !TB._PROMPT_NEG.test(TB._promptSig(el));
      });
      if (!cands.length) return null;
      // 1) explicit positive label, or the visible placeholder text of an empty box
      const hinted = cands.find(
        (el) =>
          TB._PROMPT_POS.test(TB._promptSig(el)) ||
          TB._PROMPT_POS.test((el.innerText || "").slice(0, 80))
      );
      if (hinted) return hinted;
      // 2) prefer a contenteditable composer (chat/prompt boxes usually are)
      const editable = cands.filter((el) => el.isContentEditable);
      const pool = editable.length ? editable : cands;
      // 3) largest by area within the chosen pool
      return pool.sort((a, b) => TB._area(b) - TB._area(a))[0];
    },

    /** A visible, enabled button/role=button whose accessible label matches `re`
     *  and does NOT match `exclude` (when given). The exclude guard matters on
     *  labs.google Flow: the real send button is "arrow_forward Create" but a
     *  decoy "add_2 Create" (add-scene) and a "delete View Trash" share words /
     *  the type=submit attribute, so a naive match can click the wrong one. */
    findButton(re, exclude = null) {
      const btns = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
      return (
        btns.find((b) => {
          if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
          if (!TB.isVisible(b)) return false;
          const label = `${b.innerText || b.textContent || ""} ${
            b.getAttribute("aria-label") || ""
          } ${b.title || ""} ${b.value || ""}`;
          if (exclude && exclude.test(label)) return false;
          return re.test(label);
        }) || null
      );
    },

    /** Wait until findButton(re, exclude) yields a button, else throw. `opts` is
     *  a timeout in ms, or `{ timeout, exclude }`. */
    async waitForButton(re, opts = {}) {
      const { timeout = 30000, exclude = null } =
        typeof opts === "number" ? { timeout: opts } : opts;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const b = TB.findButton(re, exclude);
        if (b) return b;
        await TB.sleep(200);
      }
      throw new Error(`timeout waiting for button matching ${re}`);
    },

    /** Geometry fallback for a chat-style composer's send control: the
     *  bottom-right, enabled button within the prompt's container, used when the
     *  send button has no matchable label (labs.google Flow's send is an
     *  icon-only "arrow_forward"). Rejects +/Agent/Add/More/Settings/Trash/etc. */
    findComposerSend(promptEl) {
      if (!promptEl) return null;
      let root = promptEl;
      for (let i = 0; i < 6 && root.parentElement; i++) root = root.parentElement;
      const reject = /\badd\b|add_|agent|more|settings|help|back|search|filter|trash|menu|attach|upload|expand|swap/i;
      const btns = [...root.querySelectorAll('button, [role="button"]')].filter((b) => {
        if (b.disabled || b.getAttribute("aria-disabled") === "true" || !TB.isVisible(b)) return false;
        const name = `${b.innerText || b.textContent || ""} ${
          b.getAttribute("aria-label") || ""
        } ${b.title || ""}`.trim();
        return !reject.test(name);
      });
      if (!btns.length) return null;
      // The send arrow sits at the composer's bottom-right corner.
      return btns.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.right + rb.bottom - (ra.right + ra.bottom);
      })[0];
    },

    /** Dispatch a real Enter key sequence (chat composers often submit on Enter). */
    pressEnter(el) {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    },

    // ---- generated-media detection ------------------------------------------

    /** Heuristic: a real generated <img>, not an avatar / icon / logo / sprite.
     *  `opts` is a number (legacy minNatural) or { minNatural, minRendered,
     *  allowData }. allowData=true keeps data: URIs — grok.com/imagine returns its
     *  results as base64 data URIs, unlike labs.google's https media URLs. The
     *  rendered-size floor drops tiny avatars/icons even when natural size is big
     *  (e.g. a 48px-rendered 482x536 profile pic). */
    isContentImage(img, opts = {}) {
      const { minNatural = 256, minRendered = 80, allowData = false } =
        typeof opts === "number" ? { minNatural: opts } : opts;
      const src = img?.currentSrc || img?.src;
      if (!src) return false;
      if (!allowData && src.startsWith("data:")) return false; // inline icons are data: URIs
      const nw = img.naturalWidth || img.width || 0;
      const nh = img.naturalHeight || img.height || 0;
      if (nw < minNatural || nh < minNatural) return false; // skip thumbnails/spinners
      const r = img.getBoundingClientRect();
      if (r.width < minRendered || r.height < minRendered) return false; // tiny on page = avatar/icon
      const hint = `${img.alt || ""} ${img.className || ""} ${
        img.closest("[aria-label]")?.getAttribute("aria-label") || ""
      }`.toLowerCase();
      if (/avatar|logo|\bicon\b|emoji|sprite|profile|favicon|rounded-full/.test(hint)) return false;
      return TB.isVisible(img);
    },

    /** Snapshot of current generated-image URLs (the before/after baseline). */
    imageUrls(opts) {
      return new Set(
        [...document.images]
          .filter((i) => TB.isContentImage(i, opts))
          .map((i) => i.currentSrc || i.src)
      );
    },

    /** First content image whose URL is NOT in `before` (i.e. freshly generated). */
    freshImageUrl(before, opts) {
      for (const img of document.images) {
        const src = img.currentSrc || img.src;
        if (src && !before.has(src) && TB.isContentImage(img, opts)) return src;
      }
      return null;
    },

    _videoSrc(v) {
      return (
        v.currentSrc ||
        v.getAttribute("src") ||
        v.querySelector("source[src]")?.getAttribute("src") ||
        null
      );
    },

    /** Best playable <video> URL under `selector` (src / currentSrc / <source>). */
    videoUrl(selector = "video") {
      for (const v of document.querySelectorAll(selector)) {
        if (!TB.isVisible(v)) continue;
        const src = TB._videoSrc(v);
        if (src) return src; // blob: is valid here — generated clips are often blobs
      }
      return null;
    },

    /** Snapshot of current <video> URLs (the before/after baseline). Needed
     *  because labs.google Flow keeps prior renders on the page — without a
     *  baseline the video branch would return a STALE earlier clip. */
    videoUrls() {
      const out = new Set();
      for (const v of document.querySelectorAll("video")) {
        const src = TB._videoSrc(v);
        if (src) out.add(src);
      }
      return out;
    },

    /** First visible <video> whose URL is NOT in `before` (freshly generated). */
    freshVideoUrl(before) {
      for (const v of document.querySelectorAll("video")) {
        if (!TB.isVisible(v)) continue;
        const src = TB._videoSrc(v);
        if (src && !before.has(src)) return src;
      }
      return null;
    },

    /** Download a (possibly cross-origin) media URL into a File for upload.
     *  data:/blob: and same-origin/CORS-OK hosts are read directly; otherwise
     *  (the common case — TikTok pulling labs.google / assets.grok.com media) we
     *  relay through the background service worker, which fetches with the
     *  extension's host_permissions and isn't bound by the page's CORS policy. */
    async fetchAsFile(url, filename) {
      const toFile = (blob) =>
        new File([blob], filename, { type: blob.type || "application/octet-stream" });

      if (url.startsWith("data:") || url.startsWith("blob:")) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
        return toFile(await res.blob());
      }
      // Try a direct fetch first (same-origin / CORS-enabled hosts).
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.ok) return toFile(await res.blob());
      } catch (_) {
        /* CORS or network error — fall back to the background fetch below */
      }
      // Cross-origin: relay through the background service worker.
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ __tb: true, type: "fetchMedia", url }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(r);
        });
      });
      if (!resp || !resp.ok) throw new Error(resp?.error || "background media fetch failed");
      return new File([TB._b64ToBytes(resp.base64)], filename, {
        type: resp.type || "application/octet-stream",
      });
    },

    /** Decode a base64 string (from the background fetch relay) into bytes. */
    _b64ToBytes(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    },

    /** Attach a File to an <input type=file> without a real user file picker. */
    setFileInput(input, file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },

    // ---- progress relay back to the app (via background) ----
    report(jobId, stage, message, progress) {
      chrome.runtime.sendMessage({ __tb: true, type: "ext.status", jobId, stage, message, progress });
    },
  };

  window.TB = TB;

  // Liveness probe used by background.waitForContentScript().
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === CONTENT_PING) {
      sendResponse({ ready: true, href: location.href });
      return true;
    }
  });
})();
