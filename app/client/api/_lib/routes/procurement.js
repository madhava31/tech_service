import { Router } from 'express';
import { sendRouteError } from '../http/errors.js';
import { createSchemaGuard } from '../db/schemaGuard.js';
import {
  getProcurementOverview,
  getProcurementRequirements,
  getProcurementRequirementById,
  createProcurementRequirement,
  getSuppliers,
  getSupplierById,
  createSupplier,
  getIncomingProcurement,
  getReceivingQueue,
  receivePoStock,
  getProcurementReportsData,
  getProcurementActivity,
} from '../procurement/service.js';

// /api/procurement: Postgres port of the legacy SQLite procurement routes
// (app/server/src/routes/procurement.js), limited to supplier purchase orders (see
// procurement/service.js). Converting a requirement into a supplier PO has no frontend and is not
// ported.

const router = Router();

// Tables/columns from migration 001 that procurement needs (see db/schemaGuard.js).
router.use(createSchemaGuard({
  procurement_requirement: ['id', 'requirement_code', 'product_id', 'warehouse_id', 'status', 'purchase_order_id', 'supplier_id'],
  purchase_order: ['supplier_id', 'received_quantity', 'procurement_requirement_id'],
  company: ['is_supplier', 'company_type'],
  stock_receipt: ['id', 'source_type', 'source_reference'],
  stock_receipt_item: ['receipt_id', 'product_id', 'quantity'],
  warehouse: ['id'],
  inventory_stock: ['product_id'],
}, 'Procurement', 'Failed to load procurement data'));

const page = (q) => ({
  limit: Math.min(Math.max(Number(q.limit) || 50, 1), 1000),
  offset: Math.max(Number(q.offset) || 0, 0),
});
const handle = (fn, fallback) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendRouteError(res, err, err.status || 500, fallback);
  }
};

router.get('/overview', handle(async (req, res) => {
  res.json(await getProcurementOverview());
}, 'Failed to retrieve procurement overview'));

router.get('/requirements', handle(async (req, res) => {
  const { q, priority, status, sourceType, warehouseId } = req.query;
  res.json(await getProcurementRequirements({ q, priority, status, sourceType, warehouseId, ...page(req.query) }));
}, 'Failed to list procurement requirements'));

router.get('/requirements/:id', handle(async (req, res) => {
  const data = await getProcurementRequirementById(req.params.id);
  if (!data) return res.status(404).json({ error: 'Procurement requirement not found' });
  res.json(data);
}, 'Failed to get procurement requirement detail'));

router.post('/requirements', handle(async (req, res) => {
  res.status(201).json(await createProcurementRequirement(req.body || {}, req.user));
}, 'Failed to create procurement requirement'));

router.get('/suppliers', handle(async (req, res) => {
  res.json(await getSuppliers({ q: req.query.q, ...page(req.query) }));
}, 'Failed to list suppliers'));

router.get('/suppliers/:id', handle(async (req, res) => {
  const data = await getSupplierById(req.params.id);
  if (!data) return res.status(404).json({ error: 'Supplier not found' });
  res.json(data);
}, 'Failed to get supplier detail'));

router.post('/suppliers', handle(async (req, res) => {
  res.status(201).json(await createSupplier(req.body || {}));
}, 'Failed to create supplier'));

router.get('/incoming', handle(async (req, res) => {
  const { q, supplierId, warehouseId, status } = req.query;
  res.json(await getIncomingProcurement({ q, supplierId, warehouseId, status, ...page(req.query) }));
}, 'Failed to list incoming procurement'));

router.get('/receiving', handle(async (req, res) => {
  res.json(await getReceivingQueue({ warehouseId: req.query.warehouseId, ...page(req.query) }));
}, 'Failed to list receiving queue'));

router.post('/receive-stock', handle(async (req, res) => {
  res.json(await receivePoStock(req.body || {}, req.user));
}, 'Failed to receive stock'));

router.get('/reports', handle(async (req, res) => {
  res.json(await getProcurementReportsData());
}, 'Failed to get procurement reports'));

router.get('/activity', handle(async (req, res) => {
  const { q, docType } = req.query;
  res.json(await getProcurementActivity({ q, docType, ...page(req.query) }));
}, 'Failed to get procurement activity'));

export default router;
