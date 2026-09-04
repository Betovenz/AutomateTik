// ── Custom dropdown ───────────────────────────────────────────────────────────
// Replaces the native <select> popup with a dark rounded popover (matching the
// trippleviral web). The real <select> stays in the DOM (visually hidden), so all
// of app.js's `.value` reads, `change` listeners, and dynamic option rebuilding
// keep working untouched. Selects rendered later (per-mode into #genForm, etc.)
// are auto-enhanced by a MutationObserver. The tiny dense table selects
// (.dir-sel / .dir-col-select, anything inside .jobs-grid) are left native.
(function () {
  "use strict";
  const FLAG = "data-cs";
  let openCs = null;

  const labelOf = (sel) => {
    const o = sel.options[sel.selectedIndex];
    return o ? o.textContent.trim() : "";
  };

  function syncTrigger(sel, cs) {
    const lbl = cs.querySelector(".cs-trigger-label");
    if (lbl) lbl.textContent = labelOf(sel) || "—";
    cs.classList.toggle("is-empty", !sel.value);
    cs.classList.toggle("is-disabled", sel.disabled);
  }

  function buildPanel(sel, cs) {
    const panel = document.createElement("div");
    panel.className = "cs-panel";
    panel.setAttribute("role", "listbox");
    const makeOpt = (opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        "cs-opt" + (opt.selected ? " is-selected" : "") + (opt.disabled ? " is-disabled" : "");
      b.textContent = opt.textContent.trim();
      if (opt.disabled) b.disabled = true;
      b.addEventListener("click", () => {
        if (opt.disabled) return;
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closePanel();
        syncTrigger(sel, cs);
      });
      return b;
    };
    Array.from(sel.children).forEach((child) => {
      if (child.tagName === "OPTGROUP") {
        const g = document.createElement("div");
        g.className = "cs-group";
        g.textContent = child.label;
        panel.appendChild(g);
        Array.from(child.children).forEach((o) => panel.appendChild(makeOpt(o)));
      } else if (child.tagName === "OPTION") {
        panel.appendChild(makeOpt(child));
      }
    });
    return panel;
  }

  // The panel is fixed-position (appended to <body>) so overflow containers
  // (tables, modals, scroll areas) can't clip it. Opens downward, or upward when
  // there isn't room below.
  function place(cs) {
    const panel = cs._panel;
    if (!panel) return;
    const r = cs.getBoundingClientRect();
    const vh = window.innerHeight;
    panel.style.minWidth = r.width + "px";
    const left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8));
    panel.style.left = left + "px";
    const below = vh - r.bottom;
    if (below < 220 && r.top > below) {
      panel.style.top = "auto";
      panel.style.bottom = vh - r.top + 6 + "px";
      panel.style.maxHeight = Math.min(320, r.top - 16) + "px";
    } else {
      panel.style.bottom = "auto";
      panel.style.top = r.bottom + 6 + "px";
      panel.style.maxHeight = Math.min(320, below - 16) + "px";
    }
  }

  function closePanel() {
    if (!openCs) return;
    openCs.classList.remove("is-open");
    if (openCs._panel) {
      openCs._panel.remove();
      openCs._panel = null;
    }
    openCs = null;
  }

  function openPanel(cs, sel) {
    closePanel();
    const panel = buildPanel(sel, cs);
    cs._panel = panel;
    document.body.appendChild(panel);
    cs.classList.add("is-open");
    openCs = cs;
    place(cs);
    const s = panel.querySelector(".cs-opt.is-selected");
    if (s) s.scrollIntoView({ block: "nearest" });
  }

  function enhance(sel) {
    if (!sel || sel.getAttribute(FLAG) === "1") return;
    if (sel.matches(".dir-sel, .dir-col-select") || sel.closest(".jobs-grid")) return;
    sel.setAttribute(FLAG, "1");

    const cs = document.createElement("div");
    cs.className = "cs";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "cs-trigger";
    trigger.innerHTML =
      '<span class="cs-trigger-label"></span>' +
      '<span class="cs-chevron" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';

    sel.parentNode.insertBefore(cs, sel);
    cs.appendChild(trigger);
    cs.appendChild(sel);
    sel.classList.add("cs-native");

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (cs.classList.contains("is-open")) closePanel();
      else if (!sel.disabled) openPanel(cs, sel);
    });
    // re-sync the visible label when app.js mutates the select (value set silently,
    // options rebuilt, disabled toggled)
    cs.addEventListener("mouseenter", () => syncTrigger(sel, cs));
    sel.addEventListener("change", () => syncTrigger(sel, cs));
    new MutationObserver(() => {
      if (openCs === cs) closePanel();
      syncTrigger(sel, cs);
    }).observe(sel, { childList: true, attributes: true, attributeFilter: ["disabled"] });

    syncTrigger(sel, cs);
  }

  const enhanceAll = (root) => (root || document).querySelectorAll("select").forEach(enhance);

  document.addEventListener("click", (e) => {
    if (
      openCs &&
      !openCs.contains(e.target) &&
      !(openCs._panel && openCs._panel.contains(e.target))
    )
      closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
  // Close on background/page scroll (the fixed panel would otherwise float away
  // from its trigger). But a scroll that originates INSIDE the open panel is the
  // user scrolling a tall option list — don't close on that.
  window.addEventListener(
    "scroll",
    (e) => {
      if (openCs && openCs._panel && openCs._panel.contains(e.target)) return;
      closePanel();
    },
    true
  );
  window.addEventListener("resize", () => closePanel());

  function boot() {
    enhanceAll(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.tagName === "SELECT") enhance(n);
          else if (n.querySelectorAll) n.querySelectorAll("select").forEach(enhance);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
