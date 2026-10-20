import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

export const NEW_CUSTOMER_WINDOW_DAYS = 90;
export const STRONG_VALUE_MULTIPLIER = 1.5;
export const HEALTH_LABELS = {
  new: 'New',
  inactive: 'Inactive',
  at_risk: 'At Risk',
  strong: 'Strong',
  active: 'Active',
  no_history: 'No Purchase History',
};

export function classifyHealthStatus({ daysSinceFirstOrder, daysSinceLastOrder, totalRevenue, avgRevenue, lapseDays }) {
  if (daysSinceFirstOrder <= NEW_CUSTOMER_WINDOW_DAYS) return 'new';
  if (daysSinceLastOrder >= lapseDays) return 'inactive';
  if (daysSinceLastOrder >= lapseDays * 0.5) return 'at_risk';
  if (avgRevenue > 0 && totalRevenue >= avgRevenue * STRONG_VALUE_MULTIPLIER) return 'strong';
  return 'active';
}

export function getAllCompanyHealth() {
  const settings = db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
  const lapseMonths = settings?.default_lapse_months ?? 12;
  const lapseDays = Math.round(lapseMonths * 30.44);

  const allCompanies = db.prepare(`SELECT id, name FROM company ORDER BY name`).all();

  const salesRows = db
    .prepare(
      `SELECT company_name,
              COUNT(*) AS order_count,
              COALESCE(SUM(total_amount), 0) AS total_revenue,
              MIN(sale_date) AS first_order_date,
              MAX(sale_date) AS last_order_date,
              CAST(julianday('now') - julianday(MIN(sale_date)) AS INTEGER) AS days_since_first_order,
              CAST(julianday('now') - julianday(MAX(sale_date)) AS INTEGER) AS days_since_last_order
       FROM sales_record
       WHERE needs_review = 0 AND sale_date IS NOT NULL AND company_name IS NOT NULL
       GROUP BY company_name`
    )
    .all();
  const salesByName = new Map(salesRows.map((r) => [r.company_name, r]));

  const avgRow = db
    .prepare(
      `SELECT AVG(total) AS avg_total FROM (
         SELECT company_name, SUM(total_amount) AS total FROM sales_record WHERE needs_review = 0 GROUP BY company_name
       ) t`
    )
    .get();
  const avgRevenue = Number(avgRow?.avg_total) || 0;

  const customers = allCompanies.map((c) => {
    const r = salesByName.get(c.name);
    if (!r) {
      return {
        company_id: c.id,
        company_name: c.name,
        status: 'no_history',
        label: HEALTH_LABELS.no_history,
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
      label: HEALTH_LABELS[status] || status,
      totalRevenue,
      orderCount,
      avgOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
      firstOrderDate: r.first_order_date,
      lastOrderDate: r.last_order_date,
      daysSinceLastOrder,
      lapseMonths,
    };
  });

  const summary = {
    total: customers.length,
    active: customers.filter((c) => c.status === 'active').length,
    strong: customers.filter((c) => c.status === 'strong').length,
    atRisk: customers.filter((c) => c.status === 'at_risk').length,
    inactive: customers.filter((c) => c.status === 'inactive').length,
    new: customers.filter((c) => c.status === 'new').length,
    noHistory: customers.filter((c) => c.status === 'no_history').length,
  };

  return { customers, summary };
}

router.get('/', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db
      .prepare(`SELECT * FROM company WHERE name LIKE ? ORDER BY name`)
      .all(`%${q}%`);
  } else {
    rows = db.prepare(`SELECT * FROM company ORDER BY name`).all();
  }
  res.json(rows);
});

// IMPORTANT: /health-summary must be before /:id so :id doesn't match 'health-summary'
router.get('/health-summary', (req, res) => {
  try {
    res.json(getAllCompanyHealth());
  } catch (err) {
    console.error('Error fetching company health summary:', err);
    res.status(500).json({ error: 'Failed to load customer health summary.' });
  }
});

router.get('/:id/health', (req, res) => {
  try {
    const company = db.prepare(`SELECT id, name FROM company WHERE id = ?`).get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const settings = db.prepare(`SELECT default_lapse_months FROM company_settings WHERE id = 1`).get();
    const lapseMonths = settings?.default_lapse_months ?? 12;
    const lapseDays = Math.round(lapseMonths * 30.44);

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS order_count,
           COALESCE(SUM(total_amount), 0) AS total_revenue,
           MIN(sale_date) AS first_order_date,
           MAX(sale_date) AS last_order_date,
           CAST(julianday('now') - julianday(MIN(sale_date)) AS INTEGER) AS days_since_first_order,
           CAST(julianday('now') - julianday(MAX(sale_date)) AS INTEGER) AS days_since_last_order
         FROM sales_record
         WHERE needs_review = 0 AND company_name = ?`
      )
      .get(company.name);

    const orderCount = Number(stats?.order_count || 0);
    const totalRevenue = Number(stats?.total_revenue || 0);

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

    const avgRow = db
      .prepare(
        `SELECT AVG(total) AS avg_total FROM (
           SELECT company_name, SUM(total_amount) AS total
           FROM sales_record WHERE needs_review = 0
           GROUP BY company_name
         ) t`
      )
      .get();
    const avgRevenue = Number(avgRow?.avg_total) || 0;

    const daysSinceFirstOrder = Number(stats.days_since_first_order);
    const daysSinceLastOrder = Number(stats.days_since_last_order);
    const status = classifyHealthStatus({ daysSinceFirstOrder, daysSinceLastOrder, totalRevenue, avgRevenue, lapseDays });

    res.json({
      company,
      health: {
        status,
        label: HEALTH_LABELS[status] || status,
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
    console.error('Error fetching company health detail:', err);
    res.status(500).json({ error: 'Failed to load company health.' });
  }
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { name, address, state, gstin, contact_person, phone, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const trimmed = name.trim();
  try {
    const existing = db.prepare(`SELECT * FROM company WHERE UPPER(name) = UPPER(?)`).get(trimmed);
    if (existing) {
      return res.status(200).json(existing);
    }
    const info = db
      .prepare(
        `INSERT INTO company (name, address, state, gstin, contact_person, phone, email)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(trimmed, address || null, state || null, gstin || null, contact_person || null, phone || null, email || null);
    const row = db.prepare(`SELECT * FROM company WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db.prepare(`SELECT * FROM company WHERE UPPER(name) = UPPER(?)`).get(trimmed);
      if (existing) return res.status(200).json(existing);
      return res.status(409).json({ error: 'A company with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { name, address, state, gstin, contact_person, phone, email } = req.body;
  db.prepare(
    `UPDATE company SET name = ?, address = ?, state = ?, gstin = ?, contact_person = ?, phone = ?, email = ? WHERE id = ?`
  ).run(
    name?.trim() || existing.name,
    address ?? existing.address,
    state ?? existing.state,
    gstin ?? existing.gstin,
    contact_person ?? existing.contact_person,
    phone ?? existing.phone,
    email ?? existing.email,
    req.params.id
  );
  const row = db.prepare(`SELECT * FROM company WHERE id = ?`).get(req.params.id);
  res.json(row);
});

export default router;
