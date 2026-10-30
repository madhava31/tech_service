// Technicon Services ERP - company delete routes (no database, no network)
// Run via: node app/client/scripts/test-company-delete.mjs
//
// DELETE /api/companies/:id and POST /api/companies/bulk-delete are admin only and never cascade:
// a company still used by quotations, sales records, sale reports or supplier records is refused
// with a message naming what uses it. Tables added by migration 001 are only checked if present.

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
const { default: router } = await imp('api/_lib/routes/companies.js');
console.error = () => {};

// In-memory stand-in for the tables the routes touch.
let state;
function reset({ present = ['quotation.company_id', 'sales_record.company_id', 'sale_report.company_id', 'procurement_requirement.supplier_id', 'purchase_order.supplier_id'], refs = {} } = {}) {
  state = {
    companies: new Map([[1, 'Acme Labs'], [2, 'Beta Corp'], [3, 'Gamma Ltd'], [4, 'Delta Inc']]),
    present: new Set(present),
    refs, // 'table.column' -> { companyId: count }
    sql: [],
    deleteError: null,
    failCatalog: false,
  };
}
db.transaction = async (fn) => fn();
db.prepare = (sql) => {
  const run = async (...params) => {
    state.sql.push(sql);
    if (sql.includes('information_schema.columns')) {
      if (state.failCatalog) throw Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });
      return { rows: params[0].filter((r) => state.present.has(r)).map((ref) => ({ ref })) };
    }
    const count = sql.match(/^SELECT (\w+) AS id, COUNT\(\*\)::int AS n FROM (\w+) WHERE/);
    if (count) {
      const byId = state.refs[`${count[2]}.${count[1]}`] || {};
      return { rows: params[0].filter((id) => byId[id]).map((id) => ({ id, n: byId[id] })) };
    }
    if (sql.startsWith('SELECT id, name FROM company WHERE id = ANY')) {
      return { rows: params[0].filter((id) => state.companies.has(id)).map((id) => ({ id, name: state.companies.get(id) })) };
    }
    if (sql.startsWith('SELECT id, name FROM company WHERE id = ?')) {
      const id = params[0];
      return { rows: state.companies.has(id) ? [{ id, name: state.companies.get(id) }] : [] };
    }
    if (sql.startsWith('DELETE FROM company')) {
      if (state.deleteError) throw state.deleteError;
      const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
      ids.forEach((id) => state.companies.delete(id));
      return { rows: [], rowCount: ids.length };
    }
    throw new Error('unexpected SQL in test: ' + sql);
  };
  return {
    get: async (...p) => (await run(...p)).rows[0],
    all: async (...p) => (await run(...p)).rows,
    run: async (...p) => { const r = await run(...p); return { changes: r.rowCount ?? 0 }; },
  };
};

let role = 'admin';
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1, username: 'u', role }; next(); }); // requireAuth runs in app/api/index.js
app.use('/api/companies', router);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const call = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/companies${p}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const deletes = () => state.sql.filter((s) => s.startsWith('DELETE FROM company')).length;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  reset();
  role = 'admin';
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n    ${e.message}`); }
}

try {
  await test('staff users get 403 on both routes and nothing is queried', async () => {
    role = 'staff';
    const a = await call('DELETE', '/1');
    const b = await call('POST', '/bulk-delete', { ids: [1, 2] });
    assert.deepStrictEqual([a.status, b.status], [403, 403]);
    assert.match(a.body.error, /administrator/);
    assert.strictEqual(state.sql.length, 0);
  });

  await test('invalid id -> 400', async () => {
    assert.strictEqual((await call('DELETE', '/abc')).status, 400);
    assert.strictEqual((await call('DELETE', '/-3')).status, 400);
  });

  await test('unknown company -> 404 "Company not found"', async () => {
    const r = await call('DELETE', '/99');
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(r.body, { error: 'Company not found' });
  });

  await test('unused company is deleted -> 200 { ok: true }', async () => {
    const r = await call('DELETE', '/3');
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true }]);
    assert.ok(!state.companies.has(3));
    assert.strictEqual(deletes(), 1);
  });

  await test('company still in use -> 409 naming what uses it, nothing deleted', async () => {
    state.refs = { 'quotation.company_id': { 1: 2 }, 'sales_record.company_id': { 1: 1 }, 'procurement_requirement.supplier_id': { 1: 3 } };
    const r = await call('DELETE', '/1');
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'Cannot delete "Acme Labs": it is still used by 2 quotations, 1 sales record, 3 procurement requirements.');
    assert.strictEqual(deletes(), 0);
    assert.ok(state.companies.has(1));
  });

  await test('tables from migration 001 are only checked where they exist', async () => {
    reset({ present: ['quotation.company_id', 'sales_record.company_id'] });
    await call('DELETE', '/3');
    assert.ok(!state.sql.some((s) => /FROM sale_report|FROM procurement_requirement|FROM purchase_order/.test(s)), state.sql.join('\n'));
    assert.ok(state.sql.some((s) => /FROM quotation WHERE/.test(s)));
  });

  await test('a reference created between the check and the delete (FK 23503) -> 409', async () => {
    state.deleteError = Object.assign(new Error('update or delete on table "company" violates foreign key constraint'), { code: '23503' });
    const r = await call('DELETE', '/3');
    assert.strictEqual(r.status, 409);
    assert.ok(!/foreign key|constraint|company"/.test(r.body.error), r.body.error);
  });

  await test('database error -> 500 generic message, no database text', async () => {
    state.failCatalog = true;
    const r = await call('DELETE', '/3');
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(r.body, { error: 'Unable to delete the company. Please try again.' });
  });

  await test('bulk: deletes unused, blocks used ones by name, reports missing', async () => {
    state.refs = { 'sale_report.company_id': { 2: 1 } };
    const r = await call('POST', '/bulk-delete', { ids: [1, 2, 3, 99] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.success, true);
    assert.strictEqual(r.body.deletedCount, 2);
    assert.strictEqual(r.body.blockedCount, 1);
    assert.deepStrictEqual(r.body.blockedNames, ['Beta Corp']);
    assert.strictEqual(r.body.message, 'Deleted 2 companies. 1 could not be deleted because they are still used by other records: Beta Corp. 1 no longer existed.');
    assert.deepStrictEqual([...state.companies.keys()].sort(), [2, 4]);
  });

  await test('bulk: all unused -> plain success message', async () => {
    const r = await call('POST', '/bulk-delete', { ids: [3, 4] });
    assert.deepStrictEqual([r.body.deletedCount, r.body.blockedCount, r.body.message], [2, 0, 'Deleted 2 companies.']);
  });

  await test('bulk: empty, invalid or oversized id lists -> 400, nothing queried', async () => {
    for (const ids of [[], ['x'], [1.5], Array.from({ length: 501 }, (_, i) => i + 1)]) {
      const r = await call('POST', '/bulk-delete', { ids });
      assert.strictEqual(r.status, 400, JSON.stringify(ids).slice(0, 30));
    }
    assert.strictEqual(state.sql.length, 0);
  });

  await test('bulk: FK race -> 409 "Nothing was deleted"', async () => {
    state.deleteError = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
    const r = await call('POST', '/bulk-delete', { ids: [3, 4] });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /^Nothing was deleted/);
  });
} finally {
  server.close();
  await db.pool.end();
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} COMPANY DELETE TESTS PASSED`);
process.exit(failed ? 1 : 0);
