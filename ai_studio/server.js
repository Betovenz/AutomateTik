const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const httpLib = require("http");
const httpsLib = require("https");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8788);
const AUTOTIK_EXTENSION_DIR = path.resolve(ROOT, "..", "gtpro_extension");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const CAPTURE_FILE = path.join(RUNTIME_DIR, "browser-capture-latest.json");
const CAPTURE_INDEX_FILE = path.join(RUNTIME_DIR, "browser-captures.json");
const SHOPEE_AFFILIATE_CAPTURE_FILE = path.join(RUNTIME_DIR, "shopee-affiliate-api-captures.json");
const EXTENSION_PROFILE_FILE = path.join(RUNTIME_DIR, "extension-profiles.json");
const FLOW_ACCOUNT_FILE = path.join(RUNTIME_DIR, "flow-account.json");
const TIKTOK_ACCOUNT_PROFILE_FILE = path.join(RUNTIME_DIR, "tiktok-account-profiles.json");
// POST WEB AI settings (provider + API keys used to write captions/hashtags).
// Kept server-side so the keys never round-trip to the browser in full.
const POSTWEB_AI_FILE = path.join(RUNTIME_DIR, "postweb-ai.json");
// POST WEB's form settings used to live only in the browser's localStorage, so
// clearing site data, using another browser, or moving the portable build to a
// different machine silently reset them. They are recorded here as well, and the
// page reads this file back on open.
const POSTWEB_SETTINGS_FILE = path.join(RUNTIME_DIR, "postweb-settings.json");
// Same page both extensions' background.js opens to publish — waking a sleeping
// TikTok profile straight onto it means the tab is already there when the retry
// of the publish command lands.
const TIKTOK_UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";
const FLOW_RESULTS_DIR = path.join(ROOT, "lib", "media-core", "flow-results");
const MEDIA_CORE_DIR = path.join(ROOT, "lib", "media-core");
const MEDIA_CORE_JS = path.join(MEDIA_CORE_DIR, "media-core.js");
const MEDIA_CORE_WASM = path.join(MEDIA_CORE_DIR, "media-core.wasm");
const FLOW_BRIDGE_SCRIPT = path.join(ROOT, "lib", "media-core", "flow_backend_bridge.py");
const FINAL_FILE_DIR = path.join(ROOT, "Final-File");
const FINAL_FILE_JS_DIR = path.join(ROOT, "Final-File-JS");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const clients = new Set();
const extensionSockets = new Set();
const extensionSocketMeta = new Map();
const EXPECTED_MAIN_EXTENSION_VERSION = "0.1.22";
const SUPPORTED_MAIN_EXTENSION_VERSIONS = new Set([EXPECTED_MAIN_EXTENSION_VERSION, "0.1.21"]);
const FLOW_EXTENDED_ENABLED = true;
const chromeProfileHintsBySocketId = new Map();
const pendingChromeProfileBindings = new Map();
const pendingExtensionJobs = new Map();
let extensionSocketSeq = 0;
const CHROME_WAKE_WAIT_MS = 18000;
const EXTENSION_ROLE_MAIN = "main";
const EXTENSION_ROLE_TIKTOK = "tiktok";
// Keyed by role + the profile being woken, so two channels in two Chrome
// profiles wake at the same time instead of sharing one global promise (which
// would hand both callers the SAME socket and serialise every publish).
const extensionWakePromises = new Map();
const extensionState = {
  connected: false,
  lastSeen: null,
  version: null,
  lastMessage: null,
  flowAccountEmail: loadRememberedFlowAccountEmail(),
};
const latestProgress = {
  shopee: null,
};
const backendLogs = [];
const MAX_BACKEND_LOGS = 500;

function addBackendLog(level, source, message, detail = null) {
  const row = {
    time: new Date().toISOString(),
    level: level || "info",
    source: source || "server",
    message: String(message || ""),
    detail,
  };
  backendLogs.push(row);
  if (backendLogs.length > MAX_BACKEND_LOGS) backendLogs.splice(0, backendLogs.length - MAX_BACKEND_LOGS);
  const prefix = `[${row.time}] [${row.level}] [${row.source}]`;
  if (row.level === "error") console.error(prefix, row.message, row.detail || "");
  else if (row.level === "warn") console.warn(prefix, row.message, row.detail || "");
  else console.log(prefix, row.message, row.detail || "");
  return row;
}
addBackendLog("info", "server", "AutoGT Pro server booting", { port: PORT });

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".svg": "image/svg+xml; charset=utf-8",
};

function noCacheHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    // Local-only server (bound to 127.0.0.1); allows the main app's own UI
    // (a different localhost port) to call the TikTok Channel account APIs.
    "Access-Control-Allow-Origin": "*",
  };
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const target = path.join(ROOT, clean || "index.html");
  return target.startsWith(ROOT) ? target : path.join(ROOT, "index.html");
}

function sendReload() {
  for (const res of clients) {
    res.write("event: reload\ndata: now\n\n");
  }
}

// Live reload watches the whole app folder, but generated output also lands in
// there (Final-File, flow-results, Python's __pycache__). Reloading on those
// wiped the page mid-generation, so only hand-edited front-end sources count.
const RELOAD_SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".css", ".html"]);
const RELOAD_IGNORE_PARTS = [
  "node_modules",
  "runtime",
  "__pycache__",
  "final-file",
  "flow-results",
  "flow_downloads",
  ".git",
];

let reloadTimer = null;
function queueReload(file) {
  if (!file) return;
  const normalized = String(file).split(path.sep).join("/").toLowerCase();
  if (RELOAD_IGNORE_PARTS.some((part) => normalized.includes(part))) return;
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || !RELOAD_SOURCE_EXT.has(normalized.slice(dot))) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(sendReload, 120);
}

fs.watch(ROOT, { recursive: true }, (_event, file) => queueReload(file));

function readCaptureIndex() {
  try {
    return JSON.parse(fs.readFileSync(CAPTURE_INDEX_FILE, "utf8"));
  } catch {
    const latest = readLatestCapture();
    if (!latest) return {};
    const provider = String(latest.provider || latest.tab?.domain || "unknown").toLowerCase();
    return { [provider]: latest };
  }
}

