-- Migration 007: audit log of quotation emails.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 004 (app_user and quotation
-- must exist). It runs as a single transaction and only creates a new table, so nothing existing changes.
--
-- quotation_email_log has one row per attempt to email a quotation PDF from the ERP:
--   status  PENDING             the row is written just before the provider is called
--           SIMULATED_NOT_SENT  the mock provider accepted the message; NO email was sent
--           SENT                a real provider accepted the message (a provider that is not connected yet)
--           FAILED              the provider refused or errored; error_message says why (short, no secrets)
-- The message body and the PDF are NOT stored here.
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as
-- in migrations 001 to 006. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation', 'app_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 007 needs table "%" first (base schema).', t;
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS quotation_email_log (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  sent_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  cc TEXT,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL
    CONSTRAINT quotation_email_log_status_check CHECK (status IN ('PENDING', 'SIMULATED_NOT_SENT', 'SENT', 'FAILED')),
  provider_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotation_email_log_quotation ON quotation_email_log(quotation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_email_log_sent_by ON quotation_email_log(sent_by);

ALTER TABLE quotation_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE quotation_email_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE quotation_email_log_id_seq FROM anon, authenticated;

DO $$
DECLARE problems text;
BEGIN
  SELECT string_agg(format('%s.%s (want %s, have %s)', e.t, e.c, e.typ, coalesce(c.data_type, 'missing')), '; ')
    INTO problems
  FROM (VALUES
    ('quotation_email_log', 'id', 'integer'),
    ('quotation_email_log', 'quotation_id', 'integer'),
    ('quotation_email_log', 'sent_by', 'integer'),
    ('quotation_email_log', 'recipient', 'text'),
    ('quotation_email_log', 'cc', 'text'),
    ('quotation_email_log', 'subject', 'text'),
    ('quotation_email_log', 'provider', 'text'),
    ('quotation_email_log', 'status', 'text'),
    ('quotation_email_log', 'provider_message_id', 'text'),
    ('quotation_email_log', 'error_message', 'text'),
    ('quotation_email_log', 'created_at', 'timestamp without time zone')
  ) AS e(t, c, typ)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 007 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
