// Postgres port of the inventory service from app/server/src/services/inventoryService.js.
// Response shapes match that service (and the client types in src/api.ts): movements and
// reservations are raw snake_case rows plus joined names; stock items and operations payloads
// are camelCase.
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { getUserTable } from '../db/inventorySchema.js';

const DEFAULT_LOW_THRESHOLD = 10;
const DEFAULT_CRITICAL_THRESHOLD = 5;

function num(v) {
  return Number(v) || 0;
}

function classify(available, lowThreshold, critThreshold) {
  if (available <= 0) return 'out_of_stock';
  if (available <= critThreshold) return 'critical';
  if (available <= lowThreshold) return 'low_stock';
  return 'healthy';
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function requireProduct(productId) {
  const product = await db.prepare(`SELECT id, part_no, description FROM product WHERE id = ?`).get(productId);
  if (!product) throw httpError(404, 'Product not found');
  return product;
}

async function requireWarehouse(warehouseId) {
  const warehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(warehouseId);
  if (!warehouse) throw httpError(404, 'Warehouse not found');
  return warehouse;
}

/**
 * Ensures an inventory_stock row exists for a product in a warehouse and returns it,
 * locked FOR UPDATE so concurrent stock moves inside a transaction serialize.
 */
export async function getOrCreateStockRow(warehouseId, productId) {
  await db
    .prepare(`
      INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, reserved_quantity, incoming_quantity)
      VALUES (?, ?, 0, 0, 0)
      ON CONFLICT (warehouse_id, product_id) DO NOTHING
    `)
    .run(warehouseId, productId);

  return db
    .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ? FOR UPDATE`)
    .get(warehouseId, productId);
}

async function insertMovement({
  warehouseId,
  productId,
  movementType,
  quantity,
  beforeOnHand,
  afterOnHand,
  beforeReserved,
  afterReserved,
  referenceType,
  referenceId,
  reason,
  userId,
}) {
  return db
    .prepare(`
      INSERT INTO inventory_movement (
        warehouse_id, product_id, movement_type, quantity,
        before_on_hand, after_on_hand, before_reserved, after_reserved,
        reference_type, reference_id, reason, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `)
    .get(
      warehouseId,
      productId,
      movementType,
      quantity,
      beforeOnHand,
      afterOnHand,
      beforeReserved,
      afterReserved,
      referenceType || null,
      referenceId != null && referenceId !== '' ? String(referenceId) : null,
      reason || null,
      userId || null
    );
}

async function setStock(warehouseId, productId, { onHand, reserved }) {
  return db
    .prepare(`
      UPDATE inventory_stock
      SET on_hand_quantity = ?, reserved_quantity = ?, updated_at = NOW()
      WHERE warehouse_id = ? AND product_id = ?
      RETURNING *
    `)
    .get(onHand, reserved, warehouseId, productId);
}

// ---------------------------------------------------------------------------
// Warehouses & stock summaries
// ---------------------------------------------------------------------------

export async function getWarehouses({ activeOnly = false } = {}) {
  const rows = await db
    .prepare(`
      SELECT
        w.*,
        COUNT(DISTINCT s.product_id) AS product_count,
        COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand
      FROM warehouse w
      LEFT JOIN inventory_stock s ON s.warehouse_id = w.id
      ${activeOnly ? 'WHERE w.is_active = 1' : ''}
      GROUP BY w.id
      ORDER BY w.is_default DESC, w.name ASC
    `)
    .all();
  return rows.map((r) => ({
    ...r,
    product_count: num(r.product_count),
    total_on_hand: num(r.total_on_hand),
  }));
}

/**
 * Aggregated stock per product (all warehouses, or one), with threshold-based status.
 */
export async function getStockSummary({
  warehouseId = null,
  lowStockOnly = false,
  status = null,
  q = null,
  limit = 50,
  offset = 0,
} = {}) {
  const joinParams = [];
  let joinSql = 'LEFT JOIN inventory_stock s ON s.product_id = p.id';
  if (warehouseId) {
    joinSql += ' AND s.warehouse_id = ?';
    joinParams.push(Number(warehouseId));
  }

  const whereParams = [];
  let whereSql = '';
  if (q) {
    whereSql = 'WHERE (p.part_no ILIKE ? OR p.description ILIKE ?)';
    whereParams.push(`%${q}%`, `%${q}%`);
  }

  const avail = '(COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0))';
  const low = `COALESCE(MAX(s.low_stock_threshold), ${DEFAULT_LOW_THRESHOLD})`;
  const crit = `COALESCE(MAX(s.critical_stock_threshold), ${DEFAULT_CRITICAL_THRESHOLD})`;
  let havingSql = '';
  if (status === 'out_of_stock') {
    havingSql = `HAVING ${avail} <= 0`;
  } else if (status === 'critical') {
    havingSql = `HAVING ${avail} > 0 AND ${avail} <= ${crit}`;
  } else if (status === 'low_stock' || lowStockOnly) {
    havingSql = `HAVING ${avail} > ${crit} AND ${avail} <= ${low}`;
  } else if (status === 'healthy') {
    havingSql = `HAVING ${avail} > ${low}`;
  }

  const params = [...joinParams, ...whereParams];

  const countRow = await db
    .prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT p.id
        FROM product p
        ${joinSql}
        ${whereSql}
        GROUP BY p.id
        ${havingSql}
      ) matched
    `)
    .get(...params);

  const rows = await db
    .prepare(`
      SELECT
        p.id AS product_id,
        p.part_no,
        p.description,
        p.hsn_sac,
        p.unit,
        COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
        COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
        COALESCE(SUM(s.incoming_quantity), 0) AS incoming_quantity,
        ${low} AS low_stock_threshold,
        ${crit} AS critical_stock_threshold,
        COUNT(DISTINCT s.warehouse_id) AS warehouse_count
      FROM product p
      ${joinSql}
      ${whereSql}
      GROUP BY p.id
      ${havingSql}
      ORDER BY p.part_no ASC
      LIMIT ? OFFSET ?
    `)
    .all(...params, Number(limit), Number(offset));

  const items = rows.map((r) => {
    const onHand = num(r.on_hand_quantity);
    const reserved = num(r.reserved_quantity);
    const available = Math.max(0, onHand - reserved);
    const lowThreshold = num(r.low_stock_threshold);
    const critThreshold = num(r.critical_stock_threshold);
    const stockStatus = classify(available, lowThreshold, critThreshold);

    return {
      productId: r.product_id,
      partNo: r.part_no,
      description: r.description,
      hsnSac: r.hsn_sac || '',
      unit: r.unit || 'Nos',
      onHandQuantity: onHand,
      reservedQuantity: reserved,
      incomingQuantity: num(r.incoming_quantity),
      availableQuantity: available,
      lowStockThreshold: lowThreshold,
      criticalStockThreshold: critThreshold,
      isLowStock: stockStatus === 'low_stock',
      isCriticalStock: stockStatus === 'critical',
      isOutOfStock: stockStatus === 'out_of_stock',
      status: stockStatus,
      warehouseCount: num(r.warehouse_count),
    };
  });

  return { items, total: num(countRow?.total), limit: Number(limit), offset: Number(offset) };
}

async function countStockHealth(warehouseId = null) {
  const params = [];
  let joinSql = 'LEFT JOIN inventory_stock s ON s.product_id = p.id';
  if (warehouseId) {
    joinSql += ' AND s.warehouse_id = ?';
    params.push(Number(warehouseId));
  }
  const rows = await db
    .prepare(`
      SELECT
        COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand,
        COALESCE(SUM(s.reserved_quantity), 0) AS reserved,
        COALESCE(MAX(s.low_stock_threshold), ${DEFAULT_LOW_THRESHOLD}) AS low_threshold,
        COALESCE(MAX(s.critical_stock_threshold), ${DEFAULT_CRITICAL_THRESHOLD}) AS crit_threshold
      FROM product p
      ${joinSql}
      GROUP BY p.id
    `)
    .all(...params);

  const counts = { trackedProducts: rows.length, healthyCount: 0, lowStockCount: 0, criticalStockCount: 0, outOfStockCount: 0 };
  for (const r of rows) {
    const status = classify(Math.max(0, num(r.on_hand) - num(r.reserved)), num(r.low_threshold), num(r.crit_threshold));
    if (status === 'out_of_stock') counts.outOfStockCount++;
    else if (status === 'critical') counts.criticalStockCount++;
    else if (status === 'low_stock') counts.lowStockCount++;
    else counts.healthyCount++;
  }
  return counts;
}

export async function getWarehouseById(id) {
  const warehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(id);
  if (!warehouse) return null;

  const [stats, stockRows, stockRes, movementsRes] = await Promise.all([
    db
      .prepare(`
        SELECT
          COUNT(DISTINCT product_id) AS product_count,
          COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
          COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
          COALESCE(SUM(incoming_quantity), 0) AS total_incoming
        FROM inventory_stock
        WHERE warehouse_id = ?
      `)
      .get(id),
    db
      .prepare(`
        SELECT on_hand_quantity, reserved_quantity, low_stock_threshold, critical_stock_threshold
        FROM inventory_stock
        WHERE warehouse_id = ?
      `)
      .all(id),
    getStockSummary({ warehouseId: id, limit: 100 }),
    getMovements({ warehouseId: id, limit: 25 }),
  ]);

  const counts = { healthyCount: 0, lowStockCount: 0, criticalStockCount: 0, outOfStockCount: 0 };
  for (const s of stockRows) {
    const status = classify(
      Math.max(0, num(s.on_hand_quantity) - num(s.reserved_quantity)),
      s.low_stock_threshold ?? DEFAULT_LOW_THRESHOLD,
      s.critical_stock_threshold ?? DEFAULT_CRITICAL_THRESHOLD
    );
    if (status === 'out_of_stock') counts.outOfStockCount++;
    else if (status === 'critical') counts.criticalStockCount++;
    else if (status === 'low_stock') counts.lowStockCount++;
    else counts.healthyCount++;
  }

  const totalOnHand = num(stats?.total_on_hand);
  const totalReserved = num(stats?.total_reserved);
  const metrics = {
    productCount: num(stats?.product_count),
    totalOnHand,
    totalReserved,
    totalAvailable: Math.max(0, totalOnHand - totalReserved),
    totalIncoming: num(stats?.total_incoming),
    ...counts,
  };

  return {
    ...warehouse,
    metrics,
    summary: metrics,
    stock: stockRes.items,
    recentMovements: movementsRes.movements,
  };
}

export async function getInventoryOverview() {
  const [warehouses, stats, health, recentMovementsRes, lowStockRes] = await Promise.all([
    getWarehouses(),
    db
      .prepare(`
        SELECT
          COUNT(DISTINCT product_id) AS products_with_inventory,
          COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
          COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
          COALESCE(SUM(incoming_quantity), 0) AS total_incoming
        FROM inventory_stock
      `)
      .get(),
    countStockHealth(),
    getMovements({ limit: 10 }),
    getStockSummary({ lowStockOnly: true, limit: 10 }),
  ]);

  const totalOnHand = num(stats?.total_on_hand);
  const totalReserved = num(stats?.total_reserved);
  const totalAvailable = Math.max(0, totalOnHand - totalReserved);
  const totalIncoming = num(stats?.total_incoming);
  const activeWarehouses = warehouses.filter((w) => Number(w.is_active) === 1).length;

  return {
    metrics: {
      totalWarehouses: warehouses.length,
      activeWarehouses,
      totalTrackedProducts: health.trackedProducts,
      productsWithStock: num(stats?.products_with_inventory),
      totalOnHandQuantity: totalOnHand,
      totalReservedQuantity: totalReserved,
      totalAvailableQuantity: totalAvailable,
      totalIncomingQuantity: totalIncoming,
      healthyCount: health.healthyCount,
      lowStockCount: health.lowStockCount,
      criticalStockCount: health.criticalStockCount,
      outOfStockCount: health.outOfStockCount,
    },
    warehouseCount: activeWarehouses,
    productsWithInventory: num(stats?.products_with_inventory),
    totalProducts: health.trackedProducts,
    totalOnHand,
    totalReserved,
    totalAvailable,
    totalIncoming,
    warehouses,
    recentMovements: recentMovementsRes.movements,
    lowStockItems: lowStockRes.items,
  };
}

// ---------------------------------------------------------------------------
// Movements & reservations (ledger queries)
// ---------------------------------------------------------------------------

function movementWithAliases(m) {
  return {
    ...m,
    quantity: num(m.quantity),
    before_on_hand: num(m.before_on_hand),
    after_on_hand: num(m.after_on_hand),
    before_reserved: num(m.before_reserved),
    after_reserved: num(m.after_reserved),
    // camelCase aliases for older screens that read these names
    warehouseId: m.warehouse_id,
    warehouseName: m.warehouse_name || '',
    productId: m.product_id,
    partNo: m.part_no || '',
    description: m.product_description || '',
    movementType: m.movement_type,
    referenceType: m.reference_type || '',
    referenceId: m.reference_id || '',
    createdAt: m.created_at,
  };
}

function reservationWithAliases(r) {
  return {
    ...r,
    quantity: num(r.quantity),
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name || '',
    productId: r.product_id,
    partNo: r.part_no || '',
    description: r.product_description || '',
    referenceType: r.reference_type || '',
    referenceId: r.reference_id || '',
    createdAt: r.created_at,
  };
}

export async function getMovements({
  warehouseId = null,
  productId = null,
  movementType = null,
  referenceType = null,
  referenceId = null,
  limit = 50,
  offset = 0,
} = {}) {
  const userTable = await getUserTable();
  const conditions = [];
  const params = [];

  if (warehouseId) {
    conditions.push('m.warehouse_id = ?');
    params.push(Number(warehouseId));
  }
  if (productId) {
    conditions.push('m.product_id = ?');
    params.push(Number(productId));
  }
  if (movementType) {
    conditions.push('m.movement_type = ?');
    params.push(movementType);
  }
  if (referenceType) {
    conditions.push('m.reference_type = ?');
    params.push(referenceType);
  }
  if (referenceId) {
    conditions.push('m.reference_id = ?');
    params.push(String(referenceId));
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM inventory_movement m ${whereSql}`).get(...params),
    db
      .prepare(`
        SELECT
          m.*,
          w.name AS warehouse_name,
          w.code AS warehouse_code,
          p.part_no,
          p.description AS product_description,
          p.unit,
          u.username AS created_by_username
        FROM inventory_movement m
        JOIN warehouse w ON w.id = m.warehouse_id
        JOIN product p ON p.id = m.product_id
        LEFT JOIN ${userTable} u ON u.id = m.created_by
        ${whereSql}
        ORDER BY m.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, Number(limit), Number(offset)),
  ]);

  return { movements: rows.map(movementWithAliases), total: num(countRow?.total), limit: Number(limit), offset: Number(offset) };
}

