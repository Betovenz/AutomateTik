const modes = {
  "tiktok-shop": {
    "title": "\u0e02\u0e32\u0e22\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 TikTok",
    "eyebrow": "TikTok sales flow",
    "desc": "\u0e08\u0e31\u0e14\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 TikTok \u0e41\u0e25\u0e30\u0e2a\u0e48\u0e07\u0e44\u0e1b\u0e22\u0e31\u0e07 TikTok units"
  },
  "shopee-shop": {
    "title": "\u0e02\u0e32\u0e22\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 Shopee",
    "eyebrow": "Shopee listing flow",
    "desc": "\u0e08\u0e31\u0e14\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 Shopee \u0e41\u0e25\u0e30\u0e2a\u0e48\u0e07\u0e44\u0e1b\u0e22\u0e31\u0e07 Shopee units"
  },
  "shopee-product-search": {
    "title": "หาสินค้า Shopee",
    "eyebrow": "Shopee Affiliate discovery",
    "desc": "ค้นหาและคัดเลือกสินค้า Shopee Affiliate ด้วยข้อมูลยอดขาย ราคา และค่าคอมมิชชัน"
  },
  "flow-prompt": {
    "title": "ตั้งค่า Prompt",
    "eyebrow": "Google Flow prompt defaults",
    "desc": "ตั้งค่ารูปแบบตัวละคร ฉาก อารมณ์คลิป และโมเดล เป็นค่าเริ่มต้นของทุกสินค้าใน Queue"
  },
  "flow-queue": {
    "title": "คิว",
    "eyebrow": "Google Flow video generation",
    "desc": "จัดคิวสินค้าและติดตามการสร้างวิดีโอด้วย Google Flow"
  },
  "flow-history": {
    "title": "ประวัติ",
    "eyebrow": "Google Flow job history",
    "desc": "สรุปทุกงานสร้างวิดีโอที่เคยรัน สำเร็จ ไม่สำเร็จ หรือยกเลิก"
  },
  "remix-review": {
    "title": "Remixวิดีโอรีวิว",
    "eyebrow": "Review video remix",
    "desc": "นำวิดีโอรีวิวเดิมมาเรียบเรียงใหม่เป็น script, hook และคอนเทนต์พร้อมใช้งาน"
  },
  "post-tiktok-mobile": {
    "title": "Post Tiktok(มือถือ)",
    "eyebrow": "TikTok mobile publishing",
    "desc": "เตรียมงานโพสต์ผ่านมือถือหรือ mobile session สำหรับ workflow ที่ต้องใช้อุปกรณ์จริง"
  },
  "adb-connect": {
    "title": "\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21 ADB",
    "eyebrow": "ADB mobile bridge",
    "desc": "\u0e08\u0e31\u0e14\u0e01\u0e32\u0e23 channel, library \u0e41\u0e25\u0e30 queue \u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a TikTok mobile post"
  }
  // "channel" route removed: it duplicated the parent app's native Channel tab
  // (ui/index.html #channelView). "ไปหน้า Channel" now tells the parent frame
  // to switch to that tab instead of rendering its own copy here.
};

const PLATFORM_UNIT_MODES = {
  "tiktok-flow-prompt": { title: "\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32 Prompt", eyebrow: "TikTok / Flow", desc: "TikTok Flow prompt defaults" },
  "tiktok-flow-queue": { title: "\u0e04\u0e34\u0e27", eyebrow: "TikTok / Flow", desc: "TikTok Flow queue" },
  "tiktok-flow-history": { title: "\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34", eyebrow: "TikTok / Flow", desc: "TikTok Flow history" },
  "tiktok-remix-review": { title: "Remix\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e23\u0e35\u0e27\u0e34\u0e27", eyebrow: "TikTok / Remix", desc: "TikTok remix queue" },
  "tiktok-post-mobile": { title: "Post TikTok(\u0e21\u0e37\u0e2d\u0e16\u0e37\u0e2d)", eyebrow: "TikTok / Mobile Post", desc: "TikTok mobile post" },
  "adb-connect": { title: "\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21 ADB", eyebrow: "ADB / Mobile", desc: "ADB channel and TikTok mobile post" },
  "shopee-flow-prompt": { title: "\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32 Prompt", eyebrow: "Shopee / Flow", desc: "Shopee Flow prompt defaults" },
  "shopee-flow-queue": { title: "\u0e04\u0e34\u0e27", eyebrow: "Shopee / Flow", desc: "Shopee Flow queue" },
  "shopee-flow-history": { title: "\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34", eyebrow: "Shopee / Flow", desc: "Shopee Flow history" },
  "shopee-remix-review": { title: "Remix\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e23\u0e35\u0e27\u0e34\u0e27", eyebrow: "Shopee / Remix", desc: "Shopee remix queue" },
  "shopee-post-mobile": { title: "Post Shopee(\u0e21\u0e37\u0e2d\u0e16\u0e37\u0e2d)", eyebrow: "Shopee / Mobile Post", desc: "Shopee mobile post" }
};

// Extended is available in Settings as the continuous-scene mode.
const FLOW_EXTENDED_ENABLED = true;
Object.assign(modes, PLATFORM_UNIT_MODES);

// Derived from `modes` (post-merge) rather than a separately hand-maintained
// list — the previous hardcoded list only covered 5 of 21 known routes
// (missing shopee-shop and every shopee-flow-* route among others), silently
// bouncing any unlisted-but-valid route back to tiktok-shop.
// Shopee Shop / Product Search / Shopee Remix (and the rest of the shopee-*
// workspace) are retired from the UI: their routes are no longer reachable and
// bounce to tiktok-shop. The code paths behind them stay in place, unwired.
const AUTOTIK_ALLOWED_ROUTES = new Set(Object.keys(modes).filter((route) => !route.startsWith("shopee-")));

const PLATFORM_UNITS = {
  tiktok: [
    { route: "tiktok-shop", icon: "inventory_2", label: "TikTok Shop" },
    { route: "tiktok-flow-prompt", icon: "tune", label: "Flow Prompt" },
    { route: "tiktok-flow-queue", icon: "movie_creation", label: "Flow Queue" },
    { route: "tiktok-flow-history", icon: "history", label: "Flow History" },
    { route: "tiktok-post-mobile", icon: "smartphone", label: "Mobile Post" }
  ],
  shopee: [],
  adb: [
    { route: "adb-connect", icon: "phonelink_setup", label: "\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21 ADB" }
  ]
};

function platformForRoute(route) {
  if (route === "adb-connect") return "adb";
  if (route === "shopee-shop" || (route && route.startsWith("shopee-"))) return "shopee";
  return "tiktok";
}

function mainRouteFor(route) {
  const platform = platformForRoute(route);
  if (platform === "shopee") return "shopee-shop";
  if (platform === "adb") return "adb-connect";
  return "tiktok-shop";
}

function generatorForRoute(route) {
  return "flow";
}

function isGeneratorWorkbenchRoute(route) {
  return /-flow-(prompt|queue|history)$/.test(String(route || ""));
}

function flowPageForRoute(route) {
  const match = /-flow-(prompt|queue|history)$/.exec(String(route || ""));
  return match ? match[1] : "";
}

function isMobilePostRoute(route) {
  return ["tiktok-post-mobile", "shopee-post-mobile"].includes(String(route || ""));
}

function renderUnitMenus(platform, activeRoute) {
  const items = PLATFORM_UNITS[platform] || PLATFORM_UNITS.tiktok;
  document.querySelectorAll(".side-nav:not(.side-bottom)").forEach((nav) => {
    nav.innerHTML = items.map((item) =>
      '<a href="#' + item.route + '" data-route="' + item.route + '" class="' + (item.route === activeRoute ? 'active' : '') + '">' +
      '<span class="material-symbols-outlined">' + item.icon + '</span><span class="side-nav-label">' + item.label + '</span></a>'
    ).join('');
  });
}

function togglePlatformOnlyNav(platform) {
  document.querySelectorAll("[data-platform-only], .side-bottom a[href='#channel']").forEach((item) => {
    const allowedPlatform = item.dataset.platformOnly || "tiktok";
    item.hidden = allowedPlatform !== platform;
  });
}

function ensureMainModeTabs() {
  document.querySelectorAll(".mode-tabs, .nav[aria-label='Main menu']").forEach((nav) => {
    if (nav.querySelector('[data-route="adb-connect"]')) return;
    const adbLink = document.createElement("a");
    adbLink.href = "#adb-connect";
    adbLink.dataset.route = "adb-connect";
    adbLink.textContent = "\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21 ADB";
    nav.appendChild(adbLink);
  });
}

ensureMainModeTabs();

const home = document.querySelector('[data-view="home"]');
const workspace = document.querySelector('[data-view="mode"]');
const title = document.querySelector("#modeTitle");
const eyebrow = document.querySelector("#modeEyebrow");
const desc = document.querySelector("#modeDesc");
const navLinks = [...document.querySelectorAll("[data-route]")];
const pagePanels = [...document.querySelectorAll("[data-mode-page]")];
const extensionPills = [...document.querySelectorAll("[data-extension-status]")];
const appContent = document.querySelector(".app-content");
const tiktokWarning = document.querySelector("[data-tiktok-warning]");
const tiktokWarningTitle = document.querySelector("[data-tiktok-warning-title]");
const tiktokWarningText = document.querySelector("[data-tiktok-warning-text]");
const openTikTokButton = document.querySelector("[data-open-tiktok]");
const EXPECTED_EXTENSION_VERSION = "0.1.22";
let flowGoogleAccountEmail = "";

function setOptionLabels(selectId, labels) {
  const select = document.getElementById(selectId);
  if (!select) return;
  [...select.options].forEach((option, index) => {
    if (labels[index]) option.textContent = labels[index];
  });
}

function setElementText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setButtonText(buttonId, text) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  const icon = button.querySelector(".material-symbols-outlined")?.outerHTML || "";
  button.innerHTML = icon ? `${icon} ${text}` : text;
}

function setLabelForControl(controlId, text) {
  const control = document.getElementById(controlId);
  const labelText = control?.closest("label")?.querySelector("span");
  if (labelText) labelText.textContent = text;
}

function repairVisibleStaticText() {
  setElementText('[data-open="tiktok-shop"] h2', "ขายสินค้า TikTok");
  setElementText('[data-open="shopee-shop"] h2', "ขายสินค้า Shopee");  setElementText('[data-open="adb-connect"] h2', "เชื่อม ADB");
  document.querySelectorAll(".mode-card > button").forEach((button) => {
    button.textContent = "เข้าใช้งาน";
  });

  const flowHead = document.querySelector(".flow-editor-head h2");
  if (flowHead) {
    flowHead.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span> คิวสินค้าสร้างวิดีโอ (Queue Items)';
  }
  setElementText("#clipOverviewPanel h3", "ภาพรวมคลิป");
  setLabelForControl("clipCharacterStyle", "รูปแบบตัวละคร (ไม่เลือกก็ได้)");
  setLabelForControl("clipSceneStyle", "ฉากสำหรับ Gen รูปสมจริง");
  setLabelForControl("clipCharacter", "ตัวละคร (ไม่เลือกก็ได้)");
  setLabelForControl("clipMood", "อารมณ์ของคลิป");
  setLabelForControl("clipVoiceMood", "อารมณ์การพูด");
  setLabelForControl("flowImageModel", "Model ภาพ");
  setLabelForControl("flowVideoModel", "Model วิดีโอ");
  setLabelForControl("flowAspect", "ขนาด (Aspect)");
  setLabelForControl("flowSceneCount", "จำนวนคลิป");

  setOptionLabels("clipCharacterStyle", [
    "สมจริง",
    "UGC รีวิวสินค้า",
    "ไลฟ์สไตล์",
    "พรีเมียมแฟชั่น",
    "แม่บ้านใช้งานจริง",
    "วัยรุ่นสดใส",
    "ผู้เชี่ยวชาญแนะนำ",
    "Before / After",
    "ไม่ใช้ตัวละคร",
    "มินิมอลสินค้าเด่น",
    "+ เพิ่มเอง"
  ]);
  setOptionLabels("clipSceneStyle", [
    "ให้ AI เลือกฉากที่เหมาะกับสินค้า",
    "ในบ้านแสงธรรมชาติ",
    "สตูดิโอสินค้า",
    "คาเฟ่ / ไลฟ์สไตล์",
    "โต๊ะทำงาน",
    "ห้องครัว",
    "ห้องน้ำ / โต๊ะเครื่องแป้ง",
    "กลางแจ้ง",
    "ร้านค้า / ชั้นวางสินค้า",
    "พื้นหลังสีเรียบ",
    "+ เพิ่มเอง"
  ]);
  setOptionLabels("clipCharacter", [
    "-- เลือกตัวละคร --",
    "ผู้หญิงวัยทำงาน",
    "ผู้ชายวัยทำงาน",
    "แม่บ้าน / ครอบครัว",
    "วัยรุ่นนักศึกษา",
    "ครีเอเตอร์รีวิวสินค้า",
    "เจ้าของร้านแนะนำสินค้า",
    "ผู้เชี่ยวชาญ / ที่ปรึกษา",
    "คู่รัก",
    "คุณแม่ดูแลลูก",
    "ไม่แสดงตัวละคร",
    "+ เพิ่มเอง"
  ]);
  setOptionLabels("clipMood", [
    "สบายๆ",
    "สนุก สดใส",
    "พรีเมียม",
    "จริงจัง น่าเชื่อถือ",
    "อบอุ่น เป็นกันเอง",
    "เร่งด่วน กระตุ้นซื้อ",
    "หรูหรา",
    "มินิมอล สะอาดตา",
    "ตลกนิดๆ",
    "รีวิวจริงใจ",
    "+ เพิ่มเอง"
  ]);
  setOptionLabels("clipVoiceMood", [
    "สุภาพ",
    "เป็นกันเอง",
    "ขายเก่ง กระชับ",
    "รีวิวจริงใจ",
    "นุ่มนวล อธิบายละเอียด",
    "ตื่นเต้น มีพลัง",
    "มืออาชีพ",
    "เพื่อนแนะนำเพื่อน",
    "ไลฟ์ขายของ",
    "เล่าเรื่องธรรมชาติ",
    "+ เพิ่มเอง"
  ]);
  setOptionLabels("flowVideoModel", [
    "Lite (5 เครดิต)",
    "Veo Standard (10 เครดิต)",
    "Veo Quality (20 เครดิต)"
  ]);
  setOptionLabels("flowSceneCount", [
    "1 คลิป",
    "2 คลิป",
    "3 คลิป",
    "4 คลิป",
    "5 คลิป",
    "6 คลิป",
    "7 คลิป",
    "8 คลิป",
    "9 คลิป",
    "10 คลิป"
  ]);

  setButtonText("applyClipOverviewBtn", "บันทึก");
  setButtonText("clearFlowQueueBtn", "ล้าง Queue");
  setButtonText("createFlowClipsBtn", "สร้างคลิป");
  setButtonText("saveFlowSettingsBtn", "บันทึก");

  const totalLabel = document.getElementById("flowTotalJobs")?.nextElementSibling;
  const doneLabel = document.getElementById("flowDoneJobs")?.nextElementSibling;
  const failedLabel = document.getElementById("flowFailedJobs")?.nextElementSibling;
  if (totalLabel) totalLabel.textContent = "ทั้งหมด";
  if (doneLabel) doneLabel.textContent = "สำเร็จ";
  if (failedLabel) failedLabel.textContent = "ไม่สำเร็จ";
}

function setRoute(route) {
  if (!AUTOTIK_ALLOWED_ROUTES.has(route)) route = "tiktok-shop";
  const mode = modes[route];
  const platform = platformForRoute(route);
  const mainRoute = mainRouteFor(route);
  const generatorMode = generatorForRoute(route);
  const isWorkbench = isGeneratorWorkbenchRoute(route);
  document.body.dataset.route = mode ? route : "home";
  document.body.dataset.platform = mode ? platform : "";
  document.body.dataset.generator = mode ? generatorMode : "";
  document.body.dataset.flowPage = isWorkbench ? flowPageForRoute(route) : "";
  document.body.classList.toggle("workspace-route", !!mode);
  document.body.classList.toggle("flow-workbench-route", !!mode && isWorkbench);
  document.body.classList.toggle("mobile-post-route", !!mode && isMobilePostRoute(route));
  document.body.classList.toggle("adb-device-route", !!mode && route === "adb-connect");

  if (!mode) {
    home.hidden = false;
    workspace.hidden = true;
    history.replaceState(null, "", "#home");
    appContent && (appContent.scrollTop = 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    repairVisibleStaticText();
    return;
  }

  renderUnitMenus(platform, route);
  togglePlatformOnlyNav(platform);
  document.querySelectorAll("[data-route]").forEach((link) => {
    const isMainTab = !!link.closest(".mode-tabs");
    link.classList.toggle("active", link.dataset.route === (isMainTab ? mainRoute : route));
  });

  if (title) title.textContent = mode.title;
  if (eyebrow) eyebrow.textContent = mode.eyebrow;
  if (desc) desc.textContent = mode.desc;

  pagePanels.forEach((panel) => {
    const shouldShow = route === "tiktok-shop" || route === "shopee-shop"
      ? panel.dataset.modePage === route
      : panel.dataset.modePage === "generic";
    panel.hidden = !shouldShow;
  });

  const flowWorkbenchPanel = document.querySelector("[data-flow-workbench]");
  const mobilePostRoutePanel = document.getElementById("mobilePostPanel");
  const adbDeviceRoutePanel = document.getElementById("adbDevicePanel");
  const shopeeDiscoveryPanel = document.getElementById("shopeeProductSearchPanel");
  const shopeeRemixPanel = document.getElementById("shopeeRemixPanel");

  document.querySelectorAll(".route-panel").forEach((panel) => {
    panel.hidden = true;
  });

  if (flowWorkbenchPanel && isWorkbench) flowWorkbenchPanel.hidden = false;
  if (mobilePostRoutePanel && isMobilePostRoute(route)) mobilePostRoutePanel.hidden = false;
  if (adbDeviceRoutePanel && route === "adb-connect") adbDeviceRoutePanel.hidden = false;
  if (shopeeDiscoveryPanel && route === "shopee-product-search") shopeeDiscoveryPanel.hidden = false;
  if (shopeeRemixPanel) shopeeRemixPanel.hidden = route !== "shopee-remix-review";

  setActiveFlowPlatform(platform === "shopee" ? "shopee" : "tiktok", generatorMode);
  if (route === "shopee-remix-review") initShopeeRemix();
  if (isMobilePostRoute(route)) {
    setActiveMobilePlatform(platform === "shopee" ? "shopee" : "tiktok");
    renderMobilePostWorkspace();
  }
  if (route === "adb-connect") renderAdbDeviceWorkspace();
  if (route === "shopee-product-search") renderShopeeDiscovery();
  home.hidden = true;
  workspace.hidden = false;
  appContent && (appContent.scrollTop = 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  history.replaceState(null, "", '#' + route);
  repairVisibleStaticText();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-route], [data-open]");
  // <body> carries data-route as CURRENT-route state (setRoute writes it, and
  // autogt-ui.css styles body[data-route=…]) — it is not a nav trigger. Without
  // this guard .closest() matched the body for EVERY click anywhere on the page,
  // so the preventDefault() below cancelled every default action: the คิว
  // "เริ่มคิวอัตโนมัติ" switch, and any other checkbox, simply would not toggle.
  if (!trigger || trigger === document.body || trigger === document.documentElement) return;
  event.preventDefault();
  setRoute(trigger.dataset.route || trigger.dataset.open || "home");
});

window.addEventListener("hashchange", () => setRoute(location.hash.slice(1) || "home"));

// TikTok Manager Pro's unified sidebar drives this page while it is embedded:
// the parent posts the route it wants shown (it also updates the iframe hash,
// so this is the fast path when the frame is already loaded).
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "autotik:route" || typeof data.route !== "string") return;
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(event.origin || "")) return;
  setRoute(data.route);
});

async function refreshExtensionStatus() {
  try {
    const response = await fetch("/api/extension-status", { cache: "no-store" });
    const status = await response.json();
    const staleExtension = !!status.connected && status.version && status.version !== EXPECTED_EXTENSION_VERSION;
    const connected = !!status.connected && !staleExtension;
    const rawProfileLabel = String(status.mainExtension?.profileLabel || status.mainExtension?.profileDirectory || "").trim();
    const mainProfileLabel = /^(?:Chrome\s+[0-9a-f]{4}|Chrome\s+#\d+)$/i.test(rawProfileLabel) ? "" : rawProfileLabel;
    flowGoogleAccountEmail = String(status.mainExtension?.accountEmail || status.flowAccountEmail || "").trim();
    const connectedIdentity = flowGoogleAccountEmail || mainProfileLabel;
    const connectedLabel = connectedIdentity
      ? `AutoTik v0.1.0 beta · ${connectedIdentity}`
      : "AutoTik Extension v0.1.0 beta connected";
    const tiktokReady = hasUsableTikTokChannelCache() || !!status.tiktokReady || hasTikTokCookies(status.captures?.tiktok);
    extensionPills.forEach((pill) => {
      pill.classList.toggle("is-connected", connected);
      pill.dataset.extensionStatus = connected ? "connected" : (staleExtension ? "stale" : "offline");
      const label = pill.querySelector("[data-extension-label]");
      if (label) label.textContent = staleExtension ? `Reload AutoTik v${EXPECTED_EXTENSION_VERSION}` : (connected ? connectedLabel : "AutoTik Extension v0.1.0 beta offline");
      pill.title = staleExtension
        ? `Chrome is still running AutoTik Extension v${status.version}. Reload the unpacked extension to v${EXPECTED_EXTENSION_VERSION}.`
        : (connected && status.version
          ? `AutoTik Extension v${status.version}${connectedIdentity ? ` · ${connectedIdentity}` : ""}`
          : "AutoTik Extension v0.1.0 beta offline");
    });
    updateTikTokCookieState({ connected, tiktokReady: tiktokReady || await readTikTokCaptureReady() });
  } catch {
    extensionPills.forEach((pill) => {
      pill.classList.remove("is-connected");
      const label = pill.querySelector("[data-extension-label]");
      if (label) label.textContent = "AutoTik Extension v0.1.0 beta offline";
    });
    updateTikTokCookieState({ connected: false, tiktokReady: hasUsableTikTokChannelCache() || await readTikTokCaptureReady() });
  }
}

function hasTikTokCookies(capture) {
  if (!capture) return false;
  if (capture.hasCookies || capture.cookieCount > 0) return true;
  const cookies = Array.isArray(capture.cookies) ? capture.cookies : [];
  return cookies.some((cookie) => /^(sessionid|sessionid_ss|sid_tt)$/i.test(cookie.name || ""));
}

function hasUsableTikTokChannelCache() {
  const selected = normalizePostAccount(showcaseSelectedAccount);
  if (selected && channelCookieStatus(selected).usable) return true;
  return readPostAccountCache().some((account) => channelCookieStatus(account).usable);
}

async function readTikTokCaptureReady() {
  try {
    const response = await fetch("/api/browser-capture/latest?provider=tiktok", { cache: "no-store" });
    if (!response.ok) return false;
    return hasTikTokCookies(await response.json());
  } catch {
    return false;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text || "{}");
  } catch {
    const looksLikeHtml = text.trim().startsWith("<");
    throw new Error(looksLikeHtml
      ? "Server route is not ready. Restart Automate Tik server and reload this page."
      : `Invalid JSON response: ${text.slice(0, 120)}`);
  }
}

function updateTikTokCookieState({ connected, tiktokReady }) {
  if (!tiktokWarning) return;
  tiktokWarning.hidden = tiktokReady;
  tiktokWarning.style.display = tiktokReady ? "none" : "";
  document.body.classList.toggle("has-tiktok-cookie", tiktokReady);
  if (tiktokReady) return;

  if (!connected) {
    if (tiktokWarningTitle) tiktokWarningTitle.textContent = "Extension ยังไม่เชื่อมต่อ";
    if (tiktokWarningText) tiktokWarningText.textContent = "เปิด AutoTik Extension เมื่อต้องการสแกนหรือ refresh Channel เพื่อเก็บ cookie/token ใหม่";
    return;
  }

  if (tiktokWarningTitle) tiktokWarningTitle.textContent = "ยังไม่มี Channel TikTok ที่ใช้ได้";
  if (tiktokWarningText) tiktokWarningText.textContent = "ไปหน้า Channel แล้วกดสแกนหา Account หรือ refresh ช่องที่ต้องการ เพื่อเก็บ cookie/token ก่อนดึง Showcase";
}

openTikTokButton?.addEventListener("click", () => {
  window.open("https://www.tiktok.com/", "_blank", "noopener,noreferrer");
});

refreshExtensionStatus();
setInterval(refreshExtensionStatus, 2000);

document.querySelectorAll("[data-debug-json] summary").forEach((summary) => {
  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const details = summary.closest("details");
    const pre = details?.querySelector("pre");
    if (!details) return;
    details.open = !details.open;
    if (details.open && pre && !pre.textContent.trim()) {
      pre.textContent = "ยังไม่มี JSON ให้แสดง ให้ดึงสินค้าก่อน";
    }
  };

  summary.addEventListener("click", toggle);
  summary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    toggle(event);
  });
});

const showcaseState = {
  products: [],
  filtered: [],
};

