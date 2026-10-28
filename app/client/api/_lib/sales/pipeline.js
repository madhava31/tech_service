import db from '../db/index.js';
import { calculateLineStockStatus, httpError } from './orders.js';

// Postgres port of the legacy SQLite sales pipeline service
// (app/server/src/services/salesPipelineService.js). Response shapes match the frontend types in
// app/client/src/api.ts (SalesPipelineResponse, SalesFollowUp, ManagementAttentionResponse, ...).
//
// The legacy engine ran ~8 queries per quotation; here the related documents, quantities,
// follow-ups and stock for all matching quotations are fetched in a fixed number of queries.

const num = (v) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);
const DEFAULT_STALE_DAYS = 30;
const DEFAULT_HIGH_VALUE = 500000;
const FOLLOW_UP_STATUSES = ['scheduled', 'completed', 'cancelled'];

/** Workflow stage of a quotation and its downstream documents (stored statuses are not changed). */
export function deriveSalesPipelineStage({ quotationStatus, hasPo, hasPi, saleReports = [], totalOrdered = 0, totalDispatched = 0 }) {
  if (quotationStatus === 'draft' && !hasPo) return 'QUOTATION_DRAFT';
  if (quotationStatus === 'sent' && !hasPo) return 'AWAITING_CUSTOMER';
  if (quotationStatus === 'rejected' && !hasPo) return 'QUOTATION_REJECTED';

  const dispatched = Number(totalDispatched) || 0;
  const ordered = Number(totalOrdered) || 0;
  if (ordered > 0 && dispatched >= ordered) return 'COMPLETED';
  if (dispatched > 0 && dispatched < ordered) return 'PARTIALLY_DISPATCHED';

  const hasDraftSaleReport = saleReports.some((sr) => sr.status === 'DRAFT');
  if (hasDraftSaleReport || (hasPi && saleReports.length > 0)) return 'READY_TO_DISPATCH';
  if (hasPi) return 'PI_CREATED';
  if (hasPo) return 'PO_CREATED';
  if (quotationStatus === 'accepted') return 'PO_CREATED';
  return 'AWAITING_CUSTOMER';
}

/**
 * Stale-quotation and high-value thresholds from company_settings. These columns exist only on some
 * databases, so the row is read whole and the documented defaults apply when they are absent/empty.
 */
export async function getThresholdSettings() {
  const row = (await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).get()) || {};
  return {
    staleDays: Number(row.stale_quotation_days) || DEFAULT_STALE_DAYS,
    highValueThreshold: Number(row.high_value_threshold) || DEFAULT_HIGH_VALUE,
  };
}

