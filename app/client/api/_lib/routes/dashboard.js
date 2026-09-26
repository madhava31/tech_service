import { Router } from 'express';
import db from '../db/index.js';
import { classifyHealthStatus } from './companies.js';

const router = Router();

// Shared by /attention (count only) and /inactive-customers (full list) so the two can never
// drift apart — both read the exact same company-level row set. Company-level, not product-level:
// grouped by company_name alone (unlike /api/reports/lapsed, which groups by company_name+part_no
// and would give a different, larger count for the same business question).
export async function getInactiveCustomers(lapseMonths) {
  return db
    .prepare(
      `SELECT company_name, MAX(sale_date) AS last_purchase, SUM(total_amount) AS total_revenue
       FROM sales_record
       WHERE needs_review = 0 AND sale_date IS NOT NULL AND company_name IS NOT NULL
       GROUP BY company_name
       HAVING MAX(sale_date) < (CURRENT_DATE - (? * INTERVAL '1 month'))
       ORDER BY MAX(sale_date) ASC`
    )
    .all(lapseMonths);
}

// Shared by /attention (count only) and /awaiting-customer-response (full list) so the two can
// never drift apart — both read the exact same row set.
export async function getAwaitingCustomerResponseQuotations() {
  return db
    .prepare(
      `SELECT q.id, q.number, q.date, q.total, q.status, c.name AS company_name
       FROM quotation q JOIN company c ON c.id = q.company_id
       WHERE q.status = 'sent'
       ORDER BY q.date ASC`
    )
    .all();
}

// Shared by /attention (count only) and /draft-quotations (full list) so the two can never
// drift apart — both read the exact same row set.
async function getDraftQuotations() {
  return db
    .prepare(
      `SELECT q.id, q.number, q.date, q.total, q.status, c.name AS company_name
       FROM quotation q JOIN company c ON c.id = q.company_id
       WHERE q.status = 'draft'
       ORDER BY q.date ASC`
    )
    .all();
}

// Shared by /attention (count only) and /purchase-orders-not-invoiced (full list) so the two can
// never drift apart — both use the exact same PO-to-PI relationship (performa_invoice.purchase_order_id,
// which is nullable: a PI can be issued directly from a quotation without ever going through a PO).
async function getPurchaseOrdersNotYetInvoiced() {
  return db
    .prepare(
      `SELECT po.id, po.number, po.date, po.client_po_ref, q.id AS quotation_id, q.number AS quotation_number, q.total, c.name AS company_name
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       JOIN company c ON c.id = q.company_id
       LEFT JOIN performa_invoice pi ON pi.purchase_order_id = po.id
       WHERE pi.id IS NULL
       ORDER BY po.date ASC`
    )
    .all();
}

// Shared by /attention (count only) and /flagged-sales-records (full list) so the two can never
// drift apart — both use the exact same filter already established by the existing (untouched)
// /api/reports/review-queue endpoint: needs_review = 1 AND review_dismissed = 0.
async function getSalesRecordsNeedingReview() {
  return db
    .prepare(
      `SELECT id, sale_date, invoice_no, company_name, po_no, part_no, product_description, price, qty, total_amount, review_reason
       FROM sales_record
       WHERE needs_review = 1 AND review_dismissed = 0
       ORDER BY id`
    )
    .all();
}

// Shared by the Step 4.4 dashboard follow-up aggregation (and, in a later step, /attention) so
// both would read the exact same active-follow-up row set. "Active" means status = 'scheduled'
// only — completed/cancelled follow-ups are historical and structurally excluded here, not just
// filtered client-side. The overdue/due-today/upcoming bucket is computed in SQL against
// CURRENT_DATE (not a JS Date) so classification is consistent no matter where the API process
// runs; follow_up_date is a DATE column so this is a plain date comparison, no timezone conversion.
async function getActiveFollowUps() {
  return db
    .prepare(
      `SELECT f.id, f.quotation_id, q.number AS quotation_number, c.name AS company_name,
              f.follow_up_date, f.notes, f.created_at, u.username AS created_by_username,
              CASE
                WHEN f.follow_up_date < CURRENT_DATE THEN 'overdue'
                WHEN f.follow_up_date = CURRENT_DATE THEN 'due_today'
                ELSE 'upcoming'
              END AS bucket
       FROM quotation_follow_up f
       JOIN quotation q ON q.id = f.quotation_id
       JOIN company c ON c.id = q.company_id
       JOIN app_user u ON u.id = f.created_by
       WHERE f.status = 'scheduled'
       ORDER BY f.follow_up_date ASC, f.id ASC`
    )
    .all();
}

