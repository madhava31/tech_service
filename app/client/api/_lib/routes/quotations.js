import { Router } from 'express';
import db from '../db/index.js';
import { nextNumber } from '../db/numbering.js';
import { streamQuotationPdfV2 } from '../pdf/quotationPdf.js';
import { quotationUnitReady, cleanUnit, quotationItemsWithUnit } from '../quotations/quotationUnit.js';
import { requireQuotationModule, buildQuotation, nextQuotationNumber, headerValues, insertItems, cleanFeatures } from '../quotations/module.js';
import apiCache from '../cache/apiCache.js';
import { sendRouteError } from '../http/errors.js';
import { readLumpSum, splitLumpSum, savePricingMode } from '../quotations/lumpSum.js';
import { readInstrument, saveInstrument } from '../quotations/instrument.js';
import { requirePoReceived, listPos, createPo, deletePo, updatePo } from '../quotations/poReceived.js';
import { requireInvoices, listInvoices, createInvoice, deleteInvoice, invoiceStock, invoicesReady, restoreInvoiceStock } from '../quotations/invoices.js';
import { resolveUserId } from '../db/inventorySchema.js';
import { NEGOTIATION, ALL_STATUSES, EDITABLE_STATUSES, MODULE_EDITABLE_STATUSES, statusChangeError, takeRevisionSnapshot, dropUnchangedRevision, listRevisions } from '../quotations/negotiation.js';
import { requireSalesTeam, getSalesTeam, saveSalesTeam, validateTeam, setTeamFromIds, salesTeamReady } from '../quotations/salesTeam.js';
import { defaultTerms, saveCustomTerms, storedTerms } from '../quotations/terms.js';
import { collectPdf } from '../pdf/pdfBuffer.js';
import { createSendEmailHandler, requireAdminRole } from '../mail/sendEmailHandler.js';
import { getMailProvider, getSender } from '../mail/index.js';
import { createSendGuard } from '../mail/sendGuard.js';
import { emailLog, requireEmailLog } from '../mail/emailLog.js';
import { applyQuotationContactAndTerms, paymentsReady, requirePayments, getQuotationPayments, recordPayment, paymentTermsText } from '../payments/service.js';

const router = Router();

// Sales people see and change only the quotations they created; admins see all. One check for
// every route that takes a quotation id, so no single route can forget it. A quotation that is not
// yours answers 404, exactly like one that does not exist.
const isAdmin = (req) => req.user?.role === 'admin';
async function ownQuotationParam(req, res, next, id) {
  try {
    if (isAdmin(req) || !/^\d+$/.test(String(id))) return next();
    const row = await db.prepare(`SELECT created_by_user_id FROM quotation WHERE id = ?`).get(id);
    if (row && Number(row.created_by_user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'Quotation not found' });
    next();
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
}
router.param('id', ownQuotationParam);
router.param('quotationId', ownQuotationParam);

/** Requests from the quotation module's form carry a `terms` list; older callers do not. */
const isModuleRequest = (body) => Array.isArray(body?.terms);
const moduleGuard = (req, res, next) => (isModuleRequest(req.body) ? requireQuotationModule(req, res, next) : next());

const LIST_COLUMNS = `q.*, c.name AS company_name, e.name AS sales_engineer_name, u.username AS created_by_username,
           (SELECT COUNT(*) FROM performa_invoice pi WHERE pi.quotation_id = q.id)::int AS pi_count,
           (SELECT string_agg(qi.part_no, ', ' ORDER BY qi.id) FROM quotation_item qi WHERE qi.quotation_id = q.id) AS items_part_nos`;

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
    sendRouteError(res, err, 400, 'Failed to calculate pricing');
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
    sendRouteError(res, err, 500, 'Failed to analyze quotation stock');
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
    sendRouteError(res, err, 500, 'Failed to analyze quotation stock');
  }
});

