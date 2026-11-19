// Live Excel link: private per-user keys and the read-only feed Excel refreshes from.
//
//   POST   /api/export/keys          (signed in)  create a key; the key is returned ONCE, only its hash is stored
//   GET    /api/export/keys          (signed in)  the user's own keys (never the key itself)
//   DELETE /api/export/keys/:id      (signed in)  revoke a key; it stops working at once
//   DELETE /api/export/keys/:id/permanent (signed in)  delete a key that is already revoked, so it leaves the list
//   DELETE /api/export/keys/revoked  (signed in)  delete all of the user's revoked keys
//   GET    /api/export/live/quotations.xlsx?key=...&columns=...   the feed: key only, no login cookie, read only
//
// The table comes from migration 009; until it is applied every route here answers 503 MIGRATION_REQUIRED.
import crypto from 'node:crypto';
import { Router } from 'express';
import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';
import { sendRouteError } from '../http/errors.js';
import { buildQuotationExport, sendExcelResponse } from '../routes/export.js';

export const KEY_COLUMNS = { export_api_key: ['id', 'user_id', 'label', 'key_hash', 'key_hint', 'created_at', 'last_used_at', 'revoked_at'] };
export const requireExportKeys = createSchemaGuard(KEY_COLUMNS, 'Live Excel link', 'Something went wrong. Please try again.', '009');

export const MAX_ACTIVE_KEYS = 5;
const KEY_SHAPE = /^tsl_[A-Za-z0-9_-]{43}$/;

/** A new random key: "tsl_" + 32 random bytes (256 bits) as base64url. */
export const generateKey = () => `tsl_${crypto.randomBytes(32).toString('base64url')}`;
/** Keys are random, so a plain SHA-256 is enough to store them safely. */
export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
export const keyHint = (key) => `${String(key).slice(0, 8)}…`;

