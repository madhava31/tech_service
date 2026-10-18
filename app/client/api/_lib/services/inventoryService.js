import db from '../db/index.js';
import ExcelJS from 'exceljs';
import { nextNumber } from '../db/numbering.js';

/**
 * Ensures an inventory_stock row exists for a product in a warehouse.
 * Returns the current stock row.
 */
export async function getOrCreateStockRow(warehouseId, productId) {
  let row = await db
    .prepare(
      `SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`
    )
    .get(warehouseId, productId);

  if (!row) {
    await db.prepare(
      `INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, reserved_quantity, incoming_quantity)
       VALUES (?, ?, 0, 0, 0)
       ON CONFLICT (warehouse_id, product_id) DO NOTHING
       RETURNING id`
    ).run(warehouseId, productId);

    row = await db
      .prepare(
        `SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`
      )
      .get(warehouseId, productId);
  }

  return row;
}

/**
 * Retrieve all warehouses with stock summary
 */
export async function getWarehouses({ activeOnly = false } = {}) {
  let sql = `
    SELECT
      w.*,
      COUNT(DISTINCT s.product_id) AS product_count,
      COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand
    FROM warehouse w
    LEFT JOIN inventory_stock s ON s.warehouse_id = w.id
  `;
  if (activeOnly) {
    sql += ` WHERE w.is_active = 1`;
  }
  sql += ` GROUP BY w.id ORDER BY w.is_default DESC, w.name ASC`;
  return (await db.prepare(sql).all()).map((r) => ({
    ...r,
    product_count: Number(r.product_count) || 0,
    total_on_hand: Number(r.total_on_hand) || 0,
  }));
}

/**
 * Retrieve a single warehouse by ID with detailed stock summary
 */
export async function getWarehouseById(id) {
  const warehouse = await db.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(id);
  if (!warehouse) return null;

  const stats = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT product_id) AS product_count,
         COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
         COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
         COALESCE(SUM(incoming_quantity), 0) AS total_incoming
       FROM inventory_stock
       WHERE warehouse_id = ?`
    )
    .get(id);

  const productStocks = await db
    .prepare(
      `SELECT
         on_hand_quantity AS on_hand,
         reserved_quantity AS reserved,
         low_stock_threshold AS low_threshold,
         critical_stock_threshold AS crit_threshold
       FROM inventory_stock
       WHERE warehouse_id = ?`
    )
    .all(id);

  let lowStockCount = 0;
  let criticalStockCount = 0;
  let outOfStockCount = 0;
  let healthyCount = 0;

  for (const s of productStocks) {
    const available = Math.max(0, s.on_hand - s.reserved);
    if (available === 0) {
      outOfStockCount++;
    } else if (available <= s.crit_threshold) {
      criticalStockCount++;
    } else if (available <= s.low_threshold) {
      lowStockCount++;
    } else {
      healthyCount++;
    }
  }

  const totalOnHand = Number(stats?.total_on_hand) || 0;
  const totalReserved = Number(stats?.total_reserved) || 0;
  const totalAvailable = Math.max(0, totalOnHand - totalReserved);
  const totalIncoming = Number(stats?.total_incoming) || 0;

  const metrics = {
    productCount: Number(stats?.product_count) || 0,
    totalOnHand,
    totalReserved,
    totalAvailable,
    totalIncoming,
    healthyCount,
    lowStockCount,
    criticalStockCount,
    outOfStockCount,
  };

  const stockRes = await getStockSummary({ warehouseId: id, limit: 100 });
  const movementsRes = await getMovements({ warehouseId: id, limit: 25 });

  return {
    ...warehouse,
    metrics,
    summary: metrics,
    stock: stockRes.items,
    recentMovements: movementsRes.movements,
  };
}

/**
 * Retrieve high-level inventory overview metrics
 */
export async function getInventoryOverview() {
  const activeWarehouses = (await db.prepare(`SELECT COUNT(*) AS total FROM warehouse WHERE is_active = 1`).get())?.total || 0;
  const totalWarehouses = (await db.prepare(`SELECT COUNT(*) AS total FROM warehouse`).get())?.total || 0;

  const stats = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT product_id) AS products_with_inventory,
         COALESCE(SUM(on_hand_quantity), 0) AS total_on_hand,
         COALESCE(SUM(reserved_quantity), 0) AS total_reserved,
         COALESCE(SUM(incoming_quantity), 0) AS total_incoming
       FROM inventory_stock`
    )
    .get();

  const productStocks = await db
    .prepare(
      `SELECT
         p.id,
         COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand,
         COALESCE(SUM(s.reserved_quantity), 0) AS reserved,
         COALESCE(MAX(s.low_stock_threshold), 10) AS low_threshold,
         COALESCE(MAX(s.critical_stock_threshold), 5) AS crit_threshold
       FROM product p
       LEFT JOIN inventory_stock s ON s.product_id = p.id
       GROUP BY p.id`
    )
    .all();

  let lowStockCount = 0;
  let criticalStockCount = 0;
  let outOfStockCount = 0;
  let healthyCount = 0;

  for (const p of productStocks) {
    const available = Math.max(0, p.on_hand - p.reserved);
    if (available === 0) {
      outOfStockCount++;
    } else if (available <= p.crit_threshold) {
      criticalStockCount++;
    } else if (available <= p.low_threshold) {
      lowStockCount++;
    } else {
      healthyCount++;
    }
  }

  const totalOnHand = Number(stats?.total_on_hand) || 0;
  const totalReserved = Number(stats?.total_reserved) || 0;
  const totalAvailable = Math.max(0, totalOnHand - totalReserved);
  const totalIncoming = Number(stats?.total_incoming) || 0;

  const warehouses = await getWarehouses({ activeOnly: false });
  const recentMovementsRes = await getMovements({ limit: 10 });
  const lowStockRes = await getStockSummary({ lowStockOnly: true, limit: 10 });

  const metrics = {
    totalWarehouses,
    activeWarehouses,
    totalTrackedProducts: productStocks.length,
    productsWithStock: Number(stats?.products_with_inventory) || 0,
    totalOnHandQuantity: totalOnHand,
    totalReservedQuantity: totalReserved,
    totalAvailableQuantity: totalAvailable,
    totalIncomingQuantity: totalIncoming,
    healthyCount,
    lowStockCount,
    criticalStockCount,
    outOfStockCount,
  };

  return {
    metrics,
    warehouseCount: activeWarehouses,
    productsWithInventory: Number(stats?.products_with_inventory) || 0,
    totalProducts: productStocks.length,
    totalOnHand,
    totalReserved,
    totalAvailable,
    totalIncoming,
    warehouses,
    recentMovements: recentMovementsRes.movements,
    lowStockItems: lowStockRes.items,
  };
}

/**
 * Retrieve the default warehouse
 */
export async function getDefaultWarehouse() {
  let wh = await db.prepare(`SELECT * FROM warehouse WHERE is_default = 1 LIMIT 1`).get();
  if (!wh) {
    wh = await db.prepare(`SELECT * FROM warehouse WHERE is_active = 1 ORDER BY id ASC LIMIT 1`).get();
  }
  return wh || null;
}

/**
 * Create a new warehouse
 */
export async function createWarehouse({ name, code, address = '', city = '', state = '', isDefault = false }) {
  if (!name || !code) {
    throw new Error('Warehouse name and code are required');
  }

  return db.transaction(async () => {
    if (isDefault) {
      await db.prepare(`UPDATE warehouse SET is_default = 0`).run();
    }

    const info = await db
      .prepare(
        `INSERT INTO warehouse (name, code, address, city, state, is_active, is_default)
         VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING id`
      )
      .run(name.trim(), code.trim().toUpperCase(), address.trim(), city.trim(), state.trim(), isDefault ? 1 : 0);

    return await getWarehouseById(info.lastInsertRowid);
  });
}

/**
 * Update an existing warehouse
 */
export async function updateWarehouse(id, { name, code, address, city, state, isActive, isDefault }) {
  const existing = await getWarehouseById(id);
  if (!existing) {
    throw new Error('Warehouse not found');
  }

  return db.transaction(async () => {
    if (isDefault) {
      await db.prepare(`UPDATE warehouse SET is_default = 0 WHERE id <> ?`).run(id);
    }

    await db.prepare(
      `UPDATE warehouse
       SET name = ?,
           code = ?,
           address = ?,
           city = ?,
           state = ?,
           is_active = ?,
           is_default = ?,
           updated_at = NOW()
       WHERE id = ?`
    ).run(
      name !== undefined ? name.trim() : existing.name,
      code !== undefined ? code.trim().toUpperCase() : existing.code,
      address !== undefined ? address.trim() : existing.address,
      city !== undefined ? city.trim() : existing.city,
      state !== undefined ? state.trim() : existing.state,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
      isDefault !== undefined ? (isDefault ? 1 : 0) : existing.is_default,
      id
    );

    return await getWarehouseById(id);
  });
}

/**
 * Get aggregate stock summary across all products, optionally filtered by warehouse, search query, or status.
 * Uses grouped SQL to eliminate N+1 queries.
 */
export async function getStockSummary({
  warehouseId = null,
  lowStockOnly = false,
  status = null,
  q = null,
  limit = 50,
  offset = 0,
} = {}) {
  let whereConditions = [];
  let params = [];

  if (warehouseId) {
    whereConditions.push(`(s.warehouse_id = ? OR s.warehouse_id IS NULL)`);
    params.push(warehouseId);
  }

  if (q) {
    whereConditions.push(`(p.part_no LIKE ? OR p.description LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  let havingSql = '';
  if (status === 'out_of_stock') {
    havingSql = `HAVING (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) = 0`;
  } else if (status === 'critical') {
    havingSql = `HAVING (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) > 0 AND (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) <= COALESCE(MAX(s.critical_stock_threshold), 5)`;
  } else if (status === 'low_stock' || lowStockOnly) {
    havingSql = `HAVING (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) > COALESCE(MAX(s.critical_stock_threshold), 5) AND (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) <= COALESCE(MAX(s.low_stock_threshold), 10)`;
  } else if (status === 'healthy') {
    havingSql = `HAVING (COALESCE(SUM(s.on_hand_quantity), 0) - COALESCE(SUM(s.reserved_quantity), 0)) > COALESCE(MAX(s.low_stock_threshold), 10)`;
  }

  // Get total matching count
  const countQuery = `
    SELECT COUNT(*) AS total FROM (
      SELECT p.id
      FROM product p
      LEFT JOIN inventory_stock s ON s.product_id = p.id
      ${whereSql}
      GROUP BY p.id
      ${havingSql}
    )
  `;
  const countRow = await db.prepare(countQuery).get(...params);
  const total = countRow ? countRow.total : 0;

  // Aggregate stock across warehouses or specific warehouse
  const queryParams = [...params, limit, offset];
  const rows = await db
    .prepare(
      `SELECT
         p.id AS product_id,
         p.part_no,
         p.description,
         p.unit,
         COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
         COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
         COALESCE(SUM(incoming_quantity), 0) AS incoming_quantity,
         COALESCE(MAX(s.low_stock_threshold), 10) AS low_stock_threshold,
         COALESCE(MAX(s.critical_stock_threshold), 5) AS critical_stock_threshold,
         COUNT(DISTINCT s.warehouse_id) AS warehouse_count
       FROM product p
       LEFT JOIN inventory_stock s ON s.product_id = p.id
       ${whereSql}
       GROUP BY p.id, p.part_no, p.description, p.unit
       ${havingSql}
       ORDER BY p.description ASC
       LIMIT ? OFFSET ?`
    )
    .all(...queryParams);

  const items = rows.map((r) => {
    const onHand = Number(r.on_hand_quantity);
    const reserved = Number(r.reserved_quantity);
    const available = Math.max(0, onHand - reserved);
    const lowThreshold = Number(r.low_stock_threshold);
    const critThreshold = Number(r.critical_stock_threshold);

    let stockStatus = 'healthy';
    if (available === 0) stockStatus = 'out_of_stock';
    else if (available <= critThreshold) stockStatus = 'critical';
    else if (available <= lowThreshold) stockStatus = 'low_stock';

    return {
      productId: r.product_id,
      partNo: r.part_no,
      description: r.description,
      unit: r.unit,
      onHandQuantity: onHand,
      reservedQuantity: reserved,
      incomingQuantity: Number(r.incoming_quantity),
      availableQuantity: available,
      lowStockThreshold: lowThreshold,
      criticalStockThreshold: critThreshold,
      isLowStock: available <= lowThreshold && available > critThreshold,
      isCriticalStock: available <= critThreshold && available > 0,
      isOutOfStock: available === 0,
      status: stockStatus,
      warehouseCount: Number(r.warehouse_count),
    };
  });

  return { items, total, limit, offset };
}

/**
 * Get stock breakdown for a specific product
 */
export async function getProductStock(productId, warehouseId = null) {
  const product = await db.prepare(`SELECT id, part_no, description, unit, default_price FROM product WHERE id = ?`).get(productId);
  if (!product) {
    throw new Error('Product not found');
  }

  let sql = `
    SELECT
      s.*,
      w.name AS warehouse_name,
      w.code AS warehouse_code,
      w.is_default AS warehouse_is_default
    FROM inventory_stock s
    JOIN warehouse w ON w.id = s.warehouse_id
    WHERE s.product_id = ?
  `;
  const params = [productId];

  if (warehouseId) {
    sql += ` AND s.warehouse_id = ?`;
    params.push(warehouseId);
  }

  sql += ` ORDER BY w.is_default DESC, w.name ASC`;
  const rows = await db.prepare(sql).all(...params);

  const warehousesStock = rows.map((r) => {
    const onHand = Number(r.on_hand_quantity);
    const reserved = Number(r.reserved_quantity);
    return {
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      warehouseCode: r.warehouse_code,
      warehouseIsDefault: Boolean(r.warehouse_is_default),
      onHandQuantity: onHand,
      reservedQuantity: reserved,
      incomingQuantity: Number(r.incoming_quantity),
      availableQuantity: Math.max(0, onHand - reserved),
      lowStockThreshold: Number(r.low_stock_threshold),
      criticalStockThreshold: Number(r.critical_stock_threshold),
      updatedAt: r.updated_at,
    };
  });

  const totals = warehousesStock.reduce(
    (acc, cur) => {
      acc.onHandQuantity += cur.onHandQuantity;
      acc.reservedQuantity += cur.reservedQuantity;
      acc.incomingQuantity += cur.incomingQuantity;
      acc.availableQuantity += cur.availableQuantity;
      return acc;
    },
    { onHandQuantity: 0, reservedQuantity: 0, incomingQuantity: 0, availableQuantity: 0 }
  );

  return {
    product,
    totals,
    warehouses: warehousesStock,
  };
}

/**
 * Record stock receipt / stock-in (increments on_hand_quantity)
 */
export async function recordStockIn({
  warehouseId,
  productId,
  quantity,
  referenceType = 'STOCK_RECEIPT',
  referenceId = null,
  reason = 'Stock Inward',
  userId = null,
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const afterOnHand = beforeOnHand + qty;
    const beforeReserved = Number(current.reserved_quantity);

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterOnHand, warehouseId, productId);

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'STOCK_IN', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        beforeReserved,
        referenceType,
        referenceId ? String(referenceId) : null,
        reason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Record stock issue / stock-out (decrements on_hand_quantity)
 * Validates available stock >= requested quantity.
 */
export async function recordStockOut({
  warehouseId,
  productId,
  quantity,
  referenceType = 'STOCK_ISSUE',
  referenceId = null,
  reason = 'Stock Outward',
  userId = null,
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);
    const available = beforeOnHand - beforeReserved;

    if (qty > available) {
      throw new Error(`Insufficient available stock. Requested: ${qty}, Available: ${available}`);
    }

    const afterOnHand = beforeOnHand - qty;

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterOnHand, warehouseId, productId);

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'STOCK_OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        beforeReserved,
        referenceType,
        referenceId ? String(referenceId) : null,
        reason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Adjust stock level directly (e.g. for opening stock or physical stock count verification).
 * Cannot adjust on_hand below reserved_quantity.
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
  if (isNaN(targetOnHand) || targetOnHand < 0) {
    throw new Error('New on-hand quantity cannot be negative');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);

    if (targetOnHand < beforeReserved) {
      throw new Error(`Cannot adjust on-hand stock below reserved quantity (${beforeReserved})`);
    }

    const delta = targetOnHand - beforeOnHand;
    if (delta === 0) {
      return { stock: current, movement: null };
    }

    let movementType = 'ADJUSTMENT';
    if (beforeOnHand === 0 && (reason.toLowerCase().includes('opening') || referenceType.includes('OPENING'))) {
      movementType = 'OPENING_STOCK';
    }

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(targetOnHand, warehouseId, productId);

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        movementType,
        Math.abs(delta),
        beforeOnHand,
        targetOnHand,
        beforeReserved,
        beforeReserved,
        referenceType,
        referenceId ? String(referenceId) : null,
        reason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Reserve stock for a quotation or order.
 * Increases reserved_quantity without physically deducting on_hand.
 */
export async function reserveStock({
  warehouseId,
  productId,
  quantity,
  referenceType = 'QUOTATION',
  referenceId = null,
  notes = '',
  userId = null,
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) {
    throw new Error('Reservation quantity must be greater than zero');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);
    const available = beforeOnHand - beforeReserved;

    if (qty > available) {
      throw new Error(`Insufficient available stock to reserve. Requested: ${qty}, Available: ${available}`);
    }

    const afterReserved = beforeReserved + qty;

    await db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterReserved, warehouseId, productId);

    const resInfo = await db
      .prepare(
        `INSERT INTO stock_reservation (
           warehouse_id, product_id, quantity, status, reference_type, reference_id, notes, reserved_by
         ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        referenceType,
        referenceId ? String(referenceId) : null,
        notes,
        userId
      );

    const reservation = await db
      .prepare(`SELECT * FROM stock_reservation WHERE id = ?`)
      .get(resInfo.lastInsertRowid);

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    return { reservation, stock: updatedStock };
  });
}

