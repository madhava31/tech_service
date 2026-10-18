import db from '../db/index.js';

/**
 * Derives visual/operational sales workflow status without mutating database status strings.
 */
export function deriveSalesOrderStatus({ quotationStatus, hasPo, hasPi, saleReports = [], totalOrdered = 0, totalDispatched = 0 }) {
  if (quotationStatus === 'draft') return 'QUOTATION_DRAFT';
  if (quotationStatus === 'sent') return 'AWAITING_CUSTOMER';
  if (quotationStatus === 'rejected') return 'QUOTATION_REJECTED';

  // Quotation is accepted
  const confirmedDispatched = totalDispatched;
  const isFullyDispatched = totalOrdered > 0 && confirmedDispatched >= totalOrdered;
  const isPartiallyDispatched = confirmedDispatched > 0 && confirmedDispatched < totalOrdered;

  if (isFullyDispatched) return 'COMPLETED';
  if (isPartiallyDispatched) return 'PARTIALLY_DISPATCHED';
  if (saleReports.length > 0) return 'READY_TO_DISPATCH';
  if (hasPi) return 'PI_CREATED';
  if (hasPo) return 'PO_CREATED';
  return 'ORDER_CONFIRMED';
}

/**
 * Calculates stock status for a given line item quantity vs available inventory.
 * AVAILABLE = ON_HAND - RESERVED
 */
export function calculateLineStockStatus(qtyRequired, availableQty) {
  const req = Number(qtyRequired) || 0;
  const avail = Number(availableQty) || 0;
  if (avail >= req) return 'IN_STOCK';
  if (avail > 0) return 'PARTIALLY_AVAILABLE';
  return 'OUT_OF_STOCK';
}

/**
 * GET Sales Control Center Overview Metrics & Pipeline Flow
 */
