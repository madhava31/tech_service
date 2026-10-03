import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

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

const app = express();

app.set('trust proxy', 1);

// Frontend and backend are served from the same Vercel deployment/domain, so this is same-origin
// in production and never actually needs cross-origin sharing — same-origin requests never go
// through CORS checks at all. CLIENT_ORIGIN lets a specific origin be allow-listed explicitly if
// the frontend is ever split to a separate domain. The previous fallback (`|| true`) reflected
// *any* requesting origin back as allowed, which combined with `credentials: true` meant a
// malicious third-party page could make a credentialed cross-origin request and have the browser
// hand back the response — `false` disables cross-origin sharing by default instead (Step 5.6).
const allowedOrigin = process.env.CLIENT_ORIGIN || false;

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Small, dependency-free security headers — safe for every response, no effect on legitimate
// same-origin API/SPA traffic. Deliberately not a full helmet-style framework (Step 5.6 scope).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

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
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/opportunities', requireAuth, opportunitiesRouter);
app.use('/api/engineers', requireAuth, engineersRouter);
app.use('/api/admin', adminRouter);

// Final safety net: every route already wraps its own logic in try/catch and returns a clean
// JSON error, so this should never actually fire in practice. It exists purely so that if
// something ever does slip through uncaught, the client gets a controlled generic JSON response
// instead of Express's default HTML/stack-trace error page (which, outside NODE_ENV=production,
// includes the stack trace in the response body).
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Export Express app for Vercel
export default app;
