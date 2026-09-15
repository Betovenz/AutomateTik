// Content script (ISOLATED world): bridges the desktop app's "generate" command to the
// MAIN-world Grok API engine (grok-api.js) and relays progress/results back.
//
// grok generation runs ENTIRELY via grok's internal API (image over the imagine WebSocket,
// video over /rest/app-chat/conversations/new) inside the user's real, logged-in grok.com
// tab — NOT DOM automation. This script:
//   • forwards grok's own per-request x-statsig-id (sniffed by grok-api.js's MAIN-world hook)
//     up to the service worker, which replays the freshest one on protected requests;
//   • on a "generate" message, handshakes the MAIN-world engine, then dispatches the right
//     flow (image / video / image_video / extend) to it via window.postMessage.
//
// The old DOM-driving path (typing into the composer, clicking toolbar controls, polling the
// "Generating NN%" overlay) was removed when grok moved to the API engine — see git history
// if a DOM fallback is ever needed again. [[grok-realtab-api-pivot]]

(function () {
  // Idempotency guard: the bridge is normally loaded as a manifest content script, but the
  // service worker ALSO injects it on-demand via chrome.scripting.executeScript (the G-Labs
  // mechanism) so generation works in a grok tab that was open BEFORE the extension loaded.
  // Re-running would register a SECOND "generate" onMessage listener → double generation, so
  // bail if we're already here. [[grok-realtab-api-pivot]]
  if (window.__TB_GROK_BRIDGE__) return;
  window.__TB_GROK_BRIDGE__ = true;

  // Relay grok's OWN per-request x-statsig-id — captured by the MAIN-world fetch/XHR hook in
  // grok-api.js and posted as {__tbGrokStatsig} — up to the service worker, which replays the
  // freshest one on /conversations/new. This is the deterministic statsig capture (no webRequest
  // blind spots). [[grok-realtab-api-pivot]]
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.__tbGrokStatsig) {
      try {
        chrome.runtime.sendMessage({ __tb: true, type: "grokStatsig", value: d.__tbGrokStatsig });
      } catch (_) {}
    }
  });

  // Bridge to the MAIN-world Grok API engine (grok-api.js): send a generate command,
  // relay its progress events to `report`, resolve with the engine's result. The engine
  // calls grok's internal API directly in THIS real, logged-in tab (no DOM) — grok's
  // anti-bot trusts a real session so a replayed x-statsig-id is accepted (live-verified
  // 2026-06-18: conversations/new 200 in a real tab vs 403 from off-screen CDP).
  // The genuine grok x-statsig-id sniffed by the service worker (background.js webRequest).
  // Set per-generate from the inbound message; forwarded to the MAIN-world engine so its
  // raw fetch carries grok's real signed anti-bot token. [[grok-realtab-api-pivot]]
  let lastStatsig = null;

  function generateViaApi(media, opts, report) {
    return new Promise((resolve, reject) => {
      const id = "tb" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      let settled = false;
      const cleanup = () => {
        settled = true;
        window.removeEventListener("message", onMsg);
        clearTimeout(timer);
      };
      const onMsg = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.__tbGrok !== "evt" || d.id !== id) return;
        if (d.event) {
          const ev = d.event;
          if (ev.kind === "progress" && typeof ev.pct === "number") {
            report("waiting", `กำลังสร้าง ${ev.pct}%…`, 0.4 + 0.55 * (ev.pct / 100));
          } else if (ev.kind === "stage") {
            report("waiting", "กำลังประมวลผล…", 0.5);
          }
          return;
        }
        if (d.done) {
          cleanup();
          if (d.error) reject(new Error(d.error));
          else resolve(d.result);
        }
      };
      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error("grok API engine timed out (is grok-api.js injected? are you logged in?)"));
        }
      }, 420000);
      window.addEventListener("message", onMsg);
      window.postMessage({ __tbGrok: "cmd", id, media, opts, statsig: lastStatsig }, "*");
    });
  }

  // Fast handshake with the MAIN-world engine (grok-api.js). If it doesn't answer, the tab
  // was loaded before the extension (no document_start engine) → fail fast with a clear fix.
  function ensureEngine() {
    return new Promise((resolve) => {
      const id = "ping" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const onMsg = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d && d.__tbGrok === "evt" && d.id === id) { window.removeEventListener("message", onMsg); resolve(true); }
      };
      window.addEventListener("message", onMsg);
      window.postMessage({ __tbGrok: "cmd", id, ping: true }, "*");
      setTimeout(() => { window.removeEventListener("message", onMsg); resolve(false); }, 3000);
    });
  }

  async function generate({ jobId, prompt, mediaType, count = 1, options = {}, statsig = null }) {
    lastStatsig = statsig || null; // grok's real anti-bot token (sniffed by the SW)
    const report = (stage, message, progress) => {
      if (TB.hud) TB.hud.stage(message, { jobId }); // mirror progress onto the on-page HUD
      TB.report(jobId, stage, message, progress);
    };

    if (!(await ensureEngine())) {
      throw new Error(
        "Grok API engine ยังไม่โหลดในแท็บนี้ — รีโหลดแท็บ grok.com แล้วลองใหม่ " +
        "(ถ้าเพิ่ง reload extension ใน chrome://extensions ต้องรีโหลดแท็บ grok ด้วย)"
      );
    }

    // grok-clip10 image→video: generate the start image then ANIMATE it — all via the API
    // engine (grok-3 + toolOverrides{videoGen}, RAW motion message, image post id in
    // fileAttachments). grok-extend's +10s chaining IS wired below (target>10 →
    // generateViaApi("extend"), which the engine renders as base clip + N extend hops).
    // [[grok-realtab-api-pivot]]
    if (options.mediaFlow === "image_video") {
      const target = parseInt(String(options.grokDuration || "10"), 10) || 10;

      // grok-extend: a base clip then +10s extend hops to reach a >10s target. The continuation
      // prompts are extendPrompt2, extendPrompt3, … ("continue, don't re-greet"). [[grok-realtab-api-pivot]]
      if (target > 10) {
        const extendPrompts = [];
        for (let i = 2; options["extendPrompt" + i]; i++) extendPrompts.push(options["extendPrompt" + i]);
        report("generate", "กำลังสร้างคลิปยาว (Grok API)…", 0.15);
        const out = await generateViaApi("extend", {
          prompt, // start-image prompt
          promptVideo: options.promptVideo || prompt,
          extendPrompts,
          targetSeconds: target,
          aspect: options.aspect || "9:16",
          resolution: options.grokResolution || "720p",
        }, report);
        if (!out || !out.videoUrl) throw new Error("grok extend returned no video URL");
        report("done", "Grok สร้างคลิปยาวเสร็จแล้ว", 1);
        return { ok: true, mediaUrl: out.videoUrl, mediaType: "video" };
      }

      // grok-clip10: start image → animate (single clip).
      report("generate", "กำลังสร้างภาพ + วิดีโอ (Grok API)…", 0.2);
      const out = await generateViaApi("image_video", {
        prompt, // start-image prompt
        promptVideo: options.promptVideo || prompt,
        aspect: options.aspect || "9:16",
        videoLength: target,
        resolution: options.grokResolution || "720p",
      }, report);
      if (!out || !out.videoUrl) throw new Error("grok image→video returned no video URL");
      report("done", "Grok สร้างวิดีโอเสร็จแล้ว", 1);
      return { ok: true, mediaUrl: out.videoUrl, mediaType: "video" };
    }

    report(
      "generate",
      mediaType === "video" ? "กำลังสร้างวิดีโอ (Grok API)…" : "กำลังสร้างภาพ (Grok API)…",
      0.3
    );
    const media = mediaType === "video" ? "video" : "image";
    const apiOpts = { prompt, aspect: options.aspect || "9:16", count };
    if (media === "video") {
      apiOpts.videoLength = parseInt(String(options.grokDuration || "6"), 10) || 6;
      apiOpts.resolution = options.grokResolution || "720p";
    }
    const out = await generateViaApi(media, apiOpts, report);

    if (media === "video") {
      if (!out || !out.videoUrl) throw new Error("grok returned no video URL");
      report("done", "Grok สร้างวิดีโอเสร็จแล้ว", 1);
      // assets.grok.com is cookie-gated (CORS-blocked in-page) → the app downloads it with
      // the connected account's grok cookie before save_media.
      return { ok: true, mediaUrl: out.videoUrl, mediaType: "video" };
    }
    // grok returns base64 JPEG frames over the WS — pick the largest (the final, sharp one).
    const images = (out && out.images) || [];
    const best = images.slice().sort((a, b) => b.length - a.length)[0];
    if (!best) throw new Error("grok returned no image");
    report("done", "Grok สร้างภาพเสร็จแล้ว", 1);
    return { ok: true, mediaUrl: "data:image/jpeg;base64," + best, mediaType: "image" };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "generate") return;
    const sub = `Grok · ${msg.mediaType === "video" ? "Video" : "Image"}`;
    if (TB.hud) TB.hud.mount({ jobId: msg.jobId, subtitle: sub, stage: "กำลังเริ่มต้น…" });
    generate(msg)
      .then((r) => {
        if (TB.hud) TB.hud.done({ ok: r?.ok !== false, jobId: msg.jobId, label: "เสร็จสมบูรณ์" });
        sendResponse(r);
      })
      .catch((e) => {
        if (TB.hud) TB.hud.done({ ok: false, jobId: msg.jobId, label: "เกิดข้อผิดพลาด" });
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  });
})();