/**
 * Release an active stock reservation (cancelled quote/order).
 * Decreases reserved_quantity.
 */
export async function releaseReservation({ reservationId, userId = null }) {
  return db.transaction(async () => {
    const reservation = await db
      .prepare(`SELECT * FROM stock_reservation WHERE id = ?`)
      .get(reservationId);

    if (!reservation) {
      throw new Error('Reservation not found');
    }

    if (reservation.status !== 'ACTIVE') {
      throw new Error(`Cannot release reservation with status: ${reservation.status}`);
    }

    const qty = Number(reservation.quantity);
    const current = await getOrCreateStockRow(reservation.warehouse_id, reservation.product_id);
    const beforeReserved = Number(current.reserved_quantity);
    const afterReserved = Math.max(0, beforeReserved - qty);

    await db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterReserved, reservation.warehouse_id, reservation.product_id);

    await db.prepare(
      `UPDATE stock_reservation
       SET status = 'RELEASED',
           released_at = NOW()
       WHERE id = ?`
    ).run(reservationId);

    const updatedReservation = await db
      .prepare(`SELECT * FROM stock_reservation WHERE id = ?`)
      .get(reservationId);

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(reservation.warehouse_id, reservation.product_id);

    return { reservation: updatedReservation, stock: updatedStock };
  });
}

/**
 * Fulfill an active reservation (e.g. dispatched/invoiced).
 * Atomically decrements BOTH reserved_quantity and on_hand_quantity and creates a STOCK_OUT movement.
 */
export async function fulfillReservation({ reservationId, userId = null }) {
  return db.transaction(async () => {
    const reservation = await db
      .prepare(`SELECT * FROM stock_reservation WHERE id = ?`)
      .get(reservationId);

    if (!reservation) {
      throw new Error('Reservation not found');
    }

    if (reservation.status !== 'ACTIVE') {
      throw new Error(`Cannot fulfill reservation with status: ${reservation.status}`);
    }

    const qty = Number(reservation.quantity);
    const current = await getOrCreateStockRow(reservation.warehouse_id, reservation.product_id);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);

    if (qty > beforeOnHand) {
      throw new Error(`Insufficient on-hand stock to fulfill reservation. Required: ${qty}, On Hand: ${beforeOnHand}`);
    }

    const afterOnHand = beforeOnHand - qty;
    const afterReserved = Math.max(0, beforeReserved - qty);

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           reserved_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterOnHand, afterReserved, reservation.warehouse_id, reservation.product_id);

    await db.prepare(
      `UPDATE stock_reservation
       SET status = 'FULFILLED',
           fulfilled_at = NOW()
       WHERE id = ?`
    ).run(reservationId);

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'STOCK_OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        reservation.warehouse_id,
        reservation.product_id,
        qty,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        afterReserved,
        reservation.reference_type || 'RESERVATION_FULFILL',
        reservation.reference_id || String(reservationId),
        'Reservation fulfilled and stock issued',
        userId
      );

    const updatedReservation = await db
      .prepare(`SELECT * FROM stock_reservation WHERE id = ?`)
      .get(reservationId);

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(reservation.warehouse_id, reservation.product_id);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { reservation: updatedReservation, stock: updatedStock, movement };
  });
}

/**
 * Record a return from customer or supplier.
 * Increments on_hand_quantity and logs RETURN movement.
 */
export async function recordReturn({
  warehouseId,
  productId,
  quantity,
  referenceType = 'RETURN',
  referenceId = null,
  reason = 'Customer Return',
  userId = null,
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0) {
    throw new Error('Return quantity must be greater than zero');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const afterOnHand = beforeOnHand + qty;
    const beforeReserved = Number(current.reserved_quantity);

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterOnHand, warehouseId, productId);

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        beforeReserved,
        referenceType,
        referenceId ? String(referenceId) : null,
        reason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Query stock movements (audit ledger) with joined product, warehouse, and user details.
 */
export async function getMovements({
  warehouseId = null,
  productId = null,
  movementType = null,
  referenceType = null,
  referenceId = null,
  limit = 50,
  offset = 0,
} = {}) {
  let conditions = [];
  let params = [];

  if (warehouseId) {
    conditions.push(`m.warehouse_id = ?`);
    params.push(warehouseId);
  }
  if (productId) {
    conditions.push(`m.product_id = ?`);
    params.push(productId);
  }
  if (movementType) {
    conditions.push(`m.movement_type = ?`);
    params.push(movementType);
  }
  if (referenceType) {
    conditions.push(`m.reference_type = ?`);
    params.push(referenceType);
  }
  if (referenceId) {
    conditions.push(`m.reference_id = ?`);
    params.push(referenceId);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM inventory_movement m ${whereSql}`)
    .get(...params);

  const total = countRow ? countRow.total : 0;

  const rows = await db
    .prepare(
      `SELECT
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
       LEFT JOIN "user" u ON u.id = m.created_by
       ${whereSql}
       ORDER BY m.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { movements: rows, total, limit, offset };
}

/**
 * Query stock reservations
 */
export async function getReservations({
  warehouseId = null,
  productId = null,
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  let conditions = [];
  let params = [];

  if (warehouseId) {
    conditions.push(`r.warehouse_id = ?`);
    params.push(warehouseId);
  }
  if (productId) {
    conditions.push(`r.product_id = ?`);
    params.push(productId);
  }
  if (status) {
    conditions.push(`r.status = ?`);
    params.push(status);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM stock_reservation r ${whereSql}`)
    .get(...params);

  const total = countRow ? countRow.total : 0;

  const rows = await db
    .prepare(
      `SELECT
         r.*,
         w.name AS warehouse_name,
         w.code AS warehouse_code,
         p.part_no,
         p.description AS product_description,
         u.username AS reserved_by_username
       FROM stock_reservation r
       JOIN warehouse w ON w.id = r.warehouse_id
       JOIN product p ON p.id = r.product_id
       LEFT JOIN "user" u ON u.id = r.reserved_by
       ${whereSql}
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { reservations: rows, total, limit, offset };
}

/**
 * Retrieve a single reservation by ID with product, warehouse, stock snapshot, and movements
 */
export async function getReservationById(id) {
  const resId = Number(id);
  if (!resId) return null;

  const reservation = await db
    .prepare(
      `SELECT
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
       LEFT JOIN "user" u ON u.id = r.reserved_by
       WHERE r.id = ?`
    )
    .get(resId);

  if (!reservation) return null;

  // Stock snapshot
  const stock = await db
    .prepare(
      `SELECT
         on_hand_quantity AS on_hand,
         reserved_quantity AS reserved,
         COALESCE(on_hand_quantity, 0) - COALESCE(reserved_quantity, 0) AS available
       FROM inventory_stock
       WHERE warehouse_id = ? AND product_id = ?`
    )
    .get(reservation.warehouse_id, reservation.product_id) || { on_hand: 0, reserved: 0, available: 0 };

  // Movements linked to this reservation reference
  const movements = await db
    .prepare(
      `SELECT m.*, u.username AS created_by_username
       FROM inventory_movement m
       LEFT JOIN "user" u ON u.id = m.created_by
       WHERE m.warehouse_id = ? AND m.product_id = ? AND m.reference_type = ? AND m.reference_id = ?
       ORDER BY m.id DESC`
    )
    .all(
      reservation.warehouse_id,
      reservation.product_id,
      reservation.reference_type || 'RESERVATION_FULFILL',
      reservation.reference_id || String(resId)
    );

  return {
    ...reservation,
    quantity: Number(reservation.quantity),
    stock: {
      onHand: Number(stock.on_hand || 0),
      reserved: Number(stock.reserved || 0),
      available: Math.max(0, Number(stock.available || 0)),
    },
    movements,
  };
}

/**
 * Retrieve paginated stock receipts with search and filters
 */
export async function getStockReceipts({
  warehouseId = null,
  status = null,
  sourceType = null,
  q = null,
  limit = 50,
  offset = 0,
} = {}) {
  let conditions = [];
  let params = [];

  if (warehouseId) {
    conditions.push(`r.warehouse_id = ?`);
    params.push(warehouseId);
  }
  if (status) {
    conditions.push(`r.status = ?`);
    params.push(status);
  }
  if (sourceType) {
    conditions.push(`r.source_type = ?`);
    params.push(sourceType);
  }
  if (q) {
    conditions.push(`(r.receipt_number LIKE ? OR r.source_reference LIKE ? OR r.notes LIKE ?)`);
    const searchPattern = `%${q}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM stock_receipt r ${whereSql}`)
    .get(...params);
  const total = countRow ? countRow.total : 0;

  const rows = await db
    .prepare(
      `SELECT
         r.*,
         w.name AS warehouse_name,
         w.code AS warehouse_code,
         u.username AS created_by_username,
         COUNT(i.id) AS product_count,
         COALESCE(SUM(i.quantity), 0) AS total_quantity
       FROM stock_receipt r
       JOIN warehouse w ON w.id = r.warehouse_id
       LEFT JOIN "user" u ON u.id = r.created_by
       LEFT JOIN stock_receipt_item i ON i.receipt_id = r.id
       ${whereSql}
       GROUP BY r.id, w.name, w.code, u.username
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { receipts: rows, total, limit, offset };
}

/**
 * Retrieve single stock receipt by ID with line items and linked movement audit trail
 */
export async function getStockReceiptById(id) {
  const receipt = await db
    .prepare(
      `SELECT
         r.*,
         w.name AS warehouse_name,
         w.code AS warehouse_code,
         u.username AS created_by_username
       FROM stock_receipt r
       JOIN warehouse w ON w.id = r.warehouse_id
       LEFT JOIN "user" u ON u.id = r.created_by
       WHERE r.id = ?`
    )
    .get(id);

  if (!receipt) return null;

  const items = await db
    .prepare(
      `SELECT
         i.*,
         p.part_no,
         p.description AS product_description,
         p.unit,
         p.hsn_sac,
         p.default_price
       FROM stock_receipt_item i
       JOIN product p ON p.id = i.product_id
       WHERE i.receipt_id = ?
       ORDER BY i.id ASC`
    )
    .all(id);

  const movements = await db
    .prepare(
      `SELECT
         m.*,
         p.part_no,
         p.description AS product_description,
         p.unit,
         u.username AS created_by_username
       FROM inventory_movement m
       JOIN product p ON p.id = m.product_id
       LEFT JOIN "user" u ON u.id = m.created_by
       WHERE m.reference_type = 'STOCK_RECEIPT' AND m.reference_id = ?
       ORDER BY m.id ASC`
    )
    .all(String(id));

  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return {
    ...receipt,
    items,
    movements,
    totalQuantity,
    productCount: items.length,
  };
}

/**
 * Create a stock receipt (Manual or Excel Restocking).
 * Atomically creates receipt, line items, and executes stock-in movements if confirmImmediately=true.
 */
export async function createStockReceipt({
  warehouseId,
  receiptNumber = null,
  sourceType = 'MANUAL',
  sourceReference = null,
  notes = null,
  items = [],
  confirmImmediately = true,
  userId = null,
}) {
  const whId = Number(warehouseId);
  if (!whId) throw new Error('Warehouse is required');

  const warehouse = await getWarehouseById(whId);
  if (!warehouse) throw new Error('Warehouse not found');
  if (warehouse.is_active !== 1) throw new Error('Selected warehouse is not active');

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required for a stock receipt');
  }

  // Duplicate receipt reference check
  if (sourceReference && String(sourceReference).trim()) {
    const cleanRef = String(sourceReference).trim();
    const existingRef = await db
      .prepare(`SELECT id, receipt_number FROM stock_receipt WHERE source_reference = ? AND status = 'CONFIRMED'`)
      .get(cleanRef);
    if (existingRef) {
      throw new Error(`This stock receipt has already been processed (Reference: '${cleanRef}', Receipt #${existingRef.receipt_number})`);
    }
  }

  // Pre-validate all items before beginning transaction
  const allProducts = await db.prepare('SELECT id, part_no FROM product').all();
  const prodById = new Map(allProducts.map((p) => [p.id, p]));
  const prodByPartNo = new Map(allProducts.map((p) => [p.part_no.trim().toLowerCase(), p]));

  const validatedItems = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const qty = Number(item.quantity);
    if (!qty || qty <= 0 || isNaN(qty) || !isFinite(qty)) {
      throw new Error(`Item at row ${idx + 1} has an invalid quantity: must be greater than zero`);
    }

    let product = null;
    if (item.productId) {
      product = prodById.get(Number(item.productId));
    } else if (item.partNo) {
      product = prodByPartNo.get(String(item.partNo).trim().toLowerCase());
    }

    if (!product) {
      throw new Error(
        `Product '${item.partNo || item.productId}' does not exist in the Product Catalogue`
      );
    }

    validatedItems.push({
      productId: product.id,
      quantity: qty,
      notes: item.notes ? String(item.notes).trim() : null,
    });
  }

  // Generate receipt number if not provided
  let finalReceiptNumber = receiptNumber ? String(receiptNumber).trim() : null;
  if (!finalReceiptNumber) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    finalReceiptNumber = `SR-${today}-${rand}`;
  }

  // Check receipt number uniqueness
  const existingReceipt = await db
    .prepare('SELECT id FROM stock_receipt WHERE receipt_number = ?')
    .get(finalReceiptNumber);
  if (existingReceipt) {
    throw new Error(`Receipt number '${finalReceiptNumber}' already exists`);
  }

  const initialStatus = confirmImmediately ? 'CONFIRMED' : 'DRAFT';
  const confirmedAt = confirmImmediately ? new Date().toISOString() : null;

  return db.transaction(async () => {
    const receiptInsert = await db
      .prepare(
        `INSERT INTO stock_receipt (
           warehouse_id, receipt_number, source_type, source_reference,
           status, notes, created_by, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        whId,
        finalReceiptNumber,
        sourceType,
        sourceReference ? String(sourceReference).trim() : null,
        initialStatus,
        notes ? String(notes).trim() : null,
        userId || null,
        confirmedAt
      );

    const receiptId = receiptInsert.lastInsertRowid;

    for (const item of validatedItems) {
      let beforeOnHand = 0;
      let afterOnHand = 0;

      if (confirmImmediately) {
        const stockInRes = await recordStockIn({
          warehouseId: whId,
          productId: item.productId,
          quantity: item.quantity,
          referenceType: 'STOCK_RECEIPT',
          referenceId: String(receiptId),
          reason: notes || `Stock Receipt ${finalReceiptNumber}`,
          userId,
        });
        beforeOnHand = stockInRes.movement.before_on_hand;
        afterOnHand = stockInRes.movement.after_on_hand;
      }

      await db.prepare(
        `INSERT INTO stock_receipt_item (
           receipt_id, product_id, quantity, before_on_hand, after_on_hand, notes
         ) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
      ).run(receiptId, item.productId, item.quantity, beforeOnHand, afterOnHand, item.notes);
    }

    return await getStockReceiptById(receiptId);
  });
}

/**
 * Confirm a staged DRAFT stock receipt
 */
export async function confirmDraftReceipt(receiptId, userId = null) {
  const rId = Number(receiptId);
  if (!rId) throw new Error('Invalid receipt ID');

  return db.transaction(async () => {
    const receipt = await db.prepare('SELECT * FROM stock_receipt WHERE id = ?').get(rId);
    if (!receipt) throw new Error('Receipt not found');
    if (receipt.status === 'CONFIRMED') throw new Error('This stock receipt has already been processed.');
    if (receipt.status === 'CANCELLED') throw new Error('Cancelled receipt cannot be confirmed.');

    const items = await db.prepare('SELECT * FROM stock_receipt_item WHERE receipt_id = ?').all(rId);
    if (items.length === 0) throw new Error('Receipt has no items to confirm');

    for (const item of items) {
      const stockInRes = await recordStockIn({
        warehouseId: receipt.warehouse_id,
        productId: item.product_id,
        quantity: item.quantity,
        referenceType: 'STOCK_RECEIPT',
        referenceId: String(rId),
        reason: receipt.notes || `Stock Receipt ${receipt.receipt_number}`,
        userId,
      });

      await db.prepare(
        `UPDATE stock_receipt_item
         SET before_on_hand = ?, after_on_hand = ?
         WHERE id = ?`
      ).run(stockInRes.movement.before_on_hand, stockInRes.movement.after_on_hand, item.id);
    }

    await db.prepare(
      `UPDATE stock_receipt
       SET status = 'CONFIRMED', confirmed_at = NOW()
       WHERE id = ?`
    ).run(rId);

    return await getStockReceiptById(rId);
  });
}

/**
 * Cancel a staged DRAFT stock receipt
 */
export async function cancelDraftReceipt(receiptId, userId = null) {
  const rId = Number(receiptId);
  if (!rId) throw new Error('Invalid receipt ID');

  return db.transaction(async () => {
    const receipt = await db.prepare('SELECT * FROM stock_receipt WHERE id = ?').get(rId);
    if (!receipt) throw new Error('Receipt not found');
    if (receipt.status === 'CONFIRMED') {
      throw new Error('Cannot cancel an already confirmed stock receipt');
    }
    if (receipt.status === 'CANCELLED') {
      return await getStockReceiptById(rId);
    }

    await db.prepare(`UPDATE stock_receipt SET status = 'CANCELLED' WHERE id = ?`).run(rId);
    return await getStockReceiptById(rId);
  });
}

/**
 * Analyze an uploaded Excel stock workbook: extract sheets, headers, sample rows, and suggest column mapping
 */
export async function analyzeExcelStockWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length === 0) {
    throw new Error('The uploaded workbook contains no worksheets');
  }

  const sheets = [];
  let suggestedPartNoColumn = null;
  let suggestedQuantityColumn = null;
  let suggestedNotesColumn = null;

  const partNoRegex = /^(part[_\s\-]?no|part[_\s\-]?number|sku|item[_\s\-]?code|product[_\s\-]?code|model[_\s\-]?no|part|part_no|partno|partnumber)$/i;
  const qtyRegex = /^(qty|quantity|received[_\s\-]?qty|stock|units|count|inward[_\s\-]?qty|received|received_qty)$/i;
  const notesRegex = /^(notes?|remarks?|comments?|reference|ref|challan[_\s\-]?no)$/i;

  for (const sheet of workbook.worksheets) {
    let headerRowNumber = 0;
    let headers = [];

    // Find the first non-empty row to use as headers
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const values = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const val = String(cell.value || '').trim();
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
      sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
        headers.push(String(cell.value || '').trim());
      });
    }

    // Inspect headers for suggestions
    for (const h of headers) {
      if (!suggestedPartNoColumn && partNoRegex.test(h)) suggestedPartNoColumn = h;
      if (!suggestedQuantityColumn && qtyRegex.test(h)) suggestedQuantityColumn = h;
      if (!suggestedNotesColumn && notesRegex.test(h)) suggestedNotesColumn = h;
    }

    // Count data rows
    const dataRowCount = Math.max(0, sheet.rowCount - headerRowNumber);

    // Read up to 5 sample rows for user inspection
    const sampleRows = [];
    if (headerRowNumber > 0) {
      for (let r = headerRowNumber + 1; r <= Math.min(headerRowNumber + 5, sheet.rowCount); r++) {
        const row = sheet.getRow(r);
        const obj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const headerName = headers[colNumber - 1];
          if (headerName) {
            let val = cell.value;
            if (val && typeof val === 'object' && 'result' in val) val = val.result;
            obj[headerName] = val != null ? String(val).trim() : '';
          }
        });
        if (Object.keys(obj).length > 0) {
          sampleRows.push(obj);
        }
      }
    }

    sheets.push({
      name: sheet.name,
      rowCount: dataRowCount,
      headers,
      sampleRows,
    });
  }

  return {
    sheets,
    suggestedPartNoColumn,
    suggestedQuantityColumn,
    suggestedNotesColumn,
  };
}

