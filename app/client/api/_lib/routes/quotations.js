import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamQuotationPdf } from '../pdf/documents.js';
import apiCache from '../cache/apiCache.js';

const router = Router();

function getItemPrice(it) {
  if (it.price !== undefined && it.price !== null && it.price !== '') {
    const p = Number(it.price);
    if (!isNaN(p)) return p;
  }
  if (it.actual_unit_price !== undefined && it.actual_unit_price !== null && it.actual_unit_price !== '') {
    const p = Number(it.actual_unit_price);
    if (!isNaN(p)) return p;
  }
  if (it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '') {
    const p = Number(it.unit_price);
    if (!isNaN(p)) return p;
  }
  if (it.unitPrice !== undefined && it.unitPrice !== null && it.unitPrice !== '') {
    const p = Number(it.unitPrice);
    if (!isNaN(p)) return p;
  }
  return null;
}

function computeTotals(items, taxPercent, discountType = 'percentage', discountValue = 0) {
  let grossSubtotal = 0;
  let productDiscountTotal = 0;

  const processedItems = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const actualUnitPrice = getItemPrice(it) ?? 0;
    const grossLineTotal = actualUnitPrice * qty;
    const discType = it.discount_type || it.discountType || 'none';
    const discVal = Number(it.discount_value ?? it.discountValue) || 0;

    let discPerUnit = 0;
    if (discType === 'percentage' || discType === 'percent') {
      if (discVal > 0) discPerUnit = (actualUnitPrice * discVal) / 100;
    } else if (discType === 'amount' || discType === 'flat' || discType === 'fixed') {
      if (discVal > 0) discPerUnit = Math.min(discVal, actualUnitPrice);
    }

    const finalUnitPrice = Math.max(0, actualUnitPrice - discPerUnit);
    const prodDiscAmount = Math.min(discPerUnit * qty, grossLineTotal);
    const afterProdDiscAmount = Math.max(0, grossLineTotal - prodDiscAmount);
    const finalLineTotal = afterProdDiscAmount;

    grossSubtotal += grossLineTotal;
    productDiscountTotal += prodDiscAmount;

    return {
      ...it,
      actual_unit_price: actualUnitPrice,
      price: actualUnitPrice,
      qty,
      gross_line_total: grossLineTotal,
      product_discount_amount: prodDiscAmount,
      after_product_discount_amount: afterProdDiscAmount,
      final_unit_price: finalUnitPrice,
      final_line_total: finalLineTotal,
      amount: finalLineTotal,
    };
  });

  const subtotalAfterProductDiscounts = Math.max(0, grossSubtotal - productDiscountTotal);
  const subtotal = subtotalAfterProductDiscounts;

  const numVal = Number(discountValue) || 0;
  const dType = discountType || 'percentage';
  let overallDiscountAmount = 0;

  if (dType === 'amount' || dType === 'flat' || dType === 'fixed') {
    overallDiscountAmount = numVal > 0 ? Math.min(numVal, subtotalAfterProductDiscounts) : 0;
  } else if (dType === 'percentage' || dType === 'percent') {
    overallDiscountAmount = numVal > 0 ? (subtotalAfterProductDiscounts * (numVal / 100)) : 0;
  }
  overallDiscountAmount = Math.min(overallDiscountAmount, subtotalAfterProductDiscounts);

  const discountPercent = dType === 'percentage' ? numVal : (subtotalAfterProductDiscounts > 0 ? (overallDiscountAmount / subtotalAfterProductDiscounts) * 100 : 0);
  const taxableAmount = Math.max(0, subtotalAfterProductDiscounts - overallDiscountAmount);
  const taxAmount = taxableAmount * (Number(taxPercent) / 100);
  const exactTotal = taxableAmount + taxAmount;
  const roundedTotal = Math.round(exactTotal);
  const roundOff = roundedTotal - exactTotal;
  const total = roundedTotal;

  return {
    processedItems,
    grossSubtotal,
    productDiscountTotal,
    subtotalAfterProductDiscounts,
    subtotal,
    discountType: dType,
    discountValue: numVal,
    discountPercent,
    discountAmount: overallDiscountAmount,
    taxableAmount,
    taxAmount,
    roundOff,
    total,
  };
}

