-- Migration 009: private keys for the live Excel link.
--
-- Run it by hand in the Supabase SQL Editor, after review and after migration 004 (app_user must exist).
-- It runs as a single transaction and only creates a new table, so nothing existing changes.
--
-- A user can create a key in the ERP (Quotations > Export to Excel > Live link). The key goes into a link that
-- Excel's "Get Data > From Web" reads, so the sheet refreshes from the ERP without the ERP login. Only a SHA-256
-- hash of the key is stored: the key itself is shown once, when it is created, and cannot be recovered.
--   * key_hash      SHA-256 (hex) of the key; unique, used to look the key up.
--   * key_hint      the first characters of the key, so a user can tell their keys apart. Not enough to use it.
--   * revoked_at    set when the user revokes the key; a revoked key stops working at once.
--   * last_used_at  when Excel last fetched with it (updated at most once a minute).
--
-- Security: row level security on, no policies, and the anon and authenticated roles lose their grants, as in
-- migrations 001 to 008. The backend connects as postgres, which has BYPASSRLS.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('app_user') IS NULL THEN
    RAISE EXCEPTION 'Migration 009 needs table "app_user" first (base schema).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS export_api_key (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_export_api_key_user ON export_api_key(user_id);

ALTER TABLE export_api_key ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON export_api_key FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE export_api_key_id_seq FROM %I', r);
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
    ('export_api_key', 'id', 'integer', 'NO'),
    ('export_api_key', 'user_id', 'integer', 'NO'),
    ('export_api_key', 'label', 'text', 'NO'),
    ('export_api_key', 'key_hash', 'text', 'NO'),
    ('export_api_key', 'key_hint', 'text', 'NO'),
    ('export_api_key', 'created_at', 'timestamp without time zone', 'NO'),
    ('export_api_key', 'last_used_at', 'timestamp without time zone', 'YES'),
    ('export_api_key', 'revoked_at', 'timestamp without time zone', 'YES')
  ) AS e(t, c, typ, nul)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = current_schema() AND c.table_name = e.t AND c.column_name = e.c
  WHERE c.data_type IS DISTINCT FROM e.typ OR c.is_nullable IS DISTINCT FROM e.nul;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 009 validation failed: %', problems;
  END IF;
END $$;

COMMIT;
