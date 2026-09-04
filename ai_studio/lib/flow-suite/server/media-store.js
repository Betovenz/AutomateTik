// Order numbers + the "Connect" log that ties an order number back to its
// product/link/final file. Ported from the BlueSPite reference project
// (C:\Users\Blue\Documents\Test\Blue SP_ai\server\media-store.mjs).
//
// Deviation from BlueSPite (per the port plan, decision #3): ai_studio
// already has a working, proven pipeline for the actual video file
// (server.js's finalizeFlowScenes(), writing into Final-File/<platform>/ +
// a Final-File-JS/<platform>/ metadata companion) — this module does NOT
// duplicate that. It only adds the order-number identifier and a sibling
// Final-File-Connect/<platform>/<order>.json summary log, so nothing that
// already works today needs to change.

const fs = require("fs");
const path = require("path");
const store = require("./store.js");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLetters(n) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return out;
}

function randomDigits(n) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/**
 * `XX-XXXX-XXX` — 2 random English letters, a persisted 4-digit sequence (so
 * files sort in creation order), 3 random digits (collision safety). English
 * letters/digits only, so the number is always a safe filename/folder name.
 */
function genOrderNumber() {
  const seq = store.nextOrderSeq();
  return `${randomLetters(2)}-${String(seq).padStart(4, "0")}-${randomDigits(3)}`;
}

function connectDirFor(root, platformKey) {
  const dir = path.join(root, "Final-File-Connect", platformKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The per-order "Connect" log — product, link, scenes, and which file is
 *  the final video. One JSON file per order, alongside Final-File/Final-File-JS. */
function writeConnectLog(root, platformKey, orderNumber, payload) {
  const dir = connectDirFor(root, platformKey);
  const dest = path.join(dir, `${orderNumber}.json`);
  fs.writeFileSync(dest, JSON.stringify({ orderNumber, ...payload }, null, 2), "utf8");
  return dest;
}

module.exports = {
  genOrderNumber,
  writeConnectLog,
};
