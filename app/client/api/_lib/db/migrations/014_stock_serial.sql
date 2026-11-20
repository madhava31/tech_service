-- Migration 014: serial numbers of stock units (Mettler instruments), with the date each unit came in and the date it went out.
--
-- Run it by hand in the Supabase SQL Editor, after migrations 001 and 012 (product, warehouse, stock_receipt and quotation_invoice
-- must exist). It runs as a single transaction and only creates a new table, so nothing existing changes.
--
-- One row per unit. It is created when stock comes in (the Stock Inward form asks for the serial numbers of Mettler lines) and
-- gets its outward date and invoice when an invoice picks it. Removing that invoice puts the unit back in stock. The same serial
-- number is never recorded twice for one product. The app works without this table: only the serial number features are unavailable.
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in migrations
-- 001 to 012. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product', 'warehouse', 'stock_receipt', 'quotation_invoice'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 014 needs table "%" first (migrations 001 and 012).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS stock_serial (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL,
  warehouse_id INTEGER REFERENCES warehouse(id) ON DELETE SET NULL,
  receipt_id INTEGER REFERENCES stock_receipt(id) ON DELETE SET NULL,
  inward_date DATE NOT NULL DEFAULT CURRENT_DATE,
  outward_date DATE,
  invoice_id INTEGER REFERENCES quotation_invoice(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_serial_product_serial ON stock_serial (product_id, lower(btrim(serial_number)));
CREATE INDEX IF NOT EXISTS idx_stock_serial_in_stock ON stock_serial (product_id) WHERE outward_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_serial_invoice ON stock_serial (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_serial_receipt ON stock_serial (receipt_id) WHERE receipt_id IS NOT NULL;

ALTER TABLE stock_serial ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON stock_serial FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE stock_serial_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s, have %s)', e.t, e.c, e.typ, coalesce(c.data_type, 'missing')), '; ')
    INTO problems
  FROM (VALUES
    ('stock_serial', 'id', 'integer'),
    ('stock_serial', 'product_id', 'integer'),
    ('stock_serial', 'serial_number', 'text'),
    ('stock_serial', 'warehouse_id', 'integer'),
    ('stock_serial', 'receipt_id', 'integer'),
    ('stock_serial', 'inward_date', 'date'),
    ('stock_serial', 'outward_date', 'date'),
    ('stock_serial', 'invoice_id', 'integer')
  ) AS e(t, c, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 014 verification failed: %', problems;
  END IF;
END $$;

COMMIT;
