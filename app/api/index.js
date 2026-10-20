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
  ALLOWED_TAGS,
} from '../client/api/_lib/db/events.js';

export function getMutationTags(path, customTags) {
  if (Array.isArray(customTags) && customTags.length > 0) {
    return customTags.filter((t) => ALLOWED_TAGS.has(t));
  }
  const tags = new Set();
  const p = (path || '').toLowerCase();

  if (p.includes('/quotation')) {
    tags.add('quotations');
    tags.add('dashboard');
    tags.add('opportunities');
  }
  if (p.includes('/sale')) {
    tags.add('sales');
    tags.add('dashboard');
    tags.add('opportunities');
    tags.add('engineers');
    tags.add('reports');
  }
  if (p.includes('/compan')) {
    tags.add('companies');
    tags.add('dashboard');
    tags.add('opportunities');
  }
  if (p.includes('/product')) {
    tags.add('products');
    tags.add('dashboard');
    tags.add('inventory');
  }
  if (p.includes('/inventory') || p.includes('/stock') || p.includes('/warehouse')) {
    tags.add('inventory');
    tags.add('products');
    tags.add('dashboard');
  }
  if (p.includes('/engineer')) {
    tags.add('engineers');
    tags.add('dashboard');
    tags.add('sales');
  }
  if (p.includes('/purchase-order')) {
    tags.add('purchase_orders');
    tags.add('dashboard');
    tags.add('quotations');
  }
  if (p.includes('/performa-invoice')) {
    tags.add('performa_invoices');
    tags.add('dashboard');
    tags.add('quotations');
  }
  if (p.includes('/firm')) {
    tags.add('firms');
    tags.add('dashboard');
    tags.add('settings');
  }
  if (p.includes('/branch')) {
    tags.add('branches');
    tags.add('firms');
    tags.add('dashboard');
    tags.add('settings');
  }
  if (p.includes('/settings')) {
    tags.add('settings');
    tags.add('dashboard');
    tags.add('quotations');
  }
  if (p.includes('/admin')) {
    tags.add('admin');
    tags.add('engineers');
    tags.add('dashboard');
  }
  if (p.includes('/report')) {
    tags.add('reports');
    tags.add('sales');
    tags.add('companies');
    tags.add('products');
    tags.add('dashboard');
  }
  if (p.includes('/opportunit')) {
    tags.add('opportunities');
    tags.add('dashboard');
  }

  return Array.from(tags).filter((t) => ALLOWED_TAGS.has(t));
}

const app = express();

if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
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

  // Defer cache invalidation and notification until AFTER route handler runs and response finishes
  // Never broadcast when validation, authorization, or database operations failed
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && !res.locals.mutationFailed) {
        const tags = getMutationTags(req.path, res.locals.mutationTags);
        if (tags.length > 0) {
          apiCache.invalidateTags(tags);
          broadcastEvent(db.pool, {
            entity: req.path,
            action: req.method,
            tags,
          }).catch(() => {});
        }
      }
    });
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
