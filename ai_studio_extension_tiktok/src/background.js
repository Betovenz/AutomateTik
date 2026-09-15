// AutoGT Pro — MV3 service worker.
// Bridges the desktop app (localhost WebSocket) to per-site content scripts.

import { ReconnectingWS } from "./lib/ws-client.js";
import { MSG, ACTION, envelope, resolveWsUrl } from "./lib/protocol.js";

const EXTENSION_ROLE = chrome.runtime.getManifest().name.includes("TikTok") ? "tiktok" : "main";

// ---- Site routing -----------------------------------------------------------
// TODO: confirm exact tool URLs against the live sites; these are the entry
// points the content scripts drive.
const SOURCE_URLS = {
  google_labs: {
    // ImageFX was merged into Flow — /fx/tools/image-fx now redirects to /fx/tools/flow.
    // Both modes use the Flow editor; the content script picks Image/Video there.
    image: "https://labs.google/fx/tools/flow",
    video: "https://labs.google/fx/tools/flow",
  },
  grok: {
    // /imagine is Grok's dedicated image/video tool (direct prompt + Image/Video
    // toggle) — NOT the chat UI. Verified live: composer is a TipTap contenteditable.
    image: "https://grok.com/imagine",
    video: "https://grok.com/imagine",
  },
};
const TIKTOK_UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";

const CONTENT_PING = "__tb_ping";

// ---- grok anti-bot token sniffer (the G-Labs mechanism) --------------------
// grok signs every /rest/* request with an x-statsig-id header inside its own
// (private, non-patchable) apiClient — a MAIN-world fetch hook can't reproduce it,
// and a stale/localStorage value gets a 403 "rejected by anti-bot rules". G-Labs
// sidesteps all of that: it watches grok's OWN outbound /rest/* requests with
// chrome.webRequest and lifts the REAL signed token off the wire, then reuses it.
// We mirror G-Labs' capture STRATEGY: a BROAD filter (any method, any /rest/*) plus
// "freeze-after-reset" — once we hold a token we only REPLACE it with a strictly-better
// (lower-tier) one, never downgrade and never with our OWN injected POST token. warmup always
// makes grok poll BEFORE our POST fires, so grok's genuine token is frozen first — that kills
// the self-POST feedback loop WITHOUT the old method/path filter that could capture NOTHING
// when grok's frontend doesn't happen to emit a GET /rest/app-chat/ during warmup. Tiers encode
// the proven-valid token CLASS so we STILL prefer grok's GET /rest/app-chat/ poll token
// (LIVE-PROVEN valid for conversations/new) and fall back to a broader token only to avoid
// MISSING. Reset on warmup / 403. [[grok-realtab-api-pivot]]
let grokStatsig = null;
let grokStatsigAt = 0; // when grokStatsig was last captured (the token is freshness-bound)
let grokStatsigTier = 0; // 1=GET /rest/app-chat/ (proven); 2=other GET /rest/*; 3=any /rest/* — lower is better
// NOTE 2026-06-19: LENGTH is NOT the accept/reject discriminator — grok's OWN working
// conversations/new uses a len-94 x-statsig-id (operator-captured). A len-gate was tried and
// REVERTED. The real delta between grok's own request (accepted) and our replay of a sniffed
// token (rejected) is still under investigation (per-request binding? a missing header? the
// fetch mechanism?) — the diagnostic below + a console-replay test drive it. [[grok-403-glabs-vs-ours]]
// Diagnostic: distinct (length, tier, method, path) token classes grok emitted since the last
// warmup reset. Surfaced in the EXT_STATUS line so a 403 post-mortem shows what grok made
// AVAILABLE during warmup (and which request produced it).
let grokStatsigSeen = [];
// grok's REAL browser-telemetry headers, sniffed off its OWN /rest/* request alongside the frozen
// x-statsig-id (a mutually-consistent set). LIVE-VERIFIED 2026-06-19: grok's working
// conversations/new sends baggage + sentry-trace + traceparent; a request STRIPPED of them gets
// anti-bot code-7 ("Request rejected by anti-bot rules"). We were sending NONE ("ZERO baggage" —
// a wrong assumption). Replayed on our relayed POST so anti-bot sees a genuine browser request.
// [[grok-403-glabs-vs-ours]]
let grokSentryHeaders = null;
// The exact x-statsig-id WE last injected into the in-tab relay POST. The sniffer must NEVER
// re-capture our own echoed token (a value that already 403'd) and freeze it — that is the
// self-POST feedback loop the old GET-only filter guarded against. Excluding by VALUE kills the
// loop regardless of method/path/tier, so the broad filter is safe. [[grok-realtab-api-pivot]]
let grokInjectedStatsig = null;
function _isStatsigError(v) {
  // grok's statsig signer sometimes THROWS and emits its error AS the header value — base64 of
  // e.g. "x0:TypeError: Cannot read properties of undefined (reading 'childNodes')" (the "x0:"
  // prefix is grok's own failed-signature sentinel). anti-bot 403s such a broken token, so we must
  // never freeze/replay it (freeze-first would otherwise lock onto grok's FIRST-emitted error
  // token even though a real signed one follows). DECODE + reject. [[grok-realtab-api-pivot]]
  try {
    const d = atob(v);
    return d.startsWith("x0:") || /TypeError|Cannot read prop|childNodes|undefined/.test(d);
  } catch (_) {
    return false; // not base64 / undecodable → treat as a normal (binary) token
  }
}
function setGrokStatsig(v, tier = 2) {
  if (!(v && typeof v === "string" && v.length > 10)) return;
  if (v === grokInjectedStatsig) return; // our own echoed token — ignore (no self-feedback)
  if (_isStatsigError(v)) return; // grok's signer-error sentinel (x0:…) — anti-bot 403s it
  // Freeze-FIRST — byte-for-byte G-Labs' `if (_ftCache) return;`. Once we hold ANY genuine grok
  // token, keep THAT EXACT one for the whole job; never swap it mid-chain. The old tier system
  // let a lower-tier token (e.g. a GET /rest/app-chat/ poll firing mid-job) REPLACE the frozen
  // token between upload→create→convo hops — the "inconsistent statsig across the chain" anomaly
  // grok_api.py:234-240 warns triggers anti-bot code-7. G-Labs freezes the FIRST /rest/* token it
  // sees after a (re)warm and reuses it for every hop; a `force` warmup resets it. [[grok-realtab-api-pivot]]
  if (grokStatsig) return; // freeze-first (G-Labs `if(_ftCache)return`) — never swap mid-job
  grokStatsig = v;
  grokStatsigAt = Date.now();
  grokStatsigTier = tier;
}
function _statsigTier(details) {
  const isGet = (details.method || "GET").toUpperCase() === "GET";
  if (isGet && /\/rest\/app-chat\//.test(details.url || "")) return 1; // proven poll-token class
  if (isGet) return 2; // other GET /rest/* (fallback)
  return 3; // any other /rest/* (last resort, e.g. a POST grok itself signs)
}
function _grokSeenSummary() {
  return grokStatsigSeen.length ? grokStatsigSeen.map((c) => c.len + "/" + c.m + " " + c.path).join(", ") : "none";
}
function _sniffStatsig(details) {
  try {
    let statsig = null, baggage = null, sentryTrace = null, traceparent = null;
    for (const h of details.requestHeaders || []) {
      const n = (h.name || "").toLowerCase();
      const v = h.value;
      if (!v) continue;
      if (n === "x-statsig-id") statsig = v;
      else if (n === "baggage") baggage = v;
      else if (n === "sentry-trace") sentryTrace = v;
      else if (n === "traceparent") traceparent = v;
    }
    if (!statsig) return;
    const tier = _statsigTier(details);
    // Record each DISTINCT token class (len+tier) for the warmup post-mortem.
    if (statsig !== grokInjectedStatsig && !_isStatsigError(statsig) && grokStatsigSeen.length < 16 &&
        !grokStatsigSeen.some((c) => c.k === statsig.length + "t" + tier)) {
      let path = "?";
      try { path = new URL(details.url).pathname.replace(/^\/rest\//, ""); } catch (_) {}
      grokStatsigSeen.push({
        k: statsig.length + "t" + tier, len: statsig.length, tier,
        m: (details.method || "GET").toUpperCase(), path,
      });
    }
    setGrokStatsig(statsig, tier);
    // Snapshot grok's telemetry headers (the freshest set from grok's OWN /rest/* requests). The
    // `statsig !== grokInjectedStatsig` gate above means this is grok's genuine request, never our
    // injected echo — so no feedback loop. anti-bot code-7 rejects a request stripped of these.
    // [[grok-403-glabs-vs-ours]]
    if (statsig !== grokInjectedStatsig && (baggage || sentryTrace || traceparent)) {
      grokSentryHeaders = { baggage, "sentry-trace": sentryTrace, traceparent };
    }
  } catch (_) {}
}
try {
  const _filt = { urls: ["https://grok.com/rest/*", "https://*.grok.com/rest/*"] };
  chrome.webRequest.onBeforeSendHeaders.addListener(_sniffStatsig, _filt, ["requestHeaders", "extraHeaders"]);
  // onSendHeaders reflects the headers ACTUALLY put on the wire (post-modification) — more
  // reliable for observation than onBeforeSendHeaders.
  chrome.webRequest.onSendHeaders.addListener(_sniffStatsig, _filt, ["requestHeaders", "extraHeaders"]);
} catch (e) {
  // webRequest unavailable (permission/host) — the in-page hook (grok-api.js → grok.js) covers it.
}

async function readProfileBindToken() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const rawUrl = String(tab.url || "");
      if (!rawUrl.includes("autogt_profile_bind=")) continue;
      const url = new URL(rawUrl);
      const token = String(url.searchParams.get("autogt_profile_bind") || "").trim();
      if (token) return token;
    }
  } catch (_) {
    /* tab access can fail during early service-worker wake; command fallback still binds */
  }
  return "";
}

async function cleanupProfileBindTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs
      .filter((tab) => String(tab.url || "").includes("autogt_profile_bind=") && tab.id != null)
      .map((tab) => chrome.tabs.remove(tab.id).catch(() => {})));
  } catch (_) {
    /* bind tab cleanup is best-effort */
  }
}

