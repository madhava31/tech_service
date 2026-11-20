// Stock Intelligence: per-product limits and real demand. Demand is what actually left the warehouse (STOCK_OUT movements) in the
// period, compared with the period before it. Nothing here writes anything except setLimits().
import db from '../db/index.js';

const DEFAULT_LOW = 10;
const DEFAULT_CRITICAL = 5;
const LEAD_DAYS = 15; // how long new stock takes to arrive
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => Number(v || 0);

export function trendOf(recent, previous) {
  if (recent <= 0 && previous <= 0) return 'NO_DEMAND';
  if (recent > previous * 1.2) return 'INCREASING';
  if (recent < previous * 0.8) return 'DECREASING';
  return 'STABLE';
}

/** Pure: one product's analysis from its stock row and its demand row. */
export function analyseProduct(p, d, periodDays) {
  const onHand = num(p.on_hand), reserved = num(p.reserved), incoming = num(p.incoming);
  const low = num(p.low_threshold) || DEFAULT_LOW;
  const crit = Math.min(num(p.critical_threshold) || DEFAULT_CRITICAL, low);
  const available = Math.max(0, onHand - reserved);
  const recent = num(d?.recent), previous = num(d?.previous);
  const velocity = recent / periodDays;
  const days = velocity > 0 ? available / velocity : null;
  const projected = velocity > 0 ? (available + incoming) / velocity : null;

  const stockStatus = onHand <= 0 ? 'out_of_stock' : available <= crit ? 'critical' : available <= low ? 'low_stock' : 'healthy';
  let recommendation = 'NO_ACTION';
  if (stockStatus === 'out_of_stock') recommendation = 'OUT_OF_STOCK';
  else if (stockStatus === 'critical' || (days !== null && days <= 7)) recommendation = 'RESTOCK_NOW';
  else if (stockStatus === 'low_stock' || (days !== null && days <= LEAD_DAYS)) recommendation = 'RESTOCK_SOON';
  else if (days !== null && days <= 30) recommendation = 'MONITOR';
  // Stock already on its way that covers the shortfall: no need to order more now.
  if ((recommendation === 'RESTOCK_SOON' || recommendation === 'MONITOR') && incoming > 0 && available + incoming > low && (projected === null || projected > LEAD_DAYS)) recommendation = 'MONITOR';

  let suggested = 0;
  if (recommendation === 'RESTOCK_NOW' || recommendation === 'RESTOCK_SOON' || recommendation === 'OUT_OF_STOCK') {
    const target = Math.max(low * 2, Math.ceil(velocity * 45));
    suggested = Math.max(0, Math.ceil(target - available - incoming));
  }
  const priority = { OUT_OF_STOCK: 'CRITICAL', RESTOCK_NOW: 'HIGH', RESTOCK_SOON: 'MEDIUM', MONITOR: 'LOW', NO_ACTION: 'NONE' }[recommendation];
  const explanation =
    stockStatus === 'out_of_stock' ? 'None in stock.'
      : velocity > 0 ? `${r2(available)} available, about ${r2(velocity * 30)} used a month, so roughly ${Math.floor(days)} days of stock.`
        : `${r2(available)} available. Nothing has gone out in this period.`;
  return {
    productId: p.id, partNo: p.part_no, description: p.description, unit: p.unit || 'Nos', hsnSac: p.hsn_sac || null,
    defaultPrice: num(p.default_price), onHand, reserved, available, incoming,
    lowStockThreshold: low, criticalStockThreshold: crit,
    unitsSoldRecent: r2(recent), unitsSoldPrevious: r2(previous), revenue: 0, salesCount: num(d?.movements),
    dailyVelocity: r2(velocity), monthlyConsumption: r2(velocity * 30),
    daysOfStockRemaining: days === null ? null : Math.floor(days),
    projectedDaysWithIncoming: projected === null ? null : Math.floor(projected),
    demandTrend: trendOf(recent, previous), stockStatus, recommendation, suggestedRestockQty: suggested, priority, explanation,
    firstSaleDate: d?.first_at || null, lastSaleDate: d?.last_at || null,
  };
}

const demandClass = (units, days) => (units <= 0 ? 'NO RECENT DEMAND' : units / days >= 1 ? 'HIGH DEMAND' : units / days >= 0.25 ? 'MEDIUM DEMAND' : 'LOW DEMAND');

