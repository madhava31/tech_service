// Sent PO text pasted from Excel or Word (tabs, invisible characters) and keeping the PDF on one page.
// Run with:  npm --prefix app/client run test:sentpo
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { poFigures } = await import('../calc.js');
const { parseSentPoRequest } = await import('../service.js');
const { streamSentPoPdf, cleanPdfText } = await import('../../pdf/sentPoPdf.js');

const TAB = String.fromCharCode(9);

describe('text pasted from Excel or Word', () => {
  test('tabs and invisible characters (which printed as boxes) become plain text', () => {
    assert.equal(cleanPdfText(`Terms and Conditions :${TAB}${TAB}${TAB}\n1. Send 2 copies.${TAB}${TAB}\n\n`), 'Terms and Conditions :\n1. Send 2 copies.');
    assert.equal(cleanPdfText(`a${TAB}b​c  d\r\ne`), 'a bc d\ne');
    assert.equal(cleanPdfText(null), '');
  });

  test('saving a PO cleans the terms the same way', () => {
    const p = parseSentPoRequest(
      { supplier_name: 'A', prefix: 'P', seq: 1, terms_text: `Line one${TAB}${TAB}\nLine${TAB}two  here${TAB}`, items: [{ part_no: 'X', qty: 1 }] },
      '2026-11-24'
    );
    assert.equal(p.terms_text, 'Line one\nLine two here');
  });

  test('long terms still give a one-page PDF', async () => {
    const long = Array.from({ length: 11 }, (_, i) => `${i + 1}. A fairly long condition of the purchase order that wraps onto a second line on the page.${TAB}${TAB}`).join('\n');
    const f = poFigures({ items: [{ qty: 1, price: 100, tax_type: 'IGST', tax_percent: 18 }] });
    const items = Array.from({ length: 4 }, () => ({ part_no: 'P', description: 'Item', qty: 1, unit: 'Nos', price: 100, ...f.lines[0] }));
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    streamSentPoPdf(out, { po: { number: 'X1', order_date: '2026-11-24', supplier_name: 'S', ...f, terms_title: 'Purchase Order', terms_text: long, payment_description: 'Payment due before shipment' }, items, settings: {} });
    await done;
    const pages = (Buffer.concat(chunks).toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.equal(pages, 1);
  });
});