const loadShowcaseBtn = document.getElementById("loadShowcaseBtn");
const clearShowcaseBtn = document.getElementById("clearShowcaseBtn");
const toggleSelectBtn = document.getElementById("toggleSelectBtn");
const copySelectedBtn = document.getElementById("copySelectedBtn");
const addShowcaseSelectedBtn = document.getElementById("addShowcaseSelectedBtn");
const queueSelectedBtn = document.getElementById("queueSelectedBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const showcaseStatus = document.getElementById("showcaseStatus");
const showcaseResults = document.getElementById("showcaseResults");
const showcaseResultsSection = document.getElementById("showcaseResultsSection");
const showcaseTotal = document.getElementById("showcaseTotal");
const showcaseVisibleCount = document.getElementById("showcaseVisibleCount");
const selectedCount = document.getElementById("selectedCount");
const rawJson = document.getElementById("rawJson");
const productSearch = document.getElementById("productSearch");
const tiktokLinkUrls = document.getElementById("tiktokLinkUrls");
const checkLinksBtn = document.getElementById("checkLinksBtn");
const showcaseAccountPickBtn = document.getElementById("showcaseAccountPickBtn");
const showcaseSelectedAccountCard = document.getElementById("showcaseSelectedAccountCard");
const MOBILE_CHANNELS_KEY = "autogt.mobile.channels";
const MOBILE_LIBRARY_KEY = "autogt.mobile.library";
const MOBILE_QUEUE_KEY = "autogt.mobile.queue";
const MOBILE_SHOPEE_QUEUE_KEY = "autogt.mobile.shopee.queue";
const mobilePostPanel = document.getElementById("mobilePostPanel");
const mobileAdbStatus = document.getElementById("mobileAdbStatus");
const mobileChannelMetric = document.getElementById("mobileChannelMetric");
const mobileVideoMetric = document.getElementById("mobileVideoMetric");
const mobileQueueMetric = document.getElementById("mobileQueueMetric");
const mobileErrorMetric = document.getElementById("mobileErrorMetric");
const mobileQueueCount = document.getElementById("mobileQueueCount");
const mobileScanUploadsBtn = document.getElementById("mobileScanUploadsBtn");
const mobileRandomBtn = document.getElementById("mobileRandomBtn");
const mobileAutoRandomBtn = document.getElementById("mobileAutoRandomBtn");
const mobileQueueSelectedBtn = document.getElementById("mobileQueueSelectedBtn");
const mobileQueueAllBtn = document.getElementById("mobileQueueAllBtn");
const mobileStartAllBtn = document.getElementById("mobileStartAllBtn");
const mobileStopAllBtn = document.getElementById("mobileStopAllBtn");
const mobileClearQueueBtn = document.getElementById("mobileClearQueueBtn");
const mobileClearTimeSetBtn = document.getElementById("mobileClearTimeSetBtn");
const mobileClearHistoryBtn = document.getElementById("mobileClearHistoryBtn");
const mobileSelectAllQueueBtn = document.getElementById("mobileSelectAllQueueBtn");
const mobileScheduleClearQueueBtn = document.getElementById("mobileScheduleClearQueueBtn");
const mobileScheduleAt = document.getElementById("mobileScheduleAt");
const mobileIntervalMinutes = document.getElementById("mobileIntervalMinutes");
const mobileSetScheduleBtn = document.getElementById("mobileSetScheduleBtn");
const mobileLiveLogText = document.getElementById("mobileLiveLogText");
const mobileToggleFloatLogsBtn = document.getElementById("mobileToggleFloatLogsBtn");
const mobileQueueList = document.getElementById("mobileQueueList");
const mobileSelectedChannelCount = document.getElementById("mobileSelectedChannelCount");
const mobileSelectedVideoCount = document.getElementById("mobileSelectedVideoCount");
const mobileScanAdbBtn = document.getElementById("mobileScanAdbBtn");
const mobileHideOffline = document.getElementById("mobileHideOffline");
const mobileChannelForm = document.getElementById("mobileChannelForm");
const mobileChannelName = document.getElementById("mobileChannelName");
const mobileChannelUdid = document.getElementById("mobileChannelUdid");
const mobileDeviceList = document.getElementById("mobileDeviceList");
const mobileChannelList = document.getElementById("mobileChannelList");
const mobileScanLibraryBtn = document.getElementById("mobileScanLibraryBtn");
const mobileClearSelectionBtn = document.getElementById("mobileClearSelectionBtn");
const mobileLibrarySearch = document.getElementById("mobileLibrarySearch");
const mobileLibraryList = document.getElementById("mobileLibraryList");
const mobileHeroTitle = document.getElementById("mobileHeroTitle");
const mobileHeroDescription = document.getElementById("mobileHeroDescription");
const mobileQueueTitle = document.getElementById("mobileQueueTitle");
const mobileQueueDescription = document.getElementById("mobileQueueDescription");
let mobileChannels = readMobileList(MOBILE_CHANNELS_KEY);
let mobileLibrary = readMobileList(MOBILE_LIBRARY_KEY);
let activeMobilePlatform = "tiktok";
let mobileQueue = readMobileList(MOBILE_QUEUE_KEY);
let mobileSelectedChannels = new Set(mobileChannels.filter((item) => item.selected).map((item) => item.id));
let mobileSelectedVideos = new Set();
let mobileSelectedJobs = new Set();
let mobileAutoRandomEnabled = localStorage.getItem("autogt.mobile.autoRandom") === "1";
let mobileRunning = false;

let activeFlowPlatform = "tiktok";
const POST_ACCOUNT_CACHE_KEY = "autogt.tiktok.post.accounts";
const SHOWCASE_ACCOUNT_KEY = "autogt.tiktok.showcase.account";
let showcaseSelectedAccount = readShowcaseAccount();
let tiktokAccountModalMode = "showcase";

function setShowcaseStatus(message, isError = false) {
  if (!showcaseStatus) return;
  showcaseStatus.textContent = message || "";
  showcaseStatus.classList.toggle("is-error", !!isError);
}

function productUrl(product) {
  return `https://www.tiktok.com/view/product/${product.id || product.productid || ""}`;
}

function normalizeShowcaseProduct(product) {
  return {
    id: String(product.id || product.productid || product.product_id || ""),
    title: product.title || "-",
    image: product.image || product.cover?.url_list?.[0] || "",
    price: product.price || product.format_available_price || "-",
    commission: product.commission || product.affiliate_info?.commission_with_currency || "-",
    commissionRate: product.commissionRate ?? product.commissionPercent ?? (
      product.affiliate_info?.commission_rate ? Number(product.affiliate_info.commission_rate || 0) / 100 : "-"
    ),
    stock: product.stock ?? product.stock_num ?? "-",
    shop: product.shop || product.seller_info?.shop_name || "-",
    canAdd: product.canAdd !== false,
  };
}

function normalizeCheckedLinkProducts(payload) {
  const rows = payload?.data?.results || [];
  return rows.map((row) => {
    const product = row?.product_info?.closed_loop_product;
    if (!product) return null;
    const affiliate = product.affiliate_info || {};
    const commissionRate = Number(affiliate.commission_rate || 0) / 100;
    const shopName = product.store_name ||
      product.shop_name ||
      product.seller_info?.shop_name ||
      row.store_name ||
      row.shop_name ||
      row.shop_id ||
      "-";
    return {
      id: String(product.product_id || ""),
      title: product.title || "-",
      image: product.cover?.url_list?.[0] || "",
      price: product.format_price || product.format_available_price || "-",
      stock: product.stock_num ?? "-",
      shop: shopName,
      canAdd: true,
      commission: affiliate.commission_with_currency || "-",
      commissionRate: Number.isFinite(commissionRate) ? commissionRate : "-",
      sourceUrl: row.original_url || "",
    };
  }).filter(Boolean);
}

function parseTikTokProductUrls(text) {
  const parts = String(text || "")
    .split(/[\n,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const urls = [];
  const seen = new Set();

  for (const part of parts) {
    const idMatch = part.match(/\d{16,}/);
    const url = idMatch
      ? `https://www.tiktok.com/view/product/${idMatch[0]}`
      : /^https?:\/\//i.test(part)
        ? part
        : `https://${part}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

function selectedProductIds() {
  if (!showcaseResults) return [];
  return [...showcaseResults.querySelectorAll(".showcase-checkbox:checked")]
    .map((box) => box.value)
    .filter(Boolean);
}

function updateShowcaseControls() {
  const total = showcaseState.products.length;
  const selected = selectedProductIds().length;
  const hasProducts = total > 0;

  if (showcaseTotal) showcaseTotal.textContent = String(total);
  if (showcaseVisibleCount) showcaseVisibleCount.textContent = `${showcaseState.filtered.length} items`;
  if (selectedCount) selectedCount.textContent = `${selected} selected`;
  if (productSearch) productSearch.disabled = !hasProducts;

  [toggleSelectBtn, copySelectedBtn, addShowcaseSelectedBtn, queueSelectedBtn, deleteSelectedBtn].forEach((button) => {
    if (button) button.disabled = !hasProducts;
  });

  if (toggleSelectBtn) {
    const visibleBoxes = showcaseResults ? [...showcaseResults.querySelectorAll(".showcase-checkbox")] : [];
    const allVisibleSelected = visibleBoxes.length > 0 && visibleBoxes.every((box) => box.checked);
    toggleSelectBtn.lastChild.textContent = allVisibleSelected ? " ยกเลิกเลือกทั้งหมด" : " เลือกทั้งหมด";
  }
}

function renderShowcaseProducts(items) {
  if (!showcaseResults || !showcaseResultsSection) return;
  showcaseResults.innerHTML = "";
  showcaseResultsSection.hidden = false;

  if (!items.length) {
    if (showcaseState.products.length) {
      showcaseResults.innerHTML = `<div class="showcase-status is-error">ไม่พบสินค้าที่ตรงกับคำค้นหา</div>`;
    } else {
      showcaseResults.innerHTML = `<div class="flow-empty-card">ยังไม่มีผลลัพธ์ กดดึงสินค้าจากลิงก์หรือดึงข้อมูล Showcase เพื่อเริ่ม</div>`;
    }
    updateShowcaseControls();
    return;
  }

  for (const product of items) {
    const url = productUrl(product);
    const commissionRate = product.commissionRate && product.commissionRate !== "-" ? `${escapeHtml(String(product.commissionRate))}%` : "-";
    const card = document.createElement("div");
    card.className = "showcase-card";
    card.innerHTML = `
      <input type="checkbox" class="showcase-checkbox" value="${escapeHtml(product.id)}" aria-label="Select product" />
      <img class="showcase-row-thumb" src="${escapeHtml(product.image)}" alt="" loading="lazy" />
      <div>
        <a class="showcase-title" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(product.title)}">${escapeHtml(product.title)}</a>
        <div class="showcase-row-meta">
          <span class="showcase-price">${escapeHtml(product.price)}</span>
          <span class="showcase-comm-badge" title="${escapeHtml(product.commission || "-")}">${commissionRate}</span>
          <span class="showcase-stock-cell">คงเหลือ ${escapeHtml(String(product.stock))}</span>
          <span class="showcase-usable ${product.canAdd ? "is-usable" : "is-unusable"}">${product.canAdd ? "พร้อมใช้" : "ใช้ไม่ได้"}</span>
        </div>
        <span class="showcase-shop" title="${escapeHtml(product.shop)}">${escapeHtml(product.shop)}</span>
      </div>
    `;
    showcaseResults.appendChild(card);
  }

  showcaseResults.querySelectorAll(".showcase-checkbox").forEach((box) => {
    box.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    box.addEventListener("change", () => {
      box.closest(".showcase-card")?.classList.toggle("selected", box.checked);
      updateShowcaseControls();
    });
  });
  showcaseResults.querySelectorAll(".showcase-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      toggleCardSelectionFromClick(card, event);
    });
  });
  updateShowcaseControls();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}













function setActiveFlowPlatform(platform) {
  if (platform !== "tiktok" && platform !== "shopee") return;
  const platformChanged = activeFlowPlatform !== platform;
  activeFlowPlatform = platform;

  // flow-suite: jobs/history are filtered client-side by platform (one
  // shared server-side list, see the port plan's decision #4) — re-render
  // for the new platform and re-sample the preview box from its Showcase.
  if (platformChanged) { flowSuiteSamplePicks = []; flowSuiteQueuePage = 1; }
  renderFlowSuiteQueue();
  renderFlowSuiteHistory();
  refreshFlowSuiteSampleBox();
}












function looksLikeThaiMojibake(text) {
  return /\u0e40\u0e18|\u0e40\u0e19|\u0e22\u0e17|\u0e22\s|\u0e23\u2014|\uFFFD|(?:\u00e0[\u00b8\u00b9])|\u00c3|\u00c2|\u00e2|[\u0100-\u024F\u0370-\u052F\u0590-\u06FF\u2930-\u2BFF]/.test(String(text || ""));
}

function thaiCharCount(text) {
  return (String(text || "").match(/[\u0e00-\u0e7f]/g) || []).length;
}

function mojibakeCharCount(text) {
  return (String(text || "").match(/[\uFFFD\u0100-\u024F\u0370-\u052F\u0590-\u06FF\u2930-\u2BFF]/g) || []).length;
}

function looksUnreadableMojibakeText(text) {
  const value = String(text || "");
  if (!value) return false;
  if (/\uFFFD|(?:\u00e0[\u00b8\u00b9])|\u00c3|\u00c2|\u00e2/.test(value)) return true;
  return mojibakeCharCount(value) >= 2 && thaiCharCount(value) < 2;
}

function repairThaiMojibakeText(value) {
  const text = String(value ?? "");
  if (!looksLikeThaiMojibake(text)) return text;
  try {
    const bytes = [];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (code >= 0x0e01 && code <= 0x0e5b) {
        bytes.push(code - 0x0e01 + 0xa1);
      } else if (code === 0x201c || code === 0x201d) {
        bytes.push(0x93);
      } else if (code === 0x2018 || code === 0x2019) {
        bytes.push(0x92);
      } else if (code === 0x2013 || code === 0x2014) {
        bytes.push(0x96);
      } else {
        bytes.push(...new TextEncoder().encode(ch));
      }
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    return decoded && decoded !== text ? decoded : text;
  } catch {
    return text;
  }
}




function cleanDisplayText(value, fallback = "") {
  const cleaned = repairThaiMojibakeText(value)
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || looksUnreadableMojibakeText(cleaned)) return String(fallback || "").trim();
  return cleaned;
}

function productFallbackTitle(productId = "", platform = "TikTok") {
  const id = String(productId || "").trim();
  return id ? `สินค้า ${platform} ${id}` : `สินค้า ${platform}`;
}

















const FLOW_MEDIA_TEXT = {
  resultTitle: "\u0e1c\u0e25\u0e25\u0e31\u0e1e\u0e18\u0e4c\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d",
  openVideo: "\u0e40\u0e1b\u0e34\u0e14\u0e44\u0e1f\u0e25\u0e4c\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d",
  viewVideo: "\u0e14\u0e39\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d",
  waitResult: "\u0e23\u0e2d\u0e1c\u0e25\u0e25\u0e31\u0e1e\u0e18\u0e4c",
  emptyQueue: "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35 Queue Process \u0e01\u0e14\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e04\u0e25\u0e34\u0e1b\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e07\u0e32\u0e19\u0e08\u0e32\u0e01 Queue Items",
  productImage: "\u0e23\u0e39\u0e1b\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  productName: "\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  status: "\u0e2a\u0e16\u0e32\u0e19\u0e30",
  result: "\u0e1c\u0e25\u0e25\u0e31\u0e1e\u0e18\u0e4c",
  processing: "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e1b\u0e23\u0e30\u0e21\u0e27\u0e25\u0e1c\u0e25",
};

function ensureFlowMediaLightbox() {
  let lightbox = document.getElementById("flowMediaLightbox");
  if (lightbox) return lightbox;
  lightbox = document.createElement("div");
  lightbox.id = "flowMediaLightbox";
  lightbox.className = "flow-media-lightbox";
  lightbox.hidden = true;
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Media viewer");
  lightbox.innerHTML = [
    '<button class="flow-media-close" type="button" data-flow-media-close aria-label="Close">',
    '<span class="material-symbols-outlined">close</span>',
    '</button>',
    '<section class="flow-media-inner">',
    '<div class="flow-media-head"><span class="flow-prompt-kicker">video result</span><h2 data-flow-media-title>' + FLOW_MEDIA_TEXT.resultTitle + '</h2></div>',
    '<div class="flow-media-body" data-flow-media-body></div>',
    '<div class="flow-media-actions"><a data-flow-media-open target="_blank" rel="noreferrer">' + FLOW_MEDIA_TEXT.openVideo + '</a></div>',
    '</section>'
  ].join("");
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target.closest("[data-flow-media-close]")) closeFlowMediaLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) closeFlowMediaLightbox();
  });
  document.body.appendChild(lightbox);
  return lightbox;
}

function openFlowMediaLightbox(url, type = "video", titleText = FLOW_MEDIA_TEXT.resultTitle) {
  if (!url) return;
  const lightbox = ensureFlowMediaLightbox();
  const body = lightbox.querySelector("[data-flow-media-body]");
  const title = lightbox.querySelector("[data-flow-media-title]");
  const openLink = lightbox.querySelector("[data-flow-media-open]");
  if (title) title.textContent = titleText || FLOW_MEDIA_TEXT.resultTitle;
  if (openLink) openLink.href = url;
  const safeUrl = escapeHtml(url);
  if (body) {
    body.innerHTML = type === "image"
      ? '<img src="' + safeUrl + '" alt="" />'
      : '<video src="' + safeUrl + '" controls autoplay playsinline preload="metadata"></video>';
  }
  lightbox.hidden = false;
  document.body.classList.add("flow-media-open");
  body?.querySelector("video")?.play?.().catch(() => {});
}

function closeFlowMediaLightbox() {
  const lightbox = document.getElementById("flowMediaLightbox");
  if (!lightbox) return;
  const body = lightbox.querySelector("[data-flow-media-body]");
  const video = body?.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  if (body) body.innerHTML = "";
  lightbox.hidden = true;
  document.body.classList.remove("flow-media-open");
}

document.addEventListener("click", (event) => {
  const media = event.target.closest("[data-media]");
  if (!media) return;
  event.preventDefault();
  openFlowMediaLightbox(
    media.dataset.media || media.getAttribute("href") || "",
    media.dataset.mediaType || "video",
    media.dataset.mediaTitle || media.getAttribute("title") || FLOW_MEDIA_TEXT.resultTitle
  );
});
function flowStatusClass(status) {
  const key = String(status || "").toLowerCase();
  if (["done", "success"].includes(key)) return "is-done";
  if (["failed", "error", "stopped"].includes(key)) return "is-failed";
  if (["preparing", "image", "video", "paused"].includes(key)) return "is-running";
  return "is-queued";
}


let backendLogRows = [];
let logsModalTimer = null;
let liveLogTimer = null;
let logDockOpen = localStorage.getItem("autogt.logDock.open") === "1";
let logDockRows = [];

async function fetchBackendLogs() {
  try {
    const response = await fetch("/api/logs?limit=300", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Cannot read backend logs");
    backendLogRows = Array.isArray(payload.logs) ? payload.logs : [];
  } catch (error) {
    backendLogRows = [{
      time: new Date().toISOString(),
      level: "error",
      source: "ui",
      message: `อ่าน backend logs ไม่สำเร็จ: ${error.message || error}`,
      detail: null,
    }];
  }
  return backendLogRows;
}

function formatLogRow(row) {
  if (!row) return "ยังไม่มี log ล่าสุด";
  const time = row.time ? new Date(row.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
  const message = String(row.message || "").replace(/\s+/g, " ").trim();
  return `${time} [${row.level || "info"}] [${row.source || "server"}] ${message}`;
}

async function refreshLiveLog() {
  const rows = await fetchBackendLogs();
  const latest = formatLogRow(rows[0]);
  if (mobileLiveLogText) mobileLiveLogText.textContent = latest;
  refreshLogDock();
  const modal = document.getElementById("logsModal");
  if (modal?.classList.contains("is-open")) renderLogsModalRows(rows);
}

function startLiveLogPolling() {
  if (liveLogTimer) return;
  refreshLiveLog();
  liveLogTimer = window.setInterval(refreshLiveLog, 1500);
}

function logLevelClass(level) {
  const key = String(level || "info").toLowerCase();
  if (key === "error") return "is-failed";
  if (key === "warn" || key === "warning") return "is-running";
  return "is-done";
}

function logDetailText(detail) {
  if (detail == null || detail === "") return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function shortLogText(value, max = 700) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sendUiLog(level, source, message, detail = null) {
  fetch("/api/ui-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level, source, message, detail }),
    cache: "no-store",
  }).catch(() => {
    /* log transport is best-effort */
  });
}

function readMobileList(key) {
  try {
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function mobilePlatformKey(platform = activeMobilePlatform) {
  return String(platform || "tiktok").toLowerCase() === "shopee" ? "shopee" : "tiktok";
}

function mobileQueueStorageKey(platform = activeMobilePlatform) {
  return mobilePlatformKey(platform) === "shopee" ? MOBILE_SHOPEE_QUEUE_KEY : MOBILE_QUEUE_KEY;
}

function mobilePlatformLabel(platform = activeMobilePlatform) {
  return mobilePlatformKey(platform) === "shopee" ? "Shopee" : "TikTok";
}

function setActiveMobilePlatform(platform) {
  const next = mobilePlatformKey(platform);
  if (activeMobilePlatform === next) return;
  activeMobilePlatform = next;
  mobileQueue = readMobileList(mobileQueueStorageKey(next));
  mobileSelectedVideos.clear();
  mobileSelectedJobs.clear();
}

function saveMobileState() {
  mobileChannels = mobileChannels.map((channel) => ({
    ...channel,
    selected: mobileSelectedChannels.has(channel.id),
  }));
  localStorage.setItem(MOBILE_CHANNELS_KEY, JSON.stringify(mobileChannels));
  localStorage.setItem(MOBILE_LIBRARY_KEY, JSON.stringify(mobileLibrary));
  localStorage.setItem(mobileQueueStorageKey(), JSON.stringify(mobileQueue));
}

function mobileUid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mobileOnline(channel) {
  return ["device", "online"].includes(String(channel?.status || "").toLowerCase());
}

function setMobileStatus(message, isError = false) {
  if (mobileAdbStatus) {
    mobileAdbStatus.textContent = message || "ADB idle";
    mobileAdbStatus.classList.toggle("is-failed", !!isError);
  }
  if (message) sendUiLog(isError ? "error" : "info", "mobile:ui", message);
}

function normalizeMobileChannel(input = {}) {
  const udid = String(input.udid || input.id || input.serial || "").trim();
  return {
    id: input.channelId || input.id || mobileUid("channel"),
    name: String(input.name || input.model || input.device || udid || "Android Channel").trim(),
    udid,
    status: String(input.status || input.connection || "offline").toLowerCase(),
    model: input.model || input.product || input.device || "",
    selected: !!input.selected,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMobileVideo(input = {}) {
  const url = input.url || input.localUrl || input.path || "";
  return {
    id: input.id || input.videoId || url || mobileUid("video"),
    title: String(input.title || input.name || input.fileName || "Untitled video"),
    url,
    localUrl: input.localUrl || input.url || "",
    path: input.path || "",
    source: input.source || "library",
    platform: input.platform || "",
    productName: input.productName || input.title || "",
    productId: input.productId || input.productID || "",
    sourceUrl: input.sourceUrl || "",
    caption: input.caption || input.productName || input.title || "",
    size: input.size || 0,
    mtime: input.mtime || input.updatedAt || "",
  };
}

function renderMobilePostWorkspace() {
  if (!mobilePostPanel) return;
  const platformLabel = mobilePlatformLabel();
  if (mobileHeroTitle) mobileHeroTitle.innerHTML = `<span class="material-symbols-outlined">phonelink_setup</span> Connect ADB`;
  if (mobileHeroDescription) {
    mobileHeroDescription.textContent = `Scan Android devices, prepare ${platformLabel} mobile channels, and queue videos from the local library.`;
  }
  if (mobileQueueTitle) mobileQueueTitle.innerHTML = `<span class="material-symbols-outlined">playlist_play</span> ${platformLabel} Mobile Queue`;
  if (mobileQueueDescription) {
    mobileQueueDescription.textContent = `Choose videos from Library, choose one or more Channels, then queue them for ${platformLabel} mobile posting.`;
  }
  renderMobileMetrics();
  renderMobileChannels();
  renderMobileLibrary();
  renderMobileQueue();
}

function renderMobileMetrics() {
  const issues = mobileQueue.filter((job) => ["failed", "stopped"].includes(String(job.status || "").toLowerCase())).length;
  if (mobileChannelMetric) mobileChannelMetric.textContent = String(mobileChannels.length);
  if (mobileVideoMetric) mobileVideoMetric.textContent = String(mobileLibrary.length);
  if (mobileQueueMetric) mobileQueueMetric.textContent = String(mobileQueue.length);
  if (mobileErrorMetric) mobileErrorMetric.textContent = String(issues);
  if (mobileQueueCount) mobileQueueCount.textContent = `${mobileQueue.length} jobs`;
  if (mobileSelectedChannelCount) mobileSelectedChannelCount.textContent = `${mobileSelectedChannels.size} selected`;
  if (mobileSelectedVideoCount) mobileSelectedVideoCount.textContent = `${mobileSelectedVideos.size} selected`;
  if (mobileSelectAllQueueBtn) {
    mobileSelectAllQueueBtn.textContent = mobileQueue.length && mobileQueue.every((job) => mobileSelectedJobs.has(job.id))
      ? "Deselect All"
      : "Select All";
  }
  if (mobileSetScheduleBtn) {
    mobileSetScheduleBtn.textContent = mobileSelectedJobs.size ? `Set (${mobileSelectedJobs.size})` : "Set";
  }
  if (mobileAutoRandomBtn) {
    mobileAutoRandomBtn.textContent = mobileAutoRandomEnabled ? "Auto random : ON" : "Auto random : OFF";
    mobileAutoRandomBtn.classList.toggle("is-on", mobileAutoRandomEnabled);
  }
}

function renderMobileChannels() {
  if (!mobileChannelList) return;
  const hideOffline = !!mobileHideOffline?.checked;
  const channels = hideOffline ? mobileChannels.filter(mobileOnline) : mobileChannels;
  mobileChannelList.innerHTML = channels.length ? channels.map((channel) => {
    const selected = mobileSelectedChannels.has(channel.id);
    const online = mobileOnline(channel);
    return `
      <article class="mobile-card ${selected ? "is-selected" : ""}" data-mobile-channel="${escapeHtml(channel.id)}">
        <div class="mobile-card-head">
          <span class="mobile-status-dot ${online ? "is-online" : ""}" title="${online ? "online" : "offline"}"></span>
          <strong class="mobile-card-title">${escapeHtml(channel.name)}</strong>
          <button class="icon-btn compact" type="button" data-delete-mobile-channel="${escapeHtml(channel.id)}" aria-label="Delete channel">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="mobile-card-meta">${escapeHtml(channel.udid || "No UDID")}</div>
        <div class="mobile-card-meta">${escapeHtml(channel.model || channel.status || "offline")}</div>
      </article>`;
  }).join("") : '<div class="mobile-empty">No channel yet. Scan ADB or add UDID manually.</div>';

  mobileChannelList.querySelectorAll("[data-mobile-channel]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-delete-mobile-channel]")) return;
      const id = card.dataset.mobileChannel;
      if (mobileSelectedChannels.has(id)) mobileSelectedChannels.delete(id);
      else mobileSelectedChannels.add(id);
      saveMobileState();
      renderMobilePostWorkspace();
    });
  });

  mobileChannelList.querySelectorAll("[data-delete-mobile-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.deleteMobileChannel;
      mobileSelectedChannels.delete(id);
      mobileChannels = mobileChannels.filter((channel) => channel.id !== id);
      saveMobileState();
      renderMobilePostWorkspace();
    });
  });
}

function renderMobileDevices(devices = []) {
  if (!mobileDeviceList) return;
  if (!devices.length) {
    mobileDeviceList.innerHTML = "";
    return;
  }
  mobileDeviceList.innerHTML = devices.map((device) => {
    const online = mobileOnline(device);
    return `
      <article class="mobile-card" data-use-mobile-device="${escapeHtml(device.udid || "")}">
        <div class="mobile-card-head">
          <span class="mobile-status-dot ${online ? "is-online" : ""}"></span>
          <strong class="mobile-card-title">${escapeHtml(device.model || device.udid || "Android device")}</strong>
        </div>
        <div class="mobile-card-meta">${escapeHtml(device.udid || "")}</div>
      </article>`;
  }).join("");
  mobileDeviceList.querySelectorAll("[data-use-mobile-device]").forEach((card) => {
    card.addEventListener("click", () => {
      const udid = card.dataset.useMobileDevice || "";
      const device = devices.find((item) => item.udid === udid);
      if (!device) return;
      if (mobileChannelName) mobileChannelName.value = device.model || device.udid || "";
      if (mobileChannelUdid) mobileChannelUdid.value = device.udid || "";
    });
  });
}

function renderMobileLibrary() {
  if (!mobileLibraryList) return;
  const query = String(mobileLibrarySearch?.value || "").trim().toLowerCase();
  const activeLabel = mobilePlatformLabel().toLowerCase();
  const platformVideos = mobileLibrary.filter((video) => {
    const label = String(video.platform || "").toLowerCase();
    return !label || label === activeLabel;
  });
  const videos = query
    ? platformVideos.filter((video) => `${video.title} ${video.path} ${video.source} ${video.productId || ""}`.toLowerCase().includes(query))
    : platformVideos;
  mobileLibraryList.innerHTML = videos.length ? videos.map((video) => {
    const selected = mobileSelectedVideos.has(video.id);
    const mediaUrl = video.url || video.localUrl || "";
    const metaLine = [video.platform || "", video.productId ? `ID: ${video.productId}` : ""].filter(Boolean).join(" / ");
    return `
      <article class="mobile-card mobile-video-card ${selected ? "is-selected" : ""}" data-mobile-video="${escapeHtml(video.id)}">
        <div class="mobile-video-thumb">
          ${mediaUrl ? `<video src="${escapeHtml(mediaUrl)}" muted preload="metadata"></video>` : '<span class="material-symbols-outlined">movie</span>'}
        </div>
        <div>
          <strong class="mobile-card-title">${escapeHtml(video.title)}</strong>
          ${metaLine ? `<div class="mobile-card-meta">${escapeHtml(metaLine)}</div>` : ""}
          <div class="mobile-card-meta">${escapeHtml(video.source || "library")}</div>
          <div class="mobile-card-meta">${escapeHtml(video.path || mediaUrl || "")}</div>
        </div>
        <span class="queue-pill">${selected ? "selected" : "pick"}</span>
      </article>`;
  }).join("") : '<div class="mobile-empty">No video in Library. Scan Library first.</div>';

  mobileLibraryList.querySelectorAll("[data-mobile-video]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.mobileVideo;
      if (mobileSelectedVideos.has(id)) mobileSelectedVideos.delete(id);
      else mobileSelectedVideos.add(id);
      renderMobilePostWorkspace();
    });
  });
}

function mobileJobStatusText(status) {
  const key = String(status || "").toLowerCase();
  if (key === "running") return "Running";
  if (key === "done") return "Done";
  if (key === "failed") return "Failed";
  if (key === "stopped") return "Stopped";
  return "Queued";
}

function renderMobileQueue() {
  if (!mobileQueueList) return;
  const head = `
    <div class="mobile-job-row is-head">
      <span></span>
      <span>Job-ID</span>
      <span>Channel</span>
      <span>Video</span>
      <span>Schedule</span>
      <span>Status</span>
      <span></span>
    </div>`;
  const rows = mobileQueue.map((job) => `
    <article class="mobile-job-row ${mobileSelectedJobs.has(job.id) ? "is-selected" : ""}" data-mobile-job="${escapeHtml(job.id)}">
      <button class="mobile-queue-check ${mobileSelectedJobs.has(job.id) ? "is-checked" : ""}" type="button" data-toggle-mobile-job="${escapeHtml(job.id)}" aria-label="Select queue job">
        <span class="material-symbols-outlined">check</span>
      </button>
      <strong>${escapeHtml(job.id.slice(0, 10))}</strong>
      <span class="mobile-card-meta">${escapeHtml(job.channelName || job.udid || "-")}</span>
      <span class="mobile-card-meta">${escapeHtml(`${mobilePlatformLabel(job.platform)} • ${job.videoTitle || "-"}`)}</span>
      <span class="mobile-card-meta">${escapeHtml(mobileScheduleText(job))}</span>
      <span class="flow-status ${flowStatusClass(job.status)}">${mobileJobStatusText(job.status)}</span>
      <button class="icon-btn compact" type="button" data-delete-mobile-job="${escapeHtml(job.id)}" aria-label="Delete job">
        <span class="material-symbols-outlined">close</span>
      </button>
    </article>`).join("");
  mobileQueueList.innerHTML = mobileQueue.length ? head + rows : '<div class="mobile-empty">No mobile queue yet. Select Channel and Library video first.</div>';
  mobileQueueList.querySelectorAll("[data-delete-mobile-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mobileQueue = mobileQueue.filter((job) => job.id !== btn.dataset.deleteMobileJob);
      mobileSelectedJobs.delete(btn.dataset.deleteMobileJob);
      saveMobileState();
      renderMobilePostWorkspace();
    });
  });
  mobileQueueList.querySelectorAll("[data-toggle-mobile-job]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMobileJobSelection(btn.dataset.toggleMobileJob);
    });
  });
  mobileQueueList.querySelectorAll("[data-mobile-job]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      toggleMobileJobSelection(row.dataset.mobileJob);
    });
  });
  renderMobileMetrics();
}

function mobileScheduleText(job) {
  if (!job?.scheduledAt) return "-";
  const time = String(job.scheduledAt).replace("T", " ");
  const gap = Number(job.intervalMinutes || 0);
  return gap > 0 ? `${time} / +${gap}m` : time;
}

function toggleMobileJobSelection(id) {
  if (!id) return;
  if (mobileSelectedJobs.has(id)) mobileSelectedJobs.delete(id);
  else mobileSelectedJobs.add(id);
  renderMobilePostWorkspace();
}

async function scanMobileAdb() {
  if (!mobileScanAdbBtn) return;
  const old = mobileScanAdbBtn.disabled;
  mobileScanAdbBtn.disabled = true;
  setMobileStatus("Scanning ADB devices...");
  try {
    const response = await fetch("/api/adb/devices", { method: "POST", cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "ADB scan failed");
    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    renderMobileDevices(devices);
    devices.forEach((device) => {
      const normalized = normalizeMobileChannel(device);
      const index = mobileChannels.findIndex((channel) => channel.udid && channel.udid === normalized.udid);
      if (index >= 0) mobileChannels[index] = { ...mobileChannels[index], ...normalized, id: mobileChannels[index].id };
      else mobileChannels.push(normalized);
    });
    saveMobileState();
    setMobileStatus(`ADB scan complete: ${devices.length} device(s)`);
    renderMobilePostWorkspace();
  } catch (error) {
    setMobileStatus(error.message || "ADB scan failed", true);
  } finally {
    mobileScanAdbBtn.disabled = old;
  }
}

async function scanMobileLibrary() {
  if (!mobileScanLibraryBtn) return;
  const old = mobileScanLibraryBtn.disabled;
  mobileScanLibraryBtn.disabled = true;
  setMobileStatus("Scanning video library...");
  try {
    const response = await fetch("/api/mobile/library/scan", { method: "POST", cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Library scan failed");
    mobileLibrary = (Array.isArray(payload.videos) ? payload.videos : []).map(normalizeMobileVideo);
    mobileSelectedVideos.clear();
    saveMobileState();
    setMobileStatus(`Library scan complete: ${mobileLibrary.length} video(s)`);
    renderMobilePostWorkspace();
  } catch (error) {
    setMobileStatus(error.message || "Library scan failed", true);
  } finally {
    mobileScanLibraryBtn.disabled = old;
  }
}

function addMobileChannelFromForm(event) {
  event?.preventDefault();
  const name = String(mobileChannelName?.value || "").trim();
  const udid = String(mobileChannelUdid?.value || "").trim();
  if (!name || !udid) return;
  const existing = mobileChannels.findIndex((channel) => channel.udid === udid);
  const channel = normalizeMobileChannel({ name, udid, status: "offline", selected: true });
  if (existing >= 0) {
    channel.id = mobileChannels[existing].id;
    mobileChannels[existing] = { ...mobileChannels[existing], ...channel };
  } else {
    mobileChannels.push(channel);
  }
  mobileSelectedChannels.add(channel.id);
  if (mobileChannelName) mobileChannelName.value = "";
  if (mobileChannelUdid) mobileChannelUdid.value = "";
  saveMobileState();
  setMobileStatus(`Channel added: ${name}`);
  renderMobilePostWorkspace();
}

function queueMobileVideos(allOnline = false) {
  const channels = mobileChannels.filter((channel) => allOnline ? mobileOnline(channel) : mobileSelectedChannels.has(channel.id));
  const videos = mobileLibrary.filter((video) => mobileSelectedVideos.has(video.id));
  if (!channels.length || !videos.length) {
    setMobileStatus("Select at least 1 channel and 1 library video first", true);
    return;
  }
  channels.forEach((channel) => {
    videos.forEach((video) => {
      mobileQueue.push({
        id: mobileUid("mp"),
        platform: activeMobilePlatform,
        channelId: channel.id,
        channelName: channel.name,
        udid: channel.udid,
        videoId: video.id,
        videoTitle: video.title,
        videoUrl: video.url || video.localUrl,
        videoPath: video.path || "",
        caption: video.caption || video.productName || video.title || "",
        productName: video.productName || video.title || "",
        productId: video.productId || "",
        sourceUrl: video.sourceUrl || "",
        status: "queued",
        createdAt: new Date().toISOString(),
      });
    });
  });
  saveMobileState();
  setMobileStatus(`Queued ${channels.length * videos.length} mobile job(s)`);
  renderMobilePostWorkspace();
}

function randomDistributeMobileVideos() {
  const channels = mobileChannels.filter(mobileOnline);
  const videos = mobileLibrary.length ? mobileLibrary : [];
  if (!channels.length || !videos.length) {
    setMobileStatus("Need online channel and library video before random distribute", true);
    return;
  }
  channels.forEach((channel, index) => {
    const video = videos[index % videos.length];
    mobileQueue.push({
      id: mobileUid("mp"),
      platform: activeMobilePlatform,
      channelId: channel.id,
      channelName: channel.name,
      udid: channel.udid,
      videoId: video.id,
      videoTitle: video.title,
      videoUrl: video.url || video.localUrl,
      videoPath: video.path || "",
      caption: video.caption || video.productName || video.title || "",
      productName: video.productName || video.title || "",
      productId: video.productId || "",
      sourceUrl: video.sourceUrl || "",
      status: "queued",
      scheduledAt: mobileScheduleAt?.value || null,
      intervalMinutes: Number(mobileIntervalMinutes?.value || 0),
      createdAt: new Date().toISOString(),
    });
  });
  saveMobileState();
  setMobileStatus(`Random distributed ${channels.length} mobile job(s)`);
  renderMobilePostWorkspace();
}

function setMobileSchedule() {
  const selectedIds = mobileSelectedJobs.size ? [...mobileSelectedJobs] : mobileQueue.map((job) => job.id);
  if (!selectedIds.length) {
    setMobileStatus("No queue job to schedule", true);
    return;
  }
  const scheduledAt = mobileScheduleAt?.value || null;
  const interval = Number(mobileIntervalMinutes?.value || 0);
  mobileQueue = mobileQueue.map((job) => selectedIds.includes(job.id)
    ? { ...job, scheduledAt, intervalMinutes: interval, updatedAt: new Date().toISOString() }
    : job);
  mobileSelectedJobs.clear();
  saveMobileState();
  setMobileStatus(`Schedule set for ${selectedIds.length} job(s)`);
  renderMobilePostWorkspace();
}

function clearMobileTimeSet() {
  const selectedIds = mobileSelectedJobs.size ? [...mobileSelectedJobs] : mobileQueue.map((job) => job.id);
  mobileQueue = mobileQueue.map((job) => selectedIds.includes(job.id)
    ? { ...job, scheduledAt: null, intervalMinutes: 0, updatedAt: new Date().toISOString() }
    : job);
  if (mobileScheduleAt) mobileScheduleAt.value = "";
  if (mobileIntervalMinutes) mobileIntervalMinutes.value = "";
  mobileSelectedJobs.clear();
  saveMobileState();
  setMobileStatus(`Time set cleared for ${selectedIds.length} job(s)`);
  renderMobilePostWorkspace();
}

function clearMobileHistory() {
  mobileQueue = mobileQueue.filter((job) => !["done", "failed", "stopped"].includes(String(job.status || "").toLowerCase()));
  mobileSelectedJobs.clear();
  saveMobileState();
  setMobileStatus("Mobile queue history cleared");
  renderMobilePostWorkspace();
}

async function startMobileQueue() {
  if (mobileRunning) return;
  mobileRunning = true;
  const platformLabel = mobilePlatformLabel();
  setMobileStatus(`Starting ${platformLabel} mobile queue...`);
  try {
    for (const job of mobileQueue) {
      if (!mobileRunning) break;
      if (!["queued", "failed", "stopped"].includes(String(job.status || "").toLowerCase())) continue;
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      saveMobileState();
      renderMobilePostWorkspace();
      sendUiLog("info", "mobile:queue", `${platformLabel} mobile post job started`, {
        jobId: job.id,
        platform: job.platform || activeMobilePlatform,
        channel: job.channelName,
        udid: job.udid,
        video: job.videoPath || job.videoUrl,
        caption: job.caption || "",
      });
      try {
        const response = await fetch("/api/mobile/post/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...job,
            platform: job.platform || activeMobilePlatform,
          }),
          cache: "no-store",
        });
        const payload = await readJsonResponse(response);
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Mobile automation failed");
        job.status = "done";
        job.remotePath = payload.remotePath || job.remotePath || "";
        job.packageName = payload.packageName || job.packageName || "";
        job.automationMode = payload.mode || "adb-share-intent";
        job.updatedAt = new Date().toISOString();
        sendUiLog("info", "mobile:queue", `${platformLabel} mobile automation finished`, {
          jobId: job.id,
          platform: job.platform || activeMobilePlatform,
          remotePath: job.remotePath,
          packageName: job.packageName,
        });
      } catch (error) {
        job.status = "failed";
        job.error = error.message || String(error);
        job.updatedAt = new Date().toISOString();
        sendUiLog("error", "mobile:queue", `${platformLabel} mobile automation failed`, {
          jobId: job.id,
          error: job.error,
        });
      }
      saveMobileState();
      renderMobilePostWorkspace();
    }
    setMobileStatus(mobileRunning ? `${platformLabel} mobile queue complete` : `${platformLabel} mobile queue stopped`);
  } finally {
    mobileRunning = false;
    renderMobilePostWorkspace();
  }
}

function readShowcaseAccount() {
  try {
    return normalizePostAccount(JSON.parse(localStorage.getItem(SHOWCASE_ACCOUNT_KEY) || "null"));
  } catch {
    return null;
  }
}

function saveShowcaseAccount(account) {
  const normalized = normalizePostAccount(account);
  showcaseSelectedAccount = normalized;
  if (normalized) {
    localStorage.setItem(SHOWCASE_ACCOUNT_KEY, JSON.stringify(normalized));
    savePostAccountCache([normalized]);
  } else {
    localStorage.removeItem(SHOWCASE_ACCOUNT_KEY);
  }
  renderShowcaseSelectedAccount();
  return normalized;
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

function normalizePostAccountSession(session) {
  if (!session || typeof session !== "object") return null;
  const cookies = Array.isArray(session.cookies) ? session.cookies.map((cookie) => ({
    name: String(cookie?.name || ""),
    value: String(cookie?.value || ""),
    domain: String(cookie?.domain || ""),
    path: String(cookie?.path || "/"),
    expirationDate: cookie?.expirationDate || null,
    httpOnly: !!cookie?.httpOnly,
    secure: !!cookie?.secure,
    sameSite: String(cookie?.sameSite || ""),
  })).filter((cookie) => cookie.name && cookie.value) : [];
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
    capturedAt: session.capturedAt || "",
    cookieCount: Number(session.cookieCount || cookies.length || 0),
    cookieNames,
    hasAuthCookie: !!session.hasAuthCookie || cookies.some((cookie) => /^(sessionid|sessionid_ss|sid_tt)$/i.test(cookie.name)),
    cookies,
    tokens,
  };
}

function normalizePostAccountSessionSummary(summary, session) {
  const cleanSession = normalizePostAccountSession(session);
  const base = summary && typeof summary === "object" ? summary : {};
  return {
    provider: "tiktok",
    capturedAt: String(base.capturedAt || cleanSession?.capturedAt || ""),
    cookieCount: Number(base.cookieCount || cleanSession?.cookieCount || 0),
    cookieNames: Array.isArray(base.cookieNames) && base.cookieNames.length ? base.cookieNames.map(String) : (cleanSession?.cookieNames || []),
    hasAuthCookie: !!base.hasAuthCookie || !!cleanSession?.hasAuthCookie,
    tokenNames: Array.isArray(base.tokenNames) && base.tokenNames.length ? base.tokenNames.map(String) : Object.keys(cleanSession?.tokens || {}),
  };
}
function normalizePostAccount(account) {
  if (!account || typeof account !== "object") return null;
  const uniqueId = String(account.uniqueId || account.username || "").replace(/^@/, "").trim();
  if (!uniqueId) return null;
  const rawChromeProfileId = String(account.chromeProfileId || "");
  const rawInstallId = String(account.installId || "");
  const installId = rawInstallId || (/^\d+$/.test(rawChromeProfileId) ? "" : rawChromeProfileId);
  const chromeProfileStableId = String(account.chromeProfileStableId || account.profileStableId || (/^chrome-[a-f0-9]+$/i.test(rawChromeProfileId) ? rawChromeProfileId : ""));
  return {
    id: String(account.id || uniqueId),
    uniqueId,
    nickname: String(account.nickname || account.nickName || uniqueId),
    avatar: normalizeTikTokAvatarUrl(account.avatar || account.avatarMedium || account.avatarLarger || account.avatarThumb || ""),
    avatarThumb: normalizeTikTokAvatarUrl(account.avatarThumb || account.avatarMedium || account.avatar || ""),
    secUid: String(account.secUid || ""),
    followerCount: String(account.followerCount || ""),
    followingCount: String(account.followingCount || ""),
    heartCount: String(account.heartCount || ""),
    videoCount: String(account.videoCount || ""),
    socketId: String(account.socketId || account.profileSocketId || ""),
    profileSocketId: String(account.profileSocketId || account.socketId || ""),
    installId,
    chromeProfileId: String(rawChromeProfileId || installId || chromeProfileStableId || account.profileSocketId || account.socketId || ""),
    chromeProfileLabel: String(account.chromeProfileLabel || (account.socketId ? `Chrome #${account.socketId}` : "")),
    profileStableId: chromeProfileStableId,
    chromeProfileStableId,
    userDataDir: String(account.userDataDir || ""),
    profileDirectory: String(account.profileDirectory || account.chromeProfileDirectory || ""),
    profileDir: String(account.profileDir || ""),
    provider: "tiktok",
    session: normalizePostAccountSession(account.session),
    sessionSummary: normalizePostAccountSessionSummary(account.sessionSummary, account.session),
  };
}

function postAccountKey(account) {
  const normalized = normalizePostAccount(account);
  if (!normalized) return "";
  const profileKey = normalized.installId ||
    normalized.chromeProfileStableId ||
    normalized.profileStableId ||
    (normalized.userDataDir && normalized.profileDirectory ? `${normalized.userDataDir}\\${normalized.profileDirectory}` : "") ||
    normalized.chromeProfileId ||
    normalized.socketId ||
    normalized.profileSocketId ||
    "";
  if (profileKey) return `profile:${profileKey}`;
  const identity = normalized.secUid || normalized.uniqueId || normalized.id;
  if (identity) return `account:${identity}`;
  return "active";
}

function postAccountProfileKey(account) {
  const normalized = normalizePostAccount(account);
  if (!normalized) return "";
  const profileKey = normalized.installId ||
    normalized.chromeProfileStableId ||
    normalized.profileStableId ||
    (normalized.userDataDir && normalized.profileDirectory ? `${normalized.userDataDir}\\${normalized.profileDirectory}` : "") ||
    normalized.chromeProfileId ||
    normalized.socketId ||
    normalized.profileSocketId ||
    "";
  return profileKey ? `profile:${profileKey}` : "";
}

function postAccountScore(account) {
  const normalized = normalizePostAccount(account);
  if (!normalized) return 0;
  let score = 0;
  if (normalized.userDataDir && normalized.profileDirectory) score += 100;
  if (normalized.chromeProfileStableId || normalized.profileStableId) score += 90;
  if (normalized.profileDir) score += 20;
  if (normalized.installId && !/^\d+$/.test(normalized.installId)) score += 30;
  if (normalized.avatar || normalized.avatarThumb) score += 10;
  if (normalized.nickname && normalized.nickname !== normalized.uniqueId) score += 8;
  if (normalized.followerCount || normalized.videoCount) score += 4;
  if (normalized.socketId || normalized.profileSocketId) score += 2;
  return score;
}

function mergePostAccountRecord(current = {}, incoming = {}) {
  const currentNormalized = normalizePostAccount(current) || {};
  const incomingNormalized = normalizePostAccount(incoming) || {};
  const preferredFirst = postAccountScore(incomingNormalized) >= postAccountScore(currentNormalized);
  const primary = preferredFirst ? incomingNormalized : currentNormalized;
  const secondary = preferredFirst ? currentNormalized : incomingNormalized;
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
    if (!merged[key] && (currentNormalized[key] || incomingNormalized[key])) {
      merged[key] = currentNormalized[key] || incomingNormalized[key];
    }
  }
  return normalizePostAccount(merged);
}

function readPostAccountCache() {
  try {
    const rows = JSON.parse(localStorage.getItem(POST_ACCOUNT_CACHE_KEY) || "[]");
    if (!Array.isArray(rows)) return [];
    const merged = new Map();
    for (const raw of rows) {
      const account = normalizePostAccount(raw);
      if (!account) continue;
      const key = postAccountKey(account);
      merged.set(key, mergePostAccountRecord(merged.get(key) || {}, account));
    }
    const accounts = [...merged.values()].filter(Boolean);
    if (accounts.length !== rows.length) localStorage.setItem(POST_ACCOUNT_CACHE_KEY, JSON.stringify(accounts));
    return accounts;
  } catch {
    return [];
  }
}

function savePostAccountCache(accounts = [], options = {}) {
  const replace = !!options.replace;
  const merged = new Map();
  if (!replace) {
    for (const account of readPostAccountCache()) {
      merged.set(postAccountKey(account), account);
    }
  }
  for (const raw of accounts) {
    const account = normalizePostAccount(raw);
    if (!account) continue;
    const key = postAccountKey(account);
    merged.set(key, mergePostAccountRecord(merged.get(key) || {}, account));
  }
  const rows = [...merged.values()];
  localStorage.setItem(POST_ACCOUNT_CACHE_KEY, JSON.stringify(rows));
  return rows;
}

function postAccountMatches(account, target) {
  const current = normalizePostAccount(account);
  const wanted = normalizePostAccount(target);
  if (!current || !wanted) return false;
  const currentKey = postAccountKey(current);
  const wantedKey = postAccountKey(wanted);
  const currentProfileKey = postAccountProfileKey(current);
  const wantedProfileKey = postAccountProfileKey(wanted);
  if (currentProfileKey && wantedProfileKey) return currentProfileKey === wantedProfileKey;
  return !!(
    (currentKey && wantedKey && currentKey === wantedKey) ||
    (wanted.secUid && current.secUid === wanted.secUid) ||
    (wanted.uniqueId && current.uniqueId.toLowerCase() === wanted.uniqueId.toLowerCase()) ||
    (wanted.id && current.id === wanted.id)
  );
}

function hydrateAccountFromChannelCache(account) {
  const normalized = normalizePostAccount(account);
  if (!normalized) return null;
  const cached = readPostAccountCache().find((row) => postAccountMatches(row, normalized));
  if (!cached) return normalized;
  return mergePostAccountRecord(normalized, cached);
}

function removePostAccountCache(target) {
  const account = normalizePostAccount(target);
  if (!account) return readPostAccountCache();
  const next = readPostAccountCache().filter((row) => !postAccountMatches(row, account));
  localStorage.setItem(POST_ACCOUNT_CACHE_KEY, JSON.stringify(next));
  if (postAccountMatches(showcaseSelectedAccount, account)) {
    showcaseSelectedAccount = null;
    saveShowcaseAccount(null);
    renderShowcaseSelectedAccount();
  }
  return next;
}

function postAccountFromCard(card) {
  if (!card) return null;
  return normalizePostAccount({
    id: card.dataset.postAccountId,
    uniqueId: card.dataset.postAccountUniqueId,
    nickname: card.dataset.postAccountNickname,
    avatar: card.dataset.postAccountAvatar,
    avatarThumb: card.dataset.postAccountAvatarThumb,
    secUid: card.dataset.postAccountSecUid,
    followerCount: card.dataset.postAccountFollowers,
    followingCount: card.dataset.postAccountFollowing,
    heartCount: card.dataset.postAccountHeart,
    videoCount: card.dataset.postAccountVideos,
    installId: card.dataset.postAccountInstallId,
    socketId: card.dataset.postAccountSocketId,
    profileSocketId: card.dataset.postAccountProfileSocketId,
    chromeProfileId: card.dataset.postAccountChromeProfileId,
    chromeProfileLabel: card.dataset.postAccountChromeProfileLabel,
    profileStableId: card.dataset.postAccountProfileStableId,
    chromeProfileStableId: card.dataset.postAccountChromeProfileStableId,
    userDataDir: card.dataset.postAccountUserDataDir,
    profileDirectory: card.dataset.postAccountProfileDirectory,
    profileDir: card.dataset.postAccountProfileDir,
  });
}

function postAccountInitial(account) {
  const text = String(account?.uniqueId || account?.nickname || "T").trim();
  return (text[0] || "T").toUpperCase();
}

function postAccountAvatarMarkup(account) {
  const src = account?.avatar || account?.avatarThumb || "";
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  return `<span class="post-account-avatar-fallback">${escapeHtml(postAccountInitial(account))}</span>`;
}

function renderShowcaseSelectedAccount() {
  if (!showcaseSelectedAccountCard) return;
  const account = hydrateAccountFromChannelCache(showcaseSelectedAccount);
  if (!account) {
    showcaseSelectedAccountCard.hidden = true;
    showcaseSelectedAccountCard.innerHTML = "";
    return;
  }
  showcaseSelectedAccount = account;
  showcaseSelectedAccountCard.hidden = false;
  showcaseSelectedAccountCard.innerHTML = `
    ${postAccountAvatarMarkup(account)}
    <div>
      <strong title="@${escapeHtml(account.uniqueId)}">@${escapeHtml(account.uniqueId)}</strong>
      <span>${escapeHtml([
        account.nickname && account.nickname !== account.uniqueId ? account.nickname : "",
        account.chromeProfileLabel,
        account.followerCount ? `${account.followerCount} followers` : "",
      ].filter(Boolean).join(" ? "))}</span>
    </div>
  `;
}

function ensurePostAccountDeleteModal() {
  let modal = document.getElementById("postAccountDeleteModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "postAccountDeleteModal";
  modal.className = "post-account-delete-modal";
  modal.innerHTML = `
    <div class="post-account-delete-backdrop" data-post-account-delete-cancel></div>
    <section class="post-account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="postAccountDeleteTitle">
      <button class="flow-prompt-close" type="button" data-post-account-delete-cancel aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
      <p class="eyebrow">Delete TikTok account</p>
      <h3 id="postAccountDeleteTitle">ยืนยันการลบโปรไฟล์นี้?</h3>
      <p class="post-account-delete-note">การ์ดนี้จะถูกลบออกจากรายการบัญชีที่จำไว้ ถ้าต้องการใช้อีกครั้งให้กดสแกนหา Account ใหม่</p>
      <div class="post-account-delete-preview" data-post-account-delete-preview></div>
      <div class="post-account-delete-actions">
        <button class="outline-btn" type="button" data-post-account-delete-cancel>ยกเลิก</button>
        <button class="danger-btn" type="button" data-post-account-delete-confirm>
          <span class="material-symbols-outlined">delete</span>
          ลบโปรไฟล์
        </button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  return modal;
}

function closePostAccountDeleteModal() {
  const modal = document.getElementById("postAccountDeleteModal");
  if (!modal) return;
  modal.classList.remove("is-open");
}

function openPostAccountDeleteConfirm(account, accountModal, afterDelete) {
  const normalized = normalizePostAccount(account);
  if (!normalized) return;
  const modal = ensurePostAccountDeleteModal();
  const preview = modal.querySelector("[data-post-account-delete-preview]");
  const cancelButtons = modal.querySelectorAll("[data-post-account-delete-cancel]");
  const confirmButton = modal.querySelector("[data-post-account-delete-confirm]");
  if (preview) {
    preview.innerHTML = `
      ${postAccountAvatarMarkup(normalized)}
      <div>
        <strong>@${escapeHtml(normalized.uniqueId)}</strong>
        <span>${escapeHtml([normalized.nickname && normalized.nickname !== normalized.uniqueId ? normalized.nickname : "", normalized.chromeProfileLabel].filter(Boolean).join(" ? "))}</span>
      </div>
    `;
  }
  cancelButtons.forEach((button) => {
    button.onclick = () => closePostAccountDeleteModal();
  });
  confirmButton.onclick = async () => {
    confirmButton.disabled = true;
    confirmButton.innerHTML = `<span class="material-symbols-outlined">hourglass_empty</span> กำลังลบ...`;
    try {
      removePostAccountCache(normalized);
      const response = await fetch("/api/tiktok/accounts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: normalized }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Delete account failed");
      const nextAccounts = readPostAccountCache();
      renderTikTokAccountCards(accountModal, nextAccounts, []);
      if (typeof afterDelete === "function") afterDelete(nextAccounts);
      const status = accountModal?.querySelector("[data-post-account-status]");
      if (status) status.textContent = `ลบ @${normalized.uniqueId} แล้ว เหลือ ${nextAccounts.length} บัญชี`;
      closePostAccountDeleteModal();
    } catch (error) {
      setShowcaseStatus(`ลบโปรไฟล์ไม่สำเร็จ: ${error.message || error}`, true);
    } finally {
      confirmButton.disabled = false;
      confirmButton.innerHTML = `<span class="material-symbols-outlined">delete</span> ลบโปรไฟล์`;
    }
  };
  modal.classList.add("is-open");
}


const TIKTOK_AUTH_COOKIE_NAMES = new Set(["sessionid", "sessionid_ss", "sid_tt"]);

function channelCookieStatus(account) {
  const session = normalizePostAccountSession(account?.session);
  const cookies = Array.isArray(session?.cookies) ? session.cookies : [];
  const authCookies = cookies.filter((cookie) => TIKTOK_AUTH_COOKIE_NAMES.has(String(cookie.name || "").toLowerCase()) && cookie.value);
  const nowSeconds = Date.now() / 1000;
  const usable = authCookies.some((cookie) => !cookie.expirationDate || Number(cookie.expirationDate) > nowSeconds);
  const expired = !usable;
  const nextExpiry = authCookies
    .map((cookie) => Number(cookie.expirationDate || 0))
    .filter((value) => value > nowSeconds)
    .sort((a, b) => a - b)[0] || null;
  return {
    usable,
    expired,
    label: usable ? "ใช้ได้" : "หมดอายุ",
    className: usable ? "is-valid" : "is-expired",
    authCookieCount: authCookies.length,
    cookieCount: cookies.length,
    capturedAt: session?.capturedAt || "",
    nextExpiry,
  };
}

// The AI Studio in-iframe "channel" page (renderChannelPageAccounts, loadChannelAccounts,
// refreshChannelAccount, openChannelCookieModal, and their DOM/list handlers) was removed
// here: it duplicated the parent app's native Channel tab (ui/index.html #channelView),
// which already does this job — "ไปหน้า Channel" now asks the parent frame to switch to it.
function goToParentChannelPage() {
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: "autotik:navigate", route: "channel" }, "*");
      return;
    } catch (_) {
      /* fall through */
    }
  }
  // Not embedded in the parent shell (e.g. AI Studio opened directly in its own tab) —
  // nothing to hand the navigation off to; just open the main app.
  window.open("http://127.0.0.1:3300/app", "_blank");
}

function ensureTikTokAccountModal() {
  let modal = document.getElementById("tiktokAccountModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "tiktokAccountModal";
  modal.className = "post-account-modal";
  modal.innerHTML = `
    <div class="post-account-backdrop" data-post-account-close></div>
    <section class="post-account-dialog" role="dialog" aria-modal="true" aria-labelledby="postAccountTitle">
      <button class="flow-prompt-close" type="button" data-post-account-close aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="post-section-head">
        <div>
          <p class="eyebrow">TikTok account</p>
          <h2 id="postAccountTitle">เลือกบัญชีที่จะดึงสินค้า</h2>
          <p>รายการบัญชีในหน้านี้ดึงจากหน้า Channel เท่านั้น หากต้องการสแกนหรือ refresh ให้ไปที่หน้า Channel</p>
        </div>
        <button class="outline-btn compact" type="button" data-post-account-scan>
          <span class="material-symbols-outlined">manage_search</span>
          ไปหน้า Channel
        </button>
      </div>
      <div class="post-account-status" data-post-account-status>กำลังเชื่อมต่อ TikTok...</div>
      <div class="post-account-list" data-post-account-list></div>
    </section>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-post-account-close]")) {
      closeTikTokAccountModal();
      return;
    }
    if (event.target.closest("[data-post-account-scan]")) {
      closeTikTokAccountModal();
      goToParentChannelPage();
      return;
    }
    const profileRefreshButton = event.target.closest("[data-post-profile-refresh]");
    if (profileRefreshButton) {
      event.preventDefault();
      event.stopPropagation();
      const profile = postProfileFromRow(profileRefreshButton.closest("[data-post-profile]"));
      if (profile) refreshTikTokSingleProfile(modal, profile, profileRefreshButton);
      return;
    }
    const accountRefreshButton = event.target.closest("[data-post-account-refresh]");
    if (accountRefreshButton) {
      event.preventDefault();
      event.stopPropagation();
      const account = postAccountFromCard(accountRefreshButton.closest("[data-post-account]"));
      if (account) refreshTikTokSingleProfile(modal, account, accountRefreshButton);
      return;
    }
    const deleteButton = event.target.closest("[data-post-account-delete]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      const account = postAccountFromCard(deleteButton.closest("[data-post-account]"));
      if (account) openPostAccountDeleteConfirm(account, modal);
      return;
    }
    const card = event.target.closest("[data-post-account]");
    if (card) {
      const account = postAccountFromCard(card);
      if (!account) return;
      saveShowcaseAccount(account);
      setShowcaseStatus(`เลือกบัญชีดึงสินค้า @${account.uniqueId}`);
      closeTikTokAccountModal();
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function updateTikTokAccountModalTitle(modal) {
  const title = modal?.querySelector("#postAccountTitle");
  const desc = modal?.querySelector(".post-section-head p:not(.eyebrow)");
  if (title) title.textContent = "เลือกบัญชีที่จะดึงสินค้า";
  if (desc) desc.textContent = "เลือก Channel/TikTok account ที่มี cookie/token เก็บไว้ ระบบจะใช้ cache นี้เรียก API Showcase โดยตรง";
}

function closeTikTokAccountModal() {
  const modal = document.getElementById("tiktokAccountModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.classList.remove("post-account-open");
}

function postProfileFromRow(row) {
  if (!row) return null;
  return {
    installId: row.dataset.postProfileInstallId || "",
    socketId: row.dataset.postProfileSocketId || "",
    profileSocketId: row.dataset.postProfileSocketId || "",
    profileLabel: row.dataset.postProfileLabel || "",
    chromeProfileLabel: row.dataset.postProfileLabel || "",
    profileStableId: row.dataset.postProfileStableId || "",
    chromeProfileStableId: row.dataset.postProfileStableId || "",
    userDataDir: row.dataset.postProfileUserDataDir || "",
    profileDirectory: row.dataset.postProfileDirectory || "",
    profileDir: row.dataset.postProfileDir || "",
  };
}

function renderTikTokAccountCards(modal, accounts = [], profiles = []) {
  const list = modal?.querySelector("[data-post-account-list]");
  const status = modal?.querySelector("[data-post-account-status]");
  if (!list) return;
  if (!accounts.length) {
    const profileRows = Array.isArray(profiles) && profiles.length
      ? profiles.map((profile) => {
        const online = !!profile.connected || profile.status === "online";
        const label = profile.profileLabel || profile.chromeProfileLabel || (profile.socketId ? `Chrome #${profile.socketId}` : "Chrome profile");
        const count = Number(profile.count || 0);
        return `
          <div class="flow-empty-card post-account-profile-row"
            data-post-profile
            data-post-profile-install-id="${escapeHtml(profile.installId || "")}"
            data-post-profile-socket-id="${escapeHtml(profile.socketId || "")}"
            data-post-profile-label="${escapeHtml(label)}"
            data-post-profile-stable-id="${escapeHtml(profile.chromeProfileStableId || profile.profileStableId || "")}"
            data-post-profile-user-data-dir="${escapeHtml(profile.userDataDir || "")}"
            data-post-profile-directory="${escapeHtml(profile.profileDirectory || "")}"
            data-post-profile-dir="${escapeHtml(profile.profileDir || "")}">
            <strong>${escapeHtml(label)}</strong>
            <span class="${online ? "is-online" : "is-offline"}">${online ? "online" : "offline"}</span>
            <small>${escapeHtml(online ? (count ? `พบบัญชี ${count} บัญชี` : "เปิดอยู่ แต่ยังไม่พบบัญชี TikTok") : "Chrome profile นี้ยังไม่เชื่อมต่อ โปรแกรมจะเปิดเพื่อตรวจล่าสุดอัตโนมัติ")}</small>
            <button class="post-profile-refresh" type="button" data-post-profile-refresh>
              <span class="material-symbols-outlined">manage_search</span>
              ดึงโปรไฟล์
            </button>
          </div>
        `;
      }).join("")
      : `<div class="flow-empty-card">ยังไม่พบบัญชี TikTok จาก Chrome profile นี้</div>`;
    list.innerHTML = profileRows;
    if (status) {
      status.textContent = profiles.length
        ? `ตรวจ ${profiles.length} Chrome profile แล้ว แต่ยังไม่มีบัญชีให้เลือก`
        : "ยังไม่มีบัญชีที่บันทึกไว้ กดสแกนหา Account เพื่อค้นหาจาก Chrome profile";
    }
    return;
  }
  if (status) status.textContent = `พบบัญชี ${accounts.length} บัญชี คลิกการ์ดเพื่อเลือก`;
  list.innerHTML = accounts.map((raw) => {
    const account = normalizePostAccount(raw);
    if (!account) return "";
    const selected = postAccountKey(showcaseSelectedAccount) === postAccountKey(account);
    const profileText = account.chromeProfileLabel || (account.socketId ? `Chrome #${account.socketId}` : "");
    return `
      <div class="post-account-choice${selected ? " is-selected" : ""}" role="button" tabindex="0"
        aria-pressed="${selected ? "true" : "false"}"
        data-post-account
        data-post-account-id="${escapeHtml(account.id)}"
        data-post-account-unique-id="${escapeHtml(account.uniqueId)}"
        data-post-account-nickname="${escapeHtml(account.nickname)}"
        data-post-account-avatar="${escapeHtml(account.avatar)}"
        data-post-account-avatar-thumb="${escapeHtml(account.avatarThumb)}"
        data-post-account-sec-uid="${escapeHtml(account.secUid)}"
        data-post-account-followers="${escapeHtml(account.followerCount)}"
        data-post-account-following="${escapeHtml(account.followingCount)}"
        data-post-account-heart="${escapeHtml(account.heartCount)}"
        data-post-account-videos="${escapeHtml(account.videoCount)}"
        data-post-account-install-id="${escapeHtml(account.installId)}"
        data-post-account-socket-id="${escapeHtml(account.socketId)}"
        data-post-account-profile-socket-id="${escapeHtml(account.profileSocketId)}"
        data-post-account-chrome-profile-id="${escapeHtml(account.chromeProfileId)}"
        data-post-account-chrome-profile-label="${escapeHtml(account.chromeProfileLabel)}"
        data-post-account-profile-stable-id="${escapeHtml(account.profileStableId)}"
        data-post-account-chrome-profile-stable-id="${escapeHtml(account.chromeProfileStableId)}"
        data-post-account-user-data-dir="${escapeHtml(account.userDataDir)}"
        data-post-account-profile-directory="${escapeHtml(account.profileDirectory)}"
        data-post-account-profile-dir="${escapeHtml(account.profileDir)}">
        <div class="post-account-choice-avatar">
          ${postAccountAvatarMarkup(account)}
        </div>
        <span class="post-account-identity">
          <strong>@${escapeHtml(account.uniqueId)}</strong>
          <small>${escapeHtml(account.nickname && account.nickname !== account.uniqueId ? account.nickname : "TikTok")}</small>
        </span>
        <span class="post-account-choice-meta">
          <span><span class="material-symbols-outlined">language</span>${escapeHtml(profileText || "TikTok")}</span>
          <span><span class="material-symbols-outlined">group</span>${escapeHtml(account.followerCount || "0")} followers</span>
        </span>
        <span class="post-account-choice-state">
          <span class="material-symbols-outlined">${selected ? "check_circle" : "touch_app"}</span>
          ${selected ? "เลือกแล้ว" : "เลือกบัญชี"}
        </span>
        <div class="post-account-choice-actions">
          <button class="post-account-refresh" type="button" data-post-account-refresh title="ดึง API ใหม่" aria-label="ดึง API ใหม่ ${escapeHtml(account.uniqueId)}">
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button class="post-account-delete" type="button" data-post-account-delete title="ลบโปรไฟล์นี้" aria-label="ลบโปรไฟล์ ${escapeHtml(account.uniqueId)}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderTikTokAccountLoadingCards(modal, profiles = []) {
  const list = modal?.querySelector("[data-post-account-list]");
  const status = modal?.querySelector("[data-post-account-status]");
  if (!list) return;
  const rows = Array.isArray(profiles) && profiles.length ? profiles : [
    { profileLabel: "Chrome profile", status: "loading" },
  ];
  if (status) status.textContent = "กำลังโหลด Profile และดึงข้อมูลบัญชีจาก TikTok API...";
  list.innerHTML = rows.map((profile, index) => {
    const label = profile.profileLabel || profile.chromeProfileLabel || profile.label || `Chrome #${index + 1}`;
    return `
      <div class="flow-empty-card post-account-profile-row is-loading">
        <strong>${escapeHtml(label)}</strong>
        <span class="is-loading">loading</span>
        <small>กำลังเปิด Chrome profile, อ่าน cookie/token และดึง avatar, nickname, uniqueId จาก TikTok API</small>
      </div>
    `;
  }).join("");
}

async function refreshTikTokSingleProfile(modal, profile, button = null) {
  const status = modal?.querySelector("[data-post-account-status]");
  const row = button?.closest("[data-post-profile]");
  const originalHtml = button?.innerHTML || "";
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="material-symbols-outlined">hourglass_empty</span> กำลังดึง...`;
  }
  if (row) {
    row.classList.add("is-loading");
    const badge = row.querySelector(".is-offline, .is-online, .is-loading");
    if (badge) {
      badge.className = "is-loading";
      badge.textContent = "loading";
    }
    const note = row.querySelector("small");
    if (note) note.textContent = "กำลังเปิด Chrome profile นี้เพื่ออ่าน cookie/token และดึงข้อมูลจาก TikTok API";
  }
  if (status) status.textContent = `กำลังโหลด Profile: ${profile.profileLabel || profile.chromeProfileLabel || "Chrome profile"}`;
  try {
    const response = await fetch("/api/tiktok/accounts/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ profile, forceBrowser: true }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Cannot fetch TikTok profile");
    const serverAccounts = Array.isArray(payload.accounts) ? payload.accounts.map(normalizePostAccount).filter(Boolean) : [];
    const accounts = serverAccounts.length ? savePostAccountCache(serverAccounts, { replace: false }) : readPostAccountCache();
    const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    renderTikTokAccountCards(modal, accounts, accounts.length ? [] : profiles);
    if (status) status.textContent = accounts.length
      ? `ดึงสำเร็จ พบ ${accounts.length} บัญชี TikTok คลิกการ์ดเพื่อเลือก`
      : "ดึง profile แล้ว แต่ยังไม่พบบัญชี TikTok";
  } catch (error) {
    if (status) status.textContent = `ดึง profile ไม่สำเร็จ: ${error.message || error}`;
    if (row) {
      row.classList.remove("is-loading");
      const badge = row.querySelector(".is-loading, .is-online, .is-offline");
      if (badge) {
        badge.className = "is-offline";
        badge.textContent = "offline";
      }
      const note = row.querySelector("small");
      if (note) note.textContent = "ยังดึงข้อมูลไม่ได้ กดดึงโปรไฟล์อีกครั้งเฉพาะช่องนี้";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml || `<span class="material-symbols-outlined">manage_search</span> ดึงโปรไฟล์`;
    }
  }
}

async function loadTikTokAccountsForPost(modal = ensureTikTokAccountModal(), options = {}) {
  const status = modal?.querySelector("[data-post-account-status]");
  const list = modal?.querySelector("[data-post-account-list]");
  const cacheOnly = !!options.cacheOnly;
  const preserveList = !!options.preserveList;
  if (cacheOnly) {
    let accounts = readPostAccountCache();
    // The SERVER cache is the source of truth, not this page's localStorage.
    //
    // localStorage here is scoped to this iframe's own origin, so it never sees
    // scans, additions or deletions done from the main app's Channel tab (a
    // different origin) — those only land server-side. This used to consult the
    // server only when the local list was EMPTY, so one stale entry was enough
    // to pin this picker to a different set of accounts than the Channel page
    // was showing. Always ask the server, and let its answer replace the local
    // copy; the local one is only a fallback for when the server is unreachable.
    try {
      const response = await fetch("/api/tiktok/accounts?cache=1", { cache: "no-store" });
      const payload = await readJsonResponse(response);
      const serverAccounts = Array.isArray(payload.accounts)
        ? payload.accounts.map(normalizePostAccount).filter(Boolean)
        : [];
      if (payload?.ok !== false) accounts = savePostAccountCache(serverAccounts, { replace: true });
    } catch (_) {
      /* server unreachable — stay with whatever the local cache holds */
    }
    renderTikTokAccountCards(modal, accounts, []);
    if (status) {
      status.textContent = accounts.length
        ? `โหลดบัญชีจากหน้า Channel ${accounts.length} บัญชี คลิกการ์ดเพื่อเลือก`
        : "ยังไม่มีบัญชีในหน้า Channel ไปหน้า Channel แล้วกดสแกนหา Account";
    }
    if (list && !accounts.length) {
      list.innerHTML = `<div class="flow-empty-card">ยังไม่มีบัญชีในหน้า Channel ไปหน้า Channel แล้วกดสแกนหา Account</div>`;
    }
    return { ok: true, accounts, cached: true, source: accounts.length ? "channel-cache" : "empty" };
  }
  const endpoint = cacheOnly ? "/api/tiktok/accounts?cache=1" : "/api/tiktok/accounts?refresh=1";
  if (status) {
    status.textContent = cacheOnly
      ? "กำลังโหลดบัญชี TikTok..."
      : "กำลังสแกนหา Account จาก Chrome/TikTok...";
  }
  if (list && !preserveList) {
    if (cacheOnly) {
      list.innerHTML = `<div class="flow-empty-card">กำลังโหลดบัญชี TikTok...</div>`;
    } else {
      const cachedAccounts = readPostAccountCache();
      if (cachedAccounts.length) {
        renderTikTokAccountCards(modal, cachedAccounts, []);
        if (status) status.textContent = "กำลังโหลด Profile และอัปเดตข้อมูลบัญชีจาก TikTok API...";
      } else {
        renderTikTokAccountLoadingCards(modal, []);
      }
    }
  }
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Cannot load TikTok accounts");
    let serverAccounts = Array.isArray(payload.accounts) ? payload.accounts.map(normalizePostAccount).filter(Boolean) : [];
    let serverProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    if (!serverAccounts.length && !cacheOnly) {
      try {
        const cachedResponse = await fetch("/api/tiktok/accounts?cache=1", { cache: "no-store" });
        const cachedPayload = await readJsonResponse(cachedResponse);
        if (cachedResponse.ok && cachedPayload.ok !== false) {
          const cachedServerAccounts = Array.isArray(cachedPayload.accounts)
            ? cachedPayload.accounts.map(normalizePostAccount).filter(Boolean)
            : [];
          if (cachedServerAccounts.length) {
            serverAccounts = cachedServerAccounts;
            serverProfiles = Array.isArray(cachedPayload.profiles) ? cachedPayload.profiles : serverProfiles;
          }
        }
      } catch (_) {
        /* keep the original scan response */
      }
    }
    const cachedAccounts = readPostAccountCache();
    const accounts = serverAccounts.length ? savePostAccountCache(serverAccounts, { replace: false }) : cachedAccounts;
    const profiles = serverProfiles;
    renderTikTokAccountCards(modal, accounts, accounts.length ? [] : profiles);
    if (status && Array.isArray(payload.profiles)) {
      const profileCount = Number(payload.profileCount || payload.profiles.length || 0);
      const accountCount = accounts.length;
      if (accountCount) {
        status.textContent = `ตรวจ ${profileCount} Chrome profile พบ ${accountCount} บัญชี TikTok คลิกการ์ดเพื่อเลือก`;
      } else {
        status.textContent = "ยังไม่มีบัญชี TikTok ให้เลือก กดสแกนหา Account เพื่ออัปเดต";
      }
    }
    return payload;
  } catch (error) {
    if (status) status.textContent = `ดึงบัญชีไม่สำเร็จ: ${error.message || error}`;
    if (list && !preserveList) {
      list.innerHTML = `<div class="showcase-status is-error">ตรวจสอบว่า extension เชื่อมต่ออยู่ และล็อกอิน TikTok ใน Chrome profile นี้</div>`;
    }
    return null;
  }
}

function openShowcaseAccountModal() {
  tiktokAccountModalMode = "showcase";
  const modal = ensureTikTokAccountModal();
  updateTikTokAccountModalTitle(modal);
  modal.classList.add("is-open");
  document.body.classList.add("post-account-open");
  loadTikTokAccountsForPost(modal, { cacheOnly: true, preserveList: false });
  return modal;
}

function ensureLogsModal() {
  let modal = document.getElementById("logsModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "logsModal";
  modal.className = "logs-modal";
  modal.innerHTML = `
    <div class="logs-backdrop" data-close-logs></div>
    <section class="logs-dialog" role="dialog" aria-modal="true" aria-labelledby="logsModalTitle">
      <button class="logs-close" type="button" data-close-logs aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="logs-head">
        <div>
          <span class="logs-kicker">Backend trace</span>
          <h2 id="logsModalTitle">Logs</h2>
          <p>Log code เบื้องหลังจาก server, extension และ Flow backend</p>
        </div>
        <button class="outline-btn compact" type="button" data-refresh-logs>
          <span class="material-symbols-outlined">refresh</span>
          Refresh
        </button>
        <button class="outline-btn compact danger" type="button" data-clear-logs>
          <span class="material-symbols-outlined">delete_sweep</span>
          ล้าง Logs
        </button>
      </div>
      <div class="logs-summary" data-logs-summary></div>
      <div class="logs-list" data-logs-list></div>
    </section>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-logs]")) closeLogsModal();
    if (event.target.closest("[data-refresh-logs]")) renderLogsModal();
    if (event.target.closest("[data-clear-logs]")) clearBackendLogs();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) closeLogsModal();
  });
  document.body.appendChild(modal);
  return modal;
}

