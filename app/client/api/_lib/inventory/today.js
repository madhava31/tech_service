// "Today": what came into the warehouse and what went out today (India time), what is ready to ship, and the latest movements.
// Built from the movement history, so it always agrees with the stock figures. Used by the panel at the top of the
// Inventory overview.
import db from '../db/index.js';
import { todayIST, utcStartOf, LOCAL_TIME } from './movementReport.js';
import { loadWaitingOrders } from './waitingOrders.js';

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** The UTC start of today and of tomorrow (India days), as stored in created_at. */
export function dayBounds(now = Date.now()) {
  const day = todayIST(now);
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, startUtc: utcStartOf(day), endUtc: utcStartOf(next.toISOString().slice(0, 10)) };
}

/** Pure: totals from the per-type rows [{ movement_type, lines, units }]. */
export function totalsFromTypes(rows) {
  const pick = (types) => {
    const hit = rows.filter((r) => types.includes(r.movement_type));
    return { lines: hit.reduce((a, r) => a + Number(r.lines || 0), 0), units: r3(hit.reduce((a, r) => a + Number(r.units || 0), 0)) };
  };
  return { received: pick(['STOCK_IN', 'OPENING_STOCK']), sent: pick(['STOCK_OUT']), returned: pick(['RETURN']), adjusted: pick(['ADJUSTMENT']) };
}

export async function getToday(ctx = {}, now = Date.now()) {
  const { day, startUtc, endUtc } = dayBounds(now);
  const range = [startUtc, endUtc];
  const types = await db
    .prepare(
      `SELECT m.movement_type, COUNT(*)::int AS lines, COALESCE(SUM(ABS(m.after_on_hand - m.before_on_hand)), 0)::float8 AS units
         FROM inventory_movement m WHERE m.created_at >= ? AND m.created_at < ? GROUP BY m.movement_type`
    )
    .all(...range);
  const receipts = await db
    .prepare(`SELECT COUNT(DISTINCT m.reference_id)::int AS n FROM inventory_movement m WHERE m.created_at >= ? AND m.created_at < ? AND m.reference_type = 'STOCK_RECEIPT'`)
    .get(...range);
  const invoices = await db
    .prepare(`SELECT COUNT(DISTINCT m.reference_id)::int AS n FROM inventory_movement m WHERE m.created_at >= ? AND m.created_at < ? AND m.reference_type = 'QUOTATION_INVOICE' AND m.movement_type = 'STOCK_OUT'`)
    .get(...range);
  const movements = await db
    .prepare(
      `SELECT to_char(${LOCAL_TIME}, 'HH24:MI') AS at, p.part_no, p.description, m.movement_type, (m.after_on_hand - m.before_on_hand)::float8 AS change,
              m.reference_type, m.reference_id, m.reason
         FROM inventory_movement m JOIN product p ON p.id = m.product_id
        WHERE m.created_at >= ? AND m.created_at < ? ORDER BY m.id DESC LIMIT 12`
    )
    .all(...range);
  let waiting = null;
  try {
    waiting = (await loadWaitingOrders({}, ctx)).summary;
  } catch (err) {
    console.error('[today] could not read the waiting orders:', err?.message);
  }
  const t = totalsFromTypes(types);
  return {
    date: day,
    received: { ...t.received, receipts: Number(receipts?.n || 0) },
    sent: { ...t.sent, invoices: Number(invoices?.n || 0) },
    returned: t.returned,
    adjusted: t.adjusted,
    waiting,
    movements,
  };
}