function readLatestCapture() {
  try {
    return JSON.parse(fs.readFileSync(CAPTURE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeCapture(payload) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(CAPTURE_FILE, JSON.stringify(payload, null, 2), "utf8");
  const provider = String(payload.provider || payload.tab?.domain || "unknown").toLowerCase();
  const index = readCaptureIndex();
  index[provider] = payload;
  fs.writeFileSync(CAPTURE_INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
}

function readShopeeAffiliateCaptures() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SHOPEE_AFFILIATE_CAPTURE_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendShopeeAffiliateCaptures(captures) {
  const incoming = Array.isArray(captures) ? captures.filter((item) => item && typeof item === "object") : [];
  if (!incoming.length) return readShopeeAffiliateCaptures();
  const rows = [...readShopeeAffiliateCaptures(), ...incoming].slice(-100);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(SHOPEE_AFFILIATE_CAPTURE_FILE, JSON.stringify(rows, null, 2), "utf8");
  return rows;
}

function readExtensionProfiles() {
  try {
    const parsed = JSON.parse(fs.readFileSync(EXTENSION_PROFILE_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeExtensionProfiles(profiles) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(EXTENSION_PROFILE_FILE, JSON.stringify(profiles || {}, null, 2), "utf8");
}

function realExtensionProfileLabel(value, installId = "") {
  const label = String(value || "").trim();
  const suffix = String(installId || "").trim().slice(-4);
  // Older builds invented labels such as "Chrome f45b" from installId. It is
  // not a Chrome profile name and must never be shown or used as identity.
  if (/^Chrome\s+[0-9a-f]{4}$/i.test(label) && (!suffix || label.toLowerCase() === `chrome ${suffix}`.toLowerCase())) return "";
  if (/^Chrome\s+#\d+$/i.test(label)) return "";
  return label;
}

function upsertExtensionProfile(meta = {}, patch = {}) {
  const installId = String(meta.installId || patch.installId || "").trim();
  if (!installId) return null;
  const profiles = readExtensionProfiles();
  const current = profiles[installId] || {};
  const next = {
    ...current,
    installId,
    extensionRole: patch.extensionRole || meta.extensionRole || current.extensionRole || EXTENSION_ROLE_MAIN,
    profileLabel: realExtensionProfileLabel(patch.profileLabel || meta.profileLabel || current.profileLabel, installId),
    version: patch.version || meta.version || current.version || "",
    userDataDir: patch.userDataDir || meta.userDataDir || current.userDataDir || "",
    profileDirectory: patch.profileDirectory || meta.profileDirectory || current.profileDirectory || "",
    profileDir: patch.profileDir || meta.profileDir || current.profileDir || "",
    profileStableId: patch.profileStableId || patch.chromeProfileStableId || meta.profileStableId || current.profileStableId || chromeProfileStableId({ ...current, ...meta, ...patch }),
    chromeProfileStableId: patch.chromeProfileStableId || patch.profileStableId || meta.chromeProfileStableId || current.chromeProfileStableId || chromeProfileStableId({ ...current, ...meta, ...patch }),
    socketId: patch.socketId ?? meta.id ?? current.socketId ?? null,
    status: patch.status || current.status || "offline",
    connected: patch.connected ?? current.connected ?? false,
    firstSeen: current.firstSeen || patch.firstSeen || new Date().toISOString(),
    lastSeen: patch.lastSeen || meta.lastSeen || new Date().toISOString(),
    lastMessage: patch.lastMessage || meta.lastMessage || current.lastMessage || "",
  };
  profiles[installId] = next;
  writeExtensionProfiles(profiles);
  return next;
}

function extensionProfilesSnapshot() {
  const profiles = readExtensionProfiles();
  const liveByInstallId = new Map();
  for (const socket of extensionSocketCandidates()) {
    const meta = extensionSocketMeta.get(socket) || {};
    if (meta.installId) liveByInstallId.set(meta.installId, meta);
  }
  return Object.values(profiles).map((profile) => {
    const live = liveByInstallId.get(profile.installId);
    if (!live) return { ...profile, status: "offline", connected: false };
    return {
      ...profile,
      socketId: live.id,
      version: live.version || profile.version || "",
      profileLabel: realExtensionProfileLabel(live.profileLabel || profile.profileLabel, profile.installId),
      status: "online",
      connected: true,
      lastSeen: live.lastSeen || profile.lastSeen,
    };
  });
}

function readTikTokAccountProfileCache() {
  try {
    let parsed = JSON.parse(fs.readFileSync(TIKTOK_ACCOUNT_PROFILE_FILE, "utf8"));
    const rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const accounts = dedupeTikTokAccountsByIdentity(rawAccounts);
    // One TikTok login can be captured by more than one historical extension
    // install/profile. Migrate those rows so duplicates stay gone after restart.
    if (accounts.length !== rawAccounts.length) {
      parsed = { ...parsed, accounts, updatedAt: new Date().toISOString() };
      fs.writeFileSync(TIKTOK_ACCOUNT_PROFILE_FILE, JSON.stringify(parsed, null, 2), "utf8");
    }
    return {
      ok: true,
      cached: true,
      scannedAt: parsed.scannedAt || parsed.updatedAt || "",
      updatedAt: parsed.updatedAt || parsed.scannedAt || "",
      accounts,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      profileCount: Number(parsed.profileCount || parsed.profiles?.length || 0) || 0,
    };
  } catch {
    return {
      ok: true,
      cached: true,
      scannedAt: "",
      updatedAt: "",
      accounts: [],
      profiles: [],
      profileCount: 0,
    };
  }
}

function tiktokAccountProfileSignature(payload = {}) {
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  return JSON.stringify({
    accounts: accounts.map((account) => ({
      id: account.id || "",
      secUid: account.secUid || "",
      uniqueId: account.uniqueId || "",
      nickname: account.nickname || "",
      avatar: account.avatar || account.avatarThumb || "",
      installId: account.installId || account.chromeProfileId || "",
      chromeProfileLabel: account.chromeProfileLabel || "",
      chromeProfileStableId: chromeProfileStableId(account),
      userDataDir: account.userDataDir || "",
      profileDirectory: account.profileDirectory || "",
      sessionCapturedAt: account.session?.capturedAt || "",
      cookieNames: Array.isArray(account.session?.cookieNames) ? account.session.cookieNames.join(",") : "",
    })).sort((a, b) => `${a.installId}:${a.uniqueId}:${a.secUid}`.localeCompare(`${b.installId}:${b.uniqueId}:${b.secUid}`)),
    profiles: profiles.map((profile) => ({
      installId: profile.installId || "",
      profileLabel: profile.profileLabel || profile.chromeProfileLabel || "",
      chromeProfileStableId: chromeProfileStableId(profile),
      userDataDir: profile.userDataDir || "",
      profileDirectory: profile.profileDirectory || "",
      count: Number(profile.count || 0) || 0,
      sessionCapturedAt: profile.session?.capturedAt || "",
      cookieNames: Array.isArray(profile.session?.cookieNames) ? profile.session.cookieNames.join(",") : "",
    })).sort((a, b) => `${a.installId}:${a.profileLabel}`.localeCompare(`${b.installId}:${b.profileLabel}`)),
  });
}

function tiktokAccountCacheKey(account = {}) {
  const rawChromeProfileId = String(account.chromeProfileId || "").trim();
  const installId = String(account.installId || (/^\d+$/.test(rawChromeProfileId) ? "" : rawChromeProfileId)).trim();
  const stableId = chromeProfileStableId(account);
  const socketId = String(account.profileSocketId || account.socketId || "").trim();
  const userDataDir = String(account.userDataDir || "").trim();
  const profileDirectory = String(account.profileDirectory || account.chromeProfileDirectory || "").trim();
  const profileKey = installId || stableId || (userDataDir && profileDirectory ? `${userDataDir}\\${profileDirectory}` : "") || rawChromeProfileId || socketId;
  if (profileKey) return `profile:${profileKey}`;
  const secUid = String(account.secUid || "").trim();
  const uniqueId = String(account.uniqueId || account.username || "").replace(/^@/, "").trim().toLowerCase();
  const id = String(account.id || "").trim();
  const identity = secUid || uniqueId || id;
  if (identity) return `account:${identity}`;
  return "profile:unknown";
}

function tiktokAccountIdentityKey(account = {}) {
  const secUid = String(account.secUid || account.sec_uid || "").trim();
  if (secUid) return `sec:${secUid}`;
  const uniqueId = String(account.uniqueId || account.username || "").replace(/^@/, "").trim().toLowerCase();
  if (uniqueId) return `user:${uniqueId}`;
  const id = String(account.id || account.userId || account.uid || "").trim();
  return id ? `id:${id}` : "";
}

function dedupeTikTokAccountsByIdentity(accounts = []) {
  const unique = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const key = tiktokAccountIdentityKey(account) || tiktokAccountCacheKey(account);
    if (!key) continue;
    unique.set(key, mergeTikTokAccountRecord(unique.get(key) || {}, account));
  }
  return [...unique.values()];
}

function tiktokAccountProfileScore(account = {}) {
  let score = 0;
  if (account.userDataDir && (account.profileDirectory || account.chromeProfileDirectory)) score += 100;
  if (chromeProfileStableId(account)) score += 90;
  if (account.profileDir) score += 20;
  if (account.installId && !/^\d+$/.test(String(account.installId))) score += 30;
  if (account.avatar || account.avatarThumb || account.avatarMedium) score += 10;
  if (account.nickname && account.uniqueId && String(account.nickname) !== String(account.uniqueId)) score += 8;
  if (account.followerCount || account.videoCount) score += 4;
  if (account.socketId || account.profileSocketId) score += 2;
  return score;
}

function sanitizeTikTokSessionSnapshot(session = null) {
  if (!session || typeof session !== "object") return null;
  const cookies = Array.isArray(session.cookies) ? session.cookies
    .map((cookie) => ({
      name: String(cookie.name || ""),
      value: String(cookie.value || ""),
      domain: String(cookie.domain || ""),
      path: String(cookie.path || "/"),
      expirationDate: cookie.expirationDate || null,
      httpOnly: !!cookie.httpOnly,
      secure: !!cookie.secure,
      sameSite: cookie.sameSite || "",
    }))
    .filter((cookie) => cookie.name && cookie.value) : [];
  const tokens = session.tokens && typeof session.tokens === "object"
    ? Object.fromEntries(Object.entries(session.tokens)
      .map(([key, value]) => [String(key), String(value || "")])
      .filter(([, value]) => value))
    : {};
  const cookieNames = Array.isArray(session.cookieNames) && session.cookieNames.length
    ? session.cookieNames.map((name) => String(name || "")).filter(Boolean)
    : cookies.map((cookie) => cookie.name);
  return {
    provider: "tiktok",
    capturedAt: session.capturedAt || new Date().toISOString(),
    cookieCount: Number(session.cookieCount || cookies.length || 0),
    cookieNames,
    hasAuthCookie: !!session.hasAuthCookie || cookies.some((cookie) => /^(sessionid|sessionid_ss|sid_tt)$/i.test(cookie.name)),
    cookies,
    tokens,
  };
}

function tiktokSessionSummary(session = null) {
  const clean = sanitizeTikTokSessionSnapshot(session);
  if (!clean) return null;
  return {
    provider: "tiktok",
    capturedAt: clean.capturedAt,
    cookieCount: clean.cookieCount,
    cookieNames: clean.cookieNames,
    hasAuthCookie: clean.hasAuthCookie,
    tokenNames: Object.keys(clean.tokens || {}),
  };
}

function tiktokCookieHeaderFromSession(session = null) {
  const clean = sanitizeTikTokSessionSnapshot(session);
  if (!clean?.cookies?.length) return "";
  const pairs = new Map();
  for (const cookie of clean.cookies) {
    const name = String(cookie.name || "").trim();
    const value = String(cookie.value || "").trim();
    if (name && value) pairs.set(name, value);
  }
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function tiktokSessionAuthStatus(session = null) {
  const clean = sanitizeTikTokSessionSnapshot(session);
  const nowSeconds = Date.now() / 1000;
  const authCookies = (clean?.cookies || []).filter((cookie) => /^(sessionid|sessionid_ss|sid_tt)$/i.test(cookie.name));
  if (!clean?.cookies?.length) return { ok: false, reason: "missing", message: "ยังไม่มี cookie TikTok ใน Channel นี้ กดสแกนหา Account หรือ refresh channel ก่อนดึงสินค้า" };
  if (!authCookies.length) return { ok: false, reason: "missing-auth", message: "ไม่พบ auth cookie ของ TikTok ใน Channel นี้ กด refresh channel เพื่อเก็บ cookie ใหม่" };
  const expired = authCookies.every((cookie) => cookie.expirationDate && Number(cookie.expirationDate) <= nowSeconds);
  if (expired) return { ok: false, reason: "expired", message: "Cookie TikTok หมดอายุแล้ว กด refresh channel นี้ก่อนดึง Showcase" };
  return { ok: true, reason: "ok", message: "cookie usable" };
}

function normalizeTikTokShowcaseProduct(product = {}) {
  const cover = product.cover || {};
  const affiliate = product.affiliate_info || {};
  const commissionRateRaw = Number(affiliate.commission_rate || 0);
  return {
    id: String(product.product_id || product.id || ""),
    title: product.title || "",
    price: product.format_available_price || product.format_price || "",
    image: (Array.isArray(cover.url_list) && cover.url_list[0]) ||
      (Array.isArray(cover.thumb_url_list) && cover.thumb_url_list[0]) ||
      cover.url || "",
    stock: product.stock_num ?? null,
    shop: product.seller_info?.shop_name || product.shop_name || "",
    canAdd: product.can_added !== false,
    commission: affiliate.commission_with_currency || "-",
    commissionRate: Number.isFinite(commissionRateRaw) && commissionRateRaw > 0 ? commissionRateRaw / 100 : "-",
    rawStatus: {
      stockStatus: product.stock_status ?? null,
      reviewStatus: product.review_status ?? null,
    },
  };
}

async function fetchTikTokShowcasePageFromSession(session, offset, count) {
  const clean = sanitizeTikTokSessionSnapshot(session);
  const cookie = tiktokCookieHeaderFromSession(clean);
  const url = `https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list?count=${encodeURIComponent(count)}&offset=${encodeURIComponent(offset)}&origin=2`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "th-TH,th;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        referer: "https://shop.tiktok.com/streamer/showcase/product/list",
        "x-tt-store-region": "th",
        cookie,
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 1000) };
    }
    return { ok: response.ok, status: response.status, url, body };
  } finally {
    clearTimeout(timer);
  }
}

async function pullTikTokShowcaseFromCachedChannel(accountRef = {}) {
  const cached = findCachedTikTokAccountProfile(accountRef || {});
  const session = sanitizeTikTokSessionSnapshot(accountRef?.session || cached.session);
  const label = accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || accountRef?.uniqueId || "Channel";
  const auth = tiktokSessionAuthStatus(session);
  if (!auth.ok) {
    const error = new Error(auth.message);
    error.code = "TIKTOK_COOKIE_EXPIRED";
    throw error;
  }

  addBackendLog("info", "tiktok-showcase", "Pulling Showcase by cached Channel cookie", {
    channel: label,
    cookieCount: session.cookieCount,
    cookieNames: session.cookieNames,
  });

  const MAX_PAGES = 600;
  const MAX_DISPLAY = 2000;
  const MAX_429_RETRIES = 2;
  const started = Date.now();
  const deadlineMs = 150000;
  const seen = new Set();
  const products = [];
  let count = 20;
  let offset = 0;
  let pages = 0;
  let available = 0;
  let outOfStock = 0;
  let partial = false;
  let retries = 0;

  while (pages < MAX_PAGES) {
    if (Date.now() - started > deadlineMs) {
      partial = true;
      break;
    }

    const page = await fetchTikTokShowcasePageFromSession(session, offset, count);
    if (!page.ok) {
      if (page.status === 429 && retries < MAX_429_RETRIES) {
        retries += 1;
        await sleep(1000 * retries);
        continue;
      }
      if ([401, 403].includes(page.status)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว (HTTP ${page.status}) กด refresh channel นี้ก่อนดึง Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      if (!seen.size) throw new Error(`TikTok Showcase API HTTP ${page.status}`);
      partial = true;
      break;
    }

    const code = Number(page.body?.code ?? page.body?.status_code ?? 0);
    if (code !== 0) {
      const message = page.body?.message || page.body?.status_msg || `TikTok Showcase API code ${code}`;
      if (/login|auth|cookie|permission|forbidden|expire/i.test(message) || [401, 403].includes(code)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว: ${message} กด refresh channel นี้ก่อนดึง Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      if (!seen.size) throw new Error(message);
      partial = true;
      break;
    }

    const list = page.body?.data?.products || [];
    if (!Array.isArray(list) || !list.length) break;
    pages += 1;
    retries = 0;
    let added = 0;
    for (const row of list) {
      const id = String(row?.product_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      added += 1;
      const isActive = row?.stock_status === 1 && row?.review_status === 1;
      if (!isActive) {
        outOfStock += 1;
        continue;
      }
      available += 1;
      if (products.length < MAX_DISPLAY) products.push(normalizeTikTokShowcaseProduct(row));
    }
    addBackendLog("info", "tiktok-showcase", "Showcase page loaded from cached cookie", {
      channel: label,
      page: pages,
      scanned: seen.size,
      available,
      offset,
    });
    if (!added) break;
    offset += list.length;
    await sleep(120);
  }

  if (pages >= MAX_PAGES) partial = true;
  return {
    ok: true,
    via: "channel-cache",
    source: "shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list",
    channel: {
      uniqueId: accountRef?.uniqueId || cached.account?.uniqueId || "",
      chromeProfileLabel: accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || cached.profile?.profileLabel || "",
    },
    total: seen.size,
    available,
    outOfStock,
    pages,
    products,
    ...(partial ? { partial: true } : {}),
  };
}

function buildTikTokProductLinkCheckUrl() {
  const params = new URLSearchParams({
    user_language: "th-TH",
    locale: "th-TH",
    aid: "253642",
    app_name: "i18n_ecom_alliance",
    device_id: "0",
    device_platform: "web",
    cookie_enabled: "true",
    screen_width: "1366",
    screen_height: "768",
    browser_language: "th-TH",
    browser_platform: "Win32",
    browser_name: "Mozilla",
    browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    browser_online: "true",
    timezone_name: "Asia/Bangkok",
    page_scene: "0",
    carrier_region: "th",
  });
  return `https://shop.tiktok.com/api/v1/streamer_desktop/product_link/check?${params.toString()}`;
}


function buildTikTokShowcaseAddUrl() {
  const params = new URLSearchParams({
    user_language: "th-TH",
    locale: "th-TH",
    aid: "253642",
    app_name: "i18n_ecom_alliance",
    device_id: "0",
    device_platform: "web",
    cookie_enabled: "true",
    screen_width: "1366",
    screen_height: "768",
    browser_language: "th-TH",
    browser_platform: "Win32",
    browser_name: "Mozilla",
    browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    browser_online: "true",
    timezone_name: "Asia/Bangkok",
    page_scene: "0",
    carrier_region: "th",
  });
  return `https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/add?${params.toString()}`;
}

function buildTikTokShowcaseDeleteUrl() {
  const params = new URLSearchParams({
    user_language: "th-TH",
    locale: "th-TH",
    aid: "253642",
    app_name: "i18n_ecom_alliance",
    device_id: "0",
    device_platform: "web",
    cookie_enabled: "true",
    screen_width: "1366",
    screen_height: "768",
    browser_language: "th-TH",
    browser_platform: "Win32",
    browser_name: "Mozilla",
    browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    browser_online: "true",
    timezone_name: "Asia/Bangkok",
    page_scene: "0",
    carrier_region: "th",
  });
  return `https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/delete?${params.toString()}`;
}


async function addTikTokShowcaseProductsFromCachedChannel(accountRef = {}, productIds = [], mainPlanId = "") {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
  if (!ids.length) throw new Error("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");

  const cached = findCachedTikTokAccountProfile(accountRef || {});
  const session = sanitizeTikTokSessionSnapshot(accountRef?.session || cached.session);
  const label = accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || accountRef?.uniqueId || "Channel";
  const auth = tiktokSessionAuthStatus(session);
  if (!auth.ok) {
    const error = new Error(auth.message);
    error.code = "TIKTOK_COOKIE_EXPIRED";
    throw error;
  }

  const planId = String(mainPlanId || accountRef?.mainPlanId || cached.account?.mainPlanId || "115029389253");
  const cookie = tiktokCookieHeaderFromSession(session);
  const payload = {
    product_info: ids.map((id) => ({
      product_id: id,
      source_from: 2,
      main_plan_id: planId,
      isv_id: "",
    })),
  };

  addBackendLog("info", "tiktok-showcase", "Adding products to Showcase by cached Channel cookie", {
    channel: label,
    count: ids.length,
    productIds: ids,
    mainPlanId: planId,
    cookieCount: session.cookieCount,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(buildTikTokShowcaseAddUrl(), {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "th-TH,th;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        referer: "https://shop.tiktok.com/streamer/showcase/product/list",
        "x-tt-store-region": "th",
        cookie,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 1000) };
    }

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว (HTTP ${response.status}) กด refresh channel นี้ก่อนเพิ่มสินค้า Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(`TikTok showcase_product/add HTTP ${response.status}`);
    }

    const code = Number(body?.code ?? body?.status_code ?? 0);
    if (code !== 0) {
      const message = body?.message || body?.status_msg || `TikTok showcase_product/add code ${code}`;
      if (/login|auth|cookie|permission|forbidden|expire/i.test(message) || [401, 403].includes(code)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว: ${message} กด refresh channel นี้ก่อนเพิ่มสินค้า Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(message);
    }

    return {
      ok: true,
      via: "channel-cache",
      source: "shop.tiktok.com/api/v1/streamer_desktop/showcase_product/add",
      total: ids.length,
      productIds: ids,
      mainPlanId: planId,
      raw: body,
      channel: {
        uniqueId: accountRef?.uniqueId || cached.account?.uniqueId || "",
        chromeProfileLabel: accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || cached.profile?.profileLabel || "",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deleteTikTokShowcaseProductsFromCachedChannel(accountRef = {}, productIds = []) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
  if (!ids.length) throw new Error("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");

  const cached = findCachedTikTokAccountProfile(accountRef || {});
  const session = sanitizeTikTokSessionSnapshot(accountRef?.session || cached.session);
  const label = accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || accountRef?.uniqueId || "Channel";
  const auth = tiktokSessionAuthStatus(session);
  if (!auth.ok) {
    const error = new Error(auth.message);
    error.code = "TIKTOK_COOKIE_EXPIRED";
    throw error;
  }

  addBackendLog("info", "tiktok-showcase", "Deleting products from Showcase by cached Channel cookie", {
    channel: label,
    count: ids.length,
    productIds: ids,
    cookieCount: session.cookieCount,
  });

  const cookie = tiktokCookieHeaderFromSession(session);
  const payload = {
    product_info: ids.map((id) => ({
      product_id: id,
      source_from: 2,
    })),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(buildTikTokShowcaseDeleteUrl(), {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "th-TH,th;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        referer: "https://shop.tiktok.com/streamer/showcase/product/list",
        "x-tt-store-region": "th",
        cookie,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 1000) };
    }

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว (HTTP ${response.status}) กด refresh channel นี้ก่อนลบสินค้า Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(`TikTok showcase_product/delete HTTP ${response.status}`);
    }

    const code = Number(body?.code ?? body?.status_code ?? 0);
    if (code !== 0) {
      const message = body?.message || body?.status_msg || `TikTok showcase_product/delete code ${code}`;
      if (/login|auth|cookie|permission|forbidden|expire/i.test(message) || [401, 403].includes(code)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว: ${message} กด refresh channel นี้ก่อนลบสินค้า Showcase`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(message);
    }

    return {
      ok: true,
      via: "channel-cache",
      source: "shop.tiktok.com/api/v1/streamer_desktop/showcase_product/delete",
      total: ids.length,
      productIds: ids,
      raw: body,
      channel: {
        uniqueId: accountRef?.uniqueId || cached.account?.uniqueId || "",
        chromeProfileLabel: accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || cached.profile?.profileLabel || "",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkTikTokProductLinksFromCachedChannel(accountRef = {}, urls = []) {
  const cleanUrls = [...new Set((Array.isArray(urls) ? urls : [])
    .map((url) => String(url || "").trim())
    .filter(Boolean))];
  if (!cleanUrls.length) throw new Error("กรุณาใส่ลิงก์สินค้าอย่างน้อย 1 ลิงก์");

  const cached = findCachedTikTokAccountProfile(accountRef || {});
  const session = sanitizeTikTokSessionSnapshot(accountRef?.session || cached.session);
  const label = accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || accountRef?.uniqueId || "Channel";
  const auth = tiktokSessionAuthStatus(session);
  if (!auth.ok) {
    const error = new Error(auth.message);
    error.code = "TIKTOK_COOKIE_EXPIRED";
    throw error;
  }

  addBackendLog("info", "tiktok-links", "Checking TikTok product links by cached Channel cookie", {
    channel: label,
    count: cleanUrls.length,
    cookieCount: session.cookieCount,
  });

  const cookie = tiktokCookieHeaderFromSession(session);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(buildTikTokProductLinkCheckUrl(), {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "th-TH,th;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        referer: "https://shop.tiktok.com/streamer/showcase/product/list",
        "x-tt-store-region": "th",
        cookie,
      },
      body: JSON.stringify({ origin: 2, urls: cleanUrls }),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 1000) };
    }

    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว (HTTP ${response.status}) กด refresh channel นี้ก่อนดึงสินค้าจากลิงก์`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(`TikTok product_link/check HTTP ${response.status}`);
    }

    const code = Number(body?.code ?? body?.status_code ?? 0);
    if (code !== 0) {
      const message = body?.message || body?.status_msg || `TikTok product_link/check code ${code}`;
      if (/login|auth|cookie|permission|forbidden|expire/i.test(message) || [401, 403].includes(code)) {
        const error = new Error(`Cookie TikTok ใช้ไม่ได้หรือหมดอายุแล้ว: ${message} กด refresh channel นี้ก่อนดึงสินค้าจากลิงก์`);
        error.code = "TIKTOK_COOKIE_EXPIRED";
        throw error;
      }
      throw new Error(message);
    }

    return {
      ok: true,
      via: "channel-cache",
      source: "shop.tiktok.com/api/v1/streamer_desktop/product_link/check",
      channel: {
        uniqueId: accountRef?.uniqueId || cached.account?.uniqueId || "",
        chromeProfileLabel: accountRef?.chromeProfileLabel || cached.account?.chromeProfileLabel || cached.profile?.profileLabel || "",
      },
      data: body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTikTokAvatarUrl(value = "") {
  let url = String(value || "").trim();
  if (!url) return "";
  url = url.replace(/\\u0026/gi, "&").replace(/\u0026/gi, "&");
  url = url.replace(/^http:\/\//i, "https://");
  try {
    const parsed = new URL(url);
    if (/tiktokcdn\.com$/i.test(parsed.hostname) && parsed.searchParams.get("idc") === "my3") {
      parsed.searchParams.set("idc", "my2");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchTikTokJsonFromSession(url, session, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 12000));
  const cookie = tiktokCookieHeaderFromSession(session);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "th-TH,th;q=0.9,en;q=0.8",
        "user-agent": options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        referer: options.referer || "https://www.tiktok.com/",
        ...(cookie ? { cookie } : {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 1000) };
    }
    return { ok: response.ok, status: response.status, url, body };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTikTokAccountFromUserRecord(user = {}, stats = {}, fallbackUniqueId = "") {
  const uniqueId = String(
    user.uniqueId ||
    user.unique_id ||
    user.username ||
    user.user_name ||
    user.shareQrcodeUri?.match?.(/@([^/?]+)/)?.[1] ||
    fallbackUniqueId ||
    ""
  ).replace(/^@/, "").trim();
  if (!uniqueId) return null;
  const nickname = String(user.nickname || user.nickName || user.screen_name || user.name || uniqueId).trim();
  const avatar = normalizeTikTokAvatarUrl(
    user.avatarMedium ||
    user.avatarLarger ||
    user.avatarThumb ||
    user.avatar_url ||
    user.avatarUrl ||
    user.avatar ||
    ""
  );
  return {
    id: String(user.id || user.user_id || user.uid || uniqueId),
    uniqueId,
    nickname: nickname || uniqueId,
    avatar,
    avatarThumb: normalizeTikTokAvatarUrl(user.avatarThumb || user.avatarMedium || user.avatar_url || avatar || ""),
    avatarMedium: normalizeTikTokAvatarUrl(user.avatarMedium || avatar || ""),
    avatarLarger: normalizeTikTokAvatarUrl(user.avatarLarger || avatar || ""),
    secUid: String(user.secUid || user.sec_uid || ""),
    followerCount: String(stats.followerCount || stats.follower_count || ""),
    followingCount: String(stats.followingCount || stats.following_count || ""),
    heartCount: String(stats.heartCount || stats.heart || stats.heart_count || ""),
    videoCount: String(stats.videoCount || stats.video_count || ""),
  };
}

function normalizeTikTokAccountFromApiBody(body = {}, fallbackUniqueId = "") {
  const info = body.userInfo || body.user_info || body.data?.userInfo || body.data?.user_info || body.data || body;
  const user = info.user || info.user_info || info;
  const stats = info.statsV2 || info.stats || user.statsV2 || user.stats || {};
  return normalizeTikTokAccountFromUserRecord(user, stats, fallbackUniqueId);
}

function normalizeTikTokAccountFromUserInfoBody(body = {}, fallbackUniqueId = "") {
  const info = body?.userInfo || body?.user_info || body?.data?.userInfo || body?.data?.user_info || null;
  if (!info?.user && !info?.user_info) return null;
  return normalizeTikTokAccountFromUserRecord(info.user || info.user_info, info.statsV2 || info.stats || {}, fallbackUniqueId);
}

function collectTikTokApiCandidates(value, candidates = []) {
  if (!value || typeof value !== "object") return candidates;
  if (Array.isArray(value)) {
    for (const item of value) collectTikTokApiCandidates(item, candidates);
    return candidates;
  }
  const account = normalizeTikTokAccountFromApiBody(value);
  if (account) candidates.push(account);
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") collectTikTokApiCandidates(item, candidates);
  }
  return candidates;
}

function tiktokApiAccountScore(account = {}) {
  let score = 0;
  if (account.uniqueId) score += 10;
  if (account.secUid) score += 4;
  if (account.avatar || account.avatarThumb) score += 4;
  if (account.nickname && account.nickname !== account.uniqueId) score += 3;
  if (account.followerCount || account.videoCount) score += 2;
  return score;
}

function bestTikTokAccountFromApiBody(body = {}, fallbackUniqueId = "") {
  const direct = normalizeTikTokAccountFromApiBody(body, fallbackUniqueId);
  const candidates = collectTikTokApiCandidates(body);
  if (direct) candidates.push(direct);
  candidates.sort((a, b) => tiktokApiAccountScore(b) - tiktokApiAccountScore(a));
  return candidates[0] || null;
}

function findTikTokStoryAccount(body = {}, uniqueId = "") {
  const id = String(uniqueId || "").replace(/^@/, "").trim().toLowerCase();
  if (!id) return null;
  const rows = Array.isArray(body.storyUsers) ? body.storyUsers
    : Array.isArray(body.data?.storyUsers) ? body.data.storyUsers
      : Array.isArray(body.userList) ? body.userList
        : Array.isArray(body.data?.userList) ? body.data.userList
          : [];
  for (const row of rows) {
    const user = row?.user || row?.user_info || row;
    const rowUniqueId = String(user?.uniqueId || user?.unique_id || user?.username || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
    if (rowUniqueId !== id) continue;
    return normalizeTikTokAccountFromUserRecord(user, row.statsV2 || row.stats || user.statsV2 || user.stats || {}, uniqueId);
  }
  return null;
}

async function fetchTikTokUserDetailByUniqueId(uniqueId, session = null) {
  const id = String(uniqueId || "").replace(/^@/, "").trim();
  if (!id) return null;
  const clean = sanitizeTikTokSessionSnapshot(session);
  const msToken = clean?.tokens?.msToken || clean?.cookies?.find((cookie) => cookie.name === "msToken")?.value || "";
  const params = new URLSearchParams({
    aid: "1988",
    app_language: "th-TH",
    app_name: "tiktok_web",
    browser_language: "th-TH",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "Win32",
    browser_version: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    device_platform: "web_pc",
    focus_state: "true",
    from_page: "user",
    history_len: "1",
    is_fullscreen: "false",
    is_page_visible: "true",
    language: "th-TH",
    os: "windows",
    priority_region: "TH",
    referer: `https://www.tiktok.com/@${id}`,
    region: "TH",
    root_referer: "https://www.tiktok.com/",
    screen_height: "768",
    screen_width: "1366",
    tz_name: "Asia/Bangkok",
    uniqueId: id,
    user_is_login: "true",
    webcast_language: "th-TH",
  });
  if (msToken) params.set("msToken", msToken);
  const url = `https://www.tiktok.com/api/user/detail/?${params.toString()}`;
  const result = await fetchTikTokJsonFromSession(url, session, {
    referer: `https://www.tiktok.com/@${id}`,
  });
  const statusCode = Number(result.body?.statusCode ?? result.body?.status_code ?? result.body?.code ?? 0);
  if (!result.ok || statusCode !== 0) {
    addBackendLog("warn", "tiktok-account", "TikTok user detail API did not return a usable profile", {
      uniqueId: id,
      status: result.status,
      statusCode,
      message: result.body?.status_msg || result.body?.message || "",
    });
    return null;
  }
  return normalizeTikTokAccountFromUserInfoBody(result.body, id) || bestTikTokAccountFromApiBody(result.body, id);
}

async function fetchTikTokStoryAccountByUniqueId(uniqueId, session = null) {
  const id = String(uniqueId || "").replace(/^@/, "").trim();
  if (!id) return null;
  const clean = sanitizeTikTokSessionSnapshot(session);
  const msToken = clean?.tokens?.msToken || clean?.cookies?.find((cookie) => cookie.name === "msToken")?.value || "";
  const odinId = clean?.tokens?.odin_tt ||
    clean?.cookies?.find((cookie) => cookie.name === "odin_tt")?.value ||
    clean?.cookies?.find((cookie) => cookie.name === "uid_tt")?.value ||
    "";
  const params = new URLSearchParams({
    aid: "1988",
    app_language: "th-TH",
    app_name: "tiktok_web",
    browser_language: "th",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "Win32",
    browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    count: "30",
    cursor: "0",
    data_collection_enabled: "true",
    device_platform: "web_pc",
    focus_state: "false",
    from_page: "user",
    history_len: "3",
    isNonPersonalized: "false",
    is_fullscreen: "false",
    is_page_visible: "true",
    os: "windows",
    priority_region: "TH",
    referer: "https://www.tiktok.com/",
    region: "TH",
    root_referer: "https://www.tiktok.com/",
    screen_height: "768",
    screen_width: "1366",
    storyFeedScene: "3",
    tz_name: "Asia/Bangkok",
    user_is_login: "true",
    webcast_language: "th-TH",
  });
  if (msToken) params.set("msToken", msToken);
  if (odinId) params.set("odinId", odinId);
  const url = `https://www.tiktok.com/api/story/user_list/?${params.toString()}`;
  const result = await fetchTikTokJsonFromSession(url, clean, {
    referer: `https://www.tiktok.com/@${id}`,
    timeoutMs: 15000,
  });
  const statusCode = Number(result.body?.statusCode ?? result.body?.status_code ?? result.body?.code ?? 0);
  if (!result.ok || statusCode !== 0) {
    addBackendLog("warn", "tiktok-account", "TikTok story user_list API did not return a usable list", {
      uniqueId: id,
      status: result.status,
      statusCode,
      message: result.body?.status_msg || result.body?.message || "",
    });
    return null;
  }
  const account = findTikTokStoryAccount(result.body, id);
  if (!account) {
    addBackendLog("warn", "tiktok-account", "TikTok story user_list did not contain selected uniqueId", {
      uniqueId: id,
      count: Array.isArray(result.body?.storyUsers) ? result.body.storyUsers.length : 0,
    });
  }
  return account;
}

async function fetchTikTokAccountFromSession(session = null, profile = {}) {
  const clean = sanitizeTikTokSessionSnapshot(session);
  if (!clean?.cookies?.length) return null;
  addBackendLog("info", "tiktok-account", "Loading TikTok account by cookie/token in server", {
    profile: profile.profileLabel || profile.chromeProfileLabel || "",
    cookieCount: clean.cookieCount,
    cookieNames: clean.cookieNames,
  });

  const infoParams = new URLSearchParams({
    aid: "1988",
    app_name: "tiktok_web",
    device_platform: "web_pc",
    language: "th-TH",
    region: "TH",
  });
  const infoUrl = `https://www.tiktok.com/passport/web/account/info/?${infoParams.toString()}`;
  let account = null;
  try {
    const info = await fetchTikTokJsonFromSession(infoUrl, clean);
    account = bestTikTokAccountFromApiBody(info.body);
    if (!account) {
      addBackendLog("warn", "tiktok-account", "TikTok account info API returned no uniqueId", {
        status: info.status,
        profile: profile.profileLabel || profile.chromeProfileLabel || "",
      });
    }
  } catch (error) {
    addBackendLog("warn", "tiktok-account", "TikTok account info API failed", {
      profile: profile.profileLabel || profile.chromeProfileLabel || "",
      error: String(error.message || error),
    });
  }

  if (account?.uniqueId) {
    const detail = await fetchTikTokUserDetailByUniqueId(account.uniqueId, clean).catch((error) => {
      addBackendLog("warn", "tiktok-account", "TikTok user detail refresh failed", {
        uniqueId: account.uniqueId,
        error: String(error.message || error),
      });
      return null;
    });
    if (detail) account = mergeTikTokAccountRecord(account, detail);
  }
  if (account?.uniqueId) {
    const storyAccount = await fetchTikTokStoryAccountByUniqueId(account.uniqueId, clean).catch((error) => {
      addBackendLog("warn", "tiktok-account", "TikTok story user_list refresh failed", {
        uniqueId: account.uniqueId,
        error: String(error.message || error),
      });
      return null;
    });
    if (storyAccount) {
      const merged = mergeTikTokAccountRecord(account, {
        ...storyAccount,
        sourceApi: "story-user-list",
      });
      account = {
        ...merged,
        nickname: storyAccount.nickname || merged.nickname,
        avatar: storyAccount.avatar || merged.avatar,
        avatarThumb: storyAccount.avatarThumb || merged.avatarThumb,
        avatarMedium: storyAccount.avatarMedium || merged.avatarMedium,
        avatarLarger: storyAccount.avatarLarger || merged.avatarLarger,
        followerCount: storyAccount.followerCount || merged.followerCount,
        followingCount: storyAccount.followingCount || merged.followingCount,
        heartCount: storyAccount.heartCount || merged.heartCount,
        videoCount: storyAccount.videoCount || merged.videoCount,
        sourceApi: "story-user-list",
      };
    }
  }
  if (!account) return null;
  return {
    ...account,
    provider: "tiktok",
    selectedLabel: `@${account.uniqueId}`,
    serverApi: "cookie-session",
  };
}

function mergeTikTokAccountRecord(current = {}, incoming = {}) {
  const preferredFirst = tiktokAccountProfileScore(incoming) >= tiktokAccountProfileScore(current);
  const primary = preferredFirst ? incoming : current;
  const secondary = preferredFirst ? current : incoming;
  const merged = { ...secondary, ...primary };
  for (const key of [
    "userDataDir",
    "profileDirectory",
    "profileDir",
    "profileStableId",
    "chromeProfileStableId",
    "installId",
    "chromeProfileId",
    "chromeProfileLabel",
    "socketId",
    "profileSocketId",
    "avatar",
    "avatarThumb",
    "followerCount",
    "followingCount",
    "heartCount",
    "videoCount",
    "nickname",
    "uniqueId",
    "secUid",
    "session",
    "sessionSummary",
  ]) {
    if (!merged[key] && (current[key] || incoming[key])) merged[key] = current[key] || incoming[key];
  }
  if (current.session || incoming.session) {
    merged.session = sanitizeTikTokSessionSnapshot(incoming.session || current.session);
    merged.sessionSummary = tiktokSessionSummary(merged.session);
  }
  return merged;
}

function refreshTikTokAccountCacheRecords(currentAccounts = [], nextAccounts = []) {
  const merged = new Map();
  for (const account of currentAccounts) {
    const key = tiktokAccountCacheKey(account);
    if (key) merged.set(key, account);
  }
  for (const account of nextAccounts) {
    const key = tiktokAccountCacheKey(account);
    if (!key) continue;
    merged.set(key, mergeTikTokAccountRecord(merged.get(key) || {}, account));
  }
  return dedupeTikTokAccountsByIdentity([...merged.values()]);
}

function tiktokProfileCacheKey(profile = {}) {
  const installId = String(profile.installId || "").trim();
  const stableId = chromeProfileStableId(profile);
  const userDataDir = String(profile.userDataDir || "").trim();
  const profileDirectory = String(profile.profileDirectory || "").trim();
  const socketId = String(profile.socketId || "").trim();
  const label = String(profile.profileLabel || profile.chromeProfileLabel || "").trim().toLowerCase();
  return installId ||
    stableId ||
    (userDataDir && profileDirectory ? `${userDataDir}\\${profileDirectory}` : "") ||
    socketId ||
    label ||
    `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mergeTikTokProfileRecord(current = {}, incoming = {}) {
  const merged = { ...current, ...incoming };
  if (current.session || incoming.session) {
    merged.session = sanitizeTikTokSessionSnapshot(incoming.session || current.session);
    merged.sessionSummary = tiktokSessionSummary(merged.session);
  }
  return merged;
}

function refreshTikTokProfileCacheRecords(currentProfiles = [], nextProfiles = []) {
  const merged = new Map();
  for (const profile of currentProfiles) {
    merged.set(tiktokProfileCacheKey(profile), profile);
  }
  for (const profile of nextProfiles) {
    const key = tiktokProfileCacheKey(profile);
    merged.set(key, mergeTikTokProfileRecord(merged.get(key) || {}, profile));
  }
  return [...merged.values()];
}

function cachedTikTokAccountProfilePayload() {
  const cache = readTikTokAccountProfileCache();
  const currentProfiles = extensionProfilesSnapshot();
  const profiles = cache.profiles.length ? cache.profiles.map((profile) => {
    const live = currentProfiles.find((item) => item.installId && item.installId === profile.installId);
    return live ? { ...profile, ...live, count: profile.count ?? live.count ?? 0 } : { ...profile, connected: false, status: profile.status || "cached" };
  }) : currentProfiles;
  return {
    ...cache,
    ok: true,
    cached: true,
    accounts: cache.accounts,
    profiles,
    profileCount: profiles.length,
  };
}

function writeTikTokAccountProfileCache(payload = {}) {
  const now = new Date().toISOString();
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const current = readTikTokAccountProfileCache();
  const mergedAccounts = accounts.length
    ? refreshTikTokAccountCacheRecords(current.accounts, accounts)
    : current.accounts;
  const mergedProfiles = profiles.length
    ? refreshTikTokProfileCacheRecords(current.profiles, profiles)
    : current.profiles;
  const next = {
    ok: true,
    cached: true,
    scannedAt: payload.scannedAt || now,
    updatedAt: now,
    profileCount: mergedProfiles.length,
    accounts: mergedAccounts,
    profiles: mergedProfiles,
  };
  const changed = tiktokAccountProfileSignature(current) !== tiktokAccountProfileSignature(next);
  if (changed || !current.updatedAt) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(TIKTOK_ACCOUNT_PROFILE_FILE, JSON.stringify(next, null, 2), "utf8");
  }
  addBackendLog("info", "tiktok-account", changed ? "TikTok account profile cache updated" : "TikTok account profile cache unchanged", {
    accounts: mergedAccounts.length,
    scannedAccounts: accounts.length,
    profiles: profiles.length,
    scannedAt: next.scannedAt,
    changed,
  });
  return { ...(changed || !current.updatedAt ? next : current), changed };
}

function removeTikTokAccountProfileCache(target = {}) {
  const current = readTikTokAccountProfileCache();
  const targetKey = tiktokAccountCacheKey(target);
  const targetSecUid = String(target.secUid || "").trim();
  const targetUniqueId = String(target.uniqueId || target.username || "").replace(/^@/, "").trim().toLowerCase();
  const targetId = String(target.id || "").trim();
  const nextAccounts = current.accounts.filter((account) => {
    const accountKey = tiktokAccountCacheKey(account);
    const accountSecUid = String(account.secUid || "").trim();
    const accountUniqueId = String(account.uniqueId || account.username || "").replace(/^@/, "").trim().toLowerCase();
    const accountId = String(account.id || "").trim();
    const matched =
      (targetKey && accountKey === targetKey) ||
      (targetSecUid && accountSecUid === targetSecUid) ||
      (targetUniqueId && accountUniqueId === targetUniqueId) ||
      (targetId && accountId === targetId);
    return !matched;
  });
  const removed = current.accounts.length - nextAccounts.length;
  const next = {
    ...current,
    ok: true,
    cached: true,
    updatedAt: new Date().toISOString(),
    accounts: nextAccounts,
  };
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(TIKTOK_ACCOUNT_PROFILE_FILE, JSON.stringify(next, null, 2), "utf8");
  addBackendLog("info", "tiktok-account", "TikTok account removed from cache", {
    uniqueId: targetUniqueId || "",
    secUid: targetSecUid || "",
    removed,
    remaining: nextAccounts.length,
  });
  return { ...next, removed };
}

function buildTikTokAccountProfilePayload(profileResults = []) {
  const knownProfiles = extensionProfilesSnapshot();
  const accountMap = new Map();
  for (const profile of profileResults) {
    const profileAccounts = Array.isArray(profile.result?.accounts) ? profile.result.accounts : [];
    const profileSession = sanitizeTikTokSessionSnapshot(profile.result?.session || profile.session || null);
    for (const rawAccount of profileAccounts) {
      const chromeProfileLabel = profile.profileLabel || `Chrome #${profile.socketId}`;
      const account = {
        ...rawAccount,
        socketId: profile.socketId,
        profileSocketId: profile.socketId,
        installId: profile.installId || "",
        chromeProfileId: profile.installId || profile.chromeProfileStableId || profile.profileStableId || (profile.userDataDir && profile.profileDirectory ? chromeProfileStableId(profile) : String(profile.socketId)),
        chromeProfileLabel,
        profileStableId: chromeProfileStableId(profile),
        chromeProfileStableId: chromeProfileStableId(profile),
        userDataDir: profile.userDataDir || "",
        profileDirectory: profile.profileDirectory || "",
        profileDir: profile.profileDir || "",
        session: profileSession,
        sessionSummary: tiktokSessionSummary(profileSession),
        selectedLabel: `${rawAccount.nickname || rawAccount.uniqueId || "TikTok"} - ${chromeProfileLabel}`,
      };
      const key = tiktokAccountCacheKey(account);
      accountMap.set(key, mergeTikTokAccountRecord(accountMap.get(key) || {}, account));
    }
  }
  const accounts = dedupeTikTokAccountsByIdentity([...accountMap.values()]);
  const liveInstallIds = new Set(profileResults.map((profile) => profile.installId).filter(Boolean));
  const offlineProfiles = knownProfiles.filter((profile) =>
    !profile.connected && profile.installId && !liveInstallIds.has(profile.installId)
  );
  const responseProfiles = [
    ...profileResults.map((profile) => ({
      socketId: profile.socketId,
      installId: profile.installId || "",
      profileLabel: profile.profileLabel || (profile.socketId ? `Chrome #${profile.socketId}` : ""),
      profileStableId: chromeProfileStableId(profile),
      chromeProfileStableId: chromeProfileStableId(profile),
      userDataDir: profile.userDataDir || "",
      profileDirectory: profile.profileDirectory || "",
      profileDir: profile.profileDir || "",
      status: profile.status || "online",
      connected: true,
      ok: profile.ok,
      count: Array.isArray(profile.result?.accounts) ? profile.result.accounts.length : 0,
      error: profile.error || profile.result?.error || "",
      session: sanitizeTikTokSessionSnapshot(profile.result?.session || profile.session || null),
      sessionSummary: tiktokSessionSummary(profile.result?.session || profile.session || null),
    })),
    ...offlineProfiles,
  ];
  return {
    ok: true,
    cached: false,
    scannedAt: new Date().toISOString(),
    accounts,
    profileCount: responseProfiles.length,
    profiles: responseProfiles,
  };
}

function cachedTikTokAccountsForProfile(profile = {}) {
  const cache = readTikTokAccountProfileCache();
  const installId = String(profile.installId || "").trim();
  const stableId = chromeProfileStableId(profile);
  const userDataDir = String(profile.userDataDir || "").trim();
  const profileDirectory = String(profile.profileDirectory || "").trim();
  return cache.accounts.filter((account) => {
    return (installId && String(account.installId || "").trim() === installId) ||
      (stableId && chromeProfileStableId(account) === stableId) ||
      (userDataDir && profileDirectory &&
        String(account.userDataDir || "").trim() === userDataDir &&
        String(account.profileDirectory || account.chromeProfileDirectory || "").trim() === profileDirectory);
  });
}
function tiktokChromeProfileMatches(left = {}, right = {}) {
  const leftInstallId = String(left.installId || (left.chromeProfileId && !/^\d+$/.test(String(left.chromeProfileId)) ? left.chromeProfileId : "") || "").trim();
  const rightInstallId = String(right.installId || (right.chromeProfileId && !/^\d+$/.test(String(right.chromeProfileId)) ? right.chromeProfileId : "") || "").trim();
  if (leftInstallId && rightInstallId && leftInstallId === rightInstallId) return true;

  const leftStableId = chromeProfileStableId(left);
  const rightStableId = chromeProfileStableId(right);
  if (leftStableId && rightStableId && leftStableId === rightStableId) return true;

  const leftUserDataDir = String(left.userDataDir || "").trim();
  const rightUserDataDir = String(right.userDataDir || "").trim();
  const leftProfileDirectory = String(left.profileDirectory || left.chromeProfileDirectory || left.profileDir || "").trim();
  const rightProfileDirectory = String(right.profileDirectory || right.chromeProfileDirectory || right.profileDir || "").trim();
  if (leftUserDataDir && rightUserDataDir && leftProfileDirectory && rightProfileDirectory &&
    leftUserDataDir === rightUserDataDir && leftProfileDirectory === rightProfileDirectory) return true;

  const leftSocketId = String(left.profileSocketId || left.socketId || "").trim();
  const rightSocketId = String(right.profileSocketId || right.socketId || "").trim();
  if (leftSocketId && rightSocketId && leftSocketId === rightSocketId) return true;

  const leftProfileId = String(left.chromeProfileId || "").trim();
  const rightProfileId = String(right.chromeProfileId || "").trim();
  return !!(leftProfileId && rightProfileId && leftProfileId === rightProfileId);
}

function findCachedTikTokAccountProfile(profileRef = {}) {
  const cache = readTikTokAccountProfileCache();
  const targetAccountKey = tiktokAccountCacheKey(profileRef);
  const account = cache.accounts.find((item) =>
    tiktokChromeProfileMatches(item, profileRef) ||
    (targetAccountKey && targetAccountKey !== "profile:unknown" && tiktokAccountCacheKey(item) === targetAccountKey)
  ) || null;
  const profile = cache.profiles.find((item) => tiktokChromeProfileMatches(item, profileRef)) ||
    (account ? cache.profiles.find((item) => tiktokChromeProfileMatches(item, account)) : null) || null;
  const session = sanitizeTikTokSessionSnapshot(account?.session || profile?.session || null);
  return { account, profile, session };
}

async function refreshTikTokSingleProfileFromCachedSession(profileRef = {}) {
  const cached = findCachedTikTokAccountProfile(profileRef);
  if (!cached.session) return null;
  const profileHint = {
    ...(cached.profile || {}),
    ...(cached.account || {}),
    ...profileRef,
  };
  const account = await fetchTikTokAccountFromSession(cached.session, profileHint).catch((error) => {
    addBackendLog("warn", "tiktok-account", "Cached TikTok cookie/token refresh failed; manual channel refresh is required", {
      profile: profileHint.profileLabel || profileHint.chromeProfileLabel || "",
      uniqueId: profileHint.uniqueId || "",
      error: String(error.message || error),
    });
    return null;
  });
  if (!account?.uniqueId) return null;
  const profile = {
    ...(cached.profile || {}),
    ...profileRef,
    ok: true,
    status: cached.profile?.connected ? "online" : "cached",
    connected: !!cached.profile?.connected,
    result: {
      ok: true,
      accounts: [mergeTikTokAccountRecord(cached.account || {}, account)],
      session: cached.session,
      serverAccountFetch: true,
    },
  };
  const payload = buildTikTokAccountProfilePayload([profile]);
  const cache = writeTikTokAccountProfileCache(payload);
  addBackendLog("info", "tiktok-account", "TikTok account refreshed from cached cookie/token without opening Chrome", {
    uniqueId: account.uniqueId,
    profile: profile.profileLabel || profile.chromeProfileLabel || "",
  });
  return {
    ...payload,
    accounts: payload.accounts,
    profiles: cache.profiles,
    profileCount: cache.profileCount,
    live: false,
    cacheOnly: true,
    singleProfile: true,
    cacheChanged: cache.changed,
  };
}

async function enrichTikTokProfileResultsWithServerApi(profileResults = []) {
  const enriched = [];
  for (const profile of profileResults) {
    const result = profile.result && typeof profile.result === "object" ? { ...profile.result } : {};
    const session = sanitizeTikTokSessionSnapshot(result.session || profile.session || null);
    let accounts = Array.isArray(result.accounts) ? result.accounts.filter(Boolean) : [];

    if (session) {
      const apiAccount = await fetchTikTokAccountFromSession(session, profile).catch((error) => {
        addBackendLog("warn", "tiktok-account", "Server-side TikTok API account fetch failed", {
          profile: profile.profileLabel || profile.chromeProfileLabel || "",
          error: String(error.message || error),
        });
        return null;
      });
      if (apiAccount) {
        accounts = [apiAccount, ...accounts.filter((account) =>
          normalizeTikTokUniqueId(account.uniqueId || account.username) !== normalizeTikTokUniqueId(apiAccount.uniqueId)
        )];
      }
    }

    if (!accounts.length) {
      accounts = cachedTikTokAccountsForProfile(profile);
    }

    enriched.push({
      ...profile,
      result: {
        ...result,
        ok: result.ok !== false,
        accounts,
        session,
        serverAccountFetch: true,
      },
    });
  }
  return enriched;
}

let tiktokAccountRefreshPromise = null;

async function scanTikTokAccountProfiles({ wake = true } = {}) {
  let wakeInfo = null;
  let mainWakeInfo = null;
  if (wake) {
    addBackendLog("info", "tiktok-account", "กำลังสแกนหาร้านค้า: เปิด Chrome เพื่อเก็บ cookie/token");
    try {
      mainWakeInfo = await wakeMainExtensionForChannelScan();
    } catch (error) {
      addBackendLog("warn", "tiktok-account", "ปลุก Main Extension ไม่สำเร็จระหว่างสแกน Channel", {
        error: String(error.message || error),
      });
    }
    wakeInfo = await wakeChromeProfilesForTikTokAccounts();
  }
  const liveTikTokSockets = extensionSocketCandidates(EXTENSION_ROLE_TIKTOK, { fallback: true }).length;
  if (!liveTikTokSockets && !mainWakeInfo?.profileResult) {
    const cached = cachedTikTokAccountProfilePayload();
    addBackendLog("warn", "tiktok-account", "No live extension profiles after Chrome wake; using cached TikTok account profiles", {
      cachedAccounts: cached.accounts.length,
      cachedProfiles: cached.profiles.length,
      wake: wakeInfo,
      mainWake: mainWakeInfo,
    });
    return { ...cached, live: false, wake: wakeInfo, mainWake: mainWakeInfo };
  }
  const tiktokProfileResults = liveTikTokSockets
    ? await sendExtensionCommandToAllProfiles("getTikTokProfiles", { cleanupAfterScan: true }, 60000, EXTENSION_ROLE_TIKTOK)
    : [];
  const profileResults = [
    ...(mainWakeInfo?.profileResult ? [mainWakeInfo.profileResult] : []),
    ...tiktokProfileResults,
  ];
  addBackendLog("info", "tiktok-account", "เก็บ cookie/token แล้ว กำลังโหลดร้านจาก TikTok API", {
    profiles: profileResults.length,
    mainProfiles: mainWakeInfo?.profileResult ? 1 : 0,
    tiktokProfiles: tiktokProfileResults.length,
  });
  const enrichedProfileResults = await enrichTikTokProfileResultsWithServerApi(profileResults);
  const payload = buildTikTokAccountProfilePayload(enrichedProfileResults);
  const cache = writeTikTokAccountProfileCache(payload);
  addBackendLog("info", "tiktok-account", "TikTok account profiles received", {
    count: payload.accounts.length,
    profiles: payload.profiles,
    changed: cache.changed,
    accounts: payload.accounts.map((account) => ({
      uniqueId: account.uniqueId || "",
      nickname: account.nickname || "",
      socketId: account.socketId || "",
      installId: account.installId || "",
    })),
  });
  addBackendLog("info", "tiktok-account", "บันทึก Channel cache แล้ว", {
    accounts: cache.accounts.length,
    profiles: cache.profiles.length,
    cacheChanged: cache.changed,
  });
  return {
    ...payload,
    accounts: payload.accounts.length ? payload.accounts : cache.accounts,
    profiles: cache.profiles,
    profileCount: cache.profileCount,
    live: true,
    wake: wakeInfo,
    mainWake: mainWakeInfo,
    cacheChanged: cache.changed,
  };
}

async function scanTikTokSingleAccountProfile(profileRef = {}, options = {}) {
  const forceBrowser = !!options.forceBrowser || !!profileRef.forceBrowser;
  if (!forceBrowser) {
    const cachedPayload = await refreshTikTokSingleProfileFromCachedSession(profileRef);
    if (cachedPayload) return cachedPayload;
    throw new Error("Cookie/token cache ใช้ไม่ได้ กด refresh channel นี้เพื่อเปิด Chrome และเก็บ cookie ใหม่แบบ manual");
  }

  const installId = String(profileRef.installId || "").trim();
  const socketId = String(profileRef.socketId || profileRef.profileSocketId || "").trim();
  let socket = installId ? extensionSocketByInstallId(installId, EXTENSION_ROLE_TIKTOK) : null;
  if (!socket && socketId) socket = extensionSocketById(socketId, EXTENSION_ROLE_TIKTOK);

  const selectedProfile = discoverChromeProfileForTikTokAccount(profileRef);
  if (!socket && selectedProfile) {
    socket = await bindChromeProfileToExtensionSocket(selectedProfile, "Opening selected Chrome profile for TikTok profile fetch", EXTENSION_ROLE_TIKTOK);
  }
  if (!socket) {
    throw new Error("ไม่พบ Chrome profile ที่เลือก หรือ extension ยังไม่เชื่อมต่อกับ profile นี้");
  }

  const socketMeta = extensionSocketMeta.get(socket) || {};
  const socketHint = chromeProfileHintsBySocketId.get(Number(socketMeta.id)) || {};
  const result = await sendExtensionCommand("getTikTokProfiles", { cleanupAfterScan: true }, 60000, socket, EXTENSION_ROLE_TIKTOK);
  const profile = {
    ok: result?.ok !== false,
    socketId: socketMeta.id || null,
    installId: socketMeta.installId || installId || "",
    profileLabel: socketHint.profileLabel || socketMeta.profileLabel || profileRef.profileLabel || profileRef.chromeProfileLabel || (socketMeta.id ? `Chrome #${socketMeta.id}` : ""),
    profileStableId: socketHint.profileStableId || socketHint.chromeProfileStableId || profileRef.profileStableId || "",
    chromeProfileStableId: socketHint.chromeProfileStableId || socketHint.profileStableId || profileRef.chromeProfileStableId || "",
    userDataDir: socketHint.userDataDir || profileRef.userDataDir || "",
    profileDirectory: socketHint.profileDirectory || profileRef.profileDirectory || "",
    profileDir: socketHint.profileDir || profileRef.profileDir || "",
    status: "online",
    result,
  };
  const enrichedProfiles = await enrichTikTokProfileResultsWithServerApi([profile]);
  const payload = buildTikTokAccountProfilePayload(enrichedProfiles);
  const cache = writeTikTokAccountProfileCache(payload);
  return {
    ...payload,
    accounts: payload.accounts,
    profiles: cache.profiles,
    profileCount: cache.profileCount,
    live: true,
    singleProfile: true,
    cacheChanged: cache.changed,
  };
}

function refreshTikTokAccountCacheInBackground(reason = "background") {
  if (tiktokAccountRefreshPromise) return tiktokAccountRefreshPromise;
  addBackendLog("info", "tiktok-account", "Refreshing TikTok account profile cache without opening Chrome", { reason });
  tiktokAccountRefreshPromise = scanTikTokAccountProfiles({ wake: false })
    .catch((error) => {
      addBackendLog("warn", "tiktok-account", "Background TikTok account profile refresh failed", {
        reason,
        error: String(error.message || error),
      });
      return cachedTikTokAccountProfilePayload();
    })
    .finally(() => {
      tiktokAccountRefreshPromise = null;
    });
  return tiktokAccountRefreshPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function normalizedPath(value) {
  return String(value || "").replace(/[\\/]+/g, "\\").replace(/\\+$/g, "").toLowerCase();
}

function chromeProfileStableIdFromParts(userDataDir, profileDirectory) {
  const key = `${normalizedPath(userDataDir)}|${String(profileDirectory || "").trim().toLowerCase()}`;
  if (!key.replace(/[|\\]/g, "")) return "";
  return `chrome-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}

function chromeProfileStableId(record = {}) {
  return String(record.chromeProfileStableId || record.profileStableId || "").trim() ||
    chromeProfileStableIdFromParts(record.userDataDir, record.profileDirectory || record.chromeProfileDirectory);
}

function findChromeExecutable() {
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const candidates = [
    process.env.CHROME_PATH,
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    "chrome.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "chrome.exe" || fs.existsSync(candidate)) || "chrome.exe";
}

function chromeUserDataDirs() {
  const local = process.env.LOCALAPPDATA || "";
  return [
    local && path.join(local, "Google", "Chrome", "User Data"),
    local && path.join(local, "Google", "Chrome Beta", "User Data"),
    local && path.join(local, "Chromium", "User Data"),
  ].filter((dir) => dir && fs.existsSync(dir));
}

function discoverChromeProfiles() {
  const profiles = [];
  for (const userDataDir of chromeUserDataDirs()) {
    const localState = readJsonFile(path.join(userDataDir, "Local State"));
    const infoCache = localState?.profile?.info_cache || {};
    const names = new Set(Object.keys(infoCache));
    try {
      for (const entry of fs.readdirSync(userDataDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (fs.existsSync(path.join(userDataDir, entry.name, "Preferences"))) names.add(entry.name);
      }
    } catch {
      /* ignore unreadable profile directories */
    }
    for (const profileDirectory of names) {
      const profileDir = path.join(userDataDir, profileDirectory);
      if (!fs.existsSync(path.join(profileDir, "Preferences"))) continue;
      const info = infoCache[profileDirectory] || {};
      profiles.push({
        userDataDir,
        profileDirectory,
        profileDir,
        profileStableId: chromeProfileStableIdFromParts(userDataDir, profileDirectory),
        chromeProfileStableId: chromeProfileStableIdFromParts(userDataDir, profileDirectory),
        label: info.name || info.shortcut_name || profileDirectory,
      });
    }
  }
  return profiles;
}

function profileHasAutoGtExtension(profile, role = "") {
  const prefs = readJsonFile(path.join(profile.profileDir, "Preferences"));
  const securePrefs = readJsonFile(path.join(profile.profileDir, "Secure Preferences"));
  const settings = {
    ...(prefs?.extensions?.settings || {}),
    ...(securePrefs?.extensions?.settings || {}),
  };
  const extensionRoot = normalizedPath(AUTOTIK_EXTENSION_DIR);
  const tiktokExtensionRoot = extensionRoot;
  return Object.values(settings).some((entry) => {
    const manifest = entry?.manifest || {};
    const entryPath = normalizedPath(entry?.path || entry?.manifest?.path || "");
    const name = String(manifest.name || entry?.name || "").toLowerCase();
    const description = String(manifest.description || "").toLowerCase();
    const state = Number(entry?.state ?? 1);
    if (state === 0) return false;
    const isTikTok = entryPath === tiktokExtensionRoot ||
      entryPath.endsWith("\\autogt pro\\extension-tiktok") ||
      name.includes("autotik") ||
      name.includes("autogt pro tiktok") ||
      description.includes("tiktok profile") ||
      description.includes("tiktok channel");
    const isMain = entryPath === extensionRoot ||
      entryPath.endsWith("\\autogt pro\\extension") ||
      name.includes("autotik") ||
      (name.includes("autogt pro") && !name.includes("tiktok")) ||
      (description.includes("autogt pro") && !description.includes("tiktok channel"));
    if (role === EXTENSION_ROLE_TIKTOK) return isTikTok;
    if (role === EXTENSION_ROLE_MAIN) return isMain;
    return isMain || isTikTok;
  });
}

function discoverAutoGtChromeProfiles(role = "") {
  const profiles = discoverChromeProfiles();
  const installed = profiles.filter((profile) => profileHasAutoGtExtension(profile, role));
  if (installed.length) return installed;
  return profiles.filter((profile) => profile.profileDirectory === "Default").slice(0, 1);
}

function launchChromeProfile(profile, url = "https://www.tiktok.com/", reason = "Opening Chrome profile", role = "", options = {}) {
  const chrome = findChromeExecutable();
  const loadExtensionDir = role === EXTENSION_ROLE_TIKTOK || role === EXTENSION_ROLE_MAIN
    ? AUTOTIK_EXTENSION_DIR
    : "";
  const args = [
    profile.userDataDir ? `--user-data-dir=${profile.userDataDir}` : "",
    `--profile-directory=${profile.profileDirectory}`,
    options.newWindow ? "--new-window" : "",
    loadExtensionDir && fs.existsSync(loadExtensionDir) ? `--load-extension=${loadExtensionDir}` : "",
    url,
  ].filter(Boolean);
  addBackendLog("info", "chrome", reason, {
    userDataDir: profile.userDataDir || "",
    profile: profile.profileDirectory,
    label: profile.label,
    chrome,
    url,
    newWindow: !!options.newWindow,
  });
  const child = spawn(chrome, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function chromeProfileFromExtensionRecord(record = {}) {
  const userDataDir = String(record.userDataDir || "").trim();
  const profileDirectory = String(record.profileDirectory || "").trim();
  if (!userDataDir || !profileDirectory) return null;
  const profileDir = String(record.profileDir || path.join(userDataDir, profileDirectory));
  if (!fs.existsSync(path.join(profileDir, "Preferences"))) return null;
  return {
    userDataDir,
    profileDirectory,
    profileDir,
    profileStableId: chromeProfileStableIdFromParts(userDataDir, profileDirectory),
    chromeProfileStableId: chromeProfileStableIdFromParts(userDataDir, profileDirectory),
    label: record.profileLabel || profileDirectory,
  };
}

function normalizeTikTokUniqueId(value) {
  return String(value || "").replace(/^@/, "").trim().toLowerCase();
}

function discoverChromeProfileForTikTokAccount(account = {}) {
  const accountProfile = chromeProfileFromExtensionRecord(account);
  if (accountProfile) return accountProfile;

  const rawChromeProfileId = String(account.chromeProfileId || "").trim();
  const installId = String(account.installId || (/^\d+$/.test(rawChromeProfileId) ? "" : rawChromeProfileId)).trim();
  const records = readExtensionProfiles();
  const recordProfile = installId ? chromeProfileFromExtensionRecord(records[installId] || {}) : null;
  if (recordProfile) return recordProfile;

  const stableId = chromeProfileStableId(account) || (/^chrome-[a-f0-9]+$/i.test(rawChromeProfileId) ? rawChromeProfileId : "");
  const label = String(account.chromeProfileLabel || account.profileLabel || "").trim().toLowerCase();
  const directory = String(account.profileDirectory || account.chromeProfileDirectory || "").trim().toLowerCase();
  const numericProfile = String(account.chromeProfileId || account.profileSocketId || account.socketId || "").trim();
  const chromeNumber = (String(account.chromeProfileLabel || "").match(/chrome\s*#\s*(\d+)/i) || [])[1] || numericProfile;
  if (!stableId && !label && !directory && !chromeNumber) return null;

  return discoverAutoGtChromeProfiles(EXTENSION_ROLE_TIKTOK).find((profile) => {
    const profileLabel = String(profile.label || "").trim().toLowerCase();
    const profileDir = String(profile.profileDirectory || "").trim().toLowerCase();
    return (stableId && chromeProfileStableId(profile) === stableId) ||
      (directory && profileDir === directory) ||
      (label && !/^chrome #\d+$/i.test(label) && profileLabel === label) ||
      (chromeNumber && profileDir === `profile ${chromeNumber}`.toLowerCase());
  }) || null;
}

async function waitForExtensionInstallId(installId, timeoutMs = CHROME_WAKE_WAIT_MS) {
  const target = String(installId || "").trim();
  if (!target) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const socket = extensionSocketByInstallId(target);
    if (socket) return socket;
    await sleep(500);
  }
  return extensionSocketByInstallId(target);
}

function liveExtensionInstallIds() {
  return new Set(extensionSocketCandidates()
    .map((socket) => String(extensionSocketMeta.get(socket)?.installId || "").trim())
    .filter(Boolean));
}

async function waitForNewExtensionProfile(previousInstallIds, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const socket of extensionSocketCandidates()) {
      const meta = extensionSocketMeta.get(socket) || {};
      const installId = String(meta.installId || "").trim();
      if (installId && !previousInstallIds.has(installId)) return meta;
    }
    await sleep(300);
  }
  return null;
}

async function waitForNewExtensionSocket(previousSocketIds, timeoutMs = CHROME_WAKE_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const socket of extensionSocketCandidates()) {
      const meta = extensionSocketMeta.get(socket) || {};
      const id = Number(meta.id);
      if (Number.isFinite(id) && !previousSocketIds.has(id)) return socket;
    }
    await sleep(300);
  }
  return null;
}

function rememberChromeProfileSocketBinding(socket, profile, reason = "Chrome profile bound to extension socket") {
  const meta = socket ? extensionSocketMeta.get(socket) : null;
  if (!meta?.id || !profile) return null;
  const hint = {
    userDataDir: profile.userDataDir,
    profileDirectory: profile.profileDirectory,
    profileDir: profile.profileDir,
    profileStableId: chromeProfileStableId(profile),
    chromeProfileStableId: chromeProfileStableId(profile),
    profileLabel: meta.profileLabel || profile.label,
  };
  chromeProfileHintsBySocketId.set(Number(meta.id), hint);
  if (meta.installId) {
    upsertExtensionProfile(meta, {
      ...hint,
      profileLabel: hint.profileLabel,
      status: "online",
      connected: true,
      socketId: meta.id || null,
      lastMessage: meta.lastMessage || reason,
    });
  }
  addBackendLog("info", "chrome", reason, {
    socketId: meta.id || null,
    installId: meta.installId || "",
    profile: profile.profileDirectory,
    label: profile.label,
  });
  return { meta, hint };
}

function resolvePendingChromeProfileBinding(bindToken, socket) {
  const token = String(bindToken || "").trim();
  if (!token || !socket) return false;
  const pending = pendingChromeProfileBindings.get(token);
  if (!pending || pending.socket) return false;
  pending.socket = socket;
  pending.meta = extensionSocketMeta.get(socket) || null;
  rememberChromeProfileSocketBinding(socket, pending.profile, "Chrome profile bound to extension socket by hello token");
  return true;
}

async function waitForChromeProfileBindingToken(token, timeoutMs = CHROME_WAKE_WAIT_MS) {
  const startedAt = Date.now();
  const pending = pendingChromeProfileBindings.get(String(token || "").trim());
  while (pending && Date.now() - startedAt < timeoutMs) {
    if (pending.socket && extensionSockets.has(pending.socket)) return pending.socket;
    await sleep(250);
  }
  return pending?.socket && extensionSockets.has(pending.socket) ? pending.socket : null;
}

function startChromeProfileBinding(profile, reason = "Binding Chrome profile", role = "") {
  const token = `autogt-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const bindUrl = `https://www.tiktok.com/?autogt_profile_bind=${encodeURIComponent(token)}`;
  pendingChromeProfileBindings.set(token, { profile, socket: null, meta: null, role, createdAt: Date.now() });
  launchChromeProfile(profile, bindUrl, reason, role);
  return { token, profile };
}

async function bindChromeProfileToExtensionSocket(profile, reason = "Binding Chrome profile", role = "") {
  const { token } = startChromeProfileBinding(profile, reason, role);
  const tokenSocket = await waitForChromeProfileBindingToken(token, Math.min(CHROME_WAKE_WAIT_MS, 9000));
  if (tokenSocket) {
    pendingChromeProfileBindings.delete(token);
    return tokenSocket;
  }
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < CHROME_WAKE_WAIT_MS) {
    const pending = pendingChromeProfileBindings.get(token);
    if (pending?.socket && extensionSockets.has(pending.socket)) {
      pendingChromeProfileBindings.delete(token);
      return pending.socket;
    }
    await sleep(700);
    const sockets = extensionSocketCandidates(role || null).reverse();
    for (const socket of sockets) {
      try {
        const result = await sendExtensionCommand("claimProfileBinding", { token }, 5000, socket, role || null);
        if (result?.claimed) {
          rememberChromeProfileSocketBinding(socket, profile, "Chrome profile bound to extension socket");
          pendingChromeProfileBindings.delete(token);
          return socket;
        }
      } catch (error) {
        lastError = String(error.message || error);
      }
    }
  }
  addBackendLog("warn", "chrome", "Chrome profile binding did not find a matching extension socket", {
    profile: profile.profileDirectory,
    label: profile.label,
    error: lastError,
  });
  pendingChromeProfileBindings.delete(token);
  return null;
}

// POST WEB: find the live extension socket for the Chrome profile a saved TikTok
// account belongs to. Matches on the identifiers the account cache carries, in
// order of how strongly each one pins a specific profile. Returns null when the
// account's profile is not currently connected — the caller turns that into a
// "scan accounts again" message rather than posting from the wrong profile.
async function resolvePostWebSocket(account = {}) {
  const installId = String(account.installId || "").trim();
  if (installId) {
    const socket = extensionSocketByInstallId(installId, EXTENSION_ROLE_TIKTOK);
    if (socket) return socket;
  }

  const socketId = String(account.profileSocketId || account.socketId || "").trim();
  if (socketId) {
    const socket = extensionSocketById(socketId, EXTENSION_ROLE_TIKTOK);
    if (socket) return socket;
  }

  const stableId = chromeProfileStableId(account);
  if (stableId) {
    for (const socket of extensionSocketCandidates(EXTENSION_ROLE_TIKTOK, { fallback: true })) {
      const meta = extensionSocketMeta.get(socket) || {};
      const hint = chromeProfileHintsBySocketId.get(Number(meta.id)) || {};
      if (chromeProfileStableId(hint) === stableId) return socket;
    }
  }

  return null;
}

async function waitForExtensionProfiles(minSockets, timeoutMs = CHROME_WAKE_WAIT_MS, role = null) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (extensionSocketCandidates(role, { fallback: true }).length >= minSockets) return true;
    await sleep(500);
  }
  return extensionSocketCandidates(role, { fallback: true }).length >= minSockets;
}

async function wakeMainExtensionForChannelScan() {
  const before = extensionSocketCandidates(EXTENSION_ROLE_MAIN).length;
  if (before > 0) {
    const socket = activeExtensionSocket(EXTENSION_ROLE_MAIN);
    let captureResult = null;
    if (socket) {
      try {
        addBackendLog("info", "chrome", "Main Extension already connected; capturing TikTok cookie/token for Channel scan");
        captureResult = await sendExtensionCommand(
          "getTikTokProfiles",
          { cleanupAfterScan: true },
          60000,
          socket,
          EXTENSION_ROLE_MAIN,
        );
        addBackendLog("info", "chrome", "Main Extension captured TikTok cookie/token from connected profile", {
          ok: captureResult?.ok !== false,
          cookieCount: captureResult?.session?.cookieCount || 0,
          hasAuthCookie: !!captureResult?.session?.hasAuthCookie,
          accounts: Array.isArray(captureResult?.accounts) ? captureResult.accounts.length : 0,
        });
      } catch (error) {
        addBackendLog("warn", "chrome", "Main Extension connected but TikTok cookie/token capture failed", {
          error: String(error.message || error),
        });
      }
    }
    const socketMeta = socket ? (extensionSocketMeta.get(socket) || {}) : {};
    const socketHint = socket ? (chromeProfileHintsBySocketId.get(Number(socketMeta.id)) || {}) : {};
    const profileResult = captureResult ? {
      ok: captureResult?.ok !== false,
      socketId: socketMeta.id || null,
      installId: socketMeta.installId || "",
      profileLabel: socketHint.profileLabel || socketMeta.profileLabel || (socketMeta.id ? `Chrome #${socketMeta.id}` : "Main Extension"),
      profileStableId: socketHint.profileStableId || socketHint.chromeProfileStableId || "",
      chromeProfileStableId: socketHint.chromeProfileStableId || socketHint.profileStableId || "",
      userDataDir: socketHint.userDataDir || "",
      profileDirectory: socketHint.profileDirectory || "",
      profileDir: socketHint.profileDir || "",
      status: "online",
      role: EXTENSION_ROLE_MAIN,
      result: captureResult,
    } : null;
    return {
      launched: 0,
      before,
      after: extensionSocketCandidates(EXTENSION_ROLE_MAIN).length,
      alreadyConnected: true,
      connected: !!socket,
      captured: !!captureResult,
      profileResult,
      cookieCount: captureResult?.session?.cookieCount || 0,
      hasAuthCookie: !!captureResult?.session?.hasAuthCookie,
    };
  }

  const profiles = discoverAutoGtChromeProfiles(EXTENSION_ROLE_MAIN);
  if (!profiles.length) {
    addBackendLog("warn", "chrome", "No Chrome profile found to wake Main Extension for Channel scan");
    return { launched: 0, before, after: before, profiles: [] };
  }

  const profile = profiles[0];
  addBackendLog("info", "chrome", "Opening Main Extension for Channel scan", {
    profile: profile.profileDirectory,
    label: profile.label,
  });

  const socket = await bindChromeProfileToExtensionSocket(
    profile,
    "Opening Main Extension for Channel scan",
    EXTENSION_ROLE_MAIN,
  );
  let captureResult = null;
  if (socket) {
    try {
      addBackendLog("info", "chrome", "Main Extension capturing TikTok cookie/token for Channel scan", {
        profile: profile.profileDirectory,
        label: profile.label,
      });
      captureResult = await sendExtensionCommand(
        "getTikTokProfiles",
        { cleanupAfterScan: true },
        60000,
        socket,
        EXTENSION_ROLE_MAIN,
      );
      addBackendLog("info", "chrome", "Main Extension captured TikTok cookie/token and closed scan tab", {
        ok: captureResult?.ok !== false,
        cookieCount: captureResult?.session?.cookieCount || 0,
        hasAuthCookie: !!captureResult?.session?.hasAuthCookie,
        accounts: Array.isArray(captureResult?.accounts) ? captureResult.accounts.length : 0,
      });
    } catch (error) {
      addBackendLog("warn", "chrome", "Main Extension TikTok cookie/token capture failed", {
        profile: profile.profileDirectory,
        label: profile.label,
        error: String(error.message || error),
      });
    }
  }
  const after = extensionSocketCandidates(EXTENSION_ROLE_MAIN).length;
  addBackendLog(socket ? "info" : "warn", "chrome", socket ? "Main Extension connected for Channel scan" : "Main Extension did not connect for Channel scan", {
    launched: 1,
    before,
    after,
    profile: profile.profileDirectory,
    label: profile.label,
  });
  const socketMeta = socket ? (extensionSocketMeta.get(socket) || {}) : {};
  const socketHint = socket ? (chromeProfileHintsBySocketId.get(Number(socketMeta.id)) || {}) : {};
  const profileResult = captureResult ? {
    ok: captureResult?.ok !== false,
    socketId: socketMeta.id || null,
    installId: socketMeta.installId || "",
    profileLabel: socketHint.profileLabel || socketMeta.profileLabel || profile.label || (socketMeta.id ? `Chrome #${socketMeta.id}` : "Main Extension"),
    profileStableId: socketHint.profileStableId || socketHint.chromeProfileStableId || profile.stableId || "",
    chromeProfileStableId: socketHint.chromeProfileStableId || socketHint.profileStableId || profile.stableId || "",
    userDataDir: socketHint.userDataDir || profile.userDataDir || "",
    profileDirectory: socketHint.profileDirectory || profile.profileDirectory || "",
    profileDir: socketHint.profileDir || profile.profileDir || profile.profileDirectory || "",
    status: "online",
    role: EXTENSION_ROLE_MAIN,
    result: captureResult,
  } : null;

  return {
    launched: 1,
    before,
    after,
    profiles: [profile],
    connected: !!socket,
    captured: !!captureResult,
    profileResult,
    cookieCount: captureResult?.session?.cookieCount || 0,
    hasAuthCookie: !!captureResult?.session?.hasAuthCookie,
  };
}

async function wakeChromeProfilesForTikTokAccounts() {
  const before = extensionSocketCandidates(EXTENSION_ROLE_TIKTOK, { fallback: true }).length;
  const profiles = discoverAutoGtChromeProfiles(EXTENSION_ROLE_TIKTOK);
  if (!profiles.length) {
    addBackendLog("warn", "chrome", "No Chrome profiles found to wake for TikTok account scan");
    return { launched: 0, before, after: before, profiles: [] };
  }
  const launched = [];
  for (const profile of profiles) {
    try {
      launched.push(startChromeProfileBinding(profile, "Opening Chrome profile for TikTok account scan", EXTENSION_ROLE_TIKTOK));
      await sleep(350);
    } catch (error) {
      addBackendLog("warn", "chrome", "Cannot open Chrome profile", {
        profile: profile.profileDirectory,
        error: String(error.message || error),
      });
    }
  }

  await waitForExtensionProfiles(Math.max(before, Math.min(profiles.length, before + launched.length), 1), CHROME_WAKE_WAIT_MS, EXTENSION_ROLE_TIKTOK);

  for (const launch of launched) {
    try {
      let socket = await waitForChromeProfileBindingToken(launch.token, 1200);
      if (!socket) {
        const startedAt = Date.now();
        let lastError = "";
        while (!socket && Date.now() - startedAt < 3500) {
          for (const candidate of extensionSocketCandidates(EXTENSION_ROLE_TIKTOK, { fallback: true }).reverse()) {
            try {
              const result = await sendExtensionCommand("claimProfileBinding", { token: launch.token }, 2500, candidate, EXTENSION_ROLE_TIKTOK);
              if (result?.claimed) {
                socket = candidate;
                rememberChromeProfileSocketBinding(candidate, launch.profile, "Chrome profile bound to extension socket");
                break;
              }
            } catch (error) {
              lastError = String(error.message || error);
            }
          }
          if (!socket) await sleep(300);
        }
        if (!socket) {
          addBackendLog("warn", "chrome", "Chrome profile binding did not find a matching extension socket", {
            profile: launch.profile.profileDirectory,
            label: launch.profile.label,
            error: lastError,
          });
        }
      }
      pendingChromeProfileBindings.delete(launch.token);
      const meta = socket ? extensionSocketMeta.get(socket) : null;
      if (meta?.id) {
        chromeProfileHintsBySocketId.set(Number(meta.id), {
          userDataDir: launch.profile.userDataDir,
          profileDirectory: launch.profile.profileDirectory,
          profileDir: launch.profile.profileDir,
          profileStableId: chromeProfileStableId(launch.profile),
          chromeProfileStableId: chromeProfileStableId(launch.profile),
          profileLabel: meta.profileLabel || launch.profile.label,
        });
      }
      if (meta?.installId) {
        upsertExtensionProfile(meta, {
          userDataDir: launch.profile.userDataDir,
          profileDirectory: launch.profile.profileDirectory,
          profileDir: launch.profile.profileDir,
          profileStableId: chromeProfileStableId(launch.profile),
          chromeProfileStableId: chromeProfileStableId(launch.profile),
          profileLabel: meta.profileLabel || launch.profile.label,
          status: "online",
          connected: true,
          socketId: meta.id || null,
          lastMessage: meta.lastMessage || "ext.hello",
        });
      }
    } catch (error) {
      addBackendLog("warn", "chrome", "Cannot open Chrome profile", {
        profile: launch.profile.profileDirectory,
        error: String(error.message || error),
      });
    }
  }
  const after = extensionSocketCandidates().length;
  addBackendLog("info", "chrome", "Chrome profile wake completed", {
    launched: profiles.length,
    before,
    after,
  });
  return { launched: profiles.length, before, after, profiles };
}

function captureSummary() {
  const index = readCaptureIndex();
  return Object.fromEntries(Object.entries(index).map(([provider, payload]) => {
    const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
    return [provider, {
      capturedAt: payload.capturedAt || null,
      cookieCount: cookies.length,
      hasCookies: cookies.length > 0,
      captureMode: payload.captureMode || null,
      via: payload.via || null,
      tab: payload.tab || null,
    }];
  }));
}

// ---- flow-suite: BlueSPite-ported Prompt/Queue/History engine ----
// Sibling CommonJS/ESM modules under lib/flow-suite/ (not inlined here) —
// see the port plan (C:\Users\Blue\.claude\plans\joyful-humming-kazoo.md).
const flowSuiteStore = require("./lib/flow-suite/server/store.js");
const { createRunner: createFlowSuiteRunner } = require("./lib/flow-suite/server/runner.js");
const flowSuiteClients = new Set();

let flowSuiteSharedPromise = null;
function loadFlowSuiteShared() {
  if (!flowSuiteSharedPromise) {
    flowSuiteSharedPromise = Promise.all([
      import(pathToFileURL(path.join(ROOT, "lib", "flow-suite", "shared", "catalog.mjs")).href),
      import(pathToFileURL(path.join(ROOT, "lib", "flow-suite", "shared", "prompt.mjs")).href),
    ]).then(([catalog, prompt]) => ({ ...catalog, ...prompt }));
  }
  return flowSuiteSharedPromise;
}

let flowSuiteRunnerInstance = null;
function getFlowSuiteRunner() {
  if (!flowSuiteRunnerInstance) {
    flowSuiteRunnerInstance = createFlowSuiteRunner({
      finalizeScenes: finalizeFlowScenes,
      finalPlatformKey,
      // The queue drives Flow directly now (lib/flow-suite/server/flow-client.js);
      // only the cookie harvest and the captcha mint still need the extension.
      harvestFlowCookies,
      mintFlowCaptcha,
      refreshFlowCaptcha,
      createFlowRoom,
      submitExtendedVideo,
      // Since 2026-09 the captcha-gated aisandbox-pa REST calls answer HTTP 429
      // "reCAPTCHA evaluation failed" for every token; the Flow web app only
      // talks batchexecute from its own page, so video submit + status go
      // through the project tab as well (same pattern as Extended).
      submitFlowVideo,
      checkFlowMedia,
    });
  }
  return flowSuiteRunnerInstance;
}

async function getFlowSuiteState() {
  const shared = await loadFlowSuiteShared();
  return {
    flowAccountEmail: extensionState.flowAccountEmail || "",
    settings: flowSuiteStore.settings(),
    jobs: flowSuiteStore.jobs(),
    history: flowSuiteStore.history(),
    runner: getFlowSuiteRunner().runnerState(),
    catalog: {
      imageModels: shared.FLOW_IMAGE_MODELS,
      videoModels: shared.FLOW_VIDEO_MODELS,
      textModes: shared.TEXT_MODES,
      directionFields: shared.DIRECTION_FIELDS,
      styleOptions: shared.STYLE_OPTIONS,
      maxConcurrency: shared.MAX_CONCURRENCY,
      defaultConcurrency: shared.DEFAULT_CONCURRENCY,
      concurrentSafeModels: shared.CONCURRENT_SAFE_MODELS,
      aspectsVideo: shared.ASPECTS_VIDEO,
      aspectsImage: shared.ASPECTS_IMAGE,
    },
  };
}

function broadcastFlowSuiteState() {
  getFlowSuiteState().then((state) => {
    const line = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const res of flowSuiteClients) {
      try { res.write(line); } catch { flowSuiteClients.delete(res); }
    }
  }).catch(() => {});
}

// A job persisted as "running" only means a lane was mid-way through it when
// this process last exited — reconcile once at boot, before anything can
// start draining the queue.
flowSuiteStore.reconcileOrphanedJobs();

// Debounced writes need a flush on exit or the last ~250ms of state can be
// lost. Explicit process.exit() after flushing preserves normal Ctrl+C
// shutdown behavior (registering a SIGINT/SIGTERM listener otherwise
// prevents Node's default exit-on-signal behavior).
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { flowSuiteStore.flushNow(); } catch { /* best effort */ }
    process.exit(0);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Length": "0",
    });
    res.end();
    return;
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (requestUrl.pathname === "/api/health" && req.method === "GET") {
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({
      ok: true,
      app: "AutoGT Pro",
      port: PORT,
      time: new Date().toISOString(),
    }));
    return;
  }

  if (requestUrl.pathname === "/api/browser-capture" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        writeCapture(payload);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({
          ok: true,
          saved: path.relative(ROOT, CAPTURE_FILE),
          cookieCount: Array.isArray(payload.cookies) ? payload.cookies.length : 0,
          domain: payload.tab && payload.tab.domain,
        }));
      } catch (error) {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/shopee-affiliate-capture" && req.method === "POST") {
    readJsonBody(req, 8 * 1024 * 1024)
      .then((payload) => {
        const captures = Array.isArray(payload?.captures) ? payload.captures : [];
        const rows = appendShopeeAffiliateCaptures(captures);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, received: captures.length, stored: rows.length }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee-affiliate-capture/latest" && req.method === "GET") {
    const limit = Math.max(1, Math.min(100, Number(requestUrl.searchParams.get("limit") || 20)));
    const rows = readShopeeAffiliateCaptures();
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, total: rows.length, captures: rows.slice(-limit).reverse() }));
    return;
  }

  if (requestUrl.pathname === "/api/logs" && req.method === "GET") {
    const limit = Math.max(1, Math.min(500, Number(requestUrl.searchParams.get("limit") || 200)));
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({
      ok: true,
      logs: backendLogs.slice(-limit).reverse(),
      total: backendLogs.length,
      time: new Date().toISOString(),
    }));
    return;
  }

  // Clear on the Log dock has to empty whatever that dock is SHOWING. The studio
  // dock reads the clip-generation queue log, which /api/logs/clear does not
  // touch — clearing only the backend log left the dock looking unchanged.
  if (requestUrl.pathname === "/api/flow/logs" && req.method === "DELETE") {
    flowSuiteStore.clearLog();
    broadcastFlowSuiteState();
    addBackendLog("info", "flow-suite", "ล้าง log การเจนคลิปแล้ว");
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (requestUrl.pathname === "/api/logs/clear" && req.method === "DELETE") {
    backendLogs.splice(0, backendLogs.length);
    addBackendLog("info", "server", "Backend logs cleared");
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, count: 0 }));
    return;
  }

  if (requestUrl.pathname === "/api/ui-log" && req.method === "POST") {
    readJsonBody(req, 1024 * 1024)
      .then((payload) => {
        addBackendLog(payload.level || "info", payload.source || "ui", payload.message || "", payload.detail || null);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/adb/devices" && (req.method === "GET" || req.method === "POST")) {
    addBackendLog("info", "api:adb", `${req.method} /api/adb/devices`);
    scanAdbDevices()
      .then((devices) => {
        addBackendLog("info", "api:adb", "ADB scan complete", { devices: devices.length });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, devices }));
      })
      .catch((error) => {
        addBackendLog("error", "api:adb", "ADB scan failed", { error: String(error.message || error) });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error), devices: [] }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/mobile/library/scan" && (req.method === "GET" || req.method === "POST")) {
    addBackendLog("info", "api:mobile", `${req.method} /api/mobile/library/scan`);
    try {
      const videos = scanMobileVideoLibrary();
      addBackendLog("info", "api:mobile", "Mobile video library scanned", { videos: videos.length });
      res.writeHead(200, noCacheHeaders(types[".json"]));
      res.end(JSON.stringify({ ok: true, videos }));
    } catch (error) {
      addBackendLog("error", "api:mobile", "Mobile library scan failed", { error: String(error.message || error) });
      res.writeHead(500, noCacheHeaders(types[".json"]));
      res.end(JSON.stringify({ ok: false, error: String(error.message || error), videos: [] }));
    }
    return;
  }

  if (requestUrl.pathname === "/api/mobile/post/run" && req.method === "POST") {
    addBackendLog("info", "api:mobile", "POST /api/mobile/post/run");
    readJsonBody(req, 1024 * 1024)
      .then((payload) => runMobilePostAutomation(payload))
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        addBackendLog("error", "api:mobile", "Mobile post automation failed", { error: String(error.message || error) });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/upload-clip" && req.method === "POST") {
    addBackendLog("info", "api:upload", "POST /api/upload-clip");
    readRawBody(req, 512 * 1024 * 1024)
      .then((buffer) => {
        const file = parseMultipartFile(buffer, req.headers["content-type"] || "");
        const originalName = file.filename || "clip.mp4";
        const ext = path.extname(originalName).toLowerCase() || ".mp4";
        if (![".mp4", ".webm", ".mov", ".m4v"].includes(ext)) {
          throw new Error("Unsupported video file type. Use mp4, webm, mov, or m4v.");
        }
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const safeName = `${Date.now()}-${safeUploadName(originalName)}`;
        const target = path.join(UPLOADS_DIR, safeName);
        fs.writeFileSync(target, file.data);
        const url = `/uploads/${safeName}`;
        addBackendLog("info", "api:upload", "Uploaded TikTok post clip", {
          originalName,
          file: target,
          url,
          bytes: file.data.length,
          contentType: file.contentType || "",
        });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({
          ok: true,
          name: safeName,
          originalName,
          url,
          file: target,
          size: file.data.length,
          type: file.contentType || types[ext] || "video/mp4",
        }));
      })
      .catch((error) => {
        addBackendLog("error", "api:upload", "Upload clip failed", { error: String(error.message || error) });
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  // Dev helper: ask the connected Main Extension to chrome.runtime.reload() so a
  // rebuilt unpacked build comes up without a trip to chrome://extensions.
  if (requestUrl.pathname === "/api/extension/reload" && req.method === "POST") {
    sendExtensionCommand("reloadExtension", {}, 15000, null, EXTENSION_ROLE_MAIN)
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, previousVersion: result?.version || "" }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/extension-status" && req.method === "GET") {
    const captures = captureSummary();
    const mainSocket = activeExtensionSocket(EXTENSION_ROLE_MAIN);
    const mainMeta = mainSocket ? extensionSocketMeta.get(mainSocket) : null;
    const mainHint = mainMeta?.id ? (chromeProfileHintsBySocketId.get(Number(mainMeta.id)) || {}) : {};
    const mainProfileLabel = realExtensionProfileLabel(mainHint.profileLabel || mainMeta?.profileLabel, mainMeta?.installId);
    const mainExtension = mainMeta ? {
      socketId: mainMeta.id || null,
      installId: mainMeta.installId || "",
      profileLabel: mainProfileLabel,
      profileDirectory: mainHint.profileDirectory || mainMeta.profileDirectory || "",
      profileStableId: mainHint.profileStableId || mainHint.chromeProfileStableId || "",
      version: mainMeta.version || extensionState.version || "",
      accountEmail: mainMeta.flowAccountEmail || extensionState.flowAccountEmail || "",
      connected: true,
    } : null;
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({
      ok: true,
      connected: !!mainMeta,
      lastSeen: mainMeta?.lastSeen || null,
      version: mainMeta?.version || null,
      sockets: extensionSockets.size,
      lastMessage: extensionState.lastMessage,
      extensionProfiles: extensionProfilesSnapshot(),
      mainExtension,
      flowAccountEmail: mainMeta?.flowAccountEmail || extensionState.flowAccountEmail || "",
      captures,
      tiktokReady: !!captures.tiktok?.hasCookies,
      shopeeReady: !!captures.shopee?.hasCookies,
    }));
    return;
  }

  if (requestUrl.pathname === "/api/browser-capture/latest" && req.method === "GET") {
    const provider = requestUrl.searchParams.get("provider");
    if (provider) {
      const payload = readCaptureIndex()[provider.toLowerCase()];
      if (!payload) {
        res.writeHead(404, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: `No capture data available for ${provider}.` }));
        return;
      }
      res.writeHead(200, noCacheHeaders(types[".json"]));
      res.end(JSON.stringify(payload));
      return;
    }
    fs.readFile(CAPTURE_FILE, "utf8", (err, body) => {
      if (err) {
        res.writeHead(404, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: "No capture data available." }));
        return;
      }
      res.writeHead(200, noCacheHeaders(types[".json"]));
      res.end(body);
    });
    return;
  }

  // POST WEB AI settings: read masked state, save keys, test one provider, and
  // write a caption. Keys are only ever written in, never read back out.
  if (requestUrl.pathname === "/api/logs/friendly" && req.method === "GET") {
    const audience = requestUrl.searchParams.get("audience") === "post" ? "post" : "studio";
    const limit = Math.min(300, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 120));
    // "studio" reads the clip-generation queue log; "post" reads the backend log,
    // which is where the TikTok publish events land.
    // Both sources are stored oldest-first; the docks show newest at the top.
    const rows = audience === "studio"
      ? flowSuiteStore.logTail(600).slice().reverse().map((entry) => ({
          time: new Date(entry.ts).toISOString(),
          level: entry.level,
          text: friendlyStudioLine(entry),
        }))
      : backendLogs.slice(-600).reverse().map((row) => ({
          time: row.time,
          level: row.level,
          text: friendlyPostLine(row),
        }));
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, audience, logs: rows.filter((row) => row.text).slice(0, limit) }));
    return;
  }

  if (requestUrl.pathname === "/api/postweb/settings" && req.method === "GET") {
    const settings = readPostWebSettings();
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, settings, stored: Object.keys(settings).length > 0 }));
    return;
  }

  if (requestUrl.pathname === "/api/postweb/settings" && req.method === "POST") {
    readJsonBody(req, 64 * 1024)
      .then((payload) => {
        const settings = sanitizePostWebSettings(payload?.settings || payload || {});
        writePostWebSettings(settings);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, settings }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/postweb/ai-settings" && req.method === "GET") {
    const settings = readPostWebAiSettings();
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({
      ok: true,
      provider: settings.provider,
      keys: {
        openai: maskApiKey(settings.keys.openai),
        gemini: maskApiKey(settings.keys.gemini),
        openrouter: maskApiKey(settings.keys.openrouter),
      },
      models: {
        openai: postWebAiModel(settings, "openai"),
        gemini: postWebAiModel(settings, "gemini"),
        openrouter: postWebAiModel(settings, "openrouter"),
      },
      captionAi: settings.captionAi === true,
    }));
    return;
  }

  if (requestUrl.pathname === "/api/postweb/ai-settings" && req.method === "POST") {
    readJsonBody(req, 64 * 1024)
      .then((payload) => {
        const settings = readPostWebAiSettings();
        if (POSTWEB_AI_PROVIDERS.includes(payload.provider)) settings.provider = payload.provider;
        // A blank field means "leave the stored key alone"; the UI only sends
        // what was actually typed so a saved key survives a re-save.
        for (const provider of POSTWEB_AI_PROVIDERS) {
          const value = payload?.keys?.[provider];
          if (typeof value === "string" && value.trim()) settings.keys[provider] = value.trim();
          const model = payload?.models?.[provider];
          if (typeof model === "string" && model.trim()) settings.models[provider] = model.trim();
        }
        if (typeof payload.captionAi === "boolean") settings.captionAi = payload.captionAi;
        // A blank field means "leave it alone" (above), so removing a key has to
        // say so out loud — this is what the ลบคีย์ button sends.
        for (const provider of Array.isArray(payload.clear) ? payload.clear : []) {
          if (POSTWEB_AI_PROVIDERS.includes(provider)) settings.keys[provider] = "";
        }
        writePostWebAiSettings(settings);
        // Deliberately logs which providers are configured, never the values.
        addBackendLog("info", "post-web", "บันทึกตั้งค่า AI แคปชั่นแล้ว", {
          provider: settings.provider,
          configured: POSTWEB_AI_PROVIDERS.filter((name) => !!settings.keys[name]),
        });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, provider: settings.provider }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/postweb/ai-test" && req.method === "POST") {
    readJsonBody(req, 16 * 1024)
      .then(async (payload) => {
        const settings = readPostWebAiSettings();
        const provider = POSTWEB_AI_PROVIDERS.includes(payload.provider) ? payload.provider : settings.provider;
        // Test what the user just typed if present, otherwise the stored key.
        const typed = typeof payload?.key === "string" ? payload.key.trim() : "";
        const key = typed || settings.keys[provider];
        if (!key) throw new Error(`ยังไม่ได้ใส่ API key ของ ${provider}`);
        const result = await testPostWebAiKey(provider, key);
        addBackendLog("info", "post-web", "ทดสอบ API key สำเร็จ", { provider });
        return { provider, ...result };
      })
      .then((data) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...data }));
      })
      .catch((error) => {
        const message = String(error.message || error);
        addBackendLog("warn", "post-web", "ทดสอบ API key ไม่สำเร็จ", { error: message });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: message }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/postweb/ai-caption" && req.method === "POST") {
    readJsonBody(req, 64 * 1024)
      .then(async (payload) => {
        const productName = String(payload.productName || "").trim();
        if (!productName) throw new Error("ต้องมีชื่อสินค้าหรือชื่อวิดีโอก่อน");
        return generatePostWebCaption(productName);
      })
      .then((data) => {
        addBackendLog("info", "post-web", "สร้างแคปชั่นด้วย AI แล้ว", {
          provider: data.provider,
          model: data.model,
          hashtags: data.hashtags.length,
        });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...data }));
      })
      .catch((error) => {
        const message = String(error.message || error);
        addBackendLog("error", "post-web", "สร้างแคปชั่นด้วย AI ไม่สำเร็จ", { error: message });
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: message }));
      });
    return;
  }

  // POST WEB: hand one clip to the TikTok extension to publish through TikTok Web.
  // The page (main app, /app -> POST WEB tab) posts one job at a time and drives
  // its own queue, so this endpoint stays a single-shot publish.
  if (requestUrl.pathname === "/api/tiktok/post-web/publish" && req.method === "POST") {
    addBackendLog("info", "api:post-web", "POST /api/tiktok/post-web/publish");
    readJsonBody(req, 2 * 1024 * 1024)
      .then(async (payload) => {
        const mediaUrl = String(payload.mediaUrl || "").trim();
        if (!mediaUrl) throw new Error("mediaUrl is required.");
        const account = payload.account && typeof payload.account === "object" ? payload.account : null;

        const command = {
          jobId: String(payload.jobId || `postweb-${Date.now()}`),
          mediaUrl,
          caption: String(payload.caption || ""),
          hashtags: Array.isArray(payload.hashtags) ? payload.hashtags : [],
          productId: payload.productId || null,
          productCta: String(payload.productCta || ""),
          account,
          finalize: ["post", "schedule", "draft", "private"].includes(payload.finalize) ? payload.finalize : "post",
          scheduleAt: String(payload.scheduleAt || ""),
          autoPost: payload.finalize !== "draft",
          settings: payload.settings && typeof payload.settings === "object" ? payload.settings : {},
        };

        const socket = account ? await resolvePostWebSocket(account) : null;
        if (account && !socket) {
          const label = account.chromeProfileLabel || account.uniqueId || "บัญชีที่เลือก";
          throw new Error(`Chrome profile ของบัญชี ${label} ไม่ได้เชื่อมต่ออยู่ — ไปหน้า Channel กดสแกนหา Account ใหม่ แล้วเลือกบัญชีอีกครั้ง`);
        }

        addBackendLog("info", "post-web", "Sending clip to TikTok Web extension", {
          jobId: command.jobId,
          mediaUrl: command.mediaUrl,
          finalize: command.finalize,
          scheduleAt: command.scheduleAt,
          productId: command.productId || "",
          uniqueId: account?.uniqueId || "",
          captionPreview: command.caption.slice(0, 160),
        });
        return sendExtensionCommand("publish", command, 300000, socket, EXTENSION_ROLE_TIKTOK);
      })
      .then((result) => {
        addBackendLog("info", "post-web", "TikTok Web publish finished", result);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        const message = String(error.message || error);
        addBackendLog("error", "post-web", "TikTok Web publish failed", { error: message });
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: message }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/accounts" && (req.method === "GET" || req.method === "POST")) {
    addBackendLog("info", "api:tiktok-account", `${req.method} /api/tiktok/accounts`);
    const cacheOnly = requestUrl.searchParams.get("cache") === "1";
    const refresh = requestUrl.searchParams.get("refresh") === "1" || req.method === "POST";
    if (cacheOnly && !refresh) {
      const payload = cachedTikTokAccountProfilePayload();
      res.writeHead(200, noCacheHeaders(types[".json"]));
      res.end(JSON.stringify(payload));
      return;
    }
    scanTikTokAccountProfiles({ wake: true })
      .then((payload) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify(payload));
      })
      .catch((error) => {
        addBackendLog("error", "tiktok-account", "TikTok account profile fetch failed", { error: String(error.message || error) });
        const cached = cachedTikTokAccountProfilePayload();
        if (cached.accounts.length || cached.profiles.length) {
          res.writeHead(200, noCacheHeaders(types[".json"]));
          res.end(JSON.stringify({ ...cached, ok: true, stale: true, error: String(error.message || error) }));
          return;
        }
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error), accounts: [] }));
      });
    return;

  }

  if (requestUrl.pathname === "/api/tiktok/accounts/profile" && req.method === "POST") {
    addBackendLog("info", "api:tiktok-account", "POST /api/tiktok/accounts/profile");
    readJsonBody(req, 512 * 1024)
      .then((payload) => scanTikTokSingleAccountProfile(payload.profile || payload, { forceBrowser: !!payload.forceBrowser }))
      .then((payload) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify(payload));
      })
      .catch((error) => {
        addBackendLog("error", "tiktok-account", "TikTok single profile fetch failed", { error: String(error.message || error) });
        const cached = cachedTikTokAccountProfilePayload();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ...cached, ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/accounts/delete" && req.method === "POST") {
    addBackendLog("info", "api:tiktok-account", "POST /api/tiktok/accounts/delete");
    readJsonBody(req, 512 * 1024)
      .then((payload) => {
        const result = removeTikTokAccountProfileCache(payload.account || payload);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        addBackendLog("error", "tiktok-account", "Delete TikTok account cache failed", { error: String(error.message || error) });
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/showcase/pull" && req.method === "POST") {
    addBackendLog("info", "api:tiktok", "POST /api/tiktok/showcase/pull");
    readJsonBody(req, 512 * 1024)
      .then(async (payload) => {
        if (!payload.account) {
          throw new Error("กรุณาเลือก Channel/TikTok account ที่จะใช้ดึง Showcase ก่อน");
        }
        return pullTikTokShowcaseFromCachedChannel(payload.account);
      })
      .then((payload) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...payload }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/showcase/add" && req.method === "POST") {
    addBackendLog("info", "api:tiktok", "POST /api/tiktok/showcase/add");
    readJsonBody(req)
      .then(async (payload) => {
        if (!payload.account) {
          throw new Error("กรุณาเลือก Channel/TikTok account ที่จะใช้เพิ่มสินค้า Showcase ก่อน");
        }
        return addTikTokShowcaseProductsFromCachedChannel(payload.account, payload.productIds || [], payload.mainPlanId || "");
      })
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error), code: error.code || "" }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/showcase/delete" && req.method === "POST") {
    addBackendLog("info", "api:tiktok", "POST /api/tiktok/showcase/delete");
    readJsonBody(req)
      .then(async (payload) => {
        if (!payload.account) {
          throw new Error("กรุณาเลือก Channel/TikTok account ที่จะใช้ลบสินค้า Showcase ก่อน");
        }
        return deleteTikTokShowcaseProductsFromCachedChannel(payload.account, payload.productIds || []);
      })
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/tiktok/links/check" && req.method === "POST") {
    addBackendLog("info", "api:tiktok", "POST /api/tiktok/links/check");
    readJsonBody(req)
      .then(async (payload) => {
        if (!payload.account) {
          throw new Error("กรุณาเลือก Channel/TikTok account ที่จะใช้ดึงสินค้าจากลิงก์ก่อน");
        }
        return checkTikTokProductLinksFromCachedChannel(payload.account, payload.urls || []);
      })
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/links/check" && req.method === "POST") {
    addBackendLog("info", "api:shopee", "POST /api/shopee/links/check");
    readJsonBody(req)
      .then((payload) => sendExtensionCommand("checkShopeeLinks", { urls: payload.urls || [] }, 180000))
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/products/search" && req.method === "POST") {
    addBackendLog("info", "api:shopee", "POST /api/shopee/products/search");
    readJsonBody(req)
      .then((payload) => sendExtensionCommand("searchShopeeProducts", payload || {}, 900000, null, EXTENSION_ROLE_MAIN))
      .then((result) => {
        const ok = result?.ok !== false;
        res.writeHead(ok ? 200 : 503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ...result, ok }));
      })
      .catch((error) => {
        addBackendLog("error", "shopee-search", "Shopee Affiliate product search failed", {
          error: String(error.message || error),
        });
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/videos/rank" && req.method === "POST") {
    addBackendLog("info", "api:shopee", "POST /api/shopee/videos/rank");
    readJsonBody(req)
      .then((payload) => sendExtensionCommand("checkShopeeVideoRanks", payload || {}, 600000, null, EXTENSION_ROLE_MAIN))
      .then((result) => {
        const ok = result?.ok !== false;
        res.writeHead(ok ? 200 : 503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ...result, ok }));
      })
      .catch((error) => {
        addBackendLog("error", "shopee-video-rank", "Shopee video rank lookup failed", {
          error: String(error.message || error),
        });
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/remix/videos" && req.method === "POST") {
    addBackendLog("info", "api:shopee-remix", "POST /api/shopee/remix/videos");
    readJsonBody(req)
      .then((payload) => sendExtensionCommand(
        "fetchShopeeReviewVideos",
        payload || {},
        600000,
        null,
        EXTENSION_ROLE_MAIN
      ))
      .then((result) => {
        const ok = result?.ok !== false;
        res.writeHead(ok ? 200 : 503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ...result, ok }));
      })
      .catch((error) => {
        addBackendLog("error", "shopee-remix", "Shopee review video fetch failed", {
          error: String(error.message || error),
        });
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/remix/render" && req.method === "POST") {
    addBackendLog("info", "api:shopee-remix", "POST /api/shopee/remix/render");
    readJsonBody(req, 2 * 1024 * 1024)
      .then((payload) => renderShopeeReviewRemix(payload || {}))
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        addBackendLog("error", "shopee-remix", "Shopee review remix render failed", {
          error: String(error.message || error),
        });
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  // /api/flow/generate, /api/flow/results, /api/flow/finalize-scenes, and the
  // old /api/flow/history* trio are no longer registered as public HTTP
  // routes — the flow-suite runner (lib/flow-suite/server/runner.js) calls
  // runFlowGenerate()/finalizeFlowScenes() in-process instead, and history
  // now lives in the flow-suite store (see /api/flow/state, /api/flow/history
  // DELETE below). The underlying functions stay for that in-process use.

  // ---- flow-suite: BlueSPite-ported Prompt/Queue/History engine ----
  if (requestUrl.pathname === "/api/flow/account" && req.method === "GET") {
    harvestGoogleLabsSession()
      .then(({ accountEmail }) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, accountEmail: accountEmail || extensionState.flowAccountEmail || "" }));
        broadcastFlowSuiteState();
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, accountEmail: extensionState.flowAccountEmail || "", error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/account" && req.method === "POST") {
    readJsonBody(req, 8 * 1024)
      .then((payload) => {
        const accountEmail = String(payload?.accountEmail || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) throw new Error("accountEmail is invalid");
        rememberFlowAccountEmail(accountEmail);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, accountEmail }));
        broadcastFlowSuiteState();
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/state" && req.method === "GET") {
    getFlowSuiteState()
      .then((state) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...state }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    getFlowSuiteState().then((state) => {
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }).catch(() => {});
    flowSuiteClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* client gone */ }
    }, 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      flowSuiteClients.delete(res);
    });
    return;
  }

  if (requestUrl.pathname === "/api/flow/preview" && req.method === "POST") {
    readJsonBody(req, 512 * 1024)
      .then(async (payload) => {
        const shared = await loadFlowSuiteShared();
        return shared.buildPrompt({
          product: payload.product || {}, direction: payload.direction || {},
          videoModel: payload.videoModel, ...shared.promptSetsFrom(payload),
          textMode: payload.textMode, sceneIndex: payload.sceneIndex,
        });
      })
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/test-rooms" && req.method === "POST") {
    addBackendLog("info", "api:flow-suite", "POST /api/flow/test-rooms");
    readJsonBody(req, 64 * 1024)
      .then(async (payload) => {
        const count = Math.max(1, Math.min(50, Number(payload?.count) || 20));
        const marker = String(payload?.marker || `AutoTik Concurrent ${Date.now()}`).slice(0, 120);
        const startedAt = Date.now();
        const settled = await Promise.allSettled(
          Array.from({ length: count }, (_, index) => createFlowRoom(`${marker} ${String(index + 1).padStart(2, "0")}`)),
        );
        const rooms = settled.map((item, index) => item.status === "fulfilled"
          ? { ok: true, index: index + 1, projectId: item.value }
          : { ok: false, index: index + 1, error: String(item.reason?.message || item.reason || "room create failed") });
        const succeeded = rooms.filter((room) => room.ok).length;
        const result = { ok: succeeded === count, count, succeeded, failed: count - succeeded, durationMs: Date.now() - startedAt, rooms };
        addBackendLog(result.ok ? "info" : "error", "flow", `Concurrent room test ${succeeded}/${count}`, {
          durationMs: result.durationMs,
          errors: rooms.filter((room) => !room.ok).map((room) => room.error).slice(0, 5),
        });
        return result;
      })
      .then((result) => {
        res.writeHead(result.ok ? 200 : 503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/test-image" && req.method === "POST") {
    addBackendLog("info", "api:flow-suite", "POST /api/flow/test-image");
    readJsonBody(req, 1024 * 1024)
      .then((payload) => getFlowSuiteRunner().testGenerateImage(payload))
      .then((result) => {
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(503, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/jobs" && req.method === "POST") {
    readJsonBody(req, 1024 * 1024)
      .then((payload) => {
        const items = Array.isArray(payload.items) ? payload.items : [payload];
        const created = items.map((item) => flowSuiteStore.addJob({
          platform: item.platform === "shopee" ? "shopee" : "tiktok",
          productId: item.productId || "",
          title: item.title || "",
          product: item.product || {},
          direction: item.direction || {},
          characterMode: item.characterMode === "consistent" ? "consistent" : "random",
          videoModel: item.videoModel || "",
          imageModel: item.imageModel || "",
          aspect: item.aspect || "portrait",
          sceneMode: FLOW_EXTENDED_ENABLED && item.sceneMode === "continuous" ? "continuous" : "independent",
          sceneCount: Math.max(1, Math.min(
            FLOW_EXTENDED_ENABLED && item.sceneMode === "continuous" ? 3 : 10,
            Number(item.sceneCount) || 1,
          )),
          textMode: item.textMode === "noText" ? "noText" : "withText",
          textRulesPrompt: String(item.textRulesPrompt || "").slice(0, 5000),
          speechRulesPrompt: String(item.speechRulesPrompt || "").slice(0, 5000),
          extraPrompt: String(item.extraPrompt || "").slice(0, 5000),
          imageContentPrompt: String(item.imageContentPrompt || "").slice(0, 5000),
          imageMandatoryPrompt: String(item.imageMandatoryPrompt || "").slice(0, 5000),
          sceneVideoPrompts: Array.isArray(item.sceneVideoPrompts)
            ? item.sceneVideoPrompts.slice(0, 10).map((prompt) => String(prompt || "").slice(0, 5000))
            : [],
          productImage: item.productImage || (item.product?.images || [])[0] || "",
          sourceUrl: item.sourceUrl || "",
          status: "queued",
        }));
        broadcastFlowSuiteState();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, jobs: created }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/jobs" && req.method === "DELETE") {
    readJsonBody(req, 64 * 1024)
      .then((payload) => {
        flowSuiteStore.clearJobs(Array.isArray(payload.ids) ? payload.ids : null);
        broadcastFlowSuiteState();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/history" && req.method === "DELETE") {
    readJsonBody(req, 8 * 1024)
      .then((payload) => {
        const status = String(payload.status || "");
        if (!["done", "failed", "cancelled"].includes(status)) throw new Error("status must be done, failed, or cancelled");
        const removed = flowSuiteStore.clearHistoryByStatus(status);
        broadcastFlowSuiteState();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, removed }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/jobs/cancel" && req.method === "POST") {
    readJsonBody(req, 8 * 1024)
      .then((payload) => {
        const ok = getFlowSuiteRunner().cancelJob(String(payload.id || ""));
        broadcastFlowSuiteState();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, cancelled: ok }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/jobs/retry" && req.method === "POST") {
    readJsonBody(req, 8 * 1024)
      .then((payload) => {
        const id = String(payload.id || "");
        const result = getFlowSuiteRunner().retryFailedJobs(id ? [id] : null, broadcastFlowSuiteState);
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, ...result }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/flow/queue/run" && req.method === "POST") {
    const result = getFlowSuiteRunner().startQueueWithFailedFallback(broadcastFlowSuiteState);
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, ...result }));
    return;
  }

  if (requestUrl.pathname === "/api/flow/queue/stop" && req.method === "POST") {
    const stopped = getFlowSuiteRunner().requestStop();
    broadcastFlowSuiteState();
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: true, stopped }));
    return;
  }

  if (requestUrl.pathname === "/api/flow/settings" && req.method === "POST") {
    readJsonBody(req, 64 * 1024)
      .then((payload) => {
        const settings = flowSuiteStore.updateSettings(payload);
        broadcastFlowSuiteState();
        res.writeHead(200, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: true, settings }));
      })
      .catch((error) => {
        res.writeHead(400, noCacheHeaders(types[".json"]));
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
      });
    return;
  }

  if (requestUrl.pathname === "/api/shopee/progress" && req.method === "GET") {
    res.writeHead(200, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({
      ok: true,
      progress: latestProgress.shopee,
    }));
    return;
  }

  // Serve finished clips out of the Video Library folder (outside ROOT, so the
  // normal static handler cannot reach them). Only plain filenames inside that
  // one folder are allowed — no traversal, no nested paths.
  if (requestUrl.pathname.startsWith("/library-file/")) {
    const libraryDir = readLibraryFolder();
    const name = path.basename(decodeURIComponent(requestUrl.pathname.slice("/library-file/".length)));
    const target = libraryDir ? path.join(libraryDir, name) : "";
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, noCacheHeaders(types[".json"]));
      res.end(JSON.stringify({ ok: false, error: "ไม่พบไฟล์ในคลังวิดีโอ" }));
      return;
    }
    const contentType = types[path.extname(target).toLowerCase()] || "application/octet-stream";
    const stat = fs.statSync(target);
    // Range support so the preview player can seek.
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stat.size - 1;
      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(target, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(target).pipe(res);
    return;
  }

  if (requestUrl.pathname === "/__live") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("event: ready\ndata: connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    res.writeHead(404, noCacheHeaders(types[".json"]));
    res.end(JSON.stringify({ ok: false, error: `Unknown API route: ${requestUrl.pathname}` }));
    return;
  }

  const filePath = safePath(requestUrl.pathname);
  sendStaticFile(req, res, filePath);
});

function sendIndexFallback(res) {
  fs.readFile(path.join(ROOT, "index.html"), (fallbackErr, fallbackBody) => {
    if (fallbackErr) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, noCacheHeaders(types[".html"]));
    res.end(fallbackBody);
  });
}

