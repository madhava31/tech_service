-- Migration 001: tables and columns used by the Sales, Sale Reports, Firms/Branches, Procurement
-- and Search code that were never added to the Postgres schema.
--
-- Run manually (Supabase SQL Editor) after review. It runs in one transaction, so it either
-- applies completely or not at all.
--
-- IF NOT EXISTS makes it re-runnable, but does NOT make it safe on a database that already has
-- some of these objects: an existing table or column is kept exactly as it is, even with a
-- different type. The validation block at the end therefore checks every column this migration
-- declares (type and nullability) and rolls everything back if anything differs.
--
-- Locks: ADD COLUMN and REFERENCES take short exclusive/share locks on company, purchase_order,
-- quotation* and the referenced tables, held until COMMIT. lock_timeout makes the migration give
-- up (and roll back) instead of queueing the live app behind it; just run it again later.
--
-- Security: the six new tables get row level security with NO policies, and anon/authenticated
-- (Supabase's public API roles) lose their default grants on them. The backend connects as
-- postgres, which has BYPASSRLS, so the app is unaffected; the frontend never queries Supabase
-- directly (all data goes through /api).
--
-- Data: nothing is inserted, updated or backfilled. Existing purchase_order rows keep
-- supplier_id / procurement_requirement_id NULL, so they remain customer purchase orders;
-- existing companies keep is_supplier NULL.
--
-- Source of truth: the Postgres database these routes were developed against (a read-only catalog
-- read of the previous project). Differences from that source, on purpose:
--   * created_by / confirmed_by reference app_user (the table the Postgres app authenticates with)
--     ON DELETE SET NULL, like the inventory tables, instead of the legacy SQLite-era "user" table.
--   * sales_engineer.user_id and is_sales_engineer are not added: no code reads or writes them.
--   * purchase_order.sales_engineer_id/firm_id/branch_id are not added: nothing writes them, and
--     the one read (saleReports.js, from SELECT po.*) already falls back to NULL without them.
--
-- Requires the base schema (schema.sql) and the inventory tables (created by
-- app/client/api/_lib/db/inventorySchema.js on first use), which sale_report and
-- procurement_requirement reference.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user', 'company', 'product', 'quotation', 'quotation_item', 'quotation_follow_up',
                           'purchase_order', 'performa_invoice', 'sales_engineer', 'warehouse'] LOOP
    IF to_regclass(quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'Migration 001 needs table "%" first (base schema / inventory tables).', t;
    END IF;
  END LOOP;
END $$;

-- Firms and branches -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firm (
  id SERIAL PRIMARY KEY,
  firm_code TEXT NOT NULL UNIQUE,
  firm_name TEXT NOT NULL,
  legal_name TEXT,
  gstin TEXT,
  pan TEXT,
  email TEXT,
  phone TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT DEFAULT 'India',
  logo TEXT,
  quotation_prefix TEXT DEFAULT 'QTN',
  invoice_prefix TEXT DEFAULT 'INV',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branch (
  id SERIAL PRIMARY KEY,
  firm_id INTEGER NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  pan TEXT,
  bank_details TEXT,
  terms_conditions TEXT,
  quotation_prefix TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branch_firm ON branch(firm_id);

CREATE TABLE IF NOT EXISTS branch_document_settings (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL UNIQUE REFERENCES branch(id) ON DELETE CASCADE,
  document_title_prefix TEXT,
  logo_path TEXT,
  header_text TEXT,
  footer_text TEXT,
  authorized_signatory TEXT,
  bank_name TEXT,
  account_number TEXT,
  ifsc_code TEXT,
  branch_bank_name TEXT,
  terms_conditions TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sale reports -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_report (
  id SERIAL PRIMARY KEY,
  report_number TEXT NOT NULL UNIQUE,
  company_id INTEGER REFERENCES company(id),
  company_name_snapshot TEXT NOT NULL,
  invoice_number TEXT,
  sale_date DATE NOT NULL,
  phone_number_snapshot TEXT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('INTERNAL_DOCUMENT', 'DIRECT_EXTERNAL')),
  source_reference TEXT,
  source_quotation_id INTEGER REFERENCES quotation(id),
  source_po_id INTEGER REFERENCES purchase_order(id),
  source_pi_id INTEGER REFERENCES performa_invoice(id),
  sales_engineer_id INTEGER REFERENCES sales_engineer(id),
  firm_id INTEGER REFERENCES firm(id),
  branch_id INTEGER REFERENCES branch(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_percent DOUBLE PRECISION NOT NULL DEFAULT 18,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  confirmed_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_report_company ON sale_report(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_report_date ON sale_report(sale_date);
CREATE INDEX IF NOT EXISTS idx_sale_report_status ON sale_report(status);
CREATE INDEX IF NOT EXISTS idx_sale_report_wh ON sale_report(warehouse_id);

CREATE TABLE IF NOT EXISTS sale_report_item (
  id SERIAL PRIMARY KEY,
  sale_report_id INTEGER NOT NULL REFERENCES sale_report(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product(id),
  part_number_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL,
  hsn_code_snapshot TEXT,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  before_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  after_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Procurement ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurement_requirement (
  id SERIAL PRIMARY KEY,
  requirement_code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  required_quantity DOUBLE PRECISION NOT NULL CHECK (required_quantity > 0),
  suggested_quantity DOUBLE PRECISION NOT NULL CHECK (suggested_quantity > 0),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  reason TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('STOCK_INTELLIGENCE', 'RESTOCK_QUEUE', 'SALES_DEMAND', 'MANUAL')),
  source_reference TEXT,
  supplier_id INTEGER REFERENCES company(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_COVERED', 'ORDERED', 'RECEIVING', 'FULFILLED')),
  purchase_order_id INTEGER REFERENCES purchase_order(id),
  created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_req_prod ON procurement_requirement(product_id);
CREATE INDEX IF NOT EXISTS idx_proc_req_wh ON procurement_requirement(warehouse_id);

-- Columns used by the quotation code (create/edit, export, pipeline) -------------------------
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS firm_id INTEGER;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS gross_subtotal DOUBLE PRECISION;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS product_discount_total DOUBLE PRECISION;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS subtotal_after_product_discounts DOUBLE PRECISION;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS overall_discount_type TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS overall_discount_value DOUBLE PRECISION;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS overall_discount_amount DOUBLE PRECISION;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS net_subtotal DOUBLE PRECISION;

ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS actual_unit_price DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS discount_type TEXT;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS discount_value DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS product_discount_amount DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS after_product_discount_amount DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS overall_discount_allocated DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS final_unit_price DOUBLE PRECISION;
ALTER TABLE quotation_item ADD COLUMN IF NOT EXISTS final_line_total DOUBLE PRECISION;

ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS follow_up_time TEXT;
ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS firm_id INTEGER;
ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE quotation_follow_up ADD COLUMN IF NOT EXISTS sales_engineer_id INTEGER;

-- Columns used by the procurement code (supplier purchase orders and supplier companies) ------
-- A supplier purchase order is a purchase_order row with supplier_id or procurement_requirement_id
-- set; customer purchase orders leave both NULL.
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS received_quantity DOUBLE PRECISION;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS procurement_requirement_id INTEGER;
ALTER TABLE company ADD COLUMN IF NOT EXISTS is_supplier INTEGER;
ALTER TABLE company ADD COLUMN IF NOT EXISTS company_type TEXT;

-- Security for the new tables ---------------------------------------------------------------
-- RLS with no policies denies every role without BYPASSRLS. Grants are revoked as well, so the
-- tables are not reachable through Supabase's REST/GraphQL API with the anon or authenticated
-- role. service_role (server-side secret key, BYPASSRLS) keeps Supabase's defaults.
ALTER TABLE firm ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_report_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requirement ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
  seq text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    -- these roles exist only on Supabase; plain Postgres (local/test) skips this
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['firm', 'branch', 'branch_document_settings', 'sale_report',
                               'sale_report_item', 'procurement_requirement'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', t, r);
        seq := pg_get_serial_sequence(t, 'id');
        IF seq IS NOT NULL THEN
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I', seq, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Validation (rolls the whole migration back on any mismatch) ---------------------------------
-- Every column this migration declares, plus the two existing branch_id columns the code joins
-- to branch. Types must match exactly: node-postgres returns numeric and bigint as strings, so
-- a "compatible-looking" numeric/bigint column would break the arithmetic in the quotation,
-- sales and procurement code.
DO $$
DECLARE
  problems text;
BEGIN
  WITH expected(table_name, column_name, data_type, is_nullable) AS (VALUES
    ('firm', 'id', 'integer', 'NO'),
    ('firm', 'firm_code', 'text', 'NO'),
    ('firm', 'firm_name', 'text', 'NO'),
    ('firm', 'legal_name', 'text', 'YES'),
    ('firm', 'gstin', 'text', 'YES'),
    ('firm', 'pan', 'text', 'YES'),
    ('firm', 'email', 'text', 'YES'),
    ('firm', 'phone', 'text', 'YES'),
    ('firm', 'address_line_1', 'text', 'YES'),
    ('firm', 'address_line_2', 'text', 'YES'),
    ('firm', 'city', 'text', 'YES'),
    ('firm', 'state', 'text', 'YES'),
    ('firm', 'pincode', 'text', 'YES'),
    ('firm', 'country', 'text', 'YES'),
    ('firm', 'logo', 'text', 'YES'),
    ('firm', 'quotation_prefix', 'text', 'YES'),
    ('firm', 'invoice_prefix', 'text', 'YES'),
    ('firm', 'is_default', 'integer', 'NO'),
    ('firm', 'is_active', 'integer', 'NO'),
    ('firm', 'created_at', 'timestamp without time zone', 'NO'),
    ('firm', 'updated_at', 'timestamp without time zone', 'NO'),
    ('branch', 'id', 'integer', 'NO'),
    ('branch', 'firm_id', 'integer', 'NO'),
    ('branch', 'branch_code', 'text', 'NO'),
    ('branch', 'branch_name', 'text', 'NO'),
    ('branch', 'address_line_1', 'text', 'YES'),
    ('branch', 'address_line_2', 'text', 'YES'),
    ('branch', 'city', 'text', 'YES'),
    ('branch', 'state', 'text', 'YES'),
    ('branch', 'pincode', 'text', 'YES'),
    ('branch', 'phone', 'text', 'YES'),
    ('branch', 'email', 'text', 'YES'),
    ('branch', 'gstin', 'text', 'YES'),
    ('branch', 'pan', 'text', 'YES'),
    ('branch', 'bank_details', 'text', 'YES'),
    ('branch', 'terms_conditions', 'text', 'YES'),
    ('branch', 'quotation_prefix', 'text', 'YES'),
    ('branch', 'is_default', 'integer', 'NO'),
    ('branch', 'is_active', 'integer', 'NO'),
    ('branch', 'created_at', 'timestamp without time zone', 'NO'),
    ('branch', 'updated_at', 'timestamp without time zone', 'NO'),
    ('branch_document_settings', 'id', 'integer', 'NO'),
    ('branch_document_settings', 'branch_id', 'integer', 'NO'),
    ('branch_document_settings', 'document_title_prefix', 'text', 'YES'),
    ('branch_document_settings', 'logo_path', 'text', 'YES'),
    ('branch_document_settings', 'header_text', 'text', 'YES'),
    ('branch_document_settings', 'footer_text', 'text', 'YES'),
    ('branch_document_settings', 'authorized_signatory', 'text', 'YES'),
    ('branch_document_settings', 'bank_name', 'text', 'YES'),
    ('branch_document_settings', 'account_number', 'text', 'YES'),
    ('branch_document_settings', 'ifsc_code', 'text', 'YES'),
    ('branch_document_settings', 'branch_bank_name', 'text', 'YES'),
    ('branch_document_settings', 'terms_conditions', 'text', 'YES'),
    ('branch_document_settings', 'created_at', 'timestamp without time zone', 'NO'),
    ('branch_document_settings', 'updated_at', 'timestamp without time zone', 'NO'),
    ('sale_report', 'id', 'integer', 'NO'),
    ('sale_report', 'report_number', 'text', 'NO'),
    ('sale_report', 'company_id', 'integer', 'YES'),
    ('sale_report', 'company_name_snapshot', 'text', 'NO'),
    ('sale_report', 'invoice_number', 'text', 'YES'),
    ('sale_report', 'sale_date', 'date', 'NO'),
    ('sale_report', 'phone_number_snapshot', 'text', 'YES'),
    ('sale_report', 'warehouse_id', 'integer', 'NO'),
    ('sale_report', 'source_type', 'text', 'NO'),
    ('sale_report', 'source_reference', 'text', 'YES'),
    ('sale_report', 'source_quotation_id', 'integer', 'YES'),
    ('sale_report', 'source_po_id', 'integer', 'YES'),
    ('sale_report', 'source_pi_id', 'integer', 'YES'),
    ('sale_report', 'sales_engineer_id', 'integer', 'YES'),
    ('sale_report', 'firm_id', 'integer', 'YES'),
    ('sale_report', 'branch_id', 'integer', 'YES'),
    ('sale_report', 'status', 'text', 'NO'),
    ('sale_report', 'subtotal', 'double precision', 'NO'),
    ('sale_report', 'tax_percent', 'double precision', 'NO'),
    ('sale_report', 'tax_amount', 'double precision', 'NO'),
    ('sale_report', 'total_amount', 'double precision', 'NO'),
    ('sale_report', 'notes', 'text', 'YES'),
    ('sale_report', 'created_by', 'integer', 'YES'),
    ('sale_report', 'created_at', 'timestamp without time zone', 'NO'),
    ('sale_report', 'updated_at', 'timestamp without time zone', 'NO'),
    ('sale_report', 'confirmed_at', 'timestamp without time zone', 'YES'),
    ('sale_report', 'confirmed_by', 'integer', 'YES'),
    ('sale_report_item', 'id', 'integer', 'NO'),
    ('sale_report_item', 'sale_report_id', 'integer', 'NO'),
    ('sale_report_item', 'product_id', 'integer', 'NO'),
    ('sale_report_item', 'part_number_snapshot', 'text', 'NO'),
    ('sale_report_item', 'description_snapshot', 'text', 'NO'),
    ('sale_report_item', 'hsn_code_snapshot', 'text', 'YES'),
    ('sale_report_item', 'quantity', 'double precision', 'NO'),
    ('sale_report_item', 'unit_price', 'double precision', 'NO'),
    ('sale_report_item', 'total_price', 'double precision', 'NO'),
    ('sale_report_item', 'before_on_hand', 'double precision', 'NO'),
    ('sale_report_item', 'after_on_hand', 'double precision', 'NO'),
    ('sale_report_item', 'created_at', 'timestamp without time zone', 'NO'),
    ('procurement_requirement', 'id', 'integer', 'NO'),
    ('procurement_requirement', 'requirement_code', 'text', 'NO'),
    ('procurement_requirement', 'product_id', 'integer', 'NO'),
    ('procurement_requirement', 'warehouse_id', 'integer', 'NO'),
    ('procurement_requirement', 'required_quantity', 'double precision', 'NO'),
    ('procurement_requirement', 'suggested_quantity', 'double precision', 'NO'),
    ('procurement_requirement', 'priority', 'text', 'NO'),
    ('procurement_requirement', 'reason', 'text', 'YES'),
    ('procurement_requirement', 'source_type', 'text', 'NO'),
    ('procurement_requirement', 'source_reference', 'text', 'YES'),
    ('procurement_requirement', 'supplier_id', 'integer', 'YES'),
    ('procurement_requirement', 'status', 'text', 'NO'),
    ('procurement_requirement', 'purchase_order_id', 'integer', 'YES'),
    ('procurement_requirement', 'created_by', 'integer', 'YES'),
    ('procurement_requirement', 'created_at', 'timestamp without time zone', 'NO'),
    ('procurement_requirement', 'updated_at', 'timestamp without time zone', 'NO'),
    ('quotation', 'firm_id', 'integer', 'YES'),
    ('quotation', 'branch_id', 'integer', 'YES'),
    ('quotation', 'gross_subtotal', 'double precision', 'YES'),
    ('quotation', 'product_discount_total', 'double precision', 'YES'),
    ('quotation', 'subtotal_after_product_discounts', 'double precision', 'YES'),
    ('quotation', 'overall_discount_type', 'text', 'YES'),
    ('quotation', 'overall_discount_value', 'double precision', 'YES'),
    ('quotation', 'overall_discount_amount', 'double precision', 'YES'),
    ('quotation', 'net_subtotal', 'double precision', 'YES'),
    ('quotation_item', 'actual_unit_price', 'double precision', 'YES'),
    ('quotation_item', 'discount_type', 'text', 'YES'),
    ('quotation_item', 'discount_value', 'double precision', 'YES'),
    ('quotation_item', 'product_discount_amount', 'double precision', 'YES'),
    ('quotation_item', 'after_product_discount_amount', 'double precision', 'YES'),
    ('quotation_item', 'overall_discount_allocated', 'double precision', 'YES'),
    ('quotation_item', 'final_unit_price', 'double precision', 'YES'),
    ('quotation_item', 'final_line_total', 'double precision', 'YES'),
    ('quotation_follow_up', 'follow_up_time', 'text', 'YES'),
    ('quotation_follow_up', 'priority', 'text', 'YES'),
    ('quotation_follow_up', 'firm_id', 'integer', 'YES'),
    ('quotation_follow_up', 'branch_id', 'integer', 'YES'),
    ('quotation_follow_up', 'company_id', 'integer', 'YES'),
    ('quotation_follow_up', 'sales_engineer_id', 'integer', 'YES'),
    ('purchase_order', 'supplier_id', 'integer', 'YES'),
    ('purchase_order', 'received_quantity', 'double precision', 'YES'),
    ('purchase_order', 'procurement_requirement_id', 'integer', 'YES'),
    ('company', 'is_supplier', 'integer', 'YES'),
    ('company', 'company_type', 'text', 'YES'),
    ('sales_engineer', 'branch_id', 'integer', 'YES'),
    ('engineer_sales_targets', 'branch_id', 'integer', 'YES')
  ),
  actual AS (
    SELECT table_name::text, column_name::text, data_type::text, is_nullable::text
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  )
  SELECT string_agg(
           format('%s.%s (expected %s %s, found %s)', e.table_name, e.column_name, e.data_type,
                  CASE e.is_nullable WHEN 'YES' THEN 'NULL' ELSE 'NOT NULL' END,
                  COALESCE(a.data_type || CASE a.is_nullable WHEN 'YES' THEN ' NULL' ELSE ' NOT NULL' END, 'missing')),
           '; ' ORDER BY e.table_name, e.column_name)
  INTO problems
  FROM expected e
  LEFT JOIN actual a ON a.table_name = e.table_name AND a.column_name = e.column_name
  WHERE a.data_type IS NULL OR a.data_type <> e.data_type OR a.is_nullable <> e.is_nullable;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 001 validation failed, nothing was applied: %', problems;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO problems
  FROM pg_class c
  WHERE c.oid IN (to_regclass('firm'), to_regclass('branch'), to_regclass('branch_document_settings'),
                  to_regclass('sale_report'), to_regclass('sale_report_item'), to_regclass('procurement_requirement'))
    AND NOT c.relrowsecurity;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 001 validation failed: row level security is off on %', problems;
  END IF;

  SELECT string_agg(DISTINCT g.grantee || ' on ' || g.table_name, ', ') INTO problems
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = current_schema()
    AND g.grantee IN ('anon', 'authenticated')
    AND g.table_name IN ('firm', 'branch', 'branch_document_settings', 'sale_report',
                         'sale_report_item', 'procurement_requirement');
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 001 validation failed: public API roles still have grants (%)', problems;
  END IF;
END $$;

COMMIT;
