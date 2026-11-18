// Tests for the PO-received value SQL (what a quotation is worth once POs were received). Run with:  npm --prefix app/client run test:po
// No real database: the catalogue check runs against a stub. A dummy DATABASE_URL is set only because the modules import
// the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { orderedValueSql, receivedValueSql, preGstSql, runWithFallback } = await import('../poValue.js');
const { isManualOrderNumber, MANUAL_ORDER_PREFIX } = await import('../../../../src/lib/manualOrder.ts').catch(() => ({ isManualOrderNumber: null, MANUAL_ORDER_PREFIX: 'TSMO' }));
const { PO_COLUMNS } = await import('../poReceived.js');
const { default: db } = await import('../../db/index.js');
const { quotationStatusLabel } = await import('../../../../src/lib/quotationStatus.ts').catch(() => ({ quotationStatusLabel: null }));

const withCatalogue = async (hasPo, fn) => {
  const real = db.prepare;
  db.prepare = () => ({
    all: async () => (hasPo ? Object.entries(PO_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c }))) : []),
  });
  try { return await fn(); } finally { db.prepare = real; }
};

describe('ordered value SQL', () => {
  test('adds quantity x unit price over every item of every PO, correlated to the quotation', () => {
    const sql = orderedValueSql('q');
    assert.match(sql, /SUM\(pi\.qty \* COALESCE\(qi\.final_unit_price, qi\.actual_unit_price, qi\.price, 0\)\)/);
    assert.match(sql, /FROM quotation_po_item pi\s+JOIN quotation_po p ON p\.id = pi\.quotation_po_id\s+JOIN quotation_item qi ON qi\.id = pi\.quotation_item_id\s+WHERE p\.quotation_id = q\.id/);
    assert.match(sql, /\* \(1 \+ COALESCE\(q\.tax_percent, 0\) \/ 100\.0\)/, 'GST is added');
  });

  test('without GST the tax factor is left out (sales-person figures are before GST)', () => {
    assert.doesNotMatch(orderedValueSql('q', { withGst: false }), /tax_percent/);
  });

  test('the alias is used for the correlation', () => {
    assert.match(orderedValueSql('x'), /p\.quotation_id = x\.id/);
    assert.match(preGstSql('x'), /x\.taxable_amount/);
  });
});

describe('value of a PO-received quotation', () => {
  test('before migration 008 it is just the quotation amount (nothing breaks)', async () => {
    await withCatalogue(false, async () => {
      assert.equal(await receivedValueSql('q'), 'q.total');
      assert.equal(await receivedValueSql('q', { withGst: false, fallback: preGstSql('q') }), preGstSql('q'));
    });
  });

  test('with migration 008: the ordered value when POs exist, else the quotation amount', async () => {
    await withCatalogue(true, async () => {
      const sql = await receivedValueSql('q');
      assert.match(sql, /^CASE WHEN EXISTS \(SELECT 1 FROM quotation_po p0 WHERE p0\.quotation_id = q\.id\) THEN /);
      assert.match(sql, /ELSE q\.total END$/);
      assert.ok(sql.includes(orderedValueSql('q')));
    });
  });
});

describe('status wording', () => {
  test('the stored value accepted is shown as PO received', { skip: !quotationStatusLabel }, () => {
    assert.equal(quotationStatusLabel('accepted'), 'PO received');
    assert.equal(quotationStatusLabel('negotiation'), 'Negotiation');
    assert.equal(quotationStatusLabel('po_created'), 'po created');
    assert.equal(quotationStatusLabel(null), '');
  });
});

describe('safe fallback', () => {
  test('a report keeps working with the quotation amounts if the new SQL ever fails', async () => {
    const used = [];
    const origError = console.error;
    console.error = () => {};
    try {
      const result = await runWithFallback(async (v) => { used.push(v); if (v === 'NEW') throw new Error('boom'); return 42; }, 'NEW', 'q.total', 'test');
      assert.equal(result, 42);
      assert.deepEqual(used, ['NEW', 'q.total']);
    } finally {
      console.error = origError;
    }
  });

  test('when there is nothing new to try, the query runs once', async () => {
    const used = [];
    assert.equal(await runWithFallback(async (v) => { used.push(v); return 1; }, 'q.total', 'q.total', 'test'), 1);
    assert.deepEqual(used, ['q.total']);
  });

  test('a normal result is not retried', async () => {
    const used = [];
    await runWithFallback(async (v) => { used.push(v); return 7; }, 'NEW', 'q.total', 'test');
    assert.deepEqual(used, ['NEW']);
  });
});

describe('manual orders', { skip: !isManualOrderNumber }, () => {
  test('are recognised by their own number series only', () => {
    assert.equal(MANUAL_ORDER_PREFIX, 'TSMO');
    assert.equal(isManualOrderNumber('TSMO2627/1'), true);
    assert.equal(isManualOrderNumber(' tsmo2627/12 '), true);
    for (const n of ['TSQOT2627/643', 'TSAPQOT2627/1', 'QOT2627/1', '', null, undefined]) assert.equal(isManualOrderNumber(n), false, String(n));
  });
});
