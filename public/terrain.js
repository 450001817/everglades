// Everglades — the play area's living ground (used by terrainHtml in client.js).
//
// One terrain, one animation pipeline. The ground is a pixel-art elevation map: stepped terraces lit from the
// top-left (a lit rim on each step's upper edge, a shadowed face on its lower one), so the land reads as having
// height even from straight above. A single water level runs over it, and the round's suit is just a level:
//   Land     the water is below everything: dry, cracked earth
//   Wetland  the water fills the low ground: shallow murky pools with small ripples spreading on them, a band of
//            mud and reeds around them
//   Water    the water covers everything: one clear tropical turquoise with the sandbars a soft shape beneath,
//            and organically shaped ripples spreading outward around each sandbar; out in the open ocean (the Gulf and
//            the Keys) the ripples carry sea foam, inland (Lake Okeechobee, flooded land) they stay clear
// Changing suit moves the level, so the board never cuts from one picture to another: water rises terrace by
// terrace, or drains away and leaves dark wet ground that dries out over a few seconds.
// The colours come from the card frames (Water #42b7c0, Wetland #989d51, Land #895941), kept dark so cards and text
// stay easy to read on top.
(function (root) {
  'use strict';
  const PX = 3;                                          // screen pixels per terrain pixel
  const LEVEL = { Land: -0.16, Wetland: 0.4, Water: 1.1 }; // water level for each suit (heights run 0..1)
  const NONE = LEVEL.Land;                               // no suit yet (role draft): dry ground
  const MUD = 0.1;                                       // how far above the waterline the ground is muddy
  const DRY_RATE = 0.3;                                  // how fast wet ground dries once the water has gone (height/s; ~4 s from sea to dry land)
  const STEPS = 6;                                       // terraces
  const SEA_LEVEL = 0.95;                                // above this the board is open sea
  // ripples around the sandbars (Water): they start at this depth (just off the bar), are this far apart in depth,
  // and have faded out by the outer depth
  const RIP_IN = 0.16, RIP_GAP = 0.055, RIP_OUT = 0.42;
  const RIPPLE_LIFE = 2.4;                               // seconds a marsh ripple takes to spread and fade
  const RIPPLE_EVERY = 0.55;                             // a new one about this often (seconds)

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // shades run dark -> light; index 2 is the plain ground, lower = shadowed, higher = lit
  const EARTH = ['#2b1a12', '#3a241a', '#4a2f21', '#573828', '#66432f', '#755039'].map(hex);   // from Land #895941
  const MUDC = ['#211d10', '#2b2715', '#35311b', '#403b21', '#4b4627', '#58532e'].map(hex);    // soil + Wetland #989d51
  const GRASS = ['#1c1e10', '#262915', '#30341a', '#3b4020', '#474d27', '#545b2e'].map(hex);  // damp marsh ground, Wetland #989d51 darkened
  const REED = ['#4f5326', '#6c7136', '#8a8f47'].map(hex);                                   // Wetland, darkened
  const SEA = ['#2c7f87', '#20656f', '#18525d', '#11404b', '#0c323c'].map(hex);               // from Water #42b7c0; shore -> deep
  const MURK = hex('#34421f');                                                              // pools in the marsh are greener
  const FOAM = hex('#a8dedb'), FOAM2 = hex('#4f9fa4');
  // the tropical sea (Water #42b7c0, darkened): five close turquoise tones, shallow (over a sandbar) -> deep
  const TROPIC = ['#2f8c90', '#287f86', '#22737c', '#1d6873', '#195e6a'].map(hex);
  const GLINT = hex('#5fb8b6'), GLINT2 = hex('#8fd2cc');                                    // light on the ripples
  const SEAFOAM = hex('#dcf3ec'), SEAFOAM2 = hex('#9fd8cf');                                // ocean spume and its wash
  const BAR = hex('#49a7a3');                                                            // sand under the shallowest water
  const TROUGH = hex('#123f4a');                                                         // ...and shade in its troughs
  const RIPPLE = hex('#7a9468');                                                          // a ring spreading on a marsh pool
  const CRACK = hex('#1d120c');
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

  // ---------- the ground, built once per size ----------
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function valueNoise(w, h, cell, r, cellY = cell) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cellY) + 2, g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(w * h), sm = t => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / cell, fy = y / cellY, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
    return out;
  }
  function buildGround(w, h) {
    const r = rng(20261117 + w * 131 + h);
    const n = w * h, raw = new Float32Array(n);
    // hills about a seventh of the board across (so a phone's small board gets as many as a computer's big one)
    const big = Math.max(16, Math.min(44, Math.round(Math.max(w, h) / 7)));
    for (const [cell, amp] of [[big, 1], [big / 2, 0.42], [big / 4, 0.14]]) { const v = valueNoise(w, h, cell, r); for (let i = 0; i < n; i++) raw[i] += v[i] * amp; }
    // even out the heights (rank order), so a level of 0.4 floods exactly 40% of the board whatever its size
    const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]), H = new Float32Array(n);
    order.forEach((idx, k) => { H[idx] = k / (n - 1); });
    const step = i => Math.min(STEPS - 1, Math.floor(H[i] * STEPS));
    // light: terrace edges (rim lit from the north-west, face in shadow to the south-east) and a soft hill shade
    const shade = new Int8Array(n), cliff = new Uint8Array(n), edge = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, s = step(i);
      const up = y > 0 ? step(i - w) : s, left = x > 0 ? step(i - 1) : s, down = y < h - 1 ? step(i + w) : s, right = x < w - 1 ? step(i + 1) : s;
      let k = 1 + Math.round(s * 3 / (STEPS - 1));                       // the higher the terrace, the lighter
      if (s > down || s > right) { k = 0; cliff[i] = 1; edge[i] = 1; }   // the step's face, in shadow
      else if (s > up || s > left) { k = Math.min(5, k + 2); edge[i] = 1; } // its rim, catching the light from the north-west
      else {
        const gx = (x < w - 1 ? H[i + 1] : H[i]) - (x > 0 ? H[i - 1] : H[i]), gy = (y < h - 1 ? H[i + w] : H[i]) - (y > 0 ? H[i - w] : H[i]);
        const lit = -(gx + gy) * 14 + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.4;
        k += lit > 0.9 ? 1 : lit < -0.9 ? -1 : 0;
      }
      shade[i] = Math.max(0, Math.min(5, k));
    }
    // each face also casts a pixel of shadow onto the ground just below it (the step looks taller)
    for (let i = n - w - 1; i >= 0; i--) if (cliff[i] && !edge[i + w]) shade[i + w] = Math.max(0, shade[i + w] - 1);
    // cracks in the dry earth: the edges of a scatter of plates (Voronoi), broken up, kept off the terrace edges
    const crack = new Uint8Array(n), seeds = [];
    const plates = Math.max(8, Math.round(n / 700));
    for (let k = 0; k < plates; k++) seeds.push([r() * w, r() * h]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (edge[i]) continue;
      let d1 = 1e9, d2 = 1e9;
      for (const [sx, sy] of seeds) { const d = (sx - x) ** 2 + (sy - y) ** 2; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      if (Math.sqrt(d2) - Math.sqrt(d1) < 0.8 && r() > 0.3) crack[i] = 1;
    }
    // reeds (little tufts on the muddy banks)
    // (foam: noise stretched sideways, so a narrow band of it draws long wavy streaks like wind-blown spume)
    const reed = new Uint8Array(n), foamN = valueNoise(w, h, 14, r, 4);
    for (let i = 0; i < n; i++) if (r() < 0.035) reed[i] = 1 + (r() * 3 | 0);
    return { w, h, H, shade, cliff, crack, reed, foamN };
  }

  // ---------- drawing ----------
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function paint(st, t) {
    const G = st.ground, { w, h, H, shade, cliff, crack, reed, foamN } = G, data = st.img.data;
    const L = st.level, wet = st.wet, still = st.still;
    // how marshy the high ground is: 0 at the Land level (dry, cracked), 1 at the Wetland level and above (damp, grassy)
    const moist = Math.max(0, Math.min(1, (L - LEVEL.Land) / (LEVEL.Wetland - LEVEL.Land)));
    const ground = EARTH.map((c, k) => mix(c, GRASS[k], moist * 0.8));
    const murk = Math.max(0, Math.min(1, (1 - L) / 0.6)) * 0.7;           // marsh pools are greener and murkier than the sea
    // tropical sea (Water only): as the water rises past the marsh it turns one clear turquoise, depth only nudging the
    // shade, so what's beneath (the sandbars) shows as soft lighter shapes under the surface. At the Wetland level
    // seaMix is 0 and the marsh looks exactly as before.
    const seaMix = Math.max(0, Math.min(1, (L - 0.75) / 0.3));
    const water = SEA.map((c, k) => mix(mix(c, MURK, murk), TROPIC[k], seaMix));
    const depthScale = 0.5 + seaMix * 0.55;
    const shore = [mix(FOAM, REED[2], murk * 1.2), mix(FOAM2, REED[1], murk * 1.2)]; // sea foam, or a muddy scum in the marsh
    const sea = L > SEA_LEVEL; // open sea (the Water suit, or rising into it)
    // marsh ripples: little rings spreading from a few points on the pools, each fading as it grows
    const rings = [];
    if (!sea && L > 0.05 && !still) for (const rp of st.ripples) {
      const age = t - rp.at; if (age < 0 || age > RIPPLE_LIFE) continue;
      rings.push({ x: rp.x, y: rp.y, r: 0.8 + age * 4.2, fade: age / RIPPLE_LIFE });
    }
    const tt = still ? 0 : t;
    const foam = st.foam * seaMix;                                        // sea foam (open-ocean regions only)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, hh = H[i], d = L - hh, bay = BAYER[(y & 3) * 4 + (x & 3)];
      let c;
      if (d >= 0) {
        // water: deeper is darker (dithered between bands); the terrace faces still show faintly underneath
        const depth = Math.min(1, d / depthScale) * 4 + bay * 0.8 - 0.4;
        c = water[Math.max(0, Math.min(4, Math.round(depth) + (cliff[i] && d < 0.35 && seaMix < 0.5 ? 1 : 0)))];
        if (seaMix > 0) {
          // ripples around the sandbars: rings that follow the bar's own outline (they are drawn along lines of equal
          // depth, so they take its organic shape), travel outward from it and fade as they reach deeper water.
          // The noise bends them a little more so no two look alike; open water stays still and clear.
          // In the open-ocean regions the ripples also carry sea foam: lacy spume riding the crests nearest the bar, a
          // dithered wash trailing each one, and a broken fringe along the bar's edge. The lace comes from the noise
          // field and creeps slowly, so it reads as foam being carried, never as flicker.
          const lace = foam > 0 ? ((foamN[i] * 31 + tt * 0.05) % 1) : 1;
          if (d <= RIP_IN) {
            c = mix(c, BAR, (1 - d / RIP_IN) * 0.45 * seaMix * (bay < 0.85 ? 1 : 0.5)); // the bar: a soft lighter shape
            if (d > RIP_IN - 0.035 && lace < 0.55 * foam) c = mix(c, SEAFOAM2, 0.8);
          } else if (d < RIP_OUT) {
            const p = (d - RIP_IN) / RIP_GAP + foamN[i] * 0.35 - tt * 0.3, f = p - Math.floor(p);
            const fade = (d - RIP_IN) / (RIP_OUT - RIP_IN);                 // 0 at the bar, 1 out in deep water
            const spume = foam * Math.max(0, 1 - fade * 1.6);               // foam thins out away from the bar
            // solid near the bar, breaking up (dithered) only as it fades into deep water
            if (f < 0.2 && bay > (fade - 0.35) * 1.5) {
              c = mix(c, fade < 0.3 && f < 0.1 ? GLINT2 : GLINT, (0.7 - fade * 0.45) * seaMix);
              if (lace < 0.5 * spume) c = f < 0.12 ? SEAFOAM : mix(c, SEAFOAM2, 0.85);
            } else if (f < 0.34 && spume > 0 && lace < spume * (0.34 - f) * 3) c = mix(c, SEAFOAM2, 0.6); // the wash behind (lacy, not a grid)
            else if (f > 0.8 && f < 0.9 && bay > fade) c = mix(c, TROUGH, 0.25 * seaMix); // shade on its outer side
          }
        } else if (d < 0.02 + 0.01 * Math.sin(t * 1.6 + foamN[i] * 14)) c = d < 0.011 ? shore[0] : shore[1]; // lapping shoreline (smooth along the bank, not pixel by pixel)
        else if (rings.length && d > 0.02) {
          for (const g of rings) {
            const dist = Math.hypot(x - g.x, (y - g.y) * 1.25);           // (a touch flattened: seen at a slight angle)
            // the leading ring, and a fainter one following it in; both thin out (dithered) as they fade
            const lead = Math.abs(dist - g.r) < 0.62, trail = g.r > 3.5 && Math.abs(dist - (g.r - 2.6)) < 0.5;
            if ((lead && bay > g.fade * 0.85) || (trail && bay > 0.35 + g.fade * 0.65)) { c = mix(c, RIPPLE, lead ? 0.85 - g.fade * 0.35 : 0.5); break; }
          }
        }
      } else {
        const up = -d, k = shade[i];
        if (hh < wet || (L > 0 && up < MUD)) {
          c = MUDC[k];                                                    // mud: under the water a moment ago, or a bank
          if (reed[i] && L > 0 && L < 0.95 && up < MUD * 1.6) c = REED[reed[i] - 1];
        } else {
          c = ground[k];
          if (crack[i] && k > 0 && bay > moist * 1.4) c = CRACK;          // cracks close up as the ground gets wet
          else if (reed[i] && bay < moist * 0.6) c = REED[0];             // marsh grass on the damp high ground
          if (hh < wet + 0.05) c = mix(c, MUDC[k], 0.5);                  // drying edge
        }
      }
      const o = i * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    st.ctx.putImageData(st.img, 0, 0);
  }

  // ---------- one board at a time ----------
  const reduce = () => !!(root.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const st = { cv: null, ctx: null, ground: null, img: null, level: NONE, wet: NONE, tween: null, suit: undefined, raf: 0, last: 0, painted: 0, ro: null, ripples: [], rippleAt: 0, foam: 0, foamTo: 0 };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function fit() {
    const cv = st.cv; if (!cv) return false;
    const W = Math.max(8, Math.ceil(cv.clientWidth / PX)), Hh = Math.max(8, Math.ceil(cv.clientHeight / PX));
    if (!cv.clientWidth) return false;
    if (!st.ground || st.ground.w !== W || st.ground.h !== Hh) {
      cv.width = W; cv.height = Hh;
      st.ctx = cv.getContext('2d'); st.ground = buildGround(W, Hh); st.img = st.ctx.createImageData(W, Hh); st.painted = 0;
    }
    return true;
  }
  function frame(now) {
    st.raf = 0;
    if (!st.cv || !st.cv.isConnected) return;
    if (document.hidden || !st.cv.offsetParent) return; // not on screen: the next render (or the tab coming back) restarts it
    if (!fit()) { st.raf = requestAnimationFrame(frame); return; }
    const t = now / 1000, dt = st.last ? Math.min(0.1, t - st.last) : 0;
    let moving = false;
    if (st.tween) {
      const k = Math.min(1, (now - st.tween.at) / st.tween.ms);
      st.level = st.tween.from + (st.tween.to - st.tween.from) * ease(k);
      if (k >= 1) st.tween = null; else moving = true;
    }
    // sea foam fades in or out (about 1.5 s) when the round moves between the open ocean and inland water
    if (st.foam !== st.foamTo) { const step = dt / 1.5; st.foam = st.foam < st.foamTo ? Math.min(st.foamTo, st.foam + step) : Math.max(st.foamTo, st.foam - step); moving = true; }
    const wetBefore = st.wet;
    st.wet = Math.max(st.level, st.wet - DRY_RATE * dt);
    const drying = st.wet > st.level + 1e-4;
    st.still = reduce();
    // frame rate: smooth while the water moves, gentle while the sea or the marsh shimmers, nothing on dry land
    const fps = moving ? 30 : drying ? 12 : st.still ? 0 : st.level > 0.05 ? 12 : 0;
    // marsh: now and then a ripple starts somewhere on a pool (a fish rising, a drop falling)
    if (!st.still && st.level > 0.05 && st.level <= SEA_LEVEL && t - (st.rippleAt || 0) > RIPPLE_EVERY * (0.6 + Math.random() * 0.8)) {
      const G = st.ground;
      for (let k = 0; k < 24; k++) {
        const x = Math.floor(Math.random() * G.w), y = Math.floor(Math.random() * G.h);
        if (st.level - G.H[y * G.w + x] > 0.07) { st.ripples.push({ x, y, at: t }); st.rippleAt = t; break; }
      }
      st.ripples = st.ripples.filter(rp => t - rp.at < RIPPLE_LIFE).slice(-6);
    }
    if (!st.painted || moving || drying || wetBefore !== st.wet || (fps && now - st.painted >= 1000 / fps)) { paint(st, t); st.painted = now; }
    st.last = t;
    if (moving || drying || fps) st.raf = requestAnimationFrame(frame);
  }
  function kick() { if (!st.raf) st.raf = requestAnimationFrame(frame); }

  // Called after every render with the board's canvas, the suit to show (or null), and whether the biome is out in
  // the open ocean (its ripples then carry sea foam).
  function sync(cv, suit, marine = false) {
    if (!cv) return;
    if (cv !== st.cv) {
      st.cv = cv; st.ground = null; st.painted = 0;
      if (st.ro) st.ro.disconnect();
      if (root.ResizeObserver) { st.ro = new ResizeObserver(() => { st.painted = 0; kick(); }); st.ro.observe(cv); }
    }
    if (suit !== st.suit) {
      const to = suit ? LEVEL[suit] : NONE;
      if (st.suit === undefined || reduce()) { st.level = st.wet = to; st.tween = null; } // first sight: no animation
      else {
        const span = Math.abs(to - st.level);
        st.tween = { from: st.level, to, at: performance.now(), ms: 900 + span * 1900 }; // about 2.5 s for a full flood
      }
      st.suit = suit; st.painted = 0;
    }
    st.foamTo = marine ? 1 : 0;
    if (st.suit === undefined || reduce() || !st.last) st.foam = st.foamTo;
    kick();
  }
  // a new game starts dry
  function reset() { st.suit = undefined; st.level = st.wet = NONE; st.tween = null; st.foam = st.foamTo = 0; st.last = 0; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.cv) { st.last = 0; kick(); } });
  // milliseconds to draw one frame at the current size (for checking performance from the console)
  function bench(frames = 20) {
    if (!fit()) return null;
    const a = performance.now(); for (let k = 0; k < frames; k++) paint(st, k * 0.05); return (performance.now() - a) / frames;
  }
  root.EG_TERRAIN = { sync, reset, bench, LEVEL };
})(typeof window !== 'undefined' ? window : globalThis);
