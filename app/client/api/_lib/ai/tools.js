import db from '../db/index.js';
import {
  getInactiveCustomers,
  getAwaitingCustomerResponseQuotations,
  getGroupedFollowUps,
  getPipeline,
  getBusinessHealth,
} from '../routes/dashboard.js';
import { getAllCompanyHealth, classifyHealthStatus } from '../routes/companies.js';
import { getAllProductIntelligence } from '../routes/products.js';
import { detectAllOpportunities } from '../opportunities/detectors.js';
import { resolveDateRange, DATE_RANGE_PARAM_SCHEMA } from './dateResolver.js';

const MONTHS_MIN = 1;
const MONTHS_MAX = 60;
const LIMIT_MIN = 1;
const LIMIT_MAX = 20; // never send more than 20 rows into the model's context, per result-limit policy
const VALUE_MAX = 100000000; // 10 crore ceiling — rejects garbage input, not a real business limit
const QUOTATION_STATUSES = ['draft', 'sent', 'negotiation', 'accepted', 'rejected'];
const FOLLOW_UP_BUCKETS = ['overdue', 'due_today', 'upcoming', 'all'];
const CUSTOMER_HEALTH_STATUSES = ['new', 'strong', 'active', 'at_risk', 'inactive', 'no_history'];
const PRODUCT_PERFORMANCE_MODES = ['top', 'declining', 'frequently_quoted_rarely_purchased', 'lookup'];

function clampInt(rawValue, min, max, fallback) {
  const n = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampNumber(rawValue, min, max, fallback) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function defaultLapseMonths() {
  const row = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
  return row?.default_lapse_months ?? 12;
}

function limitedList(rows, limit) {
  const truncated = rows.length > limit;
  return { returned: rows.slice(0, limit), truncated, count: rows.length };
}

// ---------- Sales ----------

async function salesSummary(rawArgs) {
  const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS order_count
       FROM sales_record
       WHERE needs_review = 0 AND sale_date >= ? AND sale_date < ?`
    )
    .get(startDate, endDate);
  const revenue = Number(row.revenue);
  const orderCount = Number(row.order_count);

  const monthRows = await db
    .prepare(
      `SELECT substr(sale_date::text,1,7) AS month, SUM(total_amount) AS revenue
       FROM sales_record
       WHERE needs_review = 0 AND sale_date >= ? AND sale_date < ?
       GROUP BY month ORDER BY revenue DESC LIMIT 1`
    )
    .all(startDate, endDate);
  const bestMonth = monthRows[0] ? { month: monthRows[0].month, revenue: Number(monthRows[0].revenue) } : null;

  const data = {
    startDate,
    endDate,
    label,
    revenue,
    orderCount,
    avgOrderValue: orderCount > 0 ? revenue / orderCount : 0,
    bestMonth,
  };
  return { label: `Sales Summary (${label})`, params: { startDate, endDate, label }, data };
}

async function topCustomers(rawArgs) {
  const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
  const limit = clampInt(rawArgs.limit, LIMIT_MIN, LIMIT_MAX, 10);
  const rows = await db
    .prepare(
      `SELECT company_name, SUM(total_amount) AS revenue, COUNT(*) AS order_count
       FROM sales_record
       WHERE needs_review = 0 AND company_name IS NOT NULL AND sale_date >= ? AND sale_date < ?
       GROUP BY company_name
       ORDER BY revenue DESC
       LIMIT ?`
    )
    .all(startDate, endDate, limit);
  const customers = rows.map((r) => {
    const revenue = Number(r.revenue);
    const orderCount = Number(r.order_count);
    return { company_name: r.company_name, revenue, orderCount, avgOrderValue: orderCount > 0 ? revenue / orderCount : 0 };
  });
  return {
    label: `Top Customers (${label})`,
    params: { startDate, endDate, label, limit },
    data: { startDate, endDate, label, limit, customers },
  };
}

async function topProducts(rawArgs) {
  const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
  const limit = clampInt(rawArgs.limit, LIMIT_MIN, LIMIT_MAX, 10);
  const rows = await db
    .prepare(
      `SELECT part_no, MAX(product_description) AS product_description,
              SUM(total_amount) AS revenue, SUM(qty) AS units, COUNT(DISTINCT company_name) AS customers
       FROM sales_record
       WHERE needs_review = 0 AND part_no IS NOT NULL AND sale_date >= ? AND sale_date < ?
       GROUP BY part_no
       ORDER BY revenue DESC
       LIMIT ?`
    )
    .all(startDate, endDate, limit);
  const products = rows.map((r) => ({
    part_no: r.part_no,
    product_description: r.product_description,
    revenue: Number(r.revenue),
    units: Number(r.units),
    customers: Number(r.customers),
  }));
  return {
    label: `Top Products (${label})`,
    params: { startDate, endDate, label, limit },
    data: { startDate, endDate, label, limit, products },
  };
}

async function salesByCustomer(rawArgs) {
  const search = String(rawArgs.companyName || '').trim();
  if (!search) return { label: 'Sales by Customer', params: {}, data: { error: 'A company name is required.' } };

  const match = await db.prepare(`SELECT id, name FROM company WHERE name ILIKE ? ORDER BY name LIMIT 1`).get(`%${search}%`);
  if (!match) return { label: 'Sales by Customer', params: { search }, data: { found: false, search } };

  const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS order_count,
              MIN(sale_date) AS first_order_date, MAX(sale_date) AS last_order_date
       FROM sales_record
       WHERE needs_review = 0 AND company_name = ? AND sale_date >= ? AND sale_date < ?`
    )
    .get(match.name, startDate, endDate);
  const revenue = Number(row.revenue);
  const orderCount = Number(row.order_count);

  // What they actually bought — a per-product breakdown, not just the revenue total, so questions
  // like "what did X buy" have real data to answer from (not just "how much did X spend").
  const productRows = await db
    .prepare(
      `SELECT part_no, MAX(product_description) AS product_description, SUM(total_amount) AS revenue, SUM(qty) AS units
       FROM sales_record
       WHERE needs_review = 0 AND company_name = ? AND sale_date >= ? AND sale_date < ? AND part_no IS NOT NULL
       GROUP BY part_no ORDER BY revenue DESC LIMIT ${LIMIT_MAX}`
    )
    .all(match.name, startDate, endDate);
  const products = productRows.map((r) => ({ part_no: r.part_no, product_description: r.product_description, revenue: Number(r.revenue), units: Number(r.units) }));

  return {
    label: `Sales by Customer: ${match.name} (${label})`,
    params: { startDate, endDate, label },
    data: {
      found: true,
      company_name: match.name,
      startDate,
      endDate,
      label,
      revenue,
      orderCount,
      avgOrderValue: orderCount > 0 ? revenue / orderCount : 0,
      firstOrderDate: row.first_order_date,
      lastOrderDate: row.last_order_date,
      products,
    },
  };
}

