-- Migration 008: purchase orders received against a quotation ("PO received").
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 004 (quotation, quotation_item and
-- app_user must exist). It runs as a single transaction and only creates new tables, so nothing existing changes.
--
--   * quotation_po: one row per customer PO that arrived for a quotation. The user types the customer's PO number
--     by hand. A quotation can receive several POs (for example a second PO for the remaining items).
--   * quotation_po_item: the items and quantities that PO ordered. A customer may order every quoted item, or only
--     some items, or smaller quantities, so each PO lists exactly what it ordered.
--
-- This does not touch the existing purchase_order table (which Procurement also uses for supplier orders).
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in
-- migrations 001 to 007. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'quotation_item', 'app_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 008 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS quotation_po (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotation_po_quotation ON quotation_po(quotation_id);
-- The same PO number is not recorded twice for one quotation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_po_number ON quotation_po (quotation_id, lower(btrim(po_number)));

CREATE TABLE IF NOT EXISTS quotation_po_item (
  id SERIAL PRIMARY KEY,
  quotation_po_id INTEGER NOT NULL REFERENCES quotation_po(id) ON DELETE CASCADE,
  quotation_item_id INTEGER NOT NULL REFERENCES quotation_item(id) ON DELETE CASCADE,
  qty DOUBLE PRECISION NOT NULL CHECK (qty > 0),
  UNIQUE (quotation_po_id, quotation_item_id)
);
CREATE INDEX IF NOT EXISTS idx_quotation_po_item_item ON quotation_po_item(quotation_item_id);

ALTER TABLE quotation_po ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_po_item ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quotation_po, quotation_po_item FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE quotation_po_id_seq, quotation_po_item_id_seq FROM %I', r);
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
    ('quotation_po', 'id', 'integer', 'NO'),
    ('quotation_po', 'quotation_id', 'integer', 'NO'),
    ('quotation_po', 'po_number', 'text', 'NO'),
    ('quotation_po', 'po_date', 'date', 'NO'),
    ('quotation_po', 'notes', 'text', 'YES'),
    ('quotation_po', 'created_by_user_id', 'integer', 'YES'),
    ('quotation_po', 'created_at', 'timestamp without time zone', 'NO'),
    ('quotation_po_item', 'id', 'integer', 'NO'),
    ('quotation_po_item', 'quotation_po_id', 'integer', 'NO'),
    ('quotation_po_item', 'quotation_item_id', 'integer', 'NO'),
    ('quotation_po_item', 'qty', 'double precision', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ OR c.is_nullable IS DISTINCT FROM e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 008 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