export function deriveNextAction({ stage, followUpStatus, isOverdue, stockStatus, hasShortage }) {
  if (isOverdue) return 'OVERDUE: Follow up with customer immediately';
  if (followUpStatus === 'scheduled') return 'Follow up with customer';
  if (hasShortage || stockStatus === 'OUT_OF_STOCK') return 'Check stock shortage / raise procurement';
  switch (stage) {
    case 'QUOTATION_DRAFT': return 'Send quotation to customer';
    case 'AWAITING_CUSTOMER': return 'Awaiting customer response / PO';
    case 'PO_CREATED': return 'Prepare Performa Invoice (PI)';
    case 'PI_CREATED': return 'Prepare dispatch / Sale Report';
    case 'READY_TO_DISPATCH': return 'Confirm dispatch of goods';
    case 'PARTIALLY_DISPATCHED': return 'Complete remaining dispatch';
    case 'COMPLETED': return 'Order fulfilled cleanly';
    default: return 'Review quotation position';
  }
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function ageGroupFor(ageDays) {
  if (ageDays >= 60) return '60+ days';
  if (ageDays >= 31) return '31-60 days';
  if (ageDays >= 16) return '16-30 days';
  if (ageDays >= 8) return '8-15 days';
  return '0-7 days';
}

const optionalInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const optionalNumber = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Pipeline of quotations with derived stage, downstream documents, follow-up and stock state. */
export async function getSalesPipeline(options = {}, userContext = {}) {
  const firmId = optionalInt(options.firmId);
  const branchId = optionalInt(options.branchId);
  const engineerId = optionalInt(options.engineerId);
  const companyId = optionalInt(options.companyId);
  const { stage = null, quotationStatus = null, startDate = null, endDate = null, followUpStatus = null, stockStatus = null, q = null } = options;
  const minAmount = optionalNumber(options.minAmount);
  const maxAmount = optionalNumber(options.maxAmount);
  const limit = optionalInt(options.limit) || 200;
  const offset = Math.max(0, Number(options.offset) || 0);

  const { staleDays, highValueThreshold } = await getThresholdSettings();
  const todayStr = todayIso();

  let sql = `
    SELECT q.id AS quotation_id, q.number AS quotation_number, q.date AS quotation_date, q.status AS quotation_status,
           COALESCE(q.net_subtotal, q.subtotal) AS net_subtotal, q.total AS total_amount, q.tax_amount,
           c.id AS company_id, c.name AS company_name, c.state AS company_state, c.phone AS company_phone,
           COALESCE(e.id, 0) AS sales_engineer_id, COALESCE(e.name, 'Unassigned') AS sales_engineer_name,
           COALESCE(e.employee_code, 'N/A') AS sales_engineer_code,
           COALESCE(b.id, 0) AS branch_id, COALESCE(b.branch_name, 'Main') AS branch_name,
           COALESCE(f.id, 0) AS firm_id, COALESCE(f.firm_name, '') AS firm_name
    FROM quotation q
    JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
    LEFT JOIN branch b ON b.id = q.branch_id
    LEFT JOIN firm f ON f.id = q.firm_id
    WHERE 1=1`;
  const params = [];
  const userBranchId = optionalInt(userContext?.branch_id);
  if (userContext?.role !== 'admin' && userBranchId) { sql += ` AND q.branch_id = ?`; params.push(userBranchId); }
  if (firmId) { sql += ` AND q.firm_id = ?`; params.push(firmId); }
  if (branchId) { sql += ` AND q.branch_id = ?`; params.push(branchId); }
  if (engineerId) { sql += ` AND q.sales_engineer_id = ?`; params.push(engineerId); }
  if (companyId) { sql += ` AND q.company_id = ?`; params.push(companyId); }
  if (quotationStatus) { sql += ` AND q.status = ?`; params.push(quotationStatus); }
  if (startDate) { sql += ` AND q.date >= ?`; params.push(startDate); }
  if (endDate) { sql += ` AND q.date <= ?`; params.push(endDate); }
  if (minAmount !== null) { sql += ` AND q.total >= ?`; params.push(minAmount); }
  if (maxAmount !== null) { sql += ` AND q.total <= ?`; params.push(maxAmount); }
  if (q) {
    sql += ` AND (q.number ILIKE ? OR c.name ILIKE ? OR e.name ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s);
  }
  sql += ` ORDER BY q.id DESC`;
  const rows = await db.prepare(sql).all(...params);

  const ids = rows.map((r) => r.quotation_id);
  const empty = { all: async () => [] };
  const batch = (query) => (ids.length ? db.prepare(query) : empty);
  const [pos, pis, saleReports, ordered, dispatched, latestFollowUps, recentActivity, itemRows] = await Promise.all([
    batch(`SELECT quotation_id, id, number, date, client_po_ref FROM purchase_order WHERE quotation_id = ANY(?::int[]) ORDER BY id`).all(ids),
    batch(`SELECT quotation_id, id, number, date FROM performa_invoice WHERE quotation_id = ANY(?::int[]) ORDER BY id`).all(ids),
    batch(`SELECT source_quotation_id, id, report_number, status, total_amount, sale_date FROM sale_report WHERE source_quotation_id = ANY(?::int[]) ORDER BY id`).all(ids),
    batch(`SELECT quotation_id, COALESCE(SUM(qty), 0) AS total_ordered FROM quotation_item WHERE quotation_id = ANY(?::int[]) GROUP BY quotation_id`).all(ids),
    batch(
      `SELECT sr.source_quotation_id, COALESCE(SUM(sri.quantity), 0) AS total_dispatched
       FROM sale_report_item sri JOIN sale_report sr ON sr.id = sri.sale_report_id
       WHERE sr.source_quotation_id = ANY(?::int[]) AND sr.status = 'CONFIRMED'
       GROUP BY sr.source_quotation_id`
    ).all(ids),
    batch(
      `SELECT DISTINCT ON (quotation_id) quotation_id, id, follow_up_date, follow_up_time, notes, priority, status, outcome, created_at
       FROM quotation_follow_up WHERE quotation_id = ANY(?::int[])
       ORDER BY quotation_id, id DESC`
    ).all(ids),
    batch(
      `SELECT DISTINCT quotation_id FROM quotation_follow_up
       WHERE quotation_id = ANY(?::int[]) AND follow_up_date >= CURRENT_DATE - ?::int`
    ).all(ids, staleDays),
    batch(`SELECT quotation_id, product_id, qty FROM quotation_item WHERE quotation_id = ANY(?::int[]) AND product_id IS NOT NULL ORDER BY quotation_id, id`).all(ids),
  ]);

  const productIds = [...new Set(itemRows.map((r) => Number(r.product_id)))];
  const stockRows = productIds.length
    ? await db.prepare(
        `SELECT product_id, COALESCE(SUM(on_hand_quantity), 0) - COALESCE(SUM(reserved_quantity), 0) AS available
         FROM inventory_stock WHERE product_id = ANY(?::int[]) GROUP BY product_id`
      ).all(productIds)
    : [];
  const availableByProduct = new Map(stockRows.map((r) => [Number(r.product_id), num(r.available)]));

  const posByQ = groupBy(pos, 'quotation_id');
  const pisByQ = groupBy(pis, 'quotation_id');
  const srByQ = groupBy(saleReports, 'source_quotation_id');
  const itemsByQ = groupBy(itemRows, 'quotation_id');
  const orderedByQ = new Map(ordered.map((r) => [r.quotation_id, num(r.total_ordered)]));
  const dispatchedByQ = new Map(dispatched.map((r) => [r.source_quotation_id, num(r.total_dispatched)]));
  const followUpByQ = new Map(latestFollowUps.map(({ quotation_id, ...f }) => [quotation_id, f]));
  const recentByQ = new Set(recentActivity.map((r) => r.quotation_id));

  const allOpportunities = rows.map((row) => {
    const qId = row.quotation_id;
    const qPos = (posByQ.get(qId) || []).map(({ quotation_id, ...p }) => p);
    const qPis = (pisByQ.get(qId) || []).map(({ quotation_id, ...p }) => p);
    const qSrs = (srByQ.get(qId) || []).map(({ source_quotation_id, ...s }) => s);
    const totalOrdered = orderedByQ.get(qId) || 0;
    const totalDispatched = dispatchedByQ.get(qId) || 0;
    const derivedStage = deriveSalesPipelineStage({
      quotationStatus: row.quotation_status, hasPo: qPos.length > 0, hasPi: qPis.length > 0, saleReports: qSrs, totalOrdered, totalDispatched,
    });

    const ageDays = Math.max(0, Math.floor((new Date(todayStr) - new Date(row.quotation_date)) / 86400000));
    const latestFollowUp = followUpByQ.get(qId) || null;
    const isFollowUpOverdue = !!latestFollowUp && latestFollowUp.status === 'scheduled' && latestFollowUp.follow_up_date < todayStr;
    const isFollowUpDueToday = !!latestFollowUp && latestFollowUp.status === 'scheduled' && latestFollowUp.follow_up_date === todayStr;
    const totalAmount = num(row.total_amount);
    const isStale = derivedStage !== 'COMPLETED' && row.quotation_status !== 'rejected' && ageDays >= staleDays && !recentByQ.has(qId);
    const isHighValue = totalAmount >= highValueThreshold;

    let stockStatusValue = 'IN_STOCK';
    let hasShortage = false;
    for (const it of itemsByQ.get(qId) || []) {
      const lineStatus = calculateLineStockStatus(it.qty, availableByProduct.get(Number(it.product_id)) || 0);
      if (lineStatus === 'OUT_OF_STOCK') {
        stockStatusValue = 'OUT_OF_STOCK';
        hasShortage = true;
        break;
      } else if (lineStatus === 'PARTIALLY_AVAILABLE') {
        stockStatusValue = 'PARTIALLY_AVAILABLE';
        hasShortage = true;
      }
    }

    const netSubtotal = num(row.net_subtotal) || totalAmount;
    return {
      quotation_id: qId,
      quotation_number: row.quotation_number,
      quotation_date: row.quotation_date,
      quotation_status: row.quotation_status,
      net_subtotal: netSubtotal,
      total_amount: totalAmount,
      opportunity_value: netSubtotal,
      company_id: row.company_id,
      company_name: row.company_name,
      company_state: row.company_state,
      company_phone: row.company_phone,
      sales_engineer_id: row.sales_engineer_id,
      sales_engineer_name: row.sales_engineer_name,
      sales_engineer_code: row.sales_engineer_code,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      firm_id: row.firm_id,
      firm_name: row.firm_name,
      derived_stage: derivedStage,
      age_days: ageDays,
      age_group: ageGroupFor(ageDays),
      is_stale: isStale,
      is_high_value: isHighValue,
      stock_status: stockStatusValue,
      has_shortage: hasShortage,
      latest_follow_up: latestFollowUp,
      next_follow_up_date: latestFollowUp ? latestFollowUp.follow_up_date : null,
      is_follow_up_overdue: isFollowUpOverdue,
      is_follow_up_due_today: isFollowUpDueToday,
      next_action: deriveNextAction({
        stage: derivedStage, followUpStatus: latestFollowUp?.status || 'none', isOverdue: isFollowUpOverdue, stockStatus: stockStatusValue, hasShortage,
      }),
      purchase_orders: qPos,
      performa_invoices: qPis,
      sale_reports: qSrs,
      total_ordered: totalOrdered,
      total_dispatched: totalDispatched,
      remaining_quantity: Math.max(0, totalOrdered - totalDispatched),
    };
  });

  const filtered = allOpportunities.filter((item) => {
    if (stage && item.derived_stage !== stage) return false;
    if (stockStatus && item.stock_status !== stockStatus) return false;
    if (followUpStatus === 'overdue' && !item.is_follow_up_overdue) return false;
    if (followUpStatus === 'due_today' && !item.is_follow_up_due_today) return false;
    if (followUpStatus === 'stale' && !item.is_stale) return false;
    if (followUpStatus === 'scheduled' && item.latest_follow_up?.status !== 'scheduled') return false;
    return true;
  });

  const pagedItems = filtered.slice(offset, offset + limit);
  return {
    records: pagedItems.map((r) => ({
      ...r,
      customer_name: r.company_name,
      engineer_name: r.sales_engineer_name,
      pipeline_stage: r.derived_stage,
      pipeline_stage_label: r.derived_stage.replace(/_/g, ' '),
    })),
    items: pagedItems,
    allItems: filtered,
    summary: computeSummaryFromItems(filtered, { staleDays, highValueThreshold }),
    total: filtered.length,
    limit,
    offset,
  };
}

export function computeSummaryFromItems(items = [], { staleDays = DEFAULT_STALE_DAYS, highValueThreshold = DEFAULT_HIGH_VALUE } = {}) {
  const stageCounts = {
    QUOTATION_DRAFT: 0, AWAITING_CUSTOMER: 0, PO_CREATED: 0, PI_CREATED: 0,
    READY_TO_DISPATCH: 0, PARTIALLY_DISPATCHED: 0, COMPLETED: 0, QUOTATION_REJECTED: 0,
  };
  let openPipelineValue = 0;
  let openQuotationsCount = 0;
  let highValueOpportunitiesCount = 0;
  let overdueFollowUpsCount = 0;
  let dueTodayFollowUpsCount = 0;
  let staleQuotationsCount = 0;
  let stockRiskCount = 0;

  for (const item of items) {
    if (stageCounts[item.derived_stage] !== undefined) stageCounts[item.derived_stage]++;
    if (item.derived_stage !== 'COMPLETED' && item.quotation_status !== 'rejected') {
      openQuotationsCount++;
      openPipelineValue += item.opportunity_value || item.net_subtotal || 0;
      if (item.is_high_value) highValueOpportunitiesCount++;
      if (item.is_stale) staleQuotationsCount++;
      if (item.has_shortage) stockRiskCount++;
    }
    if (item.is_follow_up_overdue) overdueFollowUpsCount++;
    if (item.is_follow_up_due_today) dueTodayFollowUpsCount++;
  }

  const openVal = Number(openPipelineValue.toFixed(2));
  return {
    openQuotationsCount, open_quotations_count: openQuotationsCount,
    openPipelineValue: openVal, open_pipeline_value: openVal,
    stageCounts, stage_counts: stageCounts, stage_values: stageCounts,
    highValueOpportunitiesCount, high_value_count: highValueOpportunitiesCount, high_value_value: openVal,
    overdueFollowUpsCount, overdue_followups_count: overdueFollowUpsCount,
    dueTodayFollowUpsCount, due_today_followups_count: dueTodayFollowUpsCount,
    staleQuotationsCount, stale_quotations_count: staleQuotationsCount, stale_quotations_value: 0,
    stockRiskCount, stock_risk_count: stockRiskCount,
    staleThresholdDays: staleDays,
    highValueThreshold,
  };
}

export async function getSalesPipelineSummary(options = {}, userContext = {}) {
  const { summary } = await getSalesPipeline({ ...options, limit: 1 }, userContext);
  return {
    open_quotations_count: summary.openQuotationsCount,
    open_pipeline_value: summary.openPipelineValue,
    stage_counts: summary.stageCounts,
    stage_values: summary.stageCounts,
    high_value_count: summary.highValueOpportunitiesCount,
    high_value_value: summary.openPipelineValue,
    overdue_followups_count: summary.overdueFollowUpsCount,
    due_today_followups_count: summary.dueTodayFollowUpsCount,
    stale_quotations_count: summary.staleQuotationsCount,
    stale_quotations_value: 0,
    stock_risk_count: summary.stockRiskCount,
  };
}

/** Follow-ups (all / due_today / overdue / upcoming) with quotation, customer, engineer and branch. */
export async function getFollowUps(options = {}) {
  const firmId = optionalInt(options.firmId);
  const branchId = optionalInt(options.branchId);
  const engineerId = optionalInt(options.engineerId);
  const companyId = optionalInt(options.companyId);
  const quotationId = optionalInt(options.quotationId);
  const { priority = null, status = null, q = null } = options;
  const limit = optionalInt(options.limit) || 100;
  const offset = Math.max(0, Number(options.offset) || 0);
  const todayStr = todayIso();

  let targetType = options.type || 'all';
  if (options.dueToday) targetType = 'due_today';
  if (options.overdue) targetType = 'overdue';

  let sql = `
    SELECT f.id, f.quotation_id, q.number AS quotation_number, q.total AS quotation_value, q.status AS quotation_status,
           f.follow_up_date, f.follow_up_time, f.notes, f.priority, f.status, f.created_at, f.completed_at,
           f.outcome, f.outcome_notes, f.created_by, f.completed_by,
           cu.username AS created_by_name, du.username AS completed_by_name,
           c.id AS company_id, c.name AS company_name,
           e.id AS sales_engineer_id, COALESCE(e.name, 'Unassigned') AS sales_engineer_name,
           b.id AS branch_id, COALESCE(b.branch_name, 'Main') AS branch_name
    FROM quotation_follow_up f
    JOIN quotation q ON q.id = f.quotation_id
    JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = COALESCE(f.sales_engineer_id, q.sales_engineer_id)
    LEFT JOIN branch b ON b.id = COALESCE(f.branch_id, q.branch_id)
    LEFT JOIN app_user cu ON cu.id = f.created_by
    LEFT JOIN app_user du ON du.id = f.completed_by
    WHERE 1=1`;
  const params = [];
  if (targetType === 'due_today') { sql += ` AND f.follow_up_date = ? AND f.status = 'scheduled'`; params.push(todayStr); }
  else if (targetType === 'overdue') { sql += ` AND f.follow_up_date < ? AND f.status = 'scheduled'`; params.push(todayStr); }
  else if (targetType === 'upcoming') { sql += ` AND f.follow_up_date > ? AND f.status = 'scheduled'`; params.push(todayStr); }
  if (firmId) { sql += ` AND q.firm_id = ?`; params.push(firmId); }
  if (branchId) { sql += ` AND COALESCE(f.branch_id, q.branch_id) = ?`; params.push(branchId); }
  if (engineerId) { sql += ` AND COALESCE(f.sales_engineer_id, q.sales_engineer_id) = ?`; params.push(engineerId); }
  if (companyId) { sql += ` AND c.id = ?`; params.push(companyId); }
  if (quotationId) { sql += ` AND f.quotation_id = ?`; params.push(quotationId); }
  if (priority) { sql += ` AND f.priority = ?`; params.push(priority); }
  if (status && targetType === 'all') { sql += ` AND f.status = ?`; params.push(status); }
  if (q) {
    sql += ` AND (q.number ILIKE ? OR c.name ILIKE ? OR f.notes ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s);
  }
  if (targetType === 'overdue') {
    sql += ` ORDER BY CASE f.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
                      f.follow_up_date ASC, q.total DESC`;
  } else {
    sql += ` ORDER BY f.follow_up_date ASC, f.id DESC`;
  }

  const rows = await db.prepare(sql).all(...params);
  const followUps = rows.map((r) => ({
    ...r,
    customer_name: r.company_name,
    customer_id: r.company_id,
    engineer_name: r.sales_engineer_name,
    net_subtotal: r.quotation_value,
    days_overdue: r.status === 'scheduled' && r.follow_up_date < todayStr
      ? Math.max(1, Math.floor((new Date(todayStr) - new Date(r.follow_up_date)) / 86400000))
      : 0,
  }));
  return { followUps: followUps.slice(offset, offset + limit), total: followUps.length, limit, offset };
}

export async function getFollowUpsDueToday(options = {}) {
  return (await getFollowUps({ ...options, dueToday: true })).followUps;
}

export async function getFollowUpsOverdue(options = {}) {
  return (await getFollowUps({ ...options, overdue: true })).followUps;
}

async function existingId(table, id) {
  const n = optionalInt(id);
  if (!n) return null;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(n);
  return row ? row.id : null;
}

/** Creates a follow-up. created_by is the signed-in app_user. */
export async function createFollowUp(data = {}, userContext = {}) {
  const userId = optionalInt(userContext?.id);
  if (!userId) throw httpError(401, 'Not authenticated');
  const followUpDate = data.followUpDate || data.follow_up_date;
  if (!followUpDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(followUpDate))) throw httpError(400, 'A follow-up date (YYYY-MM-DD) is required');
  const status = data.status === 'PENDING' || !data.status ? 'scheduled' : String(data.status).toLowerCase();
  if (!FOLLOW_UP_STATUSES.includes(status)) throw httpError(400, `Status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}`);

  const quotationId = optionalInt(data.quotationId);
  let firmId = data.firmId;
  let branchId = data.branchId;
  let companyId = data.companyId;
  let engineerId = data.salesEngineerId;
  if (quotationId) {
    const quote = await db.prepare(`SELECT id, company_id, sales_engineer_id, branch_id, firm_id FROM quotation WHERE id = ?`).get(quotationId);
    if (!quote) throw httpError(404, 'Quotation not found');
    firmId = firmId || quote.firm_id;
    branchId = branchId || quote.branch_id;
    companyId = companyId || quote.company_id;
    engineerId = engineerId || quote.sales_engineer_id;
  } else {
    // quotation_follow_up.quotation_id is required by the schema
    throw httpError(400, 'A quotation is required for a follow-up');
  }

  // Sequential: this also runs inside rescheduleFollowUp's transaction, where all queries share
  // one client and concurrent queries on a client are not allowed.
  const vFirm = await existingId('firm', firmId);
  const vBranch = await existingId('branch', branchId);
  const vCompany = await existingId('company', companyId);
  const vEngineer = await existingId('sales_engineer', engineerId);
  const created = await db
    .prepare(
      `INSERT INTO quotation_follow_up (quotation_id, follow_up_date, follow_up_time, notes, priority, status,
                                        firm_id, branch_id, company_id, sales_engineer_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(quotationId, followUpDate, data.followUpTime || data.follow_up_time || null, data.notes || '', data.priority || 'NORMAL', status,
      vFirm, vBranch, vCompany, vEngineer, userId);
  return created;
}

/** Closes a follow-up as rescheduled and creates its replacement, in one transaction. */
export async function rescheduleFollowUp(followUpId, data = {}, userContext = {}) {
  const id = optionalInt(followUpId);
  if (!id) throw httpError(400, 'Invalid follow-up id');
  return db.transaction(async () => {
    const existing = await db.prepare(`SELECT * FROM quotation_follow_up WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw httpError(404, 'Follow-up not found');
    const reason = data.notes || data.reason || '';
    await db.prepare(
      `UPDATE quotation_follow_up SET status = 'completed', completed_at = NOW(), completed_by = ?, outcome = 'Rescheduled', outcome_notes = ?
       WHERE id = ?`
    ).run(optionalInt(userContext?.id), reason, id);
    return createFollowUp(
      {
        quotationId: existing.quotation_id,
        companyId: existing.company_id,
        salesEngineerId: existing.sales_engineer_id,
        branchId: existing.branch_id,
        firmId: existing.firm_id,
        followUpDate: data.followUpDate || data.newDate || existing.follow_up_date,
        followUpTime: data.followUpTime || data.newTime || existing.follow_up_time,
        priority: existing.priority,
        notes: reason ? `Rescheduled: ${reason}` : existing.notes,
      },
      userContext
    );
  });
}

