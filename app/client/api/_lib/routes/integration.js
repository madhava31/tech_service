import crypto from 'node:crypto';
import { Router } from 'express';
import db from '../db/index.js';
import { ensureSalesRequestSchema } from '../integration/requestSchema.js';

// Data for the Technicon Sales app, over shared keys instead of a login: no ERP login is both safe and useful
// here, because admin can change everything and staff see only their own quotations.
//
// Reading (GET) uses ERP_INTEGRATION_KEY and returns only the columns the sales app needs: no costs, margins,
// notes or line prices. The one thing the sales app may write is a request for a quotation (POST
// /quotation-requests), which uses its own key, ERP_INTEGRATION_WRITE_KEY, so the read key can never write.
// With a key unset (or under 32 characters), the routes it guards answer 404.
const router = Router();

function keyMatches(req, key) {
  const sent = (req.get('authorization') ?? '').replace(/^Bearer /, '');
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireReadKey(req, res, next) {
  const key = process.env.ERP_INTEGRATION_KEY;
  if (!key || key.length < 32) return res.status(404).json({ error: 'Not found' });
  if (!keyMatches(req, key)) return res.status(401).json({ error: 'Invalid key' });
  next();
}

function requireWriteKey(req, res, next) {
  const key = process.env.ERP_INTEGRATION_WRITE_KEY;
  // The write key has to be its own: a deployment that reused the read key would let it write.
  if (!key || key.length < 32 || key === process.env.ERP_INTEGRATION_KEY) return res.status(404).json({ error: 'Not found' });
  if (!keyMatches(req, key)) return res.status(401).json({ error: 'Invalid key' });
  next();
}

// Reading is GET only. A POST goes to its own route below, with its own key.
router.use((req, res, next) => (req.method === 'GET' ? requireReadKey(req, res, next) : next()));

// One page at a time, by id, so a sync never asks the database for everything at once.
function page(req) {
  const afterId = Math.max(0, parseInt(req.query.after_id, 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  return { afterId, limit };
}

function listRoute(path, select) {
  router.get(path, async (req, res) => {
    try {
      const { afterId, limit } = page(req);
      res.json(await db.prepare(select).all(afterId, limit));
    } catch (err) {
      console.error(`Integration ${path} failed:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
}

listRoute(
  '/customers',
  `SELECT id, name, address, state, gstin, contact_person, phone, email FROM company
   WHERE id > ? AND COALESCE(is_supplier, 0) = 0 AND COALESCE(company_type, '') <> 'supplier'
   ORDER BY id LIMIT ?`
);

listRoute('/products', `SELECT id, part_no, description, make, key_features FROM product WHERE id > ? ORDER BY id LIMIT ?`);

listRoute('/quotations', `SELECT id, number, date, status, total, company_id FROM quotation WHERE id > ? ORDER BY id LIMIT ?`);

// Customers' purchase orders only: a row with a supplier is what the company itself ordered.
listRoute('/orders', `SELECT id, number, date, quotation_id, client_po_ref, status FROM purchase_order WHERE id > ? AND supplier_id IS NULL ORDER BY id LIMIT ?`);

// ---- A salesperson asks for a quotation ----
const text = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

function cleanRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const salesId = Number(b.sales_request_id);
  if (!Number.isInteger(salesId) || salesId <= 0) return { error: 'sales_request_id must be a positive integer' };
  const company = b.company && typeof b.company === 'object' ? b.company : {};
  const companyName = text(company.name, 200);
  if (!companyName) return { error: 'company.name is required' };
  const code = text(b.opportunity_code, 60);
  if (!code) return { error: 'opportunity_code is required' };
  const requestedBy = text(b.requested_by, 120);
  if (!requestedBy) return { error: 'requested_by is required' };
  const rawProducts = Array.isArray(b.products) ? b.products.slice(0, 100) : [];
  const products = rawProducts
    .map((p) => ({ part_no: text(p?.part_no, 80), name: text(p?.name, 300), oem: text(p?.oem, 120) }))
    .filter((p) => p.name || p.part_no);
  const oems = (Array.isArray(b.oems) ? b.oems.slice(0, 20) : []).map((o) => text(o, 120)).filter(Boolean);
  const value = b.estimated_value === null || b.estimated_value === undefined ? null : Number(b.estimated_value);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e12)) return { error: 'estimated_value must be a number' };
  const closeDate = typeof b.expected_close_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.expected_close_date) ? b.expected_close_date.slice(0, 10) : null;
  const requestedAt = b.requested_at && !Number.isNaN(Date.parse(b.requested_at)) ? new Date(b.requested_at).toISOString() : null;
  const erpCompanyId = Number.isInteger(Number(company.erp_company_id)) && Number(company.erp_company_id) > 0 ? Number(company.erp_company_id) : null;
  return {
    values: [
      salesId, code, text(b.opportunity_title, 300), requestedBy, text(b.salesperson, 120),
      companyName, text(company.city, 120), text(company.state, 120), text(company.address, 500), text(company.gstin, 30), erpCompanyId,
      text(b.contact?.name, 120), text(b.contact?.phone, 60), text(b.contact?.email, 160),
      JSON.stringify(oems), JSON.stringify(products), value, closeDate, text(b.notes, 2000), requestedAt,
    ],
  };
}

router.post('/quotation-requests', requireWriteKey, async (req, res) => {
  try {
    const clean = cleanRequest(req.body);
    if (clean.error) return res.status(400).json({ error: clean.error });
    await ensureSalesRequestSchema(db.pool);
    const made = await db
      .prepare(
        `INSERT INTO sales_quotation_request
           (sales_request_id, opportunity_code, opportunity_title, requested_by, salesperson,
            company_name, company_city, company_state, company_address, company_gstin, erp_company_id,
            contact_name, contact_phone, contact_email, oems, products, estimated_value, expected_close_date, notes, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)
         ON CONFLICT (sales_request_id) DO NOTHING RETURNING id`
      )
      .get(...clean.values);
    if (made) return res.status(201).json({ id: made.id });
    // The same request sent again (a retry): it is already here.
    const existing = await db.prepare(`SELECT id FROM sales_quotation_request WHERE sales_request_id = ?`).get(clean.values[0]);
    res.status(200).json({ id: existing.id });
  } catch (err) {
    console.error('Integration quotation request failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
