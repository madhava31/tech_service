import db from '../db/index.js';

// Postgres port of the legacy SQLite sales order / pending work / reports services
// (app/server/src/services/salesService.js). Response shapes match the frontend types in
// app/client/src/api.ts (SalesOrdersListResponse, SalesOrderDetailResponse, ...).
// Related rows are fetched in batches instead of one query per order.

const num = (v) => Number(v) || 0;

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Workflow status of an order, derived without changing stored statuses. */
export function deriveSalesOrderStatus({ quotationStatus, hasPo, hasPi, saleReports = [], totalOrdered = 0, totalDispatched = 0 }) {
  if (quotationStatus === 'draft') return 'QUOTATION_DRAFT';
  if (quotationStatus === 'sent') return 'AWAITING_CUSTOMER';
  if (quotationStatus === 'rejected') return 'QUOTATION_REJECTED';

  const isFullyDispatched = totalOrdered > 0 && totalDispatched >= totalOrdered;
  const isPartiallyDispatched = totalDispatched > 0 && totalDispatched < totalOrdered;

  if (isFullyDispatched) return 'COMPLETED';
  if (isPartiallyDispatched) return 'PARTIALLY_DISPATCHED';
  if (saleReports.length > 0) return 'READY_TO_DISPATCH';
  if (hasPi) return 'PI_CREATED';
  if (hasPo) return 'PO_CREATED';
  return 'ORDER_CONFIRMED';
}

/** Stock status of a line: AVAILABLE = ON_HAND - RESERVED. */
export function calculateLineStockStatus(qtyRequired, availableQty) {
  const req = Number(qtyRequired) || 0;
  const avail = Number(availableQty) || 0;
  if (avail >= req) return 'IN_STOCK';
  if (avail > 0) return 'PARTIALLY_AVAILABLE';
  return 'OUT_OF_STOCK';
}

/** Stock totals across all warehouses, keyed by product id. */
async function stockByProduct(productIds) {
  const ids = [...new Set(productIds.filter(Boolean).map(Number))];
  if (!ids.length) return new Map();
  const rows = await db
    .prepare(
      `SELECT product_id,
              COALESCE(SUM(on_hand_quantity), 0) AS on_hand,
              COALESCE(SUM(reserved_quantity), 0) AS reserved,
              COALESCE(SUM(incoming_quantity), 0) AS incoming
       FROM inventory_stock WHERE product_id = ANY(?::int[])
       GROUP BY product_id`
    )
    .all(ids);
  return new Map(rows.map((r) => [Number(r.product_id), { onHand: num(r.on_hand), reserved: num(r.reserved), incoming: num(r.incoming) }]));
}