export async function completeFollowUp(followUpId, data = {}, userContext = {}) {
  const id = optionalInt(followUpId);
  if (!id) throw httpError(400, 'Invalid follow-up id');
  const row = await db
    .prepare(
      `UPDATE quotation_follow_up SET status = 'completed', completed_at = NOW(), completed_by = ?, outcome = ?, outcome_notes = ?
       WHERE id = ? RETURNING *`
    )
    .get(optionalInt(userContext?.id), data.outcome || 'Completed', data.notes || data.outcomeNotes || '', id);
  if (!row) throw httpError(404, 'Follow-up not found');
  return row;
}

export async function updateFollowUp(followUpId, data = {}, userContext = {}) {
  if (data.status === 'completed') return completeFollowUp(followUpId, data, userContext);
  if (data.followUpDate || data.newDate) {
    return rescheduleFollowUp(followUpId, { newDate: data.followUpDate || data.newDate, newTime: data.followUpTime || data.newTime, reason: data.notes }, userContext);
  }
  const id = optionalInt(followUpId);
  if (!id) throw httpError(400, 'Invalid follow-up id');
  const row = await db
    .prepare(`UPDATE quotation_follow_up SET notes = COALESCE(?, notes), priority = COALESCE(?, priority) WHERE id = ? RETURNING *`)
    .get(data.notes || null, data.priority || null, id);
  if (!row) throw httpError(404, 'Follow-up not found');
  return row;
}

