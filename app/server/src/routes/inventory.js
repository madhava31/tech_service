import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  getStockSummary,
  getProductStock,
  recordStockIn,
  recordStockOut,
  adjustStock,
  reserveStock,
  releaseReservation,
  fulfillReservation,
  recordReturn,
  getMovements,
  getReservations,
  getReservationById,
  getInventoryOverview,
  getStockIntelligence,
  getStockReceipts,
  getStockReceiptById,
  createStockReceipt,
  confirmDraftReceipt,
  analyzeExcelStockWorkbook,
  previewExcelStockInward,
  getOperationsOverview,
  getOperationsStockAlerts,
  getOperationsCriticalStock,
  getOperationsOutOfStock,
  getOperationsRestockQueue,
  getOperationsIncomingStock,
  getOperationsPendingReservations,
  createStockAdjustment,
  createStockReturn,
  createStockTransfer,
  getStockTransfers,
  getTransferById,
  getOperationsInventoryAudit,
} from '../services/inventoryService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

/**
 * GET /api/inventory/overview
 * Aggregate inventory overview KPIs
 */
router.get('/overview', (req, res) => {
  try {
    const overview = getInventoryOverview();
    res.json(overview);
  } catch (err) {
    console.error('Error fetching inventory overview:', err);
    res.status(500).json({ error: 'Failed to fetch inventory overview' });
  }
});

/**
 * GET /api/inventory/intelligence
 * Aggregate inventory intelligence, sales velocity, coverage, and restock recommendations
 */
router.get('/intelligence', (req, res) => {
  try {
    const warehouseId = req.query.warehouse_id || req.query.warehouseId ? Number(req.query.warehouse_id || req.query.warehouseId) : null;
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    const periodDays = req.query.period ? Number(req.query.period) : 30;
    const start = req.query.start ? String(req.query.start).trim() : null;
    const end = req.query.end ? String(req.query.end).trim() : null;
    const limit = req.query.limit ? Number(req.query.limit) : null;
    const offset = req.query.offset ? Number(req.query.offset) : null;

    const intelligence = getStockIntelligence({ start, end, warehouseId, productId, periodDays, limit, offset });
    res.json(intelligence);
  } catch (err) {
    console.error('Error fetching stock intelligence:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch stock intelligence' });
  }
});

/**
 * GET /api/inventory/warehouses
 */
router.get('/warehouses', (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const warehouses = getWarehouses({ activeOnly });
    res.json(warehouses);
  } catch (err) {
    console.error('Error fetching warehouses:', err);
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
});

/**
 * GET /api/inventory/warehouses/:id
 */
router.get('/warehouses/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid warehouse ID' });

    const warehouse = getWarehouseById(id);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });

    res.json(warehouse);
  } catch (err) {
    console.error('Error fetching warehouse:', err);
    res.status(500).json({ error: 'Failed to fetch warehouse' });
  }
});

/**
 * POST /api/inventory/warehouses
 */
router.post('/warehouses', (req, res) => {
  try {
    const { name, code, address, city, state, isDefault } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const warehouse = createWarehouse({
      name,
      code,
      address,
      city,
      state,
      isDefault: Boolean(isDefault),
    });

    res.status(201).json(warehouse);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A warehouse with this code already exists' });
    }
    console.error('Error creating warehouse:', err);
    res.status(400).json({ error: err.message || 'Failed to create warehouse' });
  }
});

/**
 * PATCH /api/inventory/warehouses/:id
 */
router.patch('/warehouses/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid warehouse ID' });

    const updated = updateWarehouse(id, req.body);
    res.json(updated);
  } catch (err) {
    if (err.message === 'Warehouse not found') {
      return res.status(404).json({ error: err.message });
    }
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A warehouse with this code already exists' });
    }
    console.error('Error updating warehouse:', err);
    res.status(400).json({ error: err.message || 'Failed to update warehouse' });
  }
});

