import db from '../db/index.js';
import { sendRouteError } from '../http/errors.js';

export async function getSessionUser(token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.role, s.expires_at
       FROM session s JOIN app_user u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare(`DELETE FROM session WHERE token = ?`).run(token);
    return null;
  }
  return { id: row.id, username: row.username, role: row.role };
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.session;
    const user = await getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    // getSessionUser's DB lookup is unguarded on purpose (it's a plain query, matching every other
    // helper in this codebase) — but as Express middleware, an unhandled rejection here would
    // bypass every route's own try/catch entirely (Express 4 doesn't catch async middleware
    // rejections) and could crash the whole process outright (observed locally when Postgres was
    // paused mid-request during Step 5.5 testing). Fails CLOSED: no `req.user` is ever set and
    // `next()` is never called, so a DB outage can never be mistaken for "authenticated".
    // The real error is logged server-side only; the client gets the generic message.
    sendRouteError(res, err, 500, 'Unable to verify authentication. Please try again.');
  }
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}