function sendStaticFile(req, res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      sendIndexFallback(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = types[ext] || "application/octet-stream";
    const isMedia = [".mp4", ".webm", ".mov"].includes(ext);
    if (!isMedia) {
      fs.readFile(filePath, (err, body) => {
        if (err) {
          sendIndexFallback(res);
          return;
        }
        res.writeHead(200, noCacheHeaders(contentType));
        res.end(body);
      });
      return;
    }

    const range = req.headers.range;
    const fileSize = stat.size;
    const headers = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    };

    if (!range) {
      res.writeHead(200, { ...headers, "Content-Length": fileSize });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const match = String(range).match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${fileSize}` });
      res.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${fileSize}` });
      res.end();
      return;
    }

    const chunkEnd = Math.min(end, fileSize - 1);
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${chunkEnd}/${fileSize}`,
      "Content-Length": chunkEnd - start + 1,
    });
    fs.createReadStream(filePath, { start, end: chunkEnd }).pipe(res);
  });
}

function websocketAcceptKey(key) {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function sendWsText(socket, data) {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

async function runFlowGenerate(payload, signal = null) {
  const requestedMediaType = String(payload.mediaType || "video").toLowerCase();
  const mediaType = requestedMediaType === "image" ? "image" : requestedMediaType === "extend" ? "extend" : "video";
  addBackendLog("info", "flow", `Flow generate requested: ${mediaType}`, {
    jobId: payload.jobId || null,
    source: payload.source || "google_labs",
    mode: payload.mode || "flow-clip8",
    hasProductImage: !!payload.options?.productImage,
    sceneCount: payload.options?.sceneCount || null,
    startImageMediaId: payload.options?.startImageMediaId || "",
    sourceMediaId: payload.options?.sourceMediaId || "",
    sceneId: payload.options?.sceneId || "",
  });
  const command = {
    source: payload.source || "google_labs",
    mode: payload.mode || "flow-clip8",
    prompt: payload.prompt || "",
    mediaType,
    count: Number(payload.count || 1) || 1,
    options: payload.options || {},
  };
  if (!command.prompt.trim()) throw new Error("Flow prompt is empty.");

  if (command.source === "google_labs") {
    return runGoogleFlowBackend(command, payload, signal);
  }

  const result = await sendExtensionCommand("generate", command, mediaType === "image" ? 180000 : 300000, null, EXTENSION_ROLE_MAIN, signal);
  return finalizeFlowMediaResult(result, payload.jobId || "flow", mediaType === "extend" ? "video" : mediaType);
}

const FLOW_RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
let legacyCaptchaProjectId = "";
const FLOW_ROOM_BATCH_WINDOW_MS = 35;
const FLOW_ROOM_BATCH_MAX = 50;
let pendingFlowRoomCreates = [];
let pendingFlowRoomTimer = null;

function scheduleFlowRoomBatch() {
  if (pendingFlowRoomTimer) return;
  pendingFlowRoomTimer = setTimeout(flushFlowRoomBatch, FLOW_ROOM_BATCH_WINDOW_MS);
}

async function flushFlowRoomBatch() {
  pendingFlowRoomTimer = null;
  const batch = pendingFlowRoomCreates.splice(0, FLOW_ROOM_BATCH_MAX);
  if (pendingFlowRoomCreates.length) scheduleFlowRoomBatch();
  if (!batch.length) return;
  const active = batch.filter((entry) => !entry.signal?.aborted);
  for (const entry of batch) {
    if (entry.signal?.aborted) entry.reject(new Error("ยกเลิกโดยผู้ใช้"));
  }
  if (!active.length) return;
  let result;
  try {
    result = await sendExtensionCommand(
      "flowRoomCreateBatch",
      { titles: active.map((entry) => entry.title) },
      120000,
      null,
      EXTENSION_ROLE_MAIN,
    );
  } catch (error) {
    result = { ok: false, error: String(error?.message || error), rooms: [] };
  }
  let rooms = Array.isArray(result?.rooms) ? result.rooms : [];
  // Backward-compatible bridge while Chrome is still running extension 0.1.18:
  // keep requests parallel instead of falling all the way back to the runner's
  // deliberately throttled REST room creator. Once 0.1.19 is reloaded, the
  // single batch command above is used and this branch stays cold.
  if (rooms.length !== active.length) {
    const legacy = await Promise.allSettled(active.map((entry) =>
      sendExtensionCommand("flowRoomCreate", { title: entry.title }, 90000, null, EXTENSION_ROLE_MAIN)));
    rooms = legacy.map((item) => {
      if (item.status === "rejected") return { ok: false, error: String(item.reason?.message || item.reason) };
      const projectId = String(item.value?.projectId || "").trim();
      return projectId
        ? { ok: true, projectId }
        : { ok: false, error: item.value?.error || result?.error || "Main Extension did not return a Flow projectId" };
    });
  }
  active.forEach((entry, index) => {
    if (entry.signal?.aborted) return entry.reject(new Error("ยกเลิกโดยผู้ใช้"));
    const room = rooms[index];
    const projectId = String(room?.projectId || "").trim();
    if (room?.ok && projectId) entry.resolve(projectId);
    else {
      const detail = String(room?.body || "").replace(/\s+/g, " ").slice(0, 240);
      entry.reject(new Error(`${room?.error || result?.error || "Main Extension did not return a Flow projectId"}${detail ? ` — ${detail}` : ""}`));
    }
  });
}

function createFlowRoom(title = "AutoTik AI Studio", signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("ยกเลิกโดยผู้ใช้"));
    pendingFlowRoomCreates.push({ title: String(title || "AutoTik AI Studio").slice(0, 200), signal, resolve, reject });
    scheduleFlowRoomBatch();
  });
}

async function submitExtendedVideo(payload, signal = null) {
  const result = await sendExtensionCommand(
    "flowExtendSubmit",
    payload,
    180000,
    null,
    EXTENSION_ROLE_MAIN,
    signal,
  );
  const mediaId = String(result?.mediaId || result?.pendingMediaName || result?.mediaName || "").trim();
  if (!mediaId) throw new Error(result?.error || "Main Extension did not return an Extended mediaId");
  return { ...result, mediaId, mediaName: mediaId, pendingMediaName: mediaId };
}

/** Submit one R2V / I2V generation through the Flow project page (MZZa6b / eb1hJf). */
async function submitFlowVideo(payload, signal = null) {
  const result = await sendExtensionCommand(
    "flowVideoSubmit",
    payload,
    180000,
    null,
    EXTENSION_ROLE_MAIN,
    signal,
  );
  const mediaId = String(result?.mediaId || result?.pendingMediaName || result?.mediaName || "").trim();
  if (!mediaId) throw new Error(result?.error || "Main Extension did not return a video mediaId");
  return { ...result, mediaId, mediaName: mediaId, pendingMediaName: mediaId };
}

/** One in-page status check (jwpduf) for a media id; resolves the signed clip
 *  URL (as29s) once Flow reports the clip done. Returns
 *  {done, url, failed, reason, status}. */
async function checkFlowMedia(payload, signal = null) {
  const result = await sendExtensionCommand(
    "flowMediaStatus",
    payload,
    90000,
    null,
    EXTENSION_ROLE_MAIN,
    signal,
  );
  if (!result || result.ok === false) throw new Error(result?.error || "Main Extension could not read Flow media status");
  return {
    done: result.done === true,
    url: String(result.url || ""),
    thumbnailUrl: String(result.thumbnailUrl || ""),
    failed: result.failed === true,
    reason: String(result.reason || ""),
    status: String(result.status || ""),
  };
}

/** Mint one reCAPTCHA token through the Main Extension. Shared by the Python
 *  bridge path below and by the flow-suite runner, which now calls Flow directly
 *  and mints its own token per attempt. */
async function mintFlowCaptcha(captchaAction, projectId = "", signal = null) {
  // Backward-compatible overload for the older single-media bridge path, whose
  // callers used mintFlowCaptcha(action, signal). Any project page can mint a
  // token for any room, so keep one harmless room for those legacy calls.
  if (projectId && typeof projectId === "object") {
    signal = projectId;
    projectId = "";
  }
  let roomId = String(projectId || "").trim();
  if (!roomId) {
    if (!legacyCaptchaProjectId) legacyCaptchaProjectId = await createFlowRoom("AutoTik Captcha", signal);
    roomId = legacyCaptchaProjectId;
  }
  const minted = await sendExtensionCommand("mintCaptcha", {
    siteKey: FLOW_RECAPTCHA_SITE_KEY,
    captchaAction,
    projectId: roomId,
  }, 150000, null, EXTENSION_ROLE_MAIN, signal);
  if (!minted?.token) throw new Error(`Main Extension did not mint ${captchaAction} reCAPTCHA`);
  return minted.token;
}

async function refreshFlowCaptcha(projectId = "", signal = null) {
  if (projectId && typeof projectId === "object") {
    signal = projectId;
    projectId = "";
  }
  const roomId = String(projectId || legacyCaptchaProjectId || "").trim();
  if (!roomId) throw new Error("Flow projectId is required to refresh reCAPTCHA");
  const refreshed = await sendExtensionCommand("refreshCaptcha", {
    provider: "google_flow",
    projectId: roomId,
  }, 150000, null, EXTENSION_ROLE_MAIN, signal);
  if (refreshed?.ok === false) throw new Error(refreshed.error || "Main Extension could not refresh reCAPTCHA");
  return refreshed;
}

/** Harvest the labs.google cookies through the Main Extension, waking the Flow tab
 *  first if the profile has not opened one yet. Returns BOTH candidates in the
 *  order the Python bridge tried them — the combined labs+google-sso cookie can be
 *  present yet rejected, in which case the labs-only cookie still works. */
async function harvestFlowCookies(signal = null) {
  // Ensure the one shared Flow app tab exists before reading the allowlisted
  // session cookies. Do not mint a fake SESSION_WARMUP captcha: grecaptcha is
  // intentionally absent from the Flow home page.
  try {
    await sendExtensionCommand("ensureFlowTab", { connectLabs: true }, 90000, null, EXTENSION_ROLE_MAIN, signal);
  } catch (error) {
    addBackendLog("warn", "flow", "Flow tab warm-up failed; harvesting cookies anyway", {
      error: String(error?.message || error),
    });
  }
  const harvest = await harvestGoogleLabsSession(signal);
  return [harvest.cookieInject, harvest.cookie].map(toCookieHeader).filter(Boolean);
}

/** The Main Extension reports cookies the way chrome.cookies does — an array of
 *  {name, value, ...} records, sometimes JSON-encoded as a string. The direct Flow
 *  client needs a plain `name=value; name=value` request header, so normalise
 *  whichever shape arrives. A string that is already a header passes through. */
function toCookieHeader(value) {
  if (!value) return "";
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text.startsWith("[") && !text.startsWith("{")) return text;
    try { raw = JSON.parse(text); } catch { return text; }
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((c) => (c && typeof c === "object" && c.name ? `${c.name}=${c.value ?? ""}` : ""))
    .filter(Boolean)
    .join("; ");
}

// The Flow account is never pinned: whichever Google account is signed in on
// the Chrome profile's Flow tab at harvest time is the one used, and the email
// shown in the UI is only a live label for that. Nothing is persisted, and a
// leftover flow-account.json from older builds is removed so it cannot seed
// a stale identity.
function loadRememberedFlowAccountEmail() {
  try {
    if (fs.existsSync(FLOW_ACCOUNT_FILE)) fs.unlinkSync(FLOW_ACCOUNT_FILE);
  } catch (_) {
    /* best effort */
  }
  return "";
}

/** Update the live Flow account label (in-memory only). Passing a blank value
 *  clears it — a harvest that cannot see an account must not keep showing the
 *  previous one. */
function rememberFlowAccountEmail(value) {
  const accountEmail = String(value || "").trim().toLowerCase();
  extensionState.flowAccountEmail = accountEmail;
  const socket = activeExtensionSocket(EXTENSION_ROLE_MAIN);
  if (socket) touchExtensionSocket(socket, { flowAccountEmail: accountEmail });
  return accountEmail;
}

async function detectFlowAccountEmail(cookieHeader, signal = null) {
  if (!cookieHeader) return "";
  // The NextAuth session on labs.google carries the signed-in user — the same
  // call the Flow client already makes for its access_token. Cheapest and most
  // reliable source; the HTML scrape below is only the fallback.
  try {
    const response = await fetch("https://labs.google/fx/api/auth/session", {
      signal,
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
        Referer: "https://labs.google/fx",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    });
    const data = response.ok ? await response.json().catch(() => null) : null;
    addBackendLog("debug", "flow", "labs session probe for account email", {
      status: response.status,
      keys: data && typeof data === "object" ? Object.keys(data) : [],
      userKeys: data?.user && typeof data.user === "object" ? Object.keys(data.user) : [],
    });
    const email = String(data?.user?.email || data?.email || "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  } catch (_) {
    /* fall through to the HTML scrape */
  }
  try {
    const response = await fetch("https://flow.google.com/", {
      redirect: "follow",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
        Cookie: cookieHeader,
        "User-Agent": "Mozilla/5.0 Chrome/140 Safari/537.36",
      },
    });
    if (!response.ok) return "";
    const html = (await response.text())
      .replace(/\\u0040|\\x40|&#64;|&#x40;|&commat;/gi, "@");
    const matches = html.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
    const candidates = [...new Set(matches.map((email) => email.toLowerCase()))]
      .filter((email) => !/^(?:support|noreply|no-reply|example)@/i.test(email))
      .filter((email) => !/@(?:google\.com|gstatic\.com|googleapis\.com)$/i.test(email));
    candidates.sort((a, b) => Number(b.endsWith("@gmail.com")) - Number(a.endsWith("@gmail.com")));
    return candidates[0] || "";
  } catch (_) {
    return "";
  }
}

async function harvestGoogleLabsSession(signal = null) {
  addBackendLog("info", "flow", "Harvesting Google Labs session from extension");
  // Up to 75s of that is the extension waiting on https://labs.google/fx for the
  // session cookie (SSO settle / operator sign-in), so give it head-room.
  let harvest = await sendExtensionCommand("harvestLabs", {}, 150000, null, EXTENSION_ROLE_MAIN, signal);
  let cookieInject = harvest.cookieInject || "";
  let labsCookie = harvest.cookie || "";
  let cookie = cookieInject || labsCookie;

  // Compatibility/recovery path: explicitly wake the Flow app tab, let SSO
  // settle, then harvest once more before surfacing a login requirement.
  if (!cookie) {
    addBackendLog("warn", "flow", "Google Labs session missing; waking Flow through Main Extension");
    let flowTabWarmed = false;
    try {
      await sendExtensionCommand("ensureFlowTab", { connectLabs: true }, 90000, null, EXTENSION_ROLE_MAIN, signal);
      flowTabWarmed = true;
      await sleep(1200);
      const retryHarvest = await sendExtensionCommand("harvestLabs", {}, 150000, null, EXTENSION_ROLE_MAIN, signal);
      harvest = {
        ...retryHarvest,
        labsTabOpened: retryHarvest.labsTabOpened === true || flowTabWarmed,
      };
      cookieInject = harvest.cookieInject || "";
      labsCookie = harvest.cookie || "";
      cookie = cookieInject || labsCookie;
    } catch (error) {
      harvest = {
        ...harvest,
        labsTabOpened: harvest.labsTabOpened === true || flowTabWarmed,
        error: harvest.error || String(error?.message || error),
      };
    }
  }

  if (!cookie) {
    addBackendLog("error", "flow", "Main Extension did not return Google Labs cookies", {
      extensionConnected: !!activeExtensionSocket(EXTENSION_ROLE_MAIN),
      extensionOk: harvest.ok === true,
      labsTabOpened: harvest.labsTabOpened === true,
      requiresLogin: harvest.requiresLogin === true,
      extensionError: harvest.error || "",
    });
    if (harvest.requiresLogin || harvest.labsTabOpened) {
      throw new Error("เปิด https://labs.google/fx ให้แล้ว แต่ Chrome โปรไฟล์นี้ยังไม่ได้ล็อกอิน Google — ล็อกอินในแท็บที่เปิดขึ้นมา แล้วกดเชื่อม Flow / เริ่มคิวอีกครั้ง");
    }
    throw new Error(`Main Extension could not read Google Labs cookies.${harvest.error ? ` ${harvest.error}` : ""}`);
  }
  let accountEmail = String(harvest.accountEmail || "").trim().toLowerCase();
  // Try the labs-only jar first: the combined labs+google-sso jar is the one
  // the session endpoint sometimes answers with an empty {} for.
  for (const candidate of [labsCookie, cookieInject].map(toCookieHeader).filter(Boolean)) {
    if (accountEmail) break;
    accountEmail = await detectFlowAccountEmail(candidate, signal);
  }
  accountEmail = rememberFlowAccountEmail(accountEmail);
  addBackendLog("info", "flow", "Google Labs session harvested", {
    cookieLength: cookie.length,
    hasCookieInject: !!harvest.cookieInject,
    labsCookieLength: String(harvest.cookie || "").length,
    cookieMode: harvest.cookieInject ? "labs+google-sso" : "labs-only",
    accountEmail: accountEmail || "unknown",
  });
  return { cookie: labsCookie, cookieInject, accountEmail };
}

async function runGoogleFlowBackend(command, payload, signal = null) {
  const { cookie: labsCookie, cookieInject } = await harvestGoogleLabsSession(signal);

  const bridgePayload = {
    ...command,
    cookie: labsCookie,
    cookieInject,
    options: { ...(command.options || {}) },
  };

  if (command.mediaType === "image" || (command.mediaType === "video" && !bridgePayload.options.startImageMediaId)) {
    addBackendLog("info", "flow", "Minting image reCAPTCHA token");
    const imageCaptcha = await mintFlowCaptcha("IMAGE_GENERATION", bridgePayload.options.projectId || "", signal);
    addBackendLog("info", "flow", "Image reCAPTCHA token received", { hasToken: !!imageCaptcha });
    bridgePayload.imageCaptcha = imageCaptcha;
  }

  if (command.mediaType === "video" || command.mediaType === "extend") {
    addBackendLog("info", "flow", "Minting video reCAPTCHA token");
    const videoCaptcha = await mintFlowCaptcha("VIDEO_GENERATION", bridgePayload.options.projectId || "", signal);
    addBackendLog("info", "flow", "Video reCAPTCHA token received", { hasToken: !!videoCaptcha });
    bridgePayload.videoCaptcha = videoCaptcha;
  }

  addBackendLog("info", "flow", "Running AutoGT Pro Flow backend bridge", {
    mediaType: command.mediaType,
    hasStartImageMediaId: !!bridgePayload.options.startImageMediaId,
    hasSourceMediaId: !!bridgePayload.options.sourceMediaId,
    hasSceneId: !!bridgePayload.options.sceneId,
    hasProjectId: !!bridgePayload.options.projectId,
    hasProductImage: !!bridgePayload.options.productImage,
  });
  const result = await runFlowBridge(bridgePayload, signal);
  addBackendLog("info", "flow", "AutoGT Pro Flow backend bridge finished", {
    mediaType: result.mediaType,
    mediaId: result.mediaId || "",
    workflowId: result.workflowId || "",
    projectId: result.projectId || "",
    referenceImageIds: result.referenceImageIds || [],
  });
  return finalizeFlowMediaResult(result, payload.jobId || "flow", command.mediaType === "extend" ? "video" : command.mediaType);
}

function runFlowBridge(payload, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("ยกเลิกโดยผู้ใช้"));
      return;
    }
    const candidates = [
      { cmd: "py", args: ["-3.11", FLOW_BRIDGE_SCRIPT] },
      { cmd: "python", args: [FLOW_BRIDGE_SCRIPT] },
    ];
    let index = 0;
    let onAbort = null;
    const cleanupAbort = () => { if (onAbort) signal?.removeEventListener("abort", onAbort); };
    const tryNext = (lastError) => {
      if (index >= candidates.length) {
        cleanupAbort();
        reject(lastError || new Error("Python 3.11 is not available."));
        return;
      }
      const candidate = candidates[index++];
      const child = spawn(candidate.cmd, candidate.args, {
        cwd: ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      let stdout = "";
      let stderr = "";
      let stderrCarry = "";
      let aborted = false;
      const killTimer = setTimeout(() => {
        addBackendLog("error", "flow:bridge", "Flow backend bridge timed out");
        child.kill("SIGTERM");
      }, 360000);
      onAbort = () => {
        aborted = true;
        clearTimeout(killTimer);
        child.kill("SIGTERM");
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        stderrCarry += text;
        const lines = stderrCarry.split(/\r?\n/);
        stderrCarry = lines.pop() || "";
        for (const line of lines) {
          const clean = line.trim();
          if (clean) addBackendLog("info", "flow:bridge", clean);
        }
      });
      child.on("error", tryNext);
      child.on("close", (code) => {
        clearTimeout(killTimer);
        cleanupAbort();
        if (aborted) {
          reject(new Error("ยกเลิกโดยผู้ใช้"));
          return;
        }
        if (stderrCarry.trim()) addBackendLog("info", "flow:bridge", stderrCarry.trim());
        let parsed = null;
        try {
          parsed = JSON.parse((stdout || "").trim() || "{}");
        } catch (error) {
          const message = `Flow backend returned invalid JSON: ${stderr || stdout || error.message}`;
          addBackendLog("error", "flow:bridge", message);
          reject(new Error(message));
          return;
        }
        if (code !== 0 || parsed.ok === false) {
          const message = parsed.error || stderr || `Flow backend exited with code ${code}`;
          addBackendLog("error", "flow:bridge", message, { code, stdout: stdout.slice(0, 1000) });
          reject(new Error(message));
          return;
        }
        resolve(parsed);
      });
      child.stdin.end(JSON.stringify(payload));
    };
    tryNext();
  });
}

function pickFlowResultValue(source, keys) {
  const seen = new Set();
  const queue = [source];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of keys) {
      const value = current[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return "";
}

function pickFlowMediaUrl(result, mediaType) {
  const preferred = mediaType === "image"
    ? ["localUrl", "imageUrl", "mediaUrl", "url", "downloadUrl", "thumbnailUrl", "outputUrl"]
    : ["localUrl", "videoUrl", "mediaUrl", "url", "downloadUrl", "outputUrl"];
  return pickFlowResultValue(result, preferred);
}

function writeFlowResultMeta(jobId, mediaType, payload) {
  try {
    fs.mkdirSync(FLOW_RESULTS_DIR, { recursive: true });
    const safeJob = safeFlowJobName(jobId);
    const file = path.join(FLOW_RESULTS_DIR, `${safeJob}-${mediaType}.json`);
    fs.writeFileSync(file, JSON.stringify({
      ok: true,
      jobId,
      mediaType,
      updatedAt: new Date().toISOString(),
      payload,
    }, null, 2), "utf8");
  } catch (error) {
    addBackendLog("warn", "flow", "Cannot write Flow result metadata", { jobId, mediaType, error: String(error.message || error) });
  }
}

async function finalizeFlowMediaResult(result, jobId, mediaType) {
  const mediaUrl = pickFlowMediaUrl(result, mediaType);
  const saved = mediaUrl ? await saveFlowMedia(mediaUrl, jobId, mediaType).catch((error) => ({
    ok: false,
    error: String(error.message || error),
  })) : null;
  const localUrl = saved?.url || "";
  const payload = {
    action: "generate",
    mediaType: result.mediaType || mediaType,
    mediaUrl,
    localUrl,
    resultUrl: mediaUrl || localUrl,
    imageUrl: result.imageUrl || result.startImageUrl || (mediaType === "image" ? (localUrl || mediaUrl) : ""),
    videoUrl: mediaType === "video" ? (mediaUrl || localUrl) : "",
    saved,
    raw: result,
    mediaId: result.mediaId || pickFlowResultValue(result, ["mediaId", "media_id", "id"]) || "",
    workflowId: result.workflowId || pickFlowResultValue(result, ["workflowId", "workflow_id"]) || "",
    sceneId: result.sceneId || pickFlowResultValue(result, ["sceneId", "scene_id"]) || "",
    projectId: result.projectId || pickFlowResultValue(result, ["projectId", "project_id"]) || "",
    startImageMediaId: result.startImageMediaId || "",
    referenceImageIds: result.referenceImageIds || [],
    canExtend: !!result.canExtend,
  };
  writeFlowResultMeta(jobId, mediaType, payload);
  addBackendLog("info", "flow", "Flow media finalized for app", {
    jobId,
    mediaType,
    hasMediaUrl: !!mediaUrl,
    hasLocalUrl: !!localUrl,
    mediaId: payload.mediaId,
    projectId: payload.projectId,
    savedError: saved?.error || "",
  });
  return payload;
}

function safeFlowJobName(jobId) {
  return String(jobId || "flow").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
}

// Keep the readable name (Thai included) and drop only what Windows rejects in
// a filename. The old rule allowed [a-z0-9_-] only, which turned every Thai
// product title into a row of dashes — that is why the id was used instead, and
// why nothing downstream could match a clip back to its product by name.
function safeFinalFilePart(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 80)
    .trim();
}

// A product can be rendered more than once. Keep the requested Product ID +
// title format without silently overwriting an earlier finished clip.
function uniqueFinalFileBaseName(videoDir, preferredBaseName, extension = ".mp4") {
  const desired = String(preferredBaseName || "").trim() || "video";
  let candidate = desired;
  let copy = 2;
  while (fs.existsSync(path.join(videoDir, `${candidate}${extension}`))) {
    candidate = `${desired} (${copy})`;
    copy += 1;
  }
  return candidate;
}

function buildFinalFileBaseName(videoDir, productId, productName, jobId) {
  const safeProductId = safeFinalFilePart(productId);
  const safeProductName = safeFinalFilePart(productName);
  const preferred = [safeProductId, safeProductName].filter(Boolean).join("-")
    || safeFlowJobName(jobId);
  return uniqueFinalFileBaseName(videoDir, preferred);
}

// The desktop app's Video Library folder, as chosen with its Browse button and
// stored in library_source.json next to the app. Read per call so a folder the
// user changes at runtime is picked up without restarting this server.
function readLibraryFolder() {
  const appDir = process.env.AUTOGT_APP_DIR || path.join(ROOT, "..");
  try {
    const raw = fs.readFileSync(path.join(appDir, "library_source.json"), "utf8");
    const folder = String(JSON.parse(raw)?.folder || "").trim();
    return folder && fs.existsSync(folder) ? folder : "";
  } catch {
    return "";
  }
}

// ---- POST WEB: AI caption/hashtag providers --------------------------------

const POSTWEB_AI_PROVIDERS = ["openai", "gemini", "openrouter"];
const POSTWEB_AI_DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
};

function readPostWebAiSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(POSTWEB_AI_FILE, "utf8"));
    const keys = raw && typeof raw.keys === "object" ? raw.keys : {};
    return {
      provider: POSTWEB_AI_PROVIDERS.includes(raw?.provider) ? raw.provider : "openai",
      keys: {
        openai: String(keys.openai || ""),
        gemini: String(keys.gemini || ""),
        openrouter: String(keys.openrouter || ""),
      },
      models: raw && typeof raw.models === "object" ? raw.models : {},
      // Off unless switched on: captioning spends API credit per clip, so it
      // never starts on its own just because a key happens to be saved.
      captionAi: raw?.captionAi === true,
    };
  } catch {
    return { provider: "openai", keys: { openai: "", gemini: "", openrouter: "" }, models: {}, captionAi: false };
  }
}

// Only these keys are stored, and each is coerced to its expected type — the
// page posts whatever is in its form, and this file is read straight back into
// the UI on the next open.
const POSTWEB_SETTING_FIELDS = {
  accountKey: "string",
  mode: "string",
  scheduleAt: "string",
  caption: "string",
  hashtags: "string",
  scheduleGap: "number",
  aiLabel: "boolean",
  disclose: "boolean",
  cartEnabled: "boolean",
  cartDefaultOn: "boolean",
};

// ---- plain-language logs ---------------------------------------------------
// The Log docks are read by an operator, not a developer: no RPC traces, no
// JSON payloads, no socket/job ids. Both pages read the same feed through
// /api/logs/friendly so the wording only has to be maintained once.
//
// audience "studio" = what is happening to each clip being generated.
// audience "post"   = what is happening to each TikTok post, for every channel.

/** Anything that is pure plumbing and means nothing to an operator. */
const FRIENDLY_LOG_NOISE = [
  /^\[[a-z0-9]+\]\s*[✓✗]/i,            // flow-client RPC traces
  /^(send command|ext\.result|command (failed|timed out|result rejected))/i,
  /^(GET|POST|DELETE|PUT)\s+\//,
  /^(WebSocket|Extension hello|AutoGT Pro server|Backend logs cleared)/i,
  /reCAPTCHA|mintCaptcha|harvestLabs|Harvesting Google Labs|access token/i,
];

function friendlyClipTitle(text, max = 42) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Strip anything code-shaped out of a reason before showing it. */
function friendlyReason(text, max = 90) {
  let clean = String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/data:[^\s,]+,\S*/g, "")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/quota|429|rate.?limit|RESOURCE_EXHAUSTED/i.test(text)) clean = "โควตาเต็มหรือถูกจำกัดจำนวนครั้ง";
  else if (/401|unauthor|cookie rejected|signed out|session expired/i.test(text)) clean = "ต้องล็อกอิน Google/TikTok ใหม่";
  else if (/captcha|unusual activity/i.test(text)) clean = "ติด captcha";
  else if (/AUDIO_GENERATION_FILTERED|AUDIO_FILTER/i.test(text)) clean = "เสียงถูกระบบกรอง";
  else if (/NOT_FOUND/i.test(text)) clean = "ระบบไม่รู้จักโมเดลที่เลือก";
  else if (/not readable|ไม่รองรับ/i.test(text)) clean = "ไฟล์คลิปอ่านไม่ได้";
  else if (/timed out|นานเกินกำหนด/i.test(text)) clean = "รอนานเกินกำหนด";
  else if (/not connected/i.test(text)) clean = "ส่วนขยาย Chrome ยังไม่เชื่อมต่อ";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** One clip-generation line, in plain Thai. Returns "" to hide the row. */
function friendlyStudioLine(entry) {
  const msg = String(entry?.msg || "");
  if (entry?.level === "debug") return "";
  if (FRIENDLY_LOG_NOISE.some((re) => re.test(msg))) return "";

  let m;
  if ((m = /^เริ่มงาน:\s*(.+)$/.exec(msg))) return `เริ่มสร้างคลิป — ${friendlyClipTitle(m[1])}`;
  if ((m = /^เสร็จ:\s*(.+)$/.exec(msg))) return `สร้างคลิปเสร็จแล้ว — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(ล้มเหลว|ยกเลิก):\s*(.+?)\s*—\s*([\s\S]*)$/.exec(msg))) {
    const what = m[1] === "ยกเลิก" ? "ยกเลิกคลิป" : "สร้างคลิปไม่สำเร็จ";
    const why = friendlyReason(m[3]);
    return `${what} — ${friendlyClipTitle(m[2])}${why ? ` (${why})` : ""}`;
  }
  if ((m = /^(.+?):\s*สร้างภาพเฟรมแรก/.exec(msg))) return `กำลังสร้างภาพปก — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*ข้ามขั้นตอนสร้างภาพ/.exec(msg))) return `ใช้รูปสินค้าเป็นภาพปก — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*สร้างวิดีโอ/.exec(msg))) return `กำลังสร้างวิดีโอ — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*รออยู่\s*(\d+)s/.exec(msg))) return `กำลังประมวลผล ${m[2]} วินาที — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*กำลังต่อ\s*(\d+)\s*ฉาก/.exec(msg))) return `กำลังต่อ ${m[2]} ฉากเป็นคลิปเดียว — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*อัปโหลดรูปอ้างอิง/.exec(msg))) return `กำลังอัปโหลดรูปสินค้า — ${friendlyClipTitle(m[1])}`;
  if ((m = /^(.+?):\s*ล้มเหลวในห้องเดิม\s*\((\d+)\/(\d+)\)/.exec(msg))) {
    return `ลองใหม่ครั้งที่ ${m[2]} — ${friendlyClipTitle(m[1])}`;
  }
  if (/เปิดห้อง Flow ใหม่/.test(msg)) return `เปิดพื้นที่ทำงานใหม่แล้วลองต่อ`;
  if (/^สร้างโปรเจกต์ Flow ใหม่/.test(msg)) return "";
  if (/^เริ่มรันคิว/.test(msg)) return "เริ่มรันคิว";
  if (/^หยุดคิวแล้ว/.test(msg)) return "หยุดคิวแล้ว";
  if (/^ขอหยุดคิว/.test(msg)) return "กำลังหยุดคิว";
  if (/โดน rate limit/.test(msg)) return "ถูกจำกัดจำนวนครั้ง กำลังรอแล้วลองใหม่";
  if (/เจอ captcha/.test(msg)) return "ติด captcha กำลังขอใหม่";
  if (/session\/cookie/.test(msg)) return "ต้องล็อกอิน Google ใหม่";
  if (/^ทดสอบสร้างรูป/.test(msg)) return msg.replace(/^ทดสอบสร้างรูป/, "ทดสอบสร้างภาพ");

  // Unmapped but human enough — still scrub anything code-shaped out of it.
  const clean = friendlyReason(msg, 140);
  return clean.length > 3 ? clean : "";
}

/** One TikTok-posting line, in plain Thai. Returns "" to hide the row. */
function friendlyPostLine(row) {
  const msg = String(row?.message || "");
  const detail = row?.detail && typeof row.detail === "object" ? row.detail : {};
  if (FRIENDLY_LOG_NOISE.some((re) => re.test(msg))) return "";

  const channel = String(detail.account || detail.uniqueId || "").replace(/^@/, "");
  const who = channel ? ` (@${channel})` : "";
  if (/Sending clip to TikTok Web extension/i.test(msg)) {
    return `กำลังส่งคลิปไปโพสต์${who}${detail.captionPreview ? ` — ${friendlyClipTitle(detail.captionPreview, 60)}` : ""}`;
  }
  if (/TikTok Web publish finished/i.test(msg)) {
    const note = String(detail.note || "");
    if (/draft/i.test(note)) return `บันทึกเป็นฉบับร่างแล้ว${who}`;
    if (/schedul/i.test(note)) return `ตั้งเวลาโพสต์แล้ว${who}`;
    return `โพสต์ลง TikTok สำเร็จ${who}`;
  }
  if (/TikTok Web publish failed/i.test(msg)) {
    const why = friendlyReason(detail.error || msg);
    return `โพสต์ไม่สำเร็จ${who}${why ? ` — ${why}` : ""}`;
  }
  if (/สร้างแคปชั่นด้วย AI แล้ว/.test(msg)) return "AI คิดแคปชั่นและแฮชแท็กให้แล้ว";
  if (/สร้างแคปชั่นด้วย AI ไม่สำเร็จ/.test(msg)) return `AI คิดแคปชั่นไม่สำเร็จ — ${friendlyReason(detail.error || "")}`;
  if (/ทดสอบ API key สำเร็จ/.test(msg)) return "ทดสอบ API key ผ่าน";
  if (/ทดสอบ API key ไม่สำเร็จ/.test(msg)) return `ทดสอบ API key ไม่ผ่าน — ${friendlyReason(detail.error || "")}`;
  if (/บันทึกตั้งค่า AI/.test(msg)) return "บันทึกการตั้งค่า AI แล้ว";
  if (/unavailable; opening its Chrome profile/i.test(msg)) return "กำลังเปิด Chrome ของช่องนี้ให้";
  if (/(ready|connected); retrying command/i.test(msg)) return "ส่วนขยาย Chrome พร้อมแล้ว กำลังลองใหม่";
  return "";
}

function readPostWebSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(POSTWEB_SETTINGS_FILE, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? sanitizePostWebSettings(raw) : {};
  } catch {
    return {};
  }
}

function sanitizePostWebSettings(input) {
  const out = {};
  for (const [field, kind] of Object.entries(POSTWEB_SETTING_FIELDS)) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (kind === "string") out[field] = String(value).slice(0, 4000);
    else if (kind === "number") { const n = Number(value); if (Number.isFinite(n)) out[field] = n; }
    else out[field] = !!value;
  }
  return out;
}

function writePostWebSettings(settings) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(POSTWEB_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function writePostWebAiSettings(settings) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(POSTWEB_AI_FILE, JSON.stringify(settings, null, 2), "utf8");
}

// Never return a key to the browser — only enough to show it is set.
function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "";
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function postWebAiModel(settings, provider) {
  return String(settings.models?.[provider] || POSTWEB_AI_DEFAULT_MODELS[provider] || "");
}

// A cheap read-only call per provider, used by the Test button. Chosen so the
// check validates the key without spending tokens.
async function testPostWebAiKey(provider, key) {
  const timeout = AbortSignal.timeout(15000);
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: timeout,
    });
    if (!res.ok) throw new Error(`OpenAI ตอบกลับ ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return { models: Array.isArray(data.data) ? data.data.length : 0 };
  }
  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: timeout }
    );
    if (!res.ok) throw new Error(`Gemini ตอบกลับ ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return { models: Array.isArray(data.models) ? data.models.length : 0 };
  }
  if (provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: timeout,
    });
    if (!res.ok) throw new Error(`OpenRouter ตอบกลับ ${res.status}`);
    return { models: 0 };
  }
  throw new Error(`ไม่รู้จัก provider: ${provider}`);
}

function postWebCaptionPrompt(productName) {
  return [
    "เขียนแคปชั่นภาษาไทยสำหรับคลิปขายสินค้าบน TikTok",
    `ชื่อสินค้า: ${productName}`,
    "",
    "เขียนแบบคลิปที่ทำยอดขายได้จริงบน TikTok Shop ไทย ไม่ใช่โฆษณาแข็งๆ",
    "",
    "เงื่อนไข:",
    "- แคปชั่น 1-2 ประโยค กระชับ ชวนซื้อ ไม่เกิน 150 ตัวอักษร",
    "- ขึ้นต้นด้วยประโยคที่หยุดนิ้วคนดูได้ใน 1 วินาที (ปัญหาที่เจอ หรือผลลัพธ์ที่อยากได้)",
    "- พูดถึงจุดขายที่รู้สึกได้จริง 1 อย่าง ไม่ต้องไล่สเปก",
    "- ปิดท้ายด้วย call to action สั้นๆ ให้กดตะกร้า",
    "- ห้ามใช้คำโฆษณาเกินจริง เช่น ที่สุด/อันดับ1/รับประกัน/หายขาด/เห็นผล100%",
    "- ห้ามใส่ราคาหรือส่วนลดที่ไม่ได้ให้มา",
    "- แฮชแท็ก 5-8 อัน ภาษาไทยผสมอังกฤษได้ ไม่ต้องใส่ #",
    "- แฮชแท็กให้ผสม 3 กลุ่ม: คำที่คนค้นหาสินค้านี้จริง, หมวดสินค้า, และแท็กกว้างที่ดันการมองเห็น (fyp, ของดีบอกต่อ, tiktokshop)",
    "- เรียงแฮชแท็กจากเจาะจงที่สุดไปกว้างที่สุด",
    "",
    'ตอบเป็น JSON อย่างเดียว: {"caption":"...","hashtags":["...","..."]}',
  ].join("\n");
}

// Pull the JSON object out of a model reply that may be fenced or chatty.
function parseCaptionReply(text) {
  const raw = String(text || "");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("โมเดลไม่ได้ตอบเป็น JSON");
  const parsed = JSON.parse(body.slice(start, end + 1));
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
  return {
    caption: String(parsed.caption || "").trim(),
    hashtags: hashtags.map((tag) => String(tag).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10),
  };
}

async function generatePostWebCaption(productName) {
  const settings = readPostWebAiSettings();
  const provider = settings.provider;
  const key = settings.keys[provider];
  if (!key) throw new Error(`ยังไม่ได้ใส่ API key ของ ${provider}`);
  const model = postWebAiModel(settings, provider);
  const prompt = postWebCaptionPrompt(productName);
  const timeout = AbortSignal.timeout(60000);

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: timeout,
      }
    );
    if (!res.ok) throw new Error(`Gemini ตอบกลับ ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
    return { ...parseCaptionReply(text), provider, model };
  }

  // OpenAI and OpenRouter share the chat-completions shape.
  const endpoint = provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
    }),
    signal: timeout,
  });
  if (!res.ok) throw new Error(`${provider} ตอบกลับ ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { ...parseCaptionReply(text), provider, model };
}

function finalPlatformKey(platform = "", sourceUrl = "") {
  const value = `${platform || ""} ${sourceUrl || ""}`.toLowerCase();
  return value.includes("shopee") ? "Shopee" : "TikTok";
}

function finalPlatformDirs(platform = "", sourceUrl = "") {
  const key = finalPlatformKey(platform, sourceUrl);
  // TikTok finals go straight into the app's Video Library folder — that folder
  // is this project's default home for finished clips, and putting them there
  // directly (instead of Final-File/TikTok plus a copy) means one file, one
  // place, already named after its product for the POST WEB matcher.
  const libraryDir = key === "TikTok" ? readLibraryFolder() : "";
  return {
    key,
    videoDir: libraryDir || path.join(FINAL_FILE_DIR, key),
    jsDir: path.join(FINAL_FILE_JS_DIR, key),
  };
}

function writeFinalFileJsMeta(baseName, payload, platform = payload?.platform || "", sourceUrl = payload?.sourceUrl || "") {
  const dirs = finalPlatformDirs(platform, sourceUrl);
  fs.mkdirSync(dirs.jsDir, { recursive: true });
  const jsName = `${baseName}.js`;
  const jsFile = path.join(dirs.jsDir, jsName);
  const fallbackName = payload?.productId || payload?.productID
    ? `สินค้า ${payload.productId || payload.productID}`
    : "";
  const safePayload = {
    ...payload,
    productName: cleanUtf8DisplayText(payload?.productName || payload?.title || "", fallbackName),
  };
  safePayload.caption = cleanUtf8DisplayText(payload?.caption || safePayload.productName || "", safePayload.productName || fallbackName);
  const data = JSON.stringify(safePayload, null, 2);
  const body = [
    `const AUTO_GT_FINAL_FILE = ${data};`,
    `if (typeof window !== "undefined") window.AUTO_GT_FINAL_FILE = AUTO_GT_FINAL_FILE;`,
    `if (typeof module !== "undefined") module.exports = AUTO_GT_FINAL_FILE;`,
    "",
  ].join("\n");
  fs.writeFileSync(jsFile, body, "utf8");
  return {
    name: jsName,
    file: jsFile,
    url: fileUrlFromRoot(jsFile),
  };
}

function readFinalFileJsPayload(jsPath) {
  try {
    if (!jsPath || !fs.existsSync(jsPath)) return null;
    const source = fs.readFileSync(jsPath, "utf8");
    const match = source.match(/const\s+AUTO_GT_FINAL_FILE\s*=\s*([\s\S]*?);\s*(?:if\s*\(|$)/);
    return match ? JSON.parse(match[1]) : null;
  } catch (error) {
    addBackendLog("warn", "flow", "Cannot parse Final-File-JS metadata", {
      jsPath,
      error: String(error.message || error),
    });
    return null;
  }
}

function uniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dir, `${base}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function normalizeFinalPlatformFiles() {
  if (!fs.existsSync(FINAL_FILE_DIR)) return;
  const entries = fs.readdirSync(FINAL_FILE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".mp4", ".webm", ".mov", ".m4v"].includes(ext)) continue;

    const currentVideo = path.join(FINAL_FILE_DIR, entry.name);
    const baseName = path.basename(entry.name, ext);
    const currentJs = path.join(FINAL_FILE_JS_DIR, `${baseName}.js`);
    const meta = readFinalFileJsPayload(currentJs);
    const key = finalPlatformKey(meta?.platform || "", meta?.sourceUrl || "");
    const dirs = finalPlatformDirs(key, meta?.sourceUrl || "");
    const targetVideo = uniqueFilePath(path.join(dirs.videoDir, entry.name));
    const targetBaseName = path.basename(targetVideo, ext);

    fs.mkdirSync(dirs.videoDir, { recursive: true });
    fs.renameSync(currentVideo, targetVideo);

    let jsMeta = null;
    if (meta) {
      jsMeta = {
        ...meta,
        platform: meta.platform || key,
        finalFile: targetVideo,
        finalUrl: fileUrlFromRoot(targetVideo),
        videoFileName: path.basename(targetVideo),
      };
      writeFinalFileJsMeta(targetBaseName, jsMeta, jsMeta.platform, jsMeta.sourceUrl || "");
      if (fs.existsSync(currentJs)) fs.unlinkSync(currentJs);
    } else if (fs.existsSync(currentJs)) {
      fs.mkdirSync(dirs.jsDir, { recursive: true });
      fs.renameSync(currentJs, uniqueFilePath(path.join(dirs.jsDir, `${targetBaseName}.js`)));
    }

    addBackendLog("info", "flow", "Final file moved into platform folder", {
      platform: key,
      from: currentVideo,
      to: targetVideo,
      jsUpdated: !!jsMeta,
    });
  }
}

