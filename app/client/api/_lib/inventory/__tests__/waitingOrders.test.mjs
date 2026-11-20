// Tests for the waiting orders: which customer orders can be shipped from stock now. Run with:  npm --prefix app/client run test:inventory
// A fake database stands in for Postgres; nothing connects.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { allocateOrders, summarise, loadWaitingOrders, buildWaitingOrdersExcel } = await import('../waitingOrders.js');
const { PO_COLUMNS } = await import('../../quotations/poReceived.js');
const { INVOICE_COLUMNS } = await import('../../quotations/invoices.js');
const { default: db } = await import('../../db/index.js');
const { default: ExcelJS } = await import('exceljs');

const line = (o) => ({ quotation_id: 1, quotation_item_id: 1, product_id: 100, company_id: 1, company_name: 'Laurus', ordered: 5, invoiced: 0, po_date: '2026-11-10', ...o });

describe('allocateOrders', () => {
  test('stock covers the order: ready; the example 5 of 10', () => {
    const r = allocateOrders([line({ ordered: 5 })], new Map([[100, 10]]));
    assert.deepEqual([r[0].pending, r[0].can_ship, r[0].short, r[0].status], [5, 5, 0, 'ready']);
  });

  test('what was already invoiced is not pending; fully invoiced lines disappear', () => {
    const r = allocateOrders([line({ ordered: 10, invoiced: 4 }), line({ quotation_item_id: 2, ordered: 3, invoiced: 3 })], new Map([[100, 100]]));
    assert.equal(r.length, 1);
    assert.equal(r[0].pending, 6);
  });

  test('not enough stock: partly ready, and the rest is short', () => {
    const r = allocateOrders([line({ ordered: 5 })], new Map([[100, 3]]));
    assert.deepEqual([r[0].can_ship, r[0].short, r[0].status], [3, 2, 'partly']);
  });

  test('no stock: waiting (to be ordered from the supplier)', () => {
    const r = allocateOrders([line({ ordered: 5 })], new Map());
    assert.deepEqual([r[0].can_ship, r[0].short, r[0].status, r[0].available], [0, 5, 'waiting', 0]);
  });

  test('two customers want the same part: the older PO gets the stock first, nothing is promised twice', () => {
    const r = allocateOrders(
      [
        line({ quotation_id: 2, quotation_item_id: 20, company_id: 2, company_name: 'Newer Ltd', ordered: 4, po_date: '2026-11-18' }),
        line({ quotation_id: 1, quotation_item_id: 10, company_id: 1, company_name: 'Older Ltd', ordered: 4, po_date: '2026-11-10' }),
      ],
      new Map([[100, 6]])
    );
    assert.deepEqual(r.map((x) => [x.company_name, x.can_ship, x.status]), [['Older Ltd', 4, 'ready'], ['Newer Ltd', 2, 'partly']]);
    assert.equal(r.reduce((a, x) => a + x.can_ship, 0), 6, 'exactly the stock, no more');
  });

  test('different products do not share stock; an order without a PO date comes last', () => {
    const r = allocateOrders(
      [line({ product_id: 200, quotation_item_id: 5, ordered: 2 }), line({ quotation_item_id: 6, ordered: 2, po_date: null }), line({ quotation_item_id: 7, ordered: 2, po_date: '2026-11-01' })],
      new Map([[100, 2], [200, 2]])
    );
    const byItem = Object.fromEntries(r.map((x) => [x.quotation_item_id, x.status]));
    assert.equal(byItem[5], 'ready', 'its own stock');
    assert.equal(byItem[7], 'ready', 'dated PO first');
    assert.equal(byItem[6], 'waiting', 'undated PO last, stock already used');
  });

  test('reserved stock is not available (the caller passes on hand minus reserved)', () => {
    assert.equal(allocateOrders([line({ ordered: 2 })], new Map([[100, -3]]))[0].status, 'waiting', 'a negative figure counts as nothing');
  });
});

