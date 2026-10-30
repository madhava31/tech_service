// Technicon Services ERP - PDF rupee sign regression test (no database, no network)
// Run via: node app/client/scripts/test-pdf-rupee.mjs
// Optional: PDF_OUT=<folder> also writes the three generated PDFs there for a visual check.
//
// PDF's built-in Helvetica only covers WinAnsi, so '₹' (U+20B9) was written as the bytes 0x20 0xB9
// and rendered as a space plus '¹' wherever no Windows Arial was installed (i.e. on Vercel). The
// quotation / purchase order / proforma invoice PDFs must embed the bundled Arimo font and map '₹'
// to a real glyph.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(APP, 'package.json'));
const fontkit = req('fontkit');
const PDFDocument = req('pdfkit');
const pdf = await import(pathToFileURL(path.join(APP, 'api/_lib/pdf/documents.js')).href);

const items = [
  { part_no: 'N9307810', description: 'Pump Assembly', hsn_sac: '8413', make: 'PerkinElmer', qty: 1, price: 10000, amount: 10000 },
  { part_no: 'N9300120', description: 'Seal Kit', hsn_sac: '4016', make: 'PerkinElmer', qty: 2, price: 4500, amount: 9000 },
];
const party = {
  number: 'QTN2627/42', date: '2026-10-30', company_name: 'Acme Labs', company_state: 'Telangana',
  subtotal: 19000, tax_percent: 18, discount_type: 'none', discount_percent: 0, discount_amount: 0,
  taxable_amount: 19000, round_off: 0.0, total: 22420, created_by_username: 'tester',
  quotation_number: 'QTN2627/42', po_number: 'PO2627/7', client_po_ref: 'CL-1',
};

function render(fn) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    fn(out);
  });
}

// Every font named in the PDF, plus the decompressed contents of all streams (ToUnicode CMaps).
function inspect(buf) {
  const s = buf.toString('latin1');
  const baseFonts = [...s.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]);
  const streams = [];
  const re = /(?<!end)stream\r?\n/g; // a stream start, not the tail of "endstream"
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    try { streams.push(zlib.inflateSync(raw).toString('latin1')); } catch { streams.push(raw.toString('latin1')); }
    re.lastIndex = end;
  }
  // ToUnicode CMaps map glyph ids to Unicode, e.g. "<0012> <20b9>"
  const rupeeMapped = streams.some((t) => /beginbfchar|beginbfrange/.test(t) && /<20b9>/i.test(t));
  return { baseFonts, rupeeMapped };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const outDir = process.env.PDF_OUT;
const DOCS = [
  ['quotation', (res) => pdf.streamQuotationPdf(res, { quotation: party, items, settings: {} })],
  ['purchase order', (res) => pdf.streamPurchaseOrderPdf(res, { po: party, items, settings: {} })],
  ['proforma invoice', (res) => pdf.streamPerformaInvoicePdf(res, { pi: party, items, settings: {} })],
];

await test('bundled Arimo fonts exist and contain the rupee glyph', async () => {
  for (const f of [pdf.FONT_REGULAR_PATH, pdf.FONT_BOLD_PATH]) {
    assert.ok(fs.existsSync(f), `missing ${f}`);
    assert.ok(fontkit.openSync(f).hasGlyphForCodePoint(0x20b9), `${path.basename(f)} has no U+20B9 glyph`);
  }
  assert.ok(fs.existsSync(path.join(path.dirname(pdf.FONT_REGULAR_PATH), 'OFL.txt')), 'font licence (OFL.txt) missing');
});

await test('control: the checker detects the old Helvetica failure', async () => {
  const buf = await render((out) => { const d = new PDFDocument(); d.pipe(out); d.font('Helvetica').text('₹ 10,000.00'); d.end(); });
  const r = inspect(buf);
  assert.ok(r.baseFonts.includes('Helvetica'));
  assert.strictEqual(r.rupeeMapped, false, 'Helvetica must not be reported as mapping the rupee sign');
});

for (const [name, fn] of DOCS) {
  await test(`${name} PDF embeds Arimo (no Helvetica) and maps '₹' to a real glyph`, async () => {
    const buf = await render(fn);
    if (outDir) fs.writeFileSync(path.join(outDir, `${name.replace(/ /g, '-')}.pdf`), buf);
    assert.ok(buf.subarray(0, 5).toString() === '%PDF-', 'not a PDF');
    const r = inspect(buf);
    assert.ok(r.baseFonts.some((f) => /\+Arimo-Regular$/.test(f)), `Arimo-Regular not embedded: ${r.baseFonts.join(', ')}`);
    assert.ok(r.baseFonts.some((f) => /\+Arimo-Bold$/.test(f)), `Arimo-Bold not embedded: ${r.baseFonts.join(', ')}`);
    assert.ok(!r.baseFonts.some((f) => /Helvetica/.test(f)), `Helvetica still used: ${r.baseFonts.join(', ')}`);
    assert.ok(r.rupeeMapped, "no ToUnicode mapping for '₹' (U+20B9) in the PDF");
  });
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} PDF RUPEE TESTS PASSED`);
process.exit(failed ? 1 : 0);
