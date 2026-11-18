// Tests for price negotiation (status rules and the revision history). Run with:  npm --prefix app/client run test:po
// No real database: the revision queries run against a stub. A dummy DATABASE_URL is set only because the module imports
// the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { statusChangeError, EDITABLE_STATUSES, MODULE_EDITABLE_STATUSES, ALL_STATUSES, snapshotItems, takeRevisionSnapshot, dropUnchangedRevision, listRevisions, REVISION_COLUMNS, NEGOTIATION } = await import('../negotiation.js');
const { default: db } = await import('../../db/index.js');

describe('status rules', () => {
  test('negotiation starts only from a sent quotation', () => {
    assert.equal(statusChangeError('sent', 'negotiation'), null);
    assert.equal(statusChangeError('negotiation', 'negotiation'), null);
    for (const from of ['draft', 'accepted', 'rejected']) assert.match(statusChangeError(from, 'negotiation'), /sent/);
  });

  test('a negotiated quotation can be sent again, rejected, or turn into a PO (accepted)', () => {
    for (const to of ['sent', 'rejected', 'accepted']) assert.equal(statusChangeError('negotiation', to), null, to);
    assert.equal(statusChangeError('sent', 'sent'), null);
  });

  test('unknown statuses are refused', () => {
    assert.equal(statusChangeError('sent', 'nonsense'), 'Invalid status');
    assert.ok(ALL_STATUSES.includes(NEGOTIATION));
  });

  test('every state before a PO is received can be edited; a quotation with a received PO cannot', () => {
    for (const st of ['draft', 'sent', 'negotiation', 'rejected']) {
      assert.ok(EDITABLE_STATUSES.includes(st), st);
      assert.ok(MODULE_EDITABLE_STATUSES.includes(st), st);
    }
    assert.ok(!EDITABLE_STATUSES.includes('accepted') && !MODULE_EDITABLE_STATUSES.includes('accepted'));
  });

  test('every undo step is an allowed change: negotiation to sent, sent to draft, rejected to sent', () => {
    assert.equal(statusChangeError('negotiation', 'sent'), null);
    assert.equal(statusChangeError('sent', 'draft'), null);
    assert.equal(statusChangeError('rejected', 'sent'), null);
  });
});

describe('revision history', () => {
  const realPrepare = db.prepare;
  const run = async (fn, { ready = true } = {}) => {
    const inserts = [];
    db.prepare = (sql) => ({
      all: async (...p) => {
        if (/information_schema\.columns/.test(sql)) return ready ? Object.entries(REVISION_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c }))) : [];
        if (/FROM quotation_item/.test(sql)) return [{ part_no: 'TEST-1', description: 'Column', qty: 5, final_unit_price: 1000, discount_type: 'percentage', discount_value: 10, final_line_total: 4500 }];
        if (/FROM quotation_revision r/.test(sql)) return [{ id: 1, revision_no: 1, total: 5310, items: [], note: 'asked 5%', created_by_username: 'admin' }];
        return [];
      },
      get: async () => {
        if (/FROM quotation WHERE id/.test(sql)) return { total: 5310, subtotal: 4500, tax_amount: 810 };
        if (/MAX\(revision_no\)/.test(sql)) return { n: 2 };
        return null;
      },
      run: async (...p) => { inserts.push({ sql, params: p }); return { changes: 1 }; },
    });
    try { return await fn(inserts); } finally { db.prepare = realPrepare; }
  };

  test('starting a negotiation saves the version that was sent as the next revision', async () => {
    // revisionsReady() caches a positive answer, so this test runs first with the table present
    await run(async (inserts) => {
      const n = await takeRevisionSnapshot(7, 3, 'asked 5%');
      assert.equal(n, 2);
      const ins = inserts.find((x) => /INSERT INTO quotation_revision/.test(x.sql));
      assert.deepEqual(ins.params.slice(0, 6), [7, 2, 5310, 4500, 810, 'asked 5%']);
      assert.equal(ins.params[7], 3, 'the user who started it');
      const items = JSON.parse(ins.params[6]);
      assert.deepEqual(items, [{ part_no: 'TEST-1', description: 'Column', qty: 5, unit_price: 1000, discount_type: 'percentage', discount_value: 10, line_total: 4500 }]);
    });
  });

  test('the history lists the saved rounds', async () => {
    await run(async () => {
      const r = await listRevisions(7);
      assert.equal(r.ready, true);
      assert.equal(r.revisions[0].note, 'asked 5%');
    });
  });

  test('undoing a negotiation removes the round only when nothing was changed', async () => {
    const run2 = async (lastTotal, nowTotal) => {
      const deletes = [];
      const real = db.prepare;
      db.prepare = (sql) => ({
        all: async () => (/information_schema\.columns/.test(sql) ? Object.entries(REVISION_COLUMNS).flatMap(([tb, cols]) => cols.map((c) => ({ table_name: tb, column_name: c }))) : []),
        get: async () => (/FROM quotation_revision/.test(sql) ? { id: 9, total: lastTotal } : { total: nowTotal }),
        run: async (...p) => { deletes.push({ sql, params: p }); return { changes: 1 }; },
      });
      try { return { dropped: await dropUnchangedRevision(7), deletes }; } finally { db.prepare = real; }
    };
    const same = await run2(5310, 5310);
    assert.equal(same.dropped, true);
    assert.deepEqual(same.deletes[0].params, [9]);
    const changed = await run2(5310, 5000);
    assert.equal(changed.dropped, false);
    assert.equal(changed.deletes.length, 0);
  });

  test('snapshotItems turns lines into a plain list', () => {
    assert.deepEqual(snapshotItems([{ part_no: null, description: 'X', qty: '2', price: 10, amount: 20 }]), [{ part_no: null, description: 'X', qty: 2, unit_price: 10, discount_type: 'none', discount_value: 0, line_total: 20 }]);
  });
});