function isInsideDir(filePath, dirPath) {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanupFlowTempFiles(jobId, sceneSources = []) {
  const safeJob = safeFlowJobName(jobId);
  if (!safeJob || !fs.existsSync(FLOW_RESULTS_DIR)) return [];
  const targets = new Set();
  for (const entry of fs.readdirSync(FLOW_RESULTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.includes(safeJob)) {
      targets.add(path.join(FLOW_RESULTS_DIR, entry.name));
    }
  }
  for (const scene of sceneSources) {
    const source = typeof scene === "string"
      ? scene
      : scene?.source || scene?.localUrl || scene?.url || scene?.mediaUrl || scene?.videoUrl || scene?.resultUrl || scene?.file || scene?.path || "";
    const local = localFileFromAppUrl(source);
    if (local && isInsideDir(local, FLOW_RESULTS_DIR)) targets.add(local);
  }
  const removed = [];
  for (const file of targets) {
    try {
      if (fs.existsSync(file) && isInsideDir(file, FLOW_RESULTS_DIR)) {
        fs.unlinkSync(file);
        removed.push(file);
      }
    } catch (error) {
      addBackendLog("warn", "media-core", "ล้างไฟล์ temp ไม่สำเร็จ", {
        jobId,
        file,
        error: String(error.message || error),
      });
    }
  }
  addBackendLog("info", "media-core", "ล้างไฟล์ temp flow-results แล้ว", {
    jobId,
    removed: removed.length,
    files: removed,
  });
  return removed;
}

function extensionFromUrl(mediaUrl, mediaType) {
  try {
    const ext = path.extname(new URL(mediaUrl).pathname).toLowerCase();
    if (ext) return ext;
  } catch {
    /* fall through */
  }
  return mediaType === "image" ? ".png" : ".mp4";
}

function saveFlowMedia(mediaUrl, jobId, mediaType) {
  return new Promise((resolve, reject) => {
    if (!/^https?:\/\//i.test(mediaUrl)) {
      if (mediaType === "video") {
        addBackendLog("info", "flow", "Video media already local; skip download", {
          jobId,
          mediaUrl,
        });
      }
      resolve({ ok: true, url: mediaUrl, skipped: true });
      return;
    }
    fs.mkdirSync(FLOW_RESULTS_DIR, { recursive: true });
    const safeJob = safeFlowJobName(jobId);
    const ext = extensionFromUrl(mediaUrl, mediaType);
    const filename = `${Date.now()}-${safeJob}-${mediaType}${ext}`;
    const target = path.join(FLOW_RESULTS_DIR, filename);
    const client = mediaUrl.startsWith("https:") ? httpsLib : httpLib;
    if (mediaType === "video") {
      addBackendLog("info", "flow", "Downloading Flow video media", {
        jobId,
        mediaUrl,
        target,
      });
    }
    const request = client.get(mediaUrl, {
      headers: { "user-agent": "AutoGT Pro/1.0" },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, mediaUrl).toString();
        if (mediaType === "video") {
          addBackendLog("info", "flow", "Flow video media download redirected", {
            jobId,
            mediaUrl,
            redirectUrl,
          });
        }
        response.resume();
        saveFlowMedia(redirectUrl, jobId, mediaType).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (mediaType === "video") {
          addBackendLog("error", "flow", "Flow video media download failed", {
            jobId,
            mediaUrl,
            statusCode: response.statusCode,
          });
        }
        response.resume();
        reject(new Error(`Download failed HTTP ${response.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(target);
      response.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          const url = `/lib/media-core/flow-results/${filename}`;
          if (mediaType === "video") {
            addBackendLog("info", "flow", "Flow video media downloaded", {
              jobId,
              mediaUrl,
              file: target,
              url,
            });
          }
          resolve({
            ok: true,
            file: target,
            url,
          });
        });
      });
      out.on("error", reject);
    });
    request.on("error", (error) => {
      if (mediaType === "video") {
        addBackendLog("error", "flow", "Flow video media download error", {
          jobId,
          mediaUrl,
          error: String(error.message || error),
        });
      }
      reject(error);
    });
    request.setTimeout(120000, () => {
      if (mediaType === "video") {
        addBackendLog("error", "flow", "Flow video media download timed out", {
          jobId,
          mediaUrl,
        });
      }
      request.destroy(new Error("Download timed out."));
    });
  });
}

let mediaCorePromise = null;
let mediaCoreLock = Promise.resolve();

async function loadMediaCore() {
  if (!mediaCorePromise) {
    mediaCorePromise = import(pathToFileURL(MEDIA_CORE_JS).href).then(async (mod) => {
      const payload = Buffer.from(JSON.stringify({
        wasmURL: MEDIA_CORE_WASM,
        workerURL: "",
      }), "utf8").toString("base64");
      const core = await mod.default({
        mainScriptUrlOrBlob: `${MEDIA_CORE_JS}#${payload}`,
      });
      core.setLogger((row) => {
        if (row?.type === "stderr" && /error|failed|invalid/i.test(row.message || "")) {
          addBackendLog("warn", "media-core", row.message);
        }
      });
      return core;
    });
  }
  return mediaCorePromise;
}

function withMediaCoreLock(task) {
  const run = mediaCoreLock.then(task, task);
  mediaCoreLock = run.catch(() => {});
  return run;
}

function execMediaCore(core, args, label) {
  addBackendLog("info", "media-core", `ffmpeg ${label}`, { args });
  if (typeof core.setTimeout === "function") core.setTimeout(180000);
  core.exec(...args);
  const code = core.ret;
  core.reset();
  if (code !== 0) throw new Error(`media-core ffmpeg failed during ${label}: ${code}`);
}

function localFileFromAppUrl(value) {
  if (!value || typeof value !== "string") return "";
  if (/^https?:\/\//i.test(value)) return "";
  const raw = value.replace(/^file:\/+/i, "");
  const cleaned = raw.split("?")[0];
  const target = cleaned.startsWith("/")
    ? safePath(cleaned)
    : path.isAbsolute(cleaned)
      ? cleaned
      : safePath(cleaned);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(ROOT) && !resolved.startsWith(FLOW_RESULTS_DIR)) return "";
  return fs.existsSync(resolved) ? resolved : "";
}

function downloadBuffer(mediaUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Too many redirects while loading scene media."));
      return;
    }
    const client = mediaUrl.startsWith("https:") ? httpsLib : httpLib;
    const request = client.get(mediaUrl, {
      headers: { "user-agent": "AutoGT Pro/1.0" },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadBuffer(new URL(response.headers.location, mediaUrl).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Scene media download failed HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
    request.setTimeout(180000, () => request.destroy(new Error("Scene media download timed out.")));
  });
}

function normalizeShopeeReviewMediaUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/^\/\//, "https://");
}

