// Popup: show the bridge connection state plus, per site, the accounts the
// desktop app has saved — synced live from the app over the localhost bridge.
// The app port is fixed (18787, the AI Studio Node server), so it is NOT
// shown here.

// showType: Flow/SuperGrok are tiered generation logins, so each account's plan
// (e.g. "ULTRA x20") is shown in the dropdown. TikTok is a publishing login with
// no tier, so its dropdown lists handles only.
const PROVIDERS = [
  { label: "TikTok", host: "tiktok.com", domains: ["tiktok.com"], cookies: ["sessionid", "sid_tt"], provider: "tiktok", showType: false },
];

const TIER_LABEL = { free: "FREE", pro: "PRO", ultra: "ULTRA" };

// Mirror the app's Settings TYPE column: prefer the precise plan label, else the tier.
function accountType(acc) {
  if (acc.plan) return acc.plan;
  return TIER_LABEL[acc.tier] || (acc.tier || "");
}

const DEFAULT_PORT = 18787;
const CHECK_MARK = String.fromCharCode(10003);
const CROSS_MARK = String.fromCharCode(215);

const dotBridge = document.getElementById("dotBridge");
const valBridge = document.getElementById("valBridge");
const statusGrid = document.getElementById("statusGrid");
const reconnectBtn = document.getElementById("reconnect");
const versionEl = document.getElementById("version");
const heroDot = document.getElementById("heroDot");
const heroText = document.getElementById("heroText");

function renderConnection(connected) {
  // body.connected swaps the disconnected hero for the full status grid (CSS).
  document.body.classList.toggle("connected", !!connected);
  dotBridge.classList.toggle("on", !!connected);
  dotBridge.textContent = "";
  valBridge.textContent = connected ? CHECK_MARK : CROSS_MARK;
  heroDot.classList.toggle("on", !!connected);
  heroDot.textContent = "";
  heroText.textContent = connected ? CHECK_MARK : "Waiting for app";
}

// --- Browser login state only -----------------------------------------------
async function fetchAppAccounts() {
  return null;
}

// --- Browser login (fallback when the app is offline) ------------------------
async function isSignedIn(provider) {
  try {
    const domains = provider.domains || [provider.host];
    const names = provider.cookies || [provider.cookie];
    const groups = await Promise.all(domains.map((domain) => chrome.cookies.getAll({ domain }).catch(() => [])));
    return groups.flat().some((c) => names.some((name) => c.name.includes(name)) && c.value);
  } catch (_) {
    return false; // cookies permission missing or domain unreadable
  }
}

// Each provider entry is a container <li> holding the clickable row plus a
// collapsible menu that lists the saved account handles (revealed on click).
function accountRow(provider) {
  const li = document.createElement("li");
  li.className = "acct";
  li.dataset.provider = provider.provider;

  const row = document.createElement("div");
  row.className = "status-row off";

  const dot = document.createElement("span");
  dot.className = "status-mark";
  dot.textContent = "";

  const label = document.createElement("span");
  label.className = "status-label";
  label.textContent = provider.label;
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = provider.host;
  label.appendChild(host);

  const value = document.createElement("span");
  value.className = "status-value";
  value.textContent = CROSS_MARK;

  const chevron = document.createElement("span");
  chevron.className = "acct-chevron";
  chevron.textContent = "v";

  row.append(dot, label, value, chevron);

  const menu = document.createElement("ul");
  menu.className = "acct-menu";

  li.append(row, menu);

  // Expand/collapse — only meaningful when the row actually has accounts.
  row.addEventListener("click", () => {
    if (li.classList.contains("has-accounts")) li.classList.toggle("open");
  });

  return li;
}

function countText(total) {
  if (!total) return "No account";
  return total === 1 ? "1 account" : `${total} accounts`;
}

