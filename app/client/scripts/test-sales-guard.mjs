// Technicon Services ERP - /api/sales migration guard tests (no database, no network)
// Run via: node app/client/scripts/test-sales-guard.mjs
//
// Before migration 001 is applied every /api/sales route must answer 503 MIGRATION_REQUIRED with a
// safe message (no table names); once the schema is complete the guard must let requests through.

import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const express = createRequire(path.join(APP, 'package.json'))('express');
const { default: db } = await import(pathToFileURL(path.join(APP, 'api/_lib/db/index.js')).href);
const { default: salesRouter } = await import(pathToFileURL(path.join(APP, 'api/_lib/routes/sales.js')).href);

const FULL = {
  sale_report: ['id', 'source_quotation_id', 'source_po_id', 'source_pi_id', 'status', 'total_amount'],
  sale_report_item: ['sale_report_id', 'quantity'],
  firm: ['id', 'firm_name'],
  branch: ['id', 'branch_name'],
  quotation: ['firm_id', 'branch_id', 'net_subtotal', 'sales_engineer_id'],
  quotation_follow_up: ['follow_up_time', 'priority', 'firm_id', 'branch_id', 'company_id', 'sales_engineer_id'],
  warehouse: ['id'],
  inventory_stock: ['product_id'],
};
let columns = [];
let catalogLookups = 0;
console.error = () => {}; // the guard logs what is missing; keep test output clean
db.prepare = (sql) => ({
  async all() {
    if (sql.includes('information_schema.columns')) {
      catalogLookups++;
      return columns;
    }
    throw new Error('relation "sale_report" does not exist'); // any data query
  },
  async get() {
    throw new Error('relation "sale_report" does not exist');
  },
});
const rowsFor = (spec) => Object.entries(spec).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));

const app = express();
app.use((req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
app.use('/api/sales', salesRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const get = async (p) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/sales${p}`);
  return { status: r.status, body: await r.json() };
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

try {
  await test('migration not applied (base schema only): every route answers 503 MIGRATION_REQUIRED', async () => {
    columns = rowsFor({ quotation: ['sales_engineer_id'], warehouse: ['id'], inventory_stock: ['product_id'] });
    for (const p of ['/pipeline', '/orders', '/follow-ups/due-today', '/activity', '/reports']) {
      const r = await get(p);
      assert.strictEqual(r.status, 503, p);
      assert.strictEqual(r.body.code, 'MIGRATION_REQUIRED');
      assert.ok(!/sale_report|firm|branch|relation|column/i.test(r.body.error), `message leaks schema: ${r.body.error}`);
    }
  });

  await test('one missing column is enough to refuse', async () => {
    const partial = structuredClone(FULL);
    partial.quotation_follow_up = partial.quotation_follow_up.filter((c) => c !== 'priority');
    columns = rowsFor(partial);
    assert.strictEqual((await get('/pipeline')).status, 503);
  });

  await test('failure is not cached: complete schema lets requests through', async () => {
    columns = rowsFor(FULL);
    const r = await get('/pipeline');
    assert.notStrictEqual(r.status, 503);
    // The stub then fails the data query: generic 500, no database text.
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.body.error, 'Failed to get sales pipeline');
  });

  await test('success is cached: no further catalog lookups', async () => {
    const before = catalogLookups;
    await get('/orders');
    await get('/pending');
    assert.strictEqual(catalogLookups, before);
  });
} finally {
  server.close();
  await db.pool.end();
}
console.log(`\nALL ${passed}/${passed} SALES GUARD TESTS PASSED`);
