// Tests for Stock Intelligence. Run with:  npm --prefix app/client run test:inventory   (a fake database; nothing connects)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { analyseProduct, buildResponse, trendOf, getStockIntelligence, setLimits } = await import('../intelligence.js');
const { default: db } = await import('../../db/index.js');

const P = (o = {}) => ({ id: 1, part_no: 'A1', description: 'Part', on_hand: 100, reserved: 0, incoming: 0, low_threshold: 10, critical_threshold: 5, ...o });

describe('analyseProduct', () => {
  test('no demand and plenty of stock: nothing to do', () => {
    const r = analyseProduct(P(), undefined, 30);
    assert.equal(r.recommendation, 'NO_ACTION');
    assert.equal(r.demandTrend, 'NO_DEMAND');
    assert.equal(r.daysOfStockRemaining, null);
    assert.equal(r.suggestedRestockQty, 0);
  });
  test('out of stock', () => {
    const r = analyseProduct(P({ on_hand: 0 }), { recent: 6, previous: 3 }, 30);
    assert.equal(r.stockStatus, 'out_of_stock');
    assert.equal(r.recommendation, 'OUT_OF_STOCK');
    assert.equal(r.priority, 'CRITICAL');
    assert.ok(r.suggestedRestockQty >= 20);
  });
  test("this product's own limits decide low and critical", () => {
    assert.equal(analyseProduct(P({ on_hand: 30, low_threshold: 40, critical_threshold: 20 }), undefined, 30).stockStatus, 'low_stock');
    assert.equal(analyseProduct(P({ on_hand: 15, low_threshold: 40, critical_threshold: 20 }), undefined, 30).stockStatus, 'critical');
    assert.equal(analyseProduct(P({ on_hand: 30 }), undefined, 30).stockStatus, 'healthy');
  });
  test('fast use makes healthy-looking stock urgent', () => {
    // 60 sold in 30 days = 2 a day; 12 available is 6 days
    const r = analyseProduct(P({ on_hand: 12, low_threshold: 5, critical_threshold: 2 }), { recent: 60, previous: 30 }, 30);
    assert.equal(r.daysOfStockRemaining, 6);
    assert.equal(r.recommendation, 'RESTOCK_NOW');
    assert.equal(r.demandTrend, 'INCREASING');
    assert.equal(r.suggestedRestockQty, 90 - 12);
  });
  test('stock already on its way that covers the need is only watched', () => {
    const r = analyseProduct(P({ on_hand: 20, incoming: 200, low_threshold: 5, critical_threshold: 2 }), { recent: 30, previous: 30 }, 30);
    assert.equal(r.recommendation, 'MONITOR');
    assert.equal(r.suggestedRestockQty, 0);
  });
  test('reserved stock is not available', () => {
    assert.equal(analyseProduct(P({ on_hand: 20, reserved: 18 }), undefined, 30).stockStatus, 'critical');
  });
  test('trend', () => {
    assert.equal(trendOf(0, 0), 'NO_DEMAND');
    assert.equal(trendOf(10, 10), 'STABLE');
    assert.equal(trendOf(5, 10), 'DECREASING');
  });
});

describe('buildResponse', () => {
  test('summary, health and the lists agree', () => {
    const items = [
      analyseProduct(P({ id: 1 }), { recent: 30, previous: 30, movements: 3 }, 30),
      analyseProduct(P({ id: 2, on_hand: 0 }), undefined, 30),
      analyseProduct(P({ id: 3, on_hand: 7 }), undefined, 30),
    ];
    const r = buildResponse(items, { periodDays: 30 });
    assert.equal(r.summary.totalProducts, 3);
    assert.equal(r.summary.outOfStock, 1);
    assert.equal(r.summary.lowStock, 1);
    assert.equal(r.summary.productsSelling, 1);
    assert.equal(r.health.healthy, 1);
    assert.equal(r.recommendations.length, 2);
    assert.equal(r.recommendations[0].priority, 'URGENT');
    assert.equal(r.demand[0].unitsSold, 30);
  });
});

describe('getStockIntelligence / setLimits', () => {
  let seen, changes;
  beforeEach(() => {
    seen = [];
    changes = 1;
    db.prepare = (text) => {
      const q = text.replace(/\s+/g, ' ').trim();
      const rows = (params) => {
        if ((q.replace(/'[^']*'/g, '').match(/\?/g) || []).length !== params.flat().length) throw new Error('parameter count mismatch in: ' + q.slice(0, 90));
        seen.push({ q, params });
        if (/FROM warehouse/.test(q)) return [{ id: 1, name: 'Main', code: 'M', is_default: 1, is_active: 1 }];
        if (/FROM product p LEFT JOIN inventory_stock/.test(q)) return [P({ id: 7, on_hand: 12, low_threshold: 5, critical_threshold: 2 })];
        if (/FROM inventory_movement m/.test(q)) return [{ product_id: 7, recent: 60, previous: 30, movements: 4, first_at: '2026-11-02', last_at: '2026-11-18' }];
        if (/^UPDATE inventory_stock/.test(q)) return [];
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
      };
      return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes }; } };
    };
  });

  test('demand comes from stock-out movements and shapes the advice', async () => {
    const r = await getStockIntelligence({ period: '30', warehouseId: '1' }, Date.parse('2026-11-19T07:00:00Z'));
    assert.equal(r.products[0].unitsSoldRecent, 60);
    assert.equal(r.products[0].recommendation, 'RESTOCK_NOW');
    assert.equal(r.meta.periodDays, 30);
    assert.equal(r.warehouses.length, 1);
    const d = seen.find((s) => /FROM inventory_movement m/.test(s.q));
    assert.match(d.q, /movement_type = 'STOCK_OUT'/);
  });

  test('limits: saved, and bad values refused', async () => {
    assert.deepEqual(await setLimits(7, 20, 8), { productId: 7, lowStockThreshold: 20, criticalStockThreshold: 8 });
    await assert.rejects(() => setLimits(7, 5, 8), /cannot be above/);
    await assert.rejects(() => setLimits(7, -1, 0), /zero or more/);
    changes = 0;
    await assert.rejects(() => setLimits(7, 20, 8), /no stock record/);
  });
});
