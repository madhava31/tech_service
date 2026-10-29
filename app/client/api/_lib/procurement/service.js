import db from '../db/index.js';
import { recordStockIn } from '../inventory/service.js';
import { getNextReceiptNumber } from '../routes/inventory.js';

// Postgres port of the sound parts of the legacy SQLite procurement service
// (app/server/src/services/procurementService.js). Response shapes match app/client/src/api.ts.
//
// purchase_order holds customer purchase orders. A SUPPLIER purchase order is a row with
// supplier_id or procurement_requirement_id set; procurement only ever looks at those, so customer
// orders never appear as incoming stock. Unlike the legacy code nothing is invented: unknown
// suppliers, products or ordered quantities stay null, and receiving refuses quantities it cannot
// check against an ordered quantity. Values are estimated from product.default_price because
// supplier purchase orders carry no prices of their own.

const num = (v) => Number(v) || 0;
const OPEN_PO = ['open', 'ORDERED', 'PARTIALLY_RECEIVED'];
const RECEIVED_PO = ['received', 'RECEIVED', 'FULFILLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const SOURCE_TYPES = ['STOCK_INTELLIGENCE', 'RESTOCK_QUEUE', 'SALES_DEMAND', 'MANUAL'];
const STATUSES = ['OPEN', 'PARTIALLY_COVERED', 'ORDERED', 'RECEIVING', 'FULFILLED'];
const SUPPLIER_PO = `(po.supplier_id IS NOT NULL OR po.procurement_requirement_id IS NOT NULL)`;
const IS_SUPPLIER = `(c.is_supplier = 1 OR c.company_type = 'supplier')`;
// The requirement behind a supplier PO, linked from either side.
const PO_REQUIREMENT_JOIN = `LEFT JOIN procurement_requirement pr ON pr.id = po.procurement_requirement_id
                                OR (po.procurement_requirement_id IS NULL AND pr.purchase_order_id = po.id)`;

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const optionalInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function getProcurementOverview() {
  const [poStats, reqStats, supplierRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) FILTER (WHERE po.status = ANY(?::text[])) AS open_pos,
              COUNT(*) FILTER (WHERE po.status = ANY(?::text[])) AS fully_received_pos,
              COUNT(*) FILTER (WHERE po.status = 'PARTIALLY_RECEIVED') AS partially_received_pos,
              COALESCE(SUM(GREATEST(0, COALESCE(pr.suggested_quantity, pr.required_quantity) - COALESCE(po.received_quantity, 0)))
                       FILTER (WHERE po.status = ANY(?::text[])), 0) AS incoming_units,
              COALESCE(SUM(GREATEST(0, COALESCE(pr.suggested_quantity, pr.required_quantity) - COALESCE(po.received_quantity, 0)) * COALESCE(p.default_price, 0))
                       FILTER (WHERE po.status = ANY(?::text[])), 0) AS incoming_value,
              COALESCE(SUM(COALESCE(pr.suggested_quantity, pr.required_quantity) * COALESCE(p.default_price, 0)), 0) AS procurement_value
       FROM purchase_order po
       ${PO_REQUIREMENT_JOIN}
       LEFT JOIN product p ON p.id = pr.product_id
       WHERE ${SUPPLIER_PO}`
    ).get(OPEN_PO, RECEIVED_PO, OPEN_PO, OPEN_PO),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE status = 'OPEN') AS open_requirements FROM procurement_requirement`).get(),
    db.prepare(`SELECT COUNT(*) AS total FROM company c WHERE ${IS_SUPPLIER}`).get(),
  ]);
  const openPos = num(poStats.open_pos);
  return {
    kpis: {
      openPurchaseOrders: openPos,
      pendingSupplierOrders: openPos,
      ordersAwaitingReceipt: openPos,
      partiallyReceivedOrders: num(poStats.partially_received_pos),
      fullyReceivedOrders: num(poStats.fully_received_pos),
      pendingRequirements: num(reqStats.open_requirements),
      incomingUnits: num(poStats.incoming_units),
      incomingPurchaseValue: num(poStats.incoming_value),
      totalSuppliers: num(supplierRow.total),
      procurementValue: num(poStats.procurement_value),
    },
  };
}