// GET /api/quotations/next-number - preview next sequential quotation number
router.get('/next-number', async (req, res) => {
  try {
    let prefix = req.query.prefix ? String(req.query.prefix).trim().toUpperCase() : null;
    const firmId = req.query.firmId ? Number(req.query.firmId) : null;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;

    if (!prefix && branchId) {
      const branch = await db.prepare(`SELECT quotation_prefix FROM branch WHERE id = ?`).get(branchId);
      if (branch?.quotation_prefix) prefix = branch.quotation_prefix.trim().toUpperCase();
    }
    if (!prefix && firmId) {
      const firm = await db.prepare(`SELECT quotation_prefix, firm_code, firm_name FROM firm WHERE id = ?`).get(firmId);
      if (firm?.quotation_prefix) {
        prefix = firm.quotation_prefix.trim().toUpperCase();
      } else if (
        (firm?.firm_code && firm.firm_code.toUpperCase().includes('AP')) ||
        (firm?.firm_name && firm.firm_name.toUpperCase().includes('AP'))
      ) {
        prefix = 'TSAPQOT';
      }
    }
    if (!prefix) {
      const settings = await db.prepare(`SELECT quotation_prefix FROM company_settings WHERE id = 1`).get();
      prefix = settings?.quotation_prefix || 'TSQOT';
    }
    const date = req.query.date ? String(req.query.date).slice(0, 10) : undefined;
    const number = await nextNumber(prefix, 'quotation', date);
    res.json({ number, prefix });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to get next quotation number');
  }
});

