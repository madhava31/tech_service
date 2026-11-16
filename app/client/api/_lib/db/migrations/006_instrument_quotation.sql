-- Migration 006: instrument quotations.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 005.
-- It runs as a single transaction and only adds columns, so existing quotations stay 'standard'.
--
--   * quotation.quotation_type: 'standard' (default) or 'instrument'.
--     An instrument quotation prints in the instrument format: a centred title, then a table with
--     Part Number | Quantity | Description | INR Total, and one total for all the items
--     (pricing_mode 'lump_sum', from migration 005).
--   * quotation.instrument_title: the centred title, e.g. "PerkinElmer make FTIR-Spectrum Two with UATR".
--   * quotation_item.is_main: the line prints in bold, for the main units of the instrument.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('quotation') IS NULL OR to_regclass('quotation_item') IS NULL THEN
    RAISE EXCEPTION 'Migration 006 needs tables "quotation" and "quotation_item" first (base schema).';
  END IF;
END $$;

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS quotation_type TEXT NOT NULL DEFAULT 'standard'
  CONSTRAINT quotation_type_check CHECK (quotation_type IN ('standard', 'instrument'));
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS instrument_title TEXT;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('quotation', 'quotation_type', 'text', 'NO'),
    ('quotation', 'instrument_title', 'text', 'YES'),
    ('quotation_item', 'is_main', 'boolean', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.column_name IS NULL OR c.data_type <> e.typ OR c.is_nullable <> e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 006 validation failed, nothing was applied: %', problems;
  END IF;
END $$;

COMMIT;
