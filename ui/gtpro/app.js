// GT Pro Beta 0 control panel — talks to the app over ws://<host>/ws/ui
const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ── Crash-proof localStorage ─────────────────────────────────────────────────
// WebView2's localStorage getter THROWS (SecurityError/DOMException) — it does NOT
// return null — when its persistent profile can't initialize (a locked / redirected /
// corrupt %LOCALAPPDATA%\AutoTik\webview from AV, OneDrive Known-Folder-Move, a full
// disk, or an enterprise "block site data" policy). A throw on the top-level read below
// used to abort ALL of app.js before the boot-veil safety net armed → the app sat on the
// "กำลังเตรียมระบบ" splash forever (the dashboard skeleton painted, nothing dismissed it).
// Route every access through this shim so a storage failure degrades to a no-op.
const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable — ignore */ } },
};

// ── Disable the WebView2 (Edge) default right-click menu ─────────────────────
// This is a packaged desktop app, not a browser — the native context menu
// (Emoji / Inspect / Writing Direction / Reading mode) looks out of place and
// exposes Inspect. Suppress it everywhere; Ctrl+C/V/X/A still work normally.
window.addEventListener("contextmenu", (e) => e.preventDefault());

// ── F5 / Ctrl+R / Cmd+R → reload the panel ──────────────────────────────────
// The native pywebview window has no refresh button, and the app's single-instance
// lock means relaunching from the terminal just refocuses this window (it does NOT
// re-fetch CSS/JS). A reload re-requests `/` (the server cache-busts and no-stores
// every asset), so UI edits show up without restarting the whole app. UI state is
// server-held and re-synced from ui.state, so reloading mid-session is safe.
window.addEventListener("keydown", (e) => {
  const reload =
    e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"));
  if (reload) {
    e.preventDefault();
    location.reload();
  }
});

const els = {
  // header + sidebar status
  extPill: $("extPill"),
  extPillText: $("extPillText"),
  extPill2: $("extPill2"),
  extPillText2: $("extPillText2"),
  sbStatus: $("sbStatus"),
  sbStatusText: $("sbStatusText"),
  mainBody: $("mainBody"),
  navAnnounce: $("navAnnounce"),
  viewTitle: $("viewTitle"),
  viewSub: $("viewSub"),
  openExtensions: $("openExtensions"),
  // settings
  connectExtBtn: $("connectExtBtn"),
  connectExtHint: $("connectExtHint"),
  connectedNote: $("connectedNote"),
  // settings ▸ ข้อมูลเครื่อง (per-machine first-run card)
  deviceFirstRun: $("deviceFirstRun"),
  deviceIsFirst: $("deviceIsFirst"),
  deviceRunCount: $("deviceRunCount"),
  deviceId: $("deviceId"),
  deviceFirstPill: $("deviceFirstPill"),
  // generate form (body is rendered per mode into #genForm)
  genForm: $("genForm"),
  modeChip: $("modeChip"),
  modeNote: $("modeNote"),
  sourceChip: $("sourceChip"),
  openCustomPrompt: $("openCustomPrompt"), // Custom Prompt gear in the card head
  // jobs + workflow + log
  historyBack: $("historyBack"), // History view → back to the page that opened it
  jobCount: $("jobCount"),
  statQueued: $("statQueued"),
  statRunning: $("statRunning"),
  statDone: $("statDone"),
  statFailed: $("statFailed"),
  statCancelled: $("statCancelled"),
  logDot: $("logDot"),
};

// ---- provider display labels ----
const SOURCE_LABEL = { google_labs: "Google Flow", grok: "grok", kie: "kie.ai", tiktok: "tiktok" };

// ---- reusable field descriptors (rendered into the per-mode form) ----
const FIELD_DEFS = {
  caption: { type: "text", label: "Caption", placeholder: "Caption for the post" },
  hashtags: { type: "text", label: "Hashtags", placeholder: "fyp viral tiktokshop" },
  productId: { type: "text", label: "ชื่อสินค้า", opt: "(ปักตะกร้า)", placeholder: "optional — pin to basket" },
  sourceClip: { type: "text", label: "Source clip URL", placeholder: "https://… (paste a recent job's media URL)" },
  extendSeconds: { type: "number", label: "Extend by", opt: "(seconds)", min: 1, max: 60, value: 8 },
  // Flow Extend: pick a finished Flow clip to continue. NOT a free-text URL — Flow
  // extend needs the clip's project-scoped media id + owning account, which only a
  // prior job carries (canExtend). Options are built from the cached job list at
  // render time and kept fresh by refreshExtendPicker(). [[flow-extend-hidden-stub]]
  sourceJobId: { type: "jobpick", label: "คลิปต้นทาง", opt: "(คลิป Flow ที่จะต่อ)" },
  viralStyle: {
    type: "select", label: "Viral style",
    options: [["hook", "Strong hook"], ["trend", "Trending audio"], ["loop", "Seamless loop"], ["pov", "POV"]],
  },
  // KIE Kling motion-control (Motion Control / Character Swap): reference image +
  // motion/target video. Both required; resolution is the only picked control.
  // `upload: true` adds a file-pick button + thumbnail next to the URL input.
  refImage: { type: "text", upload: true, label: "Reference image", opt: "(URL or upload)", placeholder: "https://… subject (head, shoulders, torso)" },
  klingVideo: { type: "text", label: "Video URL", opt: "(3–30s)", placeholder: "https://… motion / target clip (.mp4/.mov)" },
  kieResMode: { type: "select", label: "Resolution", options: [["720p", "720p"], ["1080p", "1080p"]] },
  // KIE (Veo 3.1) controls — model / aspect / resolution are user-picked; duration
  // is locked per mode (see kie.py MODE_DURATION). imageUrls feeds image-to-video.
  kieModel: {
    type: "select", label: "Model",
    options: [["veo3_fast", "Veo 3.1 Fast"], ["veo3", "Veo 3.1 Quality"], ["veo3_lite", "Veo 3.1 Lite"]],
  },
  kieAspect: {
    type: "select", label: "Aspect ratio",
    options: [["9:16", "9:16 (vertical)"], ["16:9", "16:9"], ["Auto", "Auto"]],
  },
  kieResolution: {
    type: "select", label: "Resolution",
    options: [["720p", "720p"], ["1080p", "1080p"], ["4k", "4K (extra credits)"]],
  },
  imageUrls: { type: "text", upload: true, label: "Image URL(s)", opt: "(1–2, comma-sep or upload)", placeholder: "first frame, last frame — paste image URLs" },
};

// Creative-direction fields (Video Style / Character / Background / Speaking Style /
// voice type / speech style), ported from sora-creator-suite via style-options.js
// (loaded before this file). These are NOT form inputs — each is its own editable
// dropdown COLUMN per row in the Recent Jobs grid (see directionCells), set per job
// after it's queued. [[style-options]]
const DIRECTION_FIELDS = window.DIRECTION_FIELDS || [];
// The default (and "clear") option for every direction dropdown, value "" → the field
// is unconstrained so the AI/generation picks it. Selected by default since a fresh job
// carries no direction. Labelled "AI เลือกให้" per operator request.
const DIR_BLANK = ["", "AI เลือกให้"];
// The "กำหนดเอง" (free-text custom) dropdown option. Its value is a sentinel — picking
// it reveals an inline text input; the committed value is sent as `custom:<text>`
// (window.CUSTOM_PREFIX). Offered for every field in window.CUSTOM_DIRECTION_FIELDS.
const DIR_CUSTOM_OPT = ["__custom__", "✎ กำหนดเอง…"];
const CUSTOM_DIR_FIELDS = new Set(window.CUSTOM_DIRECTION_FIELDS || []);

// keys gathered into JobSpec.options on submit (everything mode-specific)
const OPTION_KEYS = [
  "sourceClip", "extendSeconds", "sourceJobId", "viralStyle",
  "refImage", "klingVideo", "kieResMode",
  "kieModel", "kieAspect", "kieResolution", "imageUrls",
];

// ---- mode descriptor factory ----
function mode(group, label, title, sub, provider, opts = {}) {
  return {
    view: "generate",
    group, label, title, sub, provider,
    media: opts.media || "image",
    lockMedia: opts.lockMedia ?? false,
    top: opts.top || [], // extra fields above the prompt
    extra: opts.extra || [], // extra fields below the prompt
    base: opts.base || ["productId"], // base fields a mode shows (just the product picker now)
    scenes: opts.scenes || false, // storyboard: a scene repeater replaces the prompt
    // Render the provider settings as a clip8-style 2-col spec grid (model ยท ขนาด ยท
    // เลือกวิธีลงคลิป) instead of flat fields. Used by flow-extend so its "Setting
    // Google Flow" card matches Clip 8s. [[flow-extend-hidden-stub]]
    specGrid: opts.specGrid || false,
    // Adds a "จำนวนคลิป" (2-10) dropdown to the spec grid — flow-extend chains that many
    // continuation clips. [[flow-extend-hidden-stub]]
    clipCount: opts.clipCount || false,
    promptLabel: opts.promptLabel || "Prompt",
    promptPlaceholder: opts.promptPlaceholder || "A neon lightning bolt over a city skyline…",
    promptOptional: opts.promptOptional || false, // modes where the API supplies a default
    requiredOptions: opts.requiredOptions || [], // option fields that must be filled before submit
    comingSoon: opts.comingSoon || false,
    note: opts.note || "",
    // Show the "รายละเอียดคลิป" section (6 creative-direction selects) for this mode.
    direction: opts.direction || false,
    // Loop-style modes: generate-only (no "เลือกวิธีลงคลิป" selector, never posts),
    // hide the 6 direction columns in Recent jobs, and skip the character popup on submit.
    // [[flow-loop-mode]]
    generateOnly: opts.generateOnly || false, // hide delivery selector + force generate_only
    noDirection: opts.noDirection || false, // hide direction columns (backend skips picks too)
    noCharacter: opts.noCharacter || false, // skip the "ใส่ตัวละคร" popup on +เพิ่มลงคิว
    banner: opts.banner || false, // show the Banner overlay section (Loop) — composite an image on the video
    // ---- image→video form (mediaSwitch modes only) ----
    // Replaces the Image/Video toggle with an "Image only / Image→Video" switch,
    // splits the prompt into Prompt Image + Prompt Video, and adds a per-step
    // model dropdown.
    mediaSwitch: opts.mediaSwitch || false,
    imageModels: opts.imageModels || [], // [[value,label], …] for the image step
    videoModels: opts.videoModels || [], // [[value,label], …] for the video step
    // grok-only extra spec-grid controls (image→video): resolution/duration replace the
    // video-model picker, and aspects/defaultAspect override the generic aspect set.
    grokResolution: opts.grokResolution || [],
    grokDuration: opts.grokDuration || [],
    // Pre-selected duration (must be a value in grokDuration). clip10 = "10s"; Extend uses
    // the longer 20–60s set with its own default. Falls back to "10s" when unset.
    defaultDuration: opts.defaultDuration || "",
    aspects: opts.aspects || null,
    defaultAspect: opts.defaultAspect || "",
    promptImagePlaceholder: opts.promptImagePlaceholder || "Describe the image to create…",
    promptVideoPlaceholder: opts.promptVideoPlaceholder || "How the image should move / animate…",
  };
}

// ---- model dropdown option lists ([apiCodename, displayLabel]) ----
// NOTE: only the LABEL changes here; the codename (value) is sent to the API and
// must stay exact. MODEL_DOT prefixes each label with the "ยท" middle dot (the same
// separator used in the brand titles, e.g. "Flow ยท Clip 8s") for a tidy look.
const MODEL_DOT = "ยท ";
// Flow image codenames are CONFIRMED from the generate response (modelNameType).
const FLOW_IMAGE_MODELS = [
  ["NARWHAL", MODEL_DOT + "Nano Banana 2"],
  ["GEM_PIX_2", MODEL_DOT + "Nano Banana Pro"],
  ["IMAGEN_3_5", MODEL_DOT + "Imagen 4"],
];
// Flow video codenames CONFIRMED from generate traffic (videoModelName). Only these
// three are wired (Quality / Omni Flash intentionally omitted). Both the credit COST
// and the AVAILABILITY of each model depend on the account's Flow tier: the 0-credit
// "Lite [Lower Priority]" exists ONLY on Ultra x20, and the per-clip cost roughly
// doubles below Ultra. So the dropdown is built per the linked Flow account's tier —
// see flowVideoModels()/effectiveFlowBucket(). The first entry of each list is that
// tier's default (cheapest available). Mirrors VIDEO_MODEL_* in labs_generate.py and
// Hub._flow_video_model on the server. [[flow-lite-tier-gated]]
const FLOW_VID_LITE_LOW = "veo_3_1_i2v_lite_low_priority"; // Lite [Lower Priority] ยท x20 only
const FLOW_VID_LITE = "veo_3_1_i2v_lite"; // Lite ยท all tiers
const FLOW_VID_FAST = "veo_3_1_i2v_s_fast_portrait_ultra"; // Fast
const FLOW_VIDEO_MODELS_BY_TIER = {
  x20: [
    [FLOW_VID_LITE_LOW, MODEL_DOT + "Lite (0 เครดิต)"],
    [FLOW_VID_LITE, MODEL_DOT + "Lite (5 เครดิต)"],
    [FLOW_VID_FAST, MODEL_DOT + "Fast (10 เครดิต)"],
  ],
  x5: [
    [FLOW_VID_LITE, MODEL_DOT + "Lite (5 เครดิต)"],
    [FLOW_VID_FAST, MODEL_DOT + "Fast (10 เครดิต)"],
  ],
  below: [
    [FLOW_VID_LITE, MODEL_DOT + "Lite (10 เครดิต)"],
    [FLOW_VID_FAST, MODEL_DOT + "Fast (20 เครดิต)"],
  ],
};

// Bucket a single Flow account into a credit tier. tier alone can't tell Ultra x5
// from x20 — x20 needs the precise plan label ("ULTRA x20"); any other ultra = x5.
function accountFlowBucket(a) {
  const ultra = String(a.tier || "").toLowerCase() === "ultra";
  if (ultra && /x20/i.test(String(a.plan || ""))) return "x20";
  if (ultra) return "x5";
  return "below";
}

// Which tier the Flow video-model dropdown should reflect: the HIGHEST tier among
// enabled Flow (google_labs) accounts, so an x20 operator keeps the free option even
// in a mixed-tier pool. The hub downgrades a 0-credit pick to plain Lite if a job is
// ever routed to a non-x20 account, so this can't cause a hard failure. No accounts
// known yet → "x20" (show the full set; it re-renders once ui.state lands).
function effectiveFlowBucket() {
  const rank = { below: 0, x5: 1, x20: 2 };
  let best = null;
  for (const a of lastAccounts || []) {
    if (a.provider !== "google_labs" || !a.enabled) continue;
    const b = accountFlowBucket(a);
    if (best === null || rank[b] > rank[best]) best = b;
  }
  return best || "x20";
}

function flowVideoModels() {
  return FLOW_VIDEO_MODELS_BY_TIER[effectiveFlowBucket()] || FLOW_VIDEO_MODELS_BY_TIER.x20;
}

// Re-sync the Flow video-model dropdown when the account list changes — a tier may
// have just resolved (e.g. "free" → "ultra"/"x20" after a Refresh), which adds/removes
// the 0-credit option and changes the credit labels. Preserves a still-valid pick.
function refreshFlowVideoModelSelect() {
  const sel = $("f-videoModel");
  if (!sel) return;
  const m = NAV[currentNav];
  if (!m || m.provider !== "google_labs") return;
  const models = flowVideoModels();
  const cur = sel.value;
  sel.innerHTML = models
    .map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`)
    .join("");
  if (models.some(([v]) => v === cur)) sel.value = cur; // keep the user's choice if still offered
}

// Effective SuperGrok entitlement among enabled grok accounts. grok Free caps the
// generate controls (image = aspect only; video locked to 480p + 6s); paid SuperGrok/
// Heavy unlock the full set (Quality + 720p + 10s). Returns true (capped) ONLY when a
// grok account is KNOWN free and none are paid — optimistic like effectiveFlowBucket: an
// unresolved tier or no grok account → treat as paid so a slow ui.state doesn't flash the
// capped form. tier comes from grok.py (pro/ultra = paid). [[supergrok-config-redesign]]
function grokIsFree() {
  let sawFree = false;
  for (const a of lastAccounts || []) {
    if (a.provider !== "grok" || !a.enabled) continue;
    const tier = String(a.tier || "").toLowerCase();
    if (tier === "pro" || tier === "ultra") return false; // any paid grok → full controls
    if (tier === "free") sawFree = true;
  }
  return sawFree;
}

// Re-render the grok spec grid if the effective tier flipped (free↔paid) while the form
// is open — e.g. a Refresh just resolved the plan. Guarded on a REAL change (vs
// lastGrokFree, set by specGridHtml) so the 60s account poll doesn't reset the user's
// picks every tick. [[supergrok-config-redesign]]
function refreshGrokTierControls() {
  const m = NAV[currentNav];
  if (!m || m.view !== "generate" || m.provider !== "grok" || !m.mediaSwitch) return;
  if (grokIsFree() === lastGrokFree) return; // no tier change → leave the form alone
  renderModeForm(m); // tier flipped → rebuild with the new caps (resets lastGrokFree)
}
// Aspect (ขนาด) — value = Flow API label (IMAGE/VIDEO_ASPECTS in labs_generate.py),
// display = the ratio shown in Flow. Video (Veo) only does portrait/landscape;
// image also does square. 4:3 / 3:4 omitted (enum strings not captured yet).
const ASPECTS_IMAGE = [["portrait", "9:16"], ["landscape", "16:9"], ["square", "1:1"]];
const ASPECTS_VIDEO = [["portrait", "9:16"], ["landscape", "16:9"]];
// SuperGrok (grok.com Imagine) toolbar controls — LIVE-VERIFIED labels (2026-06-17).
// grok has NO public API (generate request is an encrypted blob), so these are the
// on-screen labels the extension clicks: image step = Quality (Speed|Quality), video
// step = resolution + duration. GROK_ASPECTS is grok-specific (5 ratios, default 9:16);
// don't fold it into the shared ASPECTS_* (Flow/Veo back ends only take portrait/
// landscape/square). [[supergrok-config-redesign]]
const GROK_IMAGE_QUALITY = [["speed", "Speed"], ["quality", "Quality"]];
const GROK_VIDEO_RESOLUTION = [["480p", "480p"], ["720p", "720p"]];
const GROK_VIDEO_DURATION = [["6s", "6 วินาที"], ["10s", "10 วินาที"]];
// Extend Clip offers longer durations than clip10's 6s/10s — max 30s.
const GROK_EXTEND_DURATION = [["20s", "20 วินาที"], ["30s", "30 วินาที"]];
const GROK_ASPECTS = [
  ["2:3", "2:3 Tall"], ["3:2", "3:2 Wide"], ["1:1", "1:1 Square"],
  ["9:16", "9:16 Vertical"], ["16:9", "16:9 Widescreen"],
];
const KIE_IMAGE_MODELS = [["nano-banana-2", "Nano Banana 2"]]; // KIE text-to-image
const KIE_VIDEO_MODELS = [
  ["veo3_fast", "Veo 3.1 Fast"], ["veo3", "Veo 3.1 Quality"], ["veo3_lite", "Veo 3.1 Lite"],
];

// ---- navigation map: sidebar key -> view/mode config ----
const NAV = {
  // ----- Dashboard — standalone overview page (default landing), sits at the TOP -----
  // Blank placeholder for now; the page body lives in data-view="dashboard" in index.html.
  dashboard: { view: "dashboard", title: "Dashboard", sub: "ภาพรวมการใช้งาน" },

  // ----- Product Showcase (TikTok) — standalone, sits ABOVE Flow -----
  // Has its OWN bespoke view — NOT the shared generate form / recent jobs grid.
  // The page body lives in the data-view="product-set" section in index.html.
  "product-showcase": { view: "product-set", title: "Product Showcase", sub: "TikTok ยท product showcase" },

  // ----- Flow (labs.google) — each mode does Image OR Video (selectable) -----
  "flow-clip8": mode("flow", "Clip 8s", "Google Flow ยท Clip 8s", "labs.google ยท image → 8-second clip", "google_labs", {
    mediaSwitch: true, direction: true,
    imageModels: FLOW_IMAGE_MODELS, videoModels: FLOW_VIDEO_MODELS_BY_TIER.x20,
    note: "สร้างภาพก่อน แล้วต่อเป็นวิดีโอทันที (ภาพ→วิดีโอ).",
  }),
  "flow-extend": mode("flow", "Extend Clip", "Google Flow ยท Extend Clip", "labs.google ยท extend an existing clip", "google_labs", {
    media: "video", lockMedia: true,
    // SETTING GOOGLE FLOW card identical to Clip 8s (operator's request): same specGrid,
    // no extra fields. [[flow-extend-hidden-stub]]
    specGrid: true, clipCount: true,
    imageModels: FLOW_IMAGE_MODELS, videoModels: FLOW_VIDEO_MODELS_BY_TIER.x20,
    promptLabel: "Continuation prompt", promptPlaceholder: "how the clip should continue…",
    note: "ต่อคลิป Google Flow ที่สร้างไว้.",
  }),
  // Loop: Configuration & Prompt = Extend Clip (same specGrid + จำนวนคลิป + per-clip Video
  // Prompts), but the GENERATION is Clip-8s-based — N independent 8s clips all starting from
  // the SAME base image, concatenated into one seamless looping video, with NO speech. The
  // backend (_run_labs_loop_chain) + _think_extend (forced silent + loop-motion) handle the
  // divergence; the UI reuses Extend's form via the same flags. [[flow-loop-mode]]
  "flow-loop": mode("flow", "Loop", "Google Flow ยท Loop", "labs.google ยท loop 8s clips → one video", "google_labs", {
    media: "video", lockMedia: true,
    specGrid: true, clipCount: true,
    // Loop = render-only factory loop: no posting, no creative direction, no character.
    generateOnly: true, noDirection: true, noCharacter: true, banner: true,
    imageModels: FLOW_IMAGE_MODELS, videoModels: FLOW_VIDEO_MODELS_BY_TIER.x20,
    promptLabel: "Loop prompt", promptPlaceholder: "ฉาก/การเคลื่อนไหวของคลิป (ไม่มีบทพูด)…",
    note: "สร้างคลิป 8 วิ หลายคลิปจากภาพเดียวกัน แล้ววนลูปต่อเป็นวิดีโอเดียว (ไม่มีบทพูด ไม่โพสต์).",
  }),
  "flow-storyboard": mode("flow", "Storyboard", "Google Flow ยท Storyboard", "labs.google ยท multi-scene storyboard", "google_labs", {
    media: "video", lockMedia: false, scenes: true, base: ["productId"],
    note: "One shot per scene, stitched in order.",
  }),
  "flow-viral": mode("flow", "Viral Google Flow", "Google Flow ยท Viral Google Flow", "labs.google ยท viral-tuned media", "google_labs", {
    media: "video", lockMedia: false, extra: ["viralStyle"],
    note: "Tunes the generation for short-form virality.",
  }),

  // ----- SuperGrok (grok) -----
  "grok-clip10": mode("supergrok", "Clip 10s", "SuperGrok ยท Clip 10s", "grok ยท image → 10-second clip", "grok", {
    mediaSwitch: true, direction: true,
    // image step = Quality (Speed|Quality); video step = resolution + duration. grok has
    // no separate video-MODEL picker, so videoModels is empty. [[supergrok-config-redesign]]
    imageModels: GROK_IMAGE_QUALITY, videoModels: [],
    grokResolution: GROK_VIDEO_RESOLUTION, grokDuration: GROK_VIDEO_DURATION,
    defaultDuration: "10s",
    aspects: GROK_ASPECTS, defaultAspect: "9:16",
    note: "สร้างภาพแล้วต่อเป็นคลิป ~10 วินาที (ภาพ→วิดีโอ).",
  }),
  "grok-extend": mode("supergrok", "Extend Clip", "SuperGrok ยท Extend Clip", "grok ยท image → extended clip", "grok", {
    // Configuration & Prompt mirrors grok-clip10 (Quality / Aspect / Resolution / Duration +
    // direction columns + เลือกวิธีลงคลิป). The extend-specific behavior is wired separately.
    mediaSwitch: true, direction: true,
    imageModels: GROK_IMAGE_QUALITY, videoModels: [],
    grokResolution: GROK_VIDEO_RESOLUTION, grokDuration: GROK_EXTEND_DURATION,
    defaultDuration: "20s",
    aspects: GROK_ASPECTS, defaultAspect: "9:16",
    note: "สร้างภาพแล้วต่อเป็นคลิปยาว 20–30 วินาที (ภาพ→วิดีโอ).",
  }),
  "grok-viral": mode("supergrok", "Viral Grok", "SuperGrok ยท Viral Grok", "grok ยท viral-tuned video", "grok", {
    media: "video", lockMedia: true, extra: ["viralStyle"],
  }),

  // ----- Post TikTok (โพสต์อย่างเดียว) — standalone, sits BELOW SuperGrok -----
  // No generation: the operator supplies finished clips (upload from disk or pick a
  // completed job) and the pipeline posts them straight to TikTok with the full publish
  // config (caption/hashtags ยท Shop product ยท delivery method ยท schedule). It reuses the
  // shared generate VIEW (jobs grid + per-mode Run/Stop) — a custom form + submit handler
  // branch on `postOnly`. Source is TIKTOK (no generation provider). [[tiktok-post-only-mode]]
  "tiktok-post": {
    view: "generate",
    provider: "tiktok",
    postOnly: true,
    noDirection: true, // no creative-direction columns in the jobs grid
    base: ["productId"],
    top: [], extra: [],
    label: "โพสต์ TikTok",
    title: "โพสต์ TikTok",
    sub: "tiktok ยท โพสต์คลิปที่มีอยู่แล้ว (ไม่ต้องสร้าง)",
    note: "อัปโหลดคลิป หรือเลือกจากงานที่สร้างเสร็จแล้ว แล้วโพสต์ขึ้น TikTok ได้เลย — ไม่ต้องสร้างใหม่.",
  },

  // ----- KIE (kie.ai ยท Veo 3.1 REST API) -----
  // Clip 8s = text-to-video (/veo/generate); Extend = image-to-video. Both poll
  // /veo/record-info. Motion Control / Character Swap use the Kling jobs family.
  "kie-clip8": mode("kie", "Clip 8s", "KIE ยท Clip 8s", "kie.ai ยท Veo 3.1 ยท 8-second clip", "kie", {
    mediaSwitch: true, direction: true,
    imageModels: KIE_IMAGE_MODELS, videoModels: KIE_VIDEO_MODELS,
    extra: ["kieAspect", "kieResolution"],
    note: "ภาพด้วย Nano Banana 2 แล้วต่อเป็นวิดีโอ Veo 3.1 (ภาพ→วิดีโอ).",
  }),
  "kie-extend": mode("kie", "Extend Clip", "KIE ยท Extend Clip", "kie.ai ยท Veo 3.1 ยท image-to-video", "kie", {
    media: "video", lockMedia: true, direction: true,
    top: ["imageUrls"], extra: ["kieModel", "kieAspect", "kieResolution"],
    promptLabel: "Prompt", promptPlaceholder: "how the clip should move / continue…",
    requiredOptions: ["imageUrls"],
    note: "1 image = animate it; 2 images = first→last frame transition.",
  }),
  "kie-motion": mode("kie", "Motion Control", "KIE ยท Motion Control", "kie.ai ยท Kling 3.0 ยท animate a still image", "kie", {
    media: "video", lockMedia: true, top: ["refImage", "klingVideo"], extra: ["kieResMode"],
    promptLabel: "Motion prompt", promptPlaceholder: "optional — leave blank for the default…",
    promptOptional: true, requiredOptions: ["refImage", "klingVideo"],
    note: "Drives a still image with a motion video (Kling 3.0).",
  }),
  "kie-swap": mode("kie", "Character Swap", "KIE ยท Character Swap", "kie.ai ยท Kling 3.0 ยท swap a character into a clip", "kie", {
    media: "video", lockMedia: true, top: ["refImage", "klingVideo"], extra: ["kieResMode"],
    promptLabel: "Notes", promptPlaceholder: "optional — leave blank for the default…",
    promptOptional: true, requiredOptions: ["refImage", "klingVideo"],
    note: "Swaps the image's character into your clip (Kling 3.0).",
  }),

  // ----- standalone views -----
  "loop-post": { view: "loop-post", title: "Loop Post TikTok", sub: "auto-post queue → TikTok" },
  workflow: { view: "workflow", title: "History", sub: "ประวัติงานทั้งหมด ยท generate → publish" },
  webhook: { view: "webhook", title: "Webhook", sub: "outbound notifications" },
  "prompt-hub": { view: "prompt-hub", title: "Prompt Hub", sub: "saved prompt library" },
  // Log is not a page anymore — it's a floating window toggled by #logToggle.
  // ที่เก็บไฟล์ — pulled out of Settings into its own bottom-left nav entry.
  downloads: { view: "downloads", title: "ที่เก็บไฟล์", sub: "โฟลเดอร์เซฟไฟล์ที่สร้างเสร็จอัตโนมัติ" },

  settings: { view: "settings", title: "Settings", sub: "accounts, connection & license" },
};

const DEFAULT_NAV = "dashboard";

let extConnected = false;
let extConnecting = false; // true while the program-side "เชื่อมต่อ Extension" button is mid-attempt
let socket = null;
let currentNav = DEFAULT_NAV;
// The page to return to when "‹ ย้อนกลับ" is pressed in the History view —
// remembered as the nav we were on right before opening History. [[history-view-error-explain]]
let backToNav = DEFAULT_NAV;
let unread = 0;
let lastAccounts = [];
// Per-mode run state: which generate modes have a drain in flight (from ui.state's
// runningModes). The Run/Stop button reflects ONLY the tab you're on, so Clip 8s can show
// "running" while Extend Clip shows "idle" — they run concurrently. [[per-mode-concurrent-run]]
let lastRunningModes = [];
// The latest inter-row countdown per mode (mode → queue.countdown payload). Lets each tab
// show its OWN countdown; switching tabs re-renders the one for that mode (or hides it).
const countdownByMode = new Map();
// What the currently-rendered grok spec grid reflects (true=Free-capped, false=paid,
// null=not rendered). Set by specGridHtml; read by refreshGrokTierControls to re-render
// only on a real free↔paid flip. [[supergrok-config-redesign]]
let lastGrokFree = null;
// True once the first ui.state delivered the account list — the connect-gate
// overlays stay hidden until then so a slow socket doesn't flash "ยังไม่เชื่อม"
// over a fully-connected install.
let accountsKnown = false;
// Last TikTok showcase pull, mirrored from the `tiktok.products` message (fresh pull
// or the restore the hub sends on connect). Feeds the generate-form product picker so
// you choose a product instead of pasting its ID. [[tiktok-showcase-products-api]]
let lastProducts = [];
// Which provider groups the pulled products are synced into (rides every tiktok.products
// payload as `syncTargets`). A mode's product picker shows products ONLY if its group is
// here — the user picks targets via the "Sync สินค้า" button (no auto-sync). [[product-picker-from-showcase]]
let productSyncTargets = [];
// The TikTok account the current product catalog was PULLED from (rides every
// tiktok.products payload as `accountId`/`accountEmail`). A showcase product can only be
// tagged on its own account, so when a product is pinned the publish-account selector is
// LOCKED to this account (and the create is blocked if it can't be resolved).
// [[publish-account-must-match-product-source]]
let productSourceAccountId = null;
let productSourceAccountEmail = "";
// Per-mode System Prompts. The generate form has no per-job prompt box — the "Custom
// Prompt" button opens an editor over a STRUCTURED set of prompt fields (blocked
// keywords + content/image/video templates in normal & no-text variants, plus
// multi-clip extend slots), and the saved values drive every job in that mode.
// Factory defaults + the editor section schema live in prompt-defaults.js (loaded
// before app.js). Only the fields the user CHANGES are stored here, keyed
// "<mode>::<field>" (e.g. "flow-clip8::contentSystemPrompt"). [[system-prompt]]
let systemPrompts = {};
const PROMPT_DEFAULTS = window.PROMPT_DEFAULTS || {};
const PROMPT_SCHEMA = window.PROMPT_SCHEMA || {};

// TikTok publish toggles ("Setting TikTok" section). Module-level so they survive a
// form re-render; persisted server-side in AppSettings.tiktok_settings and mirrored
// back via ui.state → applyTikTokSettings(). `enabled` is the master gate: when off
// the sub-toggles are retained but inert. yourBrand/brandedContent only apply when
// discloseContent is on. [[tiktok-settings]]
const TIKTOK_SETTINGS_DEFAULT = {
  enabled: false,
  disableCart: false,
  skipAiLabel: false,
  discloseContent: false,
  yourBrand: false,
  brandedContent: false,
};
let tiktokSettings = { ...TIKTOK_SETTINGS_DEFAULT };
// toggle element id -> tiktokSettings field (master tkMaster handled separately)
const TK_TOGGLE_FIELD = {
  tkDisableCart: "disableCart",
  tkSkipAi: "skipAiLabel",
  tkDisclose: "discloseContent",
  tkYourBrand: "yourBrand",
  tkBrandedContent: "brandedContent",
};
// camelCase provider group -> the section title shown ("Setting <X>")
const PROVIDER_SECTION_LABEL = { flow: "Google Flow", supergrok: "SuperGrok", kie: "KIE" };

// ---- per-mode System Prompt helpers ----
function spKey(mode, field) {
  return `${mode}::${field}`;
}
function promptDefault(mode, field) {
  const d = PROMPT_DEFAULTS[mode];
  return (d && d[field]) || "";
}
// The user's saved override for one field ("" when none).
function promptOverride(mode, field) {
  return systemPrompts[spKey(mode, field)] || "";
}
// The value actually used for a job: the user's override, else the factory default.
function effectivePrompt(mode, field) {
  return promptOverride(mode, field) || promptDefault(mode, field);
}

// The Image Prompt template embeds scene-variation MENUS — [TIME_VARIATIONS] /
// [MOOD_VARIATIONS] / [CAMERA_VARIATIONS], each a heading followed by a list of
// options. Per generated clip we keep ONE random line per heading (replacing the whole
// block), so each image gets a single coherent time/mood/camera instead of the full
// list — mirroring the reference engine's per-generation pick and giving variety across
// a batch. No-op for templates without these blocks. [[system-prompt]]
function resolveVariations(text) {
  if (!text || text.indexOf("_VARIATIONS]") === -1) return text;
  const pick = (whole, body) => {
    const opts = body.split("\n").map((s) => s.trim()).filter(Boolean);
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : whole;
  };
  return text
    .replace(/\[TIME_VARIATIONS\]\n([\s\S]*?)(?=\n\n|\n\[[A-Z_]+\]|$)/, pick)
    .replace(/\[MOOD_VARIATIONS\]\n([\s\S]*?)(?=\n\n|\n\[[A-Z_]+\]|$)/, pick)
    .replace(/\[CAMERA_VARIATIONS\]\n([\s\S]*?)(?=\n\n|\n\[[A-Z_]+\]|$)/, pick);
}

// ---- Flow Extend source-clip picker ----
// Finished Flow clips that can be extended (canExtend = persisted video handles +
// owning account). Built from the cached job list; newest first.
function extendClipOptions() {
  return (lastJobsForGrid || [])
    .filter((j) => j.canExtend)
    .slice()
    .reverse()
    .map((j) => {
      const name = ((j.displayTitle || j.prompt || "clip").trim() || "clip").slice(0, 40);
      return [String(j.id), `${name} ยท ${fmtCreated(j.createdAt)} ยท ${j.id}`];
    });
}

function extendPickerOptionsHtml() {
  const opts = extendClipOptions();
  return opts.length
    ? opts.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join("")
    : `<option value="">— ยังไม่มีคลิป Flow ที่ต่อได้ (สร้างคลิปก่อน) —</option>`;
}

// Repopulate the picker as new Flow clips finish, preserving the current choice.
function refreshExtendPicker() {
  const sel = $("f-sourceJobId");
  if (!sel) return; // not on the Extend form
  const prev = sel.value;
  sel.innerHTML = extendPickerOptionsHtml();
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

// ---- per-mode form rendering ----
function fieldHtml(name) {
  const d = FIELD_DEFS[name];
  if (!d) return "";
  // The TikTok product field is a picker over the saved showcase pull, not a
  // free-text box (with a manual escape hatch). See productPickerHtml().
  if (name === "productId") return productPickerHtml();
  const id = `f-${name}`;
  const label = `<label for="${id}">${escapeHtml(d.label)}${
    d.opt ? ` <span class="opt">${escapeHtml(d.opt)}</span>` : ""
  }</label>`;
  if (d.type === "number")
    return `<div class="field">${label}<input id="${id}" type="number" min="${d.min ?? 1}" max="${d.max ?? 10}" value="${d.value ?? 1}" /></div>`;
  // Flow Extend's "source clip" picker — a select over finished, extendable Flow
  // clips (built at render time; kept fresh by refreshExtendPicker). [[flow-extend-hidden-stub]]
  if (d.type === "jobpick")
    return `<div class="field">${label}<select id="${id}">${extendPickerOptionsHtml()}</select></div>`;
  if (d.type === "select")
    return `<div class="field">${label}<select id="${id}">${d.options
      .map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`)
      .join("")}</select></div>`;
  const input = `<input id="${id}" type="text" placeholder="${escapeHtml(d.placeholder || "")}" />`;
  if (d.type === "text" && d.upload) {
    // URL input + a file picker that uploads and fills the field; thumbnail of the
    // current value sits beneath. The hidden file input is wired by name to the field.
    return `<div class="field">${label}
      <div class="upload-row">
        ${input}
        <button type="button" class="btn tiny upload-btn" data-upload-for="${name}">⬆ Upload</button>
        <input type="file" accept="image/*" class="upload-file" data-upload-input="${name}" hidden />
      </div>
      <div class="upload-preview" data-upload-preview="${name}" hidden></div>
    </div>`;
  }
  return `<div class="field">${label}${input}</div>`;
}

function mediaHtml(m) {
  // Locked modes have a fixed media type (it's in the title, e.g. "8-second video
  // clip") — showing a toggle the user can't operate is just confusing, so omit it.
  if (!m.media || m.lockMedia) return "";
  const img = m.media === "image";
  // toggle-button group (not a radiogroup): native buttons are Tab+Enter operable
  // and aria-pressed conveys state without owing the radio keyboard model.
  const seg = (value, label, on) =>
    `<button type="button" class="seg ${on ? "active" : ""}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
  return `<div class="field">
    <span class="field-label" id="mediaLabel">Media</span>
    <div class="segmented" id="mediaType" role="group" aria-labelledby="mediaLabel">
      ${seg("image", "Image", img)}${seg("video", "Video", !img)}
    </div>
  </div>`;
}

function sceneRow(n) {
  return `<div class="scene-row"><span class="scene-n">${n}</span>
    <input type="text" data-scene placeholder="Scene ${n} — what happens…" /></div>`;
}

function scenesHtml() {
  // Scenes are the per-job content for storyboard; the standing System Prompt (script /
  // scene templates) is edited via the Custom Prompt gear in the card head.
  return `<div class="field">
    <span class="field-label">Scenes</span>
    <div id="scenesWrap" class="scenes">${sceneRow(1)}${sceneRow(2)}${sceneRow(3)}</div>
    <div class="sp-row"><button type="button" class="btn tiny" id="addScene">+ Add scene</button></div>
  </div>`;
}

// The per-mode System Prompt lives behind the Custom Prompt gear in the "Configuration &
// Prompt" card head (see index.html / openPromptEditor). It opens a full editor (blocked
// keywords + content/image/video templates, normal & no-text); the saved prompts drive
// every job in this mode — there is no per-job prompt box. refreshPromptButton() just
// shows or hides the gear per mode (modes with no PROMPT_SCHEMA have nothing to edit).
function refreshPromptButton() {
  const btn = els.openCustomPrompt;
  if (btn) btn.hidden = !PROMPT_SCHEMA[currentNav];
}

// Single-prompt modes expose the standing System Prompt via the Custom Prompt gear
// (no inline textarea), so the prompt area of the form body is empty. [[system-prompt]]
function promptFieldHtml(m) {
  return "";
}

function modelSelectHtml(id, label, options, disabled, selected = "") {
  const opts = (options.length ? options : [["", "—"]])
    .map(([v, t]) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(t)}</option>`)
    .join("");
  return `<div class="field">
    <label for="${id}">${escapeHtml(label)}</label>
    <select id="${id}"${disabled ? " disabled" : ""}>${opts}</select>
  </div>`;
}

// image→video modes: the image (primary) + video prompts live behind the Custom Prompt
// gear in the card head, so the form body's prompt area is empty. Models/aspect/count
// follow in the spec grid.
function promptsHtml(m) {
  return "";
}

// 2-column "spec" grid grouping the image model, video model, aspect and count —
// exactly 2ร—2 for Flow ▸ Clip 8s; fewer cells (still 2-col) for modes without a
// generic aspect or Count.
function specGridHtml(m) {
  const imageDisabled = m.imageModels.length === 1 && m.imageModels[0][0] === "pending";
  // Flow video models are tier-dependent (cost + the x20-only 0-credit Lite), so build
  // them live from the linked account's tier instead of the static mode list.
  const videoModels = m.provider === "google_labs" ? flowVideoModels() : m.videoModels;
  const cells = [];
  // SuperGrok Free caps the controls: image is aspect-only (no Quality), and video is
  // locked to 480p + 6s. Paid SuperGrok/Heavy unlock Quality + 720p + 10s. lastGrokFree
  // records what this render reflects so refreshGrokTierControls() re-renders only on a
  // real free↔paid flip. [[supergrok-config-redesign]]
  const grokFree = m.provider === "grok" && grokIsFree();
  if (m.provider === "grok") lastGrokFree = grokFree;
  if (m.provider === "grok") {
    // grok.com Imagine: image step = Quality (Speed|Quality); grok has no video-MODEL
    // picker — resolution + duration (after the aspect cell) replace it. Free → skip the
    // Quality cell (image = aspect only).
    if (!grokFree) {
      cells.push(modelSelectHtml("f-imageModel", "คุณภาพในการสร้างภาพ", m.imageModels, imageDisabled, "quality"));
    }
  } else {
    cells.push(
      modelSelectHtml("f-imageModel", "Model ยท ภาพ", m.imageModels, imageDisabled),
      modelSelectHtml("f-videoModel", "Model ยท วิดีโอ", videoModels, false),
    );
  }
  if (usesGenericAspect(m)) cells.push(aspectHtml(m));
  if (m.provider === "grok") {
    // Free locks each to its single allowed value (a disabled select still reports .value).
    const resList = grokFree ? [["480p", "480p"]] : m.grokResolution;
    const durList = grokFree ? [["6s", "6 วินาที"]] : m.grokDuration;
    cells.push(
      modelSelectHtml("f-grokResolution", "ความละเอียด (Resolution)", resList, grokFree, grokFree ? "480p" : "720p"),
      modelSelectHtml("f-grokDuration", "ความยาว (Duration)", durList, grokFree, grokFree ? "6s" : (m.defaultDuration || "10s")),
    );
  }
  if (m.clipCount) cells.push(clipCountHtml()); // flow-extend: how many clips to chain
  // delivery method (replaced the Count selector) — hidden for generate-only modes (Loop),
  // which never post; submitJob forces publish_mode="generate_only" for them. [[flow-loop-mode]]
  if (!m.generateOnly) cells.push(postModeFieldHtml());
  // No-text mode toggle — Google Flow only (Clip 8s + Extend Clip). Drives the existing
  // no-text prompt machinery: sends options.noText="1" + swaps to the "…NoText" template
  // variants so the generated image/video carries no headline/letters. [[flow-no-text-mode]]
  if (m.provider === "google_labs") cells.push(noTextToggleHtml());
  return `<div class="spec-grid">${cells.join("")}</div>`;
}

// Per-mode "No-text mode" state, persisted in localStorage (survives form re-renders +
// app restart) keyed by mode. Only ever set for Google Flow modes (the toggle renders
// there alone), so reads for other providers are always false. [[flow-no-text-mode]]
function noTextKeyLS(mode) {
  return "noText::" + mode;
}
function noTextEnabled(mode) {
  return safeLS.get(noTextKeyLS(mode)) === "1";
}
function setNoText(mode, on) {
  safeLS.set(noTextKeyLS(mode), on ? "1" : "0");
}

// Full-width toggle row appended to the Setting Google Flow spec grid. Reuses the TikTok
// switch look (.tk-row / .tk-switch). [[flow-no-text-mode]]
function noTextToggleHtml() {
  const on = noTextEnabled(currentNav);
  return `<div class="notext-row">
    <label class="tk-row notext-toggle">
      <span class="tk-row-label">โหมดไม่มีตัวอักษร <span class="opt">— ไม่ให้มีตัวหนังสือ/ข้อความบนภาพและวิดีโอ</span></span>
      <span class="tk-switch">
        <input type="checkbox" id="f-noText"${on ? " checked" : ""} />
        <span class="tk-track"><span class="tk-thumb"></span></span>
      </span>
    </label>
  </div>`;
}

// Map a base template key to its "No-text" variant when No-text mode is on for this
// (Google Flow) mode. Content prompts insert "NoText" BEFORE the "Extended" suffix
// (contentSystemPromptExtended → contentSystemPromptNoTextExtended); every other key just
// appends "NoText" (imagePromptTemplate → imagePromptTemplateNoText, videoPrompt2Template
// → videoPrompt2TemplateNoText). Falls back to the base key when the mode has no such
// variant or it resolves empty, so a mode without a no-text set is unaffected.
// [[flow-no-text-mode]]
function noTextTemplateKey(mode, key) {
  if (!noTextEnabled(mode)) return key;
  const variant = key === "contentSystemPromptExtended"
    ? "contentSystemPromptNoTextExtended"
    : key + "NoText";
  return effectivePrompt(mode, variant) ? variant : key;
}

// "จำนวนคลิป" selector (2-10) for flow-extend — how many continuation clips to chain.
function clipCountHtml() {
  const opts = [];
  for (let n = 2; n <= 10; n++) opts.push(`<option value="${n}">${n}</option>`);
  return `<div class="field">
    <label for="f-clipCount">จำนวนคลิป <span class="opt">(2-10)</span></label>
    <select id="f-clipCount">${opts.join("")}</select>
  </div>`;
}

// "เลือกวิธีลงคลิป" — replaced the old Count selector (every clip-generating mode). Five
// delivery methods: four stage the clip into TikTok and finalize differently (post public /
// Save draft / Schedule / post private), GENERATE_ONLY stops once the image + clip are made.
// Only generate-only dims the "Setting TikTok" card (the other four use caption/product/
// toggles); SCHEDULE reveals a date+time field. See applyPostModeUI.
const POST_MODE_AUTO = "auto";
const POST_MODE_SAVE_DRAFT = "save_draft";
const POST_MODE_SCHEDULE = "schedule";
const POST_MODE_PRIVATE = "private";
const POST_MODE_GENERATE_ONLY = "generate_only";
// The delivery methods that actually upload to TikTok (everything but generate-only) — these
// all need a connected TikTok account (gated in applyPostModeAvailability).
const POST_MODES_TIKTOK = [POST_MODE_AUTO, POST_MODE_SAVE_DRAFT, POST_MODE_SCHEDULE, POST_MODE_PRIVATE];
function postModeFieldHtml() {
  // Group the delivery selector + its schedule field into one full-width sub-row so they
  // always sit together on their OWN grid row (selector left, date/time right), regardless
  // of how many cells precede them. Without this, an odd cell count (e.g. Clip 8s: image +
  // video + aspect = 3) would split them across rows — selector right, date/time dangling
  // on the next row's left. The wrapper keeps every mode consistent with Extend Clip / Grok.
  return `<div class="post-mode-row">
    <div class="field">
      <label for="f-postMode">เลือกวิธีลงคลิป</label>
      <select id="f-postMode">
        <option value="${POST_MODE_AUTO}">สร้าง + โพสต์ TikTok (สาธารณะ)</option>
        <option value="${POST_MODE_SAVE_DRAFT}">สร้าง + Save Draft</option>
        <option value="${POST_MODE_SCHEDULE}">สร้าง + ตั้งเวลาโพสต์</option>
        <option value="${POST_MODE_PRIVATE}">สร้าง + ตั้งโพสต์ส่วนตัว</option>
        <option value="${POST_MODE_GENERATE_ONLY}">สร้างไม่โพสต์</option>
      </select>
    </div>
    <div class="field" id="f-scheduleField" hidden>
      <label>เวลาที่จะโพสต์</label>
      <input type="datetime-local" id="f-scheduleAt" class="dt-input" step="60" aria-label="เวลาที่จะโพสต์" />
      <button type="button" class="sched-gap-note" id="schedGapNote" hidden></button>
    </div>
  </div>`;
}

// The raw delivery-selector value (one of the five POST_MODE_* constants), defaulting to
// AUTO when the form isn't rendered.
function postModeValue() {
  return $("f-postMode")?.value || POST_MODE_AUTO;
}

// True when the form's delivery selector is on "สร้างไม่โพสต์" (no upload) — the only mode
// that dims the Setting TikTok card.
function postModeIsGenerateOnly() {
  // generateOnly modes (Loop) have no delivery selector but are always generate-only, so
  // the publish card must dim for them too. [[flow-loop-mode]]
  return NAV[currentNav]?.generateOnly || postModeValue() === POST_MODE_GENERATE_ONLY;
}

// The scheduled post time ("YYYY-MM-DDTHH:MM") for the SCHEDULE mode, else "".
function postScheduleValue() {
  return postModeValue() === POST_MODE_SCHEDULE ? $("f-scheduleAt")?.value || "" : "";
}

// Per-post spacing for staggered batch posts (minutes). The operator sets it in the
// scheduleGapDialog popup; it's always a whole multiple of 5 (5/10/15/…). Default 60.
const SCHEDULE_GAP_DEFAULT_MIN = 60;
const SCHEDULE_GAP_MAX_MIN = 1440; // a full day — guardrail on a fat-fingered entry
const SCHEDULE_GAP_STEP_MIN = 5; // the interval steps in whole 5-minute increments
let scheduleGapMin = SCHEDULE_GAP_DEFAULT_MIN;

// Round to the nearest multiple of 5, clamped to [5, 1 day]. The operator wants the
// per-post spacing to land on 5/10/15/… only (no in-between values, never 0).
function snapGap5(v) {
  const n = Math.round(Number(v) / SCHEDULE_GAP_STEP_MIN) * SCHEDULE_GAP_STEP_MIN;
  if (!Number.isFinite(n)) return SCHEDULE_GAP_DEFAULT_MIN;
  return Math.max(SCHEDULE_GAP_STEP_MIN, Math.min(SCHEDULE_GAP_MAX_MIN, n));
}

// The chosen spacing between staggered batch posts, in minutes (read at submit).
function scheduleGapMinutes() {
  return scheduleGapMin;
}

// Add `minutes` to a naive-local "YYYY-MM-DDTHH:MM" string and re-emit the same shape.
// Goes through the Date(y,m,d,h,mi) local-component constructor so month/day/hour rollover
// is handled correctly, and never injects a timezone offset (the server parses publish_at
// as naive local — see parse_schedule_at in models.py).
function addMinutesToLocal(local, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || "");
  if (!m || !minutes) return local || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  d.setMinutes(d.getMinutes() + Math.round(minutes));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "540 นาที" → "9 ชม." for the spread hint; keeps minutes when there's a remainder.
function formatMinutesSpread(mins) {
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

// TikTok only accepts a scheduled time roughly 15 นาที – 10 วันล่วงหน้า. Mirror that window
// so a too-soon base, or a batch's later (staggered) rows past the ceiling, don't silently
// fail to schedule and degrade to STAGED. [[schedule-datetime-picker-and-batch-interval]]
const SCHEDULE_MIN_LEAD_MIN = 15;
const SCHEDULE_MAX_DAYS_AHEAD = 10;

// Minutes from now until a naive-local "YYYY-MM-DDTHH:MM" string (NaN if unparseable).
function minutesFromNow(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || "");
  if (!m) return NaN;
  return (new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() - Date.now()) / 60000;
}

// Guard a submit: SCHEDULE mode needs a time, and (for the batch fan-out) the first AND last
// staggered rows must land inside TikTok's ~15 นาที–10 วัน window — else those rows can't be
// scheduled and quietly degrade to STAGED. Returns false (and logs) to abort before queuing.
function validatePostMode() {
  if (postModeValue() !== POST_MODE_SCHEDULE) return true;
  const base = postScheduleValue();
  if (!base) {
    addLog("เลือก 'ตั้งเวลาโพสต์' แล้ว — กรุณาระบุวันและเวลาที่จะโพสต์ก่อน", "warn");
    return false;
  }
  const lead = minutesFromNow(base);
  if (!Number.isFinite(lead)) {
    addLog("วันและเวลาที่จะโพสต์ไม่ถูกต้อง", "warn");
    return false;
  }
  if (lead < SCHEDULE_MIN_LEAD_MIN) {
    addLog(`ตั้งเวลาล่วงหน้าอย่างน้อย ${SCHEDULE_MIN_LEAD_MIN} นาที — TikTok ไม่รับเวลาที่ใกล้เกินไปหรือเลยไปแล้ว`, "warn");
    return false;
  }
  // effective batch size = 2+ ticked products → one post each (else a single, un-staggered post).
  // The cart toggle no longer suppresses the batch — it only drops the Shop tag at post time.
  // Post-only staggers by CLIP, not by product (its own clip-based window guard lives in
  // submitPostOnlyJob), so its product count must not drive this window math. [[tiktok-post-only-mode]]
  const n = !NAV[currentNav]?.postOnly && productPick.products.length >= 2 ? productPick.products.length : 1;
  const lastLead = lead + scheduleGapMinutes() * (n - 1); // last row = base + gap ร— (N-1)
  if (lastLead > SCHEDULE_MAX_DAYS_AHEAD * 24 * 60) {
    addLog(
      `โพสต์สุดท้ายเลย ${SCHEDULE_MAX_DAYS_AHEAD} วัน — TikTok ตั้งเวลาล่วงหน้าได้ไม่เกิน ${SCHEDULE_MAX_DAYS_AHEAD} วัน ยท ลดระยะห่างหรือจำนวนสินค้า`,
      "warn"
    );
    return false;
  }
  return true;
}

function aspectOptionsHtml(set, selected = "") {
  return set
    .map(([v, t]) => `<option value="${v}"${v === selected ? " selected" : ""}>${escapeHtml(t)}</option>`)
    .join("");
}

// Aspect (ขนาด) selector. Most switch modes end on a video, so they default to the Veo
// set (portrait/landscape); a mode can override the list + the pre-selected ratio via
// m.aspects / m.defaultAspect (grok ships its own 5-ratio set, default 9:16).
function aspectHtml(m) {
  const set = m?.aspects || ASPECTS_VIDEO;
  const def = m?.defaultAspect || "";
  return `<div class="field">
    <label for="f-aspect">ขนาด <span class="opt">(Aspect)</span></label>
    <select id="f-aspect">${aspectOptionsHtml(set, def)}</select>
  </div>`;
}

// modes that bring their own aspect control (KIE: kieAspect) skip the generic one
function usesGenericAspect(m) {
  return !m.extra.includes("kieAspect");
}

// <option> list of saved (enabled) TikTok accounts — shared by the generate-form
// dropdown and the Product Showcase dropdown.
function tiktokAccountOptionsHtml() {
  return (lastAccounts || [])
    .filter((a) => a.provider === "tiktok" && a.enabled)
    .map(
      (a) =>
        `<option value="${escapeHtml(String(a.id))}">${escapeHtml(String(a.email || "TikTok account"))}</option>`
    )
    .join("");
}

// Dropdown of saved TikTok accounts to PUBLISH with. The container is ALWAYS
// emitted (hidden when empty) because the ui.state carrying accounts lands AFTER
// the first form render — populateGenerateTikTokSelect() fills it in then.
function tiktokAccountFieldHtml() {
  const opts = tiktokAccountOptionsHtml();
  return `<div class="field" id="tiktokAccountField"${opts ? "" : " hidden"}>
    <label for="f-tiktokAccount">บัญชี TikTok ที่จะโพสต์</label>
    <select id="f-tiktokAccount">${opts}</select>
    <p class="product-hint tt-lock-note" id="ttAccountLockNote" hidden></p>
  </div>`;
}

// Refresh the generate-form dropdown's options in place (preserving the selection)
// when accounts change after the form was first rendered.
function populateGenerateTikTokSelect() {
  const sel = $("f-tiktokAccount");
  const field = $("tiktokAccountField");
  if (!sel || !field) return;
  const cur = sel.value;
  const opts = tiktokAccountOptionsHtml();
  sel.innerHTML = opts;
  field.hidden = !opts;
  if (cur) sel.value = cur; // keep the user's pick if it's still in the list
  applyPublishAccountLock(); // re-assert the product lock against the fresh option list
}

// True while this form is about to PIN a showcase product (so the publish account is
// dictated by the product). Not pinning: generate-only modes (no post), the cart toggle
// off (no Shop tag), nothing ticked, or post-only with 2+ ticked (it tags exactly one).
function isPinningProduct() {
  const m = NAV[currentNav];
  if (!m || m.generateOnly || cartDisabled()) return false;
  // Post-only tags exactly ONE product across the staged clips (no per-product fan-out), so only a
  // single resolvable pick actually pins — 2+ ticked tags nothing, so don't lock the account then.
  // The generate modes batch-pin every ticked product, so any pick pins there. [[tiktok-post-only-mode]]
  if (m.postOnly) return productPick.products.length === 1;
  return productPick.products.length >= 1;
}

// A pinned product whose SOURCE account (productSourceAccountId) isn't an available
// publish option → the post can't tag it. The submit guards block the create here, and
// the server re-checks at the boundary. [[publish-account-must-match-product-source]]
function productSourceAccountMissing() {
  if (!isPinningProduct()) return false;
  const sel = $("f-tiktokAccount");
  const srcId = productSourceAccountId ? String(productSourceAccountId) : "";
  return !(srcId && sel && [...sel.options].some((o) => o.value === srcId));
}

// Submit guard: refuse to create when a pinned product's source account is unavailable
// (operator chose "block, don't create"). Logs a clear reason. [[publish-account-must-match-product-source]]
function blockIfProductSourceMissing() {
  if (!productSourceAccountMissing()) return false;
  addLog(
    "⛔ ปักตะกร้าไม่ได้: ไม่พบบัญชี TikTok ต้นทางของสินค้า — เปิดบัญชีนั้นใน Settings " +
      "หรือดึงสินค้าใหม่ใน Product Showcase ก่อน",
    "error"
  );
  applyPublishAccountLock(); // surface the warning note on the locked selector
  return true;
}

// While a showcase product is pinned, LOCK the publish-account selector to the account
// the product was pulled from (a product can only be tagged on its own account). When
// that account isn't available, show a warning — the submit guard then blocks the create.
// [[publish-account-must-match-product-source]]
function applyPublishAccountLock() {
  const sel = $("f-tiktokAccount");
  const note = $("ttAccountLockNote");
  if (!sel || !note) return;
  if (!isPinningProduct()) {
    sel.disabled = false;
    sel.removeAttribute("data-locked");
    note.hidden = true;
    return;
  }
  const srcId = productSourceAccountId ? String(productSourceAccountId) : "";
  const inList = !!srcId && [...sel.options].some((o) => o.value === srcId);
  sel.disabled = true; // the post account is dictated by the product, not chosen freely
  sel.dataset.locked = "1";
  note.hidden = false;
  if (inList) {
    sel.value = srcId;
    note.classList.remove("tt-lock-warn");
    note.textContent = `🔒 โพสต์ด้วยบัญชีที่ดึงสินค้ามา: ${productSourceAccountEmail || srcId}`;
  } else {
    sel.value = ""; // no valid source account → don't leave a stale/phantom pick behind
    note.classList.add("tt-lock-warn");
    note.textContent =
      "⛔ ไม่พบบัญชี TikTok ต้นทางของสินค้านี้ (อาจถูกปิด/ลบ หรือดึงผ่าน extension) — " +
      "เปิดบัญชีนั้นใน Settings หรือดึงสินค้าใหม่ ไม่งั้นปักตะกร้าไม่ได้";
  }
}

// ---- Product picker (the `productId` field) -------------------------------
// The pulled showcase products (Product Showcase view) are saved server-side and
// offered here so you PICK a product instead of pasting its ID. The chosen
// option's value IS the TikTok product_id (pinned to the basket on publish). A
// "พิมพ์ ID เอง" escape hatch keeps manual entry for products not in the list.
// A "หลายสินค้า" toggle turns the picker into a checklist → one clip per ticked
// product (each job differs only by product_id + an auto product-name caption).
const MAX_BATCH_PRODUCTS = 150; // guardrail: don't let one click queue hundreds of clips

// A mode's product picker shows the catalog only when its provider group is one of the
// sync targets the user chose in Product Showcase ("Sync สินค้า"). No auto-sync.
function currentGroupSynced() {
  const g = NAV[currentNav]?.group;
  return !!g && productSyncTargets.includes(g);
}
// Products this mode's picker may show: the catalog if synced here, else none.
// Post-only (โพสต์ TikTok) is the TikTok poster itself — the showcase pull is its own
// product source, so it always sees the full catalog (no "Sync to this mode" indirection).
// [[tiktok-post-only-mode]]
function visibleProducts() {
  if (NAV[currentNav]?.postOnly) return lastProducts || [];
  return currentGroupSynced() ? lastProducts || [] : [];
}
// Hint under an empty picker: nothing pulled vs pulled-but-not-synced-to-this-mode.
function productPickerHintText() {
  if (!(lastProducts || []).length) return "ดึงสินค้าใน Product Showcase ก่อน เพื่อเลือกจากรายการ";
  return "สินค้ายังไม่ได้ซิงค์มาที่โหมดนี้ — กด “Sync สินค้า” ใน Product Showcase";
}

// The current form's product selection — the single source of truth read at submit.
// Reset whenever the picker markup is (re)generated (the form rebuilds per mode).
//   products : the ticked products {id,title,image}. The picker is always multi-select.
//     0 ticked   → no product on the post
//     1 ticked   → that product is pinned; the Count field still fans out N clips
//     2+ ticked  → one standalone clip per product (see selectedBatchProducts)
let productPick = { products: [] };

// A saved product by id → {id,title,image,price} (rebuilds picks / trigger from ids).
function productById(id) {
  const p = (lastProducts || []).find((x) => String(x.id) === String(id));
  return p
    ? { id: String(p.id), title: p.title || "", image: p.image || "", price: p.price || "" }
    : { id: String(id), title: "", image: "", price: "" };
}

// Trigger-button summary: a lead tile/thumbnail + a two-line title/desc. Shows the one
// pick (name + price), a "N สินค้า" count, or the empty "เลือกสินค้า" prompt. Reuses the
// shared PP_BAG_SVG (defined with the popup below; available by the time this runs).
function productPickSummaryHtml() {
  const picks = productPick.products;
  const bagTile = `<span class="pp-trigger-ico" aria-hidden="true">${PP_BAG_SVG}</span>`;
  // empty state = a clear "add" affordance: a + tile (the trigger itself goes dashed)
  const addTile = `<span class="pp-trigger-ico pp-trigger-ico-add" aria-hidden="true">${PP_PLUS_SVG}</span>`;
  const wrap = (lead, title, desc, phClass = "") =>
    `${lead}<span class="pp-trigger-text">
      <span class="pp-trigger-title${phClass}">${title}</span>
      <span class="pp-trigger-desc">${desc}</span>
    </span>`;
  if (picks.length === 1) {
    const p = picks[0];
    const lead = p.image
      ? `<img class="pp-trigger-thumb" src="${escapeHtml(p.image)}" alt="" />`
      : bagTile;
    return wrap(lead, escapeHtml(p.title || "#" + p.id), p.price ? escapeHtml(p.price) : "ปักลงตะกร้าคลิป");
  }
  if (picks.length > 1) {
    return wrap(bagTile, `เลือกแล้ว ${picks.length} สินค้า`, "1 คลิป / สินค้า");
  }
  return wrap(addTile, "เลือกสินค้า", "แตะเพื่อปักสินค้าลงตะกร้า", " pp-trigger-ph");
}

// The picker field: a "เลือกสินค้า" trigger button (opens the popup) + clear + hint.
function productPickerHtml() {
  productPick = { products: [] };
  const d = FIELD_DEFS.productId;
  const hasProducts = visibleProducts().length > 0;
  return `<div class="field" id="productPickerField">
    <div class="picker-head">
      <label>${escapeHtml(d.label)} <span class="opt">${escapeHtml(d.opt)}</span></label>
      <button type="button" class="btn tiny picker-clear" id="productClear"${
        hasProducts ? "" : " hidden"
      }>🗑 ล้างสินค้า</button>
    </div>
    <button type="button" class="product-pick-trigger" id="productPickBtn" aria-haspopup="dialog">
      <span class="pp-trigger-main" id="productPickLabel">${productPickSummaryHtml()}</span>
      <span class="pp-trigger-caret" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </button>
    <p class="product-hint muted-text" id="productPickerHint"${hasProducts ? " hidden" : ""}>
      ${escapeHtml(productPickerHintText())}
    </p>
  </div>`;
}

// Repaint the trigger label from `productPick` (after a pick or a fresh pull).
function refreshProductTrigger() {
  const label = $("productPickLabel");
  if (label) label.innerHTML = productPickSummaryHtml();
  // The batch-interval control depends on how many products are ticked — keep it in sync.
  applyScheduleIntervalUI();
  applyPublishAccountLock(); // ticking/clearing a product locks/unlocks the publish account
  refreshSubmitState(); // a product is required to enqueue — keep the button in sync
}

// Refresh the open form's picker when the saved products change (a fresh pull lands, or
// the sync targets change). Drops picks that vanished from the catalog and repaints.
function populateProductPickers() {
  const field = $("productPickerField");
  if (!field) return;
  const products = visibleProducts();
  const hasProducts = products.length > 0;
  const ids = new Set(products.map((p) => String(p.id)));
  productPick.products = productPick.products.filter((p) => ids.has(String(p.id)));
  const clearBtn = $("productClear");
  if (clearBtn) clearBtn.hidden = !hasProducts;
  const hint = $("productPickerHint");
  if (hint) {
    hint.hidden = hasProducts;
    hint.textContent = productPickerHintText();
  }
  refreshProductTrigger();
}

// The resolved TikTok product id when exactly ONE product is ticked (Count still fans
// out N clips of it); "" for none or for 2+ (which selectedBatchProducts() handles).
function productIdValue() {
  return productPick.products.length === 1 ? String(productPick.products[0].id) : "";
}

// 2+ ticked products → one standalone clip per product; else null (single / none path).
function selectedBatchProducts() {
  if (productPick.products.length < 2) return null;
  return productPick.products.map((p) => ({
    id: String(p.id),
    title: p.title || "",
    image: p.image || "", // product cover → Reference column
  }));
}

// The cover image URL of a saved product by id ("" if unknown). Feeds the
// Reference column for single-pick jobs (batch jobs carry it per product).
function productImageFor(productId) {
  if (!productId) return "";
  const p = (lastProducts || []).find((x) => String(x.id) === String(productId));
  return p?.image || "";
}

// The title of a saved product by id ("" if unknown / manual). Fed to the server's
// AI "thinking" step as the product the LLM writes the sell script about.
function productTitleFor(productId) {
  if (!productId) return "";
  const p = (lastProducts || []).find((x) => String(x.id) === String(productId));
  return p?.title || "";
}

// Drop standalone SKU/article-number tokens (>=5 digits, e.g. "4113180") from a product
// title before it becomes a caption — keeps 4-digit years like "2026" and short numbers,
// falls back to the original if stripping empties it. Mirror of Hub._clean_product_title
// (hub.py); change both together. [[tiktok-caption-and-disclosure-toggles]]
const SKU_MIN_DIGITS = 5;
function cleanProductTitle(title) {
  const raw = (title || "").trim();
  if (!raw) return "";
  const kept = raw.split(/\s+/).filter((tok) => {
    const numeric = /^#?\d[\d\-/._]*$/.test(tok);
    const digits = (tok.match(/\d/g) || []).length;
    return !(numeric && digits >= SKU_MIN_DIGITS);
  });
  return kept.join(" ").trim() || raw;
}

// The characterImages option for ONE queued clip, given the character popup's result:
//   1 character        → that image on every clip
//   2 + "same"         → both images on every clip
//   2 + "random"       → each clip gets ONE of the two, picked at random (variety)
// "" when no characters were chosen. Called once per clip, so "random" re-rolls each.
function charImagesForJob(charCfg) {
  const chars = (charCfg && charCfg.characters) || [];
  if (!chars.length) return "";
  if (chars.length === 1) return chars[0];
  if (charCfg.distribution === "random") return chars[Math.floor(Math.random() * chars.length)];
  return chars.join(", ");
}

// Send a job once (single) or fan out one STANDALONE job per ticked product (batch:
// each clip differs only by product_id + a per-product caption). No batch_id: every
// product is its own grid row and auto-publishes with its own product tag. `charCfg`
// (from the character popup) injects per-clip character reference image(s). `pinProducts`
// false ("ปิดปักตะกร้า") keeps the product as a generation reference — each row still carries
// the cover/name — but drops its Shop TAG (product_id is nulled, so the post isn't pinned).
// Returns the number of jobs queued, or 0 if a batch was requested but invalid.
function dispatchJob(data, products, charCfg, pinProducts = true) {
  if (!products) {
    const ci = charImagesForJob(charCfg);
    const options = ci ? { ...data.options, characterImages: ci } : data.options;
    send({ type: "job.submit", data: { ...data, options } });
    return 1;
  }
  if (!products.length) {
    addLog("ติ๊กเลือกสินค้าอย่างน้อย 1 รายการ", "warn");
    return 0;
  }
  if (products.length > MAX_BATCH_PRODUCTS) {
    addLog(`เลือกได้สูงสุด ${MAX_BATCH_PRODUCTS} รายการต่อครั้ง — เอาออกบางรายการก่อน`, "warn");
    return 0;
  }
  // SCHEDULE delivery + a batch → stagger each product's post time so they don't all fire
  // at once. Row i posts at base + i ร— gap minutes (i=0 keeps the base). gap=0 (or any
  // other delivery mode / no base time) leaves every row on the same publish_at.
  const gapMin = data.publish_mode === POST_MODE_SCHEDULE ? scheduleGapMinutes() : 0;
  products.forEach((p, i) => {
    const options = { ...data.options };
    if (p.image) options.productImage = p.image; // product cover → Reference column
    // product name for the AI script / direction pick (internal — stripped before provider)
    if (p.title) options.productTitle = p.title;
    const ci = charImagesForJob(charCfg); // re-rolled per product when distribution=random
    if (ci) options.characterImages = ci;
    const publishAt =
      gapMin && data.publish_at ? addMinutesToLocal(data.publish_at, gapMin * i) : data.publish_at;
    send({
      type: "job.submit",
      data: {
        ...data,
        count: 1, // one clip per product
        publish_at: publishAt, // staggered per row in SCHEDULE mode
        options,
        target: {
          ...data.target,
          product_id: pinProducts ? p.id : null, // cart off → reference only, no Shop tag pinned
          caption: data.target.caption || cleanProductTitle(p.title),
        },
      },
    });
  });
  return products.length;
}

// Pick fills the caption with the product name (only while empty or still auto-filled,
// so a hand-typed caption is never clobbered). The input listener clears the flag.
function autofillCaptionFromProduct(productId) {
  const cap = $("f-caption");
  if (!cap || !productId) return;
  const p = (lastProducts || []).find((x) => String(x.id) === String(productId));
  if (!p) return;
  if (!cap.value.trim() || cap.dataset.autofilled === "1") {
    cap.value = cleanProductTitle(p.title);
    cap.dataset.autofilled = "1";
  }
}

// ---- Image lightbox -------------------------------------------------------
// A full-size product-image preview, layered ABOVE the picker modal. It has its own
// overlay + Esc handler (not the shared activeModal) so it never closes the picker.
let imageLightboxOpen = false;
function openImageLightbox(url, title) {
  const lb = document.createElement("div");
  lb.className = "img-lightbox";
  lb.innerHTML = `<figure class="img-lightbox-fig">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(title || "")}" />
      ${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ""}
    </figure>
    <button type="button" class="img-lightbox-close" aria-label="ปิด">✕</button>`;
  const close = () => {
    imageLightboxOpen = false;
    document.removeEventListener("keydown", onKey, true);
    lb.classList.remove("open");
    setTimeout(() => lb.remove(), 150);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  lb.addEventListener("click", close); // click anywhere (backdrop, image, ✕) closes
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(lb);
  imageLightboxOpen = true;
  requestAnimationFrame(() => lb.classList.add("open"));
}

// ---- Product image chooser ------------------------------------------------
// Fetch a product's FULL gallery on demand (server-side detail call) and let the user
// pick which image becomes that product's cover — used by the picker, the Reference
// column, and the AI thinking step. Has its OWN overlay (not the shared activeModal)
// so it can stack ABOVE the picker popup. Best-effort: if the detail call returns
// nothing it still offers the known cover. [[product-picker-from-showcase]]
function dedupeStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  return out;
}

async function fetchProductImages(productId) {
  const acc = $("ttAccount")?.value || ""; // use the Showcase account if one is picked
  const qs = new URLSearchParams({ productId: String(productId) });
  if (acc) qs.set("tiktokAccountId", acc);
  try {
    return await (await fetch(`/api/product-images?${qs.toString()}`)).json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Apply a chosen cover everywhere at once: the local mirror, the current pick mirror,
// any visible thumbnails (showcase table + open picker popup), and the picker trigger;
// then persist server-side (best-effort) so it survives a restart.
function applyProductImage(productId, url) {
  const id = String(productId);
  const p = (lastProducts || []).find((x) => String(x.id) === id);
  if (p) p.image = url;
  const picked = productPick.products.find((x) => String(x.id) === id);
  if (picked) picked.image = url;
  // live-update every visible cover; the picker's "ดู" button reads the image from
  // lastProducts at click time, so it needs no DOM patch here.
  $$(`[data-prod-img="${CSS.escape(id)}"]`).forEach((img) => {
    img.src = url;
  });
  refreshProductTrigger();
  const form = new FormData();
  form.append("productId", id);
  form.append("image", url);
  fetch("/api/product-image", { method: "POST", body: form }).catch(() => {});
  addLog("ตั้งรูปสินค้าแล้ว", "info");
}

function chooseProductImage(productId) {
  const p = (lastProducts || []).find((x) => String(x.id) === String(productId));
  if (!p) return Promise.resolve(null);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay img-chooser";
    overlay.innerHTML = `
      <div class="modal char-modal" role="dialog" aria-modal="true" aria-labelledby="piTitle">
        <h3 class="modal-title" id="piTitle">เลือกรูปสินค้า</h3>
        <p class="modal-hint">${escapeHtml(p.title || "#" + p.id)}</p>
        <div class="pi-grid" data-pi-grid><p class="muted-text">⏳ กำลังดึงรูปสินค้า…</p></div>
        <div class="modal-actions"><button type="button" class="btn ghost" data-pi-cancel>ปิด</button></div>
      </div>`;
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), 150);
      resolve(val);
    };
    const renderGrid = (images, note) => {
      const grid = overlay.querySelector("[data-pi-grid]");
      if (!grid) return;
      if (!images.length) {
        grid.innerHTML = '<p class="muted-text">ไม่พบรูปสินค้า</p>';
        return;
      }
      grid.innerHTML =
        (note ? `<p class="muted-text pi-note">${escapeHtml(note)}</p>` : "") +
        `<div class="pi-thumbs">${images
          .map(
            (u) =>
              `<button type="button" class="pi-thumb${
                u === p.image ? " active" : ""
              }" data-pi-pick="${escapeHtml(u)}"><img src="${escapeHtml(u)}" alt="" loading="lazy" /></button>`
          )
          .join("")}</div>`;
    };
    overlay.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-pi-pick]");
      if (pick) {
        applyProductImage(productId, pick.dataset.piPick);
        close(pick.dataset.piPick);
        return;
      }
      if (e.target.closest("[data-pi-cancel]") || e.target === overlay) close(null);
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    fetchProductImages(productId).then((res) => {
      if (done) return; // chooser already closed
      const base = p.image ? [p.image] : [];
      const imgs = dedupeStrings([...base, ...((res && res.images) || [])]);
      const note =
        res && res.ok === false
          ? res.error
            ? `ดึงรูปเพิ่มไม่สำเร็จ: ${res.error}`
            : "ดึงรูปเพิ่มไม่สำเร็จ — แสดงเฉพาะรูปปก"
          : imgs.length <= 1
            ? "TikTok ส่งรูปมาใบเดียวสำหรับสินค้านี้"
            : "";
      renderGrid(imgs, note);
    });
  });
}

// Showcase table: clicking a product's รูป opens the chooser (this listener is safe
// to add alongside the existing document click handlers — distinct attribute).
document.addEventListener("click", (e) => {
  const ci = e.target.closest("[data-choose-image]");
  if (ci) chooseProductImage(ci.dataset.chooseImage);
});

// ---- Product picker popup -------------------------------------------------
// The "เลือกสินค้า" trigger opens this. It's a multi-select list: tick one product (the
// Count field still fans out N clips of it) or several (one standalone clip per product).
// Tap a product's cover to preview it full-size. Resolves the ticked products (mirrored
// into `productPick`), or null on cancel. [[product-picker-from-showcase]]
const PP_BAG_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1a1206"
  stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 7h12l-1.1 13H7.1L6 7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>`;
// "+" plus glyph for the picker trigger's empty/add state
const PP_PLUS_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1a1206"
  stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>`;

// Filter by the search query and (optionally) hide products already generated — so a
// big batch can target only fresh products. `draft` may be just a query string (legacy
// callers) or the picker draft {query, hideUsed}.
function ppFilter(products, draft) {
  const query = typeof draft === "string" ? draft : draft.query;
  const hideUsed = typeof draft === "string" ? false : !!draft.hideUsed;
  const onlyUsed = typeof draft === "string" ? false : !!draft.onlyUsed;
  const q = String(query || "").trim().toLowerCase();
  return products.filter((p) => {
    const used = Number(p.usedCount) > 0;
    if (hideUsed && used) return false; // ซ่อนที่เคยสร้าง → keep only fresh products
    if (onlyUsed && !used) return false; // เฉพาะที่สร้างแล้ว → keep only generated products
    if (!q) return true;
    return String(p.title || "").toLowerCase().includes(q) || String(p.id).includes(q);
  });
}
// How many of the offered products have already been generated (for the toggle label).
function ppUsedCount(products) {
  return products.reduce((n, p) => n + (Number(p.usedCount) > 0 ? 1 : 0), 0);
}

// One selectable product row: cover (tap = preview) + name + price/id + a "เลือกรูป"
// affordance (opens the image chooser) + a check pip. `pp-row` is a <button>, so the
// inner controls are spans with role=button (no nested-button), handled via their
// data-attrs in the picker's click handler.
function ppRowHtml(p, draft) {
  const id = String(p.id);
  const sel = draft.ids.has(id);
  const used = Number(p.usedCount) > 0; // already generated at least one clip
  // The cover no longer opens the lightbox — tapping anywhere on the card (cover
  // included) toggles selection. A dedicated "ดู" button handles the preview.
  const thumb = p.image
    ? `<img class="pp-thumb" data-prod-img="${escapeHtml(id)}" src="${escapeHtml(
        p.image
      )}" alt="" loading="lazy" draggable="false" />`
    : `<span class="pp-thumb pp-thumb-blank">🛍</span>`;
  const sub = p.price ? escapeHtml(p.price) : `#${escapeHtml(id)}`;
  // "เคยสร้างแล้ว" tag (with the clip count when >1) — still selectable, so the user
  // can knowingly reuse it; the hide-used toggle filters these out when unwanted.
  const usedTag = used
    ? `<span class="pp-used-tag" title="เคยสร้างคลิปจากสินค้านี้แล้ว">✓ เคยสร้างแล้ว${
        Number(p.usedCount) > 1 ? ` ร—${Number(p.usedCount)}` : ""
      }</span>`
    : "";
  // Floating cover actions (bottom-right): "ดู" previews the cover full-size (only when
  // there IS a cover), "รูป" opens the image chooser. Both stop the row-select click.
  const viewBtn = p.image
    ? `<span class="pp-media-btn pp-row-view" data-pp-view="${escapeHtml(
        id
      )}" role="button" tabindex="0" title="ดูรูปใหญ่">👁 ดู</span>`
    : "";
  // Card layout: the cover fills the top with its controls floated over it (badge /
  // select pip / actions), then the name + price sit below.
  return `<button type="button" class="pp-row${sel ? " selected" : ""}${
    used ? " is-used" : ""
  }" data-pp-id="${escapeHtml(id)}">
    <span class="pp-media">
      ${thumb}
      ${usedTag}
      <span class="pp-check" aria-hidden="true"></span>
      <span class="pp-media-actions">
        ${viewBtn}
        <span class="pp-media-btn pp-row-choose" data-pp-choose-img="${escapeHtml(id)}" role="button" tabindex="0" title="เลือก/เปลี่ยนรูปสินค้า">🖼 รูป</span>
      </span>
    </span>
    <span class="pp-row-text">
      <span class="pp-row-name">${escapeHtml(p.title || "#" + id)}</span>
      <span class="pp-row-sub">${sub}</span>
    </span>
  </button>`;
}

function ppListHtml(products, draft) {
  if (!products.length) return `<p class="pp-empty">${escapeHtml(productPickerHintText())}</p>`;
  const shown = ppFilter(products, draft);
  if (!shown.length) {
    let why;
    if (draft.hideUsed) {
      why = "ไม่มีสินค้าที่ยังไม่เคยสร้าง (ปิด “ซ่อนที่เคยสร้าง” เพื่อใช้ซ้ำ)";
    } else if (draft.onlyUsed) {
      why = "ยังไม่มีสินค้าที่เคยสร้างคลิป (ปิด “เฉพาะที่สร้างแล้ว” เพื่อดูทั้งหมด)";
    } else {
      why = `ไม่พบสินค้าที่ตรงกับ “${escapeHtml(draft.query.trim())}”`;
    }
    return `<p class="pp-empty">${why}</p>`;
  }
  return shown.map((p) => ppRowHtml(p, draft)).join("");
}

function productPickerDialogHtml(products, draft) {
  const has = products.length > 0;
  return `
    <div class="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="ppTitle">
      <div class="sync-head">
        <span class="sync-head-ico" aria-hidden="true">${PP_BAG_SVG}</span>
        <div class="sync-head-text">
          <h3 class="modal-title" id="ppTitle">เลือกสินค้า</h3>
          <p class="sync-sub">ติ๊ก (หรือ กดค้างแล้วลาก) สินค้าที่จะปักลงตะกร้า — เลือกได้หลายชิ้น (1 คลิป/สินค้า) ยท แตะรูปเพื่อดูใหญ่</p>
        </div>
      </div>
      <div class="pp-search"${has ? "" : " hidden"}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
        <input type="text" id="ppSearch" placeholder="ค้นหาชื่อสินค้า…" autocomplete="off" value="${escapeHtml(draft.query)}" />
      </div>
      <div class="pp-controls"${has ? "" : " hidden"}>
        <span class="pp-count" id="ppCount"></span>
        <div class="pp-batch-tools">
          <button type="button" class="pp-link" data-pp-all>เลือกทั้งหมด</button>
          <span class="pp-sep" aria-hidden="true">ยท</span>
          <button type="button" class="pp-link" data-pp-none>ล้าง</button>
        </div>
      </div>
      ${ppUsedCount(products) > 0
        ? `<div class="pp-filters">
        <label class="pp-hideused" title="ซ่อนสินค้าที่เคยสร้างคลิปไปแล้ว — เปิดเพื่อเลือกเฉพาะสินค้าใหม่">
          <input type="checkbox" id="ppHideUsed"${draft.hideUsed ? " checked" : ""} />
          <span>ซ่อนสินค้าที่เคยสร้างแล้ว (${ppUsedCount(products)})</span>
        </label>
        <label class="pp-hideused" title="แสดงเฉพาะสินค้าที่เคยสร้างคลิปไปแล้ว">
          <input type="checkbox" id="ppOnlyUsed"${draft.onlyUsed ? " checked" : ""} />
          <span>เฉพาะสินค้าที่สร้างแล้ว (${ppUsedCount(products)})</span>
        </label>
      </div>`
        : ""}
      <div class="pp-list" id="ppList">${ppListHtml(products, draft)}</div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-modal="cancel">ยกเลิก</button>
        <button type="button" class="btn primary" data-modal="ok">เลือก</button>
      </div>
    </div>`;
}

function productPickerDialog(current) {
  if (activeModal) closeModal(null); // one modal at a time
  const products = visibleProducts();
  const draft = {
    ids: new Set((current.products || []).map((p) => String(p.id))),
    query: "",
    hideUsed: false, // when on, products already generated are filtered out of the list
    onlyUsed: false, // when on, show ONLY products already generated (opposite of hideUsed)
  };
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = productPickerDialogHtml(products, draft);

    const setCount = () => {
      const c = overlay.querySelector("#ppCount");
      if (c) c.textContent = `เลือก ${draft.ids.size} / ${products.length}`;
    };
    const renderList = () => {
      const box = overlay.querySelector("#ppList");
      if (box) box.innerHTML = ppListHtml(products, draft);
      setCount();
    };
    setCount();

    // ---- drag-to-paint selection ----------------------------------------
    // Press a card to begin, then drag across cards to apply the SAME action to
    // each: select if the first card was unselected, otherwise deselect. A plain
    // click still toggles a single card via the click handler below — we only arm
    // `swallowNextRowClick` after a paint so the trailing synthetic click is
    // ignored once. Keyboard activation (Space/Enter on a focused card) has no
    // pointerdown, so it never arms the flag and keeps toggling normally.
    const list = overlay.querySelector("#ppList");
    let painting = false;
    let paintSelect = false; // true = adding to selection, false = removing
    let swallowNextRowClick = false;
    let capturedPointer = null;
    const rowAtPoint = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest("[data-pp-id]") : null;
    };
    const paintRow = (row) => {
      if (!row) return;
      const id = row.dataset.ppId;
      const has = draft.ids.has(id);
      if (paintSelect && !has) {
        draft.ids.add(id);
        row.classList.add("selected");
      } else if (!paintSelect && has) {
        draft.ids.delete(id);
        row.classList.remove("selected");
      } else return; // already in the target state — nothing to repaint
      setCount();
    };
    const endPaint = () => {
      if (!painting) return;
      painting = false;
      list.classList.remove("painting");
      if (capturedPointer != null) {
        try {
          list.releasePointerCapture(capturedPointer);
        } catch (_) {}
        capturedPointer = null;
      }
    };
    if (list) {
      list.addEventListener("pointerdown", (e) => {
        swallowNextRowClick = false; // drop any stale arm from a missed click
        if (e.button > 0) return; // primary button / touch / pen only
        // never start a drag from the cover action buttons (ดู / รูป)
        if (e.target.closest("[data-pp-view],[data-pp-choose-img]")) return;
        const row = e.target.closest("[data-pp-id]");
        if (!row) return;
        e.preventDefault(); // block native image drag + text selection
        painting = true;
        list.classList.add("painting");
        paintSelect = !draft.ids.has(row.dataset.ppId); // first card sets direction
        capturedPointer = e.pointerId;
        try {
          list.setPointerCapture(e.pointerId);
        } catch (_) {}
        paintRow(row);
      });
      list.addEventListener("pointermove", (e) => {
        if (!painting) return;
        paintRow(rowAtPoint(e.clientX, e.clientY));
      });
      list.addEventListener("pointerup", () => {
        if (painting) swallowNextRowClick = true; // swallow the trailing click once
        endPaint();
      });
      list.addEventListener("pointercancel", endPaint);
    }

    overlay.addEventListener("click", (e) => {
      // a drag-paint just ran → consume its trailing synthetic click (any target,
      // so a multi-card drag whose click lands on the list never leaves it armed)
      const swallowRow = swallowNextRowClick;
      swallowNextRowClick = false;
      const modalBtn = e.target.closest("[data-modal]");
      if (modalBtn) {
        if (modalBtn.dataset.modal !== "ok") return closeModal(null);
        return closeModal({ products: [...draft.ids].map(productById) });
      }
      if (e.target === overlay) return closeModal(null); // backdrop = cancel

      // tap "เลือกรูป" → open the image chooser (stacks above; don't toggle the row)
      const choose = e.target.closest("[data-pp-choose-img]");
      if (choose) {
        e.stopPropagation();
        chooseProductImage(choose.dataset.ppChooseImg);
        return;
      }
      // tap "ดู" → preview the current cover full-size (read live image, not the row)
      const view = e.target.closest("[data-pp-view]");
      if (view) {
        e.stopPropagation();
        const prod = productById(view.dataset.ppView);
        if (prod.image) openImageLightbox(prod.image, prod.title);
        return;
      }
      // toggle a row's selection (cover included) — update just that row so scroll holds
      const row = e.target.closest("[data-pp-id]");
      if (row) {
        if (swallowRow) return; // drag-paint already set this card's state
        const id = row.dataset.ppId;
        if (draft.ids.has(id)) {
          draft.ids.delete(id);
          row.classList.remove("selected");
        } else {
          draft.ids.add(id);
          row.classList.add("selected");
        }
        setCount();
        return;
      }
      if (e.target.closest("[data-pp-all]")) {
        // select all currently VISIBLE (respects search + hide-used), so "เลือกทั้งหมด"
        // with hide-used on picks only the fresh products
        ppFilter(products, draft).forEach((p) => draft.ids.add(String(p.id)));
        renderList();
        return;
      }
      if (e.target.closest("[data-pp-none]")) {
        draft.ids.clear();
        renderList();
        return;
      }
    });

    overlay.addEventListener("input", (e) => {
      if (e.target.id === "ppSearch") {
        draft.query = e.target.value;
        renderList();
      } else if (e.target.id === "ppHideUsed") {
        draft.hideUsed = e.target.checked;
        // mutually exclusive with "เฉพาะที่สร้างแล้ว" — both on would show nothing
        if (draft.hideUsed && draft.onlyUsed) {
          draft.onlyUsed = false;
          const other = overlay.querySelector("#ppOnlyUsed");
          if (other) other.checked = false;
        }
        renderList();
      } else if (e.target.id === "ppOnlyUsed") {
        draft.onlyUsed = e.target.checked;
        if (draft.onlyUsed && draft.hideUsed) {
          draft.hideUsed = false;
          const other = overlay.querySelector("#ppHideUsed");
          if (other) other.checked = false;
        }
        renderList();
      }
    });

    const onKey = (e) => {
      if (e.key === "Escape" && !imageLightboxOpen) {
        e.preventDefault();
        closeModal(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector("#ppSearch")?.focus();
    });
  });
}

// Auto-sync the CURRENT mode's provider group into the pulled catalog so its picker can
// show the products right away — this replaces the old "choose which mode" dialog for the
// click-to-pick flow. Independent per mode: we ADD this group to the existing targets
// (optimistic local update + persist to the server), so syncing Flow never unsyncs
// SuperGrok and vice versa. No-op if already synced or the mode has no group.
// [[product-picker-from-showcase]]
function autoSyncCurrentGroup() {
  const g = NAV[currentNav]?.group;
  if (!g || productSyncTargets.includes(g)) return;
  productSyncTargets = [...productSyncTargets, g]; // optimistic → visibleProducts() unlocks now
  send({ type: "tiktok.syncProducts", data: { targets: productSyncTargets } });
  populateProductPickers(); // repaint this form's picker field (hint/clear) immediately
  updateSyncState(); // keep the Product Showcase "ซิงค์อยู่: …" label in step
}

// Trigger handler: route the "เลือกสินค้า" click by showcase state instead of opening an
// empty picker. Nothing pulled → jump to Product Showcase (pull there first). Pulled but
// not synced to this mode → auto-sync THIS mode on the spot (no dialog) and fall straight
// through to the picker. Then open the real multi-select popup, mirror the ticked products
// into `productPick`, repaint the trigger, and auto-fill the caption from a single pick's
// name. [[product-picker-from-showcase]]
async function openProductPicker() {
  // No catalog yet → send the user to Product Showcase to pull one.
  if (!(lastProducts || []).length) {
    addLog("ยังไม่มีสินค้า — ดึงจาก Product Showcase ก่อน", "warn");
    setNav("product-showcase");
    return;
  }
  // Pulled, but this mode isn't a sync target → auto-sync just THIS mode and continue,
  // instead of popping a dialog asking which mode to sync.
  if (!currentGroupSynced()) autoSyncCurrentGroup();
  const res = await productPickerDialog(productPick);
  if (res === null) return; // cancelled
  productPick = { products: res.products };
  refreshProductTrigger();
  if (res.products.length === 1) autofillCaptionFromProduct(String(res.products[0].id));
}

// ---- form sections ("Setting <provider>" + "Setting TikTok") ----
function providerSectionLabel(m) {
  return PROVIDER_SECTION_LABEL[m.group] || m.label || "Generation";
}

// A titled settings group. `opts.tag` adds a small source chip on the right.
function formSectionHtml(title, body, opts = {}) {
  const tag = opts.tag
    ? `<span class="form-sec-tag ${opts.tagClass || ""}">${escapeHtml(opts.tag)}</span>`
    : "";
  return `<section class="form-sec"${opts.id ? ` id="${opts.id}"` : ""}>
    <div class="form-sec-head"><span class="form-sec-title">${escapeHtml(title)}</span>${tag}</div>
    <div class="form-sec-body">${body}</div>
  </section>`;
}

// The provider section wraps a mode's generation controls; its title names the engine
// ("Setting Google Flow" / "SuperGrok" / "KIE") with a chip for the source.
function providerSectionHtml(m, body) {
  return formSectionHtml(`Setting ${providerSectionLabel(m)}`, body, {
    tag: SOURCE_LABEL[m.provider],
    tagClass: `src-${m.provider}`,
  });
}

// "Setting TikTok": the publish toggles, the product picker (always shown — it also feeds
// image generation, not just the Shop tag), and the account dropdown — everything that
// shapes the TikTok post. "ปิดปักตะกร้า" only drops the Shop tag at post time, not the picker.
function tiktokSectionHtml(m) {
  // Banner modes (Loop) fold the product picker INTO the Banner card (see bannerSectionHtml),
  // so this card is dropped entirely — the product moves there, banner doesn't replace it.
  // [[flow-loop-mode]]
  if (m.banner) return "";
  const picker = m.base.includes("productId") ? productPickerHtml() : "";
  // Generate-only modes never post → only the product picker (it feeds image generation as a
  // reference); hide the publish toggles + TikTok-account dropdown.
  const body = m.generateOnly
    ? picker
    : tiktokTogglesHtml() + picker + tiktokAccountFieldHtml();
  return formSectionHtml("Setting TikTok", body, {
    id: "tiktokSection",
    tag: "tiktok",
    tagClass: "src-tiktok",
  });
}

// Loop's combined "สินค้า & Banner" card: the product picker (moved here from the old Setting
// TikTok card — it feeds image generation) PLUS the banner overlay (upload + placement + a live
// draggable 9:16 preview). The banner block stays hidden until the toggle is on. The backend
// composites the banner onto the finished looping video via ffmpeg. [[flow-loop-mode]]
function bannerSectionHtml(m) {
  const picker = m.base.includes("productId") ? productPickerHtml() : "";
  const body = `${picker}
    <div class="banner-sep"></div>
    ${tkToggleRow("bannerEnabled", "แปะ Banner (ป้าย SALE) ทับวิดีโอ", false)}
    <p class="banner-note" id="bannerNote">ถ้าไม่อัปรูป ระบบจะสร้างป้าย SALE ให้อัตโนมัติ — ลากรูปบนพรีวิวเพื่อจัดตำแหน่ง/ขนาดได้เลย</p>
    <div class="banner-body" id="bannerFields" hidden>
      <div class="banner-layout">
        <div class="banner-preview-col">
          <div class="banner-preview" id="bannerPreview" title="ลากเพื่อย้าย • ลากมุมเพื่อย่อ/ขยาย">
            <span class="banner-preview-tag">วิดีโอ 9:16</span>
            <div class="banner-preview-item" id="bannerPreviewItem" hidden>
              <img class="banner-preview-img" id="bannerPreviewImg" alt="banner" draggable="false" />
              <span class="banner-resize-handle" id="bannerResizeHandle" title="ลากเพื่อปรับขนาด"></span>
            </div>
          </div>
          <div class="banner-preview-cap" id="bannerPreviewCap">ลากเพื่อย้าย • ลากมุมเพื่อย่อ/ขยาย</div>
        </div>
        <div class="banner-controls">
          <div class="field">
            <label>รูป Banner <span class="opt">(ไม่ใส่ = AI สร้างป้าย SALE ให้)</span></label>
            <div class="banner-upload">
              <button type="button" class="btn-soft" id="bannerUploadBtn">อัปโหลดรูปเอง…</button>
              <button type="button" class="btn-ghost" id="bannerClearBtn" hidden>ใช้ AI สร้างแทน</button>
              <input type="file" accept="image/*" id="bannerFile" hidden />
              <input type="hidden" id="f-bannerImage" />
            </div>
          </div>
          <div class="banner-grid">
            <div class="field"><label for="f-bannerSize">ขนาด <span class="opt">(% กว้าง)</span></label>
              <input type="number" id="f-bannerSize" min="5" max="80" value="80" /></div>
            <div class="field"><label for="f-bannerOpacity">ความโปร่งใส <span class="opt">(%)</span></label>
              <input type="number" id="f-bannerOpacity" min="0" max="100" value="100" /></div>
            <div class="field"><label for="f-bannerX">ตำแหน่ง X <span class="opt">(%)</span></label>
              <input type="number" id="f-bannerX" min="0" max="100" value="50" /></div>
            <div class="field"><label for="f-bannerY">ตำแหน่ง Y <span class="opt">(%)</span></label>
              <input type="number" id="f-bannerY" min="0" max="100" value="14" /></div>
            <div class="field banner-shape-field"><label for="f-bannerShape">รูปทรง</label>
              <select id="f-bannerShape"><option value="square">สี่เหลี่ยม</option><option value="circle">วงกลม</option></select></div>
          </div>
        </div>
      </div>
    </div>`;
  return formSectionHtml("สินค้า & Banner", body, { id: "bannerSection", tag: "loop", tagClass: "src-google_labs" });
}

// Clamp a string input to [lo,hi], or fall back to def when blank/NaN.
function clampNum(raw, lo, hi, def) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

// A built-in 16:9 SAMPLE banner shown in the preview when no image is uploaded (the real banner
// is then AI-generated at run time) — so the operator can see/drag the placement immediately.
// Matches the AI banner's 16:9 ratio so the preview height is faithful.
const BANNER_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='144'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>" +
      "<stop offset='0' stop-color='#ffb43f'/><stop offset='1' stop-color='#fb9514'/>" +
      "</linearGradient></defs>" +
      "<rect width='256' height='144' rx='16' fill='url(#g)'/>" +
      "<rect x='7' y='7' width='242' height='130' rx='11' fill='none' stroke='#fff' " +
      "stroke-opacity='0.55' stroke-width='3' stroke-dasharray='9 7'/>" +
      "<text x='128' y='70' font-family='Arial,Helvetica,sans-serif' font-size='34' " +
      "font-weight='800' fill='#241500' text-anchor='middle'>SALE</text>" +
      "<text x='128' y='100' font-family='Arial,Helvetica,sans-serif' font-size='14' " +
      "fill='#241500' text-anchor='middle' opacity='0.7'>ป้ายตัวอย่าง (AI สร้างจริง)</text>" +
      "</svg>",
  );

// Mirror the current banner controls onto the live preview. Shows the uploaded image when one is
// provided, otherwise the SAMPLE placeholder (the real banner is AI-generated at run time). Sized
// as % of the preview width, centered on (x%, y%) via translate(-50%,-50%) — so the operator can
// dial in the placement without needing an upload. [[flow-loop-mode]]
function updateBannerPreview() {
  const item = $("bannerPreviewItem");
  const img = $("bannerPreviewImg");
  if (!item || !img) return;
  const url = ($("f-bannerImage")?.value || "").trim();
  const src = url || BANNER_PLACEHOLDER;
  if (img.getAttribute("src") !== src) img.src = src;
  item.hidden = false;
  // The wrapper IS the banner box (img fills it); position/size/opacity go on the wrapper so the
  // resize handle tracks its corner. Centered on (x%, y%) via translate(-50%,-50%) (in CSS).
  item.style.width = clampNum($("f-bannerSize")?.value, 5, 80, 80) + "%";
  item.style.left = clampNum($("f-bannerX")?.value, 0, 100, 50) + "%";
  item.style.top = clampNum($("f-bannerY")?.value, 0, 100, 14) + "%";
  item.style.opacity = String(clampNum($("f-bannerOpacity")?.value, 0, 100, 100) / 100);
  img.style.borderRadius = ($("f-bannerShape")?.value === "circle") ? "50%" : "8px";
  const cap = $("bannerPreviewCap");
  if (cap) {
    cap.textContent = url
      ? "ลากเพื่อย้าย • ลากมุมเพื่อย่อ/ขยาย"
      : "ป้ายตัวอย่าง — ลากเพื่อย้าย • ลากมุมเพื่อย่อ/ขยาย (ป้ายจริง AI สร้างให้)";
  }
}

// Drag the banner on the preview to set its X/Y % (center follows the pointer).
function startBannerDrag(e) {
  const wrap = $("bannerPreview");
  const item = $("bannerPreviewItem");
  if (!wrap || !item || item.hidden) return;
  e.preventDefault();
  const onMove = (ev) => {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nx = Math.round(clampNum(((ev.clientX - r.left) / r.width) * 100, 0, 100, 50));
    const ny = Math.round(clampNum(((ev.clientY - r.top) / r.height) * 100, 0, 100, 50));
    if ($("f-bannerX")) $("f-bannerX").value = nx;
    if ($("f-bannerY")) $("f-bannerY").value = ny;
    updateBannerPreview();
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  onMove(e); // jump to the initial press point
}

// Drag the corner handle to RESIZE the banner: width % = 2 ร— (horizontal gap from the banner
// center to the pointer), so it grows/shrinks symmetrically around its center. Clamped 5–80%.
function startBannerResize(e) {
  const wrap = $("bannerPreview");
  const item = $("bannerPreviewItem");
  if (!wrap || !item || item.hidden) return;
  e.preventDefault();
  e.stopPropagation(); // don't also start a move-drag
  const onMove = (ev) => {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + (clampNum($("f-bannerX")?.value, 0, 100, 50) / 100) * r.width;
    const sizePct = Math.round((Math.abs(ev.clientX - cx) * 2 / r.width) * 100);
    if ($("f-bannerSize")) $("f-bannerSize").value = clampNum(sizePct, 5, 80, 25);
    updateBannerPreview();
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// One switch row (label + iOS-style toggle). `opts.cls` adds a modifier (e.g. master).
function tkToggleRow(id, label, checked, opts = {}) {
  return `<label class="tk-row${opts.cls ? ` ${opts.cls}` : ""}">
    <span class="tk-row-label">${escapeHtml(label)}</span>
    <span class="tk-switch">
      <input type="checkbox" id="${id}"${checked ? " checked" : ""} />
      <span class="tk-track"><span class="tk-thumb"></span></span>
    </span>
  </label>`;
}

// A Disclose sub-option (Your brand / Branded content) as a selectable card: name +
// a short description + a check pip. The native input is visually hidden; the label
// toggles it (so the existing change handler + syncTikTokToggles keep working).
function tkCheck(id, label, checked, desc) {
  return `<label class="tk-opt">
    <input type="checkbox" id="${id}"${checked ? " checked" : ""} />
    <span class="tk-opt-text">
      <span class="tk-opt-name">${escapeHtml(label)}</span>
      ${desc ? `<span class="tk-opt-desc">${escapeHtml(desc)}</span>` : ""}
    </span>
    <span class="tk-opt-check" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
    </span>
  </label>`;
}

function tiktokTogglesHtml() {
  const t = tiktokSettings;
  return `<div class="tk-settings${t.enabled ? "" : " tk-off"}" id="tkSettings">
    ${tkToggleRow("tkMaster", "เปิด / ปิด ทั้งหมด", t.enabled, { cls: "tk-master" })}
    <div class="tk-list">
      ${tkToggleRow("tkDisableCart", "ปิดปักตะกร้า", t.disableCart)}
      ${tkToggleRow("tkSkipAi", "Skip AI-Generated", t.skipAiLabel)}
      ${tkToggleRow("tkDisclose", "Disclose post content", t.discloseContent)}
      <div class="tk-sub" id="tkDiscloseSub"${t.discloseContent ? "" : " hidden"}>
        ${tkCheck("tkYourBrand", "Your brand", t.yourBrand, "โปรโมตแบรนด์หรือธุรกิจของคุณเอง")}
        ${tkCheck("tkBrandedContent", "Branded content", t.brandedContent, "โปรโมตแบรนด์อื่น (ได้รับการสนับสนุน)")}
      </div>
    </div>
  </div>`;
}

// Shared submit button + form note for both render paths.
function submitHtml(m) {
  return `<button class="btn primary" id="submit"${
    m.comingSoon ? " disabled" : ""
  }>+ เพิ่มลงคิว</button>
    <p class="form-note" id="formNote"></p>`;
}

function renderModeForm(m) {
  if (m.postOnly) return renderPostOnlyForm(m); // โพสต์ TikTok อย่างเดียว — no generation form
  if (m.mediaSwitch) return renderSwitchForm(m);
  const promptOrScenes = m.scenes ? scenesHtml() : promptFieldHtml(m);
  // provider section: media toggle + mode inputs + the delivery selector (เลือกวิธีลงคลิป,
  // shown for every clip-generating mode — it replaced the old Count field). specGrid
  // modes (flow-extend) render a clip8-style grid (model ยท ขนาด ยท delivery) instead.
  const providerBody = m.specGrid
    ? m.top.map(fieldHtml).join("") + specGridHtml(m)
    : mediaHtml(m) +
      m.top.map(fieldHtml).join("") +
      m.extra.map(fieldHtml).join("") +
      postModeFieldHtml();
  els.genForm.innerHTML =
    promptOrScenes + providerSectionHtml(m, providerBody) + tiktokSectionHtml(m) +
    (m.banner ? bannerSectionHtml(m) : "") + submitHtml(m);
  applyModeChrome(m);
}

// image→video form: prompt button, the provider spec grid (models ยท aspect ยท เลือกวิธีลงคลิป),
// then the TikTok section.
function renderSwitchForm(m) {
  const providerBody =
    m.top.map(fieldHtml).join("") + specGridHtml(m) + m.extra.map(fieldHtml).join("");
  els.genForm.innerHTML =
    promptsHtml(m) + providerSectionHtml(m, providerBody) + tiktokSectionHtml(m) + submitHtml(m);
  applyModeChrome(m);
}

// ============================================================================
// Post TikTok (โพสต์ TikTok อย่างเดียว) — no generation: the operator supplies finished
// clips and the pipeline posts them. Each clip becomes one standalone job.submit with the
// clip carried in `options` (postMediaUrl for an upload, postSourceJobId for a completed
// job) — the SAME enqueue boundary as every other mode, so the product↔account bind, the
// delivery method, and the schedule stagger all apply unchanged. [[tiktok-post-only-mode]]
// ============================================================================
// The clips staged for the current post-only form. Each: {key, kind:'upload'|'job',
// url, jobId, label, caption}. Reset whenever the form re-renders.
let postClips = [];
let postClipSeq = 0;

function renderPostOnlyForm(m) {
  postClips = []; // a fresh form starts with no staged clips
  els.genForm.innerHTML =
    postClipsSectionHtml() + postOnlySettingsSectionHtml(m) + submitHtml(m);
  syncTikTokToggles(); // reflect the saved Setting-TikTok toggles
  populateGenerateTikTokSelect(); // account options + product-lock note
  refreshProductTrigger(); // product picker label
  applyModeChrome(m); // chips + note + post-mode UI + submit state
  renderPostClipsList(); // paint the (empty) clip list + gate the submit button
}

// "คลิปที่จะโพสต์": the staged-clip list + the add controls (upload / pick a finished job).
function postClipsSectionHtml() {
  const body = `
    <p class="muted-text">อัปโหลดคลิป (.mp4) จากเครื่อง หรือเลือกจากงานที่สร้างเสร็จแล้ว —
      แต่ละคลิปจะถูกโพสต์เป็น 1 โพสต์.</p>
    <div class="post-clips" id="postClipsList"></div>
    <div class="post-clips-add">
      <button type="button" class="btn" id="postClipUpload">⬆ อัปโหลดคลิป</button>
      <button type="button" class="btn ghost" id="postClipPick">＋ เลือกจากงานที่เสร็จแล้ว</button>
      <input type="file" accept="video/*" id="postClipFile" hidden multiple />
    </div>`;
  return formSectionHtml("คลิปที่จะโพสต์", body, {
    id: "postClipsSection", tag: "tiktok", tagClass: "src-tiktok",
  });
}

// "ตั้งค่าการโพสต์": shared posting config — the Setting-TikTok toggles + the product
// picker (locks the publish account) + delivery method + the account dropdown. No hashtag
// field: hashtags fall back to the defaults + the product-name tag server-side (the same as
// every generate mode, none of which expose a hashtag input). Caption is per-clip (in the
// clip rows above); a blank one falls back to the product name. [[tiktok-post-only-mode]]
function postOnlySettingsSectionHtml(m) {
  const body =
    tiktokTogglesHtml() +
    productPickerHtml() +
    postOnlyDeliveryFieldHtml() +
    tiktokAccountFieldHtml();
  return formSectionHtml("ตั้งค่าการโพสต์", body, {
    id: "postOnlySettings", tag: "tiktok", tagClass: "src-tiktok",
  });
}

// Delivery selector for post-only: the four TikTok methods only (no "สร้างไม่โพสต์" —
// a post-only job exists to post). Reuses the SAME ids as postModeFieldHtml so
// postModeValue / postScheduleValue / applyPostModeUI / maybeAskScheduleGap all work.
function postOnlyDeliveryFieldHtml() {
  return `<div class="post-mode-row">
    <div class="field">
      <label for="f-postMode">เลือกวิธีลงคลิป</label>
      <select id="f-postMode">
        <option value="${POST_MODE_AUTO}">โพสต์เลย (สาธารณะ)</option>
        <option value="${POST_MODE_SAVE_DRAFT}">บันทึกร่าง</option>
        <option value="${POST_MODE_SCHEDULE}">ตั้งเวลาโพสต์</option>
        <option value="${POST_MODE_PRIVATE}">โพสต์ส่วนตัว</option>
      </select>
    </div>
    <div class="field" id="f-scheduleField" hidden>
      <label>เวลาที่จะโพสต์</label>
      <input type="datetime-local" id="f-scheduleAt" class="dt-input" step="60" aria-label="เวลาที่จะโพสต์" />
      <button type="button" class="sched-gap-note" id="schedGapNote" hidden></button>
    </div>
  </div>`;
}

// Repaint the staged-clip list from `postClips`; gate the submit button on having ≥1 clip.
function renderPostClipsList() {
  const wrap = $("postClipsList");
  if (!wrap) return;
  if (!postClips.length) {
    wrap.innerHTML = `<p class="post-clips-empty muted-text">ยังไม่มีคลิป — กด “⬆ อัปโหลดคลิป” เพื่อเริ่ม</p>`;
  } else {
    wrap.innerHTML = postClips
      .map((c, i) => {
        const thumb = c.url
          ? `<video src="${escapeHtml(c.url)}" muted preload="metadata" playsinline></video>`
          : `<span class="pc-thumb-ico" aria-hidden="true">🎬</span>`;
        const kind = c.kind === "upload" ? "อัปโหลด" : "งานที่เสร็จแล้ว";
        return `<div class="post-clip-row" data-clip-key="${escapeHtml(c.key)}">
          <span class="pc-index">${i + 1}</span>
          <div class="pc-thumb">${thumb}</div>
          <div class="pc-main">
            <span class="pc-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
            <span class="pc-kind">${kind}</span>
            <input type="text" class="pc-caption" data-clip-cap="${escapeHtml(c.key)}"
              placeholder="แคปชั่น (เว้นว่าง = ใช้ชื่อสินค้า)" value="${escapeHtml(c.caption || "")}" />
          </div>
          <button type="button" class="pc-remove" data-clip-del="${escapeHtml(c.key)}" aria-label="ลบคลิป">✕</button>
        </div>`;
      })
      .join("");
  }
  // Submit is enabled only with ≥1 staged clip (refreshSubmitState would otherwise enable it).
  const submit = $("submit");
  if (submit) submit.disabled = postClips.length === 0;
  const note = $("formNote");
  if (note) {
    note.textContent = postClips.length
      ? "เพิ่มลงคิวแล้วกด ‘Run’ ใน Recent Jobs เพื่อเริ่มโพสต์ตามลำดับ"
      : "อัปโหลดหรือเลือกคลิปก่อน แล้วจึงเพิ่มลงคิว";
  }
  applyScheduleIntervalUI(); // post-only "N โพสต์" gap note counts staged clips → refresh on change
}

// Upload one local clip to /api/upload-clip and stage it. The returned /uploads URL is
// what the hub attaches directly (no re-download). Best-effort: a failure logs + skips.
async function uploadPostClip(file) {
  addLog(`กำลังอัปโหลด ${file.name}…`, "info");
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await (await fetch("/api/upload-clip", { method: "POST", body: form })).json();
    if (!res.ok || !res.url) {
      addLog(`อัปโหลดไม่สำเร็จ: ${res.error || file.name}`, "error");
      return;
    }
    postClips.push({
      key: String(++postClipSeq), kind: "upload", url: res.url, jobId: "",
      label: file.name, caption: "",
    });
    renderPostClipsList();
    addLog(`เพิ่มคลิป ${file.name} แล้ว`, "info");
  } catch (e) {
    addLog(`อัปโหลดไม่สำเร็จ: ${e}`, "error");
  }
}

// Pick a finished clip from a completed job (DONE + has video media). Stages it by job id —
// the hub reuses that job's already-saved file (no re-download).
async function pickCompletedClip() {
  const done = (lastJobsForGrid || []).filter(
    (j) => j.status === "done" && j.mediaUrl && j.mediaType === "video"
  );
  if (!done.length) {
    addLog("ยังไม่มีคลิปที่สร้างเสร็จให้เลือก — สร้างคลิปในโหมดอื่นก่อน", "warn");
    return;
  }
  const list = done.slice(-40).reverse(); // newest first, bounded
  const ids = await pickCompletedClipDialog(list);
  if (!ids || !ids.length) return;
  ids.forEach((id) => {
    const j = list.find((x) => x.id === id);
    if (!j) return;
    postClips.push({
      key: String(++postClipSeq), kind: "job", url: j.mediaUrl || "", jobId: j.id,
      label: ((j.displayTitle || j.prompt || j.id) + "").slice(0, 64) || j.id, caption: "",
    });
  });
  renderPostClipsList();
  addLog(`เพิ่ม ${ids.length} คลิปจากงานที่เสร็จแล้ว`, "info");
}

// A visual MULTI-select picker over finished clips: each card plays the REAL video (native
// controls) and is labelled with the source mode + product name. Tick any number of cards
// (or "เลือกทั้งหมด") then confirm. Resolves the array of chosen job ids (empty on cancel).
// Tapping a card toggles its tick; tapping the video (data-noselect) only plays it. Reuses
// the shared modal lifecycle. [[tiktok-post-only-mode]]
function pickCompletedClipDialog(jobs) {
  if (activeModal) closeModal([]); // one modal at a time
  return new Promise((resolve) => {
    const selected = new Set();
    const cards = jobs
      .map((j) => {
        const provider = NAV[j.mode]?.provider || "";
        const modeLabel = NAV[j.mode]?.title || j.mode || "—";
        const product = ((j.displayTitle || j.prompt || "") + "").trim();
        const titleHtml = product
          ? escapeHtml(product)
          : `<span class="clip-pick-noprod">— ไม่มีชื่อสินค้า —</span>`;
        // No native <video controls> — the whole card (thumbnail included) is the SELECT
        // target; the ▶ button opens a lightbox to watch. [[tiktok-post-only-mode]]
        return `<div class="clip-pick-card" data-clip-id="${escapeHtml(j.id)}"
            role="checkbox" aria-checked="false" tabindex="0">
          <span class="clip-pick-check" aria-hidden="true"></span>
          <div class="clip-pick-thumb">
            <video src="${escapeHtml(j.mediaUrl)}" preload="metadata" muted playsinline></video>
            <button type="button" class="clip-pick-play" data-clip-play="${escapeHtml(j.mediaUrl)}"
              aria-label="ดูคลิป" title="ดูคลิป">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
          <div class="clip-pick-info">
            <span class="clip-pick-title" title="${escapeHtml(product)}">${titleHtml}</span>
            <span class="clip-pick-meta-row">
              <span class="clip-pick-mode src-${escapeHtml(provider)}">${escapeHtml(modeLabel)}</span>
            </span>
          </div>
        </div>`;
      })
      .join("");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal clip-pick-modal" role="dialog" aria-modal="true" aria-labelledby="clipPickTitle">
        <h3 class="modal-title" id="clipPickTitle">เลือกคลิป</h3>
        <div class="clip-pick-head">
          <div class="clip-pick-head-left">
            <button type="button" class="clip-pick-all" id="clipPickAll" aria-pressed="false">
              <span class="cpa-box" aria-hidden="true"></span>
              <span>เลือกทั้งหมด</span>
            </button>
            <button type="button" class="clip-pick-clear" id="clipPickClear" hidden>ยกเลิกทั้งหมด</button>
          </div>
          <span class="clip-pick-count" id="clipPickCount">เลือกแล้ว 0</span>
        </div>
        <p class="modal-hint">คลิกการ์ดเพื่อเลือก ยท กดปุ่ม ▶ เพื่อดูตัวอย่าง</p>
        <div class="clip-pick-grid">${cards}</div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-clip-cancel>ยกเลิก</button>
          <button type="button" class="btn primary" data-clip-confirm disabled>เพิ่มที่เลือก</button>
        </div>
      </div>`;
    const sync = () => {
      overlay.querySelectorAll(".clip-pick-card").forEach((c) => {
        const on = selected.has(c.dataset.clipId);
        c.classList.toggle("is-selected", on);
        c.setAttribute("aria-checked", on ? "true" : "false");
      });
      const n = selected.size;
      overlay.querySelector("#clipPickCount").textContent = `เลือกแล้ว ${n}`;
      const confirm = overlay.querySelector("[data-clip-confirm]");
      confirm.disabled = n === 0;
      confirm.textContent = n ? `เพิ่มที่เลือก (${n})` : "เพิ่มที่เลือก";
      const all = overlay.querySelector("#clipPickAll");
      all.classList.toggle("is-all", n > 0 && n === jobs.length);
      all.classList.toggle("is-some", n > 0 && n < jobs.length);
      all.setAttribute("aria-pressed", n > 0 && n === jobs.length ? "true" : "false");
      overlay.querySelector("#clipPickClear").hidden = n === 0;
    };
    const toggle = (id) => {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      sync();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target.closest("[data-clip-cancel]")) return closeModal([]);
      if (e.target.closest("[data-clip-confirm]")) return closeModal([...selected]);
      if (e.target.closest("#clipPickClear")) {
        selected.clear();
        return sync();
      }
      if (e.target.closest("#clipPickAll")) {
        const allOn = selected.size === jobs.length && jobs.length > 0;
        selected.clear();
        if (!allOn) jobs.forEach((j) => selected.add(j.id));
        return sync();
      }
      const play = e.target.closest("[data-clip-play]");
      if (play) return openVideoLightbox(play.dataset.clipPlay); // watch, don't select
      const card = e.target.closest(".clip-pick-card");
      if (card) return toggle(card.dataset.clipId);
      if (e.target === overlay) closeModal([]);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest?.(".clip-pick-card");
      if (card) {
        e.preventDefault();
        toggle(card.dataset.clipId);
      }
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal([]);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => overlay.classList.add("open"));
  });
}

// Watch a clip full-size — a self-contained overlay layered ABOVE the picker (its own Esc,
// not the shared activeModal, so it never closes the picker). Click the backdrop or ✕ to
// close; clicks on the video itself are left to its native controls. [[tiktok-post-only-mode]]
function openVideoLightbox(url) {
  if (!url) return;
  const lb = document.createElement("div");
  lb.className = "video-lightbox";
  lb.innerHTML = `<div class="video-lightbox-inner">
      <video src="${escapeHtml(url)}" controls autoplay playsinline></video>
    </div>
    <button type="button" class="video-lightbox-close" aria-label="ปิด">✕</button>`;
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    lb.classList.remove("open");
    setTimeout(() => lb.remove(), 150);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation(); // close ONLY the lightbox, not the picker beneath
      close();
    }
  };
  lb.addEventListener("click", (e) => {
    // backdrop or ✕ closes; clicks on the video are left to its controls
    if (e.target === lb || e.target.closest(".video-lightbox-close")) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add("open"));
}

function removePostClip(key) {
  postClips = postClips.filter((c) => c.key !== key);
  renderPostClipsList();
}

// Queue one job.submit per staged clip. Each carries its own clip + caption; the product,
// hashtags, delivery method, and account are shared. SCHEDULE staggers each clip by the
// per-post gap (clip i posts at base + i ร— gap). [[tiktok-post-only-mode]]
async function submitPostOnlyJob(m) {
  if (!postClips.length) {
    addLog("เพิ่มคลิปอย่างน้อย 1 คลิปก่อน", "warn");
    return;
  }
  if (blockIfProductSourceMissing()) return; // pinned product whose source account is gone
  // Post-only tags ONE product across all staged clips (no per-product fan-out like the generate
  // modes) → 2+ ticked can't map to multiple tags. Block with a clear message instead of silently
  // posting untagged. (Cart off = no tag at all, so a stray pick there is harmless → don't block.)
  // [[tiktok-post-only-mode]]
  if (!cartDisabled() && productPick.products.length >= 2) {
    addLog("โพสต์ TikTok ติดสินค้าได้ทีละ 1 รายการ — เอาออกให้เหลือ 1 (หรือเปิด ‘ปิดปักตะกร้า’ ถ้าไม่อยากติดสินค้า)", "warn");
    $("productPickBtn")?.focus();
    return;
  }
  if (!validatePostMode()) return; // SCHEDULE with no/too-soon time → abort
  const val = (name) => ($(`f-${name}`)?.value || "").trim();
  // No hashtag input — the server fills defaults + a product-name tag (_publish_caption).
  const productId = cartDisabled() ? "" : productIdValue() || "";
  const pubMode = postModeValue();
  const baseAt = postScheduleValue();
  const gapMin = pubMode === POST_MODE_SCHEDULE ? scheduleGapMinutes() : 0;
  // Schedule-window guard for the staggered tail — post-only's stagger axis is CLIPS, so this is
  // the authoritative window check (validatePostMode now uses n=1 for post-only). [[tiktok-post-only-mode]]
  if (pubMode === POST_MODE_SCHEDULE && baseAt && postClips.length >= 2) {
    const lastLead = minutesFromNow(baseAt) + gapMin * (postClips.length - 1);
    if (lastLead > SCHEDULE_MAX_DAYS_AHEAD * 24 * 60) {
      addLog(
        `โพสต์สุดท้ายเลย ${SCHEDULE_MAX_DAYS_AHEAD} วัน — TikTok ตั้งเวลาล่วงหน้าได้ไม่เกิน ${SCHEDULE_MAX_DAYS_AHEAD} วัน ยท ลดระยะห่างหรือจำนวนคลิป`,
        "warn"
      );
      return;
    }
  }
  const acct = val("tiktokAccount") || null;
  postClips.forEach((c, i) => {
    const options = {};
    if (c.kind === "job") options.postSourceJobId = c.jobId;
    else options.postMediaUrl = c.url;
    // (post-only doesn't generate, so no productImage cover — the Shop tag rides target.product_id)
    const publishAt = gapMin && baseAt ? addMinutesToLocal(baseAt, gapMin * i) : baseAt;
    send({
      type: "job.submit",
      data: {
        source: "tiktok",
        prompt: "",
        media_type: "video",
        count: 1,
        publish_mode: pubMode,
        publish_at: publishAt,
        mode: "tiktok-post",
        options,
        tiktok_account_id: acct,
        target: { caption: (c.caption || "").trim(), hashtags: [], product_id: productId || null },
      },
    });
  });
  const n = postClips.length;
  postClips = [];
  renderPostClipsList();
  addLog(
    n > 1 ? `เพิ่มลงคิว ${n} คลิป — กด ‘Run’ เพื่อโพสต์` : "เพิ่มลงคิว 1 คลิป — กด ‘Run’ เพื่อโพสต์",
    "info"
  );
}

// ---- TikTok settings: persistence + live UI sync ----
// Persist the whole toggle set (the hub patch-merges + validates). [[tiktok-settings]]
function saveTikTokSettings() {
  send({ type: "settings.update", data: { tiktokSettings: { ...tiktokSettings } } });
}

// Master off → dim + disable the sub-toggles. The product picker stays visible regardless of
// the cart toggle — applyCartGate only refreshes the account lock + submit state.
function applyTikTokToggleUI() {
  const box = $("tkSettings");
  if (box) {
    box.classList.toggle("tk-off", !tiktokSettings.enabled);
    box.querySelectorAll(".tk-list input").forEach((i) => (i.disabled = !tiktokSettings.enabled));
  }
  applyCartGate();
}

// "ปิดปักตะกร้า" no longer hides the product picker: the product still feeds image generation
// (cover reference + name), so the picker stays visible. The cart toggle only flips whether the
// product gets a Shop TAG at post time — which changes the account lock + the submit gate.
function applyCartGate() {
  const field = $("productPickerField");
  if (field) field.hidden = false; // picker always shown — it feeds generation, not just the tag
  applyPublishAccountLock(); // cart on/off changes whether a product is pinned (→ account lock)
  refreshSubmitState(); // cart on/off flips whether a product is REQUIRED to enqueue
}

// The effective "no Shop tag" state (the product, if picked, is reference-only): master on AND
// "ปิดปักตะกร้า" on. Gates the product_id we send for pinning, NOT the picker or the cover image.
function cartDisabled() {
  return tiktokSettings.enabled && tiktokSettings.disableCart;
}

// A product must be ticked before a job can be queued whenever that product will actually
// be used: a Shop-tagging post (cart on) OR a generate-only mode (Loop, where the product IS
// the base image reference). Exempt only: post-only mode (own staged-clip gate) and a normal
// post with "ปิดปักตะกร้า" on (the operator opted out of a Shop tag). [[product-required-to-enqueue]]
function productRequiredButMissing(m) {
  if (!m || m.postOnly) return false;
  // Loop ignores the cart toggle (the product is its image reference, not a Shop tag) → it
  // always needs one; other modes need one only when a Shop tag will attach (cart on).
  if (!m.generateOnly && cartDisabled()) return false;
  return productPick.products.length === 0;
}

// Submit-time backstop (the button is already disabled when this is true): refuse to
// queue a Shop-tagging post with no product, log why, and surface the picker.
function blockIfNoProduct(m) {
  if (!productRequiredButMissing(m)) return false;
  addLog("เลือกสินค้าอย่างน้อย 1 รายการก่อนเพิ่มลงคิว", "warn");
  $("productPickBtn")?.focus();
  return true;
}

// "สร้างไม่โพสต์" → dim + disable the "Setting TikTok" card's PUBLISH controls
// (post toggles + account; see .sec-disabled in styles.css). The product picker stays live —
// it also feeds generation (cover image + product name), not just posting. "สร้าง + โพสต์ TikTok"
// restores it. Driven on every render and on each change of the delivery selector.
function applyPostModeUI() {
  const sec = $("tiktokSection");
  if (sec) sec.classList.toggle("sec-disabled", postModeIsGenerateOnly());
  // Reveal the date+time field only for the "ตั้งเวลาโพสต์" (schedule) mode.
  const sched = $("f-scheduleField");
  if (sched) sched.hidden = postModeValue() !== POST_MODE_SCHEDULE;
  applyScheduleIntervalUI();
}

// The per-post spacing control ("ระยะห่างเวลาต่อโพสต์") only matters when the SCHEDULE
// delivery mode fans a BATCH (2+ ticked products) out into one row per product — each
// post is then staggered by N minutes. Show it only then, with a live spread hint.
// The interval has no inline control — it's set via the popup (scheduleGapDialog). Once a
// schedule time is set, write a one-line note in the "เวลาที่จะโพสต์" area stating the gap
// (tap it to re-open the popup). Hidden until a time exists / outside SCHEDULE mode.
function applyScheduleIntervalUI() {
  const note = $("schedGapNote");
  if (!note) return;
  const show = postModeValue() === POST_MODE_SCHEDULE && !!postScheduleValue();
  note.hidden = !show;
  if (show) updateScheduleGapNote();
}

function updateScheduleGapNote() {
  const note = $("schedGapNote");
  if (!note) return;
  // Post-only staggers one post per STAGED CLIP; the generate modes stagger one per ticked
  // product. Count the right axis so "N โพสต์" matches what will actually be queued. [[tiktok-post-only-mode]]
  const count = NAV[currentNav]?.postOnly ? postClips.length : productPick.products.length;
  const base = `ระยะห่าง ${scheduleGapMin} นาที ต่อโพสต์`;
  const text =
    count >= 2
      ? `${base} ยท ${count} โพสต์ ยท โพสต์สุดท้าย +${formatMinutesSpread(scheduleGapMin * (count - 1))}`
      : base;
  note.innerHTML = `<span class="sgn-text">${escapeHtml(text)}</span><span class="sgn-edit">แก้ไข</span>`;
}

// Open the interval popup (auto after the date/time is set, or via the "แก้ไข" chip).
// Stores the chosen multiple-of-5 spacing for the next submit.
async function openScheduleGapDialog() {
  const v = await scheduleGapDialog(scheduleGapMin);
  if (v == null) return; // cancelled — keep the previous value
  scheduleGapMin = v;
  applyScheduleIntervalUI();
}

// Auto-prompt for the spacing right after the date/time picker commits, in SCHEDULE mode.
// Fires regardless of how many products are ticked (product selection can happen after the
// time is set) — the spacing only actually staggers rows when 2+ products are queued.
function maybeAskScheduleGap() {
  if (postModeValue() !== POST_MODE_SCHEDULE) return;
  if (!postScheduleValue()) return; // cleared / empty time → nothing to space
  openScheduleGapDialog();
}

// Themed +5-step interval popup. Resolves the chosen minutes (a multiple of 5) on ตกลง, or
// null on cancel/backdrop/Esc. Reuses the shared modal lifecycle (activeModal/closeModal).
function scheduleGapDialog(initial) {
  if (activeModal) closeModal(null); // one modal at a time
  return new Promise((resolve) => {
    const count = productPick.products.length;
    let val = snapGap5(initial);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal sg-dialog" role="dialog" aria-modal="true" aria-labelledby="sgTitle">
        <h3 class="modal-title" id="sgTitle">ระยะห่างเวลาต่อโพสต์</h3>
        <p class="modal-body">แต่ละโพสต์จะตั้งเวลาห่างกันกี่นาที — เพิ่ม/ลด ทีละ 5 นาที</p>
        <div class="sg-stepper">
          <button type="button" class="sg-step" data-sg="dn" aria-label="ลด 5 นาที">−</button>
          <div class="sg-val">
            <input type="text" id="sgInput" inputmode="numeric" maxlength="4" aria-label="ระยะห่าง (นาที)" />
            <span class="sg-unit">นาที</span>
          </div>
          <button type="button" class="sg-step" data-sg="up" aria-label="เพิ่ม 5 นาที">+</button>
        </div>
        <div class="sg-chips">
          ${[5, 10, 15, 30, 60].map((v) => `<button type="button" class="sg-chip" data-sg-set="${v}">${v}</button>`).join("")}
        </div>
        <p class="sg-preview" id="sgPreview"></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-sg="cancel">ยกเลิก</button>
          <button type="button" class="btn primary" data-sg="ok">ตกลง</button>
        </div>
      </div>`;
    const input = overlay.querySelector("#sgInput");
    const preview = overlay.querySelector("#sgPreview");
    const chips = overlay.querySelectorAll(".sg-chip");
    const syncChips = () => chips.forEach((c) => c.classList.toggle("is-on", +c.dataset.sgSet === val));
    const sync = (writeInput = true) => {
      if (writeInput && input) input.value = String(val);
      if (preview) {
        preview.textContent =
          count >= 2
            ? `${count} โพสต์ ยท โพสต์สุดท้าย +${formatMinutesSpread(val * (count - 1))}`
            : `เพิ่มทีละ ${val} นาที`;
      }
      syncChips();
    };
    sync();
    overlay.addEventListener("click", (e) => {
      const set = e.target.closest("[data-sg-set]");
      if (set) { val = snapGap5(+set.dataset.sgSet); sync(); return; }
      const btn = e.target.closest("[data-sg]");
      if (btn) {
        const a = btn.dataset.sg;
        if (a === "up") { val = snapGap5(val + SCHEDULE_GAP_STEP_MIN); sync(); }
        else if (a === "dn") { val = snapGap5(val - SCHEDULE_GAP_STEP_MIN); sync(); }
        else if (a === "ok") closeModal(snapGap5(val));
        else closeModal(null);
        return;
      }
      if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    // free typing — track digits into `val` for the live preview, snap to 5 on blur
    overlay.addEventListener("input", (e) => {
      if (e.target.id !== "sgInput") return;
      const digits = e.target.value.replace(/\D/g, "");
      if (digits !== "") val = Math.min(SCHEDULE_GAP_MAX_MIN, +digits);
      sync(false); // refresh preview/chips but leave the box as typed
    });
    overlay.addEventListener(
      "blur",
      (e) => { if (e.target.id === "sgInput") { val = snapGap5(val); sync(); } },
      true
    );
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeModal(null); }
      else if (e.key === "Enter") { e.preventDefault(); closeModal(snapGap5(val)); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-sg="ok"]')?.focus();
    });
  });
}

// Hide the whole "Setting TikTok" card until a TikTok account is connected — without one
// there's nothing to configure and posting can't run. The provider section then spans the
// full width (see #genForm:has(#tiktokSection[hidden]) in styles.css). Driven on each render
// (applyModeChrome) and on every account-state change (renderAccounts). Stays visible until
// the account list is known, so a slow socket doesn't flash it away.
function applyTikTokConnectedUI() {
  const sec = $("tiktokSection");
  if (sec) sec.hidden = accountsKnown && !providerLinked("tiktok");
}

// Without a connected TikTok account there's nothing to upload to, so the delivery selector
// (เลือกวิธีลงคลิป) drops ALL four TikTok methods (post / Save draft / Schedule / private) and
// pins to "สร้างไม่โพสต์". Unlike the Setting TikTok card this selector lives in the provider
// spec grid, so it must be gated here too. Connecting TikTok restores the options. While the
// account list is still unknown we keep them so a slow socket doesn't flash them away. Driven
// on each render (applyModeChrome) and on every account-state change (renderAccounts).
function applyPostModeAvailability() {
  const sel = $("f-postMode");
  if (!sel) {
    // generateOnly modes (Loop) have no selector but still need the publish card dimmed
    // (postModeIsGenerateOnly is true for them). Other selector-less views are a no-op.
    applyPostModeUI(); // [[flow-loop-mode]]
    return;
  }
  // Post-only's delivery selector offers only the four TikTok modes (no generate-only
  // fallback to force when no account is linked). The whole view is about posting, so a
  // missing TikTok account is surfaced inline instead. [[tiktok-post-only-mode]]
  if (NAV[currentNav]?.postOnly) {
    applyPostModeUI();
    return;
  }
  const canPost = !accountsKnown || providerLinked("tiktok");
  for (const value of POST_MODES_TIKTOK) {
    const opt = sel.querySelector(`option[value="${value}"]`);
    if (opt) {
      opt.hidden = !canPost;
      opt.disabled = !canPost;
    }
  }
  if (!canPost) sel.value = POST_MODE_GENERATE_ONLY; // can't upload → generate-only
  applyPostModeUI(); // keep the dimming + schedule field in sync with the (maybe forced) value
}

// Mirror the stored settings into a freshly-rendered (or already-rendered) form.
function syncTikTokToggles() {
  const set = (id, v) => {
    const el = $(id);
    if (el) el.checked = !!v;
  };
  set("tkMaster", tiktokSettings.enabled);
  set("tkDisableCart", tiktokSettings.disableCart);
  set("tkSkipAi", tiktokSettings.skipAiLabel);
  set("tkDisclose", tiktokSettings.discloseContent);
  set("tkYourBrand", tiktokSettings.yourBrand);
  set("tkBrandedContent", tiktokSettings.brandedContent);
  const sub = $("tkDiscloseSub");
  if (sub) sub.hidden = !tiktokSettings.discloseContent;
  applyTikTokToggleUI();
}

// shared chrome (chips + note + submit state) for both render paths
function applyModeChrome(m) {
  refreshPromptButton(); // show how many fields this mode has overridden
  applyTikTokToggleUI(); // master-off dimming + cart gate on the freshly rendered form
  applyPostModeAvailability(); // gate auto-post on a connected TikTok (+ dim card if generate-only)
  applyTikTokConnectedUI(); // hide the TikTok card entirely until a TikTok account is connected
  els.modeChip.textContent = m.label;
  els.sourceChip.textContent = SOURCE_LABEL[m.provider] || m.provider;
  els.sourceChip.className = `ctx-chip alt src-${m.provider}`;

  // #modeNote carries the descriptive blurb; the pending/disabled status is owned
  // by refreshSubmitState() in #formNote, so the two don't echo each other.
  if (m.note) {
    els.modeNote.hidden = false;
    els.modeNote.classList.toggle("soon", !!m.comingSoon);
    els.modeNote.textContent = m.note;
  } else {
    els.modeNote.hidden = true;
  }
  refreshSubmitState();
}

function refreshSubmitState() {
  const submit = $("submit");
  const note = $("formNote");
  const m = NAV[currentNav];
  if (!submit || !note || !m || m.view !== "generate") return;
  if (m.comingSoon) {
    // generic gate — no mode sets this today, but keep it for future not-yet-wired modes
    submit.disabled = true;
    note.textContent = "Coming soon — this mode isn't enabled yet.";
    return;
  }
  // Post-only (โพสต์ TikTok) gates enqueue on having ≥1 staged clip — renderPostClipsList
  // owns the live note + button state, so leave them to it. [[tiktok-post-only-mode]]
  if (m.postOnly) {
    submit.disabled = postClips.length === 0;
    return;
  }
  // No product ticked while one is needed (Shop tag, or Loop's image reference) → can't
  // queue: disable + say why. Ticking a product (or "ปิดปักตะกร้า" on a posting mode)
  // re-enables it. [[product-required-to-enqueue]]
  if (productRequiredButMissing(m)) {
    submit.disabled = true;
    note.textContent = "เลือกสินค้าอย่างน้อย 1 รายการก่อน จึงจะเพิ่มลงคิวได้";
    return;
  }
  // The form button only ENQUEUES — it works offline; jobs run when you press "Run" in
  // Recent Jobs. Only Flow (google_labs) needs the extension at Run time (to mint the
  // reCAPTCHA token); grok generates server-side via CDP (injected cookie) and KIE is pure
  // REST, so neither needs the extension. [[grok-revert-to-cdp-cookie-inject]]
  submit.disabled = false;
  if (extConnected) {
    note.textContent = "เพิ่มลงคิวแล้วกด ‘Run’ ใน Recent Jobs เพื่อเริ่มรันตามลำดับ";
  } else if (m.provider === "google_labs") {
    note.textContent = "เพิ่มลงคิวได้เลย — ต่อ extension (Settings) ก่อนกด Run";
  } else {
    note.textContent = "เพิ่มลงคิวได้เลย แล้วกด ‘Run’ ใน Recent Jobs เพื่อเริ่มรัน";
  }
}

function mediaValue() {
  return $("mediaType")?.querySelector(".seg.active")?.dataset.value || "image";
}

// ---- navigation ----
// In the narrow icon-rail (<=720px) the submenus can't show, so a group can never
// be "expanded" there — keep aria-expanded in lockstep with what's actually visible.
const NARROW_MQ = window.matchMedia("(max-width: 720px)");

function setGroupOpen(group, open) {
  const sub = document.querySelector(`[data-sub="${group}"]`);
  const btn = document.querySelector(`[data-group-toggle="${group}"]`);
  if (!sub || !btn) return;
  const effective = open && !NARROW_MQ.matches;
  sub.hidden = !effective;
  btn.setAttribute("aria-expanded", String(effective));
}

// crossing the breakpoint flips whether groups can expand — re-sync the active one
NARROW_MQ.addEventListener("change", () => {
  $$("[data-group-toggle]").forEach((btn) =>
    setGroupOpen(btn.dataset.groupToggle, btn.classList.contains("has-active"))
  );
});

// Keep the page <title> and the native OS window caption in sync with the active zone:
// "GT Pro Beta 0" on the home/launcher, "GT Pro Beta 0" inside the workspace. The caption is
// OS chrome owned by pywebview, so flip it through the JS bridge when it's present
// (no-op in the browser fallback, where window.pywebview is undefined).
function applyAppTitle(brand) {
  document.title = `${brand} ยท Control Panel`;
  try {
    window.pywebview?.api?.set_window_title?.(brand);
  } catch (_) {
    /* caption is cosmetic — never let it break navigation */
  }
}
// The pywebview API injects asynchronously; if it wasn't ready at the first setNav
// (e.g. a deep link straight into the workspace), re-apply the caption once it is.
window.addEventListener("pywebviewready", () =>
  applyAppTitle(document.body.dataset.section === "home" ? "GT Pro Beta 0" : "GT Pro Beta 0")
);

  // Multi-profile shell: when this control panel runs inside a profile TAB (iframe), tell the
  // shell which zone we're in so it shows the profile tab strip only in the workspace.
  // No-op in the classic single window (no parent frame). [[multi-profile]]
function postSectionToShell() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          __tb_section: document.body.dataset.section || "home",
          locked: document.body.classList.contains("locked"),
        },
        "*",
      );
    }
  } catch (_) {
    /* cross-origin / no parent — ignore */
  }
}

function setNav(navKey) {
  const cfg = NAV[navKey];
  if (!cfg) return;
  // remember where History was opened from so its "‹ ย้อนกลับ" can return there
  if (navKey === "workflow" && currentNav !== "workflow") backToNav = currentNav;
  currentNav = navKey;
  // GT Pro Beta 0 shell vs GT Pro Beta 0 workspace: the Dashboard is "home" — only it shows
  // in the sidebar and the brand reads "GT Pro Beta 0". Any tool view is the GT Pro Beta 0
  // "workspace": the tools are revealed (CSS on body[data-section]) and the brand reads
  // "GT Pro Beta 0". Derived purely from the current nav — no separate state.
  const isHome = navKey === "dashboard";
  document.body.dataset.section = isHome ? "home" : "workspace";
  const brand = isHome ? "GT Pro Beta 0" : "GT Pro Beta 0";
  const brandEl = document.getElementById("sbBrandName");
  if (brandEl) brandEl.textContent = brand;
  applyAppTitle(brand); // page <title> + native OS caption follow the active zone
  // leaving a mode drops any in-progress row selection (the grid repaints below)
  if (selectMode) {
    selectMode = false;
    selectedRows.clear();
    jobsCardEl()?.classList.remove("selecting");
  }

  // highlight the active leaf (child or standalone) button
  $$(".nav-item[data-nav]").forEach((b) => {
    const on = b.dataset.nav === navKey;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  });

  // accordion: open the active mode's parent group, collapse the others
  $$("[data-group-toggle]").forEach((btn) => {
    const g = btn.dataset.groupToggle;
    const isParent = g === (cfg.group || null);
    setGroupOpen(g, isParent);
    btn.classList.toggle("has-active", isParent);
  });

  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === cfg.view));
  els.viewTitle.textContent = cfg.title;
  els.viewSub.textContent = cfg.sub;
  if (location.hash.slice(1).split("/")[0] !== navKey) history.replaceState(null, "", `#${navKey}`);

  if (cfg.view === "generate") {
    renderModeForm(cfg);
    renderJobsGrid(lastJobsForGrid); // repaint the grid scoped to the mode just opened
  }
  // Per-mode Run/Stop + countdown follow the tab: show THIS mode's run state and its own
  // inter-row countdown (concurrent modes each keep their own). [[per-mode-concurrent-run]]
  updateQueueButton(lastRunningModes.includes(navKey));
  renderCountdown(countdownByMode.get(navKey) || null);
  updateConnectGates(); // entering a page re-checks its "เชื่อมบัญชีให้ครบก่อน" gate

  if (els.navAnnounce) els.navAnnounce.textContent = `${cfg.title} view`;
  if (els.mainBody) els.mainBody.scrollTop = 0;

  // No-login build: navigation just re-evaluates the unlocked shell and onboarding.
  if (typeof applyGate === "function") applyGate();
  if (typeof renderSetupGate === "function") renderSetupGate();
}

// leaf nav (children + standalone) navigates; group headers just expand/collapse
$$("[data-nav]").forEach((btn) => btn.addEventListener("click", () => setNav(btn.dataset.nav)));
$$("[data-goto]").forEach((btn) => btn.addEventListener("click", () => setNav(btn.dataset.goto)));
// Dashboard "GT Pro Beta 0" poster card (art + action) → enter the workspace at the main tool.
$$(".js-enter-bot").forEach((el) => el.addEventListener("click", () => setNav("product-showcase")));
// Login gate "← back to home" → return to the public Dashboard (applyGate hides the gate).
// Password fields (login + register) get an inline eye toggle to reveal/hide what's typed.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pass-toggle]");
  if (!btn) return;
  const input = btn.closest(".auth-pass")?.querySelector("input");
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.classList.toggle("is-visible", reveal);
  btn.setAttribute("aria-pressed", reveal ? "true" : "false");
  btn.setAttribute("aria-label", reveal ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
});
// Banner (Loop): the toggle reveals the placement controls + preview. The operator MAY upload
// their own banner; if they don't, the backend AI-generates a SALE-header. The controls set
// WHERE/how big it lands. Delegated so the handlers survive form re-renders. [[flow-loop-mode]]
document.addEventListener("click", (e) => {
  if (e.target.closest("#bannerUploadBtn")) {
    $("bannerFile")?.click();
    return;
  }
  if (e.target.closest("#bannerClearBtn")) {
    // back to AI-generated: drop the uploaded image, show the sample placeholder again
    if ($("f-bannerImage")) $("f-bannerImage").value = "";
    const f = $("bannerFile");
    if (f) f.value = "";
    const clr = $("bannerClearBtn");
    if (clr) clr.hidden = true;
    updateBannerPreview();
  }
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "bannerEnabled") {
    const fields = $("bannerFields");
    if (fields) fields.hidden = !e.target.checked;
    if (e.target.checked) updateBannerPreview();
    return;
  }
  if (id === "bannerFile") {
    const file = e.target.files?.[0];
    if (file) uploadBannerImage(file);
    return;
  }
  if (id === "f-bannerShape") updateBannerPreview();
});
// Live-sync the number inputs onto the preview; drag the banner on the preview to set X/Y.
document.addEventListener("input", (e) => {
  if (["f-bannerX", "f-bannerY", "f-bannerSize", "f-bannerOpacity"].includes(e.target.id)) {
    updateBannerPreview();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (e.target.id === "bannerResizeHandle") {
    startBannerResize(e);
    return;
  }
  if (e.target.closest("#bannerPreviewItem")) startBannerDrag(e);
});
// Upload an optional banner image; storing its /uploads URL switches the preview to it (and the
// backend uses it instead of AI-generating). [[flow-loop-mode]]
async function uploadBannerImage(file) {
  addLog(`Uploading banner ${file.name}…`, "info");
  try {
    const res = await uploadImage(file, currentNav);
    if (!res.ok) {
      addLog(`Banner upload failed: ${res.error || ""}`, "error");
      return;
    }
    const url = res.url || "";
    if ($("f-bannerImage")) $("f-bannerImage").value = url;
    const clr = $("bannerClearBtn");
    if (clr) clr.hidden = !url;
    updateBannerPreview();
    addLog("อัปโหลดรูป banner แล้ว", "success");
  } catch (err) {
    addLog(`Banner upload failed: ${err}`, "error");
  }
}
// Sidebar "← back" arrow on the brand (workspace only) → return to the GT Pro Beta 0 home.
document.getElementById("sbBack")?.addEventListener("click", () => setNav("dashboard"));
// Dashboard poster "รายละเอียด" button → GT Pro Beta 0 details modal.
$$(".js-bot-details").forEach((el) => el.addEventListener("click", showBotDetails));
// Only GT Pro Beta 0 is live for now — no placeholder slots. To add an app later, drop a
// real <article class="poster-card"> into the .dash-apps grid in index.html (the
// .poster-card-soon / .poster-soon styles stay available for "เร็วๆ นี้" slots).
$$("[data-group-toggle]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const g = btn.dataset.groupToggle;
    const sub = document.querySelector(`[data-sub="${g}"]`);
    const willOpen = sub?.hidden ?? false;
    $$("[data-group-toggle]").forEach((b) => setGroupOpen(b.dataset.groupToggle, false));
    setGroupOpen(g, willOpen);
  })
);
els.sbStatus.addEventListener("click", () => setNav("settings"));
// History "‹ ย้อนกลับ" → back to the page that opened it (falls back to the default)
els.historyBack?.addEventListener("click", () => setNav(NAV[backToNav] ? backToNav : DEFAULT_NAV));
// Custom Prompt gear (static, in the card head — outside #genForm so it needs its own
// listener) opens the per-mode System Prompt editor.
els.openCustomPrompt?.addEventListener("click", () => openPromptEditor(currentNav));

// ---- delegated interactions inside the dynamic generate form ----
els.genForm.addEventListener("click", (e) => {
  const seg = e.target.closest("#mediaType:not(.locked) .seg");
  if (seg) {
    [...seg.parentElement.children].forEach((c) => {
      const on = c === seg;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    return;
  }
  if (e.target.closest("#addScene")) {
    const wrap = $("scenesWrap");
    if (wrap) wrap.insertAdjacentHTML("beforeend", sceneRow(wrap.querySelectorAll(".scene-row").length + 1));
    return;
  }
  const uploadBtn = e.target.closest("[data-upload-for]");
  if (uploadBtn) {
    // open the matching hidden file input for this field
    els.genForm.querySelector(`[data-upload-input="${uploadBtn.dataset.uploadFor}"]`)?.click();
    return;
  }
  // product picker → open the "เลือกสินค้า" popup
  if (e.target.closest("#productPickBtn")) {
    openProductPicker();
    return;
  }
  if (e.target.closest("#productClear")) {
    clearProductsConfirm();
    return;
  }
  // tap the "ระยะห่าง …" note in the time area → re-open the +5-step popup
  if (e.target.closest("#schedGapNote")) {
    openScheduleGapDialog();
    return;
  }
  // Post-only (โพสต์ TikTok): add a clip (upload / pick a finished job) or remove one.
  if (e.target.closest("#postClipUpload")) {
    $("postClipFile")?.click();
    return;
  }
  if (e.target.closest("#postClipPick")) {
    pickCompletedClip();
    return;
  }
  const delClip = e.target.closest("[data-clip-del]");
  if (delClip) {
    removePostClip(delClip.dataset.clipDel);
    return;
  }
  if (e.target.closest("#submit")) submitJob();
});

// Post-only clip file picker → upload each chosen file. Multiple-select stages them all.
document.addEventListener("change", (e) => {
  if (e.target.id !== "postClipFile") return;
  const files = [...(e.target.files || [])];
  e.target.value = ""; // allow re-picking the same file later
  files.forEach((f) => uploadPostClip(f));
});

// Post-only per-clip caption edits → keep the staged-clip model in sync (survives re-render).
document.addEventListener("input", (e) => {
  const cap = e.target.closest?.("[data-clip-cap]");
  if (!cap) return;
  const clip = postClips.find((c) => c.key === cap.dataset.clipCap);
  if (clip) clip.caption = e.target.value;
});

// "ล้างสินค้า" — forget the saved showcase pull. Destructive (you must re-pull from
// Product Showcase), so confirm first; the cleared TIKTOK_PRODUCTS broadcast empties
// every picker. [[product-picker-from-showcase]]
async function clearProductsConfirm() {
  const ok = await confirmDialog(
    "ล้างรายการสินค้าที่ดึงมาทั้งหมด?\nต้องดึงจาก Product Showcase ใหม่เพื่อใช้งานอีกครั้ง",
    { title: "ล้างสินค้า", okText: "ล้าง", cancelText: "ยกเลิก", danger: true }
  );
  if (ok) send({ type: "tiktok.clearProducts" });
}

// "Sync สินค้า" — choose which generate-form providers get the pulled products (their
// pickers show them). Resolves to a string[] of group keys, or null on cancel.
const SYNC_GROUPS = [
  { key: "flow", label: "Google Flow", sub: "labs.google", logo: "labsflow.png" },
  // Hidden per operator request — uncomment to restore.
  // { key: "supergrok", label: "SuperGrok", sub: "grok.com", logo: "grok-ai-icon.webp", invert: true },
  // { key: "kie", label: "KIE", sub: "kie.ai", logo: "kie.png" },
];
function syncProductsDialog(current) {
  if (activeModal) closeModal(null); // one modal at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const rows = SYNC_GROUPS.map(
      (g) =>
        `<label class="sync-opt">
          <input type="checkbox" value="${g.key}"${current.includes(g.key) ? " checked" : ""} />
          <span class="sync-opt-logo"><img src="/static/${g.logo}" alt=""${
            g.invert ? ' class="invert"' : ""
          } width="22" height="22" /></span>
          <span class="sync-opt-text">
            <span class="sync-opt-name">${escapeHtml(g.label)}</span>
            <span class="sync-opt-sub">${escapeHtml(g.sub)}</span>
          </span>
          <span class="sync-check" aria-hidden="true"></span>
        </label>`
    ).join("");
    overlay.innerHTML = `
      <div class="modal sync-modal" role="dialog" aria-modal="true" aria-labelledby="syncTitle">
        <div class="sync-head">
          <span class="sync-head-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1a1206"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" />
            </svg>
          </span>
          <div class="sync-head-text">
            <h3 class="modal-title" id="syncTitle">Sync สินค้าเข้าโหมดสร้าง</h3>
            <p class="sync-sub">เลือกโหมดที่จะให้ใช้สินค้าที่ดึงมา — picker จะโชว์เฉพาะโหมดที่เลือก</p>
          </div>
        </div>
        <div class="sync-opts">${rows}</div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-modal="cancel">ยกเลิก</button>
          <button type="button" class="btn primary" data-modal="ok">Sync</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-modal]");
      if (btn) {
        if (btn.dataset.modal === "ok") {
          const picked = [...overlay.querySelectorAll(".sync-opts input:checked")].map((c) => c.value);
          closeModal(picked);
        } else closeModal(null);
      } else if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-modal="ok"]')?.focus();
    });
  });
}

async function openSyncDialog() {
  if (!(lastProducts || []).length) {
    addLog("ยังไม่มีสินค้าให้ซิงค์ — ดึงสินค้าก่อน", "warn");
    return;
  }
  const picked = await syncProductsDialog(productSyncTargets);
  if (picked === null) return; // cancelled
  send({ type: "tiktok.syncProducts", data: { targets: picked } });
}
$("ttSync")?.addEventListener("click", openSyncDialog);

// Reflect the current sync targets in the Product Showcase ("ซิงค์อยู่: …") + show the
// Sync row whenever there are products to sync.
function updateSyncState() {
  const row = $("ttSyncRow");
  if (row) row.hidden = !(lastProducts || []).length;
  const label = $("ttSyncState");
  if (!label) return;
  const names = productSyncTargets.map((g) => PROVIDER_SECTION_LABEL[g] || g);
  label.textContent = names.length ? `ซิงค์อยู่: ${names.join(", ")}` : "ยังไม่ได้ซิงค์ไปที่โหมดไหน";
}

// file picked in a reference-image field → upload, then fill the URL + preview;
// the image→video switch → show/hide the video prompt + model
els.genForm.addEventListener("change", (e) => {
  const fileInput = e.target.closest("[data-upload-input]");
  if (fileInput) {
    uploadRefImage(fileInput);
    return;
  }
  // Date/time picker committed (ตกลง) → write the interval note + pop the interval dialog
  if (e.target.id === "f-scheduleAt") {
    applyScheduleIntervalUI(); // show/refresh the "ระยะห่าง X นาที" note in the time area
    maybeAskScheduleGap(); // then pop the popup to set it
    return;
  }
  // Delivery method (เลือกวิธีลงคลิป) → dim/restore the Setting TikTok card
  if (e.target.id === "f-postMode") {
    applyPostModeUI();
    return;
  }
  // No-text mode (Google Flow) → persist per-mode; read back at submit. [[flow-no-text-mode]]
  if (e.target.id === "f-noText") {
    setNoText(currentNav, e.target.checked);
    return;
  }
  // TikTok settings — master gate (เปิด/ปิดทั้งหมด)
  if (e.target.id === "tkMaster") {
    tiktokSettings.enabled = e.target.checked;
    applyTikTokToggleUI();
    saveTikTokSettings();
    return;
  }
  // TikTok settings — individual toggles + Disclose sub-options
  if (TK_TOGGLE_FIELD[e.target.id]) {
    tiktokSettings[TK_TOGGLE_FIELD[e.target.id]] = e.target.checked;
    if (e.target.id === "tkDisclose") {
      const sub = $("tkDiscloseSub");
      if (sub) sub.hidden = !e.target.checked;
    }
    if (e.target.id === "tkDisableCart") applyCartGate();
    saveTikTokSettings();
    return;
  }
});

// A hand-typed caption clears the auto-fill flag so a later product pick won't
// clobber it (programmatic auto-fill doesn't fire 'input', so it stays flagged).
els.genForm.addEventListener("input", (e) => {
  if (e.target.id === "f-caption") delete e.target.dataset.autofilled;
});

// POST a file to /api/upload and return the parsed result ({ok, url, public, error}).
// `mode` lets the server route KIE-mode uploads through KIE's public file store
// (other providers get a served /uploads URL). Shared by the generate-form ref
// pickers and the character popup.
async function uploadImage(file, mode) {
  const form = new FormData();
  form.append("file", file);
  if (mode) form.append("mode", mode);
  return (await fetch("/api/upload", { method: "POST", body: form })).json();
}

async function uploadRefImage(fileInput) {
  const name = fileInput.dataset.uploadInput;
  const file = fileInput.files?.[0];
  if (!file) return;
  const target = $(`f-${name}`);
  const preview = els.genForm.querySelector(`[data-upload-preview="${name}"]`);
  const btn = els.genForm.querySelector(`[data-upload-for="${name}"]`);
  if (btn) btn.disabled = true;
  addLog(`Uploading ${file.name}…`, "info");
  try {
    const res = await uploadImage(file, currentNav); // mode → KIE public routing
    if (!res.ok) {
      addLog(`Upload failed: ${res.error}`, "error");
      return;
    }
    // imageUrls accepts up to 2 comma-separated URLs — append; refImage is single
    if (target) {
      const cur = target.value.trim();
      target.value = name === "imageUrls" && cur ? `${cur}, ${res.url}` : res.url;
    }
    if (preview) {
      preview.hidden = false;
      preview.innerHTML = `<img class="job-thumb" src="${escapeHtml(res.url)}" alt="" />`;
    }
    addLog(`Uploaded${res.public ? " to KIE" : ""}: ${res.url}`, "info");
  } catch (err) {
    addLog(`Upload error: ${err}`, "error");
  } finally {
    if (btn) btn.disabled = false;
    fileInput.value = ""; // allow re-picking the same file
  }
}

// AI-script key gate: the generate "think" step (sell-script + vision) needs an
// OpenAI OR OpenRouter key. The operator made this MANDATORY — when neither is set,
// Run/Retry pop this dialog and route the user to Settings ▸ API Keys instead of
// generating (mirrors the hub's server-side QUEUE_RUN/JOB_RETRY gate). `setupHasAiKey`
// is kept current by applyApiKeys on every ui.state. Returns true when a key is present.
async function ensureAiKeyForRun() {
  // Post-only (โพสต์ TikTok อย่างเดียว) runs no LLM "think" step, so the AI-key gate never
  // applies to it (mirrors the hub's _ai_gate_exempt backstop). [[tiktok-post-only-mode]]
  if (setupHasAiKey || NAV[currentNav]?.postOnly) return true;
  const go = await confirmDialog(
    "ต้องใส่ API Key ของ OpenAI หรือ OpenRouter อย่างใดอย่างหนึ่งก่อน จึงจะเริ่มรันงานได้",
    { title: "ยังไม่ได้ใส่ API Key", okText: "ไปใส่ API Key", cancelText: "ปิด" }
  );
  if (go) {
    setNav("settings");
    setSubtab("llm"); // the "API Keys" sub-tab
  }
  return false;
}

// "Run" — first check the AI key gate, then pop the inter-row delay dialog (กด Run แล้ว
// มีเวลามาให้ใส่), then drain THIS mode's queue oldest-first. The dialog pre-fills with the
// last-used window; the chosen values persist (settings.update) so run_queue reads them,
// then queue.run fires. `mode` scopes the server-side drain so other modes' rows stay put.
$("runQueue")?.addEventListener("click", async () => {
  if ($("runQueue")?.disabled) return; // already draining
  if (!(await ensureAiKeyForRun())) return; // no OpenAI/OpenRouter key → popup, don't run
  const cfg = await runDelayDialog({ ...rowDelay });
  if (!cfg) return; // cancelled — don't run
  rowDelay = cfg;
  saveRowDelay(); // persist the chosen window BEFORE queue.run (hub reads it from settings)
  send({ type: "queue.run", data: { mode: currentNav } });
});
// "Stop" — halt THIS mode's drain and cancel the row(s) in flight (only visible while
// a drain is live; updateQueueButton swaps it in for Run). Scoped to the open mode.
$("stopQueue")?.addEventListener("click", () => {
  const btn = $("stopQueue");
  if (btn) {
    btn.disabled = true; // one stop per drain; reset when the drain ends
    const label = btn.querySelector(".btn-label");
    if (label) label.textContent = "กำลังหยุด…";
  }
  send({ type: "queue.stop", data: { mode: currentNav } });
});
// "Clear" — empty THIS mode's Recent Jobs rows. Persisted, so confirm first; rows
// still generating/publishing (and every other mode's rows) are kept server-side.
// Clear now offers a choice: เลือกลบเฉพาะแถว (enter selection mode) or ลบทั้งหมด
// (the old per-mode clear). In-flight rows are kept either way (the hub protects them).
$("clearJobs")?.addEventListener("click", async () => {
  const choice = await choiceDialog(
    "งานที่กำลังรันอยู่จะถูกเก็บไว้เสมอ",
    {
      title: "ล้าง Recent Jobs",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#1c1206" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 9h18M9 4v16"/><path d="M13 13.5l2 2 3.5-3.5"/></svg>`,
      choices: [
        {
          value: "selected",
          label: "เลือกลบเฉพาะแถว",
          sub: "ติ๊กเลือกทีละแถวที่ต้องการลบ",
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>`,
        },
        {
          value: "all",
          label: "ลบทั้งหมด",
          sub: "ลบทุกแถวของโหมดนี้",
          kind: "danger",
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M5.5 7l.9 12.1a2 2 0 0 0 2 1.9h7.2a2 2 0 0 0 2-1.9L18.5 7"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/></svg>`,
        },
      ],
      cancelText: "ยกเลิก",
    }
  );
  if (choice === "all") send({ type: "jobs.clear", data: { mode: currentNav } });
  else if (choice === "selected") enterSelectMode();
});

// ---- "เลือกลบเฉพาะแถว": grid row-selection mode ----
// Source of truth = a Set of selected batch-keys (stable across the grid re-renders that
// fire on every state broadcast). renderJobsGrid re-applies the ticks after rebuilding,
// so a background update never wipes the in-progress selection.
let selectMode = false;
const selectedRows = new Set();
const jobsCardEl = () => $("clearJobs")?.closest(".jobs-card");

function enterSelectMode() {
  if (!jobsForCurrentMode(lastJobsForGrid).length) {
    addLog("ไม่มีงานให้เลือกลบในโหมดนี้", "warn");
    return;
  }
  selectMode = true;
  selectedRows.clear();
  jobsCardEl()?.classList.add("selecting");
  renderJobsGrid(lastJobsForGrid); // re-render to expose the per-row checkboxes
}

function exitSelectMode() {
  if (!selectMode) return;
  selectMode = false;
  selectedRows.clear();
  jobsCardEl()?.classList.remove("selecting");
  renderJobsGrid(lastJobsForGrid);
}

// reflect the selected count on the "ลบที่เลือก (n)" button + its disabled state
function updateSelectToolbar() {
  const del = $("deleteSelected");
  if (!del) return;
  const n = selectedRows.size;
  del.disabled = n === 0;
  const label = del.querySelector(".btn-label");
  if (label) label.textContent = n ? `ลบที่เลือก (${n})` : "ลบที่เลือก";
}

// after a (re)render: re-tick rows still selected, drop selections whose row vanished
function applySelectionToGrid() {
  const table = jobsCardEl()?.querySelector("[data-jobs-grid]");
  if (!table) return;
  const present = new Set();
  table.querySelectorAll("tr[data-batch-key]").forEach((tr) => {
    const key = tr.dataset.batchKey;
    present.add(key);
    const cb = tr.querySelector("[data-row-pick]");
    if (!cb) return;
    if (cb.disabled) {
      selectedRows.delete(key); // a selected row that started running → unselect it
      return;
    }
    cb.checked = selectedRows.has(key);
  });
  [...selectedRows].forEach((k) => present.has(k) || selectedRows.delete(k));
  updateSelectToolbar();
}

// tick / untick one row — keyboard path (space/enter fires `change`); the mouse path
// is handled by the paint-select handlers below (which set .checked programmatically,
// so they don't fire `change`).
document.addEventListener("change", (e) => {
  const cb = e.target.closest("[data-row-pick]");
  if (!cb) return;
  const key = cb.closest("tr[data-batch-key]")?.dataset.batchKey;
  if (!key) return;
  if (cb.checked) selectedRows.add(key);
  else selectedRows.delete(key);
  updateSelectToolbar();
});

// ---- click-and-drag to tick a range of rows ("paint" select) ----
// Hold left mouse on a row's checkbox and drag over others to set them all the same.
// mousedown picks the paint value (opposite of that row); dragging over any part of a
// row paints it. The native MOUSE click toggle is swallowed (it would double-toggle the
// first row) — but KEYBOARD activation (detail===0) is left alone, so a11y still works.
let paintingRows = false;
let paintValue = false;

function setRowChecked(label, val) {
  const input = label.querySelector("[data-row-pick]");
  if (!input || input.disabled || input.checked === val) return; // no-op if unchanged
  input.checked = val;
  const key = label.closest("tr[data-batch-key]")?.dataset.batchKey;
  if (!key) return;
  if (val) selectedRows.add(key);
  else selectedRows.delete(key);
  updateSelectToolbar();
}

document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // left button only
  const label = e.target.closest(".jobs-card.selecting .row-pick");
  if (!label) return;
  const input = label.querySelector("[data-row-pick]");
  if (!input || input.disabled) return;
  e.preventDefault(); // no text-selection / focus flicker while dragging
  paintingRows = true;
  paintValue = !input.checked;
  setRowChecked(label, paintValue);
});

// while painting, entering any part of a row paints that row's checkbox
document.addEventListener("mouseover", (e) => {
  if (!paintingRows) return;
  const tr = e.target.closest(".jobs-card.selecting tr[data-batch-key]");
  const label = tr?.querySelector(".row-pick");
  if (label) setRowChecked(label, paintValue);
});

document.addEventListener("mouseup", () => { paintingRows = false; });
window.addEventListener("blur", () => { paintingRows = false; }); // pointer left the window

// swallow the native toggle that follows a MOUSE click (we set it on mousedown already)
document.addEventListener(
  "click",
  (e) => {
    if (e.detail > 0 && e.target.closest(".jobs-card.selecting .row-pick")) e.preventDefault();
  },
  true
);

// เลือกทั้งหมด — toggle every selectable (non-running) row at once
$("selectAll")?.addEventListener("click", () => {
  const table = jobsCardEl()?.querySelector("[data-jobs-grid]");
  if (!table) return;
  const boxes = [...table.querySelectorAll("[data-row-pick]:not(:disabled)")];
  const turnOn = !(boxes.length && boxes.every((b) => b.checked));
  boxes.forEach((b) => {
    b.checked = turnOn;
    const key = b.closest("tr[data-batch-key]")?.dataset.batchKey;
    if (key) turnOn ? selectedRows.add(key) : selectedRows.delete(key);
  });
  updateSelectToolbar();
});

$("cancelSelect")?.addEventListener("click", exitSelectMode);

// ลบที่เลือก — gather every ticked row's job ids (a batch row carries all its siblings),
// confirm, then send a selective jobs.clear and leave selection mode.
$("deleteSelected")?.addEventListener("click", async () => {
  const table = jobsCardEl()?.querySelector("[data-jobs-grid]");
  if (!table) return;
  const ids = [];
  table.querySelectorAll("[data-row-pick]:checked").forEach((cb) => {
    const tr = cb.closest("tr[data-job-ids]");
    (tr?.dataset.jobIds || "").split(",").filter(Boolean).forEach((id) => ids.push(id));
  });
  if (!ids.length) return;
  const ok = await confirmDialog(
    `ลบ ${selectedRows.size} แถวที่เลือก?\nงานที่กำลังรันอยู่จะถูกเก็บไว้`,
    { title: "ลบแถวที่เลือก", okText: "ลบ", cancelText: "ยกเลิก", danger: true }
  );
  if (!ok) return;
  send({ type: "jobs.clear", data: { ids } });
  exitSelectMode();
});
// "ลองใหม่ทั้งหมด" — re-run EVERY failed row in THIS mode at once (the per-row "↻ ลองใหม่"
// does a single row). Hidden by renderJobsGrid unless the open mode has failures. Retry
// regenerates, so it's gated on the AI key like Run (mirrors the hub's JOB_RETRY gate).
$("retryFailed")?.addEventListener("click", () => {
  if (!setupHasAiKey) { ensureAiKeyForRun(); return; } // no OpenAI/OpenRouter key → popup
  send({ type: "job.retry", data: { mode: currentNav } });
});
// "โพสต์ใหม่ทั้งหมด" — re-run the TikTok POST for EVERY row in THIS mode whose clip is done
// but the post failed/staged (reuses the clip, no regeneration). The per-row "↻ โพสต์ใหม่"
// does a single row. Hidden by renderJobsGrid unless the open mode has retryable posts.
$("republishFailed")?.addEventListener("click", () =>
  send({ type: "job.republish", data: { mode: currentNav } })
);

// reflect queue state on the Run/Stop buttons: while a drain is live Run goes into a
// disabled spinner and the Stop button appears; when it ends Stop hides and resets.
function updateQueueButton(running) {
  const btn = $("runQueue");
  if (btn) {
    btn.disabled = !!running;
    btn.classList.toggle("is-running", !!running); // swaps the play glyph for a spinner
    const label = btn.querySelector(".btn-label");
    if (label) label.textContent = running ? "กำลังรัน…" : "Run";
  }
  const stop = $("stopQueue");
  if (stop) {
    stop.hidden = !running;
    if (!running) {
      stop.disabled = false; // reset the "กำลังหยุด…" click state for next time
      const label = stop.querySelector(".btn-label");
      if (label) label.textContent = "Stop";
    }
  }
  if (!running) renderCountdown(null); // drain ended — make sure the countdown is gone
}

// ---- inter-row delay: pause a random N seconds between Recent-jobs rows ----
// Configured by a dialog that pops on Run (กด Run แล้วมีเวลามาให้ใส่); persisted in
// AppSettings (row_delay_*) so the last-used window is remembered. The hub honours it
// in run_queue (after a row's generate + TikTok post) and broadcasts a per-second
// countdown rendered by the HUD-style overlay below.
const ROW_DELAY_DEFAULT = { enabled: false, min: 400, max: 600 };
let rowDelay = { ...ROW_DELAY_DEFAULT };

function clampDelaySecs(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(86400, n)) : fallback;
}

// Persist the current window (the hub re-clamps + swaps a reversed pair server-side).
function saveRowDelay() {
  send({
    type: "settings.update",
    data: {
      rowDelayEnabled: rowDelay.enabled,
      rowDelayMinS: rowDelay.min,
      rowDelayMaxS: rowDelay.max,
    },
  });
}

// Mirror persisted settings into the in-memory state so the Run dialog pre-fills with
// the last-used window (the dialog is the only surface now — no always-on controls).
function applyRowDelay(s) {
  if (typeof s.rowDelayEnabled === "boolean") rowDelay.enabled = s.rowDelayEnabled;
  if (Number.isFinite(s.rowDelayMinS)) rowDelay.min = s.rowDelayMinS;
  if (Number.isFinite(s.rowDelayMaxS)) rowDelay.max = s.rowDelayMaxS;
}

// The "กด Run แล้วมีเวลามาให้ใส่" dialog. Resolves {enabled, min, max} on "เริ่ม Run",
// or null on cancel/backdrop/Esc (Run aborts). Reuses the shared modal lifecycle.
function runDelayDialog(initial) {
  if (activeModal) closeModal(null); // one modal at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal rd-dialog" role="dialog" aria-modal="true" aria-labelledby="rdDlgTitle">
        <h3 class="modal-title" id="rdDlgTitle">หน่วงเวลาระหว่างแถว</h3>
        <p class="modal-body">สุ่มเวลารอในช่วงนี้หลังโพสต์ TikTok เสร็จ ก่อนเริ่มทำแถวถัดไป</p>
        <label class="rd-dlg-toggle">
          <span class="tk-switch">
            <input type="checkbox" id="rdDlgEnabled" ${initial.enabled ? "checked" : ""} />
            <span class="tk-track"><span class="tk-thumb"></span></span>
          </span>
          <span>เปิดหน่วงเวลาระหว่างแถว</span>
        </label>
        <div class="rd-dlg-range" id="rdDlgRange">
          <input type="number" id="rdDlgMin" class="row-delay-input" min="0" max="86400"
                 step="1" value="${initial.min}" inputmode="numeric" aria-label="ต่ำสุด (วินาที)" />
          <span class="row-delay-dash">–</span>
          <input type="number" id="rdDlgMax" class="row-delay-input" min="0" max="86400"
                 step="1" value="${initial.max}" inputmode="numeric" aria-label="สูงสุด (วินาที)" />
          <span class="row-delay-unit">วินาที</span>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-rd="cancel">ยกเลิก</button>
          <button type="button" class="btn primary" data-rd="run">▶ เริ่ม Run</button>
        </div>
      </div>`;
    const enBox = overlay.querySelector("#rdDlgEnabled");
    const range = overlay.querySelector("#rdDlgRange");
    const syncOff = () => range.classList.toggle("rd-off", !enBox.checked);
    enBox.addEventListener("change", syncOff);
    syncOff();
    const readCfg = () => {
      let lo = clampDelaySecs(overlay.querySelector("#rdDlgMin")?.value, initial.min);
      let hi = clampDelaySecs(overlay.querySelector("#rdDlgMax")?.value, initial.max);
      if (lo > hi) [lo, hi] = [hi, lo]; // a reversed pair is a typo — normalise it
      return { enabled: !!enBox.checked, min: lo, max: hi };
    };
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rd]");
      if (btn) closeModal(btn.dataset.rd === "run" ? readCfg() : null);
      else if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeModal(null); }
      else if (e.key === "Enter") { e.preventDefault(); closeModal(readCfg()); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-rd="run"]')?.focus();
    });
  });
}

// ---- inter-row countdown overlay (queue.countdown) ----
// Big m:ss readout of how long until the next row starts — the operator can wait or
// hit "ข้ามการรอ" to start now. Non-blocking, so Stop stays reachable behind it.
function fmtCountdown(s) {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function renderCountdown(d) {
  const overlay = $("rowDelayOverlay");
  if (!overlay) return;
  if (!d || !d.active) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  const count = $("rowDelayCount");
  if (count) count.textContent = fmtCountdown(d.remaining);
  const bar = $("rowDelayBar");
  if (bar) {
    const pct = d.total > 0 ? Math.max(0, Math.min(100, (d.remaining / d.total) * 100)) : 0;
    bar.style.width = `${pct}%`;
  }
}

$("rowDelaySkip")?.addEventListener("click", () => {
  // Scope the skip to THIS tab's mode so it can't shorten a concurrent mode's wait.
  send({ type: "queue.skipDelay", data: { mode: currentNav } });
  countdownByMode.delete(currentNav);
  const overlay = $("rowDelayOverlay");
  if (overlay) overlay.hidden = true; // optimistic — the hub also broadcasts active:false
});

// ---- in-app modal dialogs (themed replacement for native confirm/alert) ----
let activeModal = null;

function closeModal(result) {
  if (!activeModal) return;
  const { overlay, resolve, onKey, prev } = activeModal;
  activeModal = null;
  document.removeEventListener("keydown", onKey, true);
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 150); // let the fade-out finish
  if (prev && typeof prev.focus === "function") prev.focus();
  resolve(result);
}

// Dashboard "รายละเอียด" button → a details modal for the GT Pro Beta 0 app (static info
// + an "เข้าใช้งาน" CTA that enters the workspace). Reuses the shared .modal-overlay.
function showBotDetails() {
  if (activeModal) closeModal(null); // one modal at a time
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal bot-detail-modal" role="dialog" aria-modal="true" aria-labelledby="botDetailTitle">
      <div class="bot-detail-head">
        <span class="bot-detail-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" /></svg>
        </span>
        <div>
          <h3 class="modal-title" id="botDetailTitle">GT Pro Beta 0</h3>
          <p class="bot-detail-tag">สร้างคลิป + โพสต์ TikTok อัตโนมัติ</p>
        </div>
      </div>
      <div class="modal-body bot-detail-body">
        <p>สร้างคลิปวิดีโอสินค้าอัตโนมัติด้วย Google Flow (Veo) แล้วโพสต์ขึ้น TikTok พร้อมผูกสินค้า TikTok Shop ให้ในขั้นตอนเดียว</p>
        <ul class="bot-detail-list">
          <li>สร้างภาพ → ต่อเป็นวิดีโอด้วย Google Flow</li>
          <li>ดึงสินค้าจาก TikTok Shop มาทำคอนเทนต์</li>
          <li>โพสต์อัตโนมัติ + ผูกตะกร้าสินค้า</li>
          <li>ตั้งคิวหลายคลิป ทำงานต่อเนื่อง</li>
        </ul>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-bot-detail="close">ปิด</button>
        <button type="button" class="btn primary" data-bot-detail="enter">เข้าใช้งาน</button>
      </div>
    </div>`;
  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bot-detail]");
    if (btn) {
      const enter = btn.dataset.botDetail === "enter";
      closeModal(null);
      if (enter) setNav("product-showcase");
    } else if (e.target === overlay) {
      closeModal(null); // backdrop
    }
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal(null);
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  activeModal = { overlay, resolve: () => {}, onKey, prev: document.activeElement };
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    overlay.querySelector('[data-bot-detail="enter"]')?.focus();
  });
}

// Themed confirm. opts: {title, okText, cancelText, danger}. Resolves true/false.
// Enter = OK, Esc / backdrop click = cancel. `message` honours \n (pre-line).
function confirmDialog(message, opts = {}) {
  const { title = "ยืนยัน", okText = "ตกลง", cancelText = "ยกเลิก", danger = false } = opts;
  if (activeModal) closeModal(false); // one at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h3 class="modal-title" id="modalTitle">${escapeHtml(title)}</h3>
        <p class="modal-body">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-modal="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"}" data-modal="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-modal]");
      if (btn) closeModal(btn.dataset.modal === "ok");
      else if (e.target === overlay) closeModal(false); // backdrop = cancel
    });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeModal(false); }
      else if (e.key === "Enter") { e.preventDefault(); closeModal(true); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-modal="ok"]')?.focus();
    });
  });
}

// Themed alert — a single-button info popup with the same look as confirmDialog. Resolves
// when dismissed (OK / Enter / Esc / backdrop). `message` honours \n (pre-line). Uses the
// .alert-modal class to sit ABOVE everything (incl. the datetime picker at z-1200), so it
// can be shown while that popover is open. opts: {title, okText}.
function alertDialog(message, opts = {}) {
  const { title = "แจ้งเตือน", okText = "ตกลง" } = opts;
  if (activeModal) closeModal(null); // one at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay alert-modal";
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modalTitle">
        <h3 class="modal-title" id="modalTitle">${escapeHtml(title)}</h3>
        <p class="modal-body">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn primary" data-modal="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-modal="ok"]') || e.target === overlay) closeModal(true);
    });
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); closeModal(true); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-modal="ok"]')?.focus();
    });
  });
}

// Themed multi-choice dialog — icon header + selectable option cards (each: icon, name,
// optional sub-line) + a full-width cancel. opts: {title, icon (raw SVG), choices:
// [{value,label,sub,icon,kind}], cancelText}. Resolves the chosen value, or null on
// cancel / backdrop / Esc. `message` (optional) shows as a sub-line under the title.
// NOTE: `icon`/`c.icon` are developer-authored SVG markup, injected raw (not escaped).
function choiceDialog(message, opts = {}) {
  const { title = "เลือก", icon = "", choices = [], cancelText = "ยกเลิก" } = opts;
  if (activeModal) closeModal(null); // one at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const cards = choices
      .map(
        (c) => `
        <button type="button" class="choice-opt${c.kind ? ` choice-${c.kind}` : ""}" data-choice="${escapeHtml(c.value)}">
          ${c.icon ? `<span class="choice-opt-ico" aria-hidden="true">${c.icon}</span>` : ""}
          <span class="choice-opt-text">
            <span class="choice-opt-name">${escapeHtml(c.label)}</span>
            ${c.sub ? `<span class="choice-opt-sub">${escapeHtml(c.sub)}</span>` : ""}
          </span>
          <span class="choice-opt-caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </span>
        </button>`
      )
      .join("");
    overlay.innerHTML = `
      <div class="modal choice-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="choice-head">
          ${icon ? `<span class="choice-head-ico" aria-hidden="true">${icon}</span>` : ""}
          <div class="choice-head-text">
            <h3 class="modal-title" id="modalTitle">${escapeHtml(title)}</h3>
            ${message ? `<p class="choice-sub">${escapeHtml(message)}</p>` : ""}
          </div>
        </div>
        <div class="choice-opts">${cards}</div>
        <button type="button" class="btn ghost choice-cancel" data-choice="">${escapeHtml(cancelText)}</button>
      </div>`;
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-choice]");
      if (btn) closeModal(btn.dataset.choice || null);
      else if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeModal(null); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector("[data-choice]")?.focus();
    });
  });
}

// ---- Custom Prompt editor (per-mode System Prompt) ----
// A scrollable modal built from PROMPT_SCHEMA[mode]: collapsible Normal / No-Text
// groups of textareas seeded with the effective value (override or factory default).
// "บันทึก" diffs every field against its default and sends ONE settings.update patch —
// fields equal to the default are cleared (stored as ""), so only real edits persist.
function peFieldHtml(mode, fld) {
  const val = effectivePrompt(mode, fld.key);
  const edited = !!promptOverride(mode, fld.key);
  const rows = Math.min(16, Math.max(3, Math.round((val.length || 0) / 90) + 2));
  return `<div class="pe-field${edited ? " edited" : ""}">
    <div class="pe-field-head">
      <label for="pe-${fld.key}">${escapeHtml(fld.label)}${edited ? ' <span class="pe-edited">แก้แล้ว</span>' : ""}</label>
      <button type="button" class="btn tiny ghost" data-pe-reset="${fld.key}">↺ ค่าเริ่มต้น</button>
    </div>
    <textarea id="pe-${fld.key}" data-pe-field="${fld.key}" rows="${rows}" spellcheck="false"
      placeholder="ใช้ค่าเริ่มต้น…">${escapeHtml(val)}</textarea>
  </div>`;
}
function peGroupHtml(mode, g) {
  const fields = g.fields.map((fld) => peFieldHtml(mode, fld)).join("");
  if (g.kind === "plain") return `<div class="pe-group pe-plain">${fields}</div>`;
  return `<div class="pe-group pe-${g.kind}">
    <button type="button" class="pe-trigger" aria-expanded="false">
      <span class="pe-badge pe-badge-${g.kind}">${escapeHtml(g.badge)}</span>
      ${g.sub ? `<span class="pe-gsub">${escapeHtml(g.sub)}</span>` : ""}
      <span class="pe-chev" aria-hidden="true">▾</span>
    </button>
    <div class="pe-group-body" hidden>${fields}</div>
  </div>`;
}
function peSectionHtml(mode, sec) {
  const groups = sec.groups.map((g) => peGroupHtml(mode, g)).join("");
  return `<section class="pe-section">
    <div class="pe-sec-head"><span class="pe-dot"></span>
      <h4>${escapeHtml(sec.title)}</h4>
      ${sec.sub ? `<span class="pe-sec-sub">${escapeHtml(sec.sub)}</span>` : ""}
    </div>
    ${groups}
  </section>`;
}
function promptEditorHtml(mode, schema) {
  const sections = schema.sections.map((sec) => peSectionHtml(mode, sec)).join("");
  return `<div class="modal pe-modal" role="dialog" aria-modal="true" aria-labelledby="peTitle">
    <div class="pe-head">
      <div>
        <h3 class="modal-title" id="peTitle">⚙ Custom Prompt</h3>
        <p class="pe-mode">${escapeHtml(schema.title)}</p>
      </div>
      <button type="button" class="pe-x" data-pe="close" aria-label="ปิด" title="ปิด (Esc)">✕</button>
    </div>
    <div class="pe-body">${sections}</div>
    <div class="pe-actions">
      <button type="button" class="btn ghost tiny" data-pe="reset-all">↺ รีเซ็ตทั้งหมด</button>
      <span class="pe-spacer"></span>
      <button type="button" class="btn ghost" data-pe="close">ยกเลิก</button>
      <button type="button" class="btn primary" data-pe="save">💾 บันทึก</button>
    </div>
  </div>`;
}
function openPromptEditor(mode) {
  const schema = PROMPT_SCHEMA[mode];
  if (!schema) return;
  if (activeModal) closeModal(null); // one modal at a time
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay pe-overlay";
  overlay.innerHTML = promptEditorHtml(mode, schema);

  const save = () => {
    const patch = {};
    overlay.querySelectorAll("[data-pe-field]").forEach((ta) => {
      const field = ta.dataset.peField;
      const val = (ta.value || "").trim();
      const store = val && val !== promptDefault(mode, field).trim() ? val : ""; // "" = use default
      if (store !== promptOverride(mode, field)) patch[spKey(mode, field)] = store;
    });
    const changed = Object.keys(patch).length;
    if (changed) {
      for (const [k, v] of Object.entries(patch)) {
        if (v) systemPrompts[k] = v;
        else delete systemPrompts[k]; // optimistic mirror; hub echoes the merged map
      }
      send({ type: "settings.update", data: { systemPrompts: patch } });
    }
    refreshPromptButton();
    addLog(changed ? `บันทึก System Prompt (${changed} ช่อง)` : "System Prompt ไม่มีการเปลี่ยนแปลง", "info");
    closeModal(null);
  };

  overlay.addEventListener("click", (e) => {
    const trig = e.target.closest(".pe-trigger");
    if (trig) {
      const open = trig.getAttribute("aria-expanded") === "true";
      trig.setAttribute("aria-expanded", String(!open));
      const body = trig.nextElementSibling;
      if (body) body.hidden = open;
      return;
    }
    const reset = e.target.closest("[data-pe-reset]");
    if (reset) {
      const ta = overlay.querySelector(`[data-pe-field="${reset.dataset.peReset}"]`);
      if (ta) ta.value = promptDefault(mode, reset.dataset.peReset);
      return;
    }
    if (e.target.closest('[data-pe="reset-all"]')) {
      overlay.querySelectorAll("[data-pe-field]").forEach((ta) => {
        ta.value = promptDefault(mode, ta.dataset.peField);
      });
      return;
    }
    if (e.target.closest('[data-pe="save"]')) return save();
    if (e.target.closest('[data-pe="close"]')) return closeModal(null);
    if (e.target === overlay) closeModal(null); // backdrop = cancel
  });
  // Esc closes; Enter must NOT submit (textareas need newlines).
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeModal(null); }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  activeModal = { overlay, resolve: () => {}, onKey, prev: document.activeElement };
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    overlay.querySelector(".pe-x")?.focus();
  });
}

// ---- character reference popup (shown on "+ เพิ่มลงคิว") ----
// Two-step: first asks ใส่ตัวละครไหม? — "ไม่ใส่" resolves straight away with no
// characters (the job queues immediately); "ใส่" reveals the config step: 1–2
// reference images per submit. With 2 characters AND more than one clip queued, it
// also asks how to spread them: the SAME pair on every clip, or one RANDOM character
// per clip (variety across a batch). Resolves to
// { characters: string[], distribution: "same"|"random" }, or null if cancelled.
const MAX_CHARACTERS = 2;

// ---- saved character library ("คลังตัวละคร") ----
// Locally-uploaded character images are remembered server-side (characters.json)
// so the operator can pick them again next time instead of re-uploading. Holds
// thumbnail URLs only ({ id, url }), newest-first, mirrored from /api/characters.
let savedCharacters = [];

async function loadSavedCharacters() {
  try {
    const res = await (await fetch("/api/characters")).json();
    savedCharacters = res.ok && Array.isArray(res.characters) ? res.characters : [];
  } catch {
    savedCharacters = [];
  }
  return savedCharacters;
}

async function saveCharacter(url) {
  try {
    const form = new FormData();
    form.append("url", url);
    const res = await (await fetch("/api/characters", { method: "POST", body: form })).json();
    if (res.ok && res.character) {
      // newest-first, de-duped by url (mirror the server)
      savedCharacters = [
        res.character,
        ...savedCharacters.filter((c) => c.url !== res.character.url),
      ];
    }
  } catch (e) {
    addLog(`Could not save character: ${e}`, "warn");
  }
}

async function deleteCharacter(id) {
  try {
    await fetch(`/api/characters/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    addLog(`Could not delete character: ${e}`, "warn");
  }
  savedCharacters = savedCharacters.filter((c) => c.id !== id);
}

// Fill one upload slot from either a fresh upload or a saved-library pick.
function setCharSlot(overlay, state, idx, url, label) {
  state.urls[idx] = url;
  const nameEl = overlay.querySelector(`[data-char-name="${idx}"]`);
  if (nameEl) nameEl.textContent = label;
  const preview = overlay.querySelector(`[data-char-preview="${idx}"]`);
  if (preview) {
    preview.hidden = false;
    preview.innerHTML = `<img class="job-thumb" src="${escapeHtml(url)}" alt="" />`;
  }
}

// Clicking a saved thumbnail drops it into the first empty slot (within the chosen
// count); if every slot is full it replaces the last one.
function pickSavedCharacter(overlay, state, url) {
  let idx = -1;
  for (let i = 0; i < state.count; i++) {
    if (!state.urls[i]) { idx = i; break; }
  }
  if (idx === -1) idx = state.count - 1;
  setCharSlot(overlay, state, idx, url, "เลือกจากคลัง");
  const hint = overlay.querySelector("[data-char-hint]");
  if (hint && hint.classList.contains("warn")) {
    hint.classList.remove("warn");
    hint.textContent = "อัปโหลดรูปตัวละครเพื่อใช้เป็น reference ในการสร้าง";
  }
}

// Render the saved-character pick row (hidden when the library is empty).
function renderSavedCharacters(overlay) {
  const wrap = overlay.querySelector("[data-char-saved]");
  const list = overlay.querySelector("[data-char-saved-list]");
  if (!wrap || !list) return;
  if (!savedCharacters.length) {
    wrap.hidden = true;
    list.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  list.innerHTML = savedCharacters
    .map(
      (c) => `<div class="char-saved-item" data-char-pick="${escapeHtml(c.url)}" title="กดเพื่อเลือก">
        <img class="job-thumb" src="${escapeHtml(c.url)}" alt="" />
        <button type="button" class="char-saved-del" data-char-del="${escapeHtml(c.id)}" aria-label="ลบออกจากคลัง" title="ลบออกจากคลัง">ร—</button>
      </div>`
    )
    .join("");
}

function charSlotHtml(idx, hidden) {
  return `<div class="char-slot" data-char-slot="${idx}"${hidden ? " hidden" : ""}>
    <span class="field-label">ตัวละครแถว ${idx + 1}</span>
    <div class="upload-row">
      <button type="button" class="btn tiny upload-btn" data-char-upload="${idx}">⬆ อัปโหลด</button>
      <input type="file" accept="image/*" data-char-file="${idx}" hidden />
      <span class="char-name" data-char-name="${idx}">ยังไม่ได้เลือก</span>
    </div>
    <div class="upload-preview" data-char-preview="${idx}" hidden></div>
  </div>`;
}

// One choice card for the ใส่/ไม่ใส่ step (same look as the Clear dialog's cards).
function charChoiceHtml(action, icon, name, sub) {
  return `<button type="button" class="choice-opt" data-char-choose="${action}">
    <span class="choice-opt-ico" aria-hidden="true">${icon}</span>
    <span class="choice-opt-text">
      <span class="choice-opt-name">${name}</span>
      <span class="choice-opt-sub">${sub}</span>
    </span>
    <span class="choice-opt-caret" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
    </span>
  </button>`;
}

const CHAR_ICON_USE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const CHAR_ICON_SKIP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/></svg>`;

function characterDialogHtml() {
  return `<div class="modal char-modal" role="dialog" aria-modal="true" aria-labelledby="charTitle">
    <h3 class="modal-title" id="charTitle" data-char-title>ใส่ตัวละครไหม?</h3>
    <p class="modal-hint" data-char-hint>เลือกว่าจะใช้รูปตัวละครเป็น reference ในการสร้างหรือไม่</p>
    <div class="choice-opts" data-char-choice>
      ${charChoiceHtml("use", CHAR_ICON_USE, "ใส่ตัวละคร", "เลือก 1–2 คน แล้วแนบรูป reference")}
      ${charChoiceHtml("skip", CHAR_ICON_SKIP, "ไม่ใส่ตัวละคร", "เพิ่มลงคิวเลย")}
    </div>
    <div data-char-config hidden>
      <div class="field">
        <span class="field-label">จำนวนตัวละคร</span>
        <div class="segmented" role="group" aria-label="จำนวนตัวละคร">
          <button type="button" class="seg active" data-char-count="1" aria-pressed="true">1 คน</button>
          <button type="button" class="seg" data-char-count="2" aria-pressed="false">2 คน</button>
        </div>
      </div>
      <div class="char-saved" data-char-saved hidden>
        <span class="field-label">ตัวละครที่บันทึกไว้ <span class="opt">(กดเพื่อเลือก)</span></span>
        <div class="char-saved-list" data-char-saved-list></div>
      </div>
      <div class="char-slots">${charSlotHtml(0, false)}${charSlotHtml(1, true)}</div>
      <div class="field" data-char-dist-field hidden>
        <span class="field-label">การกระจายตัวละคร <span class="opt">(มีหลายคลิป)</span></span>
        <div class="segmented" role="group" aria-label="การกระจายตัวละคร">
          <button type="button" class="seg active" data-char-dist="same" aria-pressed="true">เดียวกันทั้งหมด</button>
          <button type="button" class="seg" data-char-dist="random" aria-pressed="false">สุ่มต่อคลิป</button>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn ghost char-back" data-char-back hidden>← กลับ</button>
      <button type="button" class="btn ghost" data-char-cancel>ยกเลิก</button>
      <button type="button" class="btn primary" data-char-confirm hidden>+ เพิ่มลงคิว</button>
    </div>
  </div>`;
}

// Reflect `state` into the open dialog: which step shows (choice cards vs the
// upload config), active count/distribution segments, the second slot (only for 2),
// and the distribution field (only for 2 chars + >1 clip).
function syncCharacterDialog(overlay, state, jobCount) {
  const onConfig = state.step === "config";
  const choice = overlay.querySelector("[data-char-choice]");
  if (choice) choice.hidden = onConfig;
  const config = overlay.querySelector("[data-char-config]");
  if (config) config.hidden = !onConfig;
  const back = overlay.querySelector("[data-char-back]");
  if (back) back.hidden = !onConfig;
  const confirm = overlay.querySelector("[data-char-confirm]");
  if (confirm) confirm.hidden = !onConfig;
  const title = overlay.querySelector("[data-char-title]");
  if (title) title.textContent = onConfig ? "ใช้ตัวละครกี่คน?" : "ใส่ตัวละครไหม?";
  const hint = overlay.querySelector("[data-char-hint]");
  if (hint) {
    hint.classList.remove("warn"); // step switch clears the no-upload warning
    hint.textContent = onConfig
      ? "อัปโหลดรูปตัวละครเพื่อใช้เป็น reference ในการสร้าง"
      : "เลือกว่าจะใช้รูปตัวละครเป็น reference ในการสร้างหรือไม่";
  }
  overlay.querySelectorAll("[data-char-count]").forEach((b) => {
    const on = Number(b.dataset.charCount) === state.count;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const slot2 = overlay.querySelector('[data-char-slot="1"]');
  if (slot2) slot2.hidden = state.count < 2;
  const distField = overlay.querySelector("[data-char-dist-field]");
  if (distField) distField.hidden = !(state.count === 2 && jobCount > 1);
  overlay.querySelectorAll("[data-char-dist]").forEach((b) => {
    const on = b.dataset.charDist === state.distribution;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

async function uploadCharacterSlot(overlay, state, idx, fileInput) {
  const file = fileInput.files?.[0];
  if (!file) return;
  const btn = overlay.querySelector(`[data-char-upload="${idx}"]`);
  const nameEl = overlay.querySelector(`[data-char-name="${idx}"]`);
  if (btn) btn.disabled = true;
  if (nameEl) nameEl.textContent = "กำลังอัปโหลด…";
  try {
    const res = await uploadImage(file, currentNav); // mode → KIE public routing
    if (!res.ok) {
      if (nameEl) nameEl.textContent = `ไม่สำเร็จ: ${res.error || ""}`;
      addLog(`Character upload failed: ${res.error}`, "error");
      return;
    }
    setCharSlot(overlay, state, idx, res.url, file.name);
    // Remember locally-stored uploads so they can be re-picked next time. KIE's
    // public upload URLs expire, so only /uploads images join the library.
    if (typeof res.url === "string" && res.url.startsWith("/uploads/")) {
      await saveCharacter(res.url);
      renderSavedCharacters(overlay);
    }
  } catch (e) {
    if (nameEl) nameEl.textContent = "อัปโหลดผิดพลาด";
    addLog(`Character upload error: ${e}`, "error");
  } finally {
    if (btn) btn.disabled = false;
    fileInput.value = ""; // allow re-picking the same file
  }
}

function characterDialog(jobCount) {
  if (activeModal) closeModal(null); // one modal at a time
  return new Promise((resolve) => {
    const state = {
      step: "choice", // "choice" (ใส่/ไม่ใส่) → "config" (count + uploads)
      count: 1,
      urls: new Array(MAX_CHARACTERS).fill(null),
      distribution: "same",
    };
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = characterDialogHtml();

    const confirm = () => {
      const characters = state.urls.slice(0, state.count).filter(Boolean);
      // chose "ใส่ตัวละคร" but attached nothing — block: the skip card is the no-char path
      if (!characters.length) {
        const hint = overlay.querySelector("[data-char-hint]");
        if (hint) {
          hint.classList.add("warn");
          hint.textContent =
            "ยังไม่ได้แนบรูป — อัปโหลดอย่างน้อย 1 รูป หรือกด ← กลับ เพื่อไม่ใส่ตัวละคร";
        }
        overlay.querySelector('[data-char-upload="0"]')?.focus();
        return;
      }
      // the same/random choice only applies with 2 chars across >1 clip; else "same"
      const distribution = state.count === 2 && jobCount > 1 ? state.distribution : "same";
      closeModal({ characters, distribution });
    };

    overlay.addEventListener("click", (e) => {
      const choose = e.target.closest("[data-char-choose]");
      if (choose) {
        // "ไม่ใส่ตัวละคร" queues right away (no characters); "ใส่" opens the config step
        if (choose.dataset.charChoose === "skip")
          return closeModal({ characters: [], distribution: "same" });
        state.step = "config";
        syncCharacterDialog(overlay, state, jobCount);
        // focus the upload, NOT confirm — a held/double Enter from the choice card
        // must not instantly confirm with zero uploads
        overlay.querySelector('[data-char-upload="0"]')?.focus();
        return;
      }
      if (e.target.closest("[data-char-back]")) {
        state.step = "choice";
        syncCharacterDialog(overlay, state, jobCount);
        overlay.querySelector("[data-char-choose]")?.focus();
        return;
      }
      const cnt = e.target.closest("[data-char-count]");
      if (cnt) {
        state.count = Number(cnt.dataset.charCount);
        syncCharacterDialog(overlay, state, jobCount);
        return;
      }
      const dist = e.target.closest("[data-char-dist]");
      if (dist) {
        state.distribution = dist.dataset.charDist;
        syncCharacterDialog(overlay, state, jobCount);
        return;
      }
      const up = e.target.closest("[data-char-upload]");
      if (up) {
        overlay.querySelector(`[data-char-file="${up.dataset.charUpload}"]`)?.click();
        return;
      }
      // delete must win over pick (the ร— sits inside the saved thumbnail)
      const del = e.target.closest("[data-char-del]");
      if (del) {
        deleteCharacter(del.dataset.charDel).then(() => renderSavedCharacters(overlay));
        return;
      }
      const pick = e.target.closest("[data-char-pick]");
      if (pick) {
        pickSavedCharacter(overlay, state, pick.dataset.charPick);
        return;
      }
      if (e.target.closest("[data-char-confirm]")) return confirm();
      if (e.target.closest("[data-char-cancel]")) return closeModal(null);
      if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    overlay.addEventListener("change", (e) => {
      const f = e.target.closest("[data-char-file]");
      if (f) uploadCharacterSlot(overlay, state, Number(f.dataset.charFile), f);
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector("[data-char-choose]")?.focus();
    });
    syncCharacterDialog(overlay, state, jobCount);
    // Pull the saved-character library and render the pick row (it may resolve
    // after the dialog is closed — guard against a stale overlay).
    loadSavedCharacters().then(() => {
      if (document.body.contains(overlay)) renderSavedCharacters(overlay);
    });
  });
}

// Batch guard shared by both submit paths — warns + returns false on an empty or
// over-cap "หลายสินค้า" selection (so we don't open the character popup for nothing).
function validBatchCount(products) {
  if (!products.length) {
    addLog("ติ๊กเลือกสินค้าอย่างน้อย 1 รายการ", "warn");
    return false;
  }
  if (products.length > MAX_BATCH_PRODUCTS) {
    addLog(`เลือกได้สูงสุด ${MAX_BATCH_PRODUCTS} รายการต่อครั้ง — เอาออกบางรายการก่อน`, "warn");
    return false;
  }
  return true;
}

async function submitJob() {
  const m = NAV[currentNav];
  if (!m || m.view !== "generate" || m.comingSoon) return;
  if (m.postOnly) return submitPostOnlyJob(m); // โพสต์ TikTok อย่างเดียว — no generation
  if (m.mediaSwitch) return submitSwitchJob(m);
  if (blockIfProductSourceMissing()) return;
  if (blockIfNoProduct(m)) return; // Shop tag / Loop image ref needs a product first
  const val = (name) => ($(`f-${name}`)?.value || "").trim();

  // The job prompt is the mode's saved Content System Prompt (override or factory
  // default), used for every job. Storyboard overrides it with its per-job scenes.
  const schema = PROMPT_SCHEMA[currentNav];
  let prompt = schema ? effectivePrompt(currentNav, schema.primaryKey) : "";
  const options = {};
  if (m.scenes) {
    const scenes = $$("#scenesWrap [data-scene]").map((i) => i.value.trim()).filter(Boolean);
    if (!scenes.length) {
      $("scenesWrap")?.querySelector("[data-scene]")?.focus();
      addLog("เพิ่มอย่างน้อย 1 ฉาก", "warn");
      return;
    }
    options.scenes = JSON.stringify(scenes);
    prompt = scenes.join(" | "); // scenes are the per-job content for storyboard
  } else if (!prompt && !m.promptOptional) {
    addLog("ตั้ง System Prompt ของโหมดนี้ก่อน (ปุ่ม Custom Prompt)", "warn");
    $("openCustomPrompt")?.focus();
    return;
  }

  OPTION_KEYS.forEach((k) => {
    const v = val(k);
    if (v) options[k] = v;
  });
  // specGrid modes (flow-extend) expose the same model ยท ขนาด grid as clip8 — collect
  // them here (a flat mode without the fields just reads ""). imageModel is cosmetic for
  // extend (no image step) but collected for parity. [[flow-extend-hidden-stub]]
  const imageModel = val("imageModel");
  if (imageModel && imageModel !== "pending") options.imageModel = imageModel;
  const videoModel = val("videoModel");
  if (videoModel) options.videoModel = videoModel;
  const aspect = val("aspect");
  if (aspect) options.aspect = aspect;
  const clipCount = val("clipCount"); // flow-extend: number of clips to chain (2-10)
  if (clipCount) options.clipCount = clipCount;

  // flow-extend: send the per-clip prompt SET like clip8's image→video, PLUS one Video
  // Prompt per chained clip. The hub's AI thinking (_think_extend) writes an N-part script
  // and fills each (image base + Video Prompt 1..N). [[flow-extend-hidden-stub]]
  if (m.clipCount && schema) {
    const n = Math.max(2, Math.min(10, parseInt(clipCount || "2", 10) || 2));
    // No-text mode (Google Flow): swap each template to its "…NoText" variant so the base
    // image carries no headline and the clips order any stray text erased. [[flow-no-text-mode]]
    const ntKey = (k) => noTextTemplateKey(currentNav, k);
    const imgT = resolveVariations(
      effectivePrompt(currentNav, ntKey(schema.imageKey || "imagePromptTemplate"))
    );
    if (imgT) prompt = imgT; // base image prompt (replaces the content system prompt)
    const v1 = effectivePrompt(currentNav, ntKey(schema.videoKey || "videoPromptTemplate"));
    if (v1) options.promptVideo = v1; // Video Prompt 1 = base clip's video
    // The LAST scene must ALWAYS close the sale: regardless of how many scenes are picked,
    // give the final clip the dedicated "Final closing clip" template (clip 9 — points at
    // camera, strong CTA, peak energy) instead of its positional one. The AI still fills the
    // last script segment (the CTA) into it, so the closing visual + closing speech line up.
    // [[flow-extend-hidden-stub]]
    const CLOSING_VP_KEY = "videoPrompt9Template";
    for (let k = 2; k <= n; k++) {
      const tplKey = k === n ? CLOSING_VP_KEY : `videoPrompt${k}Template`; // Video Prompt N (Extended)
      const t = effectivePrompt(currentNav, ntKey(tplKey));
      if (t) options[`extendPrompt${k}`] = t;
    }
    // flow-extend has its OWN multi-scene system prompt (contentSystemPromptExtended) written
    // for the N-segment chain (speech + extendSpeeches). The single-clip primaryKey gives the
    // LLM a self-contradicting brief, so prefer the extended one (fall back if it's blank).
    // [[flow-extend-hidden-stub]]
    const contentPrompt = effectivePrompt(currentNav, ntKey("contentSystemPromptExtended"))
      || effectivePrompt(currentNav, ntKey(schema.primaryKey));
    if (contentPrompt) options.contentPrompt = contentPrompt; // LLM system prompt for the script
  }
  // No-text mode flag for the backend (Google Flow only): drives _build_style_ctx (clip8)
  // + _think_extend (extend) to blank headlines / keep the no-text guards. [[flow-no-text-mode]]
  if (m.provider === "google_labs" && noTextEnabled(currentNav)) options.noText = "1";

  // Banner overlay (Loop): when the toggle is on, send the placement + the optional uploaded
  // image. If no image is uploaded the backend AI-generates a SALE-header banner. [[flow-loop-mode]]
  if (m.banner && $("bannerEnabled")?.checked) {
    options.banner = "1";
    const bImg = ($("f-bannerImage")?.value || "").trim();
    if (bImg) options.bannerImage = bImg; // uploaded → use it; absent → AI generates
    options.bannerX = val("bannerX") || "50";
    options.bannerY = val("bannerY") || "14";
    options.bannerSize = val("bannerSize") || "80";
    options.bannerOpacity = val("bannerOpacity") || "100";
    options.bannerShape = $("f-bannerShape")?.value || "square";
  }

  // required URL fields (e.g. Kling needs an image + a video) — fail in the UI
  // with focus, rather than submitting a job that the backend immediately rejects
  const missing = (m.requiredOptions || []).find((k) => !options[k]);
  if (missing) {
    $(`f-${missing}`)?.focus();
    // The clip picker (jobpick) isn't a URL — give it its own message.
    const msg = FIELD_DEFS[missing]?.type === "jobpick"
      ? "เลือกคลิปต้นทางที่จะต่อก่อน"
      : "Fill in the required image/video URL first.";
    addLog(msg, "warn");
    return;
  }

  const hashtags = val("hashtags")
    .split(/[\s,]+/)
    .map((h) => h.replace(/^#/, ""))
    .filter(Boolean);

  // "ปิดปักตะกร้า" (Setting TikTok) drops ONLY the Shop product tag (product_id) at post time —
  // the product still feeds image generation (cover reference + name) and the "หลายสินค้า" batch
  // still fans out, exactly as when the cart is on. So cartOff gates only product_id (below); the
  // picker, the batch, and the cover are unaffected. generate-only modes (Loop) never pin either
  // way but still carry the product as their image reference. [[product-required-to-enqueue]] [[flow-loop-mode]]
  const cartOff = m.generateOnly ? false : cartDisabled();
  const batch = selectedBatchProducts();
  if (batch && !validBatchCount(batch)) return;
  if (!batch) {
    const pImg = productImageFor(productIdValue());
    if (pImg) options.productImage = pImg;
    if (m.clipCount) {
      const pTitle = productTitleFor(productIdValue());
      if (pTitle) options.productTitle = pTitle; // product name for the AI script step
    }
  }

  if (!validatePostMode()) return; // "ตั้งเวลาโพสต์" with no time → abort before queuing

  const data = {
    source: m.provider,
    prompt,
    // locked modes have no toggle in the DOM — take the media type from the mode
    media_type: m.lockMedia ? m.media : mediaValue(),
    count: 1, // one clip per submit (the Count fan-out was replaced by เลือกวิธีลงคลิป)
    // generate-only modes (Loop) have no delivery selector and must never post.
    publish_mode: m.generateOnly ? POST_MODE_GENERATE_ONLY : postModeValue(),
    publish_at: m.generateOnly ? "" : postScheduleValue(), // SCHEDULE mode only — the target post time
    mode: currentNav,
    options,
    tiktok_account_id: val("tiktokAccount") || null,
    target: {
      caption: val("caption"),
      hashtags,
      product_id: cartOff ? null : productIdValue() || null,
    },
  };

  // Character popup: pick 1–2 reference characters (and how to spread them across the
  // queued clips). Cancelling aborts the whole add. Modes with no character layer (Loop)
  // skip the popup entirely and queue with no character. [[flow-loop-mode]]
  const charCfg = m.noCharacter
    ? { characters: [], distribution: "same" }
    : await characterDialog(batch ? batch.length : 1);
  if (charCfg === null) return;

  const queued = dispatchJob(data, batch, charCfg, !cartOff); // cart off → reference only, no tag
  if (!queued) return; // batch requested but invalid (none ticked / over the cap)

  // The prompt comes from the saved System Prompt (or scenes) — nothing to persist here;
  // edits are saved from the Custom Prompt editor. [[system-prompt]]
  addLog(
    queued > 1
      ? `Queued ${queued}ร— (1/สินค้า): ${m.label} ยท ${prompt.slice(0, 40)}`
      : `Queued: ${m.label} ยท ${prompt.slice(0, 50)}`,
    "info"
  );
}

// image→video submit: split prompts + per-step model in `options`; prompt = the
// image prompt (keeps the boundary validator + extension `prompt` working). Sends
// one job (single pick), or one standalone clip per ticked product ("หลายสินค้า").
async function submitSwitchJob(m) {
  if (blockIfProductSourceMissing()) return;
  if (blockIfNoProduct(m)) return; // Shop tag / Loop image ref needs a product first
  const val = (name) => ($(`f-${name}`)?.value || "").trim();
  // image→video: the IMAGE step reads the "Image Prompt" field; the VIDEO step reads
  // the "Video Prompt" field (set below). Fall back to the primary prompt if a mode
  // has no image template. [[system-prompt]]
  const schema = PROMPT_SCHEMA[currentNav];
  // No-text mode (Google Flow only) swaps each template to its "…NoText" variant; a no-op
  // for grok/kie and when the toggle is off. [[flow-no-text-mode]]
  const ntKey = (k) => noTextTemplateKey(currentNav, k);
  const prompt = schema ? effectivePrompt(currentNav, ntKey(schema.imageKey || schema.primaryKey)) : "";
  if (!prompt) {
    addLog("ตั้ง System Prompt ของโหมดนี้ก่อน (ปุ่ม Custom Prompt)", "warn");
    $("openCustomPrompt")?.focus();
    return;
  }
  // image→video only (the "image only" toggle was removed)
  const mediaFlow = "image_video";
  const mediaType = "video";

  const options = {};
  // mode-specific fields (product / kieAspect / kieResolution …) that still apply
  OPTION_KEYS.forEach((k) => {
    const v = val(k);
    if (v) options[k] = v;
  });
  options.mediaFlow = mediaFlow;
  const aspect = val("aspect"); // generic ขนาด selector (Flow/Grok); KIE uses kieAspect
  if (aspect) options.aspect = aspect;
  const imageModel = val("imageModel");
  if (imageModel && imageModel !== "pending") options.imageModel = imageModel;
  const videoModel = val("videoModel");
  if (videoModel) options.videoModel = videoModel;
  // grok.com Imagine toolbar controls (image→video): the image-step select IS the
  // Quality control; plus resolution + duration. grok has no API enum — these are the
  // on-screen labels the extension clicks. grokResolution/grokDuration are NOT in
  // OPTION_KEYS (the flat submit path doesn't render them). [[supergrok-config-redesign]]
  if (m.provider === "grok") {
    if (options.imageModel) {
      options.grokImageQuality = options.imageModel;
      delete options.imageModel;
    }
    const grokResolution = val("grokResolution");
    if (grokResolution) options.grokResolution = grokResolution;
    const grokDuration = val("grokDuration");
    if (grokDuration) options.grokDuration = grokDuration;
  }
  // the standing video-prompt template (image→video step); omit when it matches the
  // image prompt (the extension falls back to `prompt` if promptVideo is blank).
  const promptVideo = schema ? effectivePrompt(currentNav, ntKey(schema.videoKey)) : "";
  if (promptVideo && promptVideo !== prompt) options.promptVideo = promptVideo;
  // grok-extend: per-segment continuation prompts. The base clip uses promptVideo; each
  // +10s extend uses its OWN "พูดต่อเนื่อง ไม่ทักทายใหม่" template — Clip 2 = Extend Prompt 1,
  // Clip 3 = Extend Prompt 2. Mirror flow-extend's extendPrompt{N} convention (N = clip
  // number) so the grok engine picks extendPrompt{N} per extend (falls back to promptVideo).
  // Other grok modes have no extend templates → effectivePrompt returns "" → no-op.
  if (m.provider === "grok" && schema) {
    const ext1 = effectivePrompt(currentNav, "extendVideoPromptTemplate1");
    const ext2 = effectivePrompt(currentNav, "extendVideoPromptTemplate2");
    if (ext1) options.extendPrompt2 = ext1;
    if (ext2) options.extendPrompt3 = ext2;
  }

  // AI "thinking" — flow-clip8 writes the sell script + fills [..._PLACEHOLDER] slots;
  // every other generate mode uses it to AUTO-PICK the direction columns (Video Style →
  // สไตล์บทพูด) like Clip 8s. Send the Content System Prompt as the LLM system message; the
  // product name is attached below (per pick / per batch). Harmless when a mode has no
  // content prompt (stays unset). The server strips both before they reach the provider.
  {
    const contentPrompt = schema ? effectivePrompt(currentNav, ntKey(schema.primaryKey)) : "";
    if (contentPrompt) options.contentPrompt = contentPrompt;
  }
  // No-text mode flag for the backend (Google Flow only): drives _build_style_ctx to blank
  // the headline + use the no-text image/video assembly. [[flow-no-text-mode]]
  if (m.provider === "google_labs" && noTextEnabled(currentNav)) options.noText = "1";

  const hashtags = val("hashtags")
    .split(/[\s,]+/)
    .map((h) => h.replace(/^#/, ""))
    .filter(Boolean);
  // "ปิดปักตะกร้า" (Setting TikTok) drops ONLY the Shop product tag (product_id) — the product
  // cover + name still feed generation and the batch still fans out, same as when the cart is on.
  const cartOff = cartDisabled();
  const target = { caption: val("caption"), hashtags, product_id: cartOff ? null : productIdValue() || null };

  // "หลายสินค้า": one standalone clip per ticked product (no batch_id — each product is its own
  // row; it auto-publishes with its own tag unless the cart is off). Otherwise a single clip.
  const batch = selectedBatchProducts();
  if (batch && !validBatchCount(batch)) return;
  if (!validatePostMode()) return; // "ตั้งเวลาโพสต์" with no time → abort before queuing

  // Character popup, sized to however many clips this submit will queue.
  const charCfg = await characterDialog(batch ? batch.length : 1);
  if (charCfg === null) return;

  // single-pick product cover → Reference (batch sets it per product in dispatchJob). The cover
  // feeds generation whether or not the product is tagged, so this is independent of the cart toggle.
  if (!batch) {
    const pImg = productImageFor(productIdValue());
    if (pImg) options.productImage = pImg;
    const pTitle = productTitleFor(productIdValue());
    if (pTitle) options.productTitle = pTitle; // product name for the AI script / direction pick
  }

  // One job per submit (single or one-per-product). dispatchJob injects the character
  // image(s) and, for a batch, fans out one standalone clip per ticked product.
  const queued = dispatchJob(
    {
      source: m.provider,
      // resolve [TIME/MOOD/CAMERA_VARIATIONS] to one pick each for this submit
      prompt: resolveVariations(prompt),
      media_type: mediaType,
      count: 1,
      publish_mode: postModeValue(), // โพสต์ / Save draft / ตั้งเวลา / ส่วนตัว / สร้างไม่โพสต์
      publish_at: postScheduleValue(), // SCHEDULE mode only — the target post time
      mode: currentNav,
      options,
      tiktok_account_id: val("tiktokAccount") || null,
      target,
    },
    batch,
    charCfg,
    !cartOff // cart off → keep the product as a reference but drop its Shop tag
  );
  if (!queued) return;
  addLog(
    queued > 1
      ? `Queued ${queued}ร— (1/สินค้า): ${m.label} ยท ${prompt.slice(0, 40)}`
      : `Queued: ${m.label} ยท ${prompt.slice(0, 50)}`,
    "info"
  );
}

// ---- WebSocket ----
const MAX_RECONNECT = 12; // then give up and tell the user to restart
let reconnectAttempts = 0;

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/ui`;
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    addLog("Connected to app", "info");
  });
  socket.addEventListener("message", (ev) => handleMessage(JSON.parse(ev.data)));
  socket.addEventListener("close", () => {
    setExtConnected(false);
    resetTikTokButtons(true); // a pull/run in flight will never get its reply now
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT) {
      addLog("Server stopped — restart the app to reconnect.", "error");
      return;
    }
    const delay = Math.min(1500 * reconnectAttempts, 30000); // backoff, capped at 30s
    addLog(`Disconnected from app — retrying in ${Math.round(delay / 1000)}s…`, "warn");
    setTimeout(connect, delay);
  });
}

function handleMessage(msg) {
  if (msg.type === "ui.state") {
    renderAuth(msg.data.auth);
    setExtConnected(msg.data.extensionConnected);
    // Per-mode: the Run/Stop button reflects the CURRENT tab's mode only, so a running
    // Clip 8s doesn't disable Extend Clip's Run (they run concurrently). Falls back to the
    // legacy global flag if an older server omits runningModes. [[per-mode-concurrent-run]]
    lastRunningModes = msg.data.runningModes || (msg.data.queueRunning ? [currentNav] : []);
    updateQueueButton(lastRunningModes.includes(currentNav));
    renderJobs(msg.data.jobs || []);
    renderJobsGrid(msg.data.jobs || []);
    refreshExtendPicker(); // keep the Flow Extend source-clip list current
    renderAccounts(msg.data.accounts || []);
    applySettings(msg.data.settings);
    applyApiKeys(msg.data.keys);
    renderUpdate(msg.data.update);
    // Sidebar version pill from the ALWAYS-present version (a profile child disables update-
    // checking, so update.current may be absent). [[multi-profile]]
    if (msg.data.version) {
      const vp = document.querySelector(".sb-version");
      if (vp) vp.textContent = "v" + msg.data.version;
    }
    // "What's new" popup: detect a just-applied update (running version > last seen) and
    // arm the post-login/in-workspace popup. version is always present; notes ride update.
    maybeWhatsNew(msg.data.version, msg.data.update);

    renderSetupGate(); // after auth/ext/keys are applied → drive the onboarding wizard
    dismissBootVeil(); // server state is in → reveal the app (or login) under the splash
  } else if (msg.type === "log") {
    // Replayed backlog (sent to every fresh connection so the Log window doesn't
    // reset on reopen) is old activity — the separate Log window renders it, but the
    // main panel must not count it as new unread or resurface a stale error.
    if (msg.data.replay) return;
    addLog(msg.data.message, msg.data.level);
    // Same for the setup wizard: if a key-save we kicked off failed, the backend
    // reports it via the (occluded) Log window only — mirror it into the overlay.
    if (msg.data.level === "error" && setupKeySaving) {
      setupKeySaving = false;
      const sm = $("setupKeyMsg");
      if (sm) {
        sm.hidden = false;
        sm.className = "setup-key-msg warn";
        sm.textContent = `บันทึกไม่สำเร็จ: ${msg.data.message}`;
      }
    }
  } else if (msg.type === "queue.countdown") {
    // Tag-by-mode: store this mode's countdown, but only paint the overlay when it's for the
    // tab being viewed (a concurrent mode's countdown waits until you switch to it). A null
    // mode (legacy/global) shows on any tab. [[per-mode-concurrent-run]]
    const d = msg.data || {};
    const m = d.mode == null ? null : d.mode;
    if (d.active) countdownByMode.set(m, d);
    else countdownByMode.delete(m);
    if (m == null || m === currentNav) renderCountdown(d.active ? d : null);
  } else if (msg.type === "tiktok.products") {
    const d = msg.data || {};
    // A successful pull (or the restore on connect) becomes the picker's source.
    // A failure leaves the previously-saved list intact.
    if (d.ok && Array.isArray(d.products)) {
      if (Array.isArray(d.syncTargets)) productSyncTargets = d.syncTargets;
      // The account that owns these products — used to lock the publish account so the
      // pin can land. Absent (e.g. extension pull) → null → picking a product blocks.
      productSourceAccountId = d.accountId || null;
      productSourceAccountEmail = d.accountEmail || "";
      lastProducts = d.products;
      populateProductPickers();
    }
    renderTikTokProducts(d);
  }
}

function send(obj) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
}

// ---- connection state ----
function setExtConnected(on) {
  extConnected = on;
  const text = on ? "Extension connected" : "Extension offline";
  [els.extPill, els.extPill2, els.sbStatus].forEach((el) => el && (el.dataset.on = String(on)));
  [els.extPillText, els.extPillText2, els.sbStatusText].forEach((el) => el && (el.textContent = text));
  refreshSubmitState();
  if (els.connectedNote) els.connectedNote.hidden = !on;
  // Program-side connect button: connected → disabled "✓ เชื่อมต่อแล้ว"; offline → actionable
  // again (but don't stomp the "กำลังเชื่อมต่อ…" label while an attempt is still polling).
  if (els.connectExtBtn) {
    if (on) {
      extConnecting = false;
      els.connectExtBtn.disabled = true;
      els.connectExtBtn.textContent = "✓ เชื่อมต่อแล้ว";
      if (els.connectExtHint) els.connectExtHint.hidden = true;
    } else if (!extConnecting) {
      els.connectExtBtn.disabled = false;
      els.connectExtBtn.textContent = "⚡ เชื่อมต่อ Extension";
      if (els.connectExtHint) {
        els.connectExtHint.hidden = false;
        els.connectExtHint.textContent = "กดเพื่อเปิด Chrome โปรไฟล์ที่ติดตั้งส่วนขยายไว้ แล้วเชื่อมต่อให้อัตโนมัติ";
      }
    }
  }
}

// ---- Product Showcase: pull EVERY product into the picker (no clip needed) ----
// Pulling products is a cookie-authed API crawl — no clip/tab required. One client-side
// lock so a second click can't clobber the in-flight pull's button/box.
let ttBusy = false;

// Re-enable the pull button. `lost` = the socket dropped while a pull was in flight
// (so the reply will never arrive) → show a recoverable error.
function resetTikTokButtons(lost) {
  const wasBusy = ttBusy;
  ttBusy = false;
  const pull = $("ttPull");
  if (pull) {
    pull.disabled = false;
    pull.textContent = "⬇ ดึงสินค้าทั้งหมด";
  }
  if (lost && wasBusy) {
    const box = $("ttPullResult");
    if (box && /(กำลัง|⏳)/.test(box.innerHTML)) {
      box.innerHTML = '<p class="tt-pull-err">การเชื่อมต่อหลุด — ลองใหม่อีกครั้ง</p>';
    }
  }
}

// ---- Pull EVERY showcase product via the API (all pages) — no clip required ----
function requestTikTokPull() {
  if (ttBusy) {
    addLog("กำลังทำงานอยู่ — รอให้เสร็จก่อน", "warn");
    return;
  }
  ttBusy = true;
  const pull = $("ttPull");
  if (pull) {
    pull.disabled = true;
    pull.textContent = "กำลังดึง…";
  }
  const box = $("ttPullResult");
  if (box) {
    box.hidden = false;
    box.innerHTML =
      '<p class="muted-text">⏳ กำลังดึงสินค้าทุกหน้า… (ดูความคืบหน้าใน Log)</p>';
  }
  send({ type: "tiktok.pull", data: { tiktokAccountId: $("ttAccount")?.value || null } });
}

function renderTikTokProducts(d) {
  resetTikTokButtons(false);
  const box = $("ttPullResult");
  if (!box) return;
  box.hidden = false;
  if (d.connected === false) {
    box.innerHTML = '<p class="tt-pull-err">ส่วนขยายไม่ได้เชื่อมต่อ — เปิด Extension แล้วลองใหม่</p>';
    return;
  }
  if (d.cleared) {
    box.innerHTML = '<p class="muted-text">ล้างรายการสินค้าแล้ว — กด “ดึงสินค้าทั้งหมด” เพื่อดึงใหม่</p>';
    updateSyncState(); // products gone → hide the Sync row
    return;
  }
  if (d.ok === false) {
    box.innerHTML = `<p class="tt-pull-err">ดึงไม่สำเร็จ${
      d.error ? " (" + escapeHtml(String(d.error)) + ")" : ""
    } — ตรวจว่าล็อกอิน TikTok แล้ว</p>`;
    return;
  }
  const products = Array.isArray(d.products) ? d.products : [];
  const total = d.total ?? products.length; // every product scanned
  const available = d.available ?? products.length; // in-stock + addable (the kept ones)
  const outOfStock = d.outOfStock ?? Math.max(0, total - available); // out-of-stock OR unavailable
  // Show the TikTok modal's page count (the modal lists 6 products/page, so
  // ceil(total/6) matches its "…108 109 110"), not the API's internal paging.
  const pages = total ? Math.ceil(total / 6) : d.pages ?? 0;
  const partial = d.partial ? " (บางส่วน — อาจมีหน้าโหลดไม่ครบ)" : "";
  const rows = products
    .map((p, i) => {
      // The รูป cell opens the image chooser (fetch the gallery on demand → pick a
      // cover). Products with no cover yet still get a "เลือกรูป" button.
      const img = `<button type="button" class="tt-thumb-btn" data-choose-image="${escapeHtml(
        String(p.id)
      )}" title="เลือก/เปลี่ยนรูปสินค้า">${
        p.image
          ? `<img class="tt-thumb" data-prod-img="${escapeHtml(String(p.id))}" src="${escapeHtml(
              p.image
            )}" alt="" loading="lazy" />`
          : '<span class="tt-thumb-pick">เลือกรูป</span>'
      }</button>`;
      return `<tr>
        <td class="col-n">${i + 1}</td>
        <td>${img}</td>
        <td class="tt-name"><span class="grid-prompt" title="${escapeHtml(p.title || "")}">${
        escapeHtml(p.title || "") || '<span class="cell-empty">—</span>'
      }</span></td>
        <td class="tt-id">${escapeHtml(String(p.id || ""))}</td>
        <td class="tt-price">${escapeHtml(String(p.price || ""))}</td>
        <td class="tt-stock">${p.stock == null ? "–" : escapeHtml(String(p.stock))}</td>
      </tr>`;
    })
    .join("");
  box.innerHTML = `
    <div class="tt-pull-head">
      <strong>พร้อมขาย ${available.toLocaleString()} รายการ</strong>
      <span class="muted-text">ยท หมดสต๊อก ${outOfStock.toLocaleString()} ยท ทั้งหมด ${total.toLocaleString()} ยท ${pages} หน้า${partial}</span>
    </div>
    <div class="tt-pull-wrap">
      <table class="jobs-grid tt-pull-table">
        <thead><tr>
          <th class="col-n">#</th><th>รูป</th><th>ชื่อสินค้า</th>
          <th>Product ID</th><th>ราคา</th><th>สต็อก</th>
        </tr></thead>
        <tbody>${rows || '<tr class="empty-row"><td colspan="6">ไม่พบสินค้า</td></tr>'}</tbody>
      </table>
    </div>`;
  // The pull button + sync row are always visible now (the clip step is optional),
  // so there's nothing to reveal here — just refresh the sync label.
  updateSyncState();
}

const ttPullBtn = $("ttPull");
if (ttPullBtn) ttPullBtn.addEventListener("click", requestTikTokPull);

// The Product Showcase account chip reflects which TikTok account a pull will use.
$("ttAccount")?.addEventListener("change", updateTtAccountChip);

// "↺ รีเซ็ต" — back to the fresh state: clears the pulled products (the pull button
// stays available). The TikTok account is kept. Destructive (also wipes products.json),
// so confirm first. [[tiktok-one-click-run]]
async function resetProductShowcase() {
  const ok = await confirmDialog(
    "รีเซ็ตแหล่งสินค้า?\nสินค้าที่ดึงมาจะถูกล้างทั้งหมด (กลับไปเริ่มใหม่) — บัญชี TikTok ยังอยู่",
    { title: "รีเซ็ตแหล่งสินค้า", okText: "รีเซ็ต", cancelText: "ยกเลิก", danger: true }
  );
  if (!ok) return;
  ttBusy = false; // any in-flight pull's reply will just no-op against the reset UI
  // the pull button stays available — just reset its label + clear the result
  const pull = $("ttPull");
  if (pull) {
    pull.disabled = false;
    pull.textContent = "⬇ ดึงสินค้าทั้งหมด";
  }
  const pullRes = $("ttPullResult");
  if (pullRes) {
    pullRes.hidden = true;
    pullRes.innerHTML = "";
  }
  // wipe the pulled products server-side too (empties every picker via the broadcast)
  send({ type: "tiktok.clearProducts" });
  addLog("รีเซ็ตแหล่งสินค้าแล้ว — กดดึงสินค้าใหม่ได้เลย", "info");
}
$("ttReset")?.addEventListener("click", resetProductShowcase);

// ---- jobs ----
const JOB_STATUSES = ["queued", "generating", "publishing", "done", "failed", "cancelled"];
const ACTIVE_STATUSES = ["generating", "publishing"]; // progress ticking (NOT queued — it hasn't started)

// ---- History Jobs (the History view's global list) ----
// Each row carries a stable #N (creation order — #1 = งานแรกสุด) plus its created
// date/time, so a customer can report "งาน #12 เมื่อ 11/06 19:32" and the operator
// can match it to the per-job debug folder (named by that same timestamp). Rows
// that REALLY failed (generation FAILED, or the TikTok post FAILED) grow a
// dropdown explaining the cause in Thai via error-explain.js; other rows never
// show it.
function fmtCreated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The "สาเหตุที่ล้มเหลว" dropdown for one row. Only rendered for real failures;
// covers both legs separately (generate vs TikTok post) since a row can generate
// fine and still fail at the post step.
// One explained-cause block (shared by the History view's dropdown AND the generate
// view's failures modal): friendly Thai title/detail/fix from error-explain.js plus
// the raw system message. `label` names the leg (generate vs TikTok post).
function failCauseBlock(label, raw, stage) {
  const ex = window.TB_ERRORS;
  const info = ex ? ex.explain(raw) : null;
  const stageTxt = stage ? (ex ? ex.stageLabel(stage) : stage) : "";
  return `
      <div class="jf-block">
        <div class="jf-leg">${escapeHtml(label)}${stageTxt ? ` — ขั้นตอน: ${escapeHtml(stageTxt)}` : ""}</div>
        ${info ? `<div class="jf-title">${escapeHtml(info.title)}</div>` : ""}
        ${info && info.detail ? `<div class="jf-detail">${escapeHtml(info.detail)}</div>` : ""}
        ${info && info.fix ? `<div class="jf-fix">วิธีแก้: ${escapeHtml(info.fix)}</div>` : ""}
        <div class="jf-raw">ข้อความระบบ: ${escapeHtml(raw || "(ไม่มีรายละเอียดจากระบบ)")}</div>
      </div>`;
}

// The explained-cause block(s) for one job — generation leg and/or TikTok-post leg
// (a row can generate fine and still fail at the post step). Empty array when neither.
function failCauseParts(j) {
  const parts = [];
  if (j.status === "failed") parts.push(failCauseBlock("การสร้างคลิปล้มเหลว", j.error, j.stage));
  // "staged" = uploaded but the auto-post didn't land — surfaced as a post error too, so
  // it gets the same Thai-cause dropdown (its publishError carries the staged note).
  if (j.publishStatus === "failed" || j.publishStatus === "staged")
    parts.push(failCauseBlock("การโพสต์ TikTok ล้มเหลว", j.publishError, j.stage));
  return parts;
}

function failDropdown(j) {
  const parts = failCauseParts(j);
  if (!parts.length) return "";
  return `
    <details class="job-fail" data-fail-id="${escapeHtml(String(j.id))}">
      <summary>สาเหตุที่ล้มเหลว</summary>
      <div class="job-fail-body">${parts.join("")}</div>
    </details>`;
}

// History-row labels: readable provider names (raw enum values read as log noise)
const HISTORY_SOURCE_LABEL = { google_labs: "Google Flow", grok: "SuperGrok", kie: "KIE" };
const HISTORY_MEDIA_LABEL = { video: "วิดีโอ", image: "ภาพ" };

function renderJobs(jobs) {
  const rowHtml = (j, n) => {
    // every field arrives over the WS — escape before it hits innerHTML
    const status = JOB_STATUSES.includes(j.status) ? j.status : "queued";
    // headline = product name / caption (displayTitle); the raw prompt is a
    // system-prompt TEMPLATE on flow-clip8, so it only shows as a last resort
    // (grok/kie modes, where the user typed the prompt themselves)
    const title = (j.displayTitle || "").trim() || j.prompt;
    // thumbnail: product cover / character ref first, then the start image,
    // then an image result; videos get a placeholder (no <video> in the list)
    const thumb =
      (j.references && j.references[0]) ||
      j.imageUrl ||
      (j.mediaType === "image" ? j.mediaUrl : null);
    const pic = thumb
      ? `<img class="job-pic" src="${escapeHtml(thumb)}" alt="" loading="lazy">`
      : `<span class="job-pic job-pic-empty">🎬</span>`;
    const meta = [
      fmtCreated(j.createdAt),
      HISTORY_SOURCE_LABEL[j.source] || j.source,
      HISTORY_MEDIA_LABEL[j.mediaType] || j.mediaType,
      j.mode || null,
      String(j.id),
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join(" ยท ");
    return `
        <li class="job">
          <span class="job-n">#${n}</span>
          ${pic}
          <div class="job-main">
            <div class="job-prompt">${escapeHtml(title)}</div>
            <div class="job-meta">${meta}${j.stage ? " ยท " + escapeHtml(j.stage) : ""}</div>
          </div>
          <span class="badge ${status}">${escapeHtml(j.status)}</span>
          ${failDropdown(j)}
        </li>`;
  };

  // #N is assigned on the FULL list (creation order) BEFORE any limit slicing,
  // so a row keeps its number even when an element only shows the last N.
  // Rows render OLDEST-FIRST (#1 on top, new jobs appended at the bottom) —
  // same reading order as the generate view's Recent Jobs grid.
  const numbered = jobs.map((j, i) => [j, i + 1]);

  $$("[data-jobs]").forEach((el) => {
    // a state broadcast rebuilds the list — keep whichever สาเหตุ dropdowns the
    // user already opened from snapping shut mid-read
    const open = new Set(
      [...el.querySelectorAll("details.job-fail[open]")].map((d) => d.dataset.failId)
    );
    // pin-to-bottom like a log: keep following the newest row unless the user
    // has scrolled up to read older ones
    const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const limit = parseInt(el.dataset.limit || "0", 10);
    const rows = limit ? numbered.slice(-limit) : numbered;
    el.innerHTML = rows.length
      ? rows.map(([j, n]) => rowHtml(j, n)).join("")
      : '<li class="empty">No jobs yet.</li>';
    open.forEach((id) => {
      const d = el.querySelector(`details.job-fail[data-fail-id="${CSS.escape(id)}"]`);
      if (d) d.open = true;
    });
    if (follow) el.scrollTop = el.scrollHeight;
  });

  if (els.jobCount) els.jobCount.textContent = jobs.length;
  updateStats(jobs);
}

// ---- jobs grid (read-only): #, reference, prompt, result, progress, status ----
let lastJobsForGrid = []; // kept so the 1s progress ticker can re-derive elapsed time

function elapsedSeconds(j) {
  // Count REAL run time only: from when the job started generating to its finish
  // (or now). A queued job has no startedAt → null → the grid shows "–", so the
  // timer never ticks before the job actually runs (no "running before Run" look).
  if (!j.startedAt) return null;
  const start = Date.parse(j.startedAt);
  if (isNaN(start)) return null;
  const end = j.finishedAt ? Date.parse(j.finishedAt) : Date.now();
  if (isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

// Aggregate progress for a batch row: the longest elapsed time across siblings, a
// spinner while any is still running, ✓ once every sibling is done, and a
// done/total tally when the batch holds more than one item.
function progressCellBatch(items) {
  const times = items.map(elapsedSeconds).filter((s) => s !== null);
  const secs = times.length ? Math.max(...times) : null;
  const txt = secs === null ? "–" : `${secs}s`;
  const active = items.some((j) => ACTIVE_STATUSES.includes(j.status));
  const done = items.filter((j) => j.status === "done").length;
  const started = active || done > 0; // a queued-only row hasn't started → no spinner/tally
  const icon = active ? '<span class="prog-spin">⟳</span>' : done === items.length ? "✓" : "";
  const tally =
    items.length > 1 && started ? `<span class="prog-count">${done}/${items.length}</span>` : "";
  return [`<span class="prog-val">${txt}</span>`, icon, tally].filter(Boolean).join(" ");
}

function thumbCell(url, mediaType) {
  // image → <img>; video → muted inline <video> (first frame) with a ▶ overlay.
  // Click opens the full media in the in-app viewer (lightbox); the href stays so
  // right-click "copy link" works, but the click handler intercepts it.
  const u = escapeHtml(url);
  if (mediaType === "video") {
    return `<a class="thumb-link" href="${u}" data-media="${u}" data-media-type="video" title="ดู">
      <video class="job-thumb" src="${u}" muted preload="metadata"></video>
      <span class="play-badge">▶</span></a>`;
  }
  return `<a class="thumb-link" href="${u}" data-media="${u}" data-media-type="image" title="ดู">
    <img class="job-thumb" src="${u}" alt="" loading="lazy" /></a>`;
}

// One result = a [image][video] pair (image→video job) or a single media thumb
// (image-only / other sources). Items that ended with no media show a marker.
function resultPair(j) {
  const parts = [];
  if (j.imageUrl) parts.push(thumbCell(j.imageUrl, "image"));
  if (j.mediaUrl) parts.push(thumbCell(j.mediaUrl, j.mediaType));
  if (!parts.length) {
    if (j.status === "failed")
      return `<span class="result-pair empty fail" title="${escapeHtml(j.error || "failed")}">✕</span>`;
    if (j.status === "cancelled") return '<span class="result-pair empty">⊘</span>';
    return '<span class="result-pair empty">ยท</span>';
  }
  const copyUrl = j.mediaUrl || j.imageUrl; // copy the final deliverable (video if any)
  return `<div class="result-pair">${parts.join("")}<button type="button" class="result-copy" data-copy-url="${escapeHtml(copyUrl)}" title="Copy URL">⧉</button></div>`;
}

function resultCellBatch(items) {
  const anyMedia = items.some((j) => j.mediaUrl || j.imageUrl);
  const anyTerminalEmpty = items.some(
    (j) => !j.mediaUrl && !j.imageUrl && ["failed", "cancelled"].includes(j.status)
  );
  if (!anyMedia && !anyTerminalEmpty) return '<span class="cell-empty">–</span>';
  return `<div class="result-batch">${items.map(resultPair).join("")}</div>`;
}

// Collapse sibling jobs (same batch_id) into one row; a job with no batch_id is its
// own row. Items within a batch are ordered by slot so the [img→vid] pairs read
// left→right in submission order.
function groupBatches(jobs) {
  const map = new Map();
  jobs.forEach((j) => {
    const key = j.batchId ? `b:${j.batchId}` : `j:${j.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(j);
  });
  return [...map.entries()].map(([key, items]) => ({
    key,
    items: items.slice().sort((a, b) => (a.batchIndex || 0) - (b.batchIndex || 0)),
  }));
}

// The GENERATION outcome for a whole batch row (the "สร้าง" column), independent of
// the TikTok-post step: running beats done beats partial beats queued beats cancelled
// beats failed. A `publishing` job has ALREADY finished generating (we're now posting),
// so it counts as done here — generation passes the moment the clip exists.
function genStatus(items) {
  const has = (s) => items.some((j) => j.status === s);
  // A PARKED row (Flow parallel Run: generated, now waiting its turn to post) keeps
  // status "generating" but publishStatus "queued" — it has FINISHED generating, so it
  // counts as done here, NOT as still-generating.
  const parked = (j) => j.publishStatus === "queued";
  const genDone = (j) => j.status === "done" || j.status === "publishing" || parked(j);
  if (items.some((j) => j.status === "generating" && !parked(j))) return "generating";
  if (has("queued")) return items.some(genDone) ? "generating" : "queued";
  if (items.every(genDone)) return "done";
  if (items.some(genDone)) return "done"; // partial success — rest failed/cancelled
  if (has("cancelled")) return "cancelled";
  return "failed";
}

// The TikTok-POST outcome for a whole batch row (the "โพสต์ TikTok" column), read from
// each job's `publishStatus`. Most-informative state wins: an in-flight post beats a
// failure beats a needs-manual-press (staged) beats posted beats not-applicable. A
// Count>1 batch never publishes, so every sibling stays "none" → the column shows "–".
// drafted/scheduled are deliberate success terminals (SAVE_DRAFT/SCHEDULE), ranked below
// the error states but above "none" — like "posted".
const POST_STATE_PRIORITY = [
  "publishing", "failed", "staged", "posted", "scheduled", "drafted", "queued", "none",
];
function postStatus(items) {
  const states = items.map((j) => j.publishStatus || "none");
  return POST_STATE_PRIORITY.find((s) => states.includes(s)) || "none";
}

// สร้าง badge — Thai label + reuse of the existing .badge.<state> status palette.
const GEN_BADGE = {
  queued: { cls: "queued", txt: "รอคิว" },
  generating: { cls: "generating", txt: "⟳ กำลังสร้าง" },
  done: { cls: "done", txt: "✓ เสร็จ" },
  failed: { cls: "failed", txt: "✕ ล้มเหลว" },
  cancelled: { cls: "cancelled", txt: "⊘ ยกเลิก" },
};
// โพสต์ TikTok badge — its own .badge.post-* palette. "staged" (uploaded but the
// auto-post didn't land) is treated as an ERROR: the operator wants a non-auto-post
// flagged red and retryable, not a soft amber "uploaded" that reads like success.
const POST_BADGE = {
  none: { cls: "post-none", txt: "–" },
  queued: { cls: "post-queued", txt: "🕒 รอคิว" },
  publishing: { cls: "post-publishing", txt: "⟳ กำลังโพสต์" },
  posted: { cls: "post-posted", txt: "✓ โพสต์แล้ว" },
  drafted: { cls: "post-drafted", txt: "📝 ฉบับร่าง" },
  scheduled: { cls: "post-scheduled", txt: "🕒 ตั้งเวลาแล้ว" },
  staged: { cls: "post-failed", txt: "✕ ไม่ได้โพสต์" },
  failed: { cls: "post-failed", txt: "✕ ล้มเหลว" },
};
// Post outcomes a DONE row can re-post by hand WITHOUT regenerating: "failed" (upload
// errored) and "staged" (uploaded but the auto-post didn't land). Drives both the per-row
// "↻ โพสต์ใหม่" and the toolbar "โพสต์ใหม่ทั้งหมด".
const RETRYABLE_POST = ["failed", "staged"];

// Once a row has settled it owns a folder on disk (its clip + log.txt + job.json);
// the gen badge then doubles as a button that opens that folder in the OS file
// manager. Queued/generating rows have nothing saved yet → a plain badge.
const TERMINAL_GEN_STATES = ["done", "failed", "cancelled"];
// Small folder glyph appended to a clickable badge as the "opens a folder" affordance.
const FOLDER_ICON =
  '<svg class="badge-folder-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6A1.5 1.5 0 0 1 5 4.5h4l2 2h8A1.5 1.5 0 0 1 20.5 8v9.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>';

// The job whose saved folder we open for a (possibly collapsed batch) row: prefer a
// DONE clip — its media lives in the folder — else any other sibling whose folder
// already exists (publishing = generated, mid-post; failed/cancelled keep the log).
function firstArchivedId(items) {
  const done = items.find((j) => j.status === "done");
  if (done) return String(done.id);
  // publishing/failed/cancelled keep their folder; a parked row (publishStatus "queued")
  // has already saved its clip to its folder too, so its "✓ เสร็จ" badge opens it.
  const other = items.find(
    (j) => ["publishing", "failed", "cancelled"].includes(j.status) || j.publishStatus === "queued",
  );
  return other ? String(other.id) : null;
}

function genBadge(items) {
  const state = genStatus(items);
  const b = GEN_BADGE[state] || GEN_BADGE.queued;
  const folderId = TERMINAL_GEN_STATES.includes(state) ? firstArchivedId(items) : null;
  if (folderId) {
    return `<span class="badge ${b.cls} badge-folder" role="button" tabindex="0" data-open-folder="${escapeHtml(folderId)}" title="เปิดโฟลเดอร์ที่เซฟไฟล์ของแถวนี้">${b.txt}${FOLDER_ICON}</span>`;
  }
  return `<span class="badge ${b.cls}">${b.txt}</span>`;
}

function postBadge(items) {
  // "สร้างอย่างเดียว ไม่โพสต์" rows never post — say so explicitly instead of a bare "–"
  // (which also means "nothing happened yet"). A batch/single row is homogeneous here.
  if (items.length && items.every((j) => j.publishMode === "generate_only")) {
    return `<span class="badge post-skip" title="โหมดสร้างอย่างเดียว — ไม่โพสต์ TikTok">ไม่โพสต์</span>`;
  }
  const state = postStatus(items);
  const b = POST_BADGE[state] || POST_BADGE.none;
  // Scheduled rows show the target post time on hover; everything else surfaces the
  // publish error (if any) so the reason is one hover away.
  const when = state === "scheduled" ? items.map((j) => j.publishAt).find(Boolean) : "";
  const hover = when ? `ตั้งเวลาโพสต์: ${when.replace("T", " ")}` : items.map((j) => j.publishError).find(Boolean);
  const title = hover ? ` title="${escapeHtml(hover)}"` : "";
  return `<span class="badge ${b.cls}"${title}>${b.txt}</span>`;
}

// The single Prompt cell — a compact "ดู Prompt" chip instead of the (truncated,
// barely-readable) prompt text. Clicking it opens the popup with BOTH full prompts of
// the row — Prompt Image + Prompt Video — so one collapsed column replaces the old
// two. Em-dash only when the row has no prompt at all. Kept as a role="button" span
// (not a native <button>) so the existing click + keydown handlers drive it without
// double-firing the popup on Enter/Space.
function promptCell(first) {
  // flow-extend: a "🎬 N คลิป" chip so the row shows how many clips it will chain.
  const clips = first && first.clips;
  const chip = clips
    ? `<span class="clip-count-chip" title="แถวนี้จะสร้าง ${clips} คลิปต่อกัน">🎬 ${clips} คลิป</span>`
    : "";
  const has = !!(first && (first.prompt || first.promptVideo));
  if (!has)
    return `<td class="col-prompt">${chip || '<span class="cell-empty">—</span>'}</td>`;
  return (
    `<td class="col-prompt">${chip}<span class="prompt-view-btn" data-prompt-pop` +
    ' role="button" tabindex="0" title="คลิกเพื่อดู Prompt เต็ม (Image + Video)">' +
    "👁 ดู Prompt</span></td>"
  );
}

// A row's direction is only editable before it commits to a run; once any sibling has
// generated, the picks are frozen (the prompt is already built). Mirrors the hub's
// editable set in _set_job_direction.
const DIR_EDITABLE_STATUSES = ["queued", "cancelled", "failed"];

// One editable creative-direction dropdown for a grid row. Pre-filled with the job's
// current pick; a leading blank "—" clears the field. `editable` is false once the job
// has committed to a run (only QUEUED/CANCELLED/FAILED can still be changed) — then it
// renders disabled, doubling as the read-only display of what that job used.
function directionSelect(key, current, editable) {
  const cur = current || "";
  // A `custom:<text>` value shows the "กำหนดเอง" option selected + the typed text in the
  // revealed input; otherwise the matching preset id is selected.
  const isCustom = window.isCustomValue(cur);
  const customText = isCustom ? window.customValueText(cur) : "";
  const canCustom = CUSTOM_DIR_FIELDS.has(key);
  // The blank option ("") already means "AI เลือกให้", so drop videoStyle's redundant
  // "default" entry (same label) — otherwise it'd appear twice.
  const list = ((window.STYLE_OPTIONS || {})[key] || []).filter(([v]) => v !== "default");
  const opts = [DIR_BLANK, ...list, ...(canCustom ? [DIR_CUSTOM_OPT] : [])]
    .map(([v, t]) => {
      const selected = isCustom ? v === DIR_CUSTOM_OPT[0] : v === cur;
      return `<option value="${escapeHtml(v)}"${selected ? " selected" : ""}>${escapeHtml(t)}</option>`;
    })
    .join("");
  const select = `<select class="dir-sel" data-dir-key="${key}"${editable ? "" : " disabled"}>${opts}</select>`;
  if (!canCustom) return select;
  // Inline free-text input, shown only when "กำหนดเอง" is the active pick. Its `change`
  // (blur/Enter) commits the typed text as `custom:<text>` (see the dir handler below).
  const max = window.MAX_CUSTOM_DIRECTION_LEN || 300;
  const input =
    `<input type="text" class="dir-custom" data-dir-key="${key}" maxlength="${max}" ` +
    `placeholder="พิมพ์เอง…" value="${escapeHtml(customText)}"` +
    `${isCustom ? "" : " hidden"}${editable ? "" : " disabled"} />`;
  return `<div class="dir-cell">${select}${input}</div>`;
}

// The six per-row "รายละเอียดคลิป" cells (one <td> each), in DIRECTION_FIELDS order. Each is
// its own editable dropdown column (sora-creator-suite style) — changing one sends a
// job.setDirection for every job id in the row (batch siblings share the pick). The row
// uses the first sibling's current values (they're kept in sync). [[style-options]]
function directionCells(first, editable) {
  const d = (first && first.direction) || {};
  // When a character reference image was uploaded, THAT is the character — the Character
  // dropdown is hidden/disabled for the row (a preset pick would conflict with the upload).
  // The ลักษณะเสียง (voice) column is locked the same way: the voice follows the attached
  // presenter's gender (detected from the image), so it mirrors the Character column instead
  // of letting an operator pick a voice that contradicts the uploaded character.
  const hasCharImg = !!(first && first.hasCharacterImage);
  return DIRECTION_FIELDS.map(([key]) => {
    if (key === "character" && hasCharImg) {
      return `<td class="col-dir col-dir-character"><span class="dir-na" title="ใช้รูปตัวละครที่อัปโหลด">🖼 รูปอัป</span></td>`;
    }
    if (key === "voiceType" && hasCharImg) {
      return `<td class="col-dir col-dir-voiceType"><span class="dir-na" title="ลักษณะเสียงตามรูปตัวละครที่อัปโหลด">🖼 ตามรูป</span></td>`;
    }
    return `<td class="col-dir col-dir-${key}">${directionSelect(key, d[key], editable)}</td>`;
  }).join("");
}

// Reference thumbnails for a (possibly collapsed) batch row: the union of every
// sibling's references (product cover, then character image(s)), deduped + ordered.
// Falls back to the legacy single refImage for older jobs lacking `references`.
function refsForBatch(items) {
  const seen = new Set();
  const out = [];
  items.forEach((j) => {
    const refs = Array.isArray(j.references) && j.references.length
      ? j.references
      : j.refImage
        ? [j.refImage]
        : [];
    refs.forEach((u) => {
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    });
  });
  return out;
}

function batchRow(batch, n) {
  const items = batch.items;
  const first = items[0];
  const gstat = genStatus(items); // generation outcome — drives the row-level retry
  const refs = refsForBatch(items);
  const ref = refs.length
    ? `<div class="ref-stack">${refs.map((u) => thumbCell(u, "image")).join("")}</div>`
    : '<span class="cell-empty">–</span>';
  const ids = items.map((j) => String(j.id)).join(",");
  // "↻ ลองใหม่" — re-run just the FAILED clip(s) in this row. Shown only when the
  // whole row failed; carries only the failed ids so a re-run can never touch a
  // sibling that already succeeded ("retry เฉพาะ task ที่ failed").
  const failedIds = items.filter((j) => j.status === "failed").map((j) => String(j.id));
  const retry =
    gstat === "failed" && failedIds.length
      ? `<button type="button" class="btn-retry" data-retry-ids="${escapeHtml(failedIds.join(","))}" title="ลองสร้างใหม่อีกครั้ง">↻ ลองใหม่</button>`
      : "";
  // "↻ โพสต์ใหม่" — re-run ONLY the TikTok publish step for clip(s) in this row whose
  // POST needs a retry (generation already DONE). Reuses the generated clip — no
  // regeneration, no credits. Shown when the post column is "failed" (upload errored) OR
  // "staged" (uploaded but the auto-post didn't land — the operator retries by hand).
  const pstat = postStatus(items);
  const republishIds = items
    .filter((j) => RETRYABLE_POST.includes(j.publishStatus) && j.status === "done")
    .map((j) => String(j.id));
  const republish =
    RETRYABLE_POST.includes(pstat) && republishIds.length
      ? `<button type="button" class="btn-republish" data-republish-ids="${escapeHtml(republishIds.join(","))}" title="อัปขึ้น TikTok แล้วโพสต์อีกครั้ง (ไม่สร้างคลิปใหม่) — เช็กในแอป TikTok ก่อนว่าคลิปยังไม่ขึ้น เพื่อกันโพสต์ซ้ำ">↻ โพสต์ใหม่</button>`
      : "";
  // Direction is editable only while every sibling is still pre-run (queued/cancelled/
  // failed) — once any has generated, its prompt is committed so the picks are frozen.
  const dirEditable = items.every((j) => DIR_EDITABLE_STATUSES.includes(j.status));
  // The # cell doubles as the row selector in "เลือกลบเฉพาะแถว" mode: it shows the
  // number normally and a checkbox while .jobs-card.selecting is set. Running rows
  // can't be selected (the hub protects them anyway).
  const rowBusy = items.some((j) => ACTIVE_STATUSES.includes(j.status));
  return `
    <tr data-batch-key="${escapeHtml(batch.key)}" data-job-ids="${escapeHtml(ids)}">
      <td class="col-n"><span class="row-n">${n}</span><label class="row-pick"><input type="checkbox" data-row-pick aria-label="เลือกแถวที่ ${n}"${rowBusy ? " disabled" : ""} /><span class="row-pick-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" /></svg></span></label></td>
      <td class="col-ref">${ref}</td>
      ${promptCell(first)}
      ${directionCells(first, dirEditable)}
      <td class="col-result">${resultCellBatch(items)}</td>
      <td class="col-prog" data-progress>${progressCellBatch(items)}</td>
      <td class="col-status col-gen">${genBadge(items)}${retry}</td>
      <td class="col-status col-post">${postBadge(items)}${republish}</td>
    </tr>`;
}

// The Recent jobs grid is PER-MODE: each generate mode shows only its own rows (a
// job carries `mode` = the nav key it was submitted from), so e.g. "Flow ยท Clip 8s"
// never mixes with KIE or Grok rows. Non-generate views have no grid → empty list.
function jobsForCurrentMode(jobs) {
  const m = NAV[currentNav];
  if (!m || m.view !== "generate") return [];
  return jobs.filter((j) => (j.mode || "") === currentNav);
}

function renderJobsGrid(jobs) {
  lastJobsForGrid = jobs; // keep the FULL list — the 1s ticker re-derives from it
  // collapse siblings into batch rows, numbered #1..N in creation order. The queue
  // reads top→bottom: #1 stays on top and new rows are appended at the bottom
  // (the wrap scrolls). A limit, when set, keeps the most recent N still ascending.
  const numbered = groupBatches(jobsForCurrentMode(jobs)).map((b, i) => [b, i + 1]);
  // Hide the 6 creative-direction columns (th+td share .col-dir) for modes that have none
  // (Loop): CSS `.jobs-grid[data-hide-dir="1"] .col-dir{display:none}`. [[flow-loop-mode]]
  const hideDir = NAV[currentNav]?.noDirection ? "1" : "0";
  $$("[data-jobs-grid]").forEach((table) => {
    table.dataset.hideDir = hideDir;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;
    const limit = parseInt(table.dataset.limit || "0", 10);
    const rows = limit ? numbered.slice(-limit) : numbered;
    tbody.innerHTML = rows.length
      ? rows.map(([b, n]) => batchRow(b, n)).join("")
      : '<tr class="empty-row"><td colspan="13">ยังไม่มีงานของโหมดนี้</td></tr>';
  });
  // Toolbar "ลองใหม่ทั้งหมด" button: show it (with the failure count) only when the
  // open mode actually has failed rows, so it never clutters a clean queue.
  const retryAll = $("retryFailed");
  if (retryAll) {
    const failed = jobsForCurrentMode(jobs).filter((j) => j.status === "failed").length;
    retryAll.hidden = failed === 0;
    const label = retryAll.querySelector(".btn-label");
    if (label) label.textContent = failed ? `ลองใหม่ทั้งหมด (${failed})` : "ลองใหม่ทั้งหมด";
  }
  // Toolbar "โพสต์ใหม่ทั้งหมด": shown (with the count) only when this mode has rows whose
  // clip is done but the TikTok post failed/staged — a bulk re-post that skips generation.
  const republishAll = $("republishFailed");
  if (republishAll) {
    const needRepost = jobsForCurrentMode(jobs).filter(
      (j) => j.status === "done" && RETRYABLE_POST.includes(j.publishStatus)
    ).length;
    republishAll.hidden = needRepost === 0;
    const label = republishAll.querySelector(".btn-label");
    if (label) {
      label.textContent = needRepost
        ? `โพสต์ใหม่ทั้งหมด (${needRepost})`
        : "โพสต์ใหม่ทั้งหมด";
    }
  }
  // re-apply the row selection (the grid was just rebuilt) when in selection mode
  if (selectMode) applySelectionToGrid();
  updateGenStats(jobs);
}

// A job counts as ไม่สำเร็จ when its generation failed OR its TikTok post failed; as
// สำเร็จ only when it generated AND its post didn't fail — so a post-failed row is
// counted once (as failed), never as both. "staged" (uploaded but the auto-post didn't
// land) counts as a post failure — the operator treats a non-auto-post as not done.
function jobFailed(j) {
  return j.status === "failed" || j.publishStatus === "failed" || j.publishStatus === "staged";
}

// Per-mode tally shown above the Recent Jobs grid: total / สำเร็จ / ไม่สำเร็จ, scoped
// to the open mode so the numbers match the rows below. The ไม่สำเร็จ card becomes
// clickable (opens the causes modal) whenever there are failures.
function updateGenStats(jobs) {
  const items = jobsForCurrentMode(jobs);
  const counts = {
    total: items.length,
    // สำเร็จ = generated AND the post didn't fail (jobFailed also covers a staged post).
    done: items.filter((j) => j.status === "done" && !jobFailed(j)).length,
    failed: items.filter(jobFailed).length,
  };
  $$("[data-genstat]").forEach((el) => {
    el.textContent = counts[el.dataset.genstat] ?? 0;
  });
  const failedCard = $("genStatFailed");
  if (failedCard) {
    const has = counts.failed > 0;
    failedCard.classList.toggle("has-fail", has);
    if (has) {
      failedCard.setAttribute("role", "button");
      failedCard.setAttribute("tabindex", "0");
      failedCard.setAttribute("aria-label", `ไม่สำเร็จ ${counts.failed} งาน — กดดูสาเหตุ`);
    } else {
      failedCard.removeAttribute("role");
      failedCard.removeAttribute("tabindex");
      failedCard.removeAttribute("aria-label");
    }
  }
}

// One entry in the "งานที่ไม่สำเร็จ" modal: the row's grid #N + prompt + the Thai
// cause(s) from error-explain.js (generation leg and/or TikTok-post leg).
function failureCard(batch, n) {
  const blocks = [];
  batch.items.forEach((j) => blocks.push(...failCauseParts(j)));
  const first = batch.items[0] || {};
  const promptTxt = first.prompt || first.promptVideo || "";
  const prompt = escapeHtml(promptTxt) || '<span class="cell-empty">—</span>';
  return `
    <div class="fail-item">
      <div class="fail-item-head">
        <span class="fail-item-n">#${n}</span>
        <span class="fail-item-prompt" title="${escapeHtml(promptTxt)}">${prompt}</span>
      </div>
      <div class="job-fail-body">${blocks.join("")}</div>
    </div>`;
}

// Opened from the ไม่สำเร็จ stat card. Lists every failed row in the OPEN mode by its
// grid #N + prompt + cause, so the operator can see exactly which row failed and why.
function showFailuresModal() {
  // number batches exactly like the Recent Jobs grid (same per-mode order), then keep
  // only the failed ones so each kept row still shows its real #N.
  const numbered = groupBatches(jobsForCurrentMode(lastJobsForGrid)).map((b, i) => [b, i + 1]);
  const failed = numbered.filter(([b]) => b.items.some(jobFailed));
  const body = failed.length
    ? `<div class="fail-list">${failed.map(([b, n]) => failureCard(b, n)).join("")}</div>`
    : '<p class="fail-empty">ไม่มีงานที่ไม่สำเร็จในโหมดนี้</p>';
  infoModal(body, { title: `งานที่ไม่สำเร็จ (${failed.length})`, className: "modal-fail" });
}

// Themed info modal — title + pre-built (already-escaped) HTML body + a single close
// button. Reuses the confirm/choice modal plumbing (closeModal / activeModal).
function infoModal(bodyHtml, opts = {}) {
  const { title = "", okText = "ปิด", className = "" } = opts;
  if (activeModal) closeModal(null); // one at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h3 class="modal-title" id="modalTitle">${escapeHtml(title)}</h3>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          <button type="button" class="btn primary" data-modal="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-modal]");
      if (btn) closeModal(true);
      else if (e.target === overlay) closeModal(null); // backdrop = close
    });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeModal(null); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      overlay.querySelector('[data-modal="ok"]')?.focus();
    });
  });
}

// Wire the ไม่สำเร็จ card (static element) — click / Enter / Space open the causes
// modal, but only while it's in its clickable (.has-fail) state.
(() => {
  const card = $("genStatFailed");
  if (!card) return;
  const open = () => {
    if (card.classList.contains("has-fail")) showFailuresModal();
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
})();

// tick the elapsed-seconds cells for in-flight batches without re-rendering the table
function tickProgress() {
  groupBatches(jobsForCurrentMode(lastJobsForGrid)).forEach((b) => {
    if (!b.items.some((j) => ACTIVE_STATUSES.includes(j.status))) return;
    $$(`[data-batch-key="${CSS.escape(b.key)}"] [data-progress]`).forEach((cell) => {
      cell.innerHTML = progressCellBatch(b.items);
    });
  });
}
setInterval(tickProgress, 1000);

// Per-row รายละเอียดคลิป dropdowns: changing one sets that field on every job in the row
// (batch siblings share the pick). The hub applies it to the job's options and only
// accepts pre-run rows; the grid re-renders from the broadcast with the new value.
document.addEventListener("change", (e) => {
  const sel = e.target.closest(".dir-sel");
  const inp = !sel ? e.target.closest(".dir-custom") : null;
  const node = sel || inp;
  if (!node) return;
  const tr = node.closest("tr[data-job-ids]");
  const ids = (tr?.dataset.jobIds || "").split(",").filter(Boolean);
  if (!ids.length) return;
  const key = node.dataset.dirKey;
  if (sel) {
    const customInp = sel.closest(".dir-cell")?.querySelector(".dir-custom");
    if (sel.value === DIR_CUSTOM_OPT[0]) {
      // "กำหนดเอง" picked → reveal the input and let the operator type. Commit only when
      // there's text (the input's own change fires it); don't send an empty custom value.
      if (customInp) {
        customInp.hidden = false;
        customInp.focus();
        customInp.select();
      }
      const text = (customInp?.value || "").trim();
      if (text) {
        send({ type: "job.setDirection", data: { ids, key, value: window.CUSTOM_PREFIX + text } });
      }
      return;
    }
    if (customInp) customInp.hidden = true;
    send({ type: "job.setDirection", data: { ids, key, value: sel.value } });
    return;
  }
  // Custom free-text input committed (blur / Enter): send `custom:<text>`, or clear ("")
  // when the operator emptied it.
  const text = inp.value.trim();
  send({
    type: "job.setDirection",
    data: { ids, key, value: text ? window.CUSTOM_PREFIX + text : "" },
  });
});

// Enter in a custom direction input commits it (blur fires the change handler above).
document.addEventListener("keydown", (e) => {
  const inp = e.target.closest(".dir-custom");
  if (inp && e.key === "Enter") {
    e.preventDefault();
    inp.blur();
  }
});

// ---- column-header bulk direction (ปุ่ม ▾ บนหัวคอลัมน์ รายละเอียดคลิป) ----
// The ▾ button on each direction column opens a popup with two modes:
//   • "ใช้ค่าเดียวทุกแถว" — pick one option, applied to every editable row of the
//     open mode (same as setting each row's dropdown by hand, in one go).
//   • "สุ่มจากที่เลือก" — tick the options to spread; each row gets a random pick
//     from the ticked set (bag-based, so the picks spread evenly before repeating).
// Only pre-run rows (DIR_EDITABLE_STATUSES) are touched, and character-image rows
// skip the Character AND ลักษณะเสียง columns — both are locked to the uploaded character,
// mirroring directionCells. Applies as a job.setDirection
// bulk message ({key, items: [{ids, value}, …]}, chunked at DIR_BULK_CHUNK) so the
// hub lands the whole column in one save + broadcast per chunk instead of per row.

// Editable target rows for a column in the open mode — one ids-array per grid row
// (batch siblings share the pick, like the per-row dropdowns).
function dirColumnRows(key) {
  return groupBatches(jobsForCurrentMode(lastJobsForGrid))
    .filter((b) => b.items.every((j) => DIR_EDITABLE_STATUSES.includes(j.status)))
    .filter(
      (b) =>
        !((key === "character" || key === "voiceType") &&
          b.items[0] && b.items[0].hasCharacterImage)
    )
    .map((b) => b.items.map((j) => String(j.id)));
}

// n random picks from pool, bag-based: each shuffled "bag" uses every option once
// before refilling, so 10 rows over 5 ticked options get each option ~2ร— (a true
// กระจายสุ่ม, not independent rolls that can repeat one value many times).
function randomSpread(pool, n) {
  const out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) {
      bag = [...pool];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    out.push(bag.pop());
  }
  return out;
}

function dirColumnDialogHtml(label, list, rowCount, canCustom) {
  const sameOpts = [DIR_BLANK, ...list, ...(canCustom ? [DIR_CUSTOM_OPT] : [])]
    .map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`)
    .join("");
  const chips = list
    .map(
      ([v, t]) =>
        `<button type="button" class="dir-chip" data-dir-pick value="${escapeHtml(v)}" aria-pressed="false">${escapeHtml(t)}</button>`
    )
    .join("");
  return `<div class="modal dir-col-modal" role="dialog" aria-modal="true" aria-labelledby="dirColTitle">
    <h3 class="modal-title" id="dirColTitle">ตั้งค่า <span class="dir-col-name">${escapeHtml(label)}</span> ทั้งคอลัมน์</h3>
    <p class="modal-hint">ปรับ <b>${rowCount}</b> แถวที่ยังแก้ไขได้ — แถวที่สร้างแล้ว/กำลังสร้างจะไม่ถูกเปลี่ยน</p>
    <div class="segmented dir-col-seg" role="group" aria-label="รูปแบบการตั้งค่า">
      <button type="button" class="seg active" data-dir-mode="same" aria-pressed="true">
        <span class="seg-t">ค่าเดียวทุกแถว</span>
        <span class="seg-d">เลือก 1 แบบ ใช้กับทุกแถว</span>
      </button>
      <button type="button" class="seg" data-dir-mode="random" aria-pressed="false">
        <span class="seg-t">สุ่มกระจาย</span>
        <span class="seg-d">ติ๊กหลายแบบ แล้วสุ่มให้</span>
      </button>
    </div>
    <div class="dir-col-body" data-dir-same>
      <label class="dir-col-flabel" for="dirColValue">ใช้แบบนี้กับทุกแถว</label>
      <div class="dir-select-wrap">
        <select id="dirColValue" class="dir-col-select" data-dir-value>${sameOpts}</select>
      </div>
      ${
        canCustom
          ? `<input type="text" class="dir-col-custom" data-dir-custom-input maxlength="${
              window.MAX_CUSTOM_DIRECTION_LEN || 300
            }" placeholder="พิมพ์ข้อความกำหนดเอง…" hidden />`
          : ""
      }
    </div>
    <div class="dir-col-body" data-dir-random hidden>
      <div class="dir-chip-tools">
        <div class="dir-chip-toolbtns">
          <button type="button" class="dir-tool-btn" data-dir-check-all>เลือกทั้งหมด</button>
          <button type="button" class="dir-tool-btn" data-dir-check-none>ล้าง</button>
        </div>
        <span class="dir-chip-count" data-dir-count><b>0</b> แบบ</span>
      </div>
      <div class="dir-chip-grid">${chips}</div>
      <p class="dir-chip-note">สุ่มแบบทั่วถึง — ใช้ครบทุกแบบที่เลือกก่อนวนซ้ำ</p>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-dir-cancel>ยกเลิก</button>
      <button type="button" class="btn primary" data-dir-apply>นำไปใช้</button>
    </div>
  </div>`;
}

// Resolves to {mode:"same", value} | {mode:"random", pool} | null (cancelled).
function dirColumnDialog(label, list, rowCount, canCustom) {
  if (activeModal) closeModal(null); // one modal at a time
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = dirColumnDialogHtml(label, list, rowCount, canCustom);
    let mode = "same";
    const syncMode = () => {
      overlay.querySelectorAll("[data-dir-mode]").forEach((b) => {
        const on = b.dataset.dirMode === mode;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      overlay.querySelector("[data-dir-same]").hidden = mode !== "same";
      overlay.querySelector("[data-dir-random]").hidden = mode !== "random";
    };
    // chips are toggle buttons (data-dir-pick); selected = aria-pressed="true"
    const chipOn = (c) => c.getAttribute("aria-pressed") === "true";
    const setChip = (c, on) => {
      c.setAttribute("aria-pressed", String(on));
      c.classList.toggle("on", on);
    };
    const ticked = () =>
      [...overlay.querySelectorAll("[data-dir-pick]")].filter(chipOn).map((c) => c.value);
    const syncCount = () => {
      const el = overlay.querySelector("[data-dir-count] b");
      if (el) el.textContent = String(ticked().length);
    };
    overlay.addEventListener("click", (e) => {
      const seg = e.target.closest("[data-dir-mode]");
      if (seg) {
        mode = seg.dataset.dirMode;
        syncMode();
        return;
      }
      const chip = e.target.closest("[data-dir-pick]");
      if (chip) {
        setChip(chip, !chipOn(chip));
        syncCount();
        return;
      }
      if (e.target.closest("[data-dir-check-all]")) {
        overlay.querySelectorAll("[data-dir-pick]").forEach((c) => setChip(c, true));
        syncCount();
        return;
      }
      if (e.target.closest("[data-dir-check-none]")) {
        overlay.querySelectorAll("[data-dir-pick]").forEach((c) => setChip(c, false));
        syncCount();
        return;
      }
      if (e.target.closest("[data-dir-apply]")) {
        if (mode === "same") {
          let value = overlay.querySelector("[data-dir-value]")?.value || "";
          if (value === DIR_CUSTOM_OPT[0]) {
            const text = (overlay.querySelector("[data-dir-custom-input]")?.value || "").trim();
            if (!text) {
              addLog("พิมพ์ข้อความกำหนดเองก่อน แล้วค่อยกดนำไปใช้", "warn");
              return;
            }
            value = window.CUSTOM_PREFIX + text;
          }
          return closeModal({ mode, value });
        }
        const pool = ticked();
        if (!pool.length) {
          addLog("ติ๊กเลือกอย่างน้อย 1 แบบก่อนสุ่ม", "warn");
          return;
        }
        return closeModal({ mode, pool });
      }
      if (e.target.closest("[data-dir-cancel]")) return closeModal(null);
      if (e.target === overlay) closeModal(null); // backdrop = cancel
    });
    // Reveal the free-text input when "กำหนดเอง" is chosen in the same-value select.
    overlay.addEventListener("change", (e) => {
      if (!e.target.matches("[data-dir-value]")) return;
      const ci = overlay.querySelector("[data-dir-custom-input]");
      if (!ci) return;
      const on = e.target.value === DIR_CUSTOM_OPT[0];
      ci.hidden = !on;
      if (on) ci.focus();
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    activeModal = { overlay, resolve, onKey, prev: document.activeElement };
    requestAnimationFrame(() => {
      overlay.classList.add("open");
      // focus the select, NOT the apply button — the select defaults to the blank
      // "AI เลือกให้" (= clear), so an accidental Enter right after opening must not
      // wipe the whole column's hand-set picks
      overlay.querySelector("[data-dir-value]")?.focus();
    });
  });
}

// Mirrors hub._MAX_DIRECTION_ITEMS — bigger column applies are chunked into multiple
// messages so the hub's anti-flood cap never silently drops the tail rows.
const DIR_BULK_CHUNK = 500;

function dirNoRowsMsg(key) {
  // The Character column has a second exclusion (an uploaded character image
  // replaces the dropdown), so the row-status explanation alone would mislead.
  return key === "character"
    ? "ไม่มีแถวที่ตั้งค่าได้ — แถวที่อัปโหลดรูปตัวละครจะใช้รูปนั้นแทนคอลัมน์ Character และแก้ไขได้เฉพาะแถวที่ยังไม่ได้สร้าง (รอคิว/ยกเลิก/ล้มเหลว)"
    : "ไม่มีแถวที่ตั้งค่าได้ในโหมดนี้ — แก้ไขได้เฉพาะแถวที่ยังไม่ได้สร้าง (รอคิว/ยกเลิก/ล้มเหลว)";
}

async function openDirColumn(key, label) {
  if (!dirColumnRows(key).length) {
    addLog(dirNoRowsMsg(key), "warn");
    return;
  }
  // same option list as the per-row dropdowns (videoStyle's "default" duplicates the
  // blank "AI เลือกให้", so it's dropped here too)
  const list = ((window.STYLE_OPTIONS || {})[key] || []).filter(([v]) => v !== "default");
  const canCustom = CUSTOM_DIR_FIELDS.has(key);
  const res = await dirColumnDialog(label, list, dirColumnRows(key).length, canCustom);
  if (!res) return;
  // applying the blank value resets the whole column ("AI เลือกให้") and wipes any
  // hand-set per-row picks — destructive enough to confirm first
  if (res.mode === "same" && !res.value) {
    const ok = await confirmDialog(`ล้างค่า ${label} ของทุกแถวกลับเป็น "AI เลือกให้"?`, {
      title: "ล้างทั้งคอลัมน์",
      okText: "ล้างค่า",
    });
    if (!ok) return;
  }
  // re-derive AFTER the dialogs: rows can start running / get added while they were
  // open, so the apply (and the logged count) tracks the live grid, not a snapshot.
  const rows = dirColumnRows(key);
  if (!rows.length) {
    addLog(dirNoRowsMsg(key), "warn");
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    // send() silently drops when the socket is down — warn instead of a false success
    addLog("ยังไม่ได้เชื่อมต่อกับแอป — รอสถานะ Connected แล้วลองใหม่", "warn");
    return;
  }
  const values =
    res.mode === "same"
      ? rows.map(() => res.value)
      : randomSpread(res.pool, rows.length);
  const items = rows.map((ids, i) => ({ ids, value: values[i] }));
  for (let i = 0; i < items.length; i += DIR_BULK_CHUNK) {
    send({
      type: "job.setDirection",
      data: { key, items: items.slice(i, i + DIR_BULK_CHUNK) },
    });
  }
  addLog(
    res.mode === "same"
      ? `ตั้ง ${label} = "${res.value ? window.styleLabel(key, res.value) : "AI เลือกให้"}" ให้ ${rows.length} แถวแล้ว`
      : `สุ่ม ${label} จาก ${res.pool.length} ตัวเลือก กระจายให้ ${rows.length} แถวแล้ว`
  );
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".dir-col-btn");
  if (!btn) return;
  openDirColumn(btn.dataset.dirCol, btn.dataset.dirLabel || btn.dataset.dirCol);
});

// Click (or Enter/Space) on a Prompt Image / Prompt Video cell → popup showing BOTH
// full prompts of that row. Suppressed while the card is in row-selection mode so
// clicks there stay about picking rows.
function openPromptPopup(cell) {
  const tr = cell.closest("tr[data-job-ids]");
  if (!tr) return;
  const ids = (tr.dataset.jobIds || "").split(",").filter(Boolean);
  const job = (lastJobsForGrid || []).find((j) => String(j.id) === ids[0]);
  if (!job) return;
  const sec = (label, text) => `
    <section class="prompt-pop-sec">
      <h4 class="prompt-pop-label">${label}</h4>
      <div class="prompt-pop-text">${escapeHtml(text) || '<span class="cell-empty">—</span>'}</div>
    </section>`;
  const n = tr.querySelector(".row-n")?.textContent;
  // a collapsed batch row shows clip #1's prompts (same as the cells) — say so
  const clip = ids.length > 1 ? ` ยท คลิปที่ 1/${ids.length}` : "";
  infoModal(sec("Prompt Image", job.prompt) + sec("Prompt Video", job.promptVideo), {
    title: n ? `Prompt — แถว #${n}${clip}` : "Prompt",
    className: "modal-prompt",
  });
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-prompt-pop]");
  if (cell && !cell.closest(".jobs-card.selecting")) openPromptPopup(cell);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  // never double-act on one keypress: an open dialog owns the keys (activeModal), and a
  // dialog the capture-phase handler JUST closed marks the event consumed (preventDefault
  // without stopPropagation in confirmDialog's onKey — closeModal nulls activeModal
  // synchronously, so the flag is the only trace left by bubble time)
  if (activeModal || e.defaultPrevented) return;
  const cell = e.target.closest("[data-prompt-pop]");
  if (!cell || cell.closest(".jobs-card.selecting")) return;
  e.preventDefault();
  openPromptPopup(cell);
});

function updateStats(jobs) {
  const count = (pred) => jobs.filter(pred).length;
  if (els.statQueued) els.statQueued.textContent = count((j) => j.status === "queued");
  if (els.statRunning)
    els.statRunning.textContent = count((j) => ["generating", "publishing"].includes(j.status));
  if (els.statDone) els.statDone.textContent = count((j) => j.status === "done");
  if (els.statFailed) els.statFailed.textContent = count((j) => j.status === "failed");
  if (els.statCancelled) els.statCancelled.textContent = count((j) => j.status === "cancelled");
}

// ---- log + unread badge (writes to every [data-log] mirror) ----
function addLog(message, level = "info") {
  // A "divider" is a server-emitted separator drawn after a job settles — render
  // it as a rule (no timestamp/text) so finished-job blocks read apart at a glance,
  // and don't count it as unread activity.
  if (level === "divider") {
    const sep = '<div class="log-divider" role="separator" aria-hidden="true"></div>';
    $$("[data-log]").forEach((el) => {
      el.insertAdjacentHTML("beforeend", sep);
      el.scrollTop = el.scrollHeight;
    });
    return;
  }
  const ts = new Date().toLocaleTimeString();
  const cls = level === "warn" ? "warn" : level === "error" ? "error" : "";
  const html = `<div class="log-line ${cls}"><span class="ts">${ts}</span>${escapeHtml(message)}</div>`;
  $$("[data-log]").forEach((el) => {
    el.insertAdjacentHTML("beforeend", html);
    el.scrollTop = el.scrollHeight;
  });
  // the log lives in a separate window now, so just flag activity — the dot clears
  // when the user clicks the sidebar "Log" button (openLogWindow → clearUnread).
  unread += 1;
  if (els.logDot) els.logDot.hidden = false;
}

function clearUnread() {
  unread = 0;
  if (els.logDot) els.logDot.hidden = true;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Robust clipboard copy for the pywebview/Edge WebView2 native window. The async
// Clipboard API (navigator.clipboard.writeText) frequently REJECTS inside the
// embedded WebView — its clipboard-write permission isn't auto-granted by the
// host like it is in a normal Chrome tab — so we fall back to a synchronous
// execCommand("copy") on a throwaway <textarea>, which works inside the click
// user-gesture without going through the permissions model. Returns true on copy.
async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // permission denied / not allowed in WebView2 → use the legacy path below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// ---- in-app media viewer (lightbox) - open results without leaving the app ----
function openLightbox(url, type) {
  const lb = $("lightbox");
  const body = $("lightboxBody");
  if (!lb || !body || !url) return;
  const u = escapeHtml(url);
  body.innerHTML =
    type === "video"
      ? `<video src="${u}" controls autoplay playsinline></video>`
      : `<img src="${u}" alt="" />`;
  lb.hidden = false;
}

function closeLightbox() {
  const lb = $("lightbox");
  const body = $("lightboxBody");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  if (body) body.innerHTML = "";
}

$("lightboxClose")?.addEventListener("click", closeLightbox);
$("lightbox")?.addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest?.("[data-rename-input]")) closeLightbox();
  if (e.key === "Enter" || e.key === " ") {
    const folderBtn = e.target.closest?.("[data-open-folder]");
    if (folderBtn) {
      e.preventDefault();
      folderBtn.click();
    }
  }
});

// ---- Log window - the sidebar Log button opens it as a separate window ----
function openLogInBrowser() {
  window.open(`${location.origin}/log`, "tbLog", "width=540,height=560,menubar=no,toolbar=no");
}

function openLogWindow() {
  clearUnread();
  const api = window.pywebview?.api;
  if (api?.open_log_window) {
    Promise.resolve(api.open_log_window()).catch(() => openLogInBrowser());
    return;
  }
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ __tb_open_log: true, url: `${location.origin}/log` }, "*");
      return;
    } catch (_) {
      /* browser fallback below */
    }
  }
  openLogInBrowser();
}

$("logToggle")?.addEventListener("click", openLogWindow);

document.addEventListener("click", (e) => {
  const media = e.target.closest("[data-media]");
  if (media) {
    e.preventDefault();
    openLightbox(media.dataset.media, media.dataset.mediaType);
    return;
  }

  const copyUrl = e.target.closest("[data-copy-url]");
  if (copyUrl) {
    const url = copyUrl.dataset.copyUrl;
    copyToClipboard(url).then((ok) => {
      if (ok) {
        copyUrl.classList.add("copied");
        setTimeout(() => copyUrl.classList.remove("copied"), 1200);
      } else {
        addLog("Could not copy URL to clipboard.", "warn");
      }
    });
  }
});

// ---- chrome / extension actions ----
// The header "Open Extensions ▸" button sends users straight to the published Chrome
// Web Store listing (the operator ships the extension via the store). EXT_WEBSTORE_URL /
// openExternalUrl are defined later in this file but are only read at click time, so the
// forward reference is fine.
function openWebStorePage() {
  if (!EXT_WEBSTORE_READY) {
    addLog("ลิงก์ Chrome Web Store ยังไม่พร้อม", "warn");
    return;
  }
  openInChrome(EXT_WEBSTORE_URL);
  addLog("กำลังเปิดหน้า Chrome Web Store ของส่วนขยาย…", "info");
}
els.openExtensions.addEventListener("click", openWebStorePage);

// ---- program-side "เชื่อมต่อ Extension" -------------------------------------
// The app is the WebSocket SERVER; the extension's service worker dials IN to
// ws://127.0.0.1/ws/extension. We can't push a socket into Chrome — so "connect" means OPEN
// the exact Chrome PROFILE that holds the unpacked extension and let its SW reconnect.
// /api/connect-extension finds that profile (by reading each profile's prefs + the on-disk
// manifest name) and launches `chrome.exe --profile-directory=<it>` — NOT a profile-less
// launch (which hits Chrome's "Who's using Chrome?" picker = wrong/cold Chrome). Once its
// Chrome is up the SW dials in (onStartup + the 30s tb-keepalive alarm) and the pill flips
// green via ui.state → setExtConnected. Mirrors the extension popup's Reconnect button.
const CONNECT_HINT_IDLE =
  "กดเพื่อเปิด Chrome โปรไฟล์ที่ติดตั้งส่วนขยายไว้ แล้วเชื่อมต่อให้อัตโนมัติ";

function endConnectAttempt(warn) {
  extConnecting = false;
  if (extConnected) return; // setExtConnected already wrote the connected label/hint
  if (els.connectExtBtn) {
    els.connectExtBtn.disabled = false;
    els.connectExtBtn.textContent = "⚡ เชื่อมต่อ Extension";
  }
  if (els.connectExtHint) {
    els.connectExtHint.hidden = false;
    els.connectExtHint.textContent = CONNECT_HINT_IDLE;
  }
  if (warn) addLog(warn, "warn");
}

els.connectExtBtn?.addEventListener("click", async () => {
  if (extConnected) {
    addLog("ส่วนขยายเชื่อมต่ออยู่แล้ว", "info");
    return;
  }
  if (extConnecting) return;
  extConnecting = true;
  els.connectExtBtn.disabled = true;
  els.connectExtBtn.textContent = "กำลังเปิด Chrome…";
  if (els.connectExtHint) {
    els.connectExtHint.hidden = false;
    els.connectExtHint.textContent = "กำลังค้นหาโปรไฟล์ Chrome ที่ติดตั้งส่วนขยายไว้…";
  }
  let data;
  try {
    data = await (await fetch("/api/connect-extension", { method: "POST" })).json();
  } catch (e) {
    data = { ok: false, reason: String(e) };
  }
  if (!data.ok) {
    endConnectAttempt(
      data.reason === "chrome_not_found"
        ? "ไม่พบ Google Chrome — ติดตั้ง Chrome ก่อนแล้วลองใหม่"
        : `เปิด Chrome ไม่สำเร็จ: ${data.reason || "ไม่ทราบสาเหตุ"}`
    );
    return;
  }
  if (data.found) {
    addLog(`เปิด Chrome โปรไฟล์ "${data.profile}" ที่มีส่วนขยาย — รอเชื่อมต่อ…`, "info");
    if (els.connectExtHint) {
      els.connectExtHint.textContent = `เปิดโปรไฟล์ "${data.profile}" แล้ว — รอส่วนขยายเชื่อมต่อ (ไม่เกิน ~30 วินาที)…`;
    }
  } else {
    addLog("ยังไม่พบส่วนขยายในโปรไฟล์ใด — เปิดหน้า chrome://extensions ให้แล้ว กรุณากด Load unpacked", "warn");
    if (els.connectExtHint) {
      els.connectExtHint.textContent = "ยังไม่พบส่วนขยาย — กด Load unpacked ในหน้า chrome://extensions ที่เปิดให้";
    }
  }
  // Profile's Chrome is up → its SW dials in (onStartup + the 30s keepalive). Poll ~35s.
  const deadline = Date.now() + 35000;
  const tick = setInterval(() => {
    if (extConnected) {
      clearInterval(tick);
      endConnectAttempt(null);
    } else if (Date.now() > deadline) {
      clearInterval(tick);
      endConnectAttempt(
        data.found
          ? "ยังไม่เชื่อมต่อ — ลองกดรีโหลด (↻) ส่วนขยายในหน้า chrome://extensions แล้วลองอีกครั้ง"
          : "ยังไม่พบส่วนขยาย — กด Load unpacked ในโปรไฟล์นี้แล้วลองอีกครั้ง"
      );
    }
  }, 1000);
});

// ---- info ----
async function loadInfo() {
  try {
    const info = await (await fetch("/api/info")).json();
    renderDeviceInfo(info.device);
  } catch (_) {
    /* /api/info unreachable — device card stays on its "…" placeholders */
  }
}

// Render the read-only "ข้อมูลเครื่อง" card from /api/info's `device` block. Dates are
// formatted in LOCAL time as DD/MM/YYYY HH:mm (Gregorian — avoids the Buddhist-era
// surprise of toLocaleString("th-TH") on Thai Windows).
function fmtDeviceTime(iso) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

function renderDeviceInfo(d) {
  if (!d) return;
  if (els.deviceFirstRun) els.deviceFirstRun.textContent = fmtDeviceTime(d.firstRunAt);
  if (els.deviceRunCount)
    els.deviceRunCount.textContent = d.runCount != null ? `${d.runCount} ครั้ง` : "—";
  if (els.deviceId) els.deviceId.textContent = d.deviceId || "—";
  if (els.deviceIsFirst)
    els.deviceIsFirst.textContent = d.isFirstRun ? "ใช่ — เปิดครั้งแรกบนเครื่องนี้" : "ไม่ใช่";
  if (els.deviceFirstPill) els.deviceFirstPill.hidden = !d.isFirstRun;
}

// ---- settings: sub-tabs ----
// The three per-provider account tabs were merged into one "เพิ่มบัญชี" wizard —
// map their old hash keys so stale bookmarks land on the merged tab.
const SUBTAB_ALIAS = { "acc-labs": "accounts", "acc-grok": "accounts", "acc-tiktok": "accounts" };

function setSubtab(key) {
  key = SUBTAB_ALIAS[key] || key;
  // A stale/unknown hash sub-route (e.g. an old bookmark) must never blank the
  // panel area — fall back to the leftmost/default subtab so something is shown.
  const known = $$(".subtab").map((t) => t.dataset.subtab);
  if (!known.includes(key)) key = known[0] || "llm";
  $$(".subtab").forEach((t) => {
    const on = t.dataset.subtab === key;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $$(".subpanel").forEach((p) => {
    const on = p.dataset.subpanel === key;
    p.classList.toggle("active", on);
    p.hidden = !on;
  });
  // entering the wizard is a deliberate navigation — open it at the first step
  // that still needs connecting (mid-session broadcasts never reposition it)
  if (key === "accounts") setAccGroup(currentAccGroup);
  if (currentNav === "settings") history.replaceState(null, "", `#settings/${key}`);
}
$$(".subtab").forEach((tab) => tab.addEventListener("click", () => setSubtab(tab.dataset.subtab)));

// ---- Settings ▸ เพิ่มบัญชี: provider-group wizard (Google Flow / SuperGrok) ----
// Each group must connect IN ORDER: the generation login first, then TikTok.
// Step buttons stay locked until every earlier step has a usable account, and
// the run/pull pages stay gated until the WHOLE group is connected (see
// updateConnectGates below + the mirrored server gate in hub.py).
const ACC_STEPS = {
  flow: [
    { provider: "google_labs", label: "labs.google" },
    { provider: "tiktok", label: "TikTok" },
  ],
  grok: [
    { provider: "grok", label: "SuperGrok" },
    { provider: "tiktok", label: "TikTok" },
  ],
};
let currentAccGroup = "flow";

// "เชื่อมแล้ว" = at least one saved login that is toggled ON and still has its
// cookie — the same predicate the hub uses to accept work for the group.
function providerLinked(provider) {
  return lastAccounts.some((a) => a.provider === provider && a.enabled && a.hasCookie);
}

function firstOpenAccStep(group) {
  const steps = ACC_STEPS[group] || [];
  for (let i = 0; i < steps.length; i++) {
    if (!providerLinked(steps[i].provider)) return i + 1;
  }
  return 1; // ครบทุกขั้นแล้ว — เปิดขั้น 1 ไว้จัดการบัญชี
}

function visibleAccStep(group) {
  const active = document.querySelector(
    `[data-acc-group-pane="${group}"] .acc-step.active`
  );
  return active ? Number(active.dataset.accStep.split(":")[1]) || 1 : 1;
}

function setAccStep(group, n) {
  const steps = ACC_STEPS[group] || [];
  // ห้ามข้ามขั้น — จะเปิดขั้น n ได้ก็ต่อเมื่อทุกขั้นก่อนหน้าเชื่อมแล้ว
  for (let i = 0; i < n - 1; i++) {
    if (!providerLinked(steps[i].provider)) {
      n = i + 1;
      break;
    }
  }
  $$("[data-acc-step]").forEach((b) => {
    const [g, bn] = b.dataset.accStep.split(":");
    if (g !== group) return;
    b.classList.toggle("active", Number(bn) === n);
  });
  $$("[data-acc-step-pane]").forEach((p) => {
    const [g, pn] = p.dataset.accStepPane.split(":");
    if (g !== group) return;
    p.classList.toggle("active", Number(pn) === n);
  });
}

function setAccGroup(group) {
  if (!ACC_STEPS[group]) group = "flow";
  currentAccGroup = group;
  $$(".acc-group-tab").forEach((t) => {
    const on = t.dataset.accGroup === group;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $$("[data-acc-group-pane]").forEach((p) =>
    p.classList.toggle("active", p.dataset.accGroupPane === group)
  );
  setAccStep(group, firstOpenAccStep(group)); // เปิดที่ขั้นแรกที่ยังไม่เสร็จ
}

// Previous linked-state per "<group>:<provider>" — auto-advance must fire only on
// the false→true completion TRANSITION. ui.state broadcasts arrive constantly (job
// progress, credit refreshes), so re-enforcing "visible = first incomplete step" on
// every render would yank the user off a step they deliberately opened.
const accLinkedPrev = {};

// Refresh every step chip / group badge from the live account list, and keep the
// open group's visible step legal (advance when a step JUST completed; clamp back
// when an account was deleted out from under a later step).
function updateAccWizard() {
  Object.entries(ACC_STEPS).forEach(([group, steps]) => {
    const doneCount = steps.filter((s) => providerLinked(s.provider)).length;
    const badge = document.querySelector(`[data-acc-group-state="${group}"]`);
    if (badge) {
      const complete = doneCount === steps.length;
      badge.textContent = complete ? "✓ เชื่อมครบ" : `${doneCount}/${steps.length}`;
      badge.classList.toggle("done", complete);
    }
    let justCompleted = false;
    steps.forEach((step, i) => {
      const linked = providerLinked(step.provider);
      const prevKey = `${group}:${step.provider}`;
      if (accLinkedPrev[prevKey] === false && linked) justCompleted = true;
      accLinkedPrev[prevKey] = linked;
      const btn = document.querySelector(`[data-acc-step="${group}:${i + 1}"]`);
      if (!btn) return;
      const blocker = steps.slice(0, i).find((s) => !providerLinked(s.provider));
      btn.classList.toggle("done", linked);
      btn.classList.toggle("locked", !!blocker);
      btn.disabled = !!blocker;
      btn.title = blocker ? `เชื่อมบัญชี ${blocker.label} ให้เสร็จก่อน` : "";
    });
    const target = firstOpenAccStep(group);
    const visible = visibleAccStep(group);
    if (justCompleted && target > visible) setAccStep(group, target);
    else setAccStep(group, visible); // re-apply the no-skip clamp only
  });
}

$$(".acc-group-tab").forEach((t) =>
  t.addEventListener("click", () => setAccGroup(t.dataset.accGroup))
);
$$("[data-acc-step]").forEach((b) =>
  b.addEventListener("click", () => {
    const [g, n] = b.dataset.accStep.split(":");
    setAccStep(g, Number(n) || 1);
  })
);

// ---- connect gates: pages that need a connected account before they unlock ----
// Generate pages need ONLY their generation login now — TikTok was decoupled and is
// required on Product Showcase instead (operator's call). This applies to BOTH Flow
// (labs.google) and SuperGrok (grok). The Settings "เพิ่มบัญชี" wizard still walks both
// logins per group (ACC_STEPS). KIE pages are keyed by API key, not cookie accounts.
// Keyed by NAV cfg.group; mirrors hub.py ACCOUNT_GROUPS — change both together.
const CONNECT_GROUPS = {
  flow: { label: "Google Flow", accGroup: "flow", links: [{ provider: "google_labs", label: "labs.google" }] },
  supergrok: { label: "SuperGrok", accGroup: "grok", links: [{ provider: "grok", label: "SuperGrok" }] },
};

// items: [{ok, label}] — the checklist shown in the gate card. The gate shows
// while any item is unchecked; the section's real content hides under .gated.
function applyConnectGate(section, gate, items, sub) {
  if (!section || !gate) return;
  const show = !!items && items.some((it) => !it.ok);
  section.classList.toggle("gated", show);
  gate.hidden = !show;
  if (!show) return;
  const subEl = gate.querySelector(".cg-sub");
  if (subEl && sub) subEl.textContent = sub;
  const list = gate.querySelector(".cg-list");
  if (list) {
    list.innerHTML = items
      .map(
        (it) => `<li class="cg-item ${it.ok ? "ok" : "miss"}">
          <span class="cg-mark">${it.ok ? "✓" : "✗"}</span>
          <span class="cg-name">${escapeHtml(it.label)}</span>
          <span class="cg-state">${it.ok ? "เชื่อมแล้ว" : "ยังไม่ได้เชื่อม"}</span>
        </li>`
      )
      .join("");
  }
}

function updateConnectGates() {
  if (!accountsKnown) return; // ยังไม่รู้รายชื่อบัญชี — อย่าเพิ่งบล็อกหน้า
  const cfg = NAV[currentNav] || {};
  const grp = cfg.view === "generate" ? CONNECT_GROUPS[cfg.group] : null;
  applyConnectGate(
    document.querySelector('.view[data-view="generate"]'),
    $("connectGateGen"),
    grp
      ? grp.links.map((s) => ({ ok: providerLinked(s.provider), label: s.label }))
      : null,
    grp
      ? `โหมด ${grp.label} ต้องเชื่อมบัญชี ${grp.links.map((s) => s.label).join(" + ")} ก่อน จึงจะกดรันงานได้`
      : ""
  );
  // The gate button reads like "+ Add Account" — name the login it will open.
  const genBtn = $("connectGateGenBtn");
  if (genBtn && grp) genBtn.textContent = `+ เพิ่มบัญชี ${(grp.links.find((s) => !providerLinked(s.provider)) || grp.links[0]).label}`;

  // Product Showcase only needs a connected TikTok account now (decoupled from the
  // generation logins) — its server-side pull gates on TikTok alone too.
  applyConnectGate(
    document.querySelector('.view[data-view="product-set"]'),
    $("connectGateProducts"),
    cfg.view === "product-set" && !providerLinked("tiktok")
      ? [{ ok: providerLinked("tiktok"), label: "TikTok" }]
      : null,
    "ต้องเชื่อมบัญชี TikTok ก่อน จึงจะดึงสินค้าจาก Showcase ได้"
  );
}

// The connect-gate buttons act like "+ Add Account": they open the browser sign-in
// for the missing login right away (same account.browser message the wizard sends).
// The account state that comes back re-runs updateConnectGates → the gate dismisses.
$("connectGateGenBtn")?.addEventListener("click", () => {
  const cfg = NAV[currentNav] || {};
  const grp = CONNECT_GROUPS[cfg.group] || CONNECT_GROUPS.flow;
  const next = grp.links.find((s) => !providerLinked(s.provider)) || grp.links[0];
  send({ type: "account.browser", data: { provider: next.provider } });
});
$("connectGateProductsBtn")?.addEventListener("click", () => {
  send({ type: "account.browser", data: { provider: "tiktok" } });
});

// ---- accounts ----
// KIE is intentionally absent — it authenticates with a single API key
// (see the KIE settings card), not the cookie-based accounts table. TikTok is a
// cookie login (for publishing) and uses the same Browser-Login / capture flow.
const ACCOUNT_PROVIDERS = ["google_labs", "grok", "tiktok"];
const TIER_LABEL = { free: "FREE", pro: "PRO", ultra: "ULTRA" };
const ACC_STATUSES = ["active", "expired", "error", "checking"];

function fmtExp(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Relative "เมื่อสักครู่ / N นาทีก่อน" for the token re-verification stamp. The Flow
// session-expiry DATE doesn't move on Refresh, but the working access token IS re-minted
// on each read — this shows the operator that "กด Refresh แล้ว token ถูกตรวจ/รีใหม่" so a
// Refresh visibly does something even when Token EXP is unchanged.
function fmtChecked(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return "เมื่อสักครู่";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} นาทีก่อน`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ก่อน`;
  return `${Math.floor(hrs / 24)} วันก่อน`;
}

// Providers whose accounts are a PUBLISHING login (not a generation account): no
// per-media toggles, tier, or credit — so their table drops those columns.
const COMPACT_ACCOUNT_PROVIDERS = new Set(["tiktok"]);

// Grok is a generation account (keeps Image/Video AND the Type/plan column — the real
// SuperGrok plan resolved by grok.py), but it exposes no Flow-style credit balance — so
// SuperGrok drops only the Credit column (an 11-col table), unlike Flow's full 12.
const NO_CREDIT_PROVIDERS = new Set(["grok"]);

// Columns a provider's Active Accounts table renders (drives the empty-row colspan):
// full 12, minus 1 (Credit) for grok, minus 4 (Image/Video+Type/Credit) for tiktok.
function accountColspan(provider) {
  if (COMPACT_ACCOUNT_PROVIDERS.has(provider)) return 8;
  if (NO_CREDIT_PROVIDERS.has(provider)) return 11;
  return 12;
}

function accountRow(a, n, provider) {
  const status = ACC_STATUSES.includes(a.status) ? a.status : "checking";
  // Prefer the precise plan label from the provider (e.g. "ULTRA x20"); else the tier.
  const tier = a.plan ? escapeHtml(String(a.plan)) : TIER_LABEL[a.tier] || escapeHtml(String(a.tier));
  const id = escapeHtml(String(a.id));
  const compact = COMPACT_ACCOUNT_PROVIDERS.has(provider);
  // TikTok (publishing login): no Image/Video and no Type. Grok keeps both, but has
  // no Flow-style credit balance, so it hides only the Credit column.
  const hideCredit = compact || NO_CREDIT_PROVIDERS.has(provider);
  const imageVideo = compact
    ? ""
    : `
      <td><input type="checkbox" class="chk" ${a.imageEnabled ? "checked" : ""} data-toggle="image" data-id="${id}" aria-label="Image enabled" /></td>
      <td><input type="checkbox" class="chk" ${a.videoEnabled ? "checked" : ""} data-toggle="video" data-id="${id}" aria-label="Video enabled" /></td>`;
  // Type/plan column: shown for generation accounts (Flow's FREE/PRO/ULTRA, Grok's
  // real SuperGrok plan); dropped only for the TikTok publishing login.
  const typeCell = compact
    ? ""
    : `<td class="acc-tier tier-${escapeHtml(String(a.tier))}">${tier}</td>`;
  const creditCell = hideCredit
    ? ""
    : `<td class="acc-credit"><span class="credit-pill">${(Number(a.credit) || 0).toLocaleString()}</span></td>`;
  return `
    <tr data-acc-id="${id}">
      <td>${n}</td>
      <td>
        <label class="switch">
          <input type="checkbox" ${a.enabled ? "checked" : ""} data-toggle="enabled" data-id="${id}" aria-label="Account on/off" />
          <span class="track"></span>
        </label>
      </td>${imageVideo}
      <td class="acc-email" title="${escapeHtml(String(a.email))}">${escapeHtml(String(a.email))}${
        provider === "tiktok"
          ? ` <button class="a-rename" data-action="rename" data-id="${id}" aria-label="แก้ไขชื่อบัญชี" title="แก้ไขชื่อ">✎</button>`
          : ""
      }</td>${typeCell}${creditCell}
      <td class="proxy-cell">${a.proxy ? escapeHtml(String(a.proxy)) : "–"}</td>
      <td class="acc-exp">${fmtExp(a.cookieExp)}</td>
      <td class="acc-exp">${fmtExp(a.tokenExp)}${
        a.tokenCheckedAt
          ? `<div class="acc-checked" title="ตรวจ/รี token ล่าสุด — token ที่ใช้ generate ถูกรีใหม่แล้วโดยไม่ต้องล็อกอิน">✓ รีแล้ว ${escapeHtml(fmtChecked(a.tokenCheckedAt))}</div>`
          : ""
      }</td>
      <td><span class="acc-badge ${status}">${escapeHtml(String(a.status))}</span></td>
      <td>
        <div class="acc-actions">
          <button class="a-refresh" data-action="refresh" data-id="${id}">Refresh</button>
          <button class="a-proxy" data-action="proxy" data-id="${id}">Proxy</button>
          <button class="a-del" data-action="delete" data-id="${id}" aria-label="Delete account" title="Delete">🗑</button>
        </div>
      </td>
    </tr>`;
}

// Reflect the currently-selected Product Showcase account in the header chip, so
// it's obvious which TikTok account a clip/products will go to.
function updateTtAccountChip() {
  const chip = $("ttAccountChip");
  const sel = $("ttAccount");
  if (!chip) return;
  const name = sel && sel.value ? (sel.selectedOptions[0]?.textContent || "").trim() : "";
  chip.textContent = name || "ยังไม่มีบัญชี TikTok";
}

// Populate the Product Showcase account dropdown from saved (enabled) TikTok accounts.
function populateTikTokAccountSelect() {
  const sel = $("ttAccount");
  if (!sel) return;
  const cur = sel.value;
  const opts = tiktokAccountOptionsHtml();
  sel.innerHTML = opts || `<option value="">— ยังไม่มีบัญชี TikTok —</option>`;
  if (cur) sel.value = cur; // keep selection across re-render
  updateTtAccountChip();
}

function renderAccounts(accounts) {
  lastAccounts = accounts || [];
  accountsKnown = true;
  ACCOUNT_PROVIDERS.forEach((provider) => {
    const rows = lastAccounts.filter((a) => a.provider === provider);
    // TikTok's add/table block exists once per wizard group, so every match
    // gets the same rows (querySelectorAll, not querySelector).
    document
      .querySelectorAll(`[data-account-count="${provider}"]`)
      .forEach((countEl) => (countEl.textContent = rows.length));
    document.querySelectorAll(`[data-accounts="${provider}"]`).forEach((tbody) => {
      // don't blow away an inline proxy/rename edit the user is in the middle of typing
      if (tbody.querySelector("[data-proxy-input],[data-rename-input]")) return;
      const cols = accountColspan(provider);
      tbody.innerHTML = rows.length
        ? rows.map((a, i) => accountRow(a, i + 1, provider)).join("")
        : `<tr class="empty-row"><td colspan="${cols}">No accounts yet — add one above.</td></tr>`;
    });
  });
  populateTikTokAccountSelect();
  populateGenerateTikTokSelect();
  refreshFlowVideoModelSelect(); // a Flow tier may have just resolved → re-sync the dropdown
  refreshGrokTierControls(); // a grok plan may have just resolved → re-cap Free vs paid
  updateAccWizard();
  updateConnectGates();
  applyTikTokConnectedUI(); // TikTok just (dis)connected → show/hide the Setting TikTok card
  applyPostModeAvailability(); // …and add/remove the auto-post delivery option to match
}

function applySettings(s) {
  if (!s) return;
  $$("[data-account-tier]").forEach((sel) => {
    // only seed the default until the user has picked a tier themselves
    if (document.activeElement !== sel && !sel.dataset.dirty) sel.value = s.defaultTier;
  });
  applyDownloadDir(s);
  applySystemPrompts(s);
  applyTikTokSettings(s);
  applyRowDelay(s);
}

// Mirror the per-mode System Prompt overrides and refresh the Custom Prompt button's
// badge (the first state may land after the form rendered with an empty mirror).
function applySystemPrompts(s) {
  if (s.systemPrompts && typeof s.systemPrompts === "object") systemPrompts = s.systemPrompts;
  refreshPromptButton();
}

// Mirror the saved TikTok toggles (the state may land after the form first rendered
// with defaults) and reflect them onto the live switches. [[tiktok-settings]]
function applyTikTokSettings(s) {
  if (s.tiktokSettings && typeof s.tiktokSettings === "object") {
    tiktokSettings = { ...TIKTOK_SETTINGS_DEFAULT, ...s.tiktokSettings };
  }
  syncTikTokToggles();
}

// reflect the auto-save folder in Settings ▸ ที่เก็บไฟล์ (don't clobber while typing)
function applyDownloadDir(s) {
  const effective = s.downloadDir || s.downloadDirEffective || "";
  const input = $("downloadDir");
  // Show the ACTUAL folder in the field — a custom path, or the resolved default
  // (downloadDirEffective) — so the user always sees where files land. Skip while
  // they're typing so it doesn't overwrite their edit.
  if (input && document.activeElement !== input) {
    input.value = effective;
  }
  const chip = $("downloadDirChip");
  if (chip) {
    // auto-save is always on, so the chip stays "active" (accent) for both the
    // default and a custom folder — never the muted "soon/not-wired" treatment
    chip.textContent = s.downloadDir ? "กำหนดเอง" : "ค่าเริ่มต้น";
    chip.classList.remove("soon");
  }
  // mirror into the setup wizard's step โ‘ก (save folder). A valid folder always
  // exists (the resolved default), so the step is satisfied as soon as we know it.
  const setupPath = $("setupFolderPath");
  if (setupPath) {
    setupPath.textContent = effective || "(กำลังโหลด…)";
    setupPath.title = effective;
  }
  setupFolderReady = !!effective;
}

// Settings ▸ API Keys — reflect the masked/configured state synced from the user's
// backend account (state.keys = { openai, openrouter, kie, configured }). The raw
// keys never reach the UI; we only show "set + masked" or "not set" per provider.
function applyApiKeys(keys) {
  const k = keys || {};
  const conf = k.configured || {};
  let anySet = false;
  for (const [field, id] of [
    ["openai", "keyOpenaiState"],
    ["openrouter", "keyOpenrouterState"],
    ["kie", "keyKieState"],
  ]) {
    const el = $(id);
    const set = !!conf[field];
    anySet = anySet || set;
    if (el) {
      el.textContent = set ? `ยท ✓ ${k[field] || "••••"}` : "ยท ยังไม่ตั้งค่า";
      el.classList.toggle("ok", set);
    }
    // the per-key "ลบ" button only appears once that key is actually set
    const del = document.querySelector(`[data-key-delete="${field}"]`);
    if (del) del.hidden = !set;
  }
  const chip = $("apiKeysSyncChip");
  if (chip) chip.hidden = !anySet;
  // The setup wizard's step โ‘ก is "done" once EITHER AI provider has a key
  // (KIE is for video, not the AI script step — it doesn't count here).
  setupHasAiKey = !!(conf.openai || conf.openrouter);
}

// ---- auto-save folder (Settings ▸ ที่เก็บไฟล์) ----
// Native folder picker. In the desktop window it goes through the pywebview bridge; inside
// a multi-profile profile tab (iframe) the iframe has no pywebview, so it asks the shell over
// postMessage; in a plain browser it falls back to typing the path. [[multi-profile]]
function pickFolderViaShell() {
  // Ask the parent shell window (which owns pywebview) to open the native picker and post
  // the chosen path back. Resolves to the path, "" on cancel, or null if no shell answered.
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e) => {
      // Only trust the reply from the shell parent: a file:// shell reports origin "null";
      // accept a 127.0.0.1 origin too (defensive). Ignore any other sender.
      if (e.origin !== "null" && !/^http:\/\/127\.0\.0\.1:\d+$/.test(e.origin)) return;
      if (!e.data || !Object.prototype.hasOwnProperty.call(e.data, "__tb_folder_result")) return;
      done = true;
      window.removeEventListener("message", onMsg);
      resolve(e.data.__tb_folder_result || "");
    };
    window.addEventListener("message", onMsg);
    try {
      window.parent.postMessage({ __tb_pick_folder: true }, "*");
    } catch (_) {
      window.removeEventListener("message", onMsg);
      resolve(null);
      return;
    }
    setTimeout(() => {
      if (done) return;
      window.removeEventListener("message", onMsg);
      resolve(null); // no shell / cancelled dialog never answered
    }, 120000);
  });
}

async function pickDownloadFolder() {
  const api = window.pywebview?.api;
  const inProfileTab = window.parent && window.parent !== window;
  if (!api?.pick_folder && !inProfileTab) {
    addLog("เลือกจากเครื่องได้เฉพาะตอนเปิดผ่านหน้าต่างแอป — ในเบราว์เซอร์ให้พิมพ์พาธเอง", "warn");
    $("downloadDir")?.focus();
    return;
  }
  try {
    const path = api?.pick_folder ? await api.pick_folder() : await pickFolderViaShell();
    if (!path) return; // user cancelled / no picker
    const input = $("downloadDir");
    if (input) input.value = path;
    send({ type: "settings.update", data: { downloadDir: path } }); // pick = apply
    addLog(`เลือกโฟลเดอร์: ${path}`, "info");
  } catch (e) {
    addLog(`เลือกโฟลเดอร์ไม่สำเร็จ: ${e}`, "error");
  }
}
$("downloadDirBrowse")?.addEventListener("click", pickDownloadFolder);

$("downloadDirSave")?.addEventListener("click", () => {
  const v = ($("downloadDir")?.value || "").trim();
  send({ type: "settings.update", data: { downloadDir: v } });
  addLog(v ? `Saving save folder: ${v}` : "Resetting save folder to default…", "info");
});
$("downloadDirReset")?.addEventListener("click", () => {
  const input = $("downloadDir");
  if (input) input.value = "";
  send({ type: "settings.update", data: { downloadDir: "" } });
  addLog("Resetting save folder to default…", "info");
});

// ---- login gate (removed) ----

// Version the user explicitly dismissed — don't nag again until a newer one ships.
// Persisted so the dismissal survives a WebView2 reload / app restart.
let updateDismissedFor = safeLS.get("updateDismissedFor") || null;

// Toggle the "update available" banner from the live state. `update` is the hub's
// cached result ({available, current, latest, notes, mandatory, downloading,
// downloaded, error}) or null (updates disabled / not yet checked). The CTA
// downloads + verifies the exe IN-APP; the swap itself happens on next restart
// (a one-file exe can't overwrite itself while running).
// Full-screen "updating" overlay — covers the app while the new build downloads (real
// % streamed from the server), then a brief "installing" beat before the app
// auto-restarts. Driven entirely by the update state (downloading/downloaded/progress).
function renderUpdateOverlay(update) {
  const ov = document.getElementById("updateOverlay");
  if (!ov) return;
  const active = !!(update && (update.downloading || update.downloaded));
  ov.hidden = !active;
  if (!active) return;
  const pct = Math.max(0, Math.min(100, Number(update.progress) || 0));
  const set = (id, t) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };
  set("uoVersion", update.latest || update.current || "");
  const fill = document.getElementById("uoFill");
  if (fill) fill.style.width = (update.downloaded ? 100 : pct) + "%";
  if (update.downloaded) {
    set("uoPct", "100%");
    set("uoStatus", "ติดตั้งแล้ว — กำลังรีสตาร์ท…");
  } else {
    set("uoPct", pct + "%");
    set("uoStatus", "กำลังดาวน์โหลด…");
  }
}

function renderUpdate(update) {
  // Sidebar version pill: bind to the REAL running version. The HTML default was a
  // hardcoded "v0.1.0" placeholder that never tracked __version__ — so it showed
  // v0.1.0 forever even after the app updated. update.current = the server's
  // __version__, sent on every ui.state.
  if (update && update.current) {
    const vp = document.querySelector(".sb-version");
    if (vp) vp.textContent = "v" + update.current;
  }
  renderUpdateOverlay(update);
  const banner = document.getElementById("updateBanner");
  if (!banner) return;
  // `forced` (below the support floor) or `mandatory` → non-dismissible, and it
  // shows even if the user dismissed this version earlier.
  const locked = !!(update && (update.forced || update.mandatory));
  const show = !!(update && update.available) && (locked || update.latest !== updateDismissedFor);
  if (!show) {
    banner.hidden = true;
    return;
  }
  const text = document.getElementById("updateText");
  const btn = document.getElementById("updateBtn");
  // A multi-line categorized changelog belongs in the "What's new" popup (renderWhatsNew),
  // not dumped raw inline here — show only a short one-line teaser (the first item).
  const clGroups = parseChangelog(update.notes);
  const firstItem = clGroups[0] && clGroups[0].items[0];
  const teaser = firstItem
    ? ` — ${firstItem.length > 60 ? firstItem.slice(0, 57) + "…" : firstItem}`
    : "";
  let line = update.forced
    ? `🔒 ต้องอัปเดตเป็นเวอร์ชัน ${update.latest} ก่อนใช้งาน${teaser}`
    : `มีเวอร์ชันใหม่ ${update.latest} (ปัจจุบัน ${update.current})${teaser}`;
  if (update.downloaded) {
    line = `✓ ดาวน์โหลดเวอร์ชัน ${update.latest} แล้ว — กดรีสตาร์ทเพื่ออัปเดต`;
  } else if (update.error) {
    line += ` ยท โหลดไม่สำเร็จ: ${update.error}`;
  }
  if (text) text.textContent = line;

  if (btn) {
    // downloaded → restart-to-apply; otherwise download. The click handler is bound
    // once and reads the live mode off dataset so it stays correct across re-renders.
    btn.hidden = false;
    btn.disabled = !!update.downloading;
    btn.textContent = update.downloading
      ? "กำลังดาวน์โหลด…"
      : update.downloaded
        ? "รีสตาร์ทเพื่ออัปเดต"
        : update.error
          ? "ลองใหม่"
          : "ดาวน์โหลด";
    btn.dataset.mode = update.downloaded ? "apply" : "download";
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        if (btn.dataset.mode === "apply") {
          // Remember the version we're updating INTO so the relaunched (new) build
          // force-shows its What's-new popup — even the build that INTRODUCED the popup,
          // whose whatsNewSeenVersion would otherwise be seeded silently → no popup.
          safeLS.set("justUpdatedTo", (lastUpdate && lastUpdate.latest) || banner.dataset.latest || "");
          send({ type: "update.apply" }); // close window → swap on exit → relaunch
          return;
        }
        send({ type: "update.download" });
        // Optimistic: reflect "downloading" right away; the state broadcast confirms.
        btn.disabled = true;
        btn.textContent = "กำลังดาวน์โหลด…";
      });
    }
  }

  // A mandatory/forced update can't be dismissed; a downloaded one stays until restart.
  banner.classList.toggle("mandatory", locked);
  banner.dataset.latest = update.latest;
  const dismiss = document.getElementById("updateDismiss");
  if (dismiss) {
    dismiss.hidden = locked;
    if (!dismiss.dataset.bound) {
      dismiss.dataset.bound = "1";
      dismiss.addEventListener("click", () => {
        updateDismissedFor = banner.dataset.latest || null;
        safeLS.set("updateDismissedFor", updateDismissedFor || "");
        banner.hidden = true;
      });
    }
  }
  banner.hidden = false;
}

// ── "What's new" / changelog popup ──────────────────────────────────────────────
// After the app self-updates and relaunches, the operator wants the user to see a
// one-time list of what changed in the new version — shown AFTER they enter the
// GT Pro Beta 0 workspace and finish logging in (their chosen trigger), and never
// again for that version. A "มีอะไรใหม่" link by the version pill reopens it anytime.
//
// Transport: we reuse the release `notes` string (it already round-trips S3 manifest →
// backend → updater → hub → ui.state.update.notes untouched — the backend whitelists
// fields, so a *new* manifest field would be dropped without a backend redeploy).
// The notes are authored as a lightweight categorized changelog (release.py
// --notes-file): `#`-prefixed lines are category headings, `-`/`*`/`•` lines are items.

// Compare two version strings numerically (e.g. "11.6" vs "11.10"). Mirrors
// updater.parse_version: split on non-digits, pad-compare. Returns true iff
// `candidate` is strictly newer than `base`.
function isNewerVersion(base, candidate) {
  const tup = (v) => String(v || "").split(/[^\d]+/).filter((x) => x !== "").map((n) => parseInt(n, 10) || 0);
  const a = tup(base);
  const b = tup(candidate);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

// Parse operator-authored release notes into category groups for the popup.
// `#`/`##` line → new category heading; `-`/`*`/`•`/`ยท` line → item; any other
// non-empty line → item under the current (or a default untitled) group. A plain
// single-line note (old releases) collapses to one untitled group with one item.
// Returns [{ title: string|null, items: string[] }] with empty groups dropped.
function parseChangelog(notes) {
  const text = String(notes || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const groups = [];
  let cur = null;
  const ensure = () => {
    if (!cur) {
      cur = { title: null, items: [] };
      groups.push(cur);
    }
    return cur;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,4}\s*(.+)$/);
    if (h) {
      cur = { title: h[1].trim(), items: [] };
      groups.push(cur);
      continue;
    }
    ensure().items.push(line.replace(/^[-*•·]\s*/, ""));
  }
  return groups.filter((g) => g.items.length);
}

let whatsNewOpen = false;

// Build + show the popup. Text is set via textContent (never innerHTML) so an
// operator-authored note can't inject markup. Standalone overlay (independent of the
// promise-based modal lifecycle) so it never aborts a pending Run dialog.
function renderWhatsNew(version, groups) {
  if (whatsNewOpen) return;
  whatsNewOpen = true;
  const list =
    groups && groups.length
      ? groups
      : [{ title: null, items: ["ปรับปรุงทั่วไปและแก้ไขข้อบกพร่อง"] }];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay whats-new";
  overlay.innerHTML = `
    <div class="modal wn-card" role="dialog" aria-modal="true" aria-labelledby="wnTitle">
      <div class="wn-head">
        <img class="wn-logo" src="/static/logo.png" alt="" width="44" height="44" />
        <div class="wn-head-text">
          <h3 class="modal-title" id="wnTitle">GT Pro Beta 0 Update</h3>
          <p class="wn-ver"></p>
        </div>
      </div>
      <div class="wn-body" id="wnBody"></div>
      <div class="modal-actions">
        <button type="button" class="btn primary" data-wn="ok">เริ่มใช้งาน</button>
      </div>
    </div>`;
  overlay.querySelector(".wn-ver").textContent = version ? `เวอร์ชั่น ${version}` : "";
  const body = overlay.querySelector("#wnBody");
  for (const g of list) {
    const block = document.createElement("div");
    block.className = "wn-group";
    if (g.title) {
      const h = document.createElement("div");
      h.className = "wn-cat";
      h.textContent = g.title;
      block.appendChild(h);
    }
    const ul = document.createElement("ul");
    ul.className = "wn-list";
    for (const it of g.items) {
      const li = document.createElement("li");
      li.textContent = it;
      ul.appendChild(li);
    }
    block.appendChild(ul);
    body.appendChild(block);
  }
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 200);
    whatsNewOpen = false;
  };
  overlay.addEventListener("click", (e) => {
    if (e.target.closest('[data-wn="ok"]') || e.target === overlay) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    overlay.querySelector('[data-wn="ok"]')?.focus();
  });
}

// Latest known update view + running version, captured each ui.state so the manual
// "มีอะไรใหม่" link and the deferred auto-popup can read them off any event.
let lastUpdate = null;
let lastRunningVersion = null;
let whatsNewPending = null; // version we owe an auto-popup for (set when a bump is detected)
let whatsNewShownThisSession = false; // auto-popup fires at most once per launch

// True when localStorage already holds GT Pro Beta 0 state from a prior run — i.e. a
// returning/updated user, not a brand-new install. Lets maybeWhatsNew treat a missing
// whatsNewSeenVersion as "just updated into the popup feature" (show it) instead of
// "fresh install" (seed silently). Any key other than the seen-marker counts.
function hasPriorAppState() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== "whatsNewSeenVersion") return true;
    }
  } catch (_) { /* WebView2 localStorage can throw → treat as fresh */ }
  return false;
}

// Called every ui.state. Detects "we just updated" by comparing the always-present
// running version against the last version the user has seen the changelog for
// (persisted in localStorage). First run on a feature-bearing build seeds the
// baseline silently (no popup); a real bump arms `whatsNewPending`.
function maybeWhatsNew(runningVersion, update) {
  if (update) lastUpdate = update; // /version not fetched yet → update is null; keep last good
  if (runningVersion) lastRunningVersion = runningVersion;
  const cur = lastRunningVersion;
  if (cur) {
    const seen = safeLS.get("whatsNewSeenVersion");
    const justUpdated = safeLS.get("justUpdatedTo");
    if (justUpdated && justUpdated === cur && cur !== whatsNewPending) {
      // A real in-app update just applied to THIS version (marker set pre-relaunch by the
      // apply button) → always show, even for the feature-introducing build whose
      // whatsNewSeenVersion would otherwise be seeded silently in the branch below.
      whatsNewPending = cur;
      safeLS.set("justUpdatedTo", ""); // consume the one-shot marker
    } else if (!seen) {
      // No baseline yet. A RETURNING user (localStorage already holds prior app state)
      // updated into this build from a version predating the popup → show it once. A
      // truly fresh install (no prior keys) seeds silently so first-run isn't spammed.
      // KNOWN LIMITATION: on broken WebView2 profiles where localStorage throws, safeLS
      // returns null forever ([[bootveil-stuck-localstorage-throw]]); hasPriorAppState is
      // false → silent (degrades safely; the manual "มีอะไรใหม่" link still works there).
      if (hasPriorAppState()) whatsNewPending = cur;
      else safeLS.set("whatsNewSeenVersion", cur);
    } else if (isNewerVersion(seen, cur) && cur !== whatsNewPending) {
      whatsNewPending = cur;
    }
  }
  updateWhatsNewLink();
  tryShowWhatsNew();
}

// Fire the auto-popup once the trigger conditions hold: session unlocked AND the user
// is inside the GT Pro Beta 0 workspace (not the public Dashboard) AND the changelog has
// actually arrived from /version. A release shipped without notes marks the version
// seen so it never re-evaluates. Re-invoked from applyGate() on every auth/nav change.
function tryShowWhatsNew() {
  if (whatsNewShownThisSession || !whatsNewPending) return;
  const inWorkspace = currentNav && currentNav !== "dashboard";
  if (!inWorkspace) return; // trigger: after entering GT Pro Beta 0
  if (!lastUpdate) return; // /version response (with notes) hasn't landed yet → wait
  const groups = parseChangelog(lastUpdate.notes);
  const ver = whatsNewPending;
  safeLS.set("whatsNewSeenVersion", ver); // don't nag again for this version
  whatsNewPending = null;
  if (!groups.length) return; // nothing to read (notes-less release) → silent
  whatsNewShownThisSession = true;
  renderWhatsNew(ver, groups);
}

// The "มีอะไรใหม่" link by the version pill — visible only when there's a changelog to
// show, and reopens the same popup on demand (for the version the notes describe).
function updateWhatsNewLink() {
  const link = $("sbWhatsNew");
  if (!link) return;
  const groups = parseChangelog(lastUpdate && lastUpdate.notes);
  link.hidden = !groups.length;
  if (!link.dataset.bound) {
    link.dataset.bound = "1";
    link.addEventListener("click", () => {
      const ver = (lastUpdate && lastUpdate.latest) || lastRunningVersion || "";
      renderWhatsNew(ver, parseChangelog(lastUpdate && lastUpdate.notes));
    });
  }
}

// No-login build: the app is always unlocked.
let lastAuth = null;

// noLoginAuth function removed

function applyGate() {
  // Auth gate removed - always unlocked
  document.body.classList.remove("locked");
  postSectionToShell();
  tryShowWhatsNew();
}

function renderAuth(auth) {
  // Auth gate removed - always unlocked
  lastAuth = { ...(auth || {}), authenticated: true, unlocked: true };
  const unlocked = true;
  setupUnlocked = unlocked;
  applyGate();
}

// ---- setup wizard (post-login onboarding) ----
// A guided overlay shown AFTER the login gate unlocks, walking the user through the
// three one-time setup steps that mirror the Settings flows: โ‘  install the extension
// (Chrome Web Store, or Load-unpacked fallback), โ‘ก choose the save folder, โ‘ข add an
// AI API key. Each step auto-ticks from the live ui.state — extension via
// `extConnected`, the save folder via `setupFolderReady` (set in applyDownloadDir),
// the AI key via `setupHasAiKey` (set in applyApiKeys). It's not a hard lock:
// "ตั้งค่าภายหลัง" / "เริ่มใช้งาน" dismisses it for the session, it reappears next
// launch while still incomplete, and once it's done it's marked complete in
// localStorage and never auto-shows again.
let setupUnlocked = false; // mirrors auth.unlocked (set in renderAuth)
let setupHasAiKey = false; // OpenAI or OpenRouter key configured (set in applyApiKeys)
let setupFolderReady = false; // a save folder is resolved (set in applyDownloadDir)
let setupDismissed = false; // user closed the wizard this session (skip / finish)
let setupWasShown = false; // the wizard was actually displayed this session
let setupKeySaving = false; // an auth.keys.save is in flight from the wizard (for error feedback)

// The extension's published Chrome Web Store listing — step โ‘ 's "กดเพื่อติดตั้ง"
// button opens this. The store-assigned id (ndjhglk…) is NOT the Load-unpacked id
// in native_host.py (llikcndp…) — see the native-messaging note if "Connect" misbehaves.
const EXT_WEBSTORE_URL =
  "#";
const EXT_WEBSTORE_READY = !EXT_WEBSTORE_URL.includes("REPLACE_WITH_STORE_ID");

// Open an external URL from the desktop window. A synthesized <a target="_blank">
// click is handled by WebView2's new-window logic (opens the default browser) more
// reliably than window.open, which can be intercepted.
function openExternalUrl(url) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Open a URL specifically in Google Chrome (NOT the OS default browser). The
// extension-install steps must land in Chrome — the Web Store install only works
// there, and many machines default to Edge/Firefox so openExternalUrl would open the
// wrong browser. The backend launches chrome.exe directly. Falls back to the default
// browser (with a nudge to install Chrome) only when Chrome isn't on the machine.
async function openInChrome(url) {
  try {
    const data = await (
      await fetch("/api/open-chrome", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url }),
      })
    ).json();
    if (data.ok) return true;
    if (data.error !== "Chrome not found") {
      addLog(`เปิดใน Chrome ไม่สำเร็จ: ${data.error}`, "warn");
    }
  } catch (e) {
    addLog(`เปิด Chrome error: ${e}`, "error");
  }
  addLog("ไม่พบ Google Chrome — กรุณาติดตั้ง Chrome ก่อน (เปิดด้วยเบราว์เซอร์เริ่มต้นแทน)", "warn");
  openExternalUrl(url);
  return false;
}

// Toggle a step row's done (green check) + locked (dimmed + 🔒, body hidden) state.
function applySetupStep(stepId, done, locked) {
  const step = $(stepId);
  if (!step) return;
  step.dataset.done = String(done);
  step.dataset.locked = String(locked);
}

// Single place that flips the overlay on/off. Also keeps the app behind it out of
// the tab order / accessibility tree while it's up (it's a blocking modal), and moves
// focus into the card on first appearance — mirroring the app's other dialogs.
function setSetupGateVisible(show) {
  const gate = $("setupGate");
  if (!gate) return;
  const wasHidden = gate.hidden;
  gate.hidden = !show;
  const shell = document.querySelector(".app-shell");
  if (shell) {
    shell.toggleAttribute("inert", show);
    if (show) shell.setAttribute("aria-hidden", "true");
    else shell.removeAttribute("aria-hidden");
  }
  if (show) {
    setupWasShown = true;
    if (wasHidden) (gate.querySelector(".setup-card") || gate).focus?.();
  }
}

function dismissSetupGate(markComplete) {
  setupDismissed = true;
  if (markComplete) safeLS.set("setupComplete", "1");
  setSetupGateVisible(false);
}

function renderSetupGate() {
  const gate = $("setupGate");
  if (!gate) return;
  safeLS.set("setupComplete", "1");
  setSetupGateVisible(false);
  setupDismissed = true;
  setupWasShown = false;
  return;

  const extDone = !!extConnected;
  const folderDone = !!setupFolderReady;
  const keyDone = !!setupHasAiKey;
  const complete = extDone && folderDone && keyDone;

  // Hard sequential gate: each step is LOCKED until the previous one is done, so the
  // user must finish โ‘  → โ‘ก → โ‘ข in order (no skipping). Step โ‘  is never locked.
  applySetupStep("setupStepExt", extDone, false);
  applySetupStep("setupStepFolder", folderDone, !extDone);
  applySetupStep("setupStepKey", keyDone, !(extDone && folderDone));
  const extWait = $("setupExtWait");
  if (extWait) extWait.hidden = extDone; // drop the "waiting…" line once connected
  const n = (extDone ? 1 : 0) + (folderDone ? 1 : 0) + (keyDone ? 1 : 0);
  const fill = $("setupProgressFill");
  if (fill) fill.style.width = `${(n / 3) * 100}%`;
  const ptext = $("setupProgressText");
  if (ptext) ptext.textContent = `ทำไปแล้ว ${n}/3`;
  // "เริ่มใช้งาน" is the ONLY way out — and it's enabled only once all 3 are done.
  const finish = $("setupFinish");
  if (finish) {
    finish.disabled = !complete;
    finish.textContent = complete ? "เสร็จแล้ว 🎉 เริ่มใช้งาน" : "ทำให้ครบทุกขั้นก่อน";
  }
  gate.classList.toggle("is-complete", complete);

  // Once the AI key is stored, the optimistic "saving…" note has done its job and the
  // inputs can be cleared. We clear here — NOT on the Save click — so a rejected save
  // keeps the typed key for a retry.
  if (keyDone) {
    setupKeySaving = false;
    const msg = $("setupKeyMsg");
    if (msg && !msg.classList.contains("warn")) msg.hidden = true;
    if ($("setupKeyOpenai")) $("setupKeyOpenai").value = "";
    if ($("setupKeyOpenrouter")) $("setupKeyOpenrouter").value = "";
  }

  // Visibility: only on an unlocked session, while incomplete + not dismissed.
  let show = setupUnlocked && currentNav !== "dashboard" && !setupDismissed && safeLS.get("setupComplete") !== "1";
  if (show && complete && !setupWasShown) {
    // Already complete the first time we'd show it (set up via Settings on a prior
    // run) → record it silently and stay out of the way.
    safeLS.set("setupComplete", "1");
    show = false;
  }
  // When it completes LIVE while open, we deliberately do NOT persist here — setupFinish
  // persists it when the user clicks "เริ่มใช้งาน". Persisting now would let the next
  // unrelated ui.state broadcast hide the wizard out from under the user.
  setSetupGateVisible(show);
}

// step โ‘ : open the extension's Chrome Web Store listing. Until EXT_WEBSTORE_URL is
// filled in (operator pastes the published URL), show a brief "link coming" note.
$("setupInstallExt")?.addEventListener("click", () => {
  if (!EXT_WEBSTORE_READY) {
    const wait = $("setupExtWait");
    if (wait) {
      wait.classList.add("warn");
      wait.textContent = "ลิงก์ติดตั้งกำลังจะมา — เดี๋ยวอัปเดตให้";
    }
    return;
  }
  openInChrome(EXT_WEBSTORE_URL);
});

// step โ‘ก: native folder picker (reuses the Settings ▸ ที่เก็บไฟล์ logic). The chosen
// path flows back through settings.update → applyDownloadDir → #setupFolderPath.
$("setupFolderBrowse")?.addEventListener("click", pickDownloadFolder);

// Wizard step โ‘ก: save whichever AI key(s) the user typed. Reuses the same
// auth.keys.save protocol as Settings ▸ API Keys; the step ticks ✓ on the next
// ui.state once the backend confirms the key is stored.
$("setupSaveKey")?.addEventListener("click", () => {
  const openai = ($("setupKeyOpenai")?.value || "").trim();
  const openrouter = ($("setupKeyOpenrouter")?.value || "").trim();
  const msg = $("setupKeyMsg");
  const warn = (text) => {
    if (msg) {
      msg.hidden = false;
      msg.className = "setup-key-msg warn";
      msg.textContent = text;
    }
  };
  if (!openai && !openrouter) {
    warn("กรอก API key อย่างน้อยหนึ่งช่อง (OpenAI หรือ OpenRouter)");
    return;
  }
  // Light client-side sanity guard — catches a truncated paste or a key dropped in
  // the wrong field BEFORE we store it (real validity is checked server-side on use,
  // or via Settings ▸ ทดสอบ). Lenient on purpose: only blocks an obviously bad value.
  const looksKey = (k) => k.length >= 20 && !/\s/.test(k);
  const data = {};
  if (openai) {
    if (!looksKey(openai)) return warn("OpenAI key ดูไม่ถูกต้อง — ตรวจสอบแล้ววางใหม่อีกครั้ง");
    data.openai = openai;
  }
  if (openrouter) {
    if (!looksKey(openrouter)) return warn("OpenRouter key ดูไม่ถูกต้อง — ตรวจสอบแล้ววางใหม่อีกครั้ง");
    data.openrouter = openrouter;
  }
  send({ type: "auth.keys.save", data });
  setupKeySaving = true; // so an error-level log from the save surfaces in the overlay
  // NOTE: inputs are NOT cleared here — renderSetupGate clears them once the save is
  // confirmed (setupHasAiKey flips true), preserving the key for a retry on failure.
  if (msg) {
    msg.hidden = false;
    msg.className = "setup-key-msg";
    msg.textContent = "กำลังบันทึก API key…";
  }
});

// show/hide the wizard's password inputs
document.addEventListener("click", (e) => {
  const eye = e.target.closest("[data-setup-eye]");
  if (!eye) return;
  const input = $(eye.dataset.setupEye);
  if (input) input.type = input.type === "password" ? "text" : "password";
});

// "เริ่มใช้งาน" enters the app — the ONLY way out of the wizard (no skip). The button
// is disabled until all 3 steps are done, so a click means setup is complete; persist
// it so the gate never auto-shows again.
$("setupFinish")?.addEventListener("click", () => {
  if (!(extConnected && setupFolderReady && setupHasAiKey)) return; // belt-and-suspenders
  dismissSetupGate(true);
});

// ---- boot veil ----
// A full-screen branded splash (#bootVeil, the in-page twin of the native launch
// splash) covers the app until the first server state lands, so an already-logged-in
// user never sees the login form flash on the way in. Dismissed once — on the first
// ui.state, or by a safety timeout in case state is slow/never arrives (the veil sits
// above the auth gate, so it must NEVER trap the user behind it).
let bootVeilDismissed = false;
function dismissBootVeil() {
  if (bootVeilDismissed) return;
  bootVeilDismissed = true;
  const veil = document.getElementById("bootVeil");
  if (!veil) return;
  veil.classList.add("is-hiding"); // fades opacity→0, then visibility:hidden + no pointer-events
  veil.addEventListener("transitionend", () => veil.remove(), { once: true });
  setTimeout(() => veil.remove(), 900); // belt-and-suspenders if transitionend doesn't fire
}
setTimeout(dismissBootVeil, 8000); // hard fallback: never leave the veil up forever

// ---- boot ----
function applyHash() {
  const [navKey, sub] = location.hash.slice(1).split("/");
  setNav(NAV[navKey] ? navKey : DEFAULT_NAV);
  if (navKey === "settings" && sub) setSubtab(sub);
}
// Hardened: a nav error during boot must NEVER abort the rest of init (loadInfo/connect).
// connect() opens the WS that delivers the first ui.state — without it the boot veil would
// stay up forever (black screen). So swallow any applyHash throw and fall back to the home.
try {
  applyHash();
} catch (e) {
  addLog(`nav init failed (${e}); showing home`, "warn");
  try { setNav(DEFAULT_NAV); } catch (_) { /* even that failed — connect() still runs below */ }
}
window.addEventListener("hashchange", applyHash);
loadInfo();
connect();
