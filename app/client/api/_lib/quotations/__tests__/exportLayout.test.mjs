// Tests for the quotation Excel layout: column order, one row per product, and old live links keeping their layout.
// Run with:  npm --prefix app/client run test:po   (no database: the database calls are stubbed)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { buildQuotationExport, exportColumnsFor, expandToProductRows } = await import('../../routes/export.js');
const { default: db } = await import('../../db/index.js');
const { default: ExcelJS } = await import('exceljs');

const QUOTES = [
  { _id: 2, quotation_number: 'Q-2', quotation_date: '2026-11-18', customer_name: 'Laurus Labs', contact_person: 'Ravi', contact_phone: '99', contact_email: 'r@l.com', status: 'sent', total_amount: 1180 },
  { _id: 1, quotation_number: 'Q-1', quotation_date: '2026-11-17', customer_name: 'No Items Ltd', contact_person: 'N', contact_phone: '1', contact_email: 'n@x.com', status: 'sent', total_amount: 0 },
];
const ITEMS = [
  { _qid: 2, part_no: 'P-1', item_description: 'Vial', hsn_code: '7017', item_qty: 2, list_price: 500, price_after_discount: 450, line_total: 900 },
  { _qid: 2, part_no: 'P-2', item_description: 'Cap', hsn_code: '3923', item_qty: 1, list_price: 100, price_after_discount: 100, line_total: 100 },
];

async function sheet(query, scope = {}) {
  const real = db.prepare;
  db.prepare = (sql) => ({
    all: async () => (/FROM quotation_item qi/.test(sql) && /_qid/.test(sql) ? ITEMS.map((r) => ({ ...r })) : QUOTES.map((r) => ({ ...r }))),
    get: async () => ({ n: 0 }),
  });
  try {
    const { buffer } = await buildQuotationExport(query, scope);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Quotations');
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1)));
    return rows;
  } finally {
    db.prepare = real;
  }
}

describe('column order', () => {
  test('the default order starts with date, quotation, company, the product columns, then the customer contact', async () => {
    const rows = await sheet({}, { clean: true, }).catch(() => null);
    // (a clean sheet without layout=2 is an old live link; checked below) — here the download layout:
    const dl = await sheet({});
    const header = dl.find((r) => r[0] === 'Date');
    assert.deepEqual(header.slice(0, 14), [
      'Date', 'Quotation No', 'Company Name', 'Part Number', 'Description', 'HSN Code', 'Quantity',
      'List Price (₹)', 'Discount (₹)', 'Price After Discount (₹)', 'Total Price (₹)', 'Customer Name', 'Phone Number', 'Email ID',
    ]);
    assert.ok(header.includes('Sales Engineer') && header.includes('Status') && header.includes('Total Value (₹)'), 'the rest follows');
    assert.ok(rows, 'an old live link still builds');
  });
});

describe('one row per product', () => {
  test('each product is its own row with the quotation columns repeated; a quotation without products keeps one row', async () => {
    const rows = await sheet({ layout: '2', columns: 'quotation_date,quotation_number,customer_name,part_no,item_qty,list_price,item_discount,price_after_discount,line_total,contact_person' }, { clean: true });
    assert.deepEqual(rows[0], ['Date', 'Quotation No', 'Company Name', 'Part Number', 'Quantity', 'List Price (₹)', 'Discount (₹)', 'Price After Discount (₹)', 'Total Price (₹)', 'Customer Name']);
    assert.equal(rows.length, 4, 'header + 2 product rows + 1 row for the quotation without products');
    assert.equal(rows[1][1], 'Q-1', 'oldest first: the quotation without products comes first');
    assert.deepEqual(rows[2].slice(1, 9), ['Q-2', 'Laurus Labs', 'P-1', 2, 500, 50, 450, 900]);
    assert.deepEqual(rows[3].slice(1, 4), ['Q-2', 'Laurus Labs', 'P-2']);
    assert.equal(rows[3][6], 0, 'no discount on P-2');
  });

  test('without product columns the sheet stays one row per quotation', async () => {
    const rows = await sheet({ columns: 'quotation_number,customer_name,status' });
    assert.equal(rows.filter((r) => r[0] === 'Q-2').length, 1);
  });

  test('old quotations are on top and the newest at the bottom (so a new one is added below)', async () => {
    const rows = await sheet({ columns: 'quotation_number' });
    assert.ok(rows.findIndex((r) => r[0] === 'Q-1') < rows.findIndex((r) => r[0] === 'Q-2'));
  });

  test('expandToProductRows keeps the quotation fields on every product row', () => {
    const out = expandToProductRows([{ _id: 5, quotation_number: 'Q' }, { _id: 6, quotation_number: 'R' }], new Map([[5, [{ part_no: 'A' }, { part_no: 'B' }]]]));
    assert.deepEqual(out, [{ _id: 5, quotation_number: 'Q', part_no: 'A' }, { _id: 5, quotation_number: 'Q', part_no: 'B' }, { _id: 6, quotation_number: 'R' }]);
  });
});

describe('live links made before this change are upgraded to the new layout', () => {
  test('an old link (the columns of the old sheet, no layout=2) now gets the new order, names and product columns', async () => {
    const rows = await sheet({ columns: 'quotation_number,quotation_date,customer_name,contact_person,contact_phone,contact_email,status' }, { clean: true });
    assert.deepEqual(rows[0], [
      'Date', 'Quotation No', 'Company Name', 'Part Number', 'Description', 'HSN Code', 'Quantity',
      'List Price (₹)', 'Discount (₹)', 'Price After Discount (₹)', 'Total Price (₹)', 'Customer Name', 'Phone Number', 'Email ID', 'Status',
    ]);
    assert.equal(rows.length, 4, 'header + one row per product (Q-1 has none and keeps a single row)');
    assert.equal(rows[1][1], 'Q-1', 'oldest first');
    assert.equal(rows[2][3], 'P-1');
  });

  test('a link that already has layout=2 keeps exactly the columns it asked for', async () => {
    const rows = await sheet({ layout: '2', columns: 'quotation_number,quotation_date,customer_name,contact_person' }, { clean: true });
    assert.deepEqual(rows[0], ['Date', 'Quotation No', 'Company Name', 'Customer Name']);
  });

  test('exportColumnsFor: the defaults when nothing valid is asked; product defaults are added only when upgrading', () => {
    const cols = [{ key: 'a', def: true }, { key: 'b', def: true, item: true }, { key: 'c', def: false, item: true }];
    assert.deepEqual(exportColumnsFor(cols, ['zzz'], false).map((c) => c.key), ['a', 'b']);
    assert.deepEqual(exportColumnsFor(cols, ['a'], false).map((c) => c.key), ['a']);
    assert.deepEqual(exportColumnsFor(cols, ['a'], true).map((c) => c.key), ['a', 'b'], 'an old link gets the default product columns');
    assert.deepEqual(exportColumnsFor(cols, ['a', 'c'], true).map((c) => c.key), ['a', 'b', 'c']);
  });
});