/**
 * Preview Excel stock inward data: validates rows against catalogue and warehouse stock,
 * detects duplicates, aggregates incoming units, and returns before/after stock projections.
 */
export async function previewExcelStockInward({
  warehouseId,
  rows,
  duplicateHandling = 'combine',
  sourceReference = null,
}) {
  const whId = Number(warehouseId);
  if (!whId) throw new Error('Warehouse selection is required');

  const warehouse = await getWarehouseById(whId);
  if (!warehouse) throw new Error('Warehouse not found');
  if (warehouse.is_active !== 1) {
    throw new Error(`Warehouse '${warehouse.code} - ${warehouse.name}' is inactive.`);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No rows provided for preview');
  }

  if (rows.length > 2000) {
    throw new Error('Too many rows in workbook (max 2,000 rows permitted per upload)');
  }

  const warnings = [];

  // Check duplicate receipt reference
  if (sourceReference && String(sourceReference).trim()) {
    const cleanRef = String(sourceReference).trim();
    const existingRef = await db
      .prepare(`SELECT id, receipt_number FROM stock_receipt WHERE source_reference = ? AND status = 'CONFIRMED'`)
      .get(cleanRef);
    if (existingRef) {
      warnings.push(`This stock receipt has already been processed (Reference: '${cleanRef}', Receipt #${existingRef.receipt_number}).`);
    }
  }

  // Preload all products & warehouses into in-memory maps (0 N+1 queries)
  const allProducts = await db.prepare('SELECT id, part_no, description, unit FROM product').all();
  const productMap = new Map();
  for (const p of allProducts) {
    productMap.set(p.part_no.trim().toLowerCase(), p);
  }

  const allWarehouses = await db.prepare('SELECT id, code, name, is_active FROM warehouse').all();
  const warehouseMap = new Map();
  for (const w of allWarehouses) {
    warehouseMap.set(w.code.trim().toLowerCase(), w);
    warehouseMap.set(w.name.trim().toLowerCase(), w);
  }

  // Preload current stock for selected warehouse
  const stocks = await db
    .prepare(
      `SELECT product_id, on_hand_quantity, reserved_quantity
       FROM inventory_stock
       WHERE warehouse_id = ?`
    )
    .all(whId);
  const stockMap = new Map(stocks.map((s) => [s.product_id, s]));

  const invalidRows = [];
  const partNoAggregator = new Map();

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const rowNumber = rawRow.rowNumber || i + 2;
    const rawPartNo = rawRow.partNo != null ? String(rawRow.partNo).trim() : '';
    const rawQty = rawRow.quantity;
    const rawDesc = rawRow.description != null ? String(rawRow.description).trim() : '';
    const rawWh = rawRow.warehouse != null ? String(rawRow.warehouse).trim() : '';

    // Validation 1: Part number present
    if (!rawPartNo) {
      invalidRows.push({
        rowNumber,
        partNo: rawPartNo,
        quantity: rawQty,
        reason: 'Missing Part Number',
      });
      continue;
    }

    // Validation 2: Quantity valid numeric > 0
    const qty = Number(rawQty);
    if (isNaN(qty) || qty <= 0 || !isFinite(qty)) {
      invalidRows.push({
        rowNumber,
        partNo: rawPartNo,
        quantity: rawQty,
        reason: 'Quantity must be greater than zero.',
      });
      continue;
    }

    // Validation 3: Match against product catalogue
    const matchedProduct = productMap.get(rawPartNo.toLowerCase());
    if (!matchedProduct) {
      invalidRows.push({
        rowNumber,
        partNo: rawPartNo,
        quantity: qty,
        reason: `Product ${rawPartNo} does not exist in the Product Catalogue.`,
      });
      continue;
    }

    // Validation 4: Warehouse resolution (if provided in row)
    if (rawWh) {
      const whMatch = warehouseMap.get(rawWh.toLowerCase());
      if (whMatch && whMatch.is_active === 0) {
        invalidRows.push({
          rowNumber,
          partNo: rawPartNo,
          quantity: qty,
          reason: `Warehouse ${rawWh} is inactive.`,
        });
        continue;
      }
    }

    // Validation 5: Description check
    if (rawDesc && rawDesc.toLowerCase() !== matchedProduct.description.toLowerCase()) {
      warnings.push(
        `Description differs from catalogue for part '${matchedProduct.part_no}' (Excel: "${rawDesc}" vs Catalogue: "${matchedProduct.description}"). Catalogue description will be preserved.`
      );
    }

    // Accumulate / Aggregate duplicate rows
    const normalizedKey = matchedProduct.part_no.toLowerCase();
    if (!partNoAggregator.has(normalizedKey)) {
      partNoAggregator.set(normalizedKey, {
        product: matchedProduct,
        totalQuantity: qty,
        sourceRows: [rowNumber],
        notes: rawRow.notes ? String(rawRow.notes).trim() : null,
      });
    } else {
      const existing = partNoAggregator.get(normalizedKey);
      if (duplicateHandling === 'combine') {
        existing.totalQuantity += qty;
        existing.sourceRows.push(rowNumber);
        if (rawRow.notes && !existing.notes) {
          existing.notes = String(rawRow.notes).trim();
        }
      } else if (duplicateHandling === 'remove') {
        // Discard duplicate row
        warnings.push(`Duplicate row ${rowNumber} for part '${matchedProduct.part_no}' discarded.`);
      } else {
        // Keep separate
        existing.totalQuantity += qty;
        existing.sourceRows.push(rowNumber);
      }
    }
  }

  const validItems = [];

  for (const [_, entry] of partNoAggregator) {
    if (entry.sourceRows.length > 1 && duplicateHandling === 'combine') {
      warnings.push(
        `Duplicate product detected: '${entry.product.part_no}' appeared in multiple rows (${entry.sourceRows.join(', ')}) and was combined to +${entry.totalQuantity} units.`
      );
    }

    const currentStock = stockMap.get(entry.product.id);
    const currentOnHand = currentStock ? Number(currentStock.on_hand_quantity) : 0;
    const currentReserved = currentStock ? Number(currentStock.reserved_quantity) : 0;
    const incomingQuantity = entry.totalQuantity;
    const projectedOnHand = currentOnHand + incomingQuantity;
    const currentAvailable = Math.max(0, currentOnHand - currentReserved);
    const projectedAvailable = Math.max(0, projectedOnHand - currentReserved);

    validItems.push({
      productId: entry.product.id,
      partNo: entry.product.part_no,
      description: entry.product.description,
      unit: entry.product.unit || 'Nos',
      currentOnHand,
      incomingQuantity,
      projectedOnHand,
      currentAvailable,
      projectedAvailable,
      aggregatedFromRows: entry.sourceRows,
      notes: entry.notes,
    });
  }

  // Deduplicate warnings
  const uniqueWarnings = Array.from(new Set(warnings));
  const totalIncomingUnits = validItems.reduce((acc, cur) => acc + cur.incomingQuantity, 0);

  return {
    summary: {
      totalRows: rows.length,
      validItemCount: validItems.length,
      invalidRowCount: invalidRows.length,
      totalIncomingUnits,
    },
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
    },
    validItems,
    invalidRows,
    warnings: uniqueWarnings,
  };
}

/**
 * ============================================================================
 * STEP 8: SALE REPORT SERVICE FUNCTIONS
 * ============================================================================
 */

/**
 * Retrieve paginated Sale Reports with KPI summary
 */
