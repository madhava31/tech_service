import { Router } from 'express';
import { sendRouteError } from '../http/errors.js';
import { createSchemaGuard } from '../db/schemaGuard.js';
import {
  getSalesOrders,
  getSalesOrderById,
  getPendingSalesWork,
  getDocumentActivity,
  getCompanySalesHistory,
  getSalesReportsData,
} from '../sales/orders.js';
import {
  getSalesPipeline,
  getSalesPipelineSummary,
  getManagementAttention,
  getHighValueOpportunities,
  getStaleQuotations,
  getFollowUps,
  getFollowUpsDueToday,
  getFollowUpsOverdue,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  getEngineerFollowUpPerformance,
  getCustomer360Pipeline,
  getQuotationTimeline,
} from '../sales/pipeline.js';

// /api/sales: Postgres port of the legacy SQLite sales routes (app/server/src/routes/sales.js).
// GET /overview and the Excel exports are registered directly in app/api/index.js.

const router = Router();

// Tables/columns from migration 001 that the sales module needs (see db/schemaGuard.js).
const REQUIRED_COLUMNS = {
  sale_report: ['id', 'source_quotation_id', 'source_po_id', 'source_pi_id', 'status', 'total_amount'],
  sale_report_item: ['sale_report_id', 'quantity'],
  firm: ['id', 'firm_name'],
  branch: ['id', 'branch_name'],
  quotation: ['firm_id', 'branch_id', 'net_subtotal', 'sales_engineer_id'],
  quotation_follow_up: ['follow_up_time', 'priority', 'firm_id', 'branch_id', 'company_id', 'sales_engineer_id'],
  warehouse: ['id'],
  inventory_stock: ['product_id'],
};
router.use(createSchemaGuard(REQUIRED_COLUMNS, 'Sales', 'Failed to load sales data'));

const intOrNull = (v) => (v ? Number(v) : null);
const handle = (fn, fallback) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendRouteError(res, err, err.status || 500, fallback);
  }
};

router.get('/pipeline', handle(async (req, res) => {
  const { allItems, ...pipeline } = await getSalesPipeline(req.query, req.user);
  res.json(pipeline);
}, 'Failed to get sales pipeline'));

router.get('/pipeline/summary', handle(async (req, res) => {
  res.json(await getSalesPipelineSummary(req.query, req.user));
}, 'Failed to get pipeline summary'));

router.get('/management-attention', handle(async (req, res) => {
  res.json(await getManagementAttention(req.query, req.user));
}, 'Failed to get management attention'));

router.get('/high-value-opportunities', handle(async (req, res) => {
  res.json(await getHighValueOpportunities(req.query, req.user));
}, 'Failed to get high-value opportunities'));

router.get('/stale-quotations', handle(async (req, res) => {
  res.json(await getStaleQuotations(req.query, req.user));
}, 'Failed to get stale quotations'));

router.get('/follow-ups', handle(async (req, res) => {
  res.json(await getFollowUps(req.query));
}, 'Failed to get follow-ups'));

router.get('/follow-ups/due-today', handle(async (req, res) => {
  res.json(await getFollowUpsDueToday(req.query));
}, 'Failed to get due-today follow-ups'));

router.get('/follow-ups/overdue', handle(async (req, res) => {
  res.json(await getFollowUpsOverdue(req.query));
}, 'Failed to get overdue follow-ups'));

router.post('/follow-ups', handle(async (req, res) => {
  res.status(201).json(await createFollowUp(req.body || {}, req.user));
}, 'Failed to create follow-up'));

router.put('/follow-ups/:id', handle(async (req, res) => {
  res.json(await updateFollowUp(req.params.id, req.body || {}, req.user));
}, 'Failed to update follow-up'));

router.post('/follow-ups/:id/complete', handle(async (req, res) => {
  const { outcome, outcome_notes, notes } = req.body || {};
  res.json(await completeFollowUp(req.params.id, { outcome, notes: outcome_notes || notes }, req.user));
}, 'Failed to complete follow-up'));

router.post('/follow-ups/:id/reschedule', handle(async (req, res) => {
  const { follow_up_date, followUpDate, follow_up_time, followUpTime, notes } = req.body || {};
  res.json(await rescheduleFollowUp(req.params.id, { followUpDate: follow_up_date || followUpDate, followUpTime: follow_up_time || followUpTime, notes }, req.user));
}, 'Failed to reschedule follow-up'));

router.get('/engineers/:id/follow-up-performance', handle(async (req, res) => {
  res.json(await getEngineerFollowUpPerformance(req.params.id, req.query, req.user));
}, 'Failed to get engineer follow-up performance'));

router.get('/customers/:id/360', handle(async (req, res) => {
  const c360 = await getCustomer360Pipeline(req.params.id, req.user);
  if (!c360) return res.status(404).json({ error: 'Customer not found' });
  res.json(c360);
}, 'Failed to get customer 360'));

router.get('/quotations/:id/timeline', handle(async (req, res) => {
  const timeline = await getQuotationTimeline(req.params.id);
  if (!timeline) return res.status(404).json({ error: 'Quotation not found' });
  res.json({ timeline, count: timeline.length });
}, 'Failed to get quotation timeline'));

router.get('/orders', handle(async (req, res) => {
  const { q, status, companyId, startDate, endDate, limit, offset } = req.query;
  res.json(await getSalesOrders({
    q: q ? String(q) : null,
    status: status ? String(status) : null,
    companyId: intOrNull(companyId),
    startDate: startDate ? String(startDate) : null,
    endDate: endDate ? String(endDate) : null,
    limit: Math.min(Math.max(Number(limit) || 50, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  }));
}, 'Failed to list sales orders'));

router.get('/orders/:id', handle(async (req, res) => {
  const order = await getSalesOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Sales order not found' });
  res.json(order);
}, 'Failed to get sales order detail'));

router.get('/pending', handle(async (req, res) => {
  res.json(await getPendingSalesWork());
}, 'Failed to retrieve pending sales work'));

// Document events (quotations, POs, PIs, sale reports): the shape the Sales Activity page reads.
router.get('/activity', handle(async (req, res) => {
  const { q, companyId, docType, startDate, endDate, limit, offset } = req.query;
  res.json(await getDocumentActivity({
    q: q ? String(q) : null,
    companyId: intOrNull(companyId),
    docType: docType ? String(docType) : null,
    startDate: startDate ? String(startDate) : null,
    endDate: endDate ? String(endDate) : null,
    limit: Math.min(Math.max(Number(limit) || 50, 1), 1000),
    offset: Math.max(Number(offset) || 0, 0),
  }));
}, 'Failed to retrieve sales activity'));

router.get('/companies/:id/history', handle(async (req, res) => {
  const history = await getCompanySalesHistory(req.params.id);
  if (!history) return res.status(404).json({ error: 'Company not found' });
  res.json(history);
}, 'Failed to retrieve company sales history'));

router.get('/reports', handle(async (req, res) => {
  res.json(await getSalesReportsData());
}, 'Failed to retrieve sales reports'));

export default router;
