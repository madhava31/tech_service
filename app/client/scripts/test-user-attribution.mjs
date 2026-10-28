// Technicon Services ERP - created_by attribution tests (no database, no network)
// Run via: node app/client/scripts/test-user-attribution.mjs
//
// resolveUserId(sessionUser, table) must return an id that satisfies <table>.created_by's foreign
// key: the app_user id when it references app_user (current schema), or the matching legacy
// "user" row when an older database still references that table.

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test'; // never connects
const lib = path.resolve(here, '../api/_lib/db');
const { default: db } = await import(pathToFileURL(path.join(lib, 'index.js')).href);
const { resolveUserId, getUserTable } = await import(pathToFileURL(path.join(lib, 'inventorySchema.js')).href);

// Stub: which user table each table's created_by references, and the legacy "user" rows.
let fkTargets = {};
let legacyUsers = [];
let fkLookups = 0;
db.prepare = (sql) => ({
  async get(...params) {
    if (sql.includes('information_schema.table_constraints')) {
      fkLookups++;
      const target = fkTargets[params[0]];
      return target ? { ref_table: target } : undefined;
    }
    if (sql.includes('FROM "user" WHERE username')) return legacyUsers.find((u) => u.username === params[0]);
    if (sql.includes('FROM "user" WHERE id')) return legacyUsers.find((u) => u.id === params[0]);
    throw new Error(`unexpected query: ${sql}`);
  },
});

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

const session = { id: 7, username: 'priya', role: 'staff' };

await test('sale_report referencing app_user: the session user id is used', async () => {
  fkTargets = { sale_report: 'app_user' };
  assert.strictEqual(await resolveUserId(session, 'sale_report'), 7);
});

await test('table without a created_by foreign key defaults to app_user', async () => {
  fkTargets = {};
  assert.strictEqual(await getUserTable('no_fk_table'), 'app_user');
});

await test('legacy "user" with no matching row: null (column is nullable), never a wrong id', async () => {
  fkTargets = { legacy_tbl: 'user' };
  legacyUsers = [{ id: 1, username: 'someone-else' }];
  assert.strictEqual(await resolveUserId(session, 'legacy_tbl'), null);
});

await test('legacy "user" matched by username returns that row id', async () => {
  fkTargets = { legacy_tbl2: 'user' };
  legacyUsers = [{ id: 42, username: 'priya' }];
  assert.strictEqual(await resolveUserId(session, 'legacy_tbl2'), 42);
});

await test('each table is checked separately and cached', async () => {
  fkTargets = { tbl_a: 'app_user', tbl_b: 'user' };
  legacyUsers = [{ id: 99, username: 'priya' }];
  const before = fkLookups;
  assert.strictEqual(await resolveUserId(session, 'tbl_a'), 7);
  assert.strictEqual(await resolveUserId(session, 'tbl_b'), 99);
  assert.strictEqual(await resolveUserId(session, 'tbl_a'), 7);
  assert.strictEqual(fkLookups - before, 2, 'one catalog lookup per table');
});

await test('default table is still inventory_movement (existing inventory callers unchanged)', async () => {
  fkTargets = { inventory_movement: 'app_user' };
  assert.strictEqual(await resolveUserId(session), 7);
});

await test('no session user: null', async () => {
  assert.strictEqual(await resolveUserId(null, 'sale_report'), null);
  assert.strictEqual(await resolveUserId({}, 'sale_report'), null);
});

await db.pool.end();
console.log(`\nALL ${passed}/${passed} USER ATTRIBUTION TESTS PASSED`);