export async function getSaleReports({
  warehouseId = null,
  status = null,
  sourceType = null,
  companyId = null,
  q = null,
  startDate = null,
  endDate = null,
  limit = 50,
  offset = 0,
} = {}) {
  const whereConditions = [];
  const params = [];

  if (warehouseId) {
    whereConditions.push('sr.warehouse_id = ?');
    params.push(warehouseId);
  }

  if (status) {
    whereConditions.push('sr.status = ?');
    params.push(status);
  }

  if (sourceType) {
    whereConditions.push('sr.source_type = ?');
    params.push(sourceType);
  }

  if (companyId) {
    whereConditions.push('sr.company_id = ?');
    params.push(companyId);
  }

  if (startDate) {
    whereConditions.push('sr.sale_date >= ?');
    params.push(startDate);
  }

  if (endDate) {
    whereConditions.push('sr.sale_date <= ?');
    params.push(endDate);
  }

  if (q) {
    const term = `%${q.trim()}%`;
    whereConditions.push(`(
      sr.report_number LIKE ?
      OR sr.invoice_number LIKE ?
      OR sr.company_name_snapshot LIKE ?
      OR EXISTS (
        SELECT 1 FROM sale_report_item sri
        WHERE sri.sale_report_id = sr.id AND sri.part_number_snapshot LIKE ?
      )
    )`);
    params.push(term, term, term, term);
  }

  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // 1. Total matching count
  const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM sale_report sr ${whereSql}`).get(...params);
  const total = countRow?.total || 0;

  // 2. Fetch paginated reports
  const queryParams = [...params, Number(limit) || 50, Number(offset) || 0];
  const rows = await db
    .prepare(
      `SELECT
         sr.*,
         w.name AS warehouse_name,
         w.code AS warehouse_code,
         c.name AS company_name,
         u.username AS created_by_username,
         cu.username AS confirmed_by_username,
         (SELECT COUNT(*) FROM sale_report_item WHERE sale_report_id = sr.id) AS total_items,
         (SELECT COALESCE(SUM(quantity), 0) FROM sale_report_item WHERE sale_report_id = sr.id) AS total_quantity
       FROM sale_report sr
       JOIN warehouse w ON w.id = sr.warehouse_id
       LEFT JOIN company c ON c.id = sr.company_id
       LEFT JOIN "user" u ON u.id = sr.created_by
       LEFT JOIN "user" cu ON cu.id = sr.confirmed_by
       ${whereSql}
       ORDER BY sr.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...queryParams);

  // 3. Compute KPI metrics (based on real database records)
  const todayStr = new Date().toISOString().slice(0, 10);
  const kpiStats = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_reports,
         SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft_count,
         SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_count,
         SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count,
         SUM(CASE WHEN status = 'CONFIRMED' AND sale_date = ? THEN 1 ELSE 0 END) AS today_sales_count,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN total_amount ELSE 0 END), 0) AS confirmed_total_value
       FROM sale_report`
    )
    .get(todayStr);

  const kpi = {
    totalReports: Number(kpiStats?.total_reports) || 0,
    draftCount: Number(kpiStats?.draft_count) || 0,
    confirmedCount: Number(kpiStats?.confirmed_count) || 0,
    cancelledCount: Number(kpiStats?.cancelled_count) || 0,
    todaySalesCount: Number(kpiStats?.today_sales_count) || 0,
    confirmedTotalValue: Number(kpiStats?.confirmed_total_value) || 0,
  };

  return {
    reports: rows.map((r) => ({
      ...r,
      total_items: Number(r.total_items) || 0,
      total_quantity: Number(r.total_quantity) || 0,
      subtotal: Number(r.subtotal) || 0,
      tax_amount: Number(r.tax_amount) || 0,
      total_amount: Number(r.total_amount) || 0,
    })),
    total,
    limit: Number(limit),
    offset: Number(offset),
    kpi,
  };
}

/**
 * Retrieve a single Sale Report by ID with items, movements, and source document info
 */
export async function getSaleReportById(id) {
  const reportId = Number(id);
  if (!reportId) return null;

  const report = await db
    .prepare(
      `SELECT
         sr.*,
         w.name AS warehouse_name,
         w.code AS warehouse_code,
         c.name AS company_name,
         c.address AS company_address,
         c.state AS company_state,
         c.gstin AS company_gstin,
         u.username AS created_by_username,
         cu.username AS confirmed_by_username
       FROM sale_report sr
       JOIN warehouse w ON w.id = sr.warehouse_id
       LEFT JOIN company c ON c.id = sr.company_id
       LEFT JOIN "user" u ON u.id = sr.created_by
       LEFT JOIN "user" cu ON cu.id = sr.confirmed_by
       WHERE sr.id = ?`
    )
    .get(reportId);

  if (!report) return null;

  // Items
  const items = await db
    .prepare(
      `SELECT
         sri.*,
         p.unit,
         s.on_hand_quantity AS current_on_hand,
         s.reserved_quantity AS current_reserved,
         COALESCE(s.on_hand_quantity, 0) - COALESCE(s.reserved_quantity, 0) AS current_available
       FROM sale_report_item sri
       JOIN product p ON p.id = sri.product_id
       LEFT JOIN inventory_stock s ON s.warehouse_id = ? AND s.product_id = sri.product_id
       WHERE sri.sale_report_id = ?
       ORDER BY sri.id ASC`
    )
    .all(report.warehouse_id, reportId);

  // Movements linked to this report
  const movements = await db
    .prepare(
      `SELECT
         m.*,
         p.part_no,
         p.description AS product_description,
         p.unit,
         u.username AS created_by_username
       FROM inventory_movement m
       JOIN product p ON p.id = m.product_id
       LEFT JOIN "user" u ON u.id = m.created_by
       WHERE m.reference_type = 'SALE_REPORT' AND m.reference_id = ?
       ORDER BY m.id ASC`
    )
    .all(String(reportId));

  // Source document details if linked
  let sourceDocument = null;
  if (report.source_quotation_id) {
    const quote = await db
      .prepare('SELECT id, number, date, total, status FROM quotation WHERE id = ?')
      .get(report.source_quotation_id);
    if (quote) sourceDocument = { type: 'QUOTATION', document: quote };
  } else if (report.source_po_id) {
    const po = await db
      .prepare('SELECT id, number, date, client_po_ref FROM purchase_order WHERE id = ?')
      .get(report.source_po_id);
    if (po) sourceDocument = { type: 'PURCHASE_ORDER', document: po };
  } else if (report.source_pi_id) {
    const pi = await db
      .prepare('SELECT id, number, date FROM performa_invoice WHERE id = ?')
      .get(report.source_pi_id);
    if (pi) sourceDocument = { type: 'PERFORMA_INVOICE', document: pi };
  }

  const totalQuantity = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);

  return {
    ...report,
    subtotal: Number(report.subtotal) || 0,
    tax_percent: Number(report.tax_percent) || 0,
    tax_amount: Number(report.tax_amount) || 0,
    total_amount: Number(report.total_amount) || 0,
    totalQuantity,
    productCount: items.length,
    items: items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      total_price: Number(it.total_price),
      before_on_hand: Number(it.before_on_hand),
      after_on_hand: Number(it.after_on_hand),
      current_on_hand: Number(it.current_on_hand || 0),
      current_reserved: Number(it.current_reserved || 0),
      current_available: Math.max(0, Number(it.current_available || 0)),
    })),
    movements,
    sourceDocument,
  };
}

/**
 * Helper to pre-validate and normalize line items for Sale Report
 */
async function validateSaleReportItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one product line item is required');
  }

  // Preload all products to prevent N+1 queries
  const allProducts = await db.prepare('SELECT id, part_no, description, hsn_sac, default_price FROM product').all();
  const prodById = new Map(allProducts.map((p) => [p.id, p]));
  const prodByPartNo = new Map(allProducts.map((p) => [p.part_no.trim().toLowerCase(), p]));

  const validated = [];
  const seenProductIds = new Set();

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const qty = Number(it.quantity);
    if (!qty || qty <= 0 || isNaN(qty)) {
      throw new Error(`Line ${idx + 1}: Quantity must be greater than zero`);
    }

    let prod = null;
    if (it.productId) {
      prod = prodById.get(Number(it.productId));
    } else if (it.partNo) {
      prod = prodByPartNo.get(String(it.partNo).trim().toLowerCase());
    }

    if (!prod) {
      throw new Error(`Line ${idx + 1}: Product '${it.partNo || it.productId}' not found in catalogue`);
    }

    if (seenProductIds.has(prod.id)) {
      throw new Error(`Line ${idx + 1}: Duplicate product '${prod.part_no}' in same report. Consolidate quantities.`);
    }
    seenProductIds.add(prod.id);

    const unitPrice = it.unitPrice !== undefined ? Number(it.unitPrice) : Number(prod.default_price || 0);
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error(`Line ${idx + 1}: Price cannot be negative`);
    }

    const totalPrice = Number((qty * unitPrice).toFixed(2));

    validated.push({
      productId: prod.id,
      partNumber: prod.part_no,
      description: prod.description,
      hsnCode: prod.hsn_sac || null,
      quantity: qty,
      unitPrice,
      totalPrice,
    });
  }

  return validated;
}

/**
 * Create a Sale Report (Draft or Confirmed)
 */
export async function createSaleReport({
  companyId = null,
  companyName = null,
  invoiceNumber = null,
  saleDate = null,
  phoneNumber = null,
  warehouseId,
  sourceType = 'DIRECT_EXTERNAL',
  sourceReference = null,
  quotationId = null,
  poId = null,
  piId = null,
  notes = null,
  taxPercent = 18,
  items = [],
  confirmImmediately = false,
  userId = null,
}) {
  const whId = Number(warehouseId);
  if (!whId) throw new Error('Warehouse selection is required');

  const warehouse = await getWarehouseById(whId);
  if (!warehouse) throw new Error('Warehouse not found');
  if (warehouse.is_active !== 1) throw new Error('Selected warehouse is not active');

  const finalSourceType = sourceType === 'INTERNAL_DOCUMENT' ? 'INTERNAL_DOCUMENT' : 'DIRECT_EXTERNAL';

  // Company resolution
  let finalCompanyId = companyId ? Number(companyId) : null;
  let finalCompanyName = companyName ? String(companyName).trim() : '';
  let finalPhone = phoneNumber ? String(phoneNumber).trim() : '';

  if (finalCompanyId) {
    const comp = await db.prepare('SELECT id, name, phone FROM company WHERE id = ?').get(finalCompanyId);
    if (comp) {
      finalCompanyName = comp.name;
      if (!finalPhone && comp.phone) finalPhone = comp.phone;
    }
  } else if (finalCompanyName) {
    // Check if company exists with exact name to reuse foreign key
    const existingComp = await db.prepare('SELECT id, name, phone FROM company WHERE LOWER(name) = LOWER(?)').get(finalCompanyName);
    if (existingComp) {
      finalCompanyId = existingComp.id;
      finalCompanyName = existingComp.name;
      if (!finalPhone && existingComp.phone) finalPhone = existingComp.phone;
    } else {
      const compInfo = await db.prepare('INSERT INTO company (name, phone) VALUES (?, ?) RETURNING id').run(finalCompanyName, finalPhone || null);
      finalCompanyId = compInfo.lastInsertRowid;
    }
  }

  if (!finalCompanyName) {
    throw new Error('Company name is required');
  }

  // Validate line items
  const validatedItems = await validateSaleReportItems(items);

  // Compute subtotal, tax, total
  const subtotal = validatedItems.reduce((sum, it) => sum + it.totalPrice, 0);
  const taxPct = Number(taxPercent) || 0;
  const taxAmount = Number(((subtotal * taxPct) / 100).toFixed(2));
  const totalAmount = Math.round(subtotal + taxAmount);

  const dateStr = saleDate ? String(saleDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

  return db.transaction(async () => {
    // Generate sequential report number
    const prefix = (await db.prepare(`SELECT sale_report_prefix FROM company_settings WHERE id = 1`).get())?.sale_report_prefix || 'SR';
    const reportNumber = await nextNumber(prefix, 'sale_report', 'report_number');

    const info = await db
      .prepare(
        `INSERT INTO sale_report (
           report_number, company_id, company_name_snapshot, invoice_number,
           sale_date, phone_number_snapshot, warehouse_id, source_type,
           source_reference, source_quotation_id, source_po_id, source_pi_id,
           status, subtotal, tax_percent, tax_amount, total_amount,
           notes, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, NOW(), NOW()) RETURNING id`
      )
      .run(
        reportNumber,
        finalCompanyId,
        finalCompanyName,
        invoiceNumber ? String(invoiceNumber).trim() : null,
        dateStr,
        finalPhone || null,
        whId,
        finalSourceType,
        sourceReference ? String(sourceReference).trim() : null,
        quotationId ? Number(quotationId) : null,
        poId ? Number(poId) : null,
        piId ? Number(piId) : null,
        subtotal,
        taxPct,
        taxAmount,
        totalAmount,
        notes ? String(notes).trim() : null,
        userId || null
      );

    const reportId = info.lastInsertRowid;

    const insertItemStmt = await db.prepare(
      `INSERT INTO sale_report_item (
         sale_report_id, product_id, part_number_snapshot, description_snapshot,
         hsn_code_snapshot, quantity, unit_price, total_price, before_on_hand, after_on_hand
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0) RETURNING id`
    );

    for (const it of validatedItems) {
      insertItemStmt.run(
        reportId,
        it.productId,
        it.partNumber,
        it.description,
        it.hsnCode,
        it.quantity,
        it.unitPrice,
        it.totalPrice
      );
    }

    if (confirmImmediately) {
      await confirmSaleReport(reportId, userId);
    }

    return await getSaleReportById(reportId);
  });
}

/**
 * Update an existing DRAFT Sale Report
 */
export async function updateDraftSaleReport(id, data, userId = null) {
  const reportId = Number(id);
  if (!reportId) throw new Error('Invalid Sale Report ID');

  return db.transaction(async () => {
    const existing = await db.prepare('SELECT * FROM sale_report WHERE id = ?').get(reportId);
    if (!existing) throw new Error('Sale Report not found');
    if (existing.status !== 'DRAFT') {
      throw new Error(`Cannot modify a Sale Report with status '${existing.status}'`);
    }

    const whId = data.warehouseId ? Number(data.warehouseId) : existing.warehouse_id;
    const warehouse = await getWarehouseById(whId);
    if (!warehouse) throw new Error('Warehouse not found');
    if (warehouse.is_active !== 1) throw new Error('Selected warehouse is not active');

    // Company resolution
    let finalCompanyId = data.companyId !== undefined ? (data.companyId ? Number(data.companyId) : null) : existing.company_id;
    let finalCompanyName = data.companyName !== undefined ? String(data.companyName).trim() : existing.company_name_snapshot;
    let finalPhone = data.phoneNumber !== undefined ? String(data.phoneNumber).trim() : existing.phone_number_snapshot;

    if (finalCompanyId) {
      const comp = await db.prepare('SELECT id, name, phone FROM company WHERE id = ?').get(finalCompanyId);
      if (comp) {
        finalCompanyName = comp.name;
        if (!finalPhone && comp.phone) finalPhone = comp.phone;
      }
    }

    let subtotal = existing.subtotal;
    let taxPct = data.taxPercent !== undefined ? Number(data.taxPercent) : existing.tax_percent;
    let taxAmount = existing.tax_amount;
    let totalAmount = existing.total_amount;

    if (Array.isArray(data.items)) {
      const validatedItems = await validateSaleReportItems(data.items);
      subtotal = validatedItems.reduce((sum, it) => sum + it.totalPrice, 0);
      taxAmount = Number(((subtotal * taxPct) / 100).toFixed(2));
      totalAmount = Math.round(subtotal + taxAmount);

      await db.prepare('DELETE FROM sale_report_item WHERE sale_report_id = ?').run(reportId);

      const insertItemStmt = await db.prepare(
        `INSERT INTO sale_report_item (
           sale_report_id, product_id, part_number_snapshot, description_snapshot,
           hsn_code_snapshot, quantity, unit_price, total_price, before_on_hand, after_on_hand
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0) RETURNING id`
      );

      for (const it of validatedItems) {
        insertItemStmt.run(
          reportId,
          it.productId,
          it.partNumber,
          it.description,
          it.hsnCode,
          it.quantity,
          it.unitPrice,
          it.totalPrice
        );
      }
    }

    await db.prepare(
      `UPDATE sale_report
       SET company_id = ?,
           company_name_snapshot = ?,
           invoice_number = ?,
           sale_date = ?,
           phone_number_snapshot = ?,
           warehouse_id = ?,
           source_reference = ?,
           subtotal = ?,
           tax_percent = ?,
           tax_amount = ?,
           total_amount = ?,
           notes = ?,
           updated_at = NOW()
       WHERE id = ?`
    ).run(
      finalCompanyId,
      finalCompanyName,
      data.invoiceNumber !== undefined ? (data.invoiceNumber ? String(data.invoiceNumber).trim() : null) : existing.invoice_number,
      data.saleDate ? String(data.saleDate).slice(0, 10) : existing.sale_date,
      finalPhone,
      whId,
      data.sourceReference !== undefined ? (data.sourceReference ? String(data.sourceReference).trim() : null) : existing.source_reference,
      subtotal,
      taxPct,
      taxAmount,
      totalAmount,
      data.notes !== undefined ? (data.notes ? String(data.notes).trim() : null) : existing.notes,
      reportId
    );

    return await getSaleReportById(reportId);
  });
}

/**
 * Confirm Sale Report: Performs Atomic Stock Out Deduction
 * 1. Validates status == 'DRAFT'
 * 2. Checks available stock for all line items (requested <= available)
 * 3. Handles reservations if linked to a quotation with active reservations
 * 4. Deducts on_hand stock and logs inventory_movement records
 * 5. Updates sale_report_item snapshots with before/after on_hand
 * 6. Sets status to 'CONFIRMED'
 * Rollbacks completely if any step fails.
 */
export async function confirmSaleReport(id, userId = null) {
  const reportId = Number(id);
  if (!reportId) throw new Error('Invalid Sale Report ID');

  return db.transaction(async () => {
    const report = await db.prepare('SELECT * FROM sale_report WHERE id = ?').get(reportId);
    if (!report) throw new Error('Sale Report not found');
    if (report.status === 'CONFIRMED') {
      throw new Error('Sale Report is already confirmed. Double confirmation is blocked.');
    }
    if (report.status === 'CANCELLED') {
      throw new Error('Cancelled Sale Report cannot be confirmed.');
    }

    const warehouse = await getWarehouseById(report.warehouse_id);
    if (!warehouse) throw new Error('Warehouse not found');
    if (warehouse.is_active !== 1) throw new Error('Warehouse is not active');

    const items = await db.prepare('SELECT * FROM sale_report_item WHERE sale_report_id = ?').all(reportId);
    if (items.length === 0) {
      throw new Error('Sale Report has no product line items to confirm');
    }

    // Pre-load all stock rows for this warehouse into a Map (no N+1)
    const productIds = items.map((it) => it.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const stockRows = await db
      .prepare(
        `SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id IN (${placeholders})`
      )
      .all(report.warehouse_id, ...productIds);

    const stockMap = new Map(stockRows.map((s) => [s.product_id, s]));

    // Pre-load active reservations for the linked quotation or sale report if any
    let quoteReservationsMap = new Map();
    const activeReservations = await db
      .prepare(
        `SELECT * FROM stock_reservation
         WHERE warehouse_id = ? AND status = 'ACTIVE' AND (
           (reference_type = 'QUOTATION' AND reference_id = ?) OR
           (reference_type = 'SALE_REPORT' AND (
             reference_id = ? OR
             reference_id = ? OR
             (? IS NOT NULL AND reference_id = ?)
           ))
         )`
      )
      .all(
        report.warehouse_id,
        report.source_quotation_id ? String(report.source_quotation_id) : '-1',
        String(report.id),
        String(report.report_number),
        report.source_reference ? String(report.source_reference) : null,
        report.source_reference ? String(report.source_reference) : '-1'
      );
    for (const res of activeReservations) {
      quoteReservationsMap.set(res.product_id, res);
    }

    // Validate stock availability for ALL items first
    for (const item of items) {
      const stock = stockMap.get(item.product_id);
      const onHand = stock ? Number(stock.on_hand_quantity) : 0;
      const reserved = stock ? Number(stock.reserved_quantity) : 0;

      // If there is an active reservation specifically for this quotation,
      // that reserved portion is legitimately intended for this sale.
      const linkedRes = quoteReservationsMap.get(item.product_id);
      const linkedReservedQty = linkedRes ? Number(linkedRes.quantity) : 0;
      const otherReserved = Math.max(0, reserved - linkedReservedQty);
      const effectiveAvailable = Math.max(0, onHand - otherReserved);

      if (item.quantity > effectiveAvailable) {
        throw new Error(
          `Insufficient available stock for ${item.part_number_snapshot}. Available: ${effectiveAvailable}, Requested: ${item.quantity}`
        );
      }
    }

    // Now execute atomic stock out for all items
    const updateStockStmt = await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           reserved_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    );

    const insertMovementStmt = await db.prepare(
      `INSERT INTO inventory_movement (
         warehouse_id, product_id, movement_type, quantity,
         before_on_hand, after_on_hand, before_reserved, after_reserved,
         reference_type, reference_id, reason, created_by, created_at
       ) VALUES (?, ?, 'STOCK_OUT', ?, ?, ?, ?, ?, 'SALE_REPORT', ?, ?, ?, NOW()) RETURNING id`
    );

    const updateItemSnapshotsStmt = await db.prepare(
      `UPDATE sale_report_item
       SET before_on_hand = ?, after_on_hand = ?
       WHERE id = ?`
    );

    for (const item of items) {
      // Ensure stock row exists
      const currentStock = await getOrCreateStockRow(report.warehouse_id, item.product_id);
      const beforeOnHand = Number(currentStock.on_hand_quantity);
      const beforeReserved = Number(currentStock.reserved_quantity);

      const afterOnHand = beforeOnHand - item.quantity;

      // Handle reservation fulfillment if present
      let afterReserved = beforeReserved;
      const linkedRes = quoteReservationsMap.get(item.product_id);
      if (linkedRes && beforeReserved > 0) {
        const deductFromReserved = Math.min(item.quantity, Number(linkedRes.quantity), beforeReserved);
        afterReserved = beforeReserved - deductFromReserved;

        // Fulfill or update reservation
        if (item.quantity >= Number(linkedRes.quantity)) {
          await db.prepare(`UPDATE stock_reservation SET status = 'FULFILLED', fulfilled_at = NOW() WHERE id = ?`).run(linkedRes.id);
        } else {
          await db.prepare(`UPDATE stock_reservation SET quantity = quantity - ? WHERE id = ?`).run(deductFromReserved, linkedRes.id);
        }
      }

      // Update physical inventory
      updateStockStmt.run(afterOnHand, afterReserved, report.warehouse_id, item.product_id);

      // Create inventory movement record
      insertMovementStmt.run(
        report.warehouse_id,
        item.product_id,
        item.quantity,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        afterReserved,
        String(reportId),
        report.notes || `Sale Report ${report.report_number}`,
        userId
      );

      // Update line item snapshots
      updateItemSnapshotsStmt.run(beforeOnHand, afterOnHand, item.id);
    }

    // Mark Sale Report CONFIRMED
    await db.prepare(
      `UPDATE sale_report
       SET status = 'CONFIRMED',
           confirmed_at = NOW(),
           confirmed_by = ?,
           updated_at = NOW()
       WHERE id = ?`
    ).run(userId, reportId);

    return await getSaleReportById(reportId);
  });
}

/**
 * Cancel a DRAFT Sale Report
 */
export async function cancelSaleReport(id, userId = null) {
  const reportId = Number(id);
  if (!reportId) throw new Error('Invalid Sale Report ID');

  return db.transaction(async () => {
    const report = await db.prepare('SELECT * FROM sale_report WHERE id = ?').get(reportId);
    if (!report) throw new Error('Sale Report not found');
    if (report.status === 'CONFIRMED') {
      throw new Error('Cannot cancel an already confirmed Sale Report. Physical stock has already been deducted.');
    }
    if (report.status === 'CANCELLED') {
      return await getSaleReportById(reportId);
    }

    await db.prepare(
      `UPDATE sale_report
       SET status = 'CANCELLED',
           updated_at = NOW()
       WHERE id = ?`
    ).run(reportId);

    return await getSaleReportById(reportId);
  });
}

/**
 * Retrieve source document line items (Quotation, PO, or PI) with previously sold & remaining quantities
 */
export async function getSourceDocumentItems(type, id) {
  const docId = Number(id);
  if (!docId) throw new Error('Invalid document ID');

  let quotationId = null;
  let poId = null;
  let piId = null;
  let company = null;
  let documentNumber = '';
  let documentDate = '';

  const normalizedType = String(type).toLowerCase();

  if (normalizedType === 'quotation' || normalizedType === 'quote') {
    quotationId = docId;
    const q = await db
      .prepare(`SELECT q.*, c.name AS company_name, c.phone AS company_phone FROM quotation q JOIN company c ON c.id = q.company_id WHERE q.id = ?`)
      .get(docId);
    if (!q) throw new Error('Quotation not found');
    company = { id: q.company_id, name: q.company_name, phone: q.company_phone };
    documentNumber = q.number;
    documentDate = q.date;
  } else if (normalizedType === 'po' || normalizedType === 'purchase_order') {
    poId = docId;
    const po = await db
      .prepare(`SELECT po.*, q.company_id, c.name AS company_name, c.phone AS company_phone FROM purchase_order po JOIN quotation q ON q.id = po.quotation_id JOIN company c ON c.id = q.company_id WHERE po.id = ?`)
      .get(docId);
    if (!po) throw new Error('Purchase order not found');
    quotationId = po.quotation_id;
    company = { id: po.company_id, name: po.company_name, phone: po.company_phone };
    documentNumber = po.number;
    documentDate = po.date;
  } else if (normalizedType === 'pi' || normalizedType === 'performa_invoice') {
    piId = docId;
    const pi = await db
      .prepare(`SELECT pi.*, q.company_id, c.name AS company_name, c.phone AS company_phone FROM performa_invoice pi JOIN quotation q ON q.id = pi.quotation_id JOIN company c ON c.id = q.company_id WHERE pi.id = ?`)
      .get(docId);
    if (!pi) throw new Error('Performa invoice not found');
    quotationId = pi.quotation_id;
    poId = pi.purchase_order_id;
    company = { id: pi.company_id, name: pi.company_name, phone: pi.company_phone };
    documentNumber = pi.number;
    documentDate = pi.date;
  } else {
    throw new Error(`Unsupported source document type: ${type}`);
  }

  // Fetch original quotation items
  const quoteItems = await db
    .prepare(
      `SELECT qi.*, p.unit, p.hsn_sac, p.default_price
       FROM quotation_item qi
       LEFT JOIN product p ON p.id = qi.product_id
       WHERE qi.quotation_id = ?
       ORDER BY qi.id ASC`
    )
    .all(quotationId);

  // Preload previously sold quantities across confirmed sale reports linked to this quotation
  const previouslySoldRows = await db
    .prepare(
      `SELECT sri.product_id, COALESCE(SUM(sri.quantity), 0) AS sold_qty
       FROM sale_report_item sri
       JOIN sale_report sr ON sr.id = sri.sale_report_id
       WHERE sr.source_quotation_id = ? AND sr.status = 'CONFIRMED'
       GROUP BY sri.product_id`
    )
    .all(quotationId);

  const soldMap = new Map(previouslySoldRows.map((r) => [r.product_id, Number(r.sold_qty)]));

  // Get active warehouses for stock lookup
  const warehouses = await getWarehouses({ activeOnly: true });

  const items = quoteItems.map((qi) => {
    const originalQty = Number(qi.qty);
    const soldQty = soldMap.get(qi.product_id) || 0;
    const remainingQty = Math.max(0, originalQty - soldQty);

    return {
      id: qi.id,
      productId: qi.product_id,
      partNo: qi.part_no,
      description: qi.description,
      hsnSac: qi.hsn_sac,
      unit: qi.unit || 'Nos',
      originalQty,
      previouslySoldQty: soldQty,
      remainingQty,
      unitPrice: Number(qi.price),
    };
  });

  return {
    sourceType: normalizedType.toUpperCase(),
    documentId: docId,
    quotationId,
    poId,
    piId,
    documentNumber,
    documentDate,
    company,
    items,
    warehouses,
  };
}

/**
 * GET Stock Intelligence Analysis & Replenishment Recommendations
 * Aggregates real transactional data from confirmed Sale Reports, Catalogue, Stock Levels, and Reservations.
 * Operates using 0 N+1 queries.
 */
export async function getStockIntelligence({ start = null, end = null, warehouseId = null, productId = null, periodDays = 30, limit = null, offset = null } = {}) {
  let period = Math.max(7, Math.min(365, Number(periodDays) || 30));
  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs > 0) {
      period = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  const whId = warehouseId ? Number(warehouseId) : null;
  const pId = productId ? Number(productId) : null;

  // 1. Preload active warehouses
  const warehouses = await getWarehouses({ activeOnly: true });

  // 2. Query products & stock levels across specified warehouse/product or all
  let stockWhereConditions = [];
  let stockParams = [];

  if (whId) {
    stockWhereConditions.push(`s.warehouse_id = ?`);
    stockParams.push(whId);
  }
  if (pId) {
    stockWhereConditions.push(`p.id = ?`);
    stockParams.push(pId);
  }

  const stockWhereSql = stockWhereConditions.length > 0 ? `WHERE ${stockWhereConditions.join(' AND ')}` : '';

  let stockSql = `
    SELECT
      p.id AS product_id,
      p.part_no,
      p.description,
      p.unit,
      p.hsn_sac,
      p.default_price,
      COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand_quantity,
      COALESCE(SUM(s.reserved_quantity), 0) AS reserved_quantity,
      COALESCE(SUM(s.incoming_quantity), 0) AS incoming_quantity,
      COALESCE(MAX(s.low_stock_threshold), 10) AS low_stock_threshold,
      COALESCE(MAX(s.critical_stock_threshold), 5) AS critical_stock_threshold,
      COUNT(DISTINCT s.warehouse_id) AS warehouse_count
    FROM product p
    LEFT JOIN inventory_stock s ON s.product_id = p.id
    ${stockWhereSql}
    GROUP BY p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price
    ORDER BY p.description ASC
  `;

  const productRows = await db.prepare(stockSql).all(...stockParams);

  // 3. Query confirmed sales consumption for recent period and previous equivalent period
  let salesWhereConditions = [`sr.status = 'CONFIRMED'`];
  let salesParams = [];

  if (whId) {
    salesWhereConditions.push(`sr.warehouse_id = ?`);
  }
  if (pId) {
    salesWhereConditions.push(`sri.product_id = ?`);
  }

  // Date filtering logic
  const pDays = Number(period) || 30;
  let recentDateFilter = `sr.sale_date >= CURRENT_DATE - INTERVAL '${pDays} days'`;
  let previousDateFilter = `sr.sale_date >= CURRENT_DATE - INTERVAL '${pDays * 2} days' AND sr.sale_date < CURRENT_DATE - INTERVAL '${pDays} days'`;

  if (start && end) {
    recentDateFilter = `date(sr.sale_date) >= date(?) AND date(sr.sale_date) <= date(?)`;
    previousDateFilter = `date(sr.sale_date) < date(?)`;
    salesParams.push(
      start, end,
      start, end,
      start, end,
      start, end,
      start,
      start, end,
      start, end
    );
  }

  if (whId) salesParams.push(whId);
  if (pId) salesParams.push(pId);

  let salesSql = `
    SELECT
      sri.product_id,
      SUM(CASE WHEN ${recentDateFilter} THEN sri.quantity ELSE 0 END) AS recent_units_sold,
      SUM(CASE WHEN ${recentDateFilter} THEN sri.total_price ELSE 0 END) AS recent_revenue,
      COUNT(DISTINCT CASE WHEN ${recentDateFilter} THEN sr.id ELSE NULL END) AS recent_sales_count,
      COUNT(DISTINCT CASE WHEN ${recentDateFilter} THEN sr.company_id ELSE NULL END) AS recent_customer_count,
      SUM(CASE WHEN ${previousDateFilter} THEN sri.quantity ELSE 0 END) AS previous_units_sold,
      MIN(CASE WHEN ${recentDateFilter} THEN sr.sale_date ELSE NULL END) AS first_sale_date,
      MAX(CASE WHEN ${recentDateFilter} THEN sr.sale_date ELSE NULL END) AS last_sale_date
    FROM sale_report_item sri
    JOIN sale_report sr ON sr.id = sri.sale_report_id
    WHERE ${salesWhereConditions.join(' AND ')}
    GROUP BY sri.product_id
  `;

  const salesRows = await db.prepare(salesSql).all(...salesParams);
  const salesMap = new Map(salesRows.map((r) => [r.product_id, r]));

  // 4. Compute metrics & structured arrays
  const demandList = [];
  const velocityList = [];
  const coverageList = [];
  const recommendationsList = [];
  const incomingImpactList = [];
  const overstockList = [];

  const products = productRows.map((p) => {
    const sData = salesMap.get(p.product_id) || {};

    const onHand = Number(p.on_hand_quantity);
    const reserved = Number(p.reserved_quantity);
    const available = Math.max(0, onHand - reserved);
    const incoming = Number(p.incoming_quantity);

    const lowThreshold = Number(p.low_stock_threshold);
    const critThreshold = Number(p.critical_stock_threshold);

    const unitsSoldRecent = Number(sData.recent_units_sold || 0);
    const unitsSoldPrevious = Number(sData.previous_units_sold || 0);
    const revenue = Number(sData.recent_revenue || 0);
    const salesCount = Number(sData.recent_sales_count || 0);
    const customerCount = Number(sData.recent_customer_count || 0);

    const avgSellingPrice = unitsSoldRecent > 0 ? Number((revenue / unitsSoldRecent).toFixed(2)) : Number(p.default_price || 0);
    const salesFrequency = Number((salesCount / period).toFixed(3));

    const dailyVelocity = Number((unitsSoldRecent / period).toFixed(2));
    const weeklyVelocity = Number((dailyVelocity * 7).toFixed(2));
    const monthlyVelocity = Math.round(dailyVelocity * 30);

    let daysOfStockRemaining = null;
    if (dailyVelocity > 0) {
      daysOfStockRemaining = Math.floor(available / dailyVelocity);
    }

    let projectedDaysWithIncoming = null;
    if (dailyVelocity > 0) {
      projectedDaysWithIncoming = Math.floor((available + incoming) / dailyVelocity);
    }

    // Demand trend
    let demandTrend = 'STABLE';
    if (unitsSoldRecent === 0 && unitsSoldPrevious === 0) {
      demandTrend = 'NO_DEMAND';
    } else if (unitsSoldPrevious === 0 && unitsSoldRecent > 0) {
      demandTrend = 'INCREASING';
    } else if (unitsSoldPrevious > 0) {
      const pctChange = (unitsSoldRecent - unitsSoldPrevious) / unitsSoldPrevious;
      if (pctChange >= 0.15) demandTrend = 'INCREASING';
      else if (pctChange <= -0.15) demandTrend = 'DECREASING';
      else demandTrend = 'STABLE';
    }

    // Demand Classification
    let demandClassification = 'NO RECENT DEMAND';
    if (dailyVelocity >= 1.5 || unitsSoldRecent >= 50) {
      demandClassification = 'HIGH DEMAND';
    } else if (dailyVelocity >= 0.3 || unitsSoldRecent >= 10) {
      demandClassification = 'MEDIUM DEMAND';
    } else if (unitsSoldRecent > 0) {
      demandClassification = 'LOW DEMAND';
    }

    // Velocity Status
    let velocityStatus = 'DORMANT';
    if (dailyVelocity >= 1.5) velocityStatus = 'FAST_MOVING';
    else if (dailyVelocity >= 0.3) velocityStatus = 'MODERATE_MOVING';
    else if (dailyVelocity > 0) velocityStatus = 'SLOW_MOVING';

    // Stock Status
    let stockStatus = 'healthy';
    if (available === 0) stockStatus = 'out_of_stock';
    else if (available <= critThreshold) stockStatus = 'critical';
    else if (available <= lowThreshold) stockStatus = 'low_stock';

    // Coverage Status
    let coverageStatus = 'HEALTHY';
    if (available === 0) coverageStatus = 'OUT OF STOCK';
    else if (available <= critThreshold) coverageStatus = 'CRITICAL';
    else if (available <= lowThreshold) coverageStatus = 'LOW';
    else if (daysOfStockRemaining !== null && daysOfStockRemaining > 120) coverageStatus = 'OVERSTOCKED';
    else if (dailyVelocity === 0) coverageStatus = 'NO DEMAND';

    // Lead Time & Reorder Point Calculation (Planning Horizon: 14 days)
    const leadTime = 14;
    const safetyStock = Math.max(critThreshold, Math.ceil(dailyVelocity * 7));
    const reorderPoint = Math.ceil(dailyVelocity * leadTime) + safetyStock;

    // Restock Recommendation
    let recommendation = 'NO_ACTION';
    if (available === 0 && unitsSoldRecent > 0) {
      recommendation = 'RESTOCK_NOW';
    } else if (available === 0) {
      recommendation = 'OUT_OF_STOCK';
    } else if (daysOfStockRemaining !== null && daysOfStockRemaining <= 7) {
      recommendation = 'RESTOCK_NOW';
    } else if (daysOfStockRemaining !== null && daysOfStockRemaining <= 15) {
      recommendation = 'RESTOCK_SOON';
    } else if (stockStatus === 'critical' || stockStatus === 'low_stock') {
      recommendation = 'RESTOCK_SOON';
    } else if (daysOfStockRemaining !== null && daysOfStockRemaining <= 45) {
      recommendation = 'MONITOR';
    }

    // Suggested Restock Quantity (Target 30-day coverage)
    let suggestedRestockQty = 0;
    const targetStock = Math.ceil(dailyVelocity * 30);
    if (dailyVelocity > 0) {
      suggestedRestockQty = Math.max(0, targetStock - available - incoming);
    } else if (available < lowThreshold) {
      suggestedRestockQty = Math.max(0, lowThreshold - available - incoming);
    }

    // Restock Priority
    let priority = 'NO ACTION';
    if (available === 0 && unitsSoldRecent > 0) priority = 'URGENT';
    else if (available === 0) priority = 'HIGH';
    else if (recommendation === 'RESTOCK_NOW') priority = 'HIGH';
    else if (recommendation === 'RESTOCK_SOON') priority = 'MEDIUM';
    else if (recommendation === 'MONITOR') priority = 'LOW';

    // Operational Reason string
    let reason = `Stock is healthy with ${available} units available (${daysOfStockRemaining !== null ? `${daysOfStockRemaining} days` : 'sufficient'} coverage).`;
    if (incoming > 0 && available + incoming >= targetStock && dailyVelocity > 0) {
      reason = 'Incoming stock covers projected demand.';
    } else if (available === 0 && unitsSoldRecent > 0) {
      reason = `Product is OUT OF STOCK with active recent demand (${unitsSoldRecent} units sold in ${period} days). Immediate restock required.`;
    } else if (available === 0) {
      reason = `Product is currently out of stock. No recent sales detected in last ${period} days.`;
    } else if (recommendation === 'RESTOCK_NOW' || recommendation === 'RESTOCK_SOON') {
      reason = `Available stock is ${available} units while monthly consumption is ${monthlyConsumption} units. At current velocity (${dailyVelocity} units/day), approximately ${daysOfStockRemaining !== null ? daysOfStockRemaining : 'few'} days of stock remain.`;
    } else if (recommendation === 'MONITOR') {
      reason = `Stock coverage is ${daysOfStockRemaining} days. Monitor sales velocity as reorder threshold approaches.`;
    }

    // Explanation string for UI drawer
    const explanation = reason;

    const pObj = {
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      unit: p.unit || 'Nos',
      hsnSac: p.hsn_sac,
      defaultPrice: Number(p.default_price || 0),
      onHand,
      reserved,
      available,
      incoming,
      lowStockThreshold: lowThreshold,
      criticalStockThreshold: critThreshold,
      unitsSoldRecent,
      unitsSoldPrevious,
      revenue,
      salesCount,
      customerCount,
      avgSellingPrice,
      salesFrequency,
      dailyVelocity,
      weeklyVelocity,
      monthlyVelocity,
      daysOfStockRemaining,
      projectedDaysWithIncoming,
      demandTrend,
      demandClassification,
      velocityStatus,
      stockStatus,
      coverageStatus,
      leadTime,
      safetyStock,
      reorderPoint,
      recommendation,
      suggestedRestockQty,
      priority,
      reason,
      explanation,
      firstSaleDate: sData.first_sale_date || null,
      lastSaleDate: sData.last_sale_date || null,
    };

    // Populate structured sub-arrays
    demandList.push({
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      unitsSold: unitsSoldRecent,
      salesCount,
      customerCount,
      revenue,
      avgSellingPrice,
      firstSaleDate: sData.first_sale_date || null,
      lastSaleDate: sData.last_sale_date || null,
      salesFrequency,
      demandClassification,
    });

    velocityList.push({
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      currentAvailableStock: available,
      unitsSold30Day: unitsSoldRecent,
      dailyVelocity,
      weeklyVelocity,
      monthlyVelocity,
      trend: demandTrend,
      velocityStatus,
    });

    coverageList.push({
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      onHand,
      reserved,
      availableStock: available,
      incoming,
      dailyVelocity,
      coverageDays: daysOfStockRemaining,
      coverageStatus,
    });

    recommendationsList.push({
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      available,
      reserved,
      incoming,
      dailyVelocity,
      coverageDays: daysOfStockRemaining,
      leadTime,
      safetyStock,
      reorderPoint,
      recommendedQty: suggestedRestockQty,
      priority,
      reason,
    });

    incomingImpactList.push({
      productId: p.product_id,
      partNo: p.part_no,
      description: p.description,
      available,
      incoming,
      currentCoverageDays: daysOfStockRemaining,
      projectedCoverageDays: projectedDaysWithIncoming,
      impact: incoming > 0
        ? `Current: ${available} units (${daysOfStockRemaining !== null ? `${daysOfStockRemaining} days` : 'no demand'}), Incoming: +${incoming} units, Projected: ${available + incoming} units (${projectedDaysWithIncoming !== null ? `${projectedDaysWithIncoming} days` : 'no demand'})`
        : 'NO INCOMING STOCK',
    });

    if (daysOfStockRemaining !== null && daysOfStockRemaining > 90) {
      overstockList.push({
        productId: p.product_id,
        partNo: p.part_no,
        description: p.description,
        availableStock: available,
        dailyVelocity,
        coverageDays: daysOfStockRemaining,
        overstockType: 'POTENTIAL_OVERSTOCK',
        reason: `Available stock (${available} units) provides ${daysOfStockRemaining} days of coverage based on recent daily velocity (${dailyVelocity} units/day).`,
      });
    } else if (available > 100 && unitsSoldRecent === 0) {
      overstockList.push({
        productId: p.product_id,
        partNo: p.part_no,
        description: p.description,
        availableStock: available,
        dailyVelocity: 0,
        coverageDays: null,
        overstockType: 'SLOW_DORMANT',
        reason: `No recent confirmed sales detected in the last ${period} days while holding ${available} units in available stock.`,
      });
    }

    return pObj;
  });

  // Apply optional limit / offset to list
  let paginatedProducts = products;
  if (limit !== null) {
    const off = offset ? Number(offset) : 0;
    paginatedProducts = products.slice(off, off + Number(limit));
  }

  // 5. Query recent confirmed Sale Reports for impact view
  let recentSalesSql = `
    SELECT
      sr.id,
      sr.report_number,
      sr.sale_date,
      sr.company_name_snapshot AS company_name,
      sr.total_amount,
      w.name AS warehouse_name,
      COUNT(sri.id) AS product_count,
      SUM(sri.quantity) AS total_quantity
    FROM sale_report sr
    LEFT JOIN sale_report_item sri ON sri.sale_report_id = sr.id
    LEFT JOIN warehouse w ON w.id = sr.warehouse_id
    WHERE sr.status = 'CONFIRMED' ${whId ? 'AND sr.warehouse_id = ?' : ''}
    GROUP BY sr.id, w.name
    ORDER BY sr.sale_date DESC, sr.id DESC
    LIMIT 5
  `;
  const recentSalesParams = whId ? [whId] : [];
  const recentSales = await db.prepare(recentSalesSql).all(...recentSalesParams);

  // 6. Summary KPI metrics
  const totalProducts = products.length;
  const productsAnalyzed = totalProducts;
  const productsSelling = products.filter((p) => p.unitsSoldRecent > 0).length;
  const withStock = products.filter((p) => p.onHand > 0).length;
  const lowStock = products.filter((p) => p.stockStatus === 'low_stock').length;
  const criticalStock = products.filter((p) => p.stockStatus === 'critical').length;
  const outOfStock = products.filter((p) => p.stockStatus === 'out_of_stock').length;
  const needsRestock = products.filter((p) => p.recommendation === 'RESTOCK_NOW' || p.recommendation === 'RESTOCK_SOON').length;
  const productsRequiringRestock = needsRestock;

  const validCoverages = products.filter((p) => p.daysOfStockRemaining !== null).map((p) => p.daysOfStockRemaining);
  const averageStockCoverage = validCoverages.length > 0
    ? Math.round(validCoverages.reduce((sum, val) => sum + val, 0) / validCoverages.length)
    : 0;

  const totalOnHand = products.reduce((sum, p) => sum + p.onHand, 0);
  const totalReserved = products.reduce((sum, p) => sum + p.reserved, 0);
  const totalAvailable = products.reduce((sum, p) => sum + p.available, 0);
  const totalIncoming = products.reduce((sum, p) => sum + p.incoming, 0);
  const incomingUnits = totalIncoming;

  return {
    summary: {
      totalProducts,
      productsAnalyzed,
      productsSelling,
      withStock,
      lowStock,
      criticalStock,
      outOfStock,
      needsRestock,
      productsRequiringRestock,
      averageStockCoverage,
      incomingUnits,
      totalOnHand,
      totalReserved,
      totalAvailable,
      totalIncoming,
    },
    health: {
      healthy: products.filter((p) => p.stockStatus === 'healthy').length,
      low: lowStock,
      critical: criticalStock,
      outOfStock,
      incoming: products.filter((p) => p.incoming > 0).length,
    },
    demand: demandList,
    velocity: velocityList,
    coverage: coverageList,
    recommendations: recommendationsList,
    incomingImpact: incomingImpactList,
    overstock: overstockList,
    products: paginatedProducts,
    recentSales,
    warehouses,
    meta: {
      periodDays: period,
      warehouseId: whId,
      productId: pId,
      start,
      end,
    },
  };
}

// ==================================================
// STEP 12 — INVENTORY OPERATIONS & CONTROL CENTER
// ==================================================

/**
 * Retrieve real-time aggregate KPI metrics for Inventory Operations Control Center
 */
export async function getOperationsOverview({ warehouseId = null } = {}) {
  const whFilter = warehouseId ? `WHERE s.warehouse_id = ${Number(warehouseId)}` : '';
  const whFilterAnd = warehouseId ? `AND s.warehouse_id = ${Number(warehouseId)}` : '';

  const stockStats = await db.prepare(`
    SELECT
      COUNT(DISTINCT s.product_id) AS total_stock_items,
      COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand,
      COALESCE(SUM(s.reserved_quantity), 0) AS total_reserved,
      COALESCE(SUM(s.incoming_quantity), 0) AS total_incoming
    FROM inventory_stock s
    ${whFilter}
  `).get();

  const productStocks = await db.prepare(`
    SELECT
      p.id,
      COALESCE(SUM(s.on_hand_quantity), 0) AS on_hand,
      COALESCE(SUM(s.reserved_quantity), 0) AS reserved,
      COALESCE(SUM(s.incoming_quantity), 0) AS incoming,
      COALESCE(MAX(s.low_stock_threshold), 10) AS low_threshold,
      COALESCE(MAX(s.critical_stock_threshold), 5) AS crit_threshold
    FROM product p
    LEFT JOIN inventory_stock s ON s.product_id = p.id ${whFilterAnd}
    GROUP BY p.id
  `).all();

  let lowStockCount = 0;
  let criticalStockCount = 0;
  let outOfStockCount = 0;
  let healthyCount = 0;

  for (const p of productStocks) {
    const available = Math.max(0, p.on_hand - p.reserved);
    if (available === 0) outOfStockCount++;
    else if (available <= p.crit_threshold) criticalStockCount++;
    else if (available <= p.low_threshold) lowStockCount++;
    else healthyCount++;
  }

  const pendingReservations = await db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS total_units
    FROM stock_reservation
    WHERE status = 'ACTIVE' ${warehouseId ? 'AND warehouse_id = ' + Number(warehouseId) : ''}
  `).get();

  const totalOnHand = Number(stockStats?.total_on_hand) || 0;
  const totalReserved = Number(stockStats?.total_reserved) || 0;
  const totalAvailable = Math.max(0, totalOnHand - totalReserved);
  const totalIncoming = Number(stockStats?.total_incoming) || 0;

  return {
    totalStockItems: Number(stockStats?.total_stock_items) || 0,
    totalTrackedProducts: productStocks.length,
    totalOnHand,
    totalReserved,
    totalAvailable,
    lowStockCount,
    criticalStockCount,
    outOfStockCount,
    healthyCount,
    incomingStockQuantity: totalIncoming,
    pendingReservationsCount: Number(pendingReservations?.count) || 0,
    pendingReservationsUnits: Number(pendingReservations?.total_units) || 0,
  };
}