async function analyzeItemStock(database, { productId, partNo, warehouseId, requestedQuantity }) {
  let product = null;
  if (productId) {
    product = await database.prepare(`SELECT * FROM product WHERE id = ?`).get(Number(productId));
  } else if (partNo) {
    product = await database.prepare(`SELECT * FROM product WHERE part_no = ?`).get(String(partNo).trim());
  }

  const reqQty = Number(requestedQuantity) || 1;

  if (!product) {
    return {
      product_id: null,
      part_no: partNo || 'CUSTOM',
      description: 'Custom / Un-tracked Product',
      quoted_qty: reqQty,
      on_hand: 0,
      reserved: 0,
      available: 0,
      incoming: 0,
      shortage: 0,
      status: 'NOT_TRACKED',
    };
  }

  const pId = product.id;
  let whId = Number(warehouseId) || null;
  let warehouse = null;
  if (whId) {
    warehouse = await database.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(whId);
  } else {
    const defaultWh = await database.prepare(`SELECT * FROM warehouse WHERE is_default = 1 LIMIT 1`).get();
    if (defaultWh) {
      whId = defaultWh.id;
      warehouse = defaultWh;
    }
  }

  let stockRow = null;
  if (whId) {
    stockRow = await database.prepare(`
      SELECT 
        COALESCE(on_hand_quantity, 0) AS on_hand,
        COALESCE(reserved_quantity, 0) AS reserved,
        COALESCE(incoming_quantity, 0) AS incoming
      FROM inventory_stock
      WHERE warehouse_id = ? AND product_id = ?
    `).get(whId, pId);
  } else {
    stockRow = await database.prepare(`
      SELECT 
        COALESCE(SUM(on_hand_quantity), 0) AS on_hand,
        COALESCE(SUM(reserved_quantity), 0) AS reserved,
        COALESCE(SUM(incoming_quantity), 0) AS incoming
      FROM inventory_stock
      WHERE product_id = ?
    `).get(pId);
  }

  const onHand = Number(stockRow?.on_hand || 0);
  const reserved = Number(stockRow?.reserved || 0);
  const incoming = Number(stockRow?.incoming || 0);
  const available = Math.max(0, onHand - reserved);

  let status = 'AVAILABLE';
  let shortage = 0;

  if (available >= reqQty) {
    status = 'AVAILABLE';
    shortage = 0;
  } else if (available > 0) {
    status = 'PARTIAL';
    shortage = reqQty - available;
  } else if (incoming > 0) {
    status = 'INCOMING';
    shortage = reqQty - available;
  } else {
    status = 'OUT_OF_STOCK';
    shortage = reqQty - available;
  }

  return {
    product_id: pId,
    part_no: product.part_no,
    description: product.description,
    quoted_qty: reqQty,
    on_hand: onHand,
    reserved: reserved,
    available: available,
    incoming: incoming,
    shortage: shortage,
    status: status,
  };
}

router.post('/calculate-pricing', (req, res) => {
  try {
    const {
      items,
      tax_percent,
      taxPercent,
      discount_type,
      discountType,
      overall_discount_type,
      overallDiscountType,
      discount_value,
      discountValue,
      overall_discount_value,
      overallDiscountValue,
    } = req.body;
    const taxPct = tax_percent ?? taxPercent ?? 18;
    const dType = overall_discount_type ?? overallDiscountType ?? discount_type ?? discountType ?? 'percentage';
    const dVal = overall_discount_value ?? overallDiscountValue ?? discount_value ?? discountValue ?? 0;

    const result = computeTotals(items || [], taxPct, dType, dVal);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to calculate pricing' });
  }
});

router.get('/stock-analysis', async (req, res) => {
  try {
    const { productId, warehouseId, requestedQuantity } = req.query;
    if (!productId) return res.status(400).json({ error: 'productId query param is required' });
    const analysis = await analyzeItemStock(db, {
      productId: Number(productId),
      warehouseId: warehouseId ? Number(warehouseId) : null,
      requestedQuantity: requestedQuantity ? Number(requestedQuantity) : 1,
    });
    res.json(analysis);
  } catch (err) {
    console.error('Failed to analyze quotation stock:', err);
    res.status(500).json({ error: err.message || 'Failed to analyze quotation stock' });
  }
});