export async function getReservations({ warehouseId = null, productId = null, status = null, limit = 50, offset = 0 } = {}) {
  const userTable = await getUserTable();
  const conditions = [];
  const params = [];

  if (warehouseId) {
    conditions.push('r.warehouse_id = ?');
    params.push(Number(warehouseId));
  }
  if (productId) {
    conditions.push('r.product_id = ?');
    params.push(Number(productId));
  }
  if (status) {
    conditions.push('r.status = ?');
    params.push(String(status).toUpperCase());
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM stock_reservation r ${whereSql}`).get(...params),
    db
      .prepare(`
        SELECT
          r.*,
          w.name AS warehouse_name,
          w.code AS warehouse_code,
          p.part_no,
          p.description AS product_description,
          s.on_hand_quantity,
          s.reserved_quantity,
          u.username AS reserved_by_username
        FROM stock_reservation r
        JOIN warehouse w ON w.id = r.warehouse_id
        JOIN product p ON p.id = r.product_id
        LEFT JOIN inventory_stock s ON s.warehouse_id = r.warehouse_id AND s.product_id = r.product_id
        LEFT JOIN ${userTable} u ON u.id = r.reserved_by
        ${whereSql}
        ORDER BY r.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, Number(limit), Number(offset)),
  ]);

  return { reservations: rows.map(reservationWithAliases), total: num(countRow?.total), limit: Number(limit), offset: Number(offset) };
}

