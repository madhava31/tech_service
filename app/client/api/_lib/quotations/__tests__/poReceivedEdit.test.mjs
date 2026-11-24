// Editing a PO received (PUT /api/quotations/:id/po-received/:poId). Run with:  npm --prefix app/client run test:po
// No database: queries are stubbed.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { updatePo } = await import('../poReceived.js');
const { default: db } = await import('../../db/index.js');

describe('updatePo', () => {
  let state;
  beforeEach(() => {
    state = {
      pos: [{ id: 7, quotation_id: 3, po_number: 'PO-1', po_date: '2026-11-01', notes: null }],
      poItems: [{ quotation_po_id: 7, quotation_item_id: 11, qty: 5 }],
      lines: [{ id: 11, part_no: 'A1', description: 'Vials' }, { id: 12, part_no: 'B2', description: 'Caps' }],
      invoiced: [],
    };
    db.transaction = async (fn) => fn();
    db.prepare = (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      const run = (p) => {
        if (/^SELECT id FROM quotation_po WHERE id = \? AND quotation_id = \?/.test(q)) return state.pos.filter((x) => x.id === p[0] && x.quotation_id === p[1]);
        if (/^SELECT id, part_no, description FROM quotation_item/.test(q)) return state.lines;
        if (/FROM quotation_invoice_item/.test(q)) return state.invoiced;
        if (/FROM quotation_po_item pi JOIN quotation_po p/.test(q)) return [];
        if (/^UPDATE quotation_po SET/.test(q)) { Object.assign(state.pos[0], { po_number: p[0], po_date: p[1], notes: p[2] }); return []; }
        if (/^DELETE FROM quotation_po_item/.test(q)) { state.poItems = state.poItems.filter((x) => x.quotation_po_id !== p[0]); return []; }
        if (/^INSERT INTO quotation_po_item/.test(q)) { state.poItems.push({ quotation_po_id: p[0], quotation_item_id: p[1], qty: p[2] }); return []; }
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 90));
      };
      return { get: async (...p) => run(p)[0], all: async (...p) => run(p), run: async (...p) => { run(p); return { changes: 1 }; } };
    };
  });

  const call = async (params, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await updatePo({ params, body }, res);
    return res;
  };

  test('changes the number, date, notes, items and quantities', async () => {
    const r = await call({ id: '3', poId: '7' }, { po_number: 'PO-1A', po_date: '2026-11-05', notes: 'revised', items: [{ quotation_item_id: 11, qty: 3 }, { quotation_item_id: 12, qty: 2 }] });
    assert.equal(r.code, 200);
    assert.equal(state.pos[0].po_number, 'PO-1A');
    assert.equal(state.pos[0].po_date, '2026-11-05');
    assert.deepEqual(state.poItems.map((x) => [x.quotation_item_id, x.qty]), [[11, 3], [12, 2]]);
  });
  test('a quantity below what was already invoiced is refused (409)', async () => {
    state.invoiced = [{ quotation_item_id: 11, qty: 4 }];
    const r = await call({ id: '3', poId: '7' }, { po_number: 'PO-1', items: [{ quotation_item_id: 11, qty: 3 }] });
    assert.equal(r.code, 409);
    assert.match(r.body.error, /A1: 4 already invoiced/);
    assert.equal(state.poItems[0].qty, 5, 'nothing changed');
  });
  test('the same checks as a new PO, and a PO of another quotation is not found', async () => {
    assert.equal((await call({ id: '3', poId: '7' }, { po_number: '', items: [{ quotation_item_id: 11, qty: 1 }] })).code, 400);
    assert.equal((await call({ id: '3', poId: '7' }, { po_number: 'X', items: [{ quotation_item_id: 99, qty: 1 }] })).code, 400);
    assert.equal((await call({ id: '4', poId: '7' }, { po_number: 'X', items: [{ quotation_item_id: 11, qty: 1 }] })).code, 404);
  });
});