/**
 * Retrieve operational Stock Alerts
 */
export async function getOperationsStockAlerts({ warehouseId = null, category = null, severity = null, limit = 50, offset = 0 } = {}) {
  const stockSummaryRes = await getStockSummary({ warehouseId, limit: 1000 });
  const intelRes = await getStockIntelligence({ warehouseId, periodDays: 30 });
  const pendingReservationsRes = await getReservations({ warehouseId, status: 'ACTIVE', limit: 100 });
  const selectedWarehouse = warehouseId
    ? await db.prepare(`SELECT name FROM warehouse WHERE id = ?`).get(warehouseId)
    : null;
  const warehouseName = selectedWarehouse?.name || (warehouseId ? 'Warehouse' : 'All Warehouses');

  const alerts = [];
  const nowStr = new Date().toISOString();

  // Out of stock alerts
  for (const item of stockSummaryRes.items) {
    if (item.availableQuantity === 0) {
      alerts.push({
        id: `ALERT-OOS-${item.productId}`,
        alertType: 'OUT_OF_STOCK',
        category: 'OUT_OF_STOCK',
        severity: 'CRITICAL',
        productId: item.productId,
        partNumber: item.partNo,
        description: item.description,
        warehouseId: warehouseId || null,
        warehouseName,
        onHand: item.onHandQuantity,
        reserved: item.reservedQuantity,
        available: item.availableQuantity,
        threshold: item.criticalStockThreshold,
        recommendedAction: item.incomingQuantity > 0 ? 'Monitor Inbound Receipt' : 'Create Immediate Restock Request',
        createdAt: nowStr,
      });
    } else if (item.availableQuantity <= item.criticalStockThreshold) {
      alerts.push({
        id: `ALERT-CRIT-${item.productId}`,
        alertType: 'CRITICAL_STOCK',
        category: 'CRITICAL_STOCK',
        severity: 'CRITICAL',
        productId: item.productId,
        partNumber: item.partNo,
        description: item.description,
        warehouseId: warehouseId || null,
        warehouseName,
        onHand: item.onHandQuantity,
        reserved: item.reservedQuantity,
        available: item.availableQuantity,
        threshold: item.criticalStockThreshold,
        recommendedAction: 'Expedite Restock / Transfer from Central Storage',
        createdAt: nowStr,
      });
    } else if (item.availableQuantity <= item.lowStockThreshold) {
      alerts.push({
        id: `ALERT-LOW-${item.productId}`,
        alertType: 'LOW_STOCK',
        category: 'LOW_STOCK',
        severity: 'WARNING',
        productId: item.productId,
        partNumber: item.partNo,
        description: item.description,
        warehouseId: warehouseId || null,
        warehouseName,
        onHand: item.onHandQuantity,
        reserved: item.reservedQuantity,
        available: item.availableQuantity,
        threshold: item.lowStockThreshold,
        recommendedAction: 'Review Restock Queue',
        createdAt: nowStr,
      });
    }
  }

  // Reservation pressure alerts
  for (const resItem of pendingReservationsRes.reservations) {
    if (resItem.quantity >= 10) {
      alerts.push({
        id: `ALERT-RES-${resItem.id}`,
        alertType: 'RESERVATION_PRESSURE',
        category: 'RESERVATION_PRESSURE',
        severity: 'INFO',
        productId: resItem.productId,
        partNumber: resItem.partNo,
        description: resItem.productDescription,
        warehouseId: resItem.warehouseId,
        warehouseName: resItem.warehouseName,
        onHand: resItem.onHandQuantity || 0,
        reserved: resItem.reservedQuantity || 0,
        available: Math.max(0, (resItem.onHandQuantity || 0) - (resItem.reservedQuantity || 0)),
        threshold: resItem.quantity,
        recommendedAction: 'Review & Fulfill Reservation',
        createdAt: resItem.createdAt,
      });
    }
  }

  // Overstock alerts from intelligence
  for (const item of intelRes.overstock || []) {
    alerts.push({
      id: `ALERT-OVER-${item.productId}`,
      alertType: 'OVERSTOCK',
      category: 'OVERSTOCK',
      severity: 'INFO',
      productId: item.productId,
      partNumber: item.partNo,
      description: item.description,
      warehouseId: warehouseId || null,
      warehouseName,
      onHand: item.onHand,
      reserved: item.reserved,
      available: item.available,
      threshold: 90,
      recommendedAction: 'Consider Inventory Redistribution or Sales Promotion',
      createdAt: nowStr,
    });
  }

  let filtered = alerts;
  if (category) {
    filtered = filtered.filter((a) => a.category.toUpperCase() === String(category).toUpperCase());
  }
  if (severity) {
    filtered = filtered.filter((a) => a.severity.toUpperCase() === String(severity).toUpperCase());
  }

  const paginated = filtered.slice(offset, offset + limit);

  return {
    alerts: paginated,
    total: filtered.length,
    criticalCount: filtered.filter((a) => a.severity === 'CRITICAL').length,
    warningCount: filtered.filter((a) => a.severity === 'WARNING').length,
    infoCount: filtered.filter((a) => a.severity === 'INFO').length,
    limit,
    offset,
  };
}

