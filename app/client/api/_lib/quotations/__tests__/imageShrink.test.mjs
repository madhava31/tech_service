// The logo and signature are shrunk to print size before they go into a PDF. Run with:  npm --prefix app/client run test:po
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { decodePng, shrinkPng, pdfImageBytes, SHRINK_ABOVE_BYTES } = await import('../../pdf/imageShrink.js');
const { imageBuffer } = await import('../../pdf/documents.js');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'latin1'); data.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + data.length)), 8 + data.length); return o; };

/** A test PNG (RGB or RGBA, unfiltered rows): a coloured gradient with noise, so it is big like a real logo. */
function makePng(w, h, { alpha = false } = {}) {
  const ch = alpha ? 4 : 3;
  const rows = Buffer.alloc((w * ch + 1) * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 40);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * ch + 1) + 1 + x * ch;
      rows[o] = (x * 255) / w + rnd();
      rows[o + 1] = (y * 255) / h + rnd();
      rows[o + 2] = 120 + rnd();
      if (alpha) rows[o + 3] = x < w / 4 ? 0 : 255; // the left quarter is transparent
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

describe('shrinking a PNG for a PDF', () => {
  test('a big logo becomes print size and far smaller, and is still a PNG we can read', () => {
    const big = makePng(1600, 500);
    assert.ok(big.length > SHRINK_ABOVE_BYTES, `test image is ${big.length} bytes`);
    const small = shrinkPng(big, { maxWidth: 700, maxHeight: 260 });
    assert.ok(small, 'a smaller image was made');
    assert.ok(small.length < big.length / 3, `${small.length} vs ${big.length}`);
    const img = decodePng(small);
    assert.ok(img, 'the result is a valid PNG that decodes again');
    assert.deepEqual([img.w, img.h], [700, 219]);
    assert.deepEqual([...small.subarray(0, 8)], [...SIG]);
    assert.equal(small.readUInt32BE(16), 700, 'width scaled to fit');
    assert.equal(small.readUInt32BE(20), 219, 'height keeps the proportions');
    assert.equal(small[25], 3, 'indexed colour');
  });

  test('transparency is kept (a palette entry marked transparent)', () => {
    const small = shrinkPng(makePng(1400, 500, { alpha: true }), { maxWidth: 700, maxHeight: 260 });
    assert.ok(small);
    assert.ok(small.includes(Buffer.from('tRNS')), 'a transparency chunk is written');
  });

  test('an image that is already small is left alone', () => {
    const tiny = makePng(40, 20);
    assert.ok(tiny.length < SHRINK_ABOVE_BYTES);
    assert.equal(pdfImageBytes(tiny), tiny);
  });

  test('a JPEG, or bytes that are not an image, come back unchanged and nothing throws', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100 * 1024, 1)]);
    assert.equal(pdfImageBytes(jpeg), jpeg);
    const junk = Buffer.alloc(100 * 1024, 9);
    assert.equal(pdfImageBytes(junk), junk);
    const broken = Buffer.concat([makePng(1600, 500).subarray(0, 50000)]);
    assert.ok(pdfImageBytes(broken).length > 0);
  });

  test('imageBuffer (used by every PDF) shrinks a big PNG data URI and ignores other values', () => {
    const big = makePng(1600, 500);
    const out = imageBuffer(`data:image/png;base64,${big.toString('base64')}`);
    assert.ok(out.length < big.length / 3);
    assert.equal(imageBuffer('not a data uri'), null);
    assert.equal(imageBuffer(null), null);
  });
});
