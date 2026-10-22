import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// A trend is only reported as "growing"/"declining" beyond this relative change — smaller swings
// are reported as "stable" rather than implying a signal the data doesn't clearly support.
// Same calendar 6-month-vs-prior-6-month convention as Growth Opportunities.
const TREND_STABLE_THRESHOLD = 0.1;

/**
 * Bulk version of the /:id/intelligence calculation below, for the Product Intelligence report.
 * Uses grouped SQL aggregates to compute sales, trends, and quotation activity for all products
 * in memory without N+1 queries.
 */
export function getAllProductIntelligence() {
  const allProducts = db.prepare(`SELECT id, part_no, description FROM product ORDER BY description`).all();

  const salesRows = db
    .prepare(
      `SELECT part_no,
              COUNT(*) AS order_count,
              COALESCE(SUM(total_amount), 0) AS revenue,
              COALESCE(SUM(qty), 0) AS units_sold,
              COUNT(DISTINCT company_name) AS customers,
              MIN(sale_date) AS first_sale_date,
              MAX(sale_date) AS last_sale_date
       FROM sales_record
       WHERE needs_review = 0 AND part_no IS NOT NULL
       GROUP BY part_no`
    )
    .all();
  const salesByPart = new Map(salesRows.map((r) => [r.part_no, r]));

  const trendRows = db
    .prepare(
      `SELECT part_no,
              SUM(CASE WHEN sale_date >= date('now', '-6 months') THEN total_amount ELSE 0 END) AS recent_revenue,
              SUM(CASE WHEN sale_date >= date('now', '-12 months') AND sale_date < date('now', '-6 months') THEN total_amount ELSE 0 END) AS prior_revenue
       FROM sales_record
       WHERE needs_review = 0 AND part_no IS NOT NULL
       GROUP BY part_no`
    )
    .all();
  const trendByPart = new Map(trendRows.map((r) => [r.part_no, r]));

  const quotedRows = db
    .prepare(
      `SELECT p.id AS product_id,
              COUNT(qi.id) AS quoted_line_count,
              COALESCE(SUM(qi.qty), 0) AS quoted_qty,
              COUNT(DISTINCT qi.quotation_id) AS quotation_count
       FROM product p
       LEFT JOIN quotation_item qi ON qi.product_id = p.id OR qi.part_no = p.part_no
       GROUP BY p.id`
    )
    .all();
  const quotedByProductId = new Map(quotedRows.map((r) => [r.product_id, r]));

  return allProducts.map((product) => {
    const sales = salesByPart.get(product.part_no);
    const orderCount = sales ? Number(sales.order_count) : 0;
    const revenue = sales ? Number(sales.revenue) : 0;
    const unitsSold = sales ? Number(sales.units_sold) : 0;

    const trend = trendByPart.get(product.part_no);
    const recentRevenue = trend ? Number(trend.recent_revenue) || 0 : 0;
    const priorRevenue = trend ? Number(trend.prior_revenue) || 0 : 0;
    let trendDirection = 'no_data';
    let pctChange = null;
    if (priorRevenue > 0) {
      pctChange = (recentRevenue - priorRevenue) / priorRevenue;
      trendDirection = Math.abs(pctChange) < TREND_STABLE_THRESHOLD ? 'stable' : pctChange > 0 ? 'growing' : 'declining';
    }

    const quoted = quotedByProductId.get(product.id);

    return {
      id: product.id,
      part_no: product.part_no,
      description: product.description,
      revenue,
      unitsSold,
      customers: sales ? Number(sales.customers) : 0,
      avgSellingPrice: unitsSold > 0 ? revenue / unitsSold : 0,
      orderCount,
      firstSaleDate: sales ? sales.first_sale_date : null,
      lastSaleDate: sales ? sales.last_sale_date : null,
      trendDirection,
      pctChange,
      quotedLineCount: quoted ? Number(quoted.quoted_line_count) : 0,
      quotedQty: quoted ? Number(quoted.quoted_qty) : 0,
      quotationCount: quoted ? Number(quoted.quotation_count) : 0,
    };
  });
}

/**
 * List products with optional search query
 */
router.get('/', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db
      .prepare(`SELECT * FROM product WHERE description LIKE ? OR part_no LIKE ? ORDER BY description`)
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare(`SELECT * FROM product ORDER BY description`).all();
  }
  res.json(rows);
});

/**
 * GET /api/products/intelligence-summary
 * Registered BEFORE /:id so the literal path "intelligence-summary" is not swallowed by dynamic :id.
 */
router.get('/intelligence-summary', (req, res) => {
  try {
    const products = getAllProductIntelligence();
    const withSales = products.filter((p) => p.orderCount > 0);
    let topRevenueProduct = null;
    let topUnitsProduct = null;
    for (const p of withSales) {
      if (!topRevenueProduct || p.revenue > topRevenueProduct.revenue) {
        topRevenueProduct = { part_no: p.part_no, description: p.description, revenue: p.revenue };
      }
      if (!topUnitsProduct || p.unitsSold > topUnitsProduct.unitsSold) {
        topUnitsProduct = { part_no: p.part_no, description: p.description, unitsSold: p.unitsSold };
      }
    }
    res.json({
      products,
      summary: {
        totalProducts: products.length,
        productsWithSales: withSales.length,
        topRevenueProduct,
        topUnitsProduct,
      },
    });
  } catch (err) {
    console.error('Error in /api/products/intelligence-summary:', err);
    res.status(500).json({ error: 'Failed to compute product intelligence summary' });
  }
});

