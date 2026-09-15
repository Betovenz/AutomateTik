// Content script: drives labs.google (ImageFX / VideoFX / Flow) to generate media.
//
// Targeting strategy: prefer role + accessible-label + geometry heuristics
// (TB.findPromptField / TB.findButton / TB.freshImageUrl) over brittle CSS, with
// explicit selector fallbacks. These are hardened best-effort heuristics — still
// verify against the live ImageFX / Flow DOM before trusting end to end; per the
// project rules, do not assume the guesses work.

(function () {
  if (window.__TB_GOOGLE_LABS_READY) return;
  window.__TB_GOOGLE_LABS_READY = true;

  // Explicit fallback if the prompt heuristic misses.
  const SEL = {
    prompt:
      'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-slate-editor="true"], input[type="text"], input:not([type])',
  };
  // The Flow composer's send button (verified live) is ICON-ONLY: no aria-label /
  // data-testid, type="submit", innerText = the Material ligature "arrow_forward"
  // + "Create". Lock onto the arrow_forward icon first. A decoy "add_2 Create"
  // (add-scene) shares the word "Create", and "delete View Trash" / model buttons
  // are ALSO type="submit" — so exclude those to avoid clicking the wrong thing.
  const GENERATE_RE = /arrow_forward|\bgenerate\b/i;
  const GENERATE_FALLBACK_RE = /\bcreate\b|\brun\b|\brender\b|\bsubmit\b/i;
  const GENERATE_EXCLUDE_RE = /add_2|\badd\b|delete|trash|view|nano|imagen|veo|agent|settings|help/i;
  // Video (Veo) can take minutes; image is quicker. Both stay under the hub's
  // 300s COMMAND_TIMEOUT_S so the content script fails first with a clean error.
  const RESULT_TIMEOUT = { video: 220000, image: 150000 };

  async function generate({ jobId, prompt, mediaType, count }) {
    const report = (stage, message, progress) => TB.report(jobId, stage, message, progress);

    report("prompt", "Entering prompt…", 0.2);
    // Flow often opens on the DASHBOARD (project list) which has NO composer —
    // open a new project first, then wait for the editor's composer to load.
    let input = TB.findPromptField();
    if (!input) {
      const newProj = TB.findButton(/new project/i);
      if (newProj) {
        report("navigate", "Opening a new project…", 0.25);
        TB.click(newProj);
        return { ok: false, retry: true, error: "opened a new Flow project; retry after navigation" };
      }
      input = await waitForComposer();
    }
    if (!input) input = await TB.waitForAny([SEL.prompt]);

    // Match the job's media type: the editor has an Image/Video toggle, and the
    // currently-selected mode decides what gets generated.
    selectMode(mediaType);

    // Baseline existing media AFTER entering the editor, so the dashboard's
    // project thumbnails aren't mistaken for this run's result. Flow also keeps
    // prior renders (image AND video) on the page, hence the before/after diff.
    const before = { images: TB.imageUrls(), videos: TB.videoUrls() };

    const typed = input.isContentEditable
      ? TB.typeContentEditable(input, prompt)
      : (TB.type(input, prompt), true);
    // Verify the prompt actually landed (a rich editor can silently ignore a
    // synthetic insert) so we never submit an empty/placeholder box.
    await TB.sleep(150);
    const got = (input.value ?? input.innerText ?? "").trim();
    if (!typed || !got.includes(prompt.slice(0, Math.min(12, prompt.length)))) {
      throw new Error(`prompt not entered (field shows: ${JSON.stringify(got.slice(0, 40))})`);
    }

    report("generate", "Submitting generation…", 0.4);
    // Resolve the send control: arrow_forward label → bottom-right composer icon
    // (geometry) → Create/Run/Submit label — all excluding decoys (add_2 / Trash /
    // model buttons). Last resort: Enter. Never blindly clicks another submit.
    const btn =
      (await TB.waitForButton(GENERATE_RE, { timeout: 6000, exclude: GENERATE_EXCLUDE_RE }).catch(
        () => null
      )) ||
      TB.findComposerSend(input) ||
      TB.findButton(GENERATE_FALLBACK_RE, GENERATE_EXCLUDE_RE);
    if (btn) TB.click(btn);
    else TB.pressEnter(input);

    report("waiting", "Waiting for result…", 0.6);
    const timeout = RESULT_TIMEOUT[mediaType] ?? RESULT_TIMEOUT.image;
    const mediaUrl = await waitForMediaUrl(mediaType, before, timeout);

    report("done", "Generation complete", 1);
    return { ok: true, mediaUrl, mediaType, count };
  }

  /** Click the editor's Image/Video toggle to match the job. The toggle buttons'
   *  innerText is an icon ligature + label ("image\nImage", "play_circle\nVideo"),
   *  and the View-images / View-videos rail buttons share the icon — so match on
   *  the LAST line being exactly "image" / "video". Non-fatal if absent. */
  function selectMode(mediaType) {
    const want = mediaType === "video" ? "video" : "image";
    const btn = [...document.querySelectorAll('button, [role="button"]')].find((b) => {
      if (!TB.isVisible(b)) return false;
      const lines = (b.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return (lines[lines.length - 1] || "").toLowerCase() === want;
    });
    if (btn) TB.click(btn);
  }

  /** Poll until the editor's prompt composer is present (after opening a project). */
  async function waitForComposer(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = TB.findPromptField();
      if (el) return el;
      await TB.sleep(300);
    }
    return null;
  }

  // Both the image and video results load from the same labs.google endpoint
  // (…/trpc/media.getMediaUrlRedirect?name=…) — an <img> for image mode, a real
  // <video src> for video mode. Diff against the baseline so a prior render on
  // the page is never returned as this run's result.
  async function waitForMediaUrl(mediaType, before, timeout = 150000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const src =
        mediaType === "video"
          ? TB.freshVideoUrl(before.videos)
          : TB.freshImageUrl(before.images);
      if (src) return src;
      await TB.sleep(1000);
    }
    throw new Error("no generated media appeared");
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "generate") return;
    generate(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // async response
  });
})();
