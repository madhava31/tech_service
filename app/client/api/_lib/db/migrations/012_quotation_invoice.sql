-- Migration 012: invoices of a quotation, with the items and quantities each one bills and the payment due date.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 001 (quotation, quotation_item and
-- app_user must exist). It runs as a single transaction and only creates new tables, so nothing existing changes.
--
-- After the PO is received (and, for customers who want one, the performa invoice), the goods are invoiced. The user
-- types the invoice number from their tax invoice, the invoice date, the items and quantities billed, and the payment
-- due date (it starts as the invoice date plus the quotation's payment due days and can be changed). A quotation can
-- have several invoices, for example when the goods are delivered in parts. The payment schedule counts the balance
-- (or the full payment) as due on the first invoice's payment due date. The app works without these tables: only the
-- Invoice section is unavailable.
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in
-- migrations 001 to 011. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'quotation_item', 'app_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 012 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS quotation_invoice (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_due_date DATE NOT NULL,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (payment_due_date >= invoice_date)
);
CREATE INDEX IF NOT EXISTS idx_quotation_invoice_quotation ON quotation_invoice(quotation_id);
-- The same invoice number is not recorded twice for one quotation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_invoice_number ON quotation_invoice (quotation_id, lower(btrim(invoice_number)));

CREATE TABLE IF NOT EXISTS quotation_invoice_item (
  id SERIAL PRIMARY KEY,
  quotation_invoice_id INTEGER NOT NULL REFERENCES quotation_invoice(id) ON DELETE CASCADE,
  quotation_item_id INTEGER NOT NULL REFERENCES quotation_item(id) ON DELETE CASCADE,
  qty DOUBLE PRECISION NOT NULL CHECK (qty > 0),
  UNIQUE (quotation_invoice_id, quotation_item_id)
);
CREATE INDEX IF NOT EXISTS idx_quotation_invoice_item_item ON quotation_invoice_item(quotation_item_id);

ALTER TABLE quotation_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_invoice_item ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quotation_invoice, quotation_invoice_item FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE quotation_invoice_id_seq, quotation_invoice_item_id_seq FROM %I', r);
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
    ('quotation_invoice', 'id', 'integer', 'NO'),
    ('quotation_invoice', 'quotation_id', 'integer', 'NO'),
    ('quotation_invoice', 'invoice_number', 'text', 'NO'),
    ('quotation_invoice', 'invoice_date', 'date', 'NO'),
    ('quotation_invoice', 'payment_due_date', 'date', 'NO'),
    ('quotation_invoice', 'notes', 'text', 'YES'),
    ('quotation_invoice', 'created_by_user_id', 'integer', 'YES'),
    ('quotation_invoice', 'created_at', 'timestamp without time zone', 'NO'),
    ('quotation_invoice_item', 'id', 'integer', 'NO'),
    ('quotation_invoice_item', 'quotation_invoice_id', 'integer', 'NO'),
    ('quotation_invoice_item', 'quotation_item_id', 'integer', 'NO'),
    ('quotation_invoice_item', 'qty', 'double precision', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ OR c.is_nullable IS DISTINCT FROM e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 012 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
