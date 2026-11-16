// Remasters the landing backdrop art for scenery.js. Run: node tools/remaster_landing.js [originals folder]
//
// Reads the original paintings (default: ../_backup_before_landing_remaster, next to WebGame) and writes:
//   public/assets/landing-<scene>.png          the still painting (reduced motion), loose sky pixels cleaned up
//   public/assets/landing/<scene>-plate.png    the animated scene's base: cleaned, and with the alligator taken out
//   public/assets/landing/sky-<scene>.png      the sky on its own (sky behind the tree islands filled in), made to
//                                              loop every skyLoop columns (printed: copy it into SCENES), so the
//                                              clouds can drift left for ever behind the islands; its bottom half is a
//                                              mask: white = sky, black = a tree island in front
//   public/assets/landing/gator-<scene>.png    the alligator sprite (frame 0) and its wake ripples (frame 1)
// and prints open-water spots where the alligator can surface (copy them into SCENES in scenery.js).
'use strict';
const path = require('path');
const P = require('./png.js');

const ORIG = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '_backup_before_landing_remaster'));
const OUT = path.join(__dirname, '..', 'public', 'assets');

const SCENES = {
  wide: {
    w: 320, h: 180,
    horizon: 93,   // the grass line: loose pixels are cleaned above it
    skyBottom: 82, // rows above this are sky (they drift); below is the distant treeline and the grass
    // flat rectangular patches in the clouds to redraw as billows: [x0, y0, x1, y1, radius, passes]
    // single pixels to correct by hand: [x, y, colour] ('auto' = the colour most of its neighbours have)
    pixelFix: [[188, 93, 'auto'], [226, 79, '#fa9a66'], [227, 82, '#fa9a66'], // a speck in the horizon grass; yellow strays off the lone tree
      [78, 77, 'auto'], [70, 78, 'auto'], [80, 84, 'auto'], [82, 87, 'auto'], [85, 87, 'auto']], // grey specks in the haze under the clouds
    // a flat square of shade in the middle of the central cloud: let the sky show through it instead
    recolor: [[184, 10, 214, 43, '#9c4c58', '#a95767'],
      // a little vertical block of shade in the lit cloud top (under the title's G): plain lit cloud instead
      [118, 44, 122, 48, '#d05f64', '#fe854f'], [118, 44, 122, 48, '#d56455', '#fe854f'], [118, 44, 122, 51, '#ee7450', '#fe854f']],
    // single sky pixels to correct (as pixelFix, but in the sky layer, so also behind the islands): two dark pixels
    // hanging below the cloud base into the haze
    skyFix: [[77, 76, 'auto'], [88, 76, 'auto']],
    cloudFix: [[184, 10, 216, 44, 2, 1], [140, 42, 192, 70, 4, 4], [94, 16, 118, 50, 3, 3], [184, 10, 218, 44, 3, 2], [228, 36, 268, 56, 2, 2]],
    // far: the smaller, sunlit version for spots further up the water (the river in the middle of the scene)
    gator: { box: [45, 154, 124, 176], mode: 'colour', far: { scale: 0.8, sun: '#f7a070' } },
    water: { y0: 128, still: [] },
  },
  tall: {
    w: 180, h: 320,
    horizon: 160, skyBottom: 155,
    cloudFix: [[106, 34, 134, 82, 3, 3], [128, 126, 165, 154, 2, 2]], // the streak down the big cumulus; crumbs by the pine
    gator: { box: [84, 254, 179, 304], mode: 'outline', thr: 22, far: { scale: 0.88, sun: '#f0a07a' } },
    water: { y0: 200, still: [[116, 146, 180, 178], [0, 198, 66, 280]] }, // bushes, reeds
  },
};

const lumOf = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
const dist = (d, i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);

