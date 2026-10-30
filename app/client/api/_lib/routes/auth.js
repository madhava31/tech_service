import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { getSessionUser } from '../auth/middleware.js';
import { sendRouteError } from '../http/errors.js';

const router = Router();
const SESSION_DAYS = 30;
const COOKIE_NAME = 'session';
const isProduction = process.env.NODE_ENV === 'production';

// Inserting the session row and setting the cookie are separate so a caller can insert inside a
// transaction and only set the cookie once it has committed (see PUT /password).
async function insertSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return token;
}

async function createSession(userId, res) {
  setSessionCookie(res, await insertSession(userId));
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // Frontend and API are same-origin in production (one Vercel deployment), so 'lax' is correct
    // and sufficient there — it's sent on top-level navigation and same-site requests, which
    // covers this app's actual traffic. 'none' was used previously on the theory that it "costs
    // nothing" same-origin, but combined with the CORS origin-reflection default it actually
    // widened the cookie's cross-site exposure for no functional benefit (Step 5.6 hardening).
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

router.get('/me', async (req, res) => {
  try {
    const userCount = (await db.prepare(`SELECT COUNT(*) c FROM app_user`).get()).c;
    if (Number(userCount) === 0) return res.json({ needsSetup: true });

    const user = await getSessionUser(req.cookies?.session);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to check authentication status. Please try again.');
  }
});

router.post('/setup', async (req, res) => {
  try {
    const userCount = (await db.prepare(`SELECT COUNT(*) c FROM app_user`).get()).c;
    if (Number(userCount) > 0) return res.status(403).json({ error: 'Setup already completed' });

    const { username, password } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { salt, hash } = hashPassword(password);
    const info = await db
      .prepare(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES (?, ?, ?, 'admin') RETURNING id`)
      .run(username.trim(), hash, salt);

    await createSession(info.lastInsertRowid, res);
    res.status(201).json({ user: { id: info.lastInsertRowid, username: username.trim(), role: 'admin' } });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to complete setup. Please try again.');
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const row = await db.prepare(`SELECT * FROM app_user WHERE username = ?`).get(username.trim());
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await createSession(row.id, res);
    res.json({ user: { id: row.id, username: row.username, role: row.role } });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to sign in. Please try again.');
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.session;
    if (token) await db.prepare(`DELETE FROM session WHERE token = ?`).run(token);
    res.clearCookie(COOKIE_NAME, { path: '/', secure: isProduction, sameSite: 'lax' });
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to sign out. Please try again.');
  }
});

// ---------- Account settings (the signed-in admin's own credentials) ----------
// The account is always the session's user: no user id is accepted from the browser. Both changes
// require the current password. Passwords and hashes are never logged or returned.
export const USERNAME_RULE = /^[A-Za-z0-9._@-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // scrypt is deliberately slow; cap the work an oversized input can cause

async function requireSignedInAdmin(req, res, next) {
  try {
    const user = await getSessionUser(req.cookies?.session);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can change account settings' });
    req.user = user;
    next();
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to verify authentication. Please try again.');
  }
}

/** The signed-in user's row, or null when the current password is wrong. */
async function verifyCurrentPassword(userId, currentPassword) {
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > PASSWORD_MAX) return null;
  const row = await db.prepare(`SELECT id, username, role, password_hash, password_salt FROM app_user WHERE id = ?`).get(userId);
  if (!row || !verifyPassword(currentPassword, row.password_salt, row.password_hash)) return null;
  return row;
}

router.put('/username', requireSignedInAdmin, async (req, res) => {
  const { newUsername, currentPassword } = req.body || {};
  const username = typeof newUsername === 'string' ? newUsername.trim() : '';
  if (!USERNAME_RULE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters: letters, digits, dot, underscore, hyphen or @' });
  }
  try {
    const row = await verifyCurrentPassword(req.user.id, currentPassword);
    if (!row) return res.status(401).json({ error: 'Current password is incorrect' });
    if (username === row.username) return res.status(400).json({ error: 'That is already your username' });
    // Case-insensitive: "Admin" and "admin" would be confusing as two accounts. The UNIQUE
    // constraint on app_user.username still catches an exact-match race below.
    const taken = await db.prepare(`SELECT 1 FROM app_user WHERE LOWER(username) = LOWER(?) AND id <> ?`).get(username, row.id);
    if (taken) return res.status(409).json({ error: 'That username is already taken' });
    await db.prepare(`UPDATE app_user SET username = ? WHERE id = ?`).run(username, row.id);
    res.json({ user: { id: row.id, username, role: row.role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    sendRouteError(res, err, 500, 'Unable to change the username. Please try again.');
  }
});

router.put('/password', requireSignedInAdmin, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return res.status(400).json({ error: `New password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` });
  }
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New password and confirmation do not match' });
  try {
    const row = await verifyCurrentPassword(req.user.id, currentPassword);
    if (!row) return res.status(401).json({ error: 'Current password is incorrect' });
    if (verifyPassword(newPassword, row.password_salt, row.password_hash)) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }
    const { salt, hash } = hashPassword(newPassword);
    // All or nothing: new hash, every existing session (other devices included) revoked, and a
    // fresh session for this browser. The cookie is set only after the transaction commits.
    const token = await db.transaction(async () => {
      await db.prepare(`UPDATE app_user SET password_hash = ?, password_salt = ? WHERE id = ?`).run(hash, salt, row.id);
      await db.prepare(`DELETE FROM session WHERE user_id = ?`).run(row.id);
      return insertSession(row.id);
    });
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to change the password. Please try again.');
  }
});

export default router;