function downloadShopeeReviewVideoBuffer(mediaUrl, referer = "", redirects = 0) {
  return new Promise((resolve, reject) => {
    const sourceUrl = normalizeShopeeReviewMediaUrl(mediaUrl);
    if (!/^https?:\/\//i.test(sourceUrl)) {
      reject(new Error("Review video URL is invalid."));
      return;
    }
    if (redirects > 6) {
      reject(new Error("Too many redirects while downloading a Shopee review video."));
      return;
    }
    const client = sourceUrl.startsWith("https:") ? httpsLib : httpLib;
    const request = client.get(sourceUrl, {
      headers: {
        accept: "video/av1,video/webm,video/apng,video/*,*/*;q=0.8",
        referer: referer || "https://shopee.co.th/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, sourceUrl).toString();
        downloadShopeeReviewVideoBuffer(redirectUrl, referer, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Review video download failed HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        if (bytes.length < 1024) {
          reject(new Error("Review video response is empty."));
          return;
        }
        resolve(bytes);
      });
    });
    request.on("error", reject);
    request.setTimeout(180000, () => request.destroy(new Error("Review video download timed out.")));
  });
}

function normalizeShopeeRemixEditMode(value) {
  return String(value || "").trim().toLowerCase() === "classic" ? "classic" : "smart";
}

