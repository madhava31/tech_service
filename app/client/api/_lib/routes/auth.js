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

async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
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

export default router;
