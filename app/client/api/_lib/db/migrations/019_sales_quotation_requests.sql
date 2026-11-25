-- Quotation requests from the Technicon Sales app. The same definition as SALES_REQUESTS_DDL in
-- app/client/api/_lib/integration/requestSchema.js, which makes the table the first time it is needed; this file
-- is for the record, and is safe to run if the table already exists.
CREATE TABLE IF NOT EXISTS sales_quotation_request (
  id SERIAL PRIMARY KEY,
  sales_request_id INTEGER NOT NULL UNIQUE,
  opportunity_code TEXT NOT NULL,
  opportunity_title TEXT,
  requested_by TEXT NOT NULL,
  salesperson TEXT,
  company_name TEXT NOT NULL,
  company_city TEXT,
  company_state TEXT,
  company_address TEXT,
  company_gstin TEXT,
  erp_company_id INTEGER,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  oems JSONB NOT NULL DEFAULT '[]',
  products JSONB NOT NULL DEFAULT '[]',
  estimated_value NUMERIC(14, 2),
  expected_close_date DATE,
  notes TEXT,
  requested_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dismissed')),
  handled_by INTEGER,
  handled_at TIMESTAMPTZ,
  handled_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_quotation_request_status ON sales_quotation_request (status, received_at DESC);

ALTER TABLE sales_quotation_request ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE sales_quotation_request FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE sales_quotation_request_id_seq FROM anon, authenticated';
  END IF;
END $$;
