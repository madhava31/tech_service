// Technicon Services ERP - migration 001 test against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-migration-001.mjs
//
// Everything runs in ONE transaction on a throwaway schema and is rolled back (Postgres DDL is
// transactional), so nothing persists:
//   1. schema.sql + inventory tables + migration 001 (applied twice: idempotency)
//   2. the new tables, columns and foreign keys exist as expected
//   3. constraints and foreign keys behave correctly with sample rows
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('- Migration 001 test: NOT RUN (set TEST_DATABASE_URL to a non-production database)');
  process.exit(0);
}
const pg = createRequire(path.join(APP, 'package.json'))('pg');

const schemaSql = fs.readFileSync(`${APP}/api/_lib/db/schema.sql`, 'utf8');
const invSrc = fs.readFileSync(`${APP}/api/_lib/db/inventorySchema.js`, 'utf8');
const inventoryDdl = invSrc.slice(invSrc.indexOf('const INVENTORY_DDL = `') + 'const INVENTORY_DDL = `'.length, invSrc.indexOf('`;', invSrc.indexOf('const INVENTORY_DDL')));
const migration = fs.readFileSync(`${APP}/api/_lib/db/migrations/001_erp_missing_tables.sql`, 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, ''); // the test wraps everything in its own transaction

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failures++; };
const S = 'mig001_test';
try {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${S}`);
  await client.query(`SET LOCAL search_path TO ${S}`);

  await client.query(schemaSql);
  await client.query(inventoryDdl);
  check('base schema + inventory tables created in throwaway schema', true);

  // Precondition: on a schema WITHOUT the inventory tables the migration must refuse cleanly.
  await client.query('SAVEPOINT pre');
  await client.query('ALTER TABLE warehouse RENAME TO warehouse_hidden');
  try { await client.query(migration); check('refuses when a required table is missing', false); }
  catch (e) { check('refuses when a required table is missing', /needs table "warehouse"/.test(e.message), e.message); }
  await client.query('ROLLBACK TO SAVEPOINT pre');

  await client.query(migration);
  await client.query(migration);
  check('migration applies, and re-applies cleanly (idempotent)', true);

  const cols = (await client.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1`, [S])).rows;
  const has = (t, c) => cols.some((x) => x.table_name === t && x.column_name === c);
  const EXPECTED = {
    firm: 21, branch: 20, branch_document_settings: 14, sale_report: 27, sale_report_item: 12, procurement_requirement: 16,
  };
  for (const [t, n] of Object.entries(EXPECTED)) {
    const got = cols.filter((c) => c.table_name === t).length;
    check(`${t}: created with ${n} columns`, got === n, String(got));
  }
  const ADDED = {
    quotation: ['firm_id', 'branch_id', 'gross_subtotal', 'product_discount_total', 'subtotal_after_product_discounts', 'overall_discount_type', 'overall_discount_value', 'overall_discount_amount', 'net_subtotal'],
    quotation_item: ['actual_unit_price', 'discount_type', 'discount_value', 'product_discount_amount', 'after_product_discount_amount', 'overall_discount_allocated', 'final_unit_price', 'final_line_total'],
    quotation_follow_up: ['follow_up_time', 'priority', 'firm_id', 'branch_id', 'company_id', 'sales_engineer_id'],
  };
  for (const [t, list] of Object.entries(ADDED)) {
    const missing = list.filter((c) => !has(t, c));
    check(`${t}: added columns exist`, missing.length === 0, missing.join(','));
  }

  // Foreign keys for user columns point at app_user (decision D3).
  const fks = (await client.query(`SELECT conrelid::regclass::text AS t, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='f' AND connamespace = $1::regnamespace`, [S])).rows;
  const NEW_TABLES = ['sale_report', 'procurement_requirement'];
  const userFks = fks.filter((f) => NEW_TABLES.includes(f.t) && /\((created_by|confirmed_by)\)/.test(f.def));
  check('created_by/confirmed_by reference app_user ON DELETE SET NULL', userFks.length === 3 && userFks.every((f) => /REFERENCES app_user\(id\) ON DELETE SET NULL/.test(f.def)), userFks.map((f) => f.t + ':' + f.def.split(' REFERENCES ')[1]).join(' | '));

  // Exercise constraints with sample rows (all rolled back).
  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  const user = await one(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES ('t','h','s','admin') RETURNING id`);
  const co = await one(`INSERT INTO company (name) VALUES ('Test Co') RETURNING id`);
  const pr = await one(`INSERT INTO product (part_no, description) VALUES ('P-1','Item') RETURNING id`);
  const wh = await one(`INSERT INTO warehouse (name, code) VALUES ('W','W-1') RETURNING id`);
  const firm = await one(`INSERT INTO firm (firm_code, firm_name) VALUES ('F1','Firm') RETURNING id, country, quotation_prefix`);
  check('firm defaults (country India, prefix QTN)', firm.country === 'India' && firm.quotation_prefix === 'QTN');
  const br = await one(`INSERT INTO branch (firm_id, branch_code, branch_name) VALUES ($1,'B1','Branch') RETURNING id`, [firm.id]);
  await one(`INSERT INTO branch_document_settings (branch_id) VALUES ($1) RETURNING id`, [br.id]);
  const sr = await one(`INSERT INTO sale_report (report_number, company_id, company_name_snapshot, sale_date, warehouse_id, source_type, firm_id, branch_id, created_by)
                        VALUES ('SR-1',$1,'Test Co',CURRENT_DATE,$2,'DIRECT_EXTERNAL',$3,$4,$5) RETURNING id, status, tax_percent`, [co.id, wh.id, firm.id, br.id, user.id]);
  check('sale_report defaults (DRAFT, 18% tax)', sr.status === 'DRAFT' && sr.tax_percent === 18);
  await one(`INSERT INTO sale_report_item (sale_report_id, product_id, part_number_snapshot, description_snapshot, quantity) VALUES ($1,$2,'P-1','Item',2) RETURNING id`, [sr.id, pr.id]);
  await one(`INSERT INTO procurement_requirement (requirement_code, product_id, warehouse_id, required_quantity, suggested_quantity, source_type, created_by)
             VALUES ('PR-1',$1,$2,5,5,'MANUAL',$3) RETURNING id`, [pr.id, wh.id, user.id]);

  const rejects = async (name, sql, p = []) => {
    await client.query('SAVEPOINT s');
    try { await client.query(sql, p); check(name, false, 'was accepted'); } catch (e) { check(name, true, e.code); }
    await client.query('ROLLBACK TO SAVEPOINT s');
  };
  await rejects('rejects invalid sale_report status', `INSERT INTO sale_report (report_number, company_name_snapshot, sale_date, warehouse_id, source_type, status) VALUES ('SR-X','x',CURRENT_DATE,$1,'DIRECT_EXTERNAL','BOGUS')`, [wh.id]);
  await rejects('rejects duplicate report_number', `INSERT INTO sale_report (report_number, company_name_snapshot, sale_date, warehouse_id, source_type) VALUES ('SR-1','x',CURRENT_DATE,$1,'DIRECT_EXTERNAL')`, [wh.id]);
  await rejects('rejects zero-quantity sale_report_item', `INSERT INTO sale_report_item (sale_report_id, product_id, part_number_snapshot, description_snapshot, quantity) VALUES ($1,$2,'P','D',0)`, [sr.id, pr.id]);
  await rejects('rejects invalid procurement priority', `INSERT INTO procurement_requirement (requirement_code, product_id, warehouse_id, required_quantity, suggested_quantity, source_type, priority) VALUES ('PR-X',$1,$2,1,1,'MANUAL','URGENT')`, [pr.id, wh.id]);
  await rejects('rejects sale_report for a missing warehouse', `INSERT INTO sale_report (report_number, company_name_snapshot, sale_date, warehouse_id, source_type) VALUES ('SR-Y','x',CURRENT_DATE,999999,'DIRECT_EXTERNAL')`);

  await client.query(`DELETE FROM app_user WHERE id = $1`, [user.id]);
  const after = await one(`SELECT created_by FROM sale_report WHERE id = $1`, [sr.id]);
  check('deleting a user keeps the sale report and clears created_by', after.created_by === null);
  // firm is referenced by sale_report (no cascade) -> deleting it must fail; cascade is tested on a fresh firm
  await rejects('rejects deleting a firm that sale reports still reference', `DELETE FROM firm WHERE id = $1`, [firm.id]);
  const f2 = await one(`INSERT INTO firm (firm_code, firm_name) VALUES ('F2','Firm 2') RETURNING id`);
  const b2 = await one(`INSERT INTO branch (firm_id, branch_code, branch_name) VALUES ($1,'B2','Branch 2') RETURNING id`, [f2.id]);
  await one(`INSERT INTO branch_document_settings (branch_id) VALUES ($1) RETURNING id`, [b2.id]);
  await client.query(`DELETE FROM firm WHERE id = $1`, [f2.id]);
  const left = await one(`SELECT (SELECT COUNT(*)::int FROM branch WHERE id = $1) b, (SELECT COUNT(*)::int FROM branch_document_settings WHERE branch_id = $1) d`, [b2.id]);
  check('deleting a firm cascades to its branches and document settings', left.b === 0 && left.d === 0);
} catch (e) {
  failures++;
  console.error('ERROR', e.message);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  const still = (await client.query(`SELECT to_regnamespace($1) IS NOT NULL AS present`, [S])).rows[0].present;
  console.log(`rolled back; throwaway schema still present: ${still}`);
  if (still) failures++;
  await client.end();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}
