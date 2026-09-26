CREATE TABLE IF NOT EXISTS company (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  state TEXT,
  gstin TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product (
  id SERIAL PRIMARY KEY,
  part_no TEXT NOT NULL UNIQUE,
  hsn_sac TEXT,
  description TEXT NOT NULL,
  unit TEXT DEFAULT 'Nos',
  default_price DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batch (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  year_label TEXT,
  imported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_duplicate_count INTEGER NOT NULL DEFAULT 0,
  flagged_count INTEGER NOT NULL DEFAULT 0,
  companies_added INTEGER NOT NULL DEFAULT 0,
  products_added INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_record (
  id SERIAL PRIMARY KEY,
  sale_date DATE,
  invoice_no TEXT,
  company_name TEXT,
  company_id INTEGER REFERENCES company(id),
  po_no TEXT,
  state TEXT,
  hsn_sac TEXT,
  part_no TEXT,
  product_description TEXT,
  price DOUBLE PRECISION,
  qty DOUBLE PRECISION,
  total_amount DOUBLE PRECISION,
  needs_review INTEGER NOT NULL DEFAULT 0,
  review_reason TEXT,
  review_dismissed INTEGER NOT NULL DEFAULT 0,
  import_batch_id INTEGER REFERENCES import_batch(id)
);

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'TECHNICON SERVICES',
  address TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  state TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  landline TEXT DEFAULT '',
  email TEXT DEFAULT '',
  -- Stored as base64 data URIs (not file paths) since the app targets a serverless deploy with
  -- no persistent local disk — embedding the bytes directly in Postgres avoids needing separate
  -- object storage for two small images.
  logo_image TEXT DEFAULT '',
  signature_image TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  bank_account_no TEXT DEFAULT '',
  bank_ifsc TEXT DEFAULT '',
  bank_account_holder TEXT DEFAULT '',
  quotation_validity_days INTEGER DEFAULT 15,
  payment_terms TEXT DEFAULT '',
  delivery_time TEXT DEFAULT '',
  quotation_prefix TEXT DEFAULT 'QTN',
  po_prefix TEXT DEFAULT 'PO',
  pi_prefix TEXT DEFAULT 'PI',
  default_tax_percent DOUBLE PRECISION NOT NULL DEFAULT 18,
  default_lapse_months INTEGER NOT NULL DEFAULT 12
);

INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Named app_user (not "user") to sidestep any ambiguity with Postgres's reserved USER/CURRENT_USER keyword.
CREATE TABLE IF NOT EXISTS app_user (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  company_id INTEGER NOT NULL REFERENCES company(id),
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_type TEXT DEFAULT 'percentage',
  discount_value DOUBLE PRECISION DEFAULT 0,
  discount_percent DOUBLE PRECISION DEFAULT 0,
  discount_amount DOUBLE PRECISION DEFAULT 0,
  taxable_amount DOUBLE PRECISION DEFAULT 0,
  tax_percent DOUBLE PRECISION NOT NULL DEFAULT 18,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  round_off DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by_user_id INTEGER REFERENCES app_user(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_item (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES product(id),
  part_no TEXT,
  description TEXT NOT NULL,
  hsn_sac TEXT,
  make TEXT,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_order (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id),
  client_po_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performa_invoice (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id),
  purchase_order_id INTEGER REFERENCES purchase_order(id),
  status TEXT NOT NULL DEFAULT 'issued',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_company ON sales_record(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_part ON sales_record(part_no);
CREATE INDEX IF NOT EXISTS idx_quotation_company ON quotation(company_id);

-- Step 4.1: quotation follow-up history. One row per scheduled/completed/cancelled follow-up;
-- a quotation can have many rows here (nothing is ever overwritten, so history is preserved).
-- created_by/completed_by intentionally have no ON DELETE clause (defaults to RESTRICT) so a
-- user with follow-up history attached can't be deleted out from under the audit trail.
CREATE TABLE IF NOT EXISTS quotation_follow_up (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  follow_up_date DATE NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  completed_by INTEGER REFERENCES app_user(id),
  outcome TEXT,
  outcome_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_follow_up_quotation ON quotation_follow_up(quotation_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_date_status ON quotation_follow_up(follow_up_date, status);
