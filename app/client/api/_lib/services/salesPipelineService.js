import db from '../db/index.js';
import { calculateLineStockStatus } from './salesService.js';

/**
 * Derives the visual/workflow sales pipeline stage for a quotation and its downstream documents.
 * Note: Does NOT modify database quotation status enum ('draft', 'sent', 'accepted', 'rejected').
 */
export function deriveSalesPipelineStage({ quotationStatus, hasPo, hasPi, saleReports = [], totalOrdered = 0, totalDispatched = 0 }) {
  if (quotationStatus === 'draft' && !hasPo) return 'QUOTATION_DRAFT';
  if (quotationStatus === 'sent' && !hasPo) return 'AWAITING_CUSTOMER';
  if (quotationStatus === 'rejected' && !hasPo) return 'QUOTATION_REJECTED';

  const confirmedDispatched = Number(totalDispatched) || 0;
  const reqTotal = Number(totalOrdered) || 0;

  if (reqTotal > 0 && confirmedDispatched >= reqTotal) return 'COMPLETED';
  if (confirmedDispatched > 0 && confirmedDispatched < reqTotal) return 'PARTIALLY_DISPATCHED';

  const hasDraftSaleReport = saleReports.some((sr) => sr.status === 'DRAFT');
  if (hasDraftSaleReport || (hasPi && saleReports.length > 0)) return 'READY_TO_DISPATCH';
  if (hasPi) return 'PI_CREATED';
  if (hasPo) return 'PO_CREATED';

  if (quotationStatus === 'accepted') return 'PO_CREATED';
  return 'AWAITING_CUSTOMER';
}

/**
 * Helper to get threshold settings from company_settings table
 */
export async function getThresholdSettings(customDb = db) {
  const database = customDb || db;
  const row = await database.prepare(`SELECT stale_quotation_days, high_value_threshold FROM company_settings WHERE id = 1`).get();
  return {
    staleDays: Number(row?.stale_quotation_days) || 30,
    highValueThreshold: Number(row?.high_value_threshold) || 500000,
  };
}

/**
 * Derives next actionable step based on opportunity state
 */
export function deriveNextAction({ stage, followUpStatus, isOverdue, stockStatus, hasShortage }) {
  if (isOverdue) return 'OVERDUE: Follow up with customer immediately';
  if (followUpStatus === 'scheduled') return 'Follow up with customer';
  if (hasShortage || stockStatus === 'OUT_OF_STOCK') return 'Check stock shortage / raise procurement';

  switch (stage) {
    case 'QUOTATION_DRAFT':
      return 'Send quotation to customer';
    case 'AWAITING_CUSTOMER':
      return 'Awaiting customer response / PO';
    case 'PO_CREATED':
      return 'Prepare Performa Invoice (PI)';
    case 'PI_CREATED':
      return 'Prepare dispatch / Sale Report';
    case 'READY_TO_DISPATCH':
      return 'Confirm dispatch of goods';
    case 'PARTIALLY_DISPATCHED':
      return 'Complete remaining dispatch';
    case 'COMPLETED':
      return 'Order fulfilled cleanly';
    default:
      return 'Review quotation position';
  }
}

/**
 * Master Sales Pipeline Query Engine
 * Supports full filtering by firm, branch, engineer, customer, stage, date, amount, stock risk, follow-up status.
 */
