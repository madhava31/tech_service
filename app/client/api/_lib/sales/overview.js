import db from '../db/index.js';

// Postgres port of the legacy SQLite getSalesOverview (app/server/src/services/salesService.js).
// Returns the { kpis, pipeline, unavailable } shape the Sales Overview page expects
// (SalesOverviewResponse in app/client/src/api.ts).
//
// sale_report is not created on every database yet. Metrics that depend on it cannot be computed
// then, so they are returned as null and listed in `unavailable` instead of being reported as 0.

const num = (v) => Number(v) || 0;

// KPIs and pipeline stages that are derived from sale_report.
export const SALE_REPORT_METRICS = [
  'openOrders',
  'openOrderValue',
  'pendingSaleReports',
  'confirmedSales',
  'salesValue',
  'grossSales',
  'pendingDispatchValue',
  'completedSalesValue',
  'averageOrderValue',
];
export const SALE_REPORT_STAGES = ['Sale Report', 'Confirmed'];

async function tableExists(name) {
  const row = await db.prepare(`SELECT to_regclass(?) IS NOT NULL AS present`).get(`public.${name}`);
  return !!row?.present;
}

export async function getSalesOverview() {
  const quoteCounts = await db
    .prepare(
      `SELECT
        COUNT(*) AS total_quotations,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft_quotations,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent_quotations,
        COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_quotations,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_quotations,
        COALESCE(SUM(total), 0) AS quotation_total_value,
        COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) AS accepted_quotation_value
       FROM quotation`
    )
    .get();

  const poCounts = await db
    .prepare(
      `SELECT COUNT(*) AS total_pos, COALESCE(SUM(q.total), 0) AS po_total_value
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id`
    )
    .get();

  const piCounts = await db
    .prepare(
      `SELECT COUNT(*) AS total_pis, COALESCE(SUM(q.total), 0) AS pi_total_value
       FROM performa_invoice pi
       JOIN quotation q ON q.id = pi.quotation_id`
    )
    .get();

  // POs that do not have a PI yet.
  const pendingPisRow = await db
    .prepare(
      `SELECT COUNT(*) AS pending_pis
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
       WHERE pi.id IS NULL`
    )
    .get();

  const accepted = num(quoteCounts.accepted_quotations);
  const decided = accepted + num(quoteCounts.rejected_quotations);
  const conversionRate = decided > 0 ? (accepted / decided) * 100 : 0;

  const kpis = {
    totalQuotations: num(quoteCounts.total_quotations),
    draftQuotations: num(quoteCounts.draft_quotations),
    sentQuotations: num(quoteCounts.sent_quotations),
    acceptedQuotations: accepted,
    rejectedQuotations: num(quoteCounts.rejected_quotations),
    pendingPis: num(pendingPisRow.pending_pis),
    acceptedQuotationValue: num(quoteCounts.accepted_quotation_value),
    quotationConversionRate: Math.round(conversionRate * 10) / 10,
  };
  const pipeline = [
    { stage: 'Quotation', label: 'All Quotations', count: num(quoteCounts.total_quotations), value: num(quoteCounts.quotation_total_value) },
    { stage: 'Accepted', label: 'Accepted Quotes', count: accepted, value: num(quoteCounts.accepted_quotation_value) },
    { stage: 'PO', label: 'Purchase Orders', count: num(poCounts.total_pos), value: num(poCounts.po_total_value) },
    { stage: 'PI', label: 'Performa Invoices', count: num(piCounts.total_pis), value: num(piCounts.pi_total_value) },
  ];

  if (!(await tableExists('sale_report'))) {
    for (const key of SALE_REPORT_METRICS) kpis[key] = null;
    pipeline.push(
      { stage: 'Sale Report', label: 'Sale Reports', count: null, value: null },
      { stage: 'Confirmed', label: 'Confirmed Sales', count: null, value: null }
    );
    return {
      kpis,
      pipeline,
      unavailable: {
        reason: 'Sale reports are not set up in this database yet, so figures based on them cannot be calculated.',
        metrics: [...SALE_REPORT_METRICS],
        stages: [...SALE_REPORT_STAGES],
      },
    };
  }

  const srCounts = await db
    .prepare(
      `SELECT
        COUNT(*) AS total_sale_reports,
        COUNT(*) FILTER (WHERE status = 'DRAFT') AS pending_sale_reports,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed_sales,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CONFIRMED'), 0) AS confirmed_sales_value,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'DRAFT'), 0) AS pending_sale_report_value
       FROM sale_report`
    )
    .get();

  // Open orders: POs without a confirmed sale report covering the full quotation total.
  const openOrdersRow = await db
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

  const avgRow = await db
    .prepare(`SELECT AVG(total_amount) AS avg_val FROM sale_report WHERE status = 'CONFIRMED'`)
    .get();

  const confirmedValue = num(srCounts.confirmed_sales_value);
  const pendingSrValue = num(srCounts.pending_sale_report_value);

  Object.assign(kpis, {
    openOrders: num(openOrdersRow.open_orders),
    openOrderValue: num(openOrdersRow.open_order_value),
    pendingSaleReports: num(srCounts.pending_sale_reports),
    confirmedSales: num(srCounts.confirmed_sales),
    salesValue: confirmedValue,
    grossSales: confirmedValue,
    pendingDispatchValue: pendingSrValue,
    completedSalesValue: confirmedValue,
    averageOrderValue: Math.round(num(avgRow?.avg_val) * 100) / 100,
  });
  pipeline.push(
    { stage: 'Sale Report', label: 'Sale Reports', count: num(srCounts.total_sale_reports), value: confirmedValue + pendingSrValue },
    { stage: 'Confirmed', label: 'Confirmed Sales', count: num(srCounts.confirmed_sales), value: confirmedValue }
  );

  return { kpis, pipeline, unavailable: null };
}
