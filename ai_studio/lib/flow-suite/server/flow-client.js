// Direct Google Flow API client for the flow-suite queue — a CommonJS port of
// BlueSPite's server/flow-client.mjs, brought over verbatim request-for-request.
//
// WHY THIS EXISTS: ai_studio used to reach Flow only through the coarse Python
// bridge (lib/media-core/flow_backend_bridge.py -> labs_generate.pyc), whose
// bundled engine exposes no reference-to-video RPC at all — only
// batchAsyncGenerateVideoStartImage / StartAndEndImage / ExtendVideo /
// UpsampleVideo. Every R2V model in the catalog (abra_r2v_*, veo_3_1_r2v_*) was
// therefore submitted through the I2V RPC and came back as
// "MEDIA_GENERATION_STATUS_FAILED — failureReasons=NOT_FOUND". This module talks
// to Flow directly from Node, so R2V (batchAsyncGenerateVideoReferenceImages) is
// a first-class call, exactly as it is in BlueSPite.
//
// Auth: the labs.google endpoints (session, createProject, media redirect) are
// Cookie-authenticated — the Chrome extension harvests that cookie. The
// aisandbox-pa endpoints are Bearer-authenticated with the access_token that the
// session call returns, and need no cookie at all.

const crypto = require("node:crypto");

const SANDBOX_BASE = "https://aisandbox-pa.googleapis.com/v1";
const SESSION_URL = "https://labs.google/fx/api/auth/session";
const CREATE_PROJECT_URL = "https://labs.google/fx/api/trpc/project.createProject";
const MEDIA_REDIRECT_URL = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=";
const TOOL = "PINHOLE";
// A real Chrome UA — confirmed as the exact string the working Python client sends
// (labs_generate._UA). Node's default fetch UA reads as "node" to the server, which
// this endpoint has no confirmed reason to trust, so match the browser exactly.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const RECAPTCHA_ACTION_IMAGE = "IMAGE_GENERATION";
const RECAPTCHA_ACTION_VIDEO = "VIDEO_GENERATION";

function sessionId() {
  return `;${Date.now()}`;
}

function clientContext(recaptchaToken, projectId) {
  return {
    projectId,
    tool: TOOL,
    sessionId: sessionId(),
    recaptchaContext: { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
  };
}

function sandboxHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "text/plain;charset=UTF-8",
    accept: "*/*",
  };
}