export async function getReservationById(id) {
  const userTable = await getUserTable();
  const reservation = await db
    .prepare(`
      SELECT
        r.*,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        w.address AS warehouse_address,
        p.part_no,
        p.description AS product_description,
        p.unit,
        p.hsn_sac,
        u.username AS reserved_by_username
      FROM stock_reservation r
      JOIN warehouse w ON w.id = r.warehouse_id
      JOIN product p ON p.id = r.product_id
      LEFT JOIN ${userTable} u ON u.id = r.reserved_by
      WHERE r.id = ?
    `)
    .get(id);
  if (!reservation) return null;

  const [stock, movements] = await Promise.all([
    db
      .prepare(`SELECT on_hand_quantity, reserved_quantity FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(reservation.warehouse_id, reservation.product_id),
    db
      .prepare(`
        SELECT m.*, u.username AS created_by_username
        FROM inventory_movement m
        LEFT JOIN ${userTable} u ON u.id = m.created_by
        WHERE m.warehouse_id = ? AND m.product_id = ? AND m.reference_type = ? AND m.reference_id = ?
        ORDER BY m.id DESC
      `)
      .all(
        reservation.warehouse_id,
        reservation.product_id,
        reservation.reference_type || 'RESERVATION_FULFILL',
        reservation.reference_id || String(id)
      ),
  ]);

  const onHand = num(stock?.on_hand_quantity);
  const reserved = num(stock?.reserved_quantity);
  return {
    ...reservationWithAliases(reservation),
    stock: { onHand, reserved, available: Math.max(0, onHand - reserved) },
    movements: movements.map(movementWithAliases),
  };
}

// ---------------------------------------------------------------------------
// Stock-changing operations (each runs in one transaction)
// ---------------------------------------------------------------------------

function positiveQty(quantity, message = 'Quantity must be greater than zero') {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, message);
  return qty;
}

export async function recordStockIn({
  warehouseId,
  productId,
  quantity,
  referenceType = 'STOCK_RECEIPT',
  referenceId = null,
  reason = 'Stock Inward',
  userId = null,
  movementType = 'STOCK_IN',
}) {
  const qty = positiveQty(quantity);
  await requireProduct(productId);
  await requireWarehouse(warehouseId);

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    const afterOnHand = beforeOnHand + qty;

    const stock = await setStock(warehouseId, productId, { onHand: afterOnHand, reserved: beforeReserved });
    const movement = await insertMovement({
      warehouseId,
      productId,
      movementType,
      quantity: qty,
      beforeOnHand,
      afterOnHand,
      beforeReserved,
      afterReserved: beforeReserved,
      referenceType,
      referenceId,
      reason,
      userId,
    });
    return { stock, movement };
  });
}

export async function recordStockOut({
  warehouseId,
  productId,
  quantity,
  referenceType = 'STOCK_ISSUE',
  referenceId = null,
  reason = 'Stock Outward',
  userId = null,
}) {
  const qty = positiveQty(quantity);
  await requireProduct(productId);
  await requireWarehouse(warehouseId);

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    const available = beforeOnHand - beforeReserved;
    if (qty > available) {
      throw httpError(400, `Insufficient available stock. Requested: ${qty}, Available: ${available}`);
    }

    const afterOnHand = beforeOnHand - qty;
    const stock = await setStock(warehouseId, productId, { onHand: afterOnHand, reserved: beforeReserved });
    const movement = await insertMovement({
      warehouseId,
      productId,
      movementType: 'STOCK_OUT',
      quantity: qty,
      beforeOnHand,
      afterOnHand,
      beforeReserved,
      afterReserved: beforeReserved,
      referenceType,
      referenceId,
      reason,
      userId,
    });
    return { stock, movement };
  });
}

/**
 * Sets on-hand to an absolute value (opening stock / physical count). Cannot go below reserved.
 */
export async function adjustStock({
  warehouseId,
  productId,
  newOnHandQuantity,
  reason = 'Inventory Adjustment',
  referenceType = 'MANUAL_ADJUSTMENT',
  referenceId = null,
  userId = null,
}) {
  const targetOnHand = Number(newOnHandQuantity);
  if (!Number.isFinite(targetOnHand) || targetOnHand < 0) {
    throw httpError(400, 'New on-hand quantity cannot be negative');
  }
  await requireProduct(productId);
  await requireWarehouse(warehouseId);

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    if (targetOnHand < beforeReserved) {
      throw httpError(400, `Cannot adjust on-hand stock below reserved quantity (${beforeReserved})`);
    }

    const delta = targetOnHand - beforeOnHand;
    if (delta === 0) return { stock: current, movement: null };

    const isOpening =
      beforeOnHand === 0 && (String(reason).toLowerCase().includes('opening') || String(referenceType).includes('OPENING'));

    const stock = await setStock(warehouseId, productId, { onHand: targetOnHand, reserved: beforeReserved });
    const movement = await insertMovement({
      warehouseId,
      productId,
      movementType: isOpening ? 'OPENING_STOCK' : 'ADJUSTMENT',
      quantity: Math.abs(delta),
      beforeOnHand,
      afterOnHand: targetOnHand,
      beforeReserved,
      afterReserved: beforeReserved,
      referenceType,
      referenceId,
      reason,
      userId,
    });
    return { stock, movement };
  });
}

/**
 * Adjusts on-hand up or down by a quantity (Operations > Adjustments).
 */
export async function createStockAdjustment({
  warehouseId,
  productId,
  direction,
  quantity,
  reason = 'Manual Stock Adjustment',
  notes = '',
  userId = null,
}) {
  const qty = positiveQty(quantity);
  const dir = String(direction || '').toUpperCase();
  if (dir !== 'INCREASE' && dir !== 'DECREASE') {
    throw httpError(400, "Direction must be either 'INCREASE' or 'DECREASE'");
  }
  await requireProduct(productId);
  await requireWarehouse(warehouseId);

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    const targetOnHand = dir === 'INCREASE' ? beforeOnHand + qty : beforeOnHand - qty;

    if (targetOnHand < 0) {
      throw httpError(400, `Stock adjustment would result in negative on-hand quantity (${targetOnHand})`);
    }
    if (targetOnHand < beforeReserved) {
      throw httpError(
        400,
        `Cannot adjust on-hand stock below reserved quantity (${beforeReserved}). Available: ${Math.max(0, beforeOnHand - beforeReserved)}`
      );
    }

    const stock = await setStock(warehouseId, productId, { onHand: targetOnHand, reserved: beforeReserved });
    const movement = await insertMovement({
      warehouseId,
      productId,
      movementType: 'ADJUSTMENT',
      quantity: qty,
      beforeOnHand,
      afterOnHand: targetOnHand,
      beforeReserved,
      afterReserved: beforeReserved,
      referenceType: 'STOCK_ADJUSTMENT',
      referenceId: null,
      reason: notes ? `${reason} - ${notes}` : reason,
      userId,
    });
    return { stock, movement };
  });
}

export async function recordReturn({
  warehouseId,
  productId,
  quantity,
  referenceType = 'RETURN',
  referenceId = null,
  reason = 'Customer Return',
  notes = '',
  userId = null,
}) {
  positiveQty(quantity, 'Return quantity must be greater than zero');
  return recordStockIn({
    warehouseId,
    productId,
    quantity,
    referenceType,
    referenceId,
    reason: notes ? `${reason} - ${notes}` : reason,
    userId,
    movementType: 'RETURN',
  });
}

export async function reserveStock({
  warehouseId,
  productId,
  quantity,
  referenceType = 'QUOTATION',
  referenceId = null,
  notes = '',
  userId = null,
}) {
  const qty = positiveQty(quantity, 'Reservation quantity must be greater than zero');
  await requireProduct(productId);
  await requireWarehouse(warehouseId);

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    const available = beforeOnHand - beforeReserved;
    if (qty > available) {
      throw httpError(400, `Insufficient available stock to reserve. Requested: ${qty}, Available: ${available}`);
    }

    const stock = await setStock(warehouseId, productId, { onHand: beforeOnHand, reserved: beforeReserved + qty });
    const reservation = await db
      .prepare(`
        INSERT INTO stock_reservation (warehouse_id, product_id, quantity, status, reference_type, reference_id, notes, reserved_by)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
        RETURNING *
      `)
      .get(
        warehouseId,
        productId,
        qty,
        referenceType || null,
        referenceId != null && referenceId !== '' ? String(referenceId) : null,
        notes || null,
        userId || null
      );
    return { reservation, stock };
  });
}

async function lockActiveReservation(reservationId, action) {
  const reservation = await db.prepare(`SELECT * FROM stock_reservation WHERE id = ? FOR UPDATE`).get(reservationId);
  if (!reservation) throw httpError(404, 'Reservation not found');
  if (reservation.status !== 'ACTIVE') {
    throw httpError(400, `Cannot ${action} reservation with status: ${reservation.status}`);
  }
  return reservation;
}

export async function releaseReservation({ reservationId }) {
  return db.transaction(async () => {
    const reservation = await lockActiveReservation(reservationId, 'release');
    const current = await getOrCreateStockRow(reservation.warehouse_id, reservation.product_id);
    const afterReserved = Math.max(0, num(current.reserved_quantity) - num(reservation.quantity));

    const stock = await setStock(reservation.warehouse_id, reservation.product_id, {
      onHand: num(current.on_hand_quantity),
      reserved: afterReserved,
    });
    const updated = await db
      .prepare(`UPDATE stock_reservation SET status = 'RELEASED', released_at = NOW() WHERE id = ? RETURNING *`)
      .get(reservationId);
    return { reservation: updated, stock };
  });
}

export async function fulfillReservation({ reservationId, userId = null }) {
  return db.transaction(async () => {
    const reservation = await lockActiveReservation(reservationId, 'fulfill');
    const qty = num(reservation.quantity);
    const current = await getOrCreateStockRow(reservation.warehouse_id, reservation.product_id);
    const beforeOnHand = num(current.on_hand_quantity);
    const beforeReserved = num(current.reserved_quantity);
    if (qty > beforeOnHand) {
      throw httpError(400, `Insufficient on-hand stock to fulfill reservation. Required: ${qty}, On Hand: ${beforeOnHand}`);
    }

    const afterOnHand = beforeOnHand - qty;
    const afterReserved = Math.max(0, beforeReserved - qty);
    const stock = await setStock(reservation.warehouse_id, reservation.product_id, { onHand: afterOnHand, reserved: afterReserved });
    const updated = await db
      .prepare(`UPDATE stock_reservation SET status = 'FULFILLED', fulfilled_at = NOW() WHERE id = ? RETURNING *`)
      .get(reservationId);
    const movement = await insertMovement({
      warehouseId: reservation.warehouse_id,
      productId: reservation.product_id,
      movementType: 'STOCK_OUT',
      quantity: qty,
      beforeOnHand,
      afterOnHand,
      beforeReserved,
      afterReserved,
      referenceType: reservation.reference_type || 'RESERVATION_FULFILL',
      referenceId: reservation.reference_id || String(reservationId),
      reason: 'Reservation fulfilled and stock issued',
      userId,
    });
    return { reservation: updated, stock, movement };
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

async function nextTransferNumber() {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyTag = `${String(fyStartYear).slice(2)}${String(fyStartYear + 1).slice(2)}`;
  const row = await db
    .prepare(`SELECT transfer_number FROM stock_transfer WHERE transfer_number LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`TRF${fyTag}/%`);

  let nextSeq = 1;
  if (row?.transfer_number) {
    const lastSeq = parseInt(row.transfer_number.split('/').pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }
  return `TRF${fyTag}/${nextSeq}`;
}

function formatTransfer(r) {
  return {
    id: r.id,
    transferNumber: r.transfer_number,
    sourceWarehouseId: r.source_warehouse_id,
    sourceWarehouseName: r.source_warehouse_name,
    sourceWarehouseCode: r.source_warehouse_code,
    destinationWarehouseId: r.destination_warehouse_id,
    destinationWarehouseName: r.destination_warehouse_name,
    destinationWarehouseCode: r.destination_warehouse_code,
    productId: r.product_id,
    partNumber: r.part_no,
    productDescription: r.product_description,
    productUnit: r.product_unit || 'Nos',
    quantity: num(r.quantity),
    status: r.status,
    reference: r.reference,
    notes: r.notes,
    sourceBeforeOnHand: num(r.source_before_on_hand),
    sourceAfterOnHand: num(r.source_after_on_hand),
    destBeforeOnHand: num(r.dest_before_on_hand),
    destAfterOnHand: num(r.dest_after_on_hand),
    createdBy: r.created_by_username || 'System',
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

async function transferSelectSql() {
  const userTable = await getUserTable();
  return `
    SELECT
      t.*,
      src.name AS source_warehouse_name,
      src.code AS source_warehouse_code,
      dest.name AS destination_warehouse_name,
      dest.code AS destination_warehouse_code,
      p.part_no,
      p.description AS product_description,
      p.unit AS product_unit,
      u.username AS created_by_username
    FROM stock_transfer t
    JOIN warehouse src ON src.id = t.source_warehouse_id
    JOIN warehouse dest ON dest.id = t.destination_warehouse_id
    JOIN product p ON p.id = t.product_id
    LEFT JOIN ${userTable} u ON u.id = t.created_by
  `;
}

export async function getStockTransfers({ warehouseId = null, status = null, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (warehouseId) {
    conditions.push('(t.source_warehouse_id = ? OR t.destination_warehouse_id = ?)');
    params.push(Number(warehouseId), Number(warehouseId));
  }
  if (status) {
    conditions.push('t.status = ?');
    params.push(String(status).toUpperCase());
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM stock_transfer t ${whereSql}`).get(...params),
    db
      .prepare(`${await transferSelectSql()} ${whereSql} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...params, Number(limit), Number(offset)),
  ]);

  return { transfers: rows.map(formatTransfer), total: num(countRow?.total), limit: Number(limit), offset: Number(offset) };
}

export async function getTransferById(id) {
  const r = await db.prepare(`${await transferSelectSql()} WHERE t.id = ?`).get(id);
  if (!r) return null;

  const movements = await db
    .prepare(`
      SELECT m.*, w.name AS warehouse_name
      FROM inventory_movement m
      JOIN warehouse w ON w.id = m.warehouse_id
      WHERE m.reference_type = 'STOCK_TRANSFER' AND m.reference_id = ?
      ORDER BY m.id ASC
    `)
    .all(r.transfer_number);

  return { ...formatTransfer(r), movements: movements.map(movementWithAliases) };
}

export async function createStockTransfer({
  sourceWarehouseId,
  destinationWarehouseId,
  productId,
  quantity,
  reference = '',
  notes = '',
  userId = null,
}) {
  const qty = positiveQty(quantity);
  const srcId = Number(sourceWarehouseId);
  const destId = Number(destinationWarehouseId);
  if (!srcId || !destId) throw httpError(400, 'Source warehouse and destination warehouse are required');
  if (srcId === destId) throw httpError(400, 'Source and destination warehouses cannot be the same');

  await requireProduct(productId);
  const srcWarehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(srcId);
  if (!srcWarehouse) throw httpError(404, 'Source warehouse not found');
  const destWarehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(destId);
  if (!destWarehouse) throw httpError(404, 'Destination warehouse not found');

  const transferId = await db.transaction(async () => {
    // Lock both rows in a stable order so two opposite transfers can't deadlock.
    const [firstId, secondId] = srcId < destId ? [srcId, destId] : [destId, srcId];
    const first = await getOrCreateStockRow(firstId, productId);
    const second = await getOrCreateStockRow(secondId, productId);
    const srcStock = firstId === srcId ? first : second;
    const destStock = firstId === srcId ? second : first;

    const srcBeforeOnHand = num(srcStock.on_hand_quantity);
    const srcBeforeReserved = num(srcStock.reserved_quantity);
    const srcAvailable = srcBeforeOnHand - srcBeforeReserved;
    if (qty > srcAvailable) {
      throw httpError(
        400,
        `Insufficient available stock in source warehouse (${srcWarehouse.name}). Requested: ${qty}, Available: ${srcAvailable}`
      );
    }
    const srcAfterOnHand = srcBeforeOnHand - qty;
    const destBeforeOnHand = num(destStock.on_hand_quantity);
    const destBeforeReserved = num(destStock.reserved_quantity);
    const destAfterOnHand = destBeforeOnHand + qty;

    await setStock(srcId, productId, { onHand: srcAfterOnHand, reserved: srcBeforeReserved });
    await setStock(destId, productId, { onHand: destAfterOnHand, reserved: destBeforeReserved });

    const transferNumber = await nextTransferNumber();
    const inserted = await db
      .prepare(`
        INSERT INTO stock_transfer (
          transfer_number, source_warehouse_id, destination_warehouse_id, product_id,
          quantity, status, reference, notes,
          source_before_on_hand, source_after_on_hand,
          dest_before_on_hand, dest_after_on_hand,
          created_by, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, NOW())
        RETURNING id
      `)
      .get(
        transferNumber,
        srcId,
        destId,
        productId,
        qty,
        reference || null,
        notes || null,
        srcBeforeOnHand,
        srcAfterOnHand,
        destBeforeOnHand,
        destAfterOnHand,
        userId || null
      );

    await insertMovement({
      warehouseId: srcId,
      productId,
      movementType: 'TRANSFER_OUT',
      quantity: qty,
      beforeOnHand: srcBeforeOnHand,
      afterOnHand: srcAfterOnHand,
      beforeReserved: srcBeforeReserved,
      afterReserved: srcBeforeReserved,
      referenceType: 'STOCK_TRANSFER',
      referenceId: transferNumber,
      reason: `Transfer to ${destWarehouse.name} (${destWarehouse.code})`,
      userId,
    });
    await insertMovement({
      warehouseId: destId,
      productId,
      movementType: 'TRANSFER_IN',
      quantity: qty,
      beforeOnHand: destBeforeOnHand,
      afterOnHand: destAfterOnHand,
      beforeReserved: destBeforeReserved,
      afterReserved: destBeforeReserved,
      referenceType: 'STOCK_TRANSFER',
      referenceId: transferNumber,
      reason: `Transfer from ${srcWarehouse.name} (${srcWarehouse.code})`,
      userId,
    });

    return inserted.id;
  });

  return getTransferById(transferId);
}

// ---------------------------------------------------------------------------
// Excel stock inward (analyze + preview)
// ---------------------------------------------------------------------------

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('result' in value) return value.result == null ? '' : String(value.result);
    if (value.richText) return value.richText.map((t) => t.text).join('');
    if (value.text) return String(value.text);
  }
  return String(value);
}

export async function analyzeExcelStockWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length === 0) throw httpError(400, 'The uploaded workbook contains no worksheets');

  const partNoRegex = /^(part[_\s-]?no|part[_\s-]?number|sku|item[_\s-]?code|product[_\s-]?code|model[_\s-]?no|part|partno|partnumber)$/i;
  const qtyRegex = /^(qty|quantity|received[_\s-]?qty|stock|units|count|inward[_\s-]?qty|received)$/i;
  const notesRegex = /^(notes?|remarks?|comments?|reference|ref|challan[_\s-]?no)$/i;

  let suggestedPartNoColumn = null;
  let suggestedQuantityColumn = null;
  let suggestedNotesColumn = null;
  const sheets = [];

  for (const sheet of workbook.worksheets) {
    let headerRowNumber = 0;
    let headers = [];

    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const values = [];
      sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
        const val = cellText(cell.value).trim();
        if (val) values.push(val);
      });
      if (values.length >= 2) {
        headerRowNumber = r;
        headers = values;
        break;
      }
    }
    if (!headerRowNumber && sheet.rowCount > 0) {
      headerRowNumber = 1;
      sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => headers.push(cellText(cell.value).trim()));
    }

    for (const h of headers) {
      if (!suggestedPartNoColumn && partNoRegex.test(h)) suggestedPartNoColumn = h;
      if (!suggestedQuantityColumn && qtyRegex.test(h)) suggestedQuantityColumn = h;
      if (!suggestedNotesColumn && notesRegex.test(h)) suggestedNotesColumn = h;
    }

    const sampleRows = [];
    if (headerRowNumber > 0) {
      for (let r = headerRowNumber + 1; r <= Math.min(headerRowNumber + 5, sheet.rowCount); r++) {
        const obj = {};
        sheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const headerName = headers[colNumber - 1];
          if (headerName) obj[headerName] = cellText(cell.value).trim();
        });
        if (Object.keys(obj).length > 0) sampleRows.push(obj);
      }
    }

    sheets.push({
      name: sheet.name,
      rowCount: Math.max(0, sheet.rowCount - headerRowNumber),
      headers,
      sampleRows,
    });
  }

  return { sheets, suggestedPartNoColumn, suggestedQuantityColumn, suggestedNotesColumn };
}