/**
 * GET /api/products/:id/intelligence
 * Detailed intelligence for an individual product.
 */
router.get('/:id/intelligence', (req, res) => {
  try {
    const product = db.prepare(`SELECT id, part_no, description FROM product WHERE id = ?`).get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // sales_record has no product_id FK — part_no is the reliable unique key
    const sales = db
      .prepare(
        `SELECT
           COUNT(*) AS order_count,
           COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(qty), 0) AS units_sold,
           COUNT(DISTINCT company_name) AS customers,
           MIN(sale_date) AS first_sale_date,
           MAX(sale_date) AS last_sale_date
         FROM sales_record
         WHERE needs_review = 0 AND part_no = ?`
      )
      .get(product.part_no);

    const orderCount = Number(sales?.order_count) || 0;
    const revenue = Number(sales?.revenue) || 0;
    const unitsSold = Number(sales?.units_sold) || 0;

    // Trend: trailing 6 months vs prior 6 months
    const trendRow = db
      .prepare(
        `SELECT
           SUM(CASE WHEN sale_date >= date('now', '-6 months') THEN total_amount ELSE 0 END) AS recent_revenue,
           SUM(CASE WHEN sale_date >= date('now', '-12 months') AND sale_date < date('now', '-6 months') THEN total_amount ELSE 0 END) AS prior_revenue
         FROM sales_record
         WHERE needs_review = 0 AND part_no = ?`
      )
      .get(product.part_no);

    const recentRevenue = Number(trendRow?.recent_revenue) || 0;
    const priorRevenue = Number(trendRow?.prior_revenue) || 0;
    let trendDirection = 'no_data';
    let pctChange = null;
    if (priorRevenue > 0) {
      pctChange = (recentRevenue - priorRevenue) / priorRevenue;
      trendDirection = Math.abs(pctChange) < TREND_STABLE_THRESHOLD ? 'stable' : pctChange > 0 ? 'growing' : 'declining';
    }

    // Quotation activity matched by product_id or part_no
    const quoted = db
      .prepare(
        `SELECT COUNT(*) AS quoted_line_count, COALESCE(SUM(qty), 0) AS quoted_qty, COUNT(DISTINCT quotation_id) AS quotation_count
         FROM quotation_item
         WHERE product_id = ? OR part_no = ?`
      )
      .get(product.id, product.part_no);

    res.json({
      product,
      sales: {
        revenue,
        unitsSold,
        customers: Number(sales?.customers) || 0,
        avgSellingPrice: unitsSold > 0 ? revenue / unitsSold : 0,
        orderCount,
        firstSaleDate: sales?.first_sale_date || null,
        lastSaleDate: sales?.last_sale_date || null,
      },
      trend: {
        direction: trendDirection,
        pctChange,
        recentRevenue,
        priorRevenue,
      },
      quotationActivity: {
        quotedLineCount: Number(quoted?.quoted_line_count) || 0,
        quotedQty: Number(quoted?.quoted_qty) || 0,
        quotationCount: Number(quoted?.quotation_count) || 0,
      },
    });
  } catch (err) {
    console.error(`Error in /api/products/${req.params.id}/intelligence:`, err);
    res.status(500).json({ error: 'Failed to compute product intelligence' });
  }
});

/**
 * GET /api/products/:id
 */
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM product WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

/**
 * POST /api/products
 */
router.post('/', (req, res) => {
  const { part_no, hsn_sac, description, unit, default_price } = req.body;
  if (!part_no && !description) return res.status(400).json({ error: 'part_no or description is required' });
  const cleanPart = (part_no?.trim() || description?.trim() || '').toUpperCase();
  const cleanDesc = description?.trim() || part_no?.trim() || '';
  try {
    const existing = db.prepare(`SELECT * FROM product WHERE UPPER(part_no) = UPPER(?)`).get(cleanPart);
    if (existing) {
      return res.status(200).json(existing);
    }
    const info = db
      .prepare(`INSERT INTO product (part_no, hsn_sac, description, unit, default_price) VALUES (?, ?, ?, ?, ?)`)
      .run(cleanPart, hsn_sac || null, cleanDesc, unit || 'Nos', default_price ?? 0);
    const row = db.prepare(`SELECT * FROM product WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db.prepare(`SELECT * FROM product WHERE UPPER(part_no) = UPPER(?)`).get(cleanPart);
      if (existing) return res.status(200).json(existing);
      return res.status(409).json({ error: 'A product with this part number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/products/:id
 */
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM product WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const { part_no, hsn_sac, description, unit, default_price } = req.body;
  db.prepare(
    `UPDATE product SET part_no = ?, hsn_sac = ?, description = ?, unit = ?, default_price = ? WHERE id = ?`
  ).run(
    part_no?.trim() || existing.part_no,
    hsn_sac ?? existing.hsn_sac,
    description?.trim() || existing.description,
    unit ?? existing.unit,
    default_price ?? existing.default_price,
    req.params.id
  );
  const row = db.prepare(`SELECT * FROM product WHERE id = ?`).get(req.params.id);
  res.json(row);
});

export default router;
