// Everglades — the living backdrop behind the home page, lobby and loading screens.
//
// The landing art (assets/landing-wide.png and landing-tall.png) is redrawn in a canvas at its own pixel
// size and scaled up crisp, with these touches on top:
//   * the river and ponds ripple and glint,
//   * fireflies drift and blink over the marsh,
//   * the birds from the painting fly across the sky, flapping (PixelLab wingbeat animations).
// The birds were taken out of the painting for the plates (assets/landing/*-plate.png), so they can move.
//
//   * the clouds drift slowly left and keep changing shape (the sky is its own layer, assets/landing/sky-*.png,
//     resampled through a slowly turning warp, so every pixel is still one of the painting's own),
//   * the alligator now and then sinks out of sight and surfaces somewhere else (assets/landing/gator-*.png).
// The art comes from tools/remaster_landing.js (loose sky pixels cleaned, sky and alligator cut out).
//
// The water, fireflies and birds repeat a whole number of times in LOOP seconds, so they loop seamlessly; the
// clouds and the alligator run on the clock and never quite repeat.
// With "reduce motion" turned on in the system settings, the original still painting is shown instead.
(function () {
  'use strict';
  const LOOP = 48; // seconds; every period below divides this
  const FPS = 12;  // pixel-art pace (and light on batteries)
  const TAU = Math.PI * 2;

  // ---------- clouds ----------
  // Smooth 3-D value noise in [-1, 1] (x, y and time), seeded so the two warp directions differ.
  function hash(i, j, k, seed) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041) + Math.imul(seed, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise3(x, y, z, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const sm = f => f * f * (3 - 2 * f), u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    const L = (a, b, f) => a + (b - a) * f;
    const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz, seed);
    return 2 * L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
      L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) - 1;
  }
  // Draw the sky at time T (seconds) into out32 (W wide). sky: { rgb: Uint32Array (W wide), loop, h,
  // move: Uint8Array (1 = sky, 0 = a tree island in front, left as it is) }. The sky repeats every `loop` columns
  // (tools/remaster_landing.js joined its ends), so clouds leaving on the left come back round on the right; the
  // warp is pinned to the clouds (it travels with them), so they billow and change shape as they go.
  // The warp only pushes pixels sideways (rows never mix), so the sky's thin horizontal streaks stay straight.
  const CLOUD = { speed: 1 / 3.2, warpX: 2.6, sizeX: 34, sizeY: 22, turn: 30 };
  let skyBuf = null;
  function drawSky(out32, W, sky, T) {
    const drift = T * CLOUD.speed, SW = sky.loop, H = sky.h;
    // the warp field repeats with the strip (a whole number of noise cells per loop), so the loop is seamless too
    const an = Math.round(SW / CLOUD.sizeX);
    // the noise is only needed at the lattice columns: work those out once per row, then blend along each row
    const A = lattice(an, H, y => y / CLOUD.sizeY, T / CLOUD.turn, 1);
    if (!skyBuf || skyBuf.length !== W * H) skyBuf = new Uint32Array(W * H);
    const b = skyBuf;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u0 = x + drift, ux = (u0 % SW) / SW;
      let u = Math.round(u0 + CLOUD.warpX * blend(A, y, ux * an, an)) % SW; if (u < 0) u += SW;
      b[y * W + x] = sky.rgb[y * W + u];
    }
    // Tidy up: a lone pixel the warp left sticking out (or a one-pixel notch) takes its neighbours' colour, so
    // the cloud edges stay clean pixel art while they move.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (!sky.move[p]) continue;
      let c = b[p];
      if (x > 0 && x < W - 1) {
        const l = b[p - 1], r = b[p + 1];
        if (l === r && l !== c && ((y > 0 && b[p - W] === l) || (y < H - 1 && b[p + W] === l))) c = l;
      }
      if (c === b[p] && y > 0 && y < H - 1) {
        const up = b[p - W], dn = b[p + W];
        if (up === dn && up !== c && ((x > 0 && b[p - 1] === up) || (x < W - 1 && b[p + 1] === up))) c = up;
      }
      out32[p] = c;
    }
  }
  // noise3 at each of n lattice columns, for every row: a Float32Array of H * n
  function lattice(n, H, fy, z, seed) {
    const L = new Float32Array(H * n);
    for (let y = 0; y < H; y++) for (let a = 0; a < n; a++) L[y * n + a] = noise3(a, fy(y), z, seed);
    return L;
  }
  // smooth blend between lattice columns, repeating every n columns
  function blend(L, y, x, n) {
    const xi = Math.floor(x), f = x - xi, sm = f * f * (3 - 2 * f);
    const a = ((xi % n) + n) % n, b = (a + 1) % n;
    return L[y * n + a] * (1 - sm) + L[y * n + b] * sm;
  }

  // ---------- the alligator ----------
  // Each visit: it surfaces (RISE), lies there (HOLD), sinks (SINK) and stays under (UNDER), then comes up at the
  // next spot. s = how far under it is: 0 on the surface, 1 gone.
  const GATOR = { RISE: 1.8, HOLD: 15, SINK: 2.2, UNDER: 4.5, offset: 5 };
  GATOR.CYCLE = GATOR.RISE + GATOR.HOLD + GATOR.SINK + GATOR.UNDER;
  function gatorState(T, nSpots) {
    const G = GATOR, tt = T + G.offset, k = Math.floor(tt / G.CYCLE), ph = tt - k * G.CYCLE;
    let s;
    if (ph < G.RISE) s = 1 - ph / G.RISE;
    else if (ph < G.RISE + G.HOLD) s = 0;
    else if (ph < G.RISE + G.HOLD + G.SINK) s = (ph - G.RISE - G.HOLD) / G.SINK;
    else s = 1;
    return { k, spot: ((k % nSpots) + nSpots) % nSpots, next: (((k + 1) % nSpots) + nSpots) % nSpots, ph, s,
      // when its last few rings of ripples started (they spread for a few seconds)
      rings: [k * G.CYCLE - G.offset, k * G.CYCLE + G.RISE + G.HOLD - G.offset, (k - 1) * G.CYCLE + G.RISE + G.HOLD - G.offset],
      ringSpots: [((k % nSpots) + nSpots) % nSpots, ((k % nSpots) + nSpots) % nSpots, (((k - 1) % nSpots) + nSpots) % nSpots],
      bubbling: ph > G.CYCLE - 1.6 }; // just before it comes up again
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

  if (typeof document === 'undefined') { // Node: the art tools preview these
    if (typeof module !== 'undefined') module.exports = { drawSky, gatorState, noise3, CLOUD, GATOR, BAYER };
    return;
  }

  const SCENES = {
    wide: {
      plate: 'assets/landing/wide-plate.png', w: 320, h: 180, position: 'center 70%',
      horizon: 93,      // water and grass only below this row
      grassFrom: 122,   // foreground grass that sways
      sky: 'assets/landing/sky-wide.png', skyLoop: 272, // the sky repeats every skyLoop columns (printed by tools/remaster_landing.js)
      // the alligator: sprite (frame 0 the animal, frame 1 its wake), the open-water spots it surfaces at
      // (top-left corner of the sprite; flip = facing the other way) and how far it settles as it sinks
      // far: spots further up the water use farSrc, a smaller, sunlit alligator (centred on the same spot, same waterline)
      gator: { src: 'assets/landing/gator-wide.png', farSrc: 'assets/landing/gator-wide-far.png', sink: 2,
        spots: [{ x: 45, y: 154 }, { x: 146, y: 138, flip: true, far: true }, { x: 94, y: 150, flip: true }, { x: 146, y: 138, far: true }] },
      // spots that must stay still even though their colours look like water
      still: [],
      fireflies: { n: 12, y0: 110, y1: 172 },
      flock: {
        cycle: 48, travel: 640, // the flock crosses once per cycle, then stays out of sight for a while
        birds: [ // sprite, x, y at the start of the crossing (relative), wingbeat phase
          { src: 'assets/landing/bird-wide.png', fw: 32, fh: 24, x: 0, y: 51, phase: 0 },
          { src: 'assets/landing/bird-wide.png', fw: 32, fh: 24, x: 23, y: 47, phase: 3 },
          { src: 'assets/landing/bird-wide.png', fw: 32, fh: 24, x: 43, y: 44, phase: 5 },
        ],
      },
    },
    tall: {
      plate: 'assets/landing/tall-plate.png', w: 180, h: 320, position: 'center bottom',
      horizon: 160, grassFrom: 228,
      sky: 'assets/landing/sky-tall.png', skyLoop: 153,
      gator: { src: 'assets/landing/gator-tall.png', farSrc: 'assets/landing/gator-tall-far.png', sink: 0,
        spots: [{ x: 84, y: 254 }, { x: 76, y: 257, flip: true }, { x: 86, y: 239, far: true }] },
      still: [[116, 146, 180, 178], [0, 198, 66, 280]], // bushes, reeds
      fireflies: { n: 10, y0: 175, y1: 300 },
      flock: {
        cycle: 48, travel: 420,
        birds: [
          { src: 'assets/landing/bird-tall-spoonbill.png', fw: 40, fh: 32, x: 0, y: 66, phase: 0 },
          { src: 'assets/landing/bird-tall-spoonbill.png', fw: 40, fh: 32, x: 34, y: 60, phase: 4 },
          { src: 'assets/landing/bird-tall-egret.png', fw: 40, fh: 32, x: 40, y: 44, phase: 2 },
        ],
      },
    },
  };

  const canvas = document.getElementById('scenery');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const portrait = matchMedia('(orientation: portrait)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = {}; // scene name -> prepared data
  let scene = null, prep = null, lastFrame = -1, running = false;

  // Change ART_V whenever the landing art is redrawn (and the ?v= on the still paintings in style.css), so every
  // browser fetches the new images at once instead of mixing in ones it saved earlier.
  const ART_V = '20261117';
  const loadImage = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src + '?v=' + ART_V; });
  // a small repeatable pseudo-random generator, so the sparkles and fireflies are the same every visit
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

  async function prepare(name) {
    if (cache[name]) return cache[name];
    const S = SCENES[name];
    const [plate, skyIm, gatorIm, farIm, ...sprites] = await Promise.all([loadImage(S.plate), loadImage(S.sky), loadImage(S.gator.src), loadImage(S.gator.farSrc), ...S.flock.birds.map(b => loadImage(b.src))]);
    const c = document.createElement('canvas'); c.width = S.w; c.height = S.h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    // the sky layer (alpha 0 = a tree island in front of it) and the alligator sprite, read as pixels
    const pixelsOf = im => { // (on a canvas of its own: the sky strip and sprite sheets are wider than the scene)
      const k = document.createElement('canvas'); k.width = im.width; k.height = im.height;
      const kx = k.getContext('2d', { willReadFrequently: true }); kx.drawImage(im, 0, 0);
      return kx.getImageData(0, 0, im.width, im.height);
    };
    const skyD = pixelsOf(skyIm);
    // top half: the sky; bottom half: its mask (white = sky that moves, black = a tree island in front)
    const SH = skyIm.height / 2, sky = { loop: S.skyLoop, h: SH, rgb: new Uint32Array(skyD.data.buffer.slice(0, S.w * SH * 4)), move: new Uint8Array(S.w * SH) };
    for (let p = 0; p < S.w * SH; p++) sky.move[p] = skyD.data[(S.w * SH + p) * 4] > 127 ? 1 : 0;
    // an alligator sprite sheet (frame 0 the animal, frame 1 its wake) as lists of pixels
    const readGator = im => {
      const gD = pixelsOf(im), GW = im.width / 2, GH = im.height, G = { w: GW, h: GH, body: [], wake: [], eye: [0, 0] };
      let eyes = 0;
      for (let y = 0; y < GH; y++) for (let x = 0; x < im.width; x++) {
        const j = (y * im.width + x) * 4; if (gD.data[j + 3] < 128) continue;
        const r = gD.data[j], g = gD.data[j + 1], b = gD.data[j + 2], isEye = r > 150 && g > 90 && b < 60; // the yellow eyes
        if (x < GW) { G.body.push({ x, y, r, g, b, eye: isEye }); if (isEye) { G.eye[0] += x; G.eye[1] += y; eyes++; } }
        else G.wake.push({ x: x - GW, y, r, g, b });
      }
      if (eyes) { G.eye[0] /= eyes; G.eye[1] /= eyes; } else G.eye = [GW / 2, GH / 2];
      return G;
    };
    const gator = readGator(gatorIm), gatorFar = readGator(farIm);
    cx.drawImage(plate, 0, 0);
    const src = cx.getImageData(0, 0, S.w, S.h);
    const px = new Uint32Array(src.data.buffer.slice(0)); // the still plate, one 32-bit pixel per entry
    const d = src.data, n = S.w * S.h;
    const water = new Uint8Array(n), grass = new Uint8Array(n);
    const inStill = (x, y) => S.still.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    // The same colour rules as the mask preview used when tuning this (see README): yellow-green = grass,
    // blue-ish or rose-tinted below the horizon = water.
    for (let y = S.horizon + 1; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const i = y * S.w + x, r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const isGrass = g > b + 18 && r > b && g >= r * 0.62;
      const isFlower = r > 150 && b > 150 && g < 140 && b > r;
      if (inStill(x, y)) continue;
      if (isGrass) grass[i] = 1;
      else if (!isFlower && (b >= g * 0.92 || r > g * 1.3)) water[i] = 1;
    }
    // glints: the brightest water pixels
    const lum = i => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    const wl = []; for (let i = 0; i < n; i++) if (water[i]) wl.push(lum(i));
    const cut = wl.sort((a, b) => a - b)[Math.floor(wl.length * 0.9)] || 255;
    const rand = rng(name === 'wide' ? 7 : 11), periods = [3, 4, 6, 8];
    const glints = [];
    for (let i = 0; i < n; i++) if (water[i] && lum(i) >= cut && rand() < 0.5) glints.push({ i, p: periods[Math.floor(rand() * 4)], ph: rand() });
    const flies = [];
    for (let k = 0; k < S.fireflies.n; k++) flies.push({
      x: 8 + rand() * (S.w - 16), y: S.fireflies.y0 + rand() * (S.fireflies.y1 - S.fireflies.y0),
      ax: 4 + rand() * 10, ay: 2 + rand() * 5, px: [12, 16, 24][Math.floor(rand() * 3)], py: [8, 12, 16][Math.floor(rand() * 3)],
      pb: [3, 4, 6][Math.floor(rand() * 3)], ph: rand(),
    });
    const out = cx.createImageData(S.w, S.h);
    return (cache[name] = { S, px, water, grass, glints, flies, sprites, sky, gator, gatorFar, out, out32: new Uint32Array(out.data.buffer), work: c, wctx: cx });
  }

  // The alligator at its spot, s of the way under: it darkens into the water and breaks up (ordered dither) as it
  // sinks, settling a little lower; the eyes go last and come up first. Its wake shows only while it's up.
  // It only ever covers open water: flowers, grasses, reeds and lily pads in front of it stay in front.
  function drawGator(o, W, H, water, G, spot, s, sink) {
    if (s >= 1) return;
    const fx = x => spot.flip ? G.w - 1 - x : x;
    const put = (X, Y, r, g, b, k) => { // k = how much of the water under it shows through
      if (X < 0 || Y < 0 || X >= W || Y >= H || !water[Y * W + X]) return;
      const j = (Y * W + X) * 4; o[j] = r + (o[j] - r) * k; o[j + 1] = g + (o[j + 1] - g) * k; o[j + 2] = b + (o[j + 2] - b) * k;
    };
    for (const p of G.wake) { const X = spot.x + fx(p.x), Y = spot.y + p.y; if (BAYER[(Y & 3) * 4 + (X & 3)] >= 1 - s * 2.2) continue; put(X, Y, p.r, p.g, p.b, 0.35); }
    const dy = Math.round(s * sink), tint = Math.min(1, s * 1.5) * 0.7, gone = (s - 0.2) / 0.6;
    for (const p of G.body) {
      const X = spot.x + fx(p.x), Y = spot.y + p.y + dy;
      if (p.eye ? s > 0.9 : BAYER[(Y & 3) * 4 + (X & 3)] < gone) continue;
      put(X, Y, p.r, p.g, p.b, p.eye ? tint * 0.4 : tint);
    }
  }
  // Rings of ripples spreading from where it went down or came up, seen in perspective: the further up the water
  // (towards the horizon) the smaller and flatter they are, and each ring's far half is narrower and fainter than
  // its near half. depth: 0 at the horizon, 1 at the bottom of the scene. On open water only.
  function drawRings(o, W, H, water, cx, cy, age, size, depth) {
    const scale = 0.45 + 0.65 * depth, flat = 0.1 + 0.2 * depth;
    for (const [delay, k] of [[0, 0.55], [0.7, 0.35]]) {
      const a = age - delay; if (a < 0 || a > 2.6) continue;
      const rx = (size * 0.25 + a * size * 0.22) * scale, ry = rx * flat, fade = k * (1 - a / 2.6);
      const n = Math.ceil(rx * 4);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU, far = Math.sin(ang) < 0;
        const X = Math.round(cx + Math.cos(ang) * rx), Y = Math.round(cy + Math.sin(ang) * ry * (far ? 0.7 : 1.15));
        if (X < 0 || Y < 0 || X >= W || Y >= H || !water[Y * W + X]) continue;
        const f = far ? fade * 0.6 : fade, j = (Y * W + X) * 4;
        o[j] += (205 - o[j]) * f; o[j + 1] += (215 - o[j + 1]) * f; o[j + 2] += (225 - o[j + 2]) * f;
      }
    }
  }

  function render(t, T) {
    const { S, px, water, glints, flies, sprites, out, out32, wctx } = prep;
    const W = S.w, H = S.h;
    out32.set(px);
    drawSky(out32, W, prep.sky, T); // drifting, changing clouds behind the tree islands
    // ripples: water rows slide a pixel left or right in a slow wave (only ever borrowing water from water)
    for (let y = S.horizon + 1; y < H; y++) {
      const dx = Math.round(Math.sin(TAU * t / 4 + y * 0.7) * 0.9);
      if (dx) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (water[i] && water[i + dx]) out32[i] = px[i + dx]; }
    }
    // glints on the water
    const o = out.data;
    for (const s of glints) {
      const v = Math.max(0, Math.sin(TAU * (t / s.p + s.ph)));
      const k = Math.pow(v, 10) * 0.75; if (k < 0.05) continue;
      const j = s.i * 4; o[j] += (255 - o[j]) * k; o[j + 1] += (240 - o[j + 1]) * k; o[j + 2] += (215 - o[j + 2]) * k;
    }
    // the alligator, the ripples where it went down or came up, and a few bubbles just before it surfaces
    const GT = S.gator, st = gatorState(T, GT.spots.length);
    // a spot's alligator: the far (smaller, sunlit) one is centred on the near one's place, on the same waterline
    const at = k => {
      const sp = GT.spots[k], N = prep.gator, G = sp.far ? prep.gatorFar : N;
      return { G, sp: { x: sp.x + Math.round((N.w - G.w) / 2), y: sp.y + (N.h - G.h), flip: sp.flip } };
    };
    { const { G, sp } = at(st.spot); drawGator(o, W, H, water, G, sp, st.s, GT.sink); }
    st.rings.forEach((t0, i) => {
      const { G, sp } = at(st.ringSpots[i]), cy = sp.y + G.h * 0.62;
      drawRings(o, W, H, water, sp.x + G.w / 2, cy, T - t0, G.w, Math.max(0, Math.min(1, (cy - S.horizon) / (H - S.horizon))));
    });
    if (st.bubbling) {
      const { G, sp } = at(st.next), ex = sp.x + (sp.flip ? G.w - 1 - G.eye[0] : G.eye[0]), ey = sp.y + G.eye[1];
      for (let b = 0; b < 3; b++) {
        if (Math.sin(TAU * (T * 1.7 + b * 0.37)) < 0.3) continue;
        const X = Math.round(ex + (b - 1) * 4 + Math.sin(b * 2.1) * 2), Y = Math.round(ey + 2 + Math.cos(b * 1.3) * 2);
        if (X < 0 || Y < 0 || X >= W || Y >= H || !water[Y * W + X]) continue;
        const j = (Y * W + X) * 4; o[j] += (215 - o[j]) * 0.6; o[j + 1] += (225 - o[j + 1]) * 0.6; o[j + 2] += (230 - o[j + 2]) * 0.6;
      }
    }
    // fireflies
    for (const f of flies) {
      const blink = Math.sin(TAU * (t / f.pb + f.ph)); if (blink < 0.35) continue;
      const a = Math.min(1, (blink - 0.35) / 0.4);
      const x = Math.round(f.x + f.ax * Math.sin(TAU * (t / f.px + f.ph))), y = Math.round(f.y + f.ay * Math.sin(TAU * (t / f.py + f.ph * 2)));
      const dot = (xx, yy, al) => { if (xx < 0 || yy < 0 || xx >= W || yy >= H) return; const j = (yy * W + xx) * 4; o[j] += (255 - o[j]) * al; o[j + 1] += (236 - o[j + 1]) * al; o[j + 2] += (140 - o[j + 2]) * al; };
      dot(x, y, a); dot(x - 1, y, a * 0.3); dot(x + 1, y, a * 0.3); dot(x, y - 1, a * 0.3); dot(x, y + 1, a * 0.3);
    }
    wctx.putImageData(out, 0, 0);
    // the flock: flies right to left across the sky once per cycle, bobbing gently, wings beating once a second
    const F = S.flock, prog = (t % F.cycle) / F.cycle;
    const lead = W + 8 - prog * F.travel;
    F.birds.forEach((b, k) => {
      const im = sprites[k], frame = (Math.floor(t * 8) + b.phase) % 8;
      const x = Math.round(lead + b.x), y = Math.round(b.y + Math.sin(TAU * t / 4 + k * 1.7) * 1.2);
      if (x > -b.fw && x < W) wctx.drawImage(im, frame * b.fw, 0, b.fw, b.fh, x, y, b.fw, b.fh);
    });
    ctx.drawImage(prep.work, 0, 0);
  }

  function tick(now) {
    if (!running) return;
    const T = now / 1000, frame = Math.floor(T * FPS); // T: the clock (clouds, alligator); t: the LOOP for the rest
    if (frame !== lastFrame && prep) { lastFrame = frame; render((frame / FPS) % LOOP, frame / FPS); }
    requestAnimationFrame(tick);
  }

  const wanted = () => document.body.classList.contains('scenic') && !reduced.matches && !document.hidden;
  async function sync() {
    if (!wanted()) { running = false; document.documentElement.classList.remove('scenery-live'); return; }
    const name = portrait.matches ? 'tall' : 'wide';
    if (name !== scene) {
      scene = name;
      try { prep = await prepare(name); } catch { prep = null; return; } // keep the still painting if anything fails
      if (scene !== name) return;
      canvas.width = prep.S.w; canvas.height = prep.S.h;
      canvas.style.objectPosition = prep.S.position;
      lastFrame = -1;
    }
    // loading takes a moment: if a game started meanwhile, stay hidden
    if (!prep || !wanted()) { running = false; document.documentElement.classList.remove('scenery-live'); return; }
    document.documentElement.classList.add('scenery-live');
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
  portrait.addEventListener?.('change', sync);
  reduced.addEventListener?.('change', sync);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
