import { Router } from 'express';
import db from '../db/index.js';
import { ensureSalesRequestSchema } from '../integration/requestSchema.js';

// Quotation requests from the sales app, for the staff who prepare quotations. Mounted behind sign-in at
// /api/sales-requests. Every signed-in user sees them: they are not a quotation of anyone's own.
const router = Router();

const COLUMNS = `id, sales_request_id, opportunity_code, opportunity_title, requested_by, salesperson,
  company_name, company_city, company_state, company_gstin, erp_company_id,
  contact_name, contact_phone, contact_email, oems, products, estimated_value, expected_close_date,
  notes, requested_at, received_at, status, handled_at, handled_note`;

router.use(async (req, res, next) => {
  try {
    await ensureSalesRequestSchema(db.pool);
    next();
  } catch (err) {
    console.error('Sales requests schema failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ?status=pending (default) | done | dismissed | all
router.get('/', async (req, res) => {
  try {
    const status = ['pending', 'done', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const where = status === 'all' ? '' : 'WHERE status = ?';
    const rows = await db
      .prepare(`SELECT ${COLUMNS} FROM sales_quotation_request ${where} ORDER BY received_at DESC, id DESC LIMIT 200`)
      .all(...(status === 'all' ? [] : [status]));
    res.json(rows);
  } catch (err) {
    console.error('Listing sales requests failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

async function handle(req, res, status) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid request id' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) || null : null;
    const row = await db
      .prepare(
        `UPDATE sales_quotation_request SET status = ?, handled_by = ?, handled_at = NOW(), handled_note = ?
         WHERE id = ? AND status = 'pending' RETURNING ${COLUMNS}`
      )
      .get(status, req.user?.id ?? null, note, id);
    if (!row) return res.status(409).json({ error: 'That request was not found, or has already been handled.' });
    res.json(row);
  } catch (err) {
    console.error('Handling a sales request failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

router.post('/:id/done', (req, res) => handle(req, res, 'done'));
router.post('/:id/dismiss', (req, res) => handle(req, res, 'dismissed'));

export default router;
