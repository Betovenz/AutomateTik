// POST WEB — publish clips to TikTok through the browser extension.
//
// The extension bridge lives in the AI Studio Node server (port 18787), not in
// this app's Python server, so this page keeps its own queue here and hands one
// clip at a time to that server's /api/tiktok/post-web/publish. Nothing here
// talks to the extension directly.
//
// Loaded after app.js, so it reuses its top-level bindings: $, escapeHtml,
// escapeHtmlAttr, aiStudioApi, AI_STUDIO_ORIGIN.

const PW_JOBS_KEY = "autopost.postweb.jobs";
const PW_SETTINGS_KEY = "autopost.postweb.settings";
const PW_SCHEDULE_MIN_LEAD_MIN = 15;
// Fuzzy video<->product match: the longest run of characters the video name and
// the product title share. They never match exactly, so anything at or above
// this length is treated as the same product.
const PW_MATCH_MIN_CHARS = 10;
// Notes the extension returns that say nothing the status pill does not.
const PW_PLAIN_NOTES = new Set(["posted to TikTok", "saved to drafts", "scheduled"]);

let pwJobs = pwRead(PW_JOBS_KEY, []);
let pwAccounts = [];
let pwActiveAccountKey = pwRead(PW_SETTINGS_KEY, {})?.accountKey || "";
let pwProducts = [];
let pwSelectedJobs = new Set();
// Run state is per channel, the way All Channels keeps one queue per device:
// selecting a channel scopes the whole workspace to it, and two channels can be
// running at the same time without either one's Run/Stop touching the other.
const pwRunningChannels = new Set();
const pwStopRequests = new Set();
let pwPageReady = false;

function pwRead(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function pwWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled/full — the page still works for this session */
  }
}

function pwSettings() {
  return pwRead(PW_SETTINGS_KEY, {}) || {};
}

function pwSaveSettings() {
  pwWrite(PW_SETTINGS_KEY, {
    accountKey: pwActiveAccountKey,
    mode: pwMode(),
    scheduleAt: $("pwScheduleAt")?.value || "",
    scheduleGap: Number($("pwScheduleGap")?.value || 60) || 60,
    aiLabel: !!$("pwAiLabel")?.checked,
    disclose: !!$("pwDisclose")?.checked,
    cartEnabled: !!$("pwCartEnabled")?.checked,
    cartDefaultOn: true,
  });
  pwPersistSettings();
}

// localStorage stays the instant local cache, but it is per-browser: clearing
// site data, opening another browser, or moving the portable build to another
// machine used to wipe these settings. They are mirrored to
// ai_studio/runtime/postweb-settings.json, which pwInitPage reads back on open.
let pwPersistTimer = null;
function pwPersistSettings() {
  clearTimeout(pwPersistTimer);
  // Typing in the caption box fires this per keystroke; one write per pause.
  pwPersistTimer = setTimeout(() => {
    aiStudioApi("/api/postweb/settings", {
      method: "POST",
      body: JSON.stringify({ settings: pwSettings() }),
    }).catch(() => null);   // offline/ai_studio down: the local cache still holds
  }, 400);
}

/** Put a stored settings object into the form. Used for the local cache on open
 *  and again when the server's copy arrives. Values are assigned directly, never
 *  via a dispatched change event, so restoring never triggers a save loop. */
function pwApplySettings(saved) {
  if (saved.scheduleAt && $("pwScheduleAt")) $("pwScheduleAt").value = saved.scheduleAt;
  if (saved.scheduleGap && $("pwScheduleGap")) $("pwScheduleGap").value = String(saved.scheduleGap);
  if ($("pwAiLabel")) $("pwAiLabel").checked = !!saved.aiLabel;
  if ($("pwDisclose")) $("pwDisclose").checked = !!saved.disclose;
  // Cart on is the default. Browsers that used the app before this change carry
  // cartEnabled:false only because that WAS the default and pwSaveSettings writes
  // every field on any change — so a stored false from back then is not a real
  // choice. cartDefaultOn marks a save made since the new default: without it,
  // adopt the default once; with it, respect whatever is stored.
  if ($("pwCartEnabled")) {
    const chosen = saved.cartDefaultOn === true;
    $("pwCartEnabled").checked = chosen ? saved.cartEnabled !== false : true;
    if (!chosen) pwWrite(PW_SETTINGS_KEY, { ...saved, cartEnabled: true, cartDefaultOn: true });
  }
  if (saved.mode) {
    document.querySelectorAll(".pw-mode").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.pwMode === saved.mode);
    });
    const field = $("pwScheduleField");
    if (field) field.hidden = saved.mode !== "schedule";
  }
}

/** The server's copy wins on open — that is the whole point of storing it. If
 *  the file has nothing yet (first run since this landed), seed it from whatever
 *  this browser already had so nothing is lost. */
async function pwSyncSettingsFromServer() {
  const data = await aiStudioApi("/api/postweb/settings");
  if (!data?.stored) {
    pwPersistSettings();
    return;
  }
  pwWrite(PW_SETTINGS_KEY, { ...pwSettings(), ...data.settings });
  pwActiveAccountKey = data.settings.accountKey || pwActiveAccountKey;
  pwApplySettings(pwSettings());
}

function pwMode() {
  return document.querySelector(".pw-mode.is-active")?.dataset.pwMode || "post";
}

function pwAccountKey(account) {
  return String(account?.uniqueId || account?.id || "").toLowerCase();
}