async function salesByProduct(rawArgs) {
  const search = String(rawArgs.search || '').trim();
  if (!search) return { label: 'Sales by Product', params: {}, data: { error: 'A product name or part number is required.' } };

  const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
  const rows = await db
    .prepare(
      `SELECT part_no, MAX(product_description) AS product_description,
              SUM(total_amount) AS revenue, SUM(qty) AS units, COUNT(DISTINCT company_name) AS customers, COUNT(*) AS order_count
       FROM sales_record
       WHERE needs_review = 0 AND sale_date >= ? AND sale_date < ? AND (part_no ILIKE ? OR product_description ILIKE ?)
       GROUP BY part_no
       ORDER BY revenue DESC
       LIMIT 5`
    )
    .all(startDate, endDate, `%${search}%`, `%${search}%`);

  if (rows.length === 0) return { label: 'Sales by Product', params: { search, startDate, endDate }, data: { found: false, search, startDate, endDate, label } };

  const products = rows.map((r) => ({
    part_no: r.part_no,
    product_description: r.product_description,
    revenue: Number(r.revenue),
    units: Number(r.units),
    customers: Number(r.customers),
    orderCount: Number(r.order_count),
  }));
  return {
    label: `Sales by Product: "${search}" (${label})`,
    params: { search, startDate, endDate, label },
    data: { found: true, search, startDate, endDate, label, products },
  };
}

