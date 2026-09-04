let state = null;
let selectedChannelId = null;
let selectedVideos = new Set();
let selectedManageVideos = new Set();
let selectedBinVideos = new Set();
let selectedQueueItems = new Set();
let activeView = "dashboard";
let latestDevices = [];
let selectedDeviceUdid = "";
let editingChannelId = null;
let hideOfflineChannels = false;
let licenseState = null;
let pendingDeleteConfirm = null;
let pendingScheduleScope = null;
let logsPanelOpen = localStorage.getItem("atg_logs_panel_open") === "1";
let libraryPanelOpen = localStorage.getItem("atg_library_panel_open") !== "0";

const LICENSE_STORAGE_KEY = "atg_license_state";
const PROGRAM_SESSION_KEY = "atg_program_session";
const LOGIN_MESSAGE_KEY = "atg_login_message";
const LICENSE_CHECK_INTERVAL_MS = 60 * 1000;
const LIBRARY_SCAN_INTERVAL_MS = 60 * 1000;
const THUMB_VERSION = "real-thumb-v1";
let libraryScanRunning = false;

const $ = (id) => document.getElementById(id);
const numericId = (value) => Number(value);
const videoThumbSrc = (videoId) => `/api/videos/${videoId}/thumb?v=${THUMB_VERSION}`;
const urlParams = new URLSearchParams(window.location.search);
const isDesktopApp = urlParams.get("desktop") === "1";
const useNativeTitlebar = urlParams.get("nativebar") === "1";

function libraryCardMeta(video) {
  const title = String(video.product_name || "");
  const caption = String(video.caption || video.description || "");
  if (caption && caption !== title) return caption;
  return "";
}