async function renderLogsModal() {
  const modal = ensureLogsModal();
  const rows = await fetchBackendLogs();
  renderLogsModalRows(rows);
}

function renderLogsModalRows(rows = backendLogRows) {
  const modal = ensureLogsModal();
  const summary = modal.querySelector("[data-logs-summary]");
  const list = modal.querySelector("[data-logs-list]");
  const total = rows.length;
  const errors = rows.filter((row) => String(row.level || "").toLowerCase() === "error").length;
  const warns = rows.filter((row) => ["warn", "warning"].includes(String(row.level || "").toLowerCase())).length;
  const infos = Math.max(0, total - errors - warns);
  if (summary) {
    summary.innerHTML = `
      <article><strong>${total}</strong><span>log lines</span></article>
      <article><strong>${infos}</strong><span>info</span></article>
      <article><strong>${warns}</strong><span>warn</span></article>
      <article><strong>${errors}</strong><span>error</span></article>
    `;
  }
  if (list) {
    list.innerHTML = rows.length ? rows.map((row) => {
      const detail = logDetailText(row.detail);
      const time = row.time ? new Date(row.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
      return `
        <article class="logs-row backend-log-row ${logLevelClass(row.level)}">
          <span class="logs-dot"></span>
          <div>
            <strong><code>[${escapeHtml(row.level || "info")}] [${escapeHtml(row.source || "server")}]</code> ${escapeHtml(row.message || "")}</strong>
            ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
          </div>
          <span class="logs-state">${escapeHtml(row.level || "info")}</span>
          <time>${escapeHtml(time)}</time>
        </article>
      `;
    }).join("") : `
      <article class="logs-row backend-log-row is-queued">
        <span class="logs-dot"></span>
        <div>
          <strong><code>[info] [server]</code> ยังไม่มี backend log</strong>
          <pre>เริ่มดึงสินค้า หรือกดสร้างคลิป แล้ว log จะขึ้นตรงนี้</pre>
        </div>
        <span class="logs-state">info</span>
        <time>ตอนนี้</time>
      </article>
    `;
  }
}

function openLogsModal() {
  ensureLogsModal().classList.add("is-open");
  document.body.classList.add("logs-open");
  renderLogsModal();
  clearInterval(logsModalTimer);
  logsModalTimer = window.setInterval(renderLogsModal, 1500);
}

function closeLogsModal() {
  const modal = document.getElementById("logsModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.classList.remove("logs-open");
  clearInterval(logsModalTimer);
  logsModalTimer = null;
}

document.querySelectorAll("[data-open-logs]").forEach((button) => {
  button.addEventListener("click", openLogsModal);
});
// One floating log dock, on every screen — the same shape the main app's
// All Channels and POST WEB tabs use: pinned to the bottom, collapsed to its
// header until you open it, with Clear right there in the header. This replaces
// a panel with the same markup that was only reachable from a mobile-only
// button, so the desktop had no floating log at all.
function ensureLogDock() {
  let panel = document.getElementById("logDock");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "logDock";
  panel.className = "log-dock";
  panel.innerHTML = `
    <div class="log-dock-head" data-log-dock-toggle>
      <div class="log-dock-title">
        <strong>ACTIVITY LOG</strong>
        <span class="log-dock-kicker">LOG ของ AI STUDIO และ EXTENSION</span>
      </div>
      <div class="log-dock-actions">
        <button class="outline-btn compact" type="button" data-log-dock-refresh>
          <span class="material-symbols-outlined">refresh</span> Refresh
        </button>
        <button class="outline-btn compact danger" type="button" data-log-dock-clear>
          <span class="material-symbols-outlined">delete_sweep</span> Clear
        </button>
        <button class="outline-btn compact" type="button" data-log-dock-modal>
          <span class="material-symbols-outlined">open_in_full</span> Modal
        </button>
        <button class="icon-btn compact" type="button" data-log-dock-collapse aria-label="Toggle logs">
          <span class="material-symbols-outlined">expand_less</span>
        </button>
      </div>
    </div>
    <div class="log-dock-list" data-log-dock-list></div>
  `;
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-log-dock-refresh]")) { refreshLiveLog(); return; }
    if (event.target.closest("[data-log-dock-clear]")) { clearLogDock(); return; }
    if (event.target.closest("[data-log-dock-modal]")) { openLogsModal(); return; }
    // The whole header is the handle, like the main app's bottom log bar.
    if (event.target.closest("[data-log-dock-collapse]") || event.target.closest("[data-log-dock-toggle]")) toggleLogDock();
  });
  document.body.appendChild(panel);
  return panel;
}