/** Management alerts derived from the pipeline (overdue, due today, stale, high value, stock, ...). */
export async function getManagementAttention(options = {}, userContext = {}) {
  const pipeline = await getSalesPipeline(
    { firmId: options.firmId, branchId: options.branchId, engineerId: options.engineerId, limit: 100000 },
    userContext
  );
  const items = pipeline.allItems;
  const { staleThresholdDays, highValueThreshold } = pipeline.summary;
  const alerts = [];
  const add = (type, severity, title, message, count, action_link) => {
    if (count > 0) alerts.push({ id: `alert-${alerts.length + 1}`, type, severity, title, message, action_link });
  };
  const isOpen = (i) => i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected';

  const overdue = items.filter((i) => i.is_follow_up_overdue).length;
  add('OVERDUE_FOLLOWUP', 'HIGH', 'Overdue Follow-ups', `${overdue} quotation follow-ups are overdue and require immediate customer contact.`, overdue, '/follow-ups/overdue');
  const dueToday = items.filter((i) => i.is_follow_up_due_today).length;
  add('DUE_TODAY_FOLLOWUP', 'MEDIUM', 'Follow-ups Due Today', `${dueToday} follow-ups are scheduled for today.`, dueToday, '/follow-ups/due-today');
  const stale = items.filter((i) => i.is_stale).length;
  add('STALE_QUOTATION', 'HIGH', 'Stale Quotations', `${stale} active quotations have had no activity for over ${staleThresholdDays} days.`, stale, '/sales/pipeline?status=stale');
  const highValue = items.filter((i) => i.is_high_value && i.derived_stage !== 'COMPLETED').length;
  add('HIGH_VALUE_OPPORTUNITY', 'HIGH', 'High-Value Opportunities',
    `${highValue} open opportunities are valued at ₹${highValueThreshold.toLocaleString('en-IN')} or more.`, highValue, `/sales/pipeline?minAmount=${highValueThreshold}`);
  const stockRisk = items.filter((i) => i.has_shortage && i.derived_stage !== 'COMPLETED').length;
  add('STOCK_SHORTAGE_RISK', 'HIGH', 'Stock Shortage Risk', `${stockRisk} active quotations are blocked by inventory stock shortages.`, stockRisk, '/sales/pipeline?stockStatus=OUT_OF_STOCK');
  const partial = items.filter((i) => i.derived_stage === 'PARTIALLY_DISPATCHED').length;
  add('PARTIAL_DISPATCH_PENDING', 'MEDIUM', 'Partial Dispatches Remaining', `${partial} orders are partially dispatched and awaiting balance fulfillment.`, partial, '/sales/pipeline?stage=PARTIALLY_DISPATCHED');
  const perCompany = new Map();
  items.filter(isOpen).forEach((i) => perCompany.set(i.company_id, (perCompany.get(i.company_id) || 0) + 1));
  const multi = [...perCompany.values()].filter((n) => n >= 2).length;
  add('MULTIPLE_OPEN_QUOTES', 'MEDIUM', 'Customers with Multiple Open Quotes', `${multi} accounts have 2 or more active quotations pending decisions.`, multi, '/sales/pipeline');

  return { alerts, total: alerts.length };
}