function pwSelectedAccount() {
  return pwAccounts.find((account) => pwAccountKey(account) === pwActiveAccountKey) || null;
}

function pwSetClipStatus(message, isError = false) {
  const el = $("pwClipStatus");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("is-error", !!isError);
}

function pwParseHashtags(text) {
  return String(text || "")
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean);
}

// datetime-local value + N minutes, back in datetime-local format.
function pwAddMinutes(localValue, minutes) {
  if (!localValue) return "";
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return localValue;
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---- accounts -------------------------------------------------------------

// The sidebar rail is the account picker on this page — one card per TikTok
// channel, click to select, mirroring how All Channels picks a device channel.
function pwRenderSidebarChannels() {
  const wrap = $("pwSideChannels");
  if (!wrap) return;
  wrap.innerHTML = pwAccounts.length
    ? pwAccounts
        .map((account) => {
          const key = pwAccountKey(account);
          const active = key === pwActiveAccountKey ? " active" : "";
          const nickname = account.nickname && account.nickname !== account.uniqueId ? account.nickname : "";
          const meta = [account.chromeProfileLabel, account.followerCount ? `${account.followerCount} followers` : ""]
            .filter(Boolean)
            .join(" · ");
          return `
        <div class="channel-card pw-channel-card${active}" data-pw-account="${escapeHtmlAttr(key)}" role="button" tabindex="0">
          <div class="channel-row">
            <div class="pw-channel-main">
              <h3 class="channel-title"><span>@${escapeHtml(account.uniqueId || "?")}</span></h3>
              ${nickname ? `<div class="channel-meta">${escapeHtml(nickname)}</div>` : ""}
            </div>
          </div>
          <div class="channel-meta">${escapeHtml(meta || "TikTok account")}</div>
        </div>`;
        })
        .join("")
    : `<div class="pw-side-empty">ยังไม่มีช่อง — กด "สแกนหา Account"</div>`;
  pwRenderActiveAccount();
}

function pwRenderActiveAccount() {
  const el = $("pwActiveAccount");
  if (!el) return;
  const account = pwSelectedAccount();
  el.classList.toggle("is-empty", !account);
  if (!account) {
    el.textContent = "เลือกช่องจากแถบ TikTok Channel ทางซ้าย";
    return;
  }
  const meta = [account.chromeProfileLabel, account.followerCount ? `${account.followerCount} followers` : ""]
    .filter(Boolean)
    .join(" · ");
  el.innerHTML = `<strong>@${escapeHtml(account.uniqueId || "?")}</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}`;
}

function pwSelectAccount(key) {
  pwActiveAccountKey = key;
  // Products belong to the account they were pulled from, so drop the cached
  // list on switch — the next add re-pulls for the newly picked channel.
  pwProducts = [];
  pwRenderSidebarChannels();
  // The queue, the counters and the Run/Stop buttons all belong to the channel
  // that is selected, so switching re-scopes the workspace to the new one.
  pwRenderQueue();
  pwSaveSettings();
}

async function pwLoadAccounts({ refresh = false } = {}) {
  const status = $("pwSideStatus");
  if (status) {
    status.textContent = refresh ? "กำลังสแกนหา Account..." : "กำลังโหลดช่อง...";
    status.classList.remove("is-error");
  }
  try {
    const data = await aiStudioApi(`/api/tiktok/accounts?${refresh ? "refresh=1" : "cache=1"}`);
    // Publishing to the shared store is what keeps the Channel page in step;
    // the subscription below then refreshes pwAccounts and re-renders.
    tiktokAccountsStore.set(Array.isArray(data.accounts) ? data.accounts : []);
  } catch (error) {
    if (status) {
      status.textContent = `โหลดช่องไม่สำเร็จ: ${error.message || error}`;
      status.classList.add("is-error");
    }
  }
  pwRenderSidebarChannels();
  pwSaveSettings();
}

// The Channel page adds, refreshes and deletes channels; the sidebar has to show
// the same list without waiting for a reload. One store, both pages subscribe.
tiktokAccountsStore.subscribe((accounts) => {
  pwAccounts = accounts;
  // Only re-pick once a real response has landed — an empty list before the
  // first fetch is "not loaded yet", not "no channels", and must not wipe the
  // saved selection.
  if (tiktokAccountsStore.loaded) {
    if (!pwAccounts.some((account) => pwAccountKey(account) === pwActiveAccountKey)) {
      pwActiveAccountKey = pwAccounts.length ? pwAccountKey(pwAccounts[0]) : "";
    }
    const status = $("pwSideStatus");
    if (status && !status.classList.contains("is-error")) {
      status.textContent = pwAccounts.length
        ? `${pwAccounts.length} ช่อง`
        : "ยังไม่มีช่อง — ไปหน้า Channel แล้วกดสแกนหา Account";
    }
  }
  pwRenderSidebarChannels();
});

// ---- cart / pinned product ------------------------------------------------

function pwCartEnabled() {
  return !!$("pwCartEnabled")?.checked;
}

// Products live only in AI Studio's page state, so this page pulls its own copy
// straight from the Showcase API using the selected account. There is no manual
// picker any more — this runs on demand from the add-to-queue flow, and reports
// through the queue's status line.
async function pwPullProducts() {
  const account = pwSelectedAccount();
  if (!account) {
    pwSetClipStatus("เลือกช่องจากแถบ TikTok Channel ทางซ้ายก่อน", true);
    return;
  }
  try {
    const data = await aiStudioApi("/api/tiktok/showcase/pull", {
      method: "POST",
      body: JSON.stringify({ account }),
    });
    const rows = Array.isArray(data.products) ? data.products : [];
    pwProducts = rows
      .map((product) => ({
        id: String(product.id || product.productid || product.product_id || ""),
        title: product.title || "",
        price: product.price || product.format_available_price || "",
      }))
      .filter((product) => product.id);
  } catch (error) {
    pwProducts = [];
    pwSetClipStatus(`ดึงสินค้าจาก Showcase ไม่สำเร็จ: ${error.message || error}`, true);
  }
}

async function pwRefreshExtensionState() {
  const wrap = $("pwExtensionState");
  const label = $("pwExtensionLabel");
  if (!wrap || !label) return;
  try {
    const data = await aiStudioApi("/api/extension-status");
    const online = !!data.connected;
    wrap.classList.toggle("is-online", online);
    label.textContent = online ? "Extension เชื่อมต่อแล้ว" : "Extension ยังไม่เชื่อมต่อ";
  } catch {
    wrap.classList.remove("is-online");
    label.textContent = "ต่อ AI Studio ไม่ได้";
  }
}

// ---- queue ----------------------------------------------------------------

function pwStatusLabel(job) {
  if (job.status === "running") return "กำลังโพสต์";
  if (job.status === "done") {
    if (job.result?.scheduled) return "ตั้งเวลาแล้ว";
    if (job.result?.drafted) return "บันทึกร่างแล้ว";
    return "โพสต์แล้ว";
  }
  if (job.status === "failed") return "ไม่สำเร็จ";
  if (job.status === "stopped") return "หยุดแล้ว";
  return "รอคิว";
}

// Delivery mode only — the card appends the cart and account parts itself.
function pwFinalizeLabel(job) {
  if (job.finalize === "schedule") return `ตั้งเวลา ${job.scheduleAt || "-"}`;
  if (job.finalize === "draft") return "บันทึกร่าง";
  return "โพสต์เลย";
}

function pwRenderQueue() {
  const list = $("pwQueueList");
  const subtitle = $("pwQueueSubtitle");
  if (!list) return;
  // Scoped to the selected channel, the way All Channels scopes its queue to the
  // selected device — one channel's jobs never appear in another's workspace.
  const jobs = pwJobsForActiveChannel();
  list.classList.toggle("empty", !jobs.length);
  // Same card anatomy as the All Channels queue: checkbox, title + status pill,
  // a schedule/detail strip, the caption line, then the row actions.
  list.innerHTML = jobs.length
    ? jobs
        .map((job) => {
          const selected = pwSelectedJobs.has(job.id);
          const cart = job.productId
            ? `ปักสินค้า: ${job.productCta || job.productId}${job.matchScore ? ` (ตรง ${job.matchScore} ตัว)` : ""}`
            : "ไม่ปักสินค้า";
          const detail = [pwFinalizeLabel(job), cart, job.account ? `@${job.account}` : ""].filter(Boolean).join(" • ");
          // The extension's plain success notes only repeat the status pill, so
          // show a note when it carries something extra (a skipped product tag,
          // a warning) or when the job failed.
          const note = job.error || (PW_PLAIN_NOTES.has((job.note || "").trim()) ? "" : job.note || "");
          return `
      <div class="queue-card pw-job-card${selected ? " selected" : ""}" data-pw-status="${escapeHtmlAttr(job.status)}">
        <button class="queue-check ${selected ? "checked" : ""}" data-pw-job-toggle="${escapeHtmlAttr(job.id)}" type="button" aria-label="Select job"></button>
        <div class="queue-card-body">
          <div class="card-row">
            <div><div class="queue-title" title="${escapeHtmlAttr(job.name)}">${escapeHtml(job.name)}</div></div>
            <span class="pw-job-status">${escapeHtml(pwStatusLabel(job))}</span>
          </div>
          <div class="queue-schedule">${escapeHtml(detail)}</div>
          <div class="pw-job-caption">${escapeHtml(job.caption || "—")}</div>
          ${(job.hashtags || []).length
            ? `<div class="pw-job-tags">${job.hashtags.map((tag) => `<span>#${escapeHtml(String(tag).replace(/^#/, ""))}</span>`).join("")}</div>`
            : ""}
          ${note ? `<div class="queue-meta${job.error ? " is-error" : ""}">${escapeHtml(note)}</div>` : ""}
          <div class="mini-actions">
            ${job.status === "failed" || job.status === "stopped"
              ? `<button class="retry-btn" data-pw-job-retry="${escapeHtmlAttr(job.id)}" type="button">Retry</button>`
              : ""}
            <button class="danger" data-pw-job-remove="${escapeHtmlAttr(job.id)}" type="button">Remove</button>
          </div>
        </div>
      </div>`;
        })
        .join("")
    : `<div class="pw-empty">ยังไม่มีงานในคิว — เลือกวิดีโอจากแถบ Video Library แล้วกด "Add to Tiktok"</div>`;
  if (subtitle) {
    const pending = jobs.filter((job) => job.status === "queued").length;
    const others = pwJobs.length - jobs.length;
    const elsewhere = others > 0 ? ` · อีก ${others} งานอยู่ช่องอื่น` : "";
    subtitle.textContent = jobs.length
      ? `${jobs.length} งาน · รอคิว ${pending}${elsewhere}`
      : `ยังไม่มีงานในคิวของช่องนี้${elsewhere}`;
  }
  pwUpdateMetrics();
  pwUpdateRunButtons();
}

/** Which channel a job belongs to. Each job snapshots the channel that was
 *  selected when it was queued, so one stored queue holds several channels. */
function pwJobChannelKey(job) {
  return pwAccountKey(job.accountRaw) || String(job.account || "").toLowerCase() || "__default__";
}

/** The jobs the workspace is currently showing — only the selected channel's.
 *  With no channel selected yet (first load) nothing is filtered out. */
function pwJobsForActiveChannel() {
  if (!pwActiveAccountKey) return pwJobs;
  return pwJobs.filter((job) => pwJobChannelKey(job) === pwActiveAccountKey);
}

function pwChannelRunning(key = pwActiveAccountKey) {
  return pwRunningChannels.has(key);
}

function pwUpdateMetrics() {
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = String(value);
  };
  const jobs = pwJobsForActiveChannel();
  set("pwMetricQueued", jobs.filter((job) => job.status === "queued").length);
  set("pwMetricDone", jobs.filter((job) => job.status === "done").length);
  set("pwMetricFailed", jobs.filter((job) => job.status === "failed").length);
}