/**
 * GET /api/inventory/stock
 * Overall inventory stock list with search and pagination
 */
router.get('/stock', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const lowStockOnly = req.query.lowStock === 'true';
    const status = req.query.status ? String(req.query.status).trim() : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 50;
    const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;

    const result = getStockSummary({ warehouseId, lowStockOnly, status, q, limit, offset });
    res.json(result);
  } catch (err) {
    console.error('Error fetching stock summary:', err);
    res.status(500).json({ error: 'Failed to fetch inventory stock' });
  }
});

/**
 * GET /api/inventory/stock/:productId
 * Product stock across all warehouses or specific warehouse
 */
router.get('/stock/:productId', (req, res) => {
  try {
    const productId = Number(req.params.productId);
    if (!productId) return res.status(400).json({ error: 'Invalid product ID' });

    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const stock = getProductStock(productId, warehouseId);
    res.json(stock);
  } catch (err) {
    if (err.message === 'Product not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error fetching product stock:', err);
    res.status(500).json({ error: 'Failed to fetch product stock' });
  }
});

/**
 * POST /api/inventory/stock-in
 */
router.post('/stock-in', (req, res) => {
  try {
    const { warehouseId, productId, quantity, referenceType, referenceId, reason } = req.body;
    if (!warehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, and quantity are required' });
    }

    const result = recordStockIn({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType,
      referenceId,
      reason,
      userId: req.user?.id || null,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error in stock-in:', err);
    res.status(400).json({ error: err.message || 'Failed to record stock in' });
  }
});

/**
 * POST /api/inventory/stock-out
 */
router.post('/stock-out', (req, res) => {
  try {
    const { warehouseId, productId, quantity, referenceType, referenceId, reason } = req.body;
    if (!warehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, and quantity are required' });
    }

    const result = recordStockOut({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType,
      referenceId,
      reason,
      userId: req.user?.id || null,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error in stock-out:', err);
    res.status(400).json({ error: err.message || 'Failed to record stock out' });
  }
});

/**
 * POST /api/inventory/adjust
 */
router.post('/adjust', (req, res) => {
  try {
    const { warehouseId, productId, newOnHandQuantity, reason, referenceType, referenceId } = req.body;
    if (!warehouseId || !productId || newOnHandQuantity === undefined) {
      return res.status(400).json({ error: 'warehouseId, productId, and newOnHandQuantity are required' });
    }

    const result = adjustStock({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      newOnHandQuantity: Number(newOnHandQuantity),
      reason,
      referenceType,
      referenceId,
      userId: req.user?.id || null,
    });

    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error adjusting stock:', err);
    res.status(400).json({ error: err.message || 'Failed to adjust stock' });
  }
});

/**
 * POST /api/inventory/reserve
 */
router.post('/reserve', (req, res) => {
  try {
    const { warehouseId, productId, quantity, referenceType, referenceId, notes } = req.body;
    if (!warehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, and quantity are required' });
    }

    const result = reserveStock({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType,
      referenceId,
      notes,
      userId: req.user?.id || null,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error reserving stock:', err);
    res.status(400).json({ error: err.message || 'Failed to reserve stock' });
  }
});

/**
 * POST /api/inventory/release-reservation/:id
 */
router.post('/release-reservation/:id', (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'Invalid reservation ID' });

    const result = releaseReservation({
      reservationId,
      userId: req.user?.id || null,
    });

    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error releasing reservation:', err);
    res.status(400).json({ error: err.message || 'Failed to release reservation' });
  }
});

/**
 * POST /api/inventory/fulfill-reservation/:id
 */
router.post('/fulfill-reservation/:id', (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'Invalid reservation ID' });

    const result = fulfillReservation({
      reservationId,
      userId: req.user?.id || null,
    });

    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error fulfilling reservation:', err);
    res.status(400).json({ error: err.message || 'Failed to fulfill reservation' });
  }
});

/**
 * POST /api/inventory/return
 */
