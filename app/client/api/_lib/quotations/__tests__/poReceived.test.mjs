// Tests for "PO received" validation and the green-row Excel export. Run with:  npm --prefix app/client run test:po
// No database and no network: the request parser is a pure function, and the workbook builder is given rows directly.
// (A dummy DATABASE_URL is set only because the export module imports the database module; nothing connects.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { parsePoRequest, PoRequestError } = await import('../poReceived.js');
const { generateExcelBuffer } = await import('../../routes/export.js');
const { default: ExcelJS } = await import('exceljs');

const VALID = new Set([11, 12, 13]);
const TODAY = '2026-11-17';
const ok = (over = {}) => parsePoRequest({ po_number: 'PO/2026/0042', items: [{ quotation_item_id: 11, qty: 4 }], ...over }, VALID, TODAY);
const bad = (body, re) => assert.throws(() => parsePoRequest(body, VALID, TODAY), (e) => e instanceof PoRequestError && e.status === 400 && re.test(e.message));

describe('PO received request', () => {
  test('case 1: every item ordered at the quoted quantity', () => {
    const r = ok({ items: [11, 12, 13].map((id) => ({ quotation_item_id: id, qty: 5 })) });
    assert.equal(r.items.length, 3);
    assert.equal(r.po_number, 'PO/2026/0042');
    assert.equal(r.po_date, TODAY, 'the date defaults to today');
  });

  test('case 2: only selected items and quantities', () => {
    const r = ok({ items: [{ quotation_item_id: 12, qty: 2 }, { quotation_item_id: 13, qty: '4.5' }], po_date: '2026-11-10', notes: ' balance to follow ' });
    assert.deepEqual(r.items, [{ quotation_item_id: 12, qty: 2 }, { quotation_item_id: 13, qty: 4.5 }]);
    assert.equal(r.po_date, '2026-11-10');
    assert.equal(r.notes, 'balance to follow');
  });

  test('the PO number is typed by hand and trimmed', () => {
    assert.equal(ok({ po_number: '  4500012345  ' }).po_number, '4500012345');
    bad({ items: [{ quotation_item_id: 11, qty: 1 }] }, /PO number/);
    bad({ po_number: '   ', items: [{ quotation_item_id: 11, qty: 1 }] }, /PO number/);
    bad({ po_number: 'x'.repeat(61), items: [{ quotation_item_id: 11, qty: 1 }] }, /at most 60/);
    bad({ po_number: 'PO\u0000', items: [{ quotation_item_id: 11, qty: 1 }] }, /invalid characters/);
    bad({ po_number: 'PO\r\n1', items: [{ quotation_item_id: 11, qty: 1 }] }, /invalid characters/);
  });

  test('at least one item, each belonging to the quotation, once, with a quantity above 0', () => {
    bad({ po_number: 'P1' }, /at least one item/);
    bad({ po_number: 'P1', items: [] }, /at least one item/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 99, qty: 1 }] }, /does not belong/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 11, qty: 1 }, { quotation_item_id: 11, qty: 2 }] }, /twice/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 11, qty: 0 }] }, /above 0/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 11, qty: -3 }] }, /above 0/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 11, qty: 'abc' }] }, /above 0/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: 11, qty: 1e9 }] }, /too large/);
    bad({ po_number: 'P1', items: [{ quotation_item_id: '1; DROP', qty: 1 }] }, /does not belong/);
  });

  test('bad dates and malformed bodies', () => {
    bad({ po_number: 'P1', po_date: '31-12-2026', items: [{ quotation_item_id: 11, qty: 1 }] }, /valid PO date/);
    bad({ po_number: 'P1', po_date: '2026-02-30', items: [{ quotation_item_id: 11, qty: 1 }] }, /valid PO date/);
    bad(null, /Invalid request/);
    bad([], /Invalid request/);
  });
});

describe('buildQuotationExport (shared by the signed-in export and the live Excel link)', async () => {
  const { buildQuotationExport } = await import('../../routes/export.js');
  const { default: db } = await import('../../db/index.js');
  const rows = [
    { quotation_number: 'Q-1', customer_name: 'With PO Ltd', status: 'accepted', total_amount: 100, po_numbers: '4500012345' },
    { quotation_number: 'Q-2', customer_name: 'No PO Ltd', status: 'sent', total_amount: 50, po_numbers: null },
  ];

  test('runs end to end with a stubbed database: chosen columns, green row, and the own-quotations scope', async () => {
    const realPrepare = db.prepare;
    const seen = [];
    db.prepare = (sql) => ({ all: async (...params) => { seen.push({ sql, params }); return rows.map((r) => ({ ...r })); }, get: async () => ({ n: 0 }) });
    try {
      // poReceivedReady() asks the catalogue, which the stub does not know, so PO columns are treated as absent
      const { buffer, filename } = await buildQuotationExport({ columns: 'quotation_number,customer_name,status' }, { createdByUserId: 20 });
      assert.match(filename, /^TECHNICON_Quotations_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.getWorksheet('Quotations');
      assert.deepEqual([1, 2, 3, 4].map((c) => ws.getRow(5).getCell(c).value), ['Quotation No', 'Customer', 'Status', null]);
      assert.equal(ws.getRow(6).getCell(1).value, 'Q-1');
      const main = seen.find((x) => /FROM quotation q/.test(x.sql));
      assert.match(main.sql, /AND q\.created_by_user_id = \?/);
      assert.ok(main.params.includes(20), 'the user id is a bound parameter');
    } finally {
      db.prepare = realPrepare;
    }
  });
});

describe('Excel export', () => {
  const columns = [
    { header: 'Quotation No', key: 'quotation_number' },
    { header: 'Customer', key: 'customer_name' },
    { header: 'PO Number(s)', key: 'po_numbers' },
  ];
  const data = [
    { quotation_number: 'Q-1', customer_name: 'With PO Ltd', po_numbers: '4500012345', _highlight: true },
    { quotation_number: 'Q-2', customer_name: 'No PO Ltd', po_numbers: null, _highlight: false },
    { quotation_number: 'Q-3', customer_name: 'Second PO Ltd', po_numbers: 'A-1, A-2', _highlight: true },
  ];

  test('rows that received a PO are green all the way across, the others are not; PO number is in its column', async () => {
    const buf = await generateExcelBuffer({ title: 'T', sheetName: 'Quotations', columns, data });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Quotations');
    const argb = (r, c) => ws.getRow(r).getCell(c).fill?.fgColor?.argb;
    for (const c of [1, 2, 3]) {
      assert.equal(argb(6, c), 'FFC6EFCE', `row 1 col ${c} is green`);
      assert.equal(argb(8, c), 'FFC6EFCE', `row 3 col ${c} is green`);
      assert.notEqual(argb(7, c), 'FFC6EFCE', `row 2 col ${c} is not green`);
    }
    assert.equal(ws.getRow(6).getCell(3).value, '4500012345');
    assert.equal(ws.getRow(8).getCell(3).value, 'A-1, A-2');
    assert.equal(ws.getRow(7).getCell(3).value, '');
  });

  test('only the chosen columns are written', async () => {
    const chosen = columns.filter((c) => c.key !== 'customer_name');
    const buf = await generateExcelBuffer({ title: 'T', sheetName: 'Quotations', columns: chosen, data });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Quotations');
    assert.deepEqual([1, 2, 3].map((c) => ws.getRow(5).getCell(c).value), ['Quotation No', 'PO Number(s)', null]);
  });
});