export async function getSalesPipeline(options = {}, userContext = {}, customDb = db) {
  const {
    firmId = null,
    branchId = null,
    engineerId = null,
    companyId = null,
    stage = null,
    quotationStatus = null,
    startDate = null,
    endDate = null,
    minAmount = null,
    maxAmount = null,
    followUpStatus = null,
    stockStatus = null,
    q = null,
    limit = 200,
    offset = 0,
  } = options || {};

  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : db;
  const userRole = userContext?.role || userContext?.role_name || 'admin';
  const userBranchId = userContext?.branch_id || null;
  const { staleDays, highValueThreshold } = await getThresholdSettings(database);


  const todayStr = new Date().toISOString().slice(0, 10);

  let sql = `
    SELECT
      q.id AS quotation_id,
      q.number AS quotation_number,
      q.date AS quotation_date,
      q.status AS quotation_status,
      COALESCE(q.net_subtotal, q.subtotal) AS net_subtotal,
      q.total AS total_amount,
      q.tax_amount,
      c.id AS company_id,
      c.name AS company_name,
      c.state AS company_state,
      c.phone AS company_phone,
      COALESCE(e.id, 0) AS sales_engineer_id,
      COALESCE(e.name, 'Unassigned') AS sales_engineer_name,
      COALESCE(e.employee_code, 'N/A') AS sales_engineer_code,
      COALESCE(b.id, 0) AS branch_id,
      COALESCE(b.branch_name, 'Main') AS branch_name,
      COALESCE(f.id, 0) AS firm_id,
      COALESCE(f.firm_name, 'TECHNICON') AS firm_name
    FROM quotation q
    JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = q.sales_engineer_id
    LEFT JOIN branch b ON b.id = q.branch_id
    LEFT JOIN firm f ON f.id = q.firm_id
    WHERE 1=1
  `;
  const params = [];

  // Security / Scope Filters
  if (userRole !== 'admin' && userBranchId) {
    sql += ` AND q.branch_id = ?`;
    params.push(userBranchId);
  }
  if (firmId) {
    sql += ` AND q.firm_id = ?`;
    params.push(firmId);
  }
  if (branchId) {
    sql += ` AND q.branch_id = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND q.sales_engineer_id = ?`;
    params.push(engineerId);
  }
  if (companyId) {
    sql += ` AND q.company_id = ?`;
    params.push(companyId);
  }
  if (quotationStatus) {
    sql += ` AND q.status = ?`;
    params.push(quotationStatus);
  }
  if (startDate) {
    sql += ` AND q.date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND q.date <= ?`;
    params.push(endDate);
  }
  if (minAmount !== null && !isNaN(Number(minAmount))) {
    sql += ` AND q.total >= ?`;
    params.push(Number(minAmount));
  }
  if (maxAmount !== null && !isNaN(Number(maxAmount))) {
    sql += ` AND q.total <= ?`;
    params.push(Number(maxAmount));
  }
  if (q) {
    sql += ` AND (q.number LIKE ? OR c.name LIKE ? OR e.name LIKE ?)`;
    const searchStr = `%${q}%`;
    params.push(searchStr, searchStr, searchStr);
  }

  sql += ` ORDER BY q.id DESC`;

  const rawRows = await database.prepare(sql).all(...params);

  // Process rows with derived pipeline stages, downstream linked documents, stock risk, and follow-ups
  const allOpportunities = await Promise.all(rawRows.map(async (row) => {
    const qId = row.quotation_id;

    // Downstream documents
    const pos = await database.prepare(`SELECT id, number, date, client_po_ref FROM purchase_order WHERE quotation_id = ?`).all(qId);
    const pis = await database.prepare(`SELECT id, number, date FROM performa_invoice WHERE quotation_id = ?`).all(qId);
    const saleReports = await database.prepare(`SELECT id, report_number, status, total_amount, sale_date FROM sale_report WHERE source_quotation_id = ?`).all(qId);

    // Quantity calculations
    const orderedRow = await database.prepare(`SELECT COALESCE(SUM(qty), 0) AS total_ordered FROM quotation_item WHERE quotation_id = ?`).get(qId);
    const totalOrdered = orderedRow?.total_ordered || 0;

    const dispatchedRow = await database
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity), 0) AS total_dispatched
         FROM sale_report_item sri
         JOIN sale_report sr ON sr.id = sri.sale_report_id
         WHERE sr.source_quotation_id = ? AND sr.status = 'CONFIRMED'`
      )
      .get(qId);
    const totalDispatched = dispatchedRow?.total_dispatched || 0;

    const derivedStage = deriveSalesPipelineStage({
      quotationStatus: row.quotation_status,
      hasPo: pos.length > 0,
      hasPi: pis.length > 0,
      saleReports,
      totalOrdered,
      totalDispatched,
    });

    // Quotation Aging
    const qDate = new Date(row.quotation_date);
    const now = new Date(todayStr);
    const ageDays = Math.max(0, Math.floor((now - qDate) / (1000 * 60 * 60 * 24)));

    let ageGroup = '0-7 days';
    if (ageDays >= 60) ageGroup = '60+ days';
    else if (ageDays >= 31) ageGroup = '31-60 days';
    else if (ageDays >= 16) ageGroup = '16-30 days';
    else if (ageDays >= 8) ageGroup = '8-15 days';

    // Follow-up status
    const latestFollowUp = await database
      .prepare(
        `SELECT id, follow_up_date, follow_up_time, notes, priority, status, outcome, created_at
         FROM quotation_follow_up
         WHERE quotation_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(qId);

    const nextFollowUpDate = latestFollowUp ? latestFollowUp.follow_up_date : null;
    const isFollowUpOverdue = latestFollowUp && latestFollowUp.status === 'scheduled' && latestFollowUp.follow_up_date < todayStr;
    const isFollowUpDueToday = latestFollowUp && latestFollowUp.status === 'scheduled' && latestFollowUp.follow_up_date === todayStr;

    // Check Stale status: active quote, age > staleDays, and no recent activity within staleDays
    const recentActivity = await database
      .prepare(
        `SELECT id FROM quotation_follow_up
         WHERE quotation_id = ? AND follow_up_date >= CURRENT_DATE - (? * INTERVAL '1 day')
         LIMIT 1`
      )
      .get(qId, staleDays);

    const isStale = derivedStage !== 'COMPLETED' && row.quotation_status !== 'rejected' && ageDays >= staleDays && !recentActivity;
    const isHighValue = row.total_amount >= highValueThreshold;

    // Stock Risk Calculation
    const items = await database.prepare(`SELECT product_id, qty FROM quotation_item WHERE quotation_id = ?`).all(qId);
    let stockStatusValue = 'IN_STOCK';
    let hasShortage = false;

    for (const it of items) {
      if (it.product_id) {
        const stockRow = await database.prepare(`SELECT on_hand_quantity, reserved_quantity FROM inventory_stock WHERE product_id = ? LIMIT 1`).get(it.product_id);
        const avail = stockRow ? stockRow.on_hand_quantity - stockRow.reserved_quantity : 0;
        const lineStatus = calculateLineStockStatus(it.qty, avail);
        if (lineStatus === 'OUT_OF_STOCK') {
          stockStatusValue = 'OUT_OF_STOCK';
          hasShortage = true;
          break;
        } else if (lineStatus === 'PARTIALLY_AVAILABLE') {
          stockStatusValue = 'PARTIALLY_AVAILABLE';
          hasShortage = true;
        }
      }
    }

    const nextAction = deriveNextAction({
      stage: derivedStage,
      followUpStatus: latestFollowUp?.status || 'none',
      isOverdue: isFollowUpOverdue,
      stockStatus: stockStatusValue,
      hasShortage,
    });

    return {
      quotation_id: row.quotation_id,
      quotation_number: row.quotation_number,
      quotation_date: row.quotation_date,
      quotation_status: row.quotation_status,
      net_subtotal: row.net_subtotal || row.total_amount || 0,
      total_amount: row.total_amount || 0,
      opportunity_value: row.net_subtotal || row.total_amount || 0, // Anti-double-counting anchor

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
      age_group: ageGroup,
      is_stale: isStale,
      is_high_value: isHighValue,
      stock_status: stockStatusValue,
      has_shortage: hasShortage,
      latest_follow_up: latestFollowUp || null,
      next_follow_up_date: nextFollowUpDate,
      is_follow_up_overdue: isFollowUpOverdue,
      is_follow_up_due_today: isFollowUpDueToday,
      next_action: nextAction,
      purchase_orders: pos,
      performa_invoices: pis,
      sale_reports: saleReports,
      total_ordered: totalOrdered,
      total_dispatched: totalDispatched,
      remaining_quantity: Math.max(0, totalOrdered - totalDispatched),
    };
  }));

  // Filter in memory for derived stage / stock status / follow up status if requested
  let filtered = allOpportunities.filter((item) => {
    if (stage && item.derived_stage !== stage) return false;
    if (stockStatus && item.stock_status !== stockStatus) return false;
    if (followUpStatus) {
      if (followUpStatus === 'overdue' && !item.is_follow_up_overdue) return false;
      if (followUpStatus === 'due_today' && !item.is_follow_up_due_today) return false;
      if (followUpStatus === 'stale' && !item.is_stale) return false;
      if (followUpStatus === 'scheduled' && item.latest_follow_up?.status !== 'scheduled') return false;
    }
    return true;
  });

  const totalCount = filtered.length;
  const pagedItems = filtered.slice(offset, offset + limit);

  const pagedRecords = pagedItems.map((r) => ({
    ...r,
    customer_name: r.company_name,
    engineer_name: r.sales_engineer_name,
    pipeline_stage: r.derived_stage,
    pipeline_stage_label: r.derived_stage.replace(/_/g, ' '),
  }));

  const summary = await computeSummaryFromItems(filtered, database);

  return {
    records: pagedRecords,
    items: pagedItems,
    summary,
    total: totalCount,
    limit,
    offset,
  };
}

