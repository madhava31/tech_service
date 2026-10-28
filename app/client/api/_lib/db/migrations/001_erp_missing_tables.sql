-- Migration 001: tables and columns used by the Sales, Sale Reports, Firms/Branches, Procurement
-- and Search code that were never added to the Postgres schema.
--
-- Run manually (Supabase SQL Editor) after review. It is idempotent: every statement is
-- IF NOT EXISTS, so it is safe on a database that already has some or all of these objects,
-- and it runs in one transaction, so it either applies completely or not at all.
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

COMMIT;
