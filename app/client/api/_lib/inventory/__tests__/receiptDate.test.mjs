// Drives the real "stock in" route (POST /api/inventory/receipts) with a fake database, to check that the date the user
// picks is saved on the receipt, its lines and the stock movement, and that every statement has the right number of
// parameters. Run with:  npm --prefix app/client run test:inventory
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/inventory.js');
const { default: db } = await import('../../db/index.js');

let inserts;
// the number of ? placeholders outside quoted text
const placeholders = (sql) => (sql.replace(/'[^']*'/g, '').match(/\?/g) || []).length;

beforeEach(() => {
  inserts = [];
  // the route creates the inventory tables on first use: nothing to do against a fake database
  db.pool.query = async () => ({ rows: [] });
  db.prepare = (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      const flat = params.flat();
      const n = placeholders(q);
      if (n !== flat.length) throw new Error(`parameter count mismatch: ${n} placeholders, ${flat.length} values in: ${q.slice(0, 110)}`);
      if (/FROM session s JOIN app_user/.test(q)) return [{ id: 1, username: 'admin', role: 'admin', expires_at: new Date(Date.now() + 3600e3).toISOString() }];
      if (/information_schema\.table_constraints/.test(q)) return [{ ref_table: 'app_user' }];
      if (/^SELECT id FROM warehouse WHERE id = \?/.test(q)) return [{ id: 1 }];
      if (/^SELECT receipt_number FROM stock_receipt/.test(q)) return [];
      if (/^INSERT INTO stock_receipt \(/.test(q)) { inserts.push({ table: 'receipt', q, params: flat }); return [{ id: 7 }]; }
      if (/^SELECT on_hand_quantity FROM inventory_stock/.test(q)) return [{ on_hand_quantity: 10 }];
      if (/^UPDATE inventory_stock/.test(q)) return [];
      if (/^INSERT INTO inventory_movement/.test(q)) { inserts.push({ table: 'movement', q, params: flat }); return []; }
      if (/^INSERT INTO stock_receipt_item/.test(q)) { inserts.push({ table: 'item', q, params: flat }); return []; }
      if (/FROM stock_receipt r LEFT JOIN warehouse w/.test(q)) return [{ id: 7, receipt_number: 'REC2627/1', status: 'CONFIRMED' }];
      if (/FROM stock_receipt_item sri/.test(q)) return [];
      if (/FROM inventory_movement m LEFT JOIN product p/.test(q)) return [];
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 120));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => ({ changes: 1, lastInsertRowid: rows(p)[0]?.id }) };
  };
  db.transaction = async (fn) => fn();
});

async function post(body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cookies = { session: 'tok' }; next(); });
  app.use('/api/inventory', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory/receipts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const base = { warehouseId: 1, sourceType: 'MANUAL', items: [{ productId: 100, quantity: 3 }], confirmImmediately: true };

describe('stock in with a date', () => {
  test('a past date is saved on the receipt, its line and the movement (noon India time that day)', async () => {
    const r = await post({ ...base, receiptDate: '2026-11-05' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = '2026-11-05 06:30:00';
    const receipt = inserts.find((i) => i.table === 'receipt');
    assert.equal(receipt.params[receipt.params.length - 1], d, 'created_at');
    assert.equal(receipt.params[receipt.params.length - 2], d, 'confirmed_at');
    assert.equal(inserts.find((i) => i.table === 'movement').params.slice(-1)[0], d, 'the stock movement is dated');
    assert.equal(inserts.find((i) => i.table === 'item').params.slice(-1)[0], d, 'the receipt line is dated');
  });

  test('no date: everything takes the current time, as before', async () => {
    const r = await post(base);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(inserts.find((i) => i.table === 'receipt').params.slice(-1)[0], null);
    assert.equal(inserts.find((i) => i.table === 'movement').params.slice(-1)[0], null);
    assert.equal(inserts.find((i) => i.table === 'item').params.slice(-1)[0], null);
  });

  test("today's date also means now (the real time of day is kept)", async () => {
    const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
    const r = await post({ ...base, receiptDate: today });
    assert.equal(r.status, 201);
    assert.equal(inserts.find((i) => i.table === 'movement').params.slice(-1)[0], null);
  });

  test('a future or invalid date is refused and nothing is saved', async () => {
    for (const bad of ['2999-01-01', 'not-a-date', '2026-02-31']) {
      const r = await post({ ...base, receiptDate: bad });
      assert.equal(r.status, 400, bad);
      assert.match(r.body.error, /date/i);
    }
    assert.equal(inserts.length, 0, 'no receipt, line or movement was written');
  });
});
