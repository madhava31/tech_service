import db from './index.js';

// The inventory tables were added to some databases by hand and never made it into schema.sql,
// so a database bootstrapped from schema.sql alone has no `warehouse` / `inventory_stock` / ...
// tables and every inventory endpoint fails with "relation does not exist". Creating them on
// first use (IF NOT EXISTS, so existing databases are untouched) keeps every deployment working.
//
// created_by / reserved_by reference app_user here. Older databases reference a separate "user"
// table instead; getUserTable() detects which one the live FK points at so inserts and username
// joins stay correct on both.
const INVENTORY_DDL = `
CREATE TABLE IF NOT EXISTS warehouse (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  city TEXT,
  state TEXT,
  branch_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_stock (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  on_hand_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  incoming_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (incoming_quantity >= 0),
  low_stock_threshold DOUBLE PRECISION DEFAULT 10,
  critical_stock_threshold DOUBLE PRECISION DEFAULT 5,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, product_id),
  CHECK (on_hand_quantity >= reserved_quantity)
);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_product ON inventory_stock(product_id);

CREATE TABLE IF NOT EXISTS inventory_movement (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('STOCK_IN', 'STOCK_OUT', 'RETURN', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK')),
  quantity DOUBLE PRECISION NOT NULL,
  before_on_hand DOUBLE PRECISION NOT NULL,
  after_on_hand DOUBLE PRECISION NOT NULL,
  before_reserved DOUBLE PRECISION NOT NULL DEFAULT 0,
  after_reserved DOUBLE PRECISION NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_wh_prod ON inventory_movement(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movement_ref ON inventory_movement(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS stock_reservation (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FULFILLED', 'CANCELLED', 'RELEASED')),
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  reserved_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP,
  fulfilled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_receipt (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  receipt_number TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'MANUAL',
  source_reference TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  notes TEXT,
  created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_wh ON stock_receipt(warehouse_id);

CREATE TABLE IF NOT EXISTS stock_receipt_item (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES stock_receipt(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product(id),
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  before_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  after_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer (
  id SERIAL PRIMARY KEY,
  transfer_number TEXT NOT NULL UNIQUE,
  source_warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  destination_warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
  reference TEXT,
  notes TEXT,
  source_before_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  source_after_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  dest_before_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  dest_after_on_hand DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_src_wh ON stock_transfer(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_dest_wh ON stock_transfer(destination_warehouse_id);
`;

let schemaReady = null;

export function ensureInventorySchema() {
  if (!schemaReady) {
    schemaReady = db.pool.query(INVENTORY_DDL).catch((err) => {
      // Let the next request retry instead of caching a transient failure (e.g. a cold DB).
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const userTablePromises = new Map();

/**
 * Returns the quoted table name that <table>.created_by references ('"user"' on older databases,
 * 'app_user' otherwise). Defaults to inventory_movement; other tables (e.g. sale_report) can
 * reference a different user table on older databases, so each table is checked separately.
 */
export function getUserTable(table = 'inventory_movement') {
  if (!userTablePromises.has(table)) {
    const promise = db
      .prepare(`
        SELECT ccu.table_name AS ref_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = current_schema()
          AND tc.table_name = ?
          AND kcu.column_name = 'created_by'
        LIMIT 1
      `)
      .get(table)
      .then((row) => (row?.ref_table === 'user' ? '"user"' : 'app_user'))
      .catch((err) => {
        userTablePromises.delete(table);
        throw err;
      });
    userTablePromises.set(table, promise);
  }
  return userTablePromises.get(table);
}

/**
 * Maps the logged-in app_user to an id that satisfies <table>.created_by's foreign key, or null.
 */
export async function resolveUserId(sessionUser, table = 'inventory_movement') {
  if (!sessionUser?.id) return null;
  const userTable = await getUserTable(table);
  if (userTable === 'app_user') return sessionUser.id;
  try {
    const byName = sessionUser.username
      ? await db.prepare(`SELECT id FROM "user" WHERE username = ?`).get(sessionUser.username)
      : null;
    if (byName) return byName.id;
    const byId = await db.prepare(`SELECT id FROM "user" WHERE id = ?`).get(sessionUser.id);
    return byId ? byId.id : null;
  } catch {
    return null;
  }
}
