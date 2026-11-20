// Tests for "today's stock". Run with:  npm --prefix app/client run test:inventory   (a fake database; nothing connects)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { dayBounds, totalsFromTypes, getToday } = await import('../today.js');
const { default: db } = await import('../../db/index.js');

describe('dayBounds', () => {
  test('today in India: midnight to midnight, expressed in UTC', () => {
    // 19 Nov 2026 07:00 UTC is 12:30 IST on the 19th
    assert.deepEqual(dayBounds(Date.parse('2026-11-19T07:00:00Z')), { day: '2026-11-19', startUtc: '2026-11-18 18:30:00', endUtc: '2026-11-19 18:30:00' });
  });
  test('just after midnight India time is already the next day', () => {
    // 30 Nov 19:00 UTC is 00:30 IST on 1 Dec
    const b = dayBounds(Date.parse('2026-11-30T19:00:00Z'));
    assert.deepEqual([b.day, b.startUtc, b.endUtc], ['2026-12-01', '2026-11-30 18:30:00', '2026-12-01 18:30:00']);
  });
});

describe('totalsFromTypes', () => {
  test('in, out, returns and adjustments are totalled by kind', () => {
    const t = totalsFromTypes([
      { movement_type: 'STOCK_IN', lines: 3, units: 12 },
      { movement_type: 'OPENING_STOCK', lines: 1, units: 5 },
      { movement_type: 'STOCK_OUT', lines: 2, units: 7.5 },
      { movement_type: 'ADJUSTMENT', lines: 1, units: 1 },
    ]);
    assert.deepEqual(t.received, { lines: 4, units: 17 });
    assert.deepEqual(t.sent, { lines: 2, units: 7.5 });
    assert.deepEqual(t.returned, { lines: 0, units: 0 });
    assert.deepEqual(t.adjusted, { lines: 1, units: 1 });
  });
});

describe('getToday', () => {
  let seen;
  let waitingFails;
  beforeEach(() => {
    seen = [];
    waitingFails = false;
    db.prepare = (text) => {
      const q = text.replace(/\s+/g, ' ').trim();
      const rows = (params) => {
        if ((q.replace(/'[^']*'/g, '').match(/\?/g) || []).length !== params.flat().length && !/information_schema/.test(q)) throw new Error('parameter count mismatch in: ' + q.slice(0, 90));
        seen.push({ q, params });
        if (/GROUP BY m\.movement_type/.test(q)) return [{ movement_type: 'STOCK_IN', lines: 2, units: 9 }, { movement_type: 'STOCK_OUT', lines: 1, units: 4 }];
        if (/AND m\.reference_type = 'STOCK_RECEIPT'/.test(q)) return [{ n: 1 }];
        if (/AND m\.reference_type = 'QUOTATION_INVOICE'/.test(q)) return [{ n: 1 }];
        if (/FROM inventory_movement m JOIN product p/.test(q)) return [{ at: '11:05', part_no: 'B01', description: 'Vials', movement_type: 'STOCK_IN', change: 5, reference_type: 'STOCK_RECEIPT', reference_id: '7', reason: 'Stock Inward' }];
        if (/FROM information_schema\.columns/.test(q) || /FROM quotation q JOIN company c/.test(q) || /FROM inventory_stock/.test(q)) {
          if (waitingFails) throw new Error('boom');
          return [];
        }
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
      };
      return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
    };
  });

  test("today's figures, bound to today's India-time bounds", async () => {
    const r = await getToday({ isAdmin: true }, Date.parse('2026-11-19T07:00:00Z'));
    assert.equal(r.date, '2026-11-19');
    assert.deepEqual(r.received, { lines: 2, units: 9, receipts: 1 });
    assert.deepEqual(r.sent, { lines: 1, units: 4, invoices: 1 });
    assert.equal(r.movements[0].part_no, 'B01');
    const sum = seen.find((s) => /GROUP BY m\.movement_type/.test(s.q));
    assert.deepEqual(sum.params, ['2026-11-18 18:30:00', '2026-11-19 18:30:00']);
  });

  test('no customer orders waiting: the panel still works (summary is empty, not an error)', async () => {
    const r = await getToday({ isAdmin: true }, Date.parse('2026-11-19T07:00:00Z'));
    assert.deepEqual(r.waiting, { lines: 0, ready: 0, partly: 0, waiting: 0, customers: 0, units_to_order: 0 });
  });

  test('if reading the waiting orders fails, today\'s stock is still shown', async () => {
    waitingFails = true;
    const r = await getToday({ isAdmin: true }, Date.parse('2026-11-19T07:00:00Z'));
    assert.equal(r.waiting, null);
    assert.equal(r.received.units, 9);
  });
});
