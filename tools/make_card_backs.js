// Draws the card backs as simple pixel-art field-journal and folder covers. Run: node tools/make_card_backs.js
// Each back is drawn at 150x210 and scaled x5 to the cards' 750x1050:
//   public/assets/ecology-back.png            Ecology deck: a green cloth field notebook with a fern sprig
//   public/assets/biome-back.png              Biome deck: a blue travel log with a compass rose
//   public/assets/cards/disruption/back.png   Disruption deck: a manila case folder with a red stamp
// (The previous backs are in ../_backup_card_backs.) Bump BACK_V in client.js after redrawing them.
'use strict';
const path = require('path');
const P = require('./png.js');

const W = 150, H = 210, SCALE = 5;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const INK = hex('#1f1b26');

function canvas() {
  const data = new Uint8Array(W * H * 4);
  const c = {
    px(x, y, col) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255; },
    rect(x, y, w, h, col) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.px(x + i, y + j, col); },
    // a rectangle with pixel-rounded corners (r = 0..3)
    round(x, y, w, h, col, r = 2) {
      const cut = [[3, 1, 1], [2, 1, 0], [1, 0, 0], [0, 0, 0]][3 - r] || [0, 0, 0];
      for (let j = 0; j < h; j++) {
        const k = j < 3 ? cut[j] : h - 1 - j < 3 ? cut[h - 1 - j] : 0;
        for (let i = k; i < w - k; i++) c.px(x + i, y + j, col);
      }
    },
    frame(x, y, w, h, col) { c.rect(x, y, w, 1, col); c.rect(x, y + h - 1, w, 1, col); c.rect(x, y, 1, h, col); c.rect(x + w - 1, y, 1, h, col); },
    // dashed stitching around a rectangle
    stitch(x, y, w, h, col) {
      for (let i = 0; i < w; i++) if (i % 4 < 2) { c.px(x + i, y, col); c.px(x + i, y + h - 1, col); }
      for (let j = 0; j < h; j++) if (j % 4 < 2) { c.px(x, y + j, col); c.px(x + w - 1, y + j, col); }
    },
    line(x0, y0, x1, y1, col) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
      for (let k = 0; k <= n; k++) c.px(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), col);
    },
    disc(cx, cy, r, col) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) c.px(cx + x, cy + y, col); },
    ring(cx, cy, r, col) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = x * x + y * y; if (d <= r * r + r * 0.6 && d > (r - 1) * (r - 1) + (r - 1) * 0.6) c.px(cx + x, cy + y, col); } },
    // a sparse speckle of a second colour (cloth / card texture), always the same pattern
    speckle(x, y, w, h, col, every, seed = 1) {
      let s = seed;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { s = (s * 1103515245 + 12345) >>> 0; if ((s >>> 16) % every === 0) c.px(x + i, y + j, col); }
    },
    data,
  };
  c.rect(0, 0, W, H, INK);
  return c;
}

// ---------- a 5x7 pixel font (just the letters the covers need) ----------
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'], K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'], Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '0': ['01110', '10011', '10101', '10101', '10101', '11001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'], '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
};
const textWidth = (s, k) => s.length * 6 * k - k;
function text(c, s, x, y, col, k = 1) {
  for (const ch of s) {
    const g = FONT[ch] || FONT[' '];
    g.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') c.rect(x + i * k, y + j * k, k, k, col); }));
    x += 6 * k;
  }
}
const centred = (c, s, cy, col, k = 1, cx = W / 2) => text(c, s, Math.round(cx - textWidth(s, k) / 2), cy, col, k);

