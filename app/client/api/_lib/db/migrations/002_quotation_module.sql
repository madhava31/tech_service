-- Migration 002: quotation module (catalogue key features, TS/<FY>/<seq> numbering, editable terms).
--
-- Run manually (Supabase SQL Editor) after review, after migration 001. One transaction: it either
-- applies completely or not at all.
--
-- Additive only. Existing rows are untouched:
--   * product: make, key_features (a JSON array of short strings; [] for existing products, which
--     then cannot be put on a new quotation until a feature is added).
--   * quotation: contact_person, opportunity_ref, terms (JSON array of {label, text} in print
--     order). terms IS NULL marks a quotation made before this module; it keeps its old PDF.
--   * quotation_item: product_name, make, key_features: a snapshot taken when the quotation is
--     saved, so later catalogue edits never change an issued quotation.
--   * quotation_number_counter: one row per financial year ("26-27"). Numbers are handed out with
--     a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, which Postgres serialises per row, so
--     two users can never receive the same number.
--
-- Security: the new table gets row level security with no policies and loses the anon /
-- authenticated grants, like migration 001. The backend connects as postgres (BYPASSRLS).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product', 'quotation', 'quotation_item'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 002 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

ALTER TABLE product ADD COLUMN IF NOT EXISTS make TEXT;
ALTER TABLE product ADD COLUMN IF NOT EXISTS key_features JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS opportunity_ref TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS terms JSONB;

ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS key_features JSONB;

CREATE TABLE IF NOT EXISTS quotation_number_counter (
  fy TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL CHECK (last_seq >= 0)
);

CREATE INDEX IF NOT EXISTS idx_quotation_created_by ON quotation(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_quotation_item_quotation ON quotation_item(quotation_id);

ALTER TABLE quotation_number_counter ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quotation_number_counter FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Validation: every column this migration declares must exist with the expected type and
-- nullability (an older hand-made column with a different type would otherwise be kept silently).
DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('product', 'make', 'text', 'YES'),
    ('product', 'key_features', 'jsonb', 'NO'),
    ('quotation', 'contact_person', 'text', 'YES'),
    ('quotation', 'opportunity_ref', 'text', 'YES'),
    ('quotation', 'terms', 'jsonb', 'YES'),
    ('quotation_item', 'product_name', 'text', 'YES'),
    ('quotation_item', 'make', 'text', 'YES'),
    ('quotation_item', 'key_features', 'jsonb', 'YES'),
    ('quotation_number_counter', 'fy', 'text', 'NO'),
    ('quotation_number_counter', 'last_seq', 'integer', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.column_name IS NULL OR c.data_type <> e.typ OR c.is_nullable <> e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 002 validation failed, nothing was applied: %', problems;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'quotation_number_counter'::regclass) THEN
    RAISE EXCEPTION 'Migration 002 validation failed: row level security is off on quotation_number_counter';
  END IF;
END $$;

COMMIT;
