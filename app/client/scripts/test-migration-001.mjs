// Technicon Services ERP - migration 001 test against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-migration-001.mjs
//
// Everything runs in ONE transaction on a throwaway schema and is rolled back (Postgres DDL is
// transactional), so nothing persists:
//   1. schema.sql + inventory tables + migration 001 (applied twice: idempotency)
//   2. the new tables, columns and foreign keys exist as expected
//   3. constraints and foreign keys behave correctly with sample rows
//   4. validation, RLS and anon/authenticated revocation (incl. each validation failure path)
//   5. the file's own BEGIN/COMMIT wrapper, sent as one batch on a separate connection: early and
//      late failures with the real COMMIT in place (it never runs), and a full success run with
//      COMMIT replaced by ROLLBACK, so nothing persists
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
const rawMigration = fs.readFileSync(`${APP}/api/_lib/db/migrations/001_erp_missing_tables.sql`, 'utf8');
const migration = rawMigration
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, ''); // the test wraps everything in its own transaction
// the migration's final validation DO block on its own, to exercise its failure paths directly
const validationBlock = migration.slice(migration.indexOf('-- Validation (rolls'));

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

  // The validation block must roll back a database whose existing columns differ from what the
  // migration declares (IF NOT EXISTS would otherwise keep them silently).
  const mustFailValidation = async (name, setupSql, pattern) => {
    await client.query('SAVEPOINT v');
    await client.query(setupSql);
    try { await client.query(migration); check(name, false, 'was accepted'); }
    catch (e) { check(name, pattern.test(e.message), e.message.slice(0, 160)); }
    await client.query('ROLLBACK TO SAVEPOINT v');
  };
  await mustFailValidation('validation rejects a pre-existing column with the wrong type (numeric)',
    `ALTER TABLE quotation ADD COLUMN net_subtotal NUMERIC`, /validation failed.*quotation\.net_subtotal \(expected double precision NULL, found numeric NULL\)/);
  await mustFailValidation('validation rejects a pre-existing NOT NULL supplier_id (would turn customer POs into supplier POs)',
    `ALTER TABLE purchase_order ADD COLUMN supplier_id INTEGER NOT NULL DEFAULT 0`, /validation failed.*purchase_order\.supplier_id/);
  await mustFailValidation('validation rejects a pre-existing table with a different shape',
    `CREATE TABLE firm (id BIGSERIAL PRIMARY KEY, firm_code TEXT NOT NULL UNIQUE, firm_name TEXT NOT NULL)`, /validation failed.*firm\.id \(expected integer NOT NULL, found bigint NOT NULL\)/);

  // Existing customer data before the migration: a customer PO and its company.
  const preCo = (await client.query(`INSERT INTO company (name) VALUES ('Existing Customer') RETURNING id`)).rows[0].id;
  const preQ = (await client.query(`INSERT INTO quotation (number, date, company_id) VALUES ('Q-PRE', CURRENT_DATE, $1) RETURNING id`, [preCo])).rows[0].id;
  const prePo = (await client.query(`INSERT INTO purchase_order (number, date, quotation_id) VALUES ('PO-PRE', CURRENT_DATE, $1) RETURNING id`, [preQ])).rows[0].id;

  // Simulate Supabase: anon/authenticated get default grants on new tables in this schema, and
  // an explicit grant on an existing table that the migration must leave alone.
  const supabaseRoles = (await client.query(`SELECT COUNT(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated')`)).rows[0].n === 2;
  if (supabaseRoles) {
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT ALL ON TABLES TO anon, authenticated`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT ALL ON SEQUENCES TO anon, authenticated`);
    await client.query(`GRANT SELECT ON company TO anon`);
  }

  await client.query(migration);
  await client.query(migration);
  check('migration applies, and re-applies cleanly (idempotent)', true);

  check('lock_timeout 5s / statement_timeout 60s are set inside the transaction',
    (await client.query(`SELECT current_setting('lock_timeout') lt, current_setting('statement_timeout') st`)).rows.every((r) => r.lt === '5s' && r.st === '1min'));

  const prePoAfter = (await client.query(`SELECT supplier_id, procurement_requirement_id, received_quantity FROM purchase_order WHERE id = $1`, [prePo])).rows[0];
  check('existing customer PO is preserved with NULL supplier fields (still a customer PO)',
    prePoAfter.supplier_id === null && prePoAfter.procurement_requirement_id === null && prePoAfter.received_quantity === null);
  const preCoAfter = (await client.query(`SELECT is_supplier, company_type FROM company WHERE id = $1`, [preCo])).rows[0];
  check('existing company is not turned into a supplier', preCoAfter.is_supplier === null && preCoAfter.company_type === null);
  const counts = (await client.query(`SELECT (SELECT COUNT(*)::int FROM firm) f, (SELECT COUNT(*)::int FROM branch) b, (SELECT COUNT(*)::int FROM sale_report) s, (SELECT COUNT(*)::int FROM procurement_requirement) p, (SELECT COUNT(*)::int FROM company) c, (SELECT COUNT(*)::int FROM purchase_order) po`)).rows[0];
  check('migration inserts no rows (no fabricated firms, branches, reports, requirements, suppliers or POs)',
    counts.f === 0 && counts.b === 0 && counts.s === 0 && counts.p === 0 && counts.c === 1 && counts.po === 1, JSON.stringify(counts));

  const NEW6 = ['firm', 'branch', 'branch_document_settings', 'sale_report', 'sale_report_item', 'procurement_requirement'];
  const rls = (await client.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = $1::regnamespace AND relname = ANY($2)`, [S, NEW6])).rows;
  check('row level security enabled (not forced) on all 6 new tables', rls.length === 6 && rls.every((r) => r.relrowsecurity && !r.relforcerowsecurity));
  const policies = (await client.query(`SELECT COUNT(*)::int n FROM pg_policies WHERE schemaname = $1`, [S])).rows[0].n;
  check('no RLS policies were added (no public access)', policies === 0);
  if (supabaseRoles) {
    const tGrants = (await client.query(`SELECT DISTINCT grantee, table_name FROM information_schema.role_table_grants WHERE table_schema = $1 AND grantee IN ('anon','authenticated') AND table_name = ANY($2)`, [S, NEW6])).rows;
    check('anon/authenticated have no grants on the 6 new tables', tGrants.length === 0, tGrants.map((g) => g.grantee + ':' + g.table_name).join(','));
    const sGrants = (await client.query(`SELECT c.relname, a.grantee::regrole::text g FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'S' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole) AND c.relname LIKE ANY(ARRAY['firm_%','branch_%','sale_report_%','procurement_requirement_%'])`, [S])).rows;
    check('anon/authenticated have no grants on the new id sequences', sGrants.length === 0, sGrants.map((g) => g.g + ':' + g.relname).join(','));
    // control: a table created now, without the migration's REVOKE, does get the default grants
    await client.query(`CREATE TABLE control_tbl (id SERIAL PRIMARY KEY)`);
    const control = (await client.query(`SELECT has_table_privilege('anon', $1, 'SELECT') ok`, [`${S}.control_tbl`])).rows[0].ok;
    check('control: simulated Supabase default grants do apply to new tables', control === true);
    const kept = (await client.query(`SELECT has_table_privilege('anon', $1, 'SELECT') ok`, [`${S}.company`])).rows[0].ok;
    check('grants on existing tables are left untouched', kept === true);
    // effective privileges (not limited to the grants information_schema shows the current role)
    const eff = (await client.query(
      `SELECT r, t, has_table_privilege(r, format('%I.%I', $1::text, t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') tbl,
              has_sequence_privilege(r, pg_get_serial_sequence(format('%I.%I', $1::text, t), 'id'), 'USAGE,SELECT,UPDATE') seq
       FROM unnest(ARRAY['anon','authenticated']) r, unnest($2::text[]) t`, [S, NEW6])).rows;
    check('anon/authenticated hold no effective table or sequence privilege on the 6 new tables',
      eff.length === 12 && eff.every((x) => !x.tbl && !x.seq), eff.filter((x) => x.tbl || x.seq).map((x) => `${x.r}:${x.t}`).join(','));
  } else {
    console.log('-     anon/authenticated roles not present here: grant checks skipped');
  }

  // Failure paths of the validation block itself (run on the migrated schema, then rolled back).
  const validationRejects = async (name, setupSql, pattern) => {
    await client.query('SAVEPOINT vb');
    await client.query(setupSql);
    try { await client.query(validationBlock); check(name, false, 'was accepted'); }
    catch (e) { check(name, pattern.test(e.message), e.message.slice(0, 160)); }
    await client.query('ROLLBACK TO SAVEPOINT vb');
  };
  await client.query('SAVEPOINT vb');
  try { await client.query(validationBlock); check('validation block passes on the migrated schema', true); }
  catch (e) { check('validation block passes on the migrated schema', false, e.message.slice(0, 160)); }
  await client.query('ROLLBACK TO SAVEPOINT vb');
  await validationRejects('validation rejects a new table with row level security off',
    `ALTER TABLE firm DISABLE ROW LEVEL SECURITY`, /row level security is off on firm/);
  await validationRejects('validation rejects a missing column',
    `ALTER TABLE quotation DROP COLUMN net_subtotal`, /quotation\.net_subtotal \(expected double precision NULL, found missing\)/);
  // Wrong types / nullability / missing columns across added columns, new tables and the two
  // pre-existing branch_id columns. Each mismatch is one the app would mishandle (strings from
  // numeric/bigint, timezone shifts, length limits, NULL handling).
  const MISMATCHES = [
    ['bigint instead of integer (added column)', `ALTER TABLE quotation ALTER COLUMN firm_id TYPE BIGINT`, /quotation\.firm_id \(expected integer NULL, found bigint NULL\)/],
    ['varchar instead of text (added column)', `ALTER TABLE quotation ALTER COLUMN overall_discount_type TYPE VARCHAR(20)`, /quotation\.overall_discount_type \(expected text NULL, found character varying NULL\)/],
    ['real instead of double precision (item column)', `ALTER TABLE quotation_item ALTER COLUMN final_line_total TYPE REAL`, /quotation_item\.final_line_total \(expected double precision NULL, found real NULL\)/],
    ['bigint follow-up company_id', `ALTER TABLE quotation_follow_up ALTER COLUMN company_id TYPE BIGINT`, /quotation_follow_up\.company_id \(expected integer NULL, found bigint NULL\)/],
    ['numeric money column in a new table', `ALTER TABLE sale_report ALTER COLUMN total_amount TYPE NUMERIC`, /sale_report\.total_amount \(expected double precision NOT NULL, found numeric NOT NULL\)/],
    ['timestamptz instead of timestamp (new table)', `ALTER TABLE firm ALTER COLUMN created_at TYPE TIMESTAMPTZ`, /firm\.created_at \(expected timestamp without time zone NOT NULL, found timestamp with time zone NOT NULL\)/],
    ['NOT NULL where the migration declares NULL (new table)', `ALTER TABLE sale_report ALTER COLUMN notes SET NOT NULL`, /sale_report\.notes \(expected text NULL, found text NOT NULL\)/],
    ['NULL where the migration declares NOT NULL (new table)', `ALTER TABLE branch ALTER COLUMN branch_name DROP NOT NULL`, /branch\.branch_name \(expected text NOT NULL, found text NULL\)/],
    ['missing column in a new table', `ALTER TABLE procurement_requirement DROP COLUMN supplier_id`, /procurement_requirement\.supplier_id \(expected integer NULL, found missing\)/],
    ['missing pre-existing sales_engineer.branch_id', `ALTER TABLE sales_engineer DROP COLUMN branch_id`, /sales_engineer\.branch_id \(expected integer NULL, found missing\)/],
    ['received_quantity as integer (would truncate partial receipts)', `ALTER TABLE purchase_order ALTER COLUMN received_quantity TYPE INTEGER`, /purchase_order\.received_quantity \(expected double precision NULL, found integer NULL\)/],
  ];
  for (const [what, sql, pattern] of MISMATCHES) {
    await validationRejects(`validation rejects ${what}`, sql, pattern);
  }
  await validationRejects('validation reports every mismatch at once',
    `ALTER TABLE company DROP COLUMN is_supplier; ALTER TABLE quotation ALTER COLUMN net_subtotal TYPE NUMERIC`,
    /company\.is_supplier \(expected integer NULL, found missing\).*quotation\.net_subtotal \(expected double precision NULL, found numeric NULL\)/);
  if (supabaseRoles) {
    await validationRejects('validation rejects a public API role grant on a new table',
      `GRANT SELECT ON sale_report TO anon`, /public API roles still have grants \(anon on sale_report\)/);
  }

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
    purchase_order: ['supplier_id', 'received_quantity', 'procurement_requirement_id'],
    company: ['is_supplier', 'company_type'],
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

  // The file's OWN transaction wrapper, sent as one multi-statement batch (as the SQL Editor does),
  // on a separate connection. Nothing can persist:
  //  (a) failure: verbatim file with its required tables unresolvable -> the DO check raises
  //      inside the file's BEGIN, the batch stops before COMMIT, the session is left in an
  //      aborted transaction, and SET LOCAL does not leak.
  //  (b) success: the throwaway schema and prerequisites are created INSIDE the file's own
  //      transaction (right after its BEGIN) and its final COMMIT is replaced by ROLLBACK.
  const solo = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await solo.connect();
  try {
    await solo.query(`SET search_path TO mig001_nonexistent_schema`);
    let err = null;
    try { await solo.query(rawMigration); } catch (e) { err = e; }
    check('file batch: a failing check aborts inside the file\'s own BEGIN (COMMIT never runs)', err && /needs table "app_user"/.test(err.message), err?.message);
    let aborted = null;
    try { await solo.query('SELECT 1'); aborted = false; } catch (e) { aborted = e.code === '25P02'; }
    check('file batch: the session is left in the aborted transaction the file opened', aborted === true);
    await solo.query('ROLLBACK');
    const lt1 = (await solo.query(`SELECT current_setting('lock_timeout') lt`)).rows[0].lt;
    check('file batch: SET LOCAL lock_timeout does not leak past the transaction', lt1 !== '5s', lt1);

    const B = `mig001_batch_${Math.random().toString(36).slice(2, 8)}`;
    if ((rawMigration.match(/^BEGIN;\r?$/gm) || []).length !== 1 || (rawMigration.match(/^COMMIT;\r?$/gm) || []).length !== 1) {
      throw new Error('migration must contain exactly one BEGIN; and one COMMIT; line');
    }
    const batch = rawMigration
      .replace(/^BEGIN;\r?$/m, `BEGIN;\nCREATE SCHEMA ${B};\nSET LOCAL search_path TO ${B};\n${schemaSql}\n${inventoryDdl}\n`)
      .replace(/^COMMIT;\r?$/m, `SELECT 'probe' AS probe, current_setting('lock_timeout') AS lt, current_setting('statement_timeout') AS st,
               (SELECT COUNT(*)::int FROM pg_class WHERE relnamespace = '${B}'::regnamespace AND relname = ANY(ARRAY['firm','branch','branch_document_settings','sale_report','sale_report_item','procurement_requirement']) AND relrowsecurity) AS rls6;\nROLLBACK;`);
    const results = await solo.query(batch);
    const probe = (Array.isArray(results) ? results : [results]).find((r) => r.rows?.[0]?.probe === 'probe')?.rows[0];
    check('file batch: the whole file (own BEGIN, timeouts, DDL, revoke, validation) runs as one transaction',
      probe && probe.lt === '5s' && probe.st === '1min' && probe.rls6 === 6, JSON.stringify(probe));
    const gone = (await solo.query(`SELECT to_regnamespace($1) IS NULL AS gone, current_setting('lock_timeout') lt`, [B])).rows[0];
    check('file batch: rolled back completely (schema gone, timeouts reset)', gone.gone && gone.lt !== '5s', JSON.stringify(gone));

    // (c) late failure with the file's REAL COMMIT left in place: a pre-existing numeric
    //     quotation.net_subtotal (created inside the file's transaction) passes every DDL step and
    //     is only caught by the final validation. COMMIT must never run and every earlier
    //     CREATE/ALTER/REVOKE must be undone. Safety net: should the validation ever pass, the
    //     committed throwaway schema is dropped below and the test fails.
    const L = `mig001_late_${Math.random().toString(36).slice(2, 8)}`;
    const lateBatch = rawMigration.replace(/^BEGIN;\r?$/m,
      `BEGIN;\nCREATE SCHEMA ${L};\nSET LOCAL search_path TO ${L};\n${schemaSql}\n${inventoryDdl}\nALTER TABLE quotation ADD COLUMN net_subtotal NUMERIC;\n`);
    let lateErr = null;
    try { await solo.query(lateBatch); } catch (e) { lateErr = e; }
    check('file batch: validation failure after all DDL stops before the file\'s own COMMIT',
      lateErr && /validation failed, nothing was applied: quotation\.net_subtotal \(expected double precision NULL, found numeric NULL\)/.test(lateErr.message), lateErr?.message?.slice(0, 160));
    let lateAborted = null;
    try { await solo.query('SELECT 1'); lateAborted = false; } catch (e) { lateAborted = e.code === '25P02'; }
    check('file batch: still inside the file\'s aborted transaction after the late failure', lateAborted === true);
    await solo.query('ROLLBACK');
    const lateGone = (await solo.query(`SELECT to_regnamespace($1) IS NULL AS gone`, [L])).rows[0].gone;
    if (!lateGone) await solo.query(`DROP SCHEMA ${L} CASCADE`);
    check('file batch: nothing from the failed run persists (tables, columns, RLS, revokes all undone)', lateGone === true);
  } finally {
    await solo.query('ROLLBACK').catch(() => {});
    await solo.end();
  }
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