export async function getSalesOverview(customDb = db) {
  const database = customDb || db;

  // Quotation KPIs
  const quoteCounts = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_quotations,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_quotations,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_quotations,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_quotations,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_quotations,
        COALESCE(SUM(total), 0) AS quotation_total_value,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) AS accepted_quotation_value
       FROM quotation`
    )
    .get();

  // PO KPIs
  const poCounts = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_pos,
        COALESCE(SUM(q.total), 0) AS po_total_value
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id`
    )
    .get();

  // PI KPIs
  const piCounts = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_pis,
        COALESCE(SUM(q.total), 0) AS pi_total_value
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id`
    )
    .get();

  // Sale Report KPIs
  const srCounts = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_sale_reports,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS pending_sale_reports,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_sales,
        COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN total_amount ELSE 0 END), 0) AS confirmed_sales_value,
        COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN total_amount ELSE 0 END), 0) AS pending_sale_report_value
       FROM sale_report`
    )
    .get();

  // Open Orders (POs that do not have a confirmed Sale Report covering 100% of items)
  const openOrdersRow = await database
    .prepare(
      `SELECT COUNT(DISTINCT po.id) AS open_orders, COALESCE(SUM(q.total), 0) AS open_order_value
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       LEFT JOIN sale_report sr ON sr.source_po_id = po.id AND sr.status = 'CONFIRMED'
       WHERE sr.id IS NULL OR sr.id IN (
         SELECT source_po_id FROM sale_report GROUP BY source_po_id HAVING SUM(total_amount) < q.total
       )`
    )
    .get();

  // Pending PIs (POs that do not have a PI created)
  const pendingPisRow = await database
    .prepare(
      `SELECT COUNT(*) AS pending_pis, COALESCE(SUM(q.total), 0) AS pending_pi_value
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
       WHERE pi.id IS NULL`
    )
    .get();

  // Quotation Conversion Rate & Completion metrics
  const totalDecidedQuotes = (quoteCounts.accepted_quotations || 0) + (quoteCounts.rejected_quotations || 0);
  const conversionRate = totalDecidedQuotes > 0 ? (quoteCounts.accepted_quotations / totalDecidedQuotes) * 100 : 0;

  const avgOrderValRow = await database.prepare(`SELECT AVG(total_amount) AS avg_val FROM sale_report WHERE status = 'CONFIRMED'`).get();
  const avgOrderValue = avgOrderValRow?.avg_val || 0;

  // Pipeline Flow
  const pipeline = [
    { stage: 'Quotation', label: 'All Quotations', count: quoteCounts.total_quotations || 0, value: quoteCounts.quotation_total_value || 0 },
    { stage: 'Accepted', label: 'Accepted Quotes', count: quoteCounts.accepted_quotations || 0, value: quoteCounts.accepted_quotation_value || 0 },
    { stage: 'PO', label: 'Purchase Orders', count: poCounts.total_pos || 0, value: poCounts.po_total_value || 0 },
    { stage: 'PI', label: 'Performa Invoices', count: piCounts.total_pis || 0, value: piCounts.pi_total_value || 0 },
    { stage: 'Sale Report', label: 'Sale Reports', count: srCounts.total_sale_reports || 0, value: (srCounts.confirmed_sales_value || 0) + (srCounts.pending_sale_report_value || 0) },
    { stage: 'Confirmed', label: 'Confirmed Sales', count: srCounts.confirmed_sales || 0, value: srCounts.confirmed_sales_value || 0 },
  ];

  return {
    kpis: {
      totalQuotations: quoteCounts.total_quotations || 0,
      draftQuotations: quoteCounts.draft_quotations || 0,
      sentQuotations: quoteCounts.sent_quotations || 0,
      acceptedQuotations: quoteCounts.accepted_quotations || 0,
      rejectedQuotations: quoteCounts.rejected_quotations || 0,
      openOrders: openOrdersRow.open_orders || 0,
      pendingPis: pendingPisRow.pending_pis || 0,
      pendingSaleReports: srCounts.pending_sale_reports || 0,
      confirmedSales: srCounts.confirmed_sales || 0,
      salesValue: srCounts.confirmed_sales_value || 0,
      grossSales: srCounts.confirmed_sales_value || 0,
      acceptedQuotationValue: quoteCounts.accepted_quotation_value || 0,
      openOrderValue: openOrdersRow.open_order_value || 0,
      pendingDispatchValue: srCounts.pending_sale_report_value || 0,
      completedSalesValue: srCounts.confirmed_sales_value || 0,
      averageOrderValue: Math.round(avgOrderValue * 100) / 100,
      quotationConversionRate: Math.round(conversionRate * 10) / 10,
    },
    pipeline,
  };
}

/**
 * LIST Sales Orders (reuses Purchase Orders & Accepted/Sent Quotations)
 */