/**
 * Extracts {rowNumber, partNo, quantity, notes} rows from a workbook using the user's column mapping.
 */
export async function extractMappedRows(buffer, { sheetName, partNoColumn, quantityColumn, notesColumn }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) throw httpError(400, `Sheet '${sheetName}' not found in workbook`);

  let headerRowNumber = 0;
  let colIdxMap = {};
  for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
    const map = {};
    worksheet.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const val = cellText(cell.value).trim();
      if (val) map[val] = colNumber;
    });
    if (map[partNoColumn] && map[quantityColumn]) {
      headerRowNumber = r;
      colIdxMap = map;
      break;
    }
  }
  if (!headerRowNumber) {
    throw httpError(400, `Could not find header row containing columns '${partNoColumn}' and '${quantityColumn}'`);
  }

  const partNoIdx = colIdxMap[partNoColumn];
  const qtyIdx = colIdxMap[quantityColumn];
  const notesIdx = notesColumn ? colIdxMap[notesColumn] : null;

  const rows = [];
  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawPartNo = row.getCell(partNoIdx).value;
    let rawQty = row.getCell(qtyIdx).value;
    if (rawQty && typeof rawQty === 'object' && 'result' in rawQty) rawQty = rawQty.result;
    const rawNotes = notesIdx ? row.getCell(notesIdx).value : null;
    if (rawPartNo == null && rawQty == null) continue;

    rows.push({
      rowNumber: r,
      partNo: cellText(rawPartNo).trim(),
      quantity: rawQty != null ? rawQty : '',
      notes: cellText(rawNotes).trim(),
    });
  }
  return rows;
}

