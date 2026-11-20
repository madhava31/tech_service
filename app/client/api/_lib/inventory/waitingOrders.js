// Waiting orders: what each customer has ordered (PO received) and not yet been invoiced for, and whether the warehouse can
// ship it now. This is the link between stock coming in and the customer it is for.
//
//   ordered   what the customer's PO(s) ask for per product line (a PO-received quotation without PO items counts its
//             quoted quantities)
//   invoiced  what earlier invoices already billed (an invoice takes the stock out)
//   pending   ordered - invoiced
//
// The stock on hand is shared out between the orders that want the same product, oldest PO first, so a part that arrives
// for two customers is not promised twice:
//   ready    the whole pending quantity can be shipped from stock now
//   partly   some of it can
//   waiting  none of it can: it has to be ordered from the supplier
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { poReceivedReady } from '../quotations/poReceived.js';
import { invoicesReady } from '../quotations/invoices.js';

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/**
 * Pure: turns the open order lines and the stock into the waiting-orders list.
 * lines: [{ quotation_id, quotation_item_id, product_id, ordered, invoiced, po_date, ... }]
 * stock: Map product_id -> available quantity (on hand minus reserved).
 */
export function allocateOrders(lines, stock) {
  const open = lines
    .map((l) => ({ ...l, ordered: Number(l.ordered) || 0, invoiced: Number(l.invoiced) || 0 }))
    .map((l) => ({ ...l, pending: r3(Math.max(0, l.ordered - l.invoiced)) }))
    .filter((l) => l.pending > 0);
  // Oldest PO first (no date last), then the older quotation, then the line.
  open.sort(
    (a, b) =>
      String(a.po_date || '9999-12-31').localeCompare(String(b.po_date || '9999-12-31')) ||
      Number(a.quotation_id) - Number(b.quotation_id) ||
      Number(a.quotation_item_id) - Number(b.quotation_item_id)
  );
  const left = new Map();
  for (const l of open) if (!left.has(l.product_id)) left.set(l.product_id, Math.max(0, Number(stock.get(Number(l.product_id)) || 0)));
  return open.map((l) => {
    const have = left.get(l.product_id) || 0;
    const ship = r3(Math.min(l.pending, have));
    left.set(l.product_id, r3(have - ship));
    const status = ship >= l.pending - 1e-9 ? 'ready' : ship > 0 ? 'partly' : 'waiting';
    return { ...l, available: r3(Number(stock.get(Number(l.product_id)) || 0)), can_ship: ship, short: r3(l.pending - ship), status };
  });
}

/** Counts for the top of the page. */
export function summarise(rows) {
  const by = (s) => rows.filter((r) => r.status === s);
  return {
    lines: rows.length,
    ready: by('ready').length,
    partly: by('partly').length,
    waiting: by('waiting').length,
    customers: new Set(rows.map((r) => r.company_id)).size,
    units_to_order: r3(rows.reduce((a, r) => a + r.short, 0)),
  };
}

function clean(query = {}) {
  const ids = String(query.productIds ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const productId = Number(query.productId) > 0 ? Number(query.productId) : null;
  if (productId) ids.push(productId);
  const warehouseId = Number(query.warehouseId) > 0 ? Number(query.warehouseId) : null;
  const status = ['ready', 'partly', 'waiting'].includes(query.status) ? query.status : null;
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100).toLowerCase() : '';
  return { ids: [...new Set(ids)], warehouseId, status, q };
}

/**
 * Loads the open order lines and the stock, and returns the waiting-orders list.
 * Non-admin users see only the quotations they made (userId). Filters: productIds, warehouseId, status, q (text).
 */
