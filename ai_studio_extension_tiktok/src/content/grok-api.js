// MAIN-world Grok Imagine API engine. Runs INSIDE the user's real, logged-in grok.com tab
// (manifest injects this at document_start, world:"MAIN") and calls grok's internal API
// directly — image over the imagine WebSocket, video over the REST conversations API — using
// the genuine session's cookies + a replayed x-statsig-id. This is the headless DOM-driver's
// replacement: a real trusted tab passes grok's anti-bot where our off-screen Chrome did not
// (live-verified 2026-06-18: replay-statsig conversations/new => 200 in a real tab, 403 in CDP).
//
// Contracts (all live-captured from grok's own frontend, 2026-06-18):
//   IMAGE  wss://grok.com/ws/imagine/listen  — send a `reset` then an `input_text`
//          conversation.item.create; receive {type:"json",current_status,percentage_complete}
//          + {type:"image",blob:<base64 jpeg>} (preview then final; side-by-side => several).
//   VIDEO  POST /rest/media/post/create {mediaType:"MEDIA_POST_TYPE_VIDEO",prompt|mediaUrl} -> post.id
//          POST /rest/app-chat/conversations/new {modelName:"grok-3", toolOverrides:{videoGen:true},
//          message:<RAW>, videoGenModelConfig{parentPostId,aspectRatio,videoLength,resolutionName}}
//          (x-statsig-id required) -> stream
//          result.response.streamingVideoGenerationResponse{progress, videoId, videoUrl(rel)}.
//          (G-Labs' minimal server-accepted shape — NOT grok's UI "imagine-video-gen" surface.)
//          Final mp4 = https://assets.grok.com/<videoUrl>?cache=1&dl=1 (cookie-authed).
//   STATSIG  grok signs each /rest/* request with an x-statsig-id inside a PRIVATE apiClient —
//          NOT a window.fetch patch (routing our POST through window.fetch still 403s), so we
//          can't make grok sign for us. Instead (the G-Labs mechanism) the service worker
//          sniffs the REAL signed token off grok's own /rest/* traffic via chrome.webRequest
//          and injects it here; we replay it with a NATIVE fetch. anti-bot accepts grok's own
//          genuine token from a trusted tab. A stale/localStorage-only id gets 403 on video.
//
// The ISOLATED content script (grok.js) drives this over window.postMessage; results stream
// back the same way. No DOM typing/clicking.
(() => {
  "use strict";
  if (window.__TB_GROK_API__) return;
  window.__TB_GROK_API__ = true;

  const ORIGIN = "https://grok.com";
  const ASSETS = "https://assets.grok.com/";
  const WS_IMAGINE = "wss://grok.com/ws/imagine/listen";

  // ---- statsig capture: replay the latest x-statsig-id grok sends on /rest/* -------------
  // _injectedStatsig is the GENUINE token the service worker sniffed off grok's own /rest/*
  // requests via chrome.webRequest (the G-Labs mechanism) — most reliable, set per command.
  // _statsig is a weaker in-page fetch-hook fallback. [[grok-realtab-api-pivot]]
  let _injectedStatsig = null;
  let _statsig = null;
  let _statsigAt = 0;
  function rememberStatsig(headers) {
    try {
      if (!headers) return;
      let v = null;
      if (typeof headers.get === "function") v = headers.get("x-statsig-id");
      else if (Array.isArray(headers)) {
        for (const p of headers) if (String(p[0]).toLowerCase() === "x-statsig-id") { v = p[1]; break; }
      } else if (typeof headers === "object") {
        for (const k in headers) if (k.toLowerCase() === "x-statsig-id") { v = headers[k]; break; }
      }
      // Skip grok's signer-error sentinel (base64 of "x0:TypeError…childNodes") — anti-bot 403s it.
      try { if (v && atob(v).startsWith("x0:")) return; } catch (_) {}
      if (v) {
        _statsig = v;
        _statsigAt = Date.now();
        // Forward grok's OWN per-request token to the service worker (via grok.js, ISOLATED) so the
        // relay can replay a FRESH one on /conversations/new. This is the deterministic capture —
        // grok signs inside its private apiClient but still uses the page's fetch/XHR, which we
        // hooked at document_start (before grok grabbed its ref). [[grok-realtab-api-pivot]]
        try { window.postMessage({ __tbGrokStatsig: String(v) }, "*"); } catch (_) {}
      }
    } catch (_) {}
  }
  // CRITICAL: do NOT patch window.fetch / XMLHttpRequest. grok's anti-bot statsig signer runs in
  // this SAME MAIN world and, when it detects fetch/XHR have been tampered, refuses to sign — it
  // emits an `x0:TypeError…childNodes` error token that anti-bot 403s. That tamper-detection is the
  // reason OUR replay 403'd while G-Labs (whose content script never patches the page) gets a valid
  // signed token. The service-worker webRequest sniffer (background.js) lifts grok's genuine
  // x-statsig-id off the wire WITHOUT touching the page, so an in-page hook isn't needed; keep a
  // native fetch ref only for the console-test engine below. [[grok-realtab-api-pivot]]
  const _origFetch = window.fetch;

  function uuid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : "r" + Date.now() + Math.floor(Math.random() * 1e6);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Best statsig we have: the SW-sniffed real token first (grok's own signed value off the
  // wire), then the in-page fetch-hook capture, then grok's stable localStorage id as a last
  // resort. The localStorage id alone is NOT enough for video (anti-bot 403s it). [[grok-realtab-api-pivot]]
  function statsigPreseed() {
    if (_injectedStatsig) return _injectedStatsig;
    if (_statsig) return _statsig;
    try { return localStorage.getItem("x-statsig-id") || null; } catch (_) { return null; }
  }

  // Wait briefly for a real statsig (SW-injected or fetch-sniffed) to be available.
  async function ensureStatsig(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (!statsigPreseed() && Date.now() < deadline) await sleep(250);
    return statsigPreseed();
  }

  function apiHeaders() {
    const h = { "content-type": "application/json", "x-xai-request-id": uuid() };
    const s = statsigPreseed();
    if (s) h["x-statsig-id"] = s; // grok's genuine signed token, replayed (the G-Labs approach)
    return h;
  }

  // POST via the NATIVE fetch (saved at document_start) with grok's REAL replayed x-statsig-id —
  // exactly what G-Labs does: it doesn't rely on grok's in-page signer (grok signs in a private
  // apiClient, NOT a window.fetch patch — confirmed: routing through window.fetch still 403s).
  // The genuine token sniffed off grok's wire is accepted by anti-bot. [[grok-realtab-api-pivot]]
  async function apiPost(path, body) {
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await _origFetch.call(window, ORIGIN + path, {
        method: "POST",
        credentials: "include",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status !== 403) return res;
      await sleep(900); // a newer token may have been sniffed by the SW between attempts
    }
    return res;
  }

  // ---- parse a growing buffer of concatenated top-level JSON objects (NDJSON-ish) ---------
  function drainJsonObjects(buf) {
    const out = [];
    let depth = 0, inStr = false, esc = false, start = -1, i = 0;
    for (; i < buf.length; i++) {
      const ch = buf[i];
      if (start === -1) { if (ch === "{") { start = i; depth = 1; inStr = false; esc = false; } continue; }
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { out.push(JSON.parse(buf.slice(start, i + 1))); } catch (_) {} start = -1; } }
    }
    return { objects: out, rest: start === -1 ? "" : buf.slice(start) };
  }

  // =====================================================================================
  // IMAGE — wss://grok.com/ws/imagine/listen. Returns base64 JPEG blobs (data, no prefix).
  // =====================================================================================
  function generateImage(opts, onEvent) {
    const prompt = String(opts.prompt || "");
    const aspect = String(opts.aspect || "2:3");
    const sideBySide = opts.count ? Number(opts.count) > 1 : true;
    const enablePro = !!opts.pro;
    return new Promise((resolve, reject) => {
      let ws, done = false;
      const images = [];
      let lastStatus = "";
      let postId = null; // grok's job_id == the image post id (animatable via fileAttachments)
      const finish = (ok, why) => {
        if (done) return; done = true;
        try { ws && ws.close(); } catch (_) {}
        if (ok) resolve({ images, status: lastStatus, reason: why, postId });
        else reject(new Error(why || "image generation failed"));
      };
      const timer = setTimeout(() => finish(images.length > 0, "timeout"), 120000);
      try { ws = new WebSocket(WS_IMAGINE); } catch (e) { clearTimeout(timer); return reject(e); }
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ type: "conversation.item.create", timestamp: Date.now(),
            item: { type: "message", content: [{ type: "reset" }] } }));
          ws.send(JSON.stringify({ type: "conversation.item.create", timestamp: Date.now(),
            item: { type: "message", content: [{ requestId: uuid(), text: prompt, type: "input_text",
              properties: { section_count: 0, is_kids_mode: false, enable_nsfw: true, skip_upsampler: false,
                enable_side_by_side: sideBySide, is_initial: false, aspect_ratio: aspect, enable_pro: enablePro } }] } }));
        } catch (e) { clearTimeout(timer); finish(false, "send: " + e); }
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === "image" && m.blob) {
          images.push(m.blob);
          onEvent && onEvent({ kind: "image", index: images.length });
        } else if (m.type === "json") {
          lastStatus = m.current_status || lastStatus;
          if (m.job_id) postId = m.job_id; // the image post id (for image→video fileAttachments)
          onEvent && onEvent({ kind: "progress", pct: m.percentage_complete, status: m.current_status });
          if (/final|complete|finished|done/i.test(m.current_status || "")) {
            // a beat for any trailing image frames, then finish
            setTimeout(() => { clearTimeout(timer); finish(true, "final"); }, 1500);
          }
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => { clearTimeout(timer); finish(images.length > 0, "closed"); };
    });
  }

  // =====================================================================================
  // VIDEO — media/post/create -> conversations/new (stream) -> assets.grok.com mp4 (+upscale)
  // =====================================================================================
  // The connected account's userId (for building image asset URLs) — cached after one read.
  let _userId = null;
  async function getUserId() {
    if (_userId) return _userId;
    try {
      const r = await _origFetch.call(window, ORIGIN + "/rest/auth/get-user", { credentials: "include", headers: apiHeaders() });
      if (r.ok) { const j = await r.json(); _userId = j.userId || j.xaiUserId || null; }
    } catch (_) {}
    return _userId;
  }

  // POST a new VIDEO media post → its parentPostId (every video gen attaches to a fresh one).
  async function createVideoPost(prompt) {
    const res = await apiPost("/rest/media/post/create", { mediaType: "MEDIA_POST_TYPE_VIDEO", prompt }, true);
    if (res.status !== 200) throw new Error("media/post/create " + res.status + ": " + (await safeText(res)));
    const id = ((await res.json().catch(() => ({}))).post || {}).id;
    if (!id) throw new Error("media/post/create returned no post id");
    return id;
  }

  // Drain a conversations/new video stream → {relUrl, videoId, width, height} (videoUrl is
  // RELATIVE; resolve with assetUrl()). Reports progress (0–100) as it streams.
  async function drainVideoStream(convRes, onEvent) {
    const reader = convRes.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "", videoId = null, relUrl = null, lastPct = -1, width = 0, height = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { objects, rest } = drainJsonObjects(buf);
      buf = rest;
      for (const o of objects) {
        const s = o && o.result && o.result.response && o.result.response.streamingVideoGenerationResponse;
        if (!s) continue;
        if (s.videoId) videoId = s.videoId;
        if (typeof s.progress === "number" && s.progress !== lastPct) {
          lastPct = s.progress;
          onEvent && onEvent({ kind: "progress", pct: s.progress });
        }
        if (s.videoUrl) { relUrl = s.videoUrl; width = s.width || width; height = s.height || height; }
      }
      if (relUrl) break;
    }
    if (!relUrl) throw new Error("video stream ended without a videoUrl (progress " + lastPct + ")");
    return { relUrl, videoId, width, height };
  }

  function assetUrl(rel) {
    const abs = /^https?:/.test(rel) ? rel : ASSETS + String(rel).replace(/^\//, "");
    return abs + (abs.includes("?") ? "" : "?cache=1&dl=1");
  }

  // Best-effort HD upscale for 720p+ → the hd url, or null to keep the base.
  async function maybeUpscale(videoId, resolutionName, onEvent) {
    if (!(/720|1080|hd/i.test(resolutionName) && videoId)) return null;
    try {
      const up = await apiPost("/rest/media/video/upscale", { videoId }, true);
      if (up.status !== 200) return null;
      const uj = await up.json().catch(() => ({}));
      const hd = uj.hdMediaUrl || uj.hdVideoUrl || uj.videoUrl || (uj.result && uj.result.videoUrl);
      if (!hd) return null;
      onEvent && onEvent({ kind: "stage", stage: "upscaled" });
      return assetUrl(hd);
    } catch (_) { return null; }
  }

  // Single-shot text→video.
  async function generateVideo(opts, onEvent) {
    const prompt = String(opts.prompt || "");
    const aspect = String(opts.aspect || "9:16");
    const videoLength = Number(opts.videoLength || opts.duration || 6);
    const resolutionName = String(opts.resolution || "720p");
    await ensureStatsig(); // need grok's genuine replayed x-statsig-id (SW-sniffed) before the video POST

    const parentPostId = await createVideoPost(prompt);
    onEvent && onEvent({ kind: "stage", stage: "post-created", parentPostId });
    const convRes = await apiPost("/rest/app-chat/conversations/new", {
      temporary: true, modelName: "grok-3", message: prompt, toolOverrides: { videoGen: true },
      enableSideBySide: true,
      responseMetadata: { experiments: [], modelConfigOverride: { modelMap: {
        videoGenModelConfig: { parentPostId, aspectRatio: aspect, videoLength, resolutionName } } } },
    }, true);
    if (convRes.status !== 200) throw new Error("conversations/new " + convRes.status + ": " + (await safeText(convRes)));
    const { relUrl, videoId, width, height } = await drainVideoStream(convRes, onEvent);
    const videoUrl = (await maybeUpscale(videoId, resolutionName, onEvent)) || assetUrl(relUrl);
    return { videoUrl, videoId, postId: parentPostId, prompt, aspect, resolutionName, width, height };
  }

  // grok-clip10 image→video: generate the start image (WS), then ANIMATE that image post via the
  // G-Labs contract: grok-3 + toolOverrides{videoGen}, RAW motion message, image post id in
  // fileAttachments. [[grok-realtab-api-pivot]]
  async function generateImageVideo(opts, onEvent) {
    const imagePrompt = String(opts.imagePrompt || opts.prompt || "");
    const motionPrompt = String(opts.promptVideo || opts.motionPrompt || opts.prompt || "");
    const aspect = String(opts.aspect || "9:16");
    const videoLength = Number(opts.videoLength || opts.duration || 6);
    const resolutionName = String(opts.resolution || "720p");
    await ensureStatsig(); // need grok's genuine replayed x-statsig-id (SW-sniffed) before the video POST

    // 1) start image (single) → its post id + base64
    onEvent && onEvent({ kind: "stage", stage: "image" });
    const img = await generateImage({ prompt: imagePrompt, aspect, count: 1 }, (ev) => {
      if (ev.kind === "progress" && typeof ev.pct === "number") {
        onEvent && onEvent({ kind: "progress", pct: Math.round(ev.pct * 0.4) });
      }
    });
    const imagePostId = img.postId;
    const best = (img.images || []).slice().sort((a, b) => b.length - a.length)[0] || null;
    if (!imagePostId) throw new Error("image→video: no image post id from the WS (cannot animate)");
    const uid = await getUserId();
    if (!uid) throw new Error("image→video: could not resolve userId for the image asset URL");
    const imageUrl = ASSETS + "users/" + uid + "/" + imagePostId + "/content";
    if (best) onEvent && onEvent({ kind: "image", base64: best }); // stream the start image early

    // 2) new video post, 3) animate (image url prepended to message + fileAttachments)
    const parentPostId = await createVideoPost(motionPrompt);
    onEvent && onEvent({ kind: "stage", stage: "animate" });
    const convRes = await apiPost("/rest/app-chat/conversations/new", {
      temporary: true,
      modelName: "grok-3",
      message: motionPrompt,
      toolOverrides: { videoGen: true },
      fileAttachments: [imagePostId],
      enableSideBySide: true,
      responseMetadata: { experiments: [], modelConfigOverride: { modelMap: {
        videoGenModelConfig: { parentPostId, aspectRatio: aspect, videoLength, resolutionName } } } },
    }, true);
    if (convRes.status !== 200) throw new Error("conversations/new(animate) " + convRes.status + ": " + (await safeText(convRes)));

    // 4) stream → final url (+ optional HD upscale)
    const { relUrl, videoId } = await drainVideoStream(convRes, (ev) => {
      if (ev.kind === "progress") onEvent && onEvent({ kind: "progress", pct: 40 + Math.round(ev.pct * 0.55) });
    });
    const videoUrl = (await maybeUpscale(videoId, resolutionName, onEvent)) || assetUrl(relUrl);
    return { videoUrl, videoId, postId: parentPostId, prompt: motionPrompt, aspect, resolutionName, imageBase64: best, imagePostId };
  }

  // Extend an existing clip by +videoLength s (live-captured contract): re-uses the BASE
  // video's postId (extendPostId/originalPostId/parentPostId — NO fresh media/post/create),
  // references the latest clip via fileAttachments:[videoId] + isVideoExtension:true, and
  // starts the new segment at startTime (≈ the cumulative length so far). [[grok-realtab-api-pivot]]
  async function extendVideo(base, opts, onEvent) {
    const message = String(opts.message || base.prompt || "");
    const videoLength = Number(opts.videoLength || 10);
    await ensureStatsig(); // need grok's genuine replayed x-statsig-id (SW-sniffed) before the video POST
    const cfg = {
      isVideoExtension: true,
      videoExtensionStartTime: Number(base.startTime || 10),
      extendPostId: base.postId,
      stitchWithExtendPostId: true,
      originalPrompt: String(base.originalPrompt || base.prompt || ""),
      originalPostId: base.postId,
      originalRefType: "ORIGINAL_REF_TYPE_VIDEO_EXTENSION",
      mode: "custom",
      aspectRatio: base.aspect || "9:16",
      videoLength,
      resolutionName: base.resolutionName || "720p",
      parentPostId: base.postId, // extend writes to the SAME post (no new media/post/create)
      isVideoEdit: false,
    };
    const convRes = await apiPost("/rest/app-chat/conversations/new", {
      temporary: true,
      modelName: "grok-3",
      message: message,
      toolOverrides: { videoGen: true },
      fileAttachments: [base.videoId],
      enableSideBySide: true,
      responseMetadata: { experiments: [], modelConfigOverride: { modelMap: { videoGenModelConfig: cfg } } },
    }, true);
    if (convRes.status !== 200) throw new Error("extend conversations/new " + convRes.status + ": " + (await safeText(convRes)));
    const { relUrl, videoId } = await drainVideoStream(convRes, onEvent);
    const videoUrl = (await maybeUpscale(videoId, cfg.resolutionName, onEvent)) || assetUrl(relUrl);
    return { videoUrl, videoId, postId: base.postId };
  }

  // grok-extend: make the base clip (image→video), then chain +10s extends to reach the
  // target length. n = max(0,(target-10)//10); each hop continues from the latest clip on the
  // SAME base post, with a growing videoExtensionStartTime. [[grok-realtab-api-pivot]]
  async function generateExtendedVideo(opts, onEvent) {
    const target = Number(opts.targetSeconds || opts.videoLength || 10);
    const step = 10;
    const base = await generateImageVideo({ ...opts, videoLength: step }, onEvent);
    const nHops = target > step ? Math.floor((target - step) / step) : 0;
    if (!nHops) return base;
    const extendPrompts = opts.extendPrompts || [];
    let cur = base;
    let startTime = step; // base clip length (~10s); grows by step each hop
    for (let i = 0; i < nHops; i++) {
      onEvent && onEvent({ kind: "stage", stage: "extend " + (i + 1) + "/" + nHops });
      const hop = await extendVideo(
        {
          postId: base.postId,            // extend the ORIGINAL base post
          videoId: cur.videoId,           // reference the latest clip
          prompt: opts.promptVideo,
          originalPrompt: opts.promptVideo,
          aspect: opts.aspect,
          resolutionName: opts.resolution,
          startTime,
        },
        { message: extendPrompts[i] || opts.promptVideo, videoLength: step },
        (ev) => { if (ev.kind === "progress") onEvent && onEvent({ kind: "progress", pct: ev.pct }); }
      );
      cur = hop;
      startTime += step;
    }
    return { videoUrl: cur.videoUrl, videoId: cur.videoId, postId: base.postId, imageBase64: base.imageBase64 };
  }

  async function safeText(res) { try { return (await res.text()).slice(0, 300); } catch (_) { return ""; } }

  // ---- expose for console testing + the postMessage bridge (driven by grok.js, ISOLATED) --
  window.tbGrok = { generateImage, generateVideo, generateImageVideo, generateExtendedVideo, extendVideo, statsig: () => _statsig, ensureStatsig };

  window.addEventListener("message", async (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__tbGrok !== "cmd" || !d.id) return;
    const reply = (payload) => { try { window.postMessage({ __tbGrok: "evt", id: d.id, ...payload }, "*"); } catch (_) {} };
    if (d.ping) { reply({ done: true, result: { pong: true } }); return; } // handshake — engine is loaded
    // The genuine x-statsig-id sniffed by the service worker off grok's own /rest/* traffic
    // (G-Labs mechanism). Take it as the primary token for this command. [[grok-realtab-api-pivot]]
    if (d.statsig) _injectedStatsig = d.statsig;
    const onEvent = (ev) => reply({ event: ev });
    try {
      const opts = d.opts || {};
      const out = d.media === "video" ? await generateVideo(opts, onEvent)
        : d.media === "extend" ? await generateExtendedVideo(opts, onEvent)
        : d.media === "image_video" ? await generateImageVideo(opts, onEvent)
        : await generateImage(opts, onEvent);
      reply({ done: true, result: out });
    } catch (err) {
      reply({ done: true, error: String(err && (err.message || err)) });
    }
  });
})();
