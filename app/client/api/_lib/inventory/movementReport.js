// Stock In / Out report: how much of each product came in and went out on every day of a month (1–31), or in every
// month of a year (financial Apr–Mar or calendar Jan–Dec).
//
// Nothing extra is stored: every stock change is already a row in inventory_movement with before_on_hand and
// after_on_hand. The change of a movement is delta = after_on_hand - before_on_hand (an ADJUSTMENT keeps its quantity
// as a positive number, so the quantity alone cannot say up or down).
//   In          STOCK_IN, OPENING_STOCK      delta
//   Out         STOCK_OUT                    -delta
//   Returns     RETURN                       delta
//   Adjustments ADJUSTMENT                   delta (signed)
//   Transfers   TRANSFER_IN / TRANSFER_OUT   shown as In / Out only when one warehouse is selected; across all
//                                            warehouses a transfer moves nothing.
// Opening = stock at the start of the period (the after_on_hand of the last movement before it, per warehouse);
// Closing = Opening + every change in the period, so it always matches the stock at the end of the period.
// Dates are India time: created_at is stored in UTC.
import ExcelJS from 'exceljs';
import db from '../db/index.js';

/** Same value as the stock ledger filter: products with no company (make) set. */
const NO_MAKE = '__none__';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

export class ReportRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Today in India as YYYY-MM-DD. */
export function todayIST(now = Date.now()) {
  return new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** The UTC timestamp (as stored in created_at) of midnight India time at the start of `isoDay`. */
export function utcStartOf(isoDay) {
  return new Date(`${isoDay}T00:00:00+05:30`).toISOString().replace('T', ' ').slice(0, 19);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/**
 * The period and its columns.
 *   view 'month': month 'YYYY-MM' (default this month), one bucket per day.
 *   view 'year' : year YYYY, yearType 'fy' (Apr YYYY – Mar YYYY+1, the default) or 'calendar' (Jan–Dec), one bucket per month.
 * start is the first day, endExclusive the day after the last day.
 */
export function periodBounds({ view = 'month', month, year, yearType = 'fy' } = {}, today = todayIST()) {
  if (view === 'year') {
    const fy = yearType !== 'calendar';
    let y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      const [ty, tm] = today.split('-').map(Number);
      y = fy && tm < 4 ? ty - 1 : ty;
    }
    const firstMonth = fy ? 4 : 1;
    const buckets = [];
    for (let i = 0; i < 12; i++) {
      const m = ((firstMonth - 1 + i) % 12) + 1;
      const yy = y + (firstMonth - 1 + i >= 12 ? 1 : 0);
      buckets.push({ key: `${yy}-${pad(m)}`, label: `${MONTHS[m - 1]} ${String(yy).slice(2)}` });
    }
    const start = `${y}-${pad(firstMonth)}-01`;
    const endExclusive = fy ? `${y + 1}-04-01` : `${y + 1}-01-01`;
    const label = fy ? `FY ${y}-${String(y + 1).slice(2)}` : `${y}`;
    return { view: 'year', year_type: fy ? 'fy' : 'calendar', year: y, start, endExclusive, label, buckets };
  }
  let m = String(month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m) || Number(m.slice(5)) < 1 || Number(m.slice(5)) > 12) m = today.slice(0, 7);
  const y = Number(m.slice(0, 4));
  const mm = Number(m.slice(5));
  const n = daysInMonth(y, mm);
  const buckets = Array.from({ length: n }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }));
  const endExclusive = mm === 12 ? `${y + 1}-01-01` : `${y}-${pad(mm + 1)}-01`;
  return { view: 'month', month: m, start: `${m}-01`, endExclusive, label: `${MONTHS[mm - 1]} ${y}`, buckets };
}

/** The date range (India time, inclusive) of one bucket, for "what moved on this day / in this month". */
export function bucketRange(period, key) {
  if (period.view === 'month') {
    const d = `${period.month}-${pad(Number(key))}`;
    return { from: d, to: d };
  }
  const [y, m] = String(key).split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}

