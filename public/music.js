// Everglades — music. Original 8-bit tunes, synthesized live with the Web Audio API (no audio files).
//
//   TITLE  "Sunset over the Sawgrass"  home page, lobby, results       F major, 92 bpm, lazy swing
//   MATCH  "Tracking the River of Grass" during a game                 D minor, 100 bpm, light swing, driving
//   COOP   "Coils of the Anaconda"       during a co-op game            E Phrygian, 112 bpm, straight, menacing
//
// Each song is a list of bars, [chord(s), melody], the melody in eighth notes ("note:eighths", r = rest), plus its
// own arrangement (scheduleBar) built from the shared voices: square-wave lead, triangle bass, quiet pulse
// arpeggios, and sine / noise-channel drums. All three loop seamlessly.
(function (root) {
  'use strict';
  const SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const freq = (name, oct) => 440 * Math.pow(2, (SEMI[name] + 12 * (oct + 1) - 69) / 12);
  const noteFreq = n => { const m = /^([A-G][b#]?)(\d)$/.exec(n); return freq(m[1], +m[2]); };
  const CHORDS = {
    F: ['F', 'A', 'C'], Bb: ['Bb', 'D', 'F'], C: ['C', 'E', 'G'], C7: ['C', 'E', 'G', 'Bb'], Bbm: ['Bb', 'Db', 'F'],
    Am: ['A', 'C', 'E'], D7: ['D', 'F#', 'A', 'C'], Gm: ['G', 'Bb', 'D'], Dm: ['D', 'F', 'A'], A7: ['A', 'C#', 'E', 'G'],
    Edim: ['E', 'G', 'Bb'], Em: ['E', 'G', 'B'], B7: ['B', 'D#', 'F#', 'A'], G: ['G', 'B', 'D'], Bdim: ['B', 'D', 'F'],
  };

  // ======================= TITLE: "Sunset over the Sawgrass" =======================
  // 32 bars at 92 bpm:  A hopeful main melody in F · A' climbs, with a wistful bluesy turn · B the swamp turns dark
  // (D minor, a pulsing low bass, no hi-hats) · A" the melody returns and resolves home.
  const TITLE = {
    name: 'Sunset over the Sawgrass', bpm: 92, swing: 0.62, vol: 0.8,
    bars: [
      // A — hopeful
      ['F',   'C5:2 F5:2 A5:3 G5:1'], ['F',  'F5:2 C5:2 A4:4'],     ['Bb', 'D5:2 F5:2 Bb5:3 A5:1'], ['F',  'G5:2 F5:1 D5:1 C5:4'],
      ['C',   'E5:2 G5:2 C6:3 Bb5:1'], ['Bb', 'A5:2 G5:1 F5:1 D5:4'], ['F',  'C5:2 F5:2 A5:2 G5:2'],  ['C7', 'G5:6 r:2'],
      // A' — climbing, wistful
      ['F',   'C5:2 F5:2 A5:3 G5:1'], ['F',  'F5:2 A5:2 C6:4'],     ['Bb', 'D6:2 C6:1 Bb5:1 A5:2 Bb5:2'], ['Bbm', 'Db6:3 C6:1 Bb5:2 Ab5:2'],
      ['Am',  'A5:2 G5:1 F5:1 E5:2 F5:2'], ['D7', 'F#5:2 A5:2 D6:3 C6:1'], ['Gm|C7', 'Bb5:2 A5:1 G5:1 E5:2 G5:2'], ['F', 'F5:6 r:2'],
      // B — something moves in the water
      ['Dm',  'D5:3 E5:1 F5:2 A5:2'], ['Bb', 'Bb5:4 A5:2 F5:2'],     ['Gm', 'G5:3 F5:1 E5:2 D5:2'],  ['A7', 'C#5:4 E5:2 A4:2'],
      ['Dm',  'D5:2 F5:2 A5:2 D6:2'], ['Bb', 'C6:3 Bb5:1 A5:2 F5:2'], ['Gm', 'G5:2 Bb5:2 A5:2 G5:2'], ['C7', 'E5:4 G5:2 Bb5:2'],
      // A" — home again
      ['F',   'C5:2 F5:2 A5:3 G5:1'], ['F',  'F5:2 C5:2 A4:4'],     ['Bb', 'D5:2 F5:2 Bb5:3 A5:1'], ['F',  'G5:2 F5:1 D5:1 C5:4'],
      ['Dm',  'D5:2 F5:2 A5:2 C6:2'], ['Gm', 'Bb5:2 A5:2 G5:2 F5:2'], ['C7', 'E5:2 G5:2 Bb5:2 E5:2'],  ['F',  'F5:6 r:2'],
    ],
    scheduleBar(v, i, t) {
      const dark = i >= 16 && i < 24; // the B section
      const { chordAt } = v.bar(this.bars[i]);
      v.lead(this.bars[i][1], t, { vol: 0.045 });
      // bass (triangle): a walking root-fifth-octave line; long ominous roots in the dark section
      for (let b = 0; b < 4; b++) {
        const ch = chordAt(b * 2), root = ch[0], fifth = ch[2] || ch[1];
        const n = (dark ? [root, null, root, null] : [root, fifth, root, fifth])[b]; if (!n) continue;
        v.tone('triangle', freq(n, dark ? 2 : (b === 2 ? 3 : 2)), t + b * v.BEAT, dark ? v.BEAT * 1.8 : v.BEAT * 0.85, dark ? 0.16 : 0.13, { release: 0.06 });
      }
      v.arp(chordAt, t, dark ? 3 : 4, dark ? 0.012 : 0.014);
      // drums: soft kick on 1 and 3, brushy snare on 2 and 4, swung hats (no hats in the dark section, a heartbeat instead)
      for (let b = 0; b < 4; b++) {
        const tb = t + b * v.BEAT;
        if (b % 2 === 0) v.kick(tb, dark ? 0.2 : 0.14);
        else v.hit(tb, { vol: dark ? 0.025 : 0.04, dur: 0.12, hp: 1800 });
        if (!dark) v.hit(tb + v.BEAT * this.swing, { vol: 0.018, dur: 0.035 });
        else if (b === 1 || b === 3) v.tone('sine', 70, tb + v.BEAT * 0.35, 0.1, 0.12, { attack: 0.002, release: 0.04, slideTo: 38 });
      }
    },
  };

  // ======================= MATCH: "Tracking the River of Grass" =======================
  // 24 bars at 100 bpm, D minor. A: the title's rising shape turned minor, over a driving eighth-note bass ·
  // B: the hunt tightens — repeated notes climbing over Bb-C-Dm-A7, sixteenth hats · A': the motif returns and
  // hangs on A7, so the loop pulls straight back into the opening.
  const MATCH = {
    name: 'Tracking the River of Grass', bpm: 100, swing: 0.56, vol: 0.68,
    bars: [
      // A
      ['Dm', 'D5:1 r:1 A4:1 D5:1 E5:1 F5:2 E5:1'], ['Dm', 'D5:2 A4:2 F5:2 E5:2'], ['Bb', 'D5:1 r:1 Bb4:1 D5:1 F5:1 G5:2 F5:1'], ['C', 'E5:2 C5:2 G5:3 r:1'],
      ['Dm', 'A5:2 G5:1 F5:1 E5:2 F5:2'], ['Gm', 'G5:2 F5:1 E5:1 D5:2 Bb4:2'], ['A7', 'C#5:2 E5:2 G5:2 E5:2'], ['A7', 'A5:4 G5:1 F5:1 E5:2'],
      // B — tightening
      ['Bb', 'F5:1 F5:1 r:1 F5:1 G5:2 F5:2'], ['C', 'E5:1 E5:1 r:1 E5:1 G5:2 E5:2'], ['Dm', 'F5:1 F5:1 r:1 F5:1 A5:2 F5:2'], ['A7', 'E5:2 G5:2 C#6:2 A5:2'],
      ['Bb', 'D6:3 C6:1 Bb5:2 A5:2'], ['Gm', 'G5:3 F5:1 E5:2 D5:2'], ['Edim|A7', 'E5:2 G5:2 Bb5:2 C#6:2'], ['A7', 'E6:4 r:4'],
      // A'
      ['Dm', 'D5:1 r:1 A4:1 D5:1 E5:1 F5:2 E5:1'], ['Dm', 'D5:2 A4:2 F5:2 E5:2'], ['Bb', 'D5:1 r:1 Bb4:1 D5:1 F5:1 G5:2 F5:1'], ['C', 'E5:2 C5:2 G5:3 r:1'],
      ['Dm', 'A5:2 G5:1 F5:1 E5:2 F5:2'], ['Gm', 'Bb5:2 A5:1 G5:1 F5:2 E5:2'], ['Gm|A7', 'Bb5:2 A5:2 G5:2 E5:2'], ['A7', 'C#5:2 E5:2 A5:3 r:1'],
    ],
    scheduleBar(v, i, t) {
      const build = i >= 8 && i < 16;
      const { chordAt } = v.bar(this.bars[i]);
      v.lead(this.bars[i][1], t, { vol: 0.034 });
      // driving bass: eighth notes on the root, jumping an octave on the offbeats. Kept a little soft, with gentle
      // attacks and no overlap between notes: hard-attacked loud bass eighths crackled on phone speakers.
      for (let e = 0; e < 8; e++) {
        const ch = chordAt(e), n = (e === 6 && ch[2]) ? ch[2] : ch[0], len = (e % 2 ? 1 - this.swing : this.swing) * v.BEAT;
        v.tone('triangle', freq(n, e % 2 ? 3 : 2), t + v.at(e), len * 0.7, e % 2 ? 0.07 : 0.095, { attack: 0.012, release: 0.05 });
      }
      v.arp(chordAt, t, 4, build ? 0.013 : 0.01);
      // drums: kick on 1, 3 and the "and" of 4; snare on 2 and 4; straight-ish hats (sixteenths while building)
      for (let b = 0; b < 4; b++) {
        const tb = t + b * v.BEAT;
        if (b % 2 === 0) v.kick(tb, 0.15);
        else v.hit(tb, { vol: 0.045, dur: 0.11, hp: 1500 });
        v.hit(tb + v.BEAT * this.swing, { vol: 0.016, dur: 0.03 });
        if (build) { v.hit(tb + v.BEAT * 0.25, { vol: 0.01, dur: 0.02 }); v.hit(tb + v.BEAT * 0.78, { vol: 0.01, dur: 0.02 }); }
      }
      v.kick(t + 3 * v.BEAT + v.BEAT * this.swing, 0.1);
    },
  };

  // ======================= COOP: "Coils of the Anaconda" =======================
  // 16 bars at 112 bpm, E Phrygian (the flat second, F, is the snake). A low ostinato coils E-E-F-E under everything,
  // a lub-dub heartbeat kick, a hissing rattle. Bars 1-4 just the coil · 5-8 a slow lead that slides between notes ·
  // 9-12 it rises to the tritone (Bb) · 13-16 stabbing high notes, then the coil swallows it and starts again.
  const COOP = {
    name: 'Coils of the Anaconda', bpm: 112, swing: 0.5, vol: 0.6,
    bars: [
      ['Em', 'r:8'], ['F', 'r:8'], ['Em', 'r:8'], ['Dm|F', 'r:6 B4:2'],
      ['Em', 'E5:3 F5:1 E5:2 B4:2'], ['F', 'C5:3 B4:1 A4:2 B4:2'], ['Em', 'E5:3 F5:1 G5:2 F5:2'], ['F|Em', 'E5:6 r:2'],
      ['Em', 'B5:3 Bb5:1 A5:2 G5:2'], ['F', 'F5:2 E5:2 F5:2 G5:2'], ['Gm', 'Bb5:4 A5:2 F5:2'], ['F|Em', 'E5:6 r:2'],
      ['Em', 'E6:2 r:2 F6:2 r:2'], ['F', 'E6:1 D6:1 C6:1 B5:1 C6:2 B5:2'], ['Bdim', 'G5:2 F5:2 E5:2 F5:2'], ['F|Em', 'E5:4 r:4'],
    ],
    scheduleBar(v, i, t) {
      const intro = i < 4, climax = i >= 12;
      const { chordAt } = v.bar(this.bars[i]);
      // the lead slides into its long notes (a slithering bend)
      v.lead(this.bars[i][1], t, { vol: climax ? 0.04 : 0.034, slide: true });
      // the coil: E-E-F-E-E-E-G-F in low eighths, always the same, whatever the chord
      const COIL = ['E', 'E', 'F', 'E', 'E', 'E', 'G', 'F'];
      for (let e = 0; e < 8; e++) v.tone('triangle', freq(COIL[e], 2), t + v.at(e), v.BEAT * 0.4, 0.15, { attack: 0.003, release: 0.03 });
      // a dull low drone fifth under the intro, high dissonant stabs in the climax
      if (intro) v.tone('square', freq('B', 2), t, v.BAR * 0.95, 0.008, { attack: 0.4, release: 0.3 });
      if (climax) for (const n of chordAt(0)) v.tone('square', freq(n, 4), t, v.BEAT * 0.18, 0.012, { attack: 0.002, release: 0.05 });
      if (!intro) v.arp(chordAt, t, 3, 0.009);
      // heartbeat (lub-dub on 1 and 3), a rim click on 4, and the rattle: soft high noise on every sixteenth
      for (let b = 0; b < 4; b++) {
        const tb = t + b * v.BEAT;
        if (b % 2 === 0) { v.kick(tb, 0.2); v.kick(tb + v.BEAT * 0.28, 0.12); }
        if (b === 3) v.hit(tb, { vol: 0.035, dur: 0.05, hp: 3500 });
        for (let s = 0; s < 4; s++) v.hit(tb + s * v.BEAT / 4, { vol: s % 2 ? 0.006 : 0.011, dur: 0.025, hp: 7000 });
      }
    },
  };

  // ======================= the shared engine =======================
  function createTheme(getAC, song = TITLE) {
    const BEAT = 60 / song.bpm, BAR = 4 * BEAT;
    const at = e => Math.floor(e / 2) * BEAT + (e % 2 ? BEAT * song.swing : 0); // eighth e (0-7) in a bar
    let bus = null, timer = null, bar = 0, nextAt = 0, playing = false, noise = null, ac = null;

    const v = {
      BEAT, BAR, at,
      tone(type, f, t, dur, vol, { attack = 0.01, release = 0.08, vibrato = 0, slideTo = null, slideFrom = null } = {}) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type;
        if (slideFrom) { o.frequency.setValueAtTime(slideFrom, t); o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.12, dur * 0.5)); }
        else o.frequency.setValueAtTime(f, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        if (vibrato) { // gentle vibrato on long lead notes
          const lfo = ac.createOscillator(), lg = ac.createGain();
          lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * vibrato, t + Math.min(0.35, dur));
          lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + release);
        }
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        // (a ramp, not a jump: an instant gain step clicks, which small phone speakers turn into a crackle)
        g.gain.linearRampToValueAtTime(vol * 0.8, t + Math.max(attack + 0.005, dur - release));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
        o.connect(g).connect(bus); o.start(t); o.stop(t + dur + release + 0.02);
      },
      hit(t, { vol = 0.05, dur = 0.05, hp = 6000 } = {}) { // noise-channel drum
        if (!noise) {
          noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
          const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        s.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dur + 0.02);
      },
      kick(t, vol) { v.tone('sine', 120, t, 0.14, vol, { attack: 0.002, release: 0.05, slideTo: 42 }); },
      bar([chordSpec]) {
        const halves = chordSpec.split('|').map(c => CHORDS[c]);
        return { chordAt: e => halves[halves.length === 2 && e >= 4 ? 1 : 0] };
      },
      // the square-wave lead; long notes get vibrato, and with `slide` they bend up into pitch from a semitone below
      lead(melody, t, { vol = 0.045, slide = false } = {}) {
        let e = 0;
        for (const tok of melody.split(' ')) {
          const [n, len] = tok.split(':'); const L = +len;
          if (n !== 'r') {
            const start = t + at(e), end = t + (e + L >= 8 ? BAR : at(e + L)), f = noteFreq(n);
            v.tone('square', f, start, Math.max(0.08, end - start - 0.03), vol,
              { vibrato: L >= 3 ? 0.006 : 0, release: 0.1, slideFrom: slide && L >= 2 ? f * 0.944 : null });
          }
          e += L;
        }
      },
      // quiet pulse arpeggio through the chord, one note per eighth
      arp(chordAt, t, oct, vol) {
        const ARP = [0, 1, 2, 1, 0, 1, 2, 3];
        for (let k = 0; k < 8; k++) { const ch = chordAt(k); v.tone('square', freq(ch[ARP[k] % ch.length], oct), t + at(k), BEAT * 0.22, vol, { attack: 0.004, release: 0.05 }); }
      },
    };

    // Every song plays through a high-pass that removes rumble below ~40 Hz: phone speakers can't play it, but still
    // have to push it. (No compressor: the browser's adds its own make-up gain, which only makes things louder.)
    function output(ctx, dest) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40; hp.Q.value = 0.7;
      hp.connect(dest || ctx.destination);
      return hp;
    }
    function pump() {
      ac = getAC(); if (!ac || !playing) return;
      while (nextAt < ac.currentTime + 1.2) { song.scheduleBar(v, bar, nextAt); nextAt += BAR; bar = (bar + 1) % song.bars.length; }
    }
    return {
      get playing() { return playing; },
      song: song.name,
      // Render the whole song once into any audio context (e.g. an OfflineAudioContext, to test or export it).
      renderTo(ctx, dest) {
        ac = ctx; bus = ac.createGain(); bus.gain.value = song.vol; bus.connect(output(ac, dest));
        let t = 0.05; for (let i = 0; i < song.bars.length; i++) { song.scheduleBar(v, i, t); t += BAR; }
        return t;
      },
      start() {
        ac = getAC(); if (!ac || playing) return;
        playing = true;
        bus = ac.createGain(); bus.gain.setValueAtTime(0.0001, ac.currentTime);
        bus.gain.exponentialRampToValueAtTime(song.vol, ac.currentTime + 1.5); // fade in
        bus.connect(output(ac));
        bar = 0; nextAt = ac.currentTime + 0.15;
        pump(); timer = setInterval(pump, 250);
      },
      stop() {
        if (!playing) return;
        playing = false; clearInterval(timer); timer = null;
        const c = getAC(), b = bus; bus = null;
        if (c && b) { b.gain.cancelScheduledValues(c.currentTime); b.gain.setValueAtTime(b.gain.value, c.currentTime); b.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.8); setTimeout(() => b.disconnect(), 1000); }
      },
    };
  }
  root.EG_THEME = { createTheme, SONGS: { title: TITLE, match: MATCH, coop: COOP }, SONG: TITLE.bars, BPM: TITLE.bpm };
})(typeof window !== 'undefined' ? window : globalThis);