// Connected pieces of a mask (4-neighbour); returns a label per pixel and each piece's size.
function components(m, W, H) {
  const lab = new Int32Array(W * H).fill(-1), sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const k = sizes.length, st = [s]; let n = 0; lab[s] = k;
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X; if (m[j] && lab[j] < 0) { lab[j] = k; st.push(j); }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

// Tree islands and the distant treeline above the horizon: anything that isn't sky-coloured (sky is clearly
// reddish, or bright like the cream cloud tops), in pieces bigger than a few pixels, with pinholes filled.
function foliageMask(img, rows) {
  const { w, h, data: d } = img, m = new Uint8Array(w * h);
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, l = lumOf(d, i);
    const sky = l > 170 || (d[i] - d[i + 1] > 28 && l > 66);
    if (!sky) m[y * w + x] = 1;
  }
  const { lab, sizes } = components(m, w, h);
  for (let i = 0; i < m.length; i++) if (m[i] && sizes[lab[i]] <= 3) m[i] = 0;
  // grow into the islands' lit rims and dark crumbs next to them (olive or dark, never the bright cloud tops)
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x; if (m[p] || !(m[p - 1] || m[p + 1] || m[p - w] || m[p + w])) continue;
      const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2], l = lumOf(d, i);
      if (l < 150 && ((g >= r * 0.7 && g > b + 15) || l < 70)) add.push(p);
    }
    for (const p of add) m[p] = 1;
  }
  // stray leaf crumbs a few pixels off an island (brown or dark): they belong to the island, not the sky
  const near = new Uint8Array(w * h), R = 6;
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) if (m[y * w + x])
    for (let yy = Math.max(0, y - R); yy <= Math.min(rows - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) near[yy * w + xx] = 1;
  for (let p = 0; p < w * rows; p++) {
    if (m[p] || !near[p]) continue;
    const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2], l = lumOf(d, i);
    if (l < 70 || (g > b + 10 && g >= r * 0.5 && l < 130)) m[p] = 1;
  }
  const holes = components(m.map((v, i) => (!v && ((i / w) | 0) < rows) ? 1 : 0), w, h);
  for (let i = 0; i < m.length; i++) if (holes.lab[i] >= 0 && holes.sizes[holes.lab[i]] <= 4) m[i] = 1;
  return m;
}

// Loose pixels: a pixel with no same-coloured neighbour, in a flat patch it doesn't match, takes the patch's colour.
// Only above the horizon and outside the tree canopies (their speckle is texture). Returns the fixes made.
function cleanLoose(img, rows, keep) {
  const { w, data: d } = img, fixes = [];
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < rows; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x; if (keep[p]) continue;
    const i = p * 4, n4 = [i - 4, i + 4, i - w * 4, i + w * 4];
    if (n4.some(j => dist(d, i, j) < 12)) continue;
    const n8 = [...n4, i - w * 4 - 4, i - w * 4 + 4, i + w * 4 - 4, i + w * 4 + 4];
    let best = null, bn = 0;
    for (const a of n8) { const c = n8.filter(b => dist(d, a, b) < 12).length; if (c > bn) { bn = c; best = a; } }
    if (bn < 5) continue;
    fixes.push([p, d[best], d[best + 1], d[best + 2]]);
    d[i] = d[best]; d[i + 1] = d[best + 1]; d[i + 2] = d[best + 2];
  }
  return fixes;
}

