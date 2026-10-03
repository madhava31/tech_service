import { Router } from 'express';
import ExcelJS from 'exceljs';
import db from '../db/index.js';

const router = Router();

router.get('/companies', async (req, res) => {
  try {
    const { startDate, endDate, partNo } = req.query;
    let sql = `SELECT company_name, COUNT(*) AS order_count, SUM(total_amount) AS total, SUM(qty) AS total_qty
               FROM sales_record WHERE needs_review = 0`;
    const params = [];
    if (startDate) {
      sql += ` AND sale_date >= ?`;
      params.push(String(startDate));
    }
    if (endDate) {
      sql += ` AND sale_date <= ?`;
      params.push(String(endDate));
    }
    if (partNo) {
      sql += ` AND part_no = ?`;
      params.push(String(partNo));
    }
    sql += ` GROUP BY company_name ORDER BY total DESC`;
    const rows = await db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/companies/:name/history', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT sale_date, invoice_no, po_no, part_no, product_description, price, qty, total_amount
         FROM sales_record WHERE needs_review = 0 AND company_name = ?
         ORDER BY sale_date`
      )
      .all(req.params.name);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/products', async (req, res) => {
  try {
    const { startDate, endDate, companyName } = req.query;
    let sql = `SELECT part_no, MAX(product_description) AS product_description, COUNT(*) AS order_count, SUM(qty) AS total_qty, SUM(total_amount) AS total
               FROM sales_record WHERE needs_review = 0`;
    const params = [];
    if (startDate) {
      sql += ` AND sale_date >= ?`;
      params.push(String(startDate));
    }
    if (endDate) {
      sql += ` AND sale_date <= ?`;
      params.push(String(endDate));
    }
    if (companyName) {
      sql += ` AND company_name = ?`;
      params.push(String(companyName));
    }
    sql += ` GROUP BY part_no ORDER BY total DESC`;
    const rows = await db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/review-queue', async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT * FROM sales_record WHERE needs_review = 1 AND review_dismissed = 0 ORDER BY id`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/lapsed', async (req, res) => {
  try {
    const months = Math.max(1, parseInt(req.query.months, 10) || 12);
    const rows = await db
      .prepare(
        `SELECT company_name, part_no, MAX(product_description) AS product_description,
                MAX(sale_date) AS last_purchase, SUM(total_amount) AS total_revenue,
                CAST((CURRENT_DATE - MAX(sale_date)) / 30.44 AS INTEGER) AS months_since
         FROM sales_record
         WHERE needs_review = 0 AND sale_date IS NOT NULL
         GROUP BY company_name, part_no
         HAVING MAX(sale_date) < (CURRENT_DATE - (? * INTERVAL '1 month'))
         ORDER BY total_revenue DESC`
      )
      .all(months);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/companies/:name/year-comparison', async (req, res) => {
  try {
    const company = req.params.name;

    const yearRows = await db
      .prepare(
        `SELECT DISTINCT substr(sale_date::text,1,4) AS year
         FROM sales_record
         WHERE needs_review = 0 AND company_name = ? AND sale_date IS NOT NULL
         ORDER BY year DESC LIMIT 2`
      )
      .all(company);
    const recentYears = yearRows.map((r) => r.year).sort(); // chronological: older year first, newer year second

    if (recentYears.length === 0) return res.json({ years: [], products: [] });

    const placeholders = recentYears.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT part_no, MAX(product_description) AS product_description, substr(sale_date::text,1,4) AS year, SUM(total_amount) AS total
         FROM sales_record
         WHERE needs_review = 0 AND company_name = ? AND substr(sale_date::text,1,4) IN (${placeholders})
         GROUP BY part_no, year`
      )
      .all(company, ...recentYears);

    const byPart = new Map();
    for (const r of rows) {
      if (!byPart.has(r.part_no)) byPart.set(r.part_no, { part_no: r.part_no, product_description: r.product_description, byYear: {} });
      byPart.get(r.part_no).byYear[r.year] = r.total;
    }

    const [olderYear, newerYear] = recentYears;
    const products = [...byPart.values()]
      .map((p) => ({
        part_no: p.part_no,
        product_description: p.product_description,
        older_total: p.byYear[olderYear] || 0,
        newer_total: newerYear ? p.byYear[newerYear] || 0 : null,
      }))
      // Biggest drop-offs first (bought heavily before, nothing/little now) so they're the first bars a reader sees.
      .sort((a, b) => (b.older_total - (b.newer_total ?? b.older_total)) - (a.older_total - (a.newer_total ?? a.older_total)));

    res.json({ years: recentYears, products });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/company-yearly', async (req, res) => {
  try {
    const { company } = req.query;
    if (!company) return res.status(400).json({ error: 'company query param is required' });

    const products = await db
      .prepare(
        `SELECT part_no, MAX(product_description) AS product_description, SUM(total_amount) AS total
         FROM sales_record WHERE needs_review = 0 AND company_name = ?
         GROUP BY part_no ORDER BY total DESC LIMIT 10`
      )
      .all(company);

    if (products.length === 0) return res.json({ products: [], years: [], rows: [] });

    const partNos = products.map((p) => p.part_no);
    const placeholders = partNos.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT part_no, substr(sale_date::text,1,4) AS year, SUM(total_amount) AS total
         FROM sales_record
         WHERE needs_review = 0 AND company_name = ? AND sale_date IS NOT NULL AND part_no IN (${placeholders})
         GROUP BY part_no, year`
      )
      .all(company, ...partNos);

    const years = [...new Set(rows.map((r) => r.year))].sort();
    res.json({ products, years, rows });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const { type } = req.query;
    const workbook = new ExcelJS.Workbook();

    if (type === 'products') {
      const rows = await db
        .prepare(
          `SELECT part_no, MAX(product_description) AS product_description, COUNT(*) AS order_count, SUM(qty) AS total_qty, SUM(total_amount) AS total
           FROM sales_record WHERE needs_review = 0 GROUP BY part_no ORDER BY total DESC`
        )
        .all();
      const sheet = workbook.addWorksheet('Products');
      sheet.columns = [
        { header: 'Part No', key: 'part_no', width: 18 },
        { header: 'Description', key: 'product_description', width: 40 },
        { header: 'Orders', key: 'order_count', width: 10 },
        { header: 'Total Qty', key: 'total_qty', width: 12 },
        { header: 'Total Revenue', key: 'total', width: 16 },
      ];
      sheet.addRows(rows);
    } else {
      const rows = await db
        .prepare(
          `SELECT company_name, COUNT(*) AS order_count, SUM(total_amount) AS total, SUM(qty) AS total_qty
           FROM sales_record WHERE needs_review = 0 GROUP BY company_name ORDER BY total DESC`
        )
        .all();
      const sheet = workbook.addWorksheet('Companies');
      sheet.columns = [
        { header: 'Company', key: 'company_name', width: 40 },
        { header: 'Orders', key: 'order_count', width: 10 },
        { header: 'Total Qty', key: 'total_qty', width: 12 },
        { header: 'Total Revenue', key: 'total', width: 16 },
      ];
      sheet.addRows(rows);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type || 'companies'}-report.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
