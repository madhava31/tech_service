// Voiding a confirmed stock receipt (instead of deleting it). Run with:  npm --prefix app/client run test:inventory
// The real routes run against a fake database that also checks every statement has the right number of parameters.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/inventory.js');
const { default: db } = await import('../../db/index.js');

let S;
let role = 'admin';
const placeholders = (sql) => (sql.replace(/'[^']*'/g, '').match(/\?/g) || []).length;
const fresh = () => ({
  receipts: [{ id: 7, receipt_number: 'REC2627/1', status: 'CONFIRMED', warehouse_id: 1, notes: 'Mettler import' }, { id: 8, receipt_number: 'REC2627/2', status: 'DRAFT', warehouse_id: 1, notes: null }],
  items: [{ receipt_id: 7, product_id: 100, quantity: 4 }, { receipt_id: 7, product_id: 200, quantity: 2 }, { receipt_id: 8, product_id: 100, quantity: 1 }],
  stock: new Map([['1:100', { on_hand: 10, reserved: 0 }], ['1:200', { on_hand: 2, reserved: 0 }]]),
  movements: [
    { id: 1, warehouse_id: 1, product_id: 100, movement_type: 'STOCK_IN', quantity: 4, reference_type: 'STOCK_RECEIPT', reference_id: '7' },
    { id: 2, warehouse_id: 1, product_id: 200, movement_type: 'STOCK_IN', quantity: 2, reference_type: 'STOCK_RECEIPT', reference_id: '7' },
  ],
  products: new Map([[100, { id: 100, part_no: 'B01' }], [200, { id: 200, part_no: 'B02' }]]),
  nextId: 10,
});

beforeEach(() => {
  S = fresh();
  role = 'admin';
  db.pool.query = async () => ({ rows: [] });
  db.transaction = async (fn) => {
    const snap = { receipts: S.receipts.map((r) => ({ ...r })), stock: new Map([...S.stock].map(([k, v]) => [k, { ...v }])), movements: [...S.movements], items: [...S.items] };
    try { return await fn(); } catch (e) { Object.assign(S, snap); throw e; }
  };
  db.prepare = (text) => {
    const q = text.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (placeholders(q) !== params.length) throw new Error(`parameter count mismatch in: ${q.slice(0, 110)}`);
      if (/FROM session s JOIN app_user/.test(q)) return [{ id: 1, username: 'admin', role, expires_at: new Date(Date.now() + 3600e3).toISOString() }];
      if (/information_schema\.table_constraints/.test(q)) return [{ ref_table: 'app_user' }];
      if (/^SELECT \* FROM stock_receipt WHERE id = \?/.test(q)) return S.receipts.filter((r) => r.id === params[0]);
      if (/^SELECT id, receipt_number FROM stock_receipt WHERE id = \?/.test(q) || /^SELECT id, receipt_number FROM stock_receipt WHERE id/.test(q)) return S.receipts.filter((r) => r.id === params[0]).map((r) => ({ id: r.id, receipt_number: r.receipt_number }));
      if (/^SELECT product_id, SUM\(quantity\)::float8 AS quantity FROM stock_receipt_item WHERE receipt_id = \?/.test(q)) {
        const byP = new Map();
        for (const i of S.items.filter((x) => x.receipt_id === params[0])) byP.set(i.product_id, (byP.get(i.product_id) || 0) + i.quantity);
        return [...byP].filter(([, qty]) => qty > 0).map(([product_id, quantity]) => ({ product_id, quantity }));
      }
      if (/^SELECT on_hand_quantity, reserved_quantity FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(q)) { const s = S.stock.get(`${params[0]}:${params[1]}`); return s ? [{ on_hand_quantity: s.on_hand, reserved_quantity: s.reserved }] : []; }
      if (/^SELECT id, part_no FROM product WHERE id = ANY/.test(q)) return [...S.products.values()];
      if (/^SELECT id, part_no, description FROM product WHERE id/.test(q)) return [S.products.get(params[0])].filter(Boolean);
      if (/^SELECT \* FROM warehouse WHERE id = \?/.test(q)) return [{ id: params[0], name: 'W' }];
      if (/^INSERT INTO inventory_stock/.test(q)) return [];
      if (/^SELECT \* FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(q)) { const s = S.stock.get(`${params[0]}:${params[1]}`); return [{ on_hand_quantity: s.on_hand, reserved_quantity: s.reserved }]; }
      if (/^UPDATE inventory_stock SET on_hand_quantity = \?/.test(q)) { const s = S.stock.get(`${params[2]}:${params[3]}`); s.on_hand = params[0]; s.reserved = params[1]; return [{ on_hand_quantity: s.on_hand }]; }
      if (/^INSERT INTO inventory_movement/.test(q)) {
        const m = { id: S.nextId++, warehouse_id: params[0], product_id: params[1], movement_type: params[2], quantity: params[3], before_on_hand: params[4], after_on_hand: params[5], reference_type: params[8], reference_id: String(params[9]), reason: params[10] };
        S.movements.push(m);
        return [m];
      }
      if (/^UPDATE stock_receipt SET status = 'CANCELLED', notes = \? WHERE id = \?/.test(q)) { const r = S.receipts.find((x) => x.id === params[1]); r.status = 'CANCELLED'; r.notes = params[0]; return []; }
      // receipt detail
      if (/FROM stock_receipt r LEFT JOIN warehouse w/.test(q)) return S.receipts.filter((r) => r.id === params[0]);
      if (/FROM stock_receipt_item sri/.test(q)) return [];
      if (/FROM inventory_movement m LEFT JOIN product p/.test(q)) return [];
      // delete
      if (/^SELECT DISTINCT r\.receipt_number FROM stock_receipt r WHERE r\.id = ANY/.test(q)) {
        const ids = String(params[0]).replace(/[{}]/g, '').split(',').map(Number);
        return S.receipts.filter((r) => ids.includes(r.id) && S.movements.some((m) => ['STOCK_RECEIPT', 'STOCK_RECEIPT_VOID'].includes(m.reference_type) && m.reference_id === String(r.id))).map((r) => ({ receipt_number: r.receipt_number }));
      }
      if (/^SELECT sri\.product_id/.test(q)) return [];
      if (/^DELETE FROM stock_receipt WHERE id = ANY/.test(q)) { const ids = params[0]; S.receipts = S.receipts.filter((r) => !ids.includes(r.id)); return []; }
      if (/^(DELETE|UPDATE) /.test(q)) return [];
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 120));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
  };
});

