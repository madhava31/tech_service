import db from '../db/index.js';
import { recordStockIn, getWarehouseById, getOrCreateStockRow } from './inventoryService.js';
import { nextNumber } from '../db/numbering.js';

/**
 * Derives operational procurement status for a requirement or PO
 */
export function deriveProcurementPriority({ available = 0, reorderPoint = 10, safetyStock = 5, hasSalesConstraint = false }) {
  if (available <= 0 || hasSalesConstraint) return 'CRITICAL';
  if (available <= safetyStock) return 'HIGH';
  if (available <= reorderPoint) return 'MEDIUM';
  return 'LOW';
}

/**
 * GET Procurement Control Center Overview Metrics & KPIs
 */
export async function getProcurementOverview(customDb = db) {
  const database = customDb || db;

  // Open POs & Totals
  const poStats = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_pos,
        SUM(CASE WHEN po.status IN ('open', 'ORDERED', 'PARTIALLY_RECEIVED') THEN 1 ELSE 0 END) AS open_pos,
        SUM(CASE WHEN po.status IN ('received', 'RECEIVED') THEN 1 ELSE 0 END) AS fully_received_pos,
        SUM(CASE WHEN po.status = 'PARTIALLY_RECEIVED' THEN 1 ELSE 0 END) AS partially_received_pos,
        COALESCE(SUM(COALESCE(q.total, 0)), 0) AS total_procurement_value
       FROM purchase_order po
       LEFT JOIN quotation q ON q.id = po.quotation_id`
    )
    .get();

  // Procurement Requirements
  const reqStats = await database
    .prepare(
      `SELECT
        COUNT(*) AS total_requirements,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_requirements,
        SUM(CASE WHEN status = 'FULFILLED' THEN 1 ELSE 0 END) AS fulfilled_requirements
       FROM procurement_requirement`
    )
    .get();

  // Suppliers Count
  const supplierCountRow = await database
    .prepare(`SELECT COUNT(*) AS total FROM company WHERE is_supplier = 1 OR company_type = 'supplier'`)
    .get();

  // Incoming Units calculation
  const incomingUnitsRow = await database
    .prepare(
      `SELECT COALESCE(SUM(qi.qty - COALESCE(po.received_quantity, 0)), 0) AS incoming_units
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       JOIN quotation_item qi ON qi.quotation_id = q.id
       WHERE po.status IN ('open', 'ORDERED', 'PARTIALLY_RECEIVED')`
    )
    .get();

  return {
    kpis: {
      openPurchaseOrders: poStats.open_pos || 0,
      pendingSupplierOrders: poStats.open_pos || 0,
      ordersAwaitingReceipt: poStats.open_pos || 0,
      partiallyReceivedOrders: poStats.partially_received_pos || 0,
      fullyReceivedOrders: poStats.fully_received_pos || 0,
      pendingRequirements: reqStats.open_requirements || 0,
      incomingUnits: Math.max(0, incomingUnitsRow.incoming_units || 0),
      incomingPurchaseValue: poStats.total_procurement_value || 0,
      totalSuppliers: supplierCountRow.total || 0,
      procurementValue: poStats.total_procurement_value || 0,
    },
  };
}

/**
 * LIST Procurement Requirements
 */
export async function getProcurementRequirements({ q = null, priority = null, status = null, sourceType = null, warehouseId = null, limit = 50, offset = 0 }, customDb = db) {
  const database = customDb || db;

  let sql = `
    SELECT
      pr.*,
      p.part_no, p.description AS product_description, p.unit, p.default_price,
      w.name AS warehouse_name, w.code AS warehouse_code,
      c.name AS supplier_name,
      po.number AS po_number
    FROM procurement_requirement pr
    JOIN product p ON p.id = pr.product_id
    JOIN warehouse w ON w.id = pr.warehouse_id
    LEFT JOIN company c ON c.id = pr.supplier_id
    LEFT JOIN purchase_order po ON po.id = pr.purchase_order_id
    WHERE 1=1
  `;
  const params = [];

  if (warehouseId) {
    sql += ` AND pr.warehouse_id = ?`;
    params.push(warehouseId);
  }
  if (priority) {
    sql += ` AND pr.priority = ?`;
    params.push(priority.toUpperCase());
  }
  if (status) {
    sql += ` AND pr.status = ?`;
    params.push(status.toUpperCase());
  }
  if (sourceType) {
    sql += ` AND pr.source_type = ?`;
    params.push(sourceType.toUpperCase());
  }
  if (q) {
    sql += ` AND (pr.requirement_code LIKE ? OR p.part_no LIKE ? OR p.description LIKE ? OR pr.reason LIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }

  sql += ` ORDER BY pr.id DESC`;

  const allRows = await database.prepare(sql).all(...params);
  const total = allRows.length;
  const paginated = allRows.slice(offset, offset + limit);

  // Enrich with current stock level
  const requirements = await Promise.all(paginated.map(async (r) => {
    const stock = await database
      .prepare(
        `SELECT on_hand_quantity AS on_hand, reserved_quantity AS reserved, incoming_quantity AS incoming
         FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`
      )
      .get(r.warehouse_id, r.product_id) || { on_hand: 0, reserved: 0, incoming: 0 };

    const available = Math.max(0, stock.on_hand - stock.reserved);

    return {
      ...r,
      onHand: stock.on_hand,
      reserved: stock.reserved,
      available,
      incoming: stock.incoming,
    };
  }));

  return { requirements, total, limit, offset };
}