function initDesktopShell() {
  if (!isDesktopApp) return;
  document.body.classList.add("desktop-app");
  if (useNativeTitlebar) {
    document.body.classList.add("native-titlebar");
    return;
  }
  $("desktopResizeHandles")?.classList.remove("hidden");
  document.querySelector(".desktop-window-controls")?.classList.remove("hidden");
  $("desktopMinimizeBtn")?.addEventListener("click", () => window.pywebview?.api?.minimize?.());
  let maximizeBusy = false;
  $("desktopMaximizeBtn")?.addEventListener("click", async () => {
    if (maximizeBusy) return;
    maximizeBusy = true;
    try {
      await window.pywebview?.api?.toggle_maximize?.();
    } finally {
      setTimeout(() => {
        maximizeBusy = false;
      }, 600);
    }
  });
  $("desktopCloseBtn")?.addEventListener("click", () => window.pywebview?.api?.close?.());
  document.querySelector(".app-brand")?.addEventListener("dblclick", () => $("desktopMaximizeBtn")?.click());
  document.querySelectorAll("[data-resize-edge]").forEach((handle) => {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const edge = handle.dataset.resizeEdge;
      let lastX = event.screenX;
      let lastY = event.screenY;
      const onMove = (moveEvent) => {
        const dx = moveEvent.screenX - lastX;
        const dy = moveEvent.screenY - lastY;
        lastX = moveEvent.screenX;
        lastY = moveEvent.screenY;
        window.pywebview?.api?.resize_from_edge?.(edge, dx, dy);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.classList.remove("is-resizing-window");
      };
      document.body.classList.add("is-resizing-window");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

initDesktopShell();

function applyShellPanelState() {
  document.body.classList.toggle("logs-panel-open", logsPanelOpen);
  document.body.classList.toggle("library-panel-collapsed", !libraryPanelOpen);
  $("toggleLibraryBtn")?.classList.toggle("active", libraryPanelOpen);
  if ($("closeLogsBtn")) $("closeLogsBtn").textContent = logsPanelOpen ? "expand_more" : "expand_less";
  localStorage.setItem("atg_logs_panel_open", logsPanelOpen ? "1" : "0");
  localStorage.setItem("atg_library_panel_open", libraryPanelOpen ? "1" : "0");
}

function toggleLogsPanel(open = !logsPanelOpen) {
  logsPanelOpen = Boolean(open);
  applyShellPanelState();
}

function toggleLibraryPanel(open = !libraryPanelOpen) {
  libraryPanelOpen = Boolean(open);
  applyShellPanelState();
}

function closestScrollable(element) {
  let node = element;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    if (canScrollY) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

document.addEventListener(
  "wheel",
  (event) => {
    const scrollTarget = closestScrollable(event.target);
    if (!scrollTarget || scrollTarget === document.scrollingElement) return;
    const before = scrollTarget.scrollTop;
    scrollTarget.scrollTop += event.deltaY;
    if (scrollTarget.scrollTop !== before) event.preventDefault();
  },
  { passive: false }
);

applyShellPanelState();

async function api(path, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let resp;
  try {
    resp = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      signal: controller?.signal,
      ...fetchOptions,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("เชื่อมต่อ license server ช้าเกินไป กรุณาลองใหม่");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function apiWithTimeout(path, options = {}, timeoutMs = 12000) {
  return api(path, {
    timeoutMs,
    headers: { "Content-Type": "application/json" },
    ...options,
  });
}

function getLicenseState() {
  try {
    return JSON.parse(localStorage.getItem(LICENSE_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveLicenseState(nextState) {
  localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(nextState));
  licenseState = nextState;
}

function clearLicenseState() {
  localStorage.removeItem(LICENSE_STORAGE_KEY);
  sessionStorage.removeItem(PROGRAM_SESSION_KEY);
  licenseState = null;
}

function isLicenseExpired(expiresAt) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

// Login removed — nothing to redirect to. Kept as a no-op so the existing error
// paths that called it just surface the message instead of navigating away.
function redirectToLogin(message = "") {
  if (message) console.warn("[app]", message);
}

async function validateSerial(serial) {
  return apiWithTimeout("/api/license/validate", {
    method: "POST",
    body: JSON.stringify({ serial: String(serial || "").trim() }),
  }, 12000);
}

async function revalidateCurrentLicense() {
  const saved = getLicenseState();
  if (!saved?.serial || isLicenseExpired(saved.expiresAt)) {
    clearLicenseState();
    return { ok: false, error: "กรุณา login ใหม่" };
  }
  try {
    const result = await validateSerial(saved.serial);
    saveLicenseState(result.state);
    return result;
  } catch (error) {
    clearLicenseState();
    return { ok: false, error: error.message || "ตรวจสอบ license ไม่สำเร็จ" };
  }
}

async function refresh() {
  const res = await api("/api/state");
  state = res.data;
  // POST WEB can post any listed video, so only the device-queue views prune a
  // selection down to library-status videos (otherwise this 5s refresh would
  // clear what the user just ticked for TikTok).
  const assignableVideoIds = new Set(
    (state.videos || [])
      .filter((video) => activeView === "postweb" || video.status === "library")
      .map((video) => numericId(video.id))
  );
  const visibleVideoIds = new Set((state.videos || []).map((video) => numericId(video.id)));
  selectedVideos.forEach((id) => {
    if (!assignableVideoIds.has(numericId(id))) selectedVideos.delete(id);
  });
  selectedManageVideos.forEach((id) => {
    if (!visibleVideoIds.has(numericId(id))) selectedManageVideos.delete(id);
  });
  const visibleBinVideoIds = new Set((state.bin_videos || []).map((video) => numericId(video.id)));
  selectedBinVideos.forEach((id) => {
    if (!visibleBinVideoIds.has(numericId(id))) selectedBinVideos.delete(id);
  });
  if (selectedChannelId && !(state.channels || []).some((channel) => numericId(channel.id) === numericId(selectedChannelId))) {
    selectedChannelId = null;
  }
  if (!selectedChannelId && state.channels[0]) selectedChannelId = numericId(state.channels[0].id);
  if (state.auto_random?.enabled && state.auto_random?.interval_minutes && document.activeElement !== $("intervalMinutes")) {
    $("intervalMinutes").value = state.auto_random.interval_minutes;
  }
  if (state.auto_random?.enabled && state.auto_random?.scheduled_at && document.activeElement !== $("scheduleAt")) {
    $("scheduleAt").value = String(state.auto_random.scheduled_at).slice(0, 16);
  }
  render();
}

async function scanCurrentLibraryFolder() {
  if (libraryScanRunning) return;
  libraryScanRunning = true;
  try {
    const res = await api("/api/videos/scan-library", { method: "POST", body: "{}" });
    if ((res.count || 0) > 0) await refresh();
  } finally {
    libraryScanRunning = false;
  }
}

function currentChannel() {
  return state?.channels.find((channel) => numericId(channel.id) === numericId(selectedChannelId));
}

function queueForSelectedChannel() {
  return (state?.queue || []).filter((item) => numericId(item.channel_id) === numericId(selectedChannelId));
}

function deviceStateForUdid(udid) {
  const device = latestDevices.find((item) => String(item.udid) === String(udid));
  return device?.state || "offline";
}

function isChannelOnline(channel) {
  return deviceStateForUdid(channel.udid) === "device";
}

function visibleSidebarChannels() {
  const channels = state?.channels || [];
  return hideOfflineChannels ? channels.filter(isChannelOnline) : channels;
}

async function moveChannel(channelId, direction) {
  const channels = [...(state?.channels || [])];
  const index = channels.findIndex((channel) => numericId(channel.id) === numericId(channelId));
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= channels.length) return;
  [channels[index], channels[targetIndex]] = [channels[targetIndex], channels[index]];
  await api("/api/channels/reorder", {
    method: "POST",
    body: JSON.stringify({ channel_ids: channels.map((channel) => numericId(channel.id)) }),
  });
  await refresh();
}

function formatSchedule(item) {
  if (!item?.scheduled_at) return "Post when started";
  const date = new Date(item.scheduled_at);
  if (Number.isNaN(date.getTime())) return item.scheduled_at;
  return date.toLocaleString("th-TH", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInputSchedule(item) {
  if (!item?.scheduled_at) return "ยังไม่ตั้งเวลา";
  const date = new Date(item.scheduled_at);
  if (Number.isNaN(date.getTime())) return item.scheduled_at;
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBinRetention(video) {
  if (!video?.deleted_at) return "ลบอัตโนมัติใน 7 วัน";
  const enteredAt = new Date(video.deleted_at);
  if (Number.isNaN(enteredAt.getTime())) return "ลบอัตโนมัติใน 7 วัน";
  const expireAt = enteredAt.getTime() + 7 * 24 * 60 * 60 * 1000;
  const diffMs = expireAt - Date.now();
  if (diffMs <= 0) return "รอลบอัตโนมัติ";
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return `ลบอัตโนมัติใน ${days} วัน`;
}

function formatCountdown(item) {
  if (!currentChannel()?.scheduler_enabled) return "รอ Start";
  if (!item?.scheduled_at) return "รอ Start";
  const date = new Date(item.scheduled_at);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "ถึงเวลาโพสต์แล้ว";
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `โพสต์ในอีก ${hours} ชม. ${minutes} นาที`;
  return `โพสต์ในอีก ${minutes} นาที`;
}

function formatCountdownClock(item) {
  if (!currentChannel()?.scheduler_enabled) return "รอ Start";
  if (!item?.scheduled_at) return "รอ Start";
  const date = new Date(item.scheduled_at);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;
  if (hours > 0) {
    return `รอ ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `รอ ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatQueueStatus(item) {
  if (!item?.scheduled_at) return `${item.status} • ยังไม่ตั้งเวลา • รอ Start`;
  return `${item.status} • ${formatCountdown(item)} • ${formatCountdownClock(item)}`;
}

function videoStatusInfo(video) {
  const videoId = numericId(video.id);
  const queueItem = (state.queue || []).find((item) => numericId(item.video_id) === videoId);
  if (queueItem) {
    const labels = {
      pending: "อยู่ในคิว",
      transferring: "กำลังโอน",
      running: "กำลังทำงาน",
      posting: "กำลังโพสต์",
      failed: "ผิดพลาด",
    };
    const channelName = queueItem.channel_name ? ` • ${queueItem.channel_name}` : "";
    return {
      className: queueItem.status || "queued",
      label: `${labels[queueItem.status] || queueItem.status}${channelName}`,
    };
  }
  const labels = {
    library: "ยังไม่ใช้",
    queued: "ถูกเพิ่มแล้ว",
    posted: "โพสต์แล้ว",
    failed: "ผิดพลาด",
  };
  return {
    className: video.status === "library" || !video.status ? "queued unused" : video.status,
    label: labels[video.status] || video.status || "ยังไม่ใช้",
  };
}

function renderMetrics() {
  const stats = state.stats || {};
  const queued = stats.queued ?? (state.queue || []).filter((item) => ["pending", "running", "transferring", "posting"].includes(item.status)).length;
  $("metricChannels").textContent = stats.channels ?? state.channels.length;
  $("metricQueued").textContent = queued;
  $("metricComplete").textContent = stats.complete ?? 0;
  $("metricFailed").textContent = stats.failed ?? (state.queue || []).filter((item) => item.status === "failed").length;
  $("pathHint").textContent = `Folder: ${state.paths.library || state.paths.uploads}`;
  renderAutoRandomButton();
}

function renderAutoRandomButton() {
  const btn = $("autoRandomBtn");
  if (!btn) return;
  const enabled = Boolean(state?.auto_random?.enabled);
  btn.textContent = `Auto random : ${enabled ? "ON" : "OFF"}`;
  btn.classList.toggle("auto-random-on", enabled);
  btn.classList.toggle("auto-random-off", !enabled);
}

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${view}View`);
  });
  document.body.classList.toggle("gtpro-active", view === "gtpro");
  // POST WEB swaps the left rail from device channels to its TikTok channels.
  const isPostWeb = view === "postweb";
  const deviceSidebar = $("deviceSidebar");
  const postwebSidebar = $("postwebSidebar");
  if (deviceSidebar) deviceSidebar.hidden = isPostWeb;
  if (postwebSidebar) postwebSidebar.hidden = !isPostWeb;
  if (view === "channel" && !channelAccountsLoaded) loadChannelAccounts({ refresh: false });
  // postweb.js loads after this file; it owns the POST WEB tab's first paint.
  if (isPostWeb && typeof pwInitPage === "function") pwInitPage();
  // The library's action button differs per view — repaint it on every switch.
  if (state) renderVideos();
  // The bottom log panel is shared: POST WEB swaps it to the TikTok post log.
  if (typeof pwApplyLogPanel === "function") pwApplyLogPanel();
  render();
}

function renderChannels() {
  const wrap = $("channels");
  wrap.innerHTML = "";
  const channels = visibleSidebarChannels();
  if (hideOfflineChannels && selectedChannelId && !channels.some((channel) => numericId(channel.id) === numericId(selectedChannelId)) && channels[0]) {
    selectedChannelId = numericId(channels[0].id);
  }
  if (!channels.length) {
    wrap.innerHTML = `<div class="queue-meta">ไม่มี channel online</div>`;
    return;
  }
  channels.forEach((channel) => {
    const deviceState = deviceStateForUdid(channel.udid);
    const connection = deviceState === "device" ? "online" : "offline";
    const displayStatus = channel.status === "idle" ? "device" : channel.status;
    const card = document.createElement("div");
    card.className = `channel-card ${numericId(channel.id) === numericId(selectedChannelId) ? "active" : ""} ${connection}`;
    card.innerHTML = `
      <div class="channel-row">
        <div>
          <h3 class="channel-title">
            <span>${escapeHtml(channel.name)}</span>
            <button class="icon-edit" data-edit-channel="${channel.id}" type="button" aria-label="Edit channel name" title="Edit channel name"></button>
          </h3>
          <div class="channel-meta">${escapeHtml(channel.udid)}</div>
        </div>
        <div class="channel-order-actions">
          <button class="order-btn" data-channel-up="${channel.id}" type="button" aria-label="Move channel up" title="Move up"></button>
          <button class="order-btn down" data-channel-down="${channel.id}" type="button" aria-label="Move channel down" title="Move down"></button>
        </div>
        <div class="channel-badges">
          <span class="device-status ${connection}">${connection}</span>
          <span class="status ${channel.status}">${displayStatus}</span>
        </div>
      </div>
      <div class="channel-meta">Queue: ${channel.queue_count || 0}</div>
      <div class="mini-actions">
        <button class="ghost screen-btn" data-screen="${channel.id}" title="Open screen with scrcpy" aria-label="Open screen">Screen</button>
        <button class="primary" data-start="${channel.id}">Start</button>
        <button class="ghost" data-stop="${channel.id}">Stop</button>
        <button class="danger" data-delete-channel="${channel.id}">Delete</button>
      </div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target.dataset.screen || event.target.dataset.start || event.target.dataset.stop || event.target.dataset.editChannel || event.target.dataset.deleteChannel || event.target.dataset.channelUp || event.target.dataset.channelDown) return;
      selectedChannelId = numericId(channel.id);
      render();
    });
    wrap.appendChild(card);
  });

  wrap.querySelectorAll("[data-start]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/channels/${btn.dataset.start}/start`, { method: "POST", body: "{}" });
      await refresh();
    });
  });

  wrap.querySelectorAll("[data-screen]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/channels/${btn.dataset.screen}/screen`, { method: "POST", body: "{}" });
      } catch (error) {
        alert(error.message || "เปิดหน้าจอด้วย scrcpy ไม่สำเร็จ");
      }
    });
  });

  wrap.querySelectorAll("[data-delete-channel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/channels/${btn.dataset.deleteChannel}`, { method: "DELETE" });
      if (numericId(selectedChannelId) === Number(btn.dataset.deleteChannel)) selectedChannelId = null;
      await refresh();
    });
  });

  wrap.querySelectorAll("[data-stop]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/channels/${btn.dataset.stop}/stop`, { method: "POST", body: "{}" });
      await refresh();
    });
  });

  wrap.querySelectorAll("[data-edit-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const channel = state.channels.find((item) => String(item.id) === String(btn.dataset.editChannel));
      if (channel) openEditChannelModal(channel);
    });
  });

  wrap.querySelectorAll("[data-channel-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await moveChannel(btn.dataset.channelUp, -1);
    });
  });

  wrap.querySelectorAll("[data-channel-down]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await moveChannel(btn.dataset.channelDown, 1);
    });
  });
}

