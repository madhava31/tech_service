// Tests for serial numbers (Mettler units). Run with:  npm --prefix app/client run test:inventory   (a fake database; nothing connects)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const S = await import('../serials.js');
const { default: db } = await import('../../db/index.js');

describe('parseSerials / isMettler', () => {
  test('lines, commas and blanks', () => {
    assert.deepEqual(S.parseSerials('C1\n C2 ,C3;\r\n\n  C 4 '), ['C1', 'C2', 'C3', 'C 4']);
    assert.deepEqual(S.parseSerials(['a', ' ', 'b']), ['a', 'b']);
    assert.deepEqual(S.parseSerials(undefined), []);
  });
  test('Mettler company name', () => {
    assert.equal(S.isMettler('Mettler Toledo'), true);
    assert.equal(S.isMettler('PerkinElmer Consumables'), false);
  });
});

describe('checkReceiptSerials', () => {
  test('one serial number per unit', () => {
    const out = S.checkReceiptSerials([{ productId: 5, quantity: 2, serials: 'A1\nA2' }, { productId: 6, quantity: 3 }]);
    assert.deepEqual(out, [{ productId: 5, serials: ['A1', 'A2'] }]);
  });
  test('a wrong count is refused', () => {
    assert.throws(() => S.checkReceiptSerials([{ productId: 5, quantity: 3, serials: ['A1', 'A2'] }]), /2 serial numbers were entered for a quantity of 3/);
  });
  test('the same serial twice for one product is refused, ignoring case; for two products it is fine', () => {
    assert.throws(() => S.checkReceiptSerials([{ productId: 5, quantity: 2, serials: ['a1', 'A1'] }]), /entered twice/);
    assert.equal(S.checkReceiptSerials([{ productId: 5, quantity: 1, serials: ['A1'] }, { productId: 6, quantity: 1, serials: ['A1'] }]).length, 2);
  });
});

describe('planInvoiceSerials', () => {
  const lines = [{ quotation_item_id: 11, product_id: 5, qty: 2, label: 'MA204' }, { quotation_item_id: 12, product_id: 9, qty: 1, label: 'Vial' }];
  test('a product with serials in stock needs one pick per unit; others need none', () => {
    const plan = S.planInvoiceSerials(lines, { 11: [100, 101] }, new Map([[5, 4]]));
    assert.deepEqual(plan, [{ quotation_item_id: 11, product_id: 5, ids: [100, 101] }]);
  });
  test('wrong number of picks is refused', () => {
    assert.throws(() => S.planInvoiceSerials(lines, { 11: [100] }, new Map([[5, 4]])), /MA204: pick 2 serial numbers \(1 picked\)/);
  });
  test('units received without serial numbers are not asked for', () => {
    // 3 units on the invoice but only 1 has a serial number: one pick is enough
    const plan = S.planInvoiceSerials([{ quotation_item_id: 11, product_id: 5, qty: 3 }], { 11: [100] }, new Map([[5, 1]]));
    assert.equal(plan[0].ids.length, 1);
  });
  test('the same unit cannot be picked on two lines', () => {
    const two = [{ quotation_item_id: 11, product_id: 5, qty: 1 }, { quotation_item_id: 12, product_id: 5, qty: 1 }];
    assert.throws(() => S.planInvoiceSerials(two, { 11: [100], 12: [100] }, new Map([[5, 4]])), /two lines/);
  });
});