export async function getSalesOrders({ q = null, status = null, companyId = null, startDate = null, endDate = null, limit = 50, offset = 0 }, customDb = db) {
  const database = customDb || db;

  let query = `
    SELECT
      po.id AS id,
      po.id AS po_id,
      po.number AS po_number,
      po.date AS po_date,
      po.client_po_ref,
      po.created_at AS po_created_at,
      q.id AS quotation_id,
      q.number AS quotation_number,
      q.date AS quotation_date,
      q.status AS quotation_status,
      q.total AS total_amount,
      q.taxable_amount,
      q.tax_amount,
      c.id AS company_id,
      c.name AS company_name,
      c.email AS company_email,
      c.phone AS company_phone,
      pi.id AS pi_id,
      pi.number AS pi_number,
      pi.date AS pi_date
    FROM purchase_order po
    JOIN quotation q ON q.id = po.quotation_id
    JOIN company c ON c.id = q.company_id
    LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
    WHERE 1=1
  `;
  const params = [];

  if (companyId) {
    query += ` AND c.id = ?`;
    params.push(companyId);
  }
  if (startDate) {
    query += ` AND po.date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND po.date <= ?`;
    params.push(endDate);
  }
  if (q) {
    query += ` AND (po.number LIKE ? OR q.number LIKE ? OR pi.number LIKE ? OR c.name LIKE ? OR po.client_po_ref LIKE ?)`;
    const searchStr = `%${q}%`;
    params.push(searchStr, searchStr, searchStr, searchStr, searchStr);
  }

  query += ` ORDER BY po.id DESC`;

  const rows = await database.prepare(query).all(...params);

  const orders = await Promise.all(rows.map(async (row) => {
    const saleReports = await database
      .prepare(`SELECT id, report_number, status, total_amount, sale_date FROM sale_report WHERE source_po_id = ? OR source_quotation_id = ?`)
      .all(row.po_id, row.quotation_id);

    const orderedItems = await database.prepare(`SELECT SUM(qty) AS total_qty FROM quotation_item WHERE quotation_id = ?`).get(row.quotation_id);
    const totalOrdered = orderedItems?.total_qty || 0;

    const dispatchedRow = await database
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity), 0) AS total_dispatched
         FROM sale_report_item sri
         JOIN sale_report sr ON sr.id = sri.sale_report_id
         WHERE (sr.source_po_id = ? OR sr.source_quotation_id = ?) AND sr.status = 'CONFIRMED'`
      )
      .get(row.po_id, row.quotation_id);
    const totalDispatched = dispatchedRow?.total_dispatched || 0;

    const derivedStatus = deriveSalesOrderStatus({
      quotationStatus: row.quotation_status,
      hasPo: Boolean(row.po_id),
      hasPi: Boolean(row.pi_id),
      saleReports,
      totalOrdered,
      totalDispatched,
    });

    return {
      ...row,
      derivedStatus,
      totalOrdered,
      totalDispatched,
      remainingQuantity: Math.max(0, totalOrdered - totalDispatched),
      saleReports,
    };
  }));

  let filtered = orders;
  if (status) {
    filtered = orders.filter((o) => o.derivedStatus.toLowerCase() === status.toLowerCase() || o.quotation_status.toLowerCase() === status.toLowerCase());
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    orders: paginated,
    total,
    limit,
    offset,
  };
}

/**
 * GET Sales Order Detail by ID (PO ID or Quotation ID)
 */
export async function getSalesOrderById(id, customDb = db) {
  const database = customDb || db;
  const numId = Number(id);

  let po = await database
    .prepare(
      `SELECT po.*, q.number AS quotation_number, q.date AS quotation_date, q.status AS quotation_status,
              q.subtotal, q.discount_type, q.discount_value, q.discount_percent, q.discount_amount,
              q.taxable_amount, q.tax_percent, q.tax_amount, q.round_off, q.total, q.notes AS quotation_notes,
              c.id AS company_id, c.name AS company_name, c.address AS company_address, c.state AS company_state,
              c.gstin AS company_gstin, c.contact_person AS company_contact, c.phone AS company_phone, c.email AS company_email
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       JOIN company c ON c.id = q.company_id
       WHERE po.id = ?`
    )
    .get(numId);

  let quotationId = null;
  let poId = null;

  if (po) {
    poId = po.id;
    quotationId = po.quotation_id;
  } else {
    const qRow = await database
      .prepare(
        `SELECT q.*, c.id AS company_id, c.name AS company_name, c.address AS company_address, c.state AS company_state,
                c.gstin AS company_gstin, c.contact_person AS company_contact, c.phone AS company_phone, c.email AS company_email
         FROM quotation q
         JOIN company c ON c.id = q.company_id
         WHERE q.id = ?`
      )
      .get(numId);

    if (!qRow) return null;
    quotationId = qRow.id;

    po = await database
      .prepare(
        `SELECT po.*, q.number AS quotation_number, q.date AS quotation_date, q.status AS quotation_status,
                q.subtotal, q.discount_type, q.discount_value, q.discount_percent, q.discount_amount,
                q.taxable_amount, q.tax_percent, q.tax_amount, q.round_off, q.total, q.notes AS quotation_notes,
                c.id AS company_id, c.name AS company_name, c.address AS company_address, c.state AS company_state,
                c.gstin AS company_gstin, c.contact_person AS company_contact, c.phone AS company_phone, c.email AS company_email
         FROM purchase_order po
         JOIN quotation q ON q.id = po.quotation_id
         JOIN company c ON c.id = q.company_id
         WHERE po.quotation_id = ?`
      )
      .get(quotationId);

    if (po) {
      poId = po.id;
    } else {
      po = {
        id: null,
        number: 'PENDING',
        date: qRow.date,
        quotation_id: qRow.id,
        quotation_number: qRow.number,
        quotation_date: qRow.date,
        quotation_status: qRow.status,
        subtotal: qRow.subtotal,
        discount_type: qRow.discount_type,
        discount_value: qRow.discount_value,
        discount_percent: qRow.discount_percent,
        discount_amount: qRow.discount_amount,
        taxable_amount: qRow.taxable_amount,
        tax_percent: qRow.tax_percent,
        tax_amount: qRow.tax_amount,
        round_off: qRow.round_off,
        total: qRow.total,
        quotation_notes: qRow.notes,
        company_id: qRow.company_id,
        company_name: qRow.company_name,
        company_address: qRow.company_address,
        company_state: qRow.company_state,
        company_gstin: qRow.company_gstin,
        company_contact: qRow.company_contact,
        company_phone: qRow.company_phone,
        company_email: qRow.company_email,
      };
    }
  }

  const pi = poId
    ? await database.prepare(`SELECT * FROM performa_invoice WHERE purchase_order_id = ?`).get(poId)
    : await database.prepare(`SELECT * FROM performa_invoice WHERE quotation_id = ?`).get(quotationId);

  const saleReports = await database
    .prepare(
      `SELECT sr.*, w.name AS warehouse_name
       FROM sale_report sr
       LEFT JOIN warehouse w ON w.id = sr.warehouse_id
       WHERE sr.source_quotation_id = ? OR (sr.source_po_id IS NOT NULL AND sr.source_po_id = ?)
       ORDER BY sr.id DESC`
    )
    .all(quotationId, poId || 0);

  const items = await database.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(quotationId);

  let hasStockConstraint = false;
  let totalShortage = 0;

  const enrichedItems = await Promise.all(items.map(async (it) => {
    const dispatchedRow = await database
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity), 0) AS qty_dispatched
         FROM sale_report_item sri
         JOIN sale_report sr ON sr.id = sri.sale_report_id
         WHERE (sr.source_quotation_id = ? OR sr.source_po_id = ?)
           AND sr.status = 'CONFIRMED'
           AND (sri.product_id = ? OR sri.part_number_snapshot = ?)`
      )
      .get(quotationId, poId || 0, it.product_id || 0, it.part_no || '');

    const dispatchedQty = dispatchedRow?.qty_dispatched || 0;
    const remainingQty = Math.max(0, it.qty - dispatchedQty);

    let onHand = 0;
    let reserved = 0;
    let incoming = 0;

    if (it.product_id) {
      const stockRow = await database
        .prepare(
          `SELECT COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
                  COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
                  COALESCE(SUM(incoming_quantity), 0) AS total_incoming
           FROM inventory_stock WHERE product_id = ?`
        )
        .get(it.product_id);

      onHand = stockRow?.total_on_hand || 0;
      reserved = stockRow?.total_reserved || 0;
      incoming = stockRow?.total_incoming || 0;
    } else if (it.part_no) {
      const pRow = await database.prepare(`SELECT id FROM product WHERE part_no = ?`).get(it.part_no);
      if (pRow) {
        const stockRow = await database
          .prepare(
            `SELECT COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
                    COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
                    COALESCE(SUM(incoming_quantity), 0) AS total_incoming
             FROM inventory_stock WHERE product_id = ?`
          )
          .get(pRow.id);

        onHand = stockRow?.total_on_hand || 0;
        reserved = stockRow?.total_reserved || 0;
        incoming = stockRow?.total_incoming || 0;
      }
    }

    const available = Math.max(0, onHand - reserved);
    const stockStatus = calculateLineStockStatus(remainingQty, available);
    const shortage = Math.max(0, remainingQty - available);

    if (shortage > 0) {
      hasStockConstraint = true;
      totalShortage += shortage;
    }

    return {
      ...it,
      dispatchedQty,
      remainingQty,
      onHand,
      reserved,
      available,
      incoming,
      stockStatus,
      shortage,
    };
  }));

  const totalOrdered = items.reduce((sum, i) => sum + Number(i.qty), 0);
  const totalDispatched = enrichedItems.reduce((sum, i) => sum + Number(i.dispatchedQty), 0);

  const derivedStatus = deriveSalesOrderStatus({
    quotationStatus: po.quotation_status,
    hasPo: Boolean(po.id),
    hasPi: Boolean(pi?.id),
    saleReports,
    totalOrdered,
    totalDispatched,
  });

  const timeline = [];
  const qRow = await database.prepare(`SELECT created_at, number, date FROM quotation WHERE id = ?`).get(quotationId);
  if (qRow) {
    timeline.push({
      stage: 'QUOTATION_CREATED',
      title: `Quotation Created (${qRow.number})`,
      timestamp: qRow.created_at || qRow.date,
      status: 'completed',
    });
  }

  if (po.quotation_status === 'sent') {
    timeline.push({ stage: 'QUOTATION_SENT', title: 'Quotation Sent to Customer', timestamp: po.quotation_date, status: 'completed' });
  } else if (po.quotation_status === 'accepted' || po.id) {
    timeline.push({ stage: 'QUOTATION_SENT', title: 'Quotation Sent to Customer', timestamp: po.quotation_date, status: 'completed' });
    timeline.push({ stage: 'QUOTATION_ACCEPTED', title: 'Customer Acceptance Confirmed', timestamp: po.created_at || po.date, status: 'completed' });
  }

  if (po.id) {
    timeline.push({ stage: 'PO_CREATED', title: `Purchase Order Created (${po.number})`, timestamp: po.created_at || po.date, status: 'completed' });
  }

  if (pi) {
    timeline.push({ stage: 'PI_CREATED', title: `Performa Invoice Issued (${pi.number})`, timestamp: pi.created_at || pi.date, status: 'completed' });
  }

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
      ...po,
      po_id: po.id,
      po_number: po.number || po.po_number || 'PENDING',
      quotation_id: quotationId,
      derivedStatus,
      totalOrdered,
      totalDispatched,
      remainingQuantity: Math.max(0, totalOrdered - totalDispatched),
      hasStockConstraint,
      totalShortage,
    },
    relatedDocuments: {
      quotation: qRow ? { id: quotationId, number: po.quotation_number, date: po.quotation_date, status: po.quotation_status, total: po.total } : null,
      purchaseOrder: po.id ? { id: po.id, number: po.number, date: po.date, clientRef: po.client_po_ref } : null,
      performaInvoice: pi ? { id: pi.id, number: pi.number, date: pi.date, status: pi.status } : null,
      saleReports: saleReports.map((sr) => ({ id: sr.id, number: sr.report_number, date: sr.sale_date, status: sr.status, total: sr.total_amount })),
    },
    items: enrichedItems,
    timeline,
  };
}