function renderLogDockRows(rows = logDockRows) {
  const panel = ensureLogDock();
  panel.classList.toggle("is-open", logDockOpen);
  document.body.classList.toggle("log-dock-open", logDockOpen);
  const collapseIcon = panel.querySelector("[data-log-dock-collapse] .material-symbols-outlined");
  if (collapseIcon) collapseIcon.textContent = logDockOpen ? "expand_more" : "expand_less";
  const list = panel.querySelector("[data-log-dock-list]");
  if (!list) return;
  const visibleRows = rows.slice(0, 80);
  list.innerHTML = visibleRows.length ? visibleRows.map((row) => {
    const time = row.time ? new Date(row.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
    return `
      <article class="log-dock-row ${logLevelClass(row.level)}">
        <time>${escapeHtml(time)}</time>
        <strong>${escapeHtml(row.text || "")}</strong>
      </article>`;
  }).join("") : '<div class="mobile-empty">ยังไม่มีความเคลื่อนไหว</div>';
}

/** The dock shows what is happening to each clip, in plain language — the
 *  server does the wording (/api/logs/friendly) so the POST WEB dock in the main
 *  app reads exactly the same feed. */
async function refreshLogDock() {
  try {
    const response = await fetch("/api/logs/friendly?audience=studio&limit=120", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    logDockRows = Array.isArray(payload.logs) ? payload.logs : [];
  } catch (error) {
    logDockRows = [];
  }
  renderLogDockRows(logDockRows);
}

/** Clear empties BOTH logs: the clip-generation log the dock displays, and the
 *  backend log the Modal view still shows. Clearing only one left whichever
 *  view the operator was looking at apparently untouched. */
async function clearLogDock() {
  await Promise.all([
    fetch("/api/flow/logs", { method: "DELETE", cache: "no-store" }).catch(() => null),
    fetch("/api/logs/clear", { method: "DELETE", cache: "no-store" }).catch(() => null),
  ]);
  await Promise.all([refreshLogDock(), refreshLiveLog()]);
}

function toggleLogDock(open = !logDockOpen) {
  logDockOpen = Boolean(open);
  localStorage.setItem("autogt.logDock.open", logDockOpen ? "1" : "0");
  renderLogDockRows(logDockRows);
}

async function clearBackendLogs() {
  try {
    await fetch("/api/logs/clear", { method: "DELETE", cache: "no-store" });
  } catch {
    /* best-effort */
  }
  await refreshLiveLog();
  const modal = document.getElementById("logsModal");
  if (modal?.classList.contains("is-open")) renderLogsModal();
}



































// ============================= LOGS ================================== //

// ================================================================================= //

// Get Next Flow Job 

// Get Runnable Flow Jop Entry





// ============================================================================================= //


// Render the flow jobs in the queue, updating the UI with their status and available actions

// ---- ประวัติ (History) — server-persisted, separate from the localStorage-only
// flowJobs/flowQueue above. See /api/flow/history in server.js. ----
let flowHistoryFilter = "all";
let flowHistoryRows = [];


function flowHistoryStatusLabel(status) {
  if (status === "done") return "สำเร็จ";
  if (status === "cancelled") return "ยกเลิก";
  return "ล้มเหลว";
}

function flowHistoryStatusClass(status) {
  if (status === "done") return "is-success";
  if (status === "cancelled") return "is-warning";
  return "is-failed";
}



document.getElementById("flowHistoryFilter")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  flowHistoryFilter = button.dataset.filter || "all";
  document.querySelectorAll("#flowHistoryFilter [data-filter]").forEach((el) => {
    el.classList.toggle("on", el === button);
  });
  renderFlowHistoryList();
});

document.querySelector(".flow-history-clear-bar")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-clear]");
  if (!button) return;
  clearFlowHistoryByStatus(button.dataset.clear);
});

// Reset a flow job for retrying

// Retry a specific flow job by ID

// Retry all flow jobs that are in a retryable state

// Clear all flow jobs from the queue and stop any running processes

// flow-suite: maps a raw Showcase/Shopee product row (id, title, price, image,
// stock, shop, commission, commissionRate — see queueProductsForFlow below)
// into the {name, brand, category, sellingPoints, variations, images} shape
// the ported BlueSPite prompt builder (lib/flow-suite/shared/prompt.mjs's
// buildPrompt/productBlock) expects. Showcase carries no brand/category/
// selling-point/variation copy, so those fields are simply omitted —
// productBlock() already drops any missing field's line rather than
// guessing, so this degrades gracefully to a thinner (but still correct)
// prompt instead of failing. Known, accepted limitation — not fixed here.
function mapShowcaseProductToFlowProduct(product) {
  const image = String(product?.image || "").trim();
  return {
    name: String(product?.title || "").trim(),
    images: image ? [image] : [],
  };
}

// Queue products for flow-suite processing \u2014 submits directly to the
// server-side flow-suite queue (POST /api/flow/jobs) as queued jobs, using
// the current flow-suite Prompt-page settings as defaults for every job.
// Supersedes the old client-side flowQueue/localStorage staging step \u2014
// BlueSPite's own model has no separate "queue items awaiting job creation"
// stage, selecting a product creates the job directly.
async function queueProductsForFlow(products, platform, statusSetter) {
  if (!products.length) {
    statusSetter("\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Queue", true);
    return;
  }
  const targetPlatform = String(platform || "TikTok").toLowerCase() === "shopee" ? "shopee" : "tiktok";
  const settings = flowSuiteState.settings || {};
  const items = products.map((product) => {
    const mapped = mapShowcaseProductToFlowProduct(product);
    const url = targetPlatform === "shopee" ? shopeeProductUrl(product) : productUrl(product);
    return {
      platform: targetPlatform,
      productId: String(product.id || product.itemid || ""),
      title: mapped.name,
      product: mapped,
      direction: settings.direction || {},
      characterMode: settings.characterMode === "consistent" ? "consistent" : "random",
      videoModel: settings.videoModel || "",
      imageModel: settings.imageModel || "",
      aspect: settings.aspect || "portrait",
      sceneMode: FLOW_EXTENDED_ENABLED && settings.sceneMode === "continuous" ? "continuous" : "independent",
      sceneCount: settings.sceneCount || 1,
      textMode: settings.textMode || "withText",
      textRulesPrompt: settings.textRulesPrompt || "",
      speechRulesPrompt: settings.speechRulesPrompt || "",
      extraPrompt: settings.extraPrompt || "",
      imageContentPrompt: settings.imageContentPrompt || "",
      imageMandatoryPrompt: settings.imageMandatoryPrompt || "",
      sceneVideoPrompts: Array.isArray(settings.sceneVideoPrompts)
        ? settings.sceneVideoPrompts.slice(0, Math.max(1, Number(settings.sceneCount) || 1))
        : [],
      sourceUrl: url,
    };
  });

  try {
    const response = await fetch("/api/flow/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Queue \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08");
    const platformName = targetPlatform === "shopee" ? "Shopee" : "TikTok";
    statusSetter(`\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 ${platformName} Queue \u0e41\u0e25\u0e49\u0e27 ${(payload.jobs || []).length} \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23`);
    maybeAutoRunFlowSuiteQueue();
  } catch (error) {
    statusSetter(`\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Queue \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ${error.message || error}`, true);
  }
}

// ============================================================
// flow-suite: BlueSPite-ported \u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32 Prompt / \u0e04\u0e34\u0e27 / \u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34 engine.
// Server-orchestrated (lib/flow-suite/server/{store,runner,media-store}.js)
// \u2014 this client is a thin SSE-subscribed view, not the orchestrator. All 3
// pages' DOM co-exists at all times (built once by ui-shell.js); only CSS
// visibility (body[data-flow-page] .flow-page-*) toggles which is shown, so
// none of the render functions below need to know "is my page visible".
// ============================================================
const flowSuiteState = { settings: {}, jobs: [], history: [], runner: { draining: false, stopRequested: false, currentJobIds: [] }, catalog: null };
let flowSuiteSettingsLoaded = false;
let flowSuiteEventSource = null;
let flowSuiteSamplePicks = [];
let flowSuiteSampleSceneIndex = 0;
let flowSuiteLastEditedSceneIndex = 0;

// Test images cost ~1 minute each, so keep them across a page reload. Pending
// entries are dropped on load — that request died with the old page, and a
// restored "กำลังสร้างรูป…" would never finish.
const FLOW_SUITE_TEST_IMAGE_KEY = "flowSuiteTestImages";
function flowSuiteLoadTestImages() {
  try {
    const raw = sessionStorage.getItem(FLOW_SUITE_TEST_IMAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    const kept = {};
    for (const [key, value] of Object.entries(saved || {})) {
      if (value && !value.pending) kept[key] = value;
    }
    return kept;
  } catch (error) {
    return {};
  }
}
const flowSuiteTestImages = flowSuiteLoadTestImages();
function flowSuiteSetTestImage(key, value) {
  flowSuiteTestImages[key] = value;
  try {
    sessionStorage.setItem(FLOW_SUITE_TEST_IMAGE_KEY, JSON.stringify(flowSuiteTestImages));
  } catch (error) {
    /* storage disabled or full — the in-memory copy still drives this page */
  }
}
let flowSuiteSettingsSaveTimer = null;
let flowSuiteSaveDialogTimer = null;
let flowSuiteScenePromptDrafts = Array.from({ length: 10 }, () => "");
let flowSuiteHistoryFilter = "all";
// The queue renders one page at a time: 3000 jobs as a single innerHTML was both
// unreadable and slow to re-render, and the queue re-renders on every state event.
const FLOW_SUITE_PAGE_SIZE = 100;
const FLOW_SUITE_MAX_QUEUE = 3000;          // 30 pages
const FLOW_SUITE_PAGER_WINDOW = 2;          // page numbers shown either side of the current one
let flowSuiteQueuePage = 1;
let flowSuiteJobTimerInterval = null;

function flowSuiteShared() {
  return window.FlowSuiteShared || null;
}

function flowSuiteDebounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function connectFlowSuiteEvents() {
  if (flowSuiteEventSource) return;
  const start = () => {
    flowSuiteEventSource = new EventSource("/api/flow/events");
    flowSuiteEventSource.addEventListener("state", (event) => {
      try {
        applyFlowSuiteState(JSON.parse(event.data));
      } catch (error) {
        console.error("[flow-suite] bad state event", error);
      }
    });
  };
  if (flowSuiteShared()) start();
  else window.addEventListener("flow-suite-shared-ready", start, { once: true });
}

function applyFlowSuiteState(state) {
  flowGoogleAccountEmail = String(state.flowAccountEmail || flowGoogleAccountEmail || "").trim();
  flowSuiteState.settings = state.settings || {};
  flowSuiteState.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  flowSuiteState.history = Array.isArray(state.history) ? state.history : [];
  flowSuiteState.runner = state.runner || flowSuiteState.runner;
  flowSuiteState.catalog = state.catalog || flowSuiteState.catalog;

  ensureFlowSuitePromptPageInit();
  if (!flowSuiteSettingsLoaded && flowSuiteState.catalog) {
    applyFlowSuiteSettingsToForm();
    flowSuiteSettingsLoaded = true;
  }
  renderFlowSuiteQueue();
  renderFlowSuiteHistory();
  refreshFlowSuiteSampleBox();
  flowSuiteEnsureJobTimer();
}

// ---------------------------------------------------------------- Prompt page
let flowSuitePromptInited = false;
function ensureFlowSuitePromptPageInit() {
  if (flowSuitePromptInited) return;
  const shared = flowSuiteShared();
  if (!shared || !flowSuiteState.catalog) return;
  flowSuitePromptInited = true;
  renderFlowSuiteDirectionGrid();
  renderFlowSuiteModelSelects();
  wireFlowSuitePromptEvents();
}

function renderFlowSuiteDirectionGrid() {
  const shared = flowSuiteShared();
  const grid = document.getElementById("fsDirectionGrid");
  if (!shared || !grid) return;
  grid.innerHTML = "";
  for (const [field, label] of shared.DIRECTION_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "fs-field";
    wrap.dataset.directionField = field;
    const options = shared.directionOptions(field)
      .map(([id, text]) => `<option value="${escapeHtml(id)}">${escapeHtml(text)}</option>`)
      .join("");
    wrap.innerHTML = `
      <label>${escapeHtml(label)}</label>
      <select data-direction-select>${options}</select>
      <input type="text" data-direction-custom hidden maxlength="300" placeholder="\u0e1e\u0e34\u0e21\u0e1e\u0e4c\u0e40\u0e2d\u0e07\u2026" />
    `;
    grid.appendChild(wrap);
  }
  grid.querySelectorAll("[data-direction-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const wrap = select.closest("[data-direction-field]");
      const customInput = wrap?.querySelector("[data-direction-custom]");
      const isCustom = select.value === "__custom__";
      if (customInput) customInput.hidden = !isCustom;
      if (isCustom) { customInput?.focus(); return; }
      persistFlowSuiteSettings();
      refreshFlowSuiteSampleBox();
    });
  });
  grid.querySelectorAll("[data-direction-custom]").forEach((input) => {
    input.addEventListener("input", flowSuiteDebounce(() => {
      persistFlowSuiteSettings();
      refreshFlowSuiteSampleBox();
    }, 350));
  });
}

function renderFlowSuiteModelSelects() {
  const shared = flowSuiteShared();
  const catalog = flowSuiteState.catalog;
  if (!shared || !catalog) return;
  const videoModel = document.getElementById("fsVideoModel");
  const imageModel = document.getElementById("fsImageModel");
  const aspect = document.getElementById("fsAspect");
  const textMode = document.getElementById("fsTextMode");
  if (videoModel) {
    const groups = new Map();
    for (const model of catalog.videoModels) {
      if (!groups.has(model.group)) groups.set(model.group, []);
      groups.get(model.group).push(model);
    }
    videoModel.innerHTML = [...groups.entries()].map(([group, models]) => `
      <optgroup label="${escapeHtml(group)}">
        ${models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${m.credits ? ` (${m.credits} \u0e40\u0e04\u0e23\u0e14\u0e34\u0e15)` : " (\u0e1f\u0e23\u0e35)"}</option>`).join("")}
      </optgroup>
    `).join("");
  }
  if (imageModel) {
    imageModel.innerHTML = catalog.imageModels.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join("");
  }
  if (aspect) {
    aspect.innerHTML = catalog.aspectsVideo.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)}</option>`).join("");
  }
  if (textMode) {
    textMode.innerHTML = catalog.textModes.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join("");
  }
}

function wireFlowSuitePromptEvents() {
  const debouncedPersist = flowSuiteDebounce(() => {
    persistFlowSuiteSettings();
    refreshFlowSuiteSampleBox();
  }, 350);
  ["fsVideoModel", "fsImageModel", "fsAspect", "fsTextMode", "fsSceneMode", "fsCharacterMode"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      applyFlowSuiteSceneModeRestriction();
      applyFlowSuiteConcurrencyRestriction();
      refreshFlowSuitePromptSetDefaults();
      persistFlowSuiteSettings();
      refreshFlowSuiteSampleBox();
    });
  });
  document.getElementById("fsSceneCount")?.addEventListener("input", () => {
    applyFlowSuiteSceneModeRestriction();
    debouncedPersist();
  });
  document.getElementById("fsConcurrency")?.addEventListener("input", () => {
    applyFlowSuiteConcurrencyRestriction();
    debouncedPersist();
  });
  FLOW_PROMPT_SETS.forEach((set) => {
    document.getElementById(set.input)?.addEventListener("input", (event) => {
      event.currentTarget.dataset.usesDefault = "false";
      flowSuiteSetPromptSetBadge(set, event.currentTarget.value.trim() ? "custom" : "omitted");
      debouncedPersist();
    });
    document.getElementById(set.reset)?.addEventListener("click", () => {
      const input = document.getElementById(set.input);
      if (!input) return;
      const defaultText = flowSuitePromptSetDefault(set);
      input.dataset.defaultPrompt = defaultText;
      input.value = defaultText;
      input.dataset.usesDefault = "true";
      flowSuiteSetPromptSetBadge(set, "default");
      debouncedPersist();
    });
  });
  document.getElementById("fsSceneVideoPrompts")?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-scene-video-prompt]");
    if (!input) return;
    const index = Math.max(0, Math.min(9, Number(input.dataset.sceneIndex) || 0));
    input.dataset.usesDefault = "false";
    flowSuiteScenePromptDrafts[index] = input.value;
    flowSuiteLastEditedSceneIndex = index;
    const badge = input.closest(".fs-scene-prompt-field")?.querySelector("[data-scene-prompt-state]");
    if (badge) {
      badge.textContent = "กำหนดเอง";
      badge.dataset.state = "custom";
    }
    debouncedPersist();
  });
  document.getElementById("fsSceneVideoPrompts")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reset-scene-prompt]");
    if (!button) return;
    const field = button.closest(".fs-scene-prompt-field");
    const input = field?.querySelector("[data-scene-video-prompt]");
    if (!input) return;
    const index = Math.max(0, Math.min(9, Number(input.dataset.sceneIndex) || 0));
    input.value = input.dataset.defaultPrompt || "";
    input.dataset.usesDefault = "true";
    flowSuiteScenePromptDrafts[index] = "";
    flowSuiteLastEditedSceneIndex = index;
    const badge = field.querySelector("[data-scene-prompt-state]");
    if (badge) {
      badge.textContent = "Default ปัจจุบัน";
      badge.dataset.state = "default";
    }
    const status = document.getElementById("fsApplyScenePromptsStatus");
    if (status) {
      status.textContent = `คืนค่า Default ของฉาก ${index + 1} แล้ว`;
      status.style.color = "var(--fs-ok)";
    }
    debouncedPersist();
  });
  document.getElementById("fsApplyScenePromptsBtn")?.addEventListener("click", (event) => {
    saveScenePromptsAndShowPreview(event.currentTarget);
  });
  document.getElementById("fsSaveSettingsBtn")?.addEventListener("click", (event) => {
    saveFlowSuiteSettingsWithFeedback(event.currentTarget);
  });
  document.getElementById("fsSampleBtn")?.addEventListener("click", () => sampleFlowSuiteProducts(1));
  document.getElementById("fsTemplateBtn")?.addEventListener("click", () => {
    flowSuiteSamplePicks = [];
    flowSuiteSampleSceneIndex = 0;
    renderFlowSuiteSampleBox();
  });
}

