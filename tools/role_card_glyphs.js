// Letters cut out of the objectives text already printed on the role cards (right-hand page), so new objective
// wording is set in exactly the cards' own pixel lettering. Used by tools/update_role_cards.js.
//
// How: each card's right-page text lines are found (rows with ink), each line is split into words (wide gaps) and
// each word into letters (blank columns). Where a word's letter count matches its known text, every letter is kept
// as a coverage mask (how far each pixel is from the paper towards the ink), with its position against the baseline.
// The same letter is often found many times; the first clean copy is used. Red ("15pts:") and black text are both
// read, and any letter can be drawn back in either colour.
'use strict';
const path = require('path');
const PNG = require('./png.js');

const PAPER = [247, 249, 240];
const ROLES_DIR = path.join(__dirname, '..', 'public', 'assets', 'cards', 'roles');
// What each card's objectives say, line by line (as printed; spaces mark word gaps)
const TEXT = {
  LandDeveloper: ['5pts: For each map', 'objective met.', '15pts: If there is no', 'population in at least', 'three regions.', '10pts: If you won the Most', 'total Tricks.'],
  Tourist: ['5pts: For each map', 'objective met.', '10pts: If all map objectives', 'met.', '20pts: If you won tricks', 'from only your map', 'objective regions.'],
  Fisherman: ['5pts: For each map', 'objective met.', '10pts: If there are at least', '25 population in your', 'objective regions.', '15pts: Win the most tricks', 'from Water regions.'],
  Hunter: ['5pts: For each map', 'objective met.', '15pts: If there are at least', '25 population in your', 'objective regions.', '15pts: Win the most tricks', 'from Land Regions'],
  Researcher: ['5pts: For each map', 'objective met.', '15pts: Have 6 unique', 'taxonomies in your scoring', 'pile.', '10pts: Win the least Tricks.'],
  Conservationist: ['15pts: For each map', 'objective met.', '15pts: If the total', 'population majority is', 'Native.', '15pts: If you never trigger', 'an Invasive crisis.'],
};
// the right-page text block (below the OBJECTIVES! heading, above the map)
const BOX = { x0: 538, x1: 1012, y0: 66, y1: 334 };

const inkOf = (d, i) => { // 0 (paper) .. 1 (full ink), and whether the ink is red
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const red = r > 150 && g < 140 && b < 140 && r - g > 60;
  const full = red ? [237, 28, 36] : [0, 0, 0];
  const dist = Math.hypot(r - PAPER[0], g - PAPER[1], b - PAPER[2]), max = Math.hypot(full[0] - PAPER[0], full[1] - PAPER[1], full[2] - PAPER[2]);
  return { a: Math.max(0, Math.min(1, dist / max)), red };
};

function readCard(file) {
  const img = PNG.read(file), { w } = img, d = img.data;
  const A = (x, y) => inkOf(d, (y * w + x) * 4);
  const isInk = (x, y) => A(x, y).a > 0.35;
  // text lines: runs of rows that have ink
  const lines = [];
  let start = -1;
  for (let y = BOX.y0; y <= BOX.y1; y++) {
    let any = false; for (let x = BOX.x0; x <= BOX.x1 && !any; x++) if (isInk(x, y)) any = true;
    if (any && start < 0) start = y;
    if ((!any || y === BOX.y1) && start >= 0) { if (y - start > 6) lines.push([start, y - 1]); start = -1; }
  }
  return { img, A, isInk, lines };
}

// ink segments (columns with ink, separated by blank columns) within [y0, y1]
function segmentsOf(card, y0, y1) {
  const segs = []; let s = -1;
  for (let x = BOX.x0; x <= BOX.x1 + 1; x++) {
    let any = false; if (x <= BOX.x1) for (let y = y0; y <= y1 && !any; y++) if (card.isInk(x, y)) any = true;
    if (any && s < 0) s = x;
    if (!any && s >= 0) { segs.push([s, x - 1]); s = -1; }
  }
  return segs;
}

