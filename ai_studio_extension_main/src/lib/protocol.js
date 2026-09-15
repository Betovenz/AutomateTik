// Shared message protocol between this extension and the AI Studio Node
// server (ai_studio_server.py / ai_studio/server.js — the vendored AutoGT Pro
// engine). This is the "main"-role bridge (Flow/Grok/TikTok/Shopee) — its
// sibling ai_studio_extension is the dedicated "tiktok"-role bridge. Keep in
// sync with ai_studio/server.js.

export const PROTOCOL_VERSION = 1;

// Fixed port (see AI_STUDIO_PORT / AUTOTIK_AI_STUDIO_PORT in ai_studio_server.py)
// — the Node server doesn't scan forward like gtpro_server.py does, so there is
// nothing to fall forward to.
export const DEFAULT_PORT = 18787;
export const PORT_SCAN_SPAN = 0;

// Message types.
export const MSG = {
  // extension -> app
  EXT_HELLO: "ext.hello",
  EXT_STATUS: "ext.status",
  EXT_RESULT: "ext.result",
  EXT_ERROR: "ext.error",
  // app -> extension
  COMMAND: "ext.command",
  EXT_PING: "ext.ping", // keepalive from the app — receiving it keeps the SW awake
  // UI <-> app (control panel only; the extension ignores these but the
  // constants stay mirrored so the two protocol files don't drift).
  UI_HELLO: "ui.hello",
  UI_STATE: "ui.state",
  JOB_SUBMIT: "job.submit", // UI -> app: add a job to the queue (does NOT auto-run)
  JOB_CANCEL: "job.cancel",
  JOB_RETRY: "job.retry", // UI -> app: re-run the FAILED job(s) in a Recent-jobs row
  QUEUE_RUN: "queue.run", // UI -> app: run queued jobs in order; data.mode (opt) scopes to one mode
  QUEUE_STOP: "queue.stop", // UI -> app: halt a running drain + cancel in-flight; data.mode (opt) scopes
  JOBS_CLEAR: "jobs.clear", // UI -> app: clear Recent jobs (keeps in-flight); data.mode (opt) scopes, data.ids (opt) removes only those rows
  TIKTOK_CHECK: "tiktok.check", // UI -> app: is a TikTok product-showcase tab open?
  TIKTOK_STATUS: "tiktok.status", // app -> UI: result of a TIKTOK_CHECK
  TIKTOK_UPLOAD: "tiktok.upload", // UI -> app: step 1 — stage a clip in TikTok upload (no post)
  TIKTOK_UPLOADED: "tiktok.uploaded", // app -> UI: result of a TIKTOK_UPLOAD
  TIKTOK_PULL: "tiktok.pull", // UI -> app: step 2 — pull ALL showcase products (every page)
  TIKTOK_PRODUCTS: "tiktok.products", // app -> UI: result of a TIKTOK_PULL
  TIKTOK_CLEAR_PRODUCTS: "tiktok.clearProducts", // UI -> app: forget the saved showcase pull
  TIKTOK_SYNC_PRODUCTS: "tiktok.syncProducts", // UI -> app: set which provider pickers get the pull
  LOG: "log",
  ACCOUNT_ADD: "account.add",
  ACCOUNT_BROWSER: "account.browser",
  ACCOUNT_REFRESH: "account.refresh",
  ACCOUNT_REFRESH_ALL: "account.refreshAll",
  ACCOUNT_DELETE: "account.delete",
  ACCOUNT_TOGGLE: "account.toggle",
  ACCOUNT_PROXY: "account.proxy",
  ACCOUNT_RENAME: "account.rename", // UI -> app: manual display-name edit (TikTok only)
  SETTINGS_UPDATE: "settings.update",
  // extension -> app: a Browser-Login session was captured (cookies harvested)
  ACCOUNT_CAPTURED: "account.captured",
};