/**
 * GET Pending Sales Work (Action Queue across 7 categories)
 */
export async function getPendingSalesWork(customDb = db) {
  const database = customDb || db;

  const quotationsAwaiting = await database
    .prepare(
      `SELECT q.id, q.number, q.date, q.total, c.name AS company_name,
              (CURRENT_DATE - q.date) AS age_days
       FROM quotation q
       JOIN company c ON c.id = q.company_id
       WHERE q.status = 'sent'
       ORDER BY q.date ASC`
    )
    .all();

  const acceptedWithoutPo = await database
    .prepare(
      `SELECT q.id, q.number, q.date, q.total, c.name AS company_name,
              (CURRENT_DATE - q.date) AS age_days
       FROM quotation q
       JOIN company c ON c.id = q.company_id
       LEFT JOIN purchase_order po ON po.quotation_id = q.id
       WHERE q.status = 'accepted' AND po.id IS NULL
       ORDER BY q.date ASC`
    )
    .all();

  const posWithoutPi = await database
    .prepare(
      `SELECT po.id, po.number, po.date, q.total, c.name AS company_name, po.quotation_id,
              (CURRENT_DATE - po.date) AS age_days
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
       WHERE pi.id IS NULL
       ORDER BY po.date ASC`
    )
    .all();

  const pisWithoutSr = await database
    .prepare(
      `SELECT pi.id, pi.number, pi.date, q.total, c.name AS company_name, pi.purchase_order_id, pi.quotation_id,
              (CURRENT_DATE - pi.date) AS age_days
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN sale_report sr ON sr.source_pi_id = pi.id
       WHERE sr.id IS NULL
       ORDER BY pi.date ASC`
    )
    .all();

  const srAwaitingConfirm = await database
    .prepare(
      `SELECT sr.id, sr.report_number, sr.sale_date, sr.total_amount, sr.company_name_snapshot AS company_name,
              (CURRENT_DATE - sr.sale_date) AS age_days
       FROM sale_report sr
       WHERE sr.status = 'DRAFT'
       ORDER BY sr.sale_date ASC`
    )
    .all();

  return {
    quotationsAwaitingResponse: quotationsAwaiting.map((item) => ({ ...item, nextAction: 'Send Follow Up / Register Acceptance' })),
    acceptedQuotationsWithoutPo: acceptedWithoutPo.map((item) => ({ ...item, nextAction: 'Create Purchase Order' })),
    posWithoutPi: posWithoutPi.map((item) => ({ ...item, nextAction: 'Create Performa Invoice' })),
    pisWithoutSaleReport: pisWithoutSr.map((item) => ({ ...item, nextAction: 'Create Sale Report' })),
    saleReportsAwaitingConfirmation: srAwaitingConfirm.map((item) => ({ ...item, nextAction: 'Confirm Sale Report' })),
  };
}

