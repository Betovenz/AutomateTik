// Server-side queue runner for the flow-suite engine — a port of BlueSPite's
// server/runner.mjs, now following its architecture rather than only its spirit.
//
// WHAT CHANGED, AND WHY: this module used to drive one coarse generateFlowMedia()
// call per scene, which spawned the Python bridge (lib/media-core/
// flow_backend_bridge.py -> labs_generate.pyc). That engine has no
// reference-to-video RPC at all, so every R2V model in the catalog was submitted
// through the I2V RPC and came back "MEDIA_GENERATION_STATUS_FAILED —
// failureReasons=NOT_FOUND". The catalog even carried a `family` field for each
// model, copied over from BlueSPite, that nothing here ever read.
//
// The runner now calls Flow directly through ./flow-client.js and mirrors
// BlueSPite step for step:
//
//   * `model.family` picks the RPC — r2v uses batchAsyncGenerateVideoReferenceImages,
//     i2v uses batchAsyncGenerateVideoStartImage.
//   * One cookie/access-token session is shared by every lane instead of harvested
//     per job; only a session-class error drops it.
//   * Two phases per job: every scene's start image is generated BEFORE any
//     scene's video starts.
//   * "ไม่มีข้อความ" really skips image generation — I2V feeds the product photo
//     in as its start frame, R2V references the product photos directly.
//   * Scenes are generated independently and merged server-side by Flow
//     (runVideoFxConcatenation), not chained with "extend" and merged locally.
//   * Failure recovery is BlueSPite's two layers: withFlowErrorModel (re-mint a
//     captcha / wait out a rate limit, once) beneath withRoomAutoRecovery (retry
//     in the same Flow room, then open a new room and re-upload references).
//
// Only two things still go through the Chrome extension: harvesting the
// labs.google cookie and minting reCAPTCHA tokens. Both arrive as injected deps.
// Saving the finished clip is unchanged — finalizeScenes still owns the
// product-named file in the Video Library folder and the Final-File-JS metadata.

const path = require("path");
const store = require("./store.js");
const mediaStore = require("./media-store.js");
const flow = require("./flow-client.js");

let sharedModules = null;
async function loadShared() {
  if (sharedModules) return sharedModules;
  const catalog = await import("../shared/catalog.mjs");
  const prompt = await import("../shared/prompt.mjs");
  sharedModules = { ...catalog, ...prompt };
  return sharedModules;
}

const GAP_BETWEEN_JOBS_MS = Number(process.env.FLOW_SUITE_JOB_GAP_MS || 8000);
const LANE_STARTUP_STAGGER_MS = Number(process.env.FLOW_SUITE_LANE_STAGGER_MS || 0);
const LANE_IDLE_TIMEOUT_MS = Number(process.env.FLOW_SUITE_LANE_IDLE_MS || 20_000);
const LANE_IDLE_POLL_MS = 1_000;
const RETRY_DELAY_MS = 1000;
const POLL_INTERVAL_MS = Number(process.env.FLOW_SUITE_POLL_MS || 6000);
// A Flow clip can legitimately take minutes.
const POLL_TIMEOUT_MS = 12 * 60 * 1000;
// One step retries in the same Flow room this many times before the room
// fallback opens a fresh project and re-uploads the reference artifacts.
const MAX_RETRIES_PER_STEP = 10;
const STEP_RETRY_DELAY_MS = Number(process.env.FLOW_SUITE_STEP_RETRY_MS || 2000);
// A job names its Flow project after its order number (AB-0075-029), so a project
// in the Flow account can be traced straight back to the queue row and the saved
// file. Only work with no order number of its own — the ทดสอบสร้างรูป preview —
// falls back to the app name.
const FLOW_PROJECT_TITLE = "AutoTik AI Studio";
// The "ทดสอบสร้างรูป" button sits outside the lane system, so it keeps its own
// small project cache — without one, every click would litter the Flow account
// with a brand-new project.
const testImageProjectCache = { projectId: null };

function classifyFlowError(message = "") {
  if (/captcha|recaptcha|permission.denied|unusual activity|\b403\b/i.test(message)) return "captcha";
  if (/\b429\b|rate limit|resource_exhausted/i.test(message)) return "rateLimit";
  if (/unauthori[sz]ed|session expired|access token|\b401\b|cookie rejected/i.test(message)) return "session";
  return null;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("ยกเลิกโดยผู้ใช้"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("ยกเลิกโดยผู้ใช้")); }, { once: true });
  });
}