router.post('/return', (req, res) => {
  try {
    const { warehouseId, productId, quantity, referenceType, referenceId, reason } = req.body;
    if (!warehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, and quantity are required' });
    }

    const result = recordReturn({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType,
      referenceId,
      reason,
      userId: req.user?.id || null,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Error recording return:', err);
    res.status(400).json({ error: err.message || 'Failed to record return' });
  }
});

/**
 * GET /api/inventory/movements
 * Audit trail
 */
router.get('/movements', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const productId = req.query.productId ? Number(req.query.productId) : null;
    const movementType = req.query.movementType ? String(req.query.movementType).trim() : null;
    const referenceType = req.query.referenceType ? String(req.query.referenceType).trim() : null;
    const referenceId = req.query.referenceId ? String(req.query.referenceId).trim() : null;
    const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 50;
    const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;

    const result = getMovements({
      warehouseId,
      productId,
      movementType,
      referenceType,
      referenceId,
      limit,
      offset,
    });

    res.json(result);
  } catch (err) {
    console.error('Error querying movements:', err);
    res.status(500).json({ error: 'Failed to query inventory movements' });
  }
});

/**
 * GET /api/inventory/reservations
 */
router.get('/reservations', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const productId = req.query.productId ? Number(req.query.productId) : null;
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 50;
    const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;

    const result = getReservations({
      warehouseId,
      productId,
      status,
      limit,
      offset,
    });

    res.json(result);
  } catch (err) {
    console.error('Error querying reservations:', err);
    res.status(500).json({ error: 'Failed to query stock reservations' });
  }
});

/**
 * GET /api/inventory/reservations/:id
 * Retrieve a single reservation by ID
 */
router.get('/reservations/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid reservation ID' });

    const reservation = getReservationById(id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    res.json(reservation);
  } catch (err) {
    console.error('Error fetching reservation:', err);
    res.status(500).json({ error: 'Failed to fetch reservation' });
  }
});

/**
 * GET /api/inventory/receipts
 * Paginated stock receipts history
 */
router.get('/receipts', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const sourceType = req.query.sourceType ? String(req.query.sourceType).trim().toUpperCase() : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 50;
    const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;

    const result = getStockReceipts({ warehouseId, status, sourceType, q, limit, offset });
    res.json(result);
  } catch (err) {
    console.error('Error fetching stock receipts:', err);
    res.status(500).json({ error: 'Failed to fetch stock receipts' });
  }
});

/**
 * GET /api/inventory/receipts/:id
 * Single stock receipt with line items and movement history
 */
router.get('/receipts/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid receipt ID' });

    const receipt = getStockReceiptById(id);
    if (!receipt) return res.status(404).json({ error: 'Stock receipt not found' });

    res.json(receipt);
  } catch (err) {
    console.error('Error fetching stock receipt:', err);
    res.status(500).json({ error: 'Failed to fetch stock receipt' });
  }
});

/**
 * POST /api/inventory/receipts
 * Create stock receipt (Manual or Confirmed)
 */
router.post('/receipts', (req, res) => {
  try {
    const { warehouseId, receiptNumber, sourceType, sourceReference, notes, items, confirmImmediately } = req.body;
    const userId = req.user?.id || null;

    const receipt = createStockReceipt({
      warehouseId,
      receiptNumber,
      sourceType: sourceType || 'MANUAL',
      sourceReference,
      notes,
      items,
      confirmImmediately: confirmImmediately !== false,
      userId,
    });

    res.status(201).json(receipt);
  } catch (err) {
    console.error('Error creating stock receipt:', err);
    res.status(400).json({ error: err.message || 'Failed to create stock receipt' });
  }
});

/**
 * POST /api/inventory/receipts/:id/confirm
 * Confirm a staged DRAFT stock receipt
 */
