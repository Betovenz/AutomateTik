// Flat-file store for the flow-suite (BlueSPite-ported) engine. One JSON
// document, debounced atomic writes.
//
// Ported from the BlueSPite reference project
// (C:\Users\Blue\Documents\Test\Blue SP_ai\server\store.mjs). Deviates from
// it in two deliberate ways (see the port plan): no `products`/`searches`
// sub-store (ai_studio's Showcase page already owns product data — this
// store doesn't need to duplicate it), and every job/history row carries a
// `platform` field ("tiktok" | "shopee") since this engine serves both,
// unlike BlueSPite which is single-platform.

const fs = require("fs");
const path = require("path");

// Overridable so a throwaway test bridge can point at its own file instead of
// racing writes with the real one.
const DATA_DIR = process.env.FLOW_SUITE_DATA_DIR || path.join(__dirname, "..", "..", "..", "runtime");
const DB_PATH = path.join(DATA_DIR, "flow-suite.json");
const TMP_PATH = `${DB_PATH}.tmp`;

const MAX_LOG = 1500;
const MAX_HISTORY = 2000;

function emptyDb() {
  return {
    version: 1,
    settings: {
      flowTier: "x20",
      videoModel: "veo_3_1_i2v_lite",
      imageModel: "NARWHAL",
      aspect: "portrait",
      sceneCount: 1,
      concurrency: 1,
      textMode: "withText",
      direction: {},
      extraPrompt: "",
    },
    jobs: [],
    history: [],
    log: [],
    orderSeq: 0,
  };
}

let db = null;
let writeTimer = null;

function load() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      db = { ...emptyDb(), ...parsed };
      db.settings = { ...emptyDb().settings, ...(parsed.settings || {}) };
    } catch (err) {
      const backup = `${DB_PATH}.corrupt-${Date.now()}`;
      try { fs.renameSync(DB_PATH, backup); } catch { /* best effort */ }
      console.error(`[flow-suite/store] ${DB_PATH} was unreadable (${err.message}); moved to ${backup}`);
      db = emptyDb();
    }
  } else {
    db = emptyDb();
  }
  return db;
}

// Atomic-ish write: temp file + rename, so a crash mid-write cannot truncate the db.
function flush() {
  writeTimer = null;
  if (!db) return;
  try {
    fs.writeFileSync(TMP_PATH, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(TMP_PATH, DB_PATH);
  } catch (err) {
    console.error(`[flow-suite/store] write failed: ${err.message}`);
  }
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(flush, 250);
}

function state() {
  return load();
}

function save() {
  persist();
}

function flushNow() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}

// ------------------------------------------------------------------ settings
function settings() {
  return load().settings;
}

function updateSettings(patch = {}) {
  const s = load();
  s.settings = { ...s.settings, ...patch };
  if (patch.direction) s.settings.direction = { ...s.settings.direction, ...patch.direction };
  persist();
  return s.settings;
}

// ------------------------------------------------------------------ logging
// Whatever a job carries is re-serialised into flow-suite.json on every write AND
// pushed to every open page on every state broadcast. One rejected data: URI put a
// 19 MB string in `error`, which — mirrored into history — made each push ~39 MB and
// froze the Queue page. Nothing stored on a job needs to be this big, so cap it.
const MAX_JOB_TEXT = 2000;

function trimJobText(value) {
  const text = String(value);
  const dataUri = /^data:([^;,]*)/i.exec(text);
  if (dataUri) return `data:${dataUri[1] || "?"} (${Math.round(text.length / 1024)} KB inline)`;
  return text.length > MAX_JOB_TEXT ? `${text.slice(0, MAX_JOB_TEXT)}… (ตัดข้อความยาว ${text.length} ตัวอักษร)` : text;
}

/** Applied to the free-text fields a job carries — the ones that can pick up an
 *  arbitrarily long value from an upstream error or URL. */