function pwUpdateRunButtons() {
  const run = $("pwRunBtn");
  const stop = $("pwStopBtn");
  const jobs = pwJobsForActiveChannel();
  if (run) run.disabled = pwChannelRunning() || !jobs.some((job) => job.status === "queued");
  if (stop) stop.disabled = !pwChannelRunning();
}

// ---- AI caption settings ---------------------------------------------------

// Keys live on the AI Studio server; the browser only ever sees a mask of them,
// and only sends a key when the user actually types a new one.
const PW_KEY_FIELDS = { openai: "pwKeyOpenai", gemini: "pwKeyGemini", openrouter: "pwKeyOpenrouter" };
// pwLoadAiSettings swaps the placeholder to "ใส่คีย์ใหม่เพื่อแทนที่" once a key is
// stored, so it needs the original back when that key is deleted.
const PW_KEY_PLACEHOLDERS = { openai: "sk-...", gemini: "AIza...", openrouter: "sk-or-..." };

function pwSetAiStatus(message, isError = false) {
  const el = $("pwAiStatus");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("is-error", !!isError);
}

function pwOpenAiModal() {
  const modal = $("pwAiModal");
  if (!modal) return;
  pwSetAiStatus("");
  // Re-read on open so the masks reflect whatever was saved last.
  pwLoadAiSettings().catch(() => null);
  modal.classList.remove("hidden");
}