function buildShopeeRemixTimeline(sourceCount, durationSeconds, editMode = "smart") {
  const clipCount = Math.max(1, Math.floor(Number(sourceCount) || 1));
  const totalSeconds = Math.max(1, Number(durationSeconds) || 15);
  const mode = normalizeShopeeRemixEditMode(editMode);
  if (mode === "classic") {
    const segmentSeconds = totalSeconds / clipCount;
    return Array.from({ length: clipCount }, (_, index) => ({
      sourceIndex: index,
      startSeconds: 0,
      durationSeconds: index === clipCount - 1
        ? Math.max(0.5, totalSeconds - (segmentSeconds * index))
        : segmentSeconds,
      role: "classic",
    }));
  }

  const shotCount = Math.max(clipCount, Math.min(20, Math.ceil(totalSeconds / 1.55)));
  const rhythm = [1.12, 0.9, 1.05, 0.95, 1.08, 0.88, 1.02];
  const rhythmTotal = Array.from({ length: shotCount }, (_, index) => rhythm[index % rhythm.length])
    .reduce((sum, value) => sum + value, 0);
  let usedSeconds = 0;
  return Array.from({ length: shotCount }, (_, index) => {
    const isLast = index === shotCount - 1;
    const calculatedDuration = (totalSeconds * rhythm[index % rhythm.length]) / rhythmTotal;
    const shotDuration = isLast
      ? Math.max(0.5, totalSeconds - usedSeconds)
      : Math.max(0.5, Number(calculatedDuration.toFixed(3)));
    if (!isLast) usedSeconds += shotDuration;
    const sourceIndex = index % clipCount;
    const sourcePass = Math.floor(index / clipCount);
    const startSeconds = index === 0
      ? 0.08
      : Math.min(1.2, 0.18 + (sourcePass * 0.34) + ((sourceIndex % 3) * 0.08));
    let role = "pace";
    if (index === 0) role = "hook";
    else if (isLast) role = "close";
    else if (index % 3 === 1) role = "detail";
    else if (index % 3 === 2) role = "proof";
    return {
      sourceIndex,
      startSeconds: Number(startSeconds.toFixed(3)),
      durationSeconds: Number(shotDuration.toFixed(3)),
      role,
    };
  });
}

function shopeeReviewGraphemes(value) {
  const text = String(value || "");
  try {
    return Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text), (part) => part.segment);
  } catch {
    return Array.from(text);
  }
}

function extractShopeeFiveStarReviewText(comment, maxGraphemes = 35) {
  const normalized = String(comment || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\uFFFC/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
  if (!normalized) return "";

  const blocks = normalized
    .split(/\n\s*\n+/u)
    .map((block) => block.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  let finalBlock = blocks[blocks.length - 1] || "";
  finalBlock = finalBlock
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!finalBlock) return "";

  const graphemes = shopeeReviewGraphemes(finalBlock);
  const wasTrimmed = graphemes.length > maxGraphemes;
  const compact = graphemes.slice(0, maxGraphemes).join("").trim();
  return compact ? `${compact}${wasTrimmed ? "..." : ""}` : "";
}

function wrapShopeeReviewOverlayText(value, lineLength = 19) {
  const graphemes = shopeeReviewGraphemes(value);
  if (graphemes.length <= lineLength) return String(value || "").trim();
  let splitAt = lineLength;
  for (let index = Math.min(lineLength, graphemes.length - 1); index >= Math.max(10, lineLength - 7); index -= 1) {
    if (/\s/u.test(graphemes[index] || "")) {
      splitAt = index;
      break;
    }
  }
  const firstLine = graphemes.slice(0, splitAt).join("").trim();
  const secondLine = graphemes.slice(splitAt).join("").trim();
  return [firstLine, secondLine].filter(Boolean).join("\n");
}

function resolveShopeeReviewOverlayFont() {
  const windowsDir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    process.env.AUTOGT_REVIEW_OVERLAY_FONT,
    path.join(windowsDir, "Fonts", "tahomabd.ttf"),
    path.join(windowsDir, "Fonts", "LeelawUI.ttf"),
    path.join(windowsDir, "Fonts", "tahoma.ttf"),
  ].filter(Boolean);
  return candidates.find((fontFile) => fs.existsSync(fontFile)) || "";
}

