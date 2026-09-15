// Content script: uploads media to TikTok Studio and (optionally) pins a
// TikTok Shop product to the post ("ปักตะกร้าสินค้า").
//
// Selectors are best-effort — verify against the live TikTok Studio upload page
// and update SEL. The product-tagging flow in particular changes often.

(function () {
  // Verified against tiktok.com/tiktokstudio/upload (post-upload editor). The
  // file input is in the TOP document (no iframe). Caption is a Draft.js editor.
  const SEL = {
    fileInput: 'input[type="file"]',
    // Caption editor (verified): Draft.js content div.
    caption:
      '.public-DraftEditor-content, div[contenteditable="true"][data-e2e*="caption" i], div[contenteditable="true"]',
    // Post button (verified): data-testid="post_video_button".
    postButton: 'button[data-testid="post_video_button"], button[data-e2e="post_video_button"]',
    // "Add product links" modal search box (EN + TH placeholders). PRODUCT-ANCHORED arms
    // ONLY — NO bare 'search'/'ค้นหา' arm: 'ค้นหา' (Thai "search") is a substring of the
    // location box placeholder 'ค้นหาตำแหน่งที่ตั้ง', which is visible on the page and precedes
    // the modal box in DOM order, so a bare arm makes querySelector return the LOCATION box
    // and types the id there. 'ค้นหาสินค้า'/'สินค้า'/'product' never match the location box.
    // attachProduct prefers the modal-scoped modalSearchInput() over this anyway.
    productSearch:
      'input[placeholder*="search product" i], input[placeholder*="product" i],'
      + ' input[placeholder*="ค้นหาสินค้า" i], input[placeholder*="สินค้า" i]',
  };

  // Random human-like pause before each EXECUTED post-flow step (caption → product →
  // toggles → Post). TikTok throttles sessions that fire actions back-to-back. Mirrors
  // the server-side path (cdp_publish.py, _step_delay / POST_STEP_DELAY_*).
  const STEP_DELAY_MIN_MS = 4000;
  const STEP_DELAY_MAX_MS = 7500;
  const stepDelay = () =>
    TB.sleep(STEP_DELAY_MIN_MS + Math.random() * (STEP_DELAY_MAX_MS - STEP_DELAY_MIN_MS));

  // TikTok's Draft.js caption editor has a hashtag plugin that re-scans "#..." tokens and
  // DUPLICATES the trailing hashtag run on a programmatic insert (the body, carrying no
  // "#", is left untouched). Type the caption, then collapse any consecutive repeat of
  // that run. Mirrors the server-side path (cdp_publish.py _caption_js / _caption_hashtag_run).
  const hashtagRun = (full) => {
    const m = (full || "").match(/(?:^|\s)(#[^\s#]+(?:\s+#[^\s#]+)*)\s*$/);
    return m ? m[1] : "";
  };
  const collapseHashtagRun = (text, run) => {
    if (!run) return text;
    const i = text.indexOf(run);
    if (i === -1) return text;
    const head = text.slice(0, i + run.length);
    let tail = text.slice(i + run.length);
    for (;;) {
      const t = tail.replace(/^\s+/, "");
      if (t.slice(0, run.length) === run) tail = t.slice(run.length);
      else break;
    }
    return head + tail;
  };
  // Collapse a duplicated trailing hashtag run to ONE copy of each tag (first-seen order),
  // separator-agnostic — handles "#a #b #a #b", the jammed "#a #b#a #b", and NBSP/zero-width
  // boundaries, plus the same tag sitting in BOTH the caption body and the appended list.
  // Done at COMPOSE time so the caption we type is already single-copy; mirrors the
  // server-side dedupe_caption_hashtags (cdp_publish.py). Returns `full` unchanged when the
  // trailing run has no repeat.
  const TAG_SEP = "\\s\\u00a0\\u200b-\\u200d\\ufeff";
  const TRAILING_TAG_BLOCK_RE = new RegExp(
    "(?:^|[" + TAG_SEP + "])(#[^#" + TAG_SEP + "]+(?:[" + TAG_SEP + "]*#[^#" + TAG_SEP + "]+)*)[" + TAG_SEP + "]*$"
  );
  const TAG_TOKEN_RE = new RegExp("#[^#" + TAG_SEP + "]+", "g");
  const dedupeCaptionHashtags = (full) => {
    if (!full || full.indexOf("#") === -1) return full;
    const m = full.match(TRAILING_TAG_BLOCK_RE);
    if (!m) return full;
    const tokens = m[1].match(TAG_TOKEN_RE) || [];
    const seen = new Set();
    const unique = [];
    for (const tok of tokens) {
      const key = tok.slice(1).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(tok);
      }
    }
    if (unique.length === tokens.length) return full; // no repeat — keep exact formatting
    const body = full.slice(0, m.index).replace(new RegExp("[" + TAG_SEP + "]+$"), "");
    const tagStr = unique.join(" ");
    return body ? body + " " + tagStr : tagStr;
  };
  // Type a caption and undo any hashtag-run duplication. Returns the editor's final text.
  async function setCaption(el, full) {
    TB.typeContentEditable(el, full);
    const run = hashtagRun(full);
    let got = el.innerText || el.textContent || "";
    // TikTok's hashtag plugin re-scans the trailing run and DUPLICATES it a beat LATER
    // (ASYNC) — a single dedupe ran before the double landed and missed it (LIVE-VERIFIED a
    // Thai caption posted "…#a #b#a #b"). Poll & collapse for ~2s so the late double is
    // caught. Rewrite collapsed WITHOUT a synthetic input event (the extra dispatch is what
    // re-triggers the plugin); execCommand fires its own native input.
    if (run) {
      for (let k = 0; k < 8; k++) {
        await TB.sleep(250);
        got = el.innerText || el.textContent || "";
        const fixed = collapseHashtagRun(got, run);
        if (fixed !== got) {
          el.focus();
          try {
            document.execCommand("selectAll", false, null);
            document.execCommand("insertText", false, fixed);
          } catch (_) {}
        }
      }
      got = el.innerText || el.textContent || "";
    } else {
      await TB.sleep(150);
      got = el.innerText || el.textContent || "";
    }
    return got;
  }

  async function publish({ jobId, mediaUrl, caption, hashtags, productId, productCta, autoPost, finalize, scheduleAt, settings }) {
    const report = (stage, message, progress) => {
      if (TB.hud) TB.hud.stage(message, { jobId }); // mirror progress onto the on-page HUD
      TB.report(jobId, stage, message, progress);
    };

    report("fetch", "กำลังดึงไฟล์สื่อที่สร้างไว้…", 0.15);
    const ext = guessExt(mediaUrl);
    const file = await TB.fetchAsFile(mediaUrl, `autogt-pro-${Date.now()}.${ext}`);

    report("upload", "กำลังแนบไฟล์ลง TikTok…", 0.35);
    const input = await TB.waitFor(SEL.fileInput, { visible: false });
    TB.setFileInput(input, file);
    await TB.sleep(1500); // let the upload preview initialise
    // VERIFY TikTok actually ingested the clip — setFileInput is a synthetic event a
    // React app can ignore, and a stalled/flagged session leaves the dropzone spinning
    // forever. The editor (Post button / <video> preview) only renders once the clip is
    // accepted; if it never does, report a REAL failure so the job's publish status reads
    // FAILED (not a fake "prepared") and the row offers "↻ โพสต์ใหม่". Mirrors the
    // server-side CDP path's _wait_upload_accepted (120s). [[tiktok-publish-upload-stall]]
    if (!(await waitForUploadAccepted(120000))) {
      return {
        ok: false,
        error: "TikTok ค้างที่การอัปโหลดคลิป (ยังไม่ขึ้นหน้าโพสต์) — เช็คเน็ต/บัญชี แล้วลองใหม่",
      };
    }

    await stepDelay();
    report("caption", "กำลังเขียนแคปชั่น…", 0.55);
    const fullCaption = dedupeCaptionHashtags(
      [caption, (hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")]
        .filter(Boolean)
        .join(" ")
    );
    const captionEl = await TB.waitForAny([
      ".public-DraftEditor-content",
      'div[contenteditable="true"][data-e2e*="caption" i]',
      'div[contenteditable="true"]',
    ]);
    if (fullCaption) {
      // setCaption types it AND collapses the hashtag-run TikTok's editor tends to double.
      const capGot = (await setCaption(captionEl, fullCaption)).trim();
      // Draft.js can ignore synthetic input — flag (non-fatal) so the operator
      // can fix the caption before posting.
      if (!capGot.includes(fullCaption.slice(0, Math.min(10, fullCaption.length)))) {
        report("caption", "⚠ แคปชั่นอาจไม่ติด (Draft.js) — ตรวจก่อนโพสต์", 0.56);
      }
    }

    let productNote = null;
    if (productId) {
      await stepDelay();
      report("product", `กำลังปักสินค้า ${productId}…`, 0.75);
      try {
        await attachProduct(productId, productCta);
      } catch (e) {
        // Product tagging isn't wired yet — degrade to a non-fatal skip so the
        // prepared upload (file + caption) isn't reported as a failed job.
        productNote = `product tag skipped (${e?.message || e})`;
        report("product", productNote, 0.78);
      }
    }

    // "Setting TikTok" toggles: AI-generated label + content disclosure. Best-effort
    // (a selector drift is a non-fatal skip), and MUST run before Post.
    if (settings && (settings.aiLabel || settings.disclose)) {
      await stepDelay();
      report("settings", "กำลังตั้งค่าโพสต์ TikTok…", 0.85);
      try {
        await applyDisclosure(settings);
      } catch (e) {
        report("settings", `⚠ toggles skipped (${e?.message || e})`, 0.86);
      }
    }

    // FINALIZE (opt-in): post / post-private / Save draft / Schedule once the clip is
    // ready (it must finish processing first). Best-effort — a miss leaves the upload
    // prepared so it can still be finished by hand. `finalize` ("" = stage only) supersedes
    // the legacy autoPost flag (kept for older app builds).
    const action = finalize || (autoPost ? "post" : "");
    let posted = false;
    let drafted = false;
    let scheduled = false;
    if (action === "draft") {
      await stepDelay();
      report("draft", "กำลังบันทึกฉบับร่าง…", 0.9);
      drafted = await saveDraft(90000);
      if (!drafted) report("draft", "⚠ บันทึกฉบับร่างไม่สำเร็จ — ทำเองในหน้าต่าง", 0.92);
    } else if (action === "schedule") {
      await stepDelay();
      report("schedule", "กำลังตั้งเวลาโพสต์…", 0.9);
      scheduled = await setSchedule(scheduleAt, 90000);
      if (!scheduled) report("schedule", "⚠ ตั้งเวลาโพสต์ไม่สำเร็จ — ทำเองในหน้าต่าง", 0.92);
    } else if (action) {
      // post (public) or private — set "Only you" first, then click Post.
      let blocked = false;
      if (action === "private") {
        await stepDelay();
        report("privacy", "กำลังตั้งค่าเป็นส่วนตัว (เฉพาะฉัน)…", 0.88);
        // FAIL-SAFE: default visibility is "Everyone", so if "Only you" can't be set we must
        // NOT post — a public post is worse than no post. Abort, leave the upload prepared.
        if (!(await setPrivacyOnlyMe())) {
          blocked = true;
          report("privacy", "⛔ ตั้งส่วนตัวไม่สำเร็จ — ไม่โพสต์ (กันโพสต์เป็นสาธารณะ) ทำเองในหน้าต่าง", 0.9);
        }
      }
      if (!blocked) {
        await stepDelay();
        report("post", "กำลังกดโพสต์…", 0.9);
        const post = await waitForEnabledPost(90000);
        if (post) {
          TB.click(post);
          await clickPostConfirm(); // "Post now"/"Post anyway"/Thai/structural-primary confirm
          // VERIFY the post actually went out before claiming success — mirrors the server path
          // (_do_post gates posted on leaving /upload). Setting posted=true unconditionally
          // SILENTLY logged un-posted clips as "โพสต์ลง TikTok แล้ว" when the confirm couldn't be
          // matched (esp. in Thai). [[tiktok-thai-audit-2026-06-18]]
          posted = await verifyPublished(15000);
          if (!posted) {
            report("post", "⚠ กด Post แล้วแต่ยืนยันการโพสต์ไม่ได้ — เช็คในหน้า Posts แล้วกดเอง", 0.92);
          }
        } else {
          report("post", "⚠ ปุ่ม Post ยังไม่พร้อม — ตรวจแล้วกด Post เอง", 0.92);
        }
      }
    }

    const done = posted || drafted || scheduled;
    const doneMsg = drafted
      ? "บันทึกฉบับร่างแล้ว"
      : scheduled
        ? "ตั้งเวลาโพสต์แล้ว"
        : posted
          ? "โพสต์ลง TikTok แล้ว"
          : "อัปโหลดพร้อมแล้ว — ตรวจแล้วทำขั้นตอนสุดท้าย";
    report(done ? "done" : "ready", doneMsg, 1);
    const base = drafted
      ? "saved to drafts"
      : scheduled
        ? "scheduled"
        : posted
          ? "posted to TikTok"
          : "upload prepared — review & finish";
    const note = productNote ? `${base}; ${productNote}` : base;
    return { ok: true, posted, drafted, scheduled, note };
  }

  // The Post button exists once the clip is accepted but only ENABLES after the clip
  // finishes processing — poll for the verified selector becoming clickable.
  async function waitForEnabledPost(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const btn = document.querySelector(SEL.postButton);
      if (btn && TB.isVisible(btn) && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        return btn;
      }
      await TB.sleep(400);
    }
    return null;
  }

  // After clicking Post, TikTok may pop a "Continue to post?" copyright confirm. Click its
  // confirm button so the post goes out. Match known EN/TH labels first; if none match but a
  // confirm DIALOG is present, click its PRIMARY (non-Cancel/secondary) button so an unknown
  // Thai label still works. Never clicks Cancel. (The Thai confirm strings were never captured
  // live — the confirm only renders AFTER clicking Post — so the structural fallback is the real
  // safety net; added "โพสต์ทันที"/bare "โพสต์". [[tiktok-thai-audit-2026-06-18]])
  async function clickPostConfirm() {
    const CONFIRM = /^(post now|post anyway|post|โพสต์เลย|โพสต์ตอนนี้|โพสต์ทันที|โพสต์)$/i;
    const cd = Date.now() + 8000;
    while (Date.now() < cd) {
      const byText = [...document.querySelectorAll('button,[role="button"]')].find(
        (b) => TB.isVisible(b) && CONFIRM.test((b.innerText || b.textContent || "").trim())
      );
      if (byText) {
        TB.click(byText);
        return true;
      }
      // STRUCTURAL fallback: a visible confirm dialog's PRIMARY (non-Cancel/secondary) button.
      const modal = [...document.querySelectorAll('[role="dialog"],[class*="TUXModal" i]')].find((m) =>
        TB.isVisible(m)
      );
      if (modal) {
        const prim = [...modal.querySelectorAll('button,[role="button"]')].filter(
          (b) =>
            TB.isVisible(b) &&
            !b.disabled &&
            b.getAttribute("aria-disabled") !== "true" &&
            !/secondary|cancel|ghost|back|dismiss/i.test(b.className || "") &&
            !/^cancel$|ยกเลิก|แก้ไข|กลับ/i.test((b.innerText || b.textContent || "").trim())
        );
        const hit = prim.find((b) => /primary/i.test(b.className || "")) || prim[prim.length - 1];
        if (hit) {
          TB.click(hit);
          return true;
        }
      }
      await TB.sleep(300);
    }
    return false;
  }

  // VERIFY a post actually published — mirrors the server _POST_JS check: TikTok leaves
  // /upload, the Post button disappears, or a published toast shows. Without this the extension
  // claimed posted:true even when the confirm modal was never matched/clicked.
  async function verifyPublished(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!/\/upload\b/.test(location.pathname)) return true;
      if (!document.querySelector(SEL.postButton)) return true;
      const toast = [...document.querySelectorAll("*")].some(
        (e) =>
          e.children.length < 3 &&
          /video (has been )?(published|posted)|โพสต์.*สำเร็จ|เผยแพร่.*สำเร็จ/i.test(e.textContent || "")
      );
      if (toast) return true;
      await TB.sleep(500);
    }
    return false;
  }

  // ---- finalize actions: private / draft / schedule ---------------------------
  // Mirror the server-side CDP finalize JS (cdp_publish.py). LIVE-VERIFICATION PENDING:
  // TikTok Studio's privacy select / Save-draft button / schedule pickers are matched
  // structurally (label + text), no stable data-e2e confirmed — best-effort, a miss leaves
  // the upload open to finish by hand.
  const shortLeaf = (re, maxLen) =>
    [...document.querySelectorAll('span,label,p,div,button,[role="option"],li')].find((el) => {
      const t = (el.textContent || "").trim();
      return el.children.length === 0 && t && re.test(t) && TB.isVisible(el) && (!maxLen || t.length <= maxLen);
    }) || null;

  // Set "Who can watch this video" to "Only you" (the PRIVATE mode). True when verified.
  // LIVE-VERIFIED 2026-06-18: trigger `.Select__trigger`, options `.Select__item`; the
  // private choice is labelled **"Only you"** (NOT "only me"); options matched on 1st line.
  async function setPrivacyOnlyMe() {
    // LIVE-VERIFIED Thai UI 2026-06-18: "Only you" = "เฉพาะคุณเท่านั้น" (NOT "เฉพาะฉัน"!),
    // "Who can see this post" = "ใครสามารถเห็นโพสต์นี้".
    const ONLY = /^(only you|only me|private|เฉพาะคุณเท่านั้น|เฉพาะคุณ|เฉพาะฉัน|ส่วนตัว)$/i;
    const WHO = /who can (watch|see) this|ใครสามารถ(ดู|เห็น)|ใครเห็นโพสต์|ใครดูวิดีโอ/i;
    const firstLine = (el) => ((el.textContent || "").trim().split("\n")[0] || "").trim();
    const findOption = () =>
      [...document.querySelectorAll('.Select__item,[role="option"],[class*="select-option" i]')].find(
        (o) => TB.isVisible(o) && ONLY.test(firstLine(o))
      ) || null;
    let combo = null;
    const lbl = shortLeaf(WHO, 60);
    if (lbl) {
      let p = lbl.parentElement;
      for (let hops = 0; p && hops < 5 && !combo; hops++) {
        combo = p.querySelector('.Select__trigger,[role="combobox"]');
        p = p.parentElement;
      }
    }
    let opt = findOption();
    if (!opt && combo) {
      TB.click(combo);
      await TB.sleep(700);
      opt = findOption();
    }
    if (!opt) return false;
    TB.click(opt);
    await TB.sleep(600);
    // Can't verify the value without the combo → return false so the fail-safe aborts the post
    // (a public post is worse than no post). In practice the combo IS found (LIVE 2026-06-18:
    // WHO label "ใครสามารถเห็นโพสต์นี้"). [[tiktok-thai-audit-2026-06-18]]
    return combo ? ONLY.test(firstLine(combo)) : false; // re-read THIS combo's value
  }

  // Click Save draft and verify it saved. LIVE-VERIFIED 2026-06-18:
  // button[data-e2e="save_draft_button"]; clicking it while the copyright check runs opens a
  // "Save draft?" confirm whose primary button is **"Save anyway"** — must click it.
  async function saveDraft(timeout) {
    const DRAFT = /^\s*(save draft|drafts?|save to drafts|บันทึกฉบับร่าง|บันทึกแบบร่าง|บันทึกร่าง|ฉบับร่าง)\s*$/i;
    const CONFIRM = /save anyway|save draft|\bsave\b|post anyway|confirm|^ok$|got it|บันทึก|ตกลง|ยืนยัน/i;
    const findBtn = () => {
      const b = document.querySelector('button[data-e2e="save_draft_button"]');
      if (b && TB.isVisible(b) && !b.disabled) return b;
      return (
        [...document.querySelectorAll('button,[role="button"]')].find(
          (x) => TB.isVisible(x) && !x.disabled && DRAFT.test((x.innerText || x.textContent || "").trim())
        ) || null
      );
    };
    const deadline = Date.now() + timeout;
    let btn = null;
    while (Date.now() < deadline) {
      btn = findBtn();
      if (btn) break;
      await TB.sleep(400);
    }
    if (!btn) return false;
    TB.click(btn);
    let confirmed = false;
    const cd = Date.now() + 7000; // click "Save anyway" if the copyright confirm appears
    while (Date.now() < cd && !confirmed) {
      const modal = document.querySelector('[role="dialog"],[class*="TUXModal" i]');
      if (modal && TB.isVisible(modal)) {
        const b = [...modal.querySelectorAll('button,[role="button"]')].find((x) => {
          const t = (x.innerText || x.textContent || "").trim();
          return CONFIRM.test(t) && !/cancel|ยกเลิก/i.test(t);
        });
        if (b) {
          TB.click(b);
          confirmed = true;
        }
      }
      if (!confirmed) await TB.sleep(300);
    }
    const pd = Date.now() + 12000;
    while (Date.now() < pd) {
      if (!/\/upload\b/.test(location.pathname)) return true;
      if (!document.querySelector('button[data-e2e="save_draft_button"]') && !document.querySelector(SEL.postButton))
        return true; // editor closed → saved
      const toast = [...document.querySelectorAll("*")].some(
        (e) =>
          e.children.length < 3 &&
          /saved to drafts|draft saved|บันทึก.*ร่าง.*สำเร็จ|บันทึกฉบับร่างแล้ว/i.test(e.textContent || "")
      );
      if (toast) return true;
      await TB.sleep(500);
    }
    return false;
  }

  // Drive the SCHEDULE pickers. LIVE-VERIFIED 2026-06-18: the date + time inputs are
  // READ-ONLY click-to-open widgets (can't be typed). Order: tick Schedule radio →
  // time picker (hour col 00-23, minute col in steps of 5) → calendar (.calendar-wrapper,
  // navigate the two .arrow, click span.day) → Schedule button + confirm ("Post anyway").
  async function setSchedule(scheduleAt, timeout) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/.exec((scheduleAt || "").trim());
    if (!m) return false;
    // Snap the minute UP to TikTok's 5-minute step (00,05,…,55) — CEIL, never round-down, so the
    // scheduled time stays >= the requested time (mirrors the server _split_schedule_at). The old
    // Math.round could round DOWN into the PAST, and the hour-only carry broke the 23:5x → next-day
    // rollover (it kept the same day). Build a Date so day/month/year carry correctly.
    // [[tiktok-thai-audit-2026-06-18]]
    const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const rem = dt.getMinutes() % 5;
    if (rem) dt.setMinutes(dt.getMinutes() + (5 - rem));
    const ty = dt.getFullYear(), tm = dt.getMonth() + 1, td = dt.getDate();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
      // Thai month names (full + ม.ค. abbreviations) for a Thai-UI calendar header
      "มกราคม":1,"กุมภาพันธ์":2,"มีนาคม":3,"เมษายน":4,"พฤษภาคม":5,"มิถุนายน":6,"กรกฎาคม":7,"สิงหาคม":8,"กันยายน":9,"ตุลาคม":10,"พฤศจิกายน":11,"ธันวาคม":12,
      "ม.ค.":1,"ก.พ.":2,"มี.ค.":3,"เม.ย.":4,"พ.ค.":5,"มิ.ย.":6,"ก.ค.":7,"ส.ค.":8,"ก.ย.":9,"ต.ค.":10,"พ.ย.":11,"ธ.ค.":12 };
    const optText = (it) => {
      const t = it.querySelector(".tiktok-timepicker-option-text");
      return ((t ? t.textContent : it.textContent) || "").trim();
    };
    const timeCols = () => {
      const items = [...document.querySelectorAll(".tiktok-timepicker-option-item")].filter((i) => TB.isVisible(i));
      const groups = {};
      items.forEach((it) => {
        const k = Math.round(it.getBoundingClientRect().left / 8) * 8;
        (groups[k] = groups[k] || []).push(it);
      });
      return Object.keys(groups).map(Number).sort((a, b) => a - b).map((k) => groups[k]);
    };
    // TikTok's time picker is locale-dependent: 24h (hour 00-23) or 12h (hour 1-12 + an
    // AM/PM column — content list then shows "5:45 PM"). Classify columns by content + match
    // by NUMERIC value; the old exact-string "19" match silently failed on a 12h picker.
    const isAmPmText = (t) => /^(a\.?m\.?|p\.?m\.?)$/i.test((t || "").replace(/\s/g, "")) || /เที่ยง|บ่าย|เย็น|เช้า/.test(t || "");
    const classifyCols = () => {
      const info = timeCols().map((col) => {
        const texts = col.map(optText);
        const nums = texts.map((t) => parseInt(t, 10));
        const allNum = nums.length > 0 && nums.every((n) => !isNaN(n));
        return { col, texts, allNum, allMult5: allNum && nums.every((n) => n % 5 === 0), isAmPm: texts.some(isAmPmText) };
      });
      let ampm = null, minute = null, hour = null;
      info.forEach((c) => {
        if (c.isAmPm) { if (!ampm) ampm = c; }
        else if (c.allNum && c.allMult5) { if (!minute) minute = c; }   // 00,05,…,55
        else if (c.allNum) { if (!hour) hour = c; }                     // 0-23 or 1-12
      });
      if (!hour && info[0] && !info[0].isAmPm) hour = info[0];
      if (!minute) { for (let i = 0; i < info.length; i++) { if (info[i] !== hour && !info[i].isAmPm) { minute = info[i]; break; } } }
      return { info, hour, minute, ampm };
    };
    // Realistic tap: a bare click scrolls a time-picker option into view but doesn't SELECT it
    // (TikTok's wheel picker listens on pointer/mouse-down, unlike the calendar's span.day).
    const tap = (el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
      ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        try { el.dispatchEvent(new PointerEvent(type, o)); }
        catch (e) { el.dispatchEvent(new MouseEvent(type.replace("pointer", "mouse"), o)); }
      });
    };
    const pickNum = (col, n) => {
      if (!col) return false;
      const it = col.find((c) => parseInt(optText(c), 10) === n);
      if (it) { it.scrollIntoView({ block: "center" }); tap(it); return true; }
      return false;
    };
    const pickAmPm = (col, want) => {
      if (!col) return false;
      const it = col.find((c) => {
        const raw = optText(c), t = raw.replace(/[\s.]/g, "").toUpperCase();
        const isPm = t === "PM" || /หลัง|บ่าย|เย็น/.test(raw), isAm = t === "AM" || /ก่อน|เช้า/.test(raw);
        return (want === "PM" && isPm) || (want === "AM" && isAm);
      });
      if (it) { it.scrollIntoView({ block: "center" }); tap(it); return true; }
      return false;
    };
    const openInput = (re) => {
      const inp = [...document.querySelectorAll("input")].filter((i) => TB.isVisible(i)).find((i) => re.test(i.value || ""));
      if (inp) TB.click(inp.closest('[class*="TUXTextInput" i]') || inp);
      return inp || null;
    };
    const calHeader = () => {
      const w = document.querySelector(".calendar-wrapper");
      return w ? (w.textContent || "").trim().split("\n")[0] || "" : "";
    };
    const parseHeader = (h) => {
      // Header "June / 2026" (EN) or "มิถุนายน / 2026" (TH). Match Thai chars + an optional
      // slash; convert a Buddhist year (>=2500) back to Gregorian (live TikTok used 2026).
      const x = h.match(/([A-Za-z฀-๿.]+)\s*\/?\s*(\d{4})/);
      if (!x) return null;
      let y = +x[2];
      if (y >= 2500) y -= 543;
      return { mon: MONTHS[x[1].toLowerCase()] || MONTHS[x[1]] || 0, year: y };
    };
    const calArrows = () => [...document.querySelectorAll(".calendar-wrapper .arrow")].filter((a) => TB.isVisible(a));
    const clickDay = (d) => {
      const days = [...document.querySelectorAll(".calendar-wrapper span.day")].filter(
        (x) => TB.isVisible(x) && (x.textContent || "").trim() === String(d)
      );
      const cell = days.find((x) => !/disabled|gray|grey|other|outside|not-current|inactive/i.test(x.className || "")) || days[0];
      if (cell) {
        TB.click(cell);
        return true;
      }
      return false;
    };
    // 1) tick Schedule
    const radio = document.querySelector('input[name="postSchedule"][value="schedule"]');
    const radioBox = radio ? radio.closest("label") || radio : null;
    if (radioBox) { TB.click(radioBox); await TB.sleep(900); }
    // 1b) accept the one-time "Allow your video to be saved for scheduled posting?" consent modal
    // if TikTok shows it — the date/time pickers stay blocked behind it until dismissed. Mirrors
    // the CDP _SCHEDULE_JS helper. [[tiktok-schedule-allow-consent]]
    const btnText = (b) => (b.innerText || b.textContent || "").trim();
    const isCancelText = (t) => /^(cancel|ยกเลิก|ปิด|close|not now|ภายหลัง)$/i.test(t);
    // NARROW = the literal Allow label (safe page-wide, the consent button itself is exactly this).
    // BROAD adds generic accept/confirm aliases (incl. the ตกลง/เปิด/ยืนยัน TikTok uses on other
    // confirm modals) — trusted ONLY inside a confirmed modal where over-match is harmless.
    const isAllowNarrow = (t) => /^(allow|อนุญาต)$/i.test(t);
    const isAllowBroad = (t) => /^(allow|อนุญาต|ยินยอม|ยอมรับ|ตกลง|ดำเนินการต่อ|continue|เปิด|เปิดใช้งาน|turn on|ยืนยัน|confirm|ok|got it)$/i.test(t);
    const visBtns = (scope) => [...scope.querySelectorAll('button,[role="button"]')].filter((b) => TB.isVisible(b) && !b.disabled);
    const findConsentModal = () => {
      for (const d of document.querySelectorAll('[role="dialog"],[class*="modal" i],[class*="Modal" i],[class*="TUXModal" i]')) {
        if (TB.isVisible(d) && /scheduled posting|saved for|ตั้งเวลา|บันทึก.*วิดีโอ|วิดีโอ.*บันทึก|allow.*sav|sav.*schedul|อนุญาต/i.test(d.textContent || "")) return d;
      }
      return null;
    };
    const clickScheduleAllow = () => {
      const modal = findConsentModal();
      if (modal) {
        const mbtns = visBtns(modal);
        const named = mbtns.find((b) => isAllowBroad(btnText(b)));
        if (named) { TB.click(named); return true; }
        // 2-button [Cancel][Affirmative] dialog: click the one that isn't Cancel. Restrict to
        // exactly two labelled buttons so a 3rd option / "Learn more" link can't be hit.
        const labelled = mbtns.filter((b) => btnText(b));
        if (labelled.length === 2) {
          const ci = isCancelText(btnText(labelled[0])) ? 0 : (isCancelText(btnText(labelled[1])) ? 1 : -1);
          if (ci !== -1) { TB.click(labelled[1 - ci]); return true; }
        }
        return false;
      }
      // No consent modal detected → page-wide, NARROW label only (a missing modal can't trip a
      // generic accept/OK button elsewhere on the page).
      const hit = visBtns(document).find((b) => isAllowNarrow(btnText(b)));
      if (hit) { TB.click(hit); return true; }
      return false;
    };
    const dateInputPresent = () => [...document.querySelectorAll("input")].filter((i) => TB.isVisible(i)).some((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.value || ""));
    let allowClicked = false;
    // Poll up to ~2s, but break the instant the date input is present (consent already granted →
    // no modal, no added delay on the common path).
    for (let ca = 0; ca < 8; ca++) {
      if (clickScheduleAllow()) { allowClicked = true; break; }
      if (dateInputPresent()) break;
      await TB.sleep(250);
    }
    // After consent TikTok REMOUNTS the schedule panel — wait for the date input to render before
    // the date step. A fixed sleep can be too short → null input → steps skipped → schedule lost.
    if (allowClicked) { for (let dw = 0; dw < 14 && !dateInputPresent(); dw++) await TB.sleep(250); }
    const H = dt.getHours(), M = dt.getMinutes(), targetMin = H * 60 + M;
    // Close a picker by clicking OUTSIDE it (re-click the Schedule radio, a no-op when already
    // selected). NEVER press Escape — it REVERTS TikTok's time selection (looked set but the
    // time stayed at TikTok's default). [[tiktok-schedule-time-12h-24h]]
    const commit = () => { if (radioBox) TB.click(radioBox); else document.body.click(); };
    const readTimeMinutes = () => {
      for (const inp of [...document.querySelectorAll("input")].filter((i) => TB.isVisible(i))) {
        const x = (inp.value || "").trim().match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?$/i);
        if (x) { let h = +x[1]; const mi = +x[2]; const ap = (x[3] || "").toLowerCase().replace(/[\s.]/g, ""); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; return h * 60 + mi; }
      }
      return -1;
    };
    // 2) DATE FIRST — picking a date can reset the time on TikTok, so set it before the time
    if (openInput(/^\d{4}-\d{2}-\d{2}$/)) {
      await TB.sleep(700);
      for (let n = 0; n < 18; n++) {
        const ph = parseHeader(calHeader());
        if (!ph) break;
        if (ph.year === ty && ph.mon === tm) break;
        const arrows = calArrows();
        const goNext = ph.year < ty || (ph.year === ty && ph.mon < tm);
        const a = goNext ? arrows[arrows.length - 1] : arrows[0];
        if (!a) break;
        TB.click(a);
        await TB.sleep(450);
      }
      clickDay(td);
      await TB.sleep(400);
      commit();
      await TB.sleep(400);
    }
    // 3) TIME — TikTok's time picker is a hidden-overflow WHEEL that only commits its value from
    // real WheelEvents (click / scrollTop / drag / swipe / keys / typing ALL fail — verified live
    // via CDP). NUDGE each column with WheelEvent(deltaY ±120) one step at a time, reading the
    // input back after each, until it matches. Pure JS, works 12h + 24h. [[tiktok-schedule-time-12h-24h]]
    let timeVerified = false;
    if (openInput(/^\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?$/i)) {
      await TB.sleep(700);
      const cols2 = [...document.querySelectorAll(".tiktok-timepicker-time-scroll-container")];
      const hasOpt = (c, want) => [...c.querySelectorAll(".tiktok-timepicker-option-item")].some((it) => optText(it) === want);
      const ampmC = cols2.find((c) => [...c.querySelectorAll(".tiktok-timepicker-option-item")].some((it) => isAmPmText(optText(it))));
      const minC = cols2.find((c) => c !== ampmC && hasOpt(c, "55"));
      const hourC = cols2.find((c) => c !== ampmC && c !== minC);
      const nudge = async (container, getCur, target) => {
        if (!container) return false;
        for (let k = 0; k < 80; k++) {
          const cur = getCur();
          if (cur === target) return true;
          container.dispatchEvent(new WheelEvent("wheel", { deltaY: cur < target ? 120 : -120, bubbles: true, cancelable: true }));
          await TB.sleep(130);
        }
        return getCur() === target;
      };
      if (ampmC) await nudge(ampmC, () => { const v = readTimeMinutes(); return v < 0 ? -1 : (v >= 720 ? 1 : 0); }, H >= 12 ? 1 : 0);
      await nudge(hourC, () => { const v = readTimeMinutes(); return v < 0 ? -1 : Math.floor(v / 60); }, H);
      await nudge(minC, () => { const v = readTimeMinutes(); return v < 0 ? -1 : (v % 60); }, M);
      await TB.sleep(250);
      timeVerified = readTimeMinutes() === targetMin;
      commit();
      await TB.sleep(400);
    }
    // GATE: don't finalize a wrong time — leave it for manual (caller warns "ตั้งเวลาไม่สำเร็จ")
    if (!timeVerified) return false;
    // 4) Schedule button + confirm
    const post = await waitForEnabledPost(timeout); // now labelled "Schedule"
    if (!post) return false;
    TB.click(post);
    const cd = Date.now() + 8000;
    while (Date.now() < cd) {
      // a deferred "saved for scheduled posting" consent can also surface at this final click —
      // accept it too (best-effort) so the confirm step doesn't stall on an unrecognised modal.
      if (clickScheduleAllow()) await TB.sleep(500);
      const pn = [...document.querySelectorAll('button,[role="button"]')].find(
        (b) =>
          TB.isVisible(b) &&
          /^(schedule|schedule anyway|post anyway|confirm|กำหนดเวลา|ยืนยัน)$/i.test((b.innerText || b.textContent || "").trim())
      );
      if (pn) {
        TB.click(pn);
        break;
      }
      await TB.sleep(300);
    }
    const pd = Date.now() + 12000;
    while (Date.now() < pd) {
      if (!/\/upload\b/.test(location.pathname)) return true;
      if (!document.querySelector(SEL.postButton)) return true;
      const toast = [...document.querySelectorAll("*")].some(
        (e) => e.children.length < 3 && /scheduled|กำหนดเวลา.*สำเร็จ|ตั้งเวลา.*สำเร็จ/i.test(e.textContent || "")
      );
      if (toast) return true;
      await TB.sleep(500);
    }
    return false;
  }

  // ---- "Setting TikTok" disclosure toggles -----------------------------------
  // Flip the AI-generated label and/or "Disclose post content" (+ Your brand /
  // Branded content). Selectors LIVE-VERIFIED against TikTok Studio (2026-06): expand
  // the "Show more" advanced section, then flip the switches by their stable data-e2e
  // containers (aigc_container / disclose_content_container). Your brand / Branded
  // content are checkboxes that render only after Disclose is on. Best-effort.
  const isOn = (el) => {
    if (!el) return false;
    const a = el.getAttribute && el.getAttribute("aria-checked");
    if (a != null) return a === "true";
    const ds = el.getAttribute && el.getAttribute("data-state");
    if (ds != null) return ds === "checked";
    if (el.type === "checkbox") return !!el.checked;
    return /--checked-true|is-checked|is-active/i.test(el.className || "");
  };
  // Prefer the VISIBLE match — TikTok keeps stale copies of the options form in the DOM.
  const pickVisible = (sel) =>
    [...document.querySelectorAll(sel)].find((el) => TB.isVisible(el)) ||
    document.querySelector(sel);
  const leafWith = (re) =>
    [...document.querySelectorAll("span,label,p,div")].find(
      (el) => el.children.length === 0 && el.textContent && re.test(el.textContent) && TB.isVisible(el)
    ) || null;
  // The clickable part of a TUX switch is .Switch__content (it carries aria-checked).
  const switchIn = (c) => (c ? c.querySelector('.Switch__content,[role="switch"]') : null);

  async function enableSwitch(sw) {
    if (!sw) return false;
    if (isOn(sw)) return true;
    TB.click(sw);
    await TB.sleep(500);
    const modal = pickVisible('[class*="TUXModal"],[class*="tux-modal"],[role="dialog"]');
    if (modal && TB.isVisible(modal)) {
      const btn = [...modal.querySelectorAll('button,[role="button"]')].find((b) => {
        const t = (b.innerText || b.textContent || "").trim();
        return /turn on|confirm|^ok$|got it|เปิด|ตกลง|ยืนยัน/i.test(t) && !/cancel|ยกเลิก/i.test(t);
      });
      if (btn) {
        TB.click(btn);
        await TB.sleep(300);
      }
    }
    return true;
  }

  // Your brand / Branded content checkbox: anchor the text so "Branded content" doesn't
  // match the "Branded Content Policy" disclaimer below it.
  async function tickBox(re) {
    const lbl = leafWith(re);
    if (!lbl) return false;
    const row = lbl.closest(".title-line") || lbl.parentElement || lbl;
    let box = row.querySelector('input[type="checkbox"]') || row.querySelector("label.Checkbox__root");
    if (!box) return false;
    if (!isOn(box)) {
      TB.click(box);
      await TB.sleep(300);
    }
    // re-query (React may swap the node) and VERIFY it's actually checked now
    box = row.querySelector('input[type="checkbox"]') || row.querySelector("label.Checkbox__root") || box;
    return isOn(box);
  }

  async function applyDisclosure({ aiLabel, disclose, yourBrand, brandedContent }) {
    if (aiLabel || disclose) {
      if (!pickVisible('div[data-e2e="aigc_container"]')) {
        const adv = document.querySelector('div[data-e2e="advanced_settings_container"]');
        let btn = adv ? adv.querySelector(".more-btn") : null;
        if (!btn) {
          const lbl = leafWith(/show more|more options|แสดงเพิ่มเติม|ตัวเลือกเพิ่มเติม/i);
          btn = lbl ? lbl.closest(".more-btn") || lbl.closest('button,[role="button"],div,span') || lbl : null;
        }
        if (btn) {
          TB.click(btn);
          await TB.sleep(700);
        }
      }
    }
    if (disclose) {
      let dc = pickVisible('div[data-e2e="disclose_content_container"]');
      if (!dc) {
        const dl = leafWith(/disclose (?:post )?content|เผยแพร่เนื้อหาโพสต์|เปิดเผยเนื้อหา/i);
        dc = dl ? dl.closest('div[class*="container"]') || dl.parentElement : null;
      }
      await enableSwitch(switchIn(dc));
      await TB.sleep(400); // Your brand / Branded content render after Disclose turns on
      // TikTok REQUIRES at least one of Your brand / Branded content once Disclose is ON
      // (else a red "You need to indicate…" error blocks Post). Default to Your brand when
      // neither was chosen.
      if (yourBrand || !brandedContent) await tickBox(/^\s*your brand\s*$|^\s*แบรนด์ของคุณ\s*$/i);
      if (brandedContent) await tickBox(/^\s*branded content\s*$|เนื้อหาที่กล่าวถึงแบรนด์|ได้รับการสนับสนุน/i);
    }
    if (aiLabel) {
      let ac = pickVisible('div[data-e2e="aigc_container"]');
      if (!ac) {
        const al = leafWith(/^\s*ai-generated content\s*$|สร้าง.{0,6}ai/i);
        ac = al ? al.closest('div[class*="container"]') || al.parentElement : null;
      }
      await enableSwitch(switchIn(ac));
    }
  }

  // STRUCTURAL (language-INDEPENDENT) modal helpers for the product flow — mirror the
  // server-side cdp_publish.py. They resolve the modal's PRIMARY action (Next/Add) and
  // the search box WITHOUT depending on a localized label, so the flow works in ANY
  // TikTok UI language (the EN/TH regex is only a soft hint).
  // The product modal's BODY (search box / radios / name field) = the dialog ANCESTOR of the
  // visible footer. A bare [class*="modal"] grabs the FOOTER ("common-modal-footer") which
  // holds none of the body (CONFIRMED live via tiktok_dom_probe.js).
  const topModal = () => {
    const foot = [...document.querySelectorAll('[class*="modal-footer" i]')].filter((f) => TB.isVisible(f)).pop();
    if (foot) {
      let p = foot.parentElement;
      for (let i = 0; p && i < 10; i++, p = p.parentElement) {
        if (
          (p.getAttribute && p.getAttribute("role") === "dialog") ||
          (/dialog|modal/i.test(p.className || "") && !/footer/i.test(p.className || ""))
        )
          return p;
      }
      return foot.parentElement || foot;
    }
    return (
      [...document.querySelectorAll('[role="dialog"],[class*="TUXModal" i],[class*="modal" i]')]
        .filter((m) => TB.isVisible(m) && !/footer|header/i.test(m.className || ""))
        .pop() || null
    );
  };
  // The footer's primary action: the *primary*-classed button, else the LAST enabled NON-
  // Cancel button — never falls back to Cancel/Back (CONFIRMED live: Cancel=TUXButton--
  // secondary, action=TUXButton--primary). `hint` only disambiguates when several remain.
  const footerPrimary = (hint) => {
    const foots = [...document.querySelectorAll('[class*="modal-footer" i]')].filter((f) => TB.isVisible(f));
    for (let i = foots.length - 1; i >= 0; i--) {
      const bs = [...foots[i].querySelectorAll('button,[role="button"]')].filter(
        (b) =>
          TB.isVisible(b) &&
          !b.disabled &&
          b.getAttribute("aria-disabled") !== "true" &&
          !/secondary|cancel|ghost|back|dismiss/i.test(b.className || "")
      );
      if (!bs.length) continue;
      if (hint) {
        const h = bs.filter((b) =>
          hint.test(`${b.innerText || b.textContent || ""} ${b.getAttribute("aria-label") || ""}`)
        );
        if (h.length) return h[h.length - 1];
      }
      const prim = bs.filter((b) => /primary/i.test(b.className || ""));
      if (prim.length) return prim[prim.length - 1];
      return bs[bs.length - 1];
    }
    return null;
  };
  // Structural footer-primary first, else a global text match on the hint.
  async function waitAction(hint, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const b = footerPrimary(hint) || (hint ? TB.findButton(hint) : null);
      if (b) return b;
      await TB.sleep(250);
    }
    return null;
  }
  const modalSearchInput = () => {
    const m = topModal();
    if (!m) return null;
    return (
      [...m.querySelectorAll(
        'input[class*="TUXTextInputCore-input" i],input[type="search"],input[type="text"]'
      )].find((el) => TB.isVisible(el)) || null
    );
  };
  // Force the "Showcase products" (EN) / "นำเสนอสินค้า" (TH) tab before searching. The Add-
  // product-links ("เพิ่มลิงก์สินค้า") modal can open on another source tab; the id only
  // filters the showcase list when this tab is active (else the row is never found). LIVE-
  // VERIFIED DOM (2026-06-17): TikTok renders the tabs as `button.TUXTabBar-itemTitle` inside
  // a `.TUXTabBar` (active = `--active`) — NO `[role="tab"]`.
  const SHOWCASE_TAB_RE = /showcase|นำเสนอสินค้า|นำเสนอ/i;
  // Lift a matched node to its clickable tab ancestor (a <button>, role=tab/button, or a
  // tab-classed container) so the synthetic click lands on the real hit area, not an inner
  // <span> that doesn't switch the tab. Mirrors cdp_publish.py clickableTab.
  const clickableTab = (el) => {
    let p = el;
    for (let hops = 0; p && hops < 6; hops++, p = p.parentElement) {
      const role = p.getAttribute && p.getAttribute("role");
      if (
        p.tagName === "BUTTON" ||
        role === "tab" ||
        role === "button" ||
        /tabbar-item|tab-item|\btab\b/i.test(p.className || "")
      )
        return p;
    }
    return el;
  };
  // The Showcase tab. Match tab-SPECIFIC classes only — NOT a bare [class*="tab" i], which also
  // matches "table" (a live probe showed it dragging in the product TABLE, header cells and the
  // pagination). Shortest matching text = the tab label; prefer a <button>, else lift to the
  // clickable ancestor. FALLBACK for plain-<div> tabs (no tab class): the shortest SHORT-text
  // element whose text matches the showcase label, lifted. Mirrors cdp_publish.py showcaseBtn.
  const showcaseTabBtn = (m) => {
    const bs = [
      ...m.querySelectorAll(
        '[role="tab"], button[class*="TUXTabBar-item" i], [class*="TabBar-item" i], [class*="TUXTabBar" i]'
      ),
    ]
      .filter((t) => TB.isVisible(t) && SHOWCASE_TAB_RE.test(t.textContent || ""))
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
    const btn = bs.find((t) => t.tagName === "BUTTON");
    if (btn) return btn;
    if (bs.length) return clickableTab(bs[0]);
    const cands = [...m.querySelectorAll("button,a,div,span,li")]
      .filter(
        (t) =>
          TB.isVisible(t) &&
          SHOWCASE_TAB_RE.test(t.textContent || "") &&
          (t.textContent || "").trim().length < 40
      )
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
    return cands.length ? clickableTab(cands[0]) : null;
  };
  // CONTENT-based readiness: the showcase product list is up when visible radio rows exist in
  // the modal (the account HAS the product we're tagging, so rows appear once Showcase is the
  // active panel). This is the GROUND TRUTH — the tab's 'active' CLASS flickers on/off during
  // the React re-render, so confirming the switch by class was nondeterministic (the flaky
  // "บางครั้งกดติด บางครั้งไม่กด" bug).
  const showcasePanelReady = () => {
    const m = topModal();
    if (!m) return false;
    return [...m.querySelectorAll('input[type="radio"]')].some((r) => TB.isVisible(r));
  };
  // A heavier synthetic click sequence (pointer + mouse down/up + click) — TikTok's React is more
  // likely to honour this than a bare click(). The extension has NO trusted CDP click (only the
  // server cdp_publish.py path does), so this is the strongest switch it can perform.
  const forceTabClick = (el) => {
    try {
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const Ctor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, o));
      }
    } catch (e) {
      TB.click(el);
    }
  };
  // Switch to the Showcase tab and VERIFY by CONTENT, retrying. Re-pick the modal/button FRESH
  // each iteration (after "Next", topModal briefly returns the OLD link-type modal mid-swap → a
  // captured ref goes STALE). Mirrors cdp_publish.py's deterministic switch within the no-CDP
  // limit: we can only synthetic-click, but we ALWAYS click the tab (operator: "กด Showcase
  // ก่อนทุกครั้ง"), confirm by product rows (NOT the flaky 'active' class), and re-click until
  // they appear. Returns whether the showcase list became visible (caller proceeds either way).
  // The source-tab strip selector (My shop / Showcase). hasTabStrip() tells a single-panel
  // account (nothing to switch) apart from a multi-tab account (Showcase MUST be clicked).
  const TAB_SEL =
    '[role="tab"], button[class*="TUXTabBar-item" i], [class*="TabBar-item" i], [class*="TUXTabBar" i]';
  const tabIsActive = (el) =>
    /--active|is-active|(^|[^-])\bactive\b/i.test(el.className || "") ||
    el.getAttribute("aria-selected") === "true";
  const tabStrip = (m) => (m ? [...m.querySelectorAll(TAB_SEL)].filter((t) => TB.isVisible(t)) : []);
  // Locate the Showcase tab: label match first; else (2-tab modal) the NON-active tab IS Showcase
  // (My shop is the default-active tab) — a structural fallback so a label-match miss (timing /
  // language / markup drift) still resolves a target instead of silently skipping the click.
  const locateShowcaseTab = () => {
    const m = topModal();
    if (!m) return null;
    let btn = showcaseTabBtn(m);
    if (!btn) {
      const tabs = tabStrip(m);
      const inactive = tabs.filter((t) => !tabIsActive(t));
      if (tabs.length === 2 && inactive.length === 1) btn = clickableTab(inactive[0]);
    }
    return btn;
  };
  // Switch to the Showcase tab and VERIFY by CONTENT, retrying. Re-locate the button FRESH each
  // iteration (after "Next", topModal briefly returns the OLD link-type modal mid-swap → a captured
  // ref goes STALE). Mirrors cdp_publish.py's deterministic switch within the no-CDP limit: we can
  // only synthetic-click, but we ALWAYS click the tab (operator: "กด Showcase ก่อนทุกครั้ง"),
  // confirm by product rows (NOT the flaky 'active' class), and re-click until they appear.
  // Returns a tri-state: "ready" (rows up), "no-tabs" (single-panel — nothing to click), or
  // "unverified" (clicked but rows never confirmed). The caller gates the search on this.
  async function clickShowcaseTab() {
    let btn = null;
    const dlB = Date.now() + 9000;
    while (Date.now() < dlB && !btn) {
      btn = locateShowcaseTab();
      if (!btn && showcasePanelReady()) break; // list already up (showcase-only) → no tab to click
      if (!btn) await TB.sleep(200);
    }
    if (!btn) {
      // No locatable Showcase tab. If there's no source-tab strip at all it's a single-panel
      // account (legit no-op); if a strip exists but we couldn't resolve it, report unverified so
      // the caller doesn't silently treat the current (possibly My-shop) tab as Showcase.
      return tabStrip(topModal()).length > 0 ? "unverified" : "no-tabs";
    }
    for (let i = 0; i < 5; i++) {
      const fresh = locateShowcaseTab() || btn;
      try { fresh.scrollIntoView({ block: "center" }); } catch (e) {}
      forceTabClick(fresh);
      for (let j = 0; j < 6; j++) {
        await TB.sleep(400); // poll ~2.4s for the showcase list to mount after the click
        if (showcasePanelReady()) return "ready";
      }
    }
    return showcasePanelReady() ? "ready" : "unverified";
  }
  // The "+ Add" product-link OPENER, found STRUCTURALLY via its stable container
  // (CONFIRMED live: div[data-e2e="anchor_container"]) — language-independent; EN/TH text
  // is only a fallback if the container is absent.
  const openAddBtn = () => {
    const anchor = document.querySelector('div[data-e2e="anchor_container"]');
    if (anchor) {
      const bs = [...anchor.querySelectorAll('button,[role="button"]')].filter(
        (b) => TB.isVisible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true"
      );
      if (bs.length) {
        const hit = bs.filter((b) => /add|เพิ่ม/i.test(b.innerText || b.textContent || ""));
        return (hit.length ? hit : bs).pop();
      }
    }
    return TB.findButton(/^[\s+]*add(\s+links?)?\s*$|^[\s+]*เพิ่ม\s*(ลิงก์|ลิงค์)?\s*$/i);
  };

  // Link-type step (Products vs Games): when the account has >1 link type, the "Add link"
  // modal opens with an UNSELECTED "Link type" dropdown ("Select"/"เลือก") and Next stays
  // DISABLED until a type is picked. Open it and choose "Products". No-op when Products is the
  // only/default type (Next already enabled). Best-effort, language-independent (mirrors
  // cdp_publish.py chooseLinkTypeProducts). NEEDS LIVE VERIFICATION against the dropdown DOM.
  const SELECT_PLACEHOLDER_RE = /^(select|เลือก)$/i;
  const PRODUCTS_OPTION_RE = /^(products?|สินค้า)$/i;
  const linkTypeTrigger = (m) =>
    m
      ? [...m.querySelectorAll("*")].find(
          (el) =>
            el.children.length === 0 &&
            TB.isVisible(el) &&
            SELECT_PLACEHOLDER_RE.test((el.textContent || "").trim())
        ) || null
      : null;
  const openCombo = (leaf) => {
    let target = leaf;
    for (let p = leaf, hops = 0; p && hops < 6; p = p.parentElement, hops++) {
      if (
        p.getAttribute &&
        (p.getAttribute("role") === "combobox" ||
          p.getAttribute("aria-haspopup") ||
          /select|dropdown|combobox/i.test(p.className || ""))
      ) {
        target = p;
        break;
      }
    }
    TB.click(target);
  };
  const productsOption = () => {
    const opts = [
      ...document.querySelectorAll(
        '[role="option"],li,[class*="option" i],[class*="Option" i],[class*="item" i]'
      ),
    ].filter((el) => {
      const t = (el.textContent || "").trim();
      return TB.isVisible(el) && t.length < 30 && PRODUCTS_OPTION_RE.test(t) && !/game|เกม/i.test(t);
    });
    return opts.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0] || null;
  };
  // Ensure the link type is Products before advancing. Best-effort; never throws.
  async function chooseLinkTypeProducts() {
    // Wait for the "Add link" modal to mount (Cancel is its always-enabled marker).
    const md = Date.now() + 6000;
    while (Date.now() < md) {
      if (TB.findButton(/^\s*cancel\s*$|^\s*ยกเลิก\s*$/i)) break;
      await TB.sleep(150);
    }
    const deadline = Date.now() + 9000;
    let opened = false;
    while (Date.now() < deadline) {
      // Next enabled ⇒ a link type is set (Products preselected, or we just chose it).
      if (footerPrimary(/^\s*next\s*$|^\s*ถัดไป\s*$/i)) return;
      const m = topModal();
      if (!opened) {
        const leaf = m ? linkTypeTrigger(m) : null;
        if (leaf) {
          openCombo(leaf);
          opened = true;
          await TB.sleep(450);
          continue;
        }
      } else {
        const opt = productsOption();
        if (opt) {
          TB.click(opt);
          await TB.sleep(550);
          continue;
        }
      }
      await TB.sleep(250);
    }
  }

  // Structural product-modal helpers mirroring the server (cdp_publish.py _PRODUCT_SELECT_JS):
  // detect the search→name transition + fill the CTA WITHOUT a localized label.
  const modalHasVisibleRadios = () => {
    const m = topModal();
    return m ? [...m.querySelectorAll('input[type="radio"]')].some((r) => TB.isVisible(r)) : false;
  };
  // The "Product name" (CTA) field = the visible non-search text input in the modal once the
  // product list (radios) is gone. Skip any input whose placeholder mentions search/product so
  // the CTA never lands in the search box. (LIVE 2026-06-18: the real name field's placeholder
  // is EMPTY — the product name is pre-filled as a value — so this skip is safe.)
  const findModalNameInput = () => {
    const m = topModal();
    if (!m || modalHasVisibleRadios()) return null;
    for (const el of [...m.querySelectorAll('input[class*="TUXTextInputCore-input" i],input[type="text"]')]) {
      if (!TB.isVisible(el)) continue;
      const ph = (el.getAttribute("placeholder") || "").toLowerCase();
      if (ph.includes("search") || ph.includes("product") || ph.includes("ค้นหา") || ph.includes("สินค้า")) continue;
      return el;
    }
    return null;
  };
  const productModalGone = () => {
    if (modalHasVisibleRadios() || findModalNameInput()) return false;
    const box = modalSearchInput();
    return !(box && TB.isVisible(box));
  };
  // Set a React-controlled input's value via the native setter (a plain .value= is dropped by
  // React) — mirrors the server setInput.
  const setNativeValue = (el, val) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Add-product flow, verified against the live modals (Add link → Products →
  // Add product links). Buttons/steps are matched STRUCTURALLY (language-independent);
  // best-effort, wrapped in publish()'s try/catch — a failure SKIPS, never posts.
  async function attachProduct(productId, cta) {
    const id = String(productId);
    // 1) "+ Add" under the Add-link section (a PAGE button, not in a modal → EN "Add" /
    //    TH "เพิ่ม"/"เพิ่มลิงก์"; this is the one spot still keyed on a label).
    const addBtn = openAddBtn();
    if (!addBtn) throw new Error("Add-link button not found");
    TB.click(addBtn);

    // 1.5) Some accounts expose >1 link type → the modal forces choosing one (Products vs
    //      Games) before Next enables. Pick Products. No-op when it's the only/default type.
    await chooseLinkTypeProducts();

    // 2) Link-type modal → advance with the modal's PRIMARY action (Next) — STRUCTURAL.
    const next1 = await waitAction(/^\s*next\s*$|^\s*ถัดไป\s*$/i, 8000);
    if (!next1) throw new Error("Add-link Next not found");
    TB.click(next1);
    await TB.sleep(400); // let the link-type modal begin swapping to "Add product links"

    // 2.5) Land on the "Showcase products"/"นำเสนอสินค้า" tab before searching — the modal can
    //      open on another source tab; the id only filters the showcase list when this tab is
    //      active. Now UNCONDITIONAL for any multi-tab modal (operator: กด Showcase ทุกครั้ง):
    //      clickShowcaseTab re-locates + clicks + content-verifies, with a structural inactive-tab
    //      fallback when the label match misses. Returns "ready" | "no-tabs" | "unverified" — we
    //      DON'T discard it (the old code did, so a missed switch silently searched My-shop).
    const showcaseState = await clickShowcaseTab();
    if (showcaseState === "unverified") {
      // Tabs exist but the Showcase list never confirmed within the retries. The click DID fire;
      // give the panel a final moment to settle before searching. The waitForProductRow guard
      // below still aborts on a wrong/empty tab, so this never silently posts against My-shop.
      await TB.sleep(800);
    }

    // 3) Add-product-links modal: find the search box STRUCTURALLY (modal-scoped via
    //    modalSearchInput) FIRST, the EN/TH placeholder selector only as a fallback. WHY:
    //    'ค้นหา'(search) matches stray PAGE search inputs and querySelector returns the first
    //    DOM match — in Thai UI that wrong box got the id typed into it, so the product list
    //    never filtered. Mirrors the server-side cdp_publish.py _PRODUCT_OPEN_JS fix.
    let search = null;
    const dl = Date.now() + 8000;
    while (Date.now() < dl && !search) {
      search = modalSearchInput() || document.querySelector(SEL.productSearch);
      if (search && !TB.isVisible(search)) search = null;
      if (!search) await TB.sleep(300);
    }
    if (!search) throw new Error("product search box not found");
    TB.type(search, id);
    await TB.sleep(1500); // let the results load

    // 4) Select the matching row's radio (walk UP to the ancestor row that actually holds the
    //    radio — the id text + the radio live in different cells, mirroring the server findRow),
    //    then advance with the PRIMARY action (Next / ถัดไป).
    const hitEl = await waitForProductRow(id);
    if (!hitEl) throw new Error(`product ${id} not in results`);
    let radio = null;
    for (let hop = hitEl, i = 0; hop && i < 10; hop = hop.parentElement, i++) {
      radio = hop.querySelector('input[type="radio"], input[class*="Radio" i], [role="radio"]');
      if (radio) break;
    }
    TB.click(radio || hitEl);
    await TB.sleep(300);
    const next2 = await waitAction(/^\s*next\s*$|^\s*ถัดไป\s*$/i, 8000);
    if (!next2) throw new Error("product Next (after radio) not found");
    if (next2.disabled || next2.getAttribute("aria-disabled") === "true") {
      throw new Error("product Next stayed disabled");
    }
    TB.click(next2);

    // 5) "Product name" (ชื่อสินค้า) step — detected STRUCTURALLY (radios gone + a non-search
    //    input in the modal), mirroring the LIVE-VERIFIED server flow (ถัดไป → name → เพิ่ม).
    //    Fill the Thai CTA, then click the PRIMARY "เพิ่ม" (Add). Without this the extension
    //    stopped after the first Next → the product was NEVER actually attached and the CTA was
    //    dropped (background.js now forwards productCta). [[tiktok-thai-audit-2026-06-18]]
    let nameInput = null;
    const dlN = Date.now() + 9000;
    while (Date.now() < dlN) {
      if (productModalGone()) return; // modal already closed = added
      nameInput = findModalNameInput();
      if (nameInput) break;
      await TB.sleep(250);
    }
    if (cta && nameInput) {
      setNativeValue(nameInput, String(cta).slice(0, 30));
      await TB.sleep(400);
    }
    const add = await waitAction(/^\s*add\s*$|^\s*เพิ่ม\s*$/i, nameInput ? 6000 : 9000);
    if (add) TB.click(add);
    else if (!productModalGone()) throw new Error("product Add (เพิ่ม) step not found");

    // 6) VERIFY the modal closed = product really attached (else surface a failure so the
    //    caller's note reflects it).
    await TB.sleep(1500);
    if (!productModalGone()) throw new Error("product modal still open after Add");
  }

  /** The smallest visible element whose text contains the product id (its row). */
  async function waitForProductRow(id, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hits = [...document.querySelectorAll('tr, [role="row"], li, div')].filter(
        (el) => el.textContent && el.textContent.includes(id) && TB.isVisible(el)
      );
      const row = hits.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (row) return row;
      await TB.sleep(500);
    }
    return null;
  }

  function guessExt(url) {
    const m = /\.(mp4|webm|mov|png|jpe?g|webp)(\?|$)/i.exec(url || "");
    return m ? m[1].toLowerCase() : "mp4";
  }

  // ---- product-panel detection (Product Set "is TikTok pulling products?") ----
  // Best-effort, verify against the live DOM: the "Add product links / Showcase
  // products" modal has no distinct URL (it's a sub-state of the upload page), so
  // we read the DOM. Signals: the panel heading text, plus visible rows carrying a
  // long numeric Product ID (e.g. 1734413934371702703). Returns counts only — no
  // automation, no clicks.
  const PANEL_RE = /add product links|showcase products|product links/i;
  const PRODUCT_ID_RE = /\b\d{12,}\b/g;

  function readProductStatus() {
    const url = location.href;
    const onUpload = /\/tiktokstudio\/upload/i.test(url);
    const bodyText = (document.body && document.body.innerText) || "";
    const headingMatch = PANEL_RE.test(bodyText);

    // Count UNIQUE product ids in visible row-like elements (tr / role=row / li).
    // Scope to row elements (not every div) to avoid counting the same id inside
    // nested containers.
    const ids = new Set();
    for (const el of document.querySelectorAll('tr, [role="row"], li')) {
      if (!TB.isVisible(el)) continue;
      const text = el.textContent || "";
      if (text.length > 600) continue; // a big container, not a single row
      const found = text.match(PRODUCT_ID_RE);
      if (found) found.forEach((id) => ids.add(id));
    }
    // Fallback: panel is clearly open but rows used an unrecognised structure —
    // scan the panel text directly so the count isn't a misleading zero.
    if (ids.size === 0 && headingMatch) {
      const found = bodyText.match(PRODUCT_ID_RE);
      if (found) found.forEach((id) => ids.add(id));
    }
    const productCount = ids.size;
    const panelOpen = headingMatch || productCount > 0;
    return { onUpload, panelOpen, productCount, totalPages: readMaxPage(), url };
  }

  // The "...108 109 110" pager: the largest small-integer CLICKABLE element is the
  // last page number (product IDs are 19 digits → excluded; stock numbers live in
  // table cells, not buttons). Returns the page total, or null if there's no pager.
  function readMaxPage() {
    let max = 0;
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      if (!TB.isVisible(el)) continue;
      const t = (el.textContent || "").trim();
      if (!/^\d{1,4}$/.test(t)) continue;
      const n = parseInt(t, 10);
      if (n > max) max = n;
    }
    return max || null;
  }

  // Synchronous, read-only status probe for the Product Set page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "productStatus") return;
    try {
      sendResponse(readProductStatus());
    } catch (e) {
      sendResponse({ onUpload: false, panelOpen: false, productCount: 0, error: String(e?.message || e) });
    }
    return true;
  });

  // Stage a clip into the upload editor (file input + caption) WITHOUT posting —
  // used by the one-click "upload + pull" run. Reuses the verified publish upload
  // steps; auto-post stays disabled.
  async function stageUpload({ mediaUrl, caption }) {
    if (!mediaUrl) return { ok: false, error: "no clip url" };
    const file = await TB.fetchAsFile(mediaUrl, `autogt-pro-${Date.now()}.${guessExt(mediaUrl)}`);
    const input = await TB.waitFor(SEL.fileInput, { visible: false, timeout: 20000 });
    TB.setFileInput(input, file);
    // Verify TikTok ACTUALLY accepted the file — setFileInput is a synthetic event
    // a React app may ignore. The editor only renders its Post button / a <video>
    // preview once the clip loads; if neither appears, report failure (not a fake ok).
    if (!(await waitForUploadAccepted(15000))) {
      return { ok: false, error: "TikTok ไม่รับไฟล์ (ตรวจไฟล์/รีเฟรชหน้าอัปโหลด)" };
    }
    if (caption) {
      const captionEl = await TB.waitForAny([
        ".public-DraftEditor-content",
        'div[contenteditable="true"][data-e2e*="caption" i]',
        'div[contenteditable="true"]',
      ]).catch(() => null);
      if (captionEl) await setCaption(captionEl, caption);
    }
    return { ok: true };
  }

  // The upload editor's Post button / video preview appears only after the clip is
  // accepted — use that as the "file attached" signal.
  async function waitForUploadAccepted(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (document.querySelector(SEL.postButton) || document.querySelector("video")) return true;
      await TB.sleep(500);
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "stageUpload") return;
    if (TB.hud) TB.hud.mount({ subtitle: "TikTok · Upload", stage: "กำลังอัปคลิป…" });
    stageUpload(msg)
      .then((r) => {
        if (TB.hud) TB.hud.done({ ok: r?.ok !== false, label: "อัปคลิปแล้ว" });
        sendResponse(r);
      })
      .catch((e) => {
        if (TB.hud) TB.hud.done({ ok: false, label: "อัปโหลดไม่สำเร็จ" });
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "publish") return;
    if (TB.hud) TB.hud.mount({ jobId: msg.jobId, subtitle: "TikTok · Upload", stage: "กำลังเริ่มต้น…" });
    publish(msg)
      .then((r) => {
        // Upload "prepared" (auto-post is off) still counts as a successful step.
        if (TB.hud) TB.hud.done({ ok: r?.ok !== false, jobId: msg.jobId, label: "อัปโหลดพร้อมแล้ว" });
        sendResponse(r);
      })
      .catch((e) => {
        if (TB.hud) TB.hud.done({ ok: false, jobId: msg.jobId, label: "เกิดข้อผิดพลาด" });
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  });
})();
