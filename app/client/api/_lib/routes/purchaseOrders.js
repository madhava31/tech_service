import { Router } from 'express';
import db from '../db/index.js';
import { poReceivedReady } from '../quotations/poReceived.js';
import { nextNumber } from '../db/numbering.js';
import { streamPurchaseOrderPdf } from '../pdf/documents.js';

const router = Router();

async function fullPO(id) {
  const po = await db
    .prepare(
      `SELECT po.*, q.number AS quotation_number, q.subtotal, q.tax_percent, q.tax_amount, q.total,
              c.name AS company_name, c.address AS company_address, c.state AS company_state,
              c.gstin AS company_gstin, c.phone AS company_phone, u.username AS created_by_username,
              e.name AS sales_engineer_name,
              -- Contact and payment terms chosen on the quotation (migration 004); NULL before it is applied.
              to_jsonb(q) ->> 'contact_person' AS contact_person, to_jsonb(q) ->> 'contact_phone' AS contact_phone,
              to_jsonb(q) ->> 'contact_email' AS contact_email, to_jsonb(q) ->> 'advance_percent' AS advance_percent,
              to_jsonb(q) ->> 'payment_due_days' AS payment_due_days
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN app_user u ON u.id = q.created_by_user_id
       LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
       WHERE po.id = ?`
    )
    .get(id);
  if (!po) return null;
  const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(po.quotation_id);
  return { po, items };
}

// GET /api/purchase-orders/received : the customer POs recorded with "PO received" or a manual order, one row per PO,
// in the same shape as the list below. Users who are not admins see only the quotations they created.
router.get('/received', async (req, res) => {
  try {
    if (!(await poReceivedReady())) return res.json([]);
    const own = req.user?.role === 'admin' ? '' : 'WHERE q.created_by_user_id = ?';
    const rows = await db
      .prepare(
        `SELECT p.id, p.po_number AS number, p.po_date AS date, p.po_number AS client_po_ref, 'Received' AS status,
                q.id AS quotation_id, q.number AS quotation_number, c.name AS company_name,
                (SELECT COALESCE(SUM(pi.qty * COALESCE(qi.final_unit_price, qi.actual_unit_price, qi.price, 0)), 0)
                   FROM quotation_po_item pi JOIN quotation_item qi ON qi.id = pi.quotation_item_id
                  WHERE pi.quotation_po_id = p.id) * (1 + COALESCE(q.tax_percent, 0) / 100.0) AS total
           FROM quotation_po p
           JOIN quotation q ON q.id = p.quotation_id
           JOIN company c ON c.id = q.company_id
           ${own}
          ORDER BY p.created_at DESC, p.id DESC`
      )
      .all(...(own ? [req.user.id] : []));
    res.json(rows.map((r) => ({ ...r, total: Number(r.total) })));
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT po.*, q.number AS quotation_number, q.total, c.name AS company_name
         FROM purchase_order po
         JOIN quotation q ON q.id = po.quotation_id
         JOIN company c ON c.id = q.company_id
         ORDER BY po.id DESC`
      )
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await fullPO(req.params.id);
    if (!result) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ ...result.po, items: result.items });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { quotation_id, client_po_ref, date } = req.body;
    if (!quotation_id) return res.status(400).json({ error: 'quotation_id is required' });
    const quotation = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotation_id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const prefix = (await db.prepare(`SELECT po_prefix FROM company_settings WHERE id = 1`).get()).po_prefix;
    const number = await nextNumber(prefix, 'purchase_order');

    const poId = await db.transaction(async () => {
      const info = await db
        .prepare(`INSERT INTO purchase_order (number, date, quotation_id, client_po_ref) VALUES (?, ?, ?, ?) RETURNING id`)
        .run(number, date || new Date().toISOString().slice(0, 10), quotation_id, client_po_ref || null);

      await db.prepare(`UPDATE quotation SET status = 'accepted' WHERE id = ?`).run(quotation_id);
      // This route sets the quotation to 'accepted' directly, bypassing POST /:id/status — so the
      // same auto-cancellation of open follow-ups has to be duplicated here to keep the rule from
      // depending on which route happened to change the status.
      await db
        .prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE quotation_id = ? AND status = 'scheduled'`)
        .run(quotation_id);

      return info.lastInsertRowid;
    });

    const row = await db.prepare(`SELECT * FROM purchase_order WHERE id = ?`).get(poId);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to create the purchase order. Please try again.' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const result = await fullPO(req.params.id);
    if (!result) return res.status(404).json({ error: 'Purchase order not found' });
    const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.po.number.replace(/\//g, '-')}.pdf"`);
    streamPurchaseOrderPdf(res, { po: result.po, items: result.items, settings });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