function pwCloseAiModal() {
  const modal = $("pwAiModal");
  if (!modal) return;
  // Never leave a typed key sitting in the DOM after the dialog closes.
  for (const fieldId of Object.values(PW_KEY_FIELDS)) {
    const field = $(fieldId);
    if (field) field.value = "";
  }
  modal.classList.add("hidden");
}

async function pwLoadAiSettings() {
  try {
    const data = await aiStudioApi("/api/postweb/ai-settings");
    if ($("pwAiProvider") && data.provider) $("pwAiProvider").value = data.provider;
    for (const [provider, fieldId] of Object.entries(PW_KEY_FIELDS)) {
      const mask = data.keys?.[provider] || "";
      const state = document.querySelector(`[data-pw-key-state="${provider}"]`);
      if (state) state.textContent = mask ? `ตั้งค่าแล้ว: ${mask}` : "ยังไม่ได้ตั้งค่า";
      const field = $(fieldId);
      // Leave the box empty: typing is what replaces a stored key.
      if (field) field.placeholder = mask ? "ใส่คีย์ใหม่เพื่อแทนที่" : PW_KEY_PLACEHOLDERS[provider];
      const removeBtn = document.querySelector(`[data-pw-key-delete="${provider}"]`);
      if (removeBtn) removeBtn.hidden = !mask;
    }
    if ($("pwAiCaptionEnabled")) $("pwAiCaptionEnabled").checked = data.captionAi === true;
  } catch (error) {
    pwSetAiStatus(`โหลดตั้งค่า AI ไม่ได้: ${error.message || error}`, true);
  }
}

async function pwSaveAiSettings() {
  const keys = {};
  for (const [provider, fieldId] of Object.entries(PW_KEY_FIELDS)) {
    const value = $(fieldId)?.value.trim();
    if (value) keys[provider] = value;
  }
  pwSetAiStatus("กำลังบันทึก...");
  try {
    await aiStudioApi("/api/postweb/ai-settings", {
      method: "POST",
      body: JSON.stringify({
        provider: $("pwAiProvider")?.value || "openai",
        keys,
        captionAi: !!$("pwAiCaptionEnabled")?.checked,
      }),
    });
    // Clear the inputs so a key is never left sitting in the DOM.
    for (const fieldId of Object.values(PW_KEY_FIELDS)) {
      const field = $(fieldId);
      if (field) field.value = "";
    }
    await pwLoadAiSettings();
    pwSetAiStatus("บันทึกแล้ว");
  } catch (error) {
    pwSetAiStatus(`บันทึกไม่สำเร็จ: ${error.message || error}`, true);
  }
}

/** Remove one stored key. Confirmed first because the operator cannot read it
 *  back out of the app — a stray click means going to the provider for a new
 *  one. Matches the ลบโปรไฟล์ confirm in app.js. */