describe('summarise', () => {
  test('counts per status, customers and what has to be ordered', () => {
    const rows = allocateOrders(
      [line({ ordered: 2 }), line({ quotation_item_id: 2, product_id: 200, company_id: 2, ordered: 5 }), line({ quotation_item_id: 3, product_id: 300, company_id: 2, ordered: 4 })],
      new Map([[100, 5], [200, 2]])
    );
    assert.deepEqual(summarise(rows), { lines: 3, ready: 1, partly: 1, waiting: 1, customers: 2, units_to_order: 3 + 4 });
  });
});

// ---------- the real loader, with a fake database ----------
let sql;
const placeholders = (q) => (q.replace(/'[^']*'/g, '').match(/\?/g) || []).length;
const ROWS = [
  { quotation_id: 1, quotation_number: 'Q-1', company_id: 1, company_name: 'Laurus Labs', quotation_item_id: 11, product_id: 100, part_no: 'B01', description: 'Vial', ordered: 5, invoiced: 0, po_date: '2026-11-10', po_numbers: 'PO-1', unit: 'Nos' },
  { quotation_id: 2, quotation_item_id: 21, quotation_number: 'Q-2', company_id: 2, company_name: 'Trisu Labs', product_id: 100, part_no: 'B01', description: 'Vial', ordered: 4, invoiced: 0, po_date: '2026-11-18', po_numbers: 'PO-2', unit: 'Nos' },
];
beforeEach(() => {
  sql = [];
  db.prepare = (text) => {
    const q = text.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (placeholders(q) !== params.length) throw new Error(`parameter count mismatch in: ${q.slice(0, 100)}`);
      sql.push({ q, params });
      if (/FROM information_schema\.columns/.test(q)) return Object.entries({ ...PO_COLUMNS, ...INVOICE_COLUMNS }).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
      if (/FROM quotation q JOIN company c/.test(q)) return ROWS;
      if (/FROM inventory_stock/.test(q)) return [{ product_id: 100, available: 6 }];
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
  };
});

describe('loadWaitingOrders', () => {
  test('the older PO is ready, the newer one partly; the summary adds up', async () => {
    const r = await loadWaitingOrders({}, { isAdmin: true });
    assert.deepEqual(r.orders.map((o) => [o.quotation_number, o.can_ship, o.status]), [['Q-1', 5, 'ready'], ['Q-2', 1, 'partly']]);
    assert.deepEqual([r.summary.ready, r.summary.partly, r.summary.waiting, r.summary.customers], [1, 1, 0, 2]);
  });

  test('a user who is not an admin only sees their own quotations (bound parameter)', async () => {
    await loadWaitingOrders({}, { isAdmin: false, userId: 42 });
    const main = sql.find((s) => /FROM quotation q JOIN company c/.test(s.q));
    assert.match(main.q, /q\.created_by_user_id = \?/);
    assert.ok(main.params.includes(42));
    await loadWaitingOrders({}, { isAdmin: true });
    assert.doesNotMatch(sql.filter((s) => /FROM quotation q JOIN company c/.test(s.q)).pop().q, /created_by_user_id/);
  });

  test('filters: product ids are bound, status and text narrow the list but not the summary', async () => {
    const r = await loadWaitingOrders({ productIds: '100, x, 100', status: 'partly', q: 'trisu' }, { isAdmin: true });
    const main = sql.find((s) => /FROM quotation q JOIN company c/.test(s.q));
    assert.deepEqual(main.params, ['{100}']);
    assert.deepEqual(r.orders.map((o) => o.quotation_number), ['Q-2']);
    assert.equal(r.summary.lines, 1, 'the text filter narrows the summary too; the status filter does not');
  });

  test('the Excel file has one row per waiting line with its status', async () => {
    const { buffer, filename } = await buildWaitingOrdersExcel({}, { isAdmin: true });
    assert.match(filename, /^TECHNICON_Waiting_Orders_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Waiting orders');
    assert.equal(ws.getRow(1).getCell(1).value, 'Customer');
    assert.deepEqual([ws.getRow(2).getCell(1).value, ws.getRow(2).getCell(11).value, ws.getRow(2).getCell(13).value], ['Laurus Labs', 5, 'Ready']);
    assert.deepEqual([ws.getRow(3).getCell(11).value, ws.getRow(3).getCell(12).value, ws.getRow(3).getCell(13).value], [1, 3, 'Partly ready']);
  });
});