/**
 * Retrieve Critical Stock items
 */
export async function getOperationsCriticalStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const stockSummaryRes = await getStockSummary({ warehouseId, limit: 1000 });
  const criticalItems = stockSummaryRes.items.filter((item) => item.availableQuantity <= item.criticalStockThreshold);
  const paginated = criticalItems.slice(offset, offset + limit);

  return {
    items: paginated,
    total: criticalItems.length,
    limit,
    offset,
  };
}

/**
 * Retrieve Out of Stock items
 */
export async function getOperationsOutOfStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const stockSummaryRes = await getStockSummary({ warehouseId, limit: 1000 });
  const oosItems = stockSummaryRes.items.filter((item) => item.availableQuantity <= 0);

  const formattedItems = await Promise.all(oosItems.map(async (item) => {
    const lastInRow = await db.prepare(`
      SELECT created_at FROM inventory_movement
      WHERE product_id = ? AND movement_type = 'STOCK_IN'
      ${warehouseId ? 'AND warehouse_id = ' + Number(warehouseId) : ''}
      ORDER BY created_at DESC LIMIT 1
    `).get(item.productId);

    const lastOutRow = await db.prepare(`
      SELECT created_at FROM inventory_movement
      WHERE product_id = ? AND movement_type = 'STOCK_OUT'
      ${warehouseId ? 'AND warehouse_id = ' + Number(warehouseId) : ''}
      ORDER BY created_at DESC LIMIT 1
    `).get(item.productId);

    return {
      ...item,
      incomingStatus: item.incomingQuantity > 0 ? 'INCOMING' : 'NO INCOMING STOCK',
      lastStockIn: lastInRow?.created_at || null,
      lastStockOut: lastOutRow?.created_at || null,
    };
  }));

  const paginated = formattedItems.slice(offset, offset + limit);

  return {
    items: paginated,
    total: formattedItems.length,
    limit,
    offset,
  };
}