async function call(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cookies = { session: 'tok' }; next(); });
  app.use('/api/inventory', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('void a confirmed receipt', () => {
  test('the stock it added comes out again with correcting entries; the history stays and the receipt is cancelled', async () => {
    const r = await call('POST', '/receipts/7/void', { reason: 'wrong delivery' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(S.stock.get('1:100').on_hand, 6, '10 - 4');
    assert.equal(S.stock.get('1:200').on_hand, 0, '2 - 2');
    const voids = S.movements.filter((m) => m.reference_type === 'STOCK_RECEIPT_VOID');
    assert.deepEqual(voids.map((m) => [m.movement_type, m.quantity, m.before_on_hand, m.after_on_hand, m.reference_id]), [['ADJUSTMENT', 4, 10, 6, '7'], ['ADJUSTMENT', 2, 2, 0, '7']]);
    assert.match(voids[0].reason, /Receipt REC2627\/1 voided - wrong delivery/);
    assert.equal(S.movements.filter((m) => m.movement_type === 'STOCK_IN').length, 2, 'the original stock in stays in the history');
    const rec = S.receipts.find((x) => x.id === 7);
    assert.equal(rec.status, 'CANCELLED');
    assert.match(rec.notes, /Mettler import \| Voided \d{4}-\d{2}-\d{2}: wrong delivery/);
  });

  test('some of the stock already left: refused, and nothing at all changes', async () => {
    S.stock.set('1:100', { on_hand: 3, reserved: 0 }); // 4 were received, 1 is left
    const r = await call('POST', '/receipts/7/void');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Cannot void REC2627\/1/);
    assert.match(r.body.error, /B01 \(4 received, only 3 still free\)/);
    assert.equal(S.stock.get('1:100').on_hand, 3);
    assert.equal(S.stock.get('1:200').on_hand, 2, 'the other line is untouched too');
    assert.equal(S.receipts[0].status, 'CONFIRMED');
    assert.equal(S.movements.length, 2);
  });

  test('reserved stock counts as not free', async () => {
    S.stock.set('1:200', { on_hand: 2, reserved: 1 });
    const r = await call('POST', '/receipts/7/void');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /B02 \(2 received, only 1 still free\)/);
  });

  test('a draft receipt, an already cancelled one, an unknown one and a non-admin are all refused', async () => {
    assert.equal((await call('POST', '/receipts/8/void')).status, 400, 'draft: cancel it instead');
    await call('POST', '/receipts/7/void');
    const again = await call('POST', '/receipts/7/void');
    assert.equal(again.status, 400);
    assert.match(again.body.error, /already cancelled/);
    assert.equal((await call('POST', '/receipts/999/void')).status, 404);
    role = 'staff';
    S = Object.assign(S, { receipts: fresh().receipts });
    const staff = await call('POST', '/receipts/7/void');
    assert.equal(staff.status, 403);
  });
});

describe('deleting a receipt', () => {
  test('a receipt that added stock cannot be deleted: its history would be lost', async () => {
    const r = await call('DELETE', '/receipts/7');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /REC2627\/1 added stock/);
    assert.match(r.body.error, /Void the receipt instead/);
    assert.equal(S.receipts.length, 2);
    assert.equal(S.movements.length, 2);
  });

  test('a voided receipt keeps its history too', async () => {
    await call('POST', '/receipts/7/void');
    const r = await call('DELETE', '/receipts/7');
    assert.equal(r.status, 409);
  });

  test('a draft (no stock history) can still be deleted', async () => {
    const r = await call('DELETE', '/receipts/8');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(S.receipts.map((x) => x.id), [7]);
  });
});