function renderQueue() {
  const channel = currentChannel();
  $("queueTitle").textContent = channel ? `${channel.name} Queue` : "Channel Queue";
  $("queueSubtitle").textContent = channel ? `${channel.udid}` : "เลือก channel ทางซ้ายเพื่อดูคิว";
  const wrap = $("queueList");
  const items = queueForSelectedChannel();
  $("selectAllQueueBtn").textContent =
    items.length > 0 && items.every((item) => selectedQueueItems.has(item.id))
      ? "Deselect All"
      : "Select All";
  $("setScheduleBtn").textContent = selectedQueueItems.size
    ? `Set (${selectedQueueItems.size})`
    : "Set";
  wrap.innerHTML = "";
  wrap.classList.toggle("empty", items.length === 0);
  if (items.length === 0) {
    wrap.textContent = "ยังไม่มีวิดีโอในคิวของ channel นี้";
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("div");
    const isSelected = selectedQueueItems.has(item.id);
    card.className = `queue-card ${isSelected ? "selected" : ""}`;
    card.innerHTML = `
      <button class="queue-check ${isSelected ? "checked" : ""}" data-toggle-queue="${item.id}" type="button" aria-label="Select queue item"></button>
      <div class="queue-card-body">
      <div class="card-row">
        <div>
          <div class="queue-title">${escapeHtml(item.product_name || item.filename)}</div>
        </div>
        <span class="status ${item.status}">${escapeHtml(formatQueueStatus(item))}</span>
      </div>
      <div class="queue-schedule">ตั้งไว้: ${escapeHtml(formatInputSchedule(item))} • ${escapeHtml(formatCountdown(item))} • ${escapeHtml(formatCountdownClock(item))}</div>
      <div class="queue-meta">${escapeHtml(item.caption || "")}</div>
      <div class="mini-actions">
        ${item.status === "failed" ? `<button class="retry-btn" data-retry-queue="${item.id}">Retry</button>` : ""}
        <button class="danger" data-delete-queue="${item.id}">Remove</button>
      </div>
      </div>
    `;
    wrap.appendChild(card);
  });
  wrap.querySelectorAll("[data-toggle-queue]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.toggleQueue);
      if (selectedQueueItems.has(id)) selectedQueueItems.delete(id);
      else selectedQueueItems.add(id);
      renderQueue();
    });
  });
  wrap.querySelectorAll("[data-delete-queue]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      selectedQueueItems.delete(Number(btn.dataset.deleteQueue));
      await api(`/api/queue/${btn.dataset.deleteQueue}`, { method: "DELETE" });
      await refresh();
    });
  });
  wrap.querySelectorAll("[data-retry-queue]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Retrying...";
      await api(`/api/queue/${btn.dataset.retryQueue}/retry`, { method: "POST", body: "{}" });
      await refresh();
    });
  });
}

function renderVideos() {
  const wrap = $("videoList");
  wrap.innerHTML = "";
  const libraryVideos = state.videos.filter((video) => video.status === "library" || video.status === "queued");
  // On POST WEB the library feeds the TikTok post queue instead of a device
  // channel's queue, so the same button changes what it says and what it does —
  // and a video already sitting in a device queue is still postable to TikTok
  // Web, since those are two independent pipelines.
  const postwebMode = activeView === "postweb";
  const assignableVideos = postwebMode
    ? libraryVideos
    : libraryVideos.filter((video) => video.status === "library");
  $("libraryFolderHint").textContent = state.paths.library || state.paths.uploads || "";
  $("selectAllVideosBtn").textContent =
    assignableVideos.length > 0 && assignableVideos.every((video) => selectedVideos.has(numericId(video.id)))
      ? "Deselect All"
      : "Select All";
  const assignLabel = postwebMode ? "Add to Tiktok" : "Add to Queue";
  $("assignBtn").textContent = selectedVideos.size
    ? `${assignLabel} (${selectedVideos.size})`
    : assignLabel;
  if (libraryVideos.length === 0) {
    wrap.innerHTML = `<div class="empty-inline">ไม่มีวิดีโอในโฟลเดอร์นี้</div>`;
    return;
  }
  libraryVideos.forEach((video) => {
    const videoId = numericId(video.id);
    const isQueued = !postwebMode && video.status !== "library";
    const isSelected = selectedVideos.has(videoId);
    const statusInfo = videoStatusInfo(video);
    const card = document.createElement("div");
    card.className = `video-card ${isSelected ? "selected" : ""} ${isQueued ? "disabled" : ""}`;
    card.innerHTML = `
      <button class="video-check ${isSelected ? "checked" : ""}" data-toggle-video="${videoId}" type="button" aria-label="Select video" ${isQueued ? "disabled" : ""}></button>
      <button class="video-thumb" data-preview-video="${videoId}" type="button">
        <img loading="lazy" src="${videoThumbSrc(videoId)}" alt="" />
      </button>
      <div class="video-card-body">
        <div class="video-status-bar ${escapeHtmlAttr(statusInfo.className)}">${escapeHtml(statusInfo.label)}</div>
        <div class="video-title">${escapeHtml(video.product_name || video.filename)}</div>
        ${libraryCardMeta(video) ? `<div class="video-meta">${escapeHtml(libraryCardMeta(video))}</div>` : ""}
        <div class="mini-actions">
          <button class="ghost" data-toggle-video="${videoId}" ${isQueued ? "disabled" : ""}>${isQueued ? "Queued" : isSelected ? "Selected" : "Select"}</button>
          <button class="danger" data-delete-video="${videoId}">Delete</button>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });

  wrap.querySelectorAll("[data-toggle-video]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.toggleVideo);
      const video = state.videos.find((item) => numericId(item.id) === id);
      // POST WEB can post any listed video; the device views only take library ones.
      if (!video || (!postwebMode && video.status !== "library")) return;
      if (selectedVideos.has(id)) selectedVideos.delete(id);
      else selectedVideos.add(id);
      renderVideos();
    });
  });

  wrap.querySelectorAll(".video-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const toggle = card.querySelector("[data-toggle-video]");
      const id = Number(toggle?.dataset.toggleVideo);
      const video = state.videos.find((item) => numericId(item.id) === id);
      // POST WEB can post any listed video; the device views only take library ones.
      if (!video || (!postwebMode && video.status !== "library")) return;
      if (selectedVideos.has(id)) selectedVideos.delete(id);
      else selectedVideos.add(id);
      renderVideos();
    });
  });

  wrap.querySelectorAll("[data-delete-video]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.deleteVideo);
      const ok = await confirmDelete("ยืนยันการลบวิดีโอนี้ออกจากโฟลเดอร์จริง?");
      if (!ok) return;
      selectedVideos.delete(id);
      await api(`/api/videos/${id}`, { method: "DELETE" });
      await refresh();
    });
  });

  wrap.querySelectorAll("[data-preview-video]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.previewVideo;
      const item = state.videos.find((video) => String(video.id) === String(id));
      openVideoModal(id, item?.product_name || item?.filename || "Preview");
    });
  });
}

function renderManageVideos() {
  const wrap = $("videoManageList");
  if (!wrap) return;
  const videos = state.videos || [];
  const selectedCount = selectedManageVideos.size;
  $("videoManagePathHint").textContent = `Folder: ${state.paths.library || state.paths.uploads || ""}`;
  $("videoManageSummary").textContent = `Videos: ${videos.length} • Selected: ${selectedCount}`;
  $("selectAllManageVideosBtn").textContent =
    videos.length > 0 && videos.every((video) => selectedManageVideos.has(numericId(video.id)))
      ? "Deselect All"
      : "Select All";
  $("deleteManageVideosBtn").textContent = selectedCount
    ? `Delete Selected (${selectedCount})`
    : "Delete Selected";
  wrap.innerHTML = "";
  if (!videos.length) {
    wrap.innerHTML = `<div class="empty-inline">ไม่มีวิดีโอในโฟลเดอร์นี้</div>`;
    return;
  }
  videos.forEach((video) => {
    const videoId = numericId(video.id);
    const isSelected = selectedManageVideos.has(videoId);
    const statusInfo = videoStatusInfo(video);
    const row = document.createElement("div");
    row.className = `video-manage-row ${isSelected ? "selected" : ""}`;
    row.innerHTML = `
      <button class="video-check ${isSelected ? "checked" : ""}" data-toggle-manage-video="${videoId}" type="button" aria-label="Select video"></button>
      <button class="video-thumb" data-preview-video="${videoId}" type="button">
        <img loading="lazy" src="${videoThumbSrc(videoId)}" alt="" />
      </button>
      <div class="video-manage-body">
        <div class="video-status-bar ${escapeHtmlAttr(statusInfo.className)}">${escapeHtml(statusInfo.label)}</div>
        <div class="video-title">${escapeHtml(video.product_name || video.filename)}</div>
      </div>
      <button class="danger" data-delete-manage-video="${videoId}">Delete</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll("[data-toggle-manage-video]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = Number(btn.dataset.toggleManageVideo);
      if (selectedManageVideos.has(id)) selectedManageVideos.delete(id);
      else selectedManageVideos.add(id);
      renderManageVideos();
    });
  });
  wrap.querySelectorAll(".video-manage-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const toggle = row.querySelector("[data-toggle-manage-video]");
      const id = Number(toggle?.dataset.toggleManageVideo);
      if (!id) return;
      if (selectedManageVideos.has(id)) selectedManageVideos.delete(id);
      else selectedManageVideos.add(id);
      renderManageVideos();
    });
  });
  wrap.querySelectorAll("[data-delete-manage-video]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = Number(btn.dataset.deleteManageVideo);
      const ok = await confirmDelete("ยืนยันการลบวิดีโอนี้ออกจากโฟลเดอร์จริง?");
      if (!ok) return;
      selectedManageVideos.delete(id);
      selectedVideos.delete(id);
      await api(`/api/videos/${id}`, { method: "DELETE" });
      await refresh();
    });
  });
  wrap.querySelectorAll("[data-preview-video]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = btn.dataset.previewVideo;
      const item = state.videos.find((video) => String(video.id) === String(id));
      openVideoModal(id, item?.product_name || item?.filename || "Preview");
    });
  });
}