router.post('/stock-analysis', async (req, res) => {
  try {
    const { warehouse_id, warehouseId, items } = req.body;
    const targetWhId = warehouse_id || warehouseId;

    const itemArray = Array.isArray(items) ? items : [];
    const analyzed = [];
    for (const it of itemArray) {
      const pId = it.product_id || it.productId;
      const partNo = it.part_no || it.partNo;
      const qty = Number(it.qty || it.quantity || 1);

      const resItem = await analyzeItemStock(db, {
        productId: pId,
        partNo: partNo,
        warehouseId: targetWhId,
        requestedQuantity: qty,
      });
      analyzed.push(resItem);
    }

    const hasShortage = analyzed.some((i) => i.status === 'PARTIAL' || i.status === 'OUT_OF_STOCK');
    const totalShortageUnits = analyzed.reduce((sum, i) => sum + (i.shortage || 0), 0);

    let whName = null;
    if (targetWhId) {
      const wh = await db.prepare(`SELECT name FROM warehouse WHERE id = ?`).get(targetWhId);
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
    res.status(500).json({ error: err.message || 'Failed to analyze quotation stock' });
  }
});

router.get('/', async (req, res) => {
  try {
    const isPaginated = req.query.page !== undefined || req.query.pageSize !== undefined || req.query.paginated === 'true';

    if (!isPaginated) {
      const rows = await db
        .prepare(
          `SELECT q.*, c.name AS company_name, e.name AS sales_engineer_name
           FROM quotation q 
           JOIN company c ON c.id = q.company_id
           LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
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
      whereClauses.push(`q.number ILIKE ?`);
      params.push(`%${numTerm}%`);
    }
    if (compTerm) {
      whereClauses.push(`c.name ILIKE ?`);
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

    // Fast filtered count
    const totalRow = await db
      .prepare(`SELECT COUNT(*) AS count FROM quotation q JOIN company c ON c.id = q.company_id ${whereSql}`)
      .get(...params);
    const total = Number(totalRow?.count || 0);

    // Fetch paginated slice with deterministic ordering
    const itemsParams = [...params, pageSize, offset];
    const items = await db
      .prepare(
        `SELECT q.*, c.name AS company_name, e.name AS sales_engineer_name
         FROM quotation q 
         JOIN company c ON c.id = q.company_id
         LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
         ${whereSql}
         ORDER BY q.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...itemsParams);

    // Global stage counts aggregated in database
    const stageCounts = { All: 0, Draft: 0, Sent: 0, Accepted: 0, Rejected: 0 };
    const globalCountRows = await db.prepare(`SELECT status, COUNT(*) AS count FROM quotation GROUP BY status`).all();
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
  } catch (err) {
    console.error('Error fetching quotations:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quotation = await db
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
    const items = await db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(req.params.id);
    res.json({ ...quotation, items });
  } catch (err) {
    console.error('Error fetching quotation by ID:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { company_id, company_name, date, items, tax_percent, notes, discount_type, discount_value, overall_discount_type, overall_discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    let finalCompanyId = company_id ? Number(company_id) : null;
    if ((!finalCompanyId || isNaN(finalCompanyId)) && (company_name || typeof company_id === 'string')) {
      const cName = String(company_name || company_id).trim();
      if (cName) {
        let existingComp = await db.prepare(`SELECT id FROM company WHERE UPPER(name) = UPPER(?)`).get(cName);
        if (!existingComp) {
          const newComp = await db.prepare(`INSERT INTO company (name) VALUES (?) RETURNING id`).run(cName);
          finalCompanyId = newComp.lastInsertRowid;
          apiCache.invalidateTags(['dashboard', 'companies', 'opportunities']);
        } else {
          finalCompanyId = existingComp.id;
        }
      }
    }

    if (!finalCompanyId) return res.status(400).json({ error: 'company_id is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    for (let i = 0; i < items.length; i++) {
      const price = getItemPrice(items[i]);
      if (price === null) {
        return res.status(400).json({ error: `Quotation item price is required for line item ${i + 1}` });
      }
    }

    const company = await db.prepare(`SELECT id FROM company WHERE id = ?`).get(finalCompanyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const taxPercent = tax_percent ?? 18;
    const oType = overall_discount_type !== undefined ? overall_discount_type : (discount_type || 'none');
    const oVal = overall_discount_value !== undefined ? overall_discount_value : (discount_value || 0);
    const calcResult = computeTotals(items, taxPercent, oType, oVal);
    const { processedItems, grossSubtotal, productDiscountTotal, subtotalAfterProductDiscounts, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxAmount, roundOff, total } = calcResult;

    const quotationId = await db.transaction(async () => {
      const settings = await db.prepare(`SELECT quotation_prefix FROM company_settings WHERE id = 1`).get();
      const prefix = settings ? settings.quotation_prefix : 'QTN';
      const number = await nextNumber(prefix, 'quotation');
      const info = await db
        .prepare(
          `INSERT INTO quotation (
            number, date, company_id, sales_engineer_id, firm_id, branch_id, status, 
            gross_subtotal, product_discount_total, subtotal_after_product_discounts,
            overall_discount_type, overall_discount_value, overall_discount_amount, net_subtotal,
            subtotal, discount_type, discount_value, discount_percent, discount_amount, 
            taxable_amount, tax_percent, tax_amount, round_off, total, notes, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(
          number,
          date || new Date().toISOString().slice(0, 10),
          finalCompanyId,
          sales_engineer_id ? Number(sales_engineer_id) : null,
          firm_id ? Number(firm_id) : null,
          branch_id ? Number(branch_id) : null,
          grossSubtotal,
          productDiscountTotal,
          subtotalAfterProductDiscounts,
          discountType,
          discountValue,
          discountAmount,
          taxableAmount,
          subtotal,
          discountType,
          discountValue,
          discountPercent,
          discountAmount,
          taxableAmount,
          taxPercent,
          taxAmount,
          roundOff,
          total,
          notes || '',
          req.user.id
        );

      const qId = info.lastInsertRowid;
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price, final_line_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const it of processedItems) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const partNo = it.part_no ? String(it.part_no).trim() : null;
        const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

        if (partNo || it.description) {
          const finalPart = partNo || (it.description.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 2).map((w) => w.toUpperCase().slice(0, 4)).join('-') + `-${Math.floor(1000 + Math.random() * 9000)}`);
          let existingProd = null;
          if (pId) {
            existingProd = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(pId);
          }
          if (!existingProd) {
            existingProd = await db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(finalPart);
          }
          if (!existingProd) {
            const desc = (it.description && String(it.description).trim()) ? String(it.description).trim() : finalPart;
            const newProd = await db.prepare(
              `INSERT INTO product (part_no, description, default_price, hsn_sac, unit)
               VALUES (?, ?, ?, ?, 'Nos') RETURNING id`
            ).run(
              finalPart,
              desc,
              itemPrice,
              it.hsn_sac ? String(it.hsn_sac).trim() : null
            );
            pId = newProd.lastInsertRowid;
          } else {
            pId = existingProd.id;
          }
        }

        await insertItem.run(
          qId,
          pId,
          partNo,
          it.description,
          it.hsn_sac || null,
          it.make || null,
          it.qty,
          it.actual_unit_price,
          it.amount,
          it.actual_unit_price,
          it.discount_type || 'none',
          Number(it.discount_value) || 0,
          it.product_discount_amount,
          it.after_product_discount_amount,
          Number(it.overall_discount_allocated) || 0,
          it.final_unit_price,
          it.final_line_total
        );

        // Update product master default price when modified in quotation
        if (itemPrice > 0) {
          if (pId) {
            await db.prepare(`UPDATE product SET default_price = ? WHERE id = ?`).run(itemPrice, pId);
          } else if (partNo) {
            await db.prepare(`UPDATE product SET default_price = ? WHERE UPPER(part_no) = UPPER(?)`).run(itemPrice, partNo);
          }
        }
      }
      return qId;
    });

    apiCache.invalidateTags(['dashboard', 'products', 'companies']);
    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotationId);
    res.status(201).json(row);
  } catch (err) {
    console.error('Unable to create the quotation:', err);
    res.status(500).json({ error: err.message || 'Unable to create the quotation. Please try again.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft quotations can be edited' });

    const { company_id, company_name, date, items, tax_percent, notes, discount_type, discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    let finalCompanyId = company_id ? Number(company_id) : null;
    if ((!finalCompanyId || isNaN(finalCompanyId)) && (company_name || typeof company_id === 'string')) {
      const cName = String(company_name || company_id).trim();
      if (cName) {
        let existingComp = await db.prepare(`SELECT id FROM company WHERE UPPER(name) = UPPER(?)`).get(cName);
        if (!existingComp) {
          const newComp = await db.prepare(`INSERT INTO company (name) VALUES (?) RETURNING id`).run(cName);
          finalCompanyId = newComp.lastInsertRowid;
          apiCache.invalidateTags(['dashboard', 'companies', 'opportunities']);
        } else {
          finalCompanyId = existingComp.id;
        }
      }
    }
    if (!finalCompanyId) finalCompanyId = existing.company_id;

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    for (let i = 0; i < items.length; i++) {
      const price = getItemPrice(items[i]);
      if (price === null) {
        return res.status(400).json({ error: `Quotation item price is required for line item ${i + 1}` });
      }
    }

    const taxPercent = tax_percent ?? existing.tax_percent;
    const dType = discount_type !== undefined ? discount_type : (existing.discount_type || 'percentage');
    const dVal = discount_value !== undefined ? discount_value : (existing.discount_value || 0);
    const calcResult = computeTotals(items, taxPercent, dType, dVal);
    const { processedItems, grossSubtotal, productDiscountTotal, subtotalAfterProductDiscounts, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxAmount, roundOff, total } = calcResult;

    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE quotation 
           SET company_id = ?, sales_engineer_id = ?, firm_id = ?, branch_id = ?, date = ?, 
               gross_subtotal = ?, product_discount_total = ?, subtotal_after_product_discounts = ?,
               overall_discount_type = ?, overall_discount_value = ?, overall_discount_amount = ?, net_subtotal = ?,
               subtotal = ?, discount_type = ?, discount_value = ?, discount_percent = ?, discount_amount = ?, 
               taxable_amount = ?, tax_percent = ?, tax_amount = ?, round_off = ?, total = ?, notes = ? 
           WHERE id = ?`
        )
        .run(
          finalCompanyId,
          sales_engineer_id !== undefined ? (sales_engineer_id ? Number(sales_engineer_id) : null) : existing.sales_engineer_id,
          firm_id !== undefined ? (firm_id ? Number(firm_id) : null) : existing.firm_id,
          branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : existing.branch_id,
          date || existing.date,
          grossSubtotal,
          productDiscountTotal,
          subtotalAfterProductDiscounts,
          discountType,
          discountValue,
          discountAmount,
          taxableAmount,
          subtotal,
          discountType,
          discountValue,
          discountPercent,
          discountAmount,
          taxableAmount,
          taxPercent,
          taxAmount,
          roundOff,
          total,
          notes ?? existing.notes,
          req.params.id
        );

      await db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(req.params.id);
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price, final_line_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const it of processedItems) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const partNo = it.part_no ? String(it.part_no).trim() : null;
        const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

        if (partNo || it.description) {
          const finalPart = partNo || (it.description.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 2).map((w) => w.toUpperCase().slice(0, 4)).join('-') + `-${Math.floor(1000 + Math.random() * 9000)}`);
          let existingProd = null;
          if (pId) {
            existingProd = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(pId);
          }
          if (!existingProd) {
            existingProd = await db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(finalPart);
          }
          if (!existingProd) {
            const desc = (it.description && String(it.description).trim()) ? String(it.description).trim() : finalPart;
            const newProd = await db.prepare(
              `INSERT INTO product (part_no, description, default_price, hsn_sac, unit)
               VALUES (?, ?, ?, ?, 'Nos') RETURNING id`
            ).run(
              finalPart,
              desc,
              itemPrice,
              it.hsn_sac ? String(it.hsn_sac).trim() : null
            );
            pId = newProd.lastInsertRowid;
          } else {
            pId = existingProd.id;
          }
        }

        await insertItem.run(
          req.params.id,
          pId,
          partNo,
          it.description,
          it.hsn_sac || null,
          it.make || null,
          it.qty,
          it.actual_unit_price,
          it.amount,
          it.actual_unit_price,
          it.discount_type || 'none',
          Number(it.discount_value) || 0,
          it.product_discount_amount,
          it.after_product_discount_amount,
          Number(it.overall_discount_allocated) || 0,
          it.final_unit_price,
          it.final_line_total
        );

        // Update product master default price when modified in quotation
        if (itemPrice > 0) {
          if (pId) {
            await db.prepare(`UPDATE product SET default_price = ? WHERE id = ?`).run(itemPrice, pId);
          } else if (partNo) {
            await db.prepare(`UPDATE product SET default_price = ? WHERE UPPER(part_no) = UPPER(?)`).run(itemPrice, partNo);
          }
        }
      }
    });

    apiCache.invalidateTags(['dashboard', 'products', 'companies']);
    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    console.error('Unable to save the quotation:', err);
    res.status(500).json({ error: err.message || 'Unable to save the quotation. Please try again.' });
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
      if (status === 'accepted' || status === 'rejected') {
        await db
          .prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE quotation_id = ? AND status = 'scheduled'`)
          .run(req.params.id);
      }
    });

    res.json(await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id));
  } catch (err) {
    console.error('Unable to update quotation status:', err);
    res.status(500).json({ error: err.message || 'Unable to update the quotation status. Please try again.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const quotationId = req.params.id;
    const existing = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(quotationId);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });

    await db.transaction(async () => {
      // Find all connected PIs and POs
      const pis = await db.prepare(`SELECT id FROM performa_invoice WHERE quotation_id = ?`).all(quotationId);
      const piIds = pis.map((p) => p.id);

      const pos = await db.prepare(`SELECT id FROM purchase_order WHERE quotation_id = ?`).all(quotationId);
      const poIds = pos.map((p) => p.id);

      // Unlink foreign key references in external modules
      for (const poId of poIds) {
        await db.prepare(`UPDATE sale_report SET source_po_id = NULL WHERE source_po_id = ?`).run(poId);
        await db.prepare(`UPDATE procurement_requirement SET purchase_order_id = NULL WHERE purchase_order_id = ?`).run(poId);
      }
      for (const piId of piIds) {
        await db.prepare(`UPDATE sale_report SET source_pi_id = NULL WHERE source_pi_id = ?`).run(piId);
      }
      await db.prepare(`UPDATE sale_report SET source_quotation_id = NULL WHERE source_quotation_id = ?`).run(quotationId);

      // Clean up dependent performa invoices & purchase orders
      await db.prepare(`DELETE FROM performa_invoice WHERE quotation_id = ?`).run(quotationId);
      await db.prepare(`DELETE FROM purchase_order WHERE quotation_id = ?`).run(quotationId);

      // Clean up follow ups, items, and quotation
      await db.prepare(`DELETE FROM quotation_follow_up WHERE quotation_id = ?`).run(quotationId);
      await db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(quotationId);
      await db.prepare(`DELETE FROM quotation WHERE id = ?`).run(quotationId);
    });

    res.json({ success: true, message: 'Quotation deleted successfully' });
  } catch (err) {
    console.error('Failed to delete quotation:', err);
    res.status(500).json({ error: err.message || 'Failed to delete quotation. Please try again.' });
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
    console.error('Unable to schedule follow-up:', err);
    res.status(500).json({ error: err.message || 'Unable to schedule the follow-up. Please try again.' });
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
    console.error('Error fetching follow-ups:', err);
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
    console.error('Unable to complete follow-up:', err);
    res.status(500).json({ error: err.message || 'Unable to complete the follow-up. Please try again.' });
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
    console.error('Unable to cancel follow-up:', err);
    res.status(500).json({ error: err.message || 'Unable to cancel the follow-up. Please try again.' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const quotation = await db
      .prepare(
        `SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state,
                c.gstin AS company_gstin, c.phone AS company_phone,
                e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code
         FROM quotation q
         JOIN company c ON c.id = q.company_id
         LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
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
    console.error('Error streaming quotation PDF:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
