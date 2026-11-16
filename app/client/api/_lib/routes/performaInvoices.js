import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamPerformaInvoicePdf } from '../pdf/documents.js';

const router = Router();

async function fullPI(id) {
  const pi = await db
    .prepare(
      `SELECT pi.*, q.number AS quotation_number, q.subtotal, q.tax_percent, q.tax_amount, q.total,
              po.number AS po_number, po.client_po_ref,
              c.name AS company_name, c.address AS company_address, c.state AS company_state,
              c.gstin AS company_gstin, c.phone AS company_phone, u.username AS created_by_username,
              -- Contact and payment terms chosen on the quotation (migration 004); NULL before it is applied.
              to_jsonb(q) ->> 'contact_person' AS contact_person, to_jsonb(q) ->> 'contact_phone' AS contact_phone,
              to_jsonb(q) ->> 'contact_email' AS contact_email, to_jsonb(q) ->> 'advance_percent' AS advance_percent,
              to_jsonb(q) ->> 'payment_due_days' AS payment_due_days
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.id = pi.purchase_order_id
       LEFT JOIN app_user u ON u.id = q.created_by_user_id
       WHERE pi.id = ?`
    )
    .get(id);
  if (!pi) return null;
  const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(pi.quotation_id);
  return { pi, items };
}

router.get('/', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT pi.*, q.number AS quotation_number, q.total, c.name AS company_name
         FROM performa_invoice pi
         JOIN quotation q ON q.id = pi.quotation_id
         JOIN company c ON c.id = q.company_id
         ORDER BY pi.id DESC`
      )
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await fullPI(req.params.id);
    if (!result) return res.status(404).json({ error: 'Performa invoice not found' });
    res.json({ ...result.pi, items: result.items });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { quotation_id, purchase_order_id, date } = req.body;
    if (!quotation_id) return res.status(400).json({ error: 'quotation_id is required' });
    const quotation = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotation_id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const prefix = (await db.prepare(`SELECT pi_prefix FROM company_settings WHERE id = 1`).get()).pi_prefix;
    const number = await nextNumber(prefix, 'performa_invoice');
    const info = await db
      .prepare(`INSERT INTO performa_invoice (number, date, quotation_id, purchase_order_id) VALUES (?, ?, ?, ?) RETURNING id`)
      .run(number, date || new Date().toISOString().slice(0, 10), quotation_id, purchase_order_id || null);

    const row = await db.prepare(`SELECT * FROM performa_invoice WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to create the performa invoice. Please try again.' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const result = await fullPI(req.params.id);
    if (!result) return res.status(404).json({ error: 'Performa invoice not found' });
    const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.pi.number.replace(/\//g, '-')}.pdf"`);
    streamPerformaInvoicePdf(res, { pi: result.pi, items: result.items, settings });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
