-- Migration 004: contact persons per company, advance % and payment tracking per quotation.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migrations 001 to 003.
-- It runs as a single transaction, so it applies completely or not at all.
-- It is additive: it creates new tables and new columns. The only change to existing data is the backfill below.
--
--   * company_contact holds the contact persons of a company. Each quotation picks one, or adds a new one.
--     Adding a contact never changes an existing one.
--     Backfill: each company's current contact_person/phone/email is copied in as its first contact.
--   * The new quotation columns snapshot the chosen contact (contact_id, contact_person, contact_phone,
--     contact_email) and hold the payment terms:
--       advance_percent: default 100. The advance is due payment_due_days after the PO date.
--       payment_due_days: default 30. The balance is due payment_due_days after the PI date.
--   * quotation_payment holds the payments received against a quotation.
--   * company_settings gets defaults for new quotations: default_advance_percent and default_payment_due_days.
--
-- Security: the new tables get row level security with no policies, and the anon and authenticated
-- roles lose their grants, as in migrations 001 to 003. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company', 'quotation', 'company_settings', 'app_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 004 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS company_contact (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_contact_company ON company_contact(company_id);
-- One row per person and number in a company, so the same contact is never saved twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_contact_person
  ON company_contact (company_id, lower(btrim(name)), coalesce(btrim(phone), ''));

INSERT INTO company_contact (company_id, name, phone, email)
SELECT c.id, btrim(c.contact_person), NULLIF(btrim(c.phone), ''), NULLIF(btrim(c.email), '')
FROM company c
WHERE NULLIF(btrim(c.contact_person), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM company_contact cc WHERE cc.company_id = c.id);

ALTER TABLE quotation ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES company_contact(id) ON DELETE SET NULL;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS advance_percent NUMERIC(5, 2) NOT NULL DEFAULT 100
  CONSTRAINT quotation_advance_percent_range CHECK (advance_percent >= 0 AND advance_percent <= 100);
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS payment_due_days INTEGER NOT NULL DEFAULT 30
  CONSTRAINT quotation_payment_due_days_range CHECK (payment_due_days >= 0 AND payment_due_days <= 365);
CREATE INDEX IF NOT EXISTS idx_quotation_contact ON quotation(contact_id);

CREATE TABLE IF NOT EXISTS quotation_payment (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  mode TEXT,
  reference TEXT,
  note TEXT,
  created_by_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotation_payment_quotation ON quotation_payment(quotation_id);

ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_advance_percent NUMERIC(5, 2) NOT NULL DEFAULT 100
  CONSTRAINT company_settings_default_advance_range CHECK (default_advance_percent >= 0 AND default_advance_percent <= 100);
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_payment_due_days INTEGER NOT NULL DEFAULT 30
  CONSTRAINT company_settings_default_due_days_range CHECK (default_payment_due_days >= 0 AND default_payment_due_days <= 365);

ALTER TABLE company_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_payment ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON company_contact, quotation_payment FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE company_contact_id_seq, quotation_payment_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Validation. IF NOT EXISTS would silently keep an older hand-made table or column with the same
-- name, so check that every column has the expected type and nullability.
DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s %s, have %s %s)', e.t, e.c, e.typ, e.nul,
                           coalesce(c.data_type, 'missing'), coalesce(c.is_nullable, '-')), '; ')
    INTO problems
  FROM (VALUES
    ('company_contact', 'company_id', 'integer', 'NO'),
    ('company_contact', 'name', 'text', 'NO'),
    ('company_contact', 'phone', 'text', 'YES'),
    ('company_contact', 'email', 'text', 'YES'),
    ('company_contact', 'created_by_user_id', 'integer', 'YES'),
    ('quotation', 'contact_person', 'text', 'YES'),
    ('quotation', 'contact_id', 'integer', 'YES'),
    ('quotation', 'contact_phone', 'text', 'YES'),
    ('quotation', 'contact_email', 'text', 'YES'),
    ('quotation', 'advance_percent', 'numeric', 'NO'),
    ('quotation', 'payment_due_days', 'integer', 'NO'),
    ('quotation_payment', 'quotation_id', 'integer', 'NO'),
    ('quotation_payment', 'amount', 'numeric', 'NO'),
    ('quotation_payment', 'paid_on', 'date', 'NO'),
    ('quotation_payment', 'mode', 'text', 'YES'),
    ('quotation_payment', 'reference', 'text', 'YES'),
    ('quotation_payment', 'note', 'text', 'YES'),
    ('quotation_payment', 'created_by_user_id', 'integer', 'YES'),
    ('company_settings', 'default_advance_percent', 'numeric', 'NO'),
    ('company_settings', 'default_payment_due_days', 'integer', 'NO')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.column_name IS NULL OR c.data_type <> e.typ OR c.is_nullable <> e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 004 validation failed, nothing was applied: %', problems;
  END IF;
  SELECT string_agg(relname, ', ') INTO problems FROM pg_class
   WHERE relname IN ('company_contact', 'quotation_payment') AND NOT relrowsecurity;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 004 validation failed: row level security is off on %', problems;
  END IF;
END $$;

COMMIT;