async function saveScenePromptsAndShowPreview(button) {
  const status = document.getElementById("fsApplyScenePromptsStatus");
  const originalText = button?.textContent || "💾 บันทึก Prompt และดู Preview";
  captureFlowSuiteScenePromptDrafts();
  if (button) {
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
  }
  if (status) {
    status.textContent = "กำลังบันทึก Prompt รายฉาก…";
    status.style.color = "";
  }
  try {
    await persistFlowSuiteSettings(true);
    flowSuiteSamplePicks = [];
    const values = getFlowSuiteFormValues();
    flowSuiteSampleSceneIndex = Math.max(0, Math.min(values.sceneCount - 1, flowSuiteLastEditedSceneIndex));
    renderFlowSuiteSampleBox();
    const preview = document.querySelector("#fsSampleBox .fs-preview");
    if (preview) preview.scrollTop = 0;
    if (button) button.textContent = "✓ บันทึกแล้ว · Preview อัปเดต";
    if (status) {
      status.textContent = `กำลังแสดง Prompt ที่ใช้จริงของ${flowSuitePreviewSceneLabel(flowSuiteSampleSceneIndex, values.sceneMode)}`;
      status.style.color = "var(--fs-ok)";
    }
    setTimeout(() => {
      if (button) button.textContent = originalText;
    }, 2400);
  } catch (error) {
    if (button) button.textContent = "บันทึกไม่สำเร็จ · ลองอีกครั้ง";
    if (status) {
      status.textContent = String(error?.message || error || "บันทึก Prompt ไม่สำเร็จ");
      status.style.color = "var(--fs-err)";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function normalizeFlowSuiteSceneVideoPrompts(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => String(source[index] || "").slice(0, 5000));
}

function captureFlowSuiteScenePromptDrafts() {
  document.querySelectorAll("#fsSceneVideoPrompts [data-scene-video-prompt]").forEach((input) => {
    const index = Math.max(0, Math.min(9, Number(input.dataset.sceneIndex) || 0));
    flowSuiteScenePromptDrafts[index] = input.dataset.usesDefault === "true" ? "" : input.value;
  });
}

function flowSuiteDefaultScenePrompt(sceneIndex, sceneCount, sceneMode, videoModel) {
  return flowSuiteShared()?.defaultSceneVideoInstruction?.({
    sceneIndex,
    sceneCount,
    sceneMode,
    videoModel,
  }) || "";
}

// ---- Editable prompt sets (sections 3 + 4 of the Prompt page) ----
// Saved value contract (see shared/prompt.mjs): "" = system default,
// PROMPT_OMITTED = box emptied on purpose (block dropped), else custom text.
const FLOW_PROMPT_SETS = [
  { key: "textRulesPrompt", input: "fsTextRulesPrompt", badge: "fsTextRulesState", reset: "fsResetTextRules",
    defaultText: (shared, ctx) => shared.defaultTextRulesPrompt(ctx.textMode) },
  { key: "speechRulesPrompt", input: "fsSpeechRulesPrompt", badge: "fsSpeechRulesState", reset: "fsResetSpeechRules",
    defaultText: (shared, ctx) => shared.defaultSpeechRulesPrompt(ctx.videoModel) },
  { key: "extraPrompt", input: "fsExtraPrompt", badge: "fsMandatoryPromptState", reset: "fsResetMandatoryPrompt",
    defaultText: (shared) => shared.DEFAULT_MANDATORY_PROMPT },
  { key: "imageContentPrompt", input: "fsImageContentPrompt", badge: "fsImageContentState", reset: "fsResetImageContent",
    defaultText: (shared, ctx) => shared.defaultImageContentPrompt(ctx.textMode) },
  { key: "imageMandatoryPrompt", input: "fsImageMandatoryPrompt", badge: "fsImageMandatoryState", reset: "fsResetImageMandatory",
    defaultText: (shared) => shared.defaultImageMandatoryPrompt() },
];
const FLOW_PROMPT_OMITTED = "__omit__";

function flowSuitePromptSetDefault(set) {
  const shared = flowSuiteShared();
  if (!shared) return "";
  const ctx = {
    textMode: document.getElementById("fsTextMode")?.value || "withText",
    videoModel: document.getElementById("fsVideoModel")?.value || "",
  };
  try {
    return String(set.defaultText(shared, ctx) || "");
  } catch {
    return "";
  }
}

function flowSuiteSetPromptSetBadge(set, state) {
  const badge = document.getElementById(set.badge);
  if (!badge) return;
  badge.dataset.state = state;
  badge.textContent = state === "default" ? "Default ปัจจุบัน" : state === "omitted" ? "ว่าง — ไม่ส่งชุดนี้" : "กำหนดเอง";
}

function applyFlowSuitePromptSetToForm(set, savedValue) {
  const input = document.getElementById(set.input);
  if (!input) return;
  const saved = String(savedValue || "");
  const omitted = saved.trim() === FLOW_PROMPT_OMITTED;
  const usesDefault = !saved.trim();
  const defaultText = flowSuitePromptSetDefault(set);
  input.dataset.defaultPrompt = defaultText;
  input.dataset.usesDefault = usesDefault ? "true" : "false";
  input.value = omitted ? "" : usesDefault ? defaultText : saved;
  flowSuiteSetPromptSetBadge(set, omitted ? "omitted" : usesDefault ? "default" : "custom");
}

function readFlowSuitePromptSet(set) {
  const input = document.getElementById(set.input);
  if (!input) return "";
  if (input.dataset.usesDefault === "true") return "";
  return input.value.trim() ? input.value : FLOW_PROMPT_OMITTED;
}

function readFlowSuitePromptSets() {
  const out = {};
  FLOW_PROMPT_SETS.forEach((set) => { out[set.key] = readFlowSuitePromptSet(set); });
  return out;
}

/** Defaults depend on the video model (speech length) and text mode — boxes
 *  still on "Default" follow those controls instead of freezing old text. */
function refreshFlowSuitePromptSetDefaults() {
  FLOW_PROMPT_SETS.forEach((set) => {
    const input = document.getElementById(set.input);
    if (!input || input.dataset.usesDefault !== "true") return;
    const defaultText = flowSuitePromptSetDefault(set);
    input.dataset.defaultPrompt = defaultText;
    input.value = defaultText;
  });
}

function renderFlowSuiteScenePromptInputs(savedPrompts = null) {
  const container = document.getElementById("fsSceneVideoPrompts");
  if (!container) return;
  if (savedPrompts !== null) flowSuiteScenePromptDrafts = normalizeFlowSuiteSceneVideoPrompts(savedPrompts);
  else captureFlowSuiteScenePromptDrafts();

  const mode = FLOW_EXTENDED_ENABLED && document.getElementById("fsSceneMode")?.value === "continuous"
    ? "continuous"
    : "independent";
  const maxScenes = mode === "continuous" ? 3 : 10;
  const sceneCount = Math.max(1, Math.min(maxScenes, Number(document.getElementById("fsSceneCount")?.value) || 1));
  const videoModel = document.getElementById("fsVideoModel")?.value || "";
  container.innerHTML = "";
  for (let index = 0; index < sceneCount; index += 1) {
    const field = document.createElement("div");
    field.className = "fs-scene-prompt-field";
    const head = document.createElement("div");
    head.className = "fs-scene-prompt-head";
    const label = document.createElement("label");
    const suffix = mode === "continuous"
      ? (index === 0 ? " · Original" : index === 1 ? " · Extended ครั้งแรก" : " · Extended ครั้งที่สอง")
      : "";
    label.textContent = `Prompt วิดีโอฉาก ${index + 1}${suffix}`;
    const textarea = document.createElement("textarea");
    const defaultPrompt = flowSuiteDefaultScenePrompt(index, sceneCount, mode, videoModel);
    const savedPrompt = String(flowSuiteScenePromptDrafts[index] || "");
    const usesDefault = !savedPrompt.trim();
    textarea.rows = mode === "continuous" && index > 0 ? 4 : 5;
    textarea.maxLength = 5000;
    textarea.dataset.sceneIndex = String(index);
    textarea.dataset.sceneVideoPrompt = "";
    textarea.dataset.defaultPrompt = defaultPrompt;
    textarea.dataset.usesDefault = usesDefault ? "true" : "false";
    textarea.value = usesDefault ? defaultPrompt : savedPrompt;
    const state = document.createElement("span");
    state.className = "fs-scene-prompt-state";
    state.dataset.scenePromptState = "";
    state.dataset.state = usesDefault ? "default" : "custom";
    state.textContent = usesDefault ? "Default ปัจจุบัน" : "กำหนดเอง";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "fs-btn fs-ghost fs-scene-prompt-reset";
    reset.dataset.resetScenePrompt = String(index);
    reset.textContent = "↶ กลับ Default";
    reset.title = "คืนคำสั่งของฉากนี้เป็น Prompt ปัจจุบันของระบบ";
    if (mode === "continuous" && index > 0) {
      textarea.placeholder = "ตั้งคำสั่งหลักของฉาก Extended นี้";
      textarea.title = "ฉาก Extended ใช้โครง Prompt แบบเดียวกับฉาก 1 และข้อความนี้จะแทนส่วนคำสั่งฉาก";
    } else {
      textarea.placeholder = "ตั้งคำสั่งหลักของฉากนี้";
    }
    head.append(label, state, reset);
    field.append(head, textarea);
    container.appendChild(field);
  }
}

function applyFlowSuiteSceneModeRestriction() {
  const sceneModeControl = document.querySelector("[data-flow-extended-control]");
  const sceneModeSelect = document.getElementById("fsSceneMode");
  if (sceneModeControl) sceneModeControl.hidden = !FLOW_EXTENDED_ENABLED;
  if (!FLOW_EXTENDED_ENABLED && sceneModeSelect) sceneModeSelect.value = "independent";
  const mode = FLOW_EXTENDED_ENABLED && sceneModeSelect?.value === "continuous" ? "continuous" : "independent";
  const sceneCount = document.getElementById("fsSceneCount");
  const videoModel = document.getElementById("fsVideoModel");
  const modeNote = document.getElementById("fsSceneModeNote");
  const modelNote = document.getElementById("fsVideoModelNote");
  if (sceneCount) {
    sceneCount.max = mode === "continuous" ? "3" : "10";
    const max = Number(sceneCount.max);
    if ((Number(sceneCount.value) || 1) > max) sceneCount.value = String(max);
  }
  if (videoModel) {
    videoModel.disabled = false;
  }
  if (modeNote) {
    modeNote.textContent = mode === "continuous"
      ? "ฉาก 1 = Original, ฉาก 2 = Extended ครั้งแรก, ฉาก 3 = Extended ครั้งที่สอง (สูงสุด 3 ฉาก)"
      : "แต่ละฉากสร้างแยกกัน แล้วรวมเป็นไฟล์เดียวแบบปัจจุบัน (สูงสุด 10 ฉาก)";
  }
  if (modelNote) {
    modelNote.textContent = mode === "continuous"
      ? "Original ใช้โมเดลที่เลือก · Extended ใช้โมเดล Extended ของ Flow"
      : "";
  }
  renderFlowSuiteScenePromptInputs();
}

function applyFlowSuiteConcurrencyRestriction() {
  const shared = flowSuiteShared();
  const catalog = flowSuiteState.catalog;
  const concurrencyInput = document.getElementById("fsConcurrency");
  const videoModel = document.getElementById("fsVideoModel");
  if (!shared || !catalog || !concurrencyInput || !videoModel) return;
  const concurrency = Number(concurrencyInput.value) || 1;
  const safe = new Set(catalog.concurrentSafeModels);
  let currentDisallowed = false;
  videoModel.querySelectorAll("option").forEach((option) => {
    const disallowed = concurrency > 1 && !safe.has(option.value);
    option.disabled = disallowed;
    if (disallowed && option.selected) currentDisallowed = true;
  });
  if (currentDisallowed) {
    const firstSafe = [...videoModel.querySelectorAll("option")].find((o) => !o.disabled);
    if (firstSafe) videoModel.value = firstSafe.value;
    toast("\u0e04\u0e2d\u0e19\u0e40\u0e04\u0e2d\u0e23\u0e4c\u0e40\u0e23\u0e19\u0e0b\u0e35\u0e48 > 1 \u0e43\u0e0a\u0e49\u0e44\u0e14\u0e49\u0e40\u0e09\u0e1e\u0e32\u0e30\u0e42\u0e21\u0e40\u0e14\u0e25 R2V \u2014 \u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e42\u0e21\u0e40\u0e14\u0e25\u0e43\u0e2b\u0e49\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34");
  }
  const note = document.getElementById("fsConcurrencyNote");
  if (note) note.textContent = concurrency > 1 ? "\u0e23\u0e31\u0e19\u0e2b\u0e25\u0e32\u0e22\u0e07\u0e32\u0e19\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e01\u0e31\u0e19 \u2014 \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e44\u0e14\u0e49\u0e40\u0e09\u0e1e\u0e32\u0e30\u0e42\u0e21\u0e40\u0e14\u0e25 R2V" : "";
}

function getFlowSuiteDirectionValues() {
  const values = {};
  document.querySelectorAll("#fsDirectionGrid [data-direction-field]").forEach((wrap) => {
    const field = wrap.dataset.directionField;
    const select = wrap.querySelector("[data-direction-select]");
    const custom = wrap.querySelector("[data-direction-custom]");
    if (!select) return;
    values[field] = select.value === "__custom__" ? `custom:${(custom?.value || "").trim().slice(0, 300)}` : select.value;
  });
  return values;
}

function getFlowSuiteFormValues() {
  captureFlowSuiteScenePromptDrafts();
  return {
    videoModel: document.getElementById("fsVideoModel")?.value || "",
    imageModel: document.getElementById("fsImageModel")?.value || "",
    aspect: document.getElementById("fsAspect")?.value || "portrait",
    characterMode: document.getElementById("fsCharacterMode")?.value === "consistent" ? "consistent" : "random",
    sceneMode: FLOW_EXTENDED_ENABLED && document.getElementById("fsSceneMode")?.value === "continuous" ? "continuous" : "independent",
    sceneCount: Math.max(1, Math.min(
      FLOW_EXTENDED_ENABLED && document.getElementById("fsSceneMode")?.value === "continuous" ? 3 : 10,
      Number(document.getElementById("fsSceneCount")?.value) || 1,
    )),
    textMode: document.getElementById("fsTextMode")?.value || "withText",
    concurrency: Math.max(1, Math.min(150, Number(document.getElementById("fsConcurrency")?.value) || 1)),
    ...readFlowSuitePromptSets(),
    sceneVideoPrompts: flowSuiteScenePromptDrafts.slice(0, 10),
    direction: getFlowSuiteDirectionValues(),
  };
}

function ensureFlowSuiteSaveDialog() {
  let backdrop = document.getElementById("fsSaveDialogBackdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "fsSaveDialogBackdrop";
  backdrop.className = "fs-save-dialog-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="fs-save-dialog" role="dialog" aria-modal="true" aria-labelledby="fsSaveDialogTitle" aria-live="polite">
      <div class="fs-save-dialog-icon" data-save-dialog-icon aria-hidden="true"></div>
      <h2 id="fsSaveDialogTitle">กำลังบันทึกการตั้งค่า</h2>
      <p data-save-dialog-message>โปรดรอสักครู่…</p>
      <div class="fs-save-dialog-summary" data-save-dialog-summary hidden></div>
      <button type="button" class="fs-btn fs-primary" data-save-dialog-close hidden>เรียบร้อย</button>
    </section>
  `;
  backdrop.addEventListener("click", (event) => {
    if (backdrop.dataset.state === "saving") return;
    if (event.target === backdrop || event.target.closest("[data-save-dialog-close]")) backdrop.hidden = true;
  });
  const host = document.querySelector(".flow-page-prompt") || document.body;
  host.appendChild(backdrop);
  return backdrop;
}

function showFlowSuiteSaveDialog(state, message, summary = "") {
  clearTimeout(flowSuiteSaveDialogTimer);
  const backdrop = ensureFlowSuiteSaveDialog();
  backdrop.dataset.state = state;
  backdrop.hidden = false;
  const title = backdrop.querySelector("#fsSaveDialogTitle");
  const messageEl = backdrop.querySelector("[data-save-dialog-message]");
  const summaryEl = backdrop.querySelector("[data-save-dialog-summary]");
  const closeButton = backdrop.querySelector("[data-save-dialog-close]");
  if (title) title.textContent = state === "success"
    ? "บันทึกการตั้งค่าเรียบร้อย"
    : state === "error" ? "บันทึกไม่สำเร็จ" : "กำลังบันทึกการตั้งค่า";
  if (messageEl) messageEl.textContent = message;
  if (summaryEl) {
    summaryEl.textContent = summary;
    summaryEl.hidden = !summary;
  }
  if (closeButton) closeButton.hidden = state === "saving";
  // Keep the confirmation visible until the operator clicks "เรียบร้อย".
  // This also makes it obvious that the saved prompt values remain active.
}

async function saveFlowSuiteSettingsWithFeedback(button) {
  const originalText = button?.textContent || "💾 บันทึกการตั้งค่า";
  if (button) {
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
  }
  showFlowSuiteSaveDialog("saving", "กำลังตรวจสอบและบันทึกค่าลงโปรแกรม…");
  try {
    const settings = await persistFlowSuiteSettings(true);
    const modelLabel = flowSuiteVideoModelLabel(settings.videoModel);
    const modeLabel = flowSuiteSceneModeLabel(settings.sceneMode);
    showFlowSuiteSaveDialog(
      "success",
      "ค่าที่เลือกถูกบันทึกและพร้อมใช้กับงานใหม่แล้ว",
      `${modelLabel} · ${modeLabel} · ${settings.sceneCount} ฉาก`,
    );
  } catch (error) {
    showFlowSuiteSaveDialog("error", String(error?.message || error || "ไม่สามารถบันทึกการตั้งค่าได้"));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function persistFlowSuiteSettings(immediate = false) {
  clearTimeout(flowSuiteSettingsSaveTimer);
  const run = async () => {
    const response = await fetch("/api/flow/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(getFlowSuiteFormValues()),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || `บันทึกการตั้งค่าไม่สำเร็จ (HTTP ${response.status})`);
    }
    if (!result.settings) throw new Error("เซิร์ฟเวอร์ไม่ได้ส่งค่าที่บันทึกกลับมา");
    flowSuiteState.settings = result.settings;
    return result.settings;
  };
  if (immediate) return run();
  flowSuiteSettingsSaveTimer = setTimeout(() => {
    run().catch((error) => console.error("[flow-suite] auto-save failed", error));
  }, 400);
  return null;
}

function applyFlowSuiteSettingsToForm() {
  const settings = flowSuiteState.settings || {};
  const setSelect = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  };
  setSelect("fsVideoModel", settings.videoModel);
  setSelect("fsImageModel", settings.imageModel);
  setSelect("fsAspect", settings.aspect);
  setSelect("fsTextMode", settings.textMode);
  setSelect("fsCharacterMode", settings.characterMode === "consistent" ? "consistent" : "random");
  setSelect("fsSceneMode", FLOW_EXTENDED_ENABLED ? (settings.sceneMode || "independent") : "independent");
  const sceneCount = document.getElementById("fsSceneCount");
  if (sceneCount && settings.sceneCount) sceneCount.value = settings.sceneCount;
  const concurrency = document.getElementById("fsConcurrency");
  if (concurrency && settings.concurrency) concurrency.value = settings.concurrency;
  FLOW_PROMPT_SETS.forEach((set) => applyFlowSuitePromptSetToForm(set, settings[set.key]));
  flowSuiteScenePromptDrafts = normalizeFlowSuiteSceneVideoPrompts(settings.sceneVideoPrompts);

  const direction = settings.direction || {};
  document.querySelectorAll("#fsDirectionGrid [data-direction-field]").forEach((wrap) => {
    const field = wrap.dataset.directionField;
    const select = wrap.querySelector("[data-direction-select]");
    const custom = wrap.querySelector("[data-direction-custom]");
    const value = direction[field] || "";
    if (!select) return;
    if (value.startsWith("custom:")) {
      select.value = "__custom__";
      if (custom) { custom.hidden = false; custom.value = value.slice(7); }
    } else if (value) {
      select.value = value;
    }
  });
  applyFlowSuiteSceneModeRestriction();
  applyFlowSuiteConcurrencyRestriction();
}

// ---------------------------------------------------------------- Sample / preview box
function currentFlowSuiteShowcaseProducts() {
  return activeFlowPlatform === "shopee" ? (shopeeState.products || []) : (showcaseState.products || []);
}

function sampleFlowSuiteProducts(n = 3) {
  const pool = currentFlowSuiteShowcaseProducts();
  if (!pool.length) {
    flowSuiteSamplePicks = [];
    renderFlowSuiteSampleBox();
    return;
  }
  const picks = [];
  const used = new Set();
  while (picks.length < n && picks.length < pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(pool[idx]);
  }
  flowSuiteSamplePicks = picks;
  renderFlowSuiteSampleBox();
}

function refreshFlowSuiteSampleBox() {
  renderFlowSuiteSampleBox();
}

function flowSuitePreviewSceneLabel(sceneIndex, sceneMode) {
  if (sceneMode !== "continuous") return `ฉาก ${sceneIndex + 1}`;
  if (sceneIndex === 0) return "ฉาก 1 · Original";
  return sceneIndex === 1 ? "ฉาก 2 · Extended ครั้งแรก" : "ฉาก 3 · Extended ครั้งที่สอง";
}

function flowSuitePreviewVideoPrompt(prompts, values, sceneIndex, product = {}) {
  const shared = flowSuiteShared();
  return shared?.resolveSceneVideoPrompt?.({
    basePrompt: prompts.videoPrompt,
    baseInstruction: prompts.videoScenePrompt,
    sceneIndex,
    sceneCount: values.sceneCount,
    sceneMode: values.sceneMode,
    videoModel: values.videoModel,
    product,
    sceneInstruction: values.sceneVideoPrompts?.[sceneIndex] || "",
  }) || prompts.videoPrompt;
}

function renderFlowSuiteSampleBox() {
  const shared = flowSuiteShared();
  const box = document.getElementById("fsSampleBox");
  if (!shared || !box) return;
  const values = getFlowSuiteFormValues();
  flowSuiteSampleSceneIndex = Math.max(0, Math.min(values.sceneCount - 1, flowSuiteSampleSceneIndex));
  const placeholderProduct = {
    name: "-",
    brand: "-",
    category: "-",
    sellingPoints: ["-"],
    variations: ["-"],
    images: [],
  };
  const previewRows = flowSuiteSamplePicks.length
    ? flowSuiteSamplePicks.map((product, index) => ({ product, mapped: mapShowcaseProductToFlowProduct(product), index, placeholder: false }))
    : [{ product: { id: "prompt-template" }, mapped: placeholderProduct, index: 0, placeholder: true }];
  box.innerHTML = previewRows.map(({ product, mapped, index, placeholder }) => {
    const prompts = shared.buildPrompt({
      product: mapped, direction: values.direction, videoModel: values.videoModel,
      ...shared.promptSetsFrom(values), textMode: values.textMode,
      sceneIndex: flowSuiteSampleSceneIndex,
    });
    const scenePrompt = flowSuitePreviewVideoPrompt(prompts, values, flowSuiteSampleSceneIndex, mapped);
    const sceneTabs = Array.from({ length: values.sceneCount }, (_, sceneIndex) => `
      <button type="button" class="fs-scene-preview-tab${sceneIndex === flowSuiteSampleSceneIndex ? " on" : ""}"
        data-preview-scene="${sceneIndex}">${escapeHtml(flowSuitePreviewSceneLabel(sceneIndex, values.sceneMode))}</button>
    `).join("");
    const key = String(product.id || product.itemid || index);
    const cachedTest = flowSuiteTestImages[key];
    // Generating takes ~1 minute, and this box re-renders on any form change —
    // so the pending flag lives in the cache, not in the DOM, or the "กำลัง
    // สร้างรูป" note and the disabled button vanish and it looks like nothing
    // happened.
    const isPending = !!(cachedTest && cachedTest.pending && cachedTest.textMode === values.textMode && cachedTest.characterMode === values.characterMode);
    const testHtml = values.textMode === "noText"
      ? `<div class="fs-test-image-result"><img src="${escapeHtml(mapped.images[0] || "")}" alt="" /></div>`
      : isPending
        ? `<p class="fs-test-image-status">กำลังสร้างรูป… (ใช้เวลาราว 1 นาที)</p>`
        : cachedTest && cachedTest.textMode === values.textMode && cachedTest.characterMode === values.characterMode
          ? cachedTest.error
            ? `<p class="fs-test-image-status" style="color:var(--fs-err)">${escapeHtml(cachedTest.error)}</p>`
            : `<div class="fs-test-image-result"><img src="${escapeHtml(cachedTest.url)}" alt="" /></div>`
          : "";
    return `
      <div class="fs-sample-card" data-sample-key="${escapeHtml(key)}">
        <div class="fs-sample-card-head">
          ${placeholder ? "" : `<img src="${escapeHtml(mapped.images[0] || "")}" alt="" />`}
          <span>${placeholder ? "โครง Prompt · ข้อมูลสินค้าใช้ -" : escapeHtml(mapped.name || "-")}</span>
        </div>
        <div class="fs-scene-preview-tabs" role="tablist" aria-label="เลือกฉากเพื่อตรวจ Prompt">${sceneTabs}</div>
        <p class="fs-prompt-label">Video Prompt · ${escapeHtml(flowSuitePreviewSceneLabel(flowSuiteSampleSceneIndex, values.sceneMode))}</p>
        <pre class="fs-preview">${escapeHtml(scenePrompt)}</pre>
        ${prompts.imagePrompt ? `<p class="fs-prompt-label">Image Prompt</p><pre class="fs-preview">${escapeHtml(prompts.imagePrompt)}</pre>` : ""}
        ${!placeholder && values.textMode === "withText" ? `<button type="button" class="fs-btn fs-ghost fs-test-image-btn" data-test-image="${escapeHtml(key)}"${isPending ? " disabled" : ""}>\ud83e\uddea ${isPending ? "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e23\u0e39\u0e1b\u2026" : "\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e23\u0e39\u0e1b"}</button>` : ""}
        <div class="fs-test-image-status" data-test-status="${escapeHtml(key)}"></div>
        ${testHtml}
      </div>
    `;
  }).join("");

  box.querySelectorAll("[data-preview-scene]").forEach((button) => {
    button.addEventListener("click", () => {
      flowSuiteSampleSceneIndex = Number(button.dataset.previewScene) || 0;
      renderFlowSuiteSampleBox();
    });
  });

  box.querySelectorAll("[data-test-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = button.dataset.testImage;
      const index = flowSuiteSamplePicks.findIndex((p, i) => String(p.id || p.itemid || i) === key);
      if (index < 0) return;
      const product = mapShowcaseProductToFlowProduct(flowSuiteSamplePicks[index]);
      const values = getFlowSuiteFormValues();
      // Mark pending in the cache first so the state survives the re-render
      // that any form change triggers while the request is still running.
      flowSuiteSetTestImage(key, { pending: true, textMode: values.textMode, characterMode: values.characterMode });
      renderFlowSuiteSampleBox();
      try {
        const response = await fetch("/api/flow/test-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            product, direction: values.direction, characterMode: values.characterMode, imageModel: values.imageModel,
            aspect: values.aspect, ...shared.promptSetsFrom(values), platform: activeFlowPlatform,
          }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e23\u0e39\u0e1b\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08");
        flowSuiteSetTestImage(key, { url: payload.url, textMode: values.textMode, characterMode: values.characterMode });
      } catch (error) {
        flowSuiteSetTestImage(key, { error: String(error.message || error), textMode: values.textMode, characterMode: values.characterMode });
      } finally {
        // `button` belongs to the pre-render DOM and is already detached here;
        // the re-render draws a fresh, enabled one from the cache above.
        renderFlowSuiteSampleBox();
      }
    });
  });
}

// ---------------------------------------------------------------- Queue page
// Queue order = submission order, first in at the top. The store keeps the
// newest job at index 0 (unshift), while the runner claims from the END of that
// array (oldest first), so rendering the store order as-is made the queue look
// like it was being worked from the bottom up. Reverse it here once so the
// running job sits at the top and the next ones follow downward, page 1 = the
// first 100 submitted, page 2 the next 100, and so on.
function flowSuiteJobsForPlatform() {
  return flowSuiteState.jobs
    .filter((job) => job.platform === activeFlowPlatform)
    .reverse();
}

const FLOW_SUITE_STATUS_LABEL = { queued: "\u0e23\u0e2d\u0e04\u0e34\u0e27", running: "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e17\u0e33", done: "\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08", failed: "\u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27", cancelled: "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01" };

function flowSuiteFormatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "\u2014";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function flowSuiteDirectionSummary(direction = {}) {
  const shared = flowSuiteShared();
  if (!shared) return "";
  const parts = [];
  for (const [field] of shared.DIRECTION_FIELDS) {
    const value = direction[field];
    if (!value) continue;
    const text = shared.isCustomValue(value) ? shared.customValueText(value) : shared.styleLabel(field, value);
    if (text) parts.push(text);
  }
  return parts.join(" \u00b7 ");
}

function flowSuiteVideoModelLabel(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return "ไม่ระบุโมเดล";
  if (id === "veo_3_1_extension_lite") return "Veo 3.1 Extended 8s";
  const models = Array.isArray(flowSuiteState.catalog?.videoModels)
    ? flowSuiteState.catalog.videoModels
    : [];
  return models.find((model) => model.id === id)?.label || id;
}

function flowSuiteSceneModeLabel(mode) {
  return mode === "continuous" ? "ต่อเนื่อง (Extended)" : "ไม่ต่อเนื่อง";
}

// In-page video popup (BlueSPite's own design — see flow-suite.css's
// .fs-video-backdrop/.fs-video-modal) instead of a target="_blank" link.
// ai_studio's flow pages usually render inside an <iframe> (the main
// TikTok Manager Pro app's #aiStudioFrame) — target="_blank" from inside an
// iframe can open a background/off-screen tab a user never notices, which is
// exactly what "กดดูวิดีโอไม่ได้" turned out to be. A same-page modal has no
// such failure mode.
function ensureFlowSuiteVideoModal() {
  let backdrop = document.getElementById("fsVideoBackdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "fsVideoBackdrop";
  backdrop.className = "fs-video-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="fs-video-modal" role="dialog" aria-modal="true" aria-label="วิดีโอ">
      <button type="button" class="fs-video-close" data-fs-video-close aria-label="ปิด">✕</button>
      <div class="fs-video-stage">
        <video id="fsVideoModalPlayer" controls playsinline></video>
      </div>
    </div>
  `;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-fs-video-close]")) closeFlowSuiteVideoModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) closeFlowSuiteVideoModal();
  });
  // The Flow preview styles are deliberately scoped to the active Flow page.
  // Mount the modal inside that page (instead of document.body), otherwise the
  // backdrop opens without any of its fixed-position/modal styling.
  const host = document.querySelector(".flow-page-history")
    || document.querySelector(".flow-page-queue")
    || document.body;
  host.appendChild(backdrop);
  return backdrop;
}

function openFlowSuiteVideoModal(url) {
  if (!url) return;
  const backdrop = ensureFlowSuiteVideoModal();
  const player = backdrop.querySelector("#fsVideoModalPlayer");
  if (player) player.src = url;
  backdrop.hidden = false;
  player?.play?.().catch(() => {});
}

function closeFlowSuiteVideoModal() {
  const backdrop = document.getElementById("fsVideoBackdrop");
  if (!backdrop) return;
  const player = backdrop.querySelector("#fsVideoModalPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  backdrop.hidden = true;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-video]");
  if (!button) return;
  event.preventDefault();
  openFlowSuiteVideoModal(button.dataset.viewVideo);
});

document.addEventListener("error", (event) => {
  const image = event.target?.closest?.("img[data-flow-product-thumb]");
  if (!image) return;
  image.hidden = true;
  if (image.nextElementSibling?.classList.contains("fs-job-thumb-placeholder")) {
    image.nextElementSibling.hidden = false;
  }
}, true);

function renderFlowSuiteJobRow(job, { showActions = true } = {}) {
  const status = job.status || "queued";
  const linkedJob = job.jobId
    ? flowSuiteState.jobs.find((queueJob) => queueJob.id === job.jobId)
    : null;
  const thumb = job.thumb || job.product?.images?.find(Boolean) || job.productImage ||
    linkedJob?.product?.images?.find(Boolean) || linkedJob?.productImage || "";
  const sceneMode = FLOW_EXTENDED_ENABLED && job.sceneMode === "continuous" ? "continuous" : "independent";
  const originalModelLabel = flowSuiteVideoModelLabel(job.videoModel);
  // Continuous jobs always call Flow's dedicated fZytfe Extended model. Ignore
  // stale model metadata left on jobs that failed before the mapping was fixed.
  const extendedModelLabel = flowSuiteVideoModelLabel("veo_3_1_extension_lite");
  const videoModelLabel = sceneMode === "continuous"
    ? `${originalModelLabel} (Original) + ${extendedModelLabel} (Extended)`
    : originalModelLabel;
  const duration = job.startedAt
    ? flowSuiteFormatDuration((job.finishedAt || Date.now()) - job.startedAt)
    : "\u2014";
  const actions = [];
  if (showActions) {
    if (status === "running") actions.push(`<button type="button" class="fs-btn fs-ghost" data-job-cancel="${escapeHtml(job.id)}">\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01</button>`);
    if (status === "failed") actions.push(`<button type="button" class="fs-btn fs-ghost" data-job-retry="${escapeHtml(job.id)}">\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48</button>`);
    if (job.finalVideoUrl || job.videoUrl) actions.push(`<button type="button" class="fs-btn fs-ghost" data-view-video="${escapeHtml(job.finalVideoUrl || job.videoUrl)}">\u25b6 \u0e14\u0e39\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d</button>`);
  }
  return `
    <div class="fs-job" data-job-id="${escapeHtml(job.id)}">
      ${thumb
        ? `<img src="${escapeHtml(thumb)}" alt="" data-flow-product-thumb /><span class="fs-job-thumb-placeholder" hidden></span>`
        : `<span class="fs-job-thumb-placeholder"></span>`}
      <div>
        <h3>${job.orderNumber ? `<span class="fs-order-tag">${escapeHtml(job.orderNumber)}</span>` : ""}${escapeHtml(job.title || "-")}</h3>
        <div class="fs-meta">
          <span class="fs-text-mode-tag ${job.textMode === "noText" ? "fs-noText" : "fs-withText"}">${job.textMode === "noText" ? "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21" : "\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21"}</span>
          <span><b>โมเดล:</b> ${escapeHtml(videoModelLabel)}</span>
          ${flowGoogleAccountEmail ? `<span><b>บัญชี Flow:</b> ${escapeHtml(flowGoogleAccountEmail)}</span>` : ""}
          <span><b>เพิ่มฉาก:</b> ${escapeHtml(flowSuiteSceneModeLabel(sceneMode))}</span>
          <span>${escapeHtml(job.sceneCount || 1)} \u0e09\u0e32\u0e01</span>
          <span>${escapeHtml(flowSuiteDirectionSummary(job.direction))}</span>
        </div>
        ${job.error ? `<div class="fs-job-err">${escapeHtml(job.error)}</div>` : ""}
      </div>
      <div class="fs-status-col">
        <span class="fs-status fs-${status}">${escapeHtml(FLOW_SUITE_STATUS_LABEL[status] || status)}</span>
        ${job.startedAt ? `<span class="fs-job-timer" data-job-timer="${escapeHtml(job.id)}" data-started="${job.startedAt}" data-finished="${job.finishedAt || ""}">${duration}</span>` : ""}
      </div>
      <div class="fs-row">${actions.join("")}</div>
    </div>
  `;
}

function renderFlowSuiteQueue() {
  const list = document.getElementById("fsJobList");
  const counts = document.getElementById("fsQueueCounts");
  if (!list) return;
  const platformJobs = flowSuiteJobsForPlatform();
  const doneCount = platformJobs.filter((job) => job.status === "done").length;
  const jobs = platformJobs.filter((job) => job.status !== "done");
  const byStatus = { queued: 0, running: 0, failed: 0, cancelled: 0 };
  for (const job of jobs) if (byStatus[job.status] !== undefined) byStatus[job.status] += 1;

  const shown = Math.min(jobs.length, FLOW_SUITE_MAX_QUEUE);
  const totalPages = Math.max(1, Math.ceil(shown / FLOW_SUITE_PAGE_SIZE));
  // The list shrinks under you (jobs finish, "เคลียร์คิว" empties it), so a page
  // number held over from an earlier render can fall off the end.
  flowSuiteQueuePage = Math.min(Math.max(1, flowSuiteQueuePage), totalPages);
  const pageStart = (flowSuiteQueuePage - 1) * FLOW_SUITE_PAGE_SIZE;
  const pageJobs = jobs.slice(pageStart, pageStart + FLOW_SUITE_PAGE_SIZE);
  const pageLabel = totalPages > 1 ? ` · หน้า ${flowSuiteQueuePage}/${totalPages}` : "";

  if (counts) counts.textContent = `\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14 ${jobs.length} \u00b7 \u0e23\u0e2d\u0e04\u0e34\u0e27 ${byStatus.queued} \u00b7 \u0e01\u0e33\u0e25\u0e31\u0e07\u0e17\u0e33 ${byStatus.running} \u00b7 \u0e25\u0e49\u0e21\u0e40\u0e2b\u0e25\u0e27 ${byStatus.failed}${pageLabel}`;
  list.innerHTML = jobs.length
    ? pageJobs.map((job) => renderFlowSuiteJobRow(job)).join("")
    : `<div class="fs-empty">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e07\u0e32\u0e19\u0e43\u0e19\u0e04\u0e34\u0e27 \u2014 \u0e44\u0e1b\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e08\u0e32\u0e01 Showcase \u0e41\u0e25\u0e49\u0e27\u0e01\u0e14 "\u0e2a\u0e48\u0e07\u0e44\u0e1b\u0e04\u0e34\u0e27"</div>`;

  const draining = !!flowSuiteState.runner?.draining;
  const stopping = !!flowSuiteState.runner?.stopRequested;
  const activeCount = Math.max(
    byStatus.running,
    Array.isArray(flowSuiteState.runner?.currentJobIds) ? flowSuiteState.runner.currentJobIds.length : 0,
  );
  const runnerHasWork = activeCount > 0 || byStatus.queued > 0;
  const canRun = byStatus.queued > 0 || byStatus.failed > 0;
  const runBtn = document.getElementById("fsRunQueue");
  const stopBtn = document.getElementById("fsStopQueue");
  if (runBtn) {
    runBtn.disabled = !canRun || stopping || (draining && runnerHasWork);
    runBtn.textContent = byStatus.failed > 0 && byStatus.queued === 0 && activeCount === 0
      ? "▶ เริ่มงานที่ล้มเหลวอีกครั้ง"
      : "▶ รันคิว";
  }
  if (stopBtn) {
    stopBtn.disabled = stopping || !draining || !runnerHasWork;
    stopBtn.textContent = stopping ? "■ กำลังหยุด…" : "■ หยุดคิว";
  }
  const clearDoneBtn = document.getElementById("fsClearJobs");
  const clearFailedBtn = document.getElementById("fsClearFailed");
  const clearCancelledBtn = document.getElementById("fsClearCancelled");
  const retryAllBtn = document.getElementById("fsRetryAllFailed");
  const clearQueuedBtn = document.getElementById("fsClearQueued");
  if (clearDoneBtn) clearDoneBtn.hidden = doneCount === 0;
  if (clearFailedBtn) clearFailedBtn.hidden = byStatus.failed === 0;
  if (clearCancelledBtn) clearCancelledBtn.hidden = byStatus.cancelled === 0;
  if (retryAllBtn) retryAllBtn.hidden = byStatus.failed === 0;
  if (clearQueuedBtn) clearQueuedBtn.hidden = byStatus.queued === 0;

  renderFlowSuiteQueuePager(totalPages, jobs.length);

  list.querySelectorAll("[data-job-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      fetch("/api/flow/jobs/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: button.dataset.jobCancel }) }).catch(() => {});
    });
  });
  list.querySelectorAll("[data-job-retry]").forEach((button) => {
    button.addEventListener("click", () => {
      flowSuiteQueueCommand("/api/flow/jobs/retry", { id: button.dataset.jobRetry }, button);
    });
  });
}

/** Page numbers for the queue. At the 3000-job maximum that is 30 pages, and a
 *  full row of 30 numbers is unreadable — so this shows the first page, the last
 *  page and a window around the current one, with "…" standing in for the gaps. */
function renderFlowSuiteQueuePager(totalPages, totalJobs) {
  const pager = document.getElementById("fsQueuePager");
  if (!pager) return;
  if (totalPages <= 1) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }
  pager.hidden = false;

  const current = flowSuiteQueuePage;
  const wanted = new Set([1, totalPages]);
  for (let p = current - FLOW_SUITE_PAGER_WINDOW; p <= current + FLOW_SUITE_PAGER_WINDOW; p += 1) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }

  const parts = [`<button class="fs-btn fs-page-nav" type="button" data-page="${current - 1}"${current === 1 ? " disabled" : ""}>‹</button>`];
  let previous = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    if (previous && p - previous > 1) parts.push(`<span class="fs-page-gap">…</span>`);
    parts.push(`<button class="fs-btn fs-page${p === current ? " fs-page-on" : ""}" type="button" data-page="${p}">${p}</button>`);
    previous = p;
  }
  parts.push(`<button class="fs-btn fs-page-nav" type="button" data-page="${current + 1}"${current === totalPages ? " disabled" : ""}>›</button>`);
  if (totalJobs > FLOW_SUITE_MAX_QUEUE) {
    parts.push(`<span class="fs-page-note">แสดงได้สูงสุด ${FLOW_SUITE_MAX_QUEUE} งาน (มี ${totalJobs} งาน)</span>`);
  }
  pager.innerHTML = parts.join("");

  pager.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      if (!Number.isFinite(next) || next === flowSuiteQueuePage) return;
      flowSuiteQueuePage = next;
      renderFlowSuiteQueue();
      document.getElementById("fsJobList")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

function flowSuiteEnsureJobTimer() {
  if (flowSuiteJobTimerInterval) return;
  flowSuiteJobTimerInterval = window.setInterval(() => {
    document.querySelectorAll("[data-job-timer]").forEach((el) => {
      if (el.dataset.finished) return;
      const started = Number(el.dataset.started) || 0;
      if (!started) return;
      el.textContent = flowSuiteFormatDuration(Date.now() - started);
    });
  }, 1000);
}

async function flowSuiteQueueCommand(path, body = null, button = null) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "คำสั่งคิวไม่สำเร็จ");
    return payload;
  } catch (error) {
    toast(`คำสั่งคิวไม่สำเร็จ: ${error.message || error}`);
    return null;
  } finally {
    window.setTimeout(renderFlowSuiteQueue, 150);
  }
}