async function getExtensionProfileInfo() {
  const stored = await chrome.storage.local.get(["installId", "profileLabel", "installCreatedAt"]);
  let installId = String(stored.installId || "").trim();
  if (!installId) {
    installId = crypto?.randomUUID ? crypto.randomUUID() : `ext-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({
      installId,
      installCreatedAt: new Date().toISOString(),
    });
  }
  const profileLabel = String(stored.profileLabel || `Chrome ${installId.slice(-4)}`);
  const bindToken = await readProfileBindToken();
  return {
    installId,
    profileLabel,
    installCreatedAt: stored.installCreatedAt || "",
    bindToken,
  };
}

// ---- WebSocket to the desktop app ------------------------------------------
const bus = new ReconnectingWS(resolveWsUrl, {
  onOpen: () => {
    setConnected(true);
    getExtensionProfileInfo()
      .then((profile) => {
        bus.send(envelope(MSG.EXT_HELLO, null, {
          version: chrome.runtime.getManifest().version,
          extensionRole: EXTENSION_ROLE,
          ...profile,
        }));
      })
      .catch(() => {
        bus.send(envelope(MSG.EXT_HELLO, null, {
          version: chrome.runtime.getManifest().version,
          extensionRole: EXTENSION_ROLE,
        }));
      });
    autoCaptureBrowserSessions({ allowProbe: false }).catch(() => {});
  },
  onClose: () => setConnected(false),
  onMessage: (msg) => handleAppMessage(msg).catch((e) => reportError(msg?.jobId, e)),
});

// Persist the bridge state for the popup. No toolbar badge: the operator asked
// not to surface an "ON" pill on the action icon — connection is shown in the
// popup's App Bridge row instead.
function setConnected(connected) {
  chrome.storage.local.set({ connected });
}

// ---- Local no-login reconnect ---------------------------------------------
function launchApp() {
  bus.ensure();
  return Promise.resolve({ ok: true, localOnly: true });
}

// Keepalive: MV3 workers idle out and drop the socket. Re-ensure on a timer.
chrome.runtime.onInstalled.addListener(() => bus.ensure());
chrome.runtime.onStartup.addListener(() => bus.ensure());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !/^https:\/\/([^/]+\.)?(tiktok|shopee|facebook)\./i.test(tab.url)) return;
  autoCaptureBrowserSessions({ allowProbe: false }).catch(() => {});
});
// Guarded so a missing "alarms" permission can never crash the service worker.
if (chrome.alarms) {
  chrome.alarms.create("tb-keepalive", { periodInMinutes: 0.5 });
  chrome.alarms.create("autogt-cookie-scan", { periodInMinutes: 5 });
  // Create once — recreating on every SW wake-up resets the timer so it may never fire.
  chrome.alarms.get("tb-grok-keepalive", (a) => {
    if (!a) chrome.alarms.create("tb-grok-keepalive", { periodInMinutes: 1 });
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === "tb-keepalive") bus.ensure();
    else if (a.name === "tb-grok-keepalive") grokKeepAlive().catch(() => {});
    else if (a.name === "autogt-cookie-scan") autoCaptureBrowserSessions({ allowProbe: false }).catch(() => {});
  });
}
bus.ensure();

// ---- App -> extension command handling -------------------------------------
async function handleAppMessage(msg) {
  if (!msg) return;
  // Keepalive: simply receiving this over the socket resets the SW idle timer.
  if (msg.type === MSG.EXT_PING) return;
  if (msg.type !== MSG.COMMAND) return;
  const { jobId, data } = msg;
  const action = data?.action;

  if (action === ACTION.PING) {
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action, ok: true }));
    return;
  }
  if (action === ACTION.GENERATE) return runGenerate(jobId, data);
  if (action === ACTION.PUBLISH) return runPublish(jobId, data);
  if (action === ACTION.CAPTURE_LOGIN) return runCaptureLogin(data);
  if (action === ACTION.HARVEST_LABS) return runHarvestLabs(jobId);
  if (action === ACTION.MINT_CAPTCHA) return runMintCaptcha(jobId, data);
  if (action === ACTION.REFRESH_CAPTCHA) return runRefreshCaptcha(jobId);
  if (action === ACTION.HUD) return runHud(jobId, data);
  if (action === ACTION.CHECK_TIKTOK) return runCheckTikTok(jobId);
  if (action === ACTION.CHECK_TIKTOK_LINKS) return runCheckTikTokLinks(jobId, data);
  if (action === ACTION.GET_TIKTOK_PROFILES) return runGetTikTokProfiles(jobId, data);
  if (action === ACTION.CLAIM_PROFILE_BINDING) return runClaimProfileBinding(jobId, data);
  if (action === ACTION.CHECK_SHOPEE_LINKS) return runCheckShopeeLinks(jobId, data);
  if (action === ACTION.PULL_PRODUCTS) return runPullProducts(jobId);
  if (action === ACTION.ADD_TO_SHOWCASE) return runAddToShowcase(jobId, data);
  if (action === ACTION.STAGE_CLIP) return runStageClip(jobId, data);
  if (action === ACTION.GROK_FETCH) return runGrokFetch(jobId, data);
  if (action === ACTION.GROK_WS) return runGrokWs(jobId, data);
  reportError(jobId, new Error(`unknown action: ${action}`));
}

// ---- Browser-Login capture --------------------------------------------------
// Each "Add Account" opens a normal NEW browser window at the provider's sign-in
// page and waits for the user to sign in, then harvests that account's cookies.
//
// We snapshot the session-token already present (if an account is signed in) and
// accept ONLY a session-token whose value is NEW — so we capture the account the
// user signs into now, never a pre-existing one. We deliberately do NOT clear any
// cookies (this is the user's real profile — wiping would sign them out of Google).
// To add a *different* account, sign in with another Google account in that window.
//
// Per provider: the cookie domain holding the session and the cookie-name fragment
// that signals "signed in". google_labs = NextAuth (high confidence); grok is
// best-effort until verified against the live site.
const CAPTURE = {
  google_labs: { domain: "labs.google", signedIn: "session-token" },
  grok: { domain: "grok.com", signedIn: "sso" },
  tiktok: { domain: "tiktok.com", signedIn: "sessionid" },
};
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000; // give the user time to sign in
const CAPTURE_POLL_MS = 2000;
// The logged-in TikTok home (SSR state / profile nav holding the @handle) renders a beat
// AFTER the sessionid cookie appears, so the post-login handle read retries briefly rather
// than reading once and missing it — mirrors cdp_login.py's ACCOUNT_NAME_ATTEMPTS loop.
const TIKTOK_HANDLE_ATTEMPTS = 6;
const TIKTOK_HANDLE_POLL_MS = 700;

// Only one capture at a time so two sign-ins can't be confused for each other. A capture that
// the user abandons (opened the sign-in tab, never logged in) would otherwise leave this stuck
// true until waitForLoginCookies times out — blocking every retry — so it AUTO-EXPIRES.
let captureInFlight = false;
let captureStartedAt = 0;

async function runCaptureLogin(data) {
  const provider = data?.provider;
  const cfg = CAPTURE[provider];
  if (!cfg) return reportError(null, new Error(`no capture config for ${provider}`));

  // grok generates inside THIS browser's real logged-in tab, so its sign-in must create the
  // session HERE (same profile). Its capture is idempotent + tolerant of repeated clicks
  // (re-focus the tab, never an "in progress" error) and captures immediately if already
  // signed in. [[grok-realtab-api-pivot]]
  if (provider === "grok") return runGrokCapture(data, cfg);

  // google_labs reaches the extension ONLY as the CDP-blocked fallback (normal labs add uses
  // the server-side throwaway-profile CDP). On the managed/policy machines that need this
  // fallback the user is usually ALREADY signed into labs.google here, so — like grok —
  // capture the current session immediately; otherwise open the sign-in page and watch for
  // the login. (The strict "wait for a NEW token" path below would time out on an already-
  // signed-in browser since NextAuth won't rotate the token.) [[flow-add-account-debug-port-blocked]]
  if (provider === "google_labs") return runLabsCapture(data, cfg);

  if (captureInFlight && Date.now() - captureStartedAt < 90000) {
    return sendCaptured(provider, false, "another sign-in is already in progress — finish it first");
  }
  captureInFlight = true;
  captureStartedAt = Date.now();

  let win = null;
  try {
    try {
      // A normal (non-incognito) browser window, opened large at the sign-in page.
      win = await chrome.windows.create({ url: data.url, focused: true, width: 1280, height: 900 });
    } catch (_) {
      return sendCaptured(provider, false, "could not open the sign-in window");
    }
    // Snapshot any session-token already present so we capture ONLY the account
    // the user signs into now — not one that was already logged in.
    const known = await sessionTokenValues(cfg);
    const cookies = await waitForLoginCookies(cfg, known);
    if (!cookies) {
      return sendCaptured(provider, false, "sign-in not detected (timed out)");
    }
    // Best-effort: read the signed-in @handle from the still-open login window before the
    // finally closes it, so the row shows the real account (the CDP path has no name on this
    // CDP-blocked fallback). A miss is harmless — generic label + manual rename still work.
    const handle = provider === "tiktok" ? await readTikTokHandle(win && win.id) : "";
    // Shape like the "Cookie Exporter" export so the app's existing parser handles it.
    return sendCaptured(provider, true, null, JSON.stringify(cookies), handle);
  } finally {
    if (win && win.id != null) await chrome.windows.remove(win.id).catch(() => {});
    captureInFlight = false;
  }
}

// Injected into the signed-in tiktok.com tab (ISOLATED world is enough — it reads a DOM
// <script> tag, no page globals required) to extract the LOGGED-IN account's @handle. Mirrors
// cdp_login.py `_TIKTOK_ACCOUNT_JS`: structural SSR JSON first (language-independent), then a
// Thai/English-aware DOM fallback. Self-contained — executeScript serialises it, so it can
// reference only its own locals. [[tiktok-account-shows-generic-label]]
function extractTikTokHandle() {
  function pick(u) {
    var id = u && (u.uniqueId || u.unique_id);
    return id ? "@" + id : "";
  }
  try {
    var el0 = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
    if (el0 && el0.textContent) {
      var d = JSON.parse(el0.textContent);
      var sc = d && d["__DEFAULT_SCOPE__"];
      var cx = sc && sc["webapp.app-context"];
      var r0 = pick(cx && cx.user);
      if (r0) return r0;
    }
  } catch (e) {}
  try {
    if (window.SIGI_STATE && window.SIGI_STATE.AppContext && window.SIGI_STATE.AppContext.user) {
      var r1 = pick(window.SIGI_STATE.AppContext.user);
      if (r1) return r1;
    }
  } catch (e) {}
  try {
    var h = function (u) {
      var m = u && u.match(/^\/@([\w.\-]+)/);
      return m ? "@" + m[1] : "";
    };
    var nav = document.querySelector(
      'a[data-e2e="nav-profile"],[data-e2e="nav-profile"] a,a[data-e2e*="profile" i][href^="/@"]'
    );
    if (nav) {
      var r2 = h(nav.getAttribute("href"));
      if (r2) return r2;
    }
    var ls = document.querySelectorAll('a[href^="/@"]');
    for (var i = 0; i < ls.length; i++) {
      var t = (ls[i].textContent || "").trim().toLowerCase();
      if (t === "profile" || t === "โปรไฟล์") {
        var r3 = h(ls[i].getAttribute("href"));
        if (r3) return r3;
      }
    }
  } catch (e) {}
  return "";
}

// Best-effort read of the signed-in TikTok @handle from a login window's tiktok.com tab.
// Retries briefly because the logged-in home renders after the sessionid cookie (see the
// constants above). Never throws (cosmetic only) — returns "" on any failure so the capture
// still succeeds (empty → generic label, which the operator can rename by hand).
async function readTikTokHandle(windowId) {
  if (windowId == null) return "";
  const hostOf = (u) => {
    try {
      return new URL(u || "").hostname;
    } catch (_) {
      return "";
    }
  };
  const tiktokTab = async () => {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.find((t) => /(^|\.)tiktok\.com$/.test(hostOf(t.url))) || tabs[0];
  };
  // The login mints sessionid via XHR with no full reload, so the page's SSR JSON + SIGI_STATE
  // still describe the logged-OUT initial render (no uniqueId) and the profile nav may not have
  // re-rendered — the read came back empty → generic label. Reload the tiktok tab ONCE so it
  // re-fetches SSR WITH the session cookie, then poll. Best-effort. [[tiktok-account-shows-generic-label]]
  try {
    const t = await tiktokTab();
    if (t && t.id != null) {
      await chrome.tabs.reload(t.id);
      await sleep(TIKTOK_HANDLE_POLL_MS); // let the reload start re-fetching SSR before polling
    }
  } catch (_) {
    /* tab gone / not reloadable — the poll below still tries the live page */
  }
  for (let attempt = 0; attempt < TIKTOK_HANDLE_ATTEMPTS; attempt++) {
    // Stop early if the user closed the login window — otherwise we'd burn the full retry
    // budget querying a dead window while the panel looks frozen.
    if (!(await chrome.windows.get(windowId).catch(() => null))) return "";
    try {
      const tab = await tiktokTab();
      if (tab && tab.id != null) {
        // MAIN world so extractTikTokHandle can also read the page's SIGI_STATE global
        // (the SSR <script> tag + DOM strategies work in any world; SIGI_STATE needs MAIN).
        const out = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: extractTikTokHandle,
        });
        const v = out && out[0] && out[0].result;
        if (typeof v === "string" && v) return v;
      }
    } catch (_) {
      /* tab still navigating / not injectable yet — retry */
    }
    if (attempt < TIKTOK_HANDLE_ATTEMPTS - 1) await sleep(TIKTOK_HANDLE_POLL_MS); // no wait after the last try
  }
  return "";
}

// grok-specific capture — open/focus a grok.com TAB in the extension's own browser for sign-in,
// then harvest the cookie. Idempotent: if already signed in it captures immediately (no tab, no
// wait); otherwise it opens/focuses ONE grok tab and runs ONE background watcher, so clicking
// "Add Account" repeatedly just brings that tab to the front instead of erroring.
let grokWatching = false;
async function runGrokCapture(data, cfg) {
  // Already signed in (the extension's browser has a live grok session)? capture it now.
  const current = await currentCookiesIfSignedIn(cfg);
  if (current) {
    grokWatching = false;
    return sendCaptured("grok", true, null, JSON.stringify(current));
  }
  // Not signed in → bring a grok.com tab to the front (reuse one, or open in an existing
  // normal window; only spawn a new window if Chrome has none open) so the user can log in.
  let tab = (await chrome.tabs.query({ url: ["https://grok.com/*", "https://*.grok.com/*"] }))[0];
  try {
    if (tab) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
      await chrome.tabs.update(tab.id, { active: true });
    } else {
      const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
      const w = wins.find((x) => x.focused) || wins[0];
      if (w) {
        try { await chrome.windows.update(w.id, { focused: true }); } catch (_) {}
        tab = await chrome.tabs.create({ windowId: w.id, url: data.url, active: true });
      } else {
        tab = await chrome.tabs.create({ url: data.url, active: true });
      }
    }
  } catch (e) {
    return sendCaptured("grok", false, "could not open a grok.com tab: " + (e?.message || e));
  }
  // ONE watcher; a repeat click above already re-focused the tab, so just return here.
  if (grokWatching) return;
  grokWatching = true;
  try {
    const known = await sessionTokenValues(cfg);
    const cookies = await waitForLoginCookies(cfg, known);
    if (cookies) {
      try { await chrome.tabs.update(tab.id, { url: "https://grok.com/imagine" }); } catch (_) {}
      sendCaptured("grok", true, null, JSON.stringify(cookies));
    } else {
      sendCaptured("grok", false, "ยังไม่พบการล็อกอิน grok — ลงชื่อเข้าใช้ในแท็บ grok ที่เปิดอยู่ แล้วกดเพิ่มบัญชีอีกครั้ง");
    }
  } finally {
    grokWatching = false;
  }
}

// labs CDP-blocked fallback — capture the labs session already live in this browser, else open
// the sign-in page and watch for it. Mirrors runGrokCapture but opens a dedicated window (labs
// has no in-browser generation tab to reuse) and closes it once captured.
async function runLabsCapture(data, cfg) {
  // Already signed into labs in this browser? capture it now (no window, no wait).
  const current = await currentCookiesIfSignedIn(cfg);
  if (current) return sendCaptured("google_labs", true, null, JSON.stringify(current));
  if (captureInFlight && Date.now() - captureStartedAt < 90000) {
    return sendCaptured("google_labs", false, "another sign-in is already in progress — finish it first");
  }
  captureInFlight = true;
  captureStartedAt = Date.now();
  let win = null;
  try {
    try {
      win = await chrome.windows.create({ url: data.url, focused: true, width: 1280, height: 900 });
    } catch (_) {
      return sendCaptured("google_labs", false, "could not open the sign-in window");
    }
    const known = await sessionTokenValues(cfg);
    const cookies = await waitForLoginCookies(cfg, known);
    if (!cookies) {
      return sendCaptured("google_labs", false, "ยังไม่พบการล็อกอิน labs.google — ลงชื่อเข้าใช้ในหน้าต่างที่เปิด แล้วลองอีกครั้ง");
    }
    return sendCaptured("google_labs", true, null, JSON.stringify(cookies));
  } finally {
    if (win && win.id != null) await chrome.windows.remove(win.id).catch(() => {});
    captureInFlight = false;
  }
}

// The provider's current cookies as a capture blob, or null if not signed in. Shared by the
// providers that capture the session ALREADY present in this browser (grok, and google_labs
// when used as the CDP-blocked fallback) — never the strict "wait for a NEW token" path.
async function currentCookiesIfSignedIn(cfg) {
  let all = [];
  try { all = await chrome.cookies.getAll({ domain: cfg.domain }); } catch (_) {}
  if (!all.some((c) => c.name.includes(cfg.signedIn) && c.value)) return null;
  return all.map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate ?? null,
  }));
}

// Read the user's CURRENT labs.google cookies (+ the google.com SSO jar) from their logged-in
// browser, with NO window, and return them so the app can reconnect a dead-token account
// WITHOUT popping a fresh login (the competitor's cookie-import trick). Correlated reply on
// EXT_RESULT keyed by (jobId, action) so the hub can await it via _command:
//   ok=false                → the tab isn't signed into labs.google (app falls back to login)
//   cookie       (labs-only)→ stored on the account row (keeps accounts.json minimal)
//   cookieInject (labs+SSO) → seeded into the persist profile so a FUTURE reconnect is silent
async function runHarvestLabs(jobId) {
  let reply = { action: ACTION.HARVEST_LABS, ok: false, cookie: "", cookieInject: "" };
  try {
    const labs = await currentCookiesIfSignedIn(CAPTURE.google_labs);
    if (labs) {
      let google = [];
      try {
        // domain:"google.com" domain-matches *.google.com — the full SSO jar (SID /
        // __Secure-1PSID / accounts.google.com …). labs.google is a separate TLD, harvested
        // above; together they reproduce a real login so the seeded profile re-auths silently.
        const raw = await chrome.cookies.getAll({ domain: "google.com" });
        google = raw.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate ?? null,
        }));
      } catch (_) {
        /* SSO jar unreadable — labs-only still gives a warm (shorter-lived) reconnect */
      }
      reply = {
        action: ACTION.HARVEST_LABS,
        ok: true,
        cookie: JSON.stringify(labs),
        cookieInject: JSON.stringify(labs.concat(google)),
      };
    }
  } catch (_) {
    /* fall through with ok:false → the app pops the visible login as before */
  }
  bus.send(envelope(MSG.EXT_RESULT, jobId, reply));
}

// `name` (optional) is the captured account's display label — e.g. the TikTok @handle —
// forwarded to the app as `email` so the row shows the real account instead of a generic
// "<provider> account". Empty/omitted is fine; the app falls back to the generic label and
// the operator can rename it by hand. [[tiktok-account-shows-generic-label]]
function sendCaptured(provider, ok, error, cookie, name) {
  const data = ok ? { ok, provider, cookie, email: name || "" } : { ok, provider, error };
  bus.send(envelope(MSG.ACCOUNT_CAPTURED, null, data));
}

// Current session-token cookie values for the provider (the "known" baseline).
async function sessionTokenValues(cfg) {
  let all = [];
  try {
    all = await chrome.cookies.getAll({ domain: cfg.domain });
  } catch (_) {
    /* none readable */
  }
  return new Set(all.filter((c) => c.name.includes(cfg.signedIn) && c.value).map((c) => c.value));
}

async function waitForLoginCookies(cfg, known) {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let all = [];
    try {
      all = await chrome.cookies.getAll({ domain: cfg.domain });
    } catch (_) {
      /* cookies briefly unavailable */
    }
    // Accept only a session-token the user just minted (value not in the baseline),
    // so an already-signed-in session can't be captured as this account.
    const fresh = all.some((c) => c.name.includes(cfg.signedIn) && c.value && !known.has(c.value));
    if (fresh) {
      return all.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate ?? null,
      }));
    }
    await sleep(CAPTURE_POLL_MS);
  }
  return null;
}

async function runGenerate(jobId, data) {
  let tabId;
  if (data.source === "grok") {
    // grok generates via the internal API inside the user's REAL logged-in grok.com tab
    // (grok-api.js, MAIN world). Reuse that tab (no focus theft); require a logged-in
    // session. [[grok-realtab-api-pivot]]
    status(jobId, "navigate", "ใช้แท็บ grok.com ที่ล็อกอินไว้…");
    tabId = await ensureGrokTab();
  } else {
    const url = SOURCE_URLS[data.source]?.[data.mediaType];
    if (!url) throw new Error(`no URL for source=${data.source} mediaType=${data.mediaType}`);
    status(jobId, "navigate", `Opening ${data.source}…`);
    ({ tabId } = await openSite(url));
    if (data.source === "google_labs") {
      await ensureAutomationScripts(tabId, [
        "src/content/dom.js",
        "src/content/overlay.js",
        "src/content/google-labs.js",
      ]);
    }
  }
  const result = await sendToTabRobust(tabId, {
    type: "generate",
    jobId,
    prompt: data.prompt,
    mediaType: data.mediaType,
    count: data.count ?? 1,
    // feature/mode + mode-specific inputs from the new per-mode UI. Content
    // scripts ignore these today; forwarded so the passthrough is wired
    // end-to-end for when per-mode automation lands (e.g. KIE docs).
    mode: data.mode ?? "",
    options: data.options ?? {},
    // grok anti-bot token: the genuine x-statsig-id sniffed off grok's OWN /rest/*
    // requests via webRequest (exactly how G-Labs does it). Handed to the in-tab API
    // engine so its raw fetch carries grok's real signed header. [[grok-realtab-api-pivot]]
    statsig: data.source === "grok" ? grokStatsig : undefined,
  }, data.source === "google_labs" ? {
    files: ["src/content/dom.js", "src/content/overlay.js", "src/content/google-labs.js"],
  } : {});
  bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.GENERATE, ...result }));
}

async function runPublish(jobId, data) {
  status(jobId, "navigate", "Opening TikTok upload…");
  const { tabId, created } = await openSite(TIKTOK_UPLOAD_URL);
  const result = await sendToTab(tabId, {
    type: "publish",
    jobId,
    mediaUrl: data.mediaUrl,
    caption: data.caption ?? "",
    hashtags: data.hashtags ?? [],
    productId: data.productId ?? null,
    // AI call-to-action → the product modal's "Product name" (ชื่อสินค้า). Without forwarding
    // this the content script's attachProduct had no CTA to type. [[tiktok-thai-audit-2026-06-18]]
    productCta: data.productCta ?? null,
    // Forward the full-automation flags: the finalize action (post / Save draft / Schedule
    // / private) + its schedule time, plus the "Setting TikTok" toggles (AI-generated label
    // / disclosure). autoPost stays for back-compat. Without these the content script
    // silently fell back to a no-post, no-toggle staging.
    finalize: data.finalize ?? (data.autoPost ? "post" : ""),
    scheduleAt: data.scheduleAt ?? "",
    autoPost: data.autoPost ?? false,
    settings: data.settings ?? null,
  });
  await closePublishTab(tabId, created, result);
  bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.PUBLISH, ...result }));
}

// TikTok leaves the upload page sitting there after a post, so a batch run ends
// up with one abandoned tab per clip. Close it once the job is genuinely done.
//
// Deliberately narrow: only a tab WE opened, and only when TikTok actually
// accepted the post / draft / schedule. A failure — or a run that merely staged
// the upload for the operator to finish by hand (finalize empty, so ok:true with
// none of the three flags) — leaves the tab up, because that is exactly the page
// the operator still needs.
const PUBLISH_TAB_CLOSE_DELAY_MS = 2000;

async function closePublishTab(tabId, created, result) {
  if (!created || !result?.ok) return;
  if (!(result.posted || result.drafted || result.scheduled)) return;
  // Small grace period: the content script reports as soon as TikTok confirms,
  // and closing the tab in that instant can cut off its trailing requests.
  await new Promise((resolve) => setTimeout(resolve, PUBLISH_TAB_CLOSE_DELAY_MS));
  try {
    await chrome.tabs.remove(tabId);
  } catch (_) {
    /* already closed by the operator, or its window went away */
  }
}

// ---- TikTok product-page check ---------------------------------------------
// Product Set asks "is the TikTok 'Add product links / Showcase products' page
// open and pulling products?". We find the user's TikTok tab (preferring the
// Studio upload page), ask its content script to read the product panel, and
// relay a compact status back. Read-only: never opens or navigates a tab.
async function runCheckTikTok(jobId) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.CHECK_TIKTOK, ...extra }));
  try {
    const tabs = await chrome.tabs.query({});
    const tiktok = tabs.filter((t) => t.url && /^https:\/\/[^/]*tiktok\.com\//i.test(t.url));
    if (!tiktok.length) return reply({ ok: true, open: false, reason: "no-tab" });
    // Prefer the Studio upload tab (where the product modal lives); else any TikTok tab.
    const tab = tiktok.find((t) => /tiktokstudio\/upload/i.test(t.url)) || tiktok[0];
    let status = null;
    try {
      status = await chrome.tabs.sendMessage(tab.id, { type: "productStatus" });
    } catch (_) {
      /* content script not injected/ready on that tab */
    }
    if (!status) {
      return finish({
        ok: true, open: true, url: tab.url,
        onUpload: /tiktokstudio\/upload/i.test(tab.url),
        panelOpen: false, productCount: 0, reason: "no-content",
      });
    }
    return reply({ ok: true, open: true, url: tab.url, ...status });
  } catch (e) {
    reply({ ok: false, error: String(e?.message || e) });
  }
}

function fetchTikTokUserDetailInPage(uniqueId) {
  return (async () => {
    const id = String(uniqueId || "").replace(/^@/, "").trim();
    if (!id) return { ok: false, error: "missing uniqueId" };
    const language = navigator.language || "th-TH";
    const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "Asia/Bangkok";
    const params = new URLSearchParams({
      aid: "1988",
      appType: "t",
      app_language: language,
      app_name: "tiktok_web",
      browser_language: language,
      browser_name: "Mozilla",
      browser_online: String(navigator.onLine),
      browser_platform: navigator.platform || "Win32",
      browser_version: navigator.userAgent || "",
      channel: "tiktok_web",
      cookie_enabled: String(navigator.cookieEnabled),
      device_platform: "web_pc",
      focus_state: String(document.hasFocus()),
      from_page: "user",
      history_len: String(history.length || 1),
      is_fullscreen: "false",
      is_page_visible: String(!document.hidden),
      language,
      os: "windows",
      priority_region: "TH",
      referer: location.href,
      region: "TH",
      root_referer: document.referrer || "https://www.tiktok.com/",
      screen_height: String(screen.height || 768),
      screen_width: String(screen.width || 1366),
      tz_name: tz,
      uniqueId: id,
      user_is_login: "true",
      webcast_language: language,
    });
    const url = `/api/user/detail/?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = { rawText: text.slice(0, 1000) }; }
    const code = body && (body.statusCode ?? body.status_code ?? body.code ?? 0);
    return {
      ok: response.ok && Number(code || 0) === 0,
      status: response.status,
      url,
      body,
      error: response.ok ? (body && (body.status_msg || body.message || "")) : `HTTP ${response.status}`,
    };
  })();
}