// Fill masked pixels from the same row, continuing the pattern on either side (water and sky are made of
// horizontal streaks): a gap of length L copies the L pixels before it, or after it, then further out.
// ok(p) says which pixels may be copied (e.g. only open water, so lily pads and reeds aren't cloned).
function inpaintRows(img, mask, rows, ok = () => true) {
  const { w, data: d } = img;
  const good = sx => sx >= 0 && sx < w;
  for (let y = 0; y < rows; y++) {
    const fine = sx => good(sx) && !mask[y * w + sx] && ok(y * w + sx);
    for (let x = 0; x < w;) {
      if (!mask[y * w + x]) { x++; continue; }
      let e = x; while (e < w && mask[y * w + e]) e++;
      const L = e - x;
      for (let k = 0; k < L; k++) {
        let sx = -1;
        for (let rep = 1; rep <= 6 && sx < 0; rep++) for (const c of [x - rep * L + k, e + (rep - 1) * L + k]) if (sx < 0 && fine(c)) sx = c;
        for (let r = 1; r < w && sx < 0; r++) for (const c of [x - r, e - 1 + r]) if (sx < 0 && fine(c)) sx = c; // nearest usable pixel
        if (sx < 0) sx = x > 0 ? x - 1 : Math.min(e, w - 1);
        const s = (y * w + sx) * 4, o = (y * w + x + k) * 4;
        d[o] = d[s]; d[o + 1] = d[s + 1]; d[o + 2] = d[s + 2];
      }
      x = e;
    }
  }
}

function fixPixels(img, list) {
  const { w, data: d } = img;
  for (const [x, y, col] of list) {
    const i = (y * w + x) * 4;
    let rgb;
    if (col === 'auto') { // the most common colour among its eight neighbours
      const count = new Map();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const j = ((y + dy) * w + x + dx) * 4, k = d[j] + ',' + d[j + 1] + ',' + d[j + 2]; count.set(k, (count.get(k) || 0) + 1); }
      rgb = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    } else rgb = [1, 3, 5].map(k => parseInt(col.slice(k, k + 2), 16));
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
  }
}

// Majority filter inside a box: each pixel takes the most common colour within radius r (ties keep its own), for
// `passes` rounds. Square corners round off and streaks thinner than about r vanish, so flat rectangular
// patches become soft billows, using only colours already in the painting.
function majority(img, x0, y0, x1, y1, r = 2, passes = 2) {
  const { w, h, data: d } = img;
  for (let pass = 0; pass < passes; pass++) {
    const src = Uint8Array.from(d);
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const count = new Map(); let best = null, bn = 0;
      const own = ((y * w + x) * 4), ownKey = (src[own] << 16) | (src[own + 1] << 8) | src[own + 2];
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r + r) continue;
        const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const s = (Y * w + X) * 4, key = (src[s] << 16) | (src[s + 1] << 8) | src[s + 2];
        const n = (count.get(key) || 0) + 1; count.set(key, n);
        if (n > bn || (n === bn && key === ownKey)) { bn = n; best = key; }
      }
      if (best !== ownKey && bn > (count.get(ownKey) || 0)) { d[own] = best >> 16; d[own + 1] = (best >> 8) & 255; d[own + 2] = best & 255; }
    }
  }
  // then little islands of one colour left inside the box (blobs and crumbs) melt into what surrounds them
  const key = p => (d[p * 4] << 16) | (d[p * 4 + 1] << 8) | d[p * 4 + 2];
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && x >= 0 && y >= 0 && x < w && y < h;
  const seen = new Uint8Array(w * h);
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
    const p0 = y * w + x; if (seen[p0]) continue;
    const k = key(p0), piece = [p0], border = new Map(); seen[p0] = 1;
    for (let q = 0; q < piece.length; q++) {
      const p = piece[q], px = p % w, py = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const n = Y * w + X, kn = key(n);
        if (kn === k) { if (!seen[n] && inBox(X, Y)) { seen[n] = 1; piece.push(n); } }
        else border.set(kn, (border.get(kn) || 0) + 1);
      }
    }
    if (piece.length >= 30 || !border.size) continue;
    const to = [...border.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const p of piece) { d[p * 4] = to >> 16; d[p * 4 + 1] = (to >> 8) & 255; d[p * 4 + 2] = to & 255; }
  }
}

