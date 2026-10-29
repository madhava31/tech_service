// Technicon Services ERP - catalog checks must follow the ACTIVE schema (current_schema()), not a
// hardcoded 'public'. Runs against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-active-schema.mjs
//
// Covers getUserTable() (inventorySchema.js) and missingColumns()/createSchemaGuard() (schemaGuard.js).
// Three throwaway schemas inside ONE transaction (rolled back, nothing persists):
//   full:   schema.sql + inventory tables + migration 001
//   base:   schema.sql only (migration 001 not applied)
//   legacy: a "user" table and a table whose created_by references it
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('- Active schema test: NOT RUN (set TEST_DATABASE_URL to a non-production database)');
  process.exit(0);
}
process.env.DATABASE_URL = url;
const req = createRequire(path.join(APP, 'package.json'));
const pg = req('pg');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);

const schemaSql = fs.readFileSync(path.join(APP, 'api/_lib/db/schema.sql'), 'utf8');
const invSrc = fs.readFileSync(path.join(APP, 'api/_lib/db/inventorySchema.js'), 'utf8');
const inventoryDdl = invSrc.slice(invSrc.indexOf('const INVENTORY_DDL = `') + 'const INVENTORY_DDL = `'.length, invSrc.indexOf('`;', invSrc.indexOf('const INVENTORY_DDL')));
const migration = fs.readFileSync(path.join(APP, 'api/_lib/db/migrations/001_erp_missing_tables.sql'), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();
const { default: db } = await imp('api/_lib/db/index.js');
db.pool.query = (sql, params) => client.query(sql, params);
db.pool.connect = async () => { throw new Error('catalog checks must not open transactions'); };

const { getUserTable } = await imp('api/_lib/db/inventorySchema.js');
const { missingColumns, createSchemaGuard } = await imp('api/_lib/db/schemaGuard.js');
console.error = () => {};

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}

const suffix = Math.random().toString(36).slice(2, 8);
const FULL = `as_full_${suffix}`;
const BASE = `as_base_${suffix}`;
const LEGACY = `as_legacy_${suffix}`;
const use = (s) => client.query(`SET LOCAL search_path TO ${s}`);
const REQUIRED = {
  sale_report: ['id', 'company_id'],
  procurement_requirement: ['id', 'supplier_id'],
  purchase_order: ['supplier_id', 'received_quantity', 'procurement_requirement_id'],
  company: ['is_supplier', 'company_type'],
};

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

try {
  await client.query('BEGIN');
  for (const s of [FULL, BASE, LEGACY]) await client.query(`CREATE SCHEMA ${s}`);
  await use(FULL);
  await client.query(schemaSql);
  await client.query(inventoryDdl);
  await client.query(migration);
  await use(BASE);
  await client.query(schemaSql);
  await use(LEGACY);
  await client.query(`CREATE TABLE "user" (id SERIAL PRIMARY KEY, username TEXT)`);
  await client.query(`CREATE TABLE legacy_probe (id SERIAL PRIMARY KEY, created_by INTEGER REFERENCES "user"(id))`);

  await test('current_schema() follows search_path', async () => {
    await use(FULL);
    assert.strictEqual((await client.query('SELECT current_schema() AS s')).rows[0].s, FULL);
  });

  await test('getUserTable reads the FK in the active schema (app_user)', async () => {
    await use(FULL);
    assert.strictEqual(await getUserTable('inventory_movement'), 'app_user');
    assert.strictEqual(await getUserTable('sale_report'), 'app_user');
  });

  await test('getUserTable detects a legacy "user" FK in the active schema', async () => {
    await use(LEGACY);
    assert.strictEqual(await getUserTable('legacy_probe'), '"user"');
  });

  await test('getUserTable ignores a same-named table in public', async () => {
    const pub = (await client.query(`
      SELECT ccu.table_name AS ref FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = 'inventory_movement' AND kcu.column_name = 'created_by'`)).rows[0]?.ref;
    // Only meaningful where public.inventory_movement references "user" (as on the old project);
    // the full-schema answer above must still be app_user.
    if (pub === 'user') assert.strictEqual(await getUserTable('inventory_movement'), 'app_user');
    console.log(`    (public.inventory_movement.created_by -> ${pub ?? 'no FK / no table'})`);
  });

  await test('missingColumns: nothing missing in the migrated schema', async () => {
    await use(FULL);
    assert.deepStrictEqual(await missingColumns(REQUIRED), []);
  });

  await test('missingColumns: reports migration 001 columns missing in the unmigrated schema', async () => {
    await use(BASE);
    const missing = await missingColumns(REQUIRED);
    for (const c of ['sale_report.id', 'procurement_requirement.supplier_id', 'purchase_order.supplier_id', 'company.is_supplier']) {
      assert.ok(missing.includes(c), `expected ${c} in ${missing.join(', ')}`);
    }
    assert.ok(!missing.includes('purchase_order.id'));
  });

  await test('schema guard: 503 until migrated, then passes and caches success only', async () => {
    const guard = createSchemaGuard(REQUIRED, 'Test', 'Failed');
    let nextCalls = 0;
    const next = () => { nextCalls++; };
    await use(BASE);
    const r1 = fakeRes();
    await guard({}, r1, next);
    assert.strictEqual(r1.statusCode, 503);
    assert.strictEqual(r1.body.code, 'MIGRATION_REQUIRED');
    assert.ok(!/relation|column|sale_report/.test(r1.body.error), 'no schema details in the response');
    assert.strictEqual(nextCalls, 0);
    await use(FULL);
    await guard({}, fakeRes(), next);
    assert.strictEqual(nextCalls, 1);
  });
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed}/${passed} ACTIVE SCHEMA TESTS PASSED`);
process.exit(failed ? 1 : 0);