function readTikTokUserFromPage() {
  function pickAccount(input) {
    var user = input && (input.user || input);
    var stats = input && (input.statsV2 || input.stats || {});
    var uniqueId = user && (user.uniqueId || user.unique_id);
    if (!uniqueId) return null;
    return {
      id: String(user.id || uniqueId),
      uniqueId: String(uniqueId),
      nickname: String(user.nickname || user.nickName || uniqueId),
      avatar: String(user.avatarMedium || user.avatarLarger || user.avatarThumb || ""),
      avatarThumb: String(user.avatarThumb || user.avatarMedium || user.avatarLarger || ""),
      secUid: String(user.secUid || ""),
      followerCount: String(stats.followerCount || ""),
      followingCount: String(stats.followingCount || ""),
      heartCount: String(stats.heartCount || stats.heart || ""),
      videoCount: String(stats.videoCount || ""),
    };
  }
  function scoreAccount(account) {
    if (!account) return -1;
    var score = 0;
    if (account.uniqueId) score += 1;
    if (account.nickname && account.nickname !== account.uniqueId) score += 3;
    if (account.avatar || account.avatarThumb) score += 4;
    if (account.secUid) score += 1;
    return score;
  }
  var candidates = [];
  try {
    var dataNode = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
    if (dataNode && dataNode.textContent) {
      var data = JSON.parse(dataNode.textContent);
      var scope = data && data["__DEFAULT_SCOPE__"];
      if (scope) {
        var keys0 = Object.keys(scope);
        for (var a = 0; a < keys0.length; a++) {
          var block = scope[keys0[a]];
          if (!block) continue;
          if (/user-detail/i.test(keys0[a])) {
            candidates.push(pickAccount(block.userInfo || block));
          }
          if (block.userInfo) candidates.push(pickAccount(block.userInfo));
          if (block.user) candidates.push(pickAccount(block.user));
        }
        var ctx = scope["webapp.app-context"];
        candidates.push(pickAccount(ctx && ctx.user));
      }
    }
  } catch (e) {}
  try {
    var sigi = window.SIGI_STATE;
    var appUser = sigi && sigi.AppContext && sigi.AppContext.user;
    candidates.push(pickAccount(appUser));
    var users = sigi && sigi.UserModule && sigi.UserModule.users;
    if (users) {
      var keys = Object.keys(users);
      for (var i = 0; i < keys.length; i++) {
        candidates.push(pickAccount(users[keys[i]]));
      }
    }
  } catch (e2) {}
  candidates = candidates.filter(Boolean);
  candidates.sort(function (a, b) { return scoreAccount(b) - scoreAccount(a); });
  return candidates[0] || null;
}

function normalizeTikTokAccountFromApi(apiResult, fallbackUniqueId = "") {
  const body = apiResult?.body || {};
  const info = body.userInfo || {};
  const user = info.user || {};
  const stats = info.statsV2 || info.stats || {};
  const hasUserPayload = !!(user.uniqueId || user.nickname || user.nickName || user.avatarMedium || user.avatarLarger || user.avatarThumb || user.secUid || user.id);
  if (!hasUserPayload) return null;
  const uniqueId = String(user.uniqueId || fallbackUniqueId || "").replace(/^@/, "");
  if (!uniqueId) return null;
  return {
    id: String(user.id || uniqueId),
    uniqueId,
    nickname: String(user.nickname || user.nickName || uniqueId),
    avatar: String(user.avatarMedium || user.avatarLarger || user.avatarThumb || ""),
    avatarThumb: String(user.avatarThumb || user.avatarMedium || user.avatarLarger || ""),
    secUid: String(user.secUid || ""),
    followerCount: String(stats.followerCount || ""),
    followingCount: String(stats.followingCount || ""),
    heartCount: String(stats.heartCount || stats.heart || ""),
    videoCount: String(stats.videoCount || ""),
  };
}

async function collectTikTokSessionSnapshot() {
  const importantNames = [
    "sessionid",
    "sessionid_ss",
    "sid_tt",
    "uid_tt",
    "uid_tt_ss",
    "ttwid",
    "msToken",
    "odin_tt",
    "passport_csrf_token",
    "passport_csrf_token_default",
    "csrf_session_id",
    "tt_chain_token",
    "s_v_web_id",
    "multi_sids",
    "sid_guard",
    "sid_ucp_v1",
    "ssid_ucp_v1",
  ];
  const wanted = new Set(importantNames.map((name) => name.toLowerCase()));
  const rows = [];
  try {
    const cookies = await chrome.cookies.getAll({ domain: "tiktok.com" });
    for (const cookie of cookies || []) {
      const name = String(cookie.name || "");
      if (!wanted.has(name.toLowerCase())) continue;
      rows.push({
        name,
        value: String(cookie.value || ""),
        domain: String(cookie.domain || ""),
        path: String(cookie.path || "/"),
        expirationDate: cookie.expirationDate || null,
        httpOnly: !!cookie.httpOnly,
        secure: !!cookie.secure,
        sameSite: cookie.sameSite || "",
      });
    }
  } catch (_) {
    /* cookies permission can be unavailable in a cold profile */
  }
  const tokenNames = ["msToken", "s_v_web_id", "ttwid", "sessionid", "sessionid_ss", "sid_tt"];
  const tokens = {};
  for (const name of tokenNames) {
    const cookie = rows.find((item) => item.name === name);
    if (cookie?.value) tokens[name] = cookie.value;
  }
  return {
    provider: "tiktok",
    capturedAt: new Date().toISOString(),
    cookieCount: rows.length,
    cookieNames: rows.map((item) => item.name),
    hasAuthCookie: rows.some((item) => /^(sessionid|sessionid_ss|sid_tt)$/i.test(item.name)),
    cookies: rows,
    tokens,
  };
}

async function runGetTikTokProfiles(jobId, data = {}) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.GET_TIKTOK_PROFILES, ...extra }));
  let scanTabId = null;
  const cleanupAfterScan = !!data?.cleanupAfterScan;
  const finish = async (extra) => {
    reply(extra);
    if (cleanupAfterScan && scanTabId != null) {
      try {
        await chrome.tabs.remove(scanTabId);
      } catch (_) {
        /* scan tab may already be closed */
      }
    }
    if (cleanupAfterScan) await cleanupProfileBindTabs();
  };
  try {
    const tabId = cleanupAfterScan
      ? await openTemporarySite("https://www.tiktok.com/")
      : (await openSite("https://www.tiktok.com/")).tabId;
    scanTabId = tabId;
    /*
     * Account scan should be fast: this command only wakes TikTok long enough
     * for Chrome to expose cookies/tokens. The app server uses those values to
     * call TikTok APIs and build the account cards.
     */
    const sessionSnapshot = await collectTikTokSessionSnapshot();
    const stored = await chrome.storage.local.get("autogt_tiktok_last_accounts").catch(() => ({}));
    const cachedAccounts = Array.isArray(stored.autogt_tiktok_last_accounts)
      ? stored.autogt_tiktok_last_accounts
      : [];
    return finish({
      ok: true,
      accounts: cachedAccounts,
      session: sessionSnapshot,
      needsServerAccountFetch: true,
      note: "TikTok cookies/tokens captured; app server will call TikTok API.",
    });
  } catch (e) {
    return finish({ ok: false, error: String(e?.message || e), accounts: [] });
  }
}

async function runClaimProfileBinding(jobId, data) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.CLAIM_PROFILE_BINDING, ...extra }));
  const token = String(data?.token || "").trim();
  if (!token) return reply({ ok: false, claimed: false, error: "missing token" });
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => String(item.url || "").includes(token));
    if (!tab) return reply({ ok: false, claimed: false });
    try {
      if (tab.id != null) await chrome.tabs.remove(tab.id);
    } catch (_) {
      /* bind tab cleanup is best-effort */
    }
    return reply({ ok: true, claimed: true, token });
  } catch (e) {
    return reply({ ok: false, claimed: false, error: String(e?.message || e) });
  }
}