// Make the sky loop on itself, so the clouds can drift left for ever: its right end overlaps its left start by OV
// columns, joined along the path down the overlap where the two differ least (so the join hides in similar
// colours). The result is W - OV columns wide and wraps around seamlessly; the first OV columns are the join.
function loopSky(sky, OV) {
  const { w: W, h: H, data: d } = sky, at = (x, y) => (y * W + x) * 4;
  const diff = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
  // E[y][k]: how different the right end and the left start are at overlap column k
  const E = Array.from({ length: H }, (_, y) => Array.from({ length: OV }, (_, k) => diff(at(W - OV + k, y), at(k, y))));
  const acc = E.map(r => r.slice()), from = E.map(r => r.map(() => 0));
  for (let y = 1; y < H; y++) for (let k = 0; k < OV; k++) {
    let best = acc[y - 1][k], bk = k;
    for (const kk of [k - 1, k + 1]) if (kk >= 0 && kk < OV && acc[y - 1][kk] < best) { best = acc[y - 1][kk]; bk = kk; }
    acc[y][k] += best; from[y][k] = bk;
  }
  let k = 0; for (let j = 1; j < OV; j++) if (acc[H - 1][j] < acc[H - 1][k]) k = j;
  const cut = new Array(H); for (let y = H - 1; y >= 0; y--) { cut[y] = k; k = from[y][k]; }
  const out = { w: W - OV, h: H, data: new Uint8Array((W - OV) * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W - OV; x++) {
    const src = x < OV && x < cut[y] ? at(W - OV + x, y) : at(x, y); // left of the cut: the right end, coming round
    out.data.set([d[src], d[src + 1], d[src + 2], 255], (y * out.w + x) * 4);
  }
  return out;
}

// The alligator further away, out in the sunlit river: scaled down (each pixel takes the colour covering most of
// the source pixels under it, the eyes always survive, and the black outline is redrawn round the new silhouette),
// with its lit pixels warmed towards the sunset on the water and a warm rim of light along the top of its back.
// spr: frame 0 the animal, frame 1 its wake (both GW wide). far: { scale, sun: '#rrggbb' }.
function farSprite(spr, far) {
  const GW = spr.w / 2, H = spr.h, k = far.scale, w = Math.round(GW * k), h = Math.round(H * k);
  const sun = [1, 3, 5].map(i => parseInt(far.sun.slice(i, i + 2), 16));
  const out = { w: w * 2, h, data: new Uint8Array(w * 2 * h * 4) };
  const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;
  for (let layer = 0; layer < 2; layer++) {
    const opaque = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / k), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / k)), sy0 = Math.floor(y / k), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / k));
      const count = new Map(); let solid = 0, total = 0, eye = null;
      for (let sy = sy0; sy < Math.min(H, sy1); sy++) for (let sx = sx0; sx < Math.min(GW, sx1); sx++) {
        total++; const i = (sy * spr.w + layer * GW + sx) * 4; if (spr.data[i + 3] < 128) continue;
        solid++; const r = spr.data[i], g = spr.data[i + 1], b = spr.data[i + 2];
        if (layer === 0 && r > 150 && g > 90 && b < 60) eye = [r, g, b];
        const key = r + ',' + g + ',' + b; count.set(key, (count.get(key) || 0) + 1);
      }
      if (!solid || solid * 2 < total) continue;
      const c = eye || [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
      out.data.set([c[0], c[1], c[2], 255], (y * out.w + layer * w + x) * 4); opaque[y * w + x] = 1;
    }
    if (layer) continue;
    // the outline: silhouette edge pixels go dark again (the shrink can wear the original outline away)
    const at = (x, y) => (y * out.w + x) * 4, inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && opaque[y * w + x];
    const ink = [20, 18, 14];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!opaque[y * w + x]) continue;
      const i = at(x, y), d = out.data, isEye = d[i] > 150 && d[i + 1] > 90 && d[i + 2] < 60;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge && !isEye) { d.set(ink, i); continue; }
      if (isEye || lum(d[i], d[i + 1], d[i + 2]) < 30) continue;
      // sunlight: the lighter a pixel, the more of the sunset's warmth it takes
      const l = Math.min(1, lum(d[i], d[i + 1], d[i + 2]) / 140), t = 0.06 + 0.26 * l;
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] + (sun[c] - d[i + c]) * t);
    }
    // a rim of warm light along the top of its back: the first pixel inside the outline, in each column
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      if (!opaque[y * w + x]) continue;
      if (inside(x, y + 1)) {
        const i = at(x, y + 1), d = out.data;
        if (!(d[i] > 150 && d[i + 1] > 90 && d[i + 2] < 60) && lum(d[i], d[i + 1], d[i + 2]) >= 30) for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] + (sun[c] - d[i + c]) * 0.6);
      }
      break;
    }
  }
  return out;
}

