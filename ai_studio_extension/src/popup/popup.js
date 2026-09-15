// Popup: one hero block for the bridge state, then one tile per site showing
// whether this Chrome profile is signed in there. The app port is fixed
// (18787, the AI Studio Node server).
const APP_ORIGIN = "http://127.0.0.1:18787";

const ICONS = {
  google_labs: '<svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"></path><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"></path></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5"></path><path d="M14 4c.5 2.5 2.3 4.3 5 4.5"></path></svg>',
};

// The TikTok extension only bridges tiktok.com — one full-width tile.
const PROVIDERS = [
  { label: "TikTok", host: "tiktok.com", domains: ["tiktok.com"], cookies: ["sessionid", "sid_tt"], provider: "tiktok" },
];

const tiles = document.getElementById("tiles");
const reconnectBtn = document.getElementById("reconnect");
const reconnectText = document.getElementById("reconnectText");
const versionEl = document.getElementById("version");
const heroText = document.getElementById("heroText");
const heroMeta = document.getElementById("heroMeta");
const openAppLink = document.getElementById("openApp");

let appStatus = null; // /api/extension-status while the app is reachable

function setState(state, title) {
  document.body.dataset.state = state;
  heroText.textContent = title;
}

function renderConnection(connected) {
  setState(connected ? "online" : "offline", connected ? "เชื่อมต่อแอปแล้ว" : "รอแอปเปิด");
  heroMeta.textContent = APP_ORIGIN.replace("http://", "");
}

async function fetchAppStatus() {
  try {
    const res = await fetch(`${APP_ORIGIN}/api/extension-status`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function isSignedIn(provider) {
  try {
    const groups = await Promise.all(provider.domains.map((domain) => chrome.cookies.getAll({ domain }).catch(() => [])));
    return groups.flat().some((c) => provider.cookies.some((name) => c.name.includes(name)) && c.value);
  } catch (_) {
    return false; // cookies permission missing or domain unreadable
  }
}

function tileFor(provider) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.provider = provider.provider;
  tile.innerHTML = `
    <div class="tile-head">
      <span class="tile-icon">${ICONS[provider.provider] || ""}</span>
      <span class="dot"></span>
    </div>
    <div class="tile-text">
      <span class="tile-title"></span>
      <span class="tile-sub"></span>
    </div>
    <span class="tile-badge"></span>`;
  tile.querySelector(".tile-title").textContent = provider.label;
  tile.querySelector(".tile-sub").textContent = provider.host;
  return tile;
}

async function renderAccounts() {
  if (!tiles.children.length) {
    for (const p of PROVIDERS) tiles.appendChild(tileFor(p));
    tiles.dataset.count = String(PROVIDERS.length);
  }
  await Promise.all(PROVIDERS.map(async (provider) => {
    const tile = tiles.querySelector(`.tile[data-provider="${provider.provider}"]`);
    const signedIn = await isSignedIn(provider);
    const dot = tile.querySelector(".dot");
    dot.classList.toggle("on", signedIn);
    dot.classList.toggle("off", !signedIn);
    const sub = tile.querySelector(".tile-sub");
    const badge = tile.querySelector(".tile-badge");
    // The app reads the live Flow account off the harvest — show it when known.
    const email = provider.provider === "google_labs"
      ? String(appStatus?.mainExtension?.accountEmail || appStatus?.flowAccountEmail || "").trim()
      : "";
    sub.textContent = email || provider.host;
    sub.title = email || provider.host;
    badge.textContent = signedIn ? "ล็อกอินแล้ว" : "ยังไม่ได้ล็อกอิน";
    badge.className = `tile-badge${signedIn ? "" : " bad"}`;
  }));
}

async function refresh() {
  const { connected } = await chrome.storage.local.get("connected");
  appStatus = connected ? await fetchAppStatus() : null;
  renderConnection(!!connected);
  await renderAccounts();
}

async function launchApp() {
  // Ask the background worker to launch (or focus) the desktop app via native
  // messaging, then bring the bridge up. { ok:false } means the launcher host is
  // not registered yet — the app has never been run on this machine.
  try {
    return await chrome.runtime.sendMessage({ type: "__tb_launch_app" });
  } catch (_) {
    chrome.runtime.sendMessage({ type: "__tb_reconnect" });
    return null;
  }
}

reconnectBtn.addEventListener("click", async () => {
  setState("connecting", "กำลังเชื่อมต่อ…");
  reconnectBtn.disabled = true;
  const launch = await launchApp();
  const hostMissing = !!(launch && launch.ok === false);
  setTimeout(async () => {
    reconnectBtn.disabled = false;
    const { connected } = await chrome.storage.local.get("connected");
    if (connected) return refresh();
    setState("offline", hostMissing ? "เปิด TikTok Manager Pro ก่อนหนึ่งครั้ง" : "รอแอปเปิด");
  }, 6000);
});

openAppLink.addEventListener("click", (event) => {
  event.preventDefault();
  launchApp();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "connected" in changes) refresh();
});

versionEl.textContent = "v" + chrome.runtime.getManifest().version;
refresh();
