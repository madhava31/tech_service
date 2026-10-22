import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamQuotationPdf } from '../pdf/documents.js';
import { getQuotationStockAnalysis } from '../services/inventoryService.js';
import { calculateQuotationPricing } from '../services/quotationPricingService.js';

const router = Router();

/**
 * POST /api/quotations/calculate-pricing
 * Real-time live quotation pricing preview endpoint
 */
router.post('/calculate-pricing', (req, res) => {
  try {
    const { items } = req.body;
    const oType = req.body.overall_discount_type || req.body.overallDiscountType || req.body.discount_type || req.body.discountType || 'none';
    const oVal = req.body.overall_discount_value !== undefined
      ? req.body.overall_discount_value
      : (req.body.overallDiscountValue !== undefined
        ? req.body.overallDiscountValue
        : (req.body.discount_value !== undefined
          ? req.body.discount_value
          : (req.body.discountValue !== undefined ? req.body.discountValue : 0)));
    const taxPct = req.body.tax_percent !== undefined
      ? req.body.tax_percent
      : (req.body.taxPercent !== undefined ? req.body.taxPercent : 18);

    const calculation = calculateQuotationPricing({
      items: Array.isArray(items) ? items : [],
      overallDiscountType: oType,
      overallDiscountValue: oVal,
      taxPercent: Number(taxPct),
    });
    res.json(calculation);
  } catch (err) {
    console.error('Failed to calculate quotation pricing:', err);
    res.status(400).json({ error: err.message || 'Failed to calculate pricing' });
  }
});

/**
 * READ-ONLY Live Quotation Stock Analysis Endpoint
 */
router.get('/stock-analysis', (req, res) => {
  try {
    const { productId, warehouseId, requestedQuantity } = req.query;
    if (!productId) return res.status(400).json({ error: 'productId query param is required' });
    const analysis = getQuotationStockAnalysis({
      productId: Number(productId),
      warehouseId: warehouseId ? Number(warehouseId) : null,
      requestedQuantity: requestedQuantity ? Number(requestedQuantity) : 1,
    });
    res.json(analysis);
  } catch (err) {
    console.error('Failed to analyze quotation stock:', err);
    res.status(400).json({ error: err.message || 'Failed to analyze quotation stock' });
  }
});

router.post('/stock-analysis', (req, res) => {
  try {
    const { warehouse_id, warehouseId, items } = req.body;
    const targetWhId = warehouse_id || warehouseId;
    
    const itemArray = Array.isArray(items) ? items : [];
    const analyzed = itemArray.map((it) => {
      const pId = it.product_id || it.productId;
      const partNo = it.part_no || it.partNo;
      const qty = Number(it.qty || it.quantity || 1);

      return getQuotationStockAnalysis({
        productId: pId,
        partNo: partNo,
        warehouseId: targetWhId,
        requestedQuantity: qty,
      });
    });

    const hasShortage = analyzed.some((i) => i.status === 'PARTIAL' || i.status === 'OUT_OF_STOCK');
    const totalShortageUnits = analyzed.reduce((sum, i) => sum + (i.shortage || 0), 0);

    let whName = null;
    if (targetWhId) {
      const wh = db.prepare(`SELECT name FROM warehouse WHERE id = ?`).get(targetWhId);
      if (wh) whName = wh.name;
    }

    res.json({
      warehouse_id: targetWhId ? Number(targetWhId) : null,
      warehouse_name: whName,
      items: analyzed,
      summary: {
        total_items: analyzed.length,
        available_count: analyzed.filter((i) => i.status === 'AVAILABLE').length,
        partial_count: analyzed.filter((i) => i.status === 'PARTIAL').length,
        incoming_count: analyzed.filter((i) => i.status === 'INCOMING').length,
        out_of_stock_count: analyzed.filter((i) => i.status === 'OUT_OF_STOCK').length,
        not_tracked_count: analyzed.filter((i) => i.status === 'NOT_TRACKED').length,
        has_shortage: hasShortage,
        total_shortage_units: totalShortageUnits,
      },
    });
  } catch (err) {
    console.error('Failed to analyze quotation stock:', err);
    res.status(400).json({ error: err.message || 'Failed to analyze quotation stock' });
  }
});

