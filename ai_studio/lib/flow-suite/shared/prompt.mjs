// Prompt builder — folds a product record + the 6 direction picks into the
// text sent to Flow. Shared by the server and the web UI (the UI renders a
// live preview from the same function, so what you see is what gets
// submitted).
//
// Ported near-verbatim from the BlueSPite reference project
// (C:\Users\Blue\Documents\Test\Blue SP_ai\shared\prompt.mjs).

import {
  STYLE_OPTIONS, DIRECTION_FIELDS, styleLabel, isCustomValue, customValueText,
  modelSeconds, DEFAULT_TEXT_MODE,
} from "./catalog.mjs";

// Random per-generation atmosphere.
const TIME_VARIATIONS = [
  "บรรยากาศตอนเช้าสดใส", "แสงกลางวันสว่างไสว", "บรรยากาศตอนบ่ายสบายๆ", "แสงเย็นอบอุ่น",
  "บรรยากาศตอนค่ำโรแมนติก", "แสงธรรมชาตินุ่มนวล", "บรรยากาศสดใส", "แสง soft light",
  "บรรยากาศตอนเช้ามื้อ", "แสงทอง golden hour",
];
const MOOD_VARIATIONS = [
  "บรรยากาศสดใสร่าเริง", "อารมณ์ผ่อนคลาย", "บรรยากาศกระตือรือร้น", "อารมณ์อบอุ่นเป็นกันเอง",
  "บรรยากาศมีชีวิตชีวา", "อารมณ์สงบเยือกเย็น", "บรรยากาศมั่นใจ", "อารมณ์สนุกสนาน",
  "บรรยากาศเป็นมิตร", "อารมณ์น่าตื่นเต้น",
];
const CAMERA_VARIATIONS = [
  "มุมกล้องใกล้ชิด", "มุมกล้องกว้าง", "มุมกล้องสูง", "มุมกล้องเตี้ย",
  "มุมกล้องปกติระดับสายตา", "โฟกัสที่สินค้าชัดเจน", "พื้นหลังเบลอสวย", "องค์ประกอบสมดุล",
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Thai prompt labels for each direction field — these are the words that actually
// land in the prompt (the form labels in DIRECTION_FIELDS are UI captions).
const DIRECTION_PROMPT_LABELS = {
  videoStyle: "สไตล์คลิป",
  character: "ตัวละคร",
  background: "ฉากหลัง",
  speakingStyle: "โทนการพูด",
  voiceType: "ลักษณะเสียง",
  speechContentStyle: "สไตล์บทพูด",
};

// Styles that must not contain speech at all.
const SILENT_STYLES = new Set(["silent-product"]);

// Hard safety rails — non-negotiable, always appended regardless of picks.
export const SAFETY_RULES = [
  "ตัวละครต้องเป็นผู้ใหญ่ (อายุ 18 ปีขึ้นไป) เท่านั้น — ห้ามมีเด็ก ทารก หรือผู้เยาว์ในภาพและวิดีโอเด็ดขาด",
  "ห้ามอ้างสรรพคุณทางการแพทย์ หรือการันตีผลลัพธ์",
  "ห้ามสร้างราคา ส่วนลด หรือโปรโมชันที่ไม่มีจริง และห้ามพูดตัวเลขราคา",
  "ห้ามอ้างข้อมูลที่ยืนยันไม่ได้ (อันดับ 1, ขายดีที่สุด, ของแท้ 100%, ส่งฟรี)",
  "ห้ามใส่โลโก้ ข้อความ หรือลายน้ำของแพลตฟอร์มอื่นในภาพ",
];

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

// Resolve one direction pick to its Thai prompt text. Returns "" for a blank pick so
// the caller can drop the line entirely and leave the model unconstrained.
function directionText(field, value) {
  const v = clean(value);
  if (!v) return "";
  if (isCustomValue(v)) return customValueText(v);
  if (field === "videoStyle" && v === "default") return "";
  return styleLabel(field, v);
}

// The product half of the prompt. Only facts that were actually available go
// in — a missing field is omitted rather than guessed.
function productBlock(product) {
  const lines = [];
  const name = clean(product?.name);
  if (name) lines.push(`ชื่อสินค้า: ${name}`);
  const brand = clean(product?.brand);
  if (brand) lines.push(`แบรนด์: ${brand}`);
  const category = clean(product?.category);
  if (category) lines.push(`หมวดสินค้า: ${category}`);

  const points = (product?.sellingPoints || [])
    .map(clean)
    .filter(Boolean)
    .slice(0, 5);
  if (points.length) lines.push(`จุดขาย: ${points.join(" / ")}`);

  const variations = (product?.variations || []).map(clean).filter(Boolean).slice(0, 6);
  if (variations.length) lines.push(`ตัวเลือกสินค้า: ${variations.join(", ")}`);
  return lines;
}

/**
 * Build the prompt pair for one generate job.
 *
 * @param {object} input
 * @param {object} input.product   product record {name, brand, category, sellingPoints[], variations[], images[]}
 * @param {object} input.direction { videoStyle, character, background, speakingStyle, voiceType, speechContentStyle }
 * @param {string} input.videoModel model id — decides the clip length the speech must fit
 * @param {string} input.extraPrompt operator's free-text addition, appended last
 * @param {string} input.textMode "withText" (default, AI-composed header banner, text
 *   stays on screen the whole clip) or "noText" (skip image-generation entirely — the
 *   video call gets the product's own photo as its start frame — and forbid on-screen
 *   text outright)
 * @returns {{ imagePrompt: string|null, videoPrompt: string, seconds: number, silent: boolean, textMode: string }}
 */
export function buildPrompt(input = {}) {
  const product = input.product || {};
  const direction = input.direction || {};
  const seconds = modelSeconds(input.videoModel);
  const style = clean(direction.videoStyle);
  const silent = SILENT_STYLES.has(style);
  const textMode = input.textMode === "noText" ? "noText" : DEFAULT_TEXT_MODE;

  const picks = [];
  for (const [field] of DIRECTION_FIELDS) {
    if (silent) {
      if (field === "speakingStyle" || field === "speechContentStyle") continue;
      if (field === "voiceType" && !isCustomValue(clean(direction.voiceType))) continue;
    }
    const text = directionText(field, direction[field]);
    if (text) picks.push(`${DIRECTION_PROMPT_LABELS[field]}: ${text}`);
  }

  const facts = productBlock(product);
  const extra = clean(input.extraPrompt);

  // ---- image prompt: WithText — H1/H2 header banner ----
  // Only built in "withText" mode. In "noText" mode the runner skips the
  // whole image-generation step (product photo goes straight into the video
  // call), so there is nothing to build a prompt for.
  let imagePrompt = null;
  if (textMode === "withText") {
  const characterText = directionText("character", direction.character) || "The person";
  const backgroundText = directionText("background", direction.background)
    || `${pickRandom(TIME_VARIATIONS)}, ${pickRandom(MOOD_VARIATIONS)}`;

  const imageParts = [
    `Realistic photo, UGC style, natural lighting. ${characterText} is featured in a completely `
      + "randomized, high-quality lifestyle environment suitable for the reference product's usage. "
      + "The background context should be dynamic and varied, not fixed to any specific room type "
      + "like a kitchen, and determined solely by the nature of the product itself. The background "
      + "is blurred to keep focus on the subject. The character is positioned slightly lower in the "
      + "frame to leave empty space at the top for the text header. The character is holding or "
      + "presenting the reference product in an engaging, enthusiastic manner suitable to the "
      + "product's size and weight.",
    "",
    "PRODUCT FIDELITY — STRICT: Reproduce the reference product EXACTLY as shown in the reference "
      + "image. Keep the packaging shape, colours, logo, brand name and EVERY piece of text/label on "
      + "the product 100% identical to the reference. Do NOT recolor the product or shift its colour "
      + "temperature — never add a gold, amber, or warm tint; the product's own colour must match the "
      + "reference exactly. Do NOT redraw, restyle, translate, rephrase, blur or invent any text on the "
      + "product — all characters (including Thai text) must stay sharp, legible and pixel-faithful to "
      + "the original. Do not alter the product label layout or branding in any way.",
    "",
    "High quality, 4k, sharp focus on the product.",
    "",
    "Add a professional graphic design text overlay positioned strictly at the top center of the "
      + "frame (Header/Banner style).",
    "Compose the header text yourself: write a short, punchy Thai advertising headline (large, bold, "
      + "max ~8 words) that highlights the product's single strongest selling point — based only on "
      + "the product details given below (name, brand, selling points). Write it like real ad copy, "
      + "not a plain repeat of the product name.",
    "Below the headline, add a smaller subtitle line: a short supporting phrase, or the price if one "
      + "is given in the product details below.",
    "Only use facts present in the product details — do not invent features, claims, prices, or "
      + "discounts that are not listed there. If no product details are given, write a generic but "
      + "appealing one-line headline suitable for the product shown in the reference image.",
    "",
    "The header text should be rendered in a typography style and color palette that automatically "
      + "matches the product's packaging. The text must be placed at the very top edge, clear of the "
      + "character's face, using a layout that looks like a video title or headline.",
    "",
    `Background style hint: ${backgroundText} — ${pickRandom(CAMERA_VARIATIONS)}.`,
    "",
    "⚠️ CRITICAL: Do NOT include any prefix labels, codes, brackets, or template markers in the "
      + "rendered text — render only the finished headline and subtitle. The text overlay must be "
      + "clean Thai text only, and no other text, caption, watermark, or logo may appear anywhere "
      + "else in the image.",
  ];
  if (facts.length) imageParts.push("", `Product details: ${facts.join(" / ")}`);
  if (extra) imageParts.push("", `Additional instruction from operator: ${extra}`);

  // NOT filter(Boolean) — imageParts intentionally includes "" entries as
  // blank-line paragraph separators; filtering them out would collapse every
  // section onto one dense block.
  imagePrompt = imageParts.join("\n");
  }

  // ---- video prompt: how that frame moves, plus the speech spec ----
  const videoParts = [
    `คลิปวิดีโอแนวตั้ง 9:16 ความยาว ${seconds} วินาที สำหรับโปรโมทสินค้าบน TikTok/Shopee`,
    "กล้องเคลื่อนนุ่มนวลต่อเนื่องไม่กระตุก โฟกัสที่สินค้าเป็นหลัก ไม่ตัดสลับฉากหลายครั้ง",
    "สินค้าต้องคงรูปเดิมตลอดคลิป — ห้ามให้สินค้าบิดเบี้ยว ละลาย หรือเปลี่ยนรูปทรง",
    textMode === "withText"
      ? "ถ้าในภาพมีข้อความปรากฏอยู่ (เช่น หัวข้อโปรโมชั่นหรือป้ายราคา) ข้อความนั้นต้องอยู่นิ่ง ชัดเจน อ่านออก "
        + "และคงอยู่ตลอดทั้งคลิปจนจบวิดีโอ ห้ามข้อความเลือนหาย บิดเบี้ยว หรือหายไปกลางคลิปเด็ดขาด"
      : "ห้ามมีข้อความ ตัวอักษร คำ หรือตัวเลขปรากฏบนหน้าจอเด็ดขาดตลอดทั้งคลิป ไม่ว่ากรณีใดก็ตาม "
        + "ห้ามมี caption หัวข้อโฆษณา ป้ายราคา หรือลายน้ำใดๆ บนจอ",
    ...facts,
    ...picks,
  ];

  if (silent) {
    videoParts.push("ไม่มีบทพูดและไม่มีเสียงคนพูดในคลิป — เล่าเรื่องด้วยภาพและการเคลื่อนไหวเท่านั้น");
  } else {
    const lo = Math.round(seconds * 2.5);
    const hi = Math.round(seconds * 3.5);
    videoParts.push(
      `บทพูดภาษาไทย ${lo}-${hi} คำ พูดจบพอดีใน ${seconds} วินาที`,
      "ต้องเอ่ยชื่อสินค้าอย่างน้อย 1 ครั้ง",
      "พูดเหมือนคนจริงที่ใช้สินค้าแล้วอยากบอกต่อ ไม่ใช่พรีเซนเตอร์อ่านสคริปต์ — ใช้ภาษาพูดจริงของคนไทย",
      "เน้นความรู้สึก 1 อย่างที่ใช้แล้วรู้สึกได้ ไม่ต้องไล่ลิสต์คุณสมบัติ",
      "ปิดท้ายให้คนดูอยากซื้อ พูดมั่นใจมีพลัง ห้ามจบเบาๆ แบบ \"ลองดูนะ\"",
      "ห้ามพูดตัวเลขราคาหรือส่วนลด",
    );
  }
  if (extra) videoParts.push(`เพิ่มเติมจากผู้ใช้: ${extra}`);
  videoParts.push(`ข้อห้าม: ${SAFETY_RULES.join(" | ")}`);

  return {
    imagePrompt,
    videoPrompt: videoParts.filter(Boolean).join("\n"),
    seconds,
    silent,
    textMode,
  };
}

// Direction dropdown data for the UI, with the blank + custom entries folded in.
export function directionOptions(field) {
  return [["", "AI เลือกให้"], ...(STYLE_OPTIONS[field] || []), ["__custom__", "✎ กำหนดเอง…"]];
}
