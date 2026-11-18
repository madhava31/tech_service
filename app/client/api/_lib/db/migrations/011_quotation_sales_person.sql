-- Migration 011: several sales people on one quotation, with each person's share of the sales target.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 001 (quotation and sales_engineer must
-- exist). It runs as a single transaction and only creates a new table, so nothing existing changes.
--
-- A quotation has one main sales engineer (quotation.sales_engineer_id). When two or more sales people worked on the
-- same company, every one of them is listed here, the main one included, each with the percentage of the sale that
-- counts toward that person's sales target (the percentages of a quotation add up to 100). A quotation with a single
-- sales person has no rows here and counts 100% for that person, exactly as before. The app works without this table:
-- only the "add another sales person" option and the target split are unavailable.
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in
-- migrations 001 to 010. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'sales_engineer'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 011 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS quotation_sales_person (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  sales_engineer_id INTEGER NOT NULL REFERENCES sales_engineer(id) ON DELETE CASCADE,
  share_percent NUMERIC(5,2) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (quotation_id, sales_engineer_id)
);
CREATE INDEX IF NOT EXISTS idx_quotation_sales_person_quotation ON quotation_sales_person(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_sales_person_engineer ON quotation_sales_person(sales_engineer_id);

ALTER TABLE quotation_sales_person ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quotation_sales_person FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE quotation_sales_person_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('quotation_sales_person', 'id', 'integer', 'NO'),
    ('quotation_sales_person', 'quotation_id', 'integer', 'NO'),
    ('quotation_sales_person', 'sales_engineer_id', 'integer', 'NO'),
    ('quotation_sales_person', 'share_percent', 'numeric', 'NO'),
    ('quotation_sales_person', 'created_at', 'timestamp without time zone', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ OR c.is_nullable IS DISTINCT FROM e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 011 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
