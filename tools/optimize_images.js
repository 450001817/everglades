// Shrinks every PNG under public/assets losslessly. Run: node tools/optimize_images.js
// Each image is re-encoded as a palette PNG when it has at most 256 colours (most of the pixel art), otherwise as a
// full-colour PNG with the best filter chosen row by row. The result is decoded and compared pixel for pixel with
// the original, and only replaces it when every pixel is identical and the file is smaller. Safe to run again
// (after redrawing art with the other tools, for example): files that can't get smaller are left alone.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const P = require('./png.js');

const ROOT = path.join(__dirname, '..', 'public', 'assets');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.png')) files.push(p); } })(ROOT);

// full-colour PNG with each row's filter chosen to compress best
function writeFiltered(file, { w, h, data }) {
  const bpp = 4, stride = w * bpp, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride), up = y ? data.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let best = null, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0, b = up[x], c = x >= bpp ? up[x - bpp] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        out[x] = (row[x] - p) & 255;
      }
      let score = 0; for (const v of out) score += v < 128 ? v : 256 - v;
      if (score < bestScore) { bestScore = score; best = [f, out]; }
    }
    raw[y * (stride + 1)] = best[0]; best[1].copy(raw, y * (stride + 1) + 1);
  }
  const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = buf => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const same = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.data.buffer, a.data.byteOffset, a.data.length), Buffer.from(b.data.buffer, b.data.byteOffset, b.data.length)) === 0;
let before = 0, after = 0, changed = 0, skipped = 0;
for (const file of files) {
  const size = fs.statSync(file).size; before += size;
  let img;
  try { img = P.read(file); } catch (e) { console.log('  skip (unsupported):', path.relative(ROOT, file), e.message); after += size; skipped++; continue; }
  const tmp = file + '.opt', tries = [];
  if (P.writeIndexed(tmp, img)) tries.push(fs.readFileSync(tmp));
  writeFiltered(tmp, img); tries.push(fs.readFileSync(tmp));
  fs.unlinkSync(tmp);
  const bestBuf = tries.sort((a, b) => a.length - b.length)[0];
  if (bestBuf.length >= size * 0.98) { after += size; continue; }
  fs.writeFileSync(tmp, bestBuf);
  const check = P.read(tmp);
  if (!same(check, img)) { fs.unlinkSync(tmp); console.log('  NOT identical, kept original:', path.relative(ROOT, file)); after += size; continue; }
  fs.renameSync(tmp, file); after += bestBuf.length; changed++;
}
console.log(`${files.length} images, ${changed} made smaller, ${skipped} skipped: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (every pixel identical)`);
