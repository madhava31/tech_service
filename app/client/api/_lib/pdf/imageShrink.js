// Makes the logo and signature small before they go into a PDF. A logo printed about 6 cm wide does not need 2171 × 724 pixels:
// kept as uploaded, it added about 1 MB to every quotation, PO and PI PDF. Pure Node (zlib only), so it works on Vercel with no
// image package: a big PNG is decoded, scaled down to print size, reduced to a limited palette and written again as a PNG.
// JPEGs and anything unusual (interlaced, 16-bit) are used as they are. Results are remembered, so each image is done once.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Only images bigger than this are worked on; smaller ones are fine as they are. */
export const SHRINK_ABOVE_BYTES = 60 * 1024;

// ---- CRC32 (PNG chunks) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Decodes a non-interlaced 8-bit PNG to RGBA. Returns null for anything else. */
export function decodePng(buf) {
  if (!buf || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0 || !idat.length) return null;
  if (ihdr.w < 1 || ihdr.h < 1 || ihdr.w * ihdr.h > 40_000_000) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!channels || (ihdr.color === 3 && !palette)) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * channels;
  if (raw.length < (stride + 1) * ihdr.h) return null;

  // Undo the row filters.
  const px = Buffer.alloc(stride * ihdr.h);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f > 4) return null;
      px[dst + x] = v & 0xff;
    }
  }

  // To RGBA.
  const rgba = Buffer.alloc(ihdr.w * ihdr.h * 4);
  for (let i = 0, n = ihdr.w * ihdr.h; i < n; i++) {
    const o = i * 4;
    const s = i * channels;
    if (ihdr.color === 6) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = px[s + 3]; }
    else if (ihdr.color === 2) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = 255; }
    else if (ihdr.color === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = 255; }
    else if (ihdr.color === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = px[s + 1]; }
    else {
      const idx = px[s];
      rgba[o] = palette[idx * 3]; rgba[o + 1] = palette[idx * 3 + 1]; rgba[o + 2] = palette[idx * 3 + 2];
      rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { w: ihdr.w, h: ihdr.h, rgba };
}

/** Box-filter downscale (area average, alpha-weighted so transparent edges do not turn dark). */
export function downscale({ w, h, rgba }, maxW, maxH) {
  const k = Math.min(1, maxW / w, maxH / h);
  if (k >= 1) return { w, h, rgba };
  const nw = Math.max(1, Math.round(w * k));
  const nh = Math.max(1, Math.round(h * k));
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * w + xx) * 4;
          const al = rgba[o + 3];
          r += rgba[o] * al; g += rgba[o + 1] * al; b += rgba[o + 2] * al; a += al; n++;
        }
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { w: nw, h: nh, rgba: out };
}

/** Median-cut palette of at most `max` colours; alpha is kept as 0 or 255 for the palette entries (tRNS). */
export function quantize({ w, h, rgba }, max = 128) {
  const n = w * h;
  // Count colours on a 5-bit-per-channel grid, which is plenty for a logo and keeps the work small.
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const alpha = rgba[o + 3] < 128 ? 0 : 255;
    const key = alpha === 0 ? -1 : ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const hasTransparent = counts.has(-1);
  counts.delete(-1);
  let boxes = [[...counts.entries()].map(([key, c]) => ({ r: ((key >> 10) & 31) << 3 | 4, g: ((key >> 5) & 31) << 3 | 4, b: (key & 31) << 3 | 4, c }))];
  const budget = max - (hasTransparent ? 1 : 0);
  while (boxes.length < budget) {
    // Split the box with the widest colour range at the weighted median of that channel.
    let best = -1, bestRange = 0, bestCh = 'r';
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      for (const ch of ['r', 'g', 'b']) {
        let lo = 255, hi = 0;
        for (const p of bx) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch; }
      }
    });
    if (best < 0) break;
    const bx = boxes[best].sort((p, q) => p[bestCh] - q[bestCh]);
    const total = bx.reduce((a, p) => a + p.c, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < bx.length; i++) { acc += bx[i].c; if (acc >= total / 2) { cut = Math.min(Math.max(i + 1, 1), bx.length - 1); break; } }
    boxes.splice(best, 1, bx.slice(0, cut), bx.slice(cut));
  }
  const palette = boxes.map((bx) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (const p of bx) { r += p.r * p.c; g += p.g * p.c; b += p.b * p.c; c += p.c; }
    return c ? [Math.round(r / c), Math.round(g / c), Math.round(b / c)] : [0, 0, 0];
  });
  const transparentIndex = hasTransparent ? palette.length : -1;
  if (hasTransparent) palette.push([255, 255, 255]);
  // Map every pixel to its nearest palette colour (cached per grid colour).
  const cache = new Map();
  const nearest = (r, g, b) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < (hasTransparent ? palette.length - 1 : palette.length); i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const indices = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) { indices[i] = transparentIndex; continue; }
    const key = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3);
    let idx = cache.get(key);
    if (idx === undefined) { idx = nearest(rgba[o], rgba[o + 1], rgba[o + 2]); cache.set(key, idx); }
    indices[i] = idx;
  }
  return { palette, indices, transparentIndex };
}

/** Writes an 8-bit indexed PNG. */
export function encodeIndexedPng(w, h, { palette, indices, transparentIndex }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((p, i) => { plte[i * 3] = p[0]; plte[i * 3 + 1] = p[1]; plte[i * 3 + 2] = p[2]; });
  // Filter 1 (Sub) on every row compresses flat logo areas well.
  const rows = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w + 1)] = 1;
    for (let x = 0; x < w; x++) rows[y * (w + 1) + 1 + x] = (indices[y * w + x] - (x > 0 ? indices[y * w + x - 1] : 0)) & 0xff;
  }
  const parts = [PNG_SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (transparentIndex >= 0) {
    const t = Buffer.alloc(transparentIndex + 1, 255);
    t[transparentIndex] = 0;
    parts.push(chunk('tRNS', t));
  }
  parts.push(chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** The PNG at print size and with a small palette, or null when it cannot be made smaller. */
export function shrinkPng(buf, { maxWidth, maxHeight }) {
  const img = decodePng(buf);
  if (!img) return null;
  const small = downscale(img, maxWidth, maxHeight);
  const out = encodeIndexedPng(small.w, small.h, quantize(small, 128));
  return out.length < buf.length ? out : null;
}

const remembered = new Map();
/**
 * An image for a PDF: a data URI (or bytes) in, bytes out. A PNG over 60 KB is shrunk to fit maxWidth × maxHeight (pixels,
 * about twice the printed size, so it stays sharp) with a small palette. Any other image, or any failure, returns the
 * original bytes, so a PDF is never held up by this.
 */
export function pdfImageBytes(source, { maxWidth = 700, maxHeight = 260 } = {}) {
  try {
    const original = Buffer.isBuffer(source) ? source : null;
    if (!original) return null;
    if (original.length <= SHRINK_ABOVE_BYTES) return original;
    const key = `${maxWidth}x${maxHeight}:${crypto.createHash('sha1').update(original).digest('hex')}`;
    if (remembered.has(key)) return remembered.get(key);
    const small = shrinkPng(original, { maxWidth, maxHeight }) || original;
    if (remembered.size > 20) remembered.clear();
    remembered.set(key, small);
    return small;
  } catch (err) {
    console.error('[pdf] could not shrink an image, using it as it is:', err?.message);
    return Buffer.isBuffer(source) ? source : null;
  }
}
