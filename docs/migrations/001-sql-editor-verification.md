# Migration 001: Supabase SQL Editor verification checklist

File: `app/client/api/_lib/db/migrations/001_erp_missing_tables.sql`

The automated test (`app/client/scripts/test-migration-001.mjs`) sends this file to Postgres as one
batch, the way the SQL Editor does. It has not been run in the SQL Editor itself. This checklist
covers that manual step.

- **Part A** runs only on a disposable, non-production Supabase project.
- **Part B** is for production (`cihuudfplqsbpnvntuym`) and needs separate, explicit approval
  first. Do not start Part B until Part A has passed and the approval is given.

General rules for every run:
- Paste the **whole** file and click **Run**. Don't use "Run selected", or the `BEGIN`, `SET LOCAL`
  and `COMMIT` lines can be left out.
- The SQL Editor connects as `postgres`. Check that `SELECT current_user, current_schema();`
  returns `postgres | public`.
- If any run fails, nothing is applied: the file is one transaction. Copy the error text into the
  review. Don't edit the file to make it pass.

---

## Part A: rehearsal on a disposable project (never production)

### A0. Prepare a project that looks like production
1. Create or choose a throwaway Supabase project whose ref is **not** `cihuudfplqsbpnvntuym`.
2. In its SQL Editor, run `app/client/api/_lib/db/schema.sql`.
3. Create the inventory tables by running the `INVENTORY_DDL` text from
   `app/client/api/_lib/db/inventorySchema.js`. Starting the app against this project once also
   creates them.
4. Leave Supabase's defaults alone: RLS off on the existing tables, and `anon`/`authenticated`
   keep their default grants. That is how production is set up.

### A1. Dry run with the file's own BEGIN (expected: success, nothing kept)
1. Paste the file and change **only** the last line from `COMMIT;` to `ROLLBACK;`.
2. Add this line just before that `ROLLBACK;`:
   ```sql
   SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout;
   ```
3. Run it. **Expected:** no error, and the result shows `5s` and `1min`. Those settings only exist
   inside the file's transaction.
4. Check that nothing was kept:
   ```sql
   SELECT to_regclass('public.firm') AS firm, to_regclass('public.sale_report') AS sale_report;  -- both NULL
   SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'quotation' AND column_name = 'net_subtotal';    -- 0
   SELECT current_setting('lock_timeout');                                                         -- not 5s
   ```

### A2. Failure rehearsal with the real COMMIT (expected: error, nothing kept)
1. Paste the file **unchanged**, so `COMMIT;` stays in place.
2. Right after the `SET LOCAL statement_timeout = '60s';` line, add:
   ```sql
   ALTER TABLE quotation ADD COLUMN net_subtotal NUMERIC;
   ```
3. Run it. **Expected error:**
   `Migration 001 validation failed, nothing was applied: quotation.net_subtotal (expected double precision NULL, found numeric NULL)`
4. Run the three checks from A1 step 4 again. All must show nothing kept, **including** the
   `NUMERIC` column added in step 2.

### A3. Real apply on the disposable project (expected: success)
1. Paste the file **unchanged** and run it. **Expected:** no error.
2. Run the post-apply checks in **C** below. Every check must match.
3. Run the unchanged file a second time. **Expected:** no error (it is re-runnable).

### A4. Lock timeout behaviour (optional)
1. In a second SQL Editor tab, run `BEGIN; LOCK TABLE company IN ACCESS SHARE MODE;` and leave it
   open.
2. In the first tab, run the unchanged file. **Expected:** within about 5 s it fails with
   `canceling statement due to lock timeout`, and nothing is applied.
3. Run `ROLLBACK;` in the second tab.

Record the date, project ref, and the result of A1–A4 in the review before asking for Part B
approval.

---

## Part B: production (only after separate written approval)

### B0. Before running
- [ ] Part A passed, and the results are in the review.
- [ ] A backup or point-in-time restore point exists for `cihuudfplqsbpnvntuym`.
- [ ] The file is byte-for-byte the reviewed, committed version, with no local edits.
- [ ] The read-only checks A–E from the review still match. Rerun query A (columns) and query B
      (name collisions) immediately before applying.
- [ ] It is a quiet period, and no long-running transactions are open:
      ```sql
      SELECT pid, state, now() - xact_start AS open_for, left(query, 80)
      FROM pg_stat_activity
      WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid()
      ORDER BY xact_start;
      ```

### B1. Apply
- Paste the unchanged file and run it once.
- **If it fails with a lock timeout:** nothing was applied. Wait, then run it again.
- **If it fails with `validation failed`:** nothing was applied. Stop, and bring the error text
  back to review.

### B2. After applying
Run the checks in **C**, then confirm in the app:
- creating a quotation succeeds
- the Sales and Procurement pages no longer return `MIGRATION_REQUIRED`

---

## C. Post-apply checks (A3 and B2)

```sql
-- C1. The six new tables exist, with RLS on (expect 6 rows, all true)
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('firm','branch','branch_document_settings','sale_report','sale_report_item','procurement_requirement')
ORDER BY relname;

-- C2. No anon/authenticated privilege on them or their id sequences (expect 0 rows)
SELECT r, t FROM unnest(ARRAY['anon','authenticated']) r,
              unnest(ARRAY['firm','branch','branch_document_settings','sale_report','sale_report_item','procurement_requirement']) t
WHERE has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_sequence_privilege(r, pg_get_serial_sequence('public.' || t, 'id'), 'USAGE,SELECT,UPDATE');

-- C3. No RLS policies were added (expect 0)
SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('firm','branch','branch_document_settings','sale_report','sale_report_item','procurement_requirement');

-- C4. No data was invented (expect 0 for every count)
SELECT (SELECT count(*) FROM firm) AS firms, (SELECT count(*) FROM branch) AS branches,
       (SELECT count(*) FROM sale_report) AS sale_reports, (SELECT count(*) FROM procurement_requirement) AS requirements,
       (SELECT count(*) FROM purchase_order WHERE supplier_id IS NOT NULL OR procurement_requirement_id IS NOT NULL OR received_quantity IS NOT NULL) AS reclassified_pos,
       (SELECT count(*) FROM company WHERE is_supplier IS NOT NULL OR company_type IS NOT NULL) AS companies_marked_supplier;

-- C5. Added column types (expect 28 rows: integer / double precision / text, all nullable)
SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND (
  (table_name = 'quotation' AND column_name IN ('firm_id','branch_id','gross_subtotal','product_discount_total','subtotal_after_product_discounts','overall_discount_type','overall_discount_value','overall_discount_amount','net_subtotal')) OR
  (table_name = 'quotation_item' AND column_name IN ('actual_unit_price','discount_type','discount_value','product_discount_amount','after_product_discount_amount','overall_discount_allocated','final_unit_price','final_line_total')) OR
  (table_name = 'quotation_follow_up' AND column_name IN ('follow_up_time','priority','firm_id','branch_id','company_id','sales_engineer_id')) OR
  (table_name = 'purchase_order' AND column_name IN ('supplier_id','received_quantity','procurement_requirement_id')) OR
  (table_name = 'company' AND column_name IN ('is_supplier','company_type')))
ORDER BY table_name, column_name;

-- C6. Grants on existing tables were not changed (compare with the pre-apply result)
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'company' AND grantee IN ('anon','authenticated')
GROUP BY grantee;
```

Expected results: C1 shows 6 rows, all `true`. C2 returns 0 rows. C3 is 0. Every count in C4 is
0 on a fresh apply. C5 returns 28 rows with the declared types, all nullable. C6 is unchanged.
