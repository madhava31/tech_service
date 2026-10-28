import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ensureInventorySchema, getUserTable, resolveUserId } from '../db/inventorySchema.js';
import * as inventory from '../inventory/service.js';
import { sendRouteError } from '../http/errors.js';

const router = Router();

// Databases created from schema.sql alone have no inventory tables; create them before any query.
router.use(async (req, res, next) => {
  try {
    await ensureInventorySchema();
    next();
  } catch (err) {
    console.error('Failed to prepare inventory tables:', err);
    res.status(500).json({ error: 'Inventory storage is unavailable. Please try again.' });
  }
});

// Service errors carry an HTTP status (400 validation, 404 missing record); anything else is a 500.
function sendError(res, err, fallbackMessage) {
  const status = err.status || 500;
  if (status >= 500) console.error(`${fallbackMessage}:`, err);
  res.status(status).json({ error: status >= 500 ? fallbackMessage : err.message });
}

function optionalId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pageParams(query, defaultLimit = 50) {
  const limit = Math.min(1000, Math.max(1, Number(query.limit) || defaultLimit));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed.'));
    }
  },
});

function getCellValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const val = cell.value;
  if (typeof val === 'object') {
    if (val.result !== undefined) return val.result;
    if (val.richText) return val.richText.map((t) => t.text).join('');
    if (val.text) return val.text;
    return String(val);
  }
  return val;
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}


let defaultWarehouseCached = null;

// Helper: Ensure default warehouse exists in Postgres
async function ensureDefaultWarehouse() {
  if (defaultWarehouseCached) return defaultWarehouseCached;
  const existing = await db.prepare(`SELECT * FROM warehouse WHERE is_default = 1 LIMIT 1`).get();
  if (existing) {
    defaultWarehouseCached = existing;
    return existing;
  }

  const anyWh = await db.prepare(`SELECT * FROM warehouse LIMIT 1`).get();
  if (anyWh) {
    defaultWarehouseCached = anyWh;
    return anyWh;
  }

  const inserted = await db.prepare(`
    INSERT INTO warehouse (name, code, address, city, state, is_active, is_default)
    VALUES ('Hyderabad Central Warehouse', 'HYD-01', 'Peerzadiguda', 'Hyderabad', 'Telangana', 1, 1)
    RETURNING *
  `).get();
  defaultWarehouseCached = inserted;
  return inserted;
}

// Helper: Generate next stock receipt number e.g. REC2627/1
export async function getNextReceiptNumber(prefix = 'REC') {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyTag = `${String(fyStartYear).slice(2)}${String(fyStartYear + 1).slice(2)}`;
  const likePattern = `${prefix}${fyTag}/%`;

  const row = await db
    .prepare(`SELECT receipt_number FROM stock_receipt WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(likePattern);

  let nextSeq = 1;
  if (row && row.receipt_number) {
    const parts = row.receipt_number.split('/');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${fyTag}/${nextSeq}`;
}

/**
 * GET /api/inventory/overview
 */

router.get('/overview', requireAuth, async (req, res) => {
  try {
    await ensureDefaultWarehouse();
    res.json(await inventory.getInventoryOverview());
  } catch (err) {
    sendError(res, err, 'Failed to fetch inventory overview');
  }
});

/**
 * GET /api/inventory/intelligence
 */
router.get('/intelligence', requireAuth, async (req, res) => {
  try {
    await ensureDefaultWarehouse();
    const { warehouseId, days = 30 } = req.query;

    const whId = warehouseId ? Number(warehouseId) : null;
    const [warehouses, products] = await Promise.all([
      db.prepare(`SELECT * FROM warehouse WHERE is_active = 1 ORDER BY is_default DESC, id ASC`).all(),
      db.prepare(`
        SELECT 
          p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price,
          COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
          COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
          COALESCE(SUM(s.incoming_quantity), 0) AS incoming_quantity
        FROM product p
        LEFT JOIN inventory_stock s ON s.product_id = p.id ${whId ? 'AND s.warehouse_id = ' + whId : ''}
        GROUP BY p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price
        ORDER BY p.part_no ASC
      `).all(),
    ]);

    const totalProducts = products.length;
    let withStock = 0;
    let lowStock = 0;
    let criticalStock = 0;
    let outOfStock = 0;
    let totalOnHand = 0;
    let totalReserved = 0;
    let totalIncoming = 0;

    const intelProducts = products.map((p) => {
      const onHand = Number(p.on_hand_quantity || 0);
      const reserved = Number(p.reserved_quantity || 0);
      const incoming = Number(p.incoming_quantity || 0);
      const available = Math.max(0, onHand - reserved);

      totalOnHand += onHand;
      totalReserved += reserved;
      totalIncoming += incoming;

      let status = 'HEALTHY';
      if (onHand <= 0) {
        status = 'OUT_OF_STOCK';
        outOfStock++;
      } else if (available <= 5) {
        status = 'CRITICAL';
        criticalStock++;
        withStock++;
      } else if (available <= 10) {
        status = 'LOW_STOCK';
        lowStock++;
        withStock++;
      } else {
        withStock++;
      }

      const recommendation = status === 'OUT_OF_STOCK' || status === 'CRITICAL' ? 'RESTOCK_NOW' : status === 'LOW_STOCK' ? 'RESTOCK_SOON' : 'SUFFICIENT';

      return {
        id: p.id,
        productId: p.id,
        part_no: p.part_no,
        partNo: p.part_no,
        description: p.description,
        unit: p.unit || 'Nos',
        hsn_sac: p.hsn_sac || '',
        hsnSac: p.hsn_sac || '',
        default_price: Number(p.default_price || 0),
        defaultPrice: Number(p.default_price || 0),
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: available,
        incomingQuantity: incoming,
        status,
        recommendation,
        trend: 'STABLE',
        demandTrend: 'STABLE',
        dailySalesRate: 0,
        coverageDays: available > 0 ? 30 : 0,
      };
    });

    const totalAvailable = Math.max(0, totalOnHand - totalReserved);
    const needsRestock = outOfStock + criticalStock + lowStock;

    res.json({
      summary: {
        totalProducts,
        productsAnalyzed: totalProducts,
        productsSelling: 0,
        withStock,
        lowStock,
        criticalStock,
        outOfStock,
        needsRestock,
        productsRequiringRestock: needsRestock,
        averageStockCoverage: 30,
        incomingUnits: totalIncoming,
        totalOnHand,
        totalReserved,
        totalAvailable,
        totalIncoming,
      },
      health: {
        healthy: Math.max(0, totalProducts - needsRestock),
        low: lowStock,
        critical: criticalStock,
        outOfStock,
        incoming: totalIncoming,
      },
      demand: [],
      velocity: [],
      coverage: [],
      recommendations: intelProducts
        .filter((p) => p.status !== 'HEALTHY')
        .map((p) => ({
          productId: p.id,
          partNo: p.partNo,
          description: p.description,
          currentStock: p.onHandQuantity,
          availableStock: p.availableQuantity,
          recommendedOrderQuantity: Math.max(20, 50 - p.availableQuantity),
          reason: p.status === 'OUT_OF_STOCK' ? 'Out of stock - Immediate replenishment needed' : 'Stock level below safety threshold',
          urgency: p.status === 'OUT_OF_STOCK' || p.status === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        })),
      incomingImpact: [],
      overstock: [],
      products: intelProducts,
      recentSales: [],
      warehouses: warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        address: w.address || '',
        city: w.city || '',
        state: w.state || '',
        is_default: Number(w.is_default || 0),
        is_active: Number(w.is_active || 0),
      })),
      meta: {
        periodDays: Number(days),
        warehouseId: whId,
      },
    });
  } catch (err) {
    console.error('Failed to get inventory intelligence:', err);
    sendRouteError(res, err, 500, 'Failed to fetch inventory intelligence');
  }
});

/**
 * GET /api/inventory/warehouses
 */
router.get('/warehouses', requireAuth, async (req, res) => {
  try {
    await ensureDefaultWarehouse();
    const activeOnly = req.query.active === 'true';
    const whereSql = activeOnly ? 'WHERE is_active = 1' : '';
    const warehouses = await db.prepare(`SELECT * FROM warehouse ${whereSql} ORDER BY is_default DESC, id ASC`).all();
    res.json(
      warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        address: w.address || '',
        city: w.city || '',
        state: w.state || '',
        is_default: Number(w.is_default || 0),
        is_active: Number(w.is_active || 0),
      }))
    );
  } catch (err) {
    console.error('Failed to get warehouses:', err);
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
});

/**
 * GET /api/inventory/warehouses/:id
 */