/**
 * GET Procurement Requirement Detail by ID
 */
export async function getProcurementRequirementById(id, customDb = db) {
  const database = customDb || db;

  const req = await database
    .prepare(
      `SELECT
        pr.*,
        p.part_no, p.description AS product_description, p.unit, p.default_price, p.hsn_sac,
        w.name AS warehouse_name, w.code AS warehouse_code, w.address AS warehouse_address,
        c.name AS supplier_name, c.email AS supplier_email, c.phone AS supplier_phone,
        po.number AS po_number, po.date AS po_date, po.status AS po_status
       FROM procurement_requirement pr
       JOIN product p ON p.id = pr.product_id
       JOIN warehouse w ON w.id = pr.warehouse_id
       LEFT JOIN company c ON c.id = pr.supplier_id
       LEFT JOIN purchase_order po ON po.id = pr.purchase_order_id
       WHERE pr.id = ?`
    )
    .get(id);

  if (!req) return null;

  const stock = await database
    .prepare(
      `SELECT on_hand_quantity AS on_hand, reserved_quantity AS reserved, incoming_quantity AS incoming,
              low_stock_threshold AS low_stock, critical_stock_threshold AS critical_stock
       FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`
    )
    .get(req.warehouse_id, req.product_id) || { on_hand: 0, reserved: 0, incoming: 0, low_stock: 10, critical_stock: 5 };

  const available = Math.max(0, stock.on_hand - stock.reserved);

  return {
    requirement: {
      ...req,
      onHand: stock.on_hand,
      reserved: stock.reserved,
      available,
      incoming: stock.incoming,
      reorderPoint: stock.low_stock,
      safetyStock: stock.critical_stock,
    },
  };
}

/**
 * CREATE Procurement Requirement
 */
export async function createProcurementRequirement({
  productId,
  warehouseId,
  requiredQuantity,
  suggestedQuantity,
  priority = 'MEDIUM',
  reason = 'Stock replenishment',
  sourceType = 'MANUAL',
  sourceReference = null,
  supplierId = null,
  userId = null,
}, customDb = db) {
  const database = customDb || db;

  const reqQty = Number(requiredQuantity);
  const suggQty = Number(suggestedQuantity || requiredQuantity);
  if (!reqQty || reqQty <= 0) {
    throw new Error('Required quantity must be greater than zero');
  }

  const p = await database.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!p) throw new Error('Product not found');

  const w = await database.prepare(`SELECT id FROM warehouse WHERE id = ?`).get(warehouseId);
  if (!w) throw new Error('Warehouse not found');

  const reqCode = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const info = await database
    .prepare(
      `INSERT INTO procurement_requirement (
        requirement_code, product_id, warehouse_id, required_quantity, suggested_quantity,
        priority, reason, source_type, source_reference, supplier_id, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?) RETURNING id`
    )
    .run(
      reqCode,
      productId,
      warehouseId,
      reqQty,
      suggQty,
      priority.toUpperCase(),
      reason,
      sourceType.toUpperCase(),
      sourceReference ? String(sourceReference) : null,
      supplierId || null,
      userId || null
    );

  return await getProcurementRequirementById(info.lastInsertRowid, database);
}

/**
 * CONVERT Procurement Requirement to Vendor Purchase Order
 */