function renderBinVideos() {
  const wrap = $("binVideoList");
  if (!wrap) return;
  const videos = state.bin_videos || [];
  const selectedCount = selectedBinVideos.size;
  $("binVideoSummary").textContent = `Videos: ${videos.length} • Selected: ${selectedCount}`;
  $("selectAllBinVideosBtn").textContent =
    videos.length > 0 && videos.every((video) => selectedBinVideos.has(numericId(video.id)))
      ? "Deselect All"
      : "Select All";
  $("deleteBinVideosBtn").textContent = selectedCount
    ? `Delete Selected (${selectedCount})`
    : "Delete Selected";
  wrap.innerHTML = "";
  if (!videos.length) {
    wrap.innerHTML = `<div class="empty-inline">ยังไม่มีวิดีโอในถังขยะ</div>`;
    return;
  }
  videos.forEach((video) => {
    const videoId = numericId(video.id);
    const isSelected = selectedBinVideos.has(videoId);
    const row = document.createElement("div");
    row.className = `video-manage-row ${isSelected ? "selected" : ""}`;
    row.innerHTML = `
      <button class="video-check ${isSelected ? "checked" : ""}" data-toggle-bin-video="${videoId}" type="button" aria-label="Select video"></button>
      <button class="video-thumb" data-preview-video="${videoId}" type="button">
        <img loading="lazy" src="${videoThumbSrc(videoId)}" alt="" />
      </button>
      <div class="video-manage-body">
        <div class="video-status-bar posted">โพสต์แล้ว</div>
        <div class="video-status-bar warning">${escapeHtml(formatBinRetention(video))}</div>
        <div class="video-title">${escapeHtml(video.product_name || video.filename)}</div>
      </div>
      <button class="danger" data-delete-bin-video="${videoId}">Delete</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll("[data-toggle-bin-video]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = Number(btn.dataset.toggleBinVideo);
      if (selectedBinVideos.has(id)) selectedBinVideos.delete(id);
      else selectedBinVideos.add(id);
      renderBinVideos();
    });
  });
  wrap.querySelectorAll(".video-manage-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const toggle = row.querySelector("[data-toggle-bin-video]");
      const id = Number(toggle?.dataset.toggleBinVideo);
      if (!id) return;
      if (selectedBinVideos.has(id)) selectedBinVideos.delete(id);
      else selectedBinVideos.add(id);
      renderBinVideos();
    });
  });
  wrap.querySelectorAll("[data-delete-bin-video]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = Number(btn.dataset.deleteBinVideo);
      const ok = await confirmDelete("ยืนยันการลบวิดีโอในถังขยะนี้ออกจากโฟลเดอร์จริง?");
      if (!ok) return;
      selectedBinVideos.delete(id);
      await api(`/api/videos/${id}`, { method: "DELETE" });
      await refresh();
    });
  });
  wrap.querySelectorAll("[data-preview-video]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = btn.dataset.previewVideo;
      const item = (state.bin_videos || []).find((video) => String(video.id) === String(id));
      openVideoModal(id, item?.product_name || item?.filename || "Preview");
    });
  });
}

function renderLogs() {
  const wrap = $("activityLog");
  // POST WEB shows the TikTok publishing log instead (postweb.js owns the panel
  // there), so the device-queue log must not paint over it.
  if (activeView === "postweb") return;
  const logs = (state.logs || []).filter((log) => {
    if (!selectedChannelId) return true;
    return log.channel_id === selectedChannelId || log.channel_id === null || log.channel_id === undefined;
  });
  wrap.innerHTML = "";
  if (logs.length === 0) {
    wrap.innerHTML = `<div class="queue-meta">ยังไม่มี activity log สำหรับ channel นี้</div>`;
    return;
  }
  logs.forEach((log) => {
    const row = document.createElement("div");
    row.className = `log-row ${log.level || "info"}`;
    const time = String(log.created_at || "").split("T")[1] || log.created_at || "";
    const fullMessage = log.message || "";
    const displayMessage = log.level === "error" ? shortText(fullMessage, 140) : fullMessage;
    row.innerHTML = `
      <div class="log-time">${escapeHtml(time)}</div>
      <div class="log-channel">${escapeHtml(log.channel_name || "System")}</div>
      <div class="log-message">
        <span>${escapeHtml(displayMessage)}</span>
        ${fullMessage.length > displayMessage.length || log.level === "error" ? `<button class="copy-btn" data-copy="${escapeHtmlAttr(fullMessage)}">Copy</button>` : ""}
      </div>
    `;
    wrap.appendChild(row);
  });
  bindCopyButtons(wrap);
}

function runningQueueItem(channel) {
  return (state.queue || []).find((item) => item.channel_id === channel.id && ["transferring", "posting", "running"].includes(item.status))
    || (state.queue || []).find((item) => item.channel_id === channel.id && item.status === "failed")
    || (state.queue || []).find((item) => item.channel_id === channel.id);
}

function channelLatestLog(channel) {
  return (state.logs || []).find((log) => log.channel_id === channel.id) || null;
}

function runningProgress(channel, item) {
  if (channel.status === "error" || item?.status === "failed") return 90;
  if (channel.status === "posting" || item?.status === "posting") return 72;
  if (channel.status === "transferring" || item?.status === "transferring") return 35;
  if (channel.status === "running" || item?.status === "running") return 58;
  if (channel.status === "stopping") return 95;
  return 12;
}

function runningStepText(channel, item, log) {
  if (item?.error_message) return `ERR: ${shortText(item.error_message, 36)}`;
  if (log?.message) return shortText(log.message, 42);
  if (item?.filename) return `${channel.status.toUpperCase()}: ${item.filename}`;
  return channel.status === "error" ? "ERR: waiting for retry" : "Waiting for active task";
}

function renderRunning() {
  const channels = state.channels || [];
  const activeChannels = channels.filter((channel) =>
    ["running", "transferring", "posting", "stopping", "error"].includes(channel.status)
  );
  const transferCount = activeChannels.filter((channel) => channel.status === "transferring").length;
  const postingCount = activeChannels.filter((channel) => channel.status === "posting").length;
  const errorCount = activeChannels.filter((channel) => channel.status === "error").length;

  $("runningTotal").textContent = String(activeChannels.length).padStart(2, "0");
  $("runningTransfer").textContent = String(transferCount).padStart(2, "0");
  $("runningPosting").textContent = String(postingCount).padStart(2, "0");
  $("runningErrors").textContent = String(errorCount).padStart(2, "0");

  const table = $("runningChannels");
  table.innerHTML = `
    <div class="running-table-head">
      <span>Channel / UDID</span>
      <span>Status</span>
      <span>Current Step</span>
      <span>Progress</span>
      <span>Actions</span>
    </div>
  `;

  if (!activeChannels.length) {
    table.insertAdjacentHTML("beforeend", `<div class="running-empty">ยังไม่มี channel ที่กำลังทำงาน</div>`);
  } else {
    activeChannels.forEach((channel, index) => {
      const item = runningQueueItem(channel);
      const log = channelLatestLog(channel);
      const progress = runningProgress(channel, item);
      const row = document.createElement("div");
      row.className = `running-table-row ${index === 0 ? "selected" : ""} ${channel.status}`;
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(channel.name)}</strong>
          <code>UDID: ${escapeHtml(channel.udid)}</code>
        </div>
        <div><span class="running-badge ${channel.status}">${escapeHtml(channel.status)}</span></div>
        <div>
          <code>${escapeHtml(runningStepText(channel, item, log))}</code>
          <small>${escapeHtml(item?.filename || log?.message || "Automation worker active")}</small>
        </div>
        <div class="running-progress-cell">
          <div class="running-progress"><span style="width:${progress}%"></span></div>
          <b>${progress}%</b>
        </div>
        <div class="running-row-actions">
          <button data-running-stop="${channel.id}" type="button" aria-label="Stop channel" title="Stop channel"></button>
        </div>
      `;
      table.appendChild(row);
    });
  }

  table.querySelectorAll("[data-running-stop]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/channels/${btn.dataset.runningStop}/stop`, { method: "POST", body: "{}" });
      await refresh();
    });
  });

  const focus = activeChannels[0] || currentChannel() || channels[0];
  const focusItem = focus ? runningQueueItem(focus) : null;
  const focusProgress = focus ? runningProgress(focus, focusItem) : 0;
  $("runningFocus").innerHTML = focus
    ? `
      <div class="running-focus-kicker">Focus Mode</div>
      <h3>${escapeHtml(focus.name)} Detail</h3>
      <div class="running-now-card">
        <div class="running-now-thumb"><span>play_circle</span></div>
        <div>
          <strong>${escapeHtml(focusItem?.product_name || focusItem?.filename || "Automation Active")}</strong>
          <small>TikTok • ${escapeHtml(focus.status)}</small>
        </div>
      </div>
      <div class="running-steps">
        ${["Queue Ready", "Transfer Complete", "App Launched", "Automation Steps", "Posted"].map((label, idx) => {
          const done = idx * 25 < focusProgress;
          const active = idx === Math.min(3, Math.floor(focusProgress / 25));
          return `<div class="${done ? "done" : ""} ${active ? "active" : ""}"><i>${done ? "check" : idx + 1}</i><span>${label}</span></div>`;
        }).join("")}
      </div>
    `
    : `<div class="running-empty">ยังไม่มี channel สำหรับ Focus Mode</div>`;

  const stream = $("runningStream");
  stream.innerHTML = "";
  const logs = (state.logs || []).slice(0, 40).reverse();
  if (!logs.length) {
    stream.innerHTML = `<div class="stream-line muted">No live stream yet.</div>`;
  } else {
    logs.forEach((log) => {
      const time = String(log.created_at || "").split("T")[1] || log.created_at || "";
      const row = document.createElement("div");
      row.className = `stream-line ${log.level || "info"}`;
      row.innerHTML = `<span>[${escapeHtml(time)}]</span> <b>${escapeHtml((log.level || "info").toUpperCase())}:</b> ${escapeHtml(shortText(log.message || "", 140))}`;
      stream.appendChild(row);
    });
    stream.scrollTop = stream.scrollHeight;
  }
}