async function pwDeleteAiKey(provider) {
  if (!PW_KEY_FIELDS[provider]) return;
  if (!confirm(`ลบ API key ของ ${provider} ?`)) return;
  pwSetAiStatus("กำลังลบคีย์...");
  try {
    await aiStudioApi("/api/postweb/ai-settings", {
      method: "POST",
      body: JSON.stringify({ clear: [provider] }),
    });
    const field = $(PW_KEY_FIELDS[provider]);
    if (field) field.value = "";
    await pwLoadAiSettings();
    pwSetAiStatus(`ลบคีย์ ${provider} แล้ว`);
  } catch (error) {
    pwSetAiStatus(`ลบคีย์ไม่สำเร็จ: ${error.message || error}`, true);
  }
}

async function pwTestAiKey() {
  const provider = $("pwAiProvider")?.value || "openai";
  const typed = $(PW_KEY_FIELDS[provider])?.value.trim() || "";
  pwSetAiStatus(`กำลังทดสอบ ${provider}...`);
  try {
    const resp = await fetch(`${AI_STUDIO_ORIGIN}/api/postweb/ai-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key: typed }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!data.ok) {
      pwSetAiStatus(`ทดสอบ ${provider} ไม่ผ่าน: ${data.error || "ไม่ทราบสาเหตุ"}`, true);
      return;
    }
    pwSetAiStatus(`ทดสอบ ${provider} ผ่าน${data.models ? ` — ใช้ได้ ${data.models} โมเดล` : ""}`);
  } catch (error) {
    pwSetAiStatus(`ทดสอบไม่สำเร็จ: ${error.message || error}`, true);
  }
}

// Uses the picked video (or the selected library video) as the subject.
/** Is AI captioning switched on in the API settings? Read from the server so
 *  every browser and every channel sees the same answer. */
async function pwAiCaptionOn() {
  try {
    const data = await aiStudioApi("/api/postweb/ai-settings");
    return data?.captionAi === true;
  } catch (error) {
    return false;   // settings unreachable: fall back to the product name
  }
}

/** The caption and hashtags this clip will actually be posted with.
 *  Falls back to the product name if the AI call fails, so one bad response
 *  never blocks a clip from being queued. */
// Clip files are named "<timestamp>-<jobId>-<product name>-final" by
// finalizeScenes, and an order number like AB-0075-029 can appear too. None of
// that belongs in a hashtag, so strip it back to the product name.
const PW_ORDER_NUMBER_RE = /\b[A-Za-z]{2}-\d{4}-\d{3}\b/g;
// Used to top up to the requested tag count when the name yields too few.
const PW_FILLER_TAGS = ["fyp", "tiktokshop", "ของดีบอกต่อ", "ราคาถูก", "ส่งไว"];

function pwProductNameFromClip(name) {
  let text = String(name || "").trim();
  text = text.replace(/\.[a-z0-9]{2,4}$/i, "");        // file extension
  text = text.replace(/-(final|remix)$/i, "");         // finalizeScenes suffix
  text = text.replace(PW_ORDER_NUMBER_RE, " ");        // order number, wherever it sits
  const withoutStamp = text.replace(/^\d{10,}-/, "");  // leading Date.now()
  if (withoutStamp !== text) {
    // Only strip the job id when a timestamp really preceded it — otherwise this
    // would eat the first word of a product name that just starts with letters.
    text = withoutStamp.replace(/^[a-z0-9]{4,}-/i, "");
  }
  return text.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Hashtags built from the product name alone. Words shorter than 4 characters
 *  are dropped: the file name is truncated when it is built, so its last word is
 *  often a fragment ("Jea" from "Jeans"). */
function pwHashtagsFromName(name, count = 5) {
  const seen = new Set();
  const tags = [];
  const push = (word) => {
    const key = word.toLowerCase();
    if (seen.has(key) || tags.length >= count) return;
    seen.add(key);
    tags.push(word);
  };
  for (const word of pwProductNameFromClip(name).split(/[\s,.\/|()\[\]#]+/)) {
    if (word.length >= 4) push(word);
  }
  for (const filler of PW_FILLER_TAGS) push(filler);
  return tags;
}

/** Split "text #a #b" into the caption body and its tags. The extension joins
 *  caption + hashtags back together and dedupes, so pulling the tags out only
 *  changes how the card DISPLAYS them — the posted text is identical. */
function pwSplitCaptionTags(text) {
  const source = String(text || "");
  const hashtags = (source.match(/#[^\s#]+/g) || []).map((tag) => tag.slice(1)).filter(Boolean);
  const caption = source.replace(/#[^\s#]+/g, " ").replace(/\s+/g, " ").trim();
  return { caption, hashtags };
}

async function pwCaptionForVideo(video, useAi) {
  const productName = video.name || "";
  if (!useAi) {
    // AI off: no caption at all — just 5 hashtags built from the product name,
    // with the timestamp/job-id/order-number noise in the file name stripped
    // out. Source is the video's All Channels caption when it has one, so an
    // edit made on that page still drives the tags.
    const source = String(video.caption || "").trim() || productName;
    return { caption: "", hashtags: pwHashtagsFromName(source, 5) };
  }
  try {
    const resp = await fetch(`${AI_STUDIO_ORIGIN}/api/postweb/ai-caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "สร้างแคปชั่นไม่สำเร็จ");
    return {
      caption: data.caption || productName,
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    };
  } catch (error) {
    pwSetClipStatus(`AI คิดแคปชั่นให้ "${productName}" ไม่สำเร็จ — ใช้ชื่อสินค้าแทน (${error.message || error})`, true);
    return { caption: productName, hashtags: [] };
  }
}