router.post('/receipts/:id/confirm', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid receipt ID' });

    const userId = req.user?.id || null;
    const receipt = confirmDraftReceipt(id, userId);
    res.json(receipt);
  } catch (err) {
    console.error('Error confirming stock receipt:', err);
    res.status(400).json({ error: err.message || 'Failed to confirm stock receipt' });
  }
});

/**
 * POST /api/inventory/receipts/:id/cancel
 * Cancel a staged DRAFT stock receipt
 */
router.post('/receipts/:id/cancel', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid receipt ID' });

    const userId = req.user?.id || null;
    const receipt = cancelDraftReceipt(id, userId);
    res.json(receipt);
  } catch (err) {
    console.error('Error cancelling stock receipt:', err);
    res.status(400).json({ error: err.message || 'Failed to cancel stock receipt' });
  }
});

/**
 * POST /api/inventory/receipts/analyze-excel
 * Inspect uploaded workbook to detect sheets, columns, and suggest mappings
 */
router.post('/receipts/analyze-excel', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'The file is too large (maximum allowed is 5MB)' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded' });

    try {
      const analysis = await analyzeExcelStockWorkbook(req.file.buffer);
      res.json(analysis);
    } catch (parseErr) {
      console.error('Excel analyze error:', parseErr);
      res.status(400).json({ error: parseErr.message || 'Could not parse Excel workbook' });
    }
  });
});

/**
 * POST /api/inventory/receipts/preview-excel
 * Parses workbook according to user column mapping and returns validation + stock projections
 */
router.post('/receipts/preview-excel', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'The file is too large (maximum allowed is 5MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded' });

    const warehouseId = Number(req.body.warehouseId);
    if (!warehouseId) return res.status(400).json({ error: 'Warehouse is required' });

    const partNoCol = req.body.partNoColumn ? String(req.body.partNoColumn).trim() : null;
    const qtyCol = req.body.quantityColumn ? String(req.body.quantityColumn).trim() : null;
    const notesCol = req.body.notesColumn ? String(req.body.notesColumn).trim() : null;
    const sheetName = req.body.sheetName ? String(req.body.sheetName).trim() : null;

    if (!partNoCol || !qtyCol) {
      return res.status(400).json({ error: 'Part Number and Quantity column mappings are required' });
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
      if (!worksheet) return res.status(400).json({ error: `Sheet '${sheetName}' not found in workbook` });

      let headerRowNumber = 0;
      let colIdxMap = {};
      for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
        const row = worksheet.getRow(r);
        const headers = [];
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const val = String(cell.value || '').trim();
          if (val) {
            headers.push(val);
            colIdxMap[val] = colNumber;
          }
        });
        if (headers.includes(partNoCol) && headers.includes(qtyCol)) {
          headerRowNumber = r;
          break;
        }
      }

      if (!headerRowNumber) {
        return res.status(400).json({
          error: `Could not find header row containing columns '${partNoCol}' and '${qtyCol}'`,
        });
      }

      const partNoIdx = colIdxMap[partNoCol];
      const qtyIdx = colIdxMap[qtyCol];
      const notesIdx = notesCol ? colIdxMap[notesCol] : null;
      let descIdx = req.body.descriptionColumn ? colIdxMap[req.body.descriptionColumn] : null;
      if (!descIdx) {
        const descKey = Object.keys(colIdxMap).find((k) =>
          /^(discription|description|material|product[_\s-]?name|name)/i.test(k)
        );
        if (descKey) descIdx = colIdxMap[descKey];
      }

      const extractedRows = [];
      for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const rawPartNo = partNoIdx ? row.getCell(partNoIdx).value : null;
        let rawQty = qtyIdx ? row.getCell(qtyIdx).value : null;
        if (rawQty && typeof rawQty === 'object' && 'result' in rawQty) rawQty = rawQty.result;
        let rawNotes = notesIdx ? row.getCell(notesIdx).value : null;
        let rawDesc = descIdx ? row.getCell(descIdx).value : null;

        // Skip completely blank rows
        if (rawPartNo == null && rawQty == null) continue;

        extractedRows.push({
          rowNumber: r,
          partNo: rawPartNo != null ? String(rawPartNo).trim() : '',
          quantity: rawQty != null ? rawQty : '',
          description: rawDesc != null ? String(rawDesc).trim() : '',
          notes: rawNotes != null ? String(rawNotes).trim() : '',
        });
      }

      const autoCreateProducts = req.body.autoCreateProducts === true || req.body.autoCreateProducts === 'true';
      const preview = previewExcelStockInward({ warehouseId, rows: extractedRows, autoCreateProducts });
      res.json(preview);
    } catch (parseErr) {
      console.error('Excel preview error:', parseErr);
      res.status(400).json({ error: parseErr.message || 'Could not parse workbook data' });
    }
  });
});