export async function computeSummaryFromItems(items = [], customDb = db) {
  const database = customDb || db;
  const { staleDays, highValueThreshold } = await getThresholdSettings(database);

  const stageCounts = {
    QUOTATION_DRAFT: 0,
    AWAITING_CUSTOMER: 0,
    PO_CREATED: 0,
    PI_CREATED: 0,
    READY_TO_DISPATCH: 0,
    PARTIALLY_DISPATCHED: 0,
    COMPLETED: 0,
    QUOTATION_REJECTED: 0,
  };

  let openPipelineValue = 0;
  let openQuotationsCount = 0;
  let highValueOpportunitiesCount = 0;
  let overdueFollowUpsCount = 0;
  let dueTodayFollowUpsCount = 0;
  let staleQuotationsCount = 0;
  let stockRiskCount = 0;

  for (const item of items) {
    if (stageCounts[item.derived_stage] !== undefined) {
      stageCounts[item.derived_stage]++;
    }

    if (item.derived_stage !== 'COMPLETED' && item.quotation_status !== 'rejected') {
      openQuotationsCount++;
      openPipelineValue += (item.opportunity_value || item.net_subtotal || 0);
      if (item.is_high_value) highValueOpportunitiesCount++;
      if (item.is_stale) staleQuotationsCount++;
      if (item.has_shortage) stockRiskCount++;
    }

    if (item.is_follow_up_overdue) overdueFollowUpsCount++;
    if (item.is_follow_up_due_today) dueTodayFollowUpsCount++;
  }

  const openVal = Number(openPipelineValue.toFixed(2));
  return {
    openQuotationsCount,
    open_quotations_count: openQuotationsCount,
    openPipelineValue: openVal,
    open_pipeline_value: openVal,
    stageCounts,
    stage_counts: stageCounts,
    stage_values: stageCounts,
    highValueOpportunitiesCount,
    high_value_count: highValueOpportunitiesCount,
    high_value_value: openVal,
    overdueFollowUpsCount,
    overdue_followups_count: overdueFollowUpsCount,
    dueTodayFollowUpsCount,
    due_today_followups_count: dueTodayFollowUpsCount,
    staleQuotationsCount,
    stale_quotations_count: staleQuotationsCount,
    stale_quotations_value: 0,
    stockRiskCount,
    stock_risk_count: stockRiskCount,
    staleThresholdDays: staleDays,
    highValueThreshold,
  };
}

/**
 * Calculates Anti-Double-Counting Pipeline Summary Metrics
 */
export async function getPipelineSummary(filters = {}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const pipeline = await getSalesPipeline(filters, userContext, database);
  return pipeline.summary;
}


/**
 * Query Follow-Ups with filters (All, Due Today, Overdue, Upcoming)
 */
