-- Migration 018 (optional, recommended): lock an account for 15 minutes after 5 wrong passwords.
--
-- Run it by hand in the Supabase SQL Editor. Login works without it (the lock is simply off until it runs). It only adds
-- two columns to app_user: failed_login_count (wrong passwords in a row) and locked_until (when the lock ends).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

COMMIT;