function trimJobPatch(patch) {
  const out = { ...patch };
  for (const field of ["error", "note", "videoUrl", "finalVideoUrl", "imageUrl"]) {
    if (typeof out[field] === "string") out[field] = trimJobText(out[field]);
  }
  return out;
}

function log(msg, level = "info", meta = null) {
  const s = load();
  // The log rides in every state broadcast too, so a single huge line (an error
  // that quoted an inline data: clip) is enough to make the payload unusable.
  const entry = { ts: Date.now(), level, msg: trimJobText(msg) };
  if (meta && typeof meta === "object" && Object.keys(meta).length) {
    entry.meta = Object.fromEntries(
      Object.entries(meta).map(([key, value]) => [key, typeof value === "string" ? trimJobText(value) : value])
    );
  }
  s.log.push(entry);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  persist();
  return entry;
}

function logTail(n = 120) {
  return load().log.slice(-n);
}

function clearLog() {
  const s = load();
  s.log = [];
  persist();
}

// ------------------------------------------------------------------ jobs
let jobSeq = 0;

function newJobId() {
  jobSeq += 1;
  return `j${Date.now().toString(36)}${jobSeq.toString(36)}`;
}

function addJob(job) {
  const s = load();
  const record = { ...job, id: job.id || newJobId(), createdAt: Date.now(), updatedAt: Date.now() };
  s.jobs.unshift(record);
  persist();
  return record;
}

function jobs() {
  return load().jobs;
}

function job(id) {
  return load().jobs.find((j) => j.id === id) || null;
}

// A job persisted as "running" only means a lane was mid-way through it when
// the server last wrote to disk — if the process then restarted, that lane
// and its AbortController are both gone, so nothing is actually working on
// the job anymore. Called once at server startup, before the queue runner
// can possibly be draining anything.
function reconcileOrphanedJobs() {
  const s = load();
  let count = 0;
  for (const j of s.jobs) {
    if (j.status === "running") {
      j.status = "failed";
      j.error = "งานค้างจากเซิร์ฟเวอร์ที่รีสตาร์ท — กด \"ลองใหม่\" ถ้าต้องการรันอีกครั้ง";
      j.finishedAt = Date.now();
      j.updatedAt = Date.now();
      count += 1;
    }
  }
  if (count) persist();
  return count;
}

function updateJob(id, patch) {
  const s = load();
  const idx = s.jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  s.jobs[idx] = { ...s.jobs[idx], ...trimJobPatch(patch), updatedAt: Date.now() };
  persist();
  return s.jobs[idx];
}

// ------------------------------------------------------------------ order numbers
function nextOrderSeq() {
  const s = load();
  s.orderSeq = (s.orderSeq || 0) + 1;
  persist();
  return s.orderSeq;
}

function clearJobs(ids = null) {
  const s = load();
  // Never drop a job that is mid-flight — the runner still holds a reference to it.
  s.jobs = s.jobs.filter((j) => j.status === "running" || (ids ? !ids.includes(j.id) : false));
  persist();
}

// ------------------------------------------------------------------ history
// Append-only, unaffected by clearJobs() above.
function recordHistory(entry) {
  const s = load();
  s.history.unshift({ ...trimJobPatch(entry), recordedAt: Date.now() });
  if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
  persist();
}

function history() {
  return load().history;
}

// No "clear all" on purpose — History deletion is per-status only.
function clearHistoryByStatus(status) {
  const s = load();
  const before = s.history.length;
  s.history = s.history.filter((h) => h.status !== status);
  persist();
  return before - s.history.length;
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  state,
  save,
  flushNow,
  settings,
  updateSettings,
  log,
  logTail,
  clearLog,
  newJobId,
  addJob,
  jobs,
  job,
  reconcileOrphanedJobs,
  updateJob,
  nextOrderSeq,
  clearJobs,
  recordHistory,
  history,
  clearHistoryByStatus,
};
