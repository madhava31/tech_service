import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamQuotationPdf } from '../pdf/documents.js';

const router = Router();

function computeTotals(items, taxPercent, discountType = 'percentage', discountValue = 0) {
  const subtotal = items.reduce((sum, it) => sum + Number(it.qty) * Number(it.price), 0);
  const numVal = Number(discountValue) || 0;
  const dType = discountType || 'percentage';
  let discountAmount = 0;
  let discountPercent = 0;

  if (dType === 'amount') {
    discountAmount = numVal > 0 ? numVal : 0;
    discountPercent = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  } else {
    discountPercent = numVal > 0 ? numVal : 0;
    discountAmount = subtotal * (discountPercent / 100);
  }

  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableAmount * (Number(taxPercent) / 100);
  const exactTotal = taxableAmount + taxAmount;
  const roundedTotal = Math.round(exactTotal);
  const roundOff = roundedTotal - exactTotal;
  const total = roundedTotal;

  return { subtotal, discountType: dType, discountValue: numVal, discountPercent, discountAmount, taxableAmount, taxAmount, roundOff, total };
}

router.get('/', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT q.*, c.name AS company_name
         FROM quotation q JOIN company c ON c.id = q.company_id
         ORDER BY q.id DESC`
      )
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quotation = await db
      .prepare(
        `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin
         FROM quotation q JOIN company c ON c.id = q.company_id WHERE q.id = ?`
      )
      .get(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(req.params.id);
    res.json({ ...quotation, items });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, sales_engineer_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    const company = await db.prepare(`SELECT id FROM company WHERE id = ?`).get(company_id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const taxPercent = tax_percent ?? 18;
    const { subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxAmount, roundOff, total } =
      computeTotals(items, taxPercent, discount_type, discount_value);

    const quotationId = await db.transaction(async () => {
      const prefix = (await db.prepare(`SELECT quotation_prefix FROM company_settings WHERE id = 1`).get()).quotation_prefix;
      const number = await nextNumber(prefix, 'quotation');
      const info = await db
        .prepare(
          `INSERT INTO quotation (number, date, company_id, sales_engineer_id, status, subtotal, discount_type, discount_value, discount_percent, discount_amount, taxable_amount, tax_percent, tax_amount, round_off, total, notes, created_by_user_id)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(number, date || new Date().toISOString().slice(0, 10), company_id, sales_engineer_id || null, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxPercent, taxAmount, roundOff, total, notes || '', req.user.id);

      const qId = info.lastInsertRowid;
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        await insertItem.run(
          qId,
          it.product_id || null,
          it.part_no || null,
          it.description,
          it.hsn_sac || null,
          it.make || null,
          it.qty,
          it.price,
          Number(it.qty) * Number(it.price)
        );
      }
      return qId;
    });

    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotationId);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to create the quotation. Please try again.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft quotations can be edited' });

    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, sales_engineer_id } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    const taxPercent = tax_percent ?? existing.tax_percent;
    const dType = discount_type !== undefined ? discount_type : (existing.discount_type || 'percentage');
    const dVal = discount_value !== undefined ? discount_value : (existing.discount_value || 0);
    const { subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxAmount, roundOff, total } =
      computeTotals(items, taxPercent, dType, dVal);

    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE quotation SET company_id = ?, sales_engineer_id = ?, date = ?, subtotal = ?, discount_type = ?, discount_value = ?, discount_percent = ?, discount_amount = ?, taxable_amount = ?, tax_percent = ?, tax_amount = ?, round_off = ?, total = ?, notes = ? WHERE id = ?`
        )
        .run(company_id || existing.company_id, sales_engineer_id !== undefined ? (sales_engineer_id || null) : existing.sales_engineer_id, date || existing.date, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxPercent, taxAmount, roundOff, total, notes ?? existing.notes, req.params.id);

      await db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(req.params.id);
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        await insertItem.run(req.params.id, it.product_id || null, it.part_no || null, it.description, it.hsn_sac || null, it.make || null, it.qty, it.price, Number(it.qty) * Number(it.price));
      }
    });

    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to save the quotation. Please try again.' });
  }
});

router.post('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['draft', 'sent', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });

    await db.transaction(async () => {
      await db.prepare(`UPDATE quotation SET status = ? WHERE id = ?`).run(status, req.params.id);
      // Accepted/rejected quotations are done being chased — any open scheduled follow-up no
      // longer makes sense, so it's auto-cancelled rather than left dangling on a closed deal.
      if (status === 'accepted' || status === 'rejected') {
        await db
          .prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE quotation_id = ? AND status = 'scheduled'`)
          .run(req.params.id);
      }
    });

    res.json(await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Unable to update the quotation status. Please try again.' });
  }
});