/**
 * POST /api/inventory/receipts/preview-rows
 * Preview rows passed directly as JSON
 */
router.post('/receipts/preview-rows', (req, res) => {
  try {
    const { warehouseId, rows } = req.body;
    const preview = previewExcelStockInward({ warehouseId, rows });
    res.json(preview);
  } catch (err) {
    console.error('Error previewing rows:', err);
    res.status(400).json({ error: err.message || 'Failed to preview rows' });
  }
});

/**
 * GET /api/inventory/intelligence
 * Comprehensive stock velocity, demand trends, coverage analysis, and replenishment recommendations
 */
router.get('/intelligence', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const period = req.query.period ? Number(req.query.period) : undefined;
    const start = req.query.start ? String(req.query.start).trim() : undefined;
    const end = req.query.end ? String(req.query.end).trim() : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = getStockIntelligence({
      warehouseId,
      productId,
      period,
      start,
      end,
      limit,
      offset,
    });
    res.json(result);
  } catch (err) {
    console.error('Error computing stock intelligence:', err);
    res.status(500).json({ error: err.message || 'Failed to compute stock intelligence' });
  }
});

/**
 * GET /api/inventory/operations/overview
 */
router.get('/operations/overview', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const overview = getOperationsOverview({ warehouseId });
    res.json(overview);
  } catch (err) {
    console.error('Error fetching operations overview:', err);
    res.status(500).json({ error: 'Failed to fetch inventory operations overview' });
  }
});

/**
 * GET /api/inventory/operations/alerts
 */
router.get('/operations/alerts', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const category = req.query.category ? String(req.query.category).trim() : null;
    const severity = req.query.severity ? String(req.query.severity).trim() : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const alerts = getOperationsStockAlerts({ warehouseId, category, severity, limit, offset });
    res.json(alerts);
  } catch (err) {
    console.error('Error fetching stock alerts:', err);
    res.status(500).json({ error: 'Failed to fetch stock alerts' });
  }
});

/**
 * GET /api/inventory/operations/critical
 */
router.get('/operations/critical', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const critical = getOperationsCriticalStock({ warehouseId, limit, offset });
    res.json(critical);
  } catch (err) {
    console.error('Error fetching critical stock:', err);
    res.status(500).json({ error: 'Failed to fetch critical stock' });
  }
});

/**
 * GET /api/inventory/operations/out-of-stock
 */
router.get('/operations/out-of-stock', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const oos = getOperationsOutOfStock({ warehouseId, limit, offset });
    res.json(oos);
  } catch (err) {
    console.error('Error fetching out of stock items:', err);
    res.status(500).json({ error: 'Failed to fetch out of stock items' });
  }
});

/**
 * GET /api/inventory/operations/restock-queue
 */
router.get('/operations/restock-queue', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const queue = getOperationsRestockQueue({ warehouseId, limit, offset });
    res.json(queue);
  } catch (err) {
    console.error('Error fetching restock queue:', err);
    res.status(500).json({ error: 'Failed to fetch restock queue' });
  }
});

/**
 * GET /api/inventory/operations/incoming
 */