function gatorMask(img, G) {
  const [x0, y0, x1, y1] = G.box, W = x1 - x0 + 1, H = y1 - y0 + 1, { w, data: d } = img;
  const at = (x, y) => ((y0 + y) * w + x0 + x) * 4;
  let m = new Uint8Array(W * H);
  if (G.mode === 'outline') { // a closed dark outline: everything it encloses
    const outl = new Uint8Array(W * H), outside = new Uint8Array(W * H), st = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lumOf(d, at(x, y)) < G.thr) outl[y * W + x] = 1;
    for (let x = 0; x < W; x++) st.push([x, 0], [x, H - 1]);
    for (let y = 0; y < H; y++) st.push([0, y], [W - 1, y]);
    while (st.length) {
      const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x; if (outside[i] || outl[i]) continue;
      outside[i] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (let i = 0; i < W * H; i++) m[i] = outside[i] ? 0 : 1;
  } else { // olive and khaki hide, or its black outline; then each row filled in between
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = at(x, y); if (d[i + 1] > d[i + 2] + 6 || lumOf(d, i) < 24) m[y * W + x] = 1;
    }
  }
  const { lab, sizes } = components(m, W, H), big = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < m.length; i++) m[i] = lab[i] === big ? 1 : 0;
  if (G.mode !== 'outline') for (let y = 0; y < H; y++) {
    let a = -1, b = -1; for (let x = 0; x < W; x++) if (m[y * W + x]) { if (a < 0) a = x; b = x; }
    if (a >= 0) for (let x = a; x <= b; x++) m[y * W + x] = 1;
  }
  // its wake: the pale ripple lines drawn around it in the water
  const wake = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y); if (!m[y * W + x] && d[i + 2] >= d[i] && d[i + 2] > 90 && lumOf(d, i) > 70) wake[y * W + x] = 1;
  }
  return { m, wake, W, H };
}

// the same water test scenery.js uses for its ripples
function waterMask(img, S) {
  const { w, h, data: d } = img, m = new Uint8Array(w * h);
  for (let y = S.horizon + 1; y < h; y++) for (let x = 0; x < w; x++) {
    if (S.water.still.some(([a, b, c, e]) => x >= a && x <= c && y >= b && y <= e)) continue;
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const isGrass = g > b + 18 && r > b && g >= r * 0.62, isFlower = r > 150 && b > 150 && g < 140 && b > r;
    if (!isGrass && !isFlower && (b >= g * 0.92 || r > g * 1.3)) m[y * w + x] = 1;
  }
  return m;
}

