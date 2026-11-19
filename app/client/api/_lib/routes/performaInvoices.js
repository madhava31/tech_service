import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamPerformaInvoicePdf } from '../pdf/documents.js';
import { loadPoRefs } from '../quotations/poRefs.js';

const router = Router();

export class PiEditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Checks an edit of a performa invoice: its number and its date. Returns { number, date } or throws a PiEditError.
 * Only the number and date can change; the quotation, the PO and the items stay as they are.
 */
export function parsePiEdit(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PiEditError('Invalid request');
  if (typeof body.number !== 'string') throw new PiEditError('Enter the PI number');
  if (CONTROL.test(body.number)) throw new PiEditError('The PI number contains invalid characters');
  const number = body.number.trim();
  if (!number) throw new PiEditError('Enter the PI number');
  if (number.length > 60) throw new PiEditError('The PI number can be at most 60 characters');
  if (/\s/.test(number)) throw new PiEditError('The PI number cannot contain spaces');
  const day = String(body.date ?? '').slice(0, 10);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid) throw new PiEditError('Enter a valid PI date');
  if (day < '2000-01-01') throw new PiEditError('That PI date is too far in the past');
  return { number, date: day };
}

async function fullPI(id) {
  const pi = await db
    .prepare(
      `SELECT pi.*, q.number AS quotation_number, q.subtotal, q.tax_percent, q.tax_amount, q.total,
              po.number AS po_number, po.client_po_ref,
              c.name AS company_name, c.address AS company_address, c.state AS company_state,
              c.gstin AS company_gstin, c.phone AS company_phone, u.username AS created_by_username,
              e.name AS sales_engineer_name,
              -- Contact and payment terms chosen on the quotation (migration 004); NULL before it is applied.
              to_jsonb(q) ->> 'contact_person' AS contact_person, to_jsonb(q) ->> 'contact_phone' AS contact_phone,
              to_jsonb(q) ->> 'contact_email' AS contact_email, to_jsonb(q) ->> 'advance_percent' AS advance_percent,
              to_jsonb(q) ->> 'payment_due_days' AS payment_due_days
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.id = pi.purchase_order_id
       LEFT JOIN app_user u ON u.id = q.created_by_user_id
       LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
       WHERE pi.id = ?`
    )
    .get(id);
  if (!pi) return null;
  const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(pi.quotation_id);
  // The customer's PO number(s) and date(s): the PI is raised against them, not against the quotation.
  pi.po_refs = (await loadPoRefs([pi.quotation_id])).get(Number(pi.quotation_id)) || [];
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
    const refs = await loadPoRefs(rows.map((r) => r.quotation_id));
    res.json(rows.map((r) => ({ ...r, po_refs: refs.get(Number(r.quotation_id)) || [] })));
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

/**
 * PUT /api/performa-invoices/:id  { number, date }
 * Changes the PI number and date. The PDF reads them from here, so it shows the change at once. The numbering of new PIs
 * continues from the highest number of the year, so a PI renamed to TSPI2627/49 makes the next one TSPI2627/50.
 * Allowed for an admin and for the sales person who made the quotation.
 */
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid PI id' });
    const pi = await db
      .prepare(`SELECT pi.id, pi.number, pi.date, q.created_by_user_id FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id WHERE pi.id = ?`)
      .get(id);
    if (!pi) return res.status(404).json({ error: 'Performa invoice not found' });
    if (req.user?.role !== 'admin' && Number(pi.created_by_user_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Only an admin or the sales person who made the quotation can edit this PI.' });
    }
    let edit;
    try {
      edit = parsePiEdit(req.body);
    } catch (err) {
      if (err instanceof PiEditError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    const clash = await db.prepare(`SELECT id FROM performa_invoice WHERE LOWER(BTRIM(number)) = LOWER(?) AND id <> ?`).get(edit.number, id);
    if (clash) return res.status(409).json({ error: `The PI number ${edit.number} is already used by another PI.` });
    await db.prepare(`UPDATE performa_invoice SET number = ?, date = ? WHERE id = ?`).run(edit.number, edit.date, id);
    res.json(await db.prepare(`SELECT * FROM performa_invoice WHERE id = ?`).get(id));
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'That PI number is already used by another PI.' });
    res.status(500).json({ error: 'Unable to save the PI. Please try again.' });
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