async function renderShopeeReviewRemix(payload = {}) {
  const product = payload?.product || {};
  const jobId = String(payload?.jobId || `SR-${Date.now()}`).trim();
  const productId = String(product?.id || product?.itemid || product?.item_id || "").trim();
  const shopId = String(product?.shopId || product?.shopid || product?.shop_id || "").trim();
  const productName = cleanUtf8DisplayText(
    product?.title || product?.name || "",
    productId ? `Shopee ${productId}` : "Shopee review remix"
  );
  const sourceUrl = String(product?.url || product?.productUrl || "").trim()
    || (shopId && productId ? `https://shopee.co.th/product/${shopId}/${productId}` : "https://shopee.co.th/");
  const durationSeconds = Math.max(10, Math.min(30, Number(payload?.durationSeconds || 15)));
  const editMode = normalizeShopeeRemixEditMode(payload?.editMode);
  const rawVideos = Array.isArray(payload?.videos) ? payload.videos.slice(0, 100) : [];
  const reviewComments = (Array.isArray(payload?.reviewComments) ? payload.reviewComments : [])
    .slice(0, 100)
    .map((entry) => ({
      ratingId: String(entry?.ratingId || ""),
      stars: Number(entry?.stars || 0),
      comment: String(entry?.comment || ""),
    }))
    .filter((entry) => entry.stars === 5 && extractShopeeFiveStarReviewText(entry.comment));
  const parsedTargetVideoCount = Number(payload?.videoCount);
  const targetVideoCount = Number.isFinite(parsedTargetVideoCount) && parsedTargetVideoCount > 0
    ? Math.max(1, Math.min(10, Math.floor(parsedTargetVideoCount)))
    : Math.max(1, Math.min(10, rawVideos.length || 1));
  const candidateVideos = rawVideos.map((entry) => ({
    url: normalizeShopeeReviewMediaUrl(typeof entry === "string" ? entry : entry?.url || entry?.videoUrl || entry?.mediaUrl),
    ratingId: String(typeof entry === "object" ? entry?.ratingId || "" : ""),
    stars: Number(typeof entry === "object" ? entry?.stars || 0 : 0),
    comment: String(typeof entry === "object" ? entry?.comment || "" : ""),
  })).filter((entry) => entry.url);
  const seenVideoUrls = new Set();
  const uniqueCandidates = candidateVideos.filter((entry) => {
    if (seenVideoUrls.has(entry.url)) return false;
    seenVideoUrls.add(entry.url);
    return true;
  });
  for (let index = uniqueCandidates.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [uniqueCandidates[index], uniqueCandidates[randomIndex]] = [uniqueCandidates[randomIndex], uniqueCandidates[index]];
  }
  const requestedVideos = uniqueCandidates.map((entry, index) => ({ ...entry, index: index + 1 }));
  if (!requestedVideos.length) throw new Error("No Shopee review video URLs were provided.");

  addBackendLog("info", "shopee-remix", "Randomized get_ratings video candidates", {
    jobId,
    productId,
    candidateClips: requestedVideos.length,
    targetClips: Math.min(targetVideoCount, requestedVideos.length),
    durationSeconds,
    editMode,
  });

  const downloaded = [];
  for (const video of requestedVideos) {
    if (downloaded.length >= targetVideoCount) break;
    try {
      addBackendLog("info", "shopee-remix", "Downloading random get_ratings video", {
        jobId,
        attempt: video.index,
        selectedClip: downloaded.length + 1,
        mediaUrl: video.url,
      });
      const bytes = await downloadShopeeReviewVideoBuffer(video.url, sourceUrl);
      downloaded.push({ ...video, selectedClip: downloaded.length + 1, bytes });
      addBackendLog("info", "shopee-remix", "Review video downloaded", {
        jobId,
        clip: downloaded.length,
        mediaUrl: video.url,
        bytes: bytes.length,
      });
    } catch (error) {
      addBackendLog("warn", "shopee-remix", "Skipping a review video that could not be downloaded", {
        jobId,
        clip: video.index,
        mediaUrl: video.url,
        error: String(error?.message || error),
      });
    }
  }
  if (downloaded.length < targetVideoCount) {
    addBackendLog("warn", "shopee-remix", "Random get_ratings video download completed with fewer clips", {
      jobId,
      requestedClips: targetVideoCount,
      downloadedClips: downloaded.length,
      failedCandidates: requestedVideos.length - downloaded.length,
    });
  }
  if (!downloaded.length) throw new Error("Unable to download any Shopee review videos.");

  const overlaySource = reviewComments[0] || uniqueCandidates.find((video) => Number(video.stars) === 5
    && extractShopeeFiveStarReviewText(video.comment));
  const overlayText = overlaySource
    ? wrapShopeeReviewOverlayText(extractShopeeFiveStarReviewText(overlaySource.comment))
    : "";
  const overlayLines = overlayText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
  const overlayFontFile = overlayText ? resolveShopeeReviewOverlayFont() : "";
  if (overlayText && !overlayFontFile) {
    addBackendLog("warn", "shopee-remix", "Skipping 5-star review overlay because no Thai font was found", {
      jobId,
      ratingId: overlaySource?.ratingId || "",
    });
  } else if (!overlayText) {
    addBackendLog("warn", "shopee-remix", "No usable 5-star review comment was returned by the Rating API", {
      jobId,
      reviewCommentCount: reviewComments.length,
      videoCandidateCount: uniqueCandidates.length,
    });
  }

  return withMediaCoreLock(async () => {
    const core = await loadMediaCore();
    const finalDirs = finalPlatformDirs("Shopee", sourceUrl);
    const safeJob = safeFlowJobName(jobId);
    const safeProduct = safeFinalFilePart(productId || shopId || "shopee");
    const baseName = `${Date.now()}-${safeJob}-${safeProduct}-remix`;
    const outputName = `${baseName}.mp4`;
    const outputFile = path.join(finalDirs.videoDir, outputName);
    const workDir = `/shopee-remix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inputs = [];
    const normalized = [];
    const scratch = [];
    const timeline = buildShopeeRemixTimeline(downloaded.length, durationSeconds, editMode);
    let overlayPrimaryTextFile = "";
    let overlayAccentTextFile = "";
    let overlayFontVirtualFile = "";
    let elapsedTimelineSeconds = 0;

    try {
      core.FS.mkdir(workDir);
      for (let index = 0; index < downloaded.length; index += 1) {
        const clip = downloaded[index];
        const inputName = `${workDir}/source-${index + 1}.mp4`;
        core.FS.writeFile(inputName, new Uint8Array(clip.bytes));
        inputs.push(inputName);
        scratch.push(inputName);
      }

      if (overlayText && overlayFontFile) {
        overlayPrimaryTextFile = `${workDir}/five-star-review-primary.txt`;
        overlayAccentTextFile = overlayLines[1] ? `${workDir}/five-star-review-accent.txt` : "";
        overlayFontVirtualFile = `${workDir}/review-font.ttf`;
        core.FS.writeFile(overlayPrimaryTextFile, new Uint8Array(Buffer.from(overlayLines[0] || overlayText, "utf8")));
        if (overlayAccentTextFile) {
          core.FS.writeFile(overlayAccentTextFile, new Uint8Array(Buffer.from(overlayLines[1], "utf8")));
        }
        core.FS.writeFile(overlayFontVirtualFile, new Uint8Array(fs.readFileSync(overlayFontFile)));
        scratch.push(overlayPrimaryTextFile, overlayFontVirtualFile);
        if (overlayAccentTextFile) scratch.push(overlayAccentTextFile);
        addBackendLog("info", "shopee-remix", "Prepared 5-star customer review overlay", {
          jobId,
          ratingId: overlaySource?.ratingId || "",
          stars: Number(overlaySource?.stars || 0),
          text: overlayText.replace(/\n/g, " / "),
          font: path.basename(overlayFontFile),
        });
      }

      addBackendLog("info", "shopee-remix", "Remix timeline prepared", {
        jobId,
        editMode,
        sourceClips: inputs.length,
        shotCount: timeline.length,
        durationSeconds,
        timeline: timeline.map((shot, index) => ({
          shot: index + 1,
          sourceClip: shot.sourceIndex + 1,
          startSeconds: shot.startSeconds,
          durationSeconds: shot.durationSeconds,
          role: shot.role,
        })),
      });

      for (let index = 0; index < timeline.length; index += 1) {
        const shot = timeline[index];
        const inputName = inputs[shot.sourceIndex];
        const normalizedName = `${workDir}/shot-${index + 1}.mp4`;
        const segmentSeconds = Number(shot.durationSeconds);
        const segmentDuration = segmentSeconds.toFixed(3);
        const seekArgs = shot.startSeconds > 0
          ? ["-ss", Number(shot.startSeconds).toFixed(3)]
          : [];
        scratch.push(normalizedName);
        const videoFilters = [
          "scale=720:1280:force_original_aspect_ratio=decrease",
          "pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black",
          "fps=30",
          `tpad=stop_mode=clone:stop_duration=${segmentDuration}`,
          `trim=duration=${segmentDuration}`,
          "setpts=PTS-STARTPTS",
        ];
        const showReviewOverlay = Boolean(overlayPrimaryTextFile && overlayFontVirtualFile && elapsedTimelineSeconds < 4.25);
        if (showReviewOverlay) {
          videoFilters.push([
            `drawtext=fontfile=${overlayFontVirtualFile}`,
            `textfile=${overlayPrimaryTextFile}`,
            "expansion=none",
            "fontcolor=white",
            "fontsize=58",
            "x=(w-text_w)/2",
            `y=${overlayAccentTextFile ? 82 : 118}`,
            "borderw=3",
            "bordercolor=black@0.82",
            "shadowcolor=black@0.95",
            "shadowx=4",
            "shadowy=5",
            "fix_bounds=1",
          ].join(":"));
          if (overlayAccentTextFile) {
            videoFilters.push([
              `drawtext=fontfile=${overlayFontVirtualFile}`,
              `textfile=${overlayAccentTextFile}`,
              "expansion=none",
              "fontcolor=0xFFC83D",
              "fontsize=58",
              "x=(w-text_w)/2",
              "y=158",
              "borderw=3",
              "bordercolor=black@0.82",
              "shadowcolor=black@0.95",
              "shadowx=4",
              "shadowy=5",
              "fix_bounds=1",
            ].join(":"));
          }
        }
        videoFilters.push("format=yuv420p");
        const videoFilter = videoFilters.join(",");
        const audioFilter = [
          "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo",
          "aresample=async=1:first_pts=0",
          "apad",
          `atrim=duration=${segmentDuration}`,
          "asetpts=PTS-STARTPTS",
        ].join(",");

        addBackendLog("info", "shopee-remix", "Normalizing review video", {
          jobId,
          shot: index + 1,
          sourceClip: shot.sourceIndex + 1,
          role: shot.role,
          startSeconds: shot.startSeconds,
          segmentSeconds,
        });
        try {
          execMediaCore(core, [
            ...seekArgs,
            "-i", inputName,
            "-filter_complex", `[0:v:0]${videoFilter}[v];[0:a:0]${audioFilter}[a]`,
            "-map", "[v]",
            "-map", "[a]",
            "-t", segmentDuration,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-movflags", "+faststart",
            normalizedName,
          ], `normalize Shopee review clip ${index + 1}`);
        } catch (audioError) {
          try { core.FS.unlink(normalizedName); } catch { /* no partial file */ }
          addBackendLog("warn", "shopee-remix", "Review clip has no usable audio; adding a silent track", {
            jobId,
            shot: index + 1,
            sourceClip: shot.sourceIndex + 1,
            error: String(audioError?.message || audioError),
          });
          execMediaCore(core, [
            ...seekArgs,
            "-i", inputName,
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-filter_complex", `[0:v:0]${videoFilter}[v];[1:a:0]atrim=duration=${segmentDuration},asetpts=PTS-STARTPTS[a]`,
            "-map", "[v]",
            "-map", "[a]",
            "-t", segmentDuration,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-movflags", "+faststart",
            normalizedName,
          ], `normalize silent Shopee review clip ${index + 1}`);
        }
        normalized.push(normalizedName);
        elapsedTimelineSeconds += segmentSeconds;
      }

      const concatFile = `${workDir}/concat.txt`;
      const finalName = `${workDir}/final.mp4`;
      scratch.push(concatFile, finalName);
      core.FS.writeFile(concatFile, normalized.map((file) => `file '${file}'`).join("\n"));
      addBackendLog("info", "shopee-remix", "Remixing Shopee review videos", {
        jobId,
        sourceClipCount: downloaded.length,
        shotCount: normalized.length,
        editMode,
        durationSeconds,
      });
      try {
        execMediaCore(core, [
          "-f", "concat",
          "-safe", "0",
          "-i", concatFile,
          "-t", String(durationSeconds),
          "-c", "copy",
          "-movflags", "+faststart",
          finalName,
        ], "concat Shopee review remix");
      } catch (concatError) {
        try { core.FS.unlink(finalName); } catch { /* no partial file */ }
        addBackendLog("warn", "shopee-remix", "Fast concat failed; retrying with encoded concat", {
          jobId,
          error: String(concatError?.message || concatError),
        });
        const inputArgs = normalized.flatMap((file) => ["-i", file]);
        const concatInputs = normalized.map((_, index) => `[${index}:v:0][${index}:a:0]`).join("");
        execMediaCore(core, [
          ...inputArgs,
          "-filter_complex", `${concatInputs}concat=n=${normalized.length}:v=1:a=1[outv][outa]`,
          "-map", "[outv]",
          "-map", "[outa]",
          "-t", String(durationSeconds),
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          finalName,
        ], "encoded concat Shopee review remix");
      }

      fs.mkdirSync(finalDirs.videoDir, { recursive: true });
      const finalBytes = core.FS.readFile(finalName);
      fs.writeFileSync(outputFile, Buffer.from(finalBytes));
      const finalUrl = fileUrlFromRoot(outputFile);
      const sourceVideos = downloaded.map(({ bytes, ...video }) => video);
      const timelineMetadata = timeline.map((shot, index) => ({
        shot: index + 1,
        sourceClip: shot.sourceIndex + 1,
        mediaUrl: sourceVideos[shot.sourceIndex]?.url || "",
        startSeconds: shot.startSeconds,
        durationSeconds: shot.durationSeconds,
        role: shot.role,
      }));
      const metadata = {
        ok: true,
        type: "AutoGT Pro Shopee Review Remix",
        jobId,
        platform: "Shopee",
        productName,
        productId,
        productID: productId,
        shopId,
        sourceUrl,
        keyword: String(product?._keyword || product?.keyword || ""),
        durationSeconds,
        editMode,
        clipCount: downloaded.length,
        shotCount: timeline.length,
        requestedClipCount: targetVideoCount,
        candidateClipCount: requestedVideos.length,
        sourceVideos,
        timeline: timelineMetadata,
        reviewOverlay: overlayText && overlayFontFile ? {
          text: overlayText.replace(/\n/g, " "),
          lines: overlayLines,
          style: "white-gold-headline",
          ratingId: overlaySource?.ratingId || "",
          stars: Number(overlaySource?.stars || 0),
          visibleSeconds: Math.min(4.25, durationSeconds),
        } : null,
        finalFile: outputFile,
        finalUrl,
        videoFileName: outputName,
        createdAt: new Date().toISOString(),
      };
      const jsMeta = writeFinalFileJsMeta(baseName, metadata, "Shopee", sourceUrl);
      addBackendLog("info", "shopee-remix", "Shopee review remix complete", {
        jobId,
        clipCount: downloaded.length,
        shotCount: timeline.length,
        editMode,
        durationSeconds,
        hasReviewOverlay: Boolean(overlayText && overlayFontFile),
        finalUrl,
        jsUrl: jsMeta.url,
      });
      return {
        action: "renderShopeeReviewRemix",
        jobId,
        mediaType: "final",
        platform: "Shopee",
        productName,
        productId,
        shopId,
        clipCount: downloaded.length,
        shotCount: timeline.length,
        requestedClipCount: targetVideoCount,
        candidateClipCount: requestedVideos.length,
        durationSeconds,
        editMode,
        file: outputFile,
        url: finalUrl,
        resultUrl: finalUrl,
        videoUrl: finalUrl,
        jsFile: jsMeta.file,
        jsUrl: jsMeta.url,
        jsName: jsMeta.name,
        metadata,
      };
    } finally {
      for (const file of [...new Set(scratch)]) {
        try { core.FS.unlink(file); } catch { /* best-effort cleanup */ }
      }
      try { core.FS.rmdir(workDir); } catch { /* best-effort cleanup */ }
    }
  });
}

async function loadSceneClipBuffer(scene) {
  const source = typeof scene === "string"
    ? scene
    : scene?.localUrl || scene?.url || scene?.mediaUrl || scene?.videoUrl || scene?.resultUrl || scene?.file || scene?.path || "";
  if (!source) throw new Error("Scene clip is missing a URL or file path.");
  const local = localFileFromAppUrl(source);
  if (local) {
    addBackendLog("info", "media-core", "อ่านคลิปจากไฟล์ในเครื่อง", {
      source,
      file: local,
    });
    return fs.readFileSync(local);
  }
  if (/^https?:\/\//i.test(source)) return downloadBuffer(source);
  // Flow's concatenation can hand the merged clip back inline as
  // "data:video/mp4;base64,…" instead of a hosted URL. That is a real clip, so
  // decode it rather than failing — and NEVER echo it into an error message:
  // a rejected data: URI put a 19 MB string on the job record, which then rode
  // in every state broadcast (39 MB per push, with history) and froze the page.
  const dataUri = /^data:([^;,]*)(;base64)?,/i.exec(source);
  if (dataUri) {
    const body = source.slice(dataUri[0].length);
    return Buffer.from(dataUri[2] ? body : decodeURIComponent(body), dataUri[2] ? "base64" : "utf8");
  }
  throw new Error(`Scene clip is not readable: ${describeClipSource(source)}`);
}

/** A source string safe to put in a log line or an error: a data: URI is
 *  reduced to its type and size instead of its megabytes of payload. */
function describeClipSource(source) {
  const text = String(source || "");
  const dataUri = /^data:([^;,]*)/i.exec(text);
  if (dataUri) return `data:${dataUri[1] || "?"} (${Math.round(text.length / 1024)} KB inline)`;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function finalizeFlowScenes(payload) {
  const scenes = Array.isArray(payload.scenes) ? payload.scenes.filter(Boolean) : [];
  const jobId = payload.jobId || "flow";
  const productId = String(payload.productId || payload.productID || payload.product_id || "").trim();
  const platform = String(payload.platform || "").trim();
  const sourceUrl = String(payload.sourceUrl || payload.url || "").trim();
  const productName = cleanUtf8DisplayText(
    payload.productName || payload.title || "",
    productId ? `สินค้า ${platform || ""} ${productId}`.replace(/\s+/g, " ").trim() : ""
  );
  const trimSeconds = Math.max(0, Number(payload.trimSeconds ?? 1) || 0);
  const finalDirs = finalPlatformDirs(platform, sourceUrl);
  if (!scenes.length) throw new Error("No scene clips were provided.");
  const sceneSources = scenes.map((scene, index) => {
    const source = typeof scene === "string"
      ? scene
      : scene?.localUrl || scene?.url || scene?.mediaUrl || scene?.videoUrl || scene?.resultUrl || scene?.file || "";
    return {
      scene: index + 1,
      source,
      trimSeconds: index === 0 ? 0 : trimSeconds,
      rule: index === 0 ? "keep full clip" : "trim first second before concat",
    };
  });
  // Flow's concatenation can hand a merged clip back as `data:video/mp4;base64,…`
  // instead of a hosted URL — tens of megabytes of base64. `sceneSources` keeps the
  // real value because the clip is loaded from it; anything that WRITES the value
  // down (metadata JSON, logs) uses this stripped copy instead, or a single job
  // would inline a whole video into a JSON file.
  const storedClips = sceneSources.map((clip) => ({
    ...clip,
    source: String(clip.source).startsWith("data:") ? "(inline data: clip)" : clip.source,
  }));

  addBackendLog("info", "media-core", "ได้รับคลิปสำหรับรวม", {
    jobId,
    sceneCount: scenes.length,
    clips: storedClips,
  });

  if (scenes.length === 1) {
    // Product ID is the stable key POST WEB uses for an exact Showcase match;
    // the readable title remains beside it for operators browsing the library.
    const baseName = buildFinalFileBaseName(finalDirs.videoDir, productId, productName, jobId);
    const outputName = `${baseName}.mp4`;
    const outputFile = path.join(finalDirs.videoDir, outputName);
    fs.mkdirSync(finalDirs.videoDir, { recursive: true });
    addBackendLog("info", "media-core", "ไฟล์ 1 ฉาก: ส่งเข้า Final-File โดยไม่ merge", {
      jobId,
      source: storedClips[0]?.source || "",
      outputFile,
    });
    const bytes = await loadSceneClipBuffer(scenes[0]);
    fs.writeFileSync(outputFile, Buffer.from(bytes));
    const finalUrl = fileUrlFromRoot(outputFile);
    const metadata = {
      ok: true,
      type: "AutoGT Pro Final File",
      jobId,
      productName,
      productId,
      productID: productId,
      platform,
      sourceUrl,
      sceneCount: scenes.length,
      trimSeconds: 0,
      rule: "single clip final file",
      finalFile: outputFile,
      finalUrl,
      videoFileName: outputName,
      createdAt: new Date().toISOString(),
      clips: storedClips,
      promptLog: payload.promptLog || {},
    };
    const jsMeta = writeFinalFileJsMeta(baseName, metadata, platform, sourceUrl);
    const result = {
      action: "finalizeScenes",
      jobId,
      mediaType: "final",
      productName,
      productId,
      productID: productId,
      platform,
      sourceUrl,
      sceneCount: scenes.length,
      trimSeconds: 0,
      file: outputFile,
      url: finalUrl,
      resultUrl: finalUrl,
      videoUrl: finalUrl,
      jsFile: jsMeta.file,
      jsUrl: jsMeta.url,
      jsName: jsMeta.name,
      metadata,
      parts: 1,
      createdAt: new Date().toISOString(),
    };
    cleanupFlowTempFiles(jobId, sceneSources);
    addBackendLog("info", "media-core", "ส่งไฟล์ 1 ฉากเข้า Final-File เสร็จแล้ว", {
      jobId,
      url: result.url,
      jsUrl: result.jsUrl,
    });
    return result;
  }

  return withMediaCoreLock(async () => {
    const core = await loadMediaCore();
    const workDir = `/final-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const baseName = buildFinalFileBaseName(finalDirs.videoDir, productId, productName, jobId);
    const outputName = `${baseName}.mp4`;
    const outputFile = path.join(finalDirs.videoDir, outputName);
    const inputs = [];

    try {
      core.FS.mkdir(workDir);
      for (let index = 0; index < scenes.length; index += 1) {
        const inputName = `${workDir}/scene-${index + 1}.mp4`;
        const source = sceneSources[index]?.source || "";
        addBackendLog("info", "media-core", "กำลังเตรียมคลิปสำหรับรวม", {
          jobId,
          scene: index + 1,
          source,
          trimSeconds: index === 0 ? 0 : trimSeconds,
          rule: index === 0 ? "keep full clip" : "trim first second before concat",
        });
        const bytes = await loadSceneClipBuffer(scenes[index]);
        core.FS.writeFile(inputName, new Uint8Array(bytes));
        addBackendLog("info", "media-core", "เตรียมคลิปสำหรับรวมเสร็จแล้ว", {
          jobId,
          scene: index + 1,
          bytes: bytes.length,
          inputName,
        });
        inputs.push(inputName);
      }

      const concatFile = `${workDir}/concat.txt`;
      const concatLines = inputs.flatMap((input, index) => {
        const lines = [`file '${input}'`];
        if (index > 0 && trimSeconds > 0) lines.push(`inpoint ${trimSeconds}`);
        return lines;
      });
      core.FS.writeFile(concatFile, concatLines.join("\n"));
      const finalName = `${workDir}/final.mp4`;
      addBackendLog("info", "media-core", "กำลังรวมคลิป", {
        jobId,
        sceneCount: scenes.length,
        trimSecondsAfterFirstClip: trimSeconds,
        method: "filter_complex concat video+audio; clip 1 full, clip 2+ trim",
      });
      const inputArgs = inputs.flatMap((input) => ["-i", input]);
      const filterParts = inputs.flatMap((_, index) => {
        const start = index === 0 || trimSeconds <= 0 ? 0 : trimSeconds;
        const videoTrim = start <= 0
          ? `trim=start=0,setpts=PTS-STARTPTS`
          : `trim=start=${start},setpts=PTS-STARTPTS`;
        const audioTrim = start <= 0
          ? `atrim=start=0,asetpts=PTS-STARTPTS`
          : `atrim=start=${start},asetpts=PTS-STARTPTS`;
        return [
          `[${index}:v:0]${videoTrim},scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p[v${index}]`,
          `[${index}:a:0]${audioTrim},aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${index}]`,
        ];
      });
      const concatInputs = inputs.map((_, index) => `[v${index}][a${index}]`).join("");
      const filterGraph = `${filterParts.join(";")};${concatInputs}concat=n=${inputs.length}:v=1:a=1[outv][outa]`;
      try {
        execMediaCore(core, [
        ...inputArgs,
        "-filter_complex", filterGraph,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-movflags", "+faststart",
        finalName,
        ], "concat final scenes");
      } catch (error) {
        addBackendLog("warn", "media-core", "concat with audio failed; retrying video-only merge", {
          jobId,
          sceneCount: scenes.length,
          message: error?.message || String(error),
          filterGraph,
        });
        const videoOnlyParts = inputs.map((_, index) => {
          const start = index === 0 || trimSeconds <= 0 ? 0 : trimSeconds;
          const videoTrim = start <= 0
            ? "trim=start=0,setpts=PTS-STARTPTS"
            : `trim=start=${start},setpts=PTS-STARTPTS`;
          return `[${index}:v:0]${videoTrim},scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p[v${index}]`;
        });
        const videoOnlyInputs = inputs.map((_, index) => `[v${index}]`).join("");
        const videoOnlyGraph = `${videoOnlyParts.join(";")};${videoOnlyInputs}concat=n=${inputs.length}:v=1:a=0[outv]`;
        addBackendLog("warn", "media-core", "retrying merge as video-only because audio concat failed", {
          jobId,
          sceneCount: scenes.length,
          trimSecondsAfterFirstClip: trimSeconds,
          reason: error?.message || String(error),
        });
        execMediaCore(core, [
          ...inputArgs,
          "-filter_complex", videoOnlyGraph,
          "-map", "[outv]",
          "-an",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-movflags", "+faststart",
          finalName,
        ], "concat final scenes video-only fallback");
      }

      fs.mkdirSync(finalDirs.videoDir, { recursive: true });
      const finalBytes = core.FS.readFile(finalName);
      fs.writeFileSync(outputFile, Buffer.from(finalBytes));
      const finalUrl = fileUrlFromRoot(outputFile);
      const metadata = {
        ok: true,
        type: "AutoGT Pro Final File",
        jobId,
        productName,
        productId,
        productID: productId,
        platform,
        sourceUrl,
        sceneCount: scenes.length,
        trimSeconds,
        rule: scenes.length > 1 ? "clip 1 full length; clip 2+ trim first 1 second before concat" : "single clip final file",
        finalFile: outputFile,
        finalUrl,
        videoFileName: outputName,
        createdAt: new Date().toISOString(),
        clips: storedClips,
        promptLog: payload.promptLog || {},
      };
      const jsMeta = writeFinalFileJsMeta(baseName, metadata, platform, sourceUrl);
      const result = {
        action: "finalizeScenes",
        jobId,
        mediaType: "final",
        productName,
        productId,
        productID: productId,
        platform,
        sourceUrl,
        sceneCount: scenes.length,
        trimSeconds,
        file: outputFile,
        url: finalUrl,
        resultUrl: finalUrl,
        videoUrl: finalUrl,
        jsFile: jsMeta.file,
        jsUrl: jsMeta.url,
        jsName: jsMeta.name,
        metadata,
        parts: inputs.length,
        createdAt: new Date().toISOString(),
      };
      cleanupFlowTempFiles(jobId, sceneSources);
      addBackendLog("info", "media-core", "รวมคลิปเสร็จแล้ว", {
        jobId,
        sceneCount: scenes.length,
        trimSeconds,
        url: result.url,
        jsUrl: result.jsUrl,
      });
      return result;
    } finally {
      for (const file of [...inputs, `${workDir}/concat.txt`, `${workDir}/final.mp4`]) {
        try { core.FS.unlink(file); } catch { /* best-effort cleanup */ }
      }
      try { core.FS.rmdir(workDir); } catch { /* best-effort cleanup */ }
    }
  });
}

function extensionCommandFailureText(value) {
  if (value == null) return "";
  if (value instanceof Error) return String(value.message || value);
  if (typeof value === "string") return value;
  const fields = [value.error, value.message, value.reason, value.detail]
    .filter((entry) => typeof entry === "string" && entry.trim());
  try {
    fields.push(JSON.stringify(value));
  } catch {
    /* best effort only */
  }
  return fields.join(" ").slice(0, 8000);
}

// Both extensions can have their Chrome profile opened for them; anything else
// (an unknown role) still fails fast rather than launching a browser blindly.
function canWakeExtensionRole(role) {
  return role === EXTENSION_ROLE_MAIN || role === EXTENSION_ROLE_TIKTOK;
}

function isRecoverableExtensionFailure(value) {
  const message = extensionCommandFailureText(value);
  return /extension is not connected|no current window|no browser window|no active window|no focused window|receiving end does not exist|message channel closed|message port closed|extension context invalidated/i.test(message);
}

function firstHttpUrl(...values) {
  for (const value of values.flat(Infinity)) {
    const candidate = String(value || "").trim();
    if (/^https?:\/\//i.test(candidate)) return candidate;
  }
  return "";
}

function extensionWakeTargetUrl(action, data = {}, role = EXTENSION_ROLE_MAIN) {
  const command = String(action || "").trim();
  // The TikTok extension only ever drives tiktok.com; waking it onto the upload
  // page means the tab the publish step wants is already there.
  if (role === EXTENSION_ROLE_TIKTOK) {
    return command === "publish" ? TIKTOK_UPLOAD_URL : "https://www.tiktok.com/";
  }
  const provider = String(data.provider || data.source || data.mode || "").toLowerCase();
  const product = data.product && typeof data.product === "object" ? data.product : {};
  const productUrl = firstHttpUrl(
    product.url,
    product.productUrl,
    data.productUrl,
    data.url,
    Array.isArray(data.urls) ? data.urls[0] : ""
  );

  if (command === "searchShopeeProducts") {
    return "https://affiliate.shopee.co.th/offer/product_offer";
  }
  if (command === "checkShopeeLinks") {
    return "https://affiliate.shopee.co.th/offer/product_offer";
  }
  if (command === "checkShopeeVideoRanks") {
    return "https://shopee.co.th/#spl-action=check_live_info";
  }
  if (command === "fetchShopeeReviewVideos") {
    return productUrl || "https://shopee.co.th/";
  }
  if (["ensureFlowTab", "flowRoomCreate", "flowRoomCreateBatch", "flowExtendSubmit", "flowVideoSubmit", "flowMediaStatus", "harvestLabs", "mintCaptcha", "refreshCaptcha", "hud"].includes(command) || command === "generate") {
    return "https://labs.google/fx";
  }
  if (["checkTikTok", "checkTikTokLinks", "getTikTokProfiles", "pullProducts", "addToShowcase"].includes(command)) {
    return "https://www.tiktok.com/";
  }
  if (command === "captureLogin") {
    if (provider.includes("shopee")) return "https://affiliate.shopee.co.th/";
    if (provider.includes("google") || provider.includes("labs") || provider.includes("flow")) {
      return "https://labs.google/fx";
    }
    if (provider.includes("tiktok")) return "https://www.tiktok.com/";
  }
  return `http://127.0.0.1:${PORT}/`;
}

function extensionSocketByInstallIdForRole(installId, role = EXTENSION_ROLE_MAIN) {
  const target = String(installId || "").trim();
  if (!target) return null;
  return extensionSocketCandidates(role)
    .find((socket) => String(extensionSocketMeta.get(socket)?.installId || "").trim() === target) || null;
}

function extensionProfileForWake(socket = null, role = EXTENSION_ROLE_MAIN) {
  const meta = socket ? extensionSocketMeta.get(socket) || {} : {};
  const records = readExtensionProfiles();
  const directCandidates = [
    chromeProfileFromExtensionRecord(chromeProfileHintsBySocketId.get(Number(meta.id)) || {}),
    chromeProfileFromExtensionRecord(records[String(meta.installId || "").trim()] || {}),
    chromeProfileFromExtensionRecord(meta),
  ].filter(Boolean);
  if (directCandidates.length) return directCandidates[0];

  const installed = discoverAutoGtChromeProfiles(role);
  const installedByStableId = new Map(installed.map((profile) => [chromeProfileStableId(profile), profile]));
  const cachedCandidates = Object.values(records)
    .filter((record) => (role === EXTENSION_ROLE_MAIN ? !record.extensionRole : true)
      || record.extensionRole === role)
    .sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));
  for (const record of cachedCandidates) {
    const cachedProfile = chromeProfileFromExtensionRecord(record);
    if (!cachedProfile) continue;
    const installedProfile = installedByStableId.get(chromeProfileStableId(cachedProfile));
    if (installedProfile) return installedProfile;
  }
  return installed[0] || null;
}

/** Open the Chrome profile that owns an extension that is not answering, then
 *  wait for it to reconnect and hand back its socket.
 *
 *  Was Main-only. The TikTok extension needs the same treatment: publishing is
 *  routed to EXTENSION_ROLE_TIKTOK, so a sleeping TikTok profile used to fail the
 *  job outright with "Extension is not connected." instead of being woken.
 *
 *  In-flight wakes are tracked per role AND per profile, so two channels living
 *  in two Chrome profiles wake concurrently — a single shared promise would have
 *  returned one profile's socket to both callers and serialised their posts. */
async function wakeExtensionForCommand(action, data = {}, sourceSocket = null, role = EXTENSION_ROLE_MAIN) {
  const sourceMeta = sourceSocket ? extensionSocketMeta.get(sourceSocket) || {} : {};
  const profile = extensionProfileForWake(sourceSocket, role);
  if (!profile) {
    throw new Error(role === EXTENSION_ROLE_TIKTOK
      ? "ไม่พบ Chrome profile ที่ติดตั้ง TikTok Extension"
      : "ไม่พบ Chrome profile ที่ติดตั้ง Main Extension");
  }
  const roleLabel = role === EXTENSION_ROLE_TIKTOK ? "TikTok Extension" : "Main Extension";
  const wakeKey = `${role}|${String(sourceMeta.installId || "").trim() || chromeProfileStableId(profile) || profile.profileDirectory || "default"}`;
  const inFlight = extensionWakePromises.get(wakeKey);
  if (inFlight) return inFlight;

  const wakeTask = (async () => {
    const url = extensionWakeTargetUrl(action, data, role);
    const installId = String(sourceMeta.installId || "").trim();
    addBackendLog("warn", "extension:wake", `${roleLabel} unavailable; opening its Chrome profile`, {
      action,
      role,
      error: "Extension unavailable or Chrome has no current window",
      installId,
      profile: profile.profileDirectory,
      label: profile.label,
      url,
    });
    launchChromeProfile(
      profile,
      url,
      `Opening ${roleLabel} Chrome profile for ${action}`,
      role,
      { newWindow: true }
    );

    // Give Chrome enough time to create its first normal window before the
    // extension action calls chrome.tabs.create/query again.
    await sleep(2200);
    const startedAt = Date.now();
    while (Date.now() - startedAt < CHROME_WAKE_WAIT_MS) {
      const preferredSocket = extensionSocketByInstallIdForRole(installId, role);
      if (preferredSocket) {
        addBackendLog("info", "extension:wake", `${roleLabel} ready; retrying command`, {
          action,
          role,
          socketId: extensionSocketMeta.get(preferredSocket)?.id || null,
          installId,
          profile: profile.profileDirectory,
          url,
        });
        return preferredSocket;
      }
      const roleSockets = extensionSocketCandidates(role);
      const activeSocket = roleSockets[roleSockets.length - 1] || null;
      if (activeSocket) {
        addBackendLog("info", "extension:wake", `${roleLabel} connected; retrying command`, {
          action,
          role,
          socketId: extensionSocketMeta.get(activeSocket)?.id || null,
          installId: extensionSocketMeta.get(activeSocket)?.installId || "",
          profile: profile.profileDirectory,
          url,
        });
        return activeSocket;
      }
      await sleep(350);
    }
    throw new Error(`เปิด Chrome แล้ว แต่ ${roleLabel} ยังไม่เชื่อมต่อกลับมายังโปรแกรม`);
  })();

  extensionWakePromises.set(wakeKey, wakeTask);
  try {
    return await wakeTask;
  } finally {
    if (extensionWakePromises.get(wakeKey) === wakeTask) extensionWakePromises.delete(wakeKey);
  }
}