describe('database parts', () => {
  let seen;
  let existing;
  let rows;
  beforeEach(() => {
    seen = [];
    existing = null;
    rows = [];
    db.prepare = (text) => {
      const q = text.replace(/\s+/g, ' ').trim();
      const run = (params) => {
        const p = params.flat();
        if ((q.replace(/'[^']*'/g, '').match(/\?/g) || []).length !== p.length && !/information_schema/.test(q)) throw new Error('parameter count mismatch in: ' + q.slice(0, 90));
        seen.push({ q, p });
        if (/information_schema/.test(q)) return S.SERIAL_COLUMNS.stock_serial.map((c) => ({ table_name: 'stock_serial', column_name: c }));
        if (/^SELECT serial_number FROM stock_serial WHERE product_id = \? AND lower/.test(q)) return existing ? [{ serial_number: existing }] : [];
        if (/^INSERT INTO stock_serial/.test(q)) return [];
        if (/^UPDATE stock_serial SET outward_date = \?, invoice_id = \?/.test(q)) return [];
        if (/^UPDATE stock_serial SET outward_date = NULL/.test(q)) return [];
        if (/FROM stock_serial s JOIN product p/.test(q)) return rows;
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
      };
      return { get: async (...p) => run(p)[0], all: async (...p) => run(p), run: async (...p) => { run(p); return { changes: /^UPDATE stock_serial SET outward_date = \?/.test(q) ? String(p[2]).replace(/[{}]/g, '').split(',').filter((x) => x !== '102').length : 1 }; } };
    };
  });

  test('a serial number that already exists is refused', async () => {
    existing = 'C1';
    await assert.rejects(() => S.assertSerialsFree([{ productId: 5, serials: ['c1'] }]), /already recorded/);
    existing = null;
    await S.assertSerialsFree([{ productId: 5, serials: ['c1'] }]);
  });

  test('receipt units are inserted with the inward date', async () => {
    await S.insertReceiptSerials([{ productId: 5, serials: ['A1', 'A2'] }], { receiptId: 7, warehouseId: 1, inwardDate: '2026-04-23' });
    const ins = seen.filter((s) => /^INSERT INTO stock_serial/.test(s.q));
    assert.equal(ins.length, 2);
    assert.deepEqual(ins[0].p, [5, 'A1', 1, 7, '2026-04-23']);
  });

  test('assigning to an invoice marks the picked units; a unit already sold is refused', async () => {
    await S.assignInvoiceSerials([{ quotation_item_id: 11, product_id: 5, ids: [100, 101] }], { invoiceId: 3, outwardDate: '2026-11-20' });
    await assert.rejects(() => S.assignInvoiceSerials([{ quotation_item_id: 11, product_id: 5, ids: [100, 101, 102] }], { invoiceId: 3, outwardDate: '2026-11-20' }), /no longer in stock/);
  });

  test('the Excel list: columns in the asked order, one row per unit, green in hand and red sent', async () => {
    rows = [
      { id: 1, serial_number: 'C601903939', inward_date: '2026-04-23', outward_date: null, product_id: 5, part_no: '30697411', description: 'Analytical Balance MA204', hsn_sac: '9016', make: 'Mettler Toledo', invoice_number: null },
      { id: 2, serial_number: 'C601903940', inward_date: '2026-04-23', outward_date: '2026-05-02', product_id: 5, part_no: '30697411', description: 'Analytical Balance MA204', hsn_sac: null, make: 'Mettler Toledo', invoice_number: 'INV-9' },
    ];
    const { buffer, filename, count } = await S.buildSerialsExcel({ make: 'Mettler Toledo' });
    assert.match(filename, /^serial-numbers-Mettler-Toledo-\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.equal(count, 2);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    assert.deepEqual(ws.getRow(1).values.slice(1), ['HSN/SAC', 'Part Number', 'Description', 'Serial Number', 'Stock Inward Date', 'Stock Outward Date', 'Available Stock In Hand']);
    assert.deepEqual(ws.getRow(2).values.slice(1, 5), ['9016', '30697411', 'Analytical Balance MA204', 'C601903939']);
    assert.equal(ws.getRow(2).getCell(7).value, 1);
    assert.equal(ws.getRow(3).getCell(7).value, 0);
    assert.equal(ws.getRow(2).getCell(6).value, null);
    assert.equal(ws.getRow(3).getCell(1).value, null);
    assert.equal(ws.getRow(2).getCell(1).fill.fgColor.argb, 'FFC6EFCE');
    assert.equal(ws.getRow(3).getCell(1).fill.fgColor.argb, 'FFFF7C80');
    const q = seen.find((s) => /FROM stock_serial s JOIN product p/.test(s.q));
    assert.deepEqual(q.p, ['Mettler Toledo']);
  });
});