export async function loadWaitingOrders(query = {}, { userId = null, isAdmin = true } = {}) {
  const f = clean(query);
  const poReady = await poReceivedReady();
  const invReady = await invoicesReady();

  const ordered = poReady
    ? `CASE WHEN EXISTS (SELECT 1 FROM quotation_po_item x JOIN quotation_po xp ON xp.id = x.quotation_po_id WHERE xp.quotation_id = q.id)
            THEN COALESCE(po.ordered, 0) ELSE qi.qty END`
    : 'qi.qty';
  const poJoin = poReady
    ? `LEFT JOIN (SELECT pi.quotation_item_id, SUM(pi.qty) AS ordered
                    FROM quotation_po_item pi GROUP BY pi.quotation_item_id) po ON po.quotation_item_id = qi.id`
    : '';
  const invJoin = invReady
    ? `LEFT JOIN (SELECT ii.quotation_item_id, SUM(ii.qty) AS invoiced FROM quotation_invoice_item ii GROUP BY ii.quotation_item_id) inv ON inv.quotation_item_id = qi.id`
    : '';
  const poDate = poReady ? `(SELECT MIN(p.po_date) FROM quotation_po p WHERE p.quotation_id = q.id)` : 'NULL';
  const poNumbers = poReady ? `(SELECT string_agg(p.po_number, ', ' ORDER BY p.po_date, p.id) FROM quotation_po p WHERE p.quotation_id = q.id)` : 'NULL';

  const params = [];
  const where = [`q.status = 'accepted'`];
  if (!isAdmin) { where.push('q.created_by_user_id = ?'); params.push(Number(userId) || 0); }
  if (f.ids.length) { where.push('qi.product_id = ANY(?::int[])'); params.push(`{${f.ids.join(',')}}`); }

  const rows = await db
    .prepare(
      `SELECT q.id AS quotation_id, q.number AS quotation_number, c.id AS company_id, c.name AS company_name,
              qi.id AS quotation_item_id, qi.product_id, qi.part_no, COALESCE(NULLIF(qi.description, ''), qi.part_no) AS description,
              (${ordered})::float8 AS ordered, ${invReady ? 'COALESCE(inv.invoiced, 0)' : '0'}::float8 AS invoiced,
              ${poDate} AS po_date, ${poNumbers} AS po_numbers, p.unit AS unit
         FROM quotation q
         JOIN company c ON c.id = q.company_id
         JOIN quotation_item qi ON qi.quotation_id = q.id AND qi.product_id IS NOT NULL
         LEFT JOIN product p ON p.id = qi.product_id
         ${poJoin}
         ${invJoin}
        WHERE ${where.join(' AND ')}`
    )
    .all(...params);

  const productIds = [...new Set(rows.map((r) => Number(r.product_id)))];
  const stock = new Map();
  if (productIds.length) {
    const sp = [`{${productIds.join(',')}}`];
    let sw = 'WHERE product_id = ANY(?::int[])';
    if (f.warehouseId) { sw += ' AND warehouse_id = ?'; sp.push(f.warehouseId); }
    const held = await db.prepare(`SELECT product_id, SUM(on_hand_quantity - reserved_quantity)::float8 AS available FROM inventory_stock ${sw} GROUP BY product_id`).all(...sp);
    for (const h of held) stock.set(Number(h.product_id), Number(h.available) || 0);
  }

  let list = allocateOrders(rows.map((r) => ({ ...r, product_id: Number(r.product_id), po_date: r.po_date ? String(r.po_date).slice(0, 10) : null })), stock);
  if (f.q) list = list.filter((r) => `${r.company_name} ${r.quotation_number} ${r.part_no} ${r.description} ${r.po_numbers || ''}`.toLowerCase().includes(f.q));
  const summary = summarise(list);
  if (f.status) list = list.filter((r) => r.status === f.status);
  return { summary, orders: list };
}

/** The waiting list as an Excel file to send (customer, PO, part, ordered, pending, in stock, can ship now, still short). */
export async function buildWaitingOrdersExcel(query = {}, ctx = {}) {
  const { orders } = await loadWaitingOrders(query, ctx);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TECHNICON SERVICES ERP';
  const ws = wb.addWorksheet('Waiting orders');
  ws.columns = [
    { header: 'Customer', key: 'company_name', width: 30 },
    { header: 'Quotation No', key: 'quotation_number', width: 18 },
    { header: 'PO Number(s)', key: 'po_numbers', width: 22 },
    { header: 'PO Date', key: 'po_date', width: 12 },
    { header: 'Part Number', key: 'part_no', width: 16 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Ordered', key: 'ordered', width: 10 },
    { header: 'Already Invoiced', key: 'invoiced', width: 14 },
    { header: 'Pending', key: 'pending', width: 10 },
    { header: 'In Stock Now', key: 'available', width: 12 },
    { header: 'Can Ship Now', key: 'can_ship', width: 13 },
    { header: 'Still Short', key: 'short', width: 11 },
    { header: 'Status', key: 'status_label', width: 12 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const LABEL = { ready: 'Ready', partly: 'Partly ready', waiting: 'Waiting' };
  const FILL = { ready: 'FFC6EFCE', partly: 'FFFFEB9C', waiting: 'FFFFC7CE' };
  for (const o of orders) {
    const row = ws.addRow({ ...o, status_label: LABEL[o.status] });
    row.getCell('status_label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[o.status] } };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `TECHNICON_Waiting_Orders_${new Date().toISOString().slice(0, 10)}.xlsx` };
}