export async function previewExcelStockInward({ warehouseId, rows, duplicateHandling = 'combine', sourceReference = null }) {
  const whId = Number(warehouseId);
  if (!whId) throw httpError(400, 'Warehouse selection is required');
  const warehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(whId);
  if (!warehouse) throw httpError(404, 'Warehouse not found');
  if (Number(warehouse.is_active) !== 1) {
    throw httpError(400, `Warehouse '${warehouse.code} - ${warehouse.name}' is inactive.`);
  }
  if (!Array.isArray(rows) || rows.length === 0) throw httpError(400, 'No rows provided for preview');
  if (rows.length > 2000) throw httpError(400, 'Too many rows in workbook (max 2,000 rows permitted per upload)');

  const warnings = [];
  if (sourceReference && String(sourceReference).trim()) {
    const cleanRef = String(sourceReference).trim();
    const existingRef = await db
      .prepare(`SELECT receipt_number FROM stock_receipt WHERE source_reference = ? AND status = 'CONFIRMED'`)
      .get(cleanRef);
    if (existingRef) {
      warnings.push(`This stock receipt has already been processed (Reference: '${cleanRef}', Receipt #${existingRef.receipt_number}).`);
    }
  }

  const [allProducts, allWarehouses, stocks] = await Promise.all([
    db.prepare('SELECT id, part_no, description, unit FROM product').all(),
    db.prepare('SELECT id, code, name, is_active FROM warehouse').all(),
    db.prepare('SELECT product_id, on_hand_quantity, reserved_quantity FROM inventory_stock WHERE warehouse_id = ?').all(whId),
  ]);
  const productMap = new Map(allProducts.map((p) => [String(p.part_no).trim().toLowerCase(), p]));
  const warehouseMap = new Map();
  for (const w of allWarehouses) {
    warehouseMap.set(String(w.code).trim().toLowerCase(), w);
    warehouseMap.set(String(w.name).trim().toLowerCase(), w);
  }
  const stockMap = new Map(stocks.map((s) => [s.product_id, s]));

  const invalidRows = [];
  const aggregator = new Map();

  rows.forEach((rawRow, i) => {
    const rowNumber = rawRow.rowNumber || i + 2;
    const rawPartNo = rawRow.partNo != null ? String(rawRow.partNo).trim() : '';
    const rawQty = rawRow.quantity;
    const rawDesc = rawRow.description != null ? String(rawRow.description).trim() : '';
    const rawWh = rawRow.warehouse != null ? String(rawRow.warehouse).trim() : '';

    if (!rawPartNo) {
      invalidRows.push({ rowNumber, partNo: rawPartNo, quantity: rawQty, reason: 'Missing Part Number' });
      return;
    }
    const qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      invalidRows.push({ rowNumber, partNo: rawPartNo, quantity: rawQty, reason: 'Quantity must be greater than zero.' });
      return;
    }
    const product = productMap.get(rawPartNo.toLowerCase());
    if (!product) {
      invalidRows.push({ rowNumber, partNo: rawPartNo, quantity: qty, reason: `Product ${rawPartNo} does not exist in the Product Catalogue.` });
      return;
    }
    if (rawWh) {
      const whMatch = warehouseMap.get(rawWh.toLowerCase());
      if (whMatch && Number(whMatch.is_active) === 0) {
        invalidRows.push({ rowNumber, partNo: rawPartNo, quantity: qty, reason: `Warehouse ${rawWh} is inactive.` });
        return;
      }
    }
    if (rawDesc && product.description && rawDesc.toLowerCase() !== product.description.toLowerCase()) {
      warnings.push(
        `Description differs from catalogue for part '${product.part_no}' (Excel: "${rawDesc}" vs Catalogue: "${product.description}"). Catalogue description will be preserved.`
      );
    }

    const key = String(product.part_no).toLowerCase();
    const notes = rawRow.notes ? String(rawRow.notes).trim() : null;
    const existing = aggregator.get(key);
    if (!existing) {
      aggregator.set(key, { product, totalQuantity: qty, sourceRows: [rowNumber], notes });
    } else if (duplicateHandling === 'remove') {
      warnings.push(`Duplicate row ${rowNumber} for part '${product.part_no}' discarded.`);
    } else {
      existing.totalQuantity += qty;
      existing.sourceRows.push(rowNumber);
      if (notes && !existing.notes) existing.notes = notes;
    }
  });

  const validItems = [];
  for (const entry of aggregator.values()) {
    if (entry.sourceRows.length > 1 && duplicateHandling === 'combine') {
      warnings.push(
        `Duplicate product detected: '${entry.product.part_no}' appeared in multiple rows (${entry.sourceRows.join(', ')}) and was combined to +${entry.totalQuantity} units.`
      );
    }
    const stock = stockMap.get(entry.product.id);
    const currentOnHand = num(stock?.on_hand_quantity);
    const currentReserved = num(stock?.reserved_quantity);
    const projectedOnHand = currentOnHand + entry.totalQuantity;
    validItems.push({
      productId: entry.product.id,
      partNo: entry.product.part_no,
      description: entry.product.description,
      unit: entry.product.unit || 'Nos',
      currentOnHand,
      incomingQuantity: entry.totalQuantity,
      projectedOnHand,
      currentAvailable: Math.max(0, currentOnHand - currentReserved),
      projectedAvailable: Math.max(0, projectedOnHand - currentReserved),
      aggregatedFromRows: entry.sourceRows,
      notes: entry.notes,
    });
  }

  return {
    summary: {
      totalRows: rows.length,
      validItemCount: validItems.length,
      invalidRowCount: invalidRows.length,
      totalIncomingUnits: validItems.reduce((acc, cur) => acc + cur.incomingQuantity, 0),
    },
    warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
    validItems,
    invalidRows,
    warnings: Array.from(new Set(warnings)),
  };
}

