-- Migration 016: Sent POs, the purchase orders Technicon sends to its suppliers (Mettler Toledo India, PerkinElmer, …).
--
-- Run it by hand in the Supabase SQL Editor, after migration 001 (company and app_user must exist). It runs as a single
-- transaction and only creates two new tables, so nothing existing changes. The app works without them: only the
-- "Sent POs" tab of the Purchase Orders page says the update is missing.
--
-- A sent PO has a number made of a prefix and a sequence (both editable), the supplier (a company, saved as a supplier when it
-- is typed new), order and due dates, the state of supply, its lines (part, description, HSN, qty, unit, price, discount, tax)
-- and the totals, advance and balance, plus the terms (a title and free text) and the payment details. Totals are worked out
-- by the server when the PO is saved and stored, so lists and the PDF read them as they are.
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in migrations
-- 001 to 015. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company', 'app_user', 'product'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 016 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS sent_po (
  id SERIAL PRIMARY KEY,
  prefix TEXT NOT NULL DEFAULT '',
  seq INTEGER,
  number TEXT NOT NULL,
  company_id INTEGER REFERENCES company(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  state_of_supply TEXT,
  price_includes_tax BOOLEAN NOT NULL DEFAULT FALSE,
  round_off_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  round_off NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  sub_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  advance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  terms_title TEXT,
  terms_text TEXT,
  payment_type TEXT,
  payment_reference TEXT,
  payment_description TEXT,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- The same PO number is never used twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sent_po_number ON sent_po (lower(btrim(number)));
CREATE INDEX IF NOT EXISTS idx_sent_po_company ON sent_po (company_id);
CREATE INDEX IF NOT EXISTS idx_sent_po_date ON sent_po (order_date);

CREATE TABLE IF NOT EXISTS sent_po_item (
  id SERIAL PRIMARY KEY,
  sent_po_id INTEGER NOT NULL REFERENCES sent_po(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  product_id INTEGER REFERENCES product(id) ON DELETE SET NULL,
  part_no TEXT,
  description TEXT,
  hsn_sac TEXT,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit TEXT,
  price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  taxable_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK (tax_type IN ('NONE', 'GST', 'IGST', 'EXEMPT')),
  tax_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sent_po_item_po ON sent_po_item (sent_po_id);

ALTER TABLE sent_po ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_po_item ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON sent_po, sent_po_item FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE sent_po_id_seq, sent_po_item_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s, have %s)', e.t, e.c, e.typ, coalesce(c.data_type, 'missing')), '; ')
    INTO problems
  FROM (VALUES
    ('sent_po', 'number', 'text'),
    ('sent_po', 'supplier_name', 'text'),
    ('sent_po', 'order_date', 'date'),
    ('sent_po', 'total', 'numeric'),
    ('sent_po', 'balance', 'numeric'),
    ('sent_po', 'terms_text', 'text'),
    ('sent_po_item', 'sent_po_id', 'integer'),
    ('sent_po_item', 'qty', 'double precision'),
    ('sent_po_item', 'tax_type', 'text'),
    ('sent_po_item', 'amount', 'numeric')
  ) AS e(t, c, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 016 verification failed: %', problems;
  END IF;
END $$;

COMMIT;
