// Tests for the Stock In / Out report. Run with:  npm --prefix app/client run test:inventory
// No database: a dummy DATABASE_URL is set only because the module imports the database module; the queries are stubbed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { periodBounds, bucketRange, addMovement, buildGrid, utcStartOf, todayIST, getMovementReport, buildMovementReportExcel, openingFromStock } = await import('../movementReport.js');
const { default: db } = await import('../../db/index.js');
const { default: ExcelJS } = await import('exceljs');

describe('period', () => {
  test('a month has one column per day', () => {
    assert.equal(periodBounds({ view: 'month', month: '2026-11' }).buckets.length, 30);
    assert.equal(periodBounds({ view: 'month', month: '2026-12' }).buckets.length, 31);
    assert.equal(periodBounds({ view: 'month', month: '2028-02' }).buckets.length, 29, 'leap year');
    assert.equal(periodBounds({ view: 'month', month: '2027-02' }).buckets.length, 28);
    const dec = periodBounds({ view: 'month', month: '2026-12' });
    assert.equal(dec.start, '2026-12-01');
    assert.equal(dec.endExclusive, '2027-01-01');
    assert.equal(dec.label, 'Dec 2026');
  });

  test('a bad or missing month falls back to this month', () => {
    assert.equal(periodBounds({ view: 'month', month: '2026-13' }, '2026-11-19').month, '2026-11');
    assert.equal(periodBounds({}, '2026-11-19').month, '2026-11');
  });

  test('the financial year runs April to March, the calendar year January to December', () => {
    const fy = periodBounds({ view: 'year', year: 2026, yearType: 'fy' });
    assert.equal(fy.label, 'FY 2026-27');
    assert.equal(fy.start, '2026-04-01');
    assert.equal(fy.endExclusive, '2027-04-01');
    assert.deepEqual([fy.buckets[0].key, fy.buckets[8].key, fy.buckets[11].key], ['2026-04', '2026-12', '2027-03']);
    assert.equal(fy.buckets[0].label, 'Apr 26');
    const cal = periodBounds({ view: 'year', year: 2026, yearType: 'calendar' });
    assert.equal(cal.label, '2026');
    assert.deepEqual([cal.start, cal.endExclusive, cal.buckets[0].key, cal.buckets[11].key], ['2026-01-01', '2027-01-01', '2026-01', '2026-12']);
  });

  test('without a year: the current financial year (Jan-Mar belongs to the year before)', () => {
    assert.equal(periodBounds({ view: 'year' }, '2027-02-10').label, 'FY 2026-27');
    assert.equal(periodBounds({ view: 'year' }, '2026-11-19').label, 'FY 2026-27');
    assert.equal(periodBounds({ view: 'year', yearType: 'calendar' }, '2027-02-10').label, '2027');
  });

  test('the range behind one column, for the "what moved" list', () => {
    const m = periodBounds({ view: 'month', month: '2026-11' });
    assert.deepEqual(bucketRange(m, '5'), { from: '2026-11-05', to: '2026-11-05' });
    const y = periodBounds({ view: 'year', year: 2026 });
    assert.deepEqual(bucketRange(y, '2027-02'), { from: '2027-02-01', to: '2027-02-28' });
  });
});

describe('India time', () => {
  test('midnight India time is 18:30 UTC the day before, so 00:30 IST on the 1st falls on the 1st', () => {
    assert.equal(utcStartOf('2026-12-01'), '2026-11-30 18:30:00');
    // A movement stored at 2026-11-30 19:00 UTC (= 00:30 IST on 1 Dec) is >= the start of December.
    assert.ok('2026-11-30 19:00:00' >= utcStartOf('2026-12-01'));
    assert.ok('2026-11-30 18:00:00' < utcStartOf('2026-12-01'), '23:30 IST on 30 Nov stays in November');
  });
  test('today in India', () => {
    assert.equal(todayIST(Date.parse('2026-11-30T19:00:00Z')), '2026-12-01');
    assert.equal(todayIST(Date.parse('2026-11-30T18:00:00Z')), '2026-11-30');
  });
});

describe('counting a movement', () => {
  const cell = () => ({ in: 0, out: 0, ret: 0, adj: 0, xfer: 0 });
  test('in, out, returns and signed adjustments', () => {
    assert.equal(addMovement(cell(), 'STOCK_IN', 10).in, 10);
    assert.equal(addMovement(cell(), 'OPENING_STOCK', 5).in, 5);
    assert.equal(addMovement(cell(), 'STOCK_OUT', -4).out, 4);
    assert.equal(addMovement(cell(), 'RETURN', 2).ret, 2);
    assert.equal(addMovement(cell(), 'ADJUSTMENT', -3).adj, -3, 'a correction down');
    assert.equal(addMovement(cell(), 'ADJUSTMENT', 6).adj, 6, 'a correction up');
    assert.equal(addMovement(cell(), 'OPENING_STOCK', -2).adj, -2, 'an opening stock set lower is a correction');
  });
  test('transfers count as in / out only for one warehouse', () => {
    const one = addMovement(addMovement(cell(), 'TRANSFER_IN', 5, true), 'TRANSFER_OUT', -2, true);
    assert.deepEqual([one.in, one.out, one.xfer], [5, 2, 3]);
    const all = addMovement(addMovement(cell(), 'TRANSFER_OUT', -5, false), 'TRANSFER_IN', 5, false);
    assert.deepEqual([all.in, all.out, all.xfer], [0, 0, 0], 'between two warehouses nothing moved overall');
  });
});

