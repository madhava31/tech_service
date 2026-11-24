// Deleting a purchase order record made with "Create PO" (DELETE /api/purchase-orders/:id). Run with:  npm --prefix app/client run test:po
// No database: queries are stubbed.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/purchaseOrders.js');
const { default: db } = await import('../../db/index.js');
const { PO_COLUMNS } = await import('../poReceived.js');

describe('DELETE /api/purchase-orders/:id', () => {
  let state;
  beforeEach(() => {
    state = {
      pos: [{ id: 5, number: 'PO2627/1', quotation_id: 55 }, { id: 6, number: 'PO2627/2', quotation_id: 65 }, { id: 7, number: 'PO2627/3', quotation_id: 65 }],
      received: [],
      quotations: { 55: 'accepted', 65: 'accepted' },
      unlinked: [],
    };
    db.transaction = async (fn) => fn();
    db.prepare = (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      const run = (p) => {
        if (/information_schema/.test(q)) return Object.entries(PO_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
        if (/^SELECT id, number, quotation_id FROM purchase_order WHERE id = \?/.test(q)) return state.pos.filter((x) => x.id === p[0]);
        if (/^UPDATE sale_report SET source_po_id = NULL/.test(q)) { state.unlinked.push(['sale_report', p[0]]); return []; }
        if (/^UPDATE procurement_requirement SET purchase_order_id = NULL/.test(q)) { state.unlinked.push(['procurement', p[0]]); return []; }
        if (/^DELETE FROM purchase_order WHERE id = \?/.test(q)) { state.pos = state.pos.filter((x) => x.id !== p[0]); return []; }
        if (/^SELECT COUNT\(\*\) AS n FROM purchase_order WHERE quotation_id = \?/.test(q)) return [{ n: state.pos.filter((x) => x.quotation_id === p[0]).length }];
        if (/^SELECT COUNT\(\*\) AS n FROM quotation_po WHERE quotation_id = \?/.test(q)) return [{ n: state.received.filter((x) => x === p[0]).length }];
        if (/^UPDATE quotation SET status = 'sent'/.test(q)) { if (state.quotations[p[0]] === 'accepted') state.quotations[p[0]] = 'sent'; return []; }
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 90));
      };
      return { get: async (...p) => run(p)[0], all: async (...p) => run(p), run: async (...p) => { run(p); return { changes: 1 }; } };
    };
  });

  async function del(id) {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 2, role: 'staff' }; next(); });
    app.use('/api/purchase-orders', router);
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/purchase-orders/${id}`, { method: 'DELETE' });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  test('deletes the record, clears links to it, and the quotation goes back to "sent" when no PO is left', async () => {
    const r = await del(5);
    assert.equal(r.status, 200);
    assert.ok(!state.pos.some((x) => x.id === 5));
    assert.deepEqual(state.unlinked, [['sale_report', 5], ['procurement', 5]]);
    assert.equal(state.quotations[55], 'sent');
  });
  test('the quotation stays accepted while it still has another PO', async () => {
    await del(6);
    assert.equal(state.quotations[65], 'accepted');
  });
  test('a PO received on the quotation also keeps it accepted', async () => {
    state.received = [55];
    await del(5);
    assert.equal(state.quotations[55], 'accepted');
  });
  test('unknown or invalid ids', async () => {
    assert.equal((await del(99)).status, 404);
    assert.equal((await del('abc')).status, 400);
  });
});