function wireFlowSuiteQueueEvents() {
  document.getElementById("fsRunQueue")?.addEventListener("click", (event) => {
    flowSuiteQueueCommand("/api/flow/queue/run", null, event.currentTarget);
  });
  document.getElementById("fsStopQueue")?.addEventListener("click", (event) => {
    flowSuiteQueueCommand("/api/flow/queue/stop", null, event.currentTarget);
  });
  document.getElementById("fsClearJobs")?.addEventListener("click", () => {
    const ids = flowSuiteJobsForPlatform().filter((j) => j.status === "done").map((j) => j.id);
    if (!ids.length) return;
    fetch("/api/flow/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  });
  // Drops only the jobs still WAITING. A job already running is not touched —
  // "หยุด" cancels that one — and finished jobs stay for "ล้างงานที่จบแล้ว".
  document.getElementById("fsClearQueued")?.addEventListener("click", () => {
    const ids = flowSuiteJobsForPlatform().filter((j) => j.status === "queued").map((j) => j.id);
    if (!ids.length) return;
    fetch("/api/flow/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  });
  document.getElementById("fsClearFailed")?.addEventListener("click", () => {
    const ids = flowSuiteJobsForPlatform().filter((j) => j.status === "failed").map((j) => j.id);
    if (!ids.length) return;
    fetch("/api/flow/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  });
  document.getElementById("fsClearCancelled")?.addEventListener("click", () => {
    const ids = flowSuiteJobsForPlatform().filter((j) => j.status === "cancelled").map((j) => j.id);
    if (!ids.length) return;
    fetch("/api/flow/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  });
  document.getElementById("fsRetryAllFailed")?.addEventListener("click", (event) => {
    flowSuiteQueueCommand("/api/flow/jobs/retry", {}, event.currentTarget);
  });

  const autoPlay = document.getElementById("fsAutoPlay");
  if (autoPlay) {
    autoPlay.checked = localStorage.getItem("flowSuiteAutoPlay") === "1";
    autoPlay.addEventListener("change", () => {
      localStorage.setItem("flowSuiteAutoPlay", autoPlay.checked ? "1" : "0");
      // Switching it on is itself a "go" when work is already waiting — the
      // toggle is not only a rule for FUTURE submits. Switching it off never
      // stops a run that is already going; "หยุด" does that.
      if (autoPlay.checked) maybeAutoRunFlowSuiteQueue({ requireQueued: true });
    });
  }
}

// "เริ่มคิวอัตโนมัติเมื่อส่งงานเข้าคิว" — a client-only preference (localStorage,
// not a server setting, matching BlueSPite's own web/app.js maybeAutoRunQueue()).
// Called after a successful queueProductsForFlow() submit.
function maybeAutoRunFlowSuiteQueue({ requireQueued = false } = {}) {
  if (localStorage.getItem("flowSuiteAutoPlay") !== "1") return;
  if (flowSuiteState.runner?.draining) return;
  // Submitting is its own proof that there is work — the new job may not have
  // reached this tab's state yet, so the submit path must not wait for it.
  // Flipping the toggle proves nothing, so that path only fires when something
  // is genuinely queued; otherwise the queue spins up and idles out for nothing.
  // Checked across every platform, because the runner drains the whole queue
  // rather than only the tab you happen to be looking at.
  if (requireQueued && !flowSuiteState.jobs.some((job) => job.status === "queued")) return;
  fetch("/api/flow/queue/run", { method: "POST" }).catch(() => {});
}

// ---------------------------------------------------------------- History page
function renderFlowSuiteHistory() {
  const list = document.getElementById("fsHistoryList");
  if (!list) return;
  const showcaseProducts = currentFlowSuiteShowcaseProducts();
  const showcaseById = new Map(showcaseProducts.map((product) => [String(product.id || product.productid || ""), product]));
  const showcaseByTitle = new Map(showcaseProducts.map((product) => [String(product.title || "").trim(), product]));
  const rows = flowSuiteState.history
    .filter((row) => row.platform === activeFlowPlatform)
    .filter((row) => flowSuiteHistoryFilter === "all" || row.status === flowSuiteHistoryFilter)
    .map((row) => {
      if (row.thumb || row.productImage || row.product?.images?.some(Boolean)) return row;
      const product = showcaseById.get(String(row.productId || "")) || showcaseByTitle.get(String(row.title || "").trim());
      return product ? { ...row, productImage: product.image || product.images?.find(Boolean) || "" } : row;
    });

  list.innerHTML = rows.length
    ? rows.map((row) => renderFlowSuiteJobRow(row, { showActions: true })).join("")
    : `<div class="fs-empty">\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34</div>`;

  document.querySelectorAll("#fsHistoryFilter [data-filter]").forEach((button) => {
    button.classList.toggle("fs-on", button.dataset.filter === flowSuiteHistoryFilter);
  });
}

function wireFlowSuiteHistoryEvents() {
  document.getElementById("fsHistoryFilter")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    flowSuiteHistoryFilter = button.dataset.filter;
    renderFlowSuiteHistory();
  });
  document.getElementById("fsHistoryClearBar")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear]");
    if (!button) return;
    fetch("/api/flow/history", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: button.dataset.clear }) }).catch(() => {});
  });
}

connectFlowSuiteEvents();
wireFlowSuiteQueueEvents();
wireFlowSuiteHistoryEvents();

function toggleCardSelectionFromClick(card, event) {
  if (event.target.closest("button, input, textarea, select, label")) return;
  if (event.target.closest("a")) {
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
  }
  const checkbox = card.querySelector(".showcase-checkbox");
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

// Apply search filter to showcase products
function applyShowcaseSearch() {
  const query = (productSearch?.value || "").trim().toLowerCase();
  showcaseState.filtered = query
    ? showcaseState.products.filter((product) => [
        product.id,
        product.title,
        product.price,
        product.stock,
        product.shop,
      ].some((value) => String(value || "").toLowerCase().includes(query)))
    : [...showcaseState.products];
  renderShowcaseProducts(showcaseState.filtered);
}

async function loadShowcaseProducts() {
  if (!loadShowcaseBtn) return;
  loadShowcaseBtn.disabled = true;
  setShowcaseStatus("กำลังดึงข้อมูล Showcase...");
  try {
    const response = await fetch("/api/tiktok/showcase/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: normalizePostAccount(showcaseSelectedAccount) }),
      cache: "no-store",
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Pull failed");

    const products = (payload.products || []).map(normalizeShowcaseProduct);
    showcaseState.products = products;
    showcaseState.filtered = [...products];
    if (rawJson) rawJson.textContent = JSON.stringify(payload, null, 2);
    if (productSearch) productSearch.value = "";
    renderShowcaseProducts(showcaseState.filtered);
    setShowcaseStatus(`ดึงสำเร็จ ทั้งหมด ${payload.total ?? products.length} รายการ ใช้ได้ ${payload.available ?? products.length} รายการ`);
  } catch (error) {
    setShowcaseStatus(`ดึงไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    loadShowcaseBtn.disabled = false;
  }
}

async function checkTikTokLinks() {
  if (!checkLinksBtn) return;
  const urls = parseTikTokProductUrls(tiktokLinkUrls?.value || "");
  if (!urls.length) {
    setShowcaseStatus("กรุณาใส่ลิงก์สินค้าอย่างน้อย 1 ลิงก์", true);
    return;
  }

  checkLinksBtn.disabled = true;
  setShowcaseStatus(`กำลังเช็ก ${urls.length} ลิงก์...`);
  try {
    const response = await fetch("/api/tiktok/links/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls, account: normalizePostAccount(showcaseSelectedAccount) }),
      cache: "no-store",
    });
    const payload = await readJsonResponse(response);
    if (rawJson) rawJson.textContent = JSON.stringify(payload, null, 2);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Check failed");

    const products = normalizeCheckedLinkProducts(payload.data);
    showcaseState.products = products;
    showcaseState.filtered = [...products];
    if (rawJson) rawJson.textContent = JSON.stringify(payload.data, null, 2);
    if (productSearch) productSearch.value = "";
    renderShowcaseProducts(showcaseState.filtered);
    setShowcaseStatus(`เช็กสำเร็จ พบ ${products.length} รายการ`);
  } catch (error) {
    setShowcaseStatus(`เช็กไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    checkLinksBtn.disabled = false;
  }
}

// Clear showcase products from the UI and reset state
function clearShowcaseProducts() {
  showcaseState.products = [];
  showcaseState.filtered = [];
  renderShowcaseProducts([]);
  if (rawJson) rawJson.textContent = "";
  if (productSearch) productSearch.value = "";
  if (tiktokLinkUrls) tiktokLinkUrls.value = "";
  setShowcaseStatus("");
  updateShowcaseControls();
}


// Toggle selection of all showcase products
function toggleSelectAllShowcase() {
  if (!showcaseResults) return;
  const boxes = [...showcaseResults.querySelectorAll(".showcase-checkbox")];
  const shouldSelect = boxes.some((box) => !box.checked);
  boxes.forEach((box) => {
    box.checked = shouldSelect;
    box.closest(".showcase-card")?.classList.toggle("selected", shouldSelect);
  });
  updateShowcaseControls();
}

async function copySelectedShowcaseLinks() {
  const links = selectedProductIds().map((id) => `https://www.tiktok.com/view/product/${id}`);
  if (!links.length) {
    setShowcaseStatus("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ", true);
    return;
  }
  await navigator.clipboard.writeText(links.join("\n"));
  setShowcaseStatus(`คัดลอกแล้ว ${links.length} ลิงก์`);
}

async function addSelectedProductsToShowcase() {
  const productIds = selectedProductIds();
  if (!productIds.length) {
    setShowcaseStatus("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ", true);
    return;
  }

  if (addShowcaseSelectedBtn) addShowcaseSelectedBtn.disabled = true;
  setShowcaseStatus(`กำลังเพิ่มสินค้า ${productIds.length} รายการไปยังโชว์เคส...`);
  try {
    const response = await fetch("/api/tiktok/showcase/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productIds, account: normalizePostAccount(showcaseSelectedAccount) }),
      cache: "no-store",
    });
    const payload = await readJsonResponse(response);
    if (rawJson) rawJson.textContent = JSON.stringify(payload, null, 2);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Add showcase failed");
    setShowcaseStatus(`เพิ่มไปยังโชว์เคสสำเร็จ ${payload.total ?? productIds.length} รายการ`);
  } catch (error) {
    setShowcaseStatus(`เพิ่มไปยังโชว์เคสไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    updateShowcaseControls();
  }
}

function queueSelectedShowcaseProducts() {
  const ids = new Set(selectedProductIds());
  const products = showcaseState.products.filter((product) => ids.has(product.id));
  queueProductsForFlow(products, "TikTok", setShowcaseStatus);
}

function ensureShowcaseDeleteModal() {
  let modal = document.getElementById("showcaseDeleteModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "showcaseDeleteModal";
  modal.className = "post-account-delete-modal showcase-delete-modal";
  modal.innerHTML = `
    <div class="post-account-delete-backdrop" data-showcase-delete-cancel></div>
    <section class="post-account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="showcaseDeleteTitle">
      <button class="flow-prompt-close" type="button" data-showcase-delete-cancel aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
      <p class="eyebrow">Delete Showcase</p>
      <h3 id="showcaseDeleteTitle">ยืนยันลบสินค้าออกจาก Showcase?</h3>
      <p class="post-account-delete-note">ระบบจะลบสินค้าที่เลือกออกจาก Showcase จริงบน TikTok และโหลดรายการใหม่หลังลบสำเร็จ</p>
      <div class="post-account-delete-preview" data-showcase-delete-preview></div>
      <div class="post-account-delete-actions">
        <button class="outline-btn" type="button" data-showcase-delete-cancel>ยกเลิก</button>
        <button class="danger-btn" type="button" data-showcase-delete-confirm>
          <span class="material-symbols-outlined">delete</span>
          ยืนยันลบ
        </button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  return modal;
}

function closeShowcaseDeleteModal() {
  const modal = document.getElementById("showcaseDeleteModal");
  if (!modal) return;
  modal.classList.remove("is-open");
}

function confirmShowcaseDelete(products = []) {
  const items = Array.isArray(products) ? products : [];
  const modal = ensureShowcaseDeleteModal();
  const preview = modal.querySelector("[data-showcase-delete-preview]");
  const cancelButtons = modal.querySelectorAll("[data-showcase-delete-cancel]");
  const confirmButton = modal.querySelector("[data-showcase-delete-confirm]");
  const sample = items.slice(0, 3).map((product) => product.title || product.id).filter(Boolean);
  if (preview) {
    preview.innerHTML = `
      <span class="material-symbols-outlined post-account-avatar-fallback">inventory_2</span>
      <div>
        <strong>${escapeHtml(items.length)} รายการจะถูกลบจาก Showcase</strong>
        <span>${escapeHtml(sample.join(" • ") || "สินค้าที่เลือก")}${items.length > sample.length ? escapeHtml(` และอีก ${items.length - sample.length} รายการ`) : ""}</span>
      </div>
    `;
  }

  return new Promise((resolve) => {
    const finish = (ok) => {
      cancelButtons.forEach((button) => { button.onclick = null; });
      if (confirmButton) confirmButton.onclick = null;
      closeShowcaseDeleteModal();
      resolve(ok);
    };
    cancelButtons.forEach((button) => {
      button.onclick = () => finish(false);
    });
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.innerHTML = `<span class="material-symbols-outlined">delete</span> ยืนยันลบ`;
      confirmButton.onclick = () => finish(true);
    }
    modal.classList.add("is-open");
  });
}

async function deleteSelectedShowcaseItems() {
  const productIds = selectedProductIds();
  if (!productIds.length) {
    setShowcaseStatus("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ", true);
    return;
  }
  if (!showcaseSelectedAccount) {
    setShowcaseStatus("กรุณาเลือกบัญชี TikTok ที่จะใช้ลบสินค้า Showcase ก่อน", true);
    return;
  }
  const selected = showcaseState.products.filter((product) => productIds.includes(product.id));
  const ok = await confirmShowcaseDelete(selected.length ? selected : productIds.map((id) => ({ id, title: id })));
  if (!ok) return;

  if (deleteSelectedBtn) deleteSelectedBtn.disabled = true;
  setShowcaseStatus(`กำลังลบสินค้า ${productIds.length} รายการออกจาก Showcase...`);
  try {
    const response = await fetch("/api/tiktok/showcase/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productIds,
        account: normalizePostAccount(showcaseSelectedAccount),
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Delete showcase failed");
    setShowcaseStatus(`ลบออกจาก Showcase สำเร็จ ${payload.total ?? productIds.length} รายการ กำลังโหลดรายการใหม่...`);
    await loadShowcaseProducts();
  } catch (error) {
    setShowcaseStatus(`ลบออกจาก Showcase ไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = false;
    updateShowcaseControls();
  }
}

loadShowcaseBtn?.addEventListener("click", loadShowcaseProducts);
checkLinksBtn?.addEventListener("click", checkTikTokLinks);
clearShowcaseBtn?.addEventListener("click", clearShowcaseProducts);
toggleSelectBtn?.addEventListener("click", toggleSelectAllShowcase);
copySelectedBtn?.addEventListener("click", copySelectedShowcaseLinks);
addShowcaseSelectedBtn?.addEventListener("click", addSelectedProductsToShowcase);
queueSelectedBtn?.addEventListener("click", queueSelectedShowcaseProducts);
deleteSelectedBtn?.addEventListener("click", deleteSelectedShowcaseItems);
productSearch?.addEventListener("input", applyShowcaseSearch);
updateShowcaseControls();
renderShowcaseProducts([]);

const shopeeState = {
  products: [],
  filtered: [],
};

const shopeeLinkUrls = document.getElementById("shopeeLinkUrls");
const checkShopeeLinksBtn = document.getElementById("checkShopeeLinksBtn");
const clearShopeeBtn = document.getElementById("clearShopeeBtn");
const shopeeToggleSelectBtn = document.getElementById("shopeeToggleSelectBtn");
const shopeeCopySelectedBtn = document.getElementById("shopeeCopySelectedBtn");
const shopeeQueueSelectedBtn = document.getElementById("shopeeQueueSelectedBtn");
const shopeeDeleteSelectedBtn = document.getElementById("shopeeDeleteSelectedBtn");
const shopeeStatus = document.getElementById("shopeeStatus");
const shopeeResults = document.getElementById("shopeeResults");
const shopeeResultsSection = document.getElementById("shopeeResultsSection");
const shopeeTotal = document.getElementById("shopeeTotal");
const shopeeVisibleCount = document.getElementById("shopeeVisibleCount");
const shopeeSelectedCount = document.getElementById("shopeeSelectedCount");
const shopeeRawJson = document.getElementById("shopeeRawJson");
const shopeeProductSearch = document.getElementById("shopeeProductSearch");

function setShopeeStatus(message, isError = false) {
  if (!shopeeStatus) return;
  shopeeStatus.textContent = message || "";
  shopeeStatus.classList.toggle("is-error", !!isError);
}

function setShopeeCaptchaStatus(message, url) {
  if (!shopeeStatus) return;
  shopeeStatus.textContent = "";
  shopeeStatus.classList.add("is-error");
  const span = document.createElement("span");
  span.textContent = message;
  shopeeStatus.appendChild(span);
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = " เปิดหน้า captcha";
    link.style.marginLeft = "8px";
    shopeeStatus.appendChild(link);
  }
}

function parseShopeeProductUrls(text) {
  const parts = String(text || "")
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const urls = [];
  const seen = new Set();

  for (const part of parts) {
    const url = /^https?:\/\//i.test(part) ? part : part.includes("shopee.") ? `https://${part}` : part;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

function shopeeProductUrl(product) {
  if (product.productUrl) return product.productUrl;
  if (product.url && /^https?:\/\//i.test(product.url)) return product.url;
  if (product.shopid && product.itemid) return `https://shopee.co.th/product/${product.shopid}/${product.itemid}`;
  if (product.sourceUrl && /^https?:\/\//i.test(product.sourceUrl)) return product.sourceUrl;
  return "https://shopee.co.th/";
}

function normalizeShopeeProducts(payload) {
  const rows = Array.isArray(payload?.products) ? payload.products : [];
  return rows.map((product) => ({
    id: String(product.id || product.itemid || product.item_id || ""),
    itemid: String(product.itemid || product.item_id || product.id || ""),
    shopid: String(product.shopid || product.shop_id || ""),
    title: product.title || product.name || "-",
    image: product.image || "",
    price: product.priceText || product.price || "-",
    commission: product.commissionText || product.commission || "-",
    commissionRate: product.commissionRate ?? product.seller_commission_rate ?? "-",
    stock: product.stock ?? "-",
    shop: product.shop || product.shop_name || "-",
    canAdd: product.canAdd !== false,
    sourceUrl: product.sourceUrl || "",
    productUrl: product.productUrl || "",
  })).filter((product) => product.id);
}

function selectedShopeeIds() {
  if (!shopeeResults) return [];
  return [...shopeeResults.querySelectorAll(".showcase-checkbox:checked")]
    .map((box) => box.value)
    .filter(Boolean);
}

function updateShopeeControls() {
  const total = shopeeState.products.length;
  const selected = selectedShopeeIds().length;
  const hasProducts = total > 0;

  if (shopeeTotal) shopeeTotal.textContent = String(total);
  if (shopeeVisibleCount) shopeeVisibleCount.textContent = `${shopeeState.filtered.length} items`;
  if (shopeeSelectedCount) shopeeSelectedCount.textContent = `${selected} selected`;
  if (shopeeProductSearch) shopeeProductSearch.disabled = !hasProducts;

  [shopeeToggleSelectBtn, shopeeCopySelectedBtn, shopeeQueueSelectedBtn, shopeeDeleteSelectedBtn].forEach((button) => {
    if (button) button.disabled = !hasProducts;
  });

  if (shopeeToggleSelectBtn && shopeeResults) {
    const visibleBoxes = [...shopeeResults.querySelectorAll(".showcase-checkbox")];
    const allVisibleSelected = visibleBoxes.length > 0 && visibleBoxes.every((box) => box.checked);
    shopeeToggleSelectBtn.lastChild.textContent = allVisibleSelected ? " ยกเลิกเลือกทั้งหมด" : " เลือกทั้งหมด";
  }
}

function renderShopeeProducts(items) {
  if (!shopeeResults || !shopeeResultsSection) return;
  shopeeResults.innerHTML = "";
  shopeeResultsSection.hidden = false;

  if (!items.length) {
    if (shopeeState.products.length) {
      shopeeResults.innerHTML = `<div class="showcase-status is-error">ไม่พบสินค้าที่ตรงกับคำค้นหา</div>`;
    } else {
      shopeeResults.innerHTML = `<div class="flow-empty-card">ยังไม่มีผลลัพธ์ วางลิงก์สินค้า Shopee แล้วกดดึงสินค้าเพื่อเริ่ม</div>`;
    }
    updateShopeeControls();
    return;
  }

  for (const product of items) {
    const url = shopeeProductUrl(product);
    const rate = product.commissionRate && product.commissionRate !== "-" ? `${product.commissionRate}%` : "-";
    const card = document.createElement("div");
    card.className = "showcase-card";
    card.innerHTML = `
      <input type="checkbox" class="showcase-checkbox" value="${escapeHtml(product.id)}" aria-label="Select product" />
      <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
        <img class="showcase-thumb" src="${escapeHtml(product.image)}" alt="" loading="lazy" />
      </a>
      <div class="showcase-info">
        <a class="showcase-title" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(product.title)}">${escapeHtml(product.title)}</a>
        <div class="showcase-meta">
          <span>ราคา: ${escapeHtml(product.price)}</span>
          <span>ค่าคอม: ${escapeHtml(product.commission || "-")}</span>
          <span>% คอม: ${escapeHtml(rate)}</span>
          <span>คงเหลือ: ${escapeHtml(String(product.stock))}</span>
          <span>${product.canAdd ? "พร้อมใช้" : "ใช้ไม่ได้"}</span>
          <span>ร้าน: ${escapeHtml(product.shop)}</span>
        </div>
        <div class="showcase-url">${escapeHtml(url)}</div>
      </div>
    `;
    const isFirstProduct = shopeeResults.childElementCount === 0;
    const focusProduct = () => {
      window.dispatchEvent(new CustomEvent("autogt:showcase-product-focus", {
        detail: { product, url, platform: "Shopee" },
      }));
    };
    card.addEventListener("click", focusProduct);
    shopeeResults.appendChild(card);
    if (isFirstProduct) focusProduct();
  }

  shopeeResults.querySelectorAll(".showcase-checkbox").forEach((box) => {
    box.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    box.addEventListener("change", updateShopeeControls);
  });
  shopeeResults.querySelectorAll(".showcase-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      toggleCardSelectionFromClick(card, event);
    });
  });
  updateShopeeControls();
}

function applyShopeeSearch() {
  const query = (shopeeProductSearch?.value || "").trim().toLowerCase();
  shopeeState.filtered = query
    ? shopeeState.products.filter((product) => [
        product.id,
        product.itemid,
        product.title,
        product.price,
        product.stock,
        product.shop,
      ].some((value) => String(value || "").toLowerCase().includes(query)))
    : [...shopeeState.products];
  renderShopeeProducts(shopeeState.filtered);
}

async function checkShopeeLinks() {
  const urls = parseShopeeProductUrls(shopeeLinkUrls?.value || "");
  if (!urls.length) {
    setShopeeStatus("กรุณาใส่ลิงก์สินค้า Shopee อย่างน้อย 1 ลิงก์", true);
    return;
  }

  if (checkShopeeLinksBtn) checkShopeeLinksBtn.disabled = true;
  shopeeState.products = [];
  shopeeState.filtered = [];
  if (shopeeProductSearch) shopeeProductSearch.value = "";
  renderShopeeProducts(shopeeState.filtered);
  setShopeeStatus(`กำลังส่งลิงก์ ${urls.length} รายการไปหน้าเช็คค่าคอม Shopee...`);
  let progressActive = true;
  const pollProgress = async () => {
    while (progressActive) {
      try {
        const response = await fetch("/api/shopee/progress", { cache: "no-store" });
        const payload = await readJsonResponse(response);
        const progress = payload.progress?.progress;
        if (progress && Number.isFinite(Number(progress.total)) && Number(progress.total) > 0) {
          setShopeeStatus(`กำลังดึงข้อมูลจาก Shopee API ${progress.done}/${progress.total}`);
        }
      } catch (_) {
        /* progress is best-effort */
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  };
  pollProgress();
  try {
    const response = await fetch("/api/shopee/links/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
      cache: "no-store",
    });
    const payload = await readJsonResponse(response);
    if (shopeeRawJson) shopeeRawJson.textContent = JSON.stringify(payload, null, 2);

    if (!response.ok || payload.ok === false) {
      if (payload.captcha) {
        setShopeeCaptchaStatus("Shopee ขึ้น captcha/blocked ให้แก้ในแท็บที่เด้งไว้ แล้วลองใหม่", payload.captchaUrl);
        return;
      }
      const message = payload.error || "Shopee check failed";
      throw new Error(message);
    }

    const products = normalizeShopeeProducts(payload);
    shopeeState.products = products;
    shopeeState.filtered = [...products];
    renderShopeeProducts(shopeeState.filtered);
    if (payload.captcha) {
      setShopeeCaptchaStatus(`ดึงได้ ${shopeeState.products.length}/${urls.length} รายการ แล้ว Shopee ขึ้น captcha/blocked ให้แก้ในแท็บที่เปิดไว้แล้วลองใหม่`, payload.captchaUrl);
    } else {
      setShopeeStatus(`ดึงสำเร็จ พบ ${shopeeState.products.length} รายการ`);
    }
  } catch (error) {
    setShopeeStatus(`ดึงไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    progressActive = false;
    if (checkShopeeLinksBtn) checkShopeeLinksBtn.disabled = false;
  }
}

function clearShopeeProducts() {
  shopeeState.products = [];
  shopeeState.filtered = [];
  renderShopeeProducts([]);
  if (shopeeRawJson) shopeeRawJson.textContent = "";
  if (shopeeProductSearch) shopeeProductSearch.value = "";
  if (shopeeLinkUrls) shopeeLinkUrls.value = "";
  setShopeeStatus("");
  updateShopeeControls();
}

function toggleSelectAllShopee() {
  if (!shopeeResults) return;
  const boxes = [...shopeeResults.querySelectorAll(".showcase-checkbox")];
  const shouldSelect = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = shouldSelect; });
  updateShopeeControls();
}

async function copySelectedShopeeLinks() {
  const ids = new Set(selectedShopeeIds());
  const links = shopeeState.products
    .filter((product) => ids.has(product.id))
    .map(shopeeProductUrl);
  if (!links.length) {
    setShopeeStatus("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ", true);
    return;
  }
  await navigator.clipboard.writeText(links.join("\n"));
  setShopeeStatus(`คัดลอกแล้ว ${links.length} ลิงก์`);
}

function queueSelectedShopeeProducts() {
  const ids = new Set(selectedShopeeIds());
  const products = shopeeState.products.filter((product) => ids.has(product.id));
  queueProductsForFlow(products, "Shopee", setShopeeStatus);
}

function deleteSelectedShopeeItems() {
  const ids = new Set(selectedShopeeIds());
  if (!ids.size) {
    setShopeeStatus("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ", true);
    return;
  }
  shopeeState.products = shopeeState.products.filter((product) => !ids.has(product.id));
  applyShopeeSearch();
  setShopeeStatus(`ลบออกจากรายการบนหน้าจอแล้ว ${ids.size} รายการ`);
}

checkShopeeLinksBtn?.addEventListener("click", checkShopeeLinks);
clearShopeeBtn?.addEventListener("click", clearShopeeProducts);
shopeeToggleSelectBtn?.addEventListener("click", toggleSelectAllShopee);
shopeeCopySelectedBtn?.addEventListener("click", copySelectedShopeeLinks);
shopeeQueueSelectedBtn?.addEventListener("click", queueSelectedShopeeProducts);
shopeeDeleteSelectedBtn?.addEventListener("click", deleteSelectedShopeeItems);
shopeeProductSearch?.addEventListener("input", applyShopeeSearch);
updateShopeeControls();
renderShopeeProducts([]);


showcaseAccountPickBtn?.addEventListener("click", openShowcaseAccountModal);

mobileScanAdbBtn?.addEventListener("click", scanMobileAdb);
mobileScanLibraryBtn?.addEventListener("click", scanMobileLibrary);
mobileScanUploadsBtn?.addEventListener("click", scanMobileLibrary);
mobileChannelForm?.addEventListener("submit", addMobileChannelFromForm);
mobileHideOffline?.addEventListener("change", renderMobilePostWorkspace);
mobileLibrarySearch?.addEventListener("input", renderMobileLibrary);
mobileClearSelectionBtn?.addEventListener("click", () => {
  mobileSelectedVideos.clear();
  renderMobilePostWorkspace();
});
mobileQueueSelectedBtn?.addEventListener("click", () => queueMobileVideos(false));
mobileQueueAllBtn?.addEventListener("click", () => queueMobileVideos(true));
mobileRandomBtn?.addEventListener("click", randomDistributeMobileVideos);
mobileAutoRandomBtn?.addEventListener("click", () => {
  mobileAutoRandomEnabled = !mobileAutoRandomEnabled;
  localStorage.setItem("autogt.mobile.autoRandom", mobileAutoRandomEnabled ? "1" : "0");
  setMobileStatus(mobileAutoRandomEnabled ? "Auto random enabled" : "Auto random disabled");
  renderMobilePostWorkspace();
});
mobileStartAllBtn?.addEventListener("click", startMobileQueue);
mobileStopAllBtn?.addEventListener("click", () => {
  mobileRunning = false;
  mobileQueue = mobileQueue.map((job) => String(job.status || "").toLowerCase() === "running"
    ? { ...job, status: "stopped", updatedAt: new Date().toISOString() }
    : job);
  saveMobileState();
  setMobileStatus("Mobile queue stopped", true);
  renderMobilePostWorkspace();
});
function clearMobileQueueAll() {
  if (mobileRunning) return;
  mobileQueue = [];
  mobileSelectedJobs.clear();
  saveMobileState();
  setMobileStatus("Mobile queue cleared");
  renderMobilePostWorkspace();
}
mobileClearQueueBtn?.addEventListener("click", clearMobileQueueAll);
mobileScheduleClearQueueBtn?.addEventListener("click", clearMobileQueueAll);
mobileSelectAllQueueBtn?.addEventListener("click", () => {
  if (mobileQueue.length && mobileQueue.every((job) => mobileSelectedJobs.has(job.id))) mobileSelectedJobs.clear();
  else mobileSelectedJobs = new Set(mobileQueue.map((job) => job.id));
  renderMobilePostWorkspace();
});
mobileSetScheduleBtn?.addEventListener("click", setMobileSchedule);
mobileClearTimeSetBtn?.addEventListener("click", clearMobileTimeSet);
mobileClearHistoryBtn?.addEventListener("click", clearMobileHistory);
mobileToggleFloatLogsBtn?.addEventListener("click", () => toggleLogDock());

const ADB_MANAGED_DEVICES_KEY = "autogt.adb.managedDevices.v1";
const ADB_CONNECTED_DEVICES_KEY = "autogt.adb.connectedDevices.v1";
const adbDevicePanel = document.getElementById("adbDevicePanel");
const adbManagedList = document.getElementById("adbManagedList");
const adbConnectedList = document.getElementById("adbConnectedList");
const adbScanBusBtn = document.getElementById("adbScanBusBtn");
const adbFilterBtn = document.getElementById("adbFilterBtn");
const adbFilterMenu = document.getElementById("adbFilterMenu");
const adbOfflineToggleBtn = document.getElementById("adbOfflineToggleBtn");
let adbManagedDevices = readMobileList(ADB_MANAGED_DEVICES_KEY);
let adbConnectedDevices = readMobileList(ADB_CONNECTED_DEVICES_KEY);
let adbHideOffline = false;
let adbSortMode = "manual";
let selectedAdbDeviceId = "";

function adbDeviceId(device = {}) {
  return String(device.udid || device.serial || device.id || device.socket || device.path || "").trim();
}

function adbDeviceKeys(device = {}) {
  return [device.udid, device.serial, device.id, device.socket, device.path]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function adbSameDevice(a = {}, b = {}) {
  const aKeys = adbDeviceKeys(a);
  const bKeys = new Set(adbDeviceKeys(b));
  return aKeys.some((key) => bKeys.has(key));
}

function adbDeviceOnline(device = {}) {
  const state = String(device.status || device.state || device.connection || "").toLowerCase();
  return ["device", "online"].includes(state) || state.includes("online");
}

function normalizeAdbDevice(input = {}) {
  const serial = adbDeviceId(input) || mobileUid("adb");
  const state = String(input.state || input.status || input.connection || "").toLowerCase();
  const online = adbDeviceOnline({ ...input, state });
  return {
    id: input.id || serial,
    serial,
    name: String(input.name || input.model || input.device || input.product || "Android Device").trim(),
    model: String(input.model || input.product || input.device || "Android").trim(),
    path: String(input.path || input.detectionPath || input.udid || input.serial || serial).trim(),
    state: state || (online ? "device" : "offline"),
    status: online ? "online" : "offline",
    sort: Number(input.sort || 0),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

const ADB_PREVIEW_DEVICE_IDS = new Set([
  "managed-pixel",
  "managed-pad",
  "serial_87A192X",
  "serial_SAMSUNG_882",
  "serial_OLD_0091",
  "serial_PA9201L",
  "emulator-5554",
]);

function isAdbPreviewDevice(device = {}) {
  const keys = [device.id, device.serial, device.udid, device.path].map((value) => String(value || "").trim());
  return keys.some((key) => ADB_PREVIEW_DEVICE_IDS.has(key));
}

function purgeAdbPreviewDevices() {
  const beforeManaged = adbManagedDevices.length;
  const beforeConnected = adbConnectedDevices.length;
  adbManagedDevices = adbManagedDevices.filter((device) => !isAdbPreviewDevice(device));
  adbConnectedDevices = adbConnectedDevices.filter((device) => !isAdbPreviewDevice(device));
  if (selectedAdbDeviceId && ADB_PREVIEW_DEVICE_IDS.has(String(selectedAdbDeviceId))) selectedAdbDeviceId = "";
  if (beforeManaged !== adbManagedDevices.length || beforeConnected !== adbConnectedDevices.length) saveAdbDevices();
}

function seedAdbDevicesIfEmpty() {
  purgeAdbPreviewDevices();
}

function saveAdbDevices() {
  localStorage.setItem(ADB_MANAGED_DEVICES_KEY, JSON.stringify(adbManagedDevices));
  localStorage.setItem(ADB_CONNECTED_DEVICES_KEY, JSON.stringify(adbConnectedDevices));
}

function adbStatusBadge(device) {
  const online = adbDeviceOnline(device);
  return `<span class="adb-status ${online ? "is-online" : "is-offline"}"><i></i>${online ? "ONLINE" : "OFFLINE"}</span>`;
}

function adbDeviceLabel(device = {}) {
  const model = String(device.model || "Android").trim();
  const serial = String(device.serial || device.udid || "").trim();
  return [model, serial].filter(Boolean).join(" • ");
}

function adbShortDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function sortAdbManagedDevices(devices = []) {
  const sorted = [...devices];
  if (adbSortMode === "online") {
    sorted.sort((a, b) => Number(adbDeviceOnline(b)) - Number(adbDeviceOnline(a)) || Number(a.sort || 0) - Number(b.sort || 0));
  } else if (adbSortMode === "offline") {
    sorted.sort((a, b) => Number(adbDeviceOnline(a)) - Number(adbDeviceOnline(b)) || Number(a.sort || 0) - Number(b.sort || 0));
  } else if (adbSortMode === "name") {
    sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "th") || Number(a.sort || 0) - Number(b.sort || 0));
  } else if (adbSortMode === "recent") {
    sorted.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime() || Number(a.sort || 0) - Number(b.sort || 0));
  } else {
    sorted.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  }
  return sorted;
}

function updateAdbFilterUi() {
  if (adbOfflineToggleBtn) {
    adbOfflineToggleBtn.classList.toggle("is-active", adbHideOffline);
    adbOfflineToggleBtn.innerHTML = `<span class="material-symbols-outlined">${adbHideOffline ? "visibility" : "visibility_off"}</span>${adbHideOffline ? "แสดง Offline" : "ซ่อน Offline"}`;
  }
  adbFilterBtn?.classList.toggle("is-active", adbSortMode !== "manual");
  adbFilterMenu?.querySelectorAll("[data-adb-sort]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.adbSort === adbSortMode);
  });
}

function closeAdbFilterMenu() {
  if (!adbFilterMenu || !adbFilterBtn) return;
  adbFilterMenu.hidden = true;
  adbFilterBtn.setAttribute("aria-expanded", "false");
}

function renderAdbManagedDevices() {
  if (!adbManagedList) return;
  updateAdbFilterUi();
  const devices = sortAdbManagedDevices(adbManagedDevices)
    .filter((device) => !adbHideOffline || adbDeviceOnline(device));
  if (!selectedAdbDeviceId && devices[0]) selectedAdbDeviceId = devices[0].id;
  adbManagedList.innerHTML = devices.length ? devices.map((device, index) => {
    const online = adbDeviceOnline(device);
    const selected = String(device.id) === String(selectedAdbDeviceId);
    return `
      <article class="adb-managed-card ${online ? "is-online" : "is-offline"} ${selected ? "is-selected" : ""}" data-adb-managed="${escapeHtml(device.id)}">
        <div class="adb-managed-top">
          <span class="adb-device-icon"><span class="material-symbols-outlined">${online ? "smartphone" : "phonelink_off"}</span></span>
          <div class="adb-device-title">
            <strong title="${escapeHtml(device.name)}">${escapeHtml(device.name)}</strong>
            <em>${escapeHtml(adbDeviceLabel(device))}</em>
          </div>
          ${adbStatusBadge(device)}
        </div>
        <div class="adb-device-fields">
          <div>
            <span>ADB socket</span>
            <code>${escapeHtml(device.path || device.serial)}</code>
          </div>
          <div>
            <span>Last check</span>
            <code>${escapeHtml(adbShortDate(device.updatedAt))}</code>
          </div>
        </div>
        <div class="adb-card-bottom">
          <span class="adb-device-role">${selected ? "Selected device" : "Managed device"}</span>
          <div class="adb-card-actions">
            <button type="button" class="adb-icon-btn" data-adb-shell="${escapeHtml(device.id)}" title="Open shell"><span class="material-symbols-outlined">terminal</span></button>
            <button type="button" class="adb-icon-btn" data-adb-refresh="${escapeHtml(device.id)}" title="Refresh state"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="adb-icon-btn" data-adb-edit="${escapeHtml(device.id)}" title="Edit device"><span class="material-symbols-outlined">edit</span></button>
            <button type="button" class="adb-icon-btn" data-adb-up="${escapeHtml(device.id)}" title="Move up" ${index === 0 ? "disabled" : ""}><span class="material-symbols-outlined">arrow_upward</span></button>
            <button type="button" class="adb-icon-btn" data-adb-down="${escapeHtml(device.id)}" title="Move down" ${index === devices.length - 1 ? "disabled" : ""}><span class="material-symbols-outlined">arrow_downward</span></button>
          </div>
        </div>
      </article>`;
  }).join("") : `<div class="adb-empty">ยังไม่มี Managed Device ให้ Scan Bus แล้วกด MANAGE เพื่อเพิ่มอุปกรณ์จริง</div>`;
}

function renderAdbConnectedDevices() {
  if (!adbConnectedList) return;
  const visibleDevices = adbConnectedDevices.filter((device) => !adbManagedDevices.some((managed) => adbSameDevice(managed, device)));
  adbConnectedList.innerHTML = visibleDevices.length ? visibleDevices.map((device) => {
    const state = String(device.state || device.status || "offline").toUpperCase();
    const isDevice = state === "DEVICE" || state === "ONLINE";
    return `
      <div class="adb-table-row" data-adb-raw="${escapeHtml(device.serial)}">
        <div class="adb-raw-main">
          <span class="adb-grip">drag_indicator</span>
          <div>
            <code>${escapeHtml(device.serial)}</code>
            <small>${escapeHtml(device.path || device.serial)}</small>
          </div>
        </div>
        <div class="adb-raw-actions">
          <span class="adb-state ${isDevice ? "is-device" : "is-warn"}">${escapeHtml(isDevice ? "DEVICE" : state || "OFFLINE")}</span>
          <button type="button" class="adb-manage-btn" data-adb-manage="${escapeHtml(device.serial)}">MANAGE</button>
        </div>
      </div>`;
  }).join("") : `<div class="adb-empty in-table">ยังไม่พบอุปกรณ์ ADB กด Scan Bus เพื่อเชื่อมต่ออุปกรณ์จริง</div>`;
}

function renderAdbDeviceWorkspace() {
  if (!adbDevicePanel) return;
  seedAdbDevicesIfEmpty();
  renderAdbManagedDevices();
  renderAdbConnectedDevices();
  if (!adbConnectedDevices.length && !adbDevicePanel.dataset.adbAutoScanDone) {
    adbDevicePanel.dataset.adbAutoScanDone = "1";
    scanAdbBus();
  }
}

function upsertManagedAdbDevice(device) {
  const normalized = normalizeAdbDevice({ ...device, sort: adbManagedDevices.length + 1 });
  const index = adbManagedDevices.findIndex((item) => adbSameDevice(item, normalized));
  if (index >= 0) {
    adbManagedDevices[index] = { ...adbManagedDevices[index], ...normalized, id: adbManagedDevices[index].id, sort: adbManagedDevices[index].sort };
  } else {
    adbManagedDevices.push(normalized);
  }
  adbConnectedDevices = adbConnectedDevices.filter((item) => !adbSameDevice(item, normalized));
  if (!selectedAdbDeviceId) selectedAdbDeviceId = normalized.id;
  saveAdbDevices();
  renderAdbDeviceWorkspace();
  setMobileStatus(`Managed device ready: ${normalized.name}`);
}

function moveManagedAdbDevice(id, direction) {
  const sorted = [...adbManagedDevices].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  const index = sorted.findIndex((device) => device.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return;
  [sorted[index], sorted[nextIndex]] = [sorted[nextIndex], sorted[index]];
  adbManagedDevices = sorted.map((device, order) => ({ ...device, sort: order + 1 }));
  saveAdbDevices();
  renderAdbDeviceWorkspace();
}

function editManagedAdbDevice(id) {
  const device = adbManagedDevices.find((item) => item.id === id);
  if (!device) return;
  const nextName = window.prompt("Edit device name", device.name);
  if (nextName === null) return;
  const nextPath = window.prompt("Edit ADB socket / path", device.path || device.serial);
  if (nextPath === null) return;
  device.name = String(nextName || device.name).trim() || device.name;
  device.path = String(nextPath || device.path || device.serial).trim();
  device.updatedAt = new Date().toISOString();
  saveAdbDevices();
  renderAdbDeviceWorkspace();
}

function syncManagedAdbStatus(scannedDevices = []) {
  const now = new Date().toISOString();
  adbManagedDevices = adbManagedDevices.map((managed) => {
    const match = scannedDevices.find((device) => adbSameDevice(managed, device));
    if (!match) {
      return { ...managed, state: "offline", status: "offline", updatedAt: now };
    }
    const normalized = normalizeAdbDevice({
      ...match,
      id: managed.id,
      name: managed.name || match.name,
      sort: managed.sort,
      updatedAt: now,
    });
    return {
      ...managed,
      ...normalized,
      id: managed.id,
      name: managed.name || normalized.name,
      sort: managed.sort,
      updatedAt: now,
    };
  });
}

async function scanAdbBus() {
  if (!adbScanBusBtn) return;
  const old = adbScanBusBtn.disabled;
  adbScanBusBtn.disabled = true;
  adbScanBusBtn.innerHTML = `<span class="material-symbols-outlined">progress_activity</span>Scanning...`;
  setMobileStatus("Scanning ADB bus...");
  try {
    const response = await fetch("/api/adb/devices", { method: "POST", cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "ADB scan failed");
    const scannedDevices = (Array.isArray(payload.devices) ? payload.devices : []).map(normalizeAdbDevice);
    syncManagedAdbStatus(scannedDevices);
    adbConnectedDevices = scannedDevices.filter((device) => !adbManagedDevices.some((managed) => adbSameDevice(managed, device)));
    saveAdbDevices();
    setMobileStatus(`ADB bus scan complete: ${scannedDevices.length} device(s)`);
  } catch (error) {
    setMobileStatus(error.message || "ADB scan failed", true);
  } finally {
    adbScanBusBtn.disabled = old;
    adbScanBusBtn.innerHTML = `<span class="material-symbols-outlined">refresh</span>Scan Bus`;
    renderAdbDeviceWorkspace();
  }
}

adbScanBusBtn?.addEventListener("click", scanAdbBus);
adbFilterBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!adbFilterMenu) return;
  const nextOpen = adbFilterMenu.hidden;
  adbFilterMenu.hidden = !nextOpen;
  adbFilterBtn.setAttribute("aria-expanded", String(nextOpen));
  updateAdbFilterUi();
});
adbFilterMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
  const sortButton = event.target.closest("[data-adb-sort]");
  if (sortButton) {
    adbSortMode = sortButton.dataset.adbSort || "manual";
    renderAdbManagedDevices();
    closeAdbFilterMenu();
    return;
  }
});
adbOfflineToggleBtn?.addEventListener("click", () => {
  adbHideOffline = !adbHideOffline;
  renderAdbManagedDevices();
});
document.addEventListener("click", (event) => {
  if (!adbFilterMenu || adbFilterMenu.hidden) return;
  if (event.target.closest(".adb-filter-wrap")) return;
  closeAdbFilterMenu();
});
adbManagedList?.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-adb-edit]");
  const up = event.target.closest("[data-adb-up]");
  const down = event.target.closest("[data-adb-down]");
  const refresh = event.target.closest("[data-adb-refresh]");
  const shell = event.target.closest("[data-adb-shell]");
  const card = event.target.closest("[data-adb-managed]");
  if (edit) return editManagedAdbDevice(edit.dataset.adbEdit);
  if (up) return moveManagedAdbDevice(up.dataset.adbUp, -1);
  if (down) return moveManagedAdbDevice(down.dataset.adbDown, 1);
  if (refresh || shell) {
    const id = refresh?.dataset.adbRefresh || shell?.dataset.adbShell;
    const device = adbManagedDevices.find((item) => item.id === id);
    if (device) device.updatedAt = new Date().toISOString();
    saveAdbDevices();
    renderAdbManagedDevices();
    return setMobileStatus(refresh ? "Refreshing managed device state..." : "Device shell action queued");
  }
  if (card) {
    selectedAdbDeviceId = card.dataset.adbManaged || "";
    renderAdbManagedDevices();
  }
});
adbConnectedList?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-adb-manage]");
  if (!btn) return;
  const device = adbConnectedDevices.find((item) => item.serial === btn.dataset.adbManage);
  if (device) upsertManagedAdbDevice(device);
});

const shopeeDiscoveryState = {
  products: [],
  filtered: [],
  selected: new Set(),
  loading: false,
  rankEnabled: false,
  rankLoading: false,
  rankRequestId: 0,
  videoRanks: new Map(),
};

const shopeeDiscoveryPanel = document.getElementById("shopeeProductSearchPanel");
const shopeeDiscoveryKeyword = document.getElementById("shopeeDiscoveryKeyword");
const shopeeDiscoveryOfferType = document.getElementById("shopeeDiscoveryOfferType");
const shopeeDiscoveryLimit = document.getElementById("shopeeDiscoveryLimit");
const shopeeDiscoveryExtraCommission = document.getElementById("shopeeDiscoveryExtraCommission");
const shopeeDiscoveryFreeSample = document.getElementById("shopeeDiscoveryFreeSample");
const shopeeDiscoveryRankToggle = document.getElementById("shopeeDiscoveryRankToggle");
const shopeeDiscoveryRankHeading = document.getElementById("shopeeDiscoveryRankHeading");
const shopeeDiscoverySearchBtn = document.getElementById("shopeeDiscoverySearchBtn");
const shopeeDiscoveryExportBtn = document.getElementById("shopeeDiscoveryExportBtn");
const shopeeDiscoverySelectAllBtn = document.getElementById("shopeeDiscoverySelectAllBtn");
const shopeeDiscoveryCopyBtn = document.getElementById("shopeeDiscoveryCopyBtn");
const shopeeDiscoveryQueueBtn = document.getElementById("shopeeDiscoveryQueueBtn");
const shopeeDiscoveryLocalFilter = document.getElementById("shopeeDiscoveryLocalFilter");
const shopeeDiscoveryResults = document.getElementById("shopeeDiscoveryResults");
const shopeeDiscoveryEmpty = document.getElementById("shopeeDiscoveryEmpty");
const shopeeDiscoveryStatus = document.getElementById("shopeeDiscoveryStatus");

function setShopeeVideoRankEnabled(enabled, options = {}) {
  const nextEnabled = enabled === true;
  const wasEnabled = shopeeDiscoveryState.rankEnabled;
  shopeeDiscoveryState.rankEnabled = nextEnabled;
  shopeeDiscoveryState.rankRequestId += 1;
  shopeeDiscoveryState.rankLoading = false;
  if (shopeeDiscoveryRankToggle) {
    shopeeDiscoveryRankToggle.classList.toggle("is-on", nextEnabled);
    shopeeDiscoveryRankToggle.setAttribute("aria-pressed", String(nextEnabled));
    const hint = shopeeDiscoveryRankToggle.querySelector("small");
    if (hint) hint.textContent = nextEnabled
      ? "เปิดอยู่ · กำลังใช้ API ตรวจ 10 อันดับแรก"
      : "ปิดอยู่ · กดเพื่อเช็ค 10 อันดับแรก";
  }
  renderShopeeDiscovery();
  if (!nextEnabled) {
    if (!options.quiet) setShopeeDiscoveryStatus("ปิดการเช็คอันดับวิดีโอแล้ว");
    return;
  }
  // A ready result may have been produced by an older API signature. Starting
  // a new rank session must never reuse stale 0/10 values.
  if (!wasEnabled || options.forceRefresh) shopeeDiscoveryState.videoRanks.clear();
  if (!options.quiet) setShopeeDiscoveryStatus("เปิดการเช็คอันดับวิดีโอแล้ว");
  if (shopeeDiscoveryState.filtered.length) {
    loadShopeeVideoRanks(shopeeDiscoveryState.filtered, { requestId: shopeeDiscoveryState.rankRequestId });
  }
}

function setShopeeDiscoveryStatus(message = "", isError = false) {
  if (!shopeeDiscoveryStatus) return;
  shopeeDiscoveryStatus.textContent = message;
  shopeeDiscoveryStatus.classList.toggle("is-error", !!isError);
}

function shopeeDiscoverySelectedProducts() {
  return shopeeDiscoveryState.products.filter((product) => shopeeDiscoveryState.selected.has(String(product.id)));
}

function formatDiscoveryNumber(value, digits = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "-";
}

function formatDiscoveryPriceRange(product) {
  const min = Number(product.priceMin ?? product.price ?? 0);
  const max = Number(product.priceMax ?? product.price ?? min);
  if (!Number.isFinite(min)) return "-";
  return min !== max ? `฿${formatDiscoveryNumber(min, 2)} - ฿${formatDiscoveryNumber(max, 2)}` : `฿${formatDiscoveryNumber(min, 2)}`;
}

function shopeeDiscoveryProductUrl(product = {}) {
  const candidates = [
    product.url,
    product.productUrl,
    product.product_url,
    product.productLink,
    product.product_link,
    product.sourceUrl,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return `https:${value}`;
  }

  const shopId = String(product.shopId || product.shopid || product.shop_id || "").trim();
  const itemId = String(product.id || product.itemid || product.item_id || "").trim();
  return shopId && itemId ? `https://shopee.co.th/product/${shopId}/${itemId}` : "";
}

function updateShopeeDiscoverySummary() {
  const products = shopeeDiscoveryState.products;
  const selected = shopeeDiscoveryState.selected.size;
  const avgCommission = products.length
    ? products.reduce((sum, item) => sum + Number(item.commissionRate || 0), 0) / products.length
    : 0;
  const totalSold = products.reduce((sum, item) => sum + Number(item.sold || 0), 0);
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  setText("shopeeDiscoveryTotal", formatDiscoveryNumber(products.length));
  setText("shopeeDiscoverySelected", formatDiscoveryNumber(selected));
  setText("shopeeDiscoveryAvgCommission", products.length ? `${formatDiscoveryNumber(avgCommission, 2)}%` : "-");
  setText("shopeeDiscoveryTotalSold", formatDiscoveryNumber(totalSold));

  const hasProducts = products.length > 0;
  const hasSelected = selected > 0;
  if (shopeeDiscoveryExportBtn) shopeeDiscoveryExportBtn.disabled = !hasProducts;
  if (shopeeDiscoverySelectAllBtn) shopeeDiscoverySelectAllBtn.disabled = !shopeeDiscoveryState.filtered.length;
  if (shopeeDiscoveryCopyBtn) shopeeDiscoveryCopyBtn.disabled = !hasSelected;
  if (shopeeDiscoveryQueueBtn) shopeeDiscoveryQueueBtn.disabled = !hasSelected;
  if (shopeeDiscoveryLocalFilter) shopeeDiscoveryLocalFilter.disabled = !hasProducts;
  if (shopeeDiscoverySelectAllBtn) {
    const allVisibleSelected = shopeeDiscoveryState.filtered.length > 0 && shopeeDiscoveryState.filtered.every((item) => shopeeDiscoveryState.selected.has(String(item.id)));
    shopeeDiscoverySelectAllBtn.innerHTML = `<span class="material-symbols-outlined">select_all</span> ${allVisibleSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}`;
  }
}

function renderShopeeDiscovery() {
  if (!shopeeDiscoveryResults || !shopeeDiscoveryEmpty) return;
  const tableWrap = shopeeDiscoveryResults.closest(".discovery-table-wrap");
  const previousScrollTop = tableWrap?.scrollTop || 0;
  const previousScrollLeft = tableWrap?.scrollLeft || 0;
  shopeeDiscoveryResults.innerHTML = "";
  shopeeDiscoveryEmpty.hidden = shopeeDiscoveryState.filtered.length > 0;
  if (shopeeDiscoveryRankHeading) shopeeDiscoveryRankHeading.hidden = !shopeeDiscoveryState.rankEnabled;

  for (const product of shopeeDiscoveryState.filtered) {
    const id = String(product.id || product.itemid || "");
    const productLink = shopeeDiscoveryProductUrl(product);
    const selected = shopeeDiscoveryState.selected.has(id);
    const rankResult = shopeeDiscoveryState.videoRanks.get(id);
    const rankCell = shopeeDiscoveryState.rankEnabled
      ? `<td class="discovery-rank-col">${renderShopeeVideoRankButton(id, rankResult)}</td>`
      : "";
    const row = document.createElement("tr");
    row.className = selected ? "is-selected" : "";
    row.dataset.discoveryProduct = id;
    row.innerHTML = `
      <td class="select-col"><input class="discovery-product-check" type="checkbox" value="${escapeHtml(id)}" ${selected ? "checked" : ""} aria-label="เลือกสินค้า" /></td>
      <td>
        <div class="discovery-product-cell">
          <img src="${escapeHtml(product.image || "")}" alt="" loading="lazy" />
          <div>
            <strong title="${escapeHtml(product.title || "")}">${escapeHtml(product.title || "-")}</strong>
            <span>Item ID: ${escapeHtml(id)}${product.isOfficialShop ? " · Mall" : ""}${product.isFreeSample ? " · รีวิวฟรี" : ""}</span>
          </div>
        </div>
      </td>
      <td><strong>${escapeHtml(formatDiscoveryPriceRange(product))}</strong></td>
      <td>${escapeHtml(formatDiscoveryNumber(product.sold))}</td>
      <td>${escapeHtml(formatDiscoveryNumber(product.historicalSold))}</td>
      <td>
        <div class="discovery-commission">
          <strong>${escapeHtml(formatDiscoveryNumber(product.commissionRate, 2))}%</strong>
          <span>฿${escapeHtml(formatDiscoveryNumber(product.commission, 2))}${Number(product.commissionMax || 0) > Number(product.commission || 0) ? ` - ฿${escapeHtml(formatDiscoveryNumber(product.commissionMax, 2))}` : ""}</span>
        </div>
      </td>
      <td>${escapeHtml(formatDiscoveryNumber(product.stock))}</td>
      <td><span class="discovery-shop-name" title="${escapeHtml(product.shop || "")}">${escapeHtml(product.shop || "-")}</span></td>
      ${rankCell}
      <td>${productLink
        ? `<button class="icon-btn compact" type="button" data-discovery-open="${escapeHtml(id)}" title="เปิดลิงก์สินค้า" aria-label="เปิดลิงก์สินค้า"><span class="material-symbols-outlined">open_in_new</span></button>`
        : `<button class="icon-btn compact" type="button" disabled title="ไม่พบลิงก์สินค้า" aria-label="ไม่พบลิงก์สินค้า"><span class="material-symbols-outlined">link_off</span></button>`}</td>`;
    shopeeDiscoveryResults.appendChild(row);
  }
  updateShopeeDiscoverySummary();
  if (tableWrap) {
    tableWrap.scrollTop = previousScrollTop;
    tableWrap.scrollLeft = previousScrollLeft;
  }
}

function renderShopeeVideoRankButton(productId, result) {
  if (!result || result.status === "pending") {
    return `<button class="discovery-rank-button is-pending" type="button" disabled><span class="material-symbols-outlined spin">progress_activity</span> รอตรวจ</button>`;
  }
  if (result.status === "loading") {
    return `<button class="discovery-rank-button is-loading" type="button" disabled><span class="material-symbols-outlined spin">progress_activity</span> กำลังเช็ค</button>`;
  }
  if (result.status === "deferred") {
    return `<button class="discovery-rank-button is-pending" type="button" data-discovery-rank-retry="${escapeHtml(productId)}" title="ตรวจสินค้านี้"><span class="material-symbols-outlined">manage_search</span> เช็ค</button>`;
  }
  if (result.status === "error") {
    return `<button class="discovery-rank-button is-error" type="button" data-discovery-rank-retry="${escapeHtml(productId)}" title="${escapeHtml(result.error || "ตรวจอันดับไม่สำเร็จ")}"><span class="material-symbols-outlined">refresh</span> ลองใหม่</button>`;
  }
  const count = Math.min(10, Array.isArray(result.videos) ? result.videos.length : Number(result.count || 0));
  return `<button class="discovery-rank-button" type="button" data-discovery-rank="${escapeHtml(productId)}" title="ดูอันดับวิดีโอ"><strong>${count}/10</strong><span>อันดับ</span></button>`;
}

async function loadShopeeVideoRanks(products = shopeeDiscoveryState.filtered, options = {}) {
  if (!shopeeDiscoveryState.rankEnabled) return;
  const force = !!options.force;
  const requestId = options.requestId || ++shopeeDiscoveryState.rankRequestId;
  const eligible = products.filter((product) => {
    const id = String(product.id || product.itemid || "");
    const current = shopeeDiscoveryState.videoRanks.get(id);
    return id && (force || !current || current.status === "pending" || current.status === "error" || current.status === "deferred");
  });
  const candidates = eligible.slice(0, force ? eligible.length : 50);
  if (!force) {
    for (const product of eligible.slice(50)) {
      const id = String(product.id || product.itemid || "");
      if (!shopeeDiscoveryState.videoRanks.has(id)) {
        shopeeDiscoveryState.videoRanks.set(id, { status: "deferred" });
      }
    }
  }
  if (!candidates.length) return;

  shopeeDiscoveryState.rankLoading = true;
  let checked = 0;
  for (let offset = 0; offset < candidates.length; offset += 10) {
    if (!shopeeDiscoveryState.rankEnabled || requestId !== shopeeDiscoveryState.rankRequestId) break;
    const batch = candidates.slice(offset, offset + 10);
    for (const product of batch) {
      shopeeDiscoveryState.videoRanks.set(String(product.id || product.itemid || ""), { status: "loading" });
    }
    renderShopeeDiscovery();
    setShopeeDiscoveryStatus(`กำลังตรวจอันดับวิดีโอ Shopee ${checked}/${candidates.length} สินค้า...`);
    try {
      const response = await fetch("/api/shopee/videos/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          products: batch.map((product) => ({
            id: String(product.id || product.itemid || ""),
            shopId: String(product.shopId || product.shopid || ""),
            title: String(product.title || ""),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const returned = new Map((Array.isArray(payload.results) ? payload.results : []).map((result) => [String(result.id || ""), result]));
      for (const product of batch) {
        const id = String(product.id || product.itemid || "");
        const result = returned.get(id);
        shopeeDiscoveryState.videoRanks.set(id, result?.ok === false
          ? { status: "error", error: result.error || "ตรวจอันดับไม่สำเร็จ" }
          : { status: "ready", count: Number(result?.count || 0), videos: Array.isArray(result?.videos) ? result.videos : [] });
      }
    } catch (error) {
      for (const product of batch) {
        shopeeDiscoveryState.videoRanks.set(String(product.id || product.itemid || ""), {
          status: "error",
          error: String(error.message || error),
        });
      }
    }
    checked += batch.length;
    renderShopeeDiscovery();
  }
  shopeeDiscoveryState.rankLoading = false;
  if (shopeeDiscoveryState.rankEnabled && requestId === shopeeDiscoveryState.rankRequestId) {
    const failed = candidates.filter((product) => shopeeDiscoveryState.videoRanks.get(String(product.id || product.itemid || ""))?.status === "error").length;
    const deferred = Math.max(0, eligible.length - candidates.length);
    setShopeeDiscoveryStatus(`เช็คอันดับวิดีโอแล้ว ${candidates.length - failed}/${candidates.length} สินค้า${failed ? ` · ไม่สำเร็จ ${failed} รายการ` : ""}${deferred ? ` · เหลือ ${deferred} รายการ กดเช็คเฉพาะรายการได้` : ""}`, failed > 0);
  }
}

function ensureShopeeVideoRankModal() {
  let modal = document.getElementById("shopeeVideoRankModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "shopeeVideoRankModal";
  modal.className = "shopee-rank-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <section class="shopee-rank-dialog" role="dialog" aria-modal="true" aria-labelledby="shopeeRankTitle">
      <header class="shopee-rank-head">
        <div><p class="eyebrow">Top product videos</p><h2 id="shopeeRankTitle">อันดับวิดีโอสินค้า</h2></div>
        <button class="icon-btn" type="button" data-shopee-rank-close aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>
      </header>
      <div class="shopee-rank-product" id="shopeeRankProduct"></div>
      <div class="shopee-rank-list" id="shopeeRankList"></div>
    </section>`;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-shopee-rank-close]")) closeShopeeVideoRankModal();
  });
  document.body.appendChild(modal);
  return modal;
}

function openShopeeVideoRankModal(productId) {
  const product = shopeeDiscoveryState.products.find((item) => String(item.id || item.itemid || "") === String(productId));
  const result = shopeeDiscoveryState.videoRanks.get(String(productId));
  if (!product || result?.status !== "ready") return;
  const modal = ensureShopeeVideoRankModal();
  const productBox = modal.querySelector("#shopeeRankProduct");
  const list = modal.querySelector("#shopeeRankList");
  const videos = Array.isArray(result.videos) ? result.videos.slice(0, 10) : [];
  productBox.innerHTML = `
    <img src="${escapeHtml(product.image || "")}" alt="" />
    <div><strong>${escapeHtml(product.title || "-")}</strong><span>Item ID: ${escapeHtml(productId)} · พบ ${videos.length}/10 อันดับ</span></div>`;
  list.innerHTML = videos.length ? videos.map((video, index) => `
    <article class="shopee-rank-card">
      <div class="shopee-rank-number"><span>อันดับ</span><strong>${escapeHtml(video.rank || index + 1)}</strong></div>
      <img src="${escapeHtml(video.preview || product.image || "")}" alt="" loading="lazy" />
      <div class="shopee-rank-detail">
        <strong>Session ${escapeHtml(video.sessionId || "-")}</strong>
        <div class="shopee-rank-metrics">
          <span>SCR ${video.score == null ? "-" : escapeHtml(formatDiscoveryNumber(video.score, 2))}</span>
          <span>CTR ${video.ctr == null ? "-" : `${escapeHtml(formatDiscoveryNumber(video.ctr, 1))}%`}</span>
          <span>CVR ${video.cvr == null ? "-" : `${escapeHtml(formatDiscoveryNumber(video.cvr, 1))}%`}</span>
          <span>${escapeHtml(formatDiscoveryNumber(video.viewCount))} วิว</span>
        </div>
      </div>
      ${video.videoUrl ? `<button class="outline-btn compact" type="button" data-shopee-video-url="${escapeHtml(video.videoUrl)}"><span class="material-symbols-outlined">play_circle</span> เปิดวิดีโอ</button>` : ""}
    </article>`).join("") : `<div class="shopee-rank-empty"><span class="material-symbols-outlined">video_library</span><strong>ไม่พบวิดีโอใน 10 อันดับแรก</strong></div>`;
  list.querySelectorAll("[data-shopee-video-url]").forEach((button) => {
    button.addEventListener("click", () => window.open(button.dataset.shopeeVideoUrl, "_blank", "noopener,noreferrer"));
  });
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeShopeeVideoRankModal() {
  const modal = document.getElementById("shopeeVideoRankModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

function applyShopeeDiscoveryLocalFilter() {
  const query = String(shopeeDiscoveryLocalFilter?.value || "").trim().toLowerCase();
  shopeeDiscoveryState.filtered = query
    ? shopeeDiscoveryState.products.filter((product) => [
        product.title,
        product.id,
        product.shop,
        product.price,
        product.commissionRate,
      ].some((value) => String(value || "").toLowerCase().includes(query)))
    : [...shopeeDiscoveryState.products];
  renderShopeeDiscovery();
}

function shopeeDiscoveryFilters() {
  const filterTypes = [];
  if (shopeeDiscoveryExtraCommission?.checked) filterTypes.push("2");
  if (shopeeDiscoveryFreeSample?.checked) filterTypes.push("5");
  const selectedSort = document.querySelector('input[name="shopeeDiscoverySort"]:checked');
  return {
    keyword: String(shopeeDiscoveryKeyword?.value || "").trim(),
    offerType: String(shopeeDiscoveryOfferType?.value || "0"),
    sortType: String(selectedSort?.value || "2"),
    filterTypes,
    maxResults: Number(shopeeDiscoveryLimit?.value ?? 0),
  };
}

async function searchShopeeDiscovery() {
  if (shopeeDiscoveryState.loading) return;
  shopeeDiscoveryState.loading = true;
  shopeeDiscoverySearchBtn.disabled = true;
  shopeeDiscoverySearchBtn.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> กำลังค้นหา';
  setShopeeDiscoveryStatus("กำลังโหลดสินค้าจาก Shopee Affiliate...");
  try {
    const response = await fetch("/api/shopee/products/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(shopeeDiscoveryFilters()),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    shopeeDiscoveryState.products = Array.isArray(payload.products) ? payload.products : [];
    shopeeDiscoveryState.filtered = [...shopeeDiscoveryState.products];
    shopeeDiscoveryState.selected.clear();
    if (shopeeDiscoveryLocalFilter) shopeeDiscoveryLocalFilter.value = "";
    renderShopeeDiscovery();
    setShopeeDiscoveryStatus(`ค้นหาสำเร็จ ${shopeeDiscoveryState.products.length} รายการ${payload.totalAvailable ? ` จากทั้งหมด ${formatDiscoveryNumber(payload.totalAvailable)} รายการ` : ""}`);
    if (shopeeDiscoveryState.rankEnabled) {
      shopeeDiscoveryState.videoRanks.clear();
      loadShopeeVideoRanks(shopeeDiscoveryState.filtered);
    }
  } catch (error) {
    shopeeDiscoveryState.products = [];
    shopeeDiscoveryState.filtered = [];
    shopeeDiscoveryState.selected.clear();
    renderShopeeDiscovery();
    setShopeeDiscoveryStatus(`ค้นหาไม่สำเร็จ: ${error.message || error}`, true);
  } finally {
    shopeeDiscoveryState.loading = false;
    shopeeDiscoverySearchBtn.disabled = false;
    shopeeDiscoverySearchBtn.innerHTML = '<span class="material-symbols-outlined">travel_explore</span> ค้นหาสินค้า';
  }
}

function toggleShopeeDiscoverySelection(id, checked) {
  if (checked) shopeeDiscoveryState.selected.add(String(id));
  else shopeeDiscoveryState.selected.delete(String(id));
  renderShopeeDiscovery();
}

function toggleAllShopeeDiscovery() {
  const shouldSelect = shopeeDiscoveryState.filtered.some((item) => !shopeeDiscoveryState.selected.has(String(item.id)));
  for (const item of shopeeDiscoveryState.filtered) {
    if (shouldSelect) shopeeDiscoveryState.selected.add(String(item.id));
    else shopeeDiscoveryState.selected.delete(String(item.id));
  }
  renderShopeeDiscovery();
}

async function copyShopeeDiscoveryLinks() {
  const products = shopeeDiscoverySelectedProducts();
  if (!products.length) return;
  await navigator.clipboard.writeText(products.map(shopeeDiscoveryProductUrl).filter(Boolean).join("\n"));
  setShopeeDiscoveryStatus(`คัดลอกลิงก์แล้ว ${products.length} รายการ`);
}

function queueShopeeDiscoveryProducts() {
  const products = shopeeDiscoverySelectedProducts().map((product) => ({
    ...product,
    url: shopeeDiscoveryProductUrl(product),
    itemid: product.id,
    price: formatDiscoveryPriceRange(product),
    commission: `฿${formatDiscoveryNumber(product.commission, 2)}`,
    commissionRate: product.commissionRate,
  }));
  queueProductsForFlow(products, "Shopee", setShopeeDiscoveryStatus);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportShopeeDiscoveryCsv() {
  if (!shopeeDiscoveryState.products.length) return;
  const headers = ["สินค้า", "ราคาเริ่มต้น", "ราคาสูงสุด", "ยอดขายต่อเดือน", "ขายแล้ว", "ค่าคอม (%)", "ค่าคอมเริ่มต้น", "ค่าคอมสูงสุด", "สต๊อก", "ร้าน Mall", "สินค้ารีวิวฟรี", "ร้านค้า", "Shop ID", "Item ID", "ลิงก์สินค้า", "ลิงก์ Affiliate"];
  const rows = shopeeDiscoveryState.products.map((item) => [item.title, item.priceMin, item.priceMax, item.sold, item.historicalSold, item.commissionRate, item.commission, item.commissionMax, item.stock, item.isOfficialShop ? "ใช่" : "ไม่ใช่", item.isFreeSample ? "ใช่" : "ไม่ใช่", item.shop, item.shopId, item.id, shopeeDiscoveryProductUrl(item), item.affiliateUrl]);
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${new Date().toISOString().slice(0, 10)}-shopee-affiliate-products.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

shopeeDiscoverySearchBtn?.addEventListener("click", searchShopeeDiscovery);
shopeeDiscoveryKeyword?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchShopeeDiscovery();
});
shopeeDiscoveryLocalFilter?.addEventListener("input", applyShopeeDiscoveryLocalFilter);
shopeeDiscoverySelectAllBtn?.addEventListener("click", toggleAllShopeeDiscovery);
shopeeDiscoveryCopyBtn?.addEventListener("click", copyShopeeDiscoveryLinks);
shopeeDiscoveryQueueBtn?.addEventListener("click", queueShopeeDiscoveryProducts);
shopeeDiscoveryExportBtn?.addEventListener("click", exportShopeeDiscoveryCsv);
shopeeDiscoveryRankToggle?.addEventListener("click", () => {
  setShopeeVideoRankEnabled(!shopeeDiscoveryState.rankEnabled);
});
shopeeDiscoveryResults?.addEventListener("click", (event) => {
  const rankButton = event.target.closest("[data-discovery-rank]");
  if (rankButton) {
    openShopeeVideoRankModal(rankButton.dataset.discoveryRank);
    return;
  }
  const retryRankButton = event.target.closest("[data-discovery-rank-retry]");
  if (retryRankButton) {
    const id = String(retryRankButton.dataset.discoveryRankRetry || "");
    const product = shopeeDiscoveryState.products.find((item) => String(item.id || item.itemid || "") === id);
    if (product) loadShopeeVideoRanks([product], { force: true });
    return;
  }
  const openButton = event.target.closest("[data-discovery-open]");
  if (openButton) {
    const id = String(openButton.dataset.discoveryOpen || "");
    const product = shopeeDiscoveryState.products.find((item) => String(item.id || item.itemid || "") === id);
    const url = shopeeDiscoveryProductUrl(product || {});
    if (!url) return setShopeeDiscoveryStatus("ไม่พบลิงก์สินค้าสำหรับรายการนี้", true);
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (event.target.closest("a, button")) return;
  const row = event.target.closest("[data-discovery-product]");
  if (!row) return;
  const checkbox = row.querySelector(".discovery-product-check");
  if (!checkbox) return;
  if (event.target !== checkbox) checkbox.checked = !checkbox.checked;
  toggleShopeeDiscoverySelection(row.dataset.discoveryProduct, checkbox.checked);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("shopeeVideoRankModal")?.classList.contains("is-open")) {
    closeShopeeVideoRankModal();
  }
});

const shopeeRemixState = {
  initialized: false,
  products: [],
  selected: new Set(),
  queue: [],
  queueFilter: "all",
  searching: false,
  running: false,
  paused: false,
  stopRequested: false,
  currentAbortController: null,
};

function shopeeRemixElements() {
  return {
    panel: document.getElementById("shopeeRemixPanel"),
    keywords: document.getElementById("shopeeRemixKeywords"),
    linkLimit: document.getElementById("shopeeRemixLinkLimit"),
    videoCount: document.getElementById("shopeeRemixVideoCount"),
    duration: document.getElementById("shopeeRemixDuration"),
    editMode: document.getElementById("shopeeRemixEditMode"),
    searchBtn: document.getElementById("shopeeRemixSearchBtn"),
    searchProgress: document.getElementById("shopeeRemixSearchProgress"),
    searchProgressBar: document.querySelector("#shopeeRemixSearchProgress .shopee-remix-progress-track span"),
    searchStatus: document.getElementById("shopeeRemixSearchStatus"),
    productCount: document.getElementById("shopeeRemixProductCount"),
    selectedCount: document.getElementById("shopeeRemixSelectedCount"),
    queueCount: document.getElementById("shopeeRemixQueueCount"),
    completeCount: document.getElementById("shopeeRemixCompleteCount"),
    productList: document.getElementById("shopeeRemixProductList"),
    clearProductsBtn: document.getElementById("shopeeRemixClearProductsBtn"),
    selectAllBtn: document.getElementById("shopeeRemixSelectAllBtn"),
    addQueueBtn: document.getElementById("shopeeRemixAddQueueBtn"),
    queueList: document.getElementById("shopeeRemixQueueList"),
    queueTotalStat: document.getElementById("shopeeRemixQueueTotalStat"),
    queueWaitingStat: document.getElementById("shopeeRemixQueueWaitingStat"),
    queueWorkingStat: document.getElementById("shopeeRemixQueueWorkingStat"),
    queueCompleteStat: document.getElementById("shopeeRemixQueueCompleteStat"),
    queueFailedStat: document.getElementById("shopeeRemixQueueFailedStat"),
    queueProgressText: document.getElementById("shopeeRemixQueueProgressText"),
    queueProgressPercent: document.getElementById("shopeeRemixQueueProgressPercent"),
    queueProgressBar: document.getElementById("shopeeRemixQueueProgressBar"),
    queueVisibleCount: document.getElementById("shopeeRemixQueueVisibleCount"),
    queueFilters: document.querySelectorAll("[data-remix-queue-filter]"),
    retryBtn: document.getElementById("shopeeRemixRetryBtn"),
    clearBtn: document.getElementById("shopeeRemixClearBtn"),
    clearQueueBtn: document.getElementById("shopeeRemixClearQueueBtn"),
    pauseBtn: document.getElementById("shopeeRemixPauseBtn"),
    stopBtn: document.getElementById("shopeeRemixStopBtn"),
    runBtn: document.getElementById("shopeeRemixRunBtn"),
  };
}

function shopeeRemixProductKey(product = {}) {
  const itemId = String(product.id || product.itemid || product.item_id || "").trim();
  const shopId = String(product.shopId || product.shopid || product.shop_id || "").trim();
  return `${shopId || "shop"}:${itemId}`;
}

function shopeeRemixProductUrl(product = {}) {
  return String(product.url || product.productUrl || shopeeDiscoveryProductUrl(product) || "").trim();
}

function shopeeRemixNumberOptions(selected, max = 10) {
  return Array.from({ length: max }, (_, index) => index + 1)
    .map((value) => `<option value="${value}"${Number(selected) === value ? " selected" : ""}>${value} วิดีโอ</option>`)
    .join("");
}

function shopeeRemixDurationOptions(selected) {
  return [10, 15, 20, 25, 30]
    .map((value) => `<option value="${value}"${Number(selected) === value ? " selected" : ""}>${value} วินาที</option>`)
    .join("");
}

function shopeeRemixEditModeOptions(selected) {
  const value = selected === "classic" ? "classic" : "smart";
  return [
    ["smart", "Smart Montage"],
    ["classic", "ต่อคลิปแบบเดิม"],
  ].map(([optionValue, label]) => (
    `<option value="${optionValue}"${value === optionValue ? " selected" : ""}>${label}</option>`
  )).join("");
}

function shopeeRemixStatusLabel(status) {
  const labels = {
    waiting: "รอคิว",
    fetching: "กำลังดึงวิดีโอรีวิว",
    rendering: "กำลัง Remix วิดีโอ",
    complete: "เสร็จแล้ว",
    failed: "ไม่สำเร็จ",
    stopped: "หยุดแล้ว",
  };
  return labels[status] || "รอคิว";
}

function shopeeRemixStatusGroup(status) {
  if (["fetching", "rendering"].includes(status)) return "working";
  if (["failed", "stopped"].includes(status)) return "failed";
  return status || "waiting";
}

function shopeeRemixQueueCounts() {
  return shopeeRemixState.queue.reduce((counts, order) => {
    counts.total += 1;
    const group = shopeeRemixStatusGroup(order.status);
    if (Object.prototype.hasOwnProperty.call(counts, group)) counts[group] += 1;
    return counts;
  }, { total: 0, waiting: 0, working: 0, complete: 0, failed: 0 });
}

function shopeeRemixStepClass(order, step) {
  const status = order.status || "waiting";
  const hasVideos = Array.isArray(order.sourceVideos) && order.sourceVideos.length > 0;
  if (status === "complete") return "is-done";
  if (step === 1) {
    if (status === "fetching") return "is-active";
    if (status === "rendering" || hasVideos) return "is-done";
    if (["failed", "stopped"].includes(status)) return "is-error";
  }
  if (step === 2) {
    if (status === "rendering") return "is-active";
    if (["failed", "stopped"].includes(status) && hasVideos) return "is-error";
  }
  return "";
}

function renderShopeeRemixSummary() {
  const elements = shopeeRemixElements();
  const activeQueue = shopeeRemixState.queue.filter((order) => order.status !== "complete").length;
  const completed = shopeeRemixState.queue.filter((order) => order.status === "complete").length;
  if (elements.productCount) elements.productCount.textContent = String(shopeeRemixState.products.length);
  if (elements.selectedCount) elements.selectedCount.textContent = String(shopeeRemixState.selected.size);
  if (elements.queueCount) elements.queueCount.textContent = String(activeQueue);
  if (elements.completeCount) elements.completeCount.textContent = String(completed);
}

function renderShopeeRemixProducts() {
  const elements = shopeeRemixElements();
  if (!elements.productList) return;
  if (!shopeeRemixState.products.length) {
    elements.productList.innerHTML = `
      <div class="shopee-remix-empty">
        <span class="material-symbols-outlined">search</span>
        <strong>ยังไม่มีสินค้า</strong>
        <p>ใส่คำค้นทางซ้าย แล้วเริ่มค้นหาเพื่อสร้างรายการลิงก์สินค้า</p>
      </div>`;
  } else {
    elements.productList.innerHTML = shopeeRemixState.products.map((product) => {
      const key = shopeeRemixProductKey(product);
      const checked = shopeeRemixState.selected.has(key);
      const productUrl = shopeeRemixProductUrl(product);
      const itemId = String(product.id || product.itemid || "-");
      const shopId = String(product.shopId || product.shopid || "-");
      const commission = Number(product.commissionRate || 0);
      return `
        <article class="shopee-remix-product${checked ? " is-selected" : ""}" data-remix-product="${escapeHtml(key)}">
          <label class="shopee-remix-check" aria-label="เลือกสินค้า">
            <input type="checkbox" data-remix-product-check="${escapeHtml(key)}"${checked ? " checked" : ""}>
            <span></span>
          </label>
          <img src="${escapeHtml(product.image || "")}" alt="" loading="lazy">
          <div class="shopee-remix-product-copy">
            <div class="shopee-remix-product-title-row">
              <strong title="${escapeHtml(product.title || "สินค้า Shopee")}">${escapeHtml(product.title || "สินค้า Shopee")}</strong>
              <span class="shopee-remix-keyword">${escapeHtml(product._keyword || "Shopee")}</span>
            </div>
            <div class="shopee-remix-product-metrics">
              <span>ราคา ${escapeHtml(formatDiscoveryPriceRange(product))}</span>
              <span>ค่าคอม ${commission ? `${formatDiscoveryNumber(commission, 2)}%` : "-"}</span>
              <span>ขายแล้ว ${escapeHtml(formatDiscoveryNumber(product.historicalSold || product.sold || 0))}</span>
              <span>ร้าน ${escapeHtml(product.shop || "-")}</span>
            </div>
            <p class="shopee-remix-product-id">Shop ${escapeHtml(shopId)} · Item ${escapeHtml(itemId)}</p>
          </div>
          <button class="icon-btn shopee-remix-open-product" type="button" data-remix-open-product="${escapeHtml(key)}" title="เปิดลิงก์สินค้า"${productUrl ? "" : " disabled"}>
            <span class="material-symbols-outlined">open_in_new</span>
          </button>
        </article>`;
    }).join("");
  }

  const hasProducts = shopeeRemixState.products.length > 0;
  if (elements.clearProductsBtn) elements.clearProductsBtn.disabled = !hasProducts || shopeeRemixState.searching;
  if (elements.selectAllBtn) elements.selectAllBtn.disabled = !hasProducts || shopeeRemixState.searching;
  if (elements.addQueueBtn) elements.addQueueBtn.disabled = !shopeeRemixState.selected.size || shopeeRemixState.running;
  renderShopeeRemixSummary();
}

function renderShopeeRemixQueue() {
  const elements = shopeeRemixElements();
  if (!elements.queueList) return;
  const counts = shopeeRemixQueueCounts();
  const finished = counts.complete + counts.failed;
  const progress = counts.total ? Math.round((finished / counts.total) * 100) : 0;
  const activeOrder = shopeeRemixState.queue.find((order) => ["fetching", "rendering"].includes(order.status));

  if (elements.queueTotalStat) elements.queueTotalStat.textContent = String(counts.total);
  if (elements.queueWaitingStat) elements.queueWaitingStat.textContent = String(counts.waiting);
  if (elements.queueWorkingStat) elements.queueWorkingStat.textContent = String(counts.working);
  if (elements.queueCompleteStat) elements.queueCompleteStat.textContent = String(counts.complete);
  if (elements.queueFailedStat) elements.queueFailedStat.textContent = String(counts.failed);
  if (elements.queueProgressPercent) elements.queueProgressPercent.textContent = `${progress}%`;
  if (elements.queueProgressBar) elements.queueProgressBar.style.width = `${progress}%`;
  if (elements.queueProgressText) {
    if (!counts.total) elements.queueProgressText.textContent = "ยังไม่มีงานใน Queue";
    else if (shopeeRemixState.paused) elements.queueProgressText.textContent = `พักการทำงาน · เหลือ ${counts.waiting} งาน`;
    else if (activeOrder) elements.queueProgressText.textContent = `${shopeeRemixStatusLabel(activeOrder.status)} · ${activeOrder.id}`;
    else elements.queueProgressText.textContent = `จบแล้ว ${finished}/${counts.total} งาน · รอทำ ${counts.waiting} งาน`;
  }

  elements.queueFilters?.forEach((button) => {
    const active = button.dataset.remixQueueFilter === shopeeRemixState.queueFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  const visibleOrders = shopeeRemixState.queue.filter((order) => {
    if (shopeeRemixState.queueFilter === "all") return true;
    return shopeeRemixStatusGroup(order.status) === shopeeRemixState.queueFilter;
  });
  if (elements.queueVisibleCount) {
    elements.queueVisibleCount.textContent = counts.total
      ? `${visibleOrders.length} จาก ${counts.total} งาน`
      : "0 งาน";
  }

  if (!counts.total) {
    elements.queueList.innerHTML = `
      <div class="shopee-remix-empty shopee-remix-empty-compact">
        <span class="material-symbols-outlined">movie_filter</span>
        <strong>Queue ว่าง</strong>
        <p>เลือกสินค้าจากรายการด้านบนแล้วส่งเข้า Queue</p>
      </div>`;
  } else if (!visibleOrders.length) {
    elements.queueList.innerHTML = `
      <div class="shopee-remix-empty shopee-remix-empty-compact">
        <span class="material-symbols-outlined">filter_alt_off</span>
        <strong>ไม่มีงานในสถานะนี้</strong>
        <p>เลือกตัวกรองอื่นเพื่อดูงานที่อยู่ใน Queue</p>
      </div>`;
  } else {
    elements.queueList.innerHTML = visibleOrders.map((order) => {
      const product = order.product;
      const locked = ["fetching", "rendering"].includes(order.status);
      const videoCandidates = Array.isArray(order.videoCandidates) && order.videoCandidates.length
        ? order.videoCandidates
        : order.sourceVideos;
      const videosFound = Array.isArray(videoCandidates) ? videoCandidates.length : 0;
      const productUrl = shopeeRemixProductUrl(product);
      const itemId = String(product.id || product.itemid || "-");
      const shopId = String(product.shopId || product.shopid || "-");
      return `
        <article class="shopee-remix-order is-${escapeHtml(order.status)}" data-remix-order="${escapeHtml(order.id)}">
          <img src="${escapeHtml(product.image || "")}" alt="" loading="lazy">
          <div class="shopee-remix-order-main">
            <div class="shopee-remix-order-heading">
              <span>${escapeHtml(order.id)}</span>
              <strong title="${escapeHtml(product.title || "สินค้า Shopee")}">${escapeHtml(product.title || "สินค้า Shopee")}</strong>
            </div>
            <div class="shopee-remix-order-meta">
              <span>Shop ${escapeHtml(shopId)} · Item ${escapeHtml(itemId)}</span>
              <a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">เปิดหน้าสินค้า</a>
            </div>
            <div class="shopee-remix-order-controls">
              <label>วิดีโอ
                <select data-remix-order-videos="${escapeHtml(order.id)}"${locked ? " disabled" : ""}>${shopeeRemixNumberOptions(order.videoCount)}</select>
              </label>
              <label>ความยาว
                <select data-remix-order-duration="${escapeHtml(order.id)}"${locked ? " disabled" : ""}>${shopeeRemixDurationOptions(order.durationSeconds)}</select>
              </label>
              <label>รูปแบบ
                <select data-remix-order-edit-mode="${escapeHtml(order.id)}"${locked ? " disabled" : ""}>${shopeeRemixEditModeOptions(order.editMode)}</select>
              </label>
              <span>${videosFound ? `พบ ${videosFound} คลิป · สุ่มใช้ ${Math.min(order.videoCount, videosFound)}` : "ยังไม่ดึงคลิป"}</span>
            </div>
            <div class="shopee-remix-order-steps" aria-label="ขั้นตอนประมวลผล">
              <span class="${shopeeRemixStepClass(order, 1)}"><i>1</i><em>ดึงวิดีโอ</em></span>
              <b></b>
              <span class="${shopeeRemixStepClass(order, 2)}"><i>2</i><em>Remix</em></span>
              <b></b>
              <span class="${shopeeRemixStepClass(order, 3)}"><i>3</i><em>Final</em></span>
            </div>
          </div>
          <div class="shopee-remix-order-state">
            <span class="shopee-remix-status is-${escapeHtml(order.status)}">${escapeHtml(shopeeRemixStatusLabel(order.status))}</span>
            ${order.error ? `<small title="${escapeHtml(order.error)}">${escapeHtml(order.error)}</small>` : ""}
            ${order.status === "complete" && order.result?.url ? `
              <button class="shopee-remix-result-btn" type="button" data-remix-preview="${escapeHtml(order.id)}">
                <span class="material-symbols-outlined">play_circle</span>
                ดูผลลัพธ์
              </button>` : ""}
          </div>
          <button class="icon-btn shopee-remix-remove-order" type="button" data-remix-remove-order="${escapeHtml(order.id)}" title="นำออกจาก Queue"${locked ? " disabled" : ""}>
            <span class="material-symbols-outlined">close</span>
          </button>
        </article>`;
    }).join("");
  }

  const waiting = counts.waiting > 0;
  const retryable = counts.failed > 0;
  const completed = counts.complete > 0;
  if (elements.runBtn) elements.runBtn.disabled = shopeeRemixState.running || !waiting;
  if (elements.pauseBtn) {
    elements.pauseBtn.disabled = !shopeeRemixState.running;
    elements.pauseBtn.innerHTML = shopeeRemixState.paused
      ? '<span class="material-symbols-outlined">play_arrow</span> ดำเนินการต่อ'
      : '<span class="material-symbols-outlined">pause</span> พัก';
  }
  if (elements.stopBtn) elements.stopBtn.disabled = !shopeeRemixState.running;
  if (elements.retryBtn) elements.retryBtn.disabled = shopeeRemixState.running || !retryable;
  if (elements.clearBtn) elements.clearBtn.disabled = shopeeRemixState.running || !completed;
  if (elements.clearQueueBtn) elements.clearQueueBtn.disabled = shopeeRemixState.running || !counts.total;
  renderShopeeRemixSummary();
}

function setShopeeRemixSearchProgress(message, current = 0, total = 0, visible = true) {
  const elements = shopeeRemixElements();
  if (elements.searchProgress) elements.searchProgress.hidden = !visible;
  if (elements.searchStatus) elements.searchStatus.textContent = message;
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
  if (elements.searchProgressBar) elements.searchProgressBar.style.width = `${percent}%`;
}

async function readShopeeRemixJson(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server ตอบกลับไม่ใช่ JSON (HTTP ${response.status})`);
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload || {};
}

async function searchShopeeRemixProducts() {
  const elements = shopeeRemixElements();
  if (shopeeRemixState.searching || !elements.keywords) return;
  const keywords = [...new Set(String(elements.keywords.value || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean))];
  if (!keywords.length) {
    setShopeeRemixSearchProgress("กรุณาใส่คำค้นอย่างน้อย 1 บรรทัด", 0, 0, true);
    elements.keywords.focus();
    return;
  }

  const limit = Math.max(0, Number(elements.linkLimit?.value || 10));
  shopeeRemixState.searching = true;
  shopeeRemixState.products = [];
  shopeeRemixState.selected.clear();
  elements.searchBtn.disabled = true;
  elements.searchBtn.innerHTML = '<span class="material-symbols-outlined shopee-remix-spin">progress_activity</span> กำลังค้นหา';
  renderShopeeRemixProducts();
  const seen = new Set();
  const errors = [];

  try {
    for (let index = 0; index < keywords.length; index += 1) {
      const keyword = keywords[index];
      setShopeeRemixSearchProgress(`กำลังค้นหา “${keyword}” (${index + 1}/${keywords.length})`, index, keywords.length, true);
      try {
        const response = await fetch("/api/shopee/products/search", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            keyword,
            offerType: "0",
            sortType: "2",
            filterTypes: [],
            maxResults: limit,
          }),
        });
        const payload = await readShopeeRemixJson(response);
        const products = Array.isArray(payload.products) ? payload.products : [];
        const limitedProducts = limit > 0 ? products.slice(0, limit) : products;
        for (const rawProduct of limitedProducts) {
          const product = { ...rawProduct, _keyword: keyword };
          const key = shopeeRemixProductKey(product);
          if (!key.endsWith(":") && !seen.has(key)) {
            seen.add(key);
            shopeeRemixState.products.push(product);
          }
        }
        renderShopeeRemixProducts();
      } catch (error) {
        errors.push(`${keyword}: ${error.message || error}`);
      }
      setShopeeRemixSearchProgress(`ค้นหา “${keyword}” แล้ว · พบรวม ${shopeeRemixState.products.length} ลิงก์`, index + 1, keywords.length, true);
    }

    const summary = errors.length
      ? `ค้นหาเสร็จ ${keywords.length - errors.length}/${keywords.length} คำ · พบ ${shopeeRemixState.products.length} ลิงก์ · ${errors.length} คำมีปัญหา`
      : `ค้นหาครบ ${keywords.length} คำ · พบ ${shopeeRemixState.products.length} ลิงก์`;
    setShopeeRemixSearchProgress(summary, keywords.length, keywords.length, true);
  } finally {
    shopeeRemixState.searching = false;
    elements.searchBtn.disabled = false;
    elements.searchBtn.innerHTML = '<span class="material-symbols-outlined">manage_search</span> เริ่มค้นหาสินค้า';
    renderShopeeRemixProducts();
  }
}

function toggleShopeeRemixProduct(key, force) {
  const checked = typeof force === "boolean" ? force : !shopeeRemixState.selected.has(key);
  if (checked) shopeeRemixState.selected.add(key);
  else shopeeRemixState.selected.delete(key);
  renderShopeeRemixProducts();
}

function toggleAllShopeeRemixProducts() {
  const shouldSelect = shopeeRemixState.products.some((product) => !shopeeRemixState.selected.has(shopeeRemixProductKey(product)));
  shopeeRemixState.selected.clear();
  if (shouldSelect) {
    for (const product of shopeeRemixState.products) shopeeRemixState.selected.add(shopeeRemixProductKey(product));
  }
  renderShopeeRemixProducts();
}

function addSelectedShopeeRemixToQueue() {
  const elements = shopeeRemixElements();
  const existing = new Set(shopeeRemixState.queue.map((order) => shopeeRemixProductKey(order.product)));
  const videoCount = Math.max(1, Math.min(10, Number(elements.videoCount?.value || 3)));
  const durationSeconds = Math.max(10, Math.min(30, Number(elements.duration?.value || 15)));
  const editMode = elements.editMode?.value === "classic" ? "classic" : "smart";
  for (const product of shopeeRemixState.products) {
    const key = shopeeRemixProductKey(product);
    if (!shopeeRemixState.selected.has(key) || existing.has(key)) continue;
    shopeeRemixState.queue.push({
      id: `SR-${Date.now().toString().slice(-7)}-${String(shopeeRemixState.queue.length + 1).padStart(2, "0")}`,
      product: { ...product },
      videoCount,
      durationSeconds,
      editMode,
      sourceVideos: [],
      videoCandidates: [],
      reviewComments: [],
      status: "waiting",
      error: "",
      result: null,
    });
    existing.add(key);
  }
  shopeeRemixState.selected.clear();
  renderShopeeRemixProducts();
  renderShopeeRemixQueue();
}

function waitForShopeeRemixResume() {
  return new Promise((resolve) => {
    const check = () => {
      if (!shopeeRemixState.paused || shopeeRemixState.stopRequested) resolve();
      else setTimeout(check, 250);
    };
    check();
  });
}

async function processShopeeRemixOrder(order) {
  const productUrl = shopeeRemixProductUrl(order.product);
  const itemId = String(order.product.id || order.product.itemid || "").trim();
  const shopId = String(order.product.shopId || order.product.shopid || "").trim();
  if (!itemId || !shopId) throw new Error("สินค้าไม่มี Shop ID หรือ Item ID");

  order.status = "fetching";
  order.error = "";
  order.sourceVideos = [];
  order.videoCandidates = [];
  order.reviewComments = [];
  renderShopeeRemixQueue();
  const videoController = new AbortController();
  shopeeRemixState.currentAbortController = videoController;
  const videoResponse = await fetch("/api/shopee/remix/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    signal: videoController.signal,
    body: JSON.stringify({
      product: {
        id: itemId,
        shopId,
        title: order.product.title || "",
        url: productUrl,
      },
      limit: order.videoCount,
    }),
  });
  const videoPayload = await readShopeeRemixJson(videoResponse);
  const selectedVideos = Array.isArray(videoPayload.videos) ? videoPayload.videos : [];
  const candidates = Array.isArray(videoPayload.candidates) ? videoPayload.candidates : [];
  order.reviewComments = Array.isArray(videoPayload.reviewComments) ? videoPayload.reviewComments : [];
  order.videoCandidates = candidates.length ? candidates : selectedVideos;
  order.sourceVideos = selectedVideos.length
    ? selectedVideos
    : order.videoCandidates.slice(0, order.videoCount);
  if (!order.videoCandidates.length) throw new Error("ไม่พบวิดีโอรีวิวจาก Rating API");
  renderShopeeRemixQueue();

  await waitForShopeeRemixResume();
  if (shopeeRemixState.stopRequested) throw new DOMException("หยุดโดยผู้ใช้", "AbortError");
  order.status = "rendering";
  renderShopeeRemixQueue();
  const renderController = new AbortController();
  shopeeRemixState.currentAbortController = renderController;
  const renderResponse = await fetch("/api/shopee/remix/render", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    signal: renderController.signal,
    body: JSON.stringify({
      jobId: order.id,
      product: {
        ...order.product,
        id: itemId,
        shopId,
        url: productUrl,
      },
      videos: order.videoCandidates,
      reviewComments: order.reviewComments,
      videoCount: order.videoCount,
      durationSeconds: order.durationSeconds,
      editMode: order.editMode === "classic" ? "classic" : "smart",
    }),
  });
  order.result = await readShopeeRemixJson(renderResponse);
  if (Array.isArray(order.result?.metadata?.sourceVideos)) {
    order.sourceVideos = order.result.metadata.sourceVideos;
  }
  order.status = "complete";
  order.error = "";
}

async function runShopeeRemixQueue() {
  if (shopeeRemixState.running) return;
  shopeeRemixState.running = true;
  shopeeRemixState.stopRequested = false;
  shopeeRemixState.paused = false;
  renderShopeeRemixQueue();
  try {
    while (!shopeeRemixState.stopRequested) {
      const order = shopeeRemixState.queue.find((item) => item.status === "waiting");
      if (!order) break;
      await waitForShopeeRemixResume();
      if (shopeeRemixState.stopRequested) break;
      try {
        await processShopeeRemixOrder(order);
      } catch (error) {
        const stopped = error?.name === "AbortError" || shopeeRemixState.stopRequested;
        order.status = stopped ? "stopped" : "failed";
        order.error = stopped ? "หยุดโดยผู้ใช้" : String(error.message || error);
      } finally {
        shopeeRemixState.currentAbortController = null;
        renderShopeeRemixQueue();
      }
    }
  } finally {
    shopeeRemixState.running = false;
    shopeeRemixState.paused = false;
    shopeeRemixState.currentAbortController = null;
    renderShopeeRemixQueue();
  }
}

function toggleShopeeRemixPause() {
  if (!shopeeRemixState.running) return;
  shopeeRemixState.paused = !shopeeRemixState.paused;
  renderShopeeRemixQueue();
}

function stopShopeeRemixQueue() {
  if (!shopeeRemixState.running) return;
  shopeeRemixState.stopRequested = true;
  shopeeRemixState.paused = false;
  shopeeRemixState.currentAbortController?.abort();
  renderShopeeRemixQueue();
}

function retryShopeeRemixFailed() {
  for (const order of shopeeRemixState.queue) {
    if (!["failed", "stopped"].includes(order.status)) continue;
    order.status = "waiting";
    order.error = "";
    order.result = null;
  }
  renderShopeeRemixQueue();
  runShopeeRemixQueue();
}

function clearShopeeRemixCompleted() {
  shopeeRemixState.queue = shopeeRemixState.queue.filter((order) => order.status !== "complete");
  renderShopeeRemixQueue();
}

function ensureShopeeRemixClearModal() {
  let modal = document.getElementById("shopeeRemixClearModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "shopeeRemixClearModal";
  modal.className = "post-account-delete-modal";
  modal.innerHTML = `
    <div class="post-account-delete-backdrop" data-remix-clear-cancel></div>
    <section class="post-account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="shopeeRemixClearTitle">
      <button class="flow-prompt-close" type="button" data-remix-clear-cancel aria-label="ปิด">
        <span class="material-symbols-outlined">close</span>
      </button>
      <p class="eyebrow">Clear Remix Workspace</p>
      <h3 id="shopeeRemixClearTitle" data-remix-clear-title>ยืนยันการล้างรายการ?</h3>
      <p class="post-account-delete-note" data-remix-clear-note></p>
      <div class="post-account-delete-preview" data-remix-clear-preview></div>
      <div class="post-account-delete-actions">
        <button class="outline-btn" type="button" data-remix-clear-cancel>ยกเลิก</button>
        <button class="danger-btn" type="button" data-remix-clear-confirm>
          <span class="material-symbols-outlined">delete_sweep</span>
          <span data-remix-clear-confirm-label>ยืนยันล้าง</span>
        </button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  return modal;
}

function confirmShopeeRemixClear(kind, count) {
  const modal = ensureShopeeRemixClearModal();
  const isQueue = kind === "queue";
  const title = modal.querySelector("[data-remix-clear-title]");
  const note = modal.querySelector("[data-remix-clear-note]");
  const preview = modal.querySelector("[data-remix-clear-preview]");
  const confirmLabel = modal.querySelector("[data-remix-clear-confirm-label]");
  const confirmButton = modal.querySelector("[data-remix-clear-confirm]");
  const cancelButtons = modal.querySelectorAll("[data-remix-clear-cancel]");

  if (title) title.textContent = isQueue ? "ยืนยันล้าง Queue ทั้งหมด?" : "ยืนยันล้างสินค้าที่ค้นพบ?";
  if (note) {
    note.textContent = isQueue
      ? "งานทุกสถานะจะถูกนำออกจาก Queue แต่ไฟล์ Final ที่สร้างไว้แล้วจะไม่ถูกลบ"
      : "รายการสินค้าที่ค้นพบและการเลือกทั้งหมดจะถูกล้าง โดยงานที่ส่งเข้า Queue แล้วจะยังอยู่";
  }
  if (preview) {
    preview.innerHTML = `
      <span class="material-symbols-outlined post-account-avatar-fallback">${isQueue ? "queue" : "inventory_2"}</span>
      <div>
        <strong>${escapeHtml(count)} ${isQueue ? "งานใน Queue" : "รายการสินค้า"}</strong>
        <span>${isQueue ? "ไฟล์วิดีโอ Final จะยังอยู่ครบ" : "พร้อมเริ่มค้นหาชุดใหม่หลังล้าง"}</span>
      </div>`;
  }
  if (confirmLabel) confirmLabel.textContent = isQueue ? "ล้าง Queue" : "ล้างรายการ";

  return new Promise((resolve) => {
    const finish = (confirmed) => {
      cancelButtons.forEach((button) => { button.onclick = null; });
      if (confirmButton) confirmButton.onclick = null;
      modal.classList.remove("is-open");
      resolve(confirmed);
    };
    cancelButtons.forEach((button) => { button.onclick = () => finish(false); });
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.onclick = () => finish(true);
    }
    modal.classList.add("is-open");
  });
}

async function clearShopeeRemixProducts() {
  if (shopeeRemixState.searching || !shopeeRemixState.products.length) return;
  const confirmed = await confirmShopeeRemixClear("products", shopeeRemixState.products.length);
  if (!confirmed) return;
  shopeeRemixState.products = [];
  shopeeRemixState.selected.clear();
  setShopeeRemixSearchProgress("", 0, 0, false);
  renderShopeeRemixProducts();
}

async function clearShopeeRemixQueue() {
  if (shopeeRemixState.running || !shopeeRemixState.queue.length) return;
  const confirmed = await confirmShopeeRemixClear("queue", shopeeRemixState.queue.length);
  if (!confirmed) return;
  shopeeRemixState.queue = [];
  shopeeRemixState.queueFilter = "all";
  shopeeRemixState.paused = false;
  shopeeRemixState.stopRequested = false;
  shopeeRemixState.currentAbortController = null;
  renderShopeeRemixQueue();
}

function openShopeeRemixPreview(order) {
  if (!order?.result?.url) return;
  document.getElementById("shopeeRemixPreviewModal")?.remove();
  const sourceClipCount = Number(order.result.clipCount || order.sourceVideos.length || 0);
  const shotCount = Number(order.result.shotCount || order.result.metadata?.shotCount || 0);
  const editModeLabel = order.result.editMode === "classic" ? "ต่อคลิปแบบเดิม" : "Smart Montage";
  const shotSummary = shotCount > 0 ? ` · ${shotCount} ช็อต` : "";
  const modal = document.createElement("div");
  modal.id = "shopeeRemixPreviewModal";
  modal.className = "shopee-remix-modal is-open";
  modal.innerHTML = `
    <div class="shopee-remix-modal-card" role="dialog" aria-modal="true" aria-label="ผลลัพธ์ Remix วิดีโอ">
      <button class="icon-btn shopee-remix-modal-close" type="button" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>
      <div class="shopee-remix-modal-head">
        <p class="eyebrow">Final Video</p>
        <h2>${escapeHtml(order.product.title || "Remix วิดีโอรีวิว Shopee")}</h2>
        <p>${escapeHtml(sourceClipCount)} คลิปต้นฉบับ${escapeHtml(shotSummary)} · ${escapeHtml(order.durationSeconds)} วินาที · ${escapeHtml(editModeLabel)}</p>
      </div>
      <video controls preload="metadata" src="${escapeHtml(order.result.url)}"></video>
      <div class="shopee-remix-modal-actions">
        <a class="primary-btn" href="${escapeHtml(order.result.url)}" target="_blank" rel="noopener noreferrer">
          <span class="material-symbols-outlined">open_in_new</span> เปิดไฟล์วิดีโอ
        </a>
      </div>
    </div>`;
  const close = () => modal.remove();
  modal.querySelector(".shopee-remix-modal-close")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.body.appendChild(modal);
}

function initShopeeRemix() {
  const elements = shopeeRemixElements();
  if (!elements.panel) return;
  if (!shopeeRemixState.initialized) {
    shopeeRemixState.initialized = true;
    elements.searchBtn?.addEventListener("click", searchShopeeRemixProducts);
    elements.clearProductsBtn?.addEventListener("click", clearShopeeRemixProducts);
    elements.selectAllBtn?.addEventListener("click", toggleAllShopeeRemixProducts);
    elements.addQueueBtn?.addEventListener("click", addSelectedShopeeRemixToQueue);
    elements.runBtn?.addEventListener("click", runShopeeRemixQueue);
    elements.pauseBtn?.addEventListener("click", toggleShopeeRemixPause);
    elements.stopBtn?.addEventListener("click", stopShopeeRemixQueue);
    elements.retryBtn?.addEventListener("click", retryShopeeRemixFailed);
    elements.clearBtn?.addEventListener("click", clearShopeeRemixCompleted);
    elements.clearQueueBtn?.addEventListener("click", clearShopeeRemixQueue);
    elements.panel.querySelector(".shopee-remix-queue-filters")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remix-queue-filter]");
      if (!button) return;
      shopeeRemixState.queueFilter = button.dataset.remixQueueFilter || "all";
      renderShopeeRemixQueue();
    });
    elements.productList?.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-remix-open-product]");
      if (openButton) {
        const product = shopeeRemixState.products.find((item) => shopeeRemixProductKey(item) === openButton.dataset.remixOpenProduct);
        const url = shopeeRemixProductUrl(product);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      const checkbox = event.target.closest("[data-remix-product-check]");
      if (checkbox) {
        toggleShopeeRemixProduct(checkbox.dataset.remixProductCheck, checkbox.checked);
        return;
      }
      const card = event.target.closest("[data-remix-product]");
      if (card) toggleShopeeRemixProduct(card.dataset.remixProduct);
    });
    elements.queueList?.addEventListener("change", (event) => {
      const videoSelect = event.target.closest("[data-remix-order-videos]");
      const durationSelect = event.target.closest("[data-remix-order-duration]");
      const editModeSelect = event.target.closest("[data-remix-order-edit-mode]");
      const id = videoSelect?.dataset.remixOrderVideos
        || durationSelect?.dataset.remixOrderDuration
        || editModeSelect?.dataset.remixOrderEditMode;
      const order = shopeeRemixState.queue.find((item) => item.id === id);
      if (!order) return;
      if (videoSelect) order.videoCount = Math.max(1, Math.min(10, Number(videoSelect.value || 1)));
      if (durationSelect) order.durationSeconds = Math.max(10, Math.min(30, Number(durationSelect.value || 10)));
      if (editModeSelect) order.editMode = editModeSelect.value === "classic" ? "classic" : "smart";
    });
    elements.queueList?.addEventListener("click", (event) => {
      const previewButton = event.target.closest("[data-remix-preview]");
      if (previewButton) {
        openShopeeRemixPreview(shopeeRemixState.queue.find((order) => order.id === previewButton.dataset.remixPreview));
        return;
      }
      const removeButton = event.target.closest("[data-remix-remove-order]");
      if (removeButton) {
        shopeeRemixState.queue = shopeeRemixState.queue.filter((order) => order.id !== removeButton.dataset.remixRemoveOrder);
        renderShopeeRemixQueue();
      }
    });
  }
  renderShopeeRemixProducts();
  renderShopeeRemixQueue();
}

setShopeeVideoRankEnabled(false, { quiet: true });
renderMobilePostWorkspace();
renderShowcaseSelectedAccount();
ensureLogDock();
startLiveLogPolling();
setRoute(location.hash.slice(1) || "home");



