// ---- TikTok showcase products: pull EVERY page via the showcase API ---------
const TIKTOK_LINK_CHECK_URL =
  "https://shop.tiktok.com/api/v1/streamer_desktop/product_link/check?user_language=th-TH&locale=th-TH&aid=253642&app_name=i18n_ecom_alliance&device_id=0&device_platform=web&cookie_enabled=true&screen_width=1366&screen_height=768&browser_language=th-TH&browser_platform=Win32&browser_name=Mozilla&browser_version=5.0+(Windows+NT+10.0%3B+Win64%3B+x64)+AppleWebKit%2F537.36+(KHTML,+like+Gecko)+Chrome%2F145.0.0.0+Safari%2F537.36&browser_online=true&timezone_name=Asia%2FBangkok&page_scene=0&carrier_region=th";
const TIKTOK_ADD_SHOWCASE_URL = TIKTOK_LINK_CHECK_URL.replace("/product_link/check?", "/showcase_product/add?");
const TIKTOK_MAIN_PLAN_ID = "115029389253";
const SHOPEE_CHECK_ITEMS_URL = "https://affiliate.shopee.co.th/offer/custom_link#spl-action=check_items";

function runCheckTikTokLinks(jobId, data) {
  const urls = Array.isArray(data?.urls) ? data.urls : [];
  return checkTikTokLinks(urls).then((res) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.CHECK_TIKTOK_LINKS, ...res }))
  );
}

async function checkTikTokLinks(urls) {
  if (!urls.length) return { ok: false, error: "No TikTok product links." };
  const res = await fetch(TIKTOK_LINK_CHECK_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "x-tt-store-region": "th",
    },
    body: JSON.stringify({ origin: 2, urls }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { rawText: text }; }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw: body };
  if (body.code && body.code !== 0) return { ok: false, error: body.message || `code ${body.code}`, raw: body };
  return { ok: true, data: body };
}

function runAddToShowcase(jobId, data) {
  const productIds = Array.isArray(data?.productIds) ? data.productIds : [];
  return addTikTokProductsToShowcase(productIds, data).then((res) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.ADD_TO_SHOWCASE, ...res }))
  );
}

async function addTikTokProductsToShowcase(productIds, options = {}) {
  const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "No TikTok product IDs selected." };
  const mainPlanId = String(options.mainPlanId || TIKTOK_MAIN_PLAN_ID);
  const payload = {
    product_info: ids.map((productId) => ({
      product_id: productId,
      source_from: 2,
      main_plan_id: mainPlanId,
      isv_id: "",
    })),
  };

  const res = await fetch(TIKTOK_ADD_SHOWCASE_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "x-tt-store-region": "th",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { rawText: text }; }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status, raw: body };
  if (body.code && body.code !== 0) return { ok: false, error: body.message || `code ${body.code}`, raw: body };
  return { ok: true, total: ids.length, data: body, payload };
}

function runCheckShopeeLinks(jobId, data) {
  const urls = Array.isArray(data?.urls) ? data.urls : [];
  return checkShopeeLinks(urls, jobId).then((res) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.CHECK_SHOPEE_LINKS, ...res }))
  );
}

function parseShopeeLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const productPath = raw.match(/\/product\/(\d+)\/(\d+)/i);
  if (productPath) return { shopId: productPath[1], itemId: productPath[2], sourceUrl: raw };
  const oldPath = raw.match(/(?:^|[-/?&])i\.(\d+)\.(\d+)(?:\D|$)/i);
  if (oldPath) return { shopId: oldPath[1], itemId: oldPath[2], sourceUrl: raw };
  const plain = raw.match(/^\d{6,}$/);
  if (plain) return { shopId: "", itemId: raw, sourceUrl: raw };
  const lastTwo = raw.match(/(\d{6,})[^\d]+(\d{6,})(?:\D*)$/);
  if (lastTwo) return { shopId: lastTwo[1], itemId: lastTwo[2], sourceUrl: raw };
  return null;
}

async function resolveShopeeLink(value) {
  const parsed = parseShopeeLink(value);
  if (parsed && parsed.itemId) return parsed;
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const response = await fetch(raw, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
    });
    const resolved = parseShopeeLink(response.url || raw);
    if (resolved) return { ...resolved, sourceUrl: raw };
  } catch (_) {
    /* Some Shopee share links block background fetch; fall through to null. */
  }
  return null;
}

function formatShopeePrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value || "-";
  const price = num > 100000 ? num / 100000 : num;
  return price.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function shopeeImageUrl(image) {
  if (!image) return "";
  if (/^https?:\/\//i.test(image)) return image;
  return `https://down-th.img.susercontent.com/file/${image}`;
}

function readShopeeCommissionRate(data) {
  const detail = data?.commission_rate_detail?.seller_commission_detail || {};
  const direct = data?.seller_commission_rate
    ?? data?.commission_rate
    ?? data?.commissionRate
    ?? detail.rate
    ?? null;
  if (direct != null && direct !== "") {
    const num = Number(direct);
    if (Number.isFinite(num)) return num;
  }
  const liveDefault = detail.live_streaming_default_exist_commission_rate;
  if (liveDefault != null && liveDefault !== "") {
    const num = Number(liveDefault);
    if (Number.isFinite(num)) return num / 1000;
  }
  return null;
}

function normalizeShopeeOffer(data, parsed, pcBody) {
  const item = data?.batch_item_for_item_card_full || data?.item || data?.product || {};
  const pcData = pcBody?.data?.item || pcBody?.data || {};
  const itemId = String(item.itemid || item.item_id || parsed.itemId || "");
  const shopId = String(item.shopid || item.shop_id || pcData.shopid || pcData.shop_id || parsed.shopId || "");
  const numericRate = readShopeeCommissionRate(data);
  const priceRaw = item.price || pcData.price || pcData.price_min || "";
  const priceText = formatShopeePrice(priceRaw);
  const commission = data?.seller_commission
    ?? (Number.isFinite(numericRate) && Number(priceRaw)
      ? (Number(priceRaw) * (numericRate / 100) / 100000).toFixed(2)
      : "");

  return {
    id: itemId,
    itemid: itemId,
    shopid: shopId,
    title: item.name || pcData.name || pcData.title || "-",
    image: shopeeImageUrl(item.image || pcData.image || pcData.images?.[0] || ""),
    price: priceText,
    commission: commission ? String(commission) : "-",
    commissionRate: Number.isFinite(numericRate) ? numericRate : "-",
    stock: item.stock ?? pcData.stock ?? "-",
    shop: item.shop_name || pcData.shop_name || "-",
    productUrl: data?.product_link || (shopId && itemId ? `https://shopee.co.th/product/${shopId}/${itemId}` : parsed.sourceUrl),
    sourceUrl: parsed.sourceUrl,
    canAdd: !!itemId,
  };
}

function compactShopeeRaw(raw) {
  return (raw || []).map((entry) => {
    const data = entry.affiliate?.body?.data || null;
    const item = data?.batch_item_for_item_card_full || null;
    return {
      sourceUrl: entry.sourceUrl,
      affiliate: {
        ok: !!entry.affiliate?.ok,
        status: entry.affiliate?.status ?? null,
        code: entry.affiliate?.body?.code ?? null,
        msg: entry.affiliate?.body?.msg ?? entry.affiliate?.body?.message ?? null,
        error: entry.affiliate?.body?.error ?? null,
        item_id: data?.item_id || item?.itemid || null,
        shop_id: item?.shopid || null,
        name: item?.name || null,
        seller_commission_rate: data?.seller_commission_rate || readShopeeCommissionRate(data),
      },
      pc: entry.pc ? {
        ok: !!entry.pc.ok,
        status: entry.pc.status ?? null,
        code: entry.pc.body?.code ?? null,
        msg: entry.pc.body?.msg ?? entry.pc.body?.message ?? null,
        error: entry.pc.body?.error ?? null,
      } : null,
    };
  });
}

async function fetchJsonWithCookies(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { rawText: text.slice(0, 1000) }; }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { fetchError: String(error?.message || error) } };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureShopeeAffiliateTab() {
  const tab = await chrome.tabs.create({ url: SHOPEE_CHECK_ITEMS_URL, active: true });
  await waitTabComplete(tab.id, 25000);
  await sleep(1200);
  return tab.id;
}

async function closeTemporaryTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (_) {
    /* tab may already be closed by the user */
  }
}

async function runShopeeAffiliateCheckInPage(tabId, items, jobId = null) {
  const start = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: shopeeStartApiCheck,
    args: [JSON.stringify(items)],
  }).then((out) => out?.[0]?.result || { ok: false, error: "empty start result" })
    .catch((error) => ({ ok: false, error: String(error?.message || error) }));
  if (!start.ok) return start;

  const raw = [];
  let lastDone = -1;
  const deadline = Date.now() + Math.max(90000, items.length * 15000 + 20000);
  while (Date.now() < deadline) {
    const state = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: shopeeReadApiCheck,
    }).then((out) => out?.[0]?.result || { ok: false, error: "empty read result" })
      .catch((error) => ({ ok: false, error: String(error?.message || error) }));
    raw.length = 0;
    raw.push(...((state.captured || []).map((entry) => {
      const match = String(entry.url || "").match(/item_id=(\d+)/);
      const parsed = items.find((item) => String(item.itemId) === (match && match[1])) || { itemId: match && match[1], sourceUrl: entry.url };
      return { sourceUrl: parsed.sourceUrl, affiliate: entry, pc: null };
    })));
    const done = Math.min(items.length, Number(state.done || 0));
    if (done !== lastDone) {
      lastDone = done;
      if (jobId) {
        bus.send(envelope(MSG.EXT_STATUS, jobId, {
          stage: "shopee",
          message: `Shopee API ${done}/${items.length}`,
          progress: { done, total: items.length },
        }));
      }
    }
    if (state.blocked || state.done >= items.length || state.finished) {
      return {
        ok: true,
        products: raw
          .filter((entry) => entry.affiliate?.ok && entry.affiliate?.body?.data)
          .map((entry) => normalizeShopeeOffer(entry.affiliate.body.data, {
            itemId: String(entry.affiliate.url || "").match(/item_id=(\d+)/)?.[1] || "",
            sourceUrl: entry.sourceUrl,
          }, null)),
        raw,
        domMode: true,
        capturedCount: state.captured?.length || 0,
        tableRows: state.tableRows || [],
        captchaUrl: state.captchaUrl || "",
        captchaLinks: state.captchaLinks || [],
        page: state.page,
      };
    }
    await sleep(900);
  }
  return {
    ok: true,
    products: raw
      .filter((entry) => entry.affiliate?.ok && entry.affiliate?.body?.data)
      .map((entry) => normalizeShopeeOffer(entry.affiliate.body.data, {
        itemId: String(entry.affiliate.url || "").match(/item_id=(\d+)/)?.[1] || "",
        sourceUrl: entry.sourceUrl,
      }, null)),
    raw,
    domMode: true,
    timedOut: true,
    capturedCount: raw.length,
  };
}

function shopeeStartDomCheck(itemsJson) {
  const items = JSON.parse(itemsJson);
  const textarea = document.querySelector("textarea[name='textarea-items']");
  const checkButton = document.querySelector(".btn-check-items");
  if (!textarea || !checkButton) {
    return {
      ok: false,
      error: "Shopee check page is not ready: textarea or button missing.",
      page: { href: location.href, readyState: document.readyState, title: document.title },
    };
  }

  window.__autogtShopeeJob = {
    captured: [],
    total: items.length,
    startedAt: Date.now(),
    clicked: false,
  };

  if (!window.__autogtShopeeFetchHooked) {
    window.__autogtShopeeFetchHooked = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = String(args[0]?.url || args[0] || "");
        if (url.includes("/api/v3/offer/product?item_id=")) {
          const body = await response.clone().json().catch(() => null);
          const job = window.__autogtShopeeJob;
          if (job && !job.captured.some((entry) => entry.url === url)) {
            job.captured.push({ url, ok: response.ok, status: response.status, body });
          }
        }
      } catch (_) {
        /* keep the page fetch untouched */
      }
      return response;
    };
  }

  textarea.value = items.map((item) => item.sourceUrl || item.itemId).join("\n");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
  checkButton.click();
  window.__autogtShopeeJob.clicked = true;
  return { ok: true, total: items.length, page: { href: location.href, readyState: document.readyState, title: document.title } };
}

function shopeeReadDomCheck() {
  const job = window.__autogtShopeeJob || { captured: [], total: 0 };
  const rows = [...document.querySelectorAll("#table-products tbody tr, .htCore tbody tr")];
  const tableRows = rows.map((row) => [...row.querySelectorAll("td, th")].map((cell) => cell.textContent.trim()).filter(Boolean))
    .filter((cells) => cells.length > 2);
  const text = document.body?.innerText || "";
  const challengeRe = /captcha|challenge|verify|verification|security|risk|anti|validate|error|blocked|90309999/i;
  const candidateUrls = [
    location.href,
    ...[...document.querySelectorAll("iframe[src], a[href], form[action]")]
      .map((node) => node.src || node.href || node.action || "")
      .filter(Boolean),
  ];
  const captchaLinks = [...new Set(candidateUrls.filter((url) => challengeRe.test(url) || challengeRe.test(text)))];
  const matches = [...text.matchAll(/(?:รายการที่\s*(\d+)\/(\d+)|ดึงข้อมูล(?:สินค้า)?(?:เรียบร้อย)?\s*(\d+)\s*รายการ)/g)];
  const textDone = matches.reduce((max, match) => Math.max(max, Number(match[1] || match[3] || 0)), 0);
  const capturedDone = (job.captured || []).filter((entry) => entry.ok && entry.body?.data).length;
  const done = Math.max(capturedDone, tableRows.length, textDone);
  const blocked = captchaLinks.length > 0 || (job.captured || []).some((entry) => entry.status === 403 || entry.body?.error === 90309999 || entry.body?.redirect_to_error_page);
  return {
    ok: true,
    done,
    total: job.total || 0,
    captured: job.captured || [],
    tableRows,
    blocked,
    captchaUrl: captchaLinks[0] || "",
    captchaLinks,
    finished: /ดึงข้อมูลเรียบร้อย/.test(text),
    page: { href: location.href, readyState: document.readyState, title: document.title },
  };
}

function shopeeStartApiCheck(itemsJson) {
  const items = JSON.parse(itemsJson);
  window.__autogtShopeeJob = {
    captured: [],
    total: items.length,
    done: 0,
    finished: false,
    blocked: false,
    error: "",
    captchaUrl: "",
    captchaLinks: [],
    startedAt: Date.now(),
  };

  const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findCaptchaLinks = () => {
    const text = document.body?.innerText || "";
    const challengeRe = /captcha|challenge|verify|verification|security|risk|anti|blocked|90309999|ตรวจสอบ|ยืนยัน|ปลอดภัย/i;
    const urls = [
      location.href,
      ...[...document.querySelectorAll("iframe[src], a[href], form[action]")]
        .map((node) => node.src || node.href || node.action || "")
        .filter(Boolean),
    ];
    return challengeRe.test(text) || urls.some((url) => challengeRe.test(url))
      ? [...new Set(urls.filter(Boolean))]
      : [];
  };
  const readJson = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { rawText: text.slice(0, 1200) }; }
      return { ok: response.ok, status: response.status, body, url: response.url || url };
    } catch (error) {
      return { ok: false, status: 0, body: { fetchError: String(error?.message || error) }, url };
    } finally {
      clearTimeout(timer);
    }
  };

  (async () => {
    const job = window.__autogtShopeeJob;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const apiUrl = `https://affiliate.shopee.co.th/api/v3/offer/product?item_id=${encodeURIComponent(item.itemId)}`;
      const affiliate = await readJson(apiUrl);
      job.captured.push({
        sourceUrl: item.sourceUrl,
        itemId: item.itemId,
        shopId: item.shopId || "",
        url: apiUrl,
        ok: affiliate.ok,
        status: affiliate.status,
        body: affiliate.body,
      });
      job.done = index + 1;
      const body = affiliate.body || {};
      if (affiliate.status === 403 || body.error === 90309999 || body.redirect_to_error_page === true || body.action_type === 2) {
        job.blocked = true;
        job.captchaLinks = findCaptchaLinks();
        job.captchaUrl = job.captchaLinks[0] || location.href;
        job.error = "Shopee captcha/blocked";
        break;
      }
      if (index < items.length - 1) await sleepLocal(1000);
    }
    job.captchaLinks = job.captchaLinks.length ? job.captchaLinks : findCaptchaLinks();
    if (job.captchaLinks.length && !job.captchaUrl) job.captchaUrl = job.captchaLinks[0];
    job.finished = true;
  })();

  return { ok: true, total: items.length, page: { href: location.href, readyState: document.readyState, title: document.title } };
}