router.get('/', (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.pageSize !== undefined || req.query.paginated === 'true';

  if (!isPaginated) {
    const rows = db
      .prepare(
        `SELECT q.*, c.name AS company_name, e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code, b.branch_name
         FROM quotation q 
         JOIN company c ON c.id = q.company_id
         LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
         LEFT JOIN branch b ON b.id = q.branch_id
         ORDER BY q.id DESC`
      )
      .all();
    return res.json(rows);
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const offset = (page - 1) * pageSize;

  const {
    status,
    searchNumber,
    qNum,
    searchCompany,
    qComp,
    dateStart,
    dateEnd,
    minAmount,
    maxAmount,
  } = req.query;

  const numTerm = (searchNumber || qNum || '').trim();
  const compTerm = (searchCompany || qComp || '').trim();

  const whereClauses = [];
  const params = [];

  if (status && status !== 'all' && status !== '') {
    whereClauses.push(`q.status = ?`);
    params.push(status);
  }
  if (numTerm) {
    whereClauses.push(`q.number LIKE ?`);
    params.push(`%${numTerm}%`);
  }
  if (compTerm) {
    whereClauses.push(`c.name LIKE ?`);
    params.push(`%${compTerm}%`);
  }
  if (dateStart) {
    whereClauses.push(`q.date >= ?`);
    params.push(dateStart);
  }
  if (dateEnd) {
    whereClauses.push(`q.date <= ?`);
    params.push(dateEnd);
  }
  if (minAmount !== undefined && minAmount !== '') {
    const minVal = Number(minAmount);
    if (!isNaN(minVal)) {
      whereClauses.push(`q.total >= ?`);
      params.push(minVal);
    }
  }
  if (maxAmount !== undefined && maxAmount !== '') {
    const maxVal = Number(maxAmount);
    if (!isNaN(maxVal)) {
      whereClauses.push(`q.total <= ?`);
      params.push(maxVal);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM quotation q JOIN company c ON c.id = q.company_id ${whereSql}`)
    .get(...params);
  const total = Number(totalRow?.count || 0);

  const itemsParams = [...params, pageSize, offset];
  const items = db
    .prepare(
      `SELECT q.*, c.name AS company_name, e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code, b.branch_name
       FROM quotation q 
       JOIN company c ON c.id = q.company_id
       LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
       LEFT JOIN branch b ON b.id = q.branch_id
       ${whereSql}
       ORDER BY q.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...itemsParams);

  const stageCounts = { All: 0, Draft: 0, Sent: 0, Accepted: 0, Rejected: 0 };
  const globalCountRows = db.prepare(`SELECT status, COUNT(*) AS count FROM quotation GROUP BY status`).all();
  let totalAll = 0;
  for (const r of globalCountRows) {
    const c = Number(r.count || 0);
    totalAll += c;
    if (r.status === 'draft') stageCounts.Draft = c;
    else if (r.status === 'sent') stageCounts.Sent = c;
    else if (r.status === 'accepted') stageCounts.Accepted = c;
    else if (r.status === 'rejected') stageCounts.Rejected = c;
  }
  stageCounts.All = totalAll;

  const hasMore = offset + items.length < total;

  res.json({
    items,
    page,
    pageSize,
    hasMore,
    total,
    stageCounts,
  });
});

router.get('/:id', (req, res) => {
  const quotation = db
    .prepare(
      `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin,
              e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code, b.branch_name
       FROM quotation q 
       JOIN company c ON c.id = q.company_id 
       LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
       LEFT JOIN branch b ON b.id = q.branch_id
       WHERE q.id = ?`
    )
    .get(req.params.id);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  const items = db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(req.params.id);
  res.json({ ...quotation, items });
});

router.post('/', (req, res) => {
  try {
    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, overall_discount_type, overall_discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    let targetCompanyId = company_id;
    let company = targetCompanyId ? db.prepare(`SELECT id FROM company WHERE id = ?`).get(targetCompanyId) : null;
    if (!company && req.body.company_name?.trim()) {
      const compName = req.body.company_name.trim();
      const existingComp = db.prepare(`SELECT id FROM company WHERE UPPER(name) = UPPER(?)`).get(compName);
      if (existingComp) {
        targetCompanyId = existingComp.id;
        company = existingComp;
      } else {
        const info = db.prepare(`INSERT INTO company (name) VALUES (?)`).run(compName);
        targetCompanyId = info.lastInsertRowid;
        company = { id: targetCompanyId };
      }
    }
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const oType = overall_discount_type || discount_type || 'none';
    const oVal = overall_discount_value !== undefined ? overall_discount_value : (discount_value !== undefined ? discount_value : 0);
    const taxPct = tax_percent !== undefined ? Number(tax_percent) : 18;

    const calc = calculateQuotationPricing({
      items,
      overallDiscountType: oType,
      overallDiscountValue: oVal,
      taxPercent: taxPct,
    });

    // Defaults for firm & branch
    let targetFirmId = firm_id ? Number(firm_id) : null;
    let targetBranchId = branch_id ? Number(branch_id) : null;
    if (!targetFirmId || !targetBranchId) {
      const defaultBranch = db.prepare(`SELECT id, firm_id FROM branch WHERE is_default = 1 LIMIT 1`).get();
      if (defaultBranch) {
        if (!targetFirmId) targetFirmId = defaultBranch.firm_id;
        if (!targetBranchId) targetBranchId = defaultBranch.id;
      }
    }

    const tx = db.transaction(() => {
      const prefix = db.prepare(`SELECT quotation_prefix FROM company_settings WHERE id = 1`).get().quotation_prefix;
      const number = nextNumber(prefix, 'quotation');
      const info = db
        .prepare(
          `INSERT INTO quotation (
            number, date, company_id, status,
            gross_subtotal, product_discount_total, subtotal_after_product_discounts,
            overall_discount_type, overall_discount_value, overall_discount_amount, net_subtotal,
            subtotal, discount_type, discount_value, discount_percent, discount_amount,
            taxable_amount, tax_percent, tax_amount, round_off, total, notes,
            sales_engineer_id, firm_id, branch_id
           ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          number,
          date || new Date().toISOString().slice(0, 10),
          targetCompanyId,
          calc.gross_subtotal,
          calc.product_discount_total,
          calc.subtotal_after_product_discounts,
          calc.overall_discount_type,
          calc.overall_discount_value,
          calc.overall_discount_amount,
          calc.net_subtotal,
          calc.subtotal,
          calc.discount_type,
          calc.discount_value,
          calc.discount_percent,
          calc.discount_amount,
          calc.taxable_amount,
          calc.tax_percent,
          calc.tax_amount,
          calc.round_off,
          calc.total,
          notes || '',
          sales_engineer_id ? Number(sales_engineer_id) : null,
          targetFirmId,
          targetBranchId
        );

      const quotationId = info.lastInsertRowid;
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price,
          final_line_total, price, amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of calc.items) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const cleanPart = it.part_no ? String(it.part_no).trim() : null;
        const cleanDesc = it.description ? String(it.description).trim() : '';
        const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

        // Auto-save part number & product description into product master DB if not existing
        if (!pId && cleanPart) {
          const existingP = db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(cleanPart);
          if (existingP) {
            pId = existingP.id;
          }
        }
        if (!pId && (cleanPart || cleanDesc)) {
          const finalPart = cleanPart || `PART-${Date.now().toString().slice(-6)}`;
          const finalDesc = cleanDesc || finalPart;
          try {
            const prodInfo = db
              .prepare(`INSERT INTO product (part_no, description, default_price, hsn_sac, unit) VALUES (?, ?, ?, ?, 'Nos')`)
              .run(finalPart, finalDesc, itemPrice, it.hsn_sac ? String(it.hsn_sac).trim() : null);
            pId = prodInfo.lastInsertRowid;
          } catch (e) {
            const fallbackP = db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(finalPart);
            if (fallbackP) pId = fallbackP.id;
          }
        }

        insertItem.run(
          quotationId,
          pId,
          cleanPart || (pId ? db.prepare(`SELECT part_no FROM product WHERE id = ?`).get(pId)?.part_no : null),
          cleanDesc,
          it.hsn_sac || null,
          it.make || null,
          it.qty,
          it.actual_unit_price,
          it.discount_type,
          it.discount_value,
          it.product_discount_amount,
          it.after_product_discount_amount,
          it.overall_discount_allocated,
          it.final_unit_price,
          it.final_line_total,
          it.price,
          it.amount
        );

        // Update product master default price when modified in quotation
        if (itemPrice > 0 && pId) {
          db.prepare(`UPDATE product SET default_price = ? WHERE id = ?`).run(itemPrice, pId);
        }
      }
      return quotationId;
    });

    const quotationId = tx();
    const row = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotationId);
    res.status(201).json(row);
  } catch (err) {
    console.error('Failed to create quotation:', err);
    res.status(400).json({ error: err.message || 'Failed to create quotation' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft quotations can be edited' });

    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, overall_discount_type, overall_discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    const oType = overall_discount_type !== undefined ? overall_discount_type : (discount_type !== undefined ? discount_type : (existing.overall_discount_type || existing.discount_type || 'none'));
    const oVal = overall_discount_value !== undefined ? overall_discount_value : (discount_value !== undefined ? discount_value : (existing.overall_discount_value || existing.discount_value || 0));
    const taxPct = tax_percent !== undefined ? Number(tax_percent) : existing.tax_percent;

    const calc = calculateQuotationPricing({
      items,
      overallDiscountType: oType,
      overallDiscountValue: oVal,
      taxPercent: taxPct,
    });

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE quotation
         SET company_id = ?, date = ?,
             gross_subtotal = ?, product_discount_total = ?, subtotal_after_product_discounts = ?,
             overall_discount_type = ?, overall_discount_value = ?, overall_discount_amount = ?, net_subtotal = ?,
             subtotal = ?, discount_type = ?, discount_value = ?, discount_percent = ?, discount_amount = ?,
             taxable_amount = ?, tax_percent = ?, tax_amount = ?, round_off = ?, total = ?, notes = ?,
             sales_engineer_id = ?, firm_id = ?, branch_id = ?
         WHERE id = ?`
      ).run(
        company_id || existing.company_id,
        date || existing.date,
        calc.gross_subtotal,
        calc.product_discount_total,
        calc.subtotal_after_product_discounts,
        calc.overall_discount_type,
        calc.overall_discount_value,
        calc.overall_discount_amount,
        calc.net_subtotal,
        calc.subtotal,
        calc.discount_type,
        calc.discount_value,
        calc.discount_percent,
        calc.discount_amount,
        calc.taxable_amount,
        calc.tax_percent,
        calc.tax_amount,
        calc.round_off,
        calc.total,
        notes ?? existing.notes,
        sales_engineer_id !== undefined ? (sales_engineer_id ? Number(sales_engineer_id) : null) : existing.sales_engineer_id,
        firm_id !== undefined ? (firm_id ? Number(firm_id) : null) : existing.firm_id,
        branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : existing.branch_id,
        req.params.id
      );

      db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(req.params.id);
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price,
          final_line_total, price, amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of calc.items) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const cleanPart = it.part_no ? String(it.part_no).trim() : null;
        const cleanDesc = it.description ? String(it.description).trim() : '';
        const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

        if (!pId && cleanPart) {
          const existingP = db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(cleanPart);
          if (existingP) {
            pId = existingP.id;
          }
        }
        if (!pId && (cleanPart || cleanDesc)) {
          const finalPart = cleanPart || `PART-${Date.now().toString().slice(-6)}`;
          const finalDesc = cleanDesc || finalPart;
          try {
            const prodInfo = db
              .prepare(`INSERT INTO product (part_no, description, default_price, hsn_sac, unit) VALUES (?, ?, ?, ?, 'Nos')`)
              .run(finalPart, finalDesc, itemPrice, it.hsn_sac ? String(it.hsn_sac).trim() : null);
            pId = prodInfo.lastInsertRowid;
          } catch (e) {
            const fallbackP = db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(finalPart);
            if (fallbackP) pId = fallbackP.id;
          }
        }

        insertItem.run(
          req.params.id,
          pId,
          cleanPart || (pId ? db.prepare(`SELECT part_no FROM product WHERE id = ?`).get(pId)?.part_no : null),
          cleanDesc,
          it.hsn_sac || null,
          it.make || null,
          it.qty,
          it.actual_unit_price,
          it.discount_type,
          it.discount_value,
          it.product_discount_amount,
          it.after_product_discount_amount,
          it.overall_discount_allocated,
          it.final_unit_price,
          it.final_line_total,
          it.price,
          it.amount
        );

        // Update product master default price when modified in quotation
        if (itemPrice > 0 && pId) {
          db.prepare(`UPDATE product SET default_price = ? WHERE id = ?`).run(itemPrice, pId);
        }
      }
    });
    tx();

    const row = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    console.error('Failed to update quotation:', err);
    res.status(400).json({ error: err.message || 'Failed to update quotation' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const quotationId = req.params.id;
    const existing = db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(quotationId);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });

    const tx = db.transaction(() => {
      const pis = db.prepare(`SELECT id FROM performa_invoice WHERE quotation_id = ?`).all(quotationId);
      const piIds = pis.map((p) => p.id);

      const pos = db.prepare(`SELECT id FROM purchase_order WHERE quotation_id = ?`).all(quotationId);
      const poIds = pos.map((p) => p.id);

      for (const poId of poIds) {
        try { db.prepare(`UPDATE sale_report SET source_po_id = NULL WHERE source_po_id = ?`).run(poId); } catch {}
        try { db.prepare(`UPDATE procurement_requirement SET purchase_order_id = NULL WHERE purchase_order_id = ?`).run(poId); } catch {}
      }
      for (const piId of piIds) {
        try { db.prepare(`UPDATE sale_report SET source_pi_id = NULL WHERE source_pi_id = ?`).run(piId); } catch {}
      }
      try { db.prepare(`UPDATE sale_report SET source_quotation_id = NULL WHERE source_quotation_id = ?`).run(quotationId); } catch {}

      try { db.prepare(`DELETE FROM performa_invoice WHERE quotation_id = ?`).run(quotationId); } catch {}
      try { db.prepare(`DELETE FROM purchase_order WHERE quotation_id = ?`).run(quotationId); } catch {}
      try { db.prepare(`DELETE FROM quotation_follow_up WHERE quotation_id = ?`).run(quotationId); } catch {}
      try { db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(quotationId); } catch {}
      db.prepare(`DELETE FROM quotation WHERE id = ?`).run(quotationId);
    });
    tx();

    res.json({ success: true, message: 'Quotation deleted successfully' });
  } catch (err) {
    console.error('Failed to delete quotation:', err);
    res.status(400).json({ error: err.message || 'Failed to delete quotation' });
  }
});