function toOpportunityRecord(r) {
  return {
    quotation_id: r.quotation_id, quotation_number: r.quotation_number, quotation_date: r.quotation_date, quotation_status: r.quotation_status,
    net_subtotal: r.net_subtotal || r.total_amount, total_amount: r.total_amount,
    company_id: r.company_id, customer_name: r.company_name,
    sales_engineer_id: r.sales_engineer_id, engineer_name: r.sales_engineer_name,
    branch_id: r.branch_id, branch_name: r.branch_name, firm_id: r.firm_id, firm_name: r.firm_name,
    pipeline_stage: r.derived_stage, pipeline_stage_label: r.derived_stage.replace(/_/g, ' '),
    age_days: r.age_days, age_group: r.age_group, is_stale: r.is_stale, is_high_value: r.is_high_value,
    next_follow_up_date: r.next_follow_up_date, stock_status: r.stock_status, next_action: r.next_action,
  };
}

export async function getHighValueOpportunities(options = {}, userContext = {}) {
  const { highValueThreshold } = await getThresholdSettings();
  const pipeline = await getSalesPipeline({ ...options, minAmount: highValueThreshold, limit: options.limit || 500 }, userContext);
  const records = pipeline.items.map(toOpportunityRecord);
  return { opportunities: records, high_value_threshold: highValueThreshold, total: pipeline.total };
}

