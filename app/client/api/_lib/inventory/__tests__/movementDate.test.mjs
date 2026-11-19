// Tests for the date on a stock movement. Run with:  npm --prefix app/client run test:inventory
// A stubbed database stands in for Postgres; nothing connects.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { movementTimestamp } = await import('../movementDate.js');
const { openingFromStock } = await import('../movementReport.js');
const svc = await import('../service.js');
const { default: db } = await import('../../db/index.js');

describe('movementTimestamp', () => {
  const TODAY = '2026-11-19';
  test('no date or today = now (null); an earlier day = noon India time that day', () => {
    assert.equal(movementTimestamp(undefined, TODAY), null);
    assert.equal(movementTimestamp('', TODAY), null);
    assert.equal(movementTimestamp('2026-11-19', TODAY), null);
    assert.equal(movementTimestamp('2026-11-05', TODAY), '2026-11-05 06:30:00');
    assert.equal(movementTimestamp('2026-11-05T10:00:00Z', TODAY), '2026-11-05 06:30:00', 'only the day counts');
  });
  test('a future, invalid or ancient date is refused with a 400', () => {
    for (const [v, re] of [['2026-11-20', /future/], ['2027-01-01', /future/], ['19-11-2026', /valid/], ['2026-02-30', /valid/], ['hello', /valid/], ['1999-12-31', /too far/]]) {
      assert.throws(() => movementTimestamp(v, TODAY), (e) => e.status === 400 && re.test(e.message), String(v));
    }
  });
  test('noon India time falls on the same day in India and in UTC', () => {
    // 06:30 UTC is 12:00 IST, so a report that groups by India day puts it on the chosen day
    assert.equal(new Date('2026-11-05T06:30:00Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), '2026-11-05');
  });
});

describe('opening stock does not depend on the order entries were made', () => {
  test('held now minus the changes since the start of the period', () => {
    const rows = openingFromStock([{ product_id: 1, on_hand: 11 }, { product_id: 2, on_hand: 4 }], [{ product_id: 1, delta: 6 }, { product_id: 3, delta: -2 }]);
    const m = new Map(rows.map((r) => [r.product_id, r.opening]));
    assert.equal(m.get(1), 5);
    assert.equal(m.get(2), 4, 'nothing moved since: opening = stock now');
    assert.equal(m.get(3), 2, 'no stock row left: opening is the reverse of what moved');
  });
  test('a stock-in entered today for an earlier date moves the opening of the later period, not the chain', () => {
    // 10 units were counted on 1 Nov (opening of November = 10). On 19 Nov someone enters 5 received on 10 Oct.
    // Stock now = 10 + 5 = 15; the changes since 1 Nov are still 0, so November still opens with 15 - 0 = 15 (the 5 did arrive
    // before November), and October's report (start 1 Oct) sees 15 - 5 = 10 at its start.
    assert.equal(openingFromStock([{ product_id: 1, on_hand: 15 }], [])[0].opening, 15);
    assert.equal(openingFromStock([{ product_id: 1, on_hand: 15 }], [{ product_id: 1, delta: 5 }])[0].opening, 10);
  });
});

// ---------- the service passes the date to the movement row ----------
let seen;
beforeEach(() => {
  seen = [];
  db.prepare = (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (/^SELECT id, part_no, description FROM product/.test(q)) return [{ id: 1 }];
      if (/^SELECT \* FROM warehouse WHERE id/.test(q)) return [{ id: 1, name: 'W' }];
      if (/^INSERT INTO inventory_stock/.test(q)) return [];
      if (/^SELECT \* FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(q)) return [{ on_hand_quantity: 10, reserved_quantity: 0 }];
      if (/^UPDATE inventory_stock SET on_hand_quantity/.test(q)) return [{ on_hand_quantity: params[0] }];
      if (/^INSERT INTO inventory_movement/.test(q)) { seen.push({ q, params }); return [{ id: 1, created_at: params[12] }]; }
      throw new Error('fake db: unhandled ' + q.slice(0, 80));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => ({ changes: 1, lastInsertRowid: rows(p)[0]?.id }) };
  };
  db.transaction = async (fn) => fn();
});

describe('service functions record the chosen date', () => {
  test('stock in, stock out, adjustment and return carry the date; without one they use the current time', async () => {
    await svc.recordStockIn({ warehouseId: 1, productId: 1, quantity: 5, occurredOn: '2026-11-05' });
    await svc.recordStockOut({ warehouseId: 1, productId: 1, quantity: 2, occurredOn: '2026-11-06' });
    await svc.createStockAdjustment({ warehouseId: 1, productId: 1, direction: 'INCREASE', quantity: 1, occurredOn: '2026-11-07' });
    await svc.recordReturn({ warehouseId: 1, productId: 1, quantity: 1, occurredOn: '2026-11-08' });
    await svc.recordStockIn({ warehouseId: 1, productId: 1, quantity: 1 });
    assert.deepEqual(seen.map((s) => s.params[12]), ['2026-11-05 06:30:00', '2026-11-06 06:30:00', '2026-11-07 06:30:00', '2026-11-08 06:30:00', null]);
    assert.match(seen[0].q, /COALESCE\(\?::timestamp, NOW\(\)\)/);
    assert.deepEqual(seen.map((s) => s.params[2]), ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN', 'STOCK_IN']);
  });

  test('a future date is refused before anything is written', async () => {
    await assert.rejects(() => svc.recordStockIn({ warehouseId: 1, productId: 1, quantity: 5, occurredOn: '2999-01-01' }), (e) => e.status === 400 && /future/.test(e.message));
    await assert.rejects(() => svc.recordStockOut({ warehouseId: 1, productId: 1, quantity: 1, occurredOn: 'nope' }), (e) => e.status === 400);
    assert.equal(seen.length, 0, 'no movement was written');
  });
});