function sendExtensionCommandOnce(action, data = {}, timeoutMs = 180000, socketOverride = null, role = EXTENSION_ROLE_MAIN, signal = null) {
  const socket = socketOverride || activeExtensionSocket(role);
  if (!socket) {
    addBackendLog("error", "extension", `send command failed: ${action}`, "Extension is not connected.");
    return Promise.reject(new Error("Extension is not connected."));
  }
  const socketMeta = touchExtensionSocket(socket, { lastMessage: `command:${action}` });

  const jobId = `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payload = {
    v: 1,
    type: "ext.command",
    jobId,
    data: { action, ...data },
  };
  addBackendLog("info", "extension", `send command: ${action}`, {
    jobId,
    timeoutMs,
    keys: Object.keys(data || {}),
    socketId: socketMeta?.id || null,
    extensionRole: socketMeta?.extensionRole || EXTENSION_ROLE_MAIN,
    sockets: extensionSockets.size,
  });
  const progressKey = action === "checkShopeeLinks" ? "shopee" : null;
  if (progressKey) {
    latestProgress[progressKey] = {
      stage: action,
      message: "Starting...",
      progress: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("ยกเลิกโดยผู้ใช้"));
      return;
    }
    const timer = setTimeout(() => {
      pendingExtensionJobs.delete(jobId);
      addBackendLog("error", "extension", `command timed out: ${action}`, { jobId });
      reject(new Error("Extension command timed out."));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      pendingExtensionJobs.delete(jobId);
      reject(new Error("ยกเลิกโดยผู้ใช้"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    pendingExtensionJobs.set(jobId, {
      resolve: (value) => { signal?.removeEventListener("abort", onAbort); resolve(value); },
      reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); },
      timer,
      progressKey,
    });
    try {
      sendWsText(socket, payload);
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingExtensionJobs.delete(jobId);
      reject(error);
    }
  });
}

async function sendExtensionCommand(action, data = {}, timeoutMs = 180000, socketOverride = null, role = EXTENSION_ROLE_MAIN, signal = null) {
  const initialSocket = socketOverride || activeExtensionSocket(role);
  let result;
  try {
    result = await sendExtensionCommandOnce(action, data, timeoutMs, initialSocket, role, signal);
  } catch (error) {
    if (!canWakeExtensionRole(role) || !isRecoverableExtensionFailure(error)) throw error;
    const recoveredSocket = await wakeExtensionForCommand(action, data, initialSocket, role);
    return sendExtensionCommandOnce(action, data, timeoutMs, recoveredSocket, role, signal);
  }

  if (!canWakeExtensionRole(role) || !isRecoverableExtensionFailure(result)) return result;
  const recoveredSocket = await wakeExtensionForCommand(action, data, initialSocket, role);
  return sendExtensionCommandOnce(action, data, timeoutMs, recoveredSocket, role, signal);
}

async function sendExtensionCommandAcrossProfiles(action, data = {}, timeoutMs = 180000, acceptResult = () => true, role = null) {
  const sockets = extensionSocketCandidates(role, { fallback: role === EXTENSION_ROLE_TIKTOK }).reverse();
  if (!sockets.length) {
    addBackendLog("error", "extension", `send command failed: ${action}`, "Extension is not connected.");
    throw new Error("Extension is not connected.");
  }

  let lastResult = null;
  let lastError = null;
  for (const socket of sockets) {
    const socketMeta = extensionSocketMeta.get(socket) || {};
    const socketRole = role || socketMeta.extensionRole || EXTENSION_ROLE_MAIN;
    try {
      const result = await sendExtensionCommand(action, data, timeoutMs, socket, socketRole);
      lastResult = result;
      if (acceptResult(result)) return result;
      addBackendLog("warn", "extension", `command result rejected, trying next profile: ${action}`, {
        socketId: socketMeta.id || null,
        ok: result?.ok,
        error: result?.error || "",
      });
    } catch (error) {
      lastError = error;
      addBackendLog("warn", "extension", `command failed, trying next profile: ${action}`, {
        socketId: socketMeta.id || null,
        error: String(error.message || error),
      });
    }
  }

  if (lastResult) return lastResult;
  throw lastError || new Error("Extension command failed in every Chrome profile.");
}

async function sendExtensionCommandToAllProfiles(action, data = {}, timeoutMs = 180000, role = null) {
  const sockets = extensionSocketCandidates(role, { fallback: role === EXTENSION_ROLE_TIKTOK }).reverse();
  if (!sockets.length) {
    addBackendLog("error", "extension", `send command failed: ${action}`, "Extension is not connected.");
    throw new Error("Extension is not connected.");
  }

  const results = await Promise.all(sockets.map(async (socket) => {
    const socketMeta = extensionSocketMeta.get(socket) || {};
    const socketRole = role || socketMeta.extensionRole || EXTENSION_ROLE_MAIN;
    const socketHint = chromeProfileHintsBySocketId.get(Number(socketMeta.id)) || {};
    try {
      const result = await sendExtensionCommand(action, data, timeoutMs, socket, socketRole);
      return {
        ok: result?.ok !== false,
        socketId: socketMeta.id || null,
        installId: socketMeta.installId || "",
        profileLabel: socketHint.profileLabel || socketMeta.profileLabel || (socketMeta.id ? `Chrome #${socketMeta.id}` : ""),
        profileStableId: socketHint.profileStableId || socketHint.chromeProfileStableId || "",
        chromeProfileStableId: socketHint.chromeProfileStableId || socketHint.profileStableId || "",
        userDataDir: socketHint.userDataDir || "",
        profileDirectory: socketHint.profileDirectory || "",
        profileDir: socketHint.profileDir || "",
        status: "online",
        result,
      };
    } catch (error) {
      addBackendLog("warn", "extension", `command failed for profile: ${action}`, {
        socketId: socketMeta.id || null,
        error: String(error.message || error),
      });
      return {
        ok: false,
        socketId: socketMeta.id || null,
        installId: socketMeta.installId || "",
        profileLabel: socketHint.profileLabel || socketMeta.profileLabel || (socketMeta.id ? `Chrome #${socketMeta.id}` : ""),
        profileStableId: socketHint.profileStableId || socketHint.chromeProfileStableId || "",
        chromeProfileStableId: socketHint.chromeProfileStableId || socketHint.profileStableId || "",
        userDataDir: socketHint.userDataDir || "",
        profileDirectory: socketHint.profileDirectory || "",
        profileDir: socketHint.profileDir || "",
        status: "online",
        error: String(error.message || error),
        result: null,
      };
    }
  }));

  return results;
}

function readRawBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeUploadName(value) {
  const ext = path.extname(value || "").toLowerCase() || ".mp4";
  const base = path.basename(value || "clip", ext)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "clip";
  return `${base}${ext}`;
}

function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
  if (!boundary) throw new Error("Missing multipart boundary.");

  const delimiter = Buffer.from(`--${boundary}`);
  let offset = buffer.indexOf(delimiter);
  while (offset >= 0) {
    const partStart = offset + delimiter.length;
    const next = buffer.indexOf(delimiter, partStart);
    if (next < 0) break;
    let part = buffer.slice(partStart, next);
    if (part.slice(0, 2).toString() === "--") break;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd > 0) {
      const headerText = part.slice(0, headerEnd).toString("utf8");
      const filenameMatch = headerText.match(/filename="([^"]*)"/i);
      if (filenameMatch) {
        const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
        const data = part.slice(headerEnd + 4);
        if (!data.length) throw new Error("Uploaded file is empty.");
        return {
          filename: path.basename(filenameMatch[1] || "clip.mp4"),
          contentType: typeMatch ? typeMatch[1].trim() : "",
          data,
        };
      }
    }
    offset = next;
  }
  throw new Error("No file field found in multipart body.");
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `${command} exited with ${code}`).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseAdbDeviceLine(line) {
  const text = String(line || "").trim();
  if (!text || /^List of devices/i.test(text)) return null;
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;
  const udid = parts[0];
  const status = parts[1];
  const detail = {};
  for (const part of parts.slice(2)) {
    const idx = part.indexOf(":");
    if (idx > 0) detail[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return {
    udid,
    status,
    model: detail.model || detail.product || detail.device || "",
    product: detail.product || "",
    device: detail.device || "",
    transport: detail.transport_id || "",
    raw: text,
  };
}

async function scanAdbDevices() {
  const adbPath = findAdbExecutable();
  const result = await runCommand(adbPath, ["devices", "-l"]);
  return result.stdout
    .split(/\r?\n/)
    .map(parseAdbDeviceLine)
    .filter(Boolean);
}

function findAdbExecutable() {
  const candidates = [
    process.env.ADB_PATH,
    path.join(ROOT, "adbutils", "binaries", "adb.exe"),
    path.join(ROOT, "lib", "adb", "adb.exe"),
    path.join("C:", "Users", "Blue", "Documents", "Aotutik", "extracted_video2", "adbutils", "binaries", "adb.exe"),
    path.join("C:", "Xampp", "htdocs", "NProject", "Automate Tik", "dist", "TikTokManagerPro 1.0.8", "_internal", "adbutils", "binaries", "adb.exe"),
    "adb",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "adb") return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore bad candidate */
    }
  }
  return "adb";
}

function fileUrlFromRoot(filePath) {
  // Finished TikTok clips live in the Video Library folder, which is outside
  // ROOT and therefore unreachable through the normal static handler — serve
  // those through the dedicated /library-file/ route instead.
  const libraryDir = readLibraryFolder();
  if (libraryDir) {
    const relLibrary = path.relative(libraryDir, filePath);
    if (relLibrary && !relLibrary.startsWith("..") && !path.isAbsolute(relLibrary)) {
      return `/library-file/${relLibrary.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`;
    }
  }
  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  return `/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function thaiCharCount(text) {
  return (String(text || "").match(/[\u0e00-\u0e7f]/g) || []).length;
}

function mojibakeCharCount(text) {
  return (String(text || "").match(/[\uFFFD\u0100-\u024F\u0370-\u052F\u0590-\u06FF\u2930-\u2BFF]/g) || []).length;
}

function repairLegacyUtf8MojibakeText(value) {
  const text = String(value ?? "");
  if (!/(?:\u00e0[\u00b8\u00b9]|\u00c3|\u00c2|\u00e2|\u0e40\u0e18|\u0e40\u0e19|\u0e22\u0e17)/.test(text)) return text;
  try {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    return thaiCharCount(repaired) > thaiCharCount(text) ? repaired : text;
  } catch {
    return text;
  }
}

function looksUnreadableText(value) {
  const text = String(value || "");
  if (!text) return false;
  if (/\uFFFD|(?:\u00e0[\u00b8\u00b9])|\u00c3|\u00c2|\u00e2/.test(text)) return true;
  return mojibakeCharCount(text) >= 2 && thaiCharCount(text) < 2;
}

function cleanUtf8DisplayText(value, fallback = "") {
  const text = repairLegacyUtf8MojibakeText(value)
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || looksUnreadableText(text)) return String(fallback || "").trim();
  return text;
}

function readFinalFileMetadata(videoPath) {
  try {
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);
    const relativeVideo = path.relative(FINAL_FILE_DIR, videoPath);
    const relativeDir = relativeVideo && !relativeVideo.startsWith("..") && !path.isAbsolute(relativeVideo)
      ? path.dirname(relativeVideo)
      : "";
    const jsCandidates = [
      relativeDir && relativeDir !== "." ? path.join(FINAL_FILE_JS_DIR, relativeDir, `${base}.js`) : "",
      path.join(FINAL_FILE_JS_DIR, `${base}.js`),
    ].filter(Boolean);
    const jsPath = jsCandidates.find((candidate) => fs.existsSync(candidate));
    if (!jsPath) return null;
    const source = fs.readFileSync(jsPath, "utf8");
    const match = source.match(/const\s+AUTO_GT_FINAL_FILE\s*=\s*([\s\S]*?);\s*(?:if\s*\(|$)/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const fallbackName = data.productId || data.productID
      ? `สินค้า ${data.platform || ""} ${data.productId || data.productID}`.replace(/\s+/g, " ").trim()
      : path.basename(videoPath, ext);
    const productName = cleanUtf8DisplayText(data.productName || data.title || "", fallbackName);
    const caption = cleanUtf8DisplayText(data.caption || data.productName || "", productName);
    return {
      productName,
      productId: data.productId || data.productID || "",
      productID: data.productID || data.productId || "",
      platform: data.platform || "",
      sourceUrl: data.sourceUrl || "",
      caption,
      finalUrl: fileUrlFromRoot(videoPath),
      finalFile: videoPath,
      jsFile: jsPath,
      jsUrl: fileUrlFromRoot(jsPath),
    };
  } catch (error) {
    addBackendLog("warn", "api:mobile", "Cannot read Final-File-JS metadata", {
      videoPath,
      error: String(error.message || error),
    });
    return null;
  }
}

function scanVideosInDir(dir, source, bucket) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanVideosInDir(full, source, bucket);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (![".mp4", ".webm", ".mov", ".m4v"].includes(ext)) continue;
    const stat = fs.statSync(full);
    const meta = source === "Final-File" ? readFinalFileMetadata(full) : null;
    bucket.push({
      id: crypto.createHash("sha1").update(full).digest("hex").slice(0, 16),
      title: meta?.productName || path.basename(entry.name, ext),
      name: entry.name,
      path: full,
      url: fileUrlFromRoot(full),
      source,
      productName: meta?.productName || "",
      productId: meta?.productId || "",
      productID: meta?.productID || meta?.productId || "",
      platform: meta?.platform || "",
      sourceUrl: meta?.sourceUrl || "",
      caption: meta?.caption || "",
      metadataJsFile: meta?.jsFile || "",
      metadataJsUrl: meta?.jsUrl || "",
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
}

function scanMobileVideoLibrary() {
  normalizeFinalPlatformFiles();
  const videos = [];
  // Finished TikTok clips now land in the Video Library folder, so scan it too;
  // Final-File is still read for older clips and for the Shopee side.
  const libraryDir = readLibraryFolder();
  if (libraryDir) scanVideosInDir(libraryDir, "Video Library", videos);
  scanVideosInDir(FINAL_FILE_DIR, "Final-File", videos);
  scanVideosInDir(UPLOADS_DIR, "Uploads", videos);
  scanVideosInDir(FLOW_RESULTS_DIR, "Flow Results", videos);
  videos.sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
  return videos.slice(0, 300);
}

function resolveMobileVideoPath(payload = {}) {
  const raw = String(payload.videoPath || payload.path || payload.file || payload.videoFile || "").trim();
  if (raw && path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
  const url = String(payload.videoUrl || payload.url || payload.localUrl || "").trim();
  if (url.startsWith("/")) {
    const decoded = decodeURIComponent(url.split("?")[0].replace(/^\/+/, ""));
    const target = path.resolve(ROOT, decoded);
    if (target.startsWith(ROOT) && fs.existsSync(target)) return target;
  }
  if (raw) {
    const target = path.resolve(ROOT, raw);
    if (target.startsWith(ROOT) && fs.existsSync(target)) return target;
  }
  throw new Error("Mobile video file not found. Scan Library again and select a valid Final-File video.");
}

function mobilePlatformConfig(platform) {
  const key = String(platform || "tiktok").toLowerCase() === "shopee" ? "shopee" : "tiktok";
  if (key === "shopee") {
    return {
      key,
      label: "Shopee",
      packageName: process.env.SHOPEE_ANDROID_PACKAGE || "com.shopee.th",
      packageCandidates: [
        process.env.SHOPEE_ANDROID_PACKAGE,
        "com.shopee.th",
        "com.shopee.ph",
        "com.shopee.my",
        "com.shopee.id",
      ].filter(Boolean),
    };
  }
  return {
    key,
    label: "TikTok",
    packageName: process.env.TIKTOK_ANDROID_PACKAGE || "com.zhiliaoapp.musically",
    packageCandidates: [
      process.env.TIKTOK_ANDROID_PACKAGE,
      "com.zhiliaoapp.musically",
      "com.ss.android.ugc.trill",
    ].filter(Boolean),
  };
}

function safeDeviceFileName(value, fallback = "autogt-video.mp4") {
  const name = path.basename(String(value || fallback)).replace(/[^\w.\-]+/g, "_");
  return name || fallback;
}

async function adbRun(args, detailLabel) {
  const adbPath = findAdbExecutable();
  try {
    return await runCommand(adbPath, args);
  } catch (error) {
    throw new Error(`${detailLabel || "adb"} failed: ${error.message || error}`);
  }
}

async function pushMobileVideoToDevice(udid, filePath, jobId) {
  const safeName = `${Date.now()}-${safeDeviceFileName(filePath)}`;
  const remote = `/sdcard/DCIM/AutoPost/${safeName}`;
  await adbRun(["-s", udid, "shell", "mkdir", "-p", "/sdcard/DCIM/AutoPost"], "adb mkdir");
  addBackendLog("info", "mobile:adb", "Pushing video to Android device", { jobId, udid, filePath, remote });
  await adbRun(["-s", udid, "push", filePath, remote], "adb push");
  addBackendLog("info", "mobile:adb", "Refreshing Android media scanner", { jobId, remote });
  await adbRun([
    "-s",
    udid,
    "shell",
    "am",
    "broadcast",
    "-a",
    "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
    "-d",
    `file://${remote}`,
  ], "media scanner");
  return remote;
}

async function openMobileShareIntent({ udid, remotePath, caption, config, jobId }) {
  const streamUrl = `file://${remotePath}`;
  const candidates = config.packageCandidates?.length ? config.packageCandidates : [config.packageName];
  let lastError = null;
  for (const packageName of candidates) {
    const args = [
      "-s",
      udid,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.SEND",
      "-t",
      "video/mp4",
      "--eu",
      "android.intent.extra.STREAM",
      streamUrl,
      "--es",
      "android.intent.extra.TEXT",
      String(caption || ""),
      "-p",
      packageName,
    ];
    addBackendLog("info", "mobile:adb", `Opening ${config.label} mobile share intent`, {
      jobId,
      udid,
      packageName,
      remotePath,
    });
    try {
      await adbRun(args, `${config.label} share intent`);
      return packageName;
    } catch (error) {
      lastError = error;
      addBackendLog("warn", "mobile:adb", `${config.label} package candidate failed`, {
        jobId,
        packageName,
        error: String(error.message || error),
      });
    }
  }
  throw lastError || new Error(`${config.label} share intent failed`);
}

async function runMobilePostAutomation(payload = {}) {
  const udid = String(payload.udid || payload.deviceId || "").trim();
  if (!udid) throw new Error("Missing Android UDID/channel.");
  const config = mobilePlatformConfig(payload.platform);
  const videoPath = resolveMobileVideoPath(payload);
  const finalMeta = readFinalFileMetadata(videoPath);
  const caption = payload.caption || finalMeta?.caption || finalMeta?.productName || payload.videoTitle || "";
  const productId = payload.productId || finalMeta?.productId || "";
  const sourceUrl = payload.sourceUrl || finalMeta?.sourceUrl || "";
  const productName = payload.productName || finalMeta?.productName || payload.videoTitle || "";
  const jobId = payload.id || payload.jobId || `mobile-${Date.now()}`;

  addBackendLog("info", "mobile:post", `${config.label} mobile automation started`, {
    jobId,
    udid,
    videoPath,
    productName,
    productId,
    sourceUrl,
  });
  const remotePath = await pushMobileVideoToDevice(udid, videoPath, jobId);
  const packageName = await openMobileShareIntent({ udid, remotePath, caption, config, jobId });
  addBackendLog("info", "mobile:post", `${config.label} mobile automation handed off to app`, {
    jobId,
    packageName,
    remotePath,
    productName,
    productId,
    sourceUrl,
  });
  return {
    mode: "adb-share-intent",
    platform: config.key,
    packageName,
    remotePath,
    productName,
    productId,
    sourceUrl,
  };
}

function readWsTextFrames(socket, chunk) {
  socket._autogtBuffer = socket._autogtBuffer
    ? Buffer.concat([socket._autogtBuffer, chunk])
    : Buffer.from(chunk);

  const messages = [];
  let offset = 0;
  const buffer = socket._autogtBuffer;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let header = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const big = buffer.readBigUInt64BE(offset + 2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large.");
      length = Number(big);
      header = 10;
    }

    const maskBytes = masked ? 4 : 0;
    const frameEnd = offset + header + maskBytes + length;
    if (frameEnd > buffer.length) break;

    const mask = masked ? buffer.subarray(offset + header, offset + header + 4) : null;
    const payload = Buffer.from(buffer.subarray(offset + header + maskBytes, frameEnd));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }

    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    if (opcode === 0x8) socket.end();
    offset = frameEnd;
  }

  socket._autogtBuffer = buffer.subarray(offset);
  return messages;
}

function touchExtensionSocket(socket, extra = {}) {
  if (!socket) return null;
  const now = new Date().toISOString();
  const meta = extensionSocketMeta.get(socket) || {
    id: ++extensionSocketSeq,
    connectedAt: now,
    lastSeen: now,
    version: null,
  };
  Object.assign(meta, extra, { lastSeen: now });
  extensionSocketMeta.set(socket, meta);
  if (extensionSockets.has(socket)) {
    extensionSockets.delete(socket);
    extensionSockets.add(socket);
  }
  return meta;
}

function activeExtensionSocket(role = EXTENSION_ROLE_MAIN) {
  // TikTok-only commands may use the Main Extension because it still exposes
  // TikTok actions. Main commands must never fall through to the TikTok-only
  // extension, otherwise recovery can wake the wrong Chrome profile.
  const sockets = extensionSocketCandidates(role, { fallback: role === EXTENSION_ROLE_TIKTOK });
  if (!sockets.length) return null;
  return sockets[sockets.length - 1];
}

function extensionSocketById(socketId, role = null) {
  const id = Number(socketId);
  if (!Number.isFinite(id)) return null;
  return extensionSocketCandidates(role, { fallback: role === EXTENSION_ROLE_TIKTOK }).find((socket) => Number(extensionSocketMeta.get(socket)?.id) === id) || null;
}

function extensionSocketByInstallId(installId, role = null) {
  const target = String(installId || "").trim();
  if (!target) return null;
  return extensionSocketCandidates(role, { fallback: role === EXTENSION_ROLE_TIKTOK }).find((socket) => String(extensionSocketMeta.get(socket)?.installId || "").trim() === target) || null;
}

function extensionSocketCandidates(role = null, options = {}) {
  const sockets = [...extensionSockets].filter((socket) => {
    if (socket.destroyed || socket.writable === false) return false;
    const meta = extensionSocketMeta.get(socket) || {};
    const socketRole = String(meta.extensionRole || EXTENSION_ROLE_MAIN);
    // A different app's lifecycle/soak harness can connect to the same local
    // port and used to become the "latest" Main Extension. Never dispatch real
    // account/cookie commands to a client that does not match this app's loaded
    // Main Extension build.
    if (socketRole === EXTENSION_ROLE_MAIN) {
      return SUPPORTED_MAIN_EXTENSION_VERSIONS.has(String(meta.version || ""));
    }
    return true;
  });
  let filtered = sockets;
  if (role) {
    filtered = sockets.filter((socket) => String(extensionSocketMeta.get(socket)?.extensionRole || EXTENSION_ROLE_MAIN) === role);
    if (!filtered.length && options.fallback) filtered = sockets;
  }
  filtered.sort((a, b) => {
    const ma = extensionSocketMeta.get(a) || {};
    const mb = extensionSocketMeta.get(b) || {};
    return String(ma.lastSeen || ma.connectedAt || "").localeCompare(String(mb.lastSeen || mb.connectedAt || ""));
  });
  return filtered;
}

function refreshExtensionStateFromMain() {
  const mainSockets = extensionSocketCandidates(EXTENSION_ROLE_MAIN);
  const latest = mainSockets[mainSockets.length - 1] || null;
  const meta = latest ? extensionSocketMeta.get(latest) || {} : {};
  extensionState.connected = !!latest;
  extensionState.lastSeen = meta.lastSeen || (latest ? new Date().toISOString() : extensionState.lastSeen);
  extensionState.version = meta.version || null;
  extensionState.lastMessage = latest ? (meta.lastMessage || "connected") : "disconnected";
  extensionState.flowAccountEmail = meta.flowAccountEmail || "";
  return { socket: latest, meta };
}

function markExtensionMessage(raw, socket = null) {
  try {
    const msg = JSON.parse(raw);
    const helloData = msg.type === "ext.hello" && msg.data ? msg.data : null;
    const helloRole = String(helloData?.extensionRole || "").trim() || EXTENSION_ROLE_MAIN;
    const meta = touchExtensionSocket(socket, {
      version: helloData?.version ? helloData.version : extensionSocketMeta.get(socket)?.version,
      installId: helloData?.installId ? helloData.installId : extensionSocketMeta.get(socket)?.installId,
      profileLabel: helloData
        ? realExtensionProfileLabel(helloData.profileLabel, helloData.installId)
        : extensionSocketMeta.get(socket)?.profileLabel,
      flowAccountEmail: helloData?.flowAccountEmail ? helloData.flowAccountEmail : extensionSocketMeta.get(socket)?.flowAccountEmail,
      bindToken: helloData?.bindToken ? helloData.bindToken : extensionSocketMeta.get(socket)?.bindToken,
      extensionRole: helloData ? helloRole : (extensionSocketMeta.get(socket)?.extensionRole || EXTENSION_ROLE_MAIN),
      lastMessage: msg.type || "message",
    });
    refreshExtensionStateFromMain();
    if (helloData?.bindToken) {
      resolvePendingChromeProfileBinding(helloData.bindToken, socket);
    }
    if (msg.type === "ext.hello" && msg.data && msg.data.version) {
      upsertExtensionProfile(meta, {
        installId: meta?.installId,
        profileLabel: meta?.profileLabel,
        version: msg.data.version,
        extensionRole: meta?.extensionRole || EXTENSION_ROLE_MAIN,
        socketId: meta?.id || null,
        status: "online",
        connected: true,
        lastMessage: "ext.hello",
      });
      addBackendLog("info", "extension", "Extension hello", {
        socketId: meta?.id || null,
        installId: meta?.installId || "",
        profileLabel: meta?.profileLabel || "",
        extensionRole: meta?.extensionRole || EXTENSION_ROLE_MAIN,
        version: msg.data.version,
        sockets: extensionSockets.size,
      });
    }
    if (msg.type === "ext.status" && msg.jobId) {
      addBackendLog("info", "extension", `status: ${msg.data?.stage || "ext.status"}`, {
        jobId: msg.jobId,
        message: msg.data?.message || "",
        progress: msg.data?.progress ?? null,
      });
      const pending = pendingExtensionJobs.get(msg.jobId);
      if (pending?.progressKey) {
        latestProgress[pending.progressKey] = {
          ...msg.data,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    if ((msg.type === "ext.result" || msg.type === "ext.error") && msg.jobId) {
      addBackendLog(msg.type === "ext.error" || msg.data?.ok === false ? "error" : "info", "extension", `${msg.type}: ${msg.data?.action || ""}`, {
        jobId: msg.jobId,
        ok: msg.data?.ok,
        error: msg.data?.error || msg.data?.message || "",
      });
      const pending = pendingExtensionJobs.get(msg.jobId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingExtensionJobs.delete(msg.jobId);
        if (msg.type === "ext.error") pending.reject(new Error(msg.data?.error || msg.data?.message || "Extension error."));
        else pending.resolve(msg.data || {});
      }
    }
  } catch {
    touchExtensionSocket(socket, { lastMessage: "raw" });
    refreshExtensionStateFromMain();
  }
}

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws/extension") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
    "",
    "",
  ].join("\r\n"));

  extensionSockets.add(socket);
  const meta = touchExtensionSocket(socket, { lastMessage: "connected" });
  refreshExtensionStateFromMain();

  addBackendLog("info", "extension", "WebSocket connected", {
    socketId: meta?.id || null,
    extensionRole: meta?.extensionRole || EXTENSION_ROLE_MAIN,
    sockets: extensionSockets.size,
  });

  sendWsText(socket, {
    v: 1,
    type: "ext.ping",
    jobId: null,
    data: { app: "AutoGT Pro", mode: "dev-bridge" },
  });

  socket.on("data", (chunk) => {
    try {
      for (const message of readWsTextFrames(socket, chunk)) markExtensionMessage(message, socket);
    } catch (error) {
      extensionState.lastMessage = String(error.message || error);
      touchExtensionSocket(socket, { lastMessage: extensionState.lastMessage });
    }
  });
  socket.on("close", () => {
    const closedMeta = extensionSocketMeta.get(socket);
    if (closedMeta?.installId) {
      upsertExtensionProfile(closedMeta, {
        status: "offline",
        connected: false,
        socketId: closedMeta.id || null,
        lastMessage: "disconnected",
        lastSeen: new Date().toISOString(),
      });
    }
    extensionSockets.delete(socket);
    extensionSocketMeta.delete(socket);
    refreshExtensionStateFromMain();
      addBackendLog("warn", "extension", "WebSocket disconnected", {
        socketId: closedMeta?.id || null,
        extensionRole: closedMeta?.extensionRole || EXTENSION_ROLE_MAIN,
        sockets: extensionSockets.size,
      });
  });
  socket.on("error", () => {});
});

normalizeFinalPlatformFiles();

// Without these, ANY unhandled exception/rejection anywhere in this server
// (a bad await, an unexpected field shape, whatever) kills the whole Node
// process instantly and silently — ported from BlueSPite's server.mjs, which
// has the same protection for the same reason. This can't make a crash
// survivable (process state may be corrupted — it still exits after), but it
// makes the LAST thing that happened durable: logged to the console (which
// ai_studio_server.py redirects to runtime/ai-studio-server.log) and to the
// in-memory backend log the app's own Log dock reads, instead of the process
// just vanishing with zero diagnostic trail.
function crashLog(label, err) {
  const message = err instanceof Error ? (err.stack || err.message) : String(err);
  try { addBackendLog("error", "server", `Unhandled ${label} — server exiting`, { message }); } catch { /* best effort */ }
  console.error(`\n[server] ${label}:\n${message}\n`);
  process.exitCode = 1;
  process.exit(1);
}
process.on("uncaughtException", (err) => crashLog("uncaughtException", err));
process.on("unhandledRejection", (err) => crashLog("unhandledRejection", err));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AutoGT Pro dev server`);
  console.log(`http://127.0.0.1:${PORT}`);
  console.log(`Watching: ${ROOT}`);
});




