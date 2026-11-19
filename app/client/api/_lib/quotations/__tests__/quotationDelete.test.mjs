// Deleting a quotation also deletes its invoices, so the stock those invoices took out of the warehouse has to come back.
// This drives the real DELETE /api/quotations/:id route with a fake database. Run with:  npm --prefix app/client run test:po
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { default: express } = await import('express');
const { default: router } = await import('../../routes/quotations.js');
const { INVOICE_COLUMNS, INVOICE_STOCK_REF, INVOICE_VOID_REF } = await import('../invoices.js');
const { default: db } = await import('../../db/index.js');

let S;
let migrated = false; // is migration 012 applied?
const placeholders = (sql) => (sql.replace(/'[^']*'/g, '').match(/\?/g) || []).length;
const fresh = () => ({
  stock: new Map([['1:100', { on_hand: 5, reserved: 0 }]]), // 10 in stock, an invoice took 5
  movements: [{ id: 1, warehouse_id: 1, product_id: 100, movement_type: 'STOCK_OUT', quantity: 5, reference_type: INVOICE_STOCK_REF, reference_id: '7', reason: 'Invoice INV-7' }],
  invoices: [{ id: 7, invoice_number: 'INV-7', quotation_id: 1 }],
  log: [],
  nextId: 2,
});

beforeEach(() => {
  S = fresh();
  db.prepare = (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (placeholders(q) !== params.length) throw new Error(`parameter count mismatch in: ${q.slice(0, 100)}`);
      if (/FROM information_schema\.columns/.test(q)) {
        if (!migrated) return [];
        return Object.entries(INVOICE_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
      }
      if (/information_schema\.table_constraints/.test(q)) return [{ ref_table: 'app_user' }];
      if (/^SELECT id FROM quotation WHERE id = \?/.test(q)) return [{ id: 1 }];
      if (/^SELECT id, invoice_number FROM quotation_invoice WHERE quotation_id = \?/.test(q)) return S.invoices.filter((i) => i.quotation_id === Number(params[0]));
      if (/FROM inventory_movement WHERE reference_type = \? AND reference_id = \? AND movement_type = 'STOCK_OUT'/.test(q)) return S.movements.filter((m) => m.reference_type === params[0] && m.reference_id === params[1] && m.movement_type === 'STOCK_OUT');
      if (/^SELECT id, part_no, description FROM product WHERE id/.test(q)) return [{ id: params[0] }];
      if (/^SELECT \* FROM warehouse WHERE id = \?/.test(q)) return [{ id: params[0], name: 'W' }];
      if (/^INSERT INTO inventory_stock/.test(q)) return [];
      if (/^SELECT \* FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(q)) { const s = S.stock.get(`${params[0]}:${params[1]}`); return [{ on_hand_quantity: s.on_hand, reserved_quantity: s.reserved }]; }
      if (/^UPDATE inventory_stock SET on_hand_quantity/.test(q)) { const s = S.stock.get(`${params[2]}:${params[3]}`); s.on_hand = params[0]; s.reserved = params[1]; S.log.push('stock ' + s.on_hand); return [{ on_hand_quantity: s.on_hand }]; }
      if (/^INSERT INTO inventory_movement/.test(q)) {
        const m = { id: S.nextId++, warehouse_id: params[0], product_id: params[1], movement_type: params[2], quantity: params[3], reference_type: params[8], reference_id: String(params[9]), reason: params[10] };
        S.movements.push(m);
        return [m];
      }
      if (/^SELECT id FROM performa_invoice WHERE quotation_id/.test(q) || /^SELECT id FROM purchase_order WHERE quotation_id/.test(q)) return [];
      if (/^DELETE FROM quotation WHERE id = \?/.test(q)) { S.log.push('quotation deleted'); S.invoices = []; return []; } // the invoices cascade
      if (/^(DELETE|UPDATE) /.test(q)) return [];
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 110));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
  };
  db.transaction = async (fn) => fn();
});

async function del(id) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/api/quotations', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/quotations/${id}`, { method: 'DELETE' });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('deleting a quotation', () => {
  // (runs first: the invoice tables are not there yet, and the delete must still work)
  test('before migration 012 (no invoice tables) the quotation still deletes', async () => {
    migrated = false;
    const r = await del(1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(S.log.includes('quotation deleted'));
    assert.equal(S.stock.get('1:100').on_hand, 5, 'nothing to put back');
  });

  test('the stock its invoice took out comes back, before the invoice disappears', async () => {
    migrated = true;
    const r = await del(1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(S.stock.get('1:100').on_hand, 10, '5 + the 5 that left with the invoice');
    const back = S.movements.find((m) => m.reference_type === INVOICE_VOID_REF);
    assert.deepEqual([back.movement_type, back.quantity, back.reference_id], ['ADJUSTMENT', 5, '7']);
    assert.match(back.reason, /Invoice INV-7 removed \(quotation deleted\)/);
    assert.ok(S.movements.some((m) => m.movement_type === 'STOCK_OUT'), 'the original stock out stays in the history');
    assert.ok(S.log.indexOf('stock 10') < S.log.indexOf('quotation deleted'), 'restored first, then deleted');
  });

  test('a quotation without invoices deletes without touching stock', async () => {
    migrated = true;
    S.invoices = [];
    S.movements = [];
    const r = await del(1);
    assert.equal(r.status, 200);
    assert.equal(S.stock.get('1:100').on_hand, 5);
    assert.equal(S.movements.length, 0);
  });

  test('an invoice with no stock lines (nothing was taken out) puts nothing back', async () => {
    migrated = true;
    S.movements = [];
    const r = await del(1);
    assert.equal(r.status, 200);
    assert.equal(S.stock.get('1:100').on_hand, 5);
    assert.equal(S.movements.length, 0);
  });
});