for (const [name, S] of Object.entries(SCENES)) {
  const plate = P.read(path.join(ORIG, 'landing', name + '-plate.png'));
  const still = P.read(path.join(ORIG, 'landing-' + name + '.png'));
  for (const img of [plate, still]) fixPixels(img, S.pixelFix || []);
  const stillOrig = Uint8Array.from(still.data);
  const N = S.w * S.h;

  // 1. loose pixels on the skyline and in the sky
  const fol = foliageMask(plate, S.horizon);
  const fixes = cleanLoose(plate, S.horizon, fol);
  let stillFixed = 0;
  for (const [p, r, g, b] of fixes) { // the still painting has the birds in it too: only fix where it matches the plate
    const i = p * 4;
    if (Math.abs(stillOrig[i] - r) + Math.abs(stillOrig[i + 1] - g) + Math.abs(stillOrig[i + 2] - b) > 120) continue;
    still.data[i] = r; still.data[i + 1] = g; still.data[i + 2] = b; stillFixed++;
  }
  // a second look at the still painting itself (around the birds the plate can't vouch for)
  const stillFol = foliageMask(still, S.horizon);
  cleanLoose(still, S.horizon, stillFol);

  // 2. the alligator: cut out as a sprite with its wake, and the water underneath filled in
  const G = gatorMask(plate, S.gator), [gx, gy] = S.gator.box;
  const spr = { w: G.W * 2, h: G.H, data: new Uint8Array(G.W * 2 * G.H * 4) };
  const hole = new Uint8Array(N);
  for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) {
    const k = y * G.W + x, s = ((gy + y) * S.w + gx + x) * 4;
    for (const [layer, on] of [[0, G.m[k]], [1, G.wake[k]]]) {
      if (!on) continue;
      const o = (y * spr.w + layer * G.W + x) * 4;
      spr.data.set(plate.data.subarray(s, s + 3), o); spr.data[o + 3] = 255;
      hole[(gy + y) * S.w + gx + x] = 1;
    }
  }
  // grow the hole by a pixel so no outline crumbs are left in the water
  const grown = Uint8Array.from(hole);
  for (let y = 1; y < S.h - 1; y++) for (let x = 1; x < S.w - 1; x++) {
    const p = y * S.w + x;
    if (!hole[p] && (hole[p - 1] || hole[p + 1] || hole[p - S.w] || hole[p + S.w]) && lumOf(plate.data, p * 4) < 24) grown[p] = 1;
  }
  const openWater = waterMask(plate, S);
  inpaintRows(plate, grown, S.h, p => openWater[p] && lumOf(plate.data, p * 4) >= 24);

  // 3. the sky layer: the plate above skyBottom, with the islands' sky filled in from the same rows.
  //    Its alpha marks what moves: 255 = sky, 0 = the islands in front (drawn from the plate, standing still).
  const sky = { w: S.w, h: S.skyBottom, data: Uint8Array.from(plate.data.subarray(0, S.w * S.skyBottom * 4)) };
  // nothing tree-coloured may ride along with the clouds: dark or olive crumbs left in the sky are filled in too
  const crumbs = new Uint8Array(N);
  for (let p = 0; p < S.w * S.skyBottom; p++) {
    if (fol[p]) { crumbs[p] = 1; continue; }
    const i = p * 4, r = plate.data[i], g = plate.data[i + 1], b = plate.data[i + 2], l = lumOf(plate.data, i);
    if (l < 60 || (g > b + 10 && g >= r * 0.75 && l < 150)) crumbs[p] = 1;
  }
  inpaintRows(sky, crumbs, S.skyBottom, p => !crumbs[p]);
  //    Redraw the clouds' flat, rectangular patches (generation artifacts) as rounded billows, then put the
  //    redrawn sky back into the plate and the still painting too (but never over the still painting's birds).
  fixPixels(sky, S.skyFix || []);
  for (const [x0, y0, x1, y1, from, to] of S.recolor || []) { // [box, colour, new colour]
    const hx = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)), [a, b] = [hx(from), hx(to)];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * S.w + x) * 4; if (sky.data[i] === a[0] && sky.data[i + 1] === a[1] && sky.data[i + 2] === a[2]) sky.data.set(b, i); }
  }
  for (const box of S.cloudFix || []) majority(sky, ...box);
  // and no pixel may stand alone in the moving sky (one that matches none of its four neighbours twinkles as the
  // clouds carry it along, like the grey specks under the clouds): it takes its neighbours' most common colour
  for (let pass = 0; pass < 2; pass++) {
    const src = Uint8Array.from(sky.data), list = [];
    const df = (i, j) => Math.abs(src[i] - src[j]) + Math.abs(src[i + 1] - src[j + 1]) + Math.abs(src[i + 2] - src[j + 2]);
    for (let y = 1; y < S.skyBottom - 1; y++) for (let x = 1; x < S.w - 1; x++) {
      const i = (y * S.w + x) * 4; // (the sky filled in behind the islands too: it drifts into view)
      if ([i - 4, i + 4, i - S.w * 4, i + S.w * 4].some(j => df(i, j) <= 40)) continue;
      list.push([x, y, 'auto']);
    }
    fixPixels(sky, list);
  }
  for (let p = 0; p < S.w * S.skyBottom; p++) {
    if (fol[p]) continue;
    const i = p * 4, same = Math.abs(still.data[i] - plate.data[i]) + Math.abs(still.data[i + 1] - plate.data[i + 1]) + Math.abs(still.data[i + 2] - plate.data[i + 2]) < 30;
    for (let k = 0; k < 3; k++) { if (same) still.data[i + k] = sky.data[i + k]; plate.data[i + k] = sky.data[i + k]; }
  }
  //    Then made to loop; the image stays a screen wide (the loop carries on into the last columns). Below it, a
  //    mask of what moves (white = sky, black = a tree island in front, drawn from the plate). (Not in the alpha:
  //    browsers lose the colour of fully transparent pixels, and the sky behind the islands comes into view.)
  const SB = S.skyBottom, loop = loopSky(sky, Math.round(S.w * 0.15)), strip = { w: S.w, h: SB * 2, data: new Uint8Array(S.w * SB * 2 * 4) };
  for (let y = 0; y < SB; y++) for (let x = 0; x < S.w; x++) {
    const o = (y * S.w + x) * 4, s = (y * loop.w + (x % loop.w)) * 4, m = ((y + SB) * S.w + x) * 4, v = fol[y * S.w + x] ? 0 : 255;
    strip.data.set([loop.data[s], loop.data[s + 1], loop.data[s + 2], 255], o); strip.data.set([v, v, v, 255], m);
  }

  P.write(path.join(OUT, 'landing', name + '-plate.png'), plate);
  P.write(path.join(OUT, 'landing', 'sky-' + name + '.png'), strip);
  P.write(path.join(OUT, 'landing', 'gator-' + name + '.png'), spr);
  if (S.gator.far) P.write(path.join(OUT, 'landing', 'gator-' + name + '-far.png'), farSprite(spr, S.gator.far));
  P.write(path.join(OUT, 'landing-' + name + '.png'), still);

  // 4. where can it surface? spots whose footprint is all open water (no lily pads or grass), spread apart
  const water = waterMask(plate, S), cells = [];
  for (let k = 0; k < G.m.length; k++) if (G.m[k]) cells.push([k % G.W, (k / G.W) | 0]);
  const spots = [];
  for (let y = S.water.y0; y + G.H <= S.h; y += 2) for (let x = -4; x + G.W <= S.w + 4; x += 2) for (const flip of [false, true]) {
    let bad = 0;
    for (const [cx, cy] of cells) {
      const X = x + (flip ? G.W - 1 - cx : cx), Y = y + cy;
      if (X < 0 || X >= S.w || !water[Y * S.w + X]) { bad++; if (bad > cells.length * 0.02) break; }
    }
    if (bad <= cells.length * 0.02) spots.push({ x, y, flip });
  }
  const chosen = [{ x: gx, y: gy, flip: false }];
  for (const s of spots.sort((a, b) => b.y - a.y)) if (chosen.every(c => Math.hypot(c.x - s.x, c.y - s.y) > G.W * 0.6)) chosen.push(s);
  console.log(`${name}: skyLoop ${loop.w}; ${fixes.length} loose sky pixels cleaned (${stillFixed} in the still painting too); alligator ${G.W}x${G.H}, ` +
    `${G.wake.reduce((a, b) => a + b, 0)} wake pixels; open-water spots:`, JSON.stringify(chosen.slice(0, 6)));
}