// ---- activity log ----------------------------------------------------------

// This page's work happens in the AI Studio server and the browser extension,
// so the shared log panel shows THAT log here instead of the device-queue log
// the other tabs use. Sources are filtered to the publishing path.

async function pwRenderLogs() {
  const wrap = $("activityLog");
  if (!wrap || typeof activeView === "undefined" || activeView !== "postweb") return;
  let rows = [];
  try {
    // Plain-language posting activity for EVERY channel — the server does the
    // wording so the AI Studio dock and this dock read the same kind of feed.
    const data = await aiStudioApi("/api/logs/friendly?audience=post&limit=200");
    rows = Array.isArray(data.logs) ? data.logs : [];
  } catch (error) {
    wrap.innerHTML = `<div class="queue-meta">ต่อ AI Studio ไม่ได้: ${escapeHtml(String(error.message || error))}</div>`;
    return;
  }
  if (activeView !== "postweb") return; // tab changed while the request was in flight
  if (!rows.length) {
    wrap.innerHTML = `<div class="queue-meta">ยังไม่มีการโพสต์</div>`;
    return;
  }
  wrap.innerHTML = rows
    .map((row) => {
      const time = String(row.time || "").slice(11, 19);
      const text = String(row.text || "");
      return `
      <div class="log-row ${escapeHtmlAttr(row.level || "info")}">
        <div class="log-time">${escapeHtml(time)}</div>
        <div class="log-message"><span>${escapeHtml(text)}</span></div>
      </div>`;
    })
    .join("");
  if (typeof bindCopyButtons === "function") bindCopyButtons(wrap);
}

function pwApplyLogPanel() {
  const title = $("logPanelTitle");
  const subtitle = $("logPanelSubtitle");
  const onPostWeb = typeof activeView !== "undefined" && activeView === "postweb";
  if (title) title.textContent = onPostWeb ? "TikTok Post Log" : "Activity Log";
  if (subtitle) {
    subtitle.textContent = onPostWeb
      ? "log การโพสต์ TikTok จาก AI Studio และ extension"
      : "ติดตามการโอนวิดีโอ การโพสต์ และ error ล่าสุด";
  }
  if (onPostWeb) pwRenderLogs().catch(() => null);
}

// ---- video <-> product matching -------------------------------------------