router.get('/', async (req, res) => {
  try {
    const isPaginated = req.query.page !== undefined || req.query.pageSize !== undefined || req.query.paginated === 'true';

    if (!isPaginated) {
      const rows = await db
        .prepare(
          `SELECT ${LIST_COLUMNS}
           FROM quotation q
           JOIN company c ON c.id = q.company_id
           LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
           LEFT JOIN app_user u ON u.id = q.created_by_user_id
           ${isAdmin(req) ? '' : 'WHERE q.created_by_user_id = ?'}
           ORDER BY q.id DESC`
        )
        .all(...(isAdmin(req) ? [] : [req.user.id]));
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
    if (!isAdmin(req)) {
      whereClauses.push(`q.created_by_user_id = ?`);
      params.push(req.user.id);
    } else if (req.query.createdBy && /^\d+$/.test(String(req.query.createdBy))) {
      whereClauses.push(`q.created_by_user_id = ?`);
      params.push(Number(req.query.createdBy));
    }
    // The sales person named on the quotation (the sales engineer), as shown in the "Sales person" column.
    if (isAdmin(req) && req.query.salesEngineerId && /^\d+$/.test(String(req.query.salesEngineerId))) {
      whereClauses.push(`q.sales_engineer_id = ?`);
      params.push(Number(req.query.salesEngineerId));
    }

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
        `SELECT ${LIST_COLUMNS}
         FROM quotation q
         JOIN company c ON c.id = q.company_id
         LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
         LEFT JOIN app_user u ON u.id = q.created_by_user_id
         ${whereSql}
         ORDER BY q.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...itemsParams);

    // Global stage counts aggregated in database
    const stageCounts = { All: 0, Draft: 0, Sent: 0, Negotiation: 0, Accepted: 0, 'PO received': 0, Rejected: 0 };
    const globalCountRows = isAdmin(req)
      ? await db.prepare(`SELECT status, COUNT(*) AS count FROM quotation GROUP BY status`).all()
      : await db.prepare(`SELECT status, COUNT(*) AS count FROM quotation WHERE created_by_user_id = ? GROUP BY status`).all(req.user.id);
    let totalAll = 0;
    for (const r of globalCountRows) {
      const c = Number(r.count || 0);
      totalAll += c;
      if (r.status === 'draft') stageCounts.Draft = c;
      else if (r.status === 'sent') stageCounts.Sent = c;
      else if (r.status === NEGOTIATION) stageCounts.Negotiation = c;
      else if (r.status === 'accepted') { stageCounts.Accepted = c; stageCounts['PO received'] = c; }
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

const QUOTATION_DETAIL_SELECT = `
  SELECT q.*, c.name AS company_name, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin,
         c.phone AS company_phone, c.email AS company_email,
         e.name AS sales_engineer_name, e.employee_code AS sales_engineer_code,
         e.phone AS sales_engineer_phone, e.email AS sales_engineer_email,
         u.username AS created_by_username,
         (SELECT COUNT(*) FROM performa_invoice pi WHERE pi.quotation_id = q.id)::int AS pi_count,
         f.firm_name, f.firm_code, f.legal_name AS firm_legal_name,
         f.address_line_1 AS firm_address_line_1, f.address_line_2 AS firm_address_line_2,
         f.city AS firm_city, f.state AS firm_state, f.pincode AS firm_pincode,
         f.gstin AS firm_gstin, f.pan AS firm_pan, f.email AS firm_email, f.phone AS firm_phone,
         f.quotation_prefix AS firm_quotation_prefix,
         b.branch_name, b.branch_code,
         b.address_line_1 AS branch_address_line_1, b.address_line_2 AS branch_address_line_2,
         b.city AS branch_city, b.state AS branch_state, b.pincode AS branch_pincode,
         b.phone AS branch_phone, b.email AS branch_email, b.gstin AS branch_gstin,
         b.quotation_prefix AS branch_quotation_prefix,
         -- branch_document_settings has header_text (not document_header_title) and no address column;
         -- the branch address is built from the branch/firm columns in enrichQuotationFirm().
         bds.header_text AS document_header_title, NULL::text AS branch_doc_address,
         bds.authorized_signatory AS branch_signatory,
         bds.bank_name AS branch_bank_name, bds.account_number AS branch_bank_account_no,
         bds.ifsc_code AS branch_bank_ifsc, bds.terms_conditions AS branch_terms
  FROM quotation q
  JOIN company c ON c.id = q.company_id
  LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
  LEFT JOIN app_user u ON u.id = q.created_by_user_id
  LEFT JOIN firm f ON f.id = q.firm_id
  LEFT JOIN branch b ON b.id = q.branch_id
  LEFT JOIN branch_document_settings bds ON bds.branch_id = b.id
`;

function enrichQuotationFirm(quotation) {
  if (!quotation) return quotation;
  const parts = [
    quotation.branch_doc_address,
    [quotation.branch_address_line_1, quotation.branch_address_line_2, quotation.branch_city, quotation.branch_state, quotation.branch_pincode].filter(Boolean).join(', '),
    [quotation.firm_address_line_1, quotation.firm_address_line_2, quotation.firm_city, quotation.firm_state, quotation.firm_pincode].filter(Boolean).join(', ')
  ].filter(Boolean);
  return {
    ...quotation,
    firm_address: parts[0] || null,
  };
}

/**
 * GET /api/quotations/terms-defaults?advance_percent=&payment_due_days=&tax_percent=  (tax_percent=0 is "No GST": adds "GST: 18% extra")
 * The standard Terms & Conditions the quotation form shows (and the PDF prints unless the user edits them).
 * Registered before '/:id' so "terms-defaults" is not read as a quotation id.
 */
router.get('/terms-defaults', async (req, res) => {
  try {
    const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
    const adv = req.query.advance_percent;
    const days = req.query.payment_due_days;
    const q = {
      advance_percent: adv !== undefined && adv !== '' && Number.isFinite(Number(adv)) ? Number(adv) : undefined,
      payment_due_days: days !== undefined && days !== '' && Number.isFinite(Number(days)) ? Number(days) : undefined,
      tax_percent: req.query.tax_percent !== undefined && req.query.tax_percent !== '' && Number.isFinite(Number(req.query.tax_percent)) ? Number(req.query.tax_percent) : undefined,
    };
    res.json({ terms: defaultTerms(q, settings) });
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rawQuotation = await db
      .prepare(`${QUOTATION_DETAIL_SELECT} WHERE q.id = ?`)
      .get(req.params.id);
    if (!rawQuotation) return res.status(404).json({ error: 'Quotation not found' });
    const quotation = enrichQuotationFirm(rawQuotation);
    // unit comes from the product (Nos, Pkt, ...), for the Unit column of the quotation table and PDF.
    const items = await quotationItemsWithUnit(req.params.id);
    // Payment schedule and payments received, once migration 004 has been applied.
    const payment = (await paymentsReady()) ? await getQuotationPayments(req.params.id) : null;
    res.json({
      ...quotation,
      items,
      payment_schedule: payment?.schedule ?? null,
      payments: payment?.payments ?? [],
      sales_team: await getSalesTeam(req.params.id),
      sales_team_available: await salesTeamReady(),
    });
  } catch (err) {
    console.error('Error fetching quotation by ID:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', moduleGuard, async (req, res) => {
  if (isModuleRequest(req.body)) return createModuleQuotation(req, res);
  try {
    const { company_id, company_name, date, tax_percent, notes, discount_type, discount_value, overall_discount_type, overall_discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    // "Add total amount": one total for all items, split across the lines (quotations/lumpSum.js).
    const lumpSum = await readLumpSum(req.body);
    await readInstrument(req.body);
    const items = lumpSum && Array.isArray(req.body.items) && req.body.items.length ? splitLumpSum(req.body.items, lumpSum) : req.body.items;
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
      let number = req.body.number !== undefined && req.body.number !== null ? String(req.body.number).trim() : '';
      if (number) {
        if (number.length > 40) {
          throw Object.assign(new Error('The quotation number can be at most 40 characters'), { status: 400 });
        }
        const clash = await db.prepare(`SELECT id FROM quotation WHERE UPPER(number) = UPPER(?)`).get(number);
        if (clash) {
          throw Object.assign(new Error(`Quotation number ${number} is already used by another quotation`), { status: 409 });
        }
      } else {
        let prefix = null;
        if (branch_id) {
          const br = await db.prepare(`SELECT quotation_prefix FROM branch WHERE id = ?`).get(branch_id);
          if (br?.quotation_prefix) prefix = br.quotation_prefix.trim().toUpperCase();
        }
        if (!prefix && firm_id) {
          const fm = await db.prepare(`SELECT quotation_prefix, firm_code, firm_name FROM firm WHERE id = ?`).get(firm_id);
          if (fm?.quotation_prefix) {
            prefix = fm.quotation_prefix.trim().toUpperCase();
          } else if (
            (fm?.firm_code && fm.firm_code.toUpperCase().includes('AP')) ||
            (fm?.firm_name && fm.firm_name.toUpperCase().includes('AP'))
          ) {
            prefix = 'TSAPQOT';
          }
        }
        if (!prefix) {
          const settings = await db.prepare(`SELECT quotation_prefix FROM company_settings WHERE id = 1`).get();
          prefix = settings?.quotation_prefix || 'TSQOT';
        }
        number = await nextNumber(prefix, 'quotation', date);
      }
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
      await savePricingMode(qId, req.body, lumpSum);
      await applyQuotationContactAndTerms(qId, finalCompanyId, req.body, req.user.id, { isNew: true });
      if (req.body.custom_terms !== undefined) await saveCustomTerms(qId, req.body.custom_terms);
      if (Array.isArray(req.body.co_sales_engineer_ids) && req.body.co_sales_engineer_ids.length) {
        await setTeamFromIds(qId, sales_engineer_id, req.body.co_sales_engineer_ids);
      }
      // The line's unit (migration 015) is saved once the column exists.
      const withUnit = await quotationUnitReady();
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price, final_line_total, key_features${withUnit ? ', unit' : ''}
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb${withUnit ? ', ?' : ''})`
      );

      for (const it of processedItems) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const partNo = it.part_no ? String(it.part_no).trim() : null;
        // A split of a lump-sum total is not a real unit price, so it never becomes the catalogue price.
        const itemPrice = lumpSum ? 0 : Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

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
          it.final_line_total,
          // Key features typed on the form for this line; null when the caller sent none (older callers).
          Array.isArray(it.key_features) || typeof it.key_features === 'string' ? JSON.stringify(cleanFeatures(it.key_features)) : null,
          ...(withUnit ? [cleanUnit(it.unit)] : [])
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
      await saveInstrument(qId, req.body);
      return qId;
    });

    apiCache.invalidateTags(['dashboard', 'products', 'companies']);
    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotationId);
    res.status(201).json(row);
  } catch (err) {
    console.error('Unable to create the quotation:', err);
    if (err?.status === 503) return res.status(503).json({ error: err.message, code: 'MIGRATION_REQUIRED' });
    sendRouteError(res, err, 500, 'Unable to create the quotation. Please try again.');
  }
});

