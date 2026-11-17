// Draws the pixel-art leaves for the "Fall leaves" splash effect (playSplash in public/client.js).
// Sheet: 3 leaf shapes (columns: maple, oak, elm) x 4 autumn colours (rows: red, orange, gold, brown), 9x9 px each.
// Usage: node tools/make_leaf_sprites.js   (writes public/assets/splash/leaves.png)
'use strict';
const path = require('path'), fs = require('fs');
const PNG = require('./png.js');

// o = outline (dark), # = leaf, + = highlight / vein, s = stem, . = empty
const SHAPES = {
  maple: [
    '....o....',
    '.o..#..o.',
    '.#o.#.o#.',
    'o##o#o##o',
    '.o##+##o.',
    'o###+###o',
    '.oo#+#oo.',
    '...o+o...',
    '....s....',
  ],
  oak: [
    '...o#o...',
    '..o##+o..',
    '.o#+##o..',
    '..o##+#o.',
    '.o#+###o.',
    '..o##+#o.',
    '...o#+o..',
    '....o+...',
    '....s....',
  ],
  elm: [
    '....o....',
    '...o#o...',
    '..o#+#o..',
    '.o##+##o.',
    '.o##+##o.',
    '.o##+##o.',
    '..o#+#o..',
    '...o+o...',
    '....s....',
  ],
};
const COLOURS = [ // [outline, leaf, highlight, stem]
  ['#6b1a12', '#c8371f', '#f06a3a', '#4a2a14'], // red
  ['#7a3410', '#e2731c', '#ffa646', '#4a2a14'], // orange
  ['#7a5a0e', '#e0ae22', '#ffe066', '#4a2a14'], // gold
  ['#3e2412', '#8a5a2b', '#c08a4c', '#2e1a0b'], // brown
];
const S = 9, cols = Object.keys(SHAPES);
const img = { w: S * cols.length, h: S * COLOURS.length, data: new Uint8Array(S * cols.length * S * COLOURS.length * 4) };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
COLOURS.forEach((pal, row) => cols.forEach((name, col) => {
  SHAPES[name].forEach((line, y) => {
    if (line.length !== S) throw new Error(`${name} row ${y} is not ${S} wide`);
    [...line].forEach((ch, x) => {
      const k = { o: 0, '#': 1, '+': 2, s: 3 }[ch]; if (k === undefined) return;
      img.data.set(hex(pal[k]), ((row * S + y) * img.w + col * S + x) * 4);
    });
  });
}));
const out = path.join(__dirname, '..', 'public', 'assets', 'splash', 'leaves.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
PNG.write(out, img);
console.log('wrote', out, `${img.w}x${img.h}`);
