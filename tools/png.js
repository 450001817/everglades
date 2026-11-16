// Tiny PNG reader/writer for the art tools (Node only, no packages): 8-bit RGB/RGBA/palette, non-interlaced.
// read(file) -> { w, h, data: Uint8Array RGBA }; write(file, { w, h, data }); scale(img, k) -> nearest-neighbour.
'use strict';
const fs = require('fs'), zlib = require('zlib');

function read(file) {
  const b = fs.readFileSync(file);
  let p = 8, w, h, depth, type, inter, plte = null, trns = null; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), c = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = c.readUInt32BE(0); h = c.readUInt32BE(4); depth = c[8]; type = c[9]; inter = c[12]; }
    else if (t === 'PLTE') plte = c; else if (t === 'tRNS') trns = c; else if (t === 'IDAT') idat.push(c);
    p += 12 + len;
  }
  if (depth !== 8 || inter) throw new Error(file + ': only 8-bit non-interlaced PNGs');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y ? px[(y - 1) * stride + x] : 0, ul = y && x >= ch ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - ul, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      px[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (type === 6) { data[o] = px[s]; data[o + 1] = px[s + 1]; data[o + 2] = px[s + 2]; data[o + 3] = px[s + 3]; }
    else if (type === 2) { data[o] = px[s]; data[o + 1] = px[s + 1]; data[o + 2] = px[s + 2]; data[o + 3] = 255; }
    else if (type === 3) { const k = px[s]; data[o] = plte[k * 3]; data[o + 1] = plte[k * 3 + 1]; data[o + 2] = plte[k * 3 + 2]; data[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (type === 0) { data[o] = data[o + 1] = data[o + 2] = px[s]; data[o + 3] = 255; }
    else { data[o] = data[o + 1] = data[o + 2] = px[s]; data[o + 3] = px[s + 1]; }
  }
  return { w, h, data };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function write(file, { w, h, data }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
// Lossless palette PNG (colour type 3) for an image with at most 256 distinct colours (alpha included); returns
// false (writes nothing) if it has more. Each row uses whichever PNG filter makes it smallest, then the strongest
// zlib level: pixel art usually comes out several times smaller, with every pixel identical.
function writeIndexed(file, { w, h, data }) {
  const index = new Map(), pal = [];
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = ((data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | data[i * 4 + 3]) >>> 0;
    let n = index.get(k);
    if (n === undefined) { if (pal.length === 256) return false; n = pal.length; index.set(k, n); pal.push(k); }
    idx[i] = n;
  }
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    const row = idx.subarray(y * w, (y + 1) * w), up = y ? idx.subarray((y - 1) * w, y * w) : new Uint8Array(w);
    let best = null, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(w);
      for (let x = 0; x < w; x++) {
        const a = x ? row[x - 1] : 0, b = up[x], c = x ? up[x - 1] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        out[x] = (row[x] - p) & 255;
      }
      let score = 0; for (const v of out) score += v < 128 ? v : 256 - v; // the usual "smallest sum" heuristic
      if (score < bestScore) { bestScore = score; best = [f, out]; }
    }
    raw[y * (w + 1)] = best[0]; best[1].copy(raw, y * (w + 1) + 1);
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 3;
  const plte = Buffer.alloc(pal.length * 3), trns = Buffer.alloc(pal.length);
  pal.forEach((k, i) => { plte[i * 3] = k >>> 24; plte[i * 3 + 1] = (k >>> 16) & 255; plte[i * 3 + 2] = (k >>> 8) & 255; trns[i] = k & 255; });
  const opaque = pal.every(k => (k & 255) === 255);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('PLTE', plte),
    ...(opaque ? [] : [chunk('tRNS', trns)]), chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]));
  return true;
}
function scale(img, k) {
  const W = img.w * k, H = img.h * k, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((y / k | 0) * img.w + (x / k | 0)) * 4, o = (y * W + x) * 4; data.set(img.data.subarray(s, s + 4), o); }
  return { w: W, h: H, data };
}
function crop(img, x0, y0, w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4), y * w * 4);
  return { w, h, data };
}
module.exports = { read, write, writeIndexed, scale, crop };
