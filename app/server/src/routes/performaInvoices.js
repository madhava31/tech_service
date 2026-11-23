import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamPerformaInvoicePdf } from '../pdf/documents.js';

const router = Router();

function fullPI(id) {
  const pi = db
    .prepare(
      `SELECT pi.*,
              COALESCE(pi.sales_engineer_id, po.sales_engineer_id, q.sales_engineer_id) AS sales_engineer_id,
              COALESCE(pi.firm_id, po.firm_id, q.firm_id) AS firm_id,
              COALESCE(pi.branch_id, po.branch_id, q.branch_id) AS branch_id,
              q.number AS quotation_number, q.subtotal, q.tax_percent, q.tax_amount, q.total,
              po.number AS po_number, po.client_po_ref,
              c.name AS company_name, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.id = pi.purchase_order_id
       WHERE pi.id = ?`
    )
    .get(id);
  if (!pi) return null;
  const items = db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(pi.quotation_id);
  return { pi, items };
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT pi.*,
              COALESCE(pi.sales_engineer_id, po.sales_engineer_id, q.sales_engineer_id) AS sales_engineer_id,
              q.number AS quotation_number, q.total, c.name AS company_name
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.id = pi.purchase_order_id
       ORDER BY pi.id DESC`
    )
    .all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const result = fullPI(req.params.id);
  if (!result) return res.status(404).json({ error: 'Performa invoice not found' });
  res.json({ ...result.pi, items: result.items });
});

router.post('/', (req, res) => {
  const { quotation_id, purchase_order_id, date } = req.body;
  if (!quotation_id) return res.status(400).json({ error: 'quotation_id is required' });
  const quotation = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotation_id);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  let sales_engineer_id = quotation.sales_engineer_id || null;
  let firm_id = quotation.firm_id || null;
  let branch_id = quotation.branch_id || null;

  if (purchase_order_id) {
    const po = db.prepare(`SELECT * FROM purchase_order WHERE id = ?`).get(purchase_order_id);
    if (po) {
      if (po.sales_engineer_id) sales_engineer_id = po.sales_engineer_id;
      if (po.firm_id) firm_id = po.firm_id;
      if (po.branch_id) branch_id = po.branch_id;
    }
  }

  const prefix = db.prepare(`SELECT pi_prefix FROM company_settings WHERE id = 1`).get().pi_prefix;
  const number = nextNumber(prefix, 'performa_invoice');
  const info = db
    .prepare(`INSERT INTO performa_invoice (number, date, quotation_id, purchase_order_id, sales_engineer_id, firm_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(number, date || new Date().toISOString().slice(0, 10), quotation_id, purchase_order_id || null, sales_engineer_id, firm_id, branch_id);

  const row = db.prepare(`SELECT * FROM performa_invoice WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid PI id' });

    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can delete performa invoices.' });
    }

    const pi = db.prepare(`SELECT id, number FROM performa_invoice WHERE id = ?`).get(id);
    if (!pi) return res.status(404).json({ error: 'Performa invoice not found' });

    db.prepare(`UPDATE sale_report SET source_pi_id = NULL WHERE source_pi_id = ?`).run(id);
    db.prepare(`DELETE FROM performa_invoice WHERE id = ?`).run(id);

    res.json({ success: true, id, message: `Performa invoice ${pi.number} deleted successfully.` });
  } catch (err) {
    console.error('Failed to delete performa invoice:', err);
    res.status(500).json({ error: 'Unable to delete the performa invoice. Please try again.' });
  }
});

router.get('/:id/pdf', (req, res) => {
  const result = fullPI(req.params.id);
  if (!result) return res.status(404).json({ error: 'Performa invoice not found' });
  const settings = db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${result.pi.number.replace(/\//g, '-')}.pdf"`);
  streamPerformaInvoicePdf(res, { pi: result.pi, items: result.items, settings });
});

export default router;