export async function getStaleQuotations(options = {}, userContext = {}) {
  const { staleDays } = await getThresholdSettings();
  const pipeline = await getSalesPipeline({ ...options, followUpStatus: 'stale', limit: options.limit || 500 }, userContext);
  const records = pipeline.items.map(toOpportunityRecord);
  return { stale_quotations: records, stale_threshold_days: staleDays, total: pipeline.total };
}

export async function getEngineerFollowUpPerformance(engineerId, options = {}, userContext = {}) {
  const id = optionalInt(engineerId);
  const eng = id ? await db.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(id) : null;
  if (!eng) throw httpError(404, 'Sales Engineer not found');

  const [pipeline, followUps] = await Promise.all([
    getSalesPipeline({ engineerId: id, limit: 100000 }, userContext),
    getFollowUps({ engineerId: id, limit: 100000 }),
  ]);
  const todayStr = todayIso();
  const thisMonth = todayStr.slice(0, 7);
  const list = followUps.followUps;
  const completedMonth = (f) => f.completed_at && new Date(f.completed_at).toISOString().slice(0, 7) === thisMonth;
  return {
    engineer: eng,
    due_today_count: list.filter((f) => f.status === 'scheduled' && f.follow_up_date === todayStr).length,
    overdue_count: list.filter((f) => f.status === 'scheduled' && f.follow_up_date < todayStr).length,
    upcoming_count: list.filter((f) => f.status === 'scheduled' && f.follow_up_date > todayStr).length,
    completed_this_month_count: list.filter((f) => f.status === 'completed' && completedMonth(f)).length,
    open_quotations_count: pipeline.allItems.filter((i) => i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected').length,
    stale_quotations_count: pipeline.allItems.filter((i) => i.is_stale).length,
    follow_ups: list,
  };
}

/** Customer 360 view. Null when the company does not exist. */
export async function getCustomer360Pipeline(companyId, userContext = {}) {
  const id = optionalInt(companyId);
  const company = id ? await db.prepare(`SELECT * FROM company WHERE id = ?`).get(id) : null;
  if (!company) return null;

  const [pipeline, followUps, confirmed, lastQuote, lastOrder, lastSale] = await Promise.all([
    getSalesPipeline({ companyId: id, limit: 1000 }, userContext),
    getFollowUps({ companyId: id, limit: 1000 }),
    db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sale_report WHERE company_id = ? AND status = 'CONFIRMED'`).get(id),
    db.prepare(`SELECT number, date FROM quotation WHERE company_id = ? ORDER BY id DESC LIMIT 1`).get(id),
    db.prepare(
      `SELECT po.number, po.date FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id
       WHERE q.company_id = ? ORDER BY po.id DESC LIMIT 1`
    ).get(id),
    db.prepare(`SELECT report_number, sale_date FROM sale_report WHERE company_id = ? AND status = 'CONFIRMED' ORDER BY id DESC LIMIT 1`).get(id),
  ]);

  const items = pipeline.allItems;
  const openStages = ['PO_CREATED', 'PI_CREATED', 'READY_TO_DISPATCH', 'PARTIALLY_DISPATCHED'];
  return {
    customer: {
      id: company.id,
      name: company.name,
      // company has no assigned-engineer column in this schema
      assigned_engineer: 'Unassigned',
      branch: 'Main',
      phone: company.phone,
      email: company.email,
    },
    sales_summary: {
      confirmed_sales_value: num(confirmed?.total),
      open_pipeline_value: items.filter((i) => i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected').reduce((s, i) => s + (i.opportunity_value || 0), 0),
      open_quotations_count: items.filter((i) => i.derived_stage === 'QUOTATION_DRAFT' || i.derived_stage === 'AWAITING_CUSTOMER').length,
      open_orders_count: items.filter((i) => openStages.includes(i.derived_stage)).length,
    },
    activity: {
      last_quotation_date: lastQuote?.date || null,
      last_follow_up_date: followUps.followUps[0]?.follow_up_date || null,
      last_order_date: lastOrder?.date || null,
      last_confirmed_sale_date: lastSale?.sale_date || null,
    },
    current_opportunities: pipeline.records,
  };
}

/** Chronological audit timeline of a quotation. Null when the quotation does not exist. */
export async function getQuotationTimeline(quotationId) {
  const id = optionalInt(quotationId);
  const quote = id ? await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(id) : null;
  if (!quote) return null;

  const [followUps, pos, pis, srs] = await Promise.all([
    db.prepare(`SELECT * FROM quotation_follow_up WHERE quotation_id = ? ORDER BY id ASC`).all(id),
    db.prepare(`SELECT * FROM purchase_order WHERE quotation_id = ? ORDER BY id ASC`).all(id),
    db.prepare(`SELECT * FROM performa_invoice WHERE quotation_id = ? ORDER BY id ASC`).all(id),
    db.prepare(`SELECT * FROM sale_report WHERE source_quotation_id = ? ORDER BY id ASC`).all(id),
  ]);

  const timeline = [
    { stage: 'QUOTATION', title: `Quotation Created (${quote.number})`, timestamp: quote.created_at, status: 'completed', description: `Created for amount ₹${num(quote.total).toLocaleString('en-IN')}` },
  ];
  if (quote.status === 'sent' || quote.status === 'accepted') {
    timeline.push({ stage: 'QUOTATION', title: 'Quotation Sent to Customer', timestamp: quote.created_at, status: 'completed', description: 'Quotation delivered to client' });
  }
  for (const f of followUps) {
    timeline.push({
      stage: 'FOLLOW_UP', title: `Follow-up ${String(f.status).toUpperCase()}`, timestamp: f.completed_at || f.created_at,
      status: f.status === 'completed' ? 'completed' : 'pending', description: (f.notes || '') + (f.outcome ? ` | Outcome: ${f.outcome}` : ''),
    });
  }
  for (const po of pos) {
    timeline.push({
      stage: 'PURCHASE_ORDER', title: `Purchase Order Created (${po.number})`, timestamp: po.created_at, status: 'completed',
      description: po.client_po_ref ? `Client Ref: ${po.client_po_ref}` : 'PO confirmed by customer',
    });
  }
  for (const pi of pis) {
    timeline.push({ stage: 'PERFORMA_INVOICE', title: `Performa Invoice Issued (${pi.number})`, timestamp: pi.created_at, status: 'completed', description: `PI issued for quotation ${quote.number}` });
  }
  for (const sr of srs) {
    timeline.push({
      stage: 'SALE_REPORT', title: `Sale Report (${sr.report_number}) - ${sr.status}`, timestamp: sr.confirmed_at || sr.created_at,
      status: sr.status === 'CONFIRMED' ? 'completed' : 'pending', description: `Dispatch report for ₹${num(sr.total_amount).toLocaleString('en-IN')}`,
    });
  }
  return timeline;
}