/**
 * Retrieve Restock Queue
 */
export async function getOperationsRestockQueue({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const intelRes = await getStockIntelligence({ warehouseId, periodDays: 30 });
  const selectedWarehouse = warehouseId
    ? await db.prepare(`SELECT name FROM warehouse WHERE id = ?`).get(warehouseId)
    : null;
  const warehouseName = selectedWarehouse?.name || (warehouseId ? 'Warehouse' : 'All Warehouses');
  const recs = intelRes.recommendations || [];

  const queue = recs.map((rec, idx) => {
    let priority = 'MEDIUM';
    if (rec.available === 0) priority = 'CRITICAL';
    else if (rec.available <= rec.safetyStock) priority = 'HIGH';

    let status = 'NEEDS_RESTOCK';
    if (rec.incoming > 0) {
      if (rec.incoming >= rec.suggestedOrderQty) status = 'INCOMING';
      else status = 'PARTIALLY_COVERED';
    }

    return {
      priority,
      rank: idx + 1,
      productId: rec.productId,
      partNumber: rec.partNo,
      description: rec.description,
      warehouseId: warehouseId || null,
      warehouseName,
      onHand: rec.onHand,
      reserved: rec.reserved,
      available: rec.available,
      reorderPoint: rec.reorderPoint,
      safetyStock: rec.safetyStock,
      incoming: rec.incoming,
      suggestedRestockQuantity: rec.suggestedOrderQty,
      reason: rec.reason,
      status,
    };
  });

  const paginated = queue.slice(offset, offset + limit);

  return {
    items: paginated,
    total: queue.length,
    criticalCount: queue.filter((q) => q.priority === 'CRITICAL').length,
    highCount: queue.filter((q) => q.priority === 'HIGH').length,
    mediumCount: queue.filter((q) => q.priority === 'MEDIUM').length,
    limit,
    offset,
  };
}

/**
 * Retrieve Incoming Stock items
 */
export async function getOperationsIncomingStock({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT
      r.id AS receipt_id,
      r.receipt_number,
      r.source_type,
      r.source_reference,
      r.status AS receipt_status,
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
    WHERE r.status = 'DRAFT'
  `;
  const params = [];
  if (warehouseId) {
    sql += ` AND r.warehouse_id = ?`;
    params.push(warehouseId);
  }
  sql += ` ORDER BY r.created_at DESC`;

  const rows = await db.prepare(sql).all(...params);
  const items = rows.map((r) => {
    const onHand = Number(r.on_hand || 0);
    const reserved = Number(r.reserved || 0);
    return {
      receiptId: r.receipt_id,
      receiptNumber: r.receipt_number,
      productId: r.product_id,
      partNumber: r.part_no,
      description: r.description,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      incomingQuantity: Number(r.incoming_qty),
      currentOnHand: onHand,
      reserved,
      available: Math.max(0, onHand - reserved),
      source: r.source_type,
      reference: r.source_reference || r.receipt_number,
      status: 'EXPECTED',
      createdAt: r.created_at,
    };
  });

  const paginated = items.slice(offset, offset + limit);

  return {
    items: paginated,
    total: items.length,
    totalIncomingUnits: items.reduce((acc, cur) => acc + cur.incomingQuantity, 0),
    limit,
    offset,
  };
}

/**
 * Retrieve Pending Active Reservations
 */
export async function getOperationsPendingReservations({ warehouseId = null, limit = 50, offset = 0 } = {}) {
  const res = await getReservations({ warehouseId, status: 'ACTIVE', limit: 1000 });
  const reservations = res.reservations;

  const productsAffected = new Set(reservations.map((r) => r.productId)).size;
  const warehousesAffected = new Set(reservations.map((r) => r.warehouseId)).size;
  const totalReservedUnits = reservations.reduce((acc, cur) => acc + cur.quantity, 0);

  const paginated = reservations.slice(offset, offset + limit);

  return {
    reservations: paginated,
    total: reservations.length,
    summary: {
      activeReservationsCount: reservations.length,
      totalReservedUnits,
      productsAffectedCount: productsAffected,
      warehousesAffectedCount: warehousesAffected,
    },
    limit,
    offset,
  };
}

/**
 * Perform transactional Stock Adjustment
 * Direction: 'INCREASE' or 'DECREASE'
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
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const dir = String(direction).toUpperCase();
  if (dir !== 'INCREASE' && dir !== 'DECREASE') {
    throw new Error("Direction must be either 'INCREASE' or 'DECREASE'");
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);

    let targetOnHand = beforeOnHand;
    if (dir === 'INCREASE') {
      targetOnHand = beforeOnHand + qty;
    } else {
      targetOnHand = beforeOnHand - qty;
    }

    if (targetOnHand < 0) {
      throw new Error(`Stock adjustment would result in negative on-hand quantity (${targetOnHand})`);
    }

    if (targetOnHand < beforeReserved) {
      throw new Error(`Cannot adjust on-hand stock below reserved quantity (${beforeReserved}). Available: ${Math.max(0, beforeOnHand - beforeReserved)}`);
    }

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(targetOnHand, warehouseId, productId);

    const fullReason = notes ? `${reason} - ${notes}` : reason;

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, 'STOCK_ADJUSTMENT', NULL, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        beforeOnHand,
        targetOnHand,
        beforeReserved,
        beforeReserved,
        fullReason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Perform transactional Stock Return
 */
export async function createStockReturn({
  warehouseId,
  productId,
  quantity,
  referenceType = 'MANUAL',
  referenceId = null,
  reason = 'Customer Stock Return',
  notes = '',
  userId = null,
}) {
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const product = await db.prepare(`SELECT id FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) throw new Error('Warehouse not found');

  return db.transaction(async () => {
    const current = await getOrCreateStockRow(warehouseId, productId);
    const beforeOnHand = Number(current.on_hand_quantity);
    const beforeReserved = Number(current.reserved_quantity);
    const afterOnHand = beforeOnHand + qty;

    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(afterOnHand, warehouseId, productId);

    const fullReason = notes ? `${reason} - ${notes}` : reason;

    const movementInfo = await db
      .prepare(
        `INSERT INTO inventory_movement (
           warehouse_id, product_id, movement_type, quantity,
           before_on_hand, after_on_hand, before_reserved, after_reserved,
           reference_type, reference_id, reason, created_by
         ) VALUES (?, ?, 'RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .run(
        warehouseId,
        productId,
        qty,
        beforeOnHand,
        afterOnHand,
        beforeReserved,
        beforeReserved,
        referenceType,
        referenceId ? String(referenceId) : null,
        fullReason,
        userId
      );

    const updatedStock = await db
      .prepare(`SELECT * FROM inventory_stock WHERE warehouse_id = ? AND product_id = ?`)
      .get(warehouseId, productId);

    const movement = await db
      .prepare(`SELECT * FROM inventory_movement WHERE id = ?`)
      .get(movementInfo.lastInsertRowid);

    return { stock: updatedStock, movement };
  });
}

/**
 * Perform transactional Warehouse Transfer
 */
export async function createStockTransfer({
  sourceWarehouseId,
  destinationWarehouseId,
  productId,
  quantity,
  reference = '',
  notes = '',
  userId = null,
}) {
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Quantity must be greater than zero');
  }

  const srcId = Number(sourceWarehouseId);
  const destId = Number(destinationWarehouseId);

  if (!srcId || !destId) {
    throw new Error('Source warehouse and destination warehouse are required');
  }

  if (srcId === destId) {
    throw new Error('Source and destination warehouses cannot be the same');
  }

  const product = await db.prepare(`SELECT id, part_no, description FROM product WHERE id = ?`).get(productId);
  if (!product) throw new Error('Product not found');

  const srcWarehouse = await getWarehouseById(srcId);
  if (!srcWarehouse) throw new Error('Source warehouse not found');

  const destWarehouse = await getWarehouseById(destId);
  if (!destWarehouse) throw new Error('Destination warehouse not found');

  return db.transaction(async () => {
    const srcStock = await getOrCreateStockRow(srcId, productId);
    const srcBeforeOnHand = Number(srcStock.on_hand_quantity);
    const srcBeforeReserved = Number(srcStock.reserved_quantity);
    const srcAvailable = srcBeforeOnHand - srcBeforeReserved;

    if (qty > srcAvailable) {
      throw new Error(`Insufficient available stock in source warehouse (${srcWarehouse.name}). Requested: ${qty}, Available: ${srcAvailable}`);
    }

    const srcAfterOnHand = srcBeforeOnHand - qty;

    const destStock = await getOrCreateStockRow(destId, productId);
    const destBeforeOnHand = Number(destStock.on_hand_quantity);
    const destBeforeReserved = Number(destStock.reserved_quantity);
    const destAfterOnHand = destBeforeOnHand + qty;

    // Deduct source stock
    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(srcAfterOnHand, srcId, productId);

    // Add destination stock
    await db.prepare(
      `UPDATE inventory_stock
       SET on_hand_quantity = ?,
           updated_at = NOW()
       WHERE warehouse_id = ? AND product_id = ?`
    ).run(destAfterOnHand, destId, productId);

    const transferNumber = await nextNumber('TRF', 'stock_transfer', 'transfer_number');

    const transferInfo = await db
      .prepare(
        `INSERT INTO stock_transfer (
           transfer_number, source_warehouse_id, destination_warehouse_id, product_id,
           quantity, status, reference, notes,
           source_before_on_hand, source_after_on_hand,
           dest_before_on_hand, dest_after_on_hand,
           created_by, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING id`
      )
      .run(
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
        userId
      );

    // Record TRANSFER_OUT movement for source
    await db.prepare(
      `INSERT INTO inventory_movement (
         warehouse_id, product_id, movement_type, quantity,
         before_on_hand, after_on_hand, before_reserved, after_reserved,
         reference_type, reference_id, reason, created_by
       ) VALUES (?, ?, 'TRANSFER_OUT', ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?) RETURNING id`
    ).run(
      srcId,
      productId,
      qty,
      srcBeforeOnHand,
      srcAfterOnHand,
      srcBeforeReserved,
      srcBeforeReserved,
      transferNumber,
      `Transfer to ${destWarehouse.name} (${destWarehouse.code})`,
      userId
    );

    // Record TRANSFER_IN movement for destination
    await db.prepare(
      `INSERT INTO inventory_movement (
         warehouse_id, product_id, movement_type, quantity,
         before_on_hand, after_on_hand, before_reserved, after_reserved,
         reference_type, reference_id, reason, created_by
       ) VALUES (?, ?, 'TRANSFER_IN', ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?) RETURNING id`
    ).run(
      destId,
      productId,
      qty,
      destBeforeOnHand,
      destAfterOnHand,
      destBeforeReserved,
      destBeforeReserved,
      transferNumber,
      `Transfer from ${srcWarehouse.name} (${srcWarehouse.code})`,
      userId
    );

    const transfer = await getTransferById(transferInfo.lastInsertRowid);
    return transfer;
  });
}

/**
 * Retrieve Stock Transfers history
 */
export async function getStockTransfers({ warehouseId = null, status = null, limit = 50, offset = 0 } = {}) {
  let whereConditions = [];
  let params = [];

  if (warehouseId) {
    whereConditions.push(`(t.source_warehouse_id = ? OR t.destination_warehouse_id = ?)`);
    params.push(warehouseId, warehouseId);
  }

  if (status) {
    whereConditions.push(`t.status = ?`);
    params.push(String(status).toUpperCase());
  }

  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM stock_transfer t ${whereSql}`).get(...params);
  const total = countRow ? countRow.total : 0;

  const sql = `
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
    LEFT JOIN "user" u ON u.id = t.created_by
    ${whereSql}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await db.prepare(sql).all(...params, limit, offset);
  const transfers = rows.map((r) => ({
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
    productUnit: r.product_unit,
    quantity: Number(r.quantity),
    status: r.status,
    reference: r.reference,
    notes: r.notes,
    sourceBeforeOnHand: Number(r.source_before_on_hand),
    sourceAfterOnHand: Number(r.source_after_on_hand),
    destBeforeOnHand: Number(r.dest_before_on_hand),
    destAfterOnHand: Number(r.dest_after_on_hand),
    createdBy: r.created_by_username || 'System',
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  }));

  return { transfers, total, limit, offset };
}

/**
 * Retrieve a single Stock Transfer by ID
 */
export async function getTransferById(id) {
  const sql = `
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
    LEFT JOIN "user" u ON u.id = t.created_by
    WHERE t.id = ?
  `;

  const r = await db.prepare(sql).get(id);
  if (!r) return null;

  const movements = await db.prepare(`
    SELECT m.*, w.name AS warehouse_name
    FROM inventory_movement m
    JOIN warehouse w ON w.id = m.warehouse_id
    WHERE m.reference_type = 'STOCK_TRANSFER' AND m.reference_id = ?
    ORDER BY m.id ASC
  `).all(r.transfer_number);

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
    productUnit: r.product_unit,
    quantity: Number(r.quantity),
    status: r.status,
    reference: r.reference,
    notes: r.notes,
    sourceBeforeOnHand: Number(r.source_before_on_hand),
    sourceAfterOnHand: Number(r.source_after_on_hand),
    destBeforeOnHand: Number(r.dest_before_on_hand),
    destAfterOnHand: Number(r.dest_after_on_hand),
    createdBy: r.created_by_username || 'System',
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    movements,
  };
}

/**
 * Retrieve Inventory Audit Log with Summary Metrics
 */
export async function getOperationsInventoryAudit({
  warehouseId = null,
  productId = null,
  movementType = null,
  userId = null,
  start = null,
  end = null,
  limit = 50,
  offset = 0,
} = {}) {
  const movementRes = await getMovements({
    warehouseId,
    productId,
    movementType,
    limit,
    offset,
  });

  // Calculate audit type breakdowns
  let whereConditions = [];
  let params = [];
  if (warehouseId) {
    whereConditions.push(`warehouse_id = ?`);
    params.push(warehouseId);
  }
  if (productId) {
    whereConditions.push(`product_id = ?`);
    params.push(productId);
  }
  if (movementType) {
    whereConditions.push(`movement_type = ?`);
    params.push(movementType);
  }
  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const summaryStats = await db.prepare(`
    SELECT
      COUNT(*) AS total_movements,
      COALESCE(SUM(CASE WHEN movement_type = 'STOCK_IN' THEN quantity ELSE 0 END), 0) AS stock_in_units,
      COALESCE(SUM(CASE WHEN movement_type = 'STOCK_OUT' THEN quantity ELSE 0 END), 0) AS stock_out_units,
      COALESCE(SUM(CASE WHEN movement_type = 'RETURN' THEN quantity ELSE 0 END), 0) AS return_units,
      COALESCE(SUM(CASE WHEN movement_type = 'ADJUSTMENT' THEN quantity ELSE 0 END), 0) AS adjustment_units,
      COALESCE(SUM(CASE WHEN movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN quantity ELSE 0 END), 0) AS transfer_units
    FROM inventory_movement
    ${whereSql}
  `).get(...params);

  return {
    movements: movementRes.movements,
    total: movementRes.total,
    summary: {
      totalMovements: Number(summaryStats?.total_movements) || 0,
      stockInUnits: Number(summaryStats?.stock_in_units) || 0,
      stockOutUnits: Number(summaryStats?.stock_out_units) || 0,
      returnUnits: Number(summaryStats?.return_units) || 0,
      adjustmentUnits: Number(summaryStats?.adjustment_units) || 0,
      transferUnits: Number(summaryStats?.transfer_units) || 0,
    },
    limit,
    offset,
  };
}

export async function getQuotationStockAnalysis({ productId = null, partNo = null, warehouseId = null, requestedQuantity = 1 }, customDb = db) {
  const database = customDb || db;
  let product = null;
  if (productId) {
    product = await database.prepare(`SELECT * FROM product WHERE id = ?`).get(Number(productId));
  } else if (partNo) {
    product = await database.prepare(`SELECT * FROM product WHERE part_no = ?`).get(String(partNo).trim());
  }

  const reqQty = Number(requestedQuantity) || 1;

  if (!product) {
    return {
      product_id: null,
      part_no: partNo || 'CUSTOM',
      description: 'Custom / Un-tracked Product',
      quoted_qty: reqQty,
      on_hand: 0,
      reserved: 0,
      available: 0,
      incoming: 0,
      shortage: 0,
      status: 'NOT_TRACKED',
    };
  }

  const pId = product.id;
  let whId = Number(warehouseId);
  if (!whId) {
    const defaultWh = await database.prepare(`SELECT id FROM warehouse WHERE is_default = 1 LIMIT 1`).get();
    whId = defaultWh ? defaultWh.id : 1;
  }

  const warehouse = await database.prepare(`SELECT * FROM warehouse WHERE id = ?`).get(whId);

  const stockRow = await database.prepare(`
    SELECT
      COALESCE(on_hand_quantity, 0) AS on_hand,
      COALESCE(reserved_quantity, 0) AS reserved,
      COALESCE(incoming_quantity, 0) AS incoming
    FROM inventory_stock
    WHERE warehouse_id = ? AND product_id = ?
  `).get(whId, pId) || { on_hand: 0, reserved: 0, incoming: 0 };

  const onHand = Number(stockRow.on_hand);
  const reserved = Number(stockRow.reserved);
  const incoming = Number(stockRow.incoming);
  const available = Math.max(0, onHand - reserved);

  let status = 'AVAILABLE';
  let shortage = 0;

  if (available >= reqQty) {
    status = 'AVAILABLE';
    shortage = 0;
  } else if (available > 0) {
    status = 'PARTIAL';
    shortage = reqQty - available;
  } else if (incoming > 0) {
    status = 'INCOMING';
    shortage = reqQty - available;
  } else {
    status = 'OUT_OF_STOCK';
    shortage = reqQty - available;
  }

  return {
    product_id: pId,
    part_no: product.part_no,
    description: product.description,
    quoted_qty: reqQty,
    on_hand: onHand,
    reserved: reserved,
    available: available,
    incoming: incoming,
    shortage: shortage,
    status: status,
    warehouse_id: whId,
    warehouse_name: warehouse ? warehouse.name : null,
  };
}
