import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let rows;
    if (q) {
      rows = await db
        .prepare(`SELECT * FROM company WHERE name ILIKE ? ORDER BY name`)
        .all(`%${q}%`);
    } else {
      rows = await db.prepare(`SELECT * FROM company ORDER BY name`).all();
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Registered before /:id so the literal path "health-summary" can never be swallowed by the
// dynamic :id segment (Express matches routes in registration order). getAllCompanyHealth is a
// hoisted function declaration defined further down this file, alongside classifyHealthStatus.
router.get('/health-summary', async (req, res) => {
  try {
    const customers = await getAllCompanyHealth();
    const summary = {
      total: customers.length,
      active: customers.filter((c) => c.status === 'active').length,
      strong: customers.filter((c) => c.status === 'strong').length,
      atRisk: customers.filter((c) => c.status === 'at_risk').length,
      inactive: customers.filter((c) => c.status === 'inactive').length,
      new: customers.filter((c) => c.status === 'new').length,
      noHistory: customers.filter((c) => c.status === 'no_history').length,
    };
    res.json({ customers, summary });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Company not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Customer Health thresholds. "New" and the inactive/at-risk boundary reuse the exact same
// company-level recency signal as dashboard.js's getInactiveCustomers() (grouped by company_name,
// needs_review = 0) so this view can never disagree with the existing Inactive Customers report.
// default_lapse_months is the same admin-configurable setting used there (company_settings, id=1).
export const NEW_CUSTOMER_WINDOW_DAYS = 90;
export const STRONG_VALUE_MULTIPLIER = 1.5;

export const HEALTH_LABELS = { new: 'New', inactive: 'Inactive', at_risk: 'At Risk', strong: 'Strong', active: 'Active' };

// Single source of truth for Customer Health classification — used by both the single-company
// /:id/health endpoint below and the bulk Growth Opportunities scan (Step 6.3), so the two can
// never disagree about which companies are at-risk/inactive/strong. Pure function, no DB access.
export function classifyHealthStatus({ daysSinceFirstOrder, daysSinceLastOrder, totalRevenue, avgRevenue, lapseDays }) {
  if (daysSinceFirstOrder <= NEW_CUSTOMER_WINDOW_DAYS) return 'new';
  if (daysSinceLastOrder >= lapseDays) return 'inactive';
  if (daysSinceLastOrder >= lapseDays * 0.5) return 'at_risk';
  if (avgRevenue > 0 && totalRevenue >= avgRevenue * STRONG_VALUE_MULTIPLIER) return 'strong';
  return 'active';
}

// Bulk version of the /:id/health calculation above, for the Customer Health report (Updating Step
// 3) — one pass over ALL companies instead of one request per company. Reuses classifyHealthStatus
// verbatim; the only new thing here is including companies with zero sales_record rows (as
// "no_history") in the result set, which /:id/health also does but the existing bulk scans used by
// Growth Opportunities (Step 6.3) and Business Health (Step 6.5) deliberately do not — those two
// intentionally operate over "companies with purchase history" only, and are NOT changed here to
// avoid altering their already-verified denominators.
export async function getAllCompanyHealth() {
  const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
  const lapseMonths = settings?.default_lapse_months ?? 12;
  const lapseDays = Math.round(lapseMonths * 30.44);

  const allCompanies = await db.prepare(`SELECT id, name FROM company ORDER BY name`).all();

  const salesRows = await db
    .prepare(
      `SELECT company_name,
              COUNT(*) AS order_count,
              COALESCE(SUM(total_amount), 0) AS total_revenue,
              MIN(sale_date) AS first_order_date,
              MAX(sale_date) AS last_order_date,
              (CURRENT_DATE - MIN(sale_date)) AS days_since_first_order,
              (CURRENT_DATE - MAX(sale_date)) AS days_since_last_order
       FROM sales_record
       WHERE needs_review = 0 AND sale_date IS NOT NULL AND company_name IS NOT NULL
       GROUP BY company_name`
    )
    .all();
  const salesByName = new Map(salesRows.map((r) => [r.company_name, r]));

  const avgRow = await db
    .prepare(
      `SELECT AVG(total) AS avg_total FROM (
         SELECT company_name, SUM(total_amount) AS total FROM sales_record WHERE needs_review = 0 GROUP BY company_name
       ) t`
    )
    .get();
  const avgRevenue = Number(avgRow.avg_total) || 0;

  return allCompanies.map((c) => {
    const r = salesByName.get(c.name);
    if (!r) {
      return {
        company_id: c.id,
        company_name: c.name,
        status: 'no_history',
        label: 'No Purchase History',
        totalRevenue: 0,
        orderCount: 0,
        avgOrderValue: 0,
        firstOrderDate: null,
        lastOrderDate: null,
        daysSinceLastOrder: null,
        lapseMonths,
      };
    }
    const daysSinceFirstOrder = Number(r.days_since_first_order);
    const daysSinceLastOrder = Number(r.days_since_last_order);
    const totalRevenue = Number(r.total_revenue);
    const orderCount = Number(r.order_count);
    const status = classifyHealthStatus({ daysSinceFirstOrder, daysSinceLastOrder, totalRevenue, avgRevenue, lapseDays });
    return {
      company_id: c.id,
      company_name: c.name,
      status,
      label: HEALTH_LABELS[status],
      totalRevenue,
      orderCount,
      avgOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
      firstOrderDate: r.first_order_date,
      lastOrderDate: r.last_order_date,
      daysSinceLastOrder,
      lapseMonths,
    };
  });
}

router.get('/:id/health', async (req, res) => {
  try {
    const company = await db.prepare(`SELECT id, name FROM company WHERE id = ?`).get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const settings = await db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
    const lapseMonths = settings?.default_lapse_months ?? 12;
    const lapseDays = Math.round(lapseMonths * 30.44);

    const stats = await db
      .prepare(
        `SELECT
           COUNT(*) AS order_count,
           COALESCE(SUM(total_amount), 0) AS total_revenue,
           MIN(sale_date) AS first_order_date,
           MAX(sale_date) AS last_order_date,
           (CURRENT_DATE - MIN(sale_date)) AS days_since_first_order,
           (CURRENT_DATE - MAX(sale_date)) AS days_since_last_order
         FROM sales_record
         WHERE needs_review = 0 AND company_name = ?`
      )
      .get(company.name);

    const orderCount = Number(stats.order_count);
    const totalRevenue = Number(stats.total_revenue);

    if (orderCount === 0) {
      return res.json({
        company,
        health: {
          status: 'no_history',
          label: 'No Purchase History',
          totalRevenue: 0,
          orderCount: 0,
          avgOrderValue: 0,
          firstOrderDate: null,
          lastOrderDate: null,
          daysSinceLastOrder: null,
          lapseMonths,
        },
      });
    }

    // Overall average total business per active customer — the reference point for distinguishing
    // "Strong" (standout value) from plain "Active". Computed from the same sales_record filter as
    // every other revenue query in this codebase.
    const avgRow = await db
      .prepare(
        `SELECT AVG(total) AS avg_total FROM (
           SELECT company_name, SUM(total_amount) AS total
           FROM sales_record WHERE needs_review = 0
           GROUP BY company_name
         ) t`
      )
      .get();
    const avgRevenue = Number(avgRow.avg_total) || 0;

    const daysSinceFirstOrder = Number(stats.days_since_first_order);
    const daysSinceLastOrder = Number(stats.days_since_last_order);

    const status = classifyHealthStatus({ daysSinceFirstOrder, daysSinceLastOrder, totalRevenue, avgRevenue, lapseDays });

    res.json({
      company,
      health: {
        status,
        label: HEALTH_LABELS[status],
        totalRevenue,
        orderCount,
        avgOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
        firstOrderDate: stats.first_order_date,
        lastOrderDate: stats.last_order_date,
        daysSinceLastOrder,
        lapseMonths,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  const { name, address, state, gstin, contact_person, phone, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const info = await db
      .prepare(
        `INSERT INTO company (name, address, state, gstin, contact_person, phone, email)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(name.trim(), address || null, state || null, gstin || null, contact_person || null, phone || null, email || null);
    const row = await db.prepare(`SELECT * FROM company WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A company with this name already exists' });
    }
    res.status(500).json({ error: 'Unable to save the company. Please try again.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Company not found' });
    const { name, address, state, gstin, contact_person, phone, email } = req.body;
    await db
      .prepare(
        `UPDATE company SET name = ?, address = ?, state = ?, gstin = ?, contact_person = ?, phone = ?, email = ? WHERE id = ?`
      )
      .run(
        name?.trim() || existing.name,
        address ?? existing.address,
        state ?? existing.state,
        gstin ?? existing.gstin,
        contact_person ?? existing.contact_person,
        phone ?? existing.phone,
        email ?? existing.email,
        req.params.id
      );
    const row = await db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Unable to save the company. Please try again.' });
  }
});

// ---------- Delete ----------
// Admin only, and never cascading: a company still used by business records is refused with a
// message naming what still uses it. Tables/columns added by migration 001 are only checked
// where they exist, so this also works on a database without them.
const COMPANY_REFERENCES = [
  ['quotation', 'company_id', 'quotation'],
  ['sales_record', 'company_id', 'sales record'],
  ['sale_report', 'company_id', 'sale report'],
  ['procurement_requirement', 'supplier_id', 'procurement requirement'],
  ['purchase_order', 'supplier_id', 'supplier purchase order'],
];
const MAX_BULK_DELETE = 500;

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can delete companies' });
  next();
}

function toIds(values) {
  const ids = [...new Set((Array.isArray(values) ? values : [values]).map(Number))];
  return ids.every((n) => Number.isInteger(n) && n > 0) ? ids : null;
}

/** company id -> ['2 quotations', '1 sales record', ...] for the given ids (only those referenced). */
async function companyReferences(ids) {
  const present = await db
    .prepare(
      `SELECT table_name || '.' || column_name AS ref FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name || '.' || column_name = ANY(?::text[])`
    )
    .all(COMPANY_REFERENCES.map(([t, c]) => `${t}.${c}`));
  const have = new Set(present.map((r) => r.ref));
  const refs = new Map();
  for (const [table, column, label] of COMPANY_REFERENCES) {
    if (!have.has(`${table}.${column}`)) continue;
    // table/column come from the constant list above, never from the request
    const rows = await db
      .prepare(`SELECT ${column} AS id, COUNT(*)::int AS n FROM ${table} WHERE ${column} = ANY(?::int[]) GROUP BY ${column}`)
      .all(ids);
    for (const r of rows) {
      if (!refs.has(r.id)) refs.set(r.id, []);
      refs.get(r.id).push(`${r.n} ${label}${r.n === 1 ? '' : 's'}`);
    }
  }
  return refs;
}

router.delete('/:id', adminOnly, async (req, res) => {
  const ids = toIds(req.params.id);
  if (!ids) return res.status(400).json({ error: 'Invalid company id' });
  try {
    const company = await db.prepare(`SELECT id, name FROM company WHERE id = ?`).get(ids[0]);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const used = (await companyReferences(ids)).get(company.id);
    if (used) {
      return res.status(409).json({ error: `Cannot delete "${company.name}": it is still used by ${used.join(', ')}.` });
    }
    await db.prepare(`DELETE FROM company WHERE id = ?`).run(company.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') {
      // a record started referencing the company between the check and the delete
      return res.status(409).json({ error: 'Cannot delete this company: it is still used by other records.' });
    }
    console.error('Failed to delete company:', err);
    res.status(500).json({ error: 'Unable to delete the company. Please try again.' });
  }
});

router.post('/bulk-delete', adminOnly, async (req, res) => {
  const ids = toIds(req.body?.ids ?? []);
  if (!ids || ids.length === 0) return res.status(400).json({ error: 'Select at least one company to delete' });
  if (ids.length > MAX_BULK_DELETE) return res.status(400).json({ error: `At most ${MAX_BULK_DELETE} companies can be deleted at once` });
  try {
    const result = await db.transaction(async () => {
      const companies = await db.prepare(`SELECT id, name FROM company WHERE id = ANY(?::int[]) FOR UPDATE`).all(ids);
      const refs = await companyReferences(companies.map((c) => c.id));
      const blocked = companies.filter((c) => refs.has(c.id));
      const deletable = companies.filter((c) => !refs.has(c.id)).map((c) => c.id);
      if (deletable.length) await db.prepare(`DELETE FROM company WHERE id = ANY(?::int[])`).run(deletable);
      return { deletedCount: deletable.length, blocked, notFound: ids.length - companies.length };
    });
    const { deletedCount, blocked, notFound } = result;
    const parts = [`Deleted ${deletedCount} compan${deletedCount === 1 ? 'y' : 'ies'}.`];
    if (blocked.length) parts.push(`${blocked.length} could not be deleted because they are still used by other records: ${blocked.map((c) => c.name).join(', ')}.`);
    if (notFound) parts.push(`${notFound} no longer existed.`);
    res.json({
      success: true,
      deletedCount,
      blockedCount: blocked.length,
      blockedNames: blocked.map((c) => c.name),
      message: parts.join(' '),
    });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Nothing was deleted: some companies started being used by other records. Please try again.' });
    }
    console.error('Failed to bulk delete companies:', err);
    res.status(500).json({ error: 'Unable to delete the selected companies. Please try again.' });
  }
});

export default router;