function renderIdle() {
  const channels = state.channels || [];
  const idleChannels = channels.filter((channel) => channel.status === "idle");
  const pendingQueue = (state.queue || []).filter((item) => item.status === "pending").length;
  $("idleTotal").textContent = idleChannels.length;
  $("idleReady").textContent = latestDevices.filter((device) => device.state === "device").length;
  $("idleQueue").textContent = pendingQueue;
  $("idleHealth").textContent = channels.some((channel) => channel.status === "error") ? "Check" : "OK";

  const deviceWrap = $("idleDevices");
  deviceWrap.innerHTML = "";
  const channelUdids = new Set(channels.map((channel) => String(channel.udid || "")));
  const availableDevices = latestDevices.filter((device) => !channelUdids.has(String(device.udid || "")));
  if (!latestDevices.length) {
    deviceWrap.innerHTML = `<div class="queue-meta">กด Scan ADB เพื่อดู devices</div>`;
  } else if (!availableDevices.length) {
    deviceWrap.innerHTML = `<div class="queue-meta">ทุก device ถูกเพิ่มเป็น Device Channel แล้ว</div>`;
  } else {
    availableDevices.forEach((device) => {
      const row = document.createElement("div");
      row.className = "device-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(device.udid)}</strong>
          <code>${escapeHtml(device.state)}</code>
        </div>
        <button class="ghost" data-use-device="${escapeHtmlAttr(device.udid)}">Use</button>
      `;
      deviceWrap.appendChild(row);
    });
    deviceWrap.querySelectorAll("[data-use-device]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDeviceChannelModal(btn.dataset.useDevice || "");
      });
    });
  }

}

function render() {
  renderMetrics();
  renderChannels();
  renderQueue();
  renderVideos();
  renderManageVideos();
  renderBinVideos();
  renderLogs();
  renderIdle();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

// ---- TikTok Channel --------------------------------------------------------
// Account/cookie bridge: the extension scans TikTok for signed-in sessions and
// the AI Studio Node server (AutoGT Pro engine, port 18787) turns those cookies
// into account cards via its own /api/tiktok/accounts*. This app talks to that
// server directly (cross-origin) rather than re-implementing the TikTok API
// calls here — gtpro_extension's WS protocol already speaks ai_studio's wire
// format, see background.js's busAiStudio.
const AI_STUDIO_ORIGIN = "http://127.0.0.1:18787";
const channelAccountList = document.getElementById("channelAccountList");
const channelAccountStatus = document.getElementById("channelAccountStatus");
const channelScanAccountsBtn = document.getElementById("channelScanAccountsBtn");
// Single source of truth for the TikTok account list.
//
// The Channel page and the POST WEB sidebar both read /api/tiktok/accounts, but
// each used to keep its own copy — so adding, refreshing or deleting a channel
// on one page left the other showing a stale list until it happened to reload.
// Both now read and write this store, and anything that renders the list
// subscribes to it.
const tiktokAccountsStore = {
  accounts: [],
  // Distinguishes "no channels" from "not fetched yet" — subscribers must not
  // act on an empty list before the first real response lands.
  loaded: false,
  listeners: new Set(),
  set(list) {
    this.accounts = Array.isArray(list) ? list : [];
    this.loaded = true;
    for (const listener of this.listeners) {
      try { listener(this.accounts); } catch (error) { console.error("[accounts] listener failed", error); }
    }
  },
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.accounts);
    return () => this.listeners.delete(listener);
  },
};
let channelAccountsLoaded = false;

async function aiStudioApi(path, options = {}) {
  const resp = await fetch(`${AI_STUDIO_ORIGIN}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

function channelCookieStatus(account) {
  if (account?.hasCookies === false) return { className: "is-missing", label: "ไม่มี cookie" };
  if (account?.cookieExpired) return { className: "is-expired", label: "หมดอายุ" };
  return { className: "is-active", label: "ใช้งานได้" };
}

function renderChannelAccounts(accounts = []) {
  if (!channelAccountList) return;
  if (!accounts.length) {
    channelAccountList.innerHTML = `
      <div class="channel-empty-card">
        <span class="material-symbols-outlined">account_circle</span>
        <strong>ยังไม่มี Channel</strong>
        <p>กดสแกนหา Account เพื่อให้ extension ส่ง cookie/token และข้อมูล TikTok account เข้ามาเก็บไว้</p>
      </div>`;
    return;
  }
  channelAccountList.innerHTML = accounts.map((account) => {
    const status = channelCookieStatus(account);
    const uniqueId = account.uniqueId || "";
    const label = account.nickname && account.nickname !== uniqueId ? account.nickname : "TikTok";
    return `
      <article class="channel-account-card">
        <div class="channel-account-main">
          <div class="channel-account-avatar">${
            account.avatar
              ? `<img src="${escapeHtmlAttr(account.avatar)}" alt="" />`
              : `<span class="material-symbols-outlined">account_circle</span>`
          }</div>
          <div>
            <strong title="@${escapeHtmlAttr(uniqueId)}">@${escapeHtml(uniqueId || "unknown")}</strong>
            <span>${escapeHtml(label)}</span>
          </div>
        </div>
        <div class="channel-account-meta">
          <span>${escapeHtml(account.followerCount ? `${account.followerCount} followers` : "Chrome profile")}</span>
          <em class="channel-cookie-badge ${status.className}">${status.label}</em>
        </div>
        <div class="channel-account-actions">
          <button class="icon-btn" type="button" data-channel-refresh="${escapeHtmlAttr(uniqueId)}" title="ดึง API ใหม่" aria-label="ดึง API ใหม่ ${escapeHtmlAttr(uniqueId)}">
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button class="icon-btn danger" type="button" data-channel-delete="${escapeHtmlAttr(uniqueId)}" title="ลบโปรไฟล์" aria-label="ลบโปรไฟล์ ${escapeHtmlAttr(uniqueId)}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </article>`;
  }).join("");
}

// Symmetry: POST WEB's "สแกนหา Account" writes the same store, so the Channel
// page has to re-render from it rather than only from its own calls.
tiktokAccountsStore.subscribe((accounts) => {
  if (tiktokAccountsStore.loaded) renderChannelAccounts(accounts);
});

async function loadChannelAccounts({ refresh = false } = {}) {
  if (!channelAccountStatus) return;
  channelAccountsLoaded = true;
  channelAccountStatus.classList.remove("is-error");
  channelAccountStatus.textContent = refresh
    ? "กำลังสแกนหาบัญชี: extension จะเปิดแท็บ TikTok ชั่วคราวเพื่อเก็บ cookie/token..."
    : "กำลังโหลด Channel...";
  try {
    const payload = await aiStudioApi(`/api/tiktok/accounts?${refresh ? "refresh=1" : "cache=1"}`);
    tiktokAccountsStore.set(Array.isArray(payload.accounts) ? payload.accounts : []);
    channelAccountStatus.textContent = tiktokAccountsStore.accounts.length
      ? `โหลด Channel แล้ว ${tiktokAccountsStore.accounts.length} บัญชี`
      : "ยังไม่พบบัญชี TikTok ให้กดสแกนหา Account อีกครั้ง";
  } catch (error) {
    renderChannelAccounts(tiktokAccountsStore.accounts);
    channelAccountStatus.classList.add("is-error");
    channelAccountStatus.textContent = `โหลด Channel ไม่สำเร็จ: ${error.message || error} — ตรวจสอบว่า AutoTik Extension เชื่อมต่อกับ AI Studio อยู่`;
  }
}

async function refreshChannelAccount(uniqueId, button) {
  const account = tiktokAccountsStore.accounts.find((item) => item.uniqueId === uniqueId);
  if (!account) return;
  const original = button?.innerHTML || "";
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="material-symbols-outlined">hourglass_empty</span>`;
  }
  channelAccountStatus.classList.remove("is-error");
  channelAccountStatus.textContent = `กำลังดึง API ใหม่ของ @${uniqueId}...`;
  try {
    const payload = await aiStudioApi("/api/tiktok/accounts/profile", {
      method: "POST",
      body: JSON.stringify({ profile: account, forceBrowser: true }),
    });
    tiktokAccountsStore.set(Array.isArray(payload.accounts) ? payload.accounts : tiktokAccountsStore.accounts);
    channelAccountStatus.textContent = `อัปเดต @${uniqueId} แล้ว`;
  } catch (error) {
    channelAccountStatus.classList.add("is-error");
    channelAccountStatus.textContent = `ดึง API ใหม่ไม่สำเร็จ: ${error.message || error}`;
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

async function deleteChannelAccount(uniqueId) {
  try {
    await aiStudioApi("/api/tiktok/accounts/delete", {
      method: "POST",
      body: JSON.stringify({ account: { uniqueId } }),
    });
    tiktokAccountsStore.set(tiktokAccountsStore.accounts.filter((item) => item.uniqueId !== uniqueId));
    channelAccountStatus.textContent = `ลบ @${uniqueId} แล้ว`;
  } catch (error) {
    channelAccountStatus.classList.add("is-error");
    channelAccountStatus.textContent = `ลบไม่สำเร็จ: ${error.message || error}`;
  }
}

channelScanAccountsBtn?.addEventListener("click", () => loadChannelAccounts({ refresh: true }));
channelAccountList?.addEventListener("click", (event) => {
  const refreshBtn = event.target.closest("[data-channel-refresh]");
  if (refreshBtn) {
    refreshChannelAccount(refreshBtn.dataset.channelRefresh, refreshBtn);
    return;
  }
  const deleteBtn = event.target.closest("[data-channel-delete]");
  if (deleteBtn && confirm(`ลบโปรไฟล์ @${deleteBtn.dataset.channelDelete}?`)) {
    deleteChannelAccount(deleteBtn.dataset.channelDelete);
  }
});

function shortText(value, max = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function bindCopyButtons(root = document) {
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const text = btn.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = old;
        }, 900);
      } catch (error) {
        btn.textContent = "Fail";
      }
    });
  });
}

function openDeviceChannelModal(udid) {
  editingChannelId = null;
  selectedDeviceUdid = udid || "";
  $("deviceChannelModalTitle").textContent = "Add Device Channel";
  $("deviceChannelModalSubtitle").textContent = "ตั้งชื่อ channel สำหรับ UDID ที่เลือก";
  $("deviceChannelUdid").value = selectedDeviceUdid;
  $("deviceChannelName").value = "";
  $("deviceChannelAddBtn").textContent = "Add";
  $("deviceChannelModal").classList.remove("hidden");
  setTimeout(() => $("deviceChannelName").focus(), 50);
}

function openEditChannelModal(channel) {
  editingChannelId = channel.id;
  selectedDeviceUdid = channel.udid || "";
  $("deviceChannelModalTitle").textContent = "Edit Device Channel";
  $("deviceChannelModalSubtitle").textContent = "แก้ไขชื่อช่องของ device channel";
  $("deviceChannelUdid").value = selectedDeviceUdid;
  $("deviceChannelName").value = channel.name || "";
  $("deviceChannelAddBtn").textContent = "Save";
  $("deviceChannelModal").classList.remove("hidden");
  setTimeout(() => {
    $("deviceChannelName").focus();
    $("deviceChannelName").select();
  }, 50);
}

function closeDeviceChannelModal() {
  selectedDeviceUdid = "";
  editingChannelId = null;
  $("deviceChannelModal").classList.add("hidden");
}

function openFolderPathModal() {
  $("folderPathModal").classList.remove("hidden");
  setTimeout(() => $("folderPathInput").focus(), 50);
}

function closeFolderPathModal() {
  $("folderPathModal").classList.add("hidden");
}

function openVideoModal(videoId, title) {
  $("videoModalTitle").textContent = title;
  const player = $("videoModalPlayer");
  player.src = `/api/videos/${videoId}/media`;
  $("videoModal").classList.remove("hidden");
  player.play().catch(() => {});
}

function closeVideoModal() {
  const player = $("videoModalPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
  $("videoModal").classList.add("hidden");
}

function confirmDelete(message) {
  $("confirmDeleteMessage").textContent = message || "วิดีโอจะถูกลบออกจากโฟลเดอร์จริง";
  $("confirmDeleteModal").classList.remove("hidden");
  return new Promise((resolve) => {
    pendingDeleteConfirm = resolve;
  });
}

function closeConfirmDeleteModal(result = false) {
  $("confirmDeleteModal").classList.add("hidden");
  if (pendingDeleteConfirm) {
    pendingDeleteConfirm(Boolean(result));
    pendingDeleteConfirm = null;
  }
}

function chooseScheduleScope() {
  $("scheduleScopeModal").classList.remove("hidden");
  return new Promise((resolve) => {
    pendingScheduleScope = resolve;
  });
}

function closeScheduleScopeModal(scope = null) {
  $("scheduleScopeModal").classList.add("hidden");
  if (pendingScheduleScope) {
    pendingScheduleScope(scope);
    pendingScheduleScope = null;
  }
}

$("channelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/channels", {
    method: "POST",
    body: JSON.stringify({
      name: $("channelName").value,
      udid: $("channelUdid").value,
    }),
  });
  $("channelName").value = "";
  $("channelUdid").value = "";
  await refresh();
});

async function scanAdbDevices() {
  const res = await api("/api/adb/devices");
  latestDevices = res.data.devices || [];
  const wrap = $("deviceList");
  wrap.innerHTML = "";
  if (state) renderChannels();
  renderIdle();
}

$("scanDevicesBtn").addEventListener("click", async () => {
  await scanAdbDevices();
});

$("idleScanBtn").addEventListener("click", async () => {
  $("scanDevicesBtn").click();
});

$("hideOfflineChannels").addEventListener("change", (event) => {
  hideOfflineChannels = event.target.checked;
  renderChannels();
});

$("bottomLogHandle").addEventListener("click", (event) => {
  if (event.target.closest("#clearLogsBtn")) return;
  toggleLogsPanel();
});
$("closeLogsBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleLogsPanel();
});
$("toggleLibraryBtn").addEventListener("click", () => toggleLibraryPanel());

document.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveView(btn.dataset.view || "dashboard");
  });
});

// The AI Studio iframe (#aiStudioFrame, http://127.0.0.1:<ai-studio-port>) has no Channel
// page of its own anymore — its "ไปหน้า Channel" button asks this parent shell to switch
// tabs instead of duplicating the account list inside the iframe.
window.addEventListener("message", (event) => {
  if (!event.origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) return;
  const data = event.data;
  if (data && data.type === "autotik:navigate" && typeof data.route === "string") {
    setActiveView(data.route);
  }
});

$("scanUploadsBtn").addEventListener("click", async () => {
  await api("/api/videos/scan-library", { method: "POST", body: "{}" });
  await refresh();
});

$("assignBtn").addEventListener("click", async () => {
  if (selectedVideos.size === 0) return;

  // POST WEB: hand the picked library videos to the TikTok post queue. The
  // extension fetches each clip over HTTP, so pass this server's media URL
  // rather than the on-disk path.
  if (activeView === "postweb") {
    const picked = [...selectedVideos]
      .map((id) => state.videos.find((video) => numericId(video.id) === numericId(id)))
      .filter(Boolean)
      .map((video) => ({
        id: numericId(video.id),
        name: video.product_name || video.filename || `video-${video.id}`,
        // The caption All Channels would post this clip with. POST WEB reuses it
        // verbatim when AI captioning is off, so both pages post the same text.
        caption: video.caption || "",
        url: `${window.location.origin}/api/videos/${numericId(video.id)}/media`,
      }));
    await pwAddVideosToQueue(picked);
    selectedVideos.clear();
    renderVideos();
    return;
  }

  if (!selectedChannelId) return;
  await api("/api/queue/assign", {
    method: "POST",
    body: JSON.stringify({
      channel_id: selectedChannelId,
      video_ids: [...selectedVideos],
      scheduled_at: $("scheduleAt").value || null,
      interval_minutes: Number($("intervalMinutes").value || 0),
    }),
  });
  selectedVideos.clear();
  await refresh();
});

$("randomBtn").addEventListener("click", async () => {
  await scanAdbDevices();
  const onlineChannels = state.channels.filter(isChannelOnline);
  if (!onlineChannels.length) {
    alert("ไม่มีเครื่องที่ online อยู่ในขณะนี้");
    return;
  }
  const channelIds = onlineChannels.map((channel) => channel.id);
  const videoIds = state.videos
    .filter((video) => video.status === "library")
    .map((video) => video.id);
  if (!videoIds.length) return;
  try {
    await api("/api/queue/random", {
      method: "POST",
      body: JSON.stringify({
        channel_ids: channelIds,
        video_ids: videoIds,
        scheduled_at: $("scheduleAt").value || null,
        interval_minutes: Number($("intervalMinutes").value || 0),
      }),
    });
    selectedVideos.clear();
    await refresh();
  } catch (error) {
    alert(error.message || "Random Distribute ไม่สำเร็จ");
  }
});

$("autoRandomBtn").addEventListener("click", async () => {
  const enabled = !Boolean(state?.auto_random?.enabled);
  const btn = $("autoRandomBtn");
  btn.disabled = true;
  try {
    await api("/api/auto-random", {
      method: "POST",
      body: JSON.stringify({
        enabled,
        scheduled_at: $("scheduleAt").value || null,
        interval_minutes: Number($("intervalMinutes").value || 0),
      }),
    });
    await refresh();
  } catch (error) {
    alert(error.message || "Auto random ไม่สำเร็จ");
  } finally {
    btn.disabled = false;
  }
});

$("intervalMinutes").addEventListener("change", async () => {
  if (!state?.auto_random?.enabled) return;
  await api("/api/auto-random", {
    method: "POST",
    body: JSON.stringify({
      enabled: true,
      scheduled_at: $("scheduleAt").value || null,
      interval_minutes: Number($("intervalMinutes").value || 0),
    }),
  });
  await refresh();
});

$("scheduleAt").addEventListener("change", async () => {
  if (!state?.auto_random?.enabled) return;
  await api("/api/auto-random", {
    method: "POST",
    body: JSON.stringify({
      enabled: true,
      scheduled_at: $("scheduleAt").value || null,
      interval_minutes: Number($("intervalMinutes").value || 0),
    }),
  });
  await refresh();
});

$("selectAllVideosBtn").addEventListener("click", () => {
  const libraryVideos = state.videos.filter(
    (video) => activeView === "postweb"
      ? video.status === "library" || video.status === "queued"
      : video.status === "library"
  );
  const allSelected = libraryVideos.length > 0 && libraryVideos.every((video) => selectedVideos.has(numericId(video.id)));
  if (allSelected) {
    libraryVideos.forEach((video) => selectedVideos.delete(numericId(video.id)));
  } else {
    libraryVideos.forEach((video) => selectedVideos.add(numericId(video.id)));
  }
  renderVideos();
});

$("clearVideoSelectionBtn").addEventListener("click", () => {
  selectedVideos.clear();
  renderVideos();
});

$("selectAllManageVideosBtn").addEventListener("click", () => {
  const videos = state.videos || [];
  const allSelected = videos.length > 0 && videos.every((video) => selectedManageVideos.has(numericId(video.id)));
  if (allSelected) {
    videos.forEach((video) => selectedManageVideos.delete(numericId(video.id)));
  } else {
    videos.forEach((video) => selectedManageVideos.add(numericId(video.id)));
  }
  renderManageVideos();
});

$("clearManageVideosBtn").addEventListener("click", () => {
  selectedManageVideos.clear();
  renderManageVideos();
});

$("deleteManageVideosBtn").addEventListener("click", async () => {
  const ids = [...selectedManageVideos];
  if (!ids.length) return;
  const ok = await confirmDelete(`ยืนยันการลบวิดีโอ ${ids.length} รายการออกจากโฟลเดอร์จริง?`);
  if (!ok) return;
  const btn = $("deleteManageVideosBtn");
  btn.disabled = true;
  try {
    for (const id of ids) {
      await api(`/api/videos/${id}`, { method: "DELETE" });
      selectedVideos.delete(id);
    }
    selectedManageVideos.clear();
    await refresh();
  } finally {
    btn.disabled = false;
  }
});

$("selectAllBinVideosBtn").addEventListener("click", () => {
  const videos = state.bin_videos || [];
  const allSelected = videos.length > 0 && videos.every((video) => selectedBinVideos.has(numericId(video.id)));
  if (allSelected) {
    videos.forEach((video) => selectedBinVideos.delete(numericId(video.id)));
  } else {
    videos.forEach((video) => selectedBinVideos.add(numericId(video.id)));
  }
  renderBinVideos();
});

$("clearBinVideosBtn").addEventListener("click", () => {
  selectedBinVideos.clear();
  renderBinVideos();
});

$("scanBinVideosBtn").addEventListener("click", async () => {
  await api("/api/videos/scan-bin", { method: "POST", body: "{}" });
  await refresh();
});

$("deleteBinVideosBtn").addEventListener("click", async () => {
  const ids = [...selectedBinVideos];
  if (!ids.length) return;
  const ok = await confirmDelete(`ยืนยันการลบวิดีโอในถังขยะ ${ids.length} รายการออกจากโฟลเดอร์จริง?`);
  if (!ok) return;
  const btn = $("deleteBinVideosBtn");
  btn.disabled = true;
  try {
    for (const id of ids) {
      await api(`/api/videos/${id}`, { method: "DELETE" });
    }
    selectedBinVideos.clear();
    await refresh();
  } finally {
    btn.disabled = false;
  }
});

$("browseFolderBtn").addEventListener("click", () => {
  browseVideoFolder();
});

$("scanManageVideosBtn").addEventListener("click", async () => {
  await api("/api/videos/scan-library", { method: "POST", body: "{}" });
  await refresh();
});

async function browseVideoFolder() {
  const btn = $("browseFolderBtn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Browsing...";
  try {
    const res = await api("/api/videos/browse-folder", { method: "POST", body: "{}" });
    if (!res.cancelled) {
      selectedVideos.clear();
      await refresh();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

$("folderPathModalClose").addEventListener("click", closeFolderPathModal);
$("folderPathModalBackdrop").addEventListener("click", closeFolderPathModal);
$("folderPathForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = $("folderPathScanBtn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Scanning...";
  try {
    await api("/api/videos/scan-folder", {
      method: "POST",
      body: JSON.stringify({ folder_path: $("folderPathInput").value.trim() }),
    });
    closeFolderPathModal();
    await refresh();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
});

$("videoModalClose").addEventListener("click", closeVideoModal);
$("videoModalBackdrop").addEventListener("click", closeVideoModal);
$("confirmDeleteCancelBtn").addEventListener("click", () => closeConfirmDeleteModal(false));
$("confirmDeleteOkBtn").addEventListener("click", () => closeConfirmDeleteModal(true));
$("confirmDeleteModalBackdrop").addEventListener("click", () => closeConfirmDeleteModal(false));
$("setAllChannelsBtn").addEventListener("click", () => closeScheduleScopeModal("all"));
$("setCurrentChannelBtn").addEventListener("click", () => closeScheduleScopeModal("current"));
$("cancelScheduleScopeBtn").addEventListener("click", () => closeScheduleScopeModal(null));
$("scheduleScopeModalBackdrop").addEventListener("click", () => closeScheduleScopeModal(null));
$("deviceChannelModalClose").addEventListener("click", closeDeviceChannelModal);
$("deviceChannelModalBackdrop").addEventListener("click", closeDeviceChannelModal);
$("deviceChannelModalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("deviceChannelName").value.trim();
  const udid = selectedDeviceUdid || $("deviceChannelUdid").value.trim();
  if (!name || (!udid && !editingChannelId)) return;
  if (editingChannelId) {
    await api(`/api/channels/${editingChannelId}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  } else {
    await api("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name, udid }),
    });
  }
  closeDeviceChannelModal();
  await refresh();
});

$("setScheduleBtn").addEventListener("click", async () => {
  if (!selectedChannelId) return;
  const scope = await chooseScheduleScope();
  if (!scope) return;
  const btn = $("setScheduleBtn");
  btn.disabled = true;
  btn.textContent = "Setting...";
  const payload = {
    queue_item_ids: scope === "current" ? [...selectedQueueItems] : [],
    scheduled_at: $("scheduleAt").value || null,
    interval_minutes: Number($("intervalMinutes").value || 0),
    set_from_now: true,
  };
  const endpoint = scope === "all" ? "/api/queue/schedule-all" : `/api/queue/${selectedChannelId}/schedule`;
  const resp = await api(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  selectedQueueItems.clear();
  await refresh();
  btn.disabled = false;
  btn.textContent = scope === "all" ? `Set All OK (${resp.count ?? 0})` : `Set OK (${resp.count ?? 0})`;
  setTimeout(() => {
    renderQueue();
  }, 900);
});

$("clearQueueBtn").addEventListener("click", async () => {
  if (!selectedChannelId) return;
  selectedQueueItems.clear();
  await api(`/api/queue/${selectedChannelId}/clear`, { method: "DELETE" });
  await refresh();
});

$("clearLogsBtn").addEventListener("click", async () => {
  // Clear whichever log the panel is currently showing.
  if (activeView === "postweb") {
    await aiStudioApi("/api/logs/clear", { method: "DELETE" });
    await pwRenderLogs();
    return;
  }
  await api("/api/logs/clear", { method: "DELETE" });
  await refresh();
});

$("startAllBtn").addEventListener("click", async () => {
  await api("/api/channels/start-all", { method: "POST", body: "{}" });
  await refresh();
});

$("stopAllBtn").addEventListener("click", async () => {
  await api("/api/channels/stop-all", { method: "POST", body: "{}" });
  await refresh();
});

$("clearTimeSetBtn").addEventListener("click", async () => {
  const btn = $("clearTimeSetBtn");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Clearing...";
  try {
    const resp = await api("/api/queue/clear-time-sets", { method: "POST", body: "{}" });
    $("scheduleAt").value = "";
    $("intervalMinutes").value = "";
    selectedQueueItems.clear();
    await refresh();
    btn.textContent = `Clear OK (${resp.count ?? 0})`;
    setTimeout(() => {
      btn.textContent = oldText;
    }, 900);
  } finally {
    btn.disabled = false;
  }
});

$("clearHistoryBtn").addEventListener("click", async () => {
  await api("/api/history/clear", { method: "DELETE" });
  selectedQueueItems.clear();
  selectedVideos.clear();
  await refresh();
});

$("selectAllQueueBtn").addEventListener("click", () => {
  const items = queueForSelectedChannel().filter((item) => item.status === "pending" || item.status === "failed");
  const allSelected = items.length > 0 && items.every((item) => selectedQueueItems.has(item.id));
  if (allSelected) {
    items.forEach((item) => selectedQueueItems.delete(item.id));
  } else {
    items.forEach((item) => selectedQueueItems.add(item.id));
  }
  renderQueue();
});

// Login removed: the app starts straight into the workspace, with no license
// check gating startup and no periodic revalidation.
async function initApp() {
  await refresh();
  document.documentElement.classList.remove("auth-pending");
  scanCurrentLibraryFolder().catch(() => null);
  scanAdbDevices().catch(() => null);
}

initApp().catch((error) => console.error("[app] init failed:", error));
setInterval(() => refresh().catch(() => null), 5000);
setInterval(() => scanAdbDevices().catch(() => null), 15000);
setInterval(() => scanCurrentLibraryFolder().catch(() => null), LIBRARY_SCAN_INTERVAL_MS);
setInterval(() => {
  if (state) renderQueue();
}, 1000);
