// Tests for the Excel stock statement. Run with:  npm --prefix app/client run test:inventory
// A fake database stands in for Postgres; nothing connects.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { monthRange, monthLabel, rowsToList, buildStockStatementExcel, MAX_MONTHS } = await import('../stockStatement.js');
const { PO_COLUMNS } = await import('../../quotations/poReceived.js');
const { INVOICE_COLUMNS } = await import('../../quotations/invoices.js');
const { default: db } = await import('../../db/index.js');
const { default: ExcelJS } = await import('exceljs');

describe('monthRange', () => {
  test('inclusive, oldest first, across a year end', () => {
    assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.deepEqual(monthRange('2026-11', '2026-11'), ['2026-11']);
  });
  test('defaults to the current month; one given month stands for both ends', () => {
    assert.deepEqual(monthRange(undefined, undefined, '2026-11-19'), ['2026-11']);
    assert.deepEqual(monthRange('2026-05', undefined), ['2026-05']);
    assert.deepEqual(monthRange('nope', '2026-03'), ['2026-03']);
  });
  test('the last month before the first, or too many months, is refused', () => {
    assert.throws(() => monthRange('2026-11', '2026-10'), (e) => e.status === 400 && /before/.test(e.message));
    assert.throws(() => monthRange('2020-01', '2026-12'), (e) => e.status === 400 && new RegExp(String(MAX_MONTHS)).test(e.message));
    assert.equal(monthRange('2026-01', '2027-12').length, 24, 'exactly the maximum is fine');
  });
  test('the sheet name', () => assert.equal(monthLabel('2026-11'), 'Nov-2026'));
});

describe('rowsToList', () => {
  const r = (o) => ({ opening: 0, closing: 0, totals: { in: 0, out: 0, ret: 0, adj: 0, xfer: 0 }, ...o });
  test('parts with stock or movement are listed; idle parts only when asked', () => {
    const rows = [r({ part_no: 'A', closing: 3 }), r({ part_no: 'B', totals: { in: 0, out: 2, ret: 0, adj: 0, xfer: 0 } }), r({ part_no: 'C' })];
    assert.deepEqual(rowsToList(rows).map((x) => x.part_no), ['A', 'B']);
    assert.equal(rowsToList(rows, true).length, 3);
  });
});

// ---------- the workbook, with a fake database ----------
const placeholders = (q) => (q.replace(/'[^']*'/g, '').match(/\?/g) || []).length;
let seen;
beforeEach(() => {
  seen = [];
  db.prepare = (text) => {
    const q = text.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (placeholders(q) !== params.length) throw new Error(`parameter count mismatch in: ${q.slice(0, 100)}`);
      seen.push({ q, params });
      if (/FROM information_schema\.columns/.test(q)) return Object.entries({ ...PO_COLUMNS, ...INVOICE_COLUMNS }).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
      if (/information_schema\.table_constraints/.test(q)) return [{ ref_table: 'app_user' }];
      if (/FROM inventory_stock s/.test(q)) return [{ product_id: 1, on_hand: 7 }, { product_id: 2, on_hand: 0 }];
      if (/SUM\(m\.after_on_hand - m\.before_on_hand\)::float8 AS delta FROM inventory_movement m JOIN product p ON p\.id = m\.product_id WHERE .* GROUP BY m\.product_id$/.test(q)) return [{ product_id: 1, delta: 4 }, { product_id: 2, delta: -2 }];
      if (/GROUP BY m\.product_id, 2/.test(q)) {
        return [
          { product_id: 1, bucket: '3', movement_type: 'STOCK_IN', delta: 10 },
          { product_id: 1, bucket: '12', movement_type: 'STOCK_OUT', delta: -6 },
          { product_id: 2, bucket: '20', movement_type: 'STOCK_OUT', delta: -2 },
        ];
      }
      if (/FROM product p WHERE p\.id = ANY/.test(q) || /^SELECT p\.id FROM product p/.test(q)) {
        return /^SELECT p\.id FROM/.test(q) ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [
          { id: 1, part_no: 'B01', description: 'Vials', unit: 'Nos', make: 'PerkinElmer' },
          { id: 2, part_no: 'B02', description: 'Caps', unit: 'Nos', make: 'PerkinElmer' },
          { id: 3, part_no: 'B03', description: 'Idle part', unit: 'Nos', make: null },
        ];
      }
      if (/FROM inventory_movement m JOIN product p ON p\.id = m\.product_id JOIN warehouse w/.test(q)) {
        return [
          { at: '03-11-2026 10:00', part_no: 'B01', description: 'Vials', make: 'PerkinElmer', movement_type: 'STOCK_IN', change: 10, warehouse: 'HYD', reference_type: 'STOCK_RECEIPT', reference_id: '7', reason: 'Stock Inward', entered_by: 'admin', receipt_number: 'REC2627/3', source_reference: 'PE251119-03', invoice_number: null, customer: null, quotation_number: null, po_numbers: null },
          { at: '12-11-2026 15:30', part_no: 'B01', description: 'Vials', make: 'PerkinElmer', movement_type: 'STOCK_OUT', change: -6, warehouse: 'HYD', reference_type: 'QUOTATION_INVOICE', reference_id: '9', reason: 'Invoice INV-9', entered_by: 'admin', receipt_number: null, source_reference: null, invoice_number: 'INV-9', customer: 'Laurus Labs', quotation_number: 'TSQOT2627/650', po_numbers: 'PO-77' },
        ];
      }
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 120));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
  };
});