function applyAppRow(item, summary, provider) {
  const total = summary ? summary.total : 0;
  const usable = !!(summary && summary.usable > 0);
  const accounts = (summary && summary.accounts) || [];
  const row = item.querySelector(".status-row");
  const value = row.querySelector(".status-value");
  const menu = item.querySelector(".acct-menu");

  row.classList.toggle("on", usable);
  row.classList.toggle("off", !usable);
  const mark = row.querySelector(".status-mark");
  mark.classList.toggle("on", usable);
  mark.textContent = "";
  value.textContent = usable ? CHECK_MARK : CROSS_MARK;

  // is-empty drives the "No account → bottom" sort.
  item.classList.toggle("is-empty", total === 0);

  // Rebuild the dropdown: one entry per saved account (handle + type badge).
  // Only rows that actually have accounts are expandable.
  menu.textContent = "";
  item.classList.toggle("has-accounts", total > 0);
  if (total === 0) item.classList.remove("open");
  for (const acc of accounts) {
    const opt = document.createElement("li");
    opt.className = "acct-item";
    // dim accounts the program can't use right now (toggled off or expired)
    if (!acc.enabled || acc.status !== "active") opt.classList.add("inactive");

    const name = document.createElement("span");
    name.className = "acct-email";
    name.textContent = acc.email || "(no label)";
    name.title = acc.email || "";
    opt.appendChild(name);

    const typeText = provider.showType ? accountType(acc) : "";
    if (typeText) {
      const badge = document.createElement("span");
      badge.className = "acct-type";
      badge.textContent = typeText;
      opt.appendChild(badge);
    }
    menu.appendChild(opt);
  }
}

async function applyBrowserRow(item, provider) {
  // App offline → we only know this browser's binary login state, no list.
  const signedIn = await isSignedIn(provider);
  const row = item.querySelector(".status-row");
  row.classList.toggle("on", signedIn);
  row.classList.toggle("off", !signedIn);
  const mark = row.querySelector(".status-mark");
  mark.classList.toggle("on", signedIn);
  mark.textContent = "";
  row.querySelector(".status-value").textContent = signedIn ? CHECK_MARK : CROSS_MARK;
  item.classList.toggle("is-empty", !signedIn);
  item.classList.remove("has-accounts", "open");
  item.querySelector(".acct-menu").textContent = "";
}

// Providers with accounts first (in PROVIDERS order); "No account" rows sink to
// the bottom. The static App Bridge row stays first (it isn't an .acct).
function reorderRows() {
  const ordered = PROVIDERS
    .map((p) => statusGrid.querySelector(`.acct[data-provider="${p.provider}"]`))
    .filter(Boolean);
  const withAccounts = ordered.filter((el) => !el.classList.contains("is-empty"));
  const empty = ordered.filter((el) => el.classList.contains("is-empty"));
  for (const el of [...withAccounts, ...empty]) statusGrid.appendChild(el);
}

async function renderAccounts() {
  if (!statusGrid.querySelector(".acct")) {
    for (const p of PROVIDERS) statusGrid.appendChild(accountRow(p));
  }
  const appAccounts = await fetchAppAccounts();

  await Promise.all(
    PROVIDERS.map(async (provider) => {
      const item = statusGrid.querySelector(`.acct[data-provider="${provider.provider}"]`);
      if (appAccounts) {
        // App reachable → show the program's saved accounts (the source of truth).
        applyAppRow(item, appAccounts[provider.provider], provider);
      } else {
        // App offline → fall back to this browser's login cookie.
        await applyBrowserRow(item, provider);
      }
    })
  );

  reorderRows();
}

async function init() {
  versionEl.textContent = "v" + chrome.runtime.getManifest().version;
  const { connected } = await chrome.storage.local.get("connected");
  renderConnection(connected);
  renderAccounts();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("connected" in changes) {
    renderConnection(changes.connected.newValue);
    // The app just came up / went down — refresh the account rows to match.
    renderAccounts();
  }
});

reconnectBtn.addEventListener("click", async () => {
  heroText.textContent = "Connecting";
  valBridge.textContent = CROSS_MARK;

  // Ask the background worker to launch (or, if it's already running, focus) the
  // desktop app via native messaging, then bring the bridge up. The dot flips to
  // amber via chrome.storage.onChanged the moment the socket connects.
  let launch = null;
  try {
    launch = await chrome.runtime.sendMessage({ type: "__tb_launch_app" });
  } catch (_) {
    // Background worker briefly unavailable — fall back to a plain reconnect.
    chrome.runtime.sendMessage({ type: "__tb_reconnect" });
  }
  renderAccounts();

  // If it hasn't connected shortly after, guide the user. A missing launcher host
  // ({ok:false}) means the app has never been opened on this machine, so it can't be
  // auto-started yet — it must be run once to register itself.
  const hostMissing = !!(launch && launch.ok === false);
  setTimeout(async () => {
    const { connected } = await chrome.storage.local.get("connected");
    if (connected) return;
    const msg = hostMissing ? "Open AutoGT Pro first" : "Waiting for app";
    heroText.textContent = msg;
    valBridge.textContent = msg;
  }, 6000);
});

init();
