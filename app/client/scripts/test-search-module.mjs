// Technicon Services ERP - global search tests against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-search-module.mjs
//
// Two throwaway schemas inside ONE transaction (rolled back, nothing persists):
//   full: schema.sql + inventory tables + migration 001, with seeded data
//   base: schema.sql only (migration 001 not applied): search must degrade, not fail
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('- Search module test: NOT RUN (set TEST_DATABASE_URL to a non-production database)');
  process.exit(0);
}
process.env.DATABASE_URL = url;
const req = createRequire(path.join(APP, 'package.json'));
const pg = req('pg');
const express = req('express');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);

const schemaSql = fs.readFileSync(path.join(APP, 'api/_lib/db/schema.sql'), 'utf8');
const invSrc = fs.readFileSync(path.join(APP, 'api/_lib/db/inventorySchema.js'), 'utf8');
const inventoryDdl = invSrc.slice(invSrc.indexOf('const INVENTORY_DDL = `') + 'const INVENTORY_DDL = `'.length, invSrc.indexOf('`;', invSrc.indexOf('const INVENTORY_DDL')));
const migration = fs.readFileSync(path.join(APP, 'api/_lib/db/migrations/001_erp_missing_tables.sql'), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();
const { default: db } = await imp('api/_lib/db/index.js');
const realQuery = db.pool.query.bind(db.pool);
const realConnect = db.pool.connect.bind(db.pool);
let queue = Promise.resolve();
const run = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};
// Each search query runs inside its own savepoint so a deliberately failing entity query (base
// schema) does not abort the surrounding test transaction.
let sp = 0;
db.pool.query = (sql, params) => run(async () => {
  const name = `q${++sp}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return r;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
});
db.pool.connect = async () => { throw new Error('search must not open transactions'); };

const { searchGlobal, normalizeQuery, detectSearchIntent } = await imp('api/_lib/search/service.js');
const { default: router } = await imp('api/_lib/routes/search.js');
const logged = [];
console.error = (...a) => logged.push(a.join(' '));

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

let server;
try {
  await client.query('BEGIN');

  await test('normalizeQuery / detectSearchIntent (pure)', async () => {
    assert.deepStrictEqual(normalizeQuery('  2 ml Screw-Cap '), { clean: '2ml screw-cap', raw: '2 ml Screw-Cap', tokens: ['2ml', 'screw-cap'] });
    assert.strictEqual(detectSearchIntent('QTN2627/5', 'qtn2627/5'), 'QUOTATION');
    assert.strictEqual(detectSearchIntent('stock P-100', 'stock p-100'), 'PRODUCT_STOCK');
    assert.strictEqual(detectSearchIntent('overdue', 'overdue'), 'FOLLOW_UP');
    assert.strictEqual(detectSearchIntent('valve', 'valve'), 'GENERAL_SEARCH');
  });

  // ---------------- full schema
  await client.query(`CREATE SCHEMA search_full`);
  await client.query(`SET LOCAL search_path TO search_full`);
  await client.query(schemaSql);
  await client.query(inventoryDdl);
  await client.query(migration);
  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  const acme = await one(`INSERT INTO company (name, gstin, state) VALUES ('Acme Labs','36AAA','Telangana') RETURNING id`);
  const p1 = await one(`INSERT INTO product (part_no, description, default_price) VALUES ('P-100','Ball Valve 2ml',10) RETURNING id`);
  await one(`INSERT INTO product (part_no, description) VALUES ('X_1','Fifty 50% Gasket') RETURNING id`);
  const wh = await one(`INSERT INTO warehouse (name, code, city) VALUES ('Main Store','W-01','Pune') RETURNING id`);
  await client.query(`INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES ($1,$2,9,2)`, [wh.id, p1.id]);
  const user = await one(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES ('u','h','s','admin') RETURNING id`);
  const q = await one(`INSERT INTO quotation (number, date, company_id, status, subtotal, tax_amount, total, net_subtotal) VALUES ('QTN2627/5', CURRENT_DATE, $1, 'sent', 500, 0, 500, 500) RETURNING id`, [acme.id]);
  await one(`INSERT INTO purchase_order (number, date, quotation_id) VALUES ('PO2627/1', CURRENT_DATE, $1) RETURNING id`, [q.id]);
  await one(`INSERT INTO sale_report (report_number, company_name_snapshot, sale_date, warehouse_id, source_type, total_amount) VALUES ('SR2627/1','Acme Labs',CURRENT_DATE,$1,'DIRECT_EXTERNAL',250) RETURNING id`, [wh.id]);
  await one(`INSERT INTO quotation_follow_up (quotation_id, follow_up_date, notes, status, priority, created_by) VALUES ($1, CURRENT_DATE, 'call acme about valves', 'scheduled', 'HIGH', $2) RETURNING id`, [q.id, user.id]);

  await test('exact part number: best match, links to the product page that exists', async () => {
    const r = await searchGlobal('p-100');
    assert.ok(r.isExactMatch);
    assert.deepStrictEqual([r.bestMatch.type, r.bestMatch.score, r.bestMatch.route], ['PRODUCT', 10, `/products/${p1.id}/intelligence`]);
    assert.deepStrictEqual([r.bestMatch.metadata.on_hand, r.bestMatch.metadata.available], [9, 7]);
  });
  await test('stock intent links to the product stock page', async () => {
    const r = await searchGlobal('stock P-100');
    assert.strictEqual(r.intent, 'PRODUCT_STOCK');
    assert.strictEqual(r.groups.INVENTORY[0].route, `/inventory/stock/${p1.id}`);
  });
  await test('documents and customers are found case-insensitively', async () => {
    assert.strictEqual((await searchGlobal('qtn2627/5')).bestMatch.route, `/quotations/${q.id}`);
    assert.strictEqual((await searchGlobal('po2627/1')).bestMatch.type, 'PURCHASE_ORDER');
    assert.strictEqual((await searchGlobal('sr2627/1')).bestMatch.type, 'SALE_REPORT');
    const acmeRes = await searchGlobal('ACME');
    assert.ok(acmeRes.groups.CUSTOMERS.some((c) => c.id === acme.id));
    assert.ok(acmeRes.groups.QUOTATIONS && acmeRes.groups.FOLLOW_UPS, 'quotation and follow-up for the customer are found');
    assert.strictEqual((await searchGlobal('w-01')).bestMatch.route, `/inventory/warehouses/${wh.id}`);
  });
  await test('LIKE wildcards typed by the user match literally', async () => {
    const pct = await searchGlobal('50%');
    assert.deepStrictEqual(pct.results.filter((x) => x.type === 'PRODUCT').map((x) => x.metadata.part_no), ['X_1']);
    const underscore = await searchGlobal('x_1');
    assert.ok(underscore.results.every((x) => x.type !== 'PRODUCT' || x.metadata.part_no === 'X_1'));
  });
  await test('empty query and limit', async () => {
    assert.deepStrictEqual(await searchGlobal('   '), { query: '   ', intent: 'GENERAL_SEARCH', isExactMatch: false, bestMatch: null, results: [], groups: {} });
    assert.strictEqual((await searchGlobal('a', { limit: 2 })).results.length, 2);
  });
  await test('no entity search failed on the full schema', async () => {
    assert.deepStrictEqual(logged, []);
  });

  // ---------------- base schema (migration 001 not applied)
  await client.query(`CREATE SCHEMA search_base`);
  await client.query(`SET LOCAL search_path TO search_base`);
  await client.query(schemaSql);
  await client.query(inventoryDdl);
  await one(`INSERT INTO company (name) VALUES ('Acme Base') RETURNING id`);
  await test('before migration 001: search still answers with what it can, failures only logged', async () => {
    logged.length = 0;
    const r = await searchGlobal('acme');
    assert.ok(r.groups.CUSTOMERS && r.groups.CUSTOMERS[0].title === 'Acme Base');
    assert.ok(logged.some((l) => /sale reports search failed/.test(l)), 'missing sale_report is logged');
  });

  const app = express();
  app.use('/api/search', router);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  await test('route: 200 with GlobalSearchResponse shape; long queries are capped', async () => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=acme&limit=5`);
    const body = await r.json();
    assert.strictEqual(r.status, 200);
    for (const k of ['query', 'intent', 'isExactMatch', 'bestMatch', 'results', 'groups']) assert.ok(k in body, k);
    const long = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=${'a'.repeat(500)}`);
    assert.strictEqual((await long.json()).query.length, 200);
  });
} catch (e) {
  failed++;
  process.stdout.write(`ERROR ${e.stack}\n`);
} finally {
  if (server) server.close();
  await client.query('ROLLBACK').catch(() => {});
  const still = (await client.query(`SELECT to_regnamespace('search_full') IS NOT NULL OR to_regnamespace('search_base') IS NOT NULL AS present`)).rows[0].present;
  console.log(`\nrolled back; throwaway schemas still present: ${still}`);
  if (still) failed++;
  db.pool.query = realQuery;
  db.pool.connect = realConnect;
  await client.end();
  await db.pool.end().catch(() => {});
  console.log(failed ? `${failed} FAILED, ${passed} passed` : `ALL ${passed}/${passed} SEARCH MODULE TESTS PASSED`);
  process.exit(failed ? 1 : 0);
}