async function load(query, ctx) {
  const { buffer, filename } = await buildStockStatementExcel(query, ctx);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return { wb, filename };
}

describe('the workbook', () => {
  test('one sheet per month in their layout, plus Movements; the file is named by the months', async () => {
    const { wb, filename } = await load({ from: '2026-11', to: '2026-11' }, { warehouseName: 'Hyderabad Central' });
    assert.equal(filename, 'TECHNICON_Stock_Statement_Nov-2026.xlsx');
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Nov-2026', 'Movements']);
    const ws = wb.getWorksheet('Nov-2026');
    const header = ws.getRow(4).values.slice(1);
    assert.deepEqual(header.slice(0, 7), ['S.NO', 'Part No', 'Description', 'Company', 'Unit', 'Opening', '1']);
    // 30 days in, Total In, 30 days out, then Total Out, Returns, Adjustments, Closing
    assert.equal(header.length, 6 + 30 + 1 + 30 + 4);
    assert.deepEqual(header.slice(-5), ['30', 'Total Out', 'Returns', 'Adjustments', 'Closing']);
    assert.equal(header[6 + 30], 'Total In');
    assert.match(ws.getCell(1, 1).value, /STOCK STATEMENT — NOV 2026/);
    assert.match(ws.getCell(2, 1).value, /Warehouse: Hyderabad Central/);
  });

  test('stock in and out land in the right day columns; totals and closing add up; idle parts are left out', async () => {
    const { wb } = await load({ from: '2026-11' });
    const ws = wb.getWorksheet('Nov-2026');
    const inCol = (d) => 6 + d;
    const outCol = (d) => 6 + 30 + 1 + d;
    const r1 = ws.getRow(5); // B01: opening 7 - 4 = 3, +10 on the 3rd, -6 on the 12th
    assert.deepEqual([r1.getCell(2).value, r1.getCell(4).value, r1.getCell(6).value], ['B01', 'PerkinElmer', 3]);
    assert.equal(r1.getCell(inCol(3)).value, 10);
    assert.equal(r1.getCell(outCol(12)).value, 6);
    assert.deepEqual([r1.getCell(6 + 30 + 1).value, r1.getCell(6 + 30 + 1 + 30 + 1).value, r1.getCell(6 + 30 + 1 + 30 + 4).value], [10, 6, 7], 'total in, total out, closing');
    const r2 = ws.getRow(6); // B02: 2 out on the 20th, nothing left
    assert.equal(r2.getCell(2).value, 'B02');
    assert.equal(r2.getCell(outCol(20)).value, 2);
    assert.equal(ws.getRow(7).getCell(3).value, 'TOTAL', 'the idle part B03 is not listed');
    assert.equal(ws.getRow(7).getCell(6 + 30 + 1).value, 10);
  });

  test('green while in stock, orange when out of stock', async () => {
    const { wb } = await load({ from: '2026-11' });
    const ws = wb.getWorksheet('Nov-2026');
    assert.equal(ws.getRow(5).getCell(2).fill.fgColor.argb, 'FFC6EFCE');
    assert.equal(ws.getRow(6).getCell(2).fill.fgColor.argb, 'FFFFE0B2');
  });

  test('"all parts" also lists the idle part', async () => {
    const { wb } = await load({ from: '2026-11', all: '1' });
    assert.equal(wb.getWorksheet('Nov-2026').getRow(7).getCell(2).value, 'B03');
  });

  test('several months: a sheet each, one Movements sheet; the day count follows the month', async () => {
    const { wb, filename } = await load({ from: '2026-12', to: '2027-02' });
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Dec-2026', 'Jan-2027', 'Feb-2027', 'Movements']);
    assert.equal(filename, 'TECHNICON_Stock_Statement_Dec-2026_to_Feb-2027.xlsx');
    assert.equal(wb.getWorksheet('Feb-2027').getRow(4).values.slice(1).length, 6 + 28 + 1 + 28 + 4);
    assert.equal(wb.getWorksheet('Dec-2026').getRow(4).values.slice(1).length, 6 + 31 + 1 + 31 + 4);
  });

  test('the Movements sheet names the customer, PO and invoice for an invoice stock-out, and the receipt and PE reference for a stock-in', async () => {
    const { wb } = await load({ from: '2026-11' });
    const ws = wb.getWorksheet('Movements');
    const head = ws.getRow(1).values.slice(1);
    assert.deepEqual(head.slice(0, 11), ['Date & Time', 'Part No', 'Description', 'Company', 'Type', 'Quantity', 'Warehouse', 'Customer', 'Quotation', 'PO Number(s)', 'Invoice No']);
    const col = (name) => head.indexOf(name) + 1;
    const inRow = ws.getRow(2);
    assert.deepEqual([inRow.getCell(col('Type')).value, inRow.getCell(col('Quantity')).value, inRow.getCell(col('Receipt No')).value, inRow.getCell(col('Supplier / Source Ref')).value], ['Stock in', 10, 'REC2627/3', 'PE251119-03']);
    const outRow = ws.getRow(3);
    assert.deepEqual(
      [outRow.getCell(col('Type')).value, outRow.getCell(col('Quantity')).value, outRow.getCell(col('Customer')).value, outRow.getCell(col('Quotation')).value, outRow.getCell(col('PO Number(s)')).value, outRow.getCell(col('Invoice No')).value],
      ['Stock out', -6, 'Laurus Labs', 'TSQOT2627/650', 'PO-77', 'INV-9']
    );
  });

  test('the date range and filters are bound parameters; the movements are limited to the range in India time', async () => {
    await load({ from: '2026-11', to: '2026-12', warehouseId: '4', make: "x'; DROP" });
    const mv = seen.find((s) => /FROM inventory_movement m JOIN product p ON p\.id = m\.product_id JOIN warehouse w/.test(s.q));
    assert.deepEqual(mv.params.slice(0, 2), ['2026-10-31 18:30:00', '2026-12-31 18:30:00']);
    assert.ok(mv.params.includes(4));
    assert.ok(mv.params.includes("x'; DROP"));
    assert.doesNotMatch(mv.q, /DROP/);
  });

  test('a bad range is refused before anything is read', async () => {
    await assert.rejects(() => buildStockStatementExcel({ from: '2026-11', to: '2026-01' }), (e) => e.status === 400);
    assert.equal(seen.length, 0);
  });
});