async function revenueComparison(rawArgs) {
  const a = await resolveDateRange(rawArgs.dateRangeA);
  const b = await resolveDateRange(rawArgs.dateRangeB);

  async function totals(startDate, endDate) {
    const row = await db
      .prepare(`SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS order_count FROM sales_record WHERE needs_review = 0 AND sale_date >= ? AND sale_date < ?`)
      .get(startDate, endDate);
    return { revenue: Number(row.revenue), orderCount: Number(row.order_count) };
  }

  const totalsA = await totals(a.startDate, a.endDate);
  const totalsB = await totals(b.startDate, b.endDate);
  const revenueDelta = totalsA.revenue - totalsB.revenue;
  const pctChange = totalsB.revenue > 0 ? revenueDelta / totalsB.revenue : null;

  return {
    label: `Revenue Comparison: ${a.label} vs ${b.label}`,
    params: { periodA: a, periodB: b },
    data: {
      periodA: { ...a, ...totalsA },
      periodB: { ...b, ...totalsB },
      revenueDelta,
      pctChange,
    },
  };
}

async function inactiveCustomers(rawArgs) {
  const months = rawArgs.months == null ? await defaultLapseMonths() : clampInt(rawArgs.months, MONTHS_MIN, MONTHS_MAX, await defaultLapseMonths());
  const rows = await getInactiveCustomers(months);
  const { returned, truncated, count } = limitedList(
    rows.map((r) => ({ company_name: r.company_name, last_purchase: r.last_purchase, total_revenue: Number(r.total_revenue) })),
    LIMIT_MAX
  );
  return { label: `Inactive Customers (${months}+ months)`, params: { months }, data: { months, count, truncated, customers: returned } };
}

// ---------- Quotations ----------

async function quotationSearch(rawArgs) {
  const conditions = [`1=1`];
  const params = [];

  if (rawArgs.companyName) {
    conditions.push(`c.name ILIKE ?`);
    params.push(`%${String(rawArgs.companyName).trim()}%`);
  }
  if (rawArgs.status && QUOTATION_STATUSES.includes(rawArgs.status)) {
    conditions.push(`q.status = ?`);
    params.push(rawArgs.status);
  }
  if (rawArgs.minValue != null) {
    conditions.push(`q.total >= ?`);
    params.push(clampNumber(rawArgs.minValue, 0, VALUE_MAX, 0));
  }
  if (rawArgs.maxValue != null) {
    conditions.push(`q.total <= ?`);
    params.push(clampNumber(rawArgs.maxValue, 0, VALUE_MAX, VALUE_MAX));
  }
  if (rawArgs.unconvertedOnly) {
    conditions.push(`q.status <> 'rejected' AND NOT EXISTS (SELECT 1 FROM performa_invoice pi WHERE pi.quotation_id = q.id) AND NOT EXISTS (SELECT 1 FROM purchase_order po WHERE po.quotation_id = q.id)`);
  }

  let dateInfo = null;
  if (rawArgs.dateRange) {
    const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
    conditions.push(`q.date >= ? AND q.date < ?`);
    params.push(startDate, endDate);
    dateInfo = { startDate, endDate, label };
  }

  const sql = `SELECT q.id, q.number, q.date, q.total, q.status, c.name AS company_name
     FROM quotation q JOIN company c ON c.id = q.company_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY q.total DESC
     LIMIT ${LIMIT_MAX + 1}`;
  const rows = await db.prepare(sql).all(...params);
  const { returned, truncated, count } = limitedList(
    rows.map((r) => ({ number: r.number, company_name: r.company_name, date: r.date, total: Number(r.total), status: r.status })),
    LIMIT_MAX
  );

  return {
    label: 'Quotation Search',
    params: { ...rawArgs, dateInfo },
    data: { count, truncated, quotations: returned, dateInfo },
  };
}