describe('grid', () => {
  const products = [{ id: 1, part_no: 'A' }, { id: 2, part_no: 'B' }];
  const bucketRows = [
    { product_id: 1, bucket: '3', movement_type: 'STOCK_IN', delta: 10 },
    { product_id: 1, bucket: '3', movement_type: 'STOCK_OUT', delta: -4 },
    { product_id: 1, bucket: '17', movement_type: 'STOCK_IN', delta: 20 },
    { product_id: 1, bucket: '17', movement_type: 'ADJUSTMENT', delta: -1 },
    { product_id: 1, bucket: '20', movement_type: 'RETURN', delta: 2 },
  ];
  test('opening + movements = closing, with per-day cells, totals and column totals', () => {
    const g = buildGrid({ products, openingRows: [{ product_id: 1, opening: 5 }, { product_id: 2, opening: 7 }], bucketRows, singleWarehouse: false });
    const a = g.rows[0];
    assert.deepEqual(a.cells['3'], { in: 10, out: 4, ret: 0, adj: 0, xfer: 0 });
    assert.deepEqual([a.totals.in, a.totals.out, a.totals.ret, a.totals.adj], [30, 4, 2, -1]);
    assert.equal(a.opening, 5);
    assert.equal(a.closing, 5 + 30 - 4 + 2 - 1);
    assert.deepEqual(g.rows[1].cells, {}, 'B did not move');
    assert.equal(g.rows[1].closing, 7);
    assert.equal(g.totals.opening, 12);
    assert.equal(g.totals.closing, 32 + 7);
    assert.equal(g.totals.columns['17'].in, 20);
  });
  test('closing includes transfers in both modes', () => {
    const rows = [{ product_id: 1, bucket: '1', movement_type: 'TRANSFER_OUT', delta: -3 }];
    assert.equal(buildGrid({ products: [products[0]], openingRows: [{ product_id: 1, opening: 10 }], bucketRows: rows, singleWarehouse: true }).rows[0].closing, 7);
    assert.equal(buildGrid({ products: [products[0]], openingRows: [{ product_id: 1, opening: 10 }], bucketRows: rows, singleWarehouse: false }).rows[0].closing, 7);
  });
});

describe('report and Excel with a stubbed database', () => {
  const stub = () => {
    const seen = [];
    const real = db.prepare;
    db.prepare = (sql) => ({
      all: async (...params) => {
        seen.push({ sql, params });
        const q0 = sql.replace(/\s+/g, ' ');
        if (/FROM inventory_stock s/.test(q0)) return [{ product_id: 1, on_hand: 11 }];
        if (/GROUP BY m.product_id$/.test(q0.trim())) return [{ product_id: 1, delta: 6 }];
        if (/GROUP BY m.product_id, 2/.test(sql)) return [{ product_id: 1, bucket: '3', movement_type: 'STOCK_IN', delta: 10 }, { product_id: 1, bucket: '3', movement_type: 'STOCK_OUT', delta: -4 }];
        if (/FROM product p WHERE p.id = ANY/.test(sql)) return [{ id: 1, part_no: 'P-1', description: 'Vial', unit: 'Nos', make: 'X' }];
        if (/FROM inventory_movement m JOIN product p ON p.id = m.product_id JOIN warehouse/.test(sql)) return [{ at: '03-11-2026 10:00', warehouse: 'HYD', part_no: 'P-1', description: 'Vial', movement_type: 'STOCK_IN', change: 10, before: 5, after: 15 }];
        return [];
      },
      get: async () => ({}),
    });
    return { seen, restore: () => { db.prepare = real; } };
  };

  test('the report: India-time bounds as bound parameters, warehouse filter, products that moved', async () => {
    const s = stub();
    try {
      const r = await getMovementReport({ view: 'month', month: '2026-11', warehouseId: '4', q: "x' OR 1=1" });
      assert.equal(r.buckets.length, 30);
      assert.equal(r.total_products, 1);
      assert.equal(r.single_warehouse, true);
      assert.deepEqual(r.products[0].cells['3'], { in: 10, out: 4, ret: 0, adj: 0, xfer: 0 });
      assert.equal(r.products[0].closing, 11);
      const bucketQ = s.seen.find((x) => /GROUP BY m.product_id, 2/.test(x.sql));
      assert.deepEqual(bucketQ.params.slice(0, 3), ['2026-10-31 18:30:00', '2026-11-30 18:30:00', 4]);
      assert.ok(bucketQ.params.includes("%x' OR 1=1%"), 'the search is a bound parameter');
      assert.doesNotMatch(bucketQ.sql, /OR 1=1/);
    } finally { s.restore(); }
  });

  test('the Excel file has Stock In, Stock Out and Movements sheets with one column per day', async () => {
    const s = stub();
    try {
      const { buffer, filename } = await buildMovementReportExcel({ view: 'month', month: '2026-11' });
      assert.equal(filename, 'TECHNICON_Stock_In_Out_2026-11.xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      assert.deepEqual(wb.worksheets.map((w) => w.name), ['Stock In', 'Stock Out', 'Movements']);
      const inWs = wb.getWorksheet('Stock In');
      const header = inWs.getRow(1).values.slice(1);
      assert.deepEqual(header.slice(0, 5), ['Part No', 'Description', 'Unit', 'Opening', '1']);
      assert.equal(header.length, 4 + 30 + 5);
      assert.equal(inWs.getRow(2).getCell(4 + 3).value, 10, 'day 3 stock in');
      assert.equal(wb.getWorksheet('Stock Out').getRow(2).getCell(4 + 3).value, 4, 'day 3 stock out');
      assert.equal(inWs.getRow(2).getCell(header.length).value, 11, 'closing');
      assert.equal(wb.getWorksheet('Movements').getRow(2).getCell(3).value, 'P-1');
    } finally { s.restore(); }
  });
});