/**
 * GET Chronological Sales Activity Audit Log
 */
export async function getSalesActivity({ q = null, companyId = null, docType = null, startDate = null, endDate = null, limit = 50, offset = 0 }, customDb = db) {
  const database = customDb || db;

  let query = `
    SELECT * FROM (
      SELECT
        'QUOTATION' AS doc_type,
        q.id AS doc_id,
        q.number AS doc_number,
        c.name AS company_name,
        c.id AS company_id,
        q.total AS amount,
        q.status AS status,
        q.created_at AS event_timestamp,
        'Quotation created with status ' || q.status AS description
      FROM quotation q
      JOIN company c ON c.id = q.company_id

      UNION ALL

      SELECT
        'PURCHASE_ORDER' AS doc_type,
        po.id AS doc_id,
        po.number AS doc_number,
        c.name AS company_name,
        c.id AS company_id,
        q.total AS amount,
        po.status AS status,
        po.created_at AS event_timestamp,
        'Purchase Order created for quotation ' || q.number AS description
      FROM purchase_order po
      JOIN quotation q ON q.id = po.quotation_id
      JOIN company c ON c.id = q.company_id

      UNION ALL

      SELECT
        'PERFORMA_INVOICE' AS doc_type,
        pi.id AS doc_id,
        pi.number AS doc_number,
        c.name AS company_name,
        c.id AS company_id,
        q.total AS amount,
        pi.status AS status,
        pi.created_at AS event_timestamp,
        'Performa Invoice issued' AS description
      FROM performa_invoice pi
      JOIN quotation q ON q.id = pi.quotation_id
      JOIN company c ON c.id = q.company_id

      UNION ALL

      SELECT
        'SALE_REPORT' AS doc_type,
        sr.id AS doc_id,
        sr.report_number AS doc_number,
        sr.company_name_snapshot AS company_name,
        sr.company_id AS company_id,
        sr.total_amount AS amount,
        sr.status AS status,
        sr.created_at AS event_timestamp,
        'Sale Report ' || sr.status AS description
      FROM sale_report sr
    ) activity
    WHERE 1=1
  `;

  const params = [];

  if (companyId) {
    query += ` AND company_id = ?`;
    params.push(companyId);
  }
  if (docType) {
    query += ` AND doc_type = ?`;
    params.push(docType.toUpperCase());
  }
  if (startDate) {
    query += ` AND event_timestamp >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND event_timestamp <= ?`;
    params.push(endDate);
  }
  if (q) {
    query += ` AND (doc_number LIKE ? OR company_name LIKE ? OR description LIKE ?)`;
    const searchStr = `%${q}%`;
    params.push(searchStr, searchStr, searchStr);
  }

  query += ` ORDER BY event_timestamp DESC`;

  const allRows = await database.prepare(query).all(...params);
  const total = allRows.length;
  const paginated = allRows.slice(offset, offset + limit);

  return {
    activity: paginated,
    total,
    limit,
    offset,
  };
}