router.post('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['draft', 'sent', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const existing = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quotation not found' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE quotation SET status = ? WHERE id = ?`).run(status, req.params.id);
    if (['accepted', 'rejected'].includes(status)) {
      db.prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE quotation_id = ? AND status = 'scheduled'`).run(req.params.id);
    }
  });
  tx();

  res.json(db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id));
});

router.post('/:id/follow-ups', (req, res) => {
  const { follow_up_date, notes } = req.body;
  if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date is required' });

  const quotation = db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  if (quotation.status !== 'sent') {
    return res.status(400).json({ error: 'Follow-ups can only be scheduled for quotations with status "sent"' });
  }

  const userId = req.user?.id || 1;
  const info = db
    .prepare(
      `INSERT INTO quotation_follow_up (quotation_id, follow_up_date, notes, status, created_by)
       VALUES (?, ?, ?, 'scheduled', ?)`
    )
    .run(req.params.id, follow_up_date, notes || '', userId);

  const row = db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.get('/:id/follow-ups', (req, res) => {
  const quotation = db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.id);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  const rows = db
    .prepare(
      `SELECT f.*, creator.username AS created_by_username, completer.username AS completed_by_username
       FROM quotation_follow_up f
       JOIN user creator ON creator.id = f.created_by
       LEFT JOIN user completer ON completer.id = f.completed_by
       WHERE f.quotation_id = ?
       ORDER BY f.follow_up_date DESC, f.id DESC`
    )
    .all(req.params.id);
  res.json({ followUps: rows });
});

router.post('/:quotationId/follow-ups/:followUpId/complete', (req, res) => {
  const { outcome, outcome_notes } = req.body;

  const quotation = db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.quotationId);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  const followUp = db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId);
  if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
  if (Number(followUp.quotation_id) !== Number(req.params.quotationId)) {
    return res.status(400).json({ error: 'Follow-up does not belong to this quotation' });
  }
  if (followUp.status !== 'scheduled') {
    return res.status(400).json({ error: 'Only scheduled follow-ups can be completed' });
  }

  const userId = req.user?.id || 1;
  db.prepare(
    `UPDATE quotation_follow_up
     SET status = 'completed', completed_at = datetime('now'), completed_by = ?, outcome = ?, outcome_notes = ?
     WHERE id = ?`
  ).run(userId, outcome || null, outcome_notes || null, req.params.followUpId);

  res.json(db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId));
});

router.post('/:quotationId/follow-ups/:followUpId/cancel', (req, res) => {
  const quotation = db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.quotationId);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  const followUp = db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(req.params.followUpId);
  if (!followUp) return res.status(404).json({ error: 'Follow-up not found' });
  if (Number(followUp.quotation_id) !== Number(req.params.quotationId)) {
    return res.status(400).json({ error: 'Follow-up does not belong to this quotation' });
  }
  if (followUp.status !== 'scheduled') {
    return res.status(400).json({ error: 'Only scheduled follow-ups can be cancelled' });
  }

  db.prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE id = ?`).run(req.params.followUpId);
  res.json({ ok: true });
});

router.get('/:id/pdf', (req, res) => {
  const quotation = db
    .prepare(
      `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin,
              e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code
       FROM quotation q
       JOIN company c ON c.id = q.company_id
       LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
       WHERE q.id = ?`
    )
    .get(req.params.id);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  const items = db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(req.params.id);
  const settings = db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quotation.number.replace(/\//g, '-')}.pdf"`);
  streamQuotationPdf(res, { quotation, items, settings });
});

export default router;
