-- Migration 003: delivery challans (from a quotation, or typed manually).
--
-- Run manually (Supabase SQL Editor) after review, after migrations 001 and 002. One transaction:
-- it either applies completely or not at all. Additive: new tables only, existing data untouched.
--
--   * delivery_challan: one row per challan, a snapshot of everything printed on it, so later
--     edits to the quotation, customer or catalogue never change an issued challan. quotation_id
--     is NULL for manual challans; it is set to NULL (the challan is kept) if the quotation is deleted.
--   * delivery_challan_item: part no, description, quantity. Deliberately no price columns:
--     a delivery challan never shows an amount.
--   * delivery_challan_number_counter: TS/DC/<FY>/<6 digits>, one row per financial year, handed
--     out by a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so numbers never repeat.
--
-- Security: row level security with no policies, and anon / authenticated lose their grants, like
-- migrations 001 and 002. The backend connects as postgres (BYPASSRLS).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'app_user', 'product'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 003 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS delivery_challan (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  challan_type TEXT NOT NULL DEFAULT 'non_returnable' CHECK (challan_type IN ('non_returnable', 'returnable')),
  invoice_no TEXT,
  quotation_id INTEGER REFERENCES quotation(id) ON DELETE SET NULL,
  quotation_number TEXT,
  customer_name TEXT NOT NULL,
  customer_address TEXT,
  attention TEXT,
  phone TEXT,
  order_date DATE,
  work_order_no TEXT,
  job TEXT,
  remarks TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_quotation ON delivery_challan(quotation_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_created_by ON delivery_challan(created_by_user_id);

CREATE TABLE IF NOT EXISTS delivery_challan_item (
  id SERIAL PRIMARY KEY,
  delivery_challan_id INTEGER NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id INTEGER REFERENCES product(id) ON DELETE SET NULL,
  part_no TEXT,
  description TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_item_challan ON delivery_challan_item(delivery_challan_id);

CREATE TABLE IF NOT EXISTS delivery_challan_number_counter (
  fy TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL CHECK (last_seq >= 0)
);

ALTER TABLE delivery_challan ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challan_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challan_number_counter ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON delivery_challan, delivery_challan_item, delivery_challan_number_counter FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE delivery_challan_id_seq, delivery_challan_item_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Validation: the tables must have exactly these columns with these types/nullability (an older
-- hand-made table with the same name would otherwise be kept silently by IF NOT EXISTS).
DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('delivery_challan', 'number', 'text', 'NO'),
    ('delivery_challan', 'date', 'date', 'NO'),
    ('delivery_challan', 'challan_type', 'text', 'NO'),
    ('delivery_challan', 'invoice_no', 'text', 'YES'),
    ('delivery_challan', 'quotation_id', 'integer', 'YES'),
    ('delivery_challan', 'quotation_number', 'text', 'YES'),
    ('delivery_challan', 'customer_name', 'text', 'NO'),
    ('delivery_challan', 'customer_address', 'text', 'YES'),
    ('delivery_challan', 'attention', 'text', 'YES'),
    ('delivery_challan', 'phone', 'text', 'YES'),
    ('delivery_challan', 'order_date', 'date', 'YES'),
    ('delivery_challan', 'work_order_no', 'text', 'YES'),
    ('delivery_challan', 'job', 'text', 'YES'),
    ('delivery_challan', 'remarks', 'text', 'YES'),
    ('delivery_challan', 'created_by_user_id', 'integer', 'YES'),
    ('delivery_challan_item', 'delivery_challan_id', 'integer', 'NO'),
    ('delivery_challan_item', 'line_no', 'integer', 'NO'),
    ('delivery_challan_item', 'product_id', 'integer', 'YES'),
    ('delivery_challan_item', 'part_no', 'text', 'YES'),
    ('delivery_challan_item', 'description', 'text', 'NO'),
    ('delivery_challan_item', 'qty', 'double precision', 'NO'),
    ('delivery_challan_number_counter', 'fy', 'text', 'NO'),
    ('delivery_challan_number_counter', 'last_seq', 'integer', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.column_name IS NULL OR c.data_type <> e.typ OR c.is_nullable <> e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 003 validation failed, nothing was applied: %', problems;
  END IF;
  SELECT string_agg(relname, ', ') INTO problems FROM pg_class
   WHERE relname IN ('delivery_challan', 'delivery_challan_item', 'delivery_challan_number_counter') AND NOT relrowsecurity;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 003 validation failed: row level security is off on %', problems;
  END IF;
END $$;

COMMIT;