/** Stock for (warehouse, product) pairs, keyed "warehouseId:productId". */
async function stockFor(pairs) {
  if (!pairs.length) return new Map();
  const rows = await db
    .prepare(
      `SELECT s.warehouse_id, s.product_id, s.on_hand_quantity, s.reserved_quantity, s.incoming_quantity,
              s.low_stock_threshold, s.critical_stock_threshold
       FROM inventory_stock s
       JOIN unnest(?::int[], ?::int[]) AS k(warehouse_id, product_id)
         ON k.warehouse_id = s.warehouse_id AND k.product_id = s.product_id`
    )
    .all(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
  return new Map(rows.map((r) => [`${r.warehouse_id}:${r.product_id}`, r]));
}

function withStock(r, s) {
  const onHand = num(s?.on_hand_quantity);
  const reserved = num(s?.reserved_quantity);
  return { ...r, onHand, reserved, available: Math.max(0, onHand - reserved), incoming: num(s?.incoming_quantity) };
}

const REQUIREMENT_SELECT = `
  SELECT pr.*, p.part_no, p.description AS product_description, p.unit, p.default_price, p.hsn_sac,
         w.name AS warehouse_name, w.code AS warehouse_code, w.address AS warehouse_address,
         c.name AS supplier_name, c.email AS supplier_email, c.phone AS supplier_phone,
         po.number AS po_number, po.date AS po_date, po.status AS po_status
  FROM procurement_requirement pr
  JOIN product p ON p.id = pr.product_id
  JOIN warehouse w ON w.id = pr.warehouse_id
  LEFT JOIN company c ON c.id = pr.supplier_id
  LEFT JOIN purchase_order po ON po.id = pr.purchase_order_id`;

export async function getProcurementRequirements({ q = null, priority = null, status = null, sourceType = null, warehouseId = null, limit = 50, offset = 0 } = {}) {
  let where = ` WHERE 1=1`;
  const params = [];
  if (optionalInt(warehouseId)) { where += ` AND pr.warehouse_id = ?`; params.push(optionalInt(warehouseId)); }
  if (priority) { where += ` AND pr.priority = ?`; params.push(String(priority).toUpperCase()); }
  if (status) { where += ` AND pr.status = ?`; params.push(String(status).toUpperCase()); }
  if (sourceType) { where += ` AND pr.source_type = ?`; params.push(String(sourceType).toUpperCase()); }
  if (q) {
    where += ` AND (pr.requirement_code ILIKE ? OR p.part_no ILIKE ? OR p.description ILIKE ? OR pr.reason ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }
  const countRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM procurement_requirement pr JOIN product p ON p.id = pr.product_id${where}`
  ).get(...params);
  const rows = await db.prepare(`${REQUIREMENT_SELECT}${where} ORDER BY pr.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const stock = await stockFor(rows.map((r) => [r.warehouse_id, r.product_id]));
  return {
    requirements: rows.map((r) => withStock(r, stock.get(`${r.warehouse_id}:${r.product_id}`))),
    total: num(countRow.n),
    limit,
    offset,
  };
}

export async function getProcurementRequirementById(id) {
  const reqId = optionalInt(id);
  if (!reqId) return null;
  const r = await db.prepare(`${REQUIREMENT_SELECT} WHERE pr.id = ?`).get(reqId);
  if (!r) return null;
  const s = (await stockFor([[r.warehouse_id, r.product_id]])).get(`${r.warehouse_id}:${r.product_id}`);
  return {
    requirement: {
      ...withStock(r, s),
      // inventory_stock defaults (10 / 5) when the product has no stock row in that warehouse yet
      reorderPoint: s ? num(s.low_stock_threshold) : 10,
      safetyStock: s ? num(s.critical_stock_threshold) : 5,
    },
  };
}

export async function createProcurementRequirement(data = {}, userContext = {}) {
  const productId = optionalInt(data.productId);
  const warehouseId = optionalInt(data.warehouseId);
  const requiredQuantity = Number(data.requiredQuantity);
  const suggestedQuantity = data.suggestedQuantity === undefined || data.suggestedQuantity === null || data.suggestedQuantity === ''
    ? requiredQuantity
    : Number(data.suggestedQuantity);
  const priority = String(data.priority || 'MEDIUM').toUpperCase();
  const sourceType = String(data.sourceType || 'MANUAL').toUpperCase();
  const supplierId = data.supplierId ? optionalInt(data.supplierId) : null;

  if (!productId) throw httpError(400, 'A product is required');
  if (!warehouseId) throw httpError(400, 'A warehouse is required');
  if (!(requiredQuantity > 0)) throw httpError(400, 'Required quantity must be greater than zero');
  if (!(suggestedQuantity > 0)) throw httpError(400, 'Suggested quantity must be greater than zero');
  if (!PRIORITIES.includes(priority)) throw httpError(400, `Priority must be one of: ${PRIORITIES.join(', ')}`);
  if (!SOURCE_TYPES.includes(sourceType)) throw httpError(400, `Source type must be one of: ${SOURCE_TYPES.join(', ')}`);
  if (data.supplierId && !supplierId) throw httpError(400, 'Invalid supplier');

  const [p, w, s] = await Promise.all([
    db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId),
    db.prepare(`SELECT id FROM warehouse WHERE id = ?`).get(warehouseId),
    supplierId ? db.prepare(`SELECT id FROM company WHERE id = ?`).get(supplierId) : null,
  ]);
  if (!p) throw httpError(404, 'Product not found');
  if (!w) throw httpError(404, 'Warehouse not found');
  if (supplierId && !s) throw httpError(404, 'Supplier not found');

  // The code is derived from the row id (taken from the sequence first), so it is unique without
  // the legacy random suffix that could collide with the UNIQUE constraint.
  const { id } = await db.prepare(`SELECT nextval(pg_get_serial_sequence('procurement_requirement', 'id')) AS id`).get();
  const code = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(id).padStart(5, '0')}`;
  await db.prepare(
    `INSERT INTO procurement_requirement (id, requirement_code, product_id, warehouse_id, required_quantity, suggested_quantity,
                                          priority, reason, source_type, source_reference, supplier_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`
  ).run(id, code, productId, warehouseId, requiredQuantity, suggestedQuantity, priority, data.reason || 'Stock replenishment',
    sourceType, data.sourceReference ? String(data.sourceReference) : null, supplierId, optionalInt(userContext?.id));
  return getProcurementRequirementById(id);
}

async function supplierPoStats(supplierIds) {
  if (!supplierIds.length) return new Map();
  const rows = await db
    .prepare(
      `SELECT po.supplier_id, COUNT(DISTINCT po.id) AS total_pos,
              COUNT(DISTINCT po.id) FILTER (WHERE po.status = ANY(?::text[])) AS pending_orders,
              COALESCE(SUM(COALESCE(pr.suggested_quantity, pr.required_quantity) * COALESCE(p.default_price, 0)), 0) AS value
       FROM purchase_order po
       ${PO_REQUIREMENT_JOIN}
       LEFT JOIN product p ON p.id = pr.product_id
       WHERE po.supplier_id = ANY(?::int[])
       GROUP BY po.supplier_id`
    )
    .all(OPEN_PO, supplierIds);
  return new Map(rows.map((r) => [r.supplier_id, r]));
}

export async function getSuppliers({ q = null, limit = 50, offset = 0 } = {}) {
  let where = ` WHERE ${IS_SUPPLIER}`;
  const params = [];
  if (q) {
    where += ` AND (c.name ILIKE ? OR c.contact_person ILIKE ? OR c.phone ILIKE ? OR c.email ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM company c${where}`).get(...params);
  const rows = await db.prepare(`SELECT c.* FROM company c${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const stats = await supplierPoStats(rows.map((r) => r.id));
  return {
    suppliers: rows.map((s) => {
      const st = stats.get(s.id);
      return { ...s, totalPos: num(st?.total_pos), totalProcurementValue: num(st?.value), pendingOrders: num(st?.pending_orders) };
    }),
    total: num(countRow.n),
    limit,
    offset,
  };
}

/** Supplier detail. Null unless the company exists and is marked as a supplier. */
export async function getSupplierById(id) {
  const sid = optionalInt(id);
  if (!sid) return null;
  const supplier = await db.prepare(`SELECT c.* FROM company c WHERE c.id = ? AND ${IS_SUPPLIER}`).get(sid);
  if (!supplier) return null;
  const purchaseOrders = await db
    .prepare(
      `SELECT po.*, pr.requirement_code, p.part_no, p.description AS product_description,
              COALESCE(pr.suggested_quantity, pr.required_quantity) AS ordered_quantity,
              COALESCE(pr.suggested_quantity, pr.required_quantity) * p.default_price AS estimated_value
       FROM purchase_order po
       ${PO_REQUIREMENT_JOIN}
       LEFT JOIN product p ON p.id = pr.product_id
       WHERE po.supplier_id = ?
       ORDER BY po.id DESC`
    )
    .all(sid);
  const openOrders = purchaseOrders.filter((po) => OPEN_PO.includes(po.status)).length;
  return {
    supplier,
    purchaseOrders,
    summary: {
      totalPurchaseOrders: purchaseOrders.length,
      totalProcurementValue: purchaseOrders.reduce((sum, po) => sum + num(po.estimated_value), 0),
      openOrders,
      completedOrders: purchaseOrders.filter((po) => RECEIVED_PO.includes(po.status)).length,
      pendingReceipts: openOrders,
    },
  };
}

/** Creates a supplier, or marks an existing company with the same name as a supplier. */
export async function createSupplier(data = {}) {
  const name = data.name ? String(data.name).trim() : '';
  if (!name) throw httpError(400, 'Company name is required');
  const existing = await db.prepare(`SELECT id FROM company WHERE LOWER(name) = LOWER(?) ORDER BY id LIMIT 1`).get(name);
  if (existing) {
    await db.prepare(`UPDATE company SET is_supplier = 1, company_type = 'supplier' WHERE id = ?`).run(existing.id);
    return getSupplierById(existing.id);
  }
  const created = await db
    .prepare(
      `INSERT INTO company (name, contact_person, phone, email, address, state, gstin, is_supplier, company_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'supplier') RETURNING id`
    )
    .get(name, data.contact_person || data.contactPerson || null, data.phone || null, data.email || null,
      data.address || null, data.state || null, data.gstin || null);
  return getSupplierById(created.id);
}

/** Open supplier purchase orders with what is still to be received. */
export async function getIncomingProcurement({ q = null, supplierId = null, warehouseId = null, status = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT po.id AS po_id, po.number AS po_number, po.date AS po_date, po.status AS po_status,
           COALESCE(po.received_quantity, 0) AS received_quantity,
           s.id AS supplier_id, s.name AS supplier_name,
           pr.id AS requirement_id, pr.requirement_code, pr.warehouse_id,
           p.id AS product_id, p.part_no, p.description AS product_description,
           COALESCE(pr.suggested_quantity, pr.required_quantity) AS ordered_quantity,
           COALESCE(pr.suggested_quantity, pr.required_quantity) * p.default_price AS po_value
    FROM purchase_order po
    ${PO_REQUIREMENT_JOIN}
    LEFT JOIN product p ON p.id = pr.product_id
    LEFT JOIN company s ON s.id = COALESCE(po.supplier_id, pr.supplier_id)
    WHERE ${SUPPLIER_PO} AND po.status = ANY(?::text[])`;
  const params = [status ? [String(status)] : OPEN_PO];
  if (optionalInt(supplierId)) { sql += ` AND s.id = ?`; params.push(optionalInt(supplierId)); }
  if (optionalInt(warehouseId)) { sql += ` AND pr.warehouse_id = ?`; params.push(optionalInt(warehouseId)); }
  if (q) {
    sql += ` AND (po.number ILIKE ? OR s.name ILIKE ? OR p.part_no ILIKE ? OR p.description ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }
  const rows = await db.prepare(`${sql} ORDER BY po.id DESC`).all(...params);
  const items = rows.map((r) => {
    const ordered = r.ordered_quantity === null ? null : num(r.ordered_quantity);
    const received = num(r.received_quantity);
    return { ...r, ordered_quantity: ordered, receivedQuantity: received, pendingQuantity: ordered === null ? null : Math.max(0, ordered - received) };
  });
  const page = items.slice(offset, offset + limit);
  return { orders: page, queue: page, items: page, total: items.length, limit, offset };
}

export async function getReceivingQueue({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const res = await getIncomingProcurement({ warehouseId, limit, offset });
  return { queue: res.orders, orders: res.orders, items: res.items, total: res.total, limit, offset };
}

/**
 * Receives stock against a supplier purchase order, atomically: one stock receipt, stock-in per
 * item, and the PO / requirement statuses. Only the requirement's product can be received, and never
 * more than the ordered quantity minus what earlier receipts for this PO already brought in.
 */
export async function receivePoStock({ poId, warehouseId, items, reference = null, notes = null } = {}, userContext = {}) {
  const pid = optionalInt(poId);
  const wid = optionalInt(warehouseId);
  if (!pid) throw httpError(400, 'Purchase Order ID is required');
  if (!wid) throw httpError(400, 'Warehouse ID is required');
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'At least one item is required for stock receipt');
  const lines = items.map((it) => ({ productId: optionalInt(it?.productId), qty: Number(it?.receiveQty ?? it?.quantity) }));
  if (lines.some((l) => !l.productId)) throw httpError(400, 'Each item needs a product');
  if (lines.some((l) => !(l.qty > 0))) throw httpError(400, 'Received quantity must be greater than zero');
  const userId = optionalInt(userContext?.id);

  return db.transaction(async () => {
    const po = await db.prepare(`SELECT * FROM purchase_order po WHERE po.id = ? FOR UPDATE`).get(pid);
    if (!po) throw httpError(404, 'Purchase Order not found');
    if (po.supplier_id === null && po.procurement_requirement_id === null) {
      throw httpError(400, 'This is a customer purchase order; stock can only be received against supplier purchase orders.');
    }
    if (!OPEN_PO.includes(po.status)) throw httpError(400, 'This Purchase Order is already fulfilled or cancelled.');

    const warehouse = await db.prepare(`SELECT id, is_active FROM warehouse WHERE id = ?`).get(wid);
    if (!warehouse) throw httpError(404, 'Warehouse not found');
    if (Number(warehouse.is_active) === 0) throw httpError(400, 'Selected warehouse is not active');

    const requirement = await db
      .prepare(`SELECT * FROM procurement_requirement pr WHERE pr.id = ? OR (?::int IS NULL AND pr.purchase_order_id = ?) ORDER BY pr.id LIMIT 1`)
      .get(po.procurement_requirement_id, po.procurement_requirement_id, po.id);
    if (!requirement) throw httpError(400, 'This purchase order has no procurement requirement, so the ordered quantity is unknown.');
    const ordered = num(requirement.suggested_quantity || requirement.required_quantity);

    const receivedRow = await db
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity), 0) AS received
         FROM stock_receipt_item sri JOIN stock_receipt sr ON sr.id = sri.receipt_id
         WHERE sr.source_type = 'PURCHASE_ORDER' AND sr.source_reference = ? AND sri.product_id = ? AND sr.status = 'CONFIRMED'`
      )
      .get(po.number, requirement.product_id);
    let remaining = Math.max(0, ordered - num(receivedRow.received));

    for (const line of lines) {
      if (line.productId !== requirement.product_id) throw httpError(400, 'Only the product on this purchase order can be received against it.');
      if (line.qty > remaining) {
        throw httpError(400, `Exceeds remaining quantity. Requested: ${line.qty}, remaining receivable quantity: ${remaining}`);
      }
      remaining -= line.qty;
    }

    const receiptNumber = await getNextReceiptNumber('REC');
    const receipt = await db
      .prepare(
        `INSERT INTO stock_receipt (warehouse_id, receipt_number, source_type, source_reference, status, notes, created_by, confirmed_at)
         VALUES (?, ?, 'PURCHASE_ORDER', ?, 'CONFIRMED', ?, ?, NOW()) RETURNING *`
      )
      .get(wid, receiptNumber, po.number, [reference, notes].filter(Boolean).join(' | ') || `Stock received for PO ${po.number}`, userId);

    const receiptsCreated = [];
    let totalReceivedInBatch = 0;
    for (const line of lines) {
      const stockIn = await recordStockIn({
        warehouseId: wid,
        productId: line.productId,
        quantity: line.qty,
        referenceType: 'STOCK_RECEIPT',
        referenceId: String(receipt.id),
        reason: `PO ${po.number} Stock Receipt`,
        userId,
      });
      await db.prepare(
        `INSERT INTO stock_receipt_item (receipt_id, product_id, quantity, before_on_hand, after_on_hand, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(receipt.id, line.productId, line.qty, stockIn.movement.before_on_hand, stockIn.movement.after_on_hand, `PO ${po.number} receipt`);
      totalReceivedInBatch += line.qty;
      receiptsCreated.push(stockIn);
    }

    const newTotalReceived = num(po.received_quantity) + totalReceivedInBatch;
    const newPoStatus = newTotalReceived >= ordered ? 'FULFILLED' : 'PARTIALLY_RECEIVED';
    const updatedPo = await db
      .prepare(`UPDATE purchase_order SET received_quantity = ?, status = ? WHERE id = ? RETURNING *`)
      .get(newTotalReceived, newPoStatus, pid);
    await db.prepare(`UPDATE procurement_requirement SET status = ?, updated_at = NOW() WHERE id = ?`)
      .run(newPoStatus === 'FULFILLED' ? 'FULFILLED' : 'RECEIVING', requirement.id);

    return { po: updatedPo, poStatus: newPoStatus, stockReceipt: receipt, totalReceivedInBatch, receiptsCreated };
  });
}

/** Ordered quantities and estimated spend per supplier and per product (supplier POs only). */
export async function getProcurementReportsData() {
  const [bySupplier, byProduct] = await Promise.all([
    db.prepare(
      `SELECT s.id AS supplier_id, s.name AS supplier_name, COUNT(DISTINCT po.id) AS total_pos,
              COALESCE(SUM(COALESCE(pr.suggested_quantity, pr.required_quantity) * COALESCE(p.default_price, 0)), 0) AS total_spend
       FROM purchase_order po
       ${PO_REQUIREMENT_JOIN}
       LEFT JOIN product p ON p.id = pr.product_id
       JOIN company s ON s.id = COALESCE(po.supplier_id, pr.supplier_id)
       WHERE ${SUPPLIER_PO}
       GROUP BY s.id
       ORDER BY total_spend DESC`
    ).all(),
    db.prepare(
      `SELECT p.id AS product_id, p.part_no, p.description,
              COALESCE(SUM(COALESCE(pr.suggested_quantity, pr.required_quantity)), 0) AS total_ordered_qty,
              COALESCE(SUM(COALESCE(pr.suggested_quantity, pr.required_quantity) * COALESCE(p.default_price, 0)), 0) AS total_spend
       FROM purchase_order po
       ${PO_REQUIREMENT_JOIN}
       JOIN product p ON p.id = pr.product_id
       WHERE ${SUPPLIER_PO}
       GROUP BY p.id
       ORDER BY total_spend DESC`
    ).all(),
  ]);
  const suppliers = bySupplier.map((r) => ({ ...r, total_pos: num(r.total_pos), total_spend: num(r.total_spend) }));
  const products = byProduct.map((r) => ({ ...r, total_ordered_qty: num(r.total_ordered_qty), total_spend: num(r.total_spend) }));
  return {
    summary: {
      totalProcurementSpend: suppliers.reduce((s, r) => s + r.total_spend, 0),
      totalPurchaseOrders: suppliers.reduce((s, r) => s + r.total_pos, 0),
      activeSuppliers: suppliers.length,
    },
    bySupplier: suppliers,
    byProduct: products,
  };
}

/** Requirements and purchase-order stock receipts, newest first. */
export async function getProcurementActivity({ q = null, docType = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT * FROM (
      SELECT 'REQUIREMENT' AS doc_type, pr.id AS doc_id, pr.requirement_code AS doc_number, p.part_no AS product_part,
             pr.status AS status, pr.created_at AS event_timestamp,
             'Procurement requirement created for ' || pr.required_quantity || ' units' AS description
      FROM procurement_requirement pr JOIN product p ON p.id = pr.product_id
      UNION ALL
      SELECT 'STOCK_RECEIPT', sr.id, sr.receipt_number, sr.source_reference, sr.status, sr.created_at, 'Stock receipt recorded'
      FROM stock_receipt sr WHERE sr.source_type = 'PURCHASE_ORDER'
    ) activity
    WHERE 1=1`;
  const params = [];
  if (docType) { sql += ` AND doc_type = ?`; params.push(String(docType).toUpperCase()); }
  if (q) {
    sql += ` AND (doc_number ILIKE ? OR description ILIKE ? OR product_part ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s);
  }
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM (${sql}) x`).get(...params);
  const rows = await db.prepare(`${sql} ORDER BY event_timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { activities: rows, activity: rows, total: num(countRow.n), limit, offset };
}