function shopeeReadApiCheck() {
  const job = window.__autogtShopeeJob || { captured: [], total: 0, done: 0 };
  const text = document.body?.innerText || "";
  const challengeRe = /captcha|challenge|verify|verification|security|risk|anti|validate|error|blocked|90309999|ตรวจสอบ|ยืนยัน|ปลอดภัย/i;
  const candidateUrls = [
    location.href,
    ...[...document.querySelectorAll("iframe[src], a[href], form[action]")]
      .map((node) => node.src || node.href || node.action || "")
      .filter(Boolean),
  ];
  const captchaLinks = [...new Set(candidateUrls.filter((url) => challengeRe.test(url) || challengeRe.test(text)))];
  const blocked = !!job.blocked || captchaLinks.length > 0 || (job.captured || []).some((entry) =>
    entry.status === 403 || entry.body?.error === 90309999 || entry.body?.redirect_to_error_page === true
  );
  return {
    ok: true,
    done: Number(job.done || (job.captured || []).length || 0),
    total: job.total || 0,
    captured: job.captured || [],
    blocked,
    captchaUrl: job.captchaUrl || captchaLinks[0] || "",
    captchaLinks: job.captchaLinks?.length ? job.captchaLinks : captchaLinks,
    finished: !!job.finished,
    error: job.error || "",
    page: { href: location.href, readyState: document.readyState, title: document.title },
  };
}

async function shopeeAffiliateCheckInPage(itemsJson) {
  try {
  const items = JSON.parse(itemsJson);
  const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const priceText = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return value || "-";
    const price = num > 100000 ? num / 100000 : num;
    return price.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  const imageUrl = (image) => {
    if (!image) return "";
    if (/^https?:\/\//i.test(image)) return image;
    return `https://down-th.img.susercontent.com/file/${image}`;
  };
  const readJson = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = { rawText: text.slice(0, 1000) }; }
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      return { ok: false, status: 0, body: { fetchError: String(error?.message || error) } };
    } finally {
      clearTimeout(timer);
    }
  };
  const normalize = (offerData, parsed, pcBody) => {
    const item = offerData?.batch_item_for_item_card_full || offerData?.item || offerData?.product || {};
    const pcData = pcBody?.data?.item || pcBody?.data || {};
    const itemId = String(item.itemid || item.item_id || parsed.itemId || "");
    const shopId = String(item.shopid || item.shop_id || pcData.shopid || pcData.shop_id || parsed.shopId || "");
    const numericRate = readShopeeCommissionRate(offerData);
    const priceRaw = item.price || pcData.price || pcData.price_min || "";
    const commission = offerData?.seller_commission
      ?? (Number.isFinite(numericRate) && Number(priceRaw)
        ? (Number(priceRaw) * (numericRate / 100) / 100000).toFixed(2)
        : "");
    return {
      id: itemId,
      itemid: itemId,
      shopid: shopId,
      title: item.name || pcData.name || pcData.title || "-",
      image: imageUrl(item.image || pcData.image || pcData.images?.[0] || ""),
      price: priceText(priceRaw),
      commission: commission ? String(commission) : "-",
      commissionRate: Number.isFinite(numericRate) ? numericRate : "-",
      stock: item.stock ?? pcData.stock ?? "-",
      shop: item.shop_name || pcData.shop_name || "-",
      productUrl: offerData?.product_link || (shopId && itemId ? `https://shopee.co.th/product/${shopId}/${itemId}` : parsed.sourceUrl),
      sourceUrl: parsed.sourceUrl,
      canAdd: !!itemId,
    };
  };
  const waitFor = async (finder, timeoutMs = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = finder();
      if (found) return found;
      await sleepLocal(250);
    }
    return null;
  };
  const scrapeVisibleTable = () => {
    const rows = [...document.querySelectorAll("#table-products tbody tr, .htCore tbody tr")];
    return rows.map((row) => [...row.querySelectorAll("td, th")].map((cell) => cell.textContent.trim()).filter(Boolean))
      .filter((cells) => cells.length > 2);
  };

  const textarea = await waitFor(() => document.querySelector("textarea[name='textarea-items']"), 10000);
  const checkButton = await waitFor(() => document.querySelector(".btn-check-items"), 10000);
  if (textarea && checkButton) {
    const captured = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = String(args[0]?.url || args[0] || "");
        if (url.includes("/api/v3/offer/product?item_id=")) {
          const cloned = response.clone();
          const body = await cloned.json().catch(() => null);
          captured.push({ url, ok: response.ok, status: response.status, body });
          window.__autogtShopeeProgress = {
            done: captured.filter((entry) => entry.ok && entry.body?.data).length,
            total: items.length,
          };
        }
      } catch (_) {
        /* keep the page fetch untouched */
      }
      return response;
    };

    textarea.value = items.map((item) => item.sourceUrl || item.itemId).join("\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    checkButton.click();

    const deadline = Date.now() + Math.max(75000, items.length * 14000);
    while (Date.now() < deadline) {
      const successes = captured.filter((entry) => entry.ok && entry.body?.data).length;
      const visibleRows = scrapeVisibleTable();
      const doneText = document.body.innerText || "";
      if (successes >= items.length || /ดึงข้อมูลเรียบร้อย/.test(doneText) || visibleRows.length >= items.length) break;
      if (captured.some((entry) => entry.status === 403 || entry.body?.error === 90309999 || entry.body?.redirect_to_error_page)) break;
      await sleepLocal(500);
    }

    const products = [];
    const raw = [];
    for (const entry of captured) {
      const match = entry.url.match(/item_id=(\d+)/);
      const parsed = items.find((item) => String(item.itemId) === (match && match[1])) || { itemId: match && match[1], sourceUrl: entry.url };
      raw.push({ sourceUrl: parsed.sourceUrl, affiliate: entry, pc: null });
      if (entry.ok && entry.body?.data) products.push(normalize(entry.body.data, parsed, null));
    }
    if (!products.length) {
      const fallbackRows = scrapeVisibleTable();
      for (const row of fallbackRows) {
        const joined = row.join(" | ");
        const idMatch = joined.match(/\b\d{8,}\b/);
        if (!idMatch) continue;
        products.push({
          id: idMatch[0],
          itemid: idMatch[0],
          shopid: "",
          title: row[0] || "-",
          image: "",
          price: row.find((cell) => /฿|\d/.test(cell)) || "-",
          commission: "-",
          commissionRate: "-",
          stock: "-",
          shop: "-",
          productUrl: "",
          sourceUrl: "",
          canAdd: true,
        });
      }
    }
    return {
      ok: true,
      products,
      raw,
      domMode: true,
      capturedCount: captured.length,
      tableRows: scrapeVisibleTable(),
      page: { href: location.href, readyState: document.readyState, title: document.title },
    };
  }

  const products = [];
  const raw = [];
  let index = 0;
  for (const item of items) {
    const affiliate = await readJson(`https://affiliate.shopee.co.th/api/v3/offer/product?item_id=${encodeURIComponent(item.itemId)}`);
    const pc = null;
    raw.push({ sourceUrl: item.sourceUrl, affiliate, pc });
    if (affiliate.ok && affiliate.body?.data) products.push(normalize(affiliate.body.data, item, null));
    index += 1;
    if (index < items.length) await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return { ok: true, products, raw, page: { href: location.href, readyState: document.readyState, title: document.title } };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      page: {
        href: typeof location !== "undefined" ? location.href : "",
        readyState: typeof document !== "undefined" ? document.readyState : "",
        title: typeof document !== "undefined" ? document.title : "",
      },
    };
  }
}

function hasShopeeChallenge(value) {
  const scan = (item) => {
    if (!item || typeof item !== "object") return false;
    if (item.status === 403) return true;
    const body = item.body || item;
    if (body.error === 90309999 || body.redirect_to_error_page === true || body.action_type === 2) return true;
    return Object.values(item).some((child) => {
      if (Array.isArray(child)) return child.some(scan);
      return child && typeof child === "object" ? scan(child) : false;
    });
  };
  return scan(value);
}

async function checkShopeeLinks(urls, jobId = null) {
  await captureProviderNow("shopee", "before-shopee-link-check").catch(() => {});
  const parsed = [];
  for (const url of urls) {
    const item = await resolveShopeeLink(url);
    if (item) parsed.push(item);
  }
  if (!parsed.length) return { ok: false, error: "No Shopee product links." };

  const deduped = [];
  const seen = new Set();
  for (const item of parsed) {
    const key = String(item.itemId || "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const tabId = await ensureShopeeAffiliateTab();
  let checked;
  let keepShopeeTabOpen = false;
  try {
    checked = await runShopeeAffiliateCheckInPage(tabId, deduped, jobId);
    keepShopeeTabOpen = hasShopeeChallenge(checked);
  } finally {
    if (!keepShopeeTabOpen) await closeTemporaryTab(tabId);
  }
  if (keepShopeeTabOpen) {
    if (checked.products?.length) {
      return {
        ok: true,
        captcha: true,
        total: checked.products.length,
        products: checked.products,
        captchaUrl: checked.captchaUrl || checked.captchaLinks?.[0] || checked.page?.href || "",
        captchaLinks: checked.captchaLinks || [],
        warning: "Shopee returned captcha/blocked status after partial results. The Shopee Affiliate tab is left open for verification.",
        raw: [{ pageResult: checked }, ...compactShopeeRaw(checked.raw || [])],
        via: "affiliate.shopee.co.th/offer/custom_link",
      };
    }
    return {
      ok: false,
      captcha: true,
      captchaUrl: checked.captchaUrl || checked.captchaLinks?.[0] || checked.page?.href || "",
      captchaLinks: checked.captchaLinks || [],
      error: "Shopee returned captcha/blocked status. The Shopee Affiliate tab is left open for verification.",
      raw: [{ pageResult: checked }],
      via: "affiliate.shopee.co.th/offer/custom_link",
    };
  }
  if (!checked.ok) {
    const fallback = await checkShopeeLinksFromWorker(deduped);
    if (hasShopeeChallenge(fallback.raw)) {
      return {
        ok: false,
        captcha: true,
        captchaUrl: checked.captchaUrl || checked.captchaLinks?.[0] || "",
        captchaLinks: checked.captchaLinks || [],
        error: "Shopee returned captcha/blocked status. Open the Shopee Affiliate tab and verify, then try again.",
        raw: [{ pageResult: checked }, ...compactShopeeRaw(fallback.raw)],
        via: "service-worker-fallback",
      };
    }
    if (fallback.products.length) {
      return {
        ok: true,
        total: fallback.products.length,
        products: fallback.products,
        raw: compactShopeeRaw(fallback.raw),
        via: "service-worker-fallback",
        pageError: checked.error,
      };
    }
    return {
      ok: false,
      error: checked.error || "Shopee page did not respond.",
      raw: [{ pageResult: checked }, ...compactShopeeRaw(fallback.raw)],
      via: "affiliate-page-failed",
    };
  }
  if (!checked.products.length) {
    const fallback = await checkShopeeLinksFromWorker(deduped);
    if (hasShopeeChallenge(fallback.raw)) {
      return {
        ok: false,
        captcha: true,
        captchaUrl: checked.captchaUrl || checked.captchaLinks?.[0] || "",
        captchaLinks: checked.captchaLinks || [],
        error: "Shopee returned captcha/blocked status. Open the Shopee Affiliate tab and verify, then try again.",
        raw: [{ pageResult: checked }, ...compactShopeeRaw(checked.raw || []), ...compactShopeeRaw(fallback.raw)],
        via: "service-worker-fallback",
      };
    }
    if (fallback.products.length) {
      return {
        ok: true,
        total: fallback.products.length,
        products: fallback.products,
        raw: compactShopeeRaw(fallback.raw),
        via: "service-worker-fallback",
      };
    }
    return {
      ok: false,
      error: "Shopee Affiliate did not return product data. Open affiliate.shopee.co.th and sign in, then try again.",
      raw: [{ pageResult: checked }, ...compactShopeeRaw(checked.raw || []), ...compactShopeeRaw(fallback.raw)],
      via: "affiliate.shopee.co.th/offer/custom_link",
    };
  }

  return {
    ok: true,
    total: checked.products.length,
    products: checked.products,
    raw: compactShopeeRaw(checked.raw),
    via: "affiliate.shopee.co.th/offer/custom_link",
  };
}

async function checkShopeeLinksFromWorker(items) {
  const products = [];
  const raw = [];
  let index = 0;
  for (const item of items) {
    const affiliateUrl = `https://affiliate.shopee.co.th/api/v3/offer/product?item_id=${encodeURIComponent(item.itemId)}`;
    const affiliate = await fetchJsonWithCookies(affiliateUrl);
    const pc = null;
    raw.push({ sourceUrl: item.sourceUrl, affiliate, pc });
    if (affiliate.ok && affiliate.body?.data) products.push(normalizeShopeeOffer(affiliate.body.data, item, null));
    index += 1;
    if (index < items.length) await sleep(700);
  }
  return { products, raw };
}

// "Showcase products" is a cookie-authed JSON API with NO request signing:
//   GET https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list?offset=N&count=M
// We page through it from the service worker — host_permissions cover *.tiktok.com,
// so cookies are sent and CORS is bypassed (a content-script fetch couldn't). The
// user only needs to be logged into TikTok; no tab required. Read-only.
//
// pullAllProducts RETURNS the result object (so it's reusable by the upload+pull
// run); runPullProducts is the thin bus wrapper for the standalone "pull" button.
function runPullProducts(jobId) {
  const progress = (message) =>
    bus.send(envelope(MSG.EXT_STATUS, jobId, { stage: "pull", message }));
  return pullAllProducts(progress).then((res) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.PULL_PRODUCTS, ...res }))
  );
}