function createRunner(deps) {
  const { finalizeScenes, finalPlatformKey, harvestFlowCookies, mintFlowCaptcha } = deps;
  if (typeof finalizeScenes !== "function") throw new Error("runner requires finalizeScenes(payload)");
  if (typeof finalPlatformKey !== "function") throw new Error("runner requires finalPlatformKey(platform, sourceUrl)");
  if (typeof harvestFlowCookies !== "function") throw new Error("runner requires harvestFlowCookies(signal)");
  if (typeof mintFlowCaptcha !== "function") throw new Error("runner requires mintFlowCaptcha(action, signal)");

  let draining = false;
  let stopRequested = false;
  let queueController = null;
  const currentJobIds = new Set();
  const jobControllers = new Map();

  function runnerState() {
    return { draining, stopRequested, currentJobIds: [...currentJobIds] };
  }

  function cancelJob(jobId) {
    const controller = jobControllers.get(jobId);
    if (!controller) return false;
    controller.abort();
    store.updateJob(jobId, { cancelRequested: true });
    return true;
  }

  function requestStop() {
    if (!draining) return false;
    stopRequested = true;
    queueController?.abort();
    for (const controller of jobControllers.values()) controller.abort();
    store.log("ขอหยุดคิว — ยกเลิกงานที่กำลังทำอยู่ทันที", "warn");
    return true;
  }

  function startQueue(onChange = () => {}) {
    if (draining) return false;
    draining = true;
    stopRequested = false;
    queueController = new AbortController();
    const concurrency = Math.min(150, Math.max(1, Number(store.settings().concurrency) || 1));
    store.log(`เริ่มรันคิว (${concurrency} คิวพร้อมกัน)`);
    onChange();
    const lanes = Array.from({ length: concurrency }, (_, i) => runLane(onChange, i));
    Promise.allSettled(lanes).then((results) => {
      for (const r of results) if (r.status === "rejected") store.log(`คิวหยุดเพราะข้อผิดพลาด: ${r.reason?.message}`, "error");
    }).finally(() => {
      draining = false;
      stopRequested = false;
      queueController = null;
      currentJobIds.clear();
      store.log("หยุดคิวแล้ว", "warn");
      onChange();
    });
    return true;
  }

  function claimNextQueued() {
    const all = store.jobs();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (all[i].status === "queued") {
        const job = all[i];
        store.updateJob(job.id, { status: "running", error: "", startedAt: Date.now() });
        return store.job(job.id);
      }
    }
    return null;
  }

  function recordJobHistory(job) {
    if (!job?.orderNumber) return;
    store.recordHistory({
      jobId: job.id, platform: job.platform, orderNumber: job.orderNumber, title: job.title,
      textMode: job.textMode, sceneCount: job.sceneCount, status: job.status,
      startedAt: job.startedAt, finishedAt: job.finishedAt,
      finalVideoUrl: job.finalVideoUrl, videoUrl: job.videoUrl, thumb: job.thumb,
      error: job.error || "",
    });
  }

  async function runLane(onChange, laneIndex) {
    if (laneIndex > 0) await sleep(laneIndex * LANE_STARTUP_STAGGER_MS, queueController?.signal).catch(() => {});
    let first = true;
    let idleSince = null;
    for (;;) {
      if (stopRequested) break;
      const job = claimNextQueued();
      if (!job) {
        if (idleSince === null) idleSince = Date.now();
        if (Date.now() - idleSince >= LANE_IDLE_TIMEOUT_MS) break;
        try { await sleep(LANE_IDLE_POLL_MS, queueController?.signal); }
        catch { break; }
        continue;
      }
      idleSince = null;
      if (!first) {
        try { await sleep(GAP_BETWEEN_JOBS_MS, queueController?.signal); }
        catch { break; }
      }
      first = false;

      currentJobIds.add(job.id);
      const controller = new AbortController();
      jobControllers.set(job.id, controller);
      store.log(`เริ่มงาน: ${job.title || job.id}`, "info", { stage: "job.started", videoModel: job.videoModel });
      onChange();
      try {
        const result = await runJob(job, controller.signal, onChange);
        const finished = store.updateJob(job.id, { status: "done", ...result, finishedAt: Date.now() });
        recordJobHistory(finished);
        store.log(`เสร็จ: ${job.title || job.id}`, "info", { stage: "job.done", videoUrl: result.videoUrl });
      } catch (err) {
        const cancelled = /ยกเลิกโดยผู้ใช้|cancelled/i.test(err.message || "");
        const finished = store.updateJob(job.id, {
          status: cancelled ? "cancelled" : "failed",
          error: err.message,
          finishedAt: Date.now(),
        });
        recordJobHistory(finished);
        store.log(`${cancelled ? "ยกเลิก" : "ล้มเหลว"}: ${job.title || job.id} — ${err.message}`, cancelled ? "warn" : "error", {
          stage: cancelled ? "job.cancelled" : "job.failed",
        });
      }
      jobControllers.delete(job.id);
      currentJobIds.delete(job.id);
      onChange();
    }
  }

  // ------------------------------------------------------------------ Flow session
  // One cookie harvest + access token shared by every lane. Harvesting per job
  // meant `concurrency` simultaneous requests against the one shared Flow tab,
  // which is what the queue's pile-up of timeouts at concurrency 10 was. Only a
  // session-class error drops the cache, so the next job re-harvests.
  let sharedSession = null;
  let sessionRefresh = null;

  function invalidateSharedFlowSession() { sharedSession = null; }

  async function harvestFlowSession(signal) {
    const candidates = await harvestFlowCookies(signal);
    if (!candidates.length) throw new Error("Main Extension ยังอ่านคุกกี้ Google Labs ไม่ได้ — เปิด Flow แล้วล็อกอินก่อน");
    // Same order the Python bridge used: the combined labs+google-sso cookie
    // first, then the labs-only one, because the richer cookie can be present
    // and still be rejected.
    let lastError = null;
    for (const cookieHeader of candidates) {
      try {
        return { cookieHeader, accessToken: await flow.getAccessToken(cookieHeader, signal) };
      } catch (err) {
        lastError = err;
        store.log(`ขอ access token ด้วยคุกกี้ชุดหนึ่งไม่สำเร็จ — ${err.message}`, "warn");
      }
    }
    throw lastError || new Error("ขอ access token ของ Google Labs ไม่สำเร็จ");
  }

  async function getSharedFlowSession(signal) {
    if (sharedSession) return sharedSession;
    if (!sessionRefresh) {
      sessionRefresh = harvestFlowSession(signal)
        .then((session) => { sharedSession = session; return session; })
        .finally(() => { sessionRefresh = null; });
    }
    return sessionRefresh;
  }

  /** `projectCache` is a {projectId} box owned by one job — the session is shared,
   *  the Flow room is not, so one job's room switch never disturbs another lane. */
  async function ensureFlowSession(projectCache, signal) {
    let session = await getSharedFlowSession(signal);
    const projectTitle = projectCache.title || FLOW_PROJECT_TITLE;
    if (!projectCache.projectId) {
      try {
        projectCache.projectId = await flow.createProject(session.cookieHeader, projectTitle, signal);
      } catch (err) {
        // The session is cached across jobs, so it CAN go stale between them —
        // and createProject is the first call every job makes, so that is where
        // it surfaces. Nothing used to classify this error (withFlowErrorModel
        // only wraps the generate calls), so every job kept reusing the same
        // dead token and failed instantly with "create project HTTP 401".
        if (classifyFlowError(err.message) !== "session") throw err;
        store.log("session/cookie ของ Flow หมดอายุ — ขอใหม่แล้วลองอีกครั้ง", "warn");
        // Only drop the entry WE used: with several lanes failing at once, a
        // lane must not throw away a fresh session another lane just fetched.
        if (sharedSession === session) invalidateSharedFlowSession();
        session = await getSharedFlowSession(signal);
        projectCache.projectId = await flow.createProject(session.cookieHeader, projectTitle, signal);
      }
      store.log(`สร้างโปรเจกต์ Flow ใหม่: ${projectTitle} (${projectCache.projectId})`);
    }
    // projectTitle rides along so a room switch names the new room the same.
    return { accessToken: session.accessToken, cookieHeader: session.cookieHeader, projectId: projectCache.projectId, projectTitle };
  }

  /** Mirror flow-client's per-request trace into the queue log, so the Log panel
   *  shows the exact RPC sequence the way BlueSPite's does. */
  function reportFlowTrace() {
    for (const entry of flow.currentTrace()) {
      const ms = entry.ms != null ? ` (${entry.ms}ms)` : "";
      const tag = entry.label ? `[${entry.label}] ` : "";
      if (entry.ok) store.log(`${tag}✓ ${entry.url}${ms}`, "debug");
      // A non-2xx response carries a status but no `error` string, so print
      // whichever the entry actually has instead of a bare "undefined".
      else store.log(`${tag}✗ ${entry.url}${ms} — ${entry.error || `HTTP ${entry.status}`}`, "error");
    }
    flow.resetTrace();
  }

  // ------------------------------------------------------------------ retry model
  /** Run `attempt(captchaToken)` with a freshly minted captcha; on a captcha- or
   *  rate-limit-class error refresh what is needed and retry exactly once. A
   *  session-class error does not retry here — the dead token is captured in the
   *  caller's closure — it drops the shared session so the next job re-harvests. */
  async function withFlowErrorModel(captchaAction, attempt, label, signal) {
    let captcha = await mintFlowCaptcha(captchaAction, signal);
    try {
      return await attempt(captcha);
    } catch (err) {
      const cls = classifyFlowError(err.message);
      if (cls === "session") {
        invalidateSharedFlowSession();
        store.log(`${label}: session/cookie ใช้ไม่ได้แล้ว — ล้าง cache ไว้ให้งานถัดไปขอใหม่`, "warn");
        throw err;
      }
      if (!cls) throw err;
      if (cls === "captcha") {
        store.log(`${label}: เจอ captcha/unusual-activity — ขอ captcha ใหม่แล้วลองอีกครั้ง`, "warn");
        captcha = await mintFlowCaptcha(captchaAction, signal);
      } else {
        store.log(`${label}: โดน rate limit — รอแล้วลองอีกครั้ง`, "warn");
        await sleep(RETRY_DELAY_MS, signal);
      }
      return await attempt(captcha);
    }
  }

  /** Same model for the captcha-less calls — poll and concat. */
  async function withRateLimitRetry(attempt, label, signal) {
    try {
      return await attempt();
    } catch (err) {
      const cls = classifyFlowError(err.message);
      if (cls === "session") invalidateSharedFlowSession();
      if (cls !== "rateLimit") throw err;
      store.log(`${label}: โดน rate limit — รอแล้วลองอีกครั้ง`, "warn");
      await sleep(RETRY_DELAY_MS, signal);
      return await attempt();
    }
  }

  async function openNewFlowRoom(session, label, signal) {
    session.projectId = await flow.createProject(session.cookieHeader, session.projectTitle || FLOW_PROJECT_TITLE, signal);
    store.log(`${label}: เปิดห้อง Flow ใหม่ (fallback หลัง retry ในห้องเดิมครบ) — ${session.projectId}`, "warn");
    return session.projectId;
  }

  /** Sits above withFlowErrorModel: one step retries in the SAME Flow room up to
   *  MAX_RETRIES_PER_STEP - 1 times, then opens a fresh room and lets
   *  `onRoomSwitch` re-upload whatever artifact the next attempt needs (mediaIds
   *  from the old room are invalid in the new one). Only an abort stops it. */
  async function withRoomAutoRecovery(session, label, signal, attempt, onRoomSwitch) {
    let attemptsInRoom = 0;
    for (;;) {
      try {
        return await attempt();
      } catch (err) {
        if (signal?.aborted || /ยกเลิก|cancelled/i.test(err.message)) throw err;
        if (attemptsInRoom < MAX_RETRIES_PER_STEP - 1) {
          attemptsInRoom += 1;
          store.log(`${label}: ล้มเหลวในห้องเดิม (${attemptsInRoom}/${MAX_RETRIES_PER_STEP - 1}) — ${err.message}`, "warn");
          await sleep(STEP_RETRY_DELAY_MS * attemptsInRoom, signal);
          continue;
        }
        await openNewFlowRoom(session, label, signal);
        if (onRoomSwitch) await onRoomSwitch();
        attemptsInRoom = 0;
      }
    }
  }

  async function uploadReferences(accessToken, projectId, urls, label, signal) {
    if (label) store.log(`${label}อัปโหลดรูปอ้างอิง ${urls.length} รูป`);
    const mediaIds = [];
    for (const url of urls) mediaIds.push(await flow.uploadReferenceImage(accessToken, projectId, url, signal));
    return mediaIds;
  }

  // ------------------------------------------------------------------ poll
  async function pollUntilDone({ accessToken, cookieHeader, projectId, mediaName }, job, onChange, label, signal) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let ticks = 0;
    while (Date.now() < deadline) {
      if (stopRequested) throw new Error("ยกเลิกโดยผู้ใช้");
      await sleep(POLL_INTERVAL_MS, signal);
      ticks += 1;
      const status = await withRateLimitRetry(() => flow.pollStatus(accessToken, projectId, mediaName, signal), label, signal);
      if (status.done) {
        const url = await flow.resolveVideoUrl(cookieHeader, mediaName, signal);
        if (!url) throw new Error("Flow สำเร็จแต่ไม่คืน URL วิดีโอ");
        return url;
      }
      if (ticks % 5 === 0) {
        store.log(`${label}: รออยู่ ${Math.round(ticks * POLL_INTERVAL_MS / 1000)}s…`);
        reportFlowTrace();
        onChange();
      }
    }
    throw new Error("รอผลจาก Flow นานเกินกำหนด");
  }

  // ------------------------------------------------------------------ phase 1
  /** Phase 1 — this scene's start image. Writes prompts/imageUrl/startImageMediaId
   *  onto the caller-owned `state` for phase 2 to read.
   *
   *  noText genuinely skips image generation now, the way shared/prompt.mjs has
   *  always documented: I2V feeds the product's own uploaded photo as its start
   *  frame, R2V references the product photos directly and needs nothing here. */
  async function runSceneImage({ job, shared, model, textMode, referenceImages, sceneIndex, sceneCount, session, signal, state }, onChange) {
    const label = sceneCount > 1 ? `${job.title} [ฉาก ${sceneIndex + 1}/${sceneCount}]` : job.title;

    // Fresh buildPrompt() per scene so the random background/camera pick varies
    // scene to scene, cached on `state` so phase 2 reuses THIS scene's video
    // prompt instead of re-rolling a different one.
    state.prompts = shared.buildPrompt({
      product: job.product || {}, direction: job.direction || {},
      videoModel: job.videoModel, extraPrompt: job.extraPrompt || "", textMode,
    });
    if (sceneIndex === 0) store.updateJob(job.id, { prompts: state.prompts });

    if (textMode === "noText") {
      if (model.family === "i2v") {
        store.log(`${label}: ข้ามขั้นตอนสร้างภาพ — ใช้รูปสินค้าต้นฉบับเป็นเฟรมแรก`);
        state.imageUrl = referenceImages[0];
        state.startImageMediaId = session.mediaIds[0];
      }
      return;
    }

    const imageModelId = job.imageModel || shared.DEFAULT_IMAGE_MODEL;
    store.log(`${label}: สร้างภาพเฟรมแรก (${imageModelId})`);
    const image = await withRoomAutoRecovery(session, label, signal, () =>
      withFlowErrorModel(flow.RECAPTCHA_ACTION_IMAGE, (captcha) => flow.generateImage({
        accessToken: session.accessToken, projectId: session.projectId, recaptchaToken: captcha,
        prompt: state.prompts.imagePrompt, aspect: job.aspect || "portrait",
        model: imageModelId, referenceMediaIds: session.mediaIds, signal,
      }), label, signal), async () => {
        session.mediaIds = await uploadReferences(session.accessToken, session.projectId, referenceImages, `${label}: ย้ายห้อง — `, signal);
      });
    state.imageUrl = image.url;
    state.startImageMediaId = image.mediaId;
    if (!state.startImageMediaId) throw new Error("Flow ไม่คืน media id ของภาพเฟรมแรก");
    if (sceneIndex === 0) { store.updateJob(job.id, { imageUrl: state.imageUrl || "" }); onChange(); }
  }

  // ------------------------------------------------------------------ phase 2
  /** Phase 2 — this scene's video, built from whatever phase 1 left on `state`.
   *  The model's family picks the RPC: r2v -> batchAsyncGenerateVideoReferenceImages,
   *  i2v -> batchAsyncGenerateVideoStartImage. Sending an r2v model id to the i2v
   *  RPC is exactly what produced failureReasons=NOT_FOUND on every queued job. */
  async function runSceneVideo({ job, model, referenceImages, sceneIndex, sceneCount, session, signal, state }, onChange) {
    const { accessToken, cookieHeader } = session;   // stable across room switches
    const label = sceneCount > 1 ? `${job.title} [ฉาก ${sceneIndex + 1}/${sceneCount}]` : job.title;
    const imageUrl = state.imageUrl || "";
    let startImageMediaId = state.startImageMediaId || "";

    store.log(`${label}: สร้างวิดีโอ ${model.label || model.id}`);
    let mediaName = "";
    const videoUrl = await withRoomAutoRecovery(session, label, signal, async () => {
      mediaName = await withFlowErrorModel(flow.RECAPTCHA_ACTION_VIDEO, (captcha) => model.family === "r2v"
        ? flow.submitR2V({
            accessToken, projectId: session.projectId, recaptchaToken: captcha,
            prompt: state.prompts.videoPrompt, videoModel: model.id, aspect: job.aspect || "portrait",
            // A phase-1 (withText) image becomes R2V's sole reference so the
            // headline actually appears in the clip; noText falls back to the
            // raw product photos.
            referenceMediaIds: startImageMediaId ? [startImageMediaId] : session.mediaIds, signal,
          })
        : flow.startVideoFromImage({
            accessToken, projectId: session.projectId, recaptchaToken: captcha,
            prompt: state.prompts.videoPrompt, videoModel: model.id, aspect: job.aspect || "portrait",
            startImageMediaId, signal,
          }), label, signal);
      return pollUntilDone({ accessToken, cookieHeader, projectId: session.projectId, mediaName }, job, onChange, label, signal);
    }, async () => {
      if (imageUrl) {
        startImageMediaId = await flow.uploadReferenceImage(session.accessToken, session.projectId, imageUrl, signal);
        store.log(`${label}: อัปโหลดภาพเฟรมแรกเข้าห้องใหม่แล้ว`, "warn");
      } else {
        session.mediaIds = await uploadReferences(session.accessToken, session.projectId, referenceImages, `${label}: ย้ายห้อง — `, signal);
      }
    });
    state.mediaName = mediaName;
    state.videoUrl = videoUrl;
  }

  // ------------------------------------------------------------------ job
  async function runJob(job, signal, onChange) {
    const shared = await loadShared();
    const model = shared.videoModel(job.videoModel);
    if (!model) throw new Error(`ไม่รู้จักโมเดล ${job.videoModel}`);

    const referenceImages = (job.product?.images?.length ? job.product.images : [job.productImage])
      .filter(Boolean).slice(0, 3);
    if (!referenceImages.length) throw new Error("สินค้านี้ไม่มีรูปสำหรับใช้อ้างอิง");

    const textMode = job.textMode === "noText" ? "noText" : "withText";
    const sceneCount = Math.max(1, Math.min(10, Number(job.sceneCount) || 1));
    const orderNumber = job.orderNumber || mediaStore.genOrderNumber();
    if (!job.orderNumber) store.updateJob(job.id, { orderNumber });

    flow.resetTrace();
    const projectCache = { projectId: null, title: orderNumber };
    try {
      const session = await ensureFlowSession(projectCache, signal);
      session.mediaIds = await uploadReferences(session.accessToken, session.projectId, referenceImages, `${job.title}: `, signal);

      // Two phases, not one interleaved loop: every scene's start image exists
      // before any scene's video generation starts.
      const sceneStates = Array.from({ length: sceneCount }, () => ({}));
      for (let i = 0; i < sceneCount; i += 1) {
        await runSceneImage({ job, shared, model, textMode, referenceImages, sceneIndex: i, sceneCount, session, signal, state: sceneStates[i] }, onChange);
      }

      const scenes = [];
      for (let i = 0; i < sceneCount; i += 1) {
        await runSceneVideo({ job, model, referenceImages, sceneIndex: i, sceneCount, session, signal, state: sceneStates[i] }, onChange);
        scenes.push({
          scene: i + 1,
          imageUrl: sceneStates[i].imageUrl || "",
          mediaName: sceneStates[i].mediaName || "",
          url: sceneStates[i].videoUrl || "",
        });
        store.updateJob(job.id, { scenes });
        onChange();
      }

      // Merge server-side on Flow instead of locally with ffmpeg. One job uses one
      // model for every scene, so every clip in it shares a duration. Independent
      // scenes also mean no "extend" chaining, so no first-second trim is needed.
      let merged;
      if (scenes.length === 1) {
        merged = { mediaId: scenes[0].mediaName, url: scenes[0].url };
      } else {
        store.log(`${job.title}: กำลังต่อ ${scenes.length} ฉากเป็นวิดีโอเดียว`);
        merged = await withRateLimitRetry(() => flow.concatenateVideos({
          accessToken: session.accessToken, cookieHeader: session.cookieHeader,
          mediaIds: scenes.map((s) => s.mediaName), clipSeconds: model.seconds, signal,
        }), job.title, signal);
      }

      // finalizeScenes still owns naming and placement (the product-named file in
      // the Video Library folder plus the Final-File-JS metadata), so it receives
      // the ONE already-merged clip and performs no second merge.
      const finalResult = await finalizeScenes({
        jobId: job.id,
        productName: job.title || "",
        productId: job.productId || "",
        platform: job.platform,
        sourceUrl: job.sourceUrl || "",
        scenes: [{ url: merged.url, mediaId: merged.mediaId }],
        trimSeconds: 0,
      });

      const platformKey = finalPlatformKey(job.platform, job.sourceUrl || "");
      mediaStore.writeConnectLog(path.join(__dirname, "..", "..", ".."), platformKey, orderNumber, {
        productId: job.productId || "", productName: job.title || "", sourceUrl: job.sourceUrl || "",
        videoModel: model.id, sceneCount: scenes.length, textMode,
        scenes, finalVideo: finalResult.url || finalResult.resultUrl || "",
        status: "done", createdAt: job.createdAt, finishedAt: Date.now(),
      });

      return {
        imageUrl: scenes[scenes.length - 1].imageUrl || "",
        videoUrl: finalResult.url || finalResult.resultUrl || finalResult.videoUrl || "",
        finalVideoUrl: finalResult.url || finalResult.resultUrl || "",
        orderNumber,
        scenes,
      };
    } finally {
      reportFlowTrace();
      onChange();
    }
  }

  /** Standalone "🧪 ทดสอบสร้างรูป" preview — the same generateImage() call a real
   *  job's phase 1 makes, without any of the video steps after it. Costs credits. */
  async function testGenerateImage({ product, direction, imageModel, aspect, extraPrompt }) {
    const shared = await loadShared();
    if (!product) throw new Error("เลือกสินค้าก่อน");
    const images = (product.images || []).slice(0, 3);
    if (!images.length) throw new Error("สินค้านี้ไม่มีรูปสำหรับใช้อ้างอิง");
    const prompts = shared.buildPrompt({
      product, direction: direction || {}, videoModel: shared.DEFAULT_VIDEO_MODEL,
      extraPrompt: extraPrompt || "", textMode: "withText",
    });
    const label = `ทดสอบสร้างรูป: ${product.name}`;
    store.log(label, "info", { stage: "test-image.started" });
    flow.resetTrace();
    try {
      const session = await ensureFlowSession(testImageProjectCache, null);
      session.mediaIds = await uploadReferences(session.accessToken, session.projectId, images, "", null);
      const image = await withFlowErrorModel(flow.RECAPTCHA_ACTION_IMAGE, (captcha) => flow.generateImage({
        accessToken: session.accessToken, projectId: session.projectId, recaptchaToken: captcha,
        prompt: prompts.imagePrompt, aspect: aspect || "portrait",
        model: imageModel || shared.DEFAULT_IMAGE_MODEL, referenceMediaIds: session.mediaIds, signal: null,
      }), label, null);
      store.log(`ทดสอบสร้างรูปสำเร็จ: ${product.name}`, "info", { stage: "test-image.done", mediaId: image.mediaId });
      return { url: image.url, mediaId: image.mediaId || "", prompt: prompts.imagePrompt };
    } catch (err) {
      store.log(`ทดสอบสร้างรูปล้มเหลว: ${err.message}`, "error", { stage: "test-image.failed", error: err.message });
      throw err;
    } finally {
      reportFlowTrace();
    }
  }

  return {
    runnerState,
    cancelJob,
    requestStop,
    startQueue,
    testGenerateImage,
    classifyFlowError,
  };
}

module.exports = { createRunner };
