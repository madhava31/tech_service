-- Migration 010: negotiation history of a quotation.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 001 (quotation and app_user must
-- exist). It runs as a single transaction and only creates a new table, so nothing existing changes.
--
-- When a customer asks for a price change the user clicks "Negotiate" on the sent quotation, edits it and sends it
-- again. Each time a negotiation starts, the version that was sent is saved here as a revision, so the price history
-- (what was offered in each round) stays visible. The app works without this table: negotiation still works, only
-- the saved history is not kept.
--   * revision_no  1, 2, 3 ... per quotation: the version that was sent before round n of negotiation.
--   * total, subtotal, tax_amount  the amounts of that version.
--   * items        the lines of that version (part number, description, quantity, price, discount, line total).
--   * note         what the customer asked for (optional).
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in
-- migrations 001 to 009. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'app_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 010 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS quotation_revision (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  note TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (quotation_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_quotation_revision_quotation ON quotation_revision(quotation_id);

ALTER TABLE quotation_revision ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quotation_revision FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE quotation_revision_id_seq FROM %I', r);
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
    ('quotation_revision', 'id', 'integer', 'NO'),
    ('quotation_revision', 'quotation_id', 'integer', 'NO'),
    ('quotation_revision', 'revision_no', 'integer', 'NO'),
    ('quotation_revision', 'total', 'double precision', 'NO'),
    ('quotation_revision', 'subtotal', 'double precision', 'NO'),
    ('quotation_revision', 'tax_amount', 'double precision', 'NO'),
    ('quotation_revision', 'note', 'text', 'YES'),
    ('quotation_revision', 'items', 'jsonb', 'NO'),
    ('quotation_revision', 'created_by_user_id', 'integer', 'YES'),
    ('quotation_revision', 'created_at', 'timestamp without time zone', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ OR c.is_nullable IS DISTINCT FROM e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 010 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