// Deep-search a nested tRPC/JSON response for the first value at key `key` — tRPC
// wraps payloads as {result:{data:{json:{...}}}} and the sandbox responses nest
// similarly; this mirrors the confirmed Python client's _deep_find exactly.
function deepFind(value, key) {
  if (value && typeof value === "object") {
    if (!Array.isArray(value) && value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    for (const v of Object.values(value)) {
      const found = deepFind(v, key);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return undefined;
}

// Which fields carry a human-readable failure reason, checked first —
// "raiMediaFilteredReason(s)" is Flow's own content-safety filter (Responsible AI)
// rejecting the request. Ported from labs_generate._failure_reason /
// _FAILURE_REASON_KEYS / _REASON_KEY_HINTS (confirmed via the same disassembly).
const FAILURE_REASON_KEYS = [
  "raiMediaFilteredReasons", "raiMediaFilteredReason", "failureReason",
  "errorMessage", "mediaGenerationStatusReason",
];
const REASON_KEY_HINTS = ["reason", "filtered", "failure", "error", "rejected", "blocked"];

function reasonLikeItems(obj, out = []) {
  if (Array.isArray(obj)) {
    for (const item of obj) reasonLikeItems(item, out);
  } else if (obj && typeof obj === "object") {
    for (const [key, val] of Object.entries(obj)) {
      const low = key.toLowerCase();
      if (REASON_KEY_HINTS.some((hint) => low.includes(hint)) && (typeof val === "string" || Array.isArray(val))) {
        out.push([key, val]);
      }
      reasonLikeItems(val, out);
    }
  }
  return out;
}

function failureReason(data) {
  const parts = [];
  const seen = new Set();
  const add = (key, val) => {
    if (seen.has(key) || val === null || val === undefined || val === "") return;
    let text;
    if (Array.isArray(val)) text = val.filter((v) => v !== null && v !== "").map(String).join(", ");
    else if (val && typeof val === "object") text = String(val.message || JSON.stringify(val));
    else text = String(val);
    text = text.trim();
    if (text) { seen.add(key); parts.push(`${key}=${text}`); }
  };
  for (const key of FAILURE_REASON_KEYS) add(key, deepFind(data, key));
  for (const [key, val] of reasonLikeItems(data)) add(key, val);
  return parts.join(" · ");
}

// ------------------------------------------------------------------ tracing
// Every call is recorded (label/url/ok/status/ms) so the Log dock's Dev mode shows
// the exact request sequence, same as every other provider call in this app.
let trace = [];
function resetTrace() { trace = []; return trace; }
function currentTrace() { return trace; }

async function tracedFetch(label, url, opts = {}) {
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err.name === "AbortError" ? "ยกเลิกโดยผู้ใช้" : err.message;
    trace.push({ ts: Date.now(), label, url, ok: false, ms, error: message });
    throw new Error(`[${label}] เรียก ${url} ไม่สำเร็จ: ${message}`);
  }
  const ms = Date.now() - startedAt;
  trace.push({ ts: Date.now(), label, url, ok: res.ok, status: res.status, ms });
  return res;
}

// ------------------------------------------------------------------ session
async function getAccessToken(cookieHeader, signal) {
  if (!cookieHeader) throw new Error("no cookie to authenticate with");
  const res = await tracedFetch("session", SESSION_URL, {
    signal,
    headers: {
      cookie: cookieHeader,
      "user-agent": UA,
      accept: "application/json",
      referer: "https://labs.google/fx/tools/flow",
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error("cookie rejected (signed out or expired)");
  if (res.status >= 400) throw new Error(`session HTTP ${res.status}`);
  const data = await res.json().catch(() => { throw new Error("session response was not JSON"); });
  const token = data?.access_token;
  if (!token) {
    // Cookie NAMES only — enough to tell "the harvest handed us the wrong shape"
    // apart from "this Chrome profile is genuinely signed out". Never log a
    // value: the session token is a live credential. Anything that does not
    // parse as `name=value; ...` is reported by shape, not by content.
    const names = String(cookieHeader)
      .split(";")
      .map((part) => part.split("=")[0].trim())
      .filter((name) => /^[A-Za-z0-9_.\-]+$/.test(name));
    const shape = names.length ? `cookies sent: [${names.join(", ")}]` : "cookie header was not in name=value form";
    const keys = data && typeof data === "object" ? Object.keys(data) : [];
    throw new Error(`no access_token in session (signed out?) — ${shape}; session keys: [${keys.join(", ")}]`);
  }
  return token;
}

// ------------------------------------------------------------------ project
async function createProject(cookieHeader, title, signal) {
  const res = await tracedFetch("createProject", CREATE_PROJECT_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      accept: "*/*",
      origin: "https://labs.google",
      referer: "https://labs.google/fx/tools/flow",
      "user-agent": UA,
      cookie: cookieHeader,
    },
    body: JSON.stringify({ json: { projectTitle: title || "BlueSPite", toolName: TOOL } }),
  });
  if (res.status >= 400) throw new Error(`create project HTTP ${res.status}`);
  const data = await res.json().catch(() => { throw new Error("create project response was not JSON"); });
  const projectId = deepFind(data, "projectId");
  if (!projectId) throw new Error("create project returned no projectId");
  return projectId;
}

// ------------------------------------------------------------------ sandbox POST
async function sandboxPost(label, url, accessToken, body, signal) {
  const res = await tracedFetch(label, url, {
    method: "POST",
    signal,
    headers: sandboxHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 401) throw new Error("labs.google session expired (HTTP 401) — ล็อกอินใหม่");
  if (res.status === 403) throw new Error(`HTTP 403 (อาจโดน reCAPTCHA บล็อก): ${text.slice(0, 300)}`);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("sandbox response was not JSON");
  }
}

// ------------------------------------------------------------------ upload
// No reCAPTCHA needed for this one (confirmed) — fetching the reference image is a
// plain Node fetch too, no CORS concern for that either now.
async function uploadReferenceImage(accessToken, projectId, imageUrl, signal) {
  const imgRes = await tracedFetch("fetchReferenceImage", imageUrl, { signal });
  if (!imgRes.ok) throw new Error(`โหลดรูปอ้างอิงไม่ได้ (HTTP ${imgRes.status}): ${imageUrl}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const imageBytes = buf.toString("base64");

  const data = await sandboxPost("uploadImage", `${SANDBOX_BASE}/flow/uploadImage`, accessToken, {
    clientContext: { projectId, tool: TOOL },
    imageBytes,
  }, signal);
  const name = data?.media?.name || deepFind(data, "name");
  if (!name) throw new Error("uploadImage returned no media name");
  return name;
}

// ------------------------------------------------------------------ image (I2V step 1)
const ASPECT_TO_IMAGE_RATIO = {
  portrait: "IMAGE_ASPECT_RATIO_PORTRAIT",
  landscape: "IMAGE_ASPECT_RATIO_LANDSCAPE",
  square: "IMAGE_ASPECT_RATIO_SQUARE",
};

/**
 * Generate the I2V start frame (Nano Banana / Imagen etc). Reference mediaIds are
 * the SAME uploaded-image ids uploadReferenceImage() returns — Flow lets an image
 * generation be steered by reference images too, which is what keeps the product
 * recognisable in the generated frame. Flow returns the signed URL synchronously in
 * the common case (confirmed); an "acknowledged but pending" async shape has been
 * observed live by ref1 but its poll contract for IMAGES specifically is not
 * confirmed here, so that case surfaces as a clear error rather than a guess.
 */
async function generateImage({ accessToken, projectId, recaptchaToken, prompt, aspect, model, referenceMediaIds = [], signal }) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const imageInputs = referenceMediaIds.filter(Boolean).map((name) => ({ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name }));
  const ctx = clientContext(recaptchaToken, projectId);
  const body = {
    clientContext: ctx,
    mediaGenerationContext: { batchId: crypto.randomUUID() },
    useNewMedia: true,
    requests: [{
      clientContext: ctx,
      imageModelName: model,
      imageAspectRatio: ASPECT_TO_IMAGE_RATIO[aspect] || ASPECT_TO_IMAGE_RATIO.portrait,
      structuredPrompt: { parts: [{ text: prompt }] },
      seed,
      imageInputs,
    }],
  };
  const data = await sandboxPost("generateImage", `${SANDBOX_BASE}/projects/${projectId}/flowMedia:batchGenerateImages`, accessToken, body, signal);

  const url = deepFind(data, "fifeUrl");
  const mediaId = deepFind(data, "name");
  if (!url) {
    const reason = failureReason(data) || (data && typeof data === "object" ? `response shape: ${Object.keys(data).sort().join(", ") || "empty"}` : "");
    throw new Error(`Flow ไม่คืน URL ภาพทันที${reason ? ` — ${reason}` : ""} (อาจเป็นแบบ acknowledge-then-poll ที่ยังไม่รองรับ)`);
  }
  return { mediaId, url };
}

// ------------------------------------------------------------------ R2V generate
const ASPECT_TO_VIDEO_RATIO = {
  portrait: "VIDEO_ASPECT_RATIO_PORTRAIT",
  landscape: "VIDEO_ASPECT_RATIO_LANDSCAPE",
};

/**
 * Submit a Reference-to-Video generation (Omni Flash / Veo R2V Lite — the models
 * that take product photos directly as reference images). Returns the pending
 * media name to poll.
 */
async function submitR2V({ accessToken, projectId, recaptchaToken, prompt, videoModel, aspect, referenceMediaIds, signal }) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const body = {
    mediaGenerationContext: {
      batchId: crypto.randomUUID(),
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    },
    clientContext: clientContext(recaptchaToken, projectId),
    requests: [{
      aspectRatio: ASPECT_TO_VIDEO_RATIO[aspect] || ASPECT_TO_VIDEO_RATIO.portrait,
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModel,
      seed,
      metadata: {},
      referenceImages: referenceMediaIds.map((mediaId) => ({
        mediaId, imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
      })),
    }],
    useV2ModelConfig: true,
  };
  const data = await sandboxPost("submitR2V", `${SANDBOX_BASE}/video:batchAsyncGenerateVideoReferenceImages`, accessToken, body, signal);
  const mediaName = data?.media?.[0]?.name || deepFind(data, "name");
  if (!mediaName) throw new Error("Flow ไม่คืนชื่อ media ของงานที่ส่ง");
  return mediaName;
}

/**
 * Submit an Image-to-Video generation (Veo I2V models) from an already-generated
 * start frame (generateImage()'s mediaId). Two endpoints exist depending on whether
 * an end frame is supplied — this app only ever uses the start-image-only one, since
 * nothing in the catalog does first→last-frame transitions. Poll/resolve are shared
 * with R2V (same batchCheckAsyncVideoGenerationStatus + media.getMediaUrlRedirect —
 * confirmed: ref1's poll_video is one function used by both paths).
 */
async function startVideoFromImage({ accessToken, projectId, recaptchaToken, prompt, videoModel, aspect, startImageMediaId, signal }) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const body = {
    mediaGenerationContext: {
      batchId: crypto.randomUUID(),
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    },
    clientContext: clientContext(recaptchaToken, projectId),
    requests: [{
      aspectRatio: ASPECT_TO_VIDEO_RATIO[aspect] || ASPECT_TO_VIDEO_RATIO.portrait,
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModel,
      seed,
      metadata: {},
      startImage: { mediaId: startImageMediaId },
    }],
    useV2ModelConfig: true,
  };
  const data = await sandboxPost("startVideoFromImage", `${SANDBOX_BASE}/video:batchAsyncGenerateVideoStartImage`, accessToken, body, signal);
  const mediaName = data?.media?.[0]?.name || deepFind(data, "name");
  if (!mediaName) throw new Error("Flow ไม่คืนชื่อ media ของงานที่ส่ง");
  return mediaName;
}

// ------------------------------------------------------------------ poll + resolve
/** One status check (the caller owns the poll loop/cadence). */
async function pollStatus(accessToken, projectId, mediaName, signal) {
  const data = await sandboxPost("pollStatus", `${SANDBOX_BASE}/video:batchCheckAsyncVideoGenerationStatus`, accessToken, {
    media: [{ name: mediaName, projectId }],
  }, signal);

  if (deepFind(data, "fifeUrl")) return { done: true };
  const status = String(deepFind(data, "mediaGenerationStatus") || "").toUpperCase();
  if (status.includes("SUCCESS")) return { done: true };
  if (status.includes("FAIL") || status.includes("ERROR")) {
    const reason = failureReason(data) || `raw: ${JSON.stringify(data).slice(0, 600)}`;
    throw new Error(`Flow แจ้งว่างานล้มเหลว: ${status || "unknown"} — ${reason}`);
  }
  return { done: false, status };
}

/** Resolve the pending media name to its signed, downloadable clip URL. */
async function resolveVideoUrl(cookieHeader, mediaName, signal) {
  const res = await tracedFetch("resolveUrl", MEDIA_REDIRECT_URL + encodeURIComponent(mediaName), {
    signal,
    headers: { cookie: cookieHeader, "user-agent": UA, accept: "*/*", referer: "https://labs.google/fx/tools/flow" },
  });
  if (!res.ok && !res.url) throw new Error(`ขอ URL วิดีโอไม่สำเร็จ (HTTP ${res.status})`);
  res.body?.cancel?.();
  return res.url;
}

// ------------------------------------------------------------------ concat (multi-scene)
// Confirmed by disassembling LabsGenerateClient.concatenate_videos in labs_generate.pyc
// (Python 3.11, same technique as every other endpoint in this file). ref2 does NOT run
// local ffmpeg for its scene merge — it asks Flow itself to concatenate the clips
// server-side. Bearer-only, no reCAPTCHA, no projectId in the body at all.
const VIDEO_CONCAT_PATH = "runVideoFxConcatenation";
const VIDEO_CONCAT_STATUS_PATH = "runVideoFxCheckConcatenationStatus";
const CONCAT_POLL_INTERVAL_MS = 5_000;
const CONCAT_POLL_TIMEOUT_MS = 600_000;
const NS_PER_SECOND = 1_000_000_000;

// Abortable — a plain setTimeout sleep would let a cancel sit unnoticed for the
// full backoff/poll interval, which is exactly the "ควรหยุดเลย" (should stop right
// away) complaint this exists to fix.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("ยกเลิกโดยผู้ใช้"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("ยกเลิกโดยผู้ใช้")); }, { once: true });
  });
}

/**
 * Merge N already-generated scene clips (their `mediaName`s, in order) into one
 * continuous video. `clipSeconds` is applied uniformly to every input — fine here
 * since one job always uses one video model for every scene, so every clip in a job
 * has the same duration.
 */
async function concatenateVideos({ accessToken, cookieHeader, mediaIds, clipSeconds, signal }) {
  const ids = (mediaIds || []).filter(Boolean);
  if (!ids.length) throw new Error("ไม่มีคลิปฉากให้ต่อ");
  const seconds = Math.round(clipSeconds) || 8;
  const lengthNs = String(seconds * NS_PER_SECOND);
  const body = {
    inputVideos: ids.map((mediaGenerationId) => ({
      mediaGenerationId, length: lengthNs, startTimeOffset: "0s", endTimeOffset: `${seconds}s`,
    })),
  };

  let start;
  for (let attempt = 0; ; attempt += 1) {
    try {
      start = await sandboxPost("concatStart", `${SANDBOX_BASE}:${VIDEO_CONCAT_PATH}`, accessToken, body, signal);
      break;
    } catch (err) {
      if (attempt < 2 && /HTTP 500/.test(err.message)) { await sleep(3000, signal); continue; }
      throw err;
    }
  }
  const opName = deepFind(start, "name");
  if (!opName) throw new Error("Flow ไม่คืนชื่อ operation ของงานต่อวิดีโอ");

  const pollBody = { operation: { operation: { name: opName } } };
  const deadline = Date.now() + CONCAT_POLL_TIMEOUT_MS;
  for (;;) {
    const st = await sandboxPost("concatPoll", `${SANDBOX_BASE}:${VIDEO_CONCAT_STATUS_PATH}`, accessToken, pollBody, signal);
    const status = String(deepFind(st, "status") || "");
    const su = status.toUpperCase();
    const encoded = deepFind(st, "encodedVideo");
    const mediaId = deepFind(st, "mediaGenerationId");
    const out = deepFind(st, "outputUri") || deepFind(st, "fifeUrl");

    if (typeof encoded === "string" && encoded.trim()) {
      return { mediaId: opName, url: `data:video/mp4;base64,${encoded.trim()}` };
    }
    if (typeof mediaId === "string" && mediaId.trim()) {
      const url = await resolveVideoUrl(cookieHeader, mediaId.trim(), signal);
      return { mediaId: mediaId.trim(), url };
    }
    if (typeof out === "string" && out.trim()) {
      return { mediaId: opName, url: out.trim() };
    }
    if (su.includes("FAIL") || su.includes("ERROR")) {
      const reason = failureReason(st) || `raw: ${JSON.stringify(st).slice(0, 600)}`;
      throw new Error(`Flow ต่อวิดีโอไม่สำเร็จ: ${status || "unknown"} — ${reason}`);
    }
    if (Date.now() >= deadline) throw new Error("รอผลการต่อวิดีโอนานเกินกำหนด");
    await sleep(CONCAT_POLL_INTERVAL_MS, signal);
  }
}

module.exports = {
  SANDBOX_BASE,
  RECAPTCHA_ACTION_IMAGE,
  RECAPTCHA_ACTION_VIDEO,
  failureReason,
  resetTrace,
  currentTrace,
  getAccessToken,
  createProject,
  uploadReferenceImage,
  generateImage,
  submitR2V,
  startVideoFromImage,
  pollStatus,
  resolveVideoUrl,
  concatenateVideos,
};
