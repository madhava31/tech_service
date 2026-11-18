// Test for GET /api/purchase-orders/received (the Purchase Orders page lists the POs received and manual POs).
// Stub database, no network. Run with:  npm --prefix app/client run test:po
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/purchaseOrders.js');
const { PO_COLUMNS } = await import('../poReceived.js');
const { default: db } = await import('../../db/index.js');

async function call(user, { ready = true } = {}) {
  const seen = [];
  const real = db.prepare;
  db.prepare = (sql) => ({
    all: async (...p) => {
      if (/information_schema\.columns/.test(sql)) return ready ? Object.entries(PO_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c }))) : [];
      seen.push({ sql, params: p });
      return [{ id: 5, number: '4500012345', date: '2026-11-17', client_po_ref: '4500012345', status: 'Received', quotation_id: 1, quotation_number: 'TSQOT2627/1', company_name: 'TEST Customer', total: '1372930.5' }];
    },
  });
  const app = express();
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/purchase-orders', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/purchase-orders/received`);
    return { status: res.status, body: await res.json(), seen };
  } finally {
    db.prepare = real;
    await new Promise((r) => server.close(r));
  }
}

// The catalogue answer is cached once positive, so the "no migration yet" case runs first.
test('before migration 008 the list is simply empty (nothing breaks)', async () => {
  const r = await call({ id: 1, role: 'admin' }, { ready: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
});

test('the received POs come back in the PO list shape, with the total as a number', async () => {
  const r = await call({ id: 1, role: 'admin' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['client_po_ref', 'company_name', 'date', 'id', 'number', 'quotation_id', 'quotation_number', 'status', 'total']);
  assert.equal(r.body[0].number, '4500012345');
  assert.equal(r.body[0].total, 1372930.5);
  assert.doesNotMatch(r.seen[0].sql, /created_by_user_id/, 'an admin sees every PO');
  assert.deepEqual(r.seen[0].params, []);
});

test('a user who is not an admin sees only the POs of their own quotations', async () => {
  const r = await call({ id: 7, role: 'staff' });
  assert.match(r.seen[0].sql, /WHERE q\.created_by_user_id = \?/);
  assert.deepEqual(r.seen[0].params, [7]);
});