export async function createPoFromRequirement({
  requirementId,
  supplierId = null,
  orderQuantity = null,
  expectedDeliveryDate = null,
  notes = null,
  userId = null,
}, customDb = db) {
  const database = customDb || db;
  const reqId = Number(requirementId);
  const req = await database.prepare(`SELECT * FROM procurement_requirement WHERE id = ?`).get(reqId);
  if (!req) throw new Error('Procurement requirement not found');

  const sId = supplierId || req.supplier_id;
  if (!sId) throw new Error('Supplier company is required to issue a Purchase Order');

  const supplier = await database.prepare(`SELECT * FROM company WHERE id = ?`).get(sId);
  if (!supplier) throw new Error('Supplier company not found');

  const qty = Number(orderQuantity || req.suggested_quantity || req.required_quantity);
  if (!qty || qty <= 0) throw new Error('Order quantity must be greater than zero');

  return database.transaction(async () => {
    const defaultQuotation = await database.prepare(`SELECT id FROM quotation ORDER BY id ASC LIMIT 1`).get();
    const quotationId = defaultQuotation ? defaultQuotation.id : 1;

    const settings = await database.prepare(`SELECT po_prefix FROM company_settings WHERE id = 1`).get();
    const prefix = settings?.po_prefix || 'PO-';
    const poNumber = await nextNumber(prefix, 'purchase_order');

    const poInsert = await database
      .prepare(
        `INSERT INTO purchase_order (
          number, date, quotation_id, client_po_ref, status, supplier_id, procurement_requirement_id, received_quantity
         ) VALUES (?, CURRENT_DATE, ?, ?, 'ORDERED', ?, ?, 0) RETURNING id`
      )
      .run(poNumber, quotationId, notes || `Procurement Req #${req.requirement_code}`, sId, reqId);

    const poId = poInsert.lastInsertRowid;

    await database
      .prepare(
        `UPDATE procurement_requirement
         SET supplier_id = ?,
             purchase_order_id = ?,
             required_quantity = ?,
             suggested_quantity = ?,
             status = 'ORDERED',
             updated_at = NOW()
         WHERE id = ?`
      )
      .run(sId, poId, qty, qty, reqId);

    await database
      .prepare(
        `UPDATE inventory_stock
         SET incoming_quantity = COALESCE(incoming_quantity, 0) + ?,
             updated_at = NOW()
         WHERE warehouse_id = ? AND product_id = ?`
      )
      .run(qty, req.warehouse_id, req.product_id);

    return {
      success: true,
      poId,
      poNumber,
      requirementId: reqId,
      status: 'ORDERED',
    };
  });
}

/**
 * LIST Suppliers / Vendors
 */