router.put('/:id', moduleGuard, async (req, res) => {
  if (isModuleRequest(req.body)) return updateModuleQuotation(req, res);
  try {
    const existing = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    if (!EDITABLE_STATUSES.includes(existing.status)) return res.status(400).json({ error: 'A quotation with a received PO cannot be edited. Remove the PO first.' });

    const { company_id, company_name, date, tax_percent, notes, discount_type, discount_value, sales_engineer_id, firm_id, branch_id } = req.body;
    const lumpSum = await readLumpSum(req.body);
    await readInstrument(req.body);
    // The quotation number can be changed while editing; it must stay unique.
    const newNumber = req.body.number !== undefined && req.body.number !== null ? String(req.body.number).trim() : null;
    if (newNumber !== null) {
      if (!newNumber) return res.status(400).json({ error: 'Please enter the quotation number' });
      if (newNumber.length > 40) return res.status(400).json({ error: 'The quotation number can be at most 40 characters' });
      const clash = await db.prepare(`SELECT id FROM quotation WHERE UPPER(number) = UPPER(?) AND id <> ?`).get(newNumber, req.params.id);
      if (clash) return res.status(409).json({ error: `Quotation number ${newNumber} is already used by another quotation` });
    }
    const items = lumpSum && Array.isArray(req.body.items) && req.body.items.length ? splitLumpSum(req.body.items, lumpSum) : req.body.items;
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
      await savePricingMode(req.params.id, req.body, lumpSum);
      if (newNumber && newNumber !== existing.number) {
        await db.prepare(`UPDATE quotation SET number = ? WHERE id = ?`).run(newNumber, req.params.id);
      }
      await applyQuotationContactAndTerms(req.params.id, finalCompanyId, req.body, req.user.id);
      if (req.body.custom_terms !== undefined) await saveCustomTerms(req.params.id, req.body.custom_terms);
      if (Array.isArray(req.body.co_sales_engineer_ids)) {
        const primary = sales_engineer_id !== undefined ? sales_engineer_id : existing.sales_engineer_id;
        await setTeamFromIds(req.params.id, primary, req.body.co_sales_engineer_ids);
      }

      await db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(req.params.id);
      // The line's unit (migration 015) is saved once the column exists.
      const withUnit = await quotationUnitReady();
      const insertItem = db.prepare(
        `INSERT INTO quotation_item (
          quotation_id, product_id, part_no, description, hsn_sac, make, qty, price, amount,
          actual_unit_price, discount_type, discount_value, product_discount_amount,
          after_product_discount_amount, overall_discount_allocated, final_unit_price, final_line_total, key_features${withUnit ? ', unit' : ''}
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb${withUnit ? ', ?' : ''})`
      );

      for (const it of processedItems) {
        let pId = it.product_id ? Number(it.product_id) : null;
        const partNo = it.part_no ? String(it.part_no).trim() : null;
        // A split of a lump-sum total is not a real unit price, so it never becomes the catalogue price.
        const itemPrice = lumpSum ? 0 : Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;

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
          it.final_line_total,
          // Key features typed on the form for this line; null when the caller sent none (older callers).
          Array.isArray(it.key_features) || typeof it.key_features === 'string' ? JSON.stringify(cleanFeatures(it.key_features)) : null,
          ...(withUnit ? [cleanUnit(it.unit)] : [])
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
      await saveInstrument(req.params.id, req.body);
    });

    apiCache.invalidateTags(['dashboard', 'products', 'companies']);
    const row = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    console.error('Unable to save the quotation:', err);
    if (err?.code === '23505') return res.status(409).json({ error: 'That quotation number is already used by another quotation' });
    if (err?.status === 503) return res.status(503).json({ error: err.message, code: 'MIGRATION_REQUIRED' });
    sendRouteError(res, err, 500, 'Unable to save the quotation. Please try again.');
  }
});