// ---------- a cloth field notebook ----------
// tone: { cover, dark, light, band, bandDark }; draws the cover, stitching, elastic band and an empty label
function notebook(c, t) {
  c.round(4, 4, W - 8, H - 8, t.dark, 3);          // edge
  c.round(5, 5, W - 10, H - 10, t.cover, 3);       // cloth
  c.speckle(6, 6, W - 12, H - 12, t.light, 23, 7);   // weave
  c.speckle(6, 6, W - 12, H - 12, t.dark, 31, 3);
  c.rect(5, 8, 3, H - 16, t.dark);                 // the spine's fold, on the left
  c.rect(8, 8, 1, H - 16, t.light);
  c.stitch(12, 11, W - 23, H - 22, t.light);       // stitched border
  // the elastic band, top to bottom near the right edge
  c.rect(W - 26, 4, 7, H - 8, INK);
  c.rect(W - 25, 4, 5, H - 8, t.band);
  c.rect(W - 25, 4, 1, H - 8, t.bandDark);
  c.rect(W - 21, 4, 1, H - 8, t.bandDark);
}
function label(c, x, y, w, h) {
  c.rect(x - 1, y - 1, w + 2, h + 2, INK);
  c.rect(x, y, w, h, hex('#f2e6c4'));
  c.rect(x, y + h - 2, w, 2, hex('#dccb9d'));       // shade along the bottom
  c.frame(x + 2, y + 2, w - 4, h - 4, hex('#b49a63'));
}

// ---------- the three backs ----------
function ecology() {
  const c = canvas();
  notebook(c, { cover: hex('#3f6b3a'), dark: hex('#2a4a29'), light: hex('#5d8c4f'), band: hex('#9c3b2e'), bandDark: hex('#6e2620') });
  // a fern frond arching over to the right, the journal's emblem, embossed in pale gold
  const gold = hex('#d9c27a'), goldDark = hex('#9a8442');
  const at = t => [44 + 46 * t * t, 120 - 86 * t + 18 * t * t * t]; // the stem, from its base (t = 0) to the tip
  for (let t = 0; t <= 1; t += 0.004) { const [x, y] = at(t); c.px(x, y, gold); c.px(x + 1, y + 1, goldDark); }
  for (let k = 1; k <= 13; k++) { // leaflets in pairs, sweeping towards the tip, shorter as they go
    const t = 0.08 + k * 0.066; if (t > 0.95) break;
    const [x0, y0] = at(t), [x1, y1] = at(t + 0.01), dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
    const len = 20 * (1 - t) + 4;
    for (const side of [-1, 1]) {
      const a = side * 0.95; // the angle off the stem
      const vx = ux * Math.cos(a) - uy * Math.sin(a), vy = ux * Math.sin(a) + uy * Math.cos(a);
      for (let i = 1; i <= len; i++) {
        const bend = (i / len) * (i / len) * 3; // the leaflet curls forward at its end
        const fx = x0 + vx * i + ux * bend, fy = y0 + vy * i + uy * bend;
        c.px(fx, fy, gold); if (i < len * 0.7) c.px(fx + 1, fy + 1, goldDark);
      }
    }
  }
  label(c, 22, 132, 94, 42);
  centred(c, 'ECOLOGY', 139, INK, 2, 69);
  centred(c, 'FIELD JOURNAL', 160, hex('#5a4a2c'), 1, 69);
  return c;
}

function biome() {
  const c = canvas();
  notebook(c, { cover: hex('#2f5d78'), dark: hex('#1f3f54'), light: hex('#4a7d99'), band: hex('#d6ad55'), bandDark: hex('#9a7a34') });
  // a compass rose, embossed in pale gold
  const gold = hex('#e2cd8a'), goldDark = hex('#9a8442'), cx = 66, cy = 74;
  c.ring(cx, cy, 30, goldDark); c.ring(cx, cy, 29, gold); c.ring(cx, cy, 24, goldDark);
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, r0 = k % 4 === 0 ? 24 : 26; c.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * 29, cy + Math.sin(a) * 29, gold); }
  const point = (a, len, wid, col, col2) => { // a four-sided star point: lit half and shaded half
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    for (let t = 0; t <= len; t += 0.5) {
      const w = wid * (1 - t / len);
      for (let s = -w; s <= w; s += 0.5) c.px(cx + ux * t + vx * s, cy + uy * t + vy * s, s < 0 ? col : col2);
    }
  };
  for (let k = 0; k < 4; k++) point(Math.PI / 4 + k * Math.PI / 2, 14, 3, goldDark, hex('#b9a25e'));
  for (let k = 0; k < 4; k++) point(k * Math.PI / 2 - Math.PI / 2, 22, 5, gold, goldDark);
  c.disc(cx, cy, 2, INK);
  text(c, 'N', cx - 2, cy - 42, gold);
  label(c, 22, 132, 94, 42);
  centred(c, 'BIOMES', 139, INK, 2, 69);
  centred(c, 'TRAVEL LOG', 160, hex('#5a4a2c'), 1, 69);
  return c;
}