async function pullAllProducts(progress) {
  const BASE = "https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list";
  const MAX_PAGES = 600; // hard backstop
  const MAX_DISPLAY = 2000; // cap the product list sent over the WS (the total stays exact)
  const DEADLINE_MS = 150000; // bound our own wall clock so we always reply before the hub's 180s timeout
  const MAX_429_RETRIES = 2;
  const started = Date.now();
  const map = (p) => {
    const c = p.cover || {};
    return {
      id: String(p.product_id || ""),
      title: p.title || "",
      price: p.format_available_price || "",
      image: (c.url_list && c.url_list[0]) || (c.thumb_url_list && c.thumb_url_list[0]) || "",
      stock: p.stock_num ?? null,
      shop: (p.seller_info && p.seller_info.shop_name) || "",
      canAdd: p.can_added !== false,
    };
  };
  const get = (offset, count) =>
    fetch(`${BASE}?offset=${offset}&count=${count}`, {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" },
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const seen = new Set(); // every unique product_id → the EXACT total
  const products = []; // display list, capped at MAX_DISPLAY
  let count = 50; // try a big page; fall back to 6 (the size the page uses) if rejected
  let offset = 0;
  let pages = 0;
  let retries = 0;
  let available = 0; // in-stock AND addable — the ones we keep
  let outOfStock = 0; // everything else (Out of stock OR Unavailable → all "หมดสต๊อก")
  let partial = false; // set whenever we stop BEFORE the genuine end (so the UI warns)
  const result = () => ({
    ok: true,
    total: seen.size, // every unique product scanned
    available, // kept (in-stock + addable)
    outOfStock, // not available (out-of-stock or unavailable)
    pages,
    products,
    ...(partial ? { partial: true } : {}),
  });

  try {
    while (pages < MAX_PAGES) {
      if (Date.now() - started > DEADLINE_MS) { partial = true; break; }

      const res = await get(offset, count);

      if (!res.ok) {
        if (res.status === 429 && retries < MAX_429_RETRIES) {
          retries++;
          const ra = parseInt(res.headers.get("retry-after") || "", 10);
          await sleep(Number.isFinite(ra) ? Math.min(ra * 1000, 10000) : 1000 * retries);
          continue; // honour the rate limit: retry the SAME offset, don't advance
        }
        if (pages === 0 && count !== 6) { count = 6; continue; } // big first page rejected → fall back
        if (!seen.size) return { ok: false, error: `HTTP ${res.status}` };
        partial = true; break; // mid-pull error → return what we have, flagged partial
      }

      const body = await res.json().catch(() => null);
      if (!body) {
        if (pages === 0 && count !== 6) { count = 6; continue; }
        if (!seen.size) return { ok: false, error: "non-JSON response" };
        partial = true; break;
      }
      // TikTok signals rate-limit / auth-expiry / transient faults as HTTP-200 with a
      // non-zero JSON `code`. Treat that as a real error on EVERY page (not just the
      // first), so a mid-stream abort is never reported as a complete total.
      if (body.code !== 0) {
        if (pages === 0 && count !== 6) { count = 6; continue; } // count=50 rejected via the code channel
        if (!seen.size) return { ok: false, error: body.message || `code ${body.code}` };
        partial = true; break;
      }
      retries = 0;

      const list = (body.data && body.data.products) || [];
      pages++;
      if (!list.length) break; // genuine end: code===0 with an empty page
      let added = 0;
      for (const p of list) {
        const id = String((p && p.product_id) || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        added++;
        // "พร้อมขาย" = the modal's Active status, read straight from TikTok's two
        // status enums (CONFIRMED against live Active / Out-of-stock / Unavailable
        // products):
        //   stock_status : 1 = in stock, 2 = Out of stock
        //   review_status: 1 = active/approved, 4 = Unavailable (removed/deleted)
        // Active needs BOTH = 1. (can_added is NOT a signal — it stays true even
        // for Unavailable products.)
        const isActive = p && p.stock_status === 1 && p.review_status === 1;
        if (!isActive) {
          outOfStock++; // Out of stock OR Unavailable → all "หมดสต๊อก"
          continue;
        }
        available++;
        if (products.length < MAX_DISPLAY) products.push(map(p));
      }
      progress(`สแกน ${seen.size} · ใช้ได้ ${available} (หน้า ${pages})`);
      if (added === 0) break; // offset ignored / all duplicates → stop (no infinite loop)
      offset += list.length; // advance by what the server actually returned (count may be capped)
      await sleep(120); // gentle throttle
    }
    if (pages >= MAX_PAGES) partial = true;
    return result();
  } catch (e) {
    if (seen.size) { partial = true; return result(); }
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ---- TikTok step 1: open the upload tab → stage a clip (no posting) -----------
// Opens (or focuses) a tiktokstudio/upload tab and asks the content script to stage
// the chosen clip into the upload editor (file input + caption; it does NOT post —
// auto-post stays disabled). The UI reveals the "pull products" step only after this
// succeeds. The product pull is a SEPARATE action (ACTION.PULL_PRODUCTS).
async function runStageClip(jobId, data) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.STAGE_CLIP, ...extra }));
  const progress = (message) =>
    bus.send(envelope(MSG.EXT_STATUS, jobId, { stage: "upload", message }));
  const clipUrl = (data && data.clipUrl) || "";
  const caption = (data && data.caption) || "";
  if (!clipUrl) return reply({ uploaded: false, uploadNote: "no clip" });
  try {
    progress("เปิดหน้าอัปโหลด TikTok…");
    const tabId = await ensureUploadTab();
    progress("กำลังอัปโหลดคลิป…");
    const up = await sendToTabWithRetry(tabId, { type: "stageUpload", mediaUrl: clipUrl, caption });
    const uploaded = !!(up && up.ok);
    return reply({ uploaded, uploadNote: uploaded ? "" : (up && up.error) || "upload failed" });
  } catch (e) {
    return reply({ uploaded: false, uploadNote: String((e && e.message) || e) });
  }
}

// Focus an existing TikTok upload tab, or open one and wait for it to load.
async function ensureUploadTab() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && /tiktokstudio\/upload/i.test(t.url));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing.id;
  }
  const tab = await chrome.tabs.create({
    url: "https://www.tiktok.com/tiktokstudio/upload",
    active: true,
  });
  await waitTabComplete(tab.id, 25000);
  return tab.id;
}

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return resolve();
      } catch (_) {
        return resolve(); // tab gone — let the caller's sendMessage retry surface it
      }
      if (Date.now() - t0 > timeout) return resolve();
      setTimeout(check, 400);
    };
    check();
  });
}

// The content script may not be injected yet on a freshly opened tab — retry.
async function sendToTabWithRetry(tabId, msg, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (_) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new Error("content script not ready on the upload tab");
}

// ---- reCAPTCHA Enterprise token minting (API generation path) --------------
// Flow's generation API needs a FRESH reCAPTCHA Enterprise token per call, and it
// can only be produced inside a real labs.google page. The app asks us to mint
// one (grecaptcha.enterprise.execute in the page's MAIN world) and relays it back
// over the WS bridge — this is what replaces DOM automation for labs.google.
const LABS_FLOW_URL = "https://labs.google/fx/tools/flow";
const FLOW_TAB_WARMUP_PROFILES = { blueviral: 0, bkode: 15_000 };
const FLOW_TAB_WARMUP_PROFILE = "bkode";
const FLOW_TAB_WARMUP_MS = FLOW_TAB_WARMUP_PROFILES[FLOW_TAB_WARMUP_PROFILE];

async function runMintCaptcha(jobId, data) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.MINT_CAPTCHA, ...extra }));
  const siteKey = data?.siteKey || "";
  const captchaAction = data?.captchaAction || data?.action || "";
  if (!siteKey || !captchaAction) {
    return reply({ ok: false, error: "siteKey and captchaAction are required" });
  }
  let tabId;
  try {
    tabId = await ensureLabsTab();
  } catch (e) {
    return reply({ ok: false, error: `no labs tab: ${e?.message || e}` });
  }
  // grecaptcha may still be initialising on a freshly opened tab — one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      const out = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: mintRecaptchaInPage,
        args: [siteKey, captchaAction],
      });
      result = out && out[0] && out[0].result;
    } catch (e) {
      result = { token: null, error: String(e?.message || e) };
    }
    if (result && result.token) return reply({ ok: true, token: result.token });
    if (attempt === 0) {
      await sleep(2000);
      continue;
    }
    return reply({ ok: false, error: (result && result.error) || "no token" });
  }
}

// One shared labs.google tab across all jobs. Without this, N parallel jobs each
// find "no labs tab" at the same instant and every one opens its own — so count=4
// would spawn 4 tabs. The in-flight create promise dedupes concurrent callers so
// the whole batch reuses a single background tab.
let _labsTabId = null;
let _labsTabCreating = null;
let _labsTabRefreshing = null; // in-flight refresh; coalesces concurrent callers

/** Pick the user's REAL, most-recently-used Flow tab — a signed-in, interacted
 *  tab mints a high-score reCAPTCHA token; a cold background tab scores low and
 *  triggers "unusual activity". Prefer /tools/flow, then any labs.google/fx.
 *  Returns a tab id or null. */
async function findLabsTab() {
  const tabs = await chrome.tabs.query({});
  const ok = (t) => t.url && !t.url.includes("accounts.google.com");
  const byRecent = (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0);
  const flow = tabs
    .filter((t) => ok(t) && t.url.includes("labs.google") && t.url.includes("/tools/flow"))
    .sort(byRecent);
  if (flow.length) return flow[0].id;
  const labs = tabs.filter((t) => ok(t) && t.url.includes("labs.google/fx")).sort(byRecent);
  return labs.length ? labs[0].id : null;
}

async function closeOtherLabsTabs(keepTabId = null) {
  const tabs = await chrome.tabs.query({});
  const staleTabIds = tabs
    .filter((tab) => {
      const url = String(tab.url || "");
      const isFlowTab = url.includes("labs.google/fx/tools/flow");
      const isTrackedFlowContext = tab.id === _labsTabId && url.includes("labs.google/fx");
      return tab.id !== keepTabId && (isFlowTab || isTrackedFlowContext);
    })
    .map((tab) => tab.id)
    .filter(Number.isInteger);
  await Promise.allSettled(staleTabIds.map((tabId) => chrome.tabs.remove(tabId)));
}

/** Find a live labs.google tab (don't reload it — that resets grecaptcha), or
 *  open ONE in the background, shared across concurrent callers. */
async function ensureLabsTab() {
  // Always select the latest real Flow tab, then close every older duplicate.
  const existing = await findLabsTab();
  if (existing != null) {
    await waitForTabComplete(existing);
    await closeOtherLabsTabs(existing);
    _labsTabId = existing;
    return existing;
  }
  // Create one only after stale Flow tabs are closed. Concurrent callers await
  // the same promise, so a batch can never open one tab per job.
  if (!_labsTabCreating) {
    _labsTabCreating = (async () => {
      await closeOtherLabsTabs();
      const tab = await chrome.tabs.create({ url: LABS_FLOW_URL, active: false });
      await waitForTabComplete(tab.id);
      await sleep(FLOW_TAB_WARMUP_MS);
      await closeOtherLabsTabs(tab.id);
      _labsTabId = tab.id;
      return tab.id;
    })();
    _labsTabCreating.finally(() => {
      _labsTabCreating = null;
    });
  }
  return _labsTabCreating;
}

/** Refresh the Flow tab's grecaptcha context after an "unusual activity" reject.
 *  Always bounce /fx → /fx/tools/flow to force a fresh grecaptcha init (the G-Labs
 *  recovery trick), so the next mint scores cleanly.
 *
 *  N parallel jobs can all be flagged at once and call this together — without a
 *  lock they'd issue overlapping navigations on the SAME shared tab and corrupt
 *  its state. So concurrent callers coalesce onto a single in-flight refresh. */
async function runRefreshCaptcha(jobId) {
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.REFRESH_CAPTCHA, ...extra }));
  try {
    if (!_labsTabRefreshing) {
      _labsTabRefreshing = (async () => {
        const tabId = await ensureLabsTab();
        await chrome.tabs.update(tabId, { url: "https://labs.google/fx" });
        await waitForTabComplete(tabId);
        await chrome.tabs.update(tabId, { url: LABS_FLOW_URL });
        await waitForTabComplete(tabId);
      })();
      _labsTabRefreshing.finally(() => {
        _labsTabRefreshing = null;
      });
    }
    await _labsTabRefreshing;
    reply({ ok: true });
  } catch (e) {
    reply({ ok: false, error: String(e?.message || e) });
  }
}

// ---- on-page "managed tab" HUD relay ---------------------------------------
// The desktop app drives the HUD on the managed tab by sending ACTION.HUD. We
// resolve the tab and relay the phase to the content-script overlay. Purely
// cosmetic: a missing tab or not-yet-ready content script must NEVER fail the job,
// so every error here is swallowed.
//
// Bring-to-front rule: ONLY grok/tiktok (those ARE the automation tabs the operator
// should watch). The Flow/labs tab (source google_labs, or empty) is just a silent
// background reCAPTCHA tab — keep it in the background so the operator is NOT yanked
// to a labs.google page. Being pulled there tempted operators to sign in, and a fresh
// labs login rotates the NextAuth session-token → kills the app's saved cookie → the
// next generate fails with HTTP 401. reCAPTCHA mints fine on the background (even
// not-logged-in) tab, so there is no reason to surface it. [[labs-token-autowarm]]
async function runHud(jobId, data) {
  const phase = data?.phase || "stage";
  try {
    const tabId = await hudTargetTab(data?.source);
    if (tabId == null) return;
    const isLabs = !data?.source || data.source === "google_labs";
    if (phase === "start" && !isLabs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {
        /* tab vanished between resolve and focus */
      }
    }
    const message = {
      type: "hud",
      phase,
      jobId: jobId ?? "_",
      title: data?.title,
      subtitle: data?.subtitle,
      stage: data?.stage,
      ok: data?.ok,
      label: data?.label,
      steps: data?.steps, // pipeline rail [{key,label}] — the overlay validates it
      step: data?.step, // active step key (think/image/video/post)
      failStep: data?.failStep, // partial success: this step settles red, the rest ✓
    };
    // The overlay content script may still be initialising on a freshly opened
    // tab — one quick retry covers that race.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await chrome.tabs.sendMessage(tabId, message);
        return;
      } catch (_) {
        if (attempt === 0) await sleep(500);
      }
    }
    // Still no receiver: the tab was open BEFORE this extension (re)loaded, so
    // Chrome never injected our content scripts into it (MV3 doesn't retro-inject
    // on update/reload) — the #1 reason the labs.google HUD "stops showing" after
    // an extension update. Inject dom.js + overlay.js on demand (manifest grants
    // "scripting" + the labs/grok/tiktok host permissions) and deliver once more.
    // Both scripts guard against double-init (dom.js: `if (window.TB) return`;
    // overlay.js: `if (!window.TB || window.TB.hud) return`), so this is a no-op
    // when they were already present. We inject ONLY the HUD pair — never the
    // per-site driver (google-labs.js / grok.js / tiktok.js) — so we can't add a
    // duplicate generate/publish listener to a tab.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content/dom.js", "src/content/overlay.js"],
      });
      await chrome.tabs.sendMessage(tabId, message);
    } catch (_) {
      /* injection blocked or tab gone — HUD is cosmetic, so give up quietly */
    }
  } catch (_) {
    /* HUD is cosmetic — never surface its failures as a job error */
  }
}

/** The tab that should show the HUD for a given source. Flow reuses the shared
 *  managed labs tab; other sources target their already-open automation tab. */
async function hudTargetTab(source) {
  if (source === "google_labs" || !source) {
    try {
      return await ensureLabsTab();
    } catch (_) {
      return null;
    }
  }
  const origin = source === "grok" ? "grok.com" : source === "tiktok" ? "tiktok.com" : null;
  if (!origin) return null;
  const tabs = await chrome.tabs.query({});
  const t = tabs.find((tb) => tb.url && tb.url.includes(origin));
  return t ? t.id : null;
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs);
  });
}

