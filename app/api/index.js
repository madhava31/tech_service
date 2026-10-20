import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import db from '../client/api/_lib/db/index.js';
import { requireAuth } from '../client/api/_lib/auth/middleware.js';

import authRouter from '../client/api/_lib/routes/auth.js';
import adminRouter from '../client/api/_lib/routes/admin.js';
import companiesRouter from '../client/api/_lib/routes/companies.js';
import productsRouter from '../client/api/_lib/routes/products.js';
import quotationsRouter from '../client/api/_lib/routes/quotations.js';
import purchaseOrdersRouter from '../client/api/_lib/routes/purchaseOrders.js';
import performaInvoicesRouter from '../client/api/_lib/routes/performaInvoices.js';
import dashboardRouter from '../client/api/_lib/routes/dashboard.js';
import reportsRouter from '../client/api/_lib/routes/reports.js';
import settingsRouter from '../client/api/_lib/routes/settings.js';
import importsRouter from '../client/api/_lib/routes/imports.js';
import aiRouter from '../client/api/_lib/routes/ai.js';
import opportunitiesRouter from '../client/api/_lib/routes/opportunities.js';
import engineersRouter from '../client/api/_lib/routes/engineers.js';
import saleReportsRouter from '../client/api/_lib/routes/saleReports.js';
import inventoryRouter from '../client/api/_lib/routes/inventory.js';
import exportRouter from '../client/api/_lib/routes/export.js';
import firmsRouter from '../client/api/_lib/routes/firms.js';
import branchesRouter from '../client/api/_lib/routes/branches.js';

import compression from 'compression';
import { apiCache } from '../client/api/_lib/cache/apiCache.js';
import {
  initPgNotificationListener,
  broadcastEvent,
  handleSseConnection,
} from '../client/api/_lib/db/events.js';

const app = express();

if (process.env.DATABASE_URL) {
  initPgNotificationListener(process.env.DATABASE_URL);
}

app.set('trust proxy', 1);

const allowedOrigin = process.env.CLIENT_ORIGIN || true;

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// High-performance gzip/deflate response compression
app.use(
  compression({
    level: 6,
    threshold: 512,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security and caching headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Vary', 'Accept-Encoding, Cookie');
  }

  // Invalidate in-memory cache and broadcast realtime notification on mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const tags = [];
    if (req.path.includes('/quotation')) tags.push('dashboard', 'quotations', 'opportunities');
    if (req.path.includes('/sale')) tags.push('dashboard', 'sales', 'opportunities', 'engineers');
    if (req.path.includes('/compan')) tags.push('dashboard', 'companies', 'opportunities');
    if (req.path.includes('/product')) tags.push('dashboard', 'products', 'inventory');
    if (req.path.includes('/inventory') || req.path.includes('/stock')) tags.push('inventory');
    if (req.path.includes('/engineer')) tags.push('engineers', 'dashboard');
    if (req.path.includes('/purchase-order') || req.path.includes('/performa-invoice')) tags.push('dashboard', 'quotations');

    if (tags.length > 0) {
      apiCache.invalidateTags(tags);
      broadcastEvent(db.pool, {
        entity: req.path,
        action: req.method,
        tags,
      }).catch(() => {});
    }
  }
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Real-time Server-Sent Events stream for cache invalidation
app.get('/api/events', requireAuth, handleSseConnection);

// Core PostgreSQL API routes
app.use('/api/auth', authRouter);
app.use('/api/companies', requireAuth, companiesRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/quotations', requireAuth, quotationsRouter);
app.use('/api/purchase-orders', requireAuth, purchaseOrdersRouter);
app.use('/api/performa-invoices', requireAuth, performaInvoicesRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/imports', requireAuth, importsRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/opportunities', requireAuth, opportunitiesRouter);
app.use('/api/engineers', requireAuth, engineersRouter);
app.use('/api/sale-reports', requireAuth, saleReportsRouter);
app.use('/api/inventory', requireAuth, inventoryRouter);
app.use('/api/export', requireAuth, exportRouter);
app.get('/api/sales/pipeline/export', requireAuth, (req, res, next) => {
  req.url = '/pipeline';
  exportRouter(req, res, next);
});
app.get('/api/sales/follow-ups/export', requireAuth, (req, res, next) => {
  req.url = '/follow-ups';
  exportRouter(req, res, next);
});
app.use('/api/admin', adminRouter);

// PostgreSQL Sales Overview endpoint
app.get('/api/sales/overview', requireAuth, async (req, res) => {
  try {
    const summary = await db.prepare(`
      SELECT
        COUNT(*) AS total_sales,
        COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM sales_record
      WHERE needs_review = 0
    `).get();

    res.json({
      totalSales: Number(summary?.total_sales || 0),
      totalRevenue: Number(summary?.total_revenue || 0),
      sales: []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load sales overview' });
  }
});

// PostgreSQL Sales Orders List endpoint
app.get('/api/sales/orders', requireAuth, async (req, res) => {
  try {
    const orders = await db.prepare(`
      SELECT
        id, invoice_no AS number, sale_date AS date, company_name,
        part_no, product_description, qty, price, total_amount AS total
      FROM sales_record
      WHERE needs_review = 0
      ORDER BY sale_date DESC
      LIMIT 100
    `).all();

    res.json({
      orders: orders || [],
      total: orders.length,
      limit: 100,
      offset: 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load sales orders' });
  }
});

app.use('/api/firms', requireAuth, firmsRouter);
app.use('/api/branches', requireAuth, branchesRouter);

app.use((err, req, res, next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export default app;