// Command actions carried inside an "ext.command" message.
export const ACTION = {
  // grok.com Imagine generate options (opaque pass-through in JobSpec.options). grok DOES
  // have a usable internal API: the MAIN-world engine (grok-api.js) calls it directly inside
  // the user's real logged-in grok.com tab (image=imagine WebSocket, video=conversations/new
  // stream) — no on-screen clicking. [[grok-realtab-api-pivot]]
  // IMAGE step → grokImageQuality ("speed"|"quality"); VIDEO step → grokResolution
  // ("480p"|"720p"), grokDuration ("6s"|"10s"); BOTH → aspect ("2:3"|"3:2"|"1:1"|
  // "9:16"|"16:9", app default "9:16"). Mirror: app/triple_bot_app/protocol.py.
  GENERATE: "generate",
  PUBLISH: "publish",
  PING: "ping",
  CAPTURE_LOGIN: "captureLogin", // app -> ext: watch a provider tab, return cookies
  // app -> ext: read the user's CURRENT labs.google + google.com cookies from their
  // logged-in tab (NO window), correlated by (jobId, action) on EXT_RESULT. The dead-token
  // Refresh reconnects from the browser session before popping a visible login. Reply:
  // {action, ok, cookie (labs-only, stored), cookieInject (labs + google.com SSO, seeded
  // into the persist profile)}. Mirror: app/triple_bot_app/protocol.py.
  HARVEST_LABS: "harvestLabs",
  ENSURE_FLOW_TAB: "ensureFlowTab", // app -> ext: keep one live Flow tab; optional projectId parks it on a room
  FLOW_ROOM_CREATE: "flowRoomCreate", // app -> ext: create one Flow room through in-page jHPbke
  FLOW_ROOM_CREATE_BATCH: "flowRoomCreateBatch", // app -> ext: create many independent rooms in one concurrent in-page batch
  FLOW_EXTEND_SUBMIT: "flowExtendSubmit", // app -> ext: submit Flow's fZytfe Extended scene RPC
  FLOW_VIDEO_SUBMIT: "flowVideoSubmit", // app -> ext: submit Flow's MZZa6b (R2V) / eb1hJf (I2V) video RPC in-page
  FLOW_MEDIA_STATUS: "flowMediaStatus", // app -> ext: poll jwpduf + resolve as29s for one media id in-page
  RELOAD_EXTENSION: "reloadExtension", // app -> ext: chrome.runtime.reload() so a rebuilt unpacked build loads without clicking
  MINT_CAPTCHA: "mintCaptcha", // app -> ext: mint in a flow.google.com/project/<id> page
  REFRESH_CAPTCHA: "refreshCaptcha", // app -> ext: bounce home then return to the project page
  HUD: "hud", // app -> ext: drive the on-page "managed tab" HUD (start/stage/done/hide)
  CHECK_TIKTOK: "checkTikTok", // app -> ext: is the TikTok product-showcase page open?
  CHECK_TIKTOK_LINKS: "checkTikTokLinks", // app -> ext: check TikTok product URLs via product_link/check
  GET_TIKTOK_PROFILES: "getTikTokProfiles", // app -> ext: open/focus TikTok and read signed-in profile cards
  CLAIM_PROFILE_BINDING: "claimProfileBinding", // app -> ext: prove this Chrome profile owns a bind-token tab
  CHECK_SHOPEE_LINKS: "checkShopeeLinks", // app -> ext: check Shopee product URLs + affiliate commission
  PULL_PRODUCTS: "pullProducts", // app -> ext: page through the showcase_product API, return all
  ADD_TO_SHOWCASE: "addToShowcase", // app -> ext: add selected TikTok product IDs into Showcase
  STAGE_CLIP: "stageClip", // app -> ext: open TikTok upload + stage a clip (no post, no pull)
  // GENERIC Grok relay (the G-Labs model — the app/exe owns ALL the Grok API contract; the
  // extension just runs the spec inside the user's real logged-in grok.com tab via
  // executeScript(world:MAIN) and returns the raw result, correlated by data.relayId).
  // [[grok-realtab-api-pivot]]
  GROK_FETCH: "grokFetch", // run one HTTP fetch; spec {url,method,headers,body,responseMode,injectStatsig,timeoutMs}
  GROK_WS: "grokWs", // open one WebSocket; spec {url,initMessages,completeImageCount,terminateOnCompleted,timeoutMs,idleTimeoutMs}
};

/** Last-known app port (set by discovery), or null if never found. */
async function storedPort() {
  try {
    const s = await chrome.storage.local.get("port");
    if (s && Number.isInteger(s.port)) return s.port;
  } catch (_) {
    /* storage may be unavailable very early */
  }
  return null;
}

/** Is the desktop app answering /api/health on this port? Fast, silent on failure. */
async function healthOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: "GET",
      cache: "no-store",
    });
    return res.ok;
  } catch (_) {
    return false; // connection refused = not the app (or app down)
  }
}

/**
 * Find the port the app is actually serving on. Tries the last-known port first
 * (the common case — one probe), then scans DEFAULT_PORT..DEFAULT_PORT+SPAN, the
 * same forward range the app uses when 8788 is busy. Persists the winner so the
 * popup reflects it and the next reconnect is a single probe. Returns null if
 * nothing answered (app not running yet).
 */
export async function discoverPort() {
  const known = await storedPort();
  const candidates = [];
  if (known != null) candidates.push(known);
  for (let p = DEFAULT_PORT; p <= DEFAULT_PORT + PORT_SCAN_SPAN; p++) {
    if (p !== known) candidates.push(p);
  }
  for (const port of candidates) {
    if (await healthOk(port)) {
      if (port !== known) {
        try {
          await chrome.storage.local.set({ port });
        } catch (_) {
          /* best-effort persistence */
        }
      }
      return port;
    }
  }
  return null;
}

export async function resolveWsUrl() {
  // Prefer the live, discovered port; if nothing answers, fall back to the
  // last-known/default so the caller's own reachability check fails cleanly and
  // schedules a retry (no errors surfaced while the app simply isn't up yet).
  const found = await discoverPort();
  const port = found ?? (await storedPort()) ?? DEFAULT_PORT;
  return `ws://127.0.0.1:${port}/ws/extension`;
}

export function envelope(type, jobId, data) {
  return { v: PROTOCOL_VERSION, type, jobId: jobId ?? null, data: data ?? {} };
}
