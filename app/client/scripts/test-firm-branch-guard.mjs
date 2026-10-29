// Technicon Services ERP - /api/firms and /api/branches migration guard tests (no database, no network)
// Run via: node app/client/scripts/test-firm-branch-guard.mjs
//
// Until migration 001 creates firm / branch / branch_document_settings (and quotation.firm_id /
// branch_id), every /api/firms and /api/branches route must answer 503 MIGRATION_REQUIRED with a
// safe message, never 'relation "firm" does not exist'. Once the schema is complete the guard
// must let requests through to the routes.

import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const express = createRequire(path.join(APP, 'package.json'))('express');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { default: db } = await imp('api/_lib/db/index.js');
const { default: firmsRouter } = await imp('api/_lib/routes/firms.js');
const { default: branchesRouter } = await imp('api/_lib/routes/branches.js');

const FULL = {
  firm: ['id', 'firm_code', 'firm_name', 'is_default', 'is_active'],
  branch: ['id', 'firm_id', 'branch_code', 'branch_name', 'is_default', 'is_active'],
  branch_document_settings: ['branch_id'],
  quotation: ['firm_id', 'branch_id'],
  sales_engineer: ['branch_id'],
};
// production before migration 001: no firm tables, quotation without firm_id/branch_id
const BEFORE = { quotation: ['id'], sales_engineer: ['branch_id'] };
let columns = [];
let catalogLookups = 0;
let dataQueries = 0;
const logged = [];
console.error = (...a) => logged.push(a.join(' '));
db.prepare = (sql) => {
  const data = async () => { dataQueries++; throw new Error('relation "firm" does not exist'); };
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
app.use((req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); }); // requireAuth runs in app/api/index.js
app.use('/api/firms', firmsRouter);
app.use('/api/branches', branchesRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const call = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api${p}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const ROUTES = [
  ['GET', '/firms'], ['GET', '/firms/1'], ['POST', '/firms', { firm_code: 'F1', firm_name: 'Firm' }], ['PUT', '/firms/1', {}],
  ['DELETE', '/firms/1'], ['POST', '/firms/bulk-delete', { ids: [1] }],
  ['GET', '/branches/all'], ['GET', '/branches'], ['GET', '/branches/1'], ['POST', '/branches', {}], ['PUT', '/branches/1', {}],
  ['PUT', '/branches/1/document-settings', {}], ['DELETE', '/branches/1'], ['POST', '/branches/bulk-delete', { ids: [1] }],
];

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

try {
  await test('migration not applied: all 14 firm/branch routes answer 503 MIGRATION_REQUIRED', async () => {
    columns = rowsFor(BEFORE);
    for (const [m, p, b] of ROUTES) {
      const r = await call(m, p, b);
      assert.strictEqual(r.status, 503, `${m} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.code, 'MIGRATION_REQUIRED');
    }
    assert.strictEqual(dataQueries, 0, 'no data query may run before the schema exists');
  });

  await test('the 503 message is safe: no table, relation or column names', async () => {
    for (const p of ['/firms', '/branches']) {
      const r = await call('GET', p);
      assert.match(r.body.error, /^Firm and branch features need a database update \(migration 001\)/);
      assert.ok(!/firm_|branch_|relation|column|does not exist|"firm"|"branch"/i.test(r.body.error), r.body.error);
    }
  });

  await test('what is missing is logged server-side for the operator', async () => {
    assert.ok(logged.some((l) => l.includes('[Firm and branch]') && l.includes('firm.id') && l.includes('quotation.firm_id')), logged.join('\n'));
  });

  await test('one missing column is enough to refuse (quotation.branch_id)', async () => {
    const partial = structuredClone(FULL);
    partial.quotation = ['firm_id'];
    columns = rowsFor(partial);
    assert.strictEqual((await call('GET', '/firms')).status, 503);
    assert.strictEqual((await call('GET', '/branches')).status, 503);
  });

  await test('failure is not cached: complete schema lets requests reach both routers', async () => {
    columns = rowsFor(FULL);
    // the stub then fails the data query: each route's own generic 500, no database text
    const f = await call('GET', '/firms');
    assert.strictEqual(f.status, 500);
    assert.deepStrictEqual(f.body, { error: 'Failed to get firms' });
    const b = await call('GET', '/branches');
    assert.strictEqual(b.status, 500);
    assert.deepStrictEqual(b.body, { error: 'Failed to get branches' });
  });

  await test('success is cached: no further catalog lookups', async () => {
    const before = catalogLookups;
    await call('GET', '/firms');
    await call('GET', '/branches/all');
    assert.strictEqual(catalogLookups, before);
  });
} finally {
  server.close();
  await db.pool.end();
}
console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} FIRM/BRANCH GUARD TESTS PASSED`);
process.exit(failed ? 1 : 0);
