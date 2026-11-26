// The Sent PO PDF uses the same price layout as the quotation PDF:
//   columns  Price/Unit | Discount | Taxable amount | GST | Amount   (Discount only with a discount; Taxable amount and GST with tax)
//   totals   Qty, Discount, Taxable amount, GST, Amount
//   summary  Sub Total (= the taxable amount, after the line discounts), one row per tax rate, Round off, Total
// Run with:  npm --prefix app/client run test:sentpo
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { poFigures } = await import('../calc.js');
const { summaryRows, sentPoLayout, streamSentPoPdf } = await import('../../pdf/sentPoPdf.js');

const r2 = (x) => Math.round(x * 100) / 100;

// The quotation example: 1 × 1,69,000.00, 10% discount, IGST 18%.
const quotationLike = () => {
  const items = [{ qty: 1, price: 169000, discount_percent: 10, tax_type: 'IGST', tax_percent: 18 }];
  const f = poFigures({ items, round_off_enabled: true });
  return { po: { ...f, round_off_enabled: true }, items: f.lines };
};

describe('Sent PO figures match the quotation', () => {
  test('1 × 1,69,000 with 10% discount and IGST 18%: discount 16,900, taxable 1,52,100, GST 27,378, total 1,79,478', () => {
    const { po, items } = quotationLike();
    const [l] = items;
    assert.equal(l.discount_amount, 16900);
    assert.equal(l.discount_percent, 10);
    assert.equal(l.taxable_amount, 152100);
    assert.equal(l.tax_amount, 27378);
    assert.equal(l.amount, 179478);
    assert.equal(po.sub_total, 152100);
    assert.equal(po.total_discount, 16900);
    assert.equal(po.total_tax, 27378);
    assert.equal(po.total, 179478);
    assert.equal(po.round_off, 0);
  });

  test('summary: Sub Total is the taxable amount, then the tax rate rows, then Round off (also when 0.00)', () => {
    const { po, items } = quotationLike();
    assert.deepEqual(summaryRows(po, items).map(([k, v]) => [k, r2(v)]), [['Sub Total', 152100], ['IGST @ 18%', 27378], ['Round off', 0]]);
  });

  test('the earlier PO: Sub Total 2,69,535.50 + IGST 48,516.39 + round off 0.11 = 3,18,052.00', () => {
    const items = [{ qty: 1, price: 431330, discount_amount: 161794.5, tax_type: 'IGST', tax_percent: 18 }];
    const f = poFigures({ items, round_off_enabled: true });
    const rows = summaryRows({ ...f, round_off_enabled: true }, f.lines);
    assert.deepEqual(rows.map(([k, v]) => [k, r2(v)]), [['Sub Total', 269535.5], ['IGST @ 18%', 48516.39], ['Round off', 0.11]]);
    assert.equal(r2(rows.reduce((a, [, v]) => a + v, 0)), f.total);
    assert.equal(f.total, 318052);
  });

  test('round off off: no Round off row; GST splits into CGST and SGST', () => {
    const items = [{ qty: 2, price: 1000, tax_type: 'GST', tax_percent: 18 }];
    const f = poFigures({ items });
    assert.deepEqual(summaryRows({ ...f, round_off_enabled: false }, f.lines).map(([k, v]) => [k, r2(v)]), [['Sub Total', 2000], ['CGST @ 9%', 180], ['SGST @ 9%', 180]]);
  });
});

describe('Sent PO table columns', () => {
  const keys = (d, t) => sentPoLayout(d, t).cols.map((c) => c.key);

  test('with discount and tax: Price/Unit, Discount, Taxable amount, GST, Amount (as on the quotation)', () => {
    assert.deepEqual(keys(true, true), ['sno', 'item', 'desc', 'hsn', 'qty', 'unit', 'price', 'disc', 'taxable', 'tax', 'amount']);
    const { byKey } = sentPoLayout(true, true);
    assert.equal(byKey.taxable.label, 'Taxable\namount');
    assert.equal(byKey.tax.label, 'GST');
  });

  test('without a discount there is no Discount column; without tax no Taxable amount or GST columns', () => {
    assert.deepEqual(keys(false, true), ['sno', 'item', 'desc', 'hsn', 'qty', 'unit', 'price', 'taxable', 'tax', 'amount']);
    assert.deepEqual(keys(true, false), ['sno', 'item', 'desc', 'hsn', 'qty', 'unit', 'price', 'disc', 'amount']);
  });

  test('the widths fill the page exactly and the description keeps room, even with every column', () => {
    for (const [d, t] of [[true, true], [false, true], [true, false], [false, false]]) {
      const { cols } = sentPoLayout(d, t);
      const total = cols.reduce((a, c) => a + c.w, 0);
      assert.ok(Math.abs(total - (595.28 - 60)) < 0.01, `widths add up to the page (${total})`);
      assert.ok(cols.find((c) => c.key === 'desc').w >= 80, 'the description is at least 80 points wide');
      for (let i = 1; i < cols.length; i++) assert.ok(Math.abs(cols[i].x - (cols[i - 1].x + cols[i - 1].w)) < 0.01);
    }
  });
});

describe('Sent PO PDF', () => {
  test('renders on one page with the quotation-style columns', async () => {
    const { po, items } = quotationLike();
    const full = items.map((l, i) => ({ part_no: `P${i}`, description: 'Item', unit: 'Nos', hsn_sac: '9027', ...l }));
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    streamSentPoPdf(out, { po: { number: 'X1', order_date: '2026-11-26', supplier_name: 'S', terms_title: 'Purchase Order', terms_text: '1. Send two copies.', ...po }, items: full, settings: {} });
    await done;
    const pdf = Buffer.concat(chunks);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  });

  test('a line whose stored record has no taxable_amount gets it from amount minus tax', async () => {
    const { po, items } = quotationLike();
    const stored = items.map(({ taxable_amount, ...rest }) => ({ part_no: 'P', description: 'Item', ...rest }));
    const out = new PassThrough();
    const done = new Promise((r) => { out.on('data', () => {}); out.on('end', r); });
    assert.doesNotThrow(() => streamSentPoPdf(out, { po: { number: 'X2', order_date: '2026-11-26', supplier_name: 'S', ...po }, items: stored, settings: {} }));
    await done;
  });
});
