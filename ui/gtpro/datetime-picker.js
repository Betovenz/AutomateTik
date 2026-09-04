// ── Custom date/time picker ──────────────────────────────────────────────────
// Replaces the native <input type="datetime-local"> popup (un-styleable OS chrome —
// the white WebView2 calendar) with a dark, amber-accented popover that matches the
// app theme, exactly like custom-select.js does for <select>. The real input stays in
// the DOM (visually hidden, .dtp-native) so app.js's `$("f-scheduleAt").value` reads,
// `postScheduleValue()`, and validation keep working untouched — we only ever write its
// `.value` (as "YYYY-MM-DDTHH:MM", naive local) and fire input/change.
//
// The whole field is one big clickable trigger (requirement: gด ตรงช่องได้เลย) with a
// prominent calendar icon. Selects rendered later into #genForm are auto-enhanced by a
// MutationObserver (the form rebuilds per mode).
(function () {
  "use strict";
  const FLAG = "data-dtp";
  let open = null; // the currently-open { dtp, native, panel, work, view } context
  let uid = 0; // unique-id counter for aria-labelledby wiring

  const MONTHS_FULL = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];
  const MONTHS_SHORT = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]; // Sunday-first

  const pad = (n) => String(n).padStart(2, "0");
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  // snap a minute to the nearest multiple of 5 (capped at 55 so it never rolls the hour) —
  // the operator wants post times to always land on :00/:05/:10…/:55.
  const snap5 = (m) => Math.min(55, Math.round(m / 5) * 5);

  // "YYYY-MM-DDTHH:MM" → {y,m,d,h,mi} (m is 0-based) or null when blank/malformed.
  function parseLocal(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] };
  }
  const fmtValue = (w) => `${w.y}-${pad(w.m + 1)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
  const fmtLabel = (w) => `${w.d} ${MONTHS_SHORT[w.m]} ${w.y} · ${pad(w.h)}:${pad(w.mi)}`;

  function nowParts() {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  }

  // true when the chosen day+time has already gone by (minute granularity). The calendar
  // already disables past *days*; this also catches "today, but an earlier time than now".
  function isPastSelection(w) {
    const sel = new Date(w.y, w.m, w.d, w.h, w.mi).getTime();
    const t = nowParts();
    const nowMin = new Date(t.y, t.m, t.d, t.h, t.mi).getTime();
    return sel < nowMin;
  }

  // earliest future time TODAY on the :05 grid (≥ now). null when now is in the last 5-min
  // block before midnight (no valid slot left today → operator must pick a later day).
  function earliestSlotToday() {
    const t = nowParts();
    let h = t.h;
    let mi = Math.ceil(t.mi / 5) * 5; // round UP to the next :05 so the slot is ≥ now
    if (mi > 55) { mi = 0; h += 1; }
    return h > 23 ? null : { h, mi };
  }

  // option-A guard: never sit in a past state. When the working day is today and its time has
  // slipped into the past, bump the time up to the earliest valid future :05 slot.
  function clampFutureTime() {
    if (!open || !isPastSelection(open.work)) return;
    const slot = earliestSlotToday();
    if (slot) { open.work.h = slot.h; open.work.mi = slot.mi; }
  }

  // would a single ▲/▼ step land the time in the past (today)? Used to both REJECT the step
  // and grey out the offending arrow.
  function stepWouldBePast(w, part, delta) {
    const cand = { ...w };
    if (part === "h") cand.h = (cand.h + delta + 24) % 24;
    else cand.mi = (cand.mi + delta + 60) % 60;
    return isPastSelection(cand);
  }

  function setStepDisabled(panel, sel, disabled) {
    const btn = panel.querySelector(sel);
    if (btn) { btn.disabled = disabled; btn.classList.toggle("is-disabled", disabled); }
  }

  // Reflect the committed native value on the trigger label (empty → placeholder).
  function syncTrigger(dtp, native) {
    const lbl = dtp.querySelector(".dtp-trigger-label");
    if (!lbl) return;
    const w = parseLocal(native.value);
    lbl.textContent = w ? fmtLabel(w) : "เลือกวันและเวลา";
    dtp.classList.toggle("is-empty", !w);
  }

  // ---- panel construction -----------------------------------------------------
  function buildPanel() {
    const panel = document.createElement("div");
    panel.className = "dtp-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "เลือกวันและเวลา");
    panel.innerHTML = `
      <div class="dtp-head">
        <button type="button" class="dtp-nav" data-dtp-prev aria-label="เดือนก่อนหน้า">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span class="dtp-title" data-dtp-title></span>
        <button type="button" class="dtp-nav" data-dtp-next aria-label="เดือนถัดไป">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="dtp-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="dtp-grid" data-dtp-grid></div>
      <div class="dtp-time">
        <span class="dtp-time-label">เวลา</span>
        <div class="dtp-spin">
          <button type="button" class="dtp-step" data-dtp-h-up aria-label="ชั่วโมง +">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
          </button>
          <input type="text" class="dtp-num" data-dtp-h inputmode="numeric" maxlength="2" aria-label="ชั่วโมง" />
          <button type="button" class="dtp-step" data-dtp-h-dn aria-label="ชั่วโมง −">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <span class="dtp-colon">:</span>
        <div class="dtp-spin">
          <button type="button" class="dtp-step" data-dtp-mi-up aria-label="นาที +">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
          </button>
          <input type="text" class="dtp-num" data-dtp-mi inputmode="numeric" maxlength="2" aria-label="นาที" />
          <button type="button" class="dtp-step" data-dtp-mi-dn aria-label="นาที −">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="dtp-actions">
        <button type="button" class="dtp-link" data-dtp-clear>ล้าง</button>
        <span class="dtp-actions-sp"></span>
        <button type="button" class="dtp-link" data-dtp-now>ตอนนี้</button>
        <button type="button" class="dtp-ok" data-dtp-ok>ตกลง</button>
      </div>`;
    return panel;
  }

  // (re)draw the month grid + title for the current view month, marking today + selection.
  function renderCalendar() {
    if (!open) return;
    const { panel, view, work } = open;
    panel.querySelector("[data-dtp-title]").textContent = `${MONTHS_FULL[view.m]} ${view.y}`;
    const grid = panel.querySelector("[data-dtp-grid]");
    const first = new Date(view.y, view.m, 1);
    const startDow = first.getDay(); // 0=Sun
    const start = new Date(view.y, view.m, 1 - startDow); // the Sunday on/before the 1st
    const today = nowParts();
    const todayMid = new Date(today.y, today.m, today.d).getTime(); // midnight today
    let html = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const inMonth = d.getMonth() === view.m;
      const isToday =
        d.getFullYear() === today.y && d.getMonth() === today.m && d.getDate() === today.d;
      const isSel =
        work.set &&
        d.getFullYear() === work.y && d.getMonth() === work.m && d.getDate() === work.d;
      // past days can't be scheduled on TikTok → disable them (today stays selectable)
      const isPast = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() < todayMid;
      const cls =
        "dtp-day" +
        (inMonth ? "" : " dtp-out") +
        (isPast ? " dtp-past" : "") +
        (isToday ? " dtp-today" : "") +
        (isSel ? " dtp-sel" : "");
      html += `<button type="button" class="${cls}"${isPast ? " disabled" : ""} data-dtp-day="${d.getFullYear()}-${d.getMonth()}-${d.getDate()}">${d.getDate()}</button>`;
    }
    grid.innerHTML = html;
  }

  function renderTime() {
    if (!open) return;
    const { panel, work } = open;
    panel.querySelector("[data-dtp-h]").value = pad(work.h);
    panel.querySelector("[data-dtp-mi]").value = pad(work.mi);
    // grey out a step arrow when that step would push the time into the past (today)
    setStepDisabled(panel, "[data-dtp-h-up]", stepWouldBePast(work, "h", 1));
    setStepDisabled(panel, "[data-dtp-h-dn]", stepWouldBePast(work, "h", -1));
    setStepDisabled(panel, "[data-dtp-mi-up]", stepWouldBePast(work, "mi", 5));
    setStepDisabled(panel, "[data-dtp-mi-dn]", stepWouldBePast(work, "mi", -5));
  }

  // ---- placement (fixed, body-appended — can't be clipped by the form scroller) ----
  function place() {
    if (!open) return;
    const { dtp, panel } = open;
    const r = dtp.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    panel.style.minWidth = Math.max(r.width, 268) + "px";
    const left = Math.max(8, Math.min(r.left, vw - panel.offsetWidth - 8));
    panel.style.left = left + "px";
    const below = vh - r.bottom;
    const need = panel.offsetHeight + 12;
    if (below < need && r.top > below) {
      panel.style.top = "auto";
      panel.style.bottom = vh - r.top + 6 + "px";
    } else {
      panel.style.bottom = "auto";
      panel.style.top = r.bottom + 6 + "px";
    }
  }

  // ---- open / close -----------------------------------------------------------
  function closePicker() {
    if (!open) return;
    open.dtp.classList.remove("is-open");
    open.dtp.querySelector(".dtp-trigger")?.setAttribute("aria-expanded", "false");
    open.panel.remove();
    open = null;
  }

  function openPicker(dtp, native) {
    closePicker();
    const seed = parseLocal(native.value) || nowParts();
    // working copy (edits are discarded unless committed via ตกลง). `set` tracks whether a
    // day has been chosen yet — an empty field opens with no day highlighted.
    const work = { ...seed, set: !!parseLocal(native.value) };
    work.mi = snap5(work.mi); // round the opening minute to a :05 step
    const view = { y: seed.y, m: seed.m };
    const panel = buildPanel();
    open = { dtp, native, panel, work, view };
    document.body.appendChild(panel);
    dtp.classList.add("is-open");
    dtp.querySelector(".dtp-trigger")?.setAttribute("aria-expanded", "true");
    clampFutureTime(); // don't open in a past state (option A) — bump today's time up if needed
    renderCalendar();
    renderTime();
    place();
  }

  // commit the working value to the native input + notify app.js
  function commit() {
    if (!open) return;
    const { native, work } = open;
    if (!work.set) {
      // no day chosen → treat ตกลง as "today at the shown time" for convenience
      const t = nowParts();
      work.y = t.y; work.m = t.m; work.d = t.d; work.set = true;
    }
    // a post can't be scheduled in the past — if the chosen date+time has already gone by,
    // warn and keep the picker open so the operator can pick a future time before committing.
    if (isPastSelection(work)) {
      const msg =
        "เวลาที่เลือกผ่านไปแล้ว ตั้งเวลาโพสต์ย้อนหลังไม่ได้\n\n" +
        "กรุณาเลือกวันและเวลาที่ยังมาไม่ถึง แล้วกดตกลงอีกครั้ง";
      // prefer the app's themed in-app popup; fall back to the native dialog only if app.js
      // hasn't exposed it. The picker stays open behind the alert (it sits above at z-1300,
      // and the dismiss handlers below skip clicks/Esc that land on a .modal-overlay).
      if (typeof window.alertDialog === "function") window.alertDialog(msg, { title: "ตั้งเวลาโพสต์ย้อนหลังไม่ได้" });
      else window.alert(msg);
      return;
    }
    native.value = fmtValue(work);
    native.dispatchEvent(new Event("input", { bubbles: true }));
    native.dispatchEvent(new Event("change", { bubbles: true }));
    const dtp = open.dtp;
    closePicker();
    syncTrigger(dtp, native);
  }

  function clearValue() {
    if (!open) return;
    const { native, dtp } = open;
    if (native.value) {
      native.value = "";
      native.dispatchEvent(new Event("input", { bubbles: true }));
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closePicker();
    syncTrigger(dtp, native);
  }

  function stepTime(part, delta) {
    if (!open) return;
    if (stepWouldBePast(open.work, part, delta)) return; // boundary — can't move into the past
    const w = open.work;
    if (part === "h") w.h = (w.h + delta + 24) % 24;
    else w.mi = (w.mi + delta + 60) % 60;
    renderTime();
  }

  // read a typed hour/minute box, clamp into range; revert to the last good value if blank
  function readNum(input, part) {
    if (!open) return;
    const w = open.work;
    const raw = input.value.replace(/\D/g, "");
    if (raw === "") return; // mid-edit — wait for blur
    const n = clamp(parseInt(raw, 10), 0, part === "h" ? 23 : 59);
    const cand = { ...w };
    if (part === "h") cand.h = n;
    else cand.mi = snap5(n); // a typed minute rounds to the nearest :05
    if (isPastSelection(cand)) return; // a past time (today) is rejected; blur restores the box
    w.h = cand.h;
    w.mi = cand.mi;
  }

  // ---- per-panel event wiring (delegated on the panel root) -------------------
  function wirePanel(panel) {
    panel.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("[data-dtp-prev]")) { shiftMonth(-1); return; }
      if (t.closest("[data-dtp-next]")) { shiftMonth(1); return; }
      if (t.closest("[data-dtp-h-up]")) { stepTime("h", 1); return; }
      if (t.closest("[data-dtp-h-dn]")) { stepTime("h", -1); return; }
      if (t.closest("[data-dtp-mi-up]")) { stepTime("mi", 5); return; }
      if (t.closest("[data-dtp-mi-dn]")) { stepTime("mi", -5); return; }
      if (t.closest("[data-dtp-now]")) { setNow(); return; }
      if (t.closest("[data-dtp-clear]")) { clearValue(); return; }
      if (t.closest("[data-dtp-ok]")) { commit(); return; }
      const day = t.closest("[data-dtp-day]");
      if (day) { pickDay(day.dataset.dtpDay); return; }
    });
    panel.addEventListener("input", (e) => {
      if (e.target.matches("[data-dtp-h]")) readNum(e.target, "h");
      else if (e.target.matches("[data-dtp-mi]")) readNum(e.target, "mi");
    });
    // normalise the box to a clamped 2-digit value when focus leaves it
    panel.addEventListener(
      "blur",
      (e) => {
        if (e.target.matches("[data-dtp-h], [data-dtp-mi]")) renderTime();
      },
      true
    );
  }

  function shiftMonth(delta) {
    if (!open) return;
    const v = open.view;
    const d = new Date(v.y, v.m + delta, 1);
    v.y = d.getFullYear();
    v.m = d.getMonth();
    renderCalendar();
    place();
  }

  function pickDay(key) {
    if (!open) return;
    const [y, m, d] = key.split("-").map(Number);
    const w = open.work;
    w.y = y; w.m = m; w.d = d; w.set = true;
    // keep the view on the month that owns the chosen day (clicking an out-of-month day)
    open.view.y = y; open.view.m = m;
    clampFutureTime(); // picking today with a past time bumps it up to the earliest slot
    renderCalendar();
    renderTime(); // reflect any clamp + refresh the step-arrow disabled states
  }

  function setNow() {
    if (!open) return;
    const t = nowParts();
    Object.assign(open.work, t, { set: true });
    open.work.mi = snap5(open.work.mi); // keep minutes on a :05 step
    clampFutureTime(); // "ตอนนี้" may snap below now (e.g. 20:16→20:15) → bump to the next slot
    open.view.y = t.y; open.view.m = t.m;
    renderCalendar();
    renderTime();
  }

  // ---- enhance a native <input type="datetime-local"> -------------------------
  function enhance(native) {
    if (!native || native.getAttribute(FLAG) === "1") return;
    native.setAttribute(FLAG, "1");

    const dtp = document.createElement("div");
    dtp.className = "dtp";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dtp-trigger";
    trigger.innerHTML =
      '<span class="dtp-ico" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.4"/>' +
      '<path d="M3 9h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13h3v3h-3z" fill="currentColor" stroke="none"/></svg></span>' +
      '<span class="dtp-trigger-label"></span>' +
      '<span class="dtp-chevron" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';

    native.parentNode.insertBefore(dtp, native);
    dtp.appendChild(trigger);
    dtp.appendChild(native);
    native.classList.add("dtp-native");
    // the real input is now only a value store — keep it out of the tab order and the
    // a11y tree so it isn't a phantom 1px tab stop next to the themed trigger.
    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");

    // a11y: the trigger is the real control — name it from the field's visible label PLUS
    // its own value text, and announce that it opens a dialog popover.
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    const labelIds = [];
    const fieldLabel = native.closest(".field")?.querySelector("label");
    if (fieldLabel) {
      if (!fieldLabel.id) fieldLabel.id = `dtp-lbl-${++uid}`;
      labelIds.push(fieldLabel.id);
    }
    const valEl = trigger.querySelector(".dtp-trigger-label");
    if (valEl) {
      valEl.id = `dtp-val-${++uid}`;
      labelIds.push(valEl.id);
    }
    if (labelIds.length) trigger.setAttribute("aria-labelledby", labelIds.join(" "));

    trigger.addEventListener("click", (e) => {
      // NOTE: deliberately NOT stopPropagation — letting the click bubble lets the
      // custom-select.js document handler dismiss any open <select> popover (the two
      // popover systems don't know about each other). The reverse direction (this picker
      // closing on a custom-select trigger click) is handled by the capture-phase
      // document listener below, which fires before custom-select's stopPropagation.
      e.preventDefault();
      if (dtp.classList.contains("is-open")) closePicker();
      else if (!native.disabled) {
        openPicker(dtp, native);
        wirePanel(open.panel);
      }
    });
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        trigger.click();
      }
    });
    // re-sync if app.js ever sets the value programmatically (form reset on re-render)
    native.addEventListener("change", () => syncTrigger(dtp, native));
    syncTrigger(dtp, native);
  }

  const enhanceAll = (root) =>
    (root || document).querySelectorAll('input.dt-input, input[type="datetime-local"]').forEach(enhance);

  // ---- global dismissal (mirrors custom-select.js) ----------------------------
  // CAPTURE phase: fires before any bubble-phase stopPropagation, so clicking an open
  // custom-select trigger (which stops propagation) still dismisses this picker.
  document.addEventListener(
    "click",
    (e) => {
      // keep the picker open while an in-app modal (e.g. the past-time alert) is up — a click
      // dismissing that modal lands outside the panel and would otherwise close the picker.
      if (
        open &&
        !open.dtp.contains(e.target) &&
        !open.panel.contains(e.target) &&
        !e.target.closest?.(".modal-overlay")
      )
        closePicker();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    // while an in-app modal (the past-time alert) is open, Esc dismisses IT, not the picker
    if (e.key === "Escape" && open && !document.querySelector(".modal-overlay")) closePicker();
  });
  // close on background scroll (the fixed panel would float away), but NOT when the scroll
  // happens inside the panel itself.
  window.addEventListener(
    "scroll",
    (e) => {
      if (open && open.panel && open.panel.contains(e.target)) return;
      if (open) closePicker();
    },
    true
  );
  window.addEventListener("resize", closePicker);

  function boot() {
    enhanceAll(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input.dt-input, input[type="datetime-local"]')) enhance(n);
          else if (n.querySelectorAll) enhanceAll(n);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