async function quotationSummary(rawArgs) {
  let dateInfo = null;
  const conditions = [`1=1`];
  const params = [];
  if (rawArgs.dateRange) {
    const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
    conditions.push(`q.date >= ? AND q.date < ?`);
    params.push(startDate, endDate);
    dateInfo = { startDate, endDate, label };
  }

  const rows = await db
    .prepare(
      `SELECT q.status, COUNT(*) AS cnt, COALESCE(SUM(q.total),0) AS total
       FROM quotation q WHERE ${conditions.join(' AND ')}
       GROUP BY q.status`
    )
    .all(...params);
  const byStatus = new Map(rows.map((r) => [r.status, { count: Number(r.cnt), value: Number(r.total) }]));
  const statuses = QUOTATION_STATUSES.map((s) => ({ status: s, count: byStatus.get(s)?.count ?? 0, value: byStatus.get(s)?.value ?? 0 }));
  const totalCount = statuses.reduce((sum, s) => sum + s.count, 0);
  const totalValue = statuses.reduce((sum, s) => sum + s.value, 0);

  const convertedRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM quotation q
       WHERE ${conditions.join(' AND ')} AND (EXISTS (SELECT 1 FROM purchase_order po WHERE po.quotation_id = q.id) OR EXISTS (SELECT 1 FROM performa_invoice pi WHERE pi.quotation_id = q.id))`
    )
    .get(...params);

  return {
    label: `Quotation Summary${dateInfo ? ` (${dateInfo.label})` : ''}`,
    params: { dateInfo },
    data: { dateInfo, totalCount, totalValue, byStatus: statuses, convertedCount: Number(convertedRow.cnt) },
  };
}

async function pipelineValue() {
  const pipeline = await getPipeline();
  return { label: 'Sales Pipeline', params: {}, data: pipeline };
}

async function awaitingCustomerResponse() {
  const rows = await getAwaitingCustomerResponseQuotations();
  const { returned, truncated, count } = limitedList(
    rows.map((r) => ({ number: r.number, company_name: r.company_name, date: r.date, total: Number(r.total), status: r.status })),
    LIMIT_MAX
  );
  return { label: 'Awaiting Customer Response', params: {}, data: { count, truncated, quotations: returned } };
}

// ---------- Purchase Orders / Performa Invoices ----------

async function purchaseOrderSummary(rawArgs) {
  let dateInfo = null;
  const conditions = [`1=1`];
  const params = [];
  if (rawArgs.dateRange) {
    const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
    conditions.push(`po.date >= ? AND po.date < ?`);
    params.push(startDate, endDate);
    dateInfo = { startDate, endDate, label };
  }
  const rows = await db
    .prepare(
      `SELECT po.number, po.date, q.number AS quotation_number, q.total, c.name AS company_name
       FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY q.total DESC LIMIT ${LIMIT_MAX + 1}`
    )
    .all(...params);
  const totalsRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(q.total),0) AS total
       FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id
       WHERE ${conditions.join(' AND ')}`
    )
    .get(...params);
  const { returned, truncated } = limitedList(
    rows.map((r) => ({ number: r.number, date: r.date, quotation_number: r.quotation_number, company_name: r.company_name, total: Number(r.total) })),
    LIMIT_MAX
  );
  return {
    label: `Purchase Order Summary${dateInfo ? ` (${dateInfo.label})` : ''}`,
    params: { dateInfo },
    data: { dateInfo, count: Number(totalsRow.cnt), totalValue: Number(totalsRow.total), truncated, purchaseOrders: returned },
  };
}