/** Adds one movement change to a cell { in, out, ret, adj, xfer }. */
export function addMovement(cell, type, delta, singleWarehouse) {
  const d = Number(delta) || 0;
  if (!d) return cell;
  switch (type) {
    case 'STOCK_IN':
    case 'OPENING_STOCK':
      if (d > 0) cell.in += d; else cell.adj += d;
      break;
    case 'STOCK_OUT':
      if (d < 0) cell.out += -d; else cell.adj += d;
      break;
    case 'RETURN':
      cell.ret += d;
      break;
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':
      cell.xfer += d;
      if (singleWarehouse) {
        if (d > 0) cell.in += d; else cell.out += -d;
      }
      break;
    default:
      cell.adj += d;
  }
  return cell;
}

const emptyCell = () => ({ in: 0, out: 0, ret: 0, adj: 0, xfer: 0 });
const roundCell = (c) => ({ in: r3(c.in), out: r3(c.out), ret: r3(c.ret), adj: r3(c.adj), xfer: r3(c.xfer) });

/**
 * Builds the grid. bucketRows: [{ product_id, bucket, movement_type, delta }]; openingRows: [{ product_id, opening }];
 * products: [{ id, ... }] in the order to show. Returns one entry per product with opening, the non-empty cells,
 * totals and closing, plus the column totals.
 */
export function buildGrid({ products, openingRows, bucketRows, singleWarehouse }) {
  const opening = new Map(openingRows.map((r) => [Number(r.product_id), Number(r.opening) || 0]));
  const byProduct = new Map();
  for (const r of bucketRows) {
    const pid = Number(r.product_id);
    if (!byProduct.has(pid)) byProduct.set(pid, new Map());
    const cells = byProduct.get(pid);
    const key = String(r.bucket);
    if (!cells.has(key)) cells.set(key, emptyCell());
    addMovement(cells.get(key), r.movement_type, r.delta, singleWarehouse);
  }
  const colTotals = {};
  const grand = { opening: 0, ...emptyCell(), closing: 0 };
  const rows = products.map((p) => {
    const cells = byProduct.get(Number(p.id)) || new Map();
    const totals = emptyCell();
    const outCells = {};
    for (const [key, c] of cells) {
      for (const k of Object.keys(totals)) totals[k] += c[k];
      if (c.in || c.out || c.ret || c.adj || c.xfer) outCells[key] = roundCell(c);
      colTotals[key] = colTotals[key] || emptyCell();
      for (const k of Object.keys(totals)) colTotals[key][k] += c[k];
    }
    const open = opening.get(Number(p.id)) || 0;
    // In / Out already contain the transfers when one warehouse is selected; across all warehouses they net to xfer.
    const closing = open + totals.in - totals.out + totals.ret + totals.adj + (singleWarehouse ? 0 : totals.xfer);
    grand.opening += open;
    for (const k of Object.keys(totals)) grand[k] += totals[k];
    grand.closing += closing;
    return { ...p, opening: r3(open), cells: outCells, totals: roundCell(totals), closing: r3(closing) };
  });
  const columns = {};
  for (const [k, c] of Object.entries(colTotals)) columns[k] = roundCell(c);
  return { rows, totals: { opening: r3(grand.opening), ...roundCell(grand), closing: r3(grand.closing), columns } };
}

// ---------- database ----------