// Injected into the labs.google page (MAIN world) — mints a reCAPTCHA Enterprise
// token. If no siteKey is supplied, it's discovered from the page's grecaptcha
// config. Self-contained: references only page globals (never runs in the SW).
async function mintRecaptchaInPage(siteKey, captchaAction) {
  try {
    if (typeof grecaptcha === "undefined" || !grecaptcha.enterprise) {
      return { token: null, error: "grecaptcha.enterprise not ready" };
    }
    let key = siteKey;
    if (!key) {
      try {
        if (typeof ___grecaptcha_cfg !== "undefined" && ___grecaptcha_cfg.clients) {
          const clients = ___grecaptcha_cfg.clients;
          for (const ck of Object.keys(clients)) {
            const client = clients[ck];
            for (const p of Object.keys(client)) {
              const v = client[p];
              if (v && typeof v === "object") {
                for (const p2 of Object.keys(v)) {
                  if (v[p2] && typeof v[p2] === "object" && v[p2].sitekey) {
                    key = v[p2].sitekey;
                    break;
                  }
                }
              }
              if (key) break;
            }
            if (key) break;
          }
        }
      } catch (e) {
        /* fall through */
      }
    }
    if (!key) return { token: null, error: "no siteKey" };
    await new Promise((res) => grecaptcha.enterprise.ready(res));
    const token = await Promise.race([
      grecaptcha.enterprise.execute(key, { action: captchaAction }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("execute timeout")), 15000)),
    ]);
    return { token, error: null };
  } catch (e) {
    return { token: null, error: (e && e.message) || String(e) };
  }
}

// ---- Tab + content-script plumbing -----------------------------------------
// Returns { tabId, created }. `created` matters for auto-close: a tab the user
// already had open on that site is theirs, and closing it would take a page away
// from under them — only a tab this function opened may be closed again.
async function openSite(targetUrl) {
  const origin = new URL(targetUrl).origin;
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find((t) => t.url && t.url.startsWith(origin));
  let created = false;
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true, url: targetUrl });
  } else {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
    created = true;
  }
  try {
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {
    /* focus is best-effort; tab automation still works if Chrome blocks window focus */
  }
  await waitForContentScript(tab.id);
  return { tabId: tab.id, created };
}

async function openTemporarySite(targetUrl) {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] }).catch(() => []);
  const focused = windows.find((win) => win.focused) || windows[0];
  const tab = await chrome.tabs.create({
    ...(focused?.id != null ? { windowId: focused.id } : {}),
    url: targetUrl,
    active: false,
  });
  await waitForContentScript(tab.id);
  return tab.id;
}

// A logged-in grok.com session? (sso / sso-rw cookie present). The internal API needs it.
async function grokLoggedIn() {
  for (const name of ["sso", "sso-rw"]) {
    try {
      const c = await chrome.cookies.get({ url: "https://grok.com", name });
      if (c && c.value && c.value.length > 10) return true;
    } catch (_) {
      /* cookies permission/availability */
    }
  }
  return false;
}

// ---- Generic Grok relay (the G-Labs model) ---------------------------------
// The desktop app (grok_api.GrokApiClient) owns the ENTIRE Grok API contract and hands us
// plain fetch / WebSocket SPECS to run INSIDE the user's real, logged-in grok.com tab. We
// inject a self-contained function into the page (executeScript world:MAIN) so the call rides
// the page's own grok-signed window.fetch (passes anti-bot) + the tab's cookies, then return
// the raw result to the app (correlated by data.relayId). No content script, no API knowledge
// here — the extension is a dumb relay. [[grok-realtab-api-pivot]]

// In-tab anti-idle (mirrors G-Labs' grokKeepAlive): a logged-in grok.com tab left idle gets
// challenged by anti-bot AND stops emitting signed /rest/* traffic (so we can't sniff a fresh
// x-statsig-id). While a grok relay is in flight, nudge the tab with a randomized scroll +
// mousemove every ~1.5-3 min so the session stays warm. [[grok-realtab-api-pivot]]
let grokRelayActive = 0; // # of grok relays currently in flight (gates the keepalive nudge)
let grokKeepAliveAt = 0; // last keepalive nudge (throttle)
async function grokNudge(tabId) {
  // A light scroll + mousemove so a SETTLED grok tab fires a fresh signed /rest/* request (for the
  // statsig sniffer) WITHOUT a disruptive reload — a reload makes grok's DOM-reading statsig signer
  // run mid-render and throw "…childNodes" → a broken x0: token. [[grok-realtab-api-pivot]]
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          const dy = Math.floor(200 + Math.random() * 400);
          window.scrollBy(0, dy);
          setTimeout(() => { try { window.scrollBy(0, -dy); } catch (_) {} }, 400 + Math.floor(Math.random() * 800));
          document.dispatchEvent(new MouseEvent("mousemove", {
            clientX: Math.floor(100 + Math.random() * 700),
            clientY: Math.floor(100 + Math.random() * 400),
            bubbles: true, cancelable: true, view: window,
          }));
        } catch (_) {}
      },
    });
  } catch (_) {}
}
async function grokKeepAlive() {
  if (grokRelayActive <= 0) return;
  const minGap = 90000 + Math.floor(Math.random() * 90000); // 1.5-3 min, jittered
  if (Date.now() - grokKeepAliveAt < minGap) return;
  grokKeepAliveAt = Date.now();
  try {
    const tabs = await chrome.tabs.query({ url: ["https://grok.com/*"] });
    const tab = tabs.find((t) => t.url && /^https:\/\/grok\.com\/imagine/.test(t.url)) || tabs[0];
    if (tab && tab.id) await grokNudge(tab.id);
  } catch (_) {}
}

async function runGrokFetch(jobId, data) {
  grokRelayActive++;
  const relayId = data.relayId;
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.GROK_FETCH, relayId, ...extra }));
  try {
    const tabId = await ensureGrokTab();
    if (data.injectStatsig) {
      // Pre-flight: ensure we hold a fresh grok-signed x-statsig-id. NOT force:true — the whole
      // generate chain (upload→create→convo→upscale) is now signed (G-Labs parity), so a single
      // warmup at the first hop yields a token good for the rest within GROK_STATSIG_MAX_AGE; a
      // force-bounce on every hop would re-navigate the tab 3-4× per job. warmup still bounces when
      // the token is actually missing/stale, and the 403-recovery below force-recaptures.
      // [[grok-realtab-api-pivot]]
      await warmupGrokStatsig(tabId, { force: false });
      bus.send(envelope(MSG.EXT_STATUS, jobId, {
        stage: "grok",
        message:
          "x-statsig-id " +
          (grokStatsig
            ? grokStatsig.slice(0, 14) + "… len" + grokStatsig.length + " tier" + grokStatsigTier + " age" + Math.round((Date.now() - grokStatsigAt) / 1000) + "s"
            : "MISSING (grok emitted no signed /rest/* during warmup)") +
          (grokSentryHeaders ? " +telemetry(baggage)" : " ⚠️NO telemetry hdrs sniffed") +
          " | warmup saw: " + _grokSeenSummary() +
          (grokCfBlocked
            ? " ⚠️ Cloudflare challenge ค้างในแท็บ grok — เปิดแท็บ grok.com แก้ challenge (Just a moment) ให้ผ่านก่อน แล้วลองใหม่"
            : ""),
      }));
    }
    const spec = {
      url: data.url,
      method: data.method || "GET",
      headers: data.headers || {},
      body: data.body ?? null,
      responseMode: data.responseMode || "json",
      injectStatsig: !!data.injectStatsig,
      timeoutMs: data.timeoutMs || 120000,
    };
    const exec = async () => {
      // Record EXACTLY the token we inject so _sniffStatsig ignores our own echoed request.
      grokInjectedStatsig = data.injectStatsig ? grokStatsig : null;
      const out = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: grokFetchInPage,
        args: [JSON.stringify(spec), grokInjectedStatsig, data.injectStatsig ? grokSentryHeaders : null],
      });
      return (out && out[0] && out[0].result) || { ok: false, error: "no result from page" };
    };
    let result = await exec();
    // G-Labs-style RETRY-SPAM: grok 403s a stale/wrong-context x-statsig-id, but it does NOT cleanly
    // bypass anti-bot — its decompiled flow does "403 recovery at every step + 5*attempt backoff",
    // i.e. re-warm a FRESH token and re-fire until one passes. We used to retry only ONCE then give
    // up (the gap vs G-Labs). Now: on 403, bounce the tab to mint a fresh signed /rest/* token (SW
    // sniffs it), back off, and retry up to N times. If grok's token is TIME-bound, a fresh one
    // eventually 200s; if REQUEST-bound, all N 403 and we surface the failure (grok image WS still
    // works). Each warmup re-navigates the tab (~seconds), so this can take a bit. [[grok-403-glabs-vs-ours]]
    const GROK_403_MAX_RETRIES = 4;
    for (let i = 1; data.injectStatsig && result && result.status === 403 && i <= GROK_403_MAX_RETRIES; i++) {
      bus.send(envelope(MSG.EXT_STATUS, jobId, {
        stage: "grok",
        message: `grok โดน 403 (anti-bot) — รี token สดแล้วยิงใหม่ รอบ ${i}/${GROK_403_MAX_RETRIES}…`,
      }));
      await sleep(1200 * i); // backoff grows per attempt (mirrors G-Labs 5*attempt)
      await warmupGrokStatsig(tabId, { force: true }); // re-capture a genuinely fresh token each retry
      result = await exec();
    }
    reply(result);
  } catch (e) {
    reply({ ok: false, error: String((e && e.message) || e) });
  } finally {
    grokRelayActive = Math.max(0, grokRelayActive - 1);
  }
}

const GROK_STATSIG_MAX_AGE = 45000; // a captured grok x-statsig-id is reusable for ~this long

// Cloudflare "Just a moment" interstitial detection. After a warmup BOUNCE (/ → /imagine) the
// freshly-loaded page can still be running Cloudflare's JS challenge for a beat; a POST fired into
// that window comes back as the challenge HTML, not grok's API (live 2026-06-18: upload-file → 403
// "Just a moment" right after the bounce). Poll the tab title until it clears. G-Labs does the same
// (its session-refresh reads document.title for these keywords). [[grok-realtab-api-pivot]]
let grokCfBlocked = false; // last warmup left the grok tab on a Cloudflare challenge it couldn't clear
const _CF_CHALLENGE_RE = /just a moment|checking your browser|attention required|cloudflare|verify you are human/i;
async function grokTabChallenged(tabId) {
  try {
    const out = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => { try { return String(document.title || ""); } catch (_) { return ""; } },
    });
    return _CF_CHALLENGE_RE.test((out && out[0] && out[0].result) || "");
  } catch (_) { return false; }
}
async function waitGrokCloudflareClear(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let everChallenged = false;
  while (Date.now() < deadline) {
    if (!(await grokTabChallenged(tabId))) return { everChallenged, stillBlocked: false };
    everChallenged = true;
    await sleep(500);
  }
  return { everChallenged, stillBlocked: true };
}

// Ensure we hold a fresh grok-signed x-statsig-id. grok only puts one on the wire when its frontend
// makes a signed /rest/* call, so when ours is missing/stale we BOUNCE grok.com → /imagine: that
// (a) makes grok's frontend fire fresh signed /rest/* requests, and (b) re-installs grok-api.js's
// document_start window.fetch hook, which forwards grok's OWN per-request token to the SW. Then
// busy-wait for the capture. Skips the bounce when the token is still fresh. (G-Labs' warmup.)
// [[grok-realtab-api-pivot]]
async function warmupGrokStatsig(tabId, { force = false } = {}) {
  if (!force && grokStatsig && Date.now() - grokStatsigAt < GROK_STATSIG_MAX_AGE) return grokStatsig;
  grokStatsig = null; // invalidate so we wait for a genuinely new token
  grokStatsigTier = 0; // reset the tier so the first token wins
  grokStatsigSeen = []; // fresh warmup → fresh candidate census
  grokSentryHeaders = null; // re-snapshot telemetry headers from the next frozen token's request
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (_) {}
  // Navigate / → /imagine so grok's frontend fires fresh SIGNED /rest/* requests we can sniff — an
  // idle/settled tab emits NONE (→ "x-statsig-id MISSING"), so a gentle no-nav warmup can't capture.
  // grok-api.js no longer patches window.fetch/XHR, so grok's anti-bot statsig signer is healthy and
  // these requests now carry a VALID token (not the `x0:` tamper-error). Let the imagine UI mount
  // before capturing, and the x0: guard in setGrokStatsig drops any residual error token.
  // [[grok-realtab-api-pivot]]
  try {
    await chrome.tabs.update(tabId, { url: "https://grok.com/" });
    await waitTabComplete(tabId, 15000);
    await chrome.tabs.update(tabId, { url: "https://grok.com/imagine" });
    await waitTabComplete(tabId, 15000);
    // Let Cloudflare's post-navigation challenge clear before any POST rides this tab.
    const cf = await waitGrokCloudflareClear(tabId);
    grokCfBlocked = cf.stillBlocked;
    await sleep(2000); // let the imagine UI + signer settle before we trust a captured token
  } catch (_) {}
  const deadline = Date.now() + 12000;
  while (!grokStatsig && Date.now() < deadline) await sleep(120);
  return grokStatsig;
}

async function runGrokWs(jobId, data) {
  grokRelayActive++;
  const relayId = data.relayId;
  const reply = (extra) =>
    bus.send(envelope(MSG.EXT_RESULT, jobId, { action: ACTION.GROK_WS, relayId, ...extra }));
  try {
    const tabId = await ensureGrokTab();
    const spec = {
      url: data.url,
      initMessages: data.initMessages || [],
      completeImageCount: data.completeImageCount || 0,
      terminateOnCompleted: data.terminateOnCompleted !== false,
      timeoutMs: data.timeoutMs || 180000,
      idleTimeoutMs: data.idleTimeoutMs || 45000,
    };
    const out = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: grokWsInPage,
      args: [JSON.stringify(spec)],
    });
    reply((out && out[0] && out[0].result) || { ok: false, error: "no result from page" });
  } catch (e) {
    reply({ ok: false, error: String((e && e.message) || e) });
  } finally {
    grokRelayActive = Math.max(0, grokRelayActive - 1);
  }
}