router.get('/operations/incoming', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const incoming = getOperationsIncomingStock({ warehouseId, limit, offset });
    res.json(incoming);
  } catch (err) {
    console.error('Error fetching incoming stock:', err);
    res.status(500).json({ error: 'Failed to fetch incoming stock' });
  }
});

/**
 * GET /api/inventory/operations/pending-reservations
 */
router.get('/operations/pending-reservations', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const pending = getOperationsPendingReservations({ warehouseId, limit, offset });
    res.json(pending);
  } catch (err) {
    console.error('Error fetching pending reservations:', err);
    res.status(500).json({ error: 'Failed to fetch pending reservations' });
  }
});

/**
 * GET /api/inventory/operations/audit
 */
router.get('/operations/audit', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const productId = req.query.productId ? Number(req.query.productId) : null;
    const movementType = req.query.movementType ? String(req.query.movementType).trim() : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const audit = getOperationsInventoryAudit({ warehouseId, productId, movementType, limit, offset });
    res.json(audit);
  } catch (err) {
    console.error('Error fetching inventory audit:', err);
    res.status(500).json({ error: 'Failed to fetch inventory audit' });
  }
});

/**
 * POST /api/inventory/adjustments
 */
router.post('/adjustments', (req, res) => {
  try {
    const { warehouseId, productId, direction, quantity, reason, notes } = req.body;
    const userId = req.user?.id || null;

    if (!warehouseId || !productId || !direction || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, direction, and quantity are required' });
    }

    const result = createStockAdjustment({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      direction,
      quantity: Number(quantity),
      reason,
      notes,
      userId,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating stock adjustment:', err);
    res.status(400).json({ error: err.message || 'Failed to create stock adjustment' });
  }
});

/**
 * POST /api/inventory/returns
 */
router.post('/returns', (req, res) => {
  try {
    const { warehouseId, productId, quantity, referenceType, referenceId, reason, notes } = req.body;
    const userId = req.user?.id || null;

    if (!warehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'warehouseId, productId, and quantity are required' });
    }

    const result = createStockReturn({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType,
      referenceId,
      reason,
      notes,
      userId,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating stock return:', err);
    res.status(400).json({ error: err.message || 'Failed to create stock return' });
  }
});

/**
 * GET /api/inventory/transfers
 */
router.get('/transfers', (req, res) => {
  try {
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const status = req.query.status ? String(req.query.status).trim() : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const transfers = getStockTransfers({ warehouseId, status, limit, offset });
    res.json(transfers);
  } catch (err) {
    console.error('Error fetching stock transfers:', err);
    res.status(500).json({ error: 'Failed to fetch stock transfers' });
  }
});

/**
 * GET /api/inventory/transfers/:id
 */
router.get('/transfers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid transfer ID' });

    const transfer = getTransferById(id);
    if (!transfer) return res.status(404).json({ error: 'Stock transfer not found' });

    res.json(transfer);
  } catch (err) {
    console.error('Error fetching stock transfer:', err);
    res.status(500).json({ error: 'Failed to fetch stock transfer' });
  }
});

/**
 * POST /api/inventory/transfers
 */
router.post('/transfers', (req, res) => {
  try {
    const { sourceWarehouseId, destinationWarehouseId, productId, quantity, reference, notes } = req.body;
    const userId = req.user?.id || null;

    if (!sourceWarehouseId || !destinationWarehouseId || !productId || !quantity) {
      return res.status(400).json({ error: 'sourceWarehouseId, destinationWarehouseId, productId, and quantity are required' });
    }

    const transfer = createStockTransfer({
      sourceWarehouseId: Number(sourceWarehouseId),
      destinationWarehouseId: Number(destinationWarehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      reference,
      notes,
      userId,
    });

    res.status(201).json(transfer);
  } catch (err) {
    console.error('Error creating stock transfer:', err);
    res.status(400).json({ error: err.message || 'Failed to create stock transfer' });
  }
});

export default router;

