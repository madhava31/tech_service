// Technicon Services ERP - /api/sale-reports migration guard tests (no database, no network)
// Run via: node app/client/scripts/test-sale-reports-guard.mjs
//
// Until migration 001 creates sale_report / sale_report_item, every /api/sale-reports route must
// answer 503 MIGRATION_REQUIRED with a safe message, never 'relation "sale_report" does not exist'.
// Once the schema is complete the guard must let requests through to the routes.

import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const req = createRequire(path.join(APP, 'package.json'));
const express = req('express');
const cookieParser = req('cookie-parser');
const { default: db } = await import(pathToFileURL(path.join(APP, 'api/_lib/db/index.js')).href);
const { default: saleReportsRouter } = await import(pathToFileURL(path.join(APP, 'api/_lib/routes/saleReports.js')).href);

const FULL = {
  sale_report: ['id', 'report_number', 'company_id', 'warehouse_id', 'source_type', 'status', 'total_amount', 'created_by', 'confirmed_by'],
  sale_report_item: ['sale_report_id', 'product_id', 'quantity'],
};
let columns = [];
let catalogLookups = 0;
let dataQueries = 0;
const logged = [];
console.error = (...a) => logged.push(a.join(' '));
db.prepare = (sql) => {
  const data = async () => { dataQueries++; throw new Error('relation "sale_report" does not exist'); };
  return {
    async all() {
      if (sql.includes('information_schema.columns')) { catalogLookups++; return columns; }
      return data();
    },
    get: data,
    run: data,
  };
};
const rowsFor = (spec) => Object.entries(spec).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/sale-reports', saleReportsRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const call = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/sale-reports${p}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const ROUTES = [
  ['GET', '/'], ['GET', '/7'], ['GET', '/source-doc/quotation/3'], ['POST', '/', {}], ['PUT', '/7', {}],
  ['POST', '/7/confirm'], ['POST', '/7/cancel'], ['POST', '/bulk-delete', { ids: [7] }], ['DELETE', '/7'],
];

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

try {
  await test('migration not applied: every sale-report route answers 503 MIGRATION_REQUIRED', async () => {
    columns = [];
    for (const [m, p, b] of ROUTES) {
      const r = await call(m, p, b);
      assert.strictEqual(r.status, 503, `${m} ${p} -> ${r.status}`);
      assert.strictEqual(r.body.code, 'MIGRATION_REQUIRED');
    }
    assert.strictEqual(dataQueries, 0, 'no data query may run before the schema exists');
  });

  await test('the 503 message is safe: no table, relation or column names', async () => {
    const r = await call('GET', '/');
    assert.match(r.body.error, /^Sale report features need a database update \(migration 001\)/);
    assert.ok(!/sale_report|relation|column|does not exist/i.test(r.body.error), r.body.error);
  });

  await test('what is missing is logged server-side for the operator', async () => {
    assert.ok(logged.some((l) => l.includes('[Sale report]') && l.includes('sale_report.id')), logged.join('\n'));
  });

  await test('one missing column is enough to refuse', async () => {
    const partial = structuredClone(FULL);
    partial.sale_report = partial.sale_report.filter((c) => c !== 'confirmed_by');
    columns = rowsFor(partial);
    assert.strictEqual((await call('GET', '/')).status, 503);
  });

  await test('failure is not cached: complete schema lets requests reach the routes', async () => {
    columns = rowsFor(FULL);
    const r = await call('GET', '/');
    // the route's own requireAuth now runs: no session cookie -> 401 (no database call needed)
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(r.body, { error: 'Not authenticated' });
  });

  await test('success is cached: no further catalog lookups', async () => {
    const before = catalogLookups;
    await call('GET', '/');
    await call('GET', '/7');
    assert.strictEqual(catalogLookups, before);
  });
} finally {
  server.close();
  await db.pool.end();
}
console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} SALE REPORTS GUARD TESTS PASSED`);
process.exit(failed ? 1 : 0);