export async function getSuppliers({ q = null, limit = 50, offset = 0 }, customDb = db) {
  const database = customDb || db;

  let sql = `SELECT * FROM company WHERE (is_supplier = 1 OR company_type = 'supplier')`;
  const params = [];

  if (q) {
    sql += ` AND (name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR email LIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }

  sql += ` ORDER BY id DESC`;

  const allRows = await database.prepare(sql).all(...params);
  const total = allRows.length;
  const paginated = allRows.slice(offset, offset + limit);

  const suppliers = await Promise.all(paginated.map(async (s) => {
    const poStats = await database
      .prepare(
        `SELECT
          COUNT(*) AS total_pos,
          COALESCE(SUM(q.total), 0) AS total_procurement_value,
          SUM(CASE WHEN po.status IN ('open', 'ORDERED', 'PARTIALLY_RECEIVED') THEN 1 ELSE 0 END) AS pending_orders
         FROM purchase_order po
         JOIN quotation q ON q.id = po.quotation_id
         WHERE po.supplier_id = ? OR q.company_id = ?`
      )
      .get(s.id, s.id);

    return {
      ...s,
      totalPos: poStats?.total_pos || 0,
      totalProcurementValue: poStats?.total_procurement_value || 0,
      pendingOrders: poStats?.pending_orders || 0,
    };
  }));

  return { suppliers, total, limit, offset };
}

/**
 * GET Supplier Detail by ID
 */
export async function getSupplierById(id, customDb = db) {
  const database = customDb || db;

  const supplier = await database.prepare(`SELECT * FROM company WHERE id = ?`).get(id);
  if (!supplier) return null;

  const purchaseOrders = await database
    .prepare(
      `SELECT po.*, q.number AS quotation_number, q.total, q.date AS quotation_date
       FROM purchase_order po
       JOIN quotation q ON q.id = po.quotation_id
       WHERE po.supplier_id = ? OR q.company_id = ?
       ORDER BY po.id DESC`
    )
    .all(id, id);

  const totalValue = purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
  const openOrders = purchaseOrders.filter((po) => ['open', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)).length;
  const completedOrders = purchaseOrders.filter((po) => ['received', 'RECEIVED'].includes(po.status)).length;

  return {
    supplier,
    purchaseOrders,
    summary: {
      totalPurchaseOrders: purchaseOrders.length,
      totalProcurementValue: totalValue,
      openOrders,
      completedOrders,
      pendingReceipts: openOrders,
    },
  };
}

/**
 * CREATE Supplier
 */
export async function createSupplier({ name, contact_person, contactPerson, phone, email, address, state, gstin, notes }, customDb = db) {
  const database = customDb || db;
  const supplierName = name ? String(name).trim() : '';
  if (!supplierName) {
    throw new Error('Company name is required');
  }

  const existing = await database.prepare(`SELECT id FROM company WHERE name = ?`).get(supplierName);
  if (existing) {
    await database.prepare(`UPDATE company SET is_supplier = 1, company_type = 'supplier' WHERE id = ?`).run(existing.id);
    return await getSupplierById(existing.id, database);
  }

  const info = await database
    .prepare(
      `INSERT INTO company (name, contact_person, phone, email, address, state, gstin, is_supplier, company_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'supplier') RETURNING id`
    )
    .run(
      supplierName,
      contact_person || contactPerson || null,
      phone || null,
      email || null,
      address || null,
      state || null,
      gstin || null
    );

  return await getSupplierById(info.lastInsertRowid, database);
}

/**
 * GET Incoming Procurement (Open POs with receivable quantities)
 */
export async function getIncomingProcurement({ q = null, supplierId = null, warehouseId = null, status = null, limit = 50, offset = 0 }, customDb = db) {
  const database = customDb || db;

  let sql = `
    SELECT
      po.id AS po_id,
      po.number AS po_number,
      po.date AS po_date,
      po.status AS po_status,
      po.received_quantity,
      q.id AS quotation_id,
      q.number AS quotation_number,
      q.total AS po_value,
      COALESCE(c.id, po.supplier_id) AS supplier_id,
      COALESCE(c.name, 'Default Supplier') AS supplier_name,
      COALESCE(qi.product_id, pr.product_id) AS product_id,
      COALESCE(p.part_no, pr_p.part_no, 'PROD-GEN') AS part_no,
      COALESCE(p.description, pr_p.description, 'Procurement Item') AS product_description,
      COALESCE(qi.qty, pr.suggested_quantity, pr.required_quantity, 100) AS ordered_quantity
    FROM purchase_order po
    LEFT JOIN quotation q ON q.id = po.quotation_id
    LEFT JOIN quotation_item qi ON qi.quotation_id = q.id
    LEFT JOIN company c ON c.id = COALESCE(po.supplier_id, q.company_id)
    LEFT JOIN product p ON p.id = qi.product_id
    LEFT JOIN procurement_requirement pr ON pr.purchase_order_id = po.id
    LEFT JOIN product pr_p ON pr_p.id = pr.product_id
    WHERE po.status IN ('open', 'ORDERED', 'PARTIALLY_RECEIVED')
  `;
  const params = [];

  if (supplierId) {
    sql += ` AND (c.id = ? OR po.supplier_id = ?)`;
    params.push(supplierId, supplierId);
  }
  if (q) {
    sql += ` AND (po.number LIKE ? OR c.name LIKE ? OR p.part_no LIKE ? OR p.description LIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }

  sql += ` ORDER BY po.id DESC`;

  const rows = await database.prepare(sql).all(...params);

  const items = rows.map((r) => {
    const received = Number(r.received_quantity || 0);
    const ordered = Number(r.ordered_quantity || 0);
    const pending = Math.max(0, ordered - received);

    return {
      ...r,
      receivedQuantity: received,
      pendingQuantity: pending,
    };
  });

  const total = items.length;
  const paginated = items.slice(offset, offset + limit);

  return { orders: paginated, queue: paginated, items: paginated, total, limit, offset };
}

/**
 * GET Receiving Queue (Operational queue for receiving stock)
 */
export async function getReceivingQueue({ warehouseId = null, limit = 50, offset = 0 }, customDb = db) {
  const res = await getIncomingProcurement({ warehouseId, limit, offset }, customDb);
  return { queue: res.orders, orders: res.orders, items: res.items, total: res.total, limit, offset };
}

/**
 * ATOMIC RECEIVE PO STOCK
 * Increments on_hand_quantity via recordStockIn while preventing receiveQty > remainingQty.
 */
export async function receivePoStock({
  poId,
  warehouseId,
  items,
  reference = null,
  notes = null,
  userId = null,
}, customDb = db) {
  const database = customDb || db;

  if (!poId) throw new Error('Purchase Order ID is required');
  if (!warehouseId) throw new Error('Warehouse ID is required');
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one item is required for stock receipt');

  const po = await database
    .prepare(
      `SELECT po.*, q.number AS quotation_number, q.id AS quotation_id
       FROM purchase_order po
       LEFT JOIN quotation q ON q.id = po.quotation_id
       WHERE po.id = ?`
    )
    .get(poId);

  if (!po) throw new Error('Purchase Order not found');
  if (['FULFILLED', 'CANCELLED', 'received', 'RECEIVED'].includes(po.status)) {
    throw new Error('This Purchase Order is already fulfilled or cancelled.');
  }

  const warehouse = await database.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');
  if (warehouse.is_active === 0 || warehouse.is_active === false) {
    throw new Error('Selected warehouse is not active');
  }

  return database.transaction(async () => {
    let totalReceivedInBatch = 0;
    const receiptsCreated = [];

    const receiptNumber = await nextNumber('REC', 'stock_receipt', 'receipt_number');

    const srInfo = await database
      .prepare(
        `INSERT INTO stock_receipt (
           warehouse_id, receipt_number, source_type, source_reference, status, notes, created_by, confirmed_at
         ) VALUES (?, ?, 'PURCHASE_ORDER', ?, 'CONFIRMED', ?, ?, NOW()) RETURNING id`
      )
      .run(
        warehouseId,
        receiptNumber,
        reference || po.number,
        notes || `Stock received for PO ${po.number}`,
        userId || null
      );

    const receiptId = srInfo.lastInsertRowid;

    for (const item of items) {
      const { productId, receiveQty, quantity } = item;
      const qty = Number(receiveQty !== undefined ? receiveQty : quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('Received quantity must be greater than zero');
      }

      let totalOrdered = 0;
      const req = await database.prepare(`SELECT required_quantity, suggested_quantity FROM procurement_requirement WHERE purchase_order_id = ?`).get(po.id);
      if (req) {
        totalOrdered = Number(req.suggested_quantity || req.required_quantity || 0);
      } else if (po.quotation_id) {
        const qItem = await database
          .prepare(`SELECT qty FROM quotation_item WHERE quotation_id = ? AND product_id = ?`)
          .get(po.quotation_id, productId);
        totalOrdered = Number(qItem?.qty || 0);
      }
      if (totalOrdered === 0) totalOrdered = 1000;

      const currentReceived = Number(po.received_quantity || 0);
      const remainingQty = Math.max(0, totalOrdered - currentReceived);

      if (qty > remainingQty) {
        throw new Error(`Exceeds remaining quantity. Requested: ${qty}, Remaining receivable quantity: ${remainingQty}`);
      }

      const stockInRes = await recordStockIn({
        warehouseId,
        productId,
        quantity: qty,
        referenceType: 'STOCK_RECEIPT',
        referenceId: String(receiptId),
        reason: `PO ${po.number} Stock Receipt`,
        userId,
      });

      await database
        .prepare(
          `INSERT INTO stock_receipt_item (
             receipt_id, product_id, quantity, before_on_hand, after_on_hand, notes
           ) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(
          receiptId,
          productId,
          qty,
          stockInRes.movement.before_on_hand,
          stockInRes.movement.after_on_hand,
          `PO ${po.number} receipt`
        );

      totalReceivedInBatch += qty;
      receiptsCreated.push(stockInRes);
    }

    if (totalReceivedInBatch === 0) {
      throw new Error('No valid positive quantities provided for receipt');
    }

    const newTotalReceived = Number(po.received_quantity || 0) + totalReceivedInBatch;

    let orderedTotal = 0;
    const req = await database.prepare(`SELECT required_quantity, suggested_quantity FROM procurement_requirement WHERE purchase_order_id = ?`).get(po.id);
    if (req) {
      orderedTotal = Number(req.suggested_quantity || req.required_quantity || 0);
    } else if (po.quotation_id) {
      orderedTotal = Number((await database
        .prepare(`SELECT SUM(qty) AS total_qty FROM quotation_item WHERE quotation_id = ?`)
        .get(po.quotation_id))?.total_qty || 0);
    }

    let newPoStatus = 'PARTIALLY_RECEIVED';
    if (orderedTotal > 0 && newTotalReceived >= orderedTotal) {
      newPoStatus = 'FULFILLED';
    } else if (orderedTotal === 0 && newTotalReceived > 0) {
      newPoStatus = 'FULFILLED';
    }

    await database
      .prepare(`UPDATE purchase_order SET received_quantity = ?, status = ? WHERE id = ?`)
      .run(newTotalReceived, newPoStatus, poId);

    await database
      .prepare(
        `UPDATE procurement_requirement
         SET status = ?, updated_at = NOW()
         WHERE purchase_order_id = ?`
      )
      .run(newPoStatus === 'FULFILLED' ? 'FULFILLED' : 'RECEIVING', poId);

    const updatedPo = await database.prepare(`SELECT * FROM purchase_order WHERE id = ?`).get(poId);
    const receipt = await database.prepare(`SELECT * FROM stock_receipt WHERE id = ?`).get(receiptId);

    return {
      po: updatedPo,
      poStatus: newPoStatus,
      stockReceipt: receipt,
      totalReceivedInBatch,
      receiptsCreated,
    };
  });
}

/**
 * GET Procurement Reports Data
 */
export async function getProcurementReportsData({ period = 'month', supplierId = null, productId = null, warehouseId = null } = {}, customDb = db) {
  const database = customDb || db;

  // By Supplier
  const bySupplier = await database
    .prepare(
      `SELECT c.id AS supplier_id, c.name AS supplier_name,
              COUNT(po.id) AS total_pos,
              COALESCE(SUM(q.total), 0) AS total_spend
       FROM company c
       JOIN purchase_order po ON po.supplier_id = c.id OR po.quotation_id IN (SELECT id FROM quotation WHERE company_id = c.id)
       JOIN quotation q ON q.id = po.quotation_id
       GROUP BY c.id
       ORDER BY total_spend DESC`
    )
    .all();

  // By Product
  const byProduct = await database
    .prepare(
      `SELECT p.id AS product_id, p.part_no, p.description,
              COALESCE(SUM(qi.qty), 0) AS total_ordered_qty,
              COALESCE(SUM(qi.amount), 0) AS total_spend
       FROM product p
       JOIN quotation_item qi ON qi.product_id = p.id
       JOIN purchase_order po ON po.quotation_id = qi.quotation_id
       GROUP BY p.id
       ORDER BY total_spend DESC`
    )
    .all();

  const totalProcurementSpend = bySupplier.reduce((s, row) => s + Number(row.total_spend || 0), 0);

  return {
    summary: {
      totalProcurementSpend,
      totalPurchaseOrders: bySupplier.reduce((s, row) => s + Number(row.total_pos || 0), 0),
      activeSuppliers: bySupplier.length,
    },
    bySupplier,
    byProduct,
  };
}

/**
 * GET Procurement Activity Stream
 */
export async function getProcurementActivity({ q = null, supplierId = null, docType = null, limit = 50, offset = 0 } = {}, customDb = db) {
  const database = customDb || db;

  let query = `
    SELECT * FROM (
      SELECT
        'REQUIREMENT' AS doc_type,
        pr.id AS doc_id,
        pr.requirement_code AS doc_number,
        p.part_no AS product_part,
        pr.status AS status,
        pr.created_at AS event_timestamp,
        'Procurement requirement created for ' || pr.required_quantity || ' units' AS description
      FROM procurement_requirement pr
      JOIN product p ON p.id = pr.product_id

      UNION ALL

      SELECT
        'STOCK_RECEIPT' AS doc_type,
        sr.id AS doc_id,
        sr.receipt_number AS doc_number,
        sr.source_reference AS product_part,
        sr.status AS status,
        sr.created_at AS event_timestamp,
        'Stock receipt recorded' AS description
      FROM stock_receipt sr
      WHERE sr.source_type = 'PURCHASE_ORDER'
    ) activity
    WHERE 1=1
  `;
  const params = [];

  if (q) {
    query += ` AND (doc_number LIKE ? OR description LIKE ? OR product_part LIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s);
  }

  query += ` ORDER BY event_timestamp DESC`;

  const allRows = await database.prepare(query).all(...params);
  const total = allRows.length;
  const paginated = allRows.slice(offset, offset + limit);

  return { activities: paginated, activity: paginated, total, limit, offset };
}