function disruption() {
  const c = canvas();
  const manila = hex('#d8b36a'), manilaDark = hex('#a98443'), manilaLight = hex('#ecd093'), back = hex('#b8914f');
  // the folder's back flap, with its tab sticking up on the left, then the front cover
  c.round(6, 6, 56, 14, back, 2); c.rect(6, 14, W - 12, 12, back);
  c.frame(6, 6, 56, 9, manilaDark);
  text(c, 'FILE', 12, 9, hex('#6d5328'));
  c.round(4, 18, W - 8, H - 22, manilaDark, 2);
  c.round(5, 19, W - 10, H - 24, manila, 2);
  c.speckle(6, 20, W - 12, H - 26, manilaLight, 29, 5);
  c.speckle(6, 20, W - 12, H - 26, manilaDark, 41, 9);
  c.rect(5, 19, W - 10, 1, manilaLight);
  // a paper clip over the top edge
  const steel = hex('#c9ccd6'), steelDark = hex('#7d8190');
  const clip = (x, y) => { c.frame(x, y, 9, 26, steelDark); c.frame(x + 1, y + 1, 7, 24, steel); c.frame(x + 3, y + 5, 3, 16, steel); };
  clip(110, 10);
  // typed lines on a label, as on an incident report
  label(c, 20, 40, 110, 30);
  text(c, 'CASE NO.', 26, 47, hex('#5a4a2c'));
  text(c, '2026', 80, 47, INK);
  c.rect(26, 59, 98, 1, hex('#b49a63'));
  // the stamp: a red box, inked unevenly
  const red = hex('#b8322b'), redPale = hex('#d77064');
  const sx = 9, sy = 96, sw = W - 18, sh = 32;
  c.frame(sx, sy, sw, sh, red); c.frame(sx + 1, sy + 1, sw - 2, sh - 2, red); c.frame(sx + 3, sy + 3, sw - 6, sh - 6, red);
  centred(c, 'DISRUPTION', sy + 9, red, 2, W / 2);
  c.speckle(sx, sy, sw, sh, manila, 17, 11); // gaps where the ink didn't take
  c.speckle(sx + 2, sy + 2, sw - 4, sh - 4, redPale, 37, 4);
  // a warning triangle under the stamp
  const tx = W / 2, ty = 146;
  for (let j = 0; j < 30; j++) { const half = Math.round(j * 0.62); c.rect(tx - half, ty + j, half * 2 + 1, 1, j < 3 ? red : j > 27 ? red : hex('#3a2a1c')); c.px(tx - half, ty + j, red); c.px(tx + half, ty + j, red); }
  c.rect(tx - 1, ty + 9, 3, 11, hex('#e9c46a')); c.rect(tx - 1, ty + 22, 3, 3, hex('#e9c46a'));
  return c;
}

const OUT = path.join(__dirname, '..', 'public', 'assets');
for (const [file, draw] of [['ecology-back.png', ecology], ['biome-back.png', biome], [path.join('cards', 'disruption', 'back.png'), disruption]]) {
  const c = draw();
  P.write(path.join(OUT, file), P.scale({ w: W, h: H, data: c.data }, SCALE));
  console.log('wrote', file);
}