// ---------------------------------------------------------------------------
// Operations control center
// ---------------------------------------------------------------------------

async function warehouseLabel(warehouseId) {
  if (!warehouseId) return 'All Warehouses';
  const row = await db.prepare(`SELECT name FROM warehouse WHERE id = ?`).get(warehouseId);
  return row?.name || 'Warehouse';
}

function paginate(list, limit, offset) {
  const l = Number(limit) || 50;
  const o = Number(offset) || 0;
  return { page: list.slice(o, o + l), limit: l, offset: o };
}

export async function getOperationsOverview({ warehouseId = null } = {}) {
  const whId = warehouseId ? Number(warehouseId) : null;
  const [stockStats, health, pending] = await Promise.all([
    db
      .prepare(`
        SELECT
          COUNT(DISTINCT s.product_id) AS total_stock_items,
          COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand,
          COALESCE(SUM(s.reserved_quantity), 0) AS total_reserved,
          COALESCE(SUM(s.incoming_quantity), 0) AS total_incoming
        FROM inventory_stock s
        ${whId ? 'WHERE s.warehouse_id = ?' : ''}
      `)
      .get(...(whId ? [whId] : [])),
    countStockHealth(whId),
    db
      .prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS total_units
        FROM stock_reservation
        WHERE status = 'ACTIVE' ${whId ? 'AND warehouse_id = ?' : ''}
      `)
      .get(...(whId ? [whId] : [])),
  ]);

  const totalOnHand = num(stockStats?.total_on_hand);
  const totalReserved = num(stockStats?.total_reserved);
  return {
    totalStockItems: num(stockStats?.total_stock_items),
    totalTrackedProducts: health.trackedProducts,
    totalOnHand,
    totalReserved,
    totalAvailable: Math.max(0, totalOnHand - totalReserved),
    lowStockCount: health.lowStockCount,
    criticalStockCount: health.criticalStockCount,
    outOfStockCount: health.outOfStockCount,
    healthyCount: health.healthyCount,
    incomingStockQuantity: num(stockStats?.total_incoming),
    pendingReservationsCount: num(pending?.count),
    pendingReservationsUnits: num(pending?.total_units),
  };
}

export async function getOperationsStockAlerts({ warehouseId = null, category = null, severity = null, limit = 50, offset = 0 } = {}) {
  const [stockRes, pendingRes, whName] = await Promise.all([
    getStockSummary({ warehouseId, limit: 1000 }),
    getReservations({ warehouseId, status: 'ACTIVE', limit: 100 }),
    warehouseLabel(warehouseId),
  ]);

  const nowStr = new Date().toISOString();
  const alerts = [];
  for (const item of stockRes.items) {
    const base = {
      productId: item.productId,
      partNumber: item.partNo,
      description: item.description,
      warehouseId: warehouseId ? Number(warehouseId) : null,
      warehouseName: whName,
      onHand: item.onHandQuantity,
      reserved: item.reservedQuantity,
      available: item.availableQuantity,
      createdAt: nowStr,
    };
    if (item.status === 'out_of_stock') {
      alerts.push({
        ...base,
        id: `ALERT-OOS-${item.productId}`,
        alertType: 'OUT_OF_STOCK',
        category: 'OUT_OF_STOCK',
        severity: 'CRITICAL',
        threshold: item.criticalStockThreshold,
        recommendedAction: item.incomingQuantity > 0 ? 'Monitor Inbound Receipt' : 'Create Immediate Restock Request',
      });
    } else if (item.status === 'critical') {
      alerts.push({
        ...base,
        id: `ALERT-CRIT-${item.productId}`,
        alertType: 'CRITICAL_STOCK',
        category: 'CRITICAL_STOCK',
        severity: 'CRITICAL',
        threshold: item.criticalStockThreshold,
        recommendedAction: 'Expedite Restock / Transfer from Central Storage',
      });
    } else if (item.status === 'low_stock') {
      alerts.push({
        ...base,
        id: `ALERT-LOW-${item.productId}`,
        alertType: 'LOW_STOCK',
        category: 'LOW_STOCK',
        severity: 'WARNING',
        threshold: item.lowStockThreshold,
        recommendedAction: 'Review Restock Queue',
      });
    }
  }

  for (const r of pendingRes.reservations) {
    if (r.quantity >= 10) {
      const onHand = num(r.on_hand_quantity);
      const reserved = num(r.reserved_quantity);
      alerts.push({
        id: `ALERT-RES-${r.id}`,
        alertType: 'RESERVATION_PRESSURE',
        category: 'RESERVATION_PRESSURE',
        severity: 'INFO',
        productId: r.product_id,
        partNumber: r.part_no,
        description: r.product_description,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        onHand,
        reserved,
        available: Math.max(0, onHand - reserved),
        threshold: r.quantity,
        recommendedAction: 'Review & Fulfill Reservation',
        createdAt: r.created_at,
      });
    }
  }

  let filtered = alerts;
  if (category) filtered = filtered.filter((a) => a.category === String(category).toUpperCase());
  if (severity) filtered = filtered.filter((a) => a.severity === String(severity).toUpperCase());

  const { page, limit: l, offset: o } = paginate(filtered, limit, offset);
  return {
    alerts: page,
    total: filtered.length,
    criticalCount: filtered.filter((a) => a.severity === 'CRITICAL').length,
    warningCount: filtered.filter((a) => a.severity === 'WARNING').length,
    infoCount: filtered.filter((a) => a.severity === 'INFO').length,
    limit: l,
    offset: o,
  };
}

export async function getOperationsCriticalStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const stockRes = await getStockSummary({ warehouseId, limit: 1000 });
  const items = stockRes.items.filter((i) => i.availableQuantity <= i.criticalStockThreshold);
  const { page, limit: l, offset: o } = paginate(items, limit, offset);
  return { items: page, total: items.length, limit: l, offset: o };
}

export async function getOperationsOutOfStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const whId = warehouseId ? Number(warehouseId) : null;
  const stockRes = await getStockSummary({ warehouseId: whId, status: 'out_of_stock', limit: 1000 });
  const { page, limit: l, offset: o } = paginate(stockRes.items, limit, offset);

  const productIds = page.map((i) => i.productId);
  const lastMoves = productIds.length
    ? await db
        .prepare(`
          SELECT product_id, movement_type, MAX(created_at) AS last_at
          FROM inventory_movement
          WHERE product_id = ANY(?) AND movement_type IN ('STOCK_IN', 'STOCK_OUT') ${whId ? 'AND warehouse_id = ?' : ''}
          GROUP BY product_id, movement_type
        `)
        .all(productIds, ...(whId ? [whId] : []))
    : [];
  const lastByKey = new Map(lastMoves.map((m) => [`${m.product_id}:${m.movement_type}`, m.last_at]));

  return {
    items: page.map((item) => ({
      ...item,
      incomingStatus: item.incomingQuantity > 0 ? 'INCOMING' : 'NO INCOMING STOCK',
      lastStockIn: lastByKey.get(`${item.productId}:STOCK_IN`) || null,
      lastStockOut: lastByKey.get(`${item.productId}:STOCK_OUT`) || null,
    })),
    total: stockRes.items.length,
    limit: l,
    offset: o,
  };
}

/**
 * Products at or below their low-stock threshold, ranked by urgency. Sales velocity isn't tracked
 * per product here, so the reorder point is the low-stock threshold and the safety stock is the
 * critical threshold; the suggestion tops stock back up to twice the reorder point.
 */
export async function getOperationsRestockQueue({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const [stockRes, whName] = await Promise.all([getStockSummary({ warehouseId, limit: 1000 }), warehouseLabel(warehouseId)]);

  const priorityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  const queue = stockRes.items
    .filter((i) => i.status !== 'healthy')
    .map((i) => {
      const reorderPoint = i.lowStockThreshold;
      const safetyStock = i.criticalStockThreshold;
      const suggested = Math.max(0, Math.ceil(reorderPoint * 2 - i.availableQuantity));
      let priority = 'MEDIUM';
      if (i.availableQuantity <= 0) priority = 'CRITICAL';
      else if (i.availableQuantity <= safetyStock) priority = 'HIGH';

      let status = 'NEEDS_RESTOCK';
      if (i.incomingQuantity > 0) status = i.incomingQuantity >= suggested ? 'INCOMING' : 'PARTIALLY_COVERED';

      let reason = 'Available stock is at or below the reorder point';
      if (priority === 'CRITICAL') reason = 'Out of stock - immediate replenishment needed';
      else if (priority === 'HIGH') reason = 'Available stock is at or below safety stock';

      return {
        priority,
        productId: i.productId,
        partNumber: i.partNo,
        description: i.description,
        warehouseId: warehouseId ? Number(warehouseId) : null,
        warehouseName: whName,
        onHand: i.onHandQuantity,
        reserved: i.reservedQuantity,
        available: i.availableQuantity,
        reorderPoint,
        safetyStock,
        incoming: i.incomingQuantity,
        suggestedRestockQuantity: suggested,
        reason,
        status,
      };
    })
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.available - b.available)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  const { page, limit: l, offset: o } = paginate(queue, limit, offset);
  return {
    items: page,
    total: queue.length,
    criticalCount: queue.filter((q) => q.priority === 'CRITICAL').length,
    highCount: queue.filter((q) => q.priority === 'HIGH').length,
    mediumCount: queue.filter((q) => q.priority === 'MEDIUM').length,
    limit: l,
    offset: o,
  };
}

export async function getOperationsIncomingStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const whId = warehouseId ? Number(warehouseId) : null;
  const rows = await db
    .prepare(`
      SELECT
        r.id AS receipt_id,
        r.receipt_number,
        r.source_type,
        r.source_reference,
        r.created_at,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        p.id AS product_id,
        p.part_no,
        p.description,
        ri.quantity AS incoming_qty,
        s.on_hand_quantity AS on_hand,
        s.reserved_quantity AS reserved
      FROM stock_receipt r
      JOIN stock_receipt_item ri ON ri.receipt_id = r.id
      JOIN warehouse w ON w.id = r.warehouse_id
      JOIN product p ON p.id = ri.product_id
      LEFT JOIN inventory_stock s ON s.warehouse_id = r.warehouse_id AND s.product_id = p.id
      WHERE r.status = 'DRAFT' ${whId ? 'AND r.warehouse_id = ?' : ''}
      ORDER BY r.created_at DESC
    `)
    .all(...(whId ? [whId] : []));

  const items = rows.map((r) => {
    const onHand = num(r.on_hand);
    const reserved = num(r.reserved);
    return {
      receiptId: r.receipt_id,
      receiptNumber: r.receipt_number,
      productId: r.product_id,
      partNumber: r.part_no,
      description: r.description,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      incomingQuantity: num(r.incoming_qty),
      currentOnHand: onHand,
      reserved,
      available: Math.max(0, onHand - reserved),
      source: r.source_type,
      reference: r.source_reference || r.receipt_number,
      status: 'EXPECTED',
      createdAt: r.created_at,
    };
  });

  const { page, limit: l, offset: o } = paginate(items, limit, offset);
  return {
    items: page,
    total: items.length,
    totalIncomingUnits: items.reduce((acc, cur) => acc + cur.incomingQuantity, 0),
    limit: l,
    offset: o,
  };
}

export async function getOperationsPendingReservations({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const res = await getReservations({ warehouseId, status: 'ACTIVE', limit: 1000 });
  const reservations = res.reservations;
  const { page, limit: l, offset: o } = paginate(reservations, limit, offset);
  return {
    reservations: page,
    total: reservations.length,
    summary: {
      activeReservationsCount: reservations.length,
      totalReservedUnits: reservations.reduce((acc, cur) => acc + cur.quantity, 0),
      productsAffectedCount: new Set(reservations.map((r) => r.product_id)).size,
      warehousesAffectedCount: new Set(reservations.map((r) => r.warehouse_id)).size,
    },
    limit: l,
    offset: o,
  };
}

export async function getOperationsInventoryAudit({ warehouseId = null, productId = null, movementType = null, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (warehouseId) {
    conditions.push('warehouse_id = ?');
    params.push(Number(warehouseId));
  }
  if (productId) {
    conditions.push('product_id = ?');
    params.push(Number(productId));
  }
  if (movementType) {
    conditions.push('movement_type = ?');
    params.push(movementType);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [movementRes, stats] = await Promise.all([
    getMovements({ warehouseId, productId, movementType, limit, offset }),
    db
      .prepare(`
        SELECT
          COUNT(*) AS total_movements,
          COALESCE(SUM(CASE WHEN movement_type = 'STOCK_IN' THEN quantity ELSE 0 END), 0) AS stock_in_units,
          COALESCE(SUM(CASE WHEN movement_type = 'STOCK_OUT' THEN quantity ELSE 0 END), 0) AS stock_out_units,
          COALESCE(SUM(CASE WHEN movement_type = 'RETURN' THEN quantity ELSE 0 END), 0) AS return_units,
          COALESCE(SUM(CASE WHEN movement_type IN ('ADJUSTMENT', 'OPENING_STOCK') THEN quantity ELSE 0 END), 0) AS adjustment_units,
          COALESCE(SUM(CASE WHEN movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN quantity ELSE 0 END), 0) AS transfer_units
        FROM inventory_movement
        ${whereSql}
      `)
      .get(...params),
  ]);

  return {
    movements: movementRes.movements,
    total: movementRes.total,
    summary: {
      totalMovements: num(stats?.total_movements),
      stockInUnits: num(stats?.stock_in_units),
      stockOutUnits: num(stats?.stock_out_units),
      returnUnits: num(stats?.return_units),
      adjustmentUnits: num(stats?.adjustment_units),
      transferUnits: num(stats?.transfer_units),
    },
    limit: movementRes.limit,
    offset: movementRes.offset,
  };
}
