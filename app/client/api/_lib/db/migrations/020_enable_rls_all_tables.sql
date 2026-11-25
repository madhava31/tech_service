-- Migration 020 (recommended): turn on row level security for every table in the public schema.
--
-- Why: Supabase's security advisor reports "RLS Disabled in Public" (critical) for the tables created before migration 008
-- (company, product, app_user, session, sales_record, ...). With RLS off, anyone holding the project's public "anon" key
-- could read and change those tables through Supabase's own REST API, including app_user (password hashes) and session
-- (login tokens). The ERP does not use that API: it connects straight to Postgres (DATABASE_URL), as the table owner,
-- and the owner is not affected by RLS. The tables added since migration 008 already work exactly this way.
--
-- What it does (no data is touched):
--   1. enables RLS on every public table that does not have it (no policy is added, so the API roles get no rows);
--   2. takes away every right of the API roles "anon" and "authenticated" on those tables and their sequences;
--   3. makes tables created in future start without API access;
--   4. stops with an error if a table is still open, so the result is never silently incomplete.
--
-- Run it by hand in the Supabase SQL Editor, then open the ERP and click through a few pages (quotations, products,
-- stock). If something does not load, re-run the advisor and tell Claude which table: the undo for one table is
--   ALTER TABLE <name> DISABLE ROW LEVEL SECURITY;
-- Running it twice is harmless.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  t record;
  s record;
  role_name text;
BEGIN
  -- 1 and 2: every ordinary table in the public schema.
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t.relname, role_name);
      END IF;
    END LOOP;
  END LOOP;

  -- The id counters of those tables.
  FOR s IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', s.relname, role_name);
      END IF;
    END LOOP;
  END LOOP;

  -- 3: tables and sequences created from now on by this role start closed to the API roles.
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- 4: verify. Any public table still without RLS fails the whole migration (nothing is applied).
DO $$
DECLARE still_open text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO still_open
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF still_open IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 020 validation failed: RLS is still off for: %', still_open;
  END IF;
END $$;

COMMIT;
