// The Discount column of the quotation PDF only prints when a line has a discount. Run with:  npm --prefix app/client run test:po
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { stdLayout, streamQuotationPdfV2 } = await import('../../pdf/quotationPdf.js');

describe('stdLayout', () => {
  const total = (l) => l.cols.reduce((a, c) => a + c.w, 0);
  test('with a discount: every column, side by side', () => {
    const l = stdLayout(true);
    assert.deepEqual(l.cols.map((c) => c.key), ['sno', 'code', 'hsn', 'desc', 'qty', 'unit', 'price', 'discount', 'taxable', 'gst', 'amount']);
    for (let i = 1; i < l.cols.length; i++) assert.equal(l.cols[i].x, l.cols[i - 1].x + l.cols[i - 1].w, 'columns touch');
  });
  test('without a discount: no Discount column, its width goes to the description, the table is as wide as before', () => {
    const a = stdLayout(true);
    const b = stdLayout(false);
    assert.ok(!b.cols.some((c) => c.key === 'discount'));
    assert.equal(b.byKey.desc.w, a.byKey.desc.w + a.byKey.discount.w);
    assert.ok(Math.abs(total(a) - total(b)) < 1e-9, 'same total width');
    for (let i = 1; i < b.cols.length; i++) assert.equal(b.cols[i].x, b.cols[i - 1].x + b.cols[i - 1].w);
    assert.equal(b.byKey.amount.x + b.byKey.amount.w, a.byKey.amount.x + a.byKey.amount.w, 'right edge unchanged');
  });
  test('the shared layout is not changed by asking for another one', () => {
    stdLayout(false);
    assert.equal(stdLayout(true).byKey.desc.w, 70);
  });
});

describe('the quotation PDF is produced either way', () => {
  const item = (qty, unit, pct) => {
    const taxable = Math.round(unit * qty * (1 - pct / 100) * 100) / 100;
    return { part_no: 'P-1', description: 'Vial', product_name: 'Vial', hsn_sac: '9027', qty, unit: 'Nos', price: unit, actual_unit_price: unit, final_unit_price: taxable / qty, final_line_total: taxable, amount: taxable, discount_type: pct ? 'percentage' : 'none', discount_value: pct, key_features: [] };
  };
  const render = async (items) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    const sub = items.reduce((a, i) => a + i.final_line_total, 0);
    streamQuotationPdfV2(out, { quotation: { number: 'Q-1', date: '2026-11-19', company_name: 'Acme', tax_percent: 18, subtotal: sub, taxable_amount: sub, tax_amount: sub * 0.18, total: sub * 1.18, pricing_mode: 'itemized', quotation_type: 'standard' }, items, settings: {} });
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('PDF did not finish')), 8000))]);
    return Buffer.concat(chunks);
  };
  test('with no discount on any line, and with a discount on one line', async () => {
    const none = await render([item(2, 1000, 0), item(1, 500, 0)]);
    const some = await render([item(2, 1000, 10), item(1, 500, 0)]);
    for (const pdf of [none, some]) { assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 1500); }
  });
});
