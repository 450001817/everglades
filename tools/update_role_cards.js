// Rewrites the rules text on role cards for new objectives / abilities (Nov 2026: Land Developer and Tourist).
//  * Right page (objectives): the old text is cleared and new lines are set in the cards' own lettering, cut letter
//    by letter from the objectives printed on all six role cards (tools/role_card_glyphs.js). "15pts:" style labels
//    in red, the rest in black.
//  * Left page (start-of-turn ability), when given: the body under the red heading is redrawn in the hand-made pixel
//    font (tools/pixelfont.py), as on the Conservationist, Fisherman and Hunter cards.
// Works on the original card images (in git: git show 920d2e8:public/assets/cards/roles/<Role>.png for all six), so it can't be run twice on its own output.
// Usage: node tools/update_role_cards.js <folder with all six original role cards> <output folder>
// After replacing a role card, bump CARD_V in public/data.js so browsers fetch the new image.
'use strict';
const fs = require('fs'), path = require('path');
const PNG = require('./png.js');
const G = require('./role_card_glyphs.js');
const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: node tools/update_role_cards.js <original cards folder> <out folder>'); process.exit(1); }

const RED = [237, 28, 36], BLACK = [0, 0, 0], PAPER = G.PAPER;
// Each objective: its red label, then its words (wrapped by hand to fit the page, about 460 px wide).
const CARDS = {
  Conservationist: {
    pitch: 37,
    objectives: [
      ['15pts:', 'For each map', 'objective met.'],
      ['15pts:', 'If the total', 'population majority is', 'Native.'],
      ['15pts:', 'If you never trigger', 'an Invasive crisis.'],
    ],
    redraw: ['15pts: If you never trigger'], // the printed "trigger" had a broken r and i
  },
  LandDeveloper: {
    pitch: 37,
    objectives: [
      ['5pts:', 'For each map', 'objective met.'],
      ['15pts:', 'If there is no', 'population in at least', 'two regions.'],
      ['10pts:', 'If you trigger the', 'most Invasive crises.'],
    ],
  },
  Tourist: {
    pitch: 33, top: -4, // 8 lines instead of 7: a little tighter, and starting 4 px higher, to stay clear of the map
    objectives: [
      ['5pts:', 'For each map', 'objective met.'],
      ['10pts:', 'If there is at least 1', 'population in each of', 'your map objectives.'],
      ['20pts:', 'If you did not win', 'any tricks outside of', 'your objective regions.'],
    ],
    ability: ['Look at the top 2', 'cards of the Travel', 'deck and put 1 on', 'the bottom.'],
  },
};

// ---------- the hand-made pixel font (left page), read from pixelfont.py ----------
const PF = {};
for (const line of fs.readFileSync(path.join(__dirname, 'pixelfont.py'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*(['"])(.+?)\1:\s*(\[.*\]),?\s*$/.exec(line);
  if (m) PF[m[2]] = JSON.parse(m[3]);
}
const pfGlyph = ch => { const rows = PF[ch]; if (!rows) throw new Error('no pixel-font glyph for ' + JSON.stringify(ch)); const w = rows[0].length; return { w, bits: rows.map(r => [...r.padEnd(w, '.')].map(c => c === '#')) }; };
const pfWidth = (t, s) => [...t].reduce((x, ch) => x + (ch === ' ' ? 3 : pfGlyph(ch).w + 1) * s, 0) - s;
function pfDraw(img, x, y, text, s, rgb) {
  for (const ch of text) {
    if (ch === ' ') { x += 3 * s; continue; }
    const g = pfGlyph(ch);
    g.bits.forEach((row, r) => row.forEach((on, c) => { if (on) fill(img, x + c * s, y + r * s, x + (c + 1) * s - 1, y + (r + 1) * s - 1, rgb); }));
    x += (g.w + 1) * s;
  }
}
function fill(img, x0, y0, x1, y1, rgb) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * img.w + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255; }
}

const lib = G.buildLibrary(srcDir); // (letters from all six original cards in the source folder)
fs.mkdirSync(outDir, { recursive: true });
for (const [role, spec] of Object.entries(CARDS)) {
  const img = PNG.read(path.join(srcDir, role + '.png'));
  const card = G.readCard(path.join(srcDir, role + '.png'));
  // the original lines (pixels, and where each one's baseline is), so unchanged lines are copied exactly
  const orig = PNG.read(path.join(srcDir, role + '.png')), oldText = G.TEXT[role];
  const oldLines = card.lines.slice(0, oldText.length).map(([a, b], i) => ({ a, b, base: G.baselineOf(card, a, b), text: oldText[i] }));
  const base0 = oldLines[0].base + (spec.top || 0); // the first line stays where it is (unless moved up)
  // clear the old objectives text
  G.erase(img, G.BOX.x0, G.BOX.y0 - 2, 1006, 336);
  // set the new lines: an unchanged line is copied from the original; a new one is set letter by letter
  const x0 = 545; let line = 0;
  for (const [label, ...rest] of spec.objectives) {
    rest.forEach((words, k) => {
      const y = base0 + line * spec.pitch, full = k === 0 ? label + ' ' + words : words;
      const same = !(spec.redraw || []).includes(full) && oldLines.find(o => o.text === full);
      if (same) {
        for (let yy = same.a - 1; yy <= same.b + 1; yy++) for (let xx = G.BOX.x0; xx <= 1006; xx++) {
          const si = (yy * orig.w + xx) * 4, di = ((yy - same.base + y) * img.w + xx) * 4;
          for (let c = 0; c < 4; c++) img.data[di + c] = orig.data[si + c];
        }
      } else {
        let x = x0;
        if (k === 0) { x = G.draw(img, lib, label, x, y, RED); x += lib.metrics.label - lib.metrics.gap; }
        const end = G.draw(img, lib, words, x, y, BLACK);
        if (end > 1008) throw new Error(`${role}: "${words}" runs off the page (to x ${end})`);
      }
      line++;
    });
  }
  const lastBase = base0 + (line - 1) * spec.pitch;
  if (lastBase + 9 > 337) throw new Error(`${role}: the text runs into the map (last baseline ${lastBase})`);
  // the left page's ability text, under the red START OF TURN: heading
  if (spec.ability) {
    G.erase(img, 30, 479, 494, 660);
    let y = 498;
    for (const t of spec.ability) {
      const w = pfWidth(t, 4); if (w > 450) throw new Error(`${role}: ability line too wide: ${t}`);
      pfDraw(img, 262 - Math.floor(w / 2), y, t, 4, BLACK); y += 40;
    }
  }
  PNG.write(path.join(outDir, role + '.png'), img);
  console.log('wrote', role, `(${line} objective lines, pitch ${spec.pitch})`);
}