// Splits the getActiveFollowUps() row set into the same overdue/dueToday/upcoming buckets used by
// /follow-ups, /attention, and the two urgent-follow-up drill-downs (/overdue-follow-ups,
// /follow-ups-due-today) — one shared source of truth so all four can never disagree, the same
// "shared helper -> /attention count -> dedicated drill-down" pattern used throughout this file.
export async function getGroupedFollowUps() {
  const rows = await getActiveFollowUps();

  const toItem = (r) => ({
    id: r.id,
    quotation_id: r.quotation_id,
    quotation_number: r.quotation_number,
    company_name: r.company_name,
    follow_up_date: r.follow_up_date,
    notes: r.notes,
    created_at: r.created_at,
    created_by_username: r.created_by_username,
  });

  return {
    overdue: rows.filter((r) => r.bucket === 'overdue').map(toItem),
    dueToday: rows.filter((r) => r.bucket === 'due_today').map(toItem),
    upcoming: rows.filter((r) => r.bucket === 'upcoming').map(toItem),
  };
}

router.get('/', async (req, res) => {
  try {
    const salesTotal = (await db.prepare(`SELECT COALESCE(SUM(total_amount),0) t FROM sales_record WHERE needs_review = 0`).get()).t;
    const quotationTotal = (await db.prepare(`SELECT COALESCE(SUM(total),0) t FROM quotation WHERE status = 'accepted'`).get()).t;

    const monthlyTrend = await db
      .prepare(
        `SELECT substr(sale_date::text,1,7) AS month, SUM(total_amount) AS total
         FROM sales_record WHERE needs_review = 0 AND sale_date IS NOT NULL
         GROUP BY month ORDER BY month`
      )
      .all();

    const topCompanies = await db
      .prepare(
        `SELECT company_name, SUM(total_amount) AS total, COUNT(*) AS orders
         FROM sales_record WHERE needs_review = 0
         GROUP BY company_name ORDER BY total DESC LIMIT 10`
      )
      .all();

    const topProducts = await db
      .prepare(
        `SELECT part_no, MAX(product_description) AS product_description, SUM(total_amount) AS total, SUM(qty) AS qty
         FROM sales_record WHERE needs_review = 0
         GROUP BY part_no ORDER BY total DESC LIMIT 10`
      )
      .all();

    // node-postgres returns COUNT(*) as a string (bigint safety) — coerced with Number(...) here,
    // same as every other count in this file (see /attention above), so `counts` actually matches
    // its declared TypeScript type (DashboardData.counts: { ...: number }) instead of silently
    // carrying strings that happen to render fine as text but would misbehave under arithmetic.
    const counts = {
      companies: Number((await db.prepare(`SELECT COUNT(*) c FROM company`).get()).c),
      products: Number((await db.prepare(`SELECT COUNT(*) c FROM product`).get()).c),
      quotations: Number((await db.prepare(`SELECT COUNT(*) c FROM quotation`).get()).c),
      purchaseOrders: Number((await db.prepare(`SELECT COUNT(*) c FROM purchase_order`).get()).c),
      performaInvoices: Number((await db.prepare(`SELECT COUNT(*) c FROM performa_invoice`).get()).c),
      rowsNeedingReview: Number((await db.prepare(`SELECT COUNT(*) c FROM sales_record WHERE needs_review = 1`).get()).c),
    };

    res.json({
      historicalRevenue: salesTotal,
      acceptedQuotationRevenue: quotationTotal,
      monthlyTrend,
      topCompanies,
      topProducts,
      counts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// "Needs Your Attention" — surfaces genuinely actionable conditions the business owner should
// act on today, computed only from fields/relationships that actually exist and mean something:
//  - quotation.status is a real, user-driven workflow field (POST /quotations/:id/status), so
//    'sent' (awaiting a customer decision) and 'draft' (never sent) are reliable signals.
//  - purchase_order.status is NOT reliable: nothing in the app ever changes it away from its
//    'open' default, so it carries no information. The real signal is structural: a PO with no
//    performa_invoice yet means the sale was never invoiced.
//  - "Lapsed" customers reuse the exact same company_settings.default_lapse_months threshold
//    already used by /api/reports/lapsed, rather than inventing a new number.
//  - Deliberately NOT implemented: "quotations expiring soon" — the quotation table has no
//    expiry/validity date column, so there's nothing to compute it from.
router.get('/attention', async (req, res) => {
  try {
    const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
    const lapseMonths = settings?.default_lapse_months ?? 12;

    // node-postgres returns COUNT(*) as a string (bigint safety), so every count is coerced with
    // Number(...) here — left as strings, "0 + '1'" string-concatenates instead of adding, and
    // count === 1 checks (for singular/plural text) silently never match.
    const sentQuotations = (await getAwaitingCustomerResponseQuotations()).length;
    const draftQuotations = (await getDraftQuotations()).length;

    const posAwaitingInvoice = (await getPurchaseOrdersNotYetInvoiced()).length;

    const inactiveCustomers = (await getInactiveCustomers(lapseMonths)).length;

    const rowsNeedingReview = (await getSalesRecordsNeedingReview()).length;

    const { overdue, dueToday } = await getGroupedFollowUps();
    const overdueFollowUps = overdue.length;
    const dueTodayFollowUps = dueToday.length;

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const items = [];

    // Urgent follow-ups are pushed first so they sort ahead of the other 'high' priority items
    // below (the sort is a stable sort by priority only) — the most time-sensitive condition on
    // the dashboard, without changing any existing item's own priority value.
    if (overdueFollowUps > 0) {
      items.push({
        type: 'follow_up_overdue',
        priority: 'high',
        title: `${plural(overdueFollowUps, 'follow-up')} overdue`,
        description: 'These follow-ups are past their scheduled date and need attention.',
        count: overdueFollowUps,
        route: '/overdue-follow-ups',
      });
    }

    if (dueTodayFollowUps > 0) {
      items.push({
        type: 'follow_up_due_today',
        priority: 'high',
        title: `${plural(dueTodayFollowUps, 'follow-up')} due today`,
        description: 'Scheduled for today — reach out before the day ends.',
        count: dueTodayFollowUps,
        route: '/follow-ups-due-today',
      });
    }

    if (sentQuotations > 0) {
      items.push({
        type: 'quotation_followup',
        priority: 'high',
        title: `${plural(sentQuotations, 'quotation')} awaiting customer response`,
        description: 'Sent to the customer but not yet accepted or rejected — follow up to move these forward.',
        count: sentQuotations,
        route: '/awaiting-customer-response',
      });
    }

    if (posAwaitingInvoice > 0) {
      items.push({
        type: 'purchase_order_invoicing',
        priority: 'high',
        title: `${plural(posAwaitingInvoice, 'purchase order')} not yet invoiced`,
        description: 'These orders have no performa invoice issued yet.',
        count: posAwaitingInvoice,
        route: '/purchase-orders-not-invoiced',
      });
    }

    if (draftQuotations > 0) {
      items.push({
        type: 'quotation_draft',
        priority: 'medium',
        title: `${plural(draftQuotations, 'quotation')} still in draft`,
        description: 'Not yet sent to the customer.',
        count: draftQuotations,
        route: '/draft-quotations',
      });
    }

    if (inactiveCustomers > 0) {
      items.push({
        type: 'customer_inactive',
        priority: 'medium',
        title: `${plural(inactiveCustomers, 'customer')} gone quiet`,
        description: `No purchases in the last ${lapseMonths} months.`,
        count: inactiveCustomers,
        route: '/inactive-customers',
      });
    }

    if (rowsNeedingReview > 0) {
      items.push({
        type: 'sales_review',
        priority: 'low',
        title: `${plural(rowsNeedingReview, 'imported sales row')} flagged for review`,
        description: 'Data quality issues found during import (missing or unclear fields).',
        count: rowsNeedingReview,
        route: '/flagged-sales-records',
      });
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const summary = {
      total: items.reduce((sum, it) => sum + it.count, 0),
      highPriority: items.filter((it) => it.priority === 'high').reduce((sum, it) => sum + it.count, 0),
    };

    res.json({ summary, items });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" quotation_followup item — uses the exact same
// getAwaitingCustomerResponseQuotations() row set as that item's count, so the two can never
// disagree.
router.get('/awaiting-customer-response', async (req, res) => {
  try {
    const rows = await getAwaitingCustomerResponseQuotations();
    const quotations = rows.map((r) => ({
      id: r.id,
      number: r.number,
      company_name: r.company_name,
      date: r.date,
      total: Number(r.total),
      status: r.status,
    }));
    res.json({ count: quotations.length, quotations });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" quotation_draft item — uses the exact same
// getDraftQuotations() row set as that item's count, so the two can never disagree.
router.get('/draft-quotations', async (req, res) => {
  try {
    const rows = await getDraftQuotations();
    const quotations = rows.map((r) => ({
      id: r.id,
      number: r.number,
      company_name: r.company_name,
      date: r.date,
      total: Number(r.total),
      status: r.status,
    }));
    res.json({ count: quotations.length, quotations });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" purchase_order_invoicing item — uses the exact
// same getPurchaseOrdersNotYetInvoiced() row set as that item's count, so the two can never
// disagree.
router.get('/purchase-orders-not-invoiced', async (req, res) => {
  try {
    const rows = await getPurchaseOrdersNotYetInvoiced();
    const purchaseOrders = rows.map((r) => ({
      id: r.id,
      number: r.number,
      quotation_id: r.quotation_id,
      quotation_number: r.quotation_number,
      company_name: r.company_name,
      date: r.date,
      total: Number(r.total),
      client_po_ref: r.client_po_ref,
    }));
    res.json({ count: purchaseOrders.length, purchaseOrders });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" sales_review item — uses the exact same
// getSalesRecordsNeedingReview() row set as that item's count, so the two can never disagree.
router.get('/flagged-sales-records', async (req, res) => {
  try {
    const rows = await getSalesRecordsNeedingReview();
    const records = rows.map((r) => ({
      id: r.id,
      sale_date: r.sale_date,
      invoice_no: r.invoice_no,
      company_name: r.company_name,
      po_no: r.po_no,
      part_no: r.part_no,
      product_description: r.product_description,
      price: r.price === null ? null : Number(r.price),
      qty: r.qty === null ? null : Number(r.qty),
      total_amount: r.total_amount === null ? null : Number(r.total_amount),
      review_reason: r.review_reason,
    }));
    res.json({ count: records.length, records });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" customer_inactive item — uses the exact same
// getInactiveCustomers() row set as that item's count, so the two can never disagree.
router.get('/inactive-customers', async (req, res) => {
  try {
    const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
    const lapseMonths = settings?.default_lapse_months ?? 12;

    const rows = await getInactiveCustomers(lapseMonths);
    const today = new Date();

    const customers = rows.map((r) => {
      const lastPurchase = new Date(r.last_purchase);
      const daysInactive = Math.floor((today.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24));
      return {
        company_name: r.company_name,
        last_purchase: r.last_purchase,
        months_inactive: Math.floor(daysInactive / 30.44),
        total_revenue: Number(r.total_revenue),
      };
    });

    res.json({ count: customers.length, months: lapseMonths, customers });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PIPELINE_STAGES = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
];

export async function getPipeline(start, end) {
  let query = `
    SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS value
    FROM quotation
  `;
  const params = [];
  if (start && end) {
    query += ` WHERE date >= ? AND date <= ?`;
    params.push(start, end);
  } else if (start) {
    query += ` WHERE date >= ?`;
    params.push(start);
  } else if (end) {
    query += ` WHERE date <= ?`;
    params.push(end);
  }
  query += ` GROUP BY status`;

  const rows = await db.prepare(query).all(...params);
  const byStage = new Map(rows.map((r) => [r.status, { count: Number(r.count), value: Number(r.value) }]));

  const stages = PIPELINE_STAGES.map(({ key, label }) => ({
    key,
    label,
    count: byStage.get(key)?.count ?? 0,
    value: byStage.get(key)?.value ?? 0,
  }));

  const totalOpportunities = stages.reduce((sum, s) => sum + s.count, 0);
  const totalValue = stages.reduce((sum, s) => sum + s.value, 0);
  const accepted = stages.find((s) => s.key === 'accepted') || { count: 0, value: 0 };
  const acceptedRate = totalValue > 0 ? Math.round((accepted.value / totalValue) * 100) : (totalOpportunities > 0 ? Math.round((accepted.count / totalOpportunities) * 100) : 0);

  const poCountRow = await db.prepare(`SELECT COUNT(*) AS c FROM purchase_order`).get();
  const piCountRow = await db.prepare(`SELECT COUNT(*) AS c FROM performa_invoice`).get();

  return {
    stages,
    summary: {
      totalOpportunities,
      totalValue,
      wonCount: accepted.count,
      wonValue: accepted.value,
      acceptedRate,
    },
    fulfillment: {
      acceptedCount: accepted.count,
      purchaseOrderCount: Number(poCountRow?.c || 0),
      performaInvoiceCount: Number(piCountRow?.c || 0),
    },
  };
}

router.get('/pipeline', async (req, res) => {
  try {
    res.json(await getPipeline());
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Combined snapshot of all active (scheduled) quotation follow-ups, split into overdue/due-today/
// upcoming. Uses the same getGroupedFollowUps() helper as /attention and the two urgent drill-downs
// below, so overdue+dueToday+upcoming can never drift from totalScheduledCount — every row lands in
// exactly one array by construction, and the underlying query already excludes completed/cancelled
// follow-ups structurally (WHERE status = 'scheduled').
router.get('/follow-ups', async (req, res) => {
  try {
    const { overdue, dueToday, upcoming } = await getGroupedFollowUps();

    res.json({
      summary: {
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
        upcomingCount: upcoming.length,
        totalScheduledCount: overdue.length + dueToday.length + upcoming.length,
      },
      overdue,
      dueToday,
      upcoming,
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" follow_up_overdue item — uses the exact same
// getGroupedFollowUps().overdue row set as that item's count, so the two can never disagree.
router.get('/overdue-follow-ups', async (req, res) => {
  try {
    const { overdue } = await getGroupedFollowUps();
    res.json({ count: overdue.length, followUps: overdue });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Drill-down behind the "Needs Your Attention" follow_up_due_today item — uses the exact same
// getGroupedFollowUps().dueToday row set as that item's count, so the two can never disagree.
router.get('/follow-ups-due-today', async (req, res) => {
  try {
    const { dueToday } = await getGroupedFollowUps();
    res.json({ count: dueToday.length, followUps: dueToday });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Recent Activity — previously computed by the frontend from three FULL list fetches
// (all quotations/all purchase orders/all performa invoices) just to show the newest 7. That grows
// unbounded with total history. Each query here is bounded at the SQL level (LIMIT 7 per entity,
// 21 rows max total) and the three small result sets are merged/sorted the same way the frontend
// used to, so the visible top-7 is identical to before — just without ever fetching full history.
router.get('/recent-activity', async (req, res) => {
  try {
    const quotations = await db
      .prepare(
        `SELECT q.id, q.number, q.date, q.status, c.name AS company_name
         FROM quotation q JOIN company c ON c.id = q.company_id
         ORDER BY q.date DESC, q.id DESC LIMIT 7`
      )
      .all();
    const purchaseOrders = await db
      .prepare(
        `SELECT po.id, po.number, po.date, po.status, c.name AS company_name
         FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id
         ORDER BY po.date DESC, po.id DESC LIMIT 7`
      )
      .all();
    const performaInvoices = await db
      .prepare(
        `SELECT pi.id, pi.number, pi.date, pi.status, c.name AS company_name
         FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id
         ORDER BY pi.date DESC, pi.id DESC LIMIT 7`
      )
      .all();

    const activity = [
      ...quotations.map((r) => ({ type: 'quotation', id: r.id, number: r.number, company_name: r.company_name, status: r.status, date: r.date })),
      ...purchaseOrders.map((r) => ({ type: 'purchase_order', id: r.id, number: r.number, company_name: r.company_name, status: r.status, date: r.date })),
      ...performaInvoices.map((r) => ({ type: 'performa_invoice', id: r.id, number: r.number, company_name: r.company_name, status: r.status, date: r.date })),
    ]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id)
      .slice(0, 7);

    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Business Health Score — a single owner-friendly 0-100 summary averaged from 5 sub-scores, each
// reusing an already-proven definition from earlier steps rather than inventing a parallel metric:
//   Sales           — % of total pipeline value that has moved past 'sent' into accepted/PO/PI
//                      (reuses getPipeline(), Step 6.1's pipeline definition, unchanged).
//   Customer Health — % of customers (with purchase history) classified new/strong/active rather
//                      than at_risk/inactive (reuses classifyHealthStatus(), Step 6.2, unchanged).
//   Follow-Ups      — % of currently-scheduled follow-ups that are NOT overdue (reuses
//                      getGroupedFollowUps(), unchanged). No scheduled follow-ups at all scores 100
//                      (nothing is being neglected), documented rather than left undefined.
//   Conversions     — of quotations that left draft (sent/accepted/rejected or already has a
//                      PO/PI), % that reached PO or PI — the pipeline's own definition of "won".
//   Repeat Business — % of customers (with purchase history) who have placed 2+ orders.
// Equal-weighted average, documented rather than an unexplained weighting scheme.
const HEALTH_SCORE_TIERS = { green: 70, yellow: 40 }; // >=70 green, 40-69 yellow, <40 red
const TIER_LABELS = { green: 'Strong', yellow: 'Needs Attention', red: 'At Risk' };

function tierFor(score) {
  if (score >= HEALTH_SCORE_TIERS.green) return 'green';
  if (score >= HEALTH_SCORE_TIERS.yellow) return 'yellow';
  return 'red';
}

// Extracted verbatim from the route handler below (Post-Completion AI Refinement) so the AI
// assistant's business_health_summary tool can reuse the exact same deterministic calculation
// instead of a second implementation — same pattern as getPipeline()/getGroupedFollowUps() above.
// No formula, threshold, or output shape changed by this extraction.
export async function getBusinessHealth() {
    // Sales — value-weighted pipeline momentum.
    const pipeline = await getPipeline();
    const wonValue = pipeline.stages
      .filter((s) => ['accepted', 'purchase_order', 'performa_invoice'].includes(s.key))
      .reduce((sum, s) => sum + s.value, 0);
    const salesScore = pipeline.summary.totalValue > 0 ? (wonValue / pipeline.summary.totalValue) * 100 : null;

    // Customer Health — reuses the exact Step 6.2 classification, bulk-scanned across all companies.
    const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
    const lapseMonths = settings?.default_lapse_months ?? 12;
    const lapseDays = Math.round(lapseMonths * 30.44);
    const custRows = await db
      .prepare(
        `SELECT company_name, COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS total_revenue,
                (CURRENT_DATE - MIN(sale_date)) AS days_since_first_order, (CURRENT_DATE - MAX(sale_date)) AS days_since_last_order
         FROM sales_record
         WHERE needs_review = 0 AND sale_date IS NOT NULL AND company_name IS NOT NULL
         GROUP BY company_name`
      )
      .all();
    const avgRevRow = await db
      .prepare(
        `SELECT AVG(total) AS avg_total FROM (
           SELECT company_name, SUM(total_amount) AS total FROM sales_record WHERE needs_review = 0 GROUP BY company_name
         ) t`
      )
      .get();
    const avgRevenue = Number(avgRevRow.avg_total) || 0;
    let healthyCount = 0;
    for (const r of custRows) {
      const status = classifyHealthStatus({
        daysSinceFirstOrder: Number(r.days_since_first_order),
        daysSinceLastOrder: Number(r.days_since_last_order),
        totalRevenue: Number(r.total_revenue),
        avgRevenue,
        lapseDays,
      });
      if (status === 'new' || status === 'strong' || status === 'active') healthyCount++;
    }
    const customerHealthScore = custRows.length > 0 ? (healthyCount / custRows.length) * 100 : null;

    // Follow-Ups — % of currently-scheduled follow-ups that are not overdue.
    const { overdue, dueToday, upcoming } = await getGroupedFollowUps();
    const totalScheduled = overdue.length + dueToday.length + upcoming.length;
    const followUpsScore = totalScheduled === 0 ? 100 : ((totalScheduled - overdue.length) / totalScheduled) * 100;

    // Conversions — of quotations that left draft, % that reached PO/PI.
    const decidedCount = pipeline.stages
      .filter((s) => s.key !== 'draft')
      .reduce((sum, s) => sum + s.count, 0);
    // Distinct quotations that reached either artifact — NOT fulfillment.purchaseOrderCount +
    // performaInvoiceCount (those are row counts per table, so a quotation with both a PO and a
    // PI would be counted twice, letting convertedCount exceed decidedCount and the score exceed
    // 100%). COUNT(DISTINCT quotation_id) across both tables avoids that double-count.
    const convertedRow = await db
      .prepare(
        `SELECT COUNT(DISTINCT quotation_id) AS c FROM (
           SELECT quotation_id FROM purchase_order
           UNION
           SELECT quotation_id FROM performa_invoice
         ) t`
      )
      .get();
    const convertedCount = Number(convertedRow.c);
    const conversionsScore = decidedCount > 0 ? (convertedCount / decidedCount) * 100 : null;

    // Repeat Business — % of customers with 2+ orders.
    const repeatCount = custRows.filter((r) => Number(r.order_count) >= 2).length;
    const repeatBusinessScore = custRows.length > 0 ? (repeatCount / custRows.length) * 100 : null;

    const components = {
      sales: {
        label: 'Sales',
        score: salesScore == null ? null : Math.round(salesScore),
        detail: salesScore == null ? 'No quotation activity yet.' : `${Math.round(wonValue).toLocaleString('en-IN')} of ${Math.round(pipeline.summary.totalValue).toLocaleString('en-IN')} in quoted value has become real business (accepted, PO, or PI).`,
      },
      customerHealth: {
        label: 'Customer Health',
        score: customerHealthScore == null ? null : Math.round(customerHealthScore),
        detail: customerHealthScore == null ? 'No customer purchase history yet.' : `${healthyCount} of ${custRows.length} customers with purchase history are new, active, or strong (not at-risk or inactive).`,
      },
      followUps: {
        label: 'Follow-Ups',
        score: Math.round(followUpsScore),
        detail: totalScheduled === 0 ? 'No follow-ups currently scheduled.' : `${overdue.length} of ${totalScheduled} scheduled follow-ups are overdue.`,
      },
      conversions: {
        label: 'Conversions',
        score: conversionsScore == null ? null : Math.round(conversionsScore),
        detail: conversionsScore == null ? 'No quotations have been sent yet.' : `${convertedCount} of ${decidedCount} quotations that left draft status converted to a purchase order or performa invoice.`,
      },
      repeatBusiness: {
        label: 'Repeat Business',
        score: repeatBusinessScore == null ? null : Math.round(repeatBusinessScore),
        detail: repeatBusinessScore == null ? 'No customer purchase history yet.' : `${repeatCount} of ${custRows.length} customers with purchase history have placed 2 or more orders.`,
      },
    };

    const scored = Object.values(components).filter((c) => c.score != null);
    const overallScore = scored.length > 0 ? Math.round(scored.reduce((sum, c) => sum + c.score, 0) / scored.length) : null;

    // Recommendation — deterministic: point at the single weakest scored component, but only if
    // it's below the "green" threshold (nothing urgent if every scored component is already
    // healthy). Uses data already computed above for 4 of 5 cases; Follow-Ups needs one small
    // additive query for its monetary value, reusing the exact same overdue definition
    // (status = 'scheduled' AND follow_up_date < CURRENT_DATE) as getActiveFollowUps() above —
    // not a modification to that function, just the same filter aggregated differently.
    const scoredEntries = Object.entries(components).filter(([, c]) => c.score != null);
    let recommendation = null;
    if (scoredEntries.length > 0) {
      const [weakestKey, weakestComponent] = scoredEntries.reduce((min, cur) => (cur[1].score < min[1].score ? cur : min));
      if (weakestComponent.score < HEALTH_SCORE_TIERS.green) {
        if (weakestKey === 'sales') {
          const openValue = pipeline.summary.totalValue - wonValue;
          recommendation = {
            component: 'sales',
            title: 'Your biggest opportunity is converting quoted business.',
            detail: `₹${Math.round(openValue).toLocaleString('en-IN')} in quotations hasn't become real business yet (still draft, sent, or lost).`,
          };
        } else if (weakestKey === 'customerHealth') {
          const atRiskRows = custRows.filter((r) => {
            const status = classifyHealthStatus({
              daysSinceFirstOrder: Number(r.days_since_first_order),
              daysSinceLastOrder: Number(r.days_since_last_order),
              totalRevenue: Number(r.total_revenue),
              avgRevenue,
              lapseDays,
            });
            return status === 'at_risk' || status === 'inactive';
          });
          const atRiskValue = atRiskRows.reduce((sum, r) => sum + Number(r.total_revenue), 0);
          recommendation = {
            component: 'customerHealth',
            title: 'Your biggest opportunity is re-engaging at-risk customers.',
            detail: `${atRiskRows.length} customers worth ${'₹' + Math.round(atRiskValue).toLocaleString('en-IN')} in historical business are at risk or inactive.`,
          };
        } else if (weakestKey === 'followUps') {
          const overdueValueRow = await db
            .prepare(
              `SELECT COUNT(*) AS overdue_count, COALESCE(SUM(q.total), 0) AS overdue_value
               FROM quotation_follow_up f JOIN quotation q ON q.id = f.quotation_id
               WHERE f.status = 'scheduled' AND f.follow_up_date < CURRENT_DATE`
            )
            .get();
          recommendation = {
            component: 'followUps',
            title: 'Your biggest opportunity is quotation follow-up.',
            detail: `${Number(overdueValueRow.overdue_count)} quotations worth ₹${Math.round(Number(overdueValueRow.overdue_value)).toLocaleString('en-IN')} need attention.`,
          };
        } else if (weakestKey === 'conversions') {
          const openStages = pipeline.stages.filter((s) => ['sent', 'accepted'].includes(s.key));
          const openValue = openStages.reduce((sum, s) => sum + s.value, 0);
          const openCount = openStages.reduce((sum, s) => sum + s.count, 0);
          recommendation = {
            component: 'conversions',
            title: 'Your biggest opportunity is closing open quotations.',
            detail: `${openCount} quotations worth ₹${Math.round(openValue).toLocaleString('en-IN')} are still open and haven't converted.`,
          };
        } else if (weakestKey === 'repeatBusiness') {
          const oneTimeCount = custRows.filter((r) => Number(r.order_count) === 1).length;
          recommendation = {
            component: 'repeatBusiness',
            title: 'Your biggest opportunity is encouraging repeat purchases.',
            detail: `${oneTimeCount} of ${custRows.length} customers have only ordered once — a follow-up could turn them into repeat customers.`,
          };
        }
      }
    }

    return {
      overallScore,
      tier: overallScore == null ? null : tierFor(overallScore),
      tierLabel: overallScore == null ? null : TIER_LABELS[tierFor(overallScore)],
      components,
      recommendation,
    };
}

router.get('/business-health', async (req, res) => {
  try {
    res.json(await getBusinessHealth());
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
