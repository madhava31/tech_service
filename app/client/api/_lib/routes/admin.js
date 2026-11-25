import { Router } from 'express';
import db from '../db/index.js';
import { requireAdmin } from '../auth/middleware.js';
import { USERNAME_RULE, PASSWORD_MIN, PASSWORD_MAX } from './auth.js';
import { hashPassword } from '../auth/password.js';
import { createBackupHandler } from '../backup/dataBackup.js';

const router = Router();
router.use(requireAdmin);

// ---------- Stats ----------

router.get('/stats', async (req, res) => {
  try {
    const tables = ['company', 'product', 'quotation', 'purchase_order', 'performa_invoice', 'sales_record', 'import_batch', 'app_user'];
    const counts = {};
    for (const t of tables) counts[t === 'app_user' ? 'user' : t] = (await db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c;
    // The size of the whole database (0 if the database will not say).
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = Number((await db.prepare(`SELECT pg_database_size(current_database()) AS size`).get())?.size) || 0;
    } catch {
      dbSizeBytes = 0;
    }
    res.json({ counts, dbSizeBytes });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Data backup (every table in one Excel file; admin only through router.use above) ----------

router.get('/backup', createBackupHandler({ db }));

// ---------- Import batches ----------

router.delete('/imports/:id', async (req, res) => {
  try {
    const batch = await db.prepare(`SELECT * FROM import_batch WHERE id = ?`).get(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Import batch not found' });

    await db.transaction(async () => {
      await db.prepare(`DELETE FROM sales_record WHERE import_batch_id = ?`).run(req.params.id);
      await db.prepare(`DELETE FROM import_batch WHERE id = ?`).run(req.params.id);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Companies / Products ----------

router.delete('/companies/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const salesCount = (await db.prepare(`SELECT COUNT(*) c FROM sales_record WHERE company_id = ?`).get(id)).c;
    const quotationCount = (await db.prepare(`SELECT COUNT(*) c FROM quotation WHERE company_id = ?`).get(id)).c;
    if (salesCount > 0 || quotationCount > 0) {
      return res.status(409).json({
        error: `Cannot delete: still referenced by ${quotationCount} quotation(s) and ${salesCount} sales record(s).`,
      });
    }
    const info = await db.prepare(`DELETE FROM company WHERE id = ?`).run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const itemCount = (await db.prepare(`SELECT COUNT(*) c FROM quotation_item WHERE product_id = ?`).get(id)).c;
    if (itemCount > 0) {
      return res.status(409).json({ error: `Cannot delete: used in ${itemCount} quotation line item(s).` });
    }
    const info = await db.prepare(`DELETE FROM product WHERE id = ?`).run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Review queue ----------

router.post('/review-queue/:id/dismiss', async (req, res) => {
  try {
    const info = await db.prepare(`UPDATE sales_record SET review_dismissed = 1 WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.delete('/review-queue/:id', async (req, res) => {
  try {
    const info = await db.prepare(`DELETE FROM sales_record WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Configuration ----------

router.get('/config', async (req, res) => {
  try {
    const row = await db.prepare(`SELECT default_tax_percent, default_lapse_months FROM company_settings WHERE id = 1`).get();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.put('/config', async (req, res) => {
  try {
    const existing = await db.prepare(`SELECT default_tax_percent, default_lapse_months FROM company_settings WHERE id = 1`).get();
    const default_tax_percent = req.body.default_tax_percent ?? existing.default_tax_percent;
    const default_lapse_months = req.body.default_lapse_months ?? existing.default_lapse_months;
    await db.prepare(`UPDATE company_settings SET default_tax_percent = ?, default_lapse_months = ? WHERE id = 1`).run(
      default_tax_percent,
      default_lapse_months
    );
    res.json({ default_tax_percent, default_lapse_months });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Users ----------

router.get('/users', async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT id, username, role, created_at FROM app_user ORDER BY id`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RULE.test(username.trim())) {
      return res.status(400).json({ error: 'Username must be 3-32 characters: letters, digits, dot, underscore, hyphen or @' });
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` });
    }
    const finalRole = role === 'admin' ? 'admin' : 'staff';

    const { salt, hash } = hashPassword(password);
    const info = await db
      .prepare(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?) RETURNING id`)
      .run(username.trim(), hash, salt, finalRole);
    res.status(201).json({ id: info.lastInsertRowid, username: username.trim(), role: finalRole });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

    const target = await db.prepare(`SELECT * FROM app_user WHERE id = ?`).get(id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'admin') {
      const adminCount = (await db.prepare(`SELECT COUNT(*) c FROM app_user WHERE role = 'admin'`).get()).c;
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining admin' });
    }

    // quotation_follow_up.created_by/completed_by have no ON DELETE clause (RESTRICT) so the audit
    // trail can't be deleted out from under it — without this check the DB would still block the
    // delete, just via an unhandled 500 with a raw constraint-violation message instead of a clean,
    // actionable error.
    const followUpCount = (
      await db.prepare(`SELECT COUNT(*) c FROM quotation_follow_up WHERE created_by = ? OR completed_by = ?`).get(id, id)
    ).c;
    if (followUpCount > 0) {
      return res.status(409).json({ error: `Cannot delete: still referenced by ${followUpCount} quotation follow-up record(s).` });
    }

    await db.prepare(`DELETE FROM app_user WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` });
    }

    const target = await db.prepare(`SELECT * FROM app_user WHERE id = ?`).get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { salt, hash } = hashPassword(password);
    await db.prepare(`UPDATE app_user SET password_hash = ?, password_salt = ? WHERE id = ?`).run(hash, salt, req.params.id);
    await db.prepare(`DELETE FROM session WHERE user_id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