/**
 * GET Customer / Company Aggregated Sales History
 */
export async function getCompanySalesHistory(companyId, customDb = db) {
  const database = customDb || db;
  const cid = Number(companyId);

  const company = await database.prepare(`SELECT * FROM company WHERE id = ?`).get(cid);
  if (!company) return null;

  const quotations = await database.prepare(`SELECT * FROM quotation WHERE company_id = ? ORDER BY id DESC`).all(cid);
  const purchaseOrders = await database
    .prepare(
      `SELECT po.*, q.number AS quotation_number, q.total
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       WHERE q.company_id = ? ORDER BY po.id DESC`
    )
    .all(cid);

  const performaInvoices = await database
    .prepare(
      `SELECT pi.*, q.number AS quotation_number, q.total
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id
       WHERE q.company_id = ? ORDER BY pi.id DESC`
    )
    .all(cid);

  const saleReports = await database.prepare(`SELECT * FROM sale_report WHERE company_id = ? ORDER BY id DESC`).all(cid);

  const confirmedSalesValue = saleReports.filter((s) => s.status === 'CONFIRMED').reduce((sum, s) => sum + s.total_amount, 0);
  const lastSale = saleReports.find((s) => s.status === 'CONFIRMED');

  const openOrdersCount = purchaseOrders.length;
  const pendingQuotationsCount = quotations.filter((q) => q.status === 'draft' || q.status === 'sent').length;

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
      confirmedSalesValue,
      lastSaleDate: lastSale?.sale_date || null,
      openOrdersCount,
      pendingQuotationsCount,
    },
  };
}

