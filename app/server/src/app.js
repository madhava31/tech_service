import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import './db/index.js';

import { requireAuth } from './auth/middleware.js';

import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import companiesRouter from './routes/companies.js';
import productsRouter from './routes/products.js';
import quotationsRouter from './routes/quotations.js';
import purchaseOrdersRouter from './routes/purchaseOrders.js';
import performaInvoicesRouter from './routes/performaInvoices.js';
import dashboardRouter from './routes/dashboard.js';
import reportsRouter from './routes/reports.js';
import settingsRouter from './routes/settings.js';
import importsRouter from './routes/imports.js';
import opportunitiesRouter from './routes/opportunities.js';
import inventoryRouter from './routes/inventory.js';
import saleReportsRouter from './routes/saleReports.js';
import salesRouter from './routes/sales.js';
import procurementRouter from './routes/procurement.js';
import engineersRouter from './routes/engineers.js';
import firmsRouter from './routes/firms.js';
import branchesRouter from './routes/branches.js';
import exportRouter from './routes/export.js';
import searchRouter from './routes/search.js';

const app = express();

app.set('trust proxy', 1);

// Restrict CORS in production if CLIENT_ORIGIN is set.
// Allow all origins for local development.
const allowedOrigin = process.env.CLIENT_ORIGIN || true;

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

import { handleSseConnection } from './db/events.js';

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Real-time Server-Sent Events stream for cache invalidation
app.get('/api/events', requireAuth, handleSseConnection);

// API routes
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
app.use('/api/opportunities', requireAuth, opportunitiesRouter);
app.use('/api/inventory', requireAuth, inventoryRouter);
app.use('/api/sale-reports', requireAuth, saleReportsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/procurement', requireAuth, procurementRouter);
app.use('/api/engineers', requireAuth, engineersRouter);
app.use('/api/firms', requireAuth, firmsRouter);
app.use('/api/branches', requireAuth, branchesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/search', requireAuth, searchRouter);
app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err?.message || 'Something went wrong. Please try again.' });
});

// Export Express app for Vercel
export default app;