function productFilters({ q, make, productId }, params) {
  const where = [];
  if (productId) {
    where.push('p.id = ?');
    params.push(Number(productId));
  }
  if (q) {
    where.push('(p.part_no ILIKE ? OR p.description ILIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (make === NO_MAKE) where.push(`(p.make IS NULL OR TRIM(p.make) = '')`);
  else if (make) {
    where.push('LOWER(TRIM(p.make)) = LOWER(?)');
    params.push(String(make).trim());
  }
  return where;
}

function cleanParams(query = {}) {
  const warehouseId = Number(query.warehouseId) > 0 ? Number(query.warehouseId) : null;
  const productId = Number(query.productId) > 0 ? Number(query.productId) : null;
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const make = typeof query.make === 'string' ? query.make.trim().slice(0, 100) : '';
  const moved = !(query.moved === '0' || query.moved === 'false' || query.moved === false);
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { warehouseId, productId, q, make, moved, limit, offset };
}

const LOCAL_TIME = `((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')`;

/** Loads the whole grid (all matching products) for a period. */
async function loadGrid(period, f) {
  const startUtc = utcStartOf(period.start);
  const endUtc = utcStartOf(period.endExclusive);
  const bucketExpr = period.view === 'month' ? `EXTRACT(DAY FROM ${LOCAL_TIME})::int::text` : `to_char(${LOCAL_TIME}, 'YYYY-MM')`;

  const bp = [startUtc, endUtc];
  const bWhere = ['m.created_at >= ?', 'm.created_at < ?'];
  if (f.warehouseId) { bWhere.push('m.warehouse_id = ?'); bp.push(f.warehouseId); }
  bWhere.push(...productFilters(f, bp));
  const bucketRows = await db
    .prepare(
      `SELECT m.product_id, ${bucketExpr} AS bucket, m.movement_type,
              SUM(m.after_on_hand - m.before_on_hand)::float8 AS delta
         FROM inventory_movement m JOIN product p ON p.id = m.product_id
        WHERE ${bWhere.join(' AND ')}
        GROUP BY m.product_id, 2, m.movement_type`
    )
    .all(...bp);

  const op = [startUtc];
  const oWhere = ['m.created_at < ?'];
  if (f.warehouseId) { oWhere.push('m.warehouse_id = ?'); op.push(f.warehouseId); }
  oWhere.push(...productFilters(f, op));
  const openingRows = await db
    .prepare(
      `SELECT x.product_id, SUM(x.after_on_hand)::float8 AS opening FROM (
         SELECT DISTINCT ON (m.warehouse_id, m.product_id) m.product_id, m.after_on_hand
           FROM inventory_movement m JOIN product p ON p.id = m.product_id
          WHERE ${oWhere.join(' AND ')}
          ORDER BY m.warehouse_id, m.product_id, m.created_at DESC, m.id DESC
       ) x GROUP BY x.product_id`
    )
    .all(...op);

  // Which products to list: those that moved in the period, or every matching product.
  let ids;
  if (f.moved) {
    ids = [...new Set(bucketRows.map((r) => Number(r.product_id)))];
  } else {
    const pp = [];
    const pWhere = productFilters(f, pp);
    ids = (await db.prepare(`SELECT p.id FROM product p ${pWhere.length ? `WHERE ${pWhere.join(' AND ')}` : ''}`).all(...pp)).map((r) => Number(r.id));
  }
  const products = ids.length
    ? await db
        .prepare(`SELECT p.id, p.part_no, p.description, p.unit, p.make FROM product p WHERE p.id = ANY(?::int[]) ORDER BY p.part_no, p.id`)
        .all(ids)
    : [];
  return buildGrid({ products, openingRows, bucketRows, singleWarehouse: !!f.warehouseId });
}

/** GET /api/inventory/movement-report */
export async function getMovementReport(query = {}) {
  const period = periodBounds({ view: query.view, month: query.month, year: query.year, yearType: query.yearType });
  const f = cleanParams(query);
  const grid = await loadGrid(period, f);
  return {
    period: { view: period.view, label: period.label, start: period.start, end_exclusive: period.endExclusive, month: period.month || null, year: period.year || null, year_type: period.year_type || null },
    buckets: period.buckets,
    single_warehouse: !!f.warehouseId,
    products: grid.rows.slice(f.offset, f.offset + f.limit),
    total_products: grid.rows.length,
    totals: grid.totals,
    limit: f.limit,
    offset: f.offset,
  };
}

/** The Excel file: a Stock In sheet, a Stock Out sheet (products x days or months) and every movement of the period. */
export async function buildMovementReportExcel(query = {}) {
  const period = periodBounds({ view: query.view, month: query.month, year: query.year, yearType: query.yearType });
  const f = { ...cleanParams(query), limit: 100000, offset: 0 };
  const grid = await loadGrid(period, f);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TECHNICON SERVICES ERP';
  const head = (ws, cols) => {
    ws.columns = cols;
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  };
  const fixed = [
    { header: 'Part No', key: 'part_no', width: 16 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Unit', key: 'unit', width: 7 },
    { header: 'Opening', key: 'opening', width: 10 },
  ];
  const tail = [
    { header: 'Total In', key: 't_in', width: 10 },
    { header: 'Total Out', key: 't_out', width: 10 },
    { header: 'Returns', key: 't_ret', width: 10 },
    { header: 'Adjustments', key: 't_adj', width: 12 },
    { header: 'Closing', key: 'closing', width: 10 },
  ];
  for (const [sheetName, field] of [['Stock In', 'in'], ['Stock Out', 'out']]) {
    const ws = wb.addWorksheet(sheetName);
    head(ws, [...fixed, ...period.buckets.map((b) => ({ header: b.label, key: `b_${b.key}`, width: period.view === 'month' ? 6 : 9 })), ...tail]);
    for (const p of grid.rows) {
      const row = { part_no: p.part_no, description: p.description, unit: p.unit, opening: p.opening, t_in: p.totals.in, t_out: p.totals.out, t_ret: p.totals.ret, t_adj: p.totals.adj, closing: p.closing };
      for (const b of period.buckets) {
        const v = p.cells[b.key]?.[field];
        if (v) row[`b_${b.key}`] = v;
      }
      ws.addRow(row);
    }
    const total = { part_no: 'Total', opening: grid.totals.opening, t_in: grid.totals.in, t_out: grid.totals.out, t_ret: grid.totals.ret, t_adj: grid.totals.adj, closing: grid.totals.closing };
    for (const b of period.buckets) {
      const v = grid.totals.columns[b.key]?.[field];
      if (v) total[`b_${b.key}`] = v;
    }
    ws.addRow(total).font = { bold: true };
  }

  // Every movement of the period, one row each.
  const mp = [utcStartOf(period.start), utcStartOf(period.endExclusive)];
  const mWhere = ['m.created_at >= ?', 'm.created_at < ?'];
  if (f.warehouseId) { mWhere.push('m.warehouse_id = ?'); mp.push(f.warehouseId); }
  mWhere.push(...productFilters(f, mp));
  const moves = await db
    .prepare(
      `SELECT to_char(${LOCAL_TIME}, 'DD-MM-YYYY HH24:MI') AS at, w.name AS warehouse, p.part_no, p.description,
              m.movement_type, (m.after_on_hand - m.before_on_hand)::float8 AS change, m.before_on_hand::float8 AS before,
              m.after_on_hand::float8 AS after, m.reference_type, m.reference_id, m.reason
         FROM inventory_movement m JOIN product p ON p.id = m.product_id JOIN warehouse w ON w.id = m.warehouse_id
        WHERE ${mWhere.join(' AND ')}
        ORDER BY m.created_at, m.id
        LIMIT 50000`
    )
    .all(...mp);
  const ws = wb.addWorksheet('Movements');
  head(ws, [
    { header: 'Date & Time', key: 'at', width: 17 },
    { header: 'Warehouse', key: 'warehouse', width: 22 },
    { header: 'Part No', key: 'part_no', width: 16 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Type', key: 'movement_type', width: 14 },
    { header: 'Change', key: 'change', width: 9 },
    { header: 'Before', key: 'before', width: 9 },
    { header: 'After', key: 'after', width: 9 },
    { header: 'Reference', key: 'ref', width: 22 },
    { header: 'Reason', key: 'reason', width: 36 },
  ]);
  for (const mv of moves) ws.addRow({ ...mv, ref: [mv.reference_type, mv.reference_id].filter(Boolean).join(' #') });

  const buffer = await wb.xlsx.writeBuffer();
  const tag = period.view === 'month' ? period.month : period.label.replace(/\s+/g, '_');
  return { buffer, filename: `TECHNICON_Stock_In_Out_${tag}.xlsx` };
}