/**
 * GET Sales Analytics Reports (Summary, Company, Product, Warehouse breakdowns)
 */
export async function getSalesReportsData({ period = 'month', companyId = null, productId = null, warehouseId = null }, customDb = db) {
  const database = customDb || db;

  const byCompany = await database
    .prepare(
      `SELECT c.id AS company_id, c.name AS company_name,
              COUNT(sr.id) AS total_orders,
              COALESCE(SUM(sr.total_amount), 0) AS total_sales
       FROM company c
       LEFT JOIN sale_report sr ON sr.company_id = c.id AND sr.status = 'CONFIRMED'
       GROUP BY c.id
       HAVING COALESCE(SUM(sr.total_amount), 0) > 0
       ORDER BY total_sales DESC`
    )
    .all();

  const byProduct = await database
    .prepare(
      `SELECT p.id AS product_id, p.part_no, p.description,
              COALESCE(SUM(sri.quantity), 0) AS total_qty_sold,
              COALESCE(SUM(sri.total_price), 0) AS total_revenue
       FROM product p
       JOIN sale_report_item sri ON sri.product_id = p.id
       JOIN sale_report sr ON sr.id = sri.sale_report_id AND sr.status = 'CONFIRMED'
       GROUP BY p.id
       ORDER BY total_revenue DESC`
    )
    .all();

  const byWarehouse = await database
    .prepare(
      `SELECT w.id AS warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
              COUNT(sr.id) AS total_reports,
              COALESCE(SUM(sr.total_amount), 0) AS total_sales
       FROM warehouse w
       LEFT JOIN sale_report sr ON sr.warehouse_id = w.id AND sr.status = 'CONFIRMED'
       GROUP BY w.id
       ORDER BY total_sales DESC`
    )
    .all();

  return {
    byCompany,
    byProduct,
    byWarehouse,
  };
}