export async function getSalesOrders({ q = null, status = null, companyId = null, startDate = null, endDate = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT
      po.id AS id, po.id AS po_id, po.number AS po_number, po.date AS po_date, po.client_po_ref,
      po.created_at AS po_created_at,
      q.id AS quotation_id, q.number AS quotation_number, q.date AS quotation_date, q.status AS quotation_status,
      q.total AS total_amount, q.taxable_amount, q.tax_amount,
      c.id AS company_id, c.name AS company_name, c.email AS company_email, c.phone AS company_phone,
      pi.id AS pi_id, pi.number AS pi_number, pi.date AS pi_date
    FROM purchase_order po
    JOIN quotation q ON q.id = po.quotation_id
    JOIN company c ON c.id = q.company_id
    LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
    WHERE 1=1`;
  const params = [];
  if (companyId) { sql += ` AND c.id = ?`; params.push(companyId); }
  if (startDate) { sql += ` AND po.date >= ?`; params.push(startDate); }
  if (endDate) { sql += ` AND po.date <= ?`; params.push(endDate); }
  if (q) {
    sql += ` AND (po.number ILIKE ? OR q.number ILIKE ? OR pi.number ILIKE ? OR c.name ILIKE ? OR po.client_po_ref ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s, s);
  }
  sql += ` ORDER BY po.id DESC`;
  const rows = await db.prepare(sql).all(...params);

  const poIds = rows.map((r) => r.po_id);
  const qIds = [...new Set(rows.map((r) => r.quotation_id))];
  const [reports, ordered, dispatched] = rows.length
    ? await Promise.all([
        db.prepare(
          `SELECT id, report_number, status, total_amount, sale_date, source_po_id, source_quotation_id
           FROM sale_report WHERE source_po_id = ANY(?::int[]) OR source_quotation_id = ANY(?::int[])`
        ).all(poIds, qIds),
        db.prepare(`SELECT quotation_id, COALESCE(SUM(qty), 0) AS total_qty FROM quotation_item WHERE quotation_id = ANY(?::int[]) GROUP BY quotation_id`).all(qIds),
        db.prepare(
          `SELECT sr.id AS sale_report_id, sr.source_po_id, sr.source_quotation_id, COALESCE(SUM(sri.quantity), 0) AS qty
           FROM sale_report_item sri JOIN sale_report sr ON sr.id = sri.sale_report_id
           WHERE sr.status = 'CONFIRMED' AND (sr.source_po_id = ANY(?::int[]) OR sr.source_quotation_id = ANY(?::int[]))
           GROUP BY sr.id, sr.source_po_id, sr.source_quotation_id`
        ).all(poIds, qIds),
      ])
    : [[], [], []];
  const orderedByQ = new Map(ordered.map((r) => [r.quotation_id, num(r.total_qty)]));

  const orders = rows.map((row) => {
    const matches = (r) => r.source_po_id === row.po_id || r.source_quotation_id === row.quotation_id;
    const saleReports = reports.filter(matches).map(({ source_po_id, source_quotation_id, ...sr }) => sr);
    const totalOrdered = orderedByQ.get(row.quotation_id) || 0;
    const totalDispatched = dispatched.filter(matches).reduce((s, r) => s + num(r.qty), 0);
    const derivedStatus = deriveSalesOrderStatus({
      quotationStatus: row.quotation_status, hasPo: Boolean(row.po_id), hasPi: Boolean(row.pi_id), saleReports, totalOrdered, totalDispatched,
    });
    return { ...row, derivedStatus, totalOrdered, totalDispatched, remainingQuantity: Math.max(0, totalOrdered - totalDispatched), saleReports };
  });

  const filtered = status
    ? orders.filter((o) => o.derivedStatus.toLowerCase() === status.toLowerCase() || o.quotation_status.toLowerCase() === status.toLowerCase())
    : orders;
  return { orders: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
}

const ORDER_SELECT = `
  SELECT po.*, q.number AS quotation_number, q.date AS quotation_date, q.status AS quotation_status,
         q.subtotal, q.discount_type, q.discount_value, q.discount_percent, q.discount_amount,
         q.taxable_amount, q.tax_percent, q.tax_amount, q.round_off, q.total, q.notes AS quotation_notes,
         c.id AS company_id, c.name AS company_name, c.address AS company_address, c.state AS company_state,
         c.gstin AS company_gstin, c.contact_person AS company_contact, c.phone AS company_phone, c.email AS company_email
  FROM purchase_order po
  JOIN quotation q ON q.id = po.quotation_id
  JOIN company c ON c.id = q.company_id`;

/** Sales order detail by PO id, or by quotation id when no PO has that id. Null if neither exists. */
export async function getSalesOrderById(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return null;

  let po = await db.prepare(`${ORDER_SELECT} WHERE po.id = ?`).get(numId);
  let quotationId = null;
  let poId = null;

  if (po) {
    poId = po.id;
    quotationId = po.quotation_id;
  } else {
    const qRow = await db
      .prepare(
        `SELECT q.*, c.id AS company_id, c.name AS company_name, c.address AS company_address, c.state AS company_state,
                c.gstin AS company_gstin, c.contact_person AS company_contact, c.phone AS company_phone, c.email AS company_email
         FROM quotation q JOIN company c ON c.id = q.company_id WHERE q.id = ?`
      )
      .get(numId);
    if (!qRow) return null;
    quotationId = qRow.id;
    po = await db.prepare(`${ORDER_SELECT} WHERE po.quotation_id = ? ORDER BY po.id LIMIT 1`).get(quotationId);
    if (po) {
      poId = po.id;
    } else {
      po = {
        id: null, number: 'PENDING', date: qRow.date, quotation_id: qRow.id,
        quotation_number: qRow.number, quotation_date: qRow.date, quotation_status: qRow.status,
        subtotal: qRow.subtotal, discount_type: qRow.discount_type, discount_value: qRow.discount_value,
        discount_percent: qRow.discount_percent, discount_amount: qRow.discount_amount, taxable_amount: qRow.taxable_amount,
        tax_percent: qRow.tax_percent, tax_amount: qRow.tax_amount, round_off: qRow.round_off, total: qRow.total,
        quotation_notes: qRow.notes, company_id: qRow.company_id, company_name: qRow.company_name,
        company_address: qRow.company_address, company_state: qRow.company_state, company_gstin: qRow.company_gstin,
        company_contact: qRow.company_contact, company_phone: qRow.company_phone, company_email: qRow.company_email,
      };
    }
  }

  const [pi, saleReports, items, dispatchedLines, qMeta] = await Promise.all([
    poId
      ? db.prepare(`SELECT * FROM performa_invoice WHERE purchase_order_id = ? ORDER BY id LIMIT 1`).get(poId)
      : db.prepare(`SELECT * FROM performa_invoice WHERE quotation_id = ? ORDER BY id LIMIT 1`).get(quotationId),
    db.prepare(
      `SELECT sr.*, w.name AS warehouse_name FROM sale_report sr
       LEFT JOIN warehouse w ON w.id = sr.warehouse_id
       WHERE sr.source_quotation_id = ? OR (sr.source_po_id IS NOT NULL AND sr.source_po_id = ?)
       ORDER BY sr.id DESC`
    ).all(quotationId, poId || 0),
    db.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(quotationId),
    db.prepare(
      `SELECT sri.product_id, sri.part_number_snapshot, sri.quantity
       FROM sale_report_item sri JOIN sale_report sr ON sr.id = sri.sale_report_id
       WHERE (sr.source_quotation_id = ? OR sr.source_po_id = ?) AND sr.status = 'CONFIRMED'`
    ).all(quotationId, poId || 0),
    db.prepare(`SELECT created_at, number, date FROM quotation WHERE id = ?`).get(quotationId),
  ]);

  // Items without product_id are matched to the catalogue by part number (as before).
  const unlinkedParts = [...new Set(items.filter((it) => !it.product_id && it.part_no).map((it) => it.part_no))];
  const partToProduct = new Map();
  if (unlinkedParts.length) {
    const rows = await db.prepare(`SELECT id, part_no FROM product WHERE part_no = ANY(?::text[])`).all(unlinkedParts);
    rows.forEach((r) => partToProduct.set(r.part_no, r.id));
  }
  const stock = await stockByProduct(items.map((it) => it.product_id || partToProduct.get(it.part_no)));

  let hasStockConstraint = false;
  let totalShortage = 0;
  const enrichedItems = items.map((it) => {
    const dispatchedQty = dispatchedLines
      .filter((d) => (it.product_id && d.product_id === it.product_id) || (it.part_no && d.part_number_snapshot === it.part_no))
      .reduce((s, d) => s + num(d.quantity), 0);
    const remainingQty = Math.max(0, num(it.qty) - dispatchedQty);
    const s = stock.get(Number(it.product_id || partToProduct.get(it.part_no))) || { onHand: 0, reserved: 0, incoming: 0 };
    const available = Math.max(0, s.onHand - s.reserved);
    const shortage = Math.max(0, remainingQty - available);
    if (shortage > 0) {
      hasStockConstraint = true;
      totalShortage += shortage;
    }
    return {
      ...it, dispatchedQty, remainingQty, onHand: s.onHand, reserved: s.reserved, available, incoming: s.incoming,
      stockStatus: calculateLineStockStatus(remainingQty, available), shortage,
    };
  });

  const totalOrdered = items.reduce((sum, i) => sum + num(i.qty), 0);
  const totalDispatched = enrichedItems.reduce((sum, i) => sum + num(i.dispatchedQty), 0);
  const derivedStatus = deriveSalesOrderStatus({
    quotationStatus: po.quotation_status, hasPo: Boolean(po.id), hasPi: Boolean(pi?.id), saleReports, totalOrdered, totalDispatched,
  });

  const timeline = [];
  if (qMeta) timeline.push({ stage: 'QUOTATION_CREATED', title: `Quotation Created (${qMeta.number})`, timestamp: qMeta.created_at || qMeta.date, status: 'completed' });
  if (po.quotation_status === 'sent') {
    timeline.push({ stage: 'QUOTATION_SENT', title: 'Quotation Sent to Customer', timestamp: po.quotation_date, status: 'completed' });
  } else if (po.quotation_status === 'accepted' || po.id) {
    timeline.push({ stage: 'QUOTATION_SENT', title: 'Quotation Sent to Customer', timestamp: po.quotation_date, status: 'completed' });
    timeline.push({ stage: 'QUOTATION_ACCEPTED', title: 'Customer Acceptance Confirmed', timestamp: po.created_at || po.date, status: 'completed' });
  }
  if (po.id) timeline.push({ stage: 'PO_CREATED', title: `Purchase Order Created (${po.number})`, timestamp: po.created_at || po.date, status: 'completed' });
  if (pi) timeline.push({ stage: 'PI_CREATED', title: `Performa Invoice Issued (${pi.number})`, timestamp: pi.created_at || pi.date, status: 'completed' });
  saleReports.forEach((sr) => {
    timeline.push({
      stage: sr.status === 'CONFIRMED' ? 'STOCK_OUT' : 'SALE_REPORT_CREATED',
      title: `Sale Report ${sr.report_number} (${sr.status})`,
      timestamp: sr.confirmed_at || sr.created_at || sr.sale_date,
      status: sr.status === 'CONFIRMED' ? 'completed' : 'pending',
    });
  });

  return {
    order: {
      ...po, po_id: po.id, po_number: po.number || po.po_number || 'PENDING', quotation_id: quotationId,
      derivedStatus, totalOrdered, totalDispatched, remainingQuantity: Math.max(0, totalOrdered - totalDispatched),
      hasStockConstraint, totalShortage,
    },
    relatedDocuments: {
      quotation: qMeta ? { id: quotationId, number: po.quotation_number, date: po.quotation_date, status: po.quotation_status, total: po.total } : null,
      purchaseOrder: po.id ? { id: po.id, number: po.number, date: po.date, clientRef: po.client_po_ref } : null,
      performaInvoice: pi ? { id: pi.id, number: pi.number, date: pi.date, status: pi.status } : null,
      saleReports: saleReports.map((sr) => ({ id: sr.id, number: sr.report_number, date: sr.sale_date, status: sr.status, total: sr.total_amount })),
    },
    items: enrichedItems,
    timeline,
  };
}

/** Action queue: documents waiting on the next step, oldest first. */
export async function getPendingSalesWork() {
  const age = (col) => `GREATEST(0, CURRENT_DATE - ${col})::int AS age_days`;
  const [quotationsAwaiting, acceptedWithoutPo, posWithoutPi, pisWithoutSr, srAwaitingConfirm] = await Promise.all([
    db.prepare(
      `SELECT q.id, q.number, q.date, q.total, c.name AS company_name, ${age('q.date')}
       FROM quotation q JOIN company c ON c.id = q.company_id
       WHERE q.status = 'sent' ORDER BY q.date ASC`
    ).all(),
    db.prepare(
      `SELECT q.id, q.number, q.date, q.total, c.name AS company_name, ${age('q.date')}
       FROM quotation q JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.quotation_id = q.id
       WHERE q.status = 'accepted' AND po.id IS NULL ORDER BY q.date ASC`
    ).all(),
    db.prepare(
      `SELECT po.id, po.number, po.date, q.total, c.name AS company_name, po.quotation_id, ${age('po.date')}
       FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id
       LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
       WHERE pi.id IS NULL ORDER BY po.date ASC`
    ).all(),
    db.prepare(
      `SELECT pi.id, pi.number, pi.date, q.total, c.name AS company_name, pi.purchase_order_id, pi.quotation_id, ${age('pi.date')}
       FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id
       WHERE NOT EXISTS (SELECT 1 FROM sale_report sr WHERE sr.source_pi_id = pi.id)
       ORDER BY pi.date ASC`
    ).all(),
    db.prepare(
      `SELECT sr.id, sr.report_number, sr.sale_date, sr.total_amount, sr.company_name_snapshot AS company_name, ${age('sr.sale_date')}
       FROM sale_report sr WHERE sr.status = 'DRAFT' ORDER BY sr.sale_date ASC`
    ).all(),
  ]);
  const withAction = (rows, nextAction) => rows.map((item) => ({ ...item, nextAction }));
  return {
    quotationsAwaitingResponse: withAction(quotationsAwaiting, 'Send Follow Up / Register Acceptance'),
    acceptedQuotationsWithoutPo: withAction(acceptedWithoutPo, 'Create Purchase Order'),
    posWithoutPi: withAction(posWithoutPi, 'Create Performa Invoice'),
    pisWithoutSaleReport: withAction(pisWithoutSr, 'Create Sale Report'),
    saleReportsAwaitingConfirmation: withAction(srAwaitingConfirm, 'Confirm Sale Report'),
  };
}

/** Chronological document events (quotations, POs, PIs, sale reports) for the Sales Activity page. */
export async function getDocumentActivity({ q = null, companyId = null, docType = null, startDate = null, endDate = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT * FROM (
      SELECT 'QUOTATION' AS doc_type, q.id AS doc_id, q.number AS doc_number, c.name AS company_name, c.id AS company_id,
             q.total AS amount, q.status AS status, q.created_at AS event_timestamp,
             'Quotation created with status ' || q.status AS description
      FROM quotation q JOIN company c ON c.id = q.company_id
      UNION ALL
      SELECT 'PURCHASE_ORDER', po.id, po.number, c.name, c.id, q.total, po.status, po.created_at,
             'Purchase Order created for quotation ' || q.number
      FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id
      UNION ALL
      SELECT 'PERFORMA_INVOICE', pi.id, pi.number, c.name, c.id, q.total, pi.status, pi.created_at,
             'Performa Invoice issued'
      FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id
      UNION ALL
      SELECT 'SALE_REPORT', sr.id, sr.report_number, sr.company_name_snapshot, sr.company_id, sr.total_amount, sr.status, sr.created_at,
             'Sale Report ' || sr.status
      FROM sale_report sr
    ) activity
    WHERE 1=1`;
  const params = [];
  if (companyId) { sql += ` AND company_id = ?`; params.push(companyId); }
  if (docType) { sql += ` AND doc_type = ?`; params.push(String(docType).toUpperCase()); }
  if (startDate) { sql += ` AND event_timestamp >= ?::date`; params.push(startDate); }
  if (endDate) { sql += ` AND event_timestamp < (?::date + 1)`; params.push(endDate); }
  if (q) {
    sql += ` AND (doc_number ILIKE ? OR company_name ILIKE ? OR description ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s);
  }
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM (${sql}) x`).get(...params);
  const rows = await db.prepare(`${sql} ORDER BY event_timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { activity: rows, total: num(countRow?.n), limit, offset };
}

/** Everything sold to one company. Null when the company does not exist. */
export async function getCompanySalesHistory(companyId) {
  const cid = Number(companyId);
  if (!Number.isInteger(cid) || cid <= 0) return null;
  const company = await db.prepare(`SELECT * FROM company WHERE id = ?`).get(cid);
  if (!company) return null;

  const [quotations, purchaseOrders, performaInvoices, saleReports] = await Promise.all([
    db.prepare(`SELECT * FROM quotation WHERE company_id = ? ORDER BY id DESC`).all(cid),
    db.prepare(
      `SELECT po.*, q.number AS quotation_number, q.total FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id WHERE q.company_id = ? ORDER BY po.id DESC`
    ).all(cid),
    db.prepare(
      `SELECT pi.*, q.number AS quotation_number, q.total FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id WHERE q.company_id = ? ORDER BY pi.id DESC`
    ).all(cid),
    db.prepare(`SELECT * FROM sale_report WHERE company_id = ? ORDER BY id DESC`).all(cid),
  ]);

  const confirmed = saleReports.filter((s) => s.status === 'CONFIRMED');
  return {
    company,
    quotations,
    purchaseOrders,
    performaInvoices,
    saleReports,
    metrics: {
      totalQuotations: quotations.length,
      totalPurchaseOrders: purchaseOrders.length,
      totalPerformaInvoices: performaInvoices.length,
      totalSaleReports: saleReports.length,
      confirmedSalesValue: confirmed.reduce((sum, s) => sum + num(s.total_amount), 0),
      lastSaleDate: confirmed[0]?.sale_date || null,
      openOrdersCount: purchaseOrders.length,
      pendingQuotationsCount: quotations.filter((x) => x.status === 'draft' || x.status === 'sent').length,
    },
  };
}

/** Confirmed sales by company, product and warehouse. */
export async function getSalesReportsData() {
  const [byCompany, byProduct, byWarehouse] = await Promise.all([
    db.prepare(
      `SELECT c.id AS company_id, c.name AS company_name,
              COUNT(sr.id) AS total_orders, COALESCE(SUM(sr.total_amount), 0) AS total_sales
       FROM company c
       LEFT JOIN sale_report sr ON sr.company_id = c.id AND sr.status = 'CONFIRMED'
       GROUP BY c.id
       HAVING COALESCE(SUM(sr.total_amount), 0) > 0
       ORDER BY total_sales DESC`
    ).all(),
    db.prepare(
      `SELECT p.id AS product_id, p.part_no, p.description,
              COALESCE(SUM(sri.quantity), 0) AS total_qty_sold, COALESCE(SUM(sri.total_price), 0) AS total_revenue
       FROM product p
       JOIN sale_report_item sri ON sri.product_id = p.id
       JOIN sale_report sr ON sr.id = sri.sale_report_id AND sr.status = 'CONFIRMED'
       GROUP BY p.id
       ORDER BY total_revenue DESC`
    ).all(),
    db.prepare(
      `SELECT w.id AS warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
              COUNT(sr.id) AS total_reports, COALESCE(SUM(sr.total_amount), 0) AS total_sales
       FROM warehouse w
       LEFT JOIN sale_report sr ON sr.warehouse_id = w.id AND sr.status = 'CONFIRMED'
       GROUP BY w.id
       ORDER BY total_sales DESC`
    ).all(),
  ]);
  const toNumbers = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, num(r[k])])) }));
  return {
    byCompany: toNumbers(byCompany, ['total_orders', 'total_sales']),
    byProduct: toNumbers(byProduct, ['total_qty_sold', 'total_revenue']),
    byWarehouse: toNumbers(byWarehouse, ['total_reports', 'total_sales']),
  };
}