// Build the glyph library from every card. Returns { glyphs: {ch: glyph}, metrics }
// Pass 1 keeps letters from words whose letters all stand apart; pass 2 also reads words where some letters touch
// (r, t and f reach into the next letter: "re", "ta", "fro"), matching the ink pieces to letters by their widths,
// and keeps only the pieces that hold a single letter.
function buildLibrary() {
  const glyphs = {}, gaps = [], spaces = [], pitches = [];
  const cards = [];
  for (const [role, text] of Object.entries(TEXT)) {
    const card = readCard(path.join(ROLES_DIR, role + '.png'));
    if (card.lines.length < text.length) continue;
    const lines = card.lines.slice(0, text.length).map(([y0, y1], li) => {
      const segs = segmentsOf(card, y0, y1);
      const words = [[segs[0]]];
      for (let k = 1; k < segs.length; k++) {
        const gap = segs[k][0] - segs[k - 1][1] - 1;
        if (gap >= 7) { words.push([segs[k]]); spaces.push(gap); } else { words[words.length - 1].push(segs[k]); gaps.push(gap); }
      }
      const bottoms = [];
      for (const word of words) for (const [a, b] of word) { let by = y0; for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) if (card.isInk(x, y)) by = Math.max(by, y); bottoms.push(by); }
      const counts = {}; for (const v of bottoms) counts[v] = (counts[v] || 0) + 1;
      const base = +Object.entries(counts).sort((p, q) => q[1] - p[1])[0][0];
      return { y0, y1, words, base, want: text[li].split(' ') };
    });
    cards.push({ role, card, lines });
    for (let k = 1; k < card.lines.length; k++) pitches.push(card.lines[k][0] - card.lines[k - 1][0]);
  }
  const keep = (role, card, ln, [a, b], ch) => {
    if (glyphs[ch]) return;
    let top = ln.y1, bot = ln.y0;
    for (let y = ln.y0; y <= ln.y1; y++) for (let x = a; x <= b; x++) if (card.A(x, y).a > 0.05) { top = Math.min(top, y); bot = Math.max(bot, y); }
    const gw = b - a + 1, gh = bot - top + 1, mask = new Float32Array(gw * gh);
    for (let y = top; y <= bot; y++) for (let x = a; x <= b; x++) mask[(y - top) * gw + (x - a)] = card.A(x, y).a;
    glyphs[ch] = { w: gw, h: gh, up: ln.base - top, mask, from: role };
  };
  // pass 1: clean words
  for (const { role, card, lines } of cards) for (const ln of lines) {
    if (ln.words.length !== ln.want.length) continue;
    ln.words.forEach((word, wi) => { const chars = [...ln.want[wi]]; if (word.length === chars.length) word.forEach((seg, ci) => keep(role, card, ln, seg, chars[ci])); });
  }
  // pass 2: words with touching letters, split by width (dynamic programming over pieces x letters)
  const gapW = 4, guess = ch => glyphs[ch] ? glyphs[ch].w : 15;
  for (const { role, card, lines } of cards) for (const ln of lines) {
    if (ln.words.length !== ln.want.length) continue;
    ln.words.forEach((word, wi) => {
      const chars = [...ln.want[wi]], S = word.length, C = chars.length;
      if (S >= C) return;
      const best = Array.from({ length: S + 1 }, () => new Array(C + 1).fill(Infinity)), from = Array.from({ length: S + 1 }, () => new Array(C + 1).fill(0));
      best[0][0] = 0;
      for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) if (best[s][c] < Infinity) for (let k = 1; k <= 3 && c + k <= C; k++) {
        const exp = chars.slice(c, c + k).reduce((t, ch) => t + guess(ch), 0) + (k - 1) * (gapW - 4); // touching: no gap
        const cost = best[s][c] + Math.abs((word[s][1] - word[s][0] + 1) - exp);
        if (cost < best[s + 1][c + k]) { best[s + 1][c + k] = cost; from[s + 1][c + k] = k; }
      }
      if (best[S][C] === Infinity) return;
      for (let s = S, c = C; s > 0; s--) { const k = from[s][c]; if (k === 1) keep(role, card, ln, word[s - 1], chars[c - 1]); c -= k; }
    });
  }
  const median = a => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
  // letter gaps on the cards alternate 3 and 4 px (the lettering was scaled), so the gap is kept as their average
  const letterGaps = gaps.filter(g => g >= 2 && g <= 6), avg = letterGaps.reduce((t, g) => t + g, 0) / letterGaps.length;
  return { glyphs, metrics: { gap: avg, space: median(spaces), label: 15, pitch: median(pitches) } };
}