router.get('/warehouses/:id', requireAuth, async (req, res) => {
  try {
    const whId = optionalId(req.params.id);
    if (!whId) return res.status(400).json({ error: 'Invalid warehouse ID' });

    const warehouse = await inventory.getWarehouseById(whId);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (err) {
    sendError(res, err, 'Failed to fetch warehouse details');
  }
});

/**
 * Helper to delete a single warehouse and clean up its references
 */
async function deleteSingleWarehouse(whId) {
  const wh = await db.prepare('SELECT * FROM warehouse WHERE id = ?').get(whId);
  if (!wh) throw new Error('Warehouse not found');
  if (Number(wh.is_default) === 1) {
    throw new Error(`Cannot delete default warehouse "${wh.name}". Designate another warehouse as default first.`);
  }

  // 1. inventory_movement
  await db.prepare('DELETE FROM inventory_movement WHERE warehouse_id = ?').run(whId);
  // 2. inventory_stock
  await db.prepare('DELETE FROM inventory_stock WHERE warehouse_id = ?').run(whId);
  // 3. stock_reservation
  await db.prepare('DELETE FROM stock_reservation WHERE warehouse_id = ?').run(whId);
  // 4. stock_receipt_item & stock_receipt
  const receipts = await db.prepare('SELECT id FROM stock_receipt WHERE warehouse_id = ?').all(whId);
  if (receipts && receipts.length > 0) {
    const receiptIds = receipts.map((r) => r.id);
    await db.prepare('DELETE FROM stock_receipt_item WHERE receipt_id = ANY(?)').run(receiptIds);
    await db.prepare('DELETE FROM stock_receipt WHERE warehouse_id = ?').run(whId);
  }
  // 5. sale_report_item & sale_report
  const sales = await db.prepare('SELECT id FROM sale_report WHERE warehouse_id = ?').all(whId);
  if (sales && sales.length > 0) {
    const saleIds = sales.map((s) => s.id);
    await db.prepare('DELETE FROM sale_report_item WHERE sale_report_id = ANY(?)').run(saleIds);
    await db.prepare('DELETE FROM sale_report WHERE warehouse_id = ?').run(whId);
  }
  // 6. stock_transfer
  await db.prepare('DELETE FROM stock_transfer WHERE source_warehouse_id = ? OR destination_warehouse_id = ?').run(whId, whId);
  // 7. procurement_requirement
  await db.prepare('DELETE FROM procurement_requirement WHERE warehouse_id = ?').run(whId);
  // 8. Delete warehouse record itself
  await db.prepare('DELETE FROM warehouse WHERE id = ?').run(whId);

  return { id: whId, name: wh.name, code: wh.code };
}

/**
 * POST /api/inventory/warehouses
 */
router.post('/warehouses', requireAuth, async (req, res) => {
  try {
    const { name, code, address, city, state, isDefault, isActive } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();

    const existing = await db.prepare('SELECT id FROM warehouse WHERE code = ?').get(cleanCode);
    if (existing) {
      return res.status(409).json({ error: 'A warehouse with this code already exists' });
    }

    const isDef = isDefault ? 1 : 0;
    if (isDef === 1) {
      await db.prepare('UPDATE warehouse SET is_default = 0').run();
    }

    const result = await db.prepare(`
      INSERT INTO warehouse (name, code, address, city, state, is_default, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      cleanName,
      cleanCode,
      address ? address.trim() : null,
      city ? city.trim() : null,
      state ? state.trim() : null,
      isDef,
      isActive !== undefined ? (isActive ? 1 : 0) : 1
    );

    res.status(201).json(result);
  } catch (err) {
    console.error('Failed to create warehouse:', err);
    sendRouteError(res, err, 400, 'Failed to create warehouse');
  }
});

/**
 * PATCH /api/inventory/warehouses/:id
 */
router.patch('/warehouses/:id', requireAuth, async (req, res) => {
  try {
    const whId = Number(req.params.id);
    if (!whId) return res.status(400).json({ error: 'Invalid warehouse ID' });

    const wh = await db.prepare('SELECT * FROM warehouse WHERE id = ?').get(whId);
    if (!wh) return res.status(404).json({ error: 'Warehouse not found' });

    const { name, code, address, city, state, isDefault, isActive } = req.body;
    const cleanCode = code !== undefined ? code.trim().toUpperCase() : wh.code;
    const cleanName = name !== undefined ? name.trim() : wh.name;

    if (code !== undefined && cleanCode !== wh.code) {
      const codeConflict = await db.prepare('SELECT id FROM warehouse WHERE code = ? AND id != ?').get(cleanCode, whId);
      if (codeConflict) return res.status(409).json({ error: 'A warehouse with this code already exists' });
    }

    let isDef = wh.is_default;
    if (isDefault !== undefined) {
      isDef = isDefault ? 1 : 0;
      if (isDef === 1) {
        await db.prepare('UPDATE warehouse SET is_default = 0 WHERE id != ?').run(whId);
      }
    }

    const updated = await db.prepare(`
      UPDATE warehouse
      SET name = ?, code = ?, address = ?, city = ?, state = ?, is_default = ?, is_active = ?
      WHERE id = ?
      RETURNING *
    `).get(
      cleanName,
      cleanCode,
      address !== undefined ? (address ? address.trim() : null) : wh.address,
      city !== undefined ? (city ? city.trim() : null) : wh.city,
      state !== undefined ? (state ? state.trim() : null) : wh.state,
      isDef,
      isActive !== undefined ? (isActive ? 1 : 0) : wh.is_active,
      whId
    );

    res.json(updated);
  } catch (err) {
    console.error('Failed to update warehouse:', err);
    sendRouteError(res, err, 400, 'Failed to update warehouse');
  }
});

/**
 * POST /api/inventory/warehouses/bulk-delete
 */
router.post('/warehouses/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array of IDs' });
    }

    const numericIds = ids.map(Number).filter((id) => Boolean(id) && !Number.isNaN(id));
    if (numericIds.length === 0) {
      return res.status(400).json({ error: 'No valid numeric IDs provided' });
    }

    // Filter out default warehouse and non-existent warehouses
    const existing = await db.prepare('SELECT id, name, code, is_default FROM warehouse WHERE id = ANY(?)').all(numericIds);
    const toDelete = (existing || []).filter((w) => Number(w.is_default) !== 1);
    const idsToDelete = toDelete.map((w) => w.id);

    if (idsToDelete.length === 0) {
      return res.status(400).json({ error: 'Cannot delete default warehouse. No eligible warehouses selected.' });
    }

    await db.transaction(async () => {
      // 1. inventory_movement
      await db.prepare('DELETE FROM inventory_movement WHERE warehouse_id = ANY(?)').run(idsToDelete);
      // 2. inventory_stock
      await db.prepare('DELETE FROM inventory_stock WHERE warehouse_id = ANY(?)').run(idsToDelete);
      // 3. stock_reservation
      await db.prepare('DELETE FROM stock_reservation WHERE warehouse_id = ANY(?)').run(idsToDelete);
      // 4. stock_receipt_item & stock_receipt
      const receipts = await db.prepare('SELECT id FROM stock_receipt WHERE warehouse_id = ANY(?)').all(idsToDelete);
      if (receipts && receipts.length > 0) {
        const receiptIds = receipts.map((r) => r.id);
        await db.prepare('DELETE FROM stock_receipt_item WHERE receipt_id = ANY(?)').run(receiptIds);
        await db.prepare('DELETE FROM stock_receipt WHERE warehouse_id = ANY(?)').run(idsToDelete);
      }
      // 5. sale_report_item & sale_report
      const sales = await db.prepare('SELECT id FROM sale_report WHERE warehouse_id = ANY(?)').all(idsToDelete);
      if (sales && sales.length > 0) {
        const saleIds = sales.map((s) => s.id);
        await db.prepare('DELETE FROM sale_report_item WHERE sale_report_id = ANY(?)').run(saleIds);
        await db.prepare('DELETE FROM sale_report WHERE warehouse_id = ANY(?)').run(idsToDelete);
      }
      // 6. stock_transfer
      await db.prepare('DELETE FROM stock_transfer WHERE source_warehouse_id = ANY(?) OR destination_warehouse_id = ANY(?)').run(idsToDelete, idsToDelete);
      // 7. procurement_requirement
      await db.prepare('DELETE FROM procurement_requirement WHERE warehouse_id = ANY(?)').run(idsToDelete);
      // 8. Delete all warehouses in ONE shot!
      await db.prepare('DELETE FROM warehouse WHERE id = ANY(?)').run(idsToDelete);
    });

    res.json({ success: true, deletedCount: idsToDelete.length, deleted: toDelete });
  } catch (err) {
    console.error('Failed to bulk delete warehouses:', err);
    sendRouteError(res, err, 500, 'Failed to bulk delete warehouses');
  }
});

/**
 * DELETE /api/inventory/warehouses/:id
 */
router.delete('/warehouses/:id', requireAuth, async (req, res) => {
  try {
    const whId = Number(req.params.id);
    if (!whId) return res.status(400).json({ error: 'Invalid warehouse ID' });

    let deleted;
    await db.transaction(async () => {
      deleted = await deleteSingleWarehouse(whId);
    });

    res.json({ success: true, ...deleted });
  } catch (err) {
    const status = err.message && err.message.includes('not found') ? 404 : 400;
    sendRouteError(res, err, status, 'Failed to delete warehouse');
  }
});

/**
 * GET /api/inventory/stock
 * Authority Inventory Stock Ledger summary (returns `{ items: [...], total, limit, offset }`)
 */

router.get('/stock', requireAuth, async (req, res) => {
  try {
    await ensureDefaultWarehouse();
    const { limit, offset } = pageParams(req.query, 25);
    res.json(
      await inventory.getStockSummary({
        warehouseId: optionalId(req.query.warehouseId),
        lowStockOnly: req.query.lowStock === 'true',
        status: req.query.status ? String(req.query.status).trim() : null,
        q: req.query.q ? String(req.query.q).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to load stock data');
  }
});

/**
 * Helper to delete product(s) and their inventory balances
 */
async function deleteProductsAndStock(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return 0;
  const numIds = productIds.map(Number).filter((id) => Boolean(id) && !Number.isNaN(id));
  if (numIds.length === 0) return 0;

  await db.transaction(async () => {
    await db.prepare('DELETE FROM inventory_movement WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM stock_reservation WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM stock_receipt_item WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM stock_transfer WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM procurement_requirement WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM inventory_stock WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('UPDATE quotation_item SET product_id = NULL WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM sale_report_item WHERE product_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM product WHERE id = ANY(?)').run(numIds);
  });

  return numIds.length;
}

/**
 * GET /api/inventory/stock/template
 * Download Excel template for stock import
 */
router.get('/stock/template', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TECHNICON SERVICES ERP';
    const worksheet = workbook.addWorksheet('Stock Import Template');

    worksheet.columns = [
      { header: 'Part No', key: 'part_no', width: 18 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Physical On Hand', key: 'on_hand', width: 18 },
      { header: 'Warehouse Code', key: 'warehouse', width: 18 },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'HSN / SAC', key: 'hsn_sac', width: 14 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141B34' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF2FBF71' } },
      };
    });

    worksheet.addRow({
      part_no: '00097993',
      description: 'Silanized Glass Wool, 50 Grams',
      on_hand: 100,
      warehouse: 'HYD-01',
      unit: 'Nos',
      hsn_sac: '38220090',
    });
    worksheet.addRow({
      part_no: '00230178',
      description: '5 #L70 mm Removable Syringe',
      on_hand: 25,
      warehouse: 'HYD-01',
      unit: 'Nos',
      hsn_sac: '90279090',
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TECHNICON_Stock_Import_Template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to generate stock template:', err);
    res.status(500).json({ error: 'Failed to generate stock template' });
  }
});

/**
 * POST /api/inventory/stock/import-excel
 * Fully functional import of stock ledger from Excel (.xlsx) only
 */
router.post('/stock/import-excel', requireAuth, uploadExcel.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded (.xlsx format required)' });
  }

  try {
    const defaultWh = await ensureDefaultWarehouse();
    const allWarehouses = await db.prepare('SELECT id, name, code FROM warehouse').all();
    const whByCode = new Map(allWarehouses.map((w) => [String(w.code).toUpperCase(), w.id]));
    const whByName = new Map(allWarehouses.map((w) => [String(w.name).toLowerCase(), w.id]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      return res.status(400).json({ error: 'The uploaded Excel sheet contains no data rows.' });
    }

    let headerRowIdx = -1;
    let colMap = {};
    for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      let foundPart = false;
      const tempMap = {};
      row.eachCell((cell, colNumber) => {
        const text = normalizeHeader(getCellValue(cell));
        if (text.includes('part') || text === 'itemcode' || text === 'sku' || text === 'itemno') {
          foundPart = true;
          tempMap.part_no = colNumber;
        } else if (text.includes('desc') || text === 'product' || text === 'itemname') {
          tempMap.description = colNumber;
        } else if (
          text.includes('onhand') ||
          text === 'quantity' ||
          text === 'qty' ||
          text === 'stock' ||
          text === 'physicalonhand'
        ) {
          tempMap.quantity = colNumber;
        } else if (text.includes('reserved')) {
          tempMap.reserved = colNumber;
        } else if (text.includes('incoming')) {
          tempMap.incoming = colNumber;
        } else if (text === 'unit' || text === 'uom') {
          tempMap.unit = colNumber;
        } else if (text.includes('hsn') || text.includes('sac')) {
          tempMap.hsn_sac = colNumber;
        } else if (text.includes('warehouse') || text === 'wh' || text === 'facility') {
          tempMap.warehouse = colNumber;
        }
      });
      if (foundPart) {
        headerRowIdx = r;
        colMap = tempMap;
        break;
      }
    }

    if (headerRowIdx === -1 || !colMap.part_no) {
      return res.status(400).json({
        error: 'Could not find a "Part No" column in the Excel file. Please ensure your header row has a "Part No" column.',
      });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];
    let totalProcessed = 0;
    const importedBy = await resolveUserId(req.user);

    await db.transaction(async () => {
      for (let r = headerRowIdx + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const rawPartNo = getCellValue(row.getCell(colMap.part_no));
        if (!rawPartNo || !String(rawPartNo).trim()) continue;

        totalProcessed++;
        const partNo = String(rawPartNo).trim();
        const description = colMap.description ? String(getCellValue(row.getCell(colMap.description)) || '').trim() : '';
        const rawQty = colMap.quantity ? getCellValue(row.getCell(colMap.quantity)) : 0;
        const qty = Number(rawQty) || 0;
        const rawReserved = colMap.reserved ? getCellValue(row.getCell(colMap.reserved)) : 0;
        const reservedQty = Number(rawReserved) || 0;
        const rawIncoming = colMap.incoming ? getCellValue(row.getCell(colMap.incoming)) : 0;
        const incomingQty = Number(rawIncoming) || 0;
        const unit = colMap.unit ? String(getCellValue(row.getCell(colMap.unit)) || 'Nos').trim() : 'Nos';
        const hsnSac = colMap.hsn_sac ? String(getCellValue(row.getCell(colMap.hsn_sac)) || '').trim() : '';

        // inventory_stock CHECKs (non-negative, on_hand >= reserved) would abort the whole
        // transaction on one bad row, so report and skip it instead.
        if (qty < 0 || reservedQty < 0 || incomingQty < 0) {
          errors.push(`Row ${r} (${partNo}): quantities cannot be negative`);
          continue;
        }
        if (reservedQty > qty) {
          errors.push(`Row ${r} (${partNo}): reserved (${reservedQty}) cannot exceed on-hand (${qty})`);
          continue;
        }

        let targetWhId = defaultWh.id;
        if (colMap.warehouse) {
          const whVal = String(getCellValue(row.getCell(colMap.warehouse)) || '').trim();
          if (whVal) {
            const byCode = whByCode.get(whVal.toUpperCase());
            const byName = whByName.get(whVal.toLowerCase());
            if (byCode) targetWhId = byCode;
            else if (byName) targetWhId = byName;
          }
        }

        // Upsert product
        let product = await db.prepare('SELECT id, description, unit, hsn_sac FROM product WHERE part_no = ?').get(partNo);
        if (!product) {
          product = await db.prepare(`
            INSERT INTO product (part_no, description, unit, hsn_sac)
            VALUES (?, ?, ?, ?)
            RETURNING id, description, unit, hsn_sac
          `).get(partNo, description || partNo, unit || 'Nos', hsnSac || null);
          createdCount++;
        } else {
          if (description || unit || hsnSac) {
            await db.prepare(`
              UPDATE product
              SET description = COALESCE(NULLIF(?, ''), description),
                  unit = COALESCE(NULLIF(?, ''), unit),
                  hsn_sac = COALESCE(NULLIF(?, ''), hsn_sac)
              WHERE id = ?
            `).run(description, unit, hsnSac, product.id);
          }
          updatedCount++;
        }

        // Upsert inventory_stock
        const existingStock = await db.prepare(`
          SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?
        `).get(targetWhId, product.id);

        if (existingStock) {
          await db.prepare(`
            UPDATE inventory_stock
            SET on_hand_quantity = ?,
                reserved_quantity = ?,
                incoming_quantity = ?,
                updated_at = NOW()
            WHERE warehouse_id = ? AND product_id = ?
          `).run(qty, reservedQty, incomingQty, targetWhId, product.id);
        } else {
          await db.prepare(`
            INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, reserved_quantity, incoming_quantity, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          `).run(targetWhId, product.id, qty, reservedQty, incomingQty);
        }

        const beforeOnHand = existingStock ? Number(existingStock.on_hand_quantity || 0) : 0;
        const beforeReserved = existingStock ? Number(existingStock.reserved_quantity || 0) : 0;
        const diffQty = qty - beforeOnHand;

        // Record stock movement audit entry (quantity is the size of the change; before/after give direction)
        if (diffQty !== 0 || reservedQty !== beforeReserved) {
          await db.prepare(`
            INSERT INTO inventory_movement (warehouse_id, product_id, movement_type, quantity, before_on_hand, after_on_hand, before_reserved, after_reserved, reference_type, reason, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EXCEL_IMPORT', ?, ?, NOW())
          `).run(
            targetWhId,
            product.id,
            existingStock ? 'ADJUSTMENT' : 'OPENING_STOCK',
            Math.abs(diffQty),
            beforeOnHand,
            qty,
            beforeReserved,
            reservedQty,
            `Imported from Excel: ${req.file.originalname}`,
            importedBy
          );
        }
      }
    });


    res.json({
      success: true,
      totalRows: totalProcessed,
      created: createdCount,
      updated: updatedCount,
      errors,
    });
  } catch (err) {
    console.error('Failed to import stock from Excel:', err);
    sendRouteError(res, err, 500, 'Failed to import Excel file');
  }
});

/**
 * POST /api/inventory/stock/bulk-delete
 */
router.post('/stock/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds must be a non-empty array' });
    }

    const count = await deleteProductsAndStock(productIds);
    res.json({ success: true, deletedCount: count });
  } catch (err) {
    console.error('Failed to bulk delete stock items:', err);
    sendRouteError(res, err, 500, 'Failed to bulk delete stock items');
  }
});

/**
 * DELETE /api/inventory/stock/:productId
 */
router.delete('/stock/:productId', requireAuth, async (req, res) => {
  try {
    const prodId = Number(req.params.productId);
    if (!prodId) return res.status(400).json({ error: 'Invalid product ID' });

    const existing = await db.prepare('SELECT id, part_no FROM product WHERE id = ?').get(prodId);
    if (!existing) return res.status(404).json({ error: 'Stock item / Product not found' });

    await deleteProductsAndStock([prodId]);
    res.json({ success: true, id: prodId, partNo: existing.part_no });
  } catch (err) {
    console.error('Failed to delete stock product:', err);
    sendRouteError(res, err, 500, 'Failed to delete stock item');
  }
});

/**
 * GET /api/inventory/stock/:productId
 * Product Stock Detail Breakdown across warehouses
 */
router.get('/stock/:productId', requireAuth, async (req, res) => {

  try {
    const prodId = Number(req.params.productId);
    const prod = await db.prepare(`SELECT * FROM product WHERE id = ?`).get(prodId);
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    const warehouses = await db.prepare(`SELECT * FROM warehouse WHERE is_active = 1`).all();
    const stocks = await db.prepare(`SELECT * FROM inventory_stock WHERE product_id = ?`).all(prodId);
    const stockByWh = new Map(stocks.map((s) => [s.warehouse_id, s]));

    const warehouseBreakdown = warehouses.map((w) => {
      const st = stockByWh.get(w.id);
      const onHand = Number(st?.on_hand_quantity || 0);
      const reserved = Number(st?.reserved_quantity || 0);
      const available = Math.max(0, onHand - reserved);
      const incoming = Number(st?.incoming_quantity || 0);

      return {
        warehouseId: w.id,
        warehouseName: w.name,
        warehouseCode: w.code,
        isDefault: Number(w.is_default || 0),
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: available,
        incomingQuantity: incoming,
      };
    });

    const totalOnHand = warehouseBreakdown.reduce((sum, w) => sum + w.onHandQuantity, 0);
    const totalReserved = warehouseBreakdown.reduce((sum, w) => sum + w.reservedQuantity, 0);
    const totalIncoming = warehouseBreakdown.reduce((sum, w) => sum + w.incomingQuantity, 0);
    const totalAvailable = Math.max(0, totalOnHand - totalReserved);

    res.json({
      product: {
        id: prod.id,
        part_no: prod.part_no,
        description: prod.description,
        hsn_sac: prod.hsn_sac || '',
        unit: prod.unit || 'Nos',
        default_price: Number(prod.default_price || 0),
        partNo: prod.part_no,
        hsnSac: prod.hsn_sac || '',
        defaultPrice: Number(prod.default_price || 0),
      },
      totals: {
        onHandQuantity: totalOnHand,
        reservedQuantity: totalReserved,
        incomingQuantity: totalIncoming,
        availableQuantity: totalAvailable,
      },
      summary: {
        totalOnHand,
        totalReserved,
        totalAvailable,
        totalIncoming,
      },
      warehouses: warehouseBreakdown.map((w) => ({
        warehouseId: w.warehouseId,
        warehouseName: w.warehouseName,
        warehouseCode: w.warehouseCode,
        warehouseIsDefault: Boolean(w.isDefault),
        onHandQuantity: w.onHandQuantity,
        reservedQuantity: w.reservedQuantity,
        availableQuantity: w.availableQuantity,
        incomingQuantity: w.incomingQuantity,
        lowStockThreshold: 10,
        criticalStockThreshold: 5,
        updatedAt: new Date().toISOString(),
      })),
    });
  } catch (err) {
    console.error('Failed to get product stock detail:', err);
    sendRouteError(res, err, 500, 'Failed to fetch product stock');
  }
});

/**
 * GET /api/inventory/receipts
 * List Stock Receipts (Stock Inward)
 */
// Helper: Retrieve complete Stock Receipt Detail object formatted with dual camelCase and snake_case properties
async function fetchStockReceiptDetail(recId) {
  const userTable = await getUserTable();
  const r = await db
    .prepare(`
      SELECT r.*, w.name AS warehouse_name, w.code AS warehouse_code,
             u.username AS created_by_username
      FROM stock_receipt r
      LEFT JOIN warehouse w ON w.id = r.warehouse_id
      LEFT JOIN ${userTable} u ON u.id = r.created_by
      WHERE r.id = ?
    `)
    .get(recId);

  if (!r) return null;

  const items = await db
    .prepare(`
      SELECT sri.*, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price
      FROM stock_receipt_item sri
      LEFT JOIN product p ON p.id = sri.product_id
      WHERE sri.receipt_id = ?
      ORDER BY sri.id ASC
    `)
    .all(recId);

  const movements = await db
    .prepare(`
      SELECT m.*, p.part_no, u.username AS created_by_username
      FROM inventory_movement m
      LEFT JOIN product p ON p.id = m.product_id
      LEFT JOIN ${userTable} u ON u.id = m.created_by
      WHERE m.reference_type = 'STOCK_RECEIPT' AND m.reference_id = ?
      ORDER BY m.id ASC
    `)
    .all(String(recId));

  const totalQty = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const productCount = items.length;

  const formattedItems = items.map((it) => ({
    id: it.id,
    receipt_id: it.receipt_id,
    receiptId: it.receipt_id,
    product_id: it.product_id,
    productId: it.product_id,
    part_no: it.part_no || '',
    partNo: it.part_no || '',
    product_description: it.description || '',
    description: it.description || '',
    unit: it.unit || 'Nos',
    hsn_sac: it.hsn_sac || '',
    hsnSac: it.hsn_sac || '',
    default_price: Number(it.default_price || 0),
    defaultPrice: Number(it.default_price || 0),
    quantity: Number(it.quantity || 0),
    before_on_hand: Number(it.before_on_hand || 0),
    beforeOnHand: Number(it.before_on_hand || 0),
    after_on_hand: Number(it.after_on_hand || 0),
    afterOnHand: Number(it.after_on_hand || 0),
    notes: it.notes || '',
    created_at: it.created_at,
    createdAt: it.created_at,
  }));

  const formattedMovements = movements.map((m) => ({
    id: m.id,
    warehouse_id: m.warehouse_id,
    warehouseId: m.warehouse_id,
    product_id: m.product_id,
    productId: m.product_id,
    part_no: m.part_no || '',
    partNo: m.part_no || '',
    movement_type: m.movement_type,
    movementType: m.movement_type,
    quantity: Number(m.quantity || 0),
    before_on_hand: Number(m.before_on_hand || 0),
    beforeOnHand: Number(m.before_on_hand || 0),
    after_on_hand: Number(m.after_on_hand || 0),
    afterOnHand: Number(m.after_on_hand || 0),
    reference_type: m.reference_type || '',
    referenceType: m.reference_type || '',
    reference_id: m.reference_id || '',
    referenceId: m.reference_id || '',
    reason: m.reason || '',
    created_at: m.created_at,
    createdAt: m.created_at,
    created_by_username: m.created_by_username || 'System',
    createdByUsername: m.created_by_username || 'System',
  }));

  return {
    id: r.id,
    receipt_number: r.receipt_number,
    receiptNumber: r.receipt_number,
    warehouse_id: r.warehouse_id,
    warehouseId: r.warehouse_id,
    warehouse_name: r.warehouse_name || '',
    warehouseName: r.warehouse_name || '',
    warehouse_code: r.warehouse_code || '',
    warehouseCode: r.warehouse_code || '',
    source_type: r.source_type,
    sourceType: r.source_type,
    source_reference: r.source_reference || '',
    sourceReference: r.source_reference || '',
    status: r.status,
    notes: r.notes || '',
    created_by: r.created_by,
    createdBy: r.created_by,
    created_by_username: r.created_by_username || null,
    createdByUsername: r.created_by_username || null,
    created_at: r.created_at,
    createdAt: r.created_at,
    confirmed_at: r.confirmed_at,
    confirmedAt: r.confirmed_at,
    product_count: productCount,
    productCount: productCount,
    total_quantity: totalQty,
    totalQuantity: totalQty,
    items: formattedItems,
    movements: formattedMovements,
  };
}

/**
 * GET /api/inventory/receipts
 * List Stock Receipts (Stock Inward)
 */
router.get('/receipts', requireAuth, async (req, res) => {
  try {
    await ensureDefaultWarehouse();
    const { warehouseId, status, sourceType, q, limit = 20, offset = 0 } = req.query;

    const conditions = [];
    const params = [];

    if (warehouseId) {
      conditions.push(`r.warehouse_id = ?`);
      params.push(Number(warehouseId));
    }
    if (status) {
      conditions.push(`r.status = ?`);
      params.push(String(status));
    }
    if (sourceType) {
      conditions.push(`r.source_type = ?`);
      params.push(String(sourceType));
    }
    if (q) {
      const term = `%${q}%`;
      conditions.push(`(r.receipt_number LIKE ? OR r.source_reference LIKE ? OR r.notes LIKE ?)`);
      params.push(term, term, term);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM stock_receipt r ${whereSql}`).get(...params);
    const total = Number(countRow?.total || 0);

    const queryParams = [...params, Number(limit), Number(offset)];
    const receipts = await db
      .prepare(`
        SELECT 
          r.*,
          w.name AS warehouse_name,
          w.code AS warehouse_code,
          (SELECT COUNT(*) FROM stock_receipt_item WHERE receipt_id = r.id) AS total_items,
          (SELECT COALESCE(SUM(quantity), 0) FROM stock_receipt_item WHERE receipt_id = r.id) AS total_quantity
        FROM stock_receipt r
        LEFT JOIN warehouse w ON w.id = r.warehouse_id
        ${whereSql}
        ORDER BY r.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...queryParams);

    res.json({
      receipts: receipts.map((r) => ({
        id: r.id,
        receipt_number: r.receipt_number,
        receiptNumber: r.receipt_number,
        warehouse_id: r.warehouse_id,
        warehouseId: r.warehouse_id,
        warehouse_name: r.warehouse_name || '',
        warehouseName: r.warehouse_name || '',
        warehouse_code: r.warehouse_code || '',
        warehouseCode: r.warehouse_code || '',
        source_type: r.source_type,
        sourceType: r.source_type,
        source_reference: r.source_reference || '',
        sourceReference: r.source_reference || '',
        status: r.status,
        notes: r.notes || '',
        total_items: Number(r.total_items || 0),
        totalItems: Number(r.total_items || 0),
        product_count: Number(r.total_items || 0),
        productCount: Number(r.total_items || 0),
        total_quantity: Number(r.total_quantity || 0),
        totalQuantity: Number(r.total_quantity || 0),
        created_at: r.created_at,
        createdAt: r.created_at,
        confirmed_at: r.confirmed_at,
        confirmedAt: r.confirmed_at,
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (err) {
    console.error('Failed to load stock receipts:', err);
    sendRouteError(res, err, 500, 'Failed to load stock receipts');
  }
});

/**
 * Helper to delete stock receipt(s) and safely revert on-hand stock if confirmed
 */
async function deleteStockReceipts(receiptIds) {
  if (!Array.isArray(receiptIds) || receiptIds.length === 0) return 0;
  const numIds = receiptIds.map(Number).filter(Boolean);
  if (numIds.length === 0) return 0;

  await db.transaction(async () => {
    const confirmedItems = await db.prepare(`
      SELECT sri.product_id, sri.quantity, r.warehouse_id
      FROM stock_receipt_item sri
      JOIN stock_receipt r ON r.id = sri.receipt_id
      WHERE r.id = ANY(?) AND r.status = 'CONFIRMED'
    `).all(numIds);

    for (const item of confirmedItems) {
      await db.prepare(`
        UPDATE inventory_stock
        SET on_hand_quantity = GREATEST(0, on_hand_quantity - ?), updated_at = NOW()
        WHERE warehouse_id = ? AND product_id = ?
      `).run(item.quantity, item.warehouse_id, item.product_id);
    }

    const strIds = numIds.map(String);
    await db.prepare(`
      DELETE FROM inventory_movement
      WHERE reference_type = 'STOCK_RECEIPT' AND reference_id = ANY(?)
    `).run(strIds);

    await db.prepare('DELETE FROM stock_receipt_item WHERE receipt_id = ANY(?)').run(numIds);
    await db.prepare('DELETE FROM stock_receipt WHERE id = ANY(?)').run(numIds);
  });

  return numIds.length;
}

/**
 * GET /api/inventory/receipts/template
 */
router.get('/receipts/template', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TECHNICON SERVICES ERP';
    const worksheet = workbook.addWorksheet('Stock Inward Template');

    worksheet.columns = [
      { header: 'Part No', key: 'part_no', width: 18 },
      { header: 'Quantity', key: 'quantity', width: 14 },
      { header: 'Warehouse Code', key: 'warehouse', width: 18 },
      { header: 'Reference', key: 'reference', width: 22 },
      { header: 'Notes', key: 'notes', width: 28 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141B34' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF2FBF71' } },
      };
    });

    worksheet.addRow({
      part_no: '00097993',
      quantity: 50,
      warehouse: 'HYD-01',
      reference: 'INV-2026-001',
      notes: 'Received from Vendor Shipment',
    });
    worksheet.addRow({
      part_no: '00230178',
      quantity: 20,
      warehouse: 'HYD-01',
      reference: 'INV-2026-001',
      notes: 'Batch #B-409',
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TECHNICON_Stock_Inward_Template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to generate stock inward template:', err);
    res.status(500).json({ error: 'Failed to generate stock inward template' });
  }
});

/**
 * POST /api/inventory/receipts/import-excel
 */
router.post('/receipts/import-excel', requireAuth, uploadExcel.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded (.xlsx format required)' });
  }

  try {
    const defaultWh = await ensureDefaultWarehouse();
    const allWarehouses = await db.prepare('SELECT id, name, code FROM warehouse').all();
    const whByCode = new Map(allWarehouses.map((w) => [String(w.code).toUpperCase(), w.id]));
    const whByName = new Map(allWarehouses.map((w) => [String(w.name).toLowerCase(), w.id]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      return res.status(400).json({ error: 'The uploaded Excel sheet contains no data rows.' });
    }

    let headerRowIdx = -1;
    let colMap = {};
    for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      let foundPart = false;
      const tempMap = {};
      row.eachCell((cell, colNumber) => {
        const text = normalizeHeader(getCellValue(cell));
        if (text.includes('part') || text === 'itemcode' || text === 'sku' || text === 'itemno') {
          foundPart = true;
          tempMap.part_no = colNumber;
        } else if (text.includes('quantity') || text === 'qty' || text.includes('units') || text === 'inwardqty') {
          tempMap.quantity = colNumber;
        } else if (text.includes('warehouse') || text === 'wh' || text === 'facility') {
          tempMap.warehouse = colNumber;
        } else if (text.includes('ref') || text.includes('invoice') || text.includes('po')) {
          tempMap.reference = colNumber;
        } else if (text.includes('note') || text.includes('remark')) {
          tempMap.notes = colNumber;
        }
      });
      if (foundPart) {
        headerRowIdx = r;
        colMap = tempMap;
        break;
      }
    }

    if (headerRowIdx === -1 || !colMap.part_no) {
      return res.status(400).json({
        error: 'Could not find a "Part No" column in the Excel file.',
      });
    }

    const parsedItems = [];
    let sourceRef = '';
    for (let r = headerRowIdx + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const rawPart = getCellValue(row.getCell(colMap.part_no));
      if (!rawPart || !String(rawPart).trim()) continue;

      const partNo = String(rawPart).trim();
      const rawQty = colMap.quantity ? getCellValue(row.getCell(colMap.quantity)) : 0;
      const qty = Number(rawQty) || 0;
      if (qty <= 0) continue;

      let targetWhId = defaultWh.id;
      if (colMap.warehouse) {
        const whVal = String(getCellValue(row.getCell(colMap.warehouse)) || '').trim();
        if (whVal) {
          const byCode = whByCode.get(whVal.toUpperCase());
          const byName = whByName.get(whVal.toLowerCase());
          if (byCode) targetWhId = byCode;
          else if (byName) targetWhId = byName;
        }
      }

      const itemRef = colMap.reference ? String(getCellValue(row.getCell(colMap.reference)) || '').trim() : '';
      if (!sourceRef && itemRef) sourceRef = itemRef;

      const itemNotes = colMap.notes ? String(getCellValue(row.getCell(colMap.notes)) || '').trim() : '';

      parsedItems.push({
        partNo,
        quantity: qty,
        warehouseId: targetWhId,
        reference: itemRef,
        notes: itemNotes,
      });
    }

    if (parsedItems.length === 0) {
      return res.status(400).json({ error: 'No valid items with positive quantity found in the Excel sheet.' });
    }

    const validUserId = await resolveUserId(req.user);
    const recNum = await getNextReceiptNumber('REC');
    const primaryWhId = parsedItems[0].warehouseId || defaultWh.id;

    let receiptId;
    let totalUnits = 0;

    await db.transaction(async () => {
      const insertedReceipt = await db.prepare(`
        INSERT INTO stock_receipt (
          warehouse_id, receipt_number, source_type, source_reference,
          status, notes, created_by, confirmed_at, created_at
        ) VALUES (?, ?, 'EXCEL_IMPORT', ?, 'CONFIRMED', ?, ?, NOW(), NOW())
        RETURNING id
      `).get(
        primaryWhId,
        recNum,
        sourceRef || `Import: ${req.file.originalname}`,
        `Bulk Excel inward of ${parsedItems.length} lines`,
        validUserId
      );

      receiptId = insertedReceipt.id;

      for (const it of parsedItems) {
        totalUnits += it.quantity;

        let product = await db.prepare('SELECT id, description, unit FROM product WHERE part_no = ?').get(it.partNo);
        if (!product) {
          product = await db.prepare(`
            INSERT INTO product (part_no, description, unit)
            VALUES (?, ?, 'Nos')
            RETURNING id, description, unit
          `).get(it.partNo, it.partNo);
        }

        const stockRow = await db.prepare(`
          SELECT on_hand_quantity, reserved_quantity FROM inventory_stock
          WHERE warehouse_id = ? AND product_id = ?
        `).get(it.warehouseId, product.id);

        const beforeOnHand = Number(stockRow?.on_hand_quantity || 0);
        const afterOnHand = beforeOnHand + it.quantity;
        const beforeReserved = Number(stockRow?.reserved_quantity || 0);

        if (stockRow) {
          await db.prepare(`
            UPDATE inventory_stock
            SET on_hand_quantity = on_hand_quantity + ?, updated_at = NOW()
            WHERE warehouse_id = ? AND product_id = ?
          `).run(it.quantity, it.warehouseId, product.id);
        } else {
          await db.prepare(`
            INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
          `).run(it.warehouseId, product.id, it.quantity);
        }

        await db.prepare(`
          INSERT INTO stock_receipt_item (
            receipt_id, product_id, quantity, before_on_hand, after_on_hand, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `).run(receiptId, product.id, it.quantity, beforeOnHand, afterOnHand, it.notes || null);

        await db.prepare(`
          INSERT INTO inventory_movement (
            warehouse_id, product_id, movement_type, quantity, before_on_hand, after_on_hand,
            before_reserved, after_reserved, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, 'STOCK_IN', ?, ?, ?, ?, ?, 'STOCK_RECEIPT', ?, ?, ?, NOW())
        `).run(
          it.warehouseId,
          product.id,
          it.quantity,
          beforeOnHand,
          afterOnHand,
          beforeReserved,
          beforeReserved,
          String(receiptId),
          `Excel Stock Inward Receipt ${recNum}`,
          validUserId
        );
      }
    });

    res.json({
      success: true,
      receiptId,
      receiptNumber: recNum,
      totalItems: parsedItems.length,
      totalQuantity: totalUnits,
    });
  } catch (err) {
    console.error('Failed to import stock receipts from Excel:', err);
    sendRouteError(res, err, 500, 'Failed to import stock receipts');
  }
});

/**
 * POST /api/inventory/receipts/bulk-delete
 */
router.post('/receipts/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const count = await deleteStockReceipts(ids);
    res.json({ success: true, deletedCount: count });
  } catch (err) {
    console.error('Failed to bulk delete receipts:', err);
    sendRouteError(res, err, 500, 'Failed to bulk delete receipts');
  }
});

/**
 * DELETE /api/inventory/receipts/:id
 */
router.delete('/receipts/:id', requireAuth, async (req, res) => {
  try {
    const recId = Number(req.params.id);
    if (!recId) return res.status(400).json({ error: 'Invalid receipt ID' });

    const existing = await db.prepare('SELECT id, receipt_number FROM stock_receipt WHERE id = ?').get(recId);
    if (!existing) return res.status(404).json({ error: 'Stock receipt not found' });

    await deleteStockReceipts([recId]);
    res.json({ success: true, id: recId, receiptNumber: existing.receipt_number });
  } catch (err) {
    console.error('Failed to delete stock receipt:', err);
    sendRouteError(res, err, 500, 'Failed to delete stock receipt');
  }
});

/**
 * GET /api/inventory/receipts/:id
 */
router.get('/receipts/:id', requireAuth, async (req, res) => {

  try {
    const recId = Number(req.params.id);
    const detail = await fetchStockReceiptDetail(recId);
    if (!detail) return res.status(404).json({ error: 'Stock receipt not found' });

    res.json(detail);
  } catch (err) {
    console.error('Failed to get stock receipt detail:', err);
    sendRouteError(res, err, 500, 'Failed to fetch receipt detail');
  }
});

/**
 * POST /api/inventory/receipts
 * Create Stock Receipt (Manual Stock Inward)
 */
router.post('/receipts', requireAuth, async (req, res) => {
  try {
    const {
      warehouseId,
      receiptNumber,
      sourceType = 'MANUAL',
      sourceReference,
      notes,
      items = [],
      confirmImmediately = true,
    } = req.body;

    if (!warehouseId) return res.status(400).json({ error: 'Warehouse is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

    let whId = Number(warehouseId);
    const wh = await db.prepare(`SELECT id FROM warehouse WHERE id = ?`).get(whId);
    if (!wh) {
      const defWh = await ensureDefaultWarehouse();
      whId = defWh.id;
    }

    const recNum = receiptNumber && receiptNumber.trim() ? receiptNumber.trim() : await getNextReceiptNumber('REC');
    const status = confirmImmediately ? 'CONFIRMED' : 'DRAFT';

    const validUserId = await resolveUserId(req.user);

    const insertedReceipt = await db.prepare(`
      INSERT INTO stock_receipt (
        warehouse_id, receipt_number, source_type, source_reference,
        status, notes, created_by, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(
      whId,
      recNum,
      sourceType,
      sourceReference ? sourceReference.trim() : null,
      status,
      notes ? notes.trim() : null,
      validUserId,
      confirmImmediately ? new Date().toISOString() : null
    );

    const receiptId = insertedReceipt.id;

    for (const it of items) {
      const prodId = Number(it.productId);
      const qty = Number(it.quantity) || 0;
      if (!prodId || qty <= 0) continue;

      let beforeOnHand = 0;
      let afterOnHand = qty;

      if (confirmImmediately) {
        // Upsert stock in inventory_stock
        const stockRow = await db
          .prepare(`SELECT on_hand_quantity FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
          .get(whId, prodId);

        beforeOnHand = Number(stockRow?.on_hand_quantity || 0);
        afterOnHand = beforeOnHand + qty;

        if (stockRow) {
          await db.prepare(`
            UPDATE inventory_stock 
            SET on_hand_quantity = on_hand_quantity + ?, updated_at = NOW()
            WHERE warehouse_id = ? AND product_id = ?
          `).run(qty, whId, prodId);
        } else {
          await db.prepare(`
            INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity)
            VALUES (?, ?, ?)
          `).run(whId, prodId, qty);
        }

        // Insert inventory_movement
        await db.prepare(`
          INSERT INTO inventory_movement (
            warehouse_id, product_id, movement_type, quantity,
            before_on_hand, after_on_hand, reference_type, reference_id, reason, created_by
          ) VALUES (?, ?, 'STOCK_IN', ?, ?, ?, 'STOCK_RECEIPT', ?, ?, ?)
        `).run(whId, prodId, qty, beforeOnHand, afterOnHand, String(receiptId), notes || 'Stock Inward', validUserId);
      }

      await db.prepare(`
        INSERT INTO stock_receipt_item (
          receipt_id, product_id, quantity, before_on_hand, after_on_hand, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(receiptId, prodId, qty, beforeOnHand, afterOnHand, it.notes || null);
    }

    const detail = await fetchStockReceiptDetail(receiptId);
    res.status(201).json(detail);
  } catch (err) {
    console.error('Failed to create stock receipt:', err);
    sendRouteError(res, err, 400, 'Failed to create stock receipt');
  }
});

/**
 * POST /api/inventory/receipts/:id/confirm
 */
router.post('/receipts/:id/confirm', requireAuth, async (req, res) => {
  try {
    const recId = Number(req.params.id);
    const r = await db.prepare(`SELECT * FROM stock_receipt WHERE id = ?`).get(recId);

    if (!r) return res.status(404).json({ error: 'Stock receipt not found' });
    if (r.status === 'CONFIRMED') {
      const detail = await fetchStockReceiptDetail(recId);
      return res.json(detail);
    }

    const validUserId = await resolveUserId(req.user);
    const items = await db.prepare(`SELECT * FROM stock_receipt_item WHERE receipt_id = ?`).all(recId);

    for (const it of items) {
      const whId = r.warehouse_id;
      const prodId = it.product_id;
      const qty = Number(it.quantity);

      const stockRow = await db
        .prepare(`SELECT on_hand_quantity FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
        .get(whId, prodId);

      const beforeOnHand = Number(stockRow?.on_hand_quantity || 0);
      const afterOnHand = beforeOnHand + qty;

      if (stockRow) {
        await db.prepare(`
          UPDATE inventory_stock 
          SET on_hand_quantity = on_hand_quantity + ?, updated_at = NOW()
          WHERE warehouse_id = ? AND product_id = ?
        `).run(qty, whId, prodId);
      } else {
        await db.prepare(`
          INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity)
          VALUES (?, ?, ?)
        `).run(whId, prodId, qty);
      }

      await db.prepare(`
        UPDATE stock_receipt_item SET before_on_hand = ?, after_on_hand = ? WHERE id = ?
      `).run(beforeOnHand, afterOnHand, it.id);

      await db.prepare(`
        INSERT INTO inventory_movement (
          warehouse_id, product_id, movement_type, quantity,
          before_on_hand, after_on_hand, reference_type, reference_id, reason, created_by
        ) VALUES (?, ?, 'STOCK_IN', ?, ?, ?, 'STOCK_RECEIPT', ?, ?, ?)
      `).run(whId, prodId, qty, beforeOnHand, afterOnHand, String(recId), 'Confirm Receipt', validUserId);
    }

    await db.prepare(`UPDATE stock_receipt SET status = 'CONFIRMED', confirmed_at = NOW() WHERE id = ?`).run(recId);

    const detail = await fetchStockReceiptDetail(recId);
    res.json(detail);
  } catch (err) {
    console.error('Failed to confirm receipt:', err);
    sendRouteError(res, err, 400, 'Failed to confirm receipt');
  }
});

/**
 * POST /api/inventory/receipts/:id/cancel
 */
router.post('/receipts/:id/cancel', requireAuth, async (req, res) => {
  try {
    const recId = Number(req.params.id);
    const r = await db.prepare(`SELECT * FROM stock_receipt WHERE id = ?`).get(recId);

    if (!r) return res.status(404).json({ error: 'Stock receipt not found' });
    if (r.status === 'CONFIRMED') return res.status(400).json({ error: 'Cannot cancel a confirmed receipt' });

    await db.prepare(`UPDATE stock_receipt SET status = 'CANCELLED' WHERE id = ?`).run(recId);

    const detail = await fetchStockReceiptDetail(recId);
    res.json(detail);
  } catch (err) {
    console.error('Failed to cancel receipt:', err);
    sendRouteError(res, err, 400, 'Failed to cancel receipt');
  }
});

/**
 * GET /api/inventory/movements
 */

router.get('/movements', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = pageParams(req.query);
    res.json(
      await inventory.getMovements({
        warehouseId: optionalId(req.query.warehouseId),
        productId: optionalId(req.query.productId),
        movementType: req.query.movementType ? String(req.query.movementType).trim() : null,
        referenceType: req.query.referenceType ? String(req.query.referenceType).trim() : null,
        referenceId: req.query.referenceId ? String(req.query.referenceId).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to list movements');
  }
});

/**
 * GET /api/inventory/reservations
 */

router.get('/reservations', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = pageParams(req.query);
    res.json(
      await inventory.getReservations({
        warehouseId: optionalId(req.query.warehouseId),
        productId: optionalId(req.query.productId),
        status: req.query.status ? String(req.query.status).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to list reservations');
  }
});

/**
 * Helper to delete reservation(s) and safely release reserved stock if active
 */
async function deleteStockReservations(resIds) {
  if (!Array.isArray(resIds) || resIds.length === 0) return 0;
  const numIds = resIds.map(Number).filter(Boolean);
  if (numIds.length === 0) return 0;

  await db.transaction(async () => {
    const activeRes = await db.prepare(`
      SELECT warehouse_id, product_id, quantity
      FROM stock_reservation
      WHERE id = ANY(?) AND status = 'ACTIVE'
    `).all(numIds);

    for (const r of activeRes) {
      await db.prepare(`
        UPDATE inventory_stock
        SET reserved_quantity = GREATEST(0, reserved_quantity - ?), updated_at = NOW()
        WHERE warehouse_id = ? AND product_id = ?
      `).run(r.quantity, r.warehouse_id, r.product_id);
    }

    await db.prepare('DELETE FROM stock_reservation WHERE id = ANY(?)').run(numIds);
  });

  return numIds.length;
}

/**
 * GET /api/inventory/reservations/template
 */
router.get('/reservations/template', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TECHNICON SERVICES ERP';
    const worksheet = workbook.addWorksheet('Reservations Template');

    worksheet.columns = [
      { header: 'Part No', key: 'part_no', width: 18 },
      { header: 'Reserved Quantity', key: 'quantity', width: 18 },
      { header: 'Warehouse Code', key: 'warehouse', width: 18 },
      { header: 'Reference Type', key: 'reference_type', width: 18 },
      { header: 'Reference ID', key: 'reference_id', width: 18 },
      { header: 'Notes', key: 'notes', width: 28 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141B34' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF2FBF71' } },
      };
    });

    worksheet.addRow({
      part_no: '00097993',
      quantity: 10,
      warehouse: 'HYD-01',
      reference_type: 'QUOTATION',
      reference_id: 'Q2627/001',
      notes: 'Customer project reservation',
    });
    worksheet.addRow({
      part_no: '00230178',
      quantity: 5,
      warehouse: 'HYD-01',
      reference_type: 'SALES_ORDER',
      reference_id: 'SO-1044',
      notes: 'Order reserve buffer',
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TECHNICON_Reservations_Template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to generate reservations template:', err);
    res.status(500).json({ error: 'Failed to generate reservations template' });
  }
});

/**
 * POST /api/inventory/reservations/import-excel
 */
router.post('/reservations/import-excel', requireAuth, uploadExcel.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded (.xlsx format required)' });
  }

  try {
    const defaultWh = await ensureDefaultWarehouse();
    const allWarehouses = await db.prepare('SELECT id, name, code FROM warehouse').all();
    const whByCode = new Map(allWarehouses.map((w) => [String(w.code).toUpperCase(), w.id]));
    const whByName = new Map(allWarehouses.map((w) => [String(w.name).toLowerCase(), w.id]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      return res.status(400).json({ error: 'The uploaded Excel sheet contains no data rows.' });
    }

    let headerRowIdx = -1;
    let colMap = {};
    for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      let foundPart = false;
      const tempMap = {};
      row.eachCell((cell, colNumber) => {
        const text = normalizeHeader(getCellValue(cell));
        if (text.includes('part') || text === 'itemcode' || text === 'sku' || text === 'itemno') {
          foundPart = true;
          tempMap.part_no = colNumber;
        } else if (text.includes('quantity') || text === 'qty' || text.includes('reserve')) {
          tempMap.quantity = colNumber;
        } else if (text.includes('warehouse') || text === 'wh' || text === 'facility') {
          tempMap.warehouse = colNumber;
        } else if (text.includes('reftype') || text.includes('referencetype')) {
          tempMap.reference_type = colNumber;
        } else if (text.includes('refid') || text.includes('referenceid') || text.includes('reference')) {
          tempMap.reference_id = colNumber;
        } else if (text.includes('note') || text.includes('remark')) {
          tempMap.notes = colNumber;
        }
      });
      if (foundPart) {
        headerRowIdx = r;
        colMap = tempMap;
        break;
      }
    }

    if (headerRowIdx === -1 || !colMap.part_no) {
      return res.status(400).json({
        error: 'Could not find a "Part No" column in the Excel file.',
      });
    }

    let createdCount = 0;
    const errors = [];
    const reservedBy = await resolveUserId(req.user);

    await db.transaction(async () => {
      for (let r = headerRowIdx + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const rawPart = getCellValue(row.getCell(colMap.part_no));
        if (!rawPart || !String(rawPart).trim()) continue;

        const partNo = String(rawPart).trim();
        const rawQty = colMap.quantity ? getCellValue(row.getCell(colMap.quantity)) : 0;
        const qty = Number(rawQty) || 0;
        if (qty <= 0) continue;

        let targetWhId = defaultWh.id;
        if (colMap.warehouse) {
          const whVal = String(getCellValue(row.getCell(colMap.warehouse)) || '').trim();
          if (whVal) {
            const byCode = whByCode.get(whVal.toUpperCase());
            const byName = whByName.get(whVal.toLowerCase());
            if (byCode) targetWhId = byCode;
            else if (byName) targetWhId = byName;
          }
        }

        const refType = colMap.reference_type ? String(getCellValue(row.getCell(colMap.reference_type)) || 'MANUAL').trim().toUpperCase() : 'MANUAL';
        const refId = colMap.reference_id ? String(getCellValue(row.getCell(colMap.reference_id)) || '').trim() : '';
        const notes = colMap.notes ? String(getCellValue(row.getCell(colMap.notes)) || '').trim() : '';

        let product = await db.prepare('SELECT id FROM product WHERE part_no = ?').get(partNo);
        if (!product) {
          product = await db.prepare('INSERT INTO product (part_no, description, unit) VALUES (?, ?, \'Nos\') RETURNING id').get(partNo, partNo);
        }

        // inventory_stock enforces on_hand >= reserved, so reserving more than is available would
        // abort the whole import transaction; report the row and keep going instead.
        const stockRow = await inventory.getOrCreateStockRow(targetWhId, product.id);
        const available = Number(stockRow.on_hand_quantity) - Number(stockRow.reserved_quantity);
        if (qty > available) {
          errors.push(`Row ${r} (${partNo}): requested ${qty} but only ${Math.max(0, available)} available to reserve`);
          continue;
        }
        await db.prepare('UPDATE inventory_stock SET reserved_quantity = reserved_quantity + ?, updated_at = NOW() WHERE warehouse_id = ? AND product_id = ?').run(qty, targetWhId, product.id);

        await db.prepare(`
          INSERT INTO stock_reservation (
            warehouse_id, product_id, quantity, status, reference_type, reference_id, notes, reserved_by, created_at
          ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NOW())
        `).run(targetWhId, product.id, qty, refType || 'MANUAL', refId || null, notes || `Excel import: ${req.file.originalname}`, reservedBy);

        createdCount++;
      }
    });

    res.json({
      success: true,
      createdCount,
      errors,
    });
  } catch (err) {
    console.error('Failed to import reservations from Excel:', err);
    sendRouteError(res, err, 500, 'Failed to import reservations');
  }
});

/**
 * POST /api/inventory/reservations/bulk-delete
 */
router.post('/reservations/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const count = await deleteStockReservations(ids);
    res.json({ success: true, deletedCount: count });
  } catch (err) {
    console.error('Failed to bulk delete reservations:', err);
    sendRouteError(res, err, 500, 'Failed to bulk delete reservations');
  }
});

/**
 * DELETE /api/inventory/reservations/:id
 */
router.delete('/reservations/:id', requireAuth, async (req, res) => {
  try {
    const resId = Number(req.params.id);
    if (!resId) return res.status(400).json({ error: 'Invalid reservation ID' });

    const existing = await db.prepare('SELECT id FROM stock_reservation WHERE id = ?').get(resId);
    if (!existing) return res.status(404).json({ error: 'Stock reservation not found' });

    await deleteStockReservations([resId]);
    res.json({ success: true, id: resId });
  } catch (err) {
    console.error('Failed to delete reservation:', err);
    sendRouteError(res, err, 500, 'Failed to delete reservation');
  }
});


/**
 * GET /api/inventory/transfers
 */

router.get('/transfers', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = pageParams(req.query);
    res.json(
      await inventory.getStockTransfers({
        warehouseId: optionalId(req.query.warehouseId),
        status: req.query.status ? String(req.query.status).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to list transfers');
  }
});

/**
 * GET /api/inventory/operations/audit
 */

router.get('/operations/audit', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = pageParams(req.query);
    res.json(
      await inventory.getOperationsInventoryAudit({
        warehouseId: optionalId(req.query.warehouseId),
        productId: optionalId(req.query.productId),
        movementType: req.query.movementType ? String(req.query.movementType).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch inventory audit');
  }
});

// ---------------------------------------------------------------------------
// Stock movements: stock-in / stock-out / adjust / return / reservations
// ---------------------------------------------------------------------------

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  return missing.length ? `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required` : null;
}

/**
 * POST /api/inventory/stock-in
 */
router.post('/stock-in', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, quantity, referenceType, referenceId, reason } = req.body;
    const result = await inventory.recordStockIn({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType: referenceType || undefined,
      referenceId,
      reason: reason || undefined,
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to record stock in');
  }
});

/**
 * POST /api/inventory/stock-out
 */
router.post('/stock-out', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, quantity, referenceType, referenceId, reason } = req.body;
    const result = await inventory.recordStockOut({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType: referenceType || undefined,
      referenceId,
      reason: reason || undefined,
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to record stock out');
  }
});

/**
 * POST /api/inventory/adjust
 * Set on-hand to an absolute quantity (opening stock / physical count).
 */
router.post('/adjust', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'newOnHandQuantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, newOnHandQuantity, reason, referenceType, referenceId } = req.body;
    const result = await inventory.adjustStock({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      newOnHandQuantity: Number(newOnHandQuantity),
      reason: reason || undefined,
      referenceType: referenceType || undefined,
      referenceId,
      userId: await resolveUserId(req.user),
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Failed to adjust stock');
  }
});

/**
 * POST /api/inventory/adjustments
 * Increase or decrease on-hand by a quantity.
 */
router.post('/adjustments', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'direction', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, direction, quantity, reason, notes } = req.body;
    const result = await inventory.createStockAdjustment({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      direction,
      quantity: Number(quantity),
      reason: reason || undefined,
      notes: notes || '',
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to create stock adjustment');
  }
});

async function handleReturn(req, res) {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, quantity, referenceType, referenceId, reason, notes } = req.body;
    const result = await inventory.recordReturn({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType: referenceType || undefined,
      referenceId,
      reason: reason || undefined,
      notes: notes || '',
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to record stock return');
  }
}

/**
 * POST /api/inventory/return and /api/inventory/returns
 */
router.post('/return', requireAuth, handleReturn);
router.post('/returns', requireAuth, handleReturn);

/**
 * POST /api/inventory/reserve
 */
router.post('/reserve', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['warehouseId', 'productId', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { warehouseId, productId, quantity, referenceType, referenceId, notes } = req.body;
    const result = await inventory.reserveStock({
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      referenceType: referenceType || undefined,
      referenceId,
      notes: notes || '',
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, 'Failed to reserve stock');
  }
});

/**
 * POST /api/inventory/release-reservation/:id
 */
router.post('/release-reservation/:id', requireAuth, async (req, res) => {
  try {
    const reservationId = optionalId(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'Invalid reservation ID' });
    res.json(await inventory.releaseReservation({ reservationId }));
  } catch (err) {
    sendError(res, err, 'Failed to release reservation');
  }
});

/**
 * POST /api/inventory/fulfill-reservation/:id
 */
router.post('/fulfill-reservation/:id', requireAuth, async (req, res) => {
  try {
    const reservationId = optionalId(req.params.id);
    if (!reservationId) return res.status(400).json({ error: 'Invalid reservation ID' });
    res.json(await inventory.fulfillReservation({ reservationId, userId: await resolveUserId(req.user) }));
  } catch (err) {
    sendError(res, err, 'Failed to fulfill reservation');
  }
});

/**
 * GET /api/inventory/reservations/:id
 * Registered after /reservations/template so that path isn't read as an id.
 */
router.get('/reservations/:id', requireAuth, async (req, res) => {
  try {
    const id = optionalId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid reservation ID' });

    const reservation = await inventory.getReservationById(id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    res.json(reservation);
  } catch (err) {
    sendError(res, err, 'Failed to fetch reservation');
  }
});

// ---------------------------------------------------------------------------
// Excel stock inward: analyze workbook, preview mapped rows, preview JSON rows
// ---------------------------------------------------------------------------

// Runs the multer upload and turns its errors (size / file type) into 400s instead of the
// generic 500 from the app-level error handler.
function withExcelUpload(handler) {
  return (req, res) => {
    uploadExcel.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (maximum allowed is 25MB)' : `Upload error: ${err.message}`;
        return res.status(400).json({ error: message });
      }
      if (err) return sendRouteError(res, err, 400, 'Upload failed');
      if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded' });
      handler(req, res);
    });
  };
}

/**
 * POST /api/inventory/receipts/analyze-excel
 */
router.post(
  '/receipts/analyze-excel',
  requireAuth,
  withExcelUpload(async (req, res) => {
    try {
      res.json(await inventory.analyzeExcelStockWorkbook(req.file.buffer));
    } catch (err) {
      sendRouteError(res, err, 400, 'Could not parse Excel workbook');
    }
  })
);

/**
 * POST /api/inventory/receipts/preview-excel
 */
router.post(
  '/receipts/preview-excel',
  requireAuth,
  withExcelUpload(async (req, res) => {
    try {
      const warehouseId = optionalId(req.body.warehouseId);
      if (!warehouseId) return res.status(400).json({ error: 'Warehouse is required' });

      const partNoColumn = req.body.partNoColumn ? String(req.body.partNoColumn).trim() : null;
      const quantityColumn = req.body.quantityColumn ? String(req.body.quantityColumn).trim() : null;
      if (!partNoColumn || !quantityColumn) {
        return res.status(400).json({ error: 'Part Number and Quantity column mappings are required' });
      }

      const rows = await inventory.extractMappedRows(req.file.buffer, {
        sheetName: req.body.sheetName ? String(req.body.sheetName).trim() : null,
        partNoColumn,
        quantityColumn,
        notesColumn: req.body.notesColumn ? String(req.body.notesColumn).trim() : null,
      });
      res.json(
        await inventory.previewExcelStockInward({
          warehouseId,
          rows,
          duplicateHandling: req.body.duplicateHandling || 'combine',
          sourceReference: req.body.sourceReference || null,
        })
      );
    } catch (err) {
      sendRouteError(res, err, 400, 'Could not parse workbook data');
    }
  })
);

/**
 * POST /api/inventory/receipts/preview-rows
 */
router.post('/receipts/preview-rows', requireAuth, async (req, res) => {
  try {
    const { warehouseId, rows, duplicateHandling, sourceReference } = req.body;
    res.json(await inventory.previewExcelStockInward({ warehouseId, rows, duplicateHandling, sourceReference }));
  } catch (err) {
    sendError(res, err, 'Failed to preview rows');
  }
});

// ---------------------------------------------------------------------------
// Operations control center
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory/operations/overview
 */
router.get('/operations/overview', requireAuth, async (req, res) => {
  try {
    res.json(await inventory.getOperationsOverview({ warehouseId: optionalId(req.query.warehouseId) }));
  } catch (err) {
    sendError(res, err, 'Failed to fetch inventory operations overview');
  }
});

/**
 * GET /api/inventory/operations/alerts
 */
router.get('/operations/alerts', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = pageParams(req.query);
    res.json(
      await inventory.getOperationsStockAlerts({
        warehouseId: optionalId(req.query.warehouseId),
        category: req.query.category ? String(req.query.category).trim() : null,
        severity: req.query.severity ? String(req.query.severity).trim() : null,
        limit,
        offset,
      })
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch stock alerts');
  }
});

const operationsLists = {
  critical: [inventory.getOperationsCriticalStock, 'Failed to fetch critical stock'],
  'out-of-stock': [inventory.getOperationsOutOfStock, 'Failed to fetch out of stock items'],
  'restock-queue': [inventory.getOperationsRestockQueue, 'Failed to fetch restock queue'],
  incoming: [inventory.getOperationsIncomingStock, 'Failed to fetch incoming stock'],
  'pending-reservations': [inventory.getOperationsPendingReservations, 'Failed to fetch pending reservations'],
};

/**
 * GET /api/inventory/operations/{critical,out-of-stock,restock-queue,incoming,pending-reservations}
 */
for (const [path, [load, failureMessage]] of Object.entries(operationsLists)) {
  router.get(`/operations/${path}`, requireAuth, async (req, res) => {
    try {
      const { limit, offset } = pageParams(req.query);
      res.json(await load({ warehouseId: optionalId(req.query.warehouseId), limit, offset }));
    } catch (err) {
      sendError(res, err, failureMessage);
    }
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory/transfers/:id
 */
router.get('/transfers/:id', requireAuth, async (req, res) => {
  try {
    const id = optionalId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid transfer ID' });

    const transfer = await inventory.getTransferById(id);
    if (!transfer) return res.status(404).json({ error: 'Stock transfer not found' });
    res.json(transfer);
  } catch (err) {
    sendError(res, err, 'Failed to fetch stock transfer');
  }
});

/**
 * POST /api/inventory/transfers
 */
router.post('/transfers', requireAuth, async (req, res) => {
  try {
    const missing = requireFields(req.body, ['sourceWarehouseId', 'destinationWarehouseId', 'productId', 'quantity']);
    if (missing) return res.status(400).json({ error: missing });

    const { sourceWarehouseId, destinationWarehouseId, productId, quantity, reference, notes } = req.body;
    const transfer = await inventory.createStockTransfer({
      sourceWarehouseId: Number(sourceWarehouseId),
      destinationWarehouseId: Number(destinationWarehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      reference,
      notes,
      userId: await resolveUserId(req.user),
    });
    res.status(201).json(transfer);
  } catch (err) {
    sendError(res, err, 'Failed to create stock transfer');
  }
});

export default router;
