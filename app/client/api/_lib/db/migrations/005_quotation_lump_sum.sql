-- Migration 005: one total amount for all of a quotation's items ("lump sum" pricing).
--
-- Run it by hand in the Supabase SQL Editor, after review. It needs only the base quotation table.
-- It runs as a single transaction and only adds columns, so existing quotations are untouched.
--
--   * quotation.pricing_mode:
--       'itemized' (default) means every line has its own price, as before.
--       'lump_sum' means the user entered one total for all the items.
--   * quotation.lump_sum_amount: that total, before overall discount and GST.
--
-- The total is still split across the lines in proportion to quantity, so POs, PIs, payments and
-- reports keep working unchanged. The quotation PDF prints only the total, with no per-item prices.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('quotation') IS NULL THEN
    RAISE EXCEPTION 'Migration 005 needs table "quotation" first (base schema).';
  END IF;
END $$;

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'itemized'
  CONSTRAINT quotation_pricing_mode_check CHECK (pricing_mode IN ('itemized', 'lump_sum'));
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS lump_sum_amount NUMERIC(14, 2)
  CONSTRAINT quotation_lump_sum_amount_check CHECK (lump_sum_amount IS NULL OR lump_sum_amount > 0);

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('quotation', 'pricing_mode', 'text', 'NO'),
    ('quotation', 'lump_sum_amount', 'numeric', 'YES')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.column_name IS NULL OR c.data_type <> e.typ OR c.is_nullable <> e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 005 validation failed, nothing was applied: %', problems;
  END IF;
END $$;

COMMIT;
