// Stops password guessing on POST /api/auth/login.
//
//  * Per account: 5 wrong passwords lock the account for 15 minutes (columns from migration 018, so it works across all
//    serverless instances). A correct password clears the count.
//  * Per address: an in-memory counter, so one address cannot try many usernames (best effort: each server instance has its own).
//
// Until migration 018 is applied the account lock is simply off and login works as before.
import db from '../db/index.js';
import { createFailLimiter } from '../export/liveExport.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export const loginIpLimiter = createFailLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

/** The caller's address (Express already applies "trust proxy" to req.ip). */
export const clientIp = (req) => String(req.ip || req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

let lockoutKnownReady = false;
/** True once app_user has the migration 018 columns. Only a positive answer is remembered, and a failed check means "no". */
export async function lockoutReady() {
  if (lockoutKnownReady) return true;
  try {
    const rows = await db
      .prepare(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'app_user' AND column_name IN ('failed_login_count', 'locked_until')`)
      .all();
    lockoutKnownReady = rows.length === 2;
  } catch {
    return false;
  }
  return lockoutKnownReady;
}
/** For tests. */
export const resetLockoutCache = () => { lockoutKnownReady = false; };

/** Whole minutes left on an account lock (0 when it is not locked). */
export function lockedMinutes(row, now = Date.now()) {
  if (!row?.locked_until) return 0;
  const left = new Date(row.locked_until).getTime() - now;
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

/** A wrong password: count it, and lock the account at the 5th. Never throws (a failure here must not hide the 401). */
export async function recordFailedLogin(userId) {
  try {
    if (!(await lockoutReady())) return;
    await db
      .prepare(
        `UPDATE app_user
            SET failed_login_count = CASE WHEN COALESCE(failed_login_count, 0) + 1 >= ? THEN 0 ELSE COALESCE(failed_login_count, 0) + 1 END,
                locked_until = CASE WHEN COALESCE(failed_login_count, 0) + 1 >= ? THEN NOW() + (? || ' minutes')::interval ELSE locked_until END
          WHERE id = ?`
      )
      .run(MAX_FAILED_LOGINS, MAX_FAILED_LOGINS, String(LOCK_MINUTES), userId);
  } catch (err) {
    console.warn('[auth] could not record a failed login:', err?.message);
  }
}

/** A correct password: clear the count and any finished lock. */
export async function recordSuccessfulLogin(row) {
  try {
    if (!row || (!Number(row.failed_login_count) && !row.locked_until)) return;
    await db.prepare(`UPDATE app_user SET failed_login_count = 0, locked_until = NULL WHERE id = ?`).run(row.id);
  } catch (err) {
    console.warn('[auth] could not clear the failed login count:', err?.message);
  }
}
