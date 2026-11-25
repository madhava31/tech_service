import { Router } from 'express';
import db from '../db/index.js';
import { requireAdminFor } from '../auth/middleware.js';

const router = Router();

const EDITABLE_FIELDS = [
  'company_name', 'address', 'gstin', 'state', 'phone', 'landline', 'email',
  'logo_image', 'signature_image',
  'bank_name', 'bank_account_no', 'bank_ifsc', 'bank_account_holder',
  'quotation_validity_days', 'payment_terms', 'delivery_time',
  'quotation_prefix', 'po_prefix', 'pi_prefix',
  // Defaults for new quotations (migration 004). Skipped below until the columns exist.
  'default_advance_percent', 'default_payment_due_days',
];

router.get('/', async (req, res) => {
  try {
    const row = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
    // ?lite=1 leaves out the logo and signature images (data URIs of up to ~1 MB), for pages that only
    // need the defaults (tax %, validity, payment terms).
    if (row && req.query.lite === '1') {
      delete row.logo_image;
      delete row.signature_image;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.put('/', requireAdminFor('change the company settings'), async (req, res) => {
  try {
    const existing = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
    const merged = { ...existing };
    // Only columns this database has, so the page keeps working before a migration is applied.
    const fields = EDITABLE_FIELDS.filter((f) => f in existing);
    for (const f of fields) {
      if (req.body[f] !== undefined) merged[f] = req.body[f];
    }
    if ('default_advance_percent' in existing) {
      const adv = Number(merged.default_advance_percent);
      if (!Number.isFinite(adv) || adv < 0 || adv > 100) return res.status(400).json({ error: 'Default advance must be between 0% and 100%' });
      const days = Number(merged.default_payment_due_days);
      if (!Number.isInteger(days) || days < 0 || days > 365) return res.status(400).json({ error: 'Default payment due days must be a whole number from 0 to 365' });
    }
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await db
      .prepare(`UPDATE company_settings SET ${setClause} WHERE id = 1`)
      .run(...fields.map((f) => merged[f]));
    res.json(await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get());
  } catch (err) {
    res.status(500).json({ error: 'Unable to save settings. Please try again.' });
  }
});

export default router;