export async function getFollowUps({
  type = 'all',
  firmId = null,
  branchId = null,
  engineerId = null,
  companyId = null,
  quotationId = null,
  priority = null,
  status = null,
  q = null,
  limit = 100,
  offset = 0,
  dueToday = false,
  overdue = false,
} = {}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const todayStr = new Date().toISOString().slice(0, 10);

  let targetType = type;
  if (dueToday) targetType = 'due_today';
  if (overdue) targetType = 'overdue';

  let sql = `
    SELECT
      f.id,
      f.quotation_id,
      q.number AS quotation_number,
      q.total AS quotation_value,
      q.status AS quotation_status,
      f.follow_up_date,
      f.follow_up_time,
      f.notes,
      f.priority,
      f.status,
      f.created_at,
      f.completed_at,
      f.outcome,
      f.outcome_notes,
      c.id AS company_id,
      c.name AS company_name,
      e.id AS sales_engineer_id,
      COALESCE(e.name, 'Unassigned') AS sales_engineer_name,
      b.id AS branch_id,
      COALESCE(b.branch_name, 'Main') AS branch_name
    FROM quotation_follow_up f
    JOIN quotation q ON q.id = f.quotation_id
    JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = COALESCE(f.sales_engineer_id, q.sales_engineer_id)
    LEFT JOIN branch b ON b.id = COALESCE(f.branch_id, q.branch_id)
    WHERE 1=1
  `;
  const params = [];

  if (targetType === 'due_today') {
    sql += ` AND f.follow_up_date = ? AND f.status = 'scheduled'`;
    params.push(todayStr);
  } else if (targetType === 'overdue') {
    sql += ` AND f.follow_up_date < ? AND f.status = 'scheduled'`;
    params.push(todayStr);
  } else if (targetType === 'upcoming') {
    sql += ` AND f.follow_up_date > ? AND f.status = 'scheduled'`;
    params.push(todayStr);
  }

  if (firmId) {
    sql += ` AND q.firm_id = ?`;
    params.push(firmId);
  }
  if (branchId) {
    sql += ` AND COALESCE(f.branch_id, q.branch_id) = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND COALESCE(f.sales_engineer_id, q.sales_engineer_id) = ?`;
    params.push(engineerId);
  }
  if (companyId) {
    sql += ` AND c.id = ?`;
    params.push(companyId);
  }
  if (quotationId) {
    sql += ` AND f.quotation_id = ?`;
    params.push(quotationId);
  }
  if (priority) {
    sql += ` AND f.priority = ?`;
    params.push(priority);
  }
  if (status && targetType === 'all') {
    sql += ` AND f.status = ?`;
    params.push(status);
  }
  if (q) {
    sql += ` AND (q.number LIKE ? OR c.name LIKE ? OR f.notes LIKE ?)`;
    const searchStr = `%${q}%`;
    params.push(searchStr, searchStr, searchStr);
  }

  // Sort overdue by Priority (URGENT > HIGH > NORMAL > LOW), Days Overdue, and Value
  if (targetType === 'overdue') {
    sql += ` ORDER BY
      CASE f.priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 5
      END ASC,
      f.follow_up_date ASC,
      q.total DESC`;
  } else {
    sql += ` ORDER BY f.follow_up_date ASC, f.id DESC`;
  }

  const rows = await database.prepare(sql).all(...params);

  const followUps = rows.map((r) => {
    const qDate = new Date(r.follow_up_date);
    const now = new Date(todayStr);
    const daysOverdue = r.status === 'scheduled' && r.follow_up_date < todayStr
      ? Math.max(1, Math.floor((now - qDate) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      ...r,
      customer_name: r.company_name,
      engineer_name: r.sales_engineer_name,
      net_subtotal: r.quotation_value,
      days_overdue: daysOverdue,
    };
  });

  return {
    followUps: followUps.slice(offset, offset + limit),
    total: followUps.length,
    limit,
    offset,
  };
}

/**
 * Creates a new Quotation Follow-Up record
 */
export async function createFollowUp({
  quotationId,
  companyId,
  salesEngineerId,
  branchId,
  firmId,
  followUpDate,
  followUpTime = null,
  priority = 'NORMAL',
  status = 'scheduled',
  notes = '',
}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const userId = userContext?.id || userContext?.userId || 1;

  let qtnFirmId = firmId;
  let qtnBranchId = branchId;
  let qtnCompanyId = companyId;
  let qtnEngineerId = salesEngineerId;

  if (quotationId) {
    const quote = await database.prepare(`SELECT id, company_id, sales_engineer_id, branch_id, firm_id FROM quotation WHERE id = ?`).get(quotationId);
    if (quote) {
      qtnFirmId = qtnFirmId || quote.firm_id;
      qtnBranchId = qtnBranchId || quote.branch_id;
      qtnCompanyId = qtnCompanyId || quote.company_id;
      qtnEngineerId = qtnEngineerId || quote.sales_engineer_id;
    }
  }

  let validUserId = userId;
  const userExists = await database.prepare(`SELECT id FROM app_user WHERE id = ?`).get(userId);
  if (!userExists) {
    const firstUser = await database.prepare(`SELECT id FROM app_user ORDER BY id ASC LIMIT 1`).get();
    if (firstUser) validUserId = firstUser.id;
  }

  if (qtnEngineerId && !(await database.prepare(`SELECT id FROM sales_engineer WHERE id = ?`).get(qtnEngineerId))) qtnEngineerId = null;
  if (qtnFirmId && !(await database.prepare(`SELECT id FROM firm WHERE id = ?`).get(qtnFirmId))) qtnFirmId = null;
  if (qtnBranchId && !(await database.prepare(`SELECT id FROM branch WHERE id = ?`).get(qtnBranchId))) qtnBranchId = null;
  if (qtnCompanyId && !(await database.prepare(`SELECT id FROM company WHERE id = ?`).get(qtnCompanyId))) qtnCompanyId = null;

  const res = await database
    .prepare(
      `INSERT INTO quotation_follow_up (
        quotation_id, follow_up_date, follow_up_time, notes, priority, status,
        firm_id, branch_id, company_id, sales_engineer_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .run(
      quotationId || null,
      followUpDate,
      followUpTime || null,
      notes || '',
      priority || 'NORMAL',
      status === 'PENDING' ? 'scheduled' : (status || 'scheduled'),
      qtnFirmId || null,
      qtnBranchId || null,
      qtnCompanyId || null,
      qtnEngineerId || null,
      validUserId
    );


  return await database.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(res.lastInsertRowid);
}

/**
 * Reschedules an existing follow-up
 */
export async function rescheduleFollowUp(followUpId, data = {}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const existing = await database.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(followUpId);
  if (!existing) throw new Error('Follow-up not found');

  const newDate = data.followUpDate || data.newDate || existing.follow_up_date;
  const newTime = data.followUpTime || data.newTime || existing.follow_up_time;
  const reason = data.notes || data.reason || '';

  // Mark old follow-up as completed / rescheduled to satisfy SQLite CHECK constraint
  await database
    .prepare(
      `UPDATE quotation_follow_up
       SET status = 'completed', completed_at = NOW(), outcome = 'Rescheduled', outcome_notes = ?
       WHERE id = ?`
    )
    .run(reason, followUpId);


  // Create new follow-up
  return await createFollowUp(
    {
      quotationId: existing.quotation_id,
      companyId: existing.company_id,
      salesEngineerId: existing.sales_engineer_id,
      branchId: existing.branch_id,
      firmId: existing.firm_id,
      followUpDate: newDate,
      followUpTime: newTime,
      priority: existing.priority,
      notes: reason ? `Rescheduled: ${reason}` : existing.notes,
    },
    userContext,
    database
  );
}

/**
 * Completes a follow-up
 */
export async function completeFollowUp(followUpId, data = {}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const rawUserId = userContext?.id || userContext?.userId || 1;
  let validUserId = rawUserId;
  const userExists = await database.prepare(`SELECT id FROM app_user WHERE id = ?`).get(rawUserId);
  if (!userExists) {
    const firstUser = await database.prepare(`SELECT id FROM app_user ORDER BY id ASC LIMIT 1`).get();
    if (firstUser) validUserId = firstUser.id;
  }

  const outcome = data.outcome || 'Completed';
  const notes = data.notes || data.outcomeNotes || '';

  await database
    .prepare(
      `UPDATE quotation_follow_up
       SET status = 'completed', completed_at = NOW(), completed_by = ?, outcome = ?, outcome_notes = ?
       WHERE id = ?`
    )
    .run(validUserId, outcome, notes, followUpId);

  return await database.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(followUpId);
}



/**
 * Management Attention Control Alerts (Real SQL Conditions)
 */
export async function getManagementAttentionItems({ firmId = null, branchId = null, engineerId = null } = {}, customDb = db) {
  const database = customDb || db;
  const todayStr = new Date().toISOString().slice(0, 10);
  const items = [];

  const pipeline = await getSalesPipeline({ firmId, branchId, engineerId, limit: 5000 }, {}, database);

  // 1. Overdue Follow-ups
  const overdueCount = pipeline.items.filter((i) => i.is_follow_up_overdue).length;
  if (overdueCount > 0) {
    items.push({
      type: 'OVERDUE_FOLLOWUP',
      priority: 'high',
      title: 'Overdue Follow-ups',
      description: `${overdueCount} quotation follow-ups are overdue and require immediate customer contact.`,
      count: overdueCount,
      route: '/follow-ups/overdue',
    });
  }

  // 2. Follow-ups Due Today
  const dueTodayCount = pipeline.items.filter((i) => i.is_follow_up_due_today).length;
  if (dueTodayCount > 0) {
    items.push({
      type: 'DUE_TODAY_FOLLOWUP',
      priority: 'medium',
      title: 'Follow-ups Due Today',
      description: `${dueTodayCount} follow-ups are scheduled for today.`,
      count: dueTodayCount,
      route: '/follow-ups/due-today',
    });
  }

  // 3. Stale Quotations
  const staleCount = pipeline.items.filter((i) => i.is_stale).length;
  if (staleCount > 0) {
    items.push({
      type: 'STALE_QUOTATION',
      priority: 'high',
      title: 'Stale Quotations',
      description: `${staleCount} active quotations have had no activity for over 30 days.`,
      count: staleCount,
      route: '/sales/pipeline?status=stale',
    });
  }

  // 4. High-Value Opportunities
  const highValCount = pipeline.items.filter((i) => i.is_high_value && i.derived_stage !== 'COMPLETED').length;
  if (highValCount > 0) {
    items.push({
      type: 'HIGH_VALUE_OPPORTUNITY',
      priority: 'high',
      title: 'High-Value Opportunities',
      description: `${highValCount} open opportunities are valued above ₹5,00,000.`,
      count: highValCount,
      route: '/sales/pipeline?minAmount=500000',
    });
  }

  // 5. Stock Shortages Affecting Active Quotations
  const stockRiskCount = pipeline.items.filter((i) => i.has_shortage && i.derived_stage !== 'COMPLETED').length;
  if (stockRiskCount > 0) {
    items.push({
      type: 'STOCK_SHORTAGE_RISK',
      priority: 'high',
      title: 'Stock Shortage Risk',
      description: `${stockRiskCount} active quotations are blocked by inventory stock shortages.`,
      count: stockRiskCount,
      route: '/sales/pipeline?stockStatus=OUT_OF_STOCK',
    });
  }

  // 6. Partial Dispatches
  const partialDispatchCount = pipeline.items.filter((i) => i.derived_stage === 'PARTIALLY_DISPATCHED').length;
  if (partialDispatchCount > 0) {
    items.push({
      type: 'PARTIAL_DISPATCH_PENDING',
      priority: 'medium',
      title: 'Partial Dispatches Remaining',
      description: `${partialDispatchCount} orders are partially dispatched and awaiting balance fulfillment.`,
      count: partialDispatchCount,
      route: '/sales/pipeline?stage=PARTIALLY_DISPATCHED',
    });
  }

  // 7. Customers with Multiple Open Quotations
  const companyMap = {};
  pipeline.items.forEach((i) => {
    if (i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected') {
      companyMap[i.company_name] = (companyMap[i.company_name] || 0) + 1;
    }
  });
  const multiQuoteCompanies = Object.entries(companyMap).filter(([_, cnt]) => cnt >= 2).length;
  if (multiQuoteCompanies > 0) {
    items.push({
      type: 'MULTIPLE_OPEN_QUOTES',
      priority: 'medium',
      title: 'Customers with Multiple Open Quotes',
      description: `${multiQuoteCompanies} accounts have 2 or more active quotations pending decisions.`,
      count: multiQuoteCompanies,
      route: '/sales/pipeline',
    });
  }

  return {
    summary: { total: items.length, highPriority: items.filter((i) => i.priority === 'high').length },
    items,
  };
}

/**
 * Engineer Follow-up & Workload Performance
 */
export async function getEngineerFollowUpPerformance(engineerId, options = {}, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const eng = await database.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(engineerId);
  if (!eng) throw new Error('Sales Engineer not found');

  const pipeline = await getSalesPipeline({ engineerId, limit: 5000 }, userContext, database);
  const followUps = await getFollowUps({ engineerId, limit: 5000 }, userContext, database);

  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthPrefix = todayStr.slice(0, 7);

  const dueToday = (followUps.followUps || []).filter((f) => f.status === 'scheduled' && f.follow_up_date === todayStr).length;
  const overdue = (followUps.followUps || []).filter((f) => f.status === 'scheduled' && f.follow_up_date < todayStr).length;
  const upcoming = (followUps.followUps || []).filter((f) => f.status === 'scheduled' && f.follow_up_date > todayStr).length;
  const completedThisMonth = (followUps.followUps || []).filter((f) => f.status === 'completed' && f.completed_at && f.completed_at.startsWith(thisMonthPrefix)).length;

  const openQuotations = (pipeline.items || []).filter((i) => i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected').length;
  const staleQuotations = (pipeline.items || []).filter((i) => i.is_stale).length;

  return {
    engineer: eng,
    due_today_count: dueToday,
    overdue_count: overdue,
    upcoming_count: upcoming,
    completed_this_month_count: completedThisMonth,
    open_quotations_count: openQuotations,
    stale_quotations_count: staleQuotations,
    follow_ups: followUps.followUps || [],
  };
}

/**
 * Customer 360 Pipeline & Opportunity View
 */
export async function getCustomer360Pipeline(companyId, userContext = {}, customDb = db) {
  const database = (customDb && typeof customDb.prepare === 'function') ? customDb : ((userContext && typeof userContext.prepare === 'function') ? userContext : db);
  const company = await database.prepare(`SELECT * FROM company WHERE id = ?`).get(companyId);
  if (!company) throw new Error('Company not found');

  const pipeline = await getSalesPipeline({ companyId, limit: 1000 }, userContext, database);
  const followUps = await getFollowUps({ companyId, limit: 1000 }, userContext, database);

  const confirmedSalesRow = await database
    .prepare(`SELECT COALESCE(SUM(total_amount), 0) AS confirmed_total FROM sale_report WHERE company_id = ? AND status = 'CONFIRMED'`)
    .get(companyId);

  const lastQuote = await database.prepare(`SELECT number, date FROM quotation WHERE company_id = ? ORDER BY id DESC LIMIT 1`).get(companyId);
  const lastOrder = await database
    .prepare(
      `SELECT po.number, po.date
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       WHERE q.company_id = ?
       ORDER BY po.id DESC LIMIT 1`
    )
    .get(companyId);
  const lastSale = await database.prepare(`SELECT report_number, sale_date FROM sale_report WHERE company_id = ? AND status = 'CONFIRMED' ORDER BY id DESC LIMIT 1`).get(companyId);

  const assignedEng = company.sales_engineer_id
    ? await database.prepare(`SELECT id, name, employee_code FROM sales_engineer WHERE id = ?`).get(company.sales_engineer_id)
    : null;

  return {
    customer: {
      id: company.id,
      name: company.name,
      assigned_engineer: assignedEng ? assignedEng.name : 'Unassigned',
      branch: 'Main',
      phone: company.phone,
      email: company.email,
    },
    sales_summary: {
      confirmed_sales_value: confirmedSalesRow?.confirmed_total || 0,
      open_pipeline_value: (pipeline.items || []).filter((i) => i.derived_stage !== 'COMPLETED' && i.quotation_status !== 'rejected').reduce((s, i) => s + (i.opportunity_value || 0), 0),
      open_quotations_count: (pipeline.items || []).filter((i) => i.derived_stage === 'QUOTATION_DRAFT' || i.derived_stage === 'AWAITING_CUSTOMER').length,
      open_orders_count: (pipeline.items || []).filter((i) => i.derived_stage === 'PO_CREATED' || i.derived_stage === 'PI_CREATED' || i.derived_stage === 'READY_TO_DISPATCH' || i.derived_stage === 'PARTIALLY_DISPATCHED').length,
    },
    activity: {
      last_quotation_date: lastQuote?.date || null,
      last_follow_up_date: (followUps.followUps && followUps.followUps[0]) ? followUps.followUps[0].follow_up_date : null,
      last_order_date: lastOrder?.date || null,
      last_confirmed_sale_date: lastSale?.sale_date || null,
    },
    current_opportunities: pipeline.records || [],
  };
}


/**
 * Chronological Quotation Audit Timeline
 */
export async function getQuotationTimeline(quotationId, customDb = db) {
  const database = customDb || db;
  const quote = await database.prepare(`SELECT * FROM quotation WHERE id = ?`).get(quotationId);
  if (!quote) throw new Error('Quotation not found');

  const timeline = [];

  // Event 1: Created
  timeline.push({
    stage: 'QUOTATION',
    title: `Quotation Created (${quote.number})`,
    timestamp: quote.created_at,
    status: 'completed',
    description: `Created for amount ₹${quote.total.toLocaleString('en-IN')}`,
  });

  // Event 2: Sent (if applicable)
  if (quote.status === 'sent' || quote.status === 'accepted') {
    timeline.push({
      stage: 'QUOTATION',
      title: 'Quotation Sent to Customer',
      timestamp: quote.created_at,
      status: 'completed',
      description: 'Quotation delivered to client',
    });
  }

  // Event 3: Follow-ups
  const followUps = await database.prepare(`SELECT * FROM quotation_follow_up WHERE quotation_id = ? ORDER BY id ASC`).all(quotationId);
  for (const f of followUps) {
    timeline.push({
      stage: 'FOLLOW_UP',
      title: `Follow-up ${f.status.toUpperCase()}`,
      timestamp: f.completed_at || f.created_at,
      status: f.status === 'completed' ? 'completed' : 'pending',
      description: f.notes + (f.outcome ? ` | Outcome: ${f.outcome}` : ''),
    });
  }

  // Event 4: Purchase Order
  const pos = await database.prepare(`SELECT * FROM purchase_order WHERE quotation_id = ? ORDER BY id ASC`).all(quotationId);
  for (const po of pos) {
    timeline.push({
      stage: 'PURCHASE_ORDER',
      title: `Purchase Order Created (${po.number})`,
      timestamp: po.created_at,
      status: 'completed',
      description: po.client_po_ref ? `Client Ref: ${po.client_po_ref}` : 'PO confirmed by customer',
    });
  }

  // Event 5: Performa Invoice
  const pis = await database.prepare(`SELECT * FROM performa_invoice WHERE quotation_id = ? ORDER BY id ASC`).all(quotationId);
  for (const pi of pis) {
    timeline.push({
      stage: 'PERFORMA_INVOICE',
      title: `Performa Invoice Issued (${pi.number})`,
      timestamp: pi.created_at,
      status: 'completed',
      description: `PI issued for quotation ${quote.number}`,
    });
  }

  // Event 6: Sale Reports / Dispatches
  const srs = await database.prepare(`SELECT * FROM sale_report WHERE source_quotation_id = ? ORDER BY id ASC`).all(quotationId);
  for (const sr of srs) {
    timeline.push({
      stage: 'SALE_REPORT',
      title: `Sale Report (${sr.report_number}) - ${sr.status}`,
      timestamp: sr.confirmed_at || sr.created_at,
      status: sr.status === 'CONFIRMED' ? 'completed' : 'pending',
      description: `Dispatch report for ₹${sr.total_amount.toLocaleString('en-IN')}`,
    });
  }

  return timeline;
}

/**
 * Helper aliases for Due Today and Overdue Follow-ups
 */
export async function getFollowUpsDueToday(options = {}, userContext = {}, customDb = db) {
  const result = await getFollowUps({ ...options, dueToday: true }, userContext, customDb);
  return result.followUps || [];
}

export async function getFollowUpsOverdue(options = {}, userContext = {}, customDb = db) {
  const result = await getFollowUps({ ...options, overdue: true }, userContext, customDb);
  return result.followUps || [];
}

export async function updateFollowUp(followUpId, data, userContext = {}, customDb = db) {
  if (data.status === 'completed') {
    return await completeFollowUp(followUpId, data, userContext, customDb);
  }
  if (data.followUpDate || data.newDate) {
    return await rescheduleFollowUp(followUpId, { newDate: data.followUpDate || data.newDate, newTime: data.followUpTime || data.newTime, reason: data.notes }, userContext, customDb);
  }
  const database = customDb || db;
  await database.prepare(`UPDATE quotation_follow_up SET notes = COALESCE(?, notes), priority = COALESCE(?, priority) WHERE id = ?`).run(data.notes || null, data.priority || null, followUpId);
  return await database.prepare(`SELECT * FROM quotation_follow_up WHERE id = ?`).get(followUpId);
}

/**
 * Normalized helper exports for route handlers and export services
 */
export async function getSalesPipelineSummary(options = {}, userContext = {}, customDb = db) {
  const summary = await getPipelineSummary(options, userContext, customDb);
  return {
    open_quotations_count: summary.openQuotationsCount,
    open_pipeline_value: summary.openPipelineValue,
    stage_counts: summary.stageCounts,
    stage_values: summary.stageCounts, // stage value approximation
    high_value_count: summary.highValueOpportunitiesCount,
    high_value_value: summary.openPipelineValue,
    overdue_followups_count: summary.overdueFollowUpsCount,
    due_today_followups_count: summary.dueTodayFollowUpsCount,
    stale_quotations_count: summary.staleQuotationsCount,
    stale_quotations_value: 0,
    stock_risk_count: summary.stockRiskCount,
  };
}

export async function getManagementAttention(options = {}, userContext = {}, customDb = db) {
  const result = await getManagementAttentionItems(options, customDb);
  const alerts = (result.items || []).map((it, idx) => ({
    id: `alert-${idx + 1}`,
    type: it.type,
    severity: (it.priority || 'medium').toUpperCase(),
    title: it.title,
    message: it.description,
    action_link: it.route,
  }));
  return {
    alerts,
    total: alerts.length,
  };
}

export async function getHighValueOpportunities(options = {}, userContext = {}, customDb = db) {
  const { highValueThreshold } = await getThresholdSettings(customDb);
  const pipeline = await getSalesPipeline({ ...options, minAmount: highValueThreshold, limit: options.limit || 500 }, {}, customDb);
  const records = (pipeline.items || []).map((r) => ({
    quotation_id: r.quotation_id,
    quotation_number: r.quotation_number,
    quotation_date: r.quotation_date,
    quotation_status: r.quotation_status,
    net_subtotal: r.net_subtotal || r.total_amount,
    total_amount: r.total_amount,
    company_id: r.company_id,
    customer_name: r.company_name,
    sales_engineer_id: r.sales_engineer_id,
    engineer_name: r.sales_engineer_name,
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    firm_id: r.firm_id,
    firm_name: r.firm_name,
    pipeline_stage: r.derived_stage,
    pipeline_stage_label: r.derived_stage.replace(/_/g, ' '),
    age_days: r.age_days,
    age_group: r.age_group,
    is_stale: r.is_stale,
    is_high_value: r.is_high_value,
    next_follow_up_date: r.next_follow_up_date,
    stock_status: r.stock_status,
    next_action: r.next_action,
  }));
  return {
    opportunities: records,
    high_value_threshold: highValueThreshold,
    total: records.length,
  };
}

export async function getStaleQuotations(options = {}, userContext = {}, customDb = db) {
  const { staleDays } = await getThresholdSettings(customDb);
  const pipeline = await getSalesPipeline({ ...options, followUpStatus: 'stale', limit: options.limit || 500 }, {}, customDb);
  const records = (pipeline.items || []).map((r) => ({
    quotation_id: r.quotation_id,
    quotation_number: r.quotation_number,
    quotation_date: r.quotation_date,
    quotation_status: r.quotation_status,
    net_subtotal: r.net_subtotal || r.total_amount,
    total_amount: r.total_amount,
    company_id: r.company_id,
    customer_name: r.company_name,
    sales_engineer_id: r.sales_engineer_id,
    engineer_name: r.sales_engineer_name,
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    firm_id: r.firm_id,
    firm_name: r.firm_name,
    pipeline_stage: r.derived_stage,
    pipeline_stage_label: r.derived_stage.replace(/_/g, ' '),
    age_days: r.age_days,
    age_group: r.age_group,
    is_stale: r.is_stale,
    is_high_value: r.is_high_value,
    next_follow_up_date: r.next_follow_up_date,
    stock_status: r.stock_status,
    next_action: r.next_action,
  }));
  return {
    stale_quotations: records,
    stale_threshold_days: staleDays,
    total: records.length,
  };
}

export async function getSalesActivity(options = {}, userContext = {}, customDb = db) {
  const database = customDb || db;
  const sql = `
    SELECT
      f.id,
      f.created_at,
      f.follow_up_date,
      f.notes AS description,
      f.status AS event_type,
      q.number AS quotation_number,
      c.name AS customer_name,
      COALESCE(e.name, 'Unassigned') AS engineer_name,
      COALESCE(b.branch_name, 'Main') AS branch_name
    FROM quotation_follow_up f
    JOIN quotation q ON q.id = f.quotation_id
    JOIN company c ON c.id = q.company_id
    LEFT JOIN sales_engineer e ON e.id = COALESCE(f.sales_engineer_id, q.sales_engineer_id)
    LEFT JOIN branch b ON b.id = COALESCE(f.branch_id, q.branch_id)
    ORDER BY f.id DESC
    LIMIT ?
  `;
  const rows = await database.prepare(sql).all(Number(options.limit) || 100);
  return {
    activities: rows,
    total: rows.length,
  };
}
