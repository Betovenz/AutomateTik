// Shared on-page HUD ("managed tab" overlay) for AutoGT Pro content scripts.
// Loaded right after dom.js in every content_scripts group, so it extends the
// same `window.TB` namespace and every site can call `TB.hud.*`.
//
// Two drivers feed the SAME card so the look is identical everywhere:
//   • Flow (labs.google) generates via the API in the desktop app — the page does
//     no DOM work — so the app drives the HUD by sending an "ext.command" with
//     action "hud" that the background relays here as a {type:"hud"} message.
//   • Grok / TikTok run their automation IN the content script, so those scripts
//     call TB.hud.mount()/stage()/done() directly (no app round-trip needed).
//
// The card lives in a closed-ish Shadow DOM attached to <html>, so the host
// page's CSS can't bleed in and our styles can't leak out.

(function () {
  if (!window.TB || window.TB.hud) return; // dom.js runs first; inject HUD once

  const MAX_LIFETIME_MS = 6 * 60 * 1000; // safety auto-hide if a "done" never arrives
  const FADE_OUT_MS = 1300; // linger after the last job finishes, then fade

  // State shared across overlapping jobs (Flow reuses one managed tab for a batch).
  const jobs = new Map(); // jobId -> { stage, steps, idx, err }
  let host = null; // shadow host element
  let els = null; // cached element refs inside the shadow root
  let startMs = 0; // when the current run began (first active job)
  let tick = null; // setInterval id for the seconds counter
  let hideTimer = null; // pending fade-out
  let killTimer = null; // safety auto-hide

  // ---- markup + styles ------------------------------------------------------
  // Step-rail icons, keyed by the step "key" the driver sends (think/image/video/post).
  // Resolved ONLY from this map (labels render via textContent), so a hostile payload
  // can never inject markup through the steps list.
  const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const STEP_ICONS = {
    think: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="M19 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z"/></svg>`,
    image: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
    video: `<svg viewBox="0 0 24 24" ${S}><path d="m23 7-7 5 7 5V7Z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
    post: `<svg viewBox="0 0 24 24" ${S}><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>`,
    dot: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>`,
  };

  function styleSheet() {
    return `
      :host { all: initial; }
      .tb-back {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8, 10, 14, .74);
        -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
        font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        opacity: 0; transition: opacity .28s ease;
      }
      .tb-back.tb-show { opacity: 1; }
      .tb-card {
        width: 316px; box-sizing: border-box; padding: 26px 26px 20px;
        text-align: center; color: #e8eaf0; border-radius: 20px;
        background: linear-gradient(180deg, #161a22 0%, #11141a 100%);
        border: 1px solid rgba(255,255,255,.08);
        box-shadow: 0 24px 60px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(251,149,20,.06);
        transform: translateY(8px) scale(.98); transition: transform .28s cubic-bezier(.16,1,.3,1);
      }
      .tb-back.tb-show .tb-card { transform: translateY(0) scale(1); }
      .tb-title { font-size: 17px; font-weight: 700; letter-spacing: .2px; }
      .tb-sub {
        margin-top: 4px; font-size: 10.5px; font-weight: 600; letter-spacing: 2px;
        text-transform: uppercase; color: #8b93a5;
      }
      .tb-steps {
        display: flex; align-items: flex-start; justify-content: center;
        margin: 18px 2px 0;
      }
      .tb-steps[hidden] { display: none; }
      .tb-step {
        flex: 0 1 auto; min-width: 48px; display: flex; flex-direction: column;
        align-items: center; gap: 6px;
      }
      .tb-ic {
        width: 34px; height: 34px; border-radius: 50%; box-sizing: border-box;
        display: flex; align-items: center; justify-content: center;
        background: #1c212b; border: 1.5px solid rgba(255,255,255,.14); color: #6b7283;
        transition: background .3s ease, border-color .3s ease, color .3s ease;
      }
      .tb-ic svg { width: 15px; height: 15px; display: block; }
      .tb-lb { font-size: 10.5px; font-weight: 600; color: #6b7283; line-height: 1.3; }
      .tb-line {
        flex: 1 1 10px; min-width: 10px; max-width: 36px; height: 2px; margin-top: 16px;
        border-radius: 1px; background: rgba(255,255,255,.12); position: relative; overflow: hidden;
      }
      .tb-line::after {
        content: ""; position: absolute; inset: 0; border-radius: 1px;
        background: linear-gradient(90deg, #fbb04a, #f2740c);
        transform: scaleX(0); transform-origin: left; transition: transform .45s ease;
      }
      .tb-line.lit::after { transform: scaleX(1); }
      .tb-step.on .tb-ic {
        background: linear-gradient(135deg, #fbb04a 0%, #f2740c 100%);
        border-color: transparent; color: #1b1206;
        animation: tb-step-pulse 1.6s infinite;
      }
      .tb-step.on .tb-lb { color: #fbb04a; }
      .tb-step.ok .tb-ic {
        background: rgba(251,149,20,.14); border-color: rgba(251,149,20,.6); color: #fbb04a;
      }
      .tb-step.ok .tb-lb { color: #c2c8d4; }
      .tb-step.err .tb-ic {
        background: rgba(241,115,107,.12); border-color: #f1736b; color: #f1736b;
      }
      .tb-step.err .tb-lb { color: #f1736b; }
      @keyframes tb-step-pulse {
        0% { box-shadow: 0 0 0 0 rgba(251,149,20,.4); }
        70% { box-shadow: 0 0 0 8px rgba(251,149,20,0); }
        100% { box-shadow: 0 0 0 0 rgba(251,149,20,0); }
      }
      .tb-statusrow {
        margin: 16px 0 8px; display: flex; align-items: center; justify-content: center;
        gap: 7px; font-size: 12.5px; color: #58d68d;
      }
      .tb-dot {
        width: 8px; height: 8px; border-radius: 50%; background: #fbb04a;
        box-shadow: 0 0 0 0 rgba(251,176,74,.6); animation: tb-pulse 1.4s infinite;
      }
      .tb-statusrow.ok { color: #58d68d; } .tb-statusrow.ok .tb-dot { background: #58d68d; animation: none; }
      .tb-statusrow.err { color: #f1736b; } .tb-statusrow.err .tb-dot { background: #f1736b; animation: none; }
      .tb-stage {
        font-size: 21px; font-weight: 800; line-height: 1.25; margin-top: 2px;
        background: linear-gradient(135deg, #fbb04a, #f2740c);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: #f2740c;
      }
      .tb-timer {
        margin-top: 10px; font-size: 13px; font-weight: 600; color: #c2c8d4;
        font-variant-numeric: tabular-nums;
      }
      .tb-count { color: #8b93a5; font-weight: 500; }
      .tb-foot {
        margin-top: 16px; padding-top: 13px; border-top: 1px solid rgba(255,255,255,.07);
        font-size: 10.5px; color: #6b7283; line-height: 1.5;
      }
      @keyframes tb-pulse {
        0% { box-shadow: 0 0 0 0 rgba(251,176,74,.55); }
        70% { box-shadow: 0 0 0 7px rgba(251,176,74,0); }
        100% { box-shadow: 0 0 0 0 rgba(251,176,74,0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .tb-back, .tb-card, .tb-dot, .tb-ic, .tb-line::after {
          transition: none !important; animation: none !important;
        }
      }
    `;
  }

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "__tb_hud_host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = styleSheet();
    const back = document.createElement("div");
    back.className = "tb-back";
    back.innerHTML = `
      <div class="tb-card" role="status" aria-live="polite">
        <div class="tb-title">AutoGT Pro</div>
        <div class="tb-sub">Automation Active</div>
        <div class="tb-steps" hidden></div>
        <div class="tb-statusrow"><span class="tb-dot"></span><span class="tb-text">Working...</span></div>
        <div class="tb-stage">กำลังเริ่มต้น…</div>
        <div class="tb-timer">0s</div>
        <div class="tb-foot">🔒 แท็บนี้ถูกควบคุมโดย AutoGT Pro</div>
      </div>`;
    shadow.append(style, back);
    (document.documentElement || document.body).appendChild(host);
    els = {
      back,
      title: back.querySelector(".tb-title"),
      sub: back.querySelector(".tb-sub"),
      steps: back.querySelector(".tb-steps"),
      row: back.querySelector(".tb-statusrow"),
      text: back.querySelector(".tb-text"),
      stage: back.querySelector(".tb-stage"),
      timer: back.querySelector(".tb-timer"),
    };
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderTimer() {
    if (!els) return;
    const n = jobs.size;
    els.timer.innerHTML =
      fmt(Date.now() - startMs) + (n > 1 ? ` <span class="tb-count">· ${n} งาน</span>` : "");
  }

  /** Validate an incoming steps list down to plain {key,label} strings (≤6).
   *  A rail needs ≥2 steps to mean anything — otherwise treat as "no steps". */
  function cleanSteps(steps) {
    if (!Array.isArray(steps)) return null;
    const out = steps
      .slice(0, 6)
      .map((s) => ({ key: String(s?.key || ""), label: String(s?.label || "") }))
      .filter((s) => s.key && s.label);
    return out.length >= 2 ? out : null;
  }

  /** Paint the step rail for one job record: steps before `idx` are done (✓),
   *  `idx` is active (lit + pulse, or red on error), the rest pending. The DOM is
   *  rebuilt only when the step LIST changes; state flips just toggle classes so
   *  the connector-line fill still animates. */
  function renderSteps(rec) {
    if (!els) return;
    const steps = rec && rec.steps;
    if (!steps) {
      els.steps.hidden = true;
      els.steps.innerHTML = "";
      els.steps.dataset.sig = "";
      return;
    }
    const sig = steps.map((s) => `${s.key}|${s.label}`).join(",");
    if (els.steps.dataset.sig !== sig) {
      els.steps.dataset.sig = sig;
      els.steps.innerHTML = "";
      steps.forEach((s, i) => {
        if (i) {
          const line = document.createElement("div");
          line.className = "tb-line";
          els.steps.appendChild(line);
        }
        const step = document.createElement("div");
        step.className = "tb-step";
        const ic = document.createElement("div");
        ic.className = "tb-ic";
        ic.innerHTML = STEP_ICONS[s.key] || STEP_ICONS.dot; // our own markup only
        const lb = document.createElement("div");
        lb.className = "tb-lb";
        lb.textContent = s.label; // untrusted text stays text
        step.append(ic, lb);
        els.steps.appendChild(step);
      });
      els.steps.hidden = false;
    }
    let i = 0; // step index; lines sit BETWEEN steps, lit once the next step is reached
    for (const node of els.steps.children) {
      if (node.classList.contains("tb-line")) {
        node.classList.toggle("lit", i <= rec.idx);
        continue;
      }
      const done = i < rec.idx;
      node.className = "tb-step" + (done ? " ok" : i === rec.idx ? (rec.err ? " err" : " on") : "");
      node.querySelector(".tb-ic").innerHTML = done
        ? STEP_ICONS.check
        : STEP_ICONS[steps[i].key] || STEP_ICONS.dot;
      i++;
    }
  }

  /** Point the card at one job record: its stage text + its step rail. */
  function show(rec) {
    if (!els || !rec) return;
    if (rec.stage) els.stage.textContent = rec.stage;
    renderSteps(rec);
  }

  function clearTimers() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (killTimer) { clearTimeout(killTimer); killTimer = null; }
  }

  // ---- public API -----------------------------------------------------------
  const hud = {
    /** Show (or refresh) the HUD and register an active job.
     *  `steps` (optional) draws the pipeline rail: [{key, label}] in order, where
     *  key picks the icon (think/image/video/post) and label is the Thai caption.
     *  `step` (optional) is the key of the step that is active right now. */
    mount({ jobId = "_", title, subtitle, stage, steps, step } = {}) {
      build();
      clearTimers();
      if (!jobs.size) {
        startMs = Date.now();
        if (tick) clearInterval(tick);
        tick = setInterval(renderTimer, 250);
      }
      const rec = { stage: stage || "", steps: cleanSteps(steps), idx: 0, err: false };
      if (step && rec.steps) {
        const i = rec.steps.findIndex((s) => s.key === step);
        if (i >= 0) rec.idx = i;
      }
      jobs.set(jobId, rec);
      if (title) els.title.textContent = title;
      if (subtitle) els.sub.textContent = subtitle;
      els.row.className = "tb-statusrow";
      els.text.textContent = "กำลังทำงาน…";
      show(rec);
      renderTimer();
      // requestAnimationFrame so the entrance transition actually runs.
      // Guard: on a backgrounded tab rAF is paused while hide()'s setTimeout
      // still fires, so els can be nulled out before this callback runs.
      requestAnimationFrame(() => { if (els) els.back.classList.add("tb-show"); });
      killTimer = setTimeout(() => hud.hide(), MAX_LIFETIME_MS);
    },

    /** Update the big accent line for an active job; `step` (a key from the
     *  mounted steps list) advances the rail — earlier steps flip to done. */
    stage(text, { jobId = "_", step } = {}) {
      if (!jobs.has(jobId)) return hud.mount({ jobId, stage: text, step });
      const rec = jobs.get(jobId);
      if (text) rec.stage = text;
      if (step && rec.steps) {
        const i = rec.steps.findIndex((s) => s.key === step);
        if (i >= 0) rec.idx = i;
      }
      show(rec);
    },

    /** Finish a job. The HUD fades only once the LAST active job is done.
     *  `failStep` marks a partial success (e.g. clip generated but the TikTok post
     *  failed — the job itself is still ok): that step settles red, the rest ✓. */
    done({ ok = true, label, jobId = "_", failStep } = {}) {
      const rec = jobs.get(jobId);
      jobs.delete(jobId);
      if (!els) return;
      if (jobs.size) {
        // Other jobs still running on this shared tab — keep going, show one of them.
        show([...jobs.values()].pop());
        renderTimer();
        return;
      }
      if (tick) { clearInterval(tick); tick = null; }
      els.row.className = "tb-statusrow " + (ok ? "ok" : "err");
      els.text.textContent = ok ? "เสร็จแล้ว" : "ไม่สำเร็จ";
      els.stage.textContent = label || (ok ? "เสร็จสมบูรณ์" : "เกิดข้อผิดพลาด");
      if (rec) {
        // settle the rail: success checks every step, failure reddens the active one,
        // a partial success (failStep) checks everything up to the failed step
        const failIdx =
          ok && failStep && rec.steps ? rec.steps.findIndex((s) => s.key === failStep) : -1;
        if (failIdx >= 0) {
          rec.idx = failIdx;
          rec.err = true;
        } else if (ok) rec.idx = (rec.steps || []).length;
        else rec.err = true;
        renderSteps(rec);
      }
      clearTimers();
      hideTimer = setTimeout(() => hud.hide(), FADE_OUT_MS);
    },

    /** Force the HUD away immediately and reset state. */
    hide() {
      clearTimers();
      if (tick) { clearInterval(tick); tick = null; }
      jobs.clear();
      if (els) els.back.classList.remove("tb-show");
      const h = host;
      setTimeout(() => { if (h && h.parentNode) h.remove(); if (host === h) { host = null; els = null; } }, 320);
    },
  };

  window.TB.hud = hud;

  // ---- app-driven path (Flow): background relays "hud" commands here --------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "hud") return;
    const { phase, jobId, title, subtitle, stage, ok, label, steps, step, failStep } = msg;
    if (phase === "start") hud.mount({ jobId, title, subtitle, stage, steps, step });
    else if (phase === "stage") hud.stage(stage, { jobId, step });
    else if (phase === "done") hud.done({ ok, label, jobId, failStep });
    else if (phase === "hide") hud.hide();
  });
})();
