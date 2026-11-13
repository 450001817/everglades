// Everglades — the living backdrop behind the home page, lobby and loading screens.
//
// The landing art (assets/landing-wide.png and landing-tall.png) is redrawn in a canvas at its own pixel
// size and scaled up crisp, with these touches on top:
//   * the river and ponds ripple and glint,
//   * fireflies drift and blink over the marsh,
//   * the birds from the painting fly across the sky, flapping (PixelLab wingbeat animations).
// The birds were taken out of the painting for the plates (assets/landing/*-plate.png), so they can move.
//
// Every motion repeats a whole number of times in LOOP seconds, so the scene loops seamlessly forever.
// With "reduce motion" turned on in the system settings, the original still painting is shown instead.
(function () {
  'use strict';
  const LOOP = 48; // seconds; every period below divides this
  const FPS = 12;  // pixel-art pace (and light on batteries)
  const TAU = Math.PI * 2;

  const SCENES = {
    wide: {
      plate: 'assets/landing/wide-plate.png', w: 320, h: 180, position: 'center 70%',
      horizon: 93,      // water and grass only below this row
      grassFrom: 122,   // foreground grass that sways
      // spots that must stay still even though their colours look like water (the alligator)
      still: [[38, 156, 122, 178]],
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
      still: [[84, 256, 174, 300], [116, 146, 180, 178], [0, 198, 66, 280]], // alligator, bushes, reeds
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

  const loadImage = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
  // a small repeatable pseudo-random generator, so the sparkles and fireflies are the same every visit
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

  async function prepare(name) {
    if (cache[name]) return cache[name];
    const S = SCENES[name];
    const [plate, ...sprites] = await Promise.all([loadImage(S.plate), ...S.flock.birds.map(b => loadImage(b.src))]);
    const c = document.createElement('canvas'); c.width = S.w; c.height = S.h;
    const cx = c.getContext('2d'); cx.drawImage(plate, 0, 0);
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
    return (cache[name] = { S, px, water, grass, glints, flies, sprites, out, out32: new Uint32Array(out.data.buffer), work: c, wctx: cx });
  }

  function render(t) {
    const { S, px, water, glints, flies, sprites, out, out32, wctx } = prep;
    const W = S.w, H = S.h;
    out32.set(px);
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
    const t = (now / 1000) % LOOP, frame = Math.floor(t * FPS);
    if (frame !== lastFrame && prep) { lastFrame = frame; render(frame / FPS); }
    requestAnimationFrame(tick);
  }

  async function sync() {
    const want = document.body.classList.contains('scenic') && !reduced.matches && !document.hidden;
    if (!want) { running = false; document.documentElement.classList.remove('scenery-live'); return; }
    const name = portrait.matches ? 'tall' : 'wide';
    if (name !== scene) {
      scene = name;
      try { prep = await prepare(name); } catch { prep = null; return; } // keep the still painting if anything fails
      if (scene !== name) return;
      canvas.width = prep.S.w; canvas.height = prep.S.h;
      canvas.style.objectPosition = prep.S.position;
      lastFrame = -1;
    }
    if (!prep) return;
    document.documentElement.classList.add('scenery-live');
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
  portrait.addEventListener?.('change', sync);
  reduced.addEventListener?.('change', sync);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
