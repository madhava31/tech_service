// Tests for Confirmed Sales (payments received, counted before GST). Run with:  npm --prefix app/client run test:po
// No database: a dummy DATABASE_URL is set only because the modules import the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { fyBounds, engineerConfirmed } = await import('../confirmedSales.js');
const { PAYMENTS_COLUMNS } = await import('../../payments/service.js');
const { SALES_TEAM_COLUMNS } = await import('../salesTeam.js');
const { default: db } = await import('../../db/index.js');

describe('fyBounds', () => {
  test('financial year runs April to March', () => {
    assert.deepEqual(fyBounds('FY 2026-27'), { start: '2026-04-01', end: '2027-04-01' });
    assert.deepEqual(fyBounds('2025-26'), { start: '2025-04-01', end: '2026-04-01' });
    assert.equal(fyBounds('nonsense'), null);
  });
});

function fakeDb({ migrations, row }) {
  const seen = [];
  db.prepare = (text) => {
    const q = text.replace(/\s+/g, ' ').trim();
    const rows = (params) => {
      if (/information_schema/.test(q)) {
        if (!migrations) return [];
        const all = { ...PAYMENTS_COLUMNS, ...SALES_TEAM_COLUMNS };
        return Object.entries(all).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
      }
      if ((q.replace(/'[^']*'/g, '').match(/\?/g) || []).length !== params.flat().length) throw new Error('parameter count mismatch in: ' + q.slice(0, 90));
      seen.push({ q, params: params.flat() });
      if (/FROM quotation_payment p/.test(q)) return [row];
      throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
    };
    return { get: async (...p) => rows(p)[0], all: async (...p) => rows(p), run: async (...p) => { rows(p); return { changes: 1 }; } };
  };
  return seen;
}

describe('engineerConfirmed', () => {
  test('before the payments migration nothing is counted and nothing is queried', async () => {
    const seen = fakeDb({ migrations: false, row: { n: 9, v: 9 } });
    assert.deepEqual(await engineerConfirmed(3, 'FY 2026-27'), { count: 0, value: 0 });
    assert.equal(seen.length, 0);
  });

  test('payments in the financial year, shared by share, before GST', async () => {
    const seen = fakeDb({ migrations: true, row: { n: 2, v: 12345.678 } });
    assert.deepEqual(await engineerConfirmed(3, 'FY 2026-27'), { count: 2, value: 12345.68 });
    const s = seen[0];
    assert.deepEqual(s.params, [3, '2026-04-01', '2027-04-01', 3]);
    assert.match(s.q, /p\.paid_on >= \? AND p\.paid_on < \?/);
    assert.match(s.q, /share_percent/);
    assert.match(s.q, /taxable_amount/);
  });

  test('an empty year is a real zero', async () => {
    fakeDb({ migrations: true, row: { n: 0, v: null } });
    assert.deepEqual(await engineerConfirmed(3, 'FY 2026-27'), { count: 0, value: 0 });
  });

  test('a bad year is refused without a query', async () => {
    const seen = fakeDb({ migrations: true, row: { n: 1, v: 1 } });
    assert.deepEqual(await engineerConfirmed(3, 'x'), { count: 0, value: 0 });
    assert.equal(seen.length, 0);
  });
});
