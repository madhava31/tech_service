-- Migration 015: the unit of each quotation line (Nos, Box, Pack of 100, Kg, …), picked or typed on the quotation form.
--
-- Run it by hand in the Supabase SQL Editor, after migration 002 (quotation_item must exist). It runs as a single transaction and
-- only adds one nullable column, so nothing existing changes: lines saved before it keep printing the product's unit.
-- The app works without it: the unit chosen on the form is then not saved and the product's unit prints, as before.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('quotation_item') IS NULL THEN
    RAISE EXCEPTION 'Migration 015 needs table "quotation_item" first (base schema).';
  END IF;
END $$;

ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS unit TEXT;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s, have %s)', e.t, e.c, e.typ, coalesce(c.data_type, 'missing')), '; ')
    INTO problems
  FROM (VALUES ('quotation_item', 'unit', 'text')) AS e(t, c, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 015 verification failed: %', problems;
  END IF;
END $$;

COMMIT;