/** Pure: the whole response from analysed items. */
export function buildResponse(items, { warehouses = [], periodDays, warehouseId = null, productId = null, start = null, end = null } = {}) {
  const sum = (k) => items.reduce((a, i) => a + i[k], 0);
  const count = (s) => items.filter((i) => i.stockStatus === s).length;
  const low = count('low_stock'), critical = count('critical'), out = count('out_of_stock');
  const needs = items.filter((i) => ['OUT_OF_STOCK', 'RESTOCK_NOW', 'RESTOCK_SOON'].includes(i.recommendation));
  const selling = items.filter((i) => i.unitsSoldRecent > 0);
  const covs = items.filter((i) => i.daysOfStockRemaining !== null).map((i) => i.daysOfStockRemaining);
  const base = (i) => ({ productId: i.productId, partNo: i.partNo, description: i.description });
  const covStatus = (i) => (i.stockStatus === 'out_of_stock' ? 'OUT OF STOCK' : i.stockStatus === 'critical' ? 'CRITICAL' : i.stockStatus === 'low_stock' ? 'LOW'
    : i.daysOfStockRemaining === null ? 'NO DEMAND' : i.daysOfStockRemaining > 180 ? 'OVERSTOCKED' : 'HEALTHY');
  return {
    summary: {
      totalProducts: items.length, productsAnalyzed: items.length, productsSelling: selling.length,
      withStock: items.filter((i) => i.onHand > 0).length, lowStock: low, criticalStock: critical, outOfStock: out,
      needsRestock: needs.length, productsRequiringRestock: needs.length,
      averageStockCoverage: covs.length ? Math.round(covs.reduce((a, b) => a + b, 0) / covs.length) : 0,
      incomingUnits: sum('incoming'), totalOnHand: sum('onHand'), totalReserved: sum('reserved'), totalAvailable: sum('available'), totalIncoming: sum('incoming'),
    },
    health: { healthy: count('healthy'), low, critical, outOfStock: out, incoming: items.filter((i) => i.incoming > 0).length },
    demand: items.filter((i) => i.unitsSoldRecent > 0).sort((a, b) => b.unitsSoldRecent - a.unitsSoldRecent).slice(0, 100).map((i) => ({
      ...base(i), unitsSold: i.unitsSoldRecent, salesCount: i.salesCount, customerCount: 0, revenue: 0, avgSellingPrice: 0,
      firstSaleDate: i.firstSaleDate, lastSaleDate: i.lastSaleDate, salesFrequency: r2(i.salesCount / periodDays), demandClassification: demandClass(i.unitsSoldRecent, periodDays),
    })),
    velocity: selling.sort((a, b) => b.dailyVelocity - a.dailyVelocity).slice(0, 100).map((i) => ({
      ...base(i), currentAvailableStock: i.available, unitsSold30Day: i.unitsSoldRecent, dailyVelocity: i.dailyVelocity, weeklyVelocity: r2(i.dailyVelocity * 7),
      monthlyVelocity: i.monthlyConsumption, trend: i.demandTrend,
      velocityStatus: i.dailyVelocity >= 1 ? 'FAST_MOVING' : i.dailyVelocity >= 0.25 ? 'MODERATE_MOVING' : 'SLOW_MOVING',
    })),
    coverage: items.filter((i) => i.unitsSoldRecent > 0 || i.stockStatus !== 'healthy').slice(0, 200).map((i) => ({
      ...base(i), onHand: i.onHand, reserved: i.reserved, availableStock: i.available, incoming: i.incoming, dailyVelocity: i.dailyVelocity,
      coverageDays: i.daysOfStockRemaining, coverageStatus: covStatus(i),
    })),
    recommendations: needs.sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM'].indexOf(a.priority) - ['CRITICAL', 'HIGH', 'MEDIUM'].indexOf(b.priority)).map((i) => ({
      ...base(i), available: i.available, reserved: i.reserved, incoming: i.incoming, dailyVelocity: i.dailyVelocity, coverageDays: i.daysOfStockRemaining,
      leadTime: LEAD_DAYS, safetyStock: i.criticalStockThreshold, reorderPoint: i.lowStockThreshold, recommendedQty: i.suggestedRestockQty,
      priority: i.priority === 'CRITICAL' ? 'URGENT' : i.priority, reason: i.explanation,
    })),
    incomingImpact: items.filter((i) => i.incoming > 0).map((i) => ({
      ...base(i), available: i.available, incoming: i.incoming, currentCoverageDays: i.daysOfStockRemaining, projectedCoverageDays: i.projectedDaysWithIncoming,
      impact: i.projectedDaysWithIncoming === null ? 'Stock on the way. No recent demand to measure against.' : `Stock on the way lifts cover to about ${i.projectedDaysWithIncoming} days.`,
    })),
    overstock: items.filter((i) => i.onHand > 0 && (i.daysOfStockRemaining === null ? i.available > i.lowStockThreshold * 5 : i.daysOfStockRemaining > 180)).slice(0, 100).map((i) => ({
      ...base(i), availableStock: i.available, dailyVelocity: i.dailyVelocity, coverageDays: i.daysOfStockRemaining,
      overstockType: i.daysOfStockRemaining === null ? 'SLOW_DORMANT' : 'POTENTIAL_OVERSTOCK',
      reason: i.daysOfStockRemaining === null ? 'Nothing has gone out in this period.' : `About ${i.daysOfStockRemaining} days of stock at the current pace.`,
    })),
    products: items,
    recentSales: [],
    warehouses,
    meta: { periodDays, warehouseId, productId, start, end },
  };
}

function parseDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
}

export async function getStockIntelligence(query = {}, now = Date.now()) {
  const whId = Number(query.warehouseId) > 0 ? Number(query.warehouseId) : null;
  const productId = Number(query.productId) > 0 ? Number(query.productId) : null;
  let start = parseDay(query.start), end = parseDay(query.end);
  let periodDays = Math.min(Math.max(Math.floor(Number(query.period || query.days) || 30), 1), 730);
  const DAY = 86400000;
  let endMs = end ? Date.parse(`${end}T00:00:00Z`) + DAY : now;
  let startMs = start ? Date.parse(`${start}T00:00:00Z`) : endMs - periodDays * DAY;
  if (start && end) periodDays = Math.max(1, Math.round((endMs - startMs) / DAY));
  const prevMs = startMs - (endMs - startMs);
  const ts = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

  const whJoin = whId ? ' AND s.warehouse_id = ?' : '';
  const stockParams = [...(whId ? [whId] : []), ...(productId ? [productId] : [])];
  const [warehouses, products] = await Promise.all([
    db.prepare(`SELECT * FROM warehouse WHERE is_active = 1 ORDER BY is_default DESC, id ASC`).all(),
    db.prepare(
      `SELECT p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price,
              COALESCE(SUM(s.on_hand_quantity), 0)::float8 AS on_hand, COALESCE(SUM(s.reserved_quantity), 0)::float8 AS reserved,
              COALESCE(SUM(s.incoming_quantity), 0)::float8 AS incoming,
              COALESCE(MAX(s.low_stock_threshold), ${DEFAULT_LOW}) AS low_threshold, COALESCE(MAX(s.critical_stock_threshold), ${DEFAULT_CRITICAL}) AS critical_threshold
         FROM product p LEFT JOIN inventory_stock s ON s.product_id = p.id${whJoin}
        ${productId ? 'WHERE p.id = ?' : ''}
        GROUP BY p.id, p.part_no, p.description, p.unit, p.hsn_sac, p.default_price ORDER BY p.part_no ASC`
    ).all(...stockParams),
  ]);
  const demandRows = await db.prepare(
    `SELECT m.product_id,
            COALESCE(SUM(CASE WHEN m.created_at >= ? THEN m.before_on_hand - m.after_on_hand ELSE 0 END), 0)::float8 AS recent,
            COALESCE(SUM(CASE WHEN m.created_at < ? THEN m.before_on_hand - m.after_on_hand ELSE 0 END), 0)::float8 AS previous,
            COUNT(CASE WHEN m.created_at >= ? THEN 1 END)::int AS movements,
            to_char(MIN(CASE WHEN m.created_at >= ? THEN m.created_at END), 'YYYY-MM-DD') AS first_at,
            to_char(MAX(CASE WHEN m.created_at >= ? THEN m.created_at END), 'YYYY-MM-DD') AS last_at
       FROM inventory_movement m
      WHERE m.movement_type = 'STOCK_OUT' AND m.created_at >= ? AND m.created_at < ?${whId ? ' AND m.warehouse_id = ?' : ''}${productId ? ' AND m.product_id = ?' : ''}
      GROUP BY m.product_id`
  ).all(ts(startMs), ts(startMs), ts(startMs), ts(startMs), ts(startMs), ts(prevMs), ts(endMs), ...(whId ? [whId] : []), ...(productId ? [productId] : []));
  const byProduct = new Map(demandRows.map((d) => [Number(d.product_id), d]));
  const items = products.map((p) => analyseProduct(p, byProduct.get(Number(p.id)), periodDays));
  return buildResponse(items, {
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code, address: w.address || '', city: w.city || '', state: w.state || '', is_default: num(w.is_default), is_active: num(w.is_active) })),
    periodDays, warehouseId: whId, productId, start, end,
  });
}

/** Sets a product's low and critical limits in every warehouse (creating the stock row where there is none yet is not done). */
export async function setLimits(productId, low, critical) {
  const l = Number(low), c = Number(critical);
  if (!Number.isFinite(l) || !Number.isFinite(c) || l < 0 || c < 0) throw Object.assign(new Error('Limits must be numbers of zero or more.'), { status: 400 });
  if (c > l) throw Object.assign(new Error('The critical limit cannot be above the low limit.'), { status: 400 });
  const r = await db.prepare(`UPDATE inventory_stock SET low_stock_threshold = ?, critical_stock_threshold = ? WHERE product_id = ?`).run(l, c, productId);
  if (!r.changes) throw Object.assign(new Error('This product has no stock record yet. Receive some stock first.'), { status: 404 });
  return { productId, lowStockThreshold: l, criticalStockThreshold: c };
}