// Strip the noise that never helps a match: extension, the "(2)" suffix Windows
// adds to duplicates, punctuation, and spacing. Case-folded so Latin brand names
// compare too (Thai has no case, so this is a no-op there).
function pwNormalizeName(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\((\d+)\)\s*$/, "")
    .replace(/[\s_\-–—.,!?"'`|/\\[\]()]+/g, "")
    .toLowerCase();
}

// Length of the longest run of characters both strings share. Chosen over a
// word-overlap score because these names are Thai product copy with no reliable
// word boundaries — a shared run of N characters is the signal that survives.
function pwLongestCommonRun(a, b) {
  if (!a || !b) return 0;
  // Rolling two-row LCS table: only the previous row is ever needed.
  let previous = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

// Best product for one video, or null when nothing shares enough characters.
function pwMatchProduct(videoName, products) {
  const name = pwNormalizeName(videoName);
  if (!name) return null;
  let best = null;
  let bestScore = 0;
  for (const product of products) {
    const score = pwLongestCommonRun(name, pwNormalizeName(product.title));
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= PW_MATCH_MIN_CHARS ? { product: best, score: bestScore } : null;
}

// ---- add videos from the Video Library into the queue ----------------------

// Called by the library's "Add to Tiktok" button (app.js) with the selected
// rows. Each video becomes one post job; with the cart on, Showcase is pulled
// once and each video is paired with its closest-named product.
async function pwAddVideosToQueue(videos) {
  const list = Array.isArray(videos) ? videos.filter((video) => video && video.url) : [];
  if (!list.length) {
    pwSetClipStatus("เลือกวิดีโอจากแถบ Video Library ก่อน", true);
    return;
  }
  const account = pwSelectedAccount();
  if (!account) {
    pwSetClipStatus("เลือกช่องจากแถบ TikTok Channel ทางซ้ายก่อน", true);
    return;
  }

  const mode = pwMode();
  const baseAt = $("pwScheduleAt")?.value || "";
  const gap = Number($("pwScheduleGap")?.value || 60) || 60;
  if (mode === "schedule") {
    if (!baseAt) {
      pwSetClipStatus("เลือกเวลาที่จะโพสต์ก่อน", true);
      return;
    }
    const leadMinutes = (new Date(baseAt).getTime() - Date.now()) / 60000;
    if (!Number.isFinite(leadMinutes) || leadMinutes < PW_SCHEDULE_MIN_LEAD_MIN) {
      pwSetClipStatus(`TikTok ต้องตั้งเวลาล่วงหน้าอย่างน้อย ${PW_SCHEDULE_MIN_LEAD_MIN} นาที`, true);
      return;
    }
  }

  // Cart on: make sure the Showcase list is loaded, then pair per video.
  const cartOn = pwCartEnabled();
  if (cartOn && !pwProducts.length) {
    pwSetClipStatus("กำลังดึงสินค้าจาก Showcase เพื่อจับคู่กับวิดีโอ...");
    await pwPullProducts();
    if (!pwProducts.length) {
      pwSetClipStatus("ดึงสินค้าจาก Showcase ไม่ได้ — ปิดตะกร้า หรือลองกด 'ดึงสินค้า' อีกครั้ง", true);
      return;
    }
  }

  // Caption is per clip now, not one box shared by the whole batch.
  //   AI off — the clip's own product name, the same default All Channels uses.
  //   AI on  — one call per clip at queue time, so the card shows the exact text
  //            that will be typed into TikTok.
  const useAi = await pwAiCaptionOn();
  if (useAi) pwSetClipStatus(`กำลังให้ AI คิดแคปชั่น ${list.length} คลิป...`);
  const written = await Promise.all(list.map((video) => pwCaptionForVideo(video, useAi)));
  const disclose = !!$("pwDisclose")?.checked;
  const settings = { aiLabel: !!$("pwAiLabel")?.checked, disclose, yourBrand: disclose };

  const startIndex = pwJobs.length;
  let matched = 0;
  const jobs = list.map((video, index) => {
    const hit = cartOn ? pwMatchProduct(video.name, pwProducts) : null;
    if (hit) matched += 1;
    const { caption, hashtags } = written[index];
    return {
      id: `PW-${Date.now()}-${index}`,
      name: video.name,
      mediaUrl: video.url,
      caption,
      hashtags,
      finalize: mode,
      scheduleAt: mode === "schedule" ? pwAddMinutes(baseAt, gap * (startIndex + index)) : "",
      settings,
      productId: hit ? hit.product.id : null,
      productCta: hit ? hit.product.title : "",
      matchScore: hit ? hit.score : 0,
      account: account.uniqueId || "",
      accountRaw: account,
      status: "queued",
      error: "",
      note: "",
      result: null,
    };
  });

  pwJobs = [...pwJobs, ...jobs];
  pwWrite(PW_JOBS_KEY, pwJobs);
  pwRenderQueue();

  if (!cartOn) {
    pwSetClipStatus(`เพิ่มลงคิวแล้ว ${jobs.length} วิดีโอ (ไม่ปักสินค้า) — กด Run เพื่อเริ่มโพสต์`);
  } else if (matched === jobs.length) {
    pwSetClipStatus(`เพิ่มลงคิวแล้ว ${jobs.length} วิดีโอ — จับคู่สินค้าได้ครบทุกตัว`);
  } else {
    pwSetClipStatus(
      `เพิ่มลงคิวแล้ว ${jobs.length} วิดีโอ — จับคู่สินค้าได้ ${matched} ตัว, อีก ${jobs.length - matched} ตัวจะโพสต์แบบไม่ปักสินค้า`,
      true
    );
  }
}

function pwSetJob(job, patch) {
  Object.assign(job, patch);
  pwWrite(PW_JOBS_KEY, pwJobs);
  pwRenderQueue();
}

async function pwPublishJob(job) {
  pwSetJob(job, { status: "running", error: "", note: "" });
  try {
    // The extension fetches the clip itself, so a server-relative library URL
    // has to be absolutised against the AI Studio origin that serves it.
    const mediaUrl = job.mediaUrl.startsWith("http") ? job.mediaUrl : `${AI_STUDIO_ORIGIN}${job.mediaUrl}`;
    const resp = await fetch(`${AI_STUDIO_ORIGIN}/api/tiktok/post-web/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: job.id,
        mediaUrl,
        caption: job.caption,
        hashtags: job.hashtags,
        finalize: job.finalize,
        scheduleAt: job.scheduleAt,
        settings: job.settings,
        productId: job.productId || null,
        productCta: job.productCta || "",
        account: job.accountRaw,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || "publish failed");
    pwSetJob(job, { status: "done", result: data, note: data.note || "" });
  } catch (error) {
    pwSetJob(job, { status: "failed", error: String(error.message || error) });
  }
  // Surface what the extension reported without waiting for the 5s poll.
  pwRenderLogs().catch(() => null);
}

/** Runs the SELECTED channel's queue only. Its jobs stay sequential — one
 *  channel is one Chrome profile with one TikTok upload tab, and the extension's
 *  publish step reuses that tab, so two posts at the same profile would fight
 *  over it. Other channels are untouched and can be running at the same time:
 *  switch channel, press Run again, and the two proceed independently. */
async function pwRunQueue() {
  const channelKey = pwActiveAccountKey;
  if (pwRunningChannels.has(channelKey)) return;
  const pending = pwJobsForActiveChannel().filter((job) => job.status === "queued");
  if (!pending.length) {
    pwSetClipStatus("ไม่มีงานที่รอคิวของช่องนี้", true);
    return;
  }
  pwRunningChannels.add(channelKey);
  pwStopRequests.delete(channelKey);
  pwUpdateRunButtons();
  const label = pwSelectedAccount()?.uniqueId ? `@${pwSelectedAccount().uniqueId}` : "ช่องนี้";
  pwSetClipStatus(`กำลังโพสต์ ${pending.length} งานของ ${label}...`);

  for (const job of pending) {
    if (pwStopRequests.has(channelKey)) {
      pwSetJob(job, { status: "stopped" });
      continue;
    }
    await pwPublishJob(job);
  }

  const stopped = pwStopRequests.has(channelKey);
  pwRunningChannels.delete(channelKey);
  pwStopRequests.delete(channelKey);
  pwUpdateRunButtons();
  const failed = pending.filter((job) => job.status === "failed").length;
  pwSetClipStatus(
    stopped ? `หยุดคิวของ ${label} แล้ว` : failed ? `จบคิวของ ${label} — ไม่สำเร็จ ${failed} งาน` : `โพสต์ครบทุกงานของ ${label} แล้ว`,
    !!failed
  );
}

// Called by setActiveView() the first time the POST WEB tab is opened.
function pwInitPage() {
  if (pwPageReady) return;
  pwPageReady = true;

  // Paint from the local cache first so the form is never briefly blank, then
  // let the stored file overwrite it — that copy is the one that survives a
  // cleared cache or a different machine.
  pwApplySettings(pwSettings());
  pwSyncSettingsFromServer().catch(() => null);

  pwRenderQueue();
  pwLoadAccounts().catch(() => null);
  pwRefreshExtensionState().catch(() => null);
  pwLoadAiSettings().catch(() => null);
}

document.querySelectorAll(".pw-mode").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pw-mode").forEach((other) => other.classList.remove("is-active"));
    btn.classList.add("is-active");
    const field = $("pwScheduleField");
    if (field) field.hidden = btn.dataset.pwMode !== "schedule";
    pwSaveSettings();
  });
});

["pwCaption", "pwHashtags", "pwScheduleAt", "pwScheduleGap", "pwAiLabel", "pwDisclose"].forEach((id) => {
  $(id)?.addEventListener("change", pwSaveSettings);
  $(id)?.addEventListener("input", pwSaveSettings);
});

$("pwSideChannels")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-pw-account]");
  if (card) pwSelectAccount(card.dataset.pwAccount);
});
$("pwSideChannels")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-pw-account]");
  if (!card) return;
  event.preventDefault();
  pwSelectAccount(card.dataset.pwAccount);
});
$("pwSideReloadBtn")?.addEventListener("click", () => pwLoadAccounts({ refresh: true }));

$("pwCartEnabled")?.addEventListener("change", pwSaveSettings);
$("pwAiSettingsBtn")?.addEventListener("click", () => pwOpenAiModal());
$("pwAiModal")?.addEventListener("click", (event) => {
  if (event.target.closest("[data-pw-ai-close]")) { pwCloseAiModal(); return; }
  const remove = event.target.closest("[data-pw-key-delete]");
  if (remove) pwDeleteAiKey(remove.dataset.pwKeyDelete);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("pwAiModal")?.classList.contains("hidden")) pwCloseAiModal();
});
$("pwAiSaveBtn")?.addEventListener("click", () => pwSaveAiSettings());
$("pwAiTestBtn")?.addEventListener("click", () => pwTestAiKey());

$("pwRunBtn")?.addEventListener("click", () => pwRunQueue());
$("pwStopBtn")?.addEventListener("click", () => {
  pwStopRequests.add(pwActiveAccountKey);
  pwSetClipStatus("กำลังหยุดหลังงานปัจจุบันเสร็จ...");
});
$("pwClearQueueBtn")?.addEventListener("click", () => {
  // Clears THIS channel's queue; another channel's jobs are none of its business.
  if (pwChannelRunning()) return;
  const dropped = new Set(pwJobsForActiveChannel().map((job) => job.id));
  pwJobs = pwJobs.filter((job) => !dropped.has(job.id));
  for (const id of dropped) pwSelectedJobs.delete(id);
  pwWrite(PW_JOBS_KEY, pwJobs);
  pwRenderQueue();
});
// Row actions are delegated: the queue list is re-rendered on every change.
$("pwQueueList")?.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-pw-job-toggle]");
  if (toggle) {
    const id = toggle.dataset.pwJobToggle;
    if (pwSelectedJobs.has(id)) pwSelectedJobs.delete(id);
    else pwSelectedJobs.add(id);
    pwRenderQueue();
    return;
  }
  const remove = event.target.closest("[data-pw-job-remove]");
  if (remove) {
    const id = remove.dataset.pwJobRemove;
    if (pwJobs.find((job) => job.id === id)?.status === "running") return;
    pwJobs = pwJobs.filter((job) => job.id !== id);
    pwSelectedJobs.delete(id);
    pwWrite(PW_JOBS_KEY, pwJobs);
    pwRenderQueue();
    return;
  }
  const retry = event.target.closest("[data-pw-job-retry]");
  if (retry) {
    const job = pwJobs.find((item) => item.id === retry.dataset.pwJobRetry);
    if (job) Object.assign(job, { status: "queued", error: "", note: "" });
    pwWrite(PW_JOBS_KEY, pwJobs);
    pwRenderQueue();
  }
});

$("pwRetryFailedBtn")?.addEventListener("click", () => {
  pwJobs.forEach((job) => {
    if (job.status === "failed" || job.status === "stopped") {
      Object.assign(job, { status: "queued", error: "", note: "" });
    }
  });
  pwWrite(PW_JOBS_KEY, pwJobs);
  pwRenderQueue();
});

// Keep the log fresh while this tab is open. It is the only view that reads the
// AI Studio log, so the poll no-ops everywhere else.
setInterval(() => {
  if (typeof activeView !== "undefined" && activeView === "postweb") {
    pwRenderLogs().catch(() => null);
  }
}, 5000);