router.post('/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    const blocked = statusChangeError(existing.status, status);
    if (blocked) return res.status(400).json({ error: blocked });
    const noteText = typeof note === 'string' ? note.trim().slice(0, 500) : '';

    await db.transaction(async () => {
      // Price negotiation: the version that was sent is saved as a revision before it is changed (history, migration 010).
      if (status === NEGOTIATION && existing.status !== NEGOTIATION) await takeRevisionSnapshot(req.params.id, req.user?.id, noteText);
      if (existing.status === NEGOTIATION && status === 'sent') await dropUnchangedRevision(req.params.id);
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
    sendRouteError(res, err, 500, 'Unable to update the quotation status. Please try again.');
  }
});

// GET /api/quotations/:id/revisions : the negotiation history (the versions that were sent before each round).
router.get('/:id/revisions', async (req, res) => {
  try {
    const found = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.id);
    if (!found) return res.status(404).json({ error: 'Quotation not found' });
    res.json(await listRevisions(Number(req.params.id)));
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const quotationId = req.params.id;
    const existing = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(quotationId);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    const stockUserId = await resolveUserId(req.user);

    await db.transaction(async () => {
      // The invoices of this quotation go with it, so the stock they took out of the warehouse must come back first.
      if (await invoicesReady()) {
        const invoices = await db.prepare(`SELECT id, invoice_number FROM quotation_invoice WHERE quotation_id = ?`).all(quotationId);
        await restoreInvoiceStock(invoices, stockUserId, 'removed (quotation deleted)');
      }

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
    sendRouteError(res, err, 500, 'Failed to delete quotation. Please try again.');
  }
});

// ---------- Payments received ----------
// The schedule (advance due after the PO, balance after the PI) is worked out in payments/service.js.
router.get('/:id/payments', requirePayments, async (req, res) => {
  try {
    const result = await getQuotationPayments(req.params.id);
    if (!result) return res.status(404).json({ error: 'Quotation not found' });
    res.json(result);
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to load the payments. Please try again.');
  }
});

router.post('/:id/payments', requirePayments, async (req, res) => {
  try {
    const quotation = await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    await recordPayment(req.params.id, req.body, req.user.id);
    res.status(201).json(await getQuotationPayments(req.params.id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to record the payment. Please try again.');
  }
});

router.delete('/:id/payments/:paymentId', requirePayments, async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Only an administrator can delete a payment' });
    const info = await db
      .prepare(`DELETE FROM quotation_payment WHERE id = ? AND quotation_id = ?`)
      .run(Number(req.params.paymentId), req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Payment not found' });
    res.json(await getQuotationPayments(req.params.id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to delete the payment. Please try again.');
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
    sendRouteError(res, err, 500, 'Unable to schedule the follow-up. Please try again.');
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
    sendRouteError(res, err, 500, 'Unable to complete the follow-up. Please try again.');
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
    sendRouteError(res, err, 500, 'Unable to cancel the follow-up. Please try again.');
  }
});

/**
 * Maps a quotation saved before the quotation module onto the approved PDF layout:
 *   terms        from the company settings the old PDF printed (payment, delivery, validity)
 *   key features from the product's catalogue entry, when it has any
 *   discount %   from the stored prices when the line used a flat amount
 *   totals       the stored taxable amount, GST and grand total (old overall discounts included)
 */
async function legacyForApprovedLayout(quotation, items, settings = {}) {
  const ids = [...new Set(items.map((it) => it.product_id).filter(Boolean))];
  // to_jsonb(p) works whether or not migration 002 (product.key_features) has been applied.
  const rows = ids.length
    ? await db.prepare(`SELECT p.id, to_jsonb(p) -> 'key_features' AS key_features FROM product p WHERE p.id = ANY(?::int[])`).all(ids)
    : [];
  const featuresById = new Map(rows.map((r) => [r.id, Array.isArray(r.key_features) ? r.key_features : []]));
  const lines = items.map((it) => {
    const listPrice = Number(it.actual_unit_price ?? it.price ?? 0);
    const unit = Number(it.final_unit_price ?? listPrice);
    const qty = Number(it.qty || 0);
    const pct = it.discount_type === 'percentage' ? Number(it.discount_value || 0) : listPrice > 0 ? Math.max(0, (1 - unit / listPrice) * 100) : 0;
    return {
      ...it,
      product_name: it.product_name || it.description,
      key_features: Array.isArray(it.key_features) ? it.key_features : featuresById.get(it.product_id) || [],
      discount_value: Math.round(pct * 100) / 100,
      final_unit_price: unit,
      final_line_total: Number(it.final_line_total ?? it.amount ?? unit * qty),
    };
  });
  // Payment terms set on the quotation (migration 004) win over the global text in settings.
  const terms = defaultTerms(quotation, settings);
  return {
    quotation: { ...quotation, terms, subtotal: Number(quotation.subtotal_after_product_discounts ?? quotation.subtotal ?? 0) },
    items: lines,
  };
}

/**
 * What the PDF prints: the approved layout of the quotation, with the terms the user edited on the form when it has any,
 * else the standard terms (payment, delivery, validity).
 */
export async function printableForPdf(quotation, items, settings) {
  const base = await legacyForApprovedLayout(quotation, items, settings);
  const edited = storedTerms(quotation.terms);
  return edited === null ? base : { ...base, quotation: { ...base.quotation, terms: edited } };
}

router.get('/:id/pdf', async (req, res) => {
  try {
    const rawQuotation = await db
      .prepare(`${QUOTATION_DETAIL_SELECT} WHERE q.id = ?`)
      .get(req.params.id);
    if (!rawQuotation) return res.status(404).json({ error: 'Quotation not found' });
    const quotation = enrichQuotationFirm(rawQuotation);
    // unit comes from the product (Nos, Pkt, ...), for the Unit column of the quotation table and PDF.
    const items = await quotationItemsWithUnit(req.params.id);
    const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();

    // Every quotation prints in the approved layout. A quotation saved before the quotation module
    // has no terms or key-feature snapshot, so those are filled in for printing (nothing is saved).
    const printable = await printableForPdf(quotation, items, settings);

    // "Special terms and notes" typed on the quotation form print under the standard terms.
    const special = String(printable.quotation.notes || '').trim();
    if (special) {
      const base = Array.isArray(printable.quotation.terms) ? printable.quotation.terms : [];
      if (!base.some((t) => String(t?.text || '').trim() === special)) {
        printable.quotation = { ...printable.quotation, terms: [...base, { label: 'Special terms', text: special }] };
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${quotation.number.replace(/\//g, '-')}.pdf"`);
    streamQuotationPdfV2(res, { ...printable, settings });
  } catch (err) {
    console.error('Error streaming quotation PDF:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Send a quotation by email (separate from View / Download PDF) ----------
// POST /api/quotations/:id/send-email  (admin only). The PDF route above is not touched: this loads the
// same data the same way (a deliberate copy of its preparation steps, so that route stays exactly as it
// is) and generates the PDF into memory with the same streamQuotationPdfV2.
async function loadQuotationForEmail(id) {
  const rawQuotation = await db.prepare(`${QUOTATION_DETAIL_SELECT} WHERE q.id = ?`).get(id);
  if (!rawQuotation) return null;
  const quotation = enrichQuotationFirm(rawQuotation);
  const items = await quotationItemsWithUnit(id);
  const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get();
  let printable = await printableForPdf(quotation, items, settings);
  const special = String(printable.quotation.notes || '').trim();
  if (special) {
    const base = Array.isArray(printable.quotation.terms) ? printable.quotation.terms : [];
    if (!base.some((t) => String(t?.text || '').trim() === special)) {
      printable = { ...printable, quotation: { ...printable.quotation, terms: [...base, { label: 'Special terms', text: special }] } };
    }
  }
  return { number: quotation.number, printable, settings };
}

const sendEmailHandler = createSendEmailHandler({
  loadQuotation: loadQuotationForEmail,
  renderPdf: (q, { maxBytes }) => collectPdf((sink) => streamQuotationPdfV2(sink, { ...q.printable, settings: q.settings }), { maxBytes }),
  getProvider: getMailProvider,
  getSender,
  log: emailLog,
  guard: createSendGuard(),
});
router.post('/:id/send-email', requireAdminRole, requireEmailLog, sendEmailHandler);

// PO received (migration 008): the customer POs of a quotation, typed by hand, with the items each one ordered.
// The sales people who worked on a quotation and each one's share of the sales target (migration 011).
router.get('/:id/sales-team', requireSalesTeam, async (req, res) => {
  try {
    res.json({ members: await getSalesTeam(req.params.id) });
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
});

router.put('/:id/sales-team', requireSalesTeam, async (req, res) => {
  try {
    const q = await db.prepare(`SELECT id, sales_engineer_id FROM quotation WHERE id = ?`).get(req.params.id);
    if (!q) return res.status(404).json({ error: 'Quotation not found' });
    const members = validateTeam(req.body?.members, q.sales_engineer_id);
    const known = await db.prepare(`SELECT id FROM sales_engineer WHERE id = ANY(?::int[])`).all(`{${members.map((m) => m.sales_engineer_id).join(',')}}`);
    if (known.length !== members.length) return res.status(400).json({ error: 'One of the sales people does not exist.' });
    await db.transaction(async () => { await saveSalesTeam(q.id, members); });
    apiCache.invalidateTags(['dashboard']);
    res.json({ members: await getSalesTeam(q.id) });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the sales team. Please try again.');
  }
});

router.get('/:id/po-received', requirePoReceived, listPos);
router.post('/:id/po-received', requirePoReceived, createPo);
router.put('/:id/po-received/:poId', requirePoReceived, updatePo);
router.delete('/:id/po-received/:poId', requirePoReceived, deletePo);
// Invoices (migration 012): number, date, items billed and the payment due date.
router.get('/:id/invoices', requireInvoices, listInvoices);
router.get('/:id/invoice-stock', requireInvoices, invoiceStock);
router.post('/:id/invoices', requireInvoices, createInvoice);
router.delete('/:id/invoices/:invoiceId', requireInvoices, deleteInvoice);

async function createModuleQuotation(req, res) {
  try {
    const q = await buildQuotation(req.body);
    const id = await db.transaction(async () => {
      let number = req.body.number !== undefined && req.body.number !== null ? String(req.body.number).trim() : '';
      if (number) {
        if (number.length > 40) {
          throw Object.assign(new Error('The quotation number can be at most 40 characters'), { status: 400 });
        }
        const clash = await db.prepare(`SELECT id FROM quotation WHERE UPPER(number) = UPPER(?)`).get(number);
        if (clash) {
          throw Object.assign(new Error(`Quotation number ${number} is already used by another quotation`), { status: 409 });
        }
      } else {
        number = await nextQuotationNumber(q.date);
      }
      const info = await db
        .prepare(
          `INSERT INTO quotation (
             number, status, created_by_user_id,
             company_id, date, contact_person, opportunity_ref, terms,
             gross_subtotal, product_discount_total, subtotal_after_product_discounts, net_subtotal, subtotal,
             taxable_amount, tax_percent, tax_amount, total,
             overall_discount_type, overall_discount_value, overall_discount_amount,
             discount_type, discount_value, discount_percent, discount_amount, round_off, notes
           ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 0, 0, 'percentage', 0, 0, 0, 0, '') RETURNING id`
        )
        .run(number, req.user.id, ...headerValues(q));
      await insertItems(info.lastInsertRowid, q.items);
      return info.lastInsertRowid;
    });
    apiCache.invalidateTags(['dashboard', 'quotations', 'companies']);
    res.status(201).json(await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to create the quotation. Please try again.');
  }
}

async function updateModuleQuotation(req, res) {
  try {
    const existing = await db.prepare(`SELECT id, status FROM quotation WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quotation not found' });
    // Accepted/rejected quotations back purchase orders and invoices that print these lines.
    if (!MODULE_EDITABLE_STATUSES.includes(existing.status)) {
      return res.status(400).json({ error: `A quotation that is ${existing.status} cannot be edited.` });
    }
    const q = await buildQuotation(req.body);
    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE quotation SET
             company_id = ?, date = ?, contact_person = ?, opportunity_ref = ?, terms = ?::jsonb,
             gross_subtotal = ?, product_discount_total = ?, subtotal_after_product_discounts = ?, net_subtotal = ?, subtotal = ?,
             taxable_amount = ?, tax_percent = ?, tax_amount = ?, total = ?,
             overall_discount_type = 'none', overall_discount_value = 0, overall_discount_amount = 0,
             discount_type = 'percentage', discount_value = 0, discount_percent = 0, discount_amount = 0, round_off = 0
           WHERE id = ?`
        )
        .run(...headerValues(q), req.params.id);
      await db.prepare(`DELETE FROM quotation_item WHERE quotation_id = ?`).run(req.params.id);
      await insertItems(req.params.id, q.items);
    });
    apiCache.invalidateTags(['dashboard', 'quotations', 'companies']);
    res.json(await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(req.params.id));
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the quotation. Please try again.');
  }
}

export default router;