// Width of a line of text in the library's lettering
function measure(lib, text) {
  let w = 0;
  for (const ch of text) w += ch === ' ' ? lib.metrics.space : (lib.glyphs[ch] ? lib.glyphs[ch].w + lib.metrics.gap : 0);
  return Math.round(w - lib.metrics.gap);
}
// Draw text with its left edge at x and its baseline at y, in colour rgb, onto a png.js image. Returns where the
// next letter would start (x after the last letter plus a letter gap).
function draw(img, lib, text, x, baseY, rgb) {
  const d = img.data, W = img.w;
  for (const ch of text) {
    if (ch === ' ') { x += lib.metrics.space - lib.metrics.gap; continue; }
    const g = lib.glyphs[ch];
    if (!g) throw new Error('no letter for ' + JSON.stringify(ch) + ' (it does not appear in any card\'s objectives text)');
    const px = Math.round(x);
    for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) {
      const a = g.mask[yy * g.w + xx]; if (a <= 0) continue;
      const i = ((baseY - g.up + yy) * W + px + xx) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] * (1 - a) + rgb[c] * a);
    }
    x += g.w + lib.metrics.gap;
  }
  return x;
}
// Clear printed text from a box, keeping the paper's own texture: every inked pixel (and its neighbours) is filled
// from the nearest clean paper above and below it in the same column.
function erase(img, x0, y0, x1, y1) {
  const W = img.w, d = img.data, w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inkOf(d, (y * W + x) * 4).a > 0.04)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy - y0, xx = x + dx - x0; if (yy >= 0 && yy < h && xx >= 0 && xx < w) m[yy * w + xx] = 1; }
  const at = (x, y) => (y * W + x) * 4;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (!m[(y - y0) * w + (x - x0)]) continue;
    let up = y, dn = y;
    while (up >= y0 && m[(up - y0) * w + (x - x0)]) up--;
    while (dn <= y1 && m[(dn - y0) * w + (x - x0)]) dn++;
    const a = up >= y0 ? at(x, up) : null, b = dn <= y1 ? at(x, dn) : null, i = at(x, y);
    for (let c = 0; c < 3; c++) d[i + c] = a && b ? Math.round((d[a + c] + d[b + c]) / 2) : a ? d[a + c] : b ? d[b + c] : PAPER[c];
  }
}

// A text line's baseline: the most common bottom row of its letters (descenders are the exception)
function baselineOf(card, y0, y1) {
  const counts = {};
  for (const [a, b] of segmentsOf(card, y0, y1)) {
    let by = y0; for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) if (card.isInk(x, y)) by = Math.max(by, y);
    counts[by] = (counts[by] || 0) + 1;
  }
  return +Object.entries(counts).sort((p, q) => q[1] - p[1])[0][0];
}

module.exports = { buildLibrary, measure, draw, erase, readCard, baselineOf, BOX, TEXT, PAPER };

if (require.main === module) { // report what the library holds
  const lib = buildLibrary();
  console.log('letters:', Object.keys(lib.glyphs).sort().join(''));
  console.log('metrics:', lib.metrics);
}
