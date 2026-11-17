// Updates the Conservationist role card for the new rules (Nov 2026):
//  * right page: "20pts" (each map objective) and "25pts" (never trigger a crisis) both become "15pts", copied from the
//    card's own "15pts:" label (the majority objective) so they match the original lettering exactly; the rest of
//    each line slides left to close the gap.
//  * left page: the old ability ("START OF TURN: You may choose not to populate...") is replaced with the new one,
//    drawn in the hand-made pixel font from pixelfont.py (the same lettering as the Anaconda boss card).
// Works on the original card (before Nov 2026; in git: git show 4c5c765:public/assets/cards/roles/Conservationist.png),
// so it can't be run twice on its own output.
// Usage: node tools/update_conservationist_card.js <original Conservationist.png> <out.png>
// After replacing a role card, bump CARD_V in public/data.js so browsers fetch the new image.
'use strict';
const fs = require('fs'), path = require('path');
const PNG = require('./png.js');
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/update_conservationist_card.js <in.png> <out.png>'); process.exit(1); }

// ---------- the pixel font, read straight from pixelfont.py (one source of truth) ----------
const G = {};
for (const line of fs.readFileSync(path.join(__dirname, 'pixelfont.py'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*(['"])(.+?)\1:\s*(\[.*\]),?\s*$/.exec(line);
  if (m) G[m[2]] = JSON.parse(m[3]);
}
const SPACE = 3;
function glyph(ch, bold) {
  const rows = G[ch]; if (!rows) throw new Error('no glyph for ' + JSON.stringify(ch));
  let w = rows[0].length;
  let bits = rows.map(r => [...r.padEnd(w, '.')].map(c => c === '#'));
  if (bold) { bits = bits.map(r => [...Array(w + 1)].map((_, i) => (i < w && r[i]) || (i > 0 && r[i - 1]))); w += 1; }
  return { w, bits };
}
const textWidth = (t, s, bold) => [...t].reduce((x, ch) => x + (ch === ' ' ? SPACE : glyph(ch, bold).w + 1) * s, 0) - s;
function wrap(text, s, width, bold) {
  const lines = []; let cur = '';
  for (const w of text.split(' ')) { const t = (cur + ' ' + w).trim(); if (textWidth(t, s, bold) <= width || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- pixels ----------
const img = PNG.read(src), { w: W } = img, D = img.data;
const PAPER = [252, 251, 239, 255], RED = [237, 28, 36, 255], INK = [0, 0, 0, 255];
const at = (x, y) => (y * W + x) * 4;
const set = (x, y, c) => { const i = at(x, y); D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = c[3]; };
const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
const grab = (x0, y0, x1, y1) => { const rows = []; for (let y = y0; y <= y1; y++) rows.push(D.slice(at(x0, y), at(x1 + 1, y))); return rows; };
const paste = (rows, x, y) => rows.forEach((r, k) => D.set(r, at(x, y + k)));
function drawText(x, y, text, s, color, bold) {
  for (const ch of text) {
    if (ch === ' ') { x += SPACE * s; continue; }
    const g = glyph(ch, bold);
    g.bits.forEach((row, r) => row.forEach((on, c) => { if (on) fill(x + c * s, y + r * s, x + (c + 1) * s - 1, y + (r + 1) * s - 1, color); }));
    x += (g.w + 1) * s;
  }
}

// sanity check: this must be the original card (the red "20pts" digits where we expect them)
const isRed = (x, y) => { const i = at(x, y); return D[i] > 200 && D[i + 1] < 90 && D[i + 2] < 90; };
// (original: the "2" fills x 545-561 and there's a gap at x 562-565 before the "0"; on an updated card the "2" moved there)
const redIn = (x0, x1) => { for (let y = 71; y <= 105; y++) for (let x = x0; x <= x1; x++) if (isRed(x, y)) return true; return false; };
if (!redIn(545, 561) || redIn(562, 565)) throw new Error('this does not look like the original Conservationist card (already updated?)');

// ---------- right page: 20pts and 25pts -> 15pts ----------
// Measured on the original: the red labels sit on cap rows 71-105 ("20pts:"), 146-180 ("15pts:") and 258-292
// ("25pts:"). "20pts:" and "25pts:" end at x 644 with their text starting at x 645; "15pts:" ends at x 637 with its
// text at x 638, so swapping in the "15pts:" label moves the rest of the line 7px left.
const label15 = grab(545, 146, 637, 180);
for (const [cap, band] of [[71, [66, 106]], [258, [250, 293]]]) { // [label cap row, the line's clear band]
  const rest = grab(645, band[0], 890, band[1]);
  fill(545, band[0], 890, band[1], PAPER);
  paste(label15, 545, cap);
  paste(rest, 638, band[0]);
}

// ---------- left page: the new ability ----------
fill(40, 442, 494, 606, PAPER);
const cx = 262, centered = (t, y, s, c, bold) => drawText(cx - Math.floor(textWidth(t, s, bold) / 2), y, t, s, c, bold);
centered('ONCE EACH ROUND:', 452, 4, RED, true);
let y = 500;
for (const line of ['Stop any 1 Invasive', 'card from populating,', "whether it's yours", "or anyone else's."]) { // broken by hand (no lone last word)
  if (textWidth(line, 4) > 450) throw new Error('line too wide: ' + line);
  centered(line, y, 4, INK); y += 40;
}
if (y > 700) throw new Error('ability text too long (' + y + ')');

PNG.write(out, img);
console.log('wrote', out);