async function performaInvoiceSummary(rawArgs) {
  let dateInfo = null;
  const conditions = [`1=1`];
  const params = [];
  if (rawArgs.dateRange) {
    const { startDate, endDate, label } = await resolveDateRange(rawArgs.dateRange);
    conditions.push(`pi.date >= ? AND pi.date < ?`);
    params.push(startDate, endDate);
    dateInfo = { startDate, endDate, label };
  }
  const rows = await db
    .prepare(
      `SELECT pi.number, pi.date, q.number AS quotation_number, q.total, c.name AS company_name
       FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY q.total DESC LIMIT ${LIMIT_MAX + 1}`
    )
    .all(...params);
  const totalsRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(q.total),0) AS total
       FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id
       WHERE ${conditions.join(' AND ')}`
    )
    .get(...params);
  const { returned, truncated } = limitedList(
    rows.map((r) => ({ number: r.number, date: r.date, quotation_number: r.quotation_number, company_name: r.company_name, total: Number(r.total) })),
    LIMIT_MAX
  );
  return {
    label: `Performa Invoice Summary${dateInfo ? ` (${dateInfo.label})` : ''}`,
    params: { dateInfo },
    data: { dateInfo, count: Number(totalsRow.cnt), totalValue: Number(totalsRow.total), truncated, performaInvoices: returned },
  };
}

// ---------- Customers / Follow-Ups ----------

async function customerSummary(rawArgs) {
  const search = String(rawArgs.companyName || '').trim();
  if (!search) return { label: 'Customer Summary', params: {}, data: { error: 'A company name is required.' } };

  const company = await db.prepare(`SELECT id, name, address, state, gstin, contact_person, phone, email FROM company WHERE name ILIKE ? ORDER BY name LIMIT 1`).get(`%${search}%`);
  if (!company) return { label: 'Customer Summary', params: { search }, data: { found: false, search } };

  const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
  const lapseMonths = settings?.default_lapse_months ?? 12;
  const lapseDays = Math.round(lapseMonths * 30.44);

  const stats = await db
    .prepare(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount),0) AS total_revenue,
              MIN(sale_date) AS first_order_date, MAX(sale_date) AS last_order_date,
              (CURRENT_DATE - MIN(sale_date)) AS days_since_first_order, (CURRENT_DATE - MAX(sale_date)) AS days_since_last_order
       FROM sales_record WHERE needs_review = 0 AND company_name = ?`
    )
    .get(company.name);
  const orderCount = Number(stats.order_count);
  const totalRevenue = Number(stats.total_revenue);

  let health = { status: 'no_history', label: 'No Purchase History' };
  if (orderCount > 0) {
    const avgRow = await db
      .prepare(`SELECT AVG(total) AS avg_total FROM (SELECT company_name, SUM(total_amount) AS total FROM sales_record WHERE needs_review = 0 GROUP BY company_name) t`)
      .get();
    const avgRevenue = Number(avgRow.avg_total) || 0;
    const status = classifyHealthStatus({
      daysSinceFirstOrder: Number(stats.days_since_first_order),
      daysSinceLastOrder: Number(stats.days_since_last_order),
      totalRevenue,
      avgRevenue,
      lapseDays,
    });
    health = { status, label: status.replace(/_/g, ' ') };
  }

  const quotationRows = await db
    .prepare(`SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS total FROM quotation WHERE company_id = ? GROUP BY status`)
    .all(company.id);
  const quotationTotal = quotationRows.reduce((sum, r) => sum + Number(r.total), 0);
  const quotationCount = quotationRows.reduce((sum, r) => sum + Number(r.cnt), 0);

  const followUpRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM quotation_follow_up f JOIN quotation q ON q.id = f.quotation_id
       WHERE q.company_id = ? AND f.status = 'scheduled'`
    )
    .get(company.id);

  return {
    label: `Customer Summary: ${company.name}`,
    params: { search },
    data: {
      found: true,
      company: { name: company.name, address: company.address, state: company.state, contact_person: company.contact_person, phone: company.phone, email: company.email },
      health,
      sales: {
        totalRevenue,
        orderCount,
        avgOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
        firstOrderDate: stats.first_order_date,
        lastOrderDate: stats.last_order_date,
      },
      quotations: { count: quotationCount, totalValue: quotationTotal, byStatus: quotationRows.map((r) => ({ status: r.status, count: Number(r.cnt), value: Number(r.total) })) },
      pendingFollowUps: Number(followUpRow.cnt),
    },
  };
}

async function followUpSummary(rawArgs) {
  const bucket = FOLLOW_UP_BUCKETS.includes(rawArgs.bucket) ? rawArgs.bucket : 'all';
  const { overdue, dueToday, upcoming } = await getGroupedFollowUps();
  const companyFilter = rawArgs.companyName ? String(rawArgs.companyName).trim().toLowerCase() : null;

  function filterByCompany(rows) {
    if (!companyFilter) return rows;
    return rows.filter((r) => r.company_name.toLowerCase().includes(companyFilter));
  }

  const overdueF = filterByCompany(overdue);
  const dueTodayF = filterByCompany(dueToday);
  const upcomingF = filterByCompany(upcoming);

  let selected;
  if (bucket === 'overdue') selected = overdueF;
  else if (bucket === 'due_today') selected = dueTodayF;
  else if (bucket === 'upcoming') selected = upcomingF;
  else selected = [...overdueF, ...dueTodayF, ...upcomingF];

  const { returned, truncated, count } = limitedList(
    selected.map((f) => ({ company_name: f.company_name, quotation_number: f.quotation_number, follow_up_date: f.follow_up_date, notes: f.notes })),
    LIMIT_MAX
  );

  return {
    label: `Follow-Up Summary (${bucket.replace('_', ' ')})`,
    params: { bucket, companyName: rawArgs.companyName || null },
    data: {
      bucket,
      overdueCount: overdueF.length,
      dueTodayCount: dueTodayF.length,
      upcomingCount: upcomingF.length,
      count,
      truncated,
      followUps: returned,
    },
  };
}

// ---------- Products / Health / Growth (reuse existing authoritative calculations) ----------

async function productPerformance(rawArgs) {
  const mode = PRODUCT_PERFORMANCE_MODES.includes(rawArgs.mode) ? rawArgs.mode : 'top';
  const limit = clampInt(rawArgs.limit, LIMIT_MIN, LIMIT_MAX, 10);
  const all = await getAllProductIntelligence();

  if (mode === 'lookup') {
    const search = String(rawArgs.search || '').trim().toLowerCase();
    if (!search) return { label: 'Product Performance', params: { mode }, data: { error: 'A product name or part number is required for lookup.' } };
    const matches = all.filter((p) => p.part_no.toLowerCase().includes(search) || p.description.toLowerCase().includes(search)).slice(0, 5);
    return { label: `Product Lookup: "${rawArgs.search}"`, params: { mode, search: rawArgs.search }, data: { found: matches.length > 0, products: matches } };
  }

  let ranked;
  if (mode === 'declining') {
    ranked = all.filter((p) => p.trendDirection === 'declining').sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0));
  } else if (mode === 'frequently_quoted_rarely_purchased') {
    ranked = all.filter((p) => p.quotedLineCount > 0).sort((a, b) => (b.quotedLineCount - b.orderCount) - (a.quotedLineCount - a.orderCount));
  } else {
    ranked = all.filter((p) => p.orderCount > 0).sort((a, b) => b.revenue - a.revenue);
  }

  const { returned, truncated, count } = limitedList(ranked, limit);
  return { label: `Product Performance (${mode.replace(/_/g, ' ')})`, params: { mode, limit }, data: { mode, count, truncated, products: returned } };
}

async function businessHealthSummary() {
  const health = await getBusinessHealth();
  return { label: 'Business Health Score', params: {}, data: health };
}

async function customerHealthSummary(rawArgs) {
  const limit = clampInt(rawArgs.limit, LIMIT_MIN, LIMIT_MAX, 20);
  const all = await getAllCompanyHealth();
  const filtered = CUSTOMER_HEALTH_STATUSES.includes(rawArgs.status) ? all.filter((c) => c.status === rawArgs.status) : all;
  const summary = {
    total: all.length,
    active: all.filter((c) => c.status === 'active').length,
    strong: all.filter((c) => c.status === 'strong').length,
    atRisk: all.filter((c) => c.status === 'at_risk').length,
    inactive: all.filter((c) => c.status === 'inactive').length,
    new: all.filter((c) => c.status === 'new').length,
    noHistory: all.filter((c) => c.status === 'no_history').length,
  };
  const { returned, truncated, count } = limitedList(filtered, limit);
  return { label: 'Customer Health Summary', params: { status: rawArgs.status || null, limit }, data: { summary, count, truncated, customers: returned } };
}

async function growthOpportunitiesSummary(rawArgs) {
  const limit = clampInt(rawArgs.limit, LIMIT_MIN, LIMIT_MAX, 10);
  const { opportunities, summary } = await detectAllOpportunities(db);
  const filtered = rawArgs.type ? opportunities.filter((o) => o.type === rawArgs.type) : opportunities;
  const { returned, truncated, count } = limitedList(filtered, limit);
  return { label: 'Growth Opportunities', params: { type: rawArgs.type || null, limit }, data: { summary, count, truncated, opportunities: returned } };
}

// ---------- Gemini function declarations ----------

export const TOOL_DECLARATIONS = [
  {
    name: 'sales_summary',
    description:
      "Total revenue, order count, and average order value for a time period, e.g. 'what were our sales in 2024', 'how much revenue this year', 'January 2024 sales'. Also returns the best month within the period.",
    parametersJsonSchema: { type: 'object', properties: { dateRange: DATE_RANGE_PARAM_SCHEMA } },
  },
  {
    name: 'top_customers',
    description: "Rank customers by revenue for a time period. Use for 'top customers in 2024', 'who bought the most last year'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { dateRange: DATE_RANGE_PARAM_SCHEMA, limit: { type: 'number', description: 'How many to return. Default 10.' } },
    },
  },
  {
    name: 'top_products',
    description: "Rank products by revenue for a time period. Use for 'best-selling products in 2024', 'which products sold the most last year'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { dateRange: DATE_RANGE_PARAM_SCHEMA, limit: { type: 'number', description: 'How many to return. Default 10.' } },
    },
  },
  {
    name: 'sales_by_customer',
    description: "What a specific customer bought (including a product-by-product breakdown), how much they spent in total, and their order history, optionally within a time period. Use for 'what did Avid buy last year', 'how much has Avid purchased', 'what products has Avid ordered'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { companyName: { type: 'string', description: 'Customer/company name (partial match is fine).' }, dateRange: DATE_RANGE_PARAM_SCHEMA },
      required: ['companyName'],
    },
  },
  {
    name: 'sales_by_product',
    description: "Revenue, units sold, and customer count for a specific product, optionally within a time period. Use for 'how much did we sell of X', 'revenue for product Y'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'Product name or part number (partial match).' }, dateRange: DATE_RANGE_PARAM_SCHEMA },
      required: ['search'],
    },
  },
  {
    name: 'revenue_comparison',
    description: "Compare total revenue between two time periods. Use for 'compare 2024 with 2023', 'how does this year compare to last year'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { dateRangeA: DATE_RANGE_PARAM_SCHEMA, dateRangeB: DATE_RANGE_PARAM_SCHEMA },
      required: ['dateRangeA', 'dateRangeB'],
    },
  },
  {
    name: 'inactive_customers',
    description: "Find customers who haven't purchased in a while. Use for 'which customers haven't purchased in 90 days' (convert 90 days to ~3 months) or 'inactive customers'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { months: { type: 'number', description: 'Months of inactivity. Omit to use the company default.' } },
    },
  },
  {
    name: 'quotation_search',
    description:
      "Search/filter quotations by customer, status, value range, date, or whether they're unconverted (not yet a PO/PI and not rejected). Use for 'quotations above ₹1 lakh that haven't converted', 'show all quotations for Avid', 'quotations we sent in 2024'.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        companyName: { type: 'string' },
        status: { type: 'string', enum: QUOTATION_STATUSES },
        minValue: { type: 'number' },
        maxValue: { type: 'number' },
        unconvertedOnly: { type: 'boolean', description: 'true = not rejected and no PO/PI yet.' },
        dateRange: DATE_RANGE_PARAM_SCHEMA,
      },
    },
  },
  {
    name: 'quotation_summary',
    description: "Counts and values of quotations grouped by status (draft/sent/accepted/rejected), plus how many converted to a PO/PI, for an optional time period. Use for 'how many quotations did we send in 2024'.",
    parametersJsonSchema: { type: 'object', properties: { dateRange: DATE_RANGE_PARAM_SCHEMA } },
  },
  {
    name: 'pipeline_value',
    description: "Current sales pipeline: total open opportunity value and breakdown by stage. Use for 'how much business is in my pipeline'.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'awaiting_customer_response',
    description: "Quotations sent to a customer and still awaiting their response. Use for 'quotations awaiting customer response', 'which quotes are still open'.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purchase_order_summary',
    description: "Count and total value of purchase orders received, optionally within a time period, including which quotations they came from. Use for 'how many POs did we receive in 2024', 'largest purchase orders'.",
    parametersJsonSchema: { type: 'object', properties: { dateRange: DATE_RANGE_PARAM_SCHEMA } },
  },
  {
    name: 'performa_invoice_summary',
    description: "Count and total value of performa invoices issued, optionally within a time period. Use for 'how many proforma invoices were issued this year'.",
    parametersJsonSchema: { type: 'object', properties: { dateRange: DATE_RANGE_PARAM_SCHEMA } },
  },
  {
    name: 'customer_summary',
    description: "Full profile of a specific customer: contact info, purchase health status, total revenue, order history, quotation activity, and pending follow-ups. Use for 'tell me about Avid Pharma Solutions', 'when was Avid's last purchase', 'does Avid have pending follow-ups'.",
    parametersJsonSchema: { type: 'object', properties: { companyName: { type: 'string' } }, required: ['companyName'] },
  },
  {
    name: 'follow_up_summary',
    description: "Scheduled quotation follow-ups: overdue, due today, or upcoming, optionally for a specific customer. Use for 'who should I follow up with today', 'overdue follow-ups', 'follow-ups for Avid'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { bucket: { type: 'string', enum: FOLLOW_UP_BUCKETS, description: 'Default all.' }, companyName: { type: 'string' } },
    },
  },
  {
    name: 'product_performance',
    description:
      "Product performance rankings: best-selling ('top'), declining sales trend ('declining'), quoted often but rarely actually purchased ('frequently_quoted_rarely_purchased'), or look up one specific product ('lookup', requires search).",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: PRODUCT_PERFORMANCE_MODES, description: 'Default top.' },
        search: { type: 'string', description: 'Required when mode=lookup.' },
        limit: { type: 'number', description: 'Default 10.' },
      },
    },
  },
  {
    name: 'business_health_summary',
    description: "Overall Business Health score (0-100), its 5 components (Sales, Customer Health, Follow-Ups, Conversions, Repeat Business), and the single biggest recommended improvement. Use for 'what is our business health score', 'why is our score low'.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'customer_health_summary',
    description: "Customer Health breakdown across the whole customer base (new/strong/active/at_risk/inactive/no_history), optionally filtered to one status. Use for 'which customers are at risk', 'which customers are inactive'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: CUSTOMER_HEALTH_STATUSES }, limit: { type: 'number', description: 'Default 20.' } },
    },
  },
  {
    name: 'growth_opportunities_summary',
    description: "Detected growth opportunities (cross-sell, at-risk customers, high-value customers, quotations likely to convert), optionally filtered by type. Use for 'what are our biggest growth opportunities'.",
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['cross_sell', 'at_risk', 'high_value', 'quotation_conversion'] }, limit: { type: 'number', description: 'Default 10.' } },
    },
  },
];

const TOOL_HANDLERS = {
  sales_summary: salesSummary,
  top_customers: topCustomers,
  top_products: topProducts,
  sales_by_customer: salesByCustomer,
  sales_by_product: salesByProduct,
  revenue_comparison: revenueComparison,
  inactive_customers: inactiveCustomers,
  quotation_search: quotationSearch,
  quotation_summary: quotationSummary,
  pipeline_value: pipelineValue,
  awaiting_customer_response: awaitingCustomerResponse,
  purchase_order_summary: purchaseOrderSummary,
  performa_invoice_summary: performaInvoiceSummary,
  customer_summary: customerSummary,
  follow_up_summary: followUpSummary,
  product_performance: productPerformance,
  business_health_summary: businessHealthSummary,
  customer_health_summary: customerHealthSummary,
  growth_opportunities_summary: growthOpportunitiesSummary,
};

// The single choke point every model-requested tool call passes through. `name` and `rawArgs` are
// both attacker/model-controlled inputs — `name` is checked against a fixed, hardcoded set of keys
// (never used for dynamic property access beyond this own-property check), and every handler
// validates/clamps its own args before any SQL runs. No handler ever accepts a raw SQL/query string;
// all date boundaries are resolved server-side via dateResolver.js, never trusted from the model.
export async function executeTool(name, rawArgs) {
  if (!Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name)) {
    return { label: 'Unknown tool', params: {}, data: { error: 'That is not a supported business query.' } };
  }
  try {
    return await TOOL_HANDLERS[name](rawArgs || {});
  } catch (err) {
    return { label: 'Error', params: {}, data: { error: 'Unable to retrieve that information right now.' } };
  }
}
