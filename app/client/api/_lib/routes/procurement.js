import { Router } from 'express';
import {
  getProcurementOverview,
  getProcurementRequirements,
  getProcurementRequirementById,
  createProcurementRequirement,
  createPoFromRequirement,
  getSuppliers,
  getSupplierById,
  createSupplier,
  getIncomingProcurement,
  getReceivingQueue,
  receivePoStock,
  getProcurementReportsData,
  getProcurementActivity,
} from '../services/procurementService.js';

const router = Router();

/**
 * GET /api/procurement/overview
 */
router.get('/overview', async (req, res) => {
  try {
    const overview = await getProcurementOverview();
    res.json(overview);
  } catch (err) {
    console.error('Failed to get procurement overview:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve procurement overview' });
  }
});

/**
 * GET /api/procurement/requirements
 */
router.get('/requirements', async (req, res) => {
  try {
    const { q, priority, status, sourceType, warehouseId, limit, offset } = req.query;

    const result = await getProcurementRequirements({
      q: q ? String(q) : null,
      priority: priority ? String(priority) : null,
      status: status ? String(status) : null,
      sourceType: sourceType ? String(sourceType) : null,
      warehouseId: warehouseId ? Number(warehouseId) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to list procurement requirements:', err);
    res.status(500).json({ error: err.message || 'Failed to list procurement requirements' });
  }
});

/**
 * GET /api/procurement/requirements/:id
 */
router.get('/requirements/:id', async (req, res) => {
  try {
    const reqData = await getProcurementRequirementById(req.params.id);
    if (!reqData) {
      return res.status(404).json({ error: 'Procurement requirement not found' });
    }
    res.json(reqData);
  } catch (err) {
    console.error('Failed to get procurement requirement detail:', err);
    res.status(500).json({ error: err.message || 'Failed to get procurement requirement detail' });
  }
});

/**
 * POST /api/procurement/requirements
 */
router.post('/requirements', async (req, res) => {
  try {
    const { productId, warehouseId, requiredQuantity, suggestedQuantity, priority, reason, sourceType, sourceReference, supplierId } = req.body;

    const reqItem = await createProcurementRequirement({
      productId,
      warehouseId,
      requiredQuantity,
      suggestedQuantity,
      priority,
      reason,
      sourceType,
      sourceReference,
      supplierId,
      userId: req.legacyAuditUserId,
    });

    res.status(201).json(reqItem);
  } catch (err) {
    console.error('Failed to create procurement requirement:', err);
    res.status(400).json({ error: err.message || 'Failed to create procurement requirement' });
  }
});

/**
 * GET /api/procurement/suppliers
 */
router.get('/suppliers', async (req, res) => {
  try {
    const { q, limit, offset } = req.query;

    const result = await getSuppliers({
      q: q ? String(q) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to list suppliers:', err);
    res.status(500).json({ error: err.message || 'Failed to list suppliers' });
  }
});

/**
 * GET /api/procurement/suppliers/:id
 */
router.get('/suppliers/:id', async (req, res) => {
  try {
    const supplierData = await getSupplierById(req.params.id);
    if (!supplierData) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json(supplierData);
  } catch (err) {
    console.error('Failed to get supplier detail:', err);
    res.status(500).json({ error: err.message || 'Failed to get supplier detail' });
  }
});

/**
 * POST /api/procurement/suppliers
 */
router.post('/suppliers', async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, state, gstin, notes } = req.body;

    const supplier = await createSupplier({
      name,
      contact_person,
      phone,
      email,
      address,
      state,
      gstin,
      notes,
    });

    res.status(201).json(supplier);
  } catch (err) {
    console.error('Failed to create supplier:', err);
    res.status(400).json({ error: err.message || 'Failed to create supplier' });
  }
});

/**
 * GET /api/procurement/incoming
 */
router.get('/incoming', async (req, res) => {
  try {
    const { q, supplierId, warehouseId, status, limit, offset } = req.query;

    const result = await getIncomingProcurement({
      q: q ? String(q) : null,
      supplierId: supplierId ? Number(supplierId) : null,
      warehouseId: warehouseId ? Number(warehouseId) : null,
      status: status ? String(status) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to list incoming procurement:', err);
    res.status(500).json({ error: err.message || 'Failed to list incoming procurement' });
  }
});

/**
 * GET /api/procurement/receiving
 */
router.get('/receiving', async (req, res) => {
  try {
    const { warehouseId, limit, offset } = req.query;

    const result = await getReceivingQueue({
      warehouseId: warehouseId ? Number(warehouseId) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to list receiving queue:', err);
    res.status(500).json({ error: err.message || 'Failed to list receiving queue' });
  }
});

/**
 * POST /api/procurement/receive-stock
 * Atomic PO stock receipt mutation
 */
router.post('/receive-stock', async (req, res) => {
  try {
    const { poId, warehouseId, items, reference, notes } = req.body;

    const result = receivePoStock({
      poId: Number(poId),
      warehouseId: Number(warehouseId),
      items,
      reference,
      notes,
      userId: req.legacyAuditUserId,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('Failed to receive stock:', err);
    res.status(400).json({ error: err.message || 'Failed to receive stock' });
  }
});

/**
 * GET /api/procurement/reports
 */
router.get('/reports', async (req, res) => {
  try {
    const { period, supplierId, productId, warehouseId } = req.query;

    const reports = await getProcurementReportsData({
      period: period ? String(period) : 'month',
      supplierId: supplierId ? Number(supplierId) : null,
      productId: productId ? Number(productId) : null,
      warehouseId: warehouseId ? Number(warehouseId) : null,
    });

    res.json(reports);
  } catch (err) {
    console.error('Failed to get procurement reports:', err);
    res.status(500).json({ error: err.message || 'Failed to get procurement reports' });
  }
});

/**
 * GET /api/procurement/activity
 */
router.get('/activity', async (req, res) => {
  try {
    const { q, supplierId, docType, limit, offset } = req.query;

    const activity = await getProcurementActivity({
      q: q ? String(q) : null,
      supplierId: supplierId ? Number(supplierId) : null,
      docType: docType ? String(docType) : null,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json(activity);
  } catch (err) {
    console.error('Failed to get procurement activity:', err);
    res.status(500).json({ error: err.message || 'Failed to get procurement activity' });
  }
});

export default router;