router.post('/:id/follow-ups', async (req, res) => {
  try {
    const { follow_up_date, notes } = req.body;
    if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date is required' });

    const quotation = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.status !== 'sent') {
      return res.status(400).json({ error: 'Follow-ups can only be scheduled for quotations with status "sent"' });
    }

    const info = await db
      .prepare(
        `INSERT INTO quotation_follow_up (quotation_id, follow_up_date, notes, status, created_by)
         VALUES (?, ?, ?, 'scheduled', ?) RETURNING id`
      )
      .run(req.params.id, follow_up_date, notes || '', req.user.id);

    const row = await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to schedule the follow-up. Please try again.' });
  }
});

router.get('/:id/follow-ups', async (req, res) => {
  try {
    const quotation = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const rows = await db
      .prepare(
        `SELECT f.*, creator.username AS created_by_username, completer.username AS completed_by_username
         FROM quotation_follow_up f
         JOIN app_user creator ON creator.id = f.created_by
         LEFT JOIN app_user completer ON completer.id = f.completed_by
         WHERE f.quotation_id = ?
         ORDER BY f.follow_up_date DESC, f.id DESC`
      )
      .all(req.params.id);
    res.json({ followUps: rows });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/:quotationId/follow-ups/:followUpId/complete', async (req, res) => {
  try {
    const { outcome, outcome_notes } = req.body;

    const quotation = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.quotationId);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const followUp = await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId);
    if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
    if (Number(followUp.quotation_id) !== Number(req.params.quotationId)) {
      return res.status(400).json({ error: 'Follow-up does not belong to this quotation' });
    }
    if (followUp.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled follow-ups can be completed' });
    }

    await db
      .prepare(
        `UPDATE quotation_follow_up
         SET status = 'completed', completed_at = NOW(), completed_by = ?, outcome = ?, outcome_notes = ?
         WHERE id = ?`
      )
      .run(req.user.id, outcome || null, outcome_notes || null, req.params.followUpId);

    res.json(await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId));
  } catch (err) {
    res.status(500).json({ error: 'Unable to complete the follow-up. Please try again.' });
  }
});

router.post('/:quotationId/follow-ups/:followUpId/cancel', async (req, res) => {
  try {
    const quotation = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.quotationId);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const followUp = await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId);
    if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
    if (Number(followUp.quotation_id) !== Number(req.params.quotationId)) {
      return res.status(400).json({ error: 'Follow-up does not belong to this quotation' });
    }
    if (followUp.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled follow-ups can be cancelled' });
    }

    await db.prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE id = ?`).run(req.params.followUpId);
    res.json(await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId));
  } catch (err) {
    res.status(500).json({ error: 'Unable to cancel the follow-up. Please try again.' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const quotation = await db
      .prepare(
        `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state,
                c.gstin AS company_gstin, c.phone AS company_phone, u.username AS created_by_username
         FROM quotation q
         JOIN company c ON c.id = q.company_id
         LEFT JOIN app_user u ON u.id = q.created_by_user_id
         WHERE q.id = ?`
      )
      .get(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(req.params.id);
    const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quotation.number.replace(/\//g, '-')}.pdf"`);
    streamQuotationPdf(res, { quotation, items, settings });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
