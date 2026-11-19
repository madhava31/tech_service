// Tests for the PO number and date shown on a performa invoice. Run with:  npm --prefix app/client run test:po
// No database: a dummy DATABASE_URL is set only because the modules import the database module; queries are stubbed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { mergePoRefs, piReferenceLines, loadPoRefs } = await import('../poRefs.js');
const { default: db } = await import('../../db/index.js');

describe('mergePoRefs', () => {
  test('oldest first, no repeated number, blanks dropped, dates cut to the day', () => {
    const out = mergePoRefs(
      [{ po_number: ' PO-2 ', po_date: '2026-11-21T00:00:00.000Z' }, { po_number: 'PO-1', po_date: '2026-11-19' }, { po_number: '  ', po_date: '2026-11-01' }],
      [{ po_number: 'po-1', po_date: '2026-11-19' }, { po_number: 'OLD-7', po_date: '2026-11-10' }]
    );
    assert.deepEqual(out, [
      { po_number: 'OLD-7', po_date: '2026-11-10' },
      { po_number: 'PO-1', po_date: '2026-11-19' },
      { po_number: 'PO-2', po_date: '2026-11-21' },
    ]);
  });
  test('nothing in, nothing out', () => assert.deepEqual(mergePoRefs(), []));
});

describe('piReferenceLines: the PI is raised against the PO, not the quotation', () => {
  const fmt = (d) => d.split('-').reverse().join('-');
  test('one PO: its number and date, and no quotation number', () => {
    const lines = piReferenceLines([{ po_number: '4500012345', po_date: '2026-11-19' }], 'TSQOT2627/646', fmt);
    assert.deepEqual(lines, ['Against PO No. : 4500012345', 'PO Date : 19-11-2026']);
    assert.ok(!lines.join(' ').includes('TSQOT'));
  });
  test('several POs are all listed, in the same order for number and date', () => {
    const lines = piReferenceLines([{ po_number: 'A', po_date: '2026-11-19' }, { po_number: 'B', po_date: '2026-11-21' }], 'Q', fmt);
    assert.deepEqual(lines, ['Against PO No. : A, B', 'PO Date : 19-11-2026, 21-11-2026']);
  });
  test('a PO without a date shows a dash', () => {
    assert.deepEqual(piReferenceLines([{ po_number: 'A', po_date: null }], 'Q', fmt), ['Against PO No. : A', 'PO Date : —']);
  });
  test('no PO recorded yet: the quotation number is the reference, so nothing is blank', () => {
    assert.deepEqual(piReferenceLines([], 'TSQOT2627/646', fmt), ['Against Quotation: TSQOT2627/646']);
    assert.deepEqual(piReferenceLines(undefined, 'TSQOT2627/646', fmt), ['Against Quotation: TSQOT2627/646']);
    assert.deepEqual(piReferenceLines([], '', fmt), []);
  });
});

describe('loadPoRefs with a stubbed database', () => {
  test('PO received entries and older purchase orders (the customer\'s reference) are combined per quotation', async () => {
    const real = db.prepare;
    db.prepare = (sql) => ({
      all: async () => {
        const q = sql.replace(/\s+/g, ' ');
        if (/information_schema/.test(q)) return [];
        if (/FROM quotation_po /.test(q)) return [{ quotation_id: 1, po_number: 'RCV-1', po_date: '2026-11-19' }];
        if (/FROM purchase_order/.test(q)) return [{ quotation_id: 1, po_number: 'CUST-REF-9', po_date: '2026-11-15' }, { quotation_id: 2, po_number: 'TSPO-3', po_date: '2026-11-16' }];
        return [];
      },
    });
    try {
      const m = await loadPoRefs([1, 2, 3, 'x', 0]);
      // poReceivedReady() sees no columns in the stub, so only the older purchase orders are found
      assert.deepEqual(m.get(1), [{ po_number: 'CUST-REF-9', po_date: '2026-11-15' }]);
      assert.deepEqual(m.get(2), [{ po_number: 'TSPO-3', po_date: '2026-11-16' }]);
      assert.deepEqual(m.get(3), []);
      assert.equal(m.size, 3, 'only valid ids');
    } finally { db.prepare = real; }
  });
});

describe('the PI PDF', () => {
  test('it is produced with the PO lines and the sales engineer, without errors', async () => {
    const { streamPerformaInvoicePdf } = await import('../../pdf/documents.js');
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => out.on('end', resolve));
    out.setHeader = () => {};
    streamPerformaInvoicePdf(out, {
      pi: {
        number: 'TSPI/26-27/001', date: '2026-11-19', quotation_number: 'TSQOT2627/646', company_name: 'Acme Labs', company_address: 'Hyderabad', company_state: 'Telangana',
        subtotal: 100, tax_percent: 18, tax_amount: 18, total: 118, sales_engineer_name: 'Ganesh.D', created_by_username: 'Admin',
        po_refs: [{ po_number: '4500012345', po_date: '2026-11-19' }],
      },
      items: [{ part_no: 'P-1', description: 'Vial', qty: 1, price: 100, actual_unit_price: 100, final_unit_price: 100, amount: 100, final_line_total: 100 }],
      settings: { company_name: 'Technicon' },
    });
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('the PDF did not finish')), 8000))]);
    const pdf = Buffer.concat(chunks);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1500);
  });
});