/** Counts failed key attempts per client address, so the feed cannot be used to guess keys. */
export function createFailLimiter({ max = 20, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const fails = new Map();
  const recent = (ip) => (fails.get(ip) || []).filter((t) => now() - t < windowMs);
  return {
    blocked: (ip) => recent(ip).length >= max,
    fail(ip) { const r = recent(ip); r.push(now()); fails.set(ip, r); },
  };
}

// ---------- handlers, built from their dependencies so tests can use fakes ----------

export function createFeedHandler({ store, build, send, limiter }) {
  return async function feed(req, res) {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
    res.setHeader('Cache-Control', 'no-store');
    if (limiter.blocked(ip)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    const refuse = () => { limiter.fail(ip); return res.status(401).json({ error: 'Invalid or revoked key' }); };
    if (!KEY_SHAPE.test(key)) return refuse();
    try {
      const row = await store.findActive(hashKey(key));
      if (!row) return refuse();
      store.touch(row.id).catch(() => {});
      // The key carries its owner's permissions: admins see every quotation, other users only their own.
      const scope = { ...(row.role === 'admin' ? {} : { createdByUserId: row.user_id }), clean: true };
      const { key: _ignored, ...query } = req.query;
      const { buffer, filename } = await build(query, scope);
      send(res, buffer, filename);
    } catch (err) {
      console.error('Live export failed:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

export function createKeyHandlers({ store }) {
  const isId = (v) => /^\d{1,9}$/.test(String(v)) && Number(v) > 0;
  return {
    async list(req, res) {
      try {
        res.json({ keys: await store.list(req.user.id), max_active: MAX_ACTIVE_KEYS });
      } catch (err) {
        sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
      }
    },
    async create(req, res) {
      try {
        const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
        // eslint-disable-next-line no-control-regex
        if (!label || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label)) return res.status(400).json({ error: 'Give the key a name of up to 60 characters, for example "My laptop"' });
        if ((await store.countActive(req.user.id)) >= MAX_ACTIVE_KEYS) return res.status(409).json({ error: `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` });
        const key = generateKey();
        const row = await store.create({ userId: req.user.id, label, hash: hashKey(key), hint: keyHint(key) });
        res.status(201).json({ id: row.id, label, hint: keyHint(key), key, created_at: row.created_at });
      } catch (err) {
        sendRouteError(res, err, 500, 'Unable to create the key. Please try again.');
      }
    },
    // Removes a revoked key from the list for good. An active key cannot be deleted: revoke it first.
    async purge(req, res) {
      try {
        if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid key id' });
        const done = await store.purge(Number(req.params.id), req.user.id, req.user.role === 'admin');
        if (!done) return res.status(404).json({ error: 'Key not found, or it is still active. Revoke it first.' });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 500, 'Unable to delete the key. Please try again.');
      }
    },
    async purgeRevoked(req, res) {
      try {
        res.json({ ok: true, deleted: await store.purgeRevoked(req.user.id) });
      } catch (err) {
        sendRouteError(res, err, 500, 'Unable to delete the revoked keys. Please try again.');
      }
    },
    async revoke(req, res) {
      try {
        if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid key id' });
        const done = await store.revoke(Number(req.params.id), req.user.id, req.user.role === 'admin');
        if (!done) return res.status(404).json({ error: 'Key not found' });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 500, 'Unable to revoke the key. Please try again.');
      }
    },
  };
}

// ---------- the real store (database) ----------
const dbStore = {
  findActive: (hash) =>
    db.prepare(`SELECT k.id, k.user_id, u.role FROM export_api_key k JOIN app_user u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL`).get(hash),
  async touch(id) {
    await db.prepare(`UPDATE export_api_key SET last_used_at = NOW() WHERE id = ? AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')`).run(id);
  },
  list: (userId) => db.prepare(`SELECT id, label, key_hint AS hint, created_at, last_used_at, revoked_at FROM export_api_key WHERE user_id = ? ORDER BY id DESC`).all(userId),
  async countActive(userId) {
    return Number((await db.prepare(`SELECT COUNT(*) AS n FROM export_api_key WHERE user_id = ? AND revoked_at IS NULL`).get(userId)).n);
  },
  async create({ userId, label, hash, hint }) {
    const info = await db.prepare(`INSERT INTO export_api_key (user_id, label, key_hash, key_hint) VALUES (?, ?, ?, ?) RETURNING id, created_at`).run(userId, label, hash, hint);
    return { id: info.lastInsertRowid, created_at: new Date().toISOString() };
  },
  async revoke(id, userId, isAdmin) {
    const r = isAdmin
      ? await db.prepare(`UPDATE export_api_key SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`).run(id)
      : await db.prepare(`UPDATE export_api_key SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(id, userId);
    return r.changes > 0;
  },
  // Only a key that is already revoked can be deleted, so a working link is never removed by accident.
  async purge(id, userId, isAdmin) {
    const r = isAdmin
      ? await db.prepare(`DELETE FROM export_api_key WHERE id = ? AND revoked_at IS NOT NULL`).run(id)
      : await db.prepare(`DELETE FROM export_api_key WHERE id = ? AND user_id = ? AND revoked_at IS NOT NULL`).run(id, userId);
    return r.changes > 0;
  },
  async purgeRevoked(userId) {
    const r = await db.prepare(`DELETE FROM export_api_key WHERE user_id = ? AND revoked_at IS NOT NULL`).run(userId);
    return r.changes;
  },
};

// Mounted in app/api/index.js: the feed WITHOUT requireAuth (the key is the credential), the key routes WITH it.
export const liveFeedRouter = Router();
liveFeedRouter.get(
  '/quotations.xlsx',
  requireExportKeys,
  createFeedHandler({ store: dbStore, build: buildQuotationExport, send: sendExcelResponse, limiter: createFailLimiter() })
);

export const keysRouter = Router();
const handlers = createKeyHandlers({ store: dbStore });
keysRouter.use(requireExportKeys);
keysRouter.get('/', handlers.list);
keysRouter.post('/', handlers.create);
// '/revoked' is declared before '/:id' so it is not read as an id.
keysRouter.delete('/revoked', handlers.purgeRevoked);
keysRouter.delete('/:id/permanent', handlers.purge);
keysRouter.delete('/:id', handlers.revoke);
