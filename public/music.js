// Everglades — title theme. An original 8-bit tune, synthesized live with the Web Audio API (no audio files).
//
// "Sunset over the Sawgrass" — 32 bars at 92 bpm with a lazy swing:
//   A  (bars 1-8)   the hopeful main melody in F major
//   A' (bars 9-16)  the melody climbs, with a wistful bluesy turn (B-flat minor, D7)
//   B  (bars 17-24) the swamp turns dark: D minor, a pulsing low bass, no hi-hats
//   A" (bars 25-32) the melody returns and resolves home, then the whole song loops
// Voices: square-wave lead, triangle bass, quiet pulse arpeggios, noise-channel drums.
// To change the tune, edit SONG below: each bar is [chord(s), melody], the melody in eighth notes.
(function (root) {
  'use strict';
  const BPM = 92, BEAT = 60 / BPM, SWING = 0.62;     // offbeat eighths land 62% through the beat
  const VOL = 0.8;                                   // overall music volume (sound effects are separate)

  // [chords, melody]  chords: one per bar, or "Gm|C7" for two halves.  melody: "note:eighths ..."  (r = rest)
  const SONG = [
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
  ];
  const DARK = bar => bar >= 16 && bar < 24;         // the B section

  const CHORDS = {
    F: ['F', 'A', 'C'], Bb: ['Bb', 'D', 'F'], C: ['C', 'E', 'G'], C7: ['C', 'E', 'G', 'Bb'], Bbm: ['Bb', 'Db', 'F'],
    Am: ['A', 'C', 'E'], D7: ['D', 'F#', 'A', 'C'], Gm: ['G', 'Bb', 'D'], Dm: ['D', 'F', 'A'], A7: ['A', 'C#', 'E', 'G'],
  };
  const SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const freq = (name, oct) => 440 * Math.pow(2, (SEMI[name] + 12 * (oct + 1) - 69) / 12);
  const noteFreq = n => { const m = /^([A-G][b#]?)(\d)$/.exec(n); return freq(m[1], +m[2]); };
  // time of eighth-note e (0-7) inside a bar, with swing
  const at = e => Math.floor(e / 2) * BEAT + (e % 2 ? BEAT * SWING : 0);
  const BAR = 4 * BEAT;

  function createTheme(getAC) {
    let bus = null, timer = null, bar = 0, nextAt = 0, playing = false, noise = null;

    function tone(ac, type, f, t, dur, vol, { attack = 0.01, release = 0.08, vibrato = 0, slideTo = null } = {}) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      if (vibrato) { // gentle vibrato on long lead notes
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * vibrato, t + Math.min(0.35, dur));
        lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + release);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.setValueAtTime(vol * 0.8, t + Math.max(attack, dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
      o.connect(g).connect(bus); o.start(t); o.stop(t + dur + release + 0.02);
    }
    function hit(ac, t, { vol = 0.05, dur = 0.05, hp = 6000 } = {}) { // noise-channel drum
      if (!noise) {
        noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dur + 0.02);
    }

    function scheduleBar(ac, i, t) {
      const [chordSpec, melody] = SONG[i];
      const halves = chordSpec.split('|').map(c => CHORDS[c]);
      const chordAt = e => halves[halves.length === 2 && e >= 4 ? 1 : 0];
      const dark = DARK(i);
      // lead melody (square wave)
      let e = 0;
      for (const tok of melody.split(' ')) {
        const [n, len] = tok.split(':'); const L = +len;
        if (n !== 'r') {
          const start = t + at(e), end = t + (e + L >= 8 ? BAR : at(e + L));
          tone(ac, 'square', noteFreq(n), start, Math.max(0.08, end - start - 0.03), 0.045, { vibrato: L >= 3 ? 0.006 : 0, release: 0.1 });
        }
        e += L;
      }
      // bass (triangle): a walking root-fifth-octave line; long ominous roots in the dark section
      for (let b = 0; b < 4; b++) {
        const ch = chordAt(b * 2), root = ch[0], fifth = ch[2] || ch[1];
        const pattern = dark ? [root, null, root, null] : [root, fifth, root, fifth];
        const n = pattern[b]; if (!n) continue;
        const oct = dark ? 2 : (b === 2 ? 3 : 2);
        tone(ac, 'triangle', freq(n, oct), t + b * BEAT, dark ? BEAT * 1.8 : BEAT * 0.85, dark ? 0.16 : 0.13, { release: 0.06 });
      }
      // arpeggio shimmer (quiet pulse), swung eighths through the chord
      const ARP = [0, 1, 2, 1, 0, 1, 2, 3];
      for (let k = 0; k < 8; k++) {
        const ch = chordAt(k), n = ch[ARP[k] % ch.length];
        tone(ac, 'square', freq(n, dark ? 3 : 4), t + at(k), BEAT * 0.22, dark ? 0.012 : 0.014, { attack: 0.004, release: 0.05 });
      }
      // drums: soft kick on 1 and 3, brushy snare on 2 and 4, swung hats (no hats in the dark section, a heartbeat instead)
      for (let b = 0; b < 4; b++) {
        const tb = t + b * BEAT;
        if (b % 2 === 0) tone(ac, 'sine', 120, tb, 0.14, dark ? 0.2 : 0.14, { attack: 0.002, release: 0.05, slideTo: 42 });
        else hit(ac, tb, { vol: dark ? 0.025 : 0.04, dur: 0.12, hp: 1800 });
        if (!dark) { hit(ac, tb + BEAT * SWING, { vol: 0.018, dur: 0.035 }); }
        else if (b === 1 || b === 3) tone(ac, 'sine', 70, tb + BEAT * 0.35, 0.1, 0.12, { attack: 0.002, release: 0.04, slideTo: 38 });
      }
    }

    function pump() {
      const ac = getAC(); if (!ac || !playing) return;
      while (nextAt < ac.currentTime + 1.2) { scheduleBar(ac, bar, nextAt); nextAt += BAR; bar = (bar + 1) % SONG.length; }
    }

    return {
      get playing() { return playing; },
      // Render the whole song once into any audio context (e.g. an OfflineAudioContext, to test or export it).
      renderTo(ac, dest) {
        bus = ac.createGain(); bus.gain.value = VOL; bus.connect(dest || ac.destination);
        let t = 0.05; for (let i = 0; i < SONG.length; i++) { scheduleBar(ac, i, t); t += BAR; }
        return t;
      },
      start() {
        const ac = getAC(); if (!ac || playing) return;
        playing = true;
        bus = ac.createGain(); bus.gain.setValueAtTime(0.0001, ac.currentTime);
        bus.gain.exponentialRampToValueAtTime(VOL, ac.currentTime + 1.5); // fade in
        bus.connect(ac.destination);
        bar = 0; nextAt = ac.currentTime + 0.15;
        pump(); timer = setInterval(pump, 250);
      },
      stop() {
        if (!playing) return;
        playing = false; clearInterval(timer); timer = null;
        const ac = getAC(), b = bus; bus = null;
        if (ac && b) { b.gain.cancelScheduledValues(ac.currentTime); b.gain.setValueAtTime(b.gain.value, ac.currentTime); b.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.8); setTimeout(() => b.disconnect(), 1000); }
      },
    };
  }
  root.EG_THEME = { createTheme, SONG, BPM };
})(window);