// Injected into the grok.com page (world:MAIN) — self-contained, references only its args +
// page globals (fetch/btoa/...). Runs ONE fetch through the page's grok-signed window.fetch.
async function grokFetchInPage(specJson, statsig, sentry) {
  const s = JSON.parse(specJson);
  const headers = Object.assign({}, s.headers || {});
  // Replay grok's REAL browser-telemetry headers (baggage / sentry-trace / traceparent), sniffed
  // off grok's own /rest/* request. anti-bot code-7 rejects a request stripped of these — a real
  // browser's Sentry SDK always sends them. Set once (they don't rotate per-attempt like statsig).
  // [[grok-403-glabs-vs-ours]]
  if (s.injectStatsig && sentry) {
    if (sentry.baggage) headers["baggage"] = sentry.baggage;
    if (sentry["sentry-trace"]) headers["sentry-trace"] = sentry["sentry-trace"];
    if (sentry.traceparent) headers["traceparent"] = sentry.traceparent;
  }
  // x-statsig-id: grok rotates a per-request token and REJECTS a stale/replayed one with 403 on
  // the protected endpoints (/conversations/new). Match G-Labs: send the FRESHEST token we can —
  // prefer the page's current localStorage value (what grok itself would use next), then the
  // value the service worker sniffed off grok's own /rest/* requests. Re-read it on each retry
  // (grok's SDK may rotate it). The browser adds the real Sec-Ch-Ua / Sec-Fetch / UA fingerprint
  // automatically because this fetch originates from the grok.com page. [[grok-realtab-api-pivot]]
  const freshStatsig = () => {
    if (!s.injectStatsig) return null;
    // ONLY the SW-sniffed frozen token — exactly G-Labs (_ftCache). The page's localStorage
    // `x-statsig-id` is a DIFFERENT id that anti-bot 403s on video, and re-reading it per-attempt
    // could swap the token mid-request; never fall back to it for an injected POST. The single
    // frozen token passed in from runGrokFetch is used verbatim for every hop. [[grok-realtab-api-pivot]]
    return statsig || null;
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), s.timeoutMs || 120000);
  const opts = { method: s.method || "GET", headers, credentials: "include", signal: ac.signal };
  if (s.body != null && s.body !== "") opts.body = s.body;
  let res;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sid = freshStatsig();
      if (sid) headers["x-statsig-id"] = sid;
      else delete headers["x-statsig-id"];
      res = await fetch(s.url, opts);
      if (res.status !== 403) break;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: "fetch: " + String(e) };
  }
  // DECISIVE TEST: emit a ready-to-paste console replay of THIS exact request (final headers incl
  // the x-statsig-id we used + the body) for /conversations/new. The app writes it to the job
  // folder so it survives the tab's 403-recovery navigation. Pasting it into grok's own console
  // isolates token-vs-injection-method: 200 in console but 403 here ⇒ the executeScript path is
  // the problem; 403 in console too ⇒ the token/body is wrong. [[grok-realtab-api-pivot]]
  let replay = null;
  if (/conversations\/new/.test(s.url || "")) {
    try {
      replay =
        "(async()=>{const r=await fetch(" + JSON.stringify(s.url) +
        ",{method:'POST',credentials:'include',headers:" + JSON.stringify(headers) +
        (s.body != null ? ",body:" + JSON.stringify(s.body) : "") +
        "});console.log('TB-REPLAY status:',r.status);console.log('TB-REPLAY body:',(await r.text()).slice(0,600));})()";
    } catch (e) {}
  }
  const status = res.status;
  const mode = s.responseMode || "json";
  // Non-200 → surface grok's actual RESPONSE BODY (the 4xx reason: invalid model, anti-bot,
  // bad attachment, rate-limit, …) instead of a bare status, so the app log shows WHY.
  // [[grok-realtab-api-pivot]]
  if (status !== 200) {
    let errText = "";
    try { errText = await res.text(); } catch (e) {}
    clearTimeout(timer);
    return { ok: false, status, error: "HTTP " + status + ": " + errText.slice(0, 1000), replay };
  }
  try {
    if (mode === "arrayBuffer") {
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      clearTimeout(timer);
      return {
        ok: status === 200, status, body: btoa(bin),
        contentType: res.headers.get("content-type") || "",
      };
    }
    if (mode === "stream") {
      // A streamed response of concatenated top-level JSON objects → parse into an array.
      // Read incrementally and STOP when the stream closes OR goes idle (grok keeps the
      // socket open after delivering the final object, so a plain res.text() would hang to
      // the hard timeout). Idle = no new bytes for streamIdleMs after activity.
      let text = "";
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const idleMs = s.streamIdleMs || 30000;
        let pending = reader.read();
        try {
          while (true) {
            let timedOut = false;
            const idleP = new Promise((r) => setTimeout(() => { timedOut = true; r(); }, idleMs));
            await Promise.race([pending, idleP]);
            if (timedOut) { try { reader.cancel(); } catch (e) {} break; }
            const { value, done } = await pending;
            if (done) break;
            text += decoder.decode(value, { stream: true });
            pending = reader.read();
          }
        } catch (e) { /* return whatever we have parsed so far */ }
      } else {
        text = await res.text();
      }
      clearTimeout(timer);
      const objects = [];
      let depth = 0, inStr = false, esc = false, start = -1;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (start === -1) {
          if (ch === "{") { start = i; depth = 1; inStr = false; esc = false; }
          continue;
        }
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch (e) {}
            start = -1;
          }
        }
      }
      return { ok: status === 200, status, body: objects };
    }
    if (mode === "text") {
      const txt = await res.text();
      clearTimeout(timer);
      return { ok: status === 200, status, body: txt };
    }
    let txt = "";
    try { txt = await res.text(); } catch (e) {}
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch (e) {}
    clearTimeout(timer);
    return { ok: status === 200, status, body };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status, error: "read: " + String(e) };
  }
}

// Injected into the grok.com page (world:MAIN) — opens ONE WebSocket, sends the init frames,
// collects every JSON message, and finishes on a "final/complete" status (+grace for trailing
// image frames), idle, or hard timeout. Self-contained.
async function grokWsInPage(specJson) {
  const s = JSON.parse(specJson);
  return await new Promise((resolve) => {
    let ws;
    const messages = [];
    let finished = false;
    let lastActivity = Date.now();
    let graceTimer = null;
    const settle = (ok, reason, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(hard);
      clearInterval(idle);
      clearTimeout(graceTimer);
      try { ws.close(); } catch (e) {}
      resolve({ ok: ok || messages.length > 0, messages, reason, error });
    };
    const hard = setTimeout(() => settle(true, "timeout"), s.timeoutMs || 180000);
    const idle = setInterval(() => {
      if (!finished && Date.now() - lastActivity > (s.idleTimeoutMs || 45000)) settle(true, "idle");
    }, 1000);
    try {
      ws = new WebSocket(s.url);
    } catch (e) {
      clearTimeout(hard);
      clearInterval(idle);
      return resolve({ ok: false, messages, error: "ws ctor: " + String(e) });
    }
    ws.onopen = () => {
      lastActivity = Date.now();
      try {
        for (const m of s.initMessages || []) ws.send(typeof m === "string" ? m : JSON.stringify(m));
      } catch (e) {
        settle(false, "error", "ws send: " + String(e));
      }
    };
    ws.onmessage = (evt) => {
      lastActivity = Date.now();
      if (typeof evt.data !== "string") return;
      let obj;
      try { obj = JSON.parse(evt.data); } catch (e) { return; }
      messages.push(obj);
      if (obj && obj.type === "json" && /final|complete|finished|done/i.test(obj.current_status || "")) {
        clearTimeout(graceTimer); // collect trailing image frames (preview→final), then finish
        graceTimer = setTimeout(() => settle(true, "final"), 1500);
      }
    };
    ws.onerror = () => settle(false, "error", "ws onerror");
    ws.onclose = () => settle(true, "ws-close");
  });
}

// Ensure a usable grok.com tab for the relay: require a logged-in session, then reuse an
// existing grok.com tab (preferring one already on /imagine) WITHOUT stealing focus, else open
// one in the background. No content script needed — runGrok* injects a self-contained function
// via executeScript(world:MAIN). [[grok-realtab-api-pivot]]
async function ensureGrokTab() {
  if (!(await grokLoggedIn())) {
    throw new Error("ยังไม่ได้ล็อกอิน grok.com — เปิดแท็บ grok.com แล้วล็อกอิน เปิดค้างไว้ แล้วลองใหม่");
  }
  const tabs = await chrome.tabs.query({});
  const onImagine = tabs.find((t) => t.url && /^https:\/\/grok\.com\/imagine/.test(t.url));
  const anyGrok = tabs.find((t) => t.url && /^https:\/\/grok\.com\//.test(t.url));
  let tabId;
  if (onImagine) {
    tabId = onImagine.id; // reuse as-is — no navigation, no focus theft
  } else if (anyGrok) {
    await chrome.tabs.update(anyGrok.id, { url: "https://grok.com/imagine" }); // no `active`
    await waitTabComplete(anyGrok.id, 25000);
    tabId = anyGrok.id;
  } else {
    const tab = await chrome.tabs.create({ url: "https://grok.com/imagine", active: false });
    await waitTabComplete(tab.id, 25000);
    tabId = tab.id;
  }
  // Pin the tab so Chrome can't discard it mid-generation (G-Labs sets this on every task; we
  // only set it inside warmup, so a fresh-token job that skips warmup was left discardable).
  try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (_) {}
  return tabId;
}

async function waitForContentScript(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: CONTENT_PING });
      if (res?.ready) return;
    } catch (_) {
      /* content script not injected yet */
    }
    await sleep(400);
  }
  throw new Error("content script did not become ready");
}

async function ensureAutomationScripts(tabId, files) {
  try {
    await waitForContentScript(tabId, 2500);
    return;
  } catch (_) {
    /* inject below */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files });
  await waitForContentScript(tabId, 10000);
}

async function sendToTabRobust(tabId, message, opts = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      if (!res?.retry) return res;
      lastErr = new Error(res.error || "content script requested retry");
    } catch (e) {
      lastErr = e;
    }
    if (opts.files) {
      try {
        await waitForTabComplete(tabId);
        await ensureAutomationScripts(tabId, opts.files);
      } catch (_) {
        /* tab may still be routing; retry after a short pause */
      }
    }
    await sleep(1500 + attempt * 1000);
  }
  throw lastErr || new Error("content script did not respond");
}

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Content-script -> app relay -------------------------------------------
chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  // Popup's "Connect" asks us to launch (or focus) the desktop app, then bring the
  // bridge up. We launch via native messaging and ensure the socket so the dot flips
  // to amber as soon as the app is listening. The result is relayed back so the popup
  // can guide the user when the launcher host isn't registered yet.
  if (m?.type === "__tb_launch_app") {
    launchApp().then((res) => {
      bus.ensure();
      sendResponse?.(res);
    });
    return true; // keep the channel open for the async native-messaging result
  }
  // Popup asks us to reconnect (e.g. after the port changed).
  if (m?.type === "__tb_reconnect") {
    try {
      bus.ws?.close();
    } catch (_) {}
    bus.ensure();
    sendResponse?.({ ok: true });
    return;
  }
  if (!m || m.__tb !== true) return;
  if (m.type === MSG.EXT_STATUS) status(m.jobId, m.stage, m.message, m.progress);
  else if (m.type === MSG.EXT_ERROR) reportError(m.jobId, new Error(m.message));
  // grok-api.js (MAIN world) sniffs grok's OWN per-request x-statsig-id off the page's real fetch
  // and relays it here via grok.js — the deterministic capture (immune to webRequest blind spots).
  // [[grok-realtab-api-pivot]]
  else if (m.type === "grokStatsig") setGrokStatsig(m.value, 2); // in-page hook is GET-only, path unknown → tier 2
});

function status(jobId, stage, message, progress) {
  bus.send(envelope(MSG.EXT_STATUS, jobId, { stage, message, progress: progress ?? null }));
}

function reportError(jobId, err) {
  // console.debug (not error) so transient/expected failures don't light up the
  // extension's "Errors" card — the failure is still reported to the app's log.
  console.debug("[NoLogin]", err);
  bus.send(envelope(MSG.EXT_ERROR, jobId ?? null, { message: String(err?.message || err) }));
}

// ---- Cross-origin media fetch for content scripts --------------------------
// A content script's own fetch() is CORS-blocked when it pulls generated media
// from another origin (e.g. tiktok.com fetching labs.google / assets.grok.com).
// The service worker CAN fetch those — host_permissions grant it cross-origin
// access — so the content script relays the URL here and gets the bytes back
// base64-encoded (runtime messaging can't carry a Blob/ArrayBuffer directly).
chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (!m || m.__tb !== true || m.type !== "fetchMedia") return;
  fetchMediaAsPayload(m.url)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // keep the channel open for the async response
});

async function fetchMediaAsPayload(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const type = res.headers.get("content-type") || "application/octet-stream";
  const base64 = arrayBufferToBase64(await res.arrayBuffer());
  return { base64, type };
}

// ---- AutoGT Pro passive browser session capture ----------------------------
const AUTOGT_SESSION_PROVIDERS = [
  {
    provider: "tiktok",
    url: "https://www.tiktok.com/",
    domains: ["tiktok.com"],
    cookies: [
      "sessionid",
      "sessionid_ss",
      "sid_tt",
      "uid_tt",
      "uid_tt_ss",
      "ttwid",
      "msToken",
      "odin_tt",
      "passport_csrf_token",
      "passport_csrf_token_default",
      "csrf_session_id",
      "tt_chain_token",
      "s_v_web_id",
      "multi_sids",
      "sid_guard",
      "sid_ucp_v1",
      "ssid_ucp_v1",
    ],
  },
  {
    provider: "shopee",
    url: "https://shopee.co.th/",
    domains: ["shopee.co.th", "affiliate.shopee.co.th"],
    cookies: [
      "SPC_EC",
      "SPC_ST",
      "SPC_U",
      "SPC_R_T_ID",
      "SPC_R_T_IV",
      "SPC_F",
      "SPC_SI",
      "SPC_SEC_SI",
      "SPC_CLIENTID",
      "REC_T_ID",
      "csrftoken",
    ],
  },
  {
    provider: "facebook",
    url: "https://www.facebook.com/",
    domains: ["facebook.com"],
    cookies: ["c_user", "xs"],
  },
];
const AUTOGT_CAPTURE_ENDPOINT = "http://127.0.0.1:18787/api/browser-capture";
const AUTOGT_ATTEMPT_GAP_MS = 10 * 60 * 1000;

async function cookiesForProvider(provider) {
  const domains = provider.domains || [provider.domain].filter(Boolean);
  const cookieMap = new Map();
  for (const domain of domains) {
    try {
      const rows = await chrome.cookies.getAll({ domain });
      for (const cookie of rows) {
        if (!provider.cookies.some((name) => cookie.name.includes(name))) continue;
        cookieMap.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
      }
    } catch (_) {
      /* keep scanning the other domains */
    }
  }
  return [...cookieMap.values()];
}

async function sendAutoCapture(provider, cookies, via) {
  const payload = {
    capturedAt: new Date().toISOString(),
    source: "AutoGT Pro Extension",
    captureMode: "auto-cookie-scan",
    provider: provider.provider,
    via,
    tab: { url: provider.url, domain: (provider.domains || [provider.domain])[0], title: provider.provider },
    cookies,
  };
  await chrome.storage.local.set({ [`autogt_${provider.provider}_capture`]: payload });
  try {
    await fetch(AUTOGT_CAPTURE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    /* local app may be closed; storage.local still has the latest capture */
  }
}

async function openProbeTabForCookies(provider) {
  const key = `autogt_${provider.provider}_last_probe`;
  const saved = await chrome.storage.local.get(key);
  const last = Number(saved[key] || 0);
  if (Date.now() - last < AUTOGT_ATTEMPT_GAP_MS) return [];
  await chrome.storage.local.set({ [key]: Date.now() });

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: provider.url, active: false });
    for (let i = 0; i < 15; i += 1) {
      await sleep(1000);
      const cookies = await cookiesForProvider(provider);
      if (cookies.length) return cookies;
    }
  } catch (_) {
    return [];
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
  return [];
}

async function autoCaptureBrowserSessions(options = {}) {
  const allowProbe = !!options.allowProbe;
  const onlyProviders = Array.isArray(options.providers) && options.providers.length
    ? new Set(options.providers.map((name) => String(name || "").toLowerCase()))
    : null;
  for (const provider of AUTOGT_SESSION_PROVIDERS) {
    if (onlyProviders && !onlyProviders.has(provider.provider)) continue;
    let via = "cookie-scan";
    let cookies = await cookiesForProvider(provider);
    if (!cookies.length && allowProbe) {
      via = "probe";
      cookies = await openProbeTabForCookies(provider);
    }
    if (cookies.length) await sendAutoCapture(provider, cookies, via);
  }
}

async function captureProviderNow(providerName, via = "manual") {
  const provider = AUTOGT_SESSION_PROVIDERS.find((item) => item.provider === providerName);
  if (!provider) return [];
  const cookies = await cookiesForProvider(provider);
  if (cookies.length) await sendAutoCapture(provider, cookies, via);
  return cookies;
}

autoCaptureBrowserSessions({ allowProbe: false }).catch(() => {});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // 32KB chunks avoid String.fromCharCode arg-count limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

