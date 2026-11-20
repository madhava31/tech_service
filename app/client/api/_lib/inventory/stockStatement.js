// Stock statement for sending: the stock sheet they keep by hand, filled from the ERP.
//
//   one sheet per month (named like "Nov-2026"): S.NO, Part No, Description, Company, Unit, Opening,
//   stock in on day 1..31, Total In, stock out on day 1..31, Total Out, Returns, Adjustments, Closing
//   and a "Movements" sheet listing every stock in and out of the period: date, part, quantity, customer, PO number and
//   invoice number (for stock that left on an invoice), the receipt and its supplier reference (for stock that came in).
// Rows are green while the part is in stock and orange when it is out of stock, like their own sheet.
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { getUserTable } from '../db/inventorySchema.js';
import { poReceivedReady } from '../quotations/poReceived.js';
import { invoicesReady } from '../quotations/invoices.js';
import { periodBounds, todayIST, utcStartOf, loadMovementGrid, productFilters, cleanParams, LOCAL_TIME } from './movementReport.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MAX_MONTHS = 24;
const GREEN = 'FFC6EFCE';
const ORANGE = 'FFFFE0B2';
const HEAD = 'FF1E3A8A';

export class StatementRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** The months from..to (both 'YYYY-MM', inclusive), oldest first. Defaults to the current month. */
export function monthRange(from, to, today = todayIST()) {
  const cur = today.slice(0, 7);
  const ok = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const a = ok(from) ? String(from) : ok(to) ? String(to) : cur;
  const b = ok(to) ? String(to) : a;
  if (b < a) throw new StatementRequestError('The last month cannot be before the first month.');
  const out = [];
  let [y, m] = a.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= b) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (out.length > MAX_MONTHS) throw new StatementRequestError(`Choose at most ${MAX_MONTHS} months at a time.`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** "2026-11" -> "Nov-2026" (the sheet name, and the title). */
export const monthLabel = (month) => `${MONTH_NAMES[Number(month.slice(5)) - 1]}-${month.slice(0, 4)}`;

/** Which rows of a month's grid are listed: parts with stock, or that moved; every part when `all` is set. */
export function rowsToList(rows, all = false) {
  if (all) return rows;
  return rows.filter((r) => r.opening !== 0 || r.closing !== 0 || r.totals.in || r.totals.out || r.totals.ret || r.totals.adj || r.totals.xfer);
}

const dash = (n) => (n ? n : null); // zero cells stay empty, as in their sheet

/** Adds one month's sheet. grid: { rows, buckets (the days), totals } from the movement report. */
function addMonthSheet(wb, month, period, grid, { filtersText, all }) {
  const ws = wb.addWorksheet(monthLabel(month));
  const days = period.buckets.length;
  const rows = rowsToList(grid.rows, all);
  const FIX = 6; // S.NO .. Opening
  const colIn = (d) => FIX + d; // day d (1-based) of the in block
  const totIn = FIX + days + 1;
  const colOut = (d) => totIn + d;
  const totOut = totIn + days + 1;
  const retCol = totOut + 1;
  const adjCol = totOut + 2;
  const closeCol = totOut + 3;
  const last = closeCol;

  ws.mergeCells(1, 1, 1, Math.min(last, 12));
  ws.getCell(1, 1).value = `TECHNICON SERVICES — STOCK STATEMENT — ${period.label.toUpperCase()}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.getCell(2, 1).value = filtersText;
  ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF555555' } };
  ws.getCell(2, 8).value = 'Green = in stock · Orange = out of stock';
  ws.getCell(2, 8).font = { italic: true, color: { argb: 'FF555555' } };

  // group titles over the two day blocks
  ws.mergeCells(3, colIn(1), 3, colIn(days));
  ws.getCell(3, colIn(1)).value = 'STOCK IN (by day of the month)';
  ws.mergeCells(3, colOut(1), 3, colOut(days));
  ws.getCell(3, colOut(1)).value = 'STOCK OUT (by day of the month)';
  for (const c of [colIn(1), colOut(1)]) { ws.getCell(3, c).alignment = { horizontal: 'center' }; ws.getCell(3, c).font = { bold: true }; }

  const header = ['S.NO', 'Part No', 'Description', 'Company', 'Unit', 'Opening'];
  for (let d = 1; d <= days; d++) header.push(String(d));
  header.push('Total In');
  for (let d = 1; d <= days; d++) header.push(String(d));
  header.push('Total Out', 'Returns', 'Adjustments', 'Closing');
  const hr = ws.getRow(4);
  header.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.alignment = { horizontal: 'center' };
  hr.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }; });

  const sum = { opening: 0, in: 0, out: 0, ret: 0, adj: 0, closing: 0 };
  const perDayIn = new Array(days + 1).fill(0);
  const perDayOut = new Array(days + 1).fill(0);
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = r.part_no;
    row.getCell(3).value = r.description;
    row.getCell(4).value = r.make || '';
    row.getCell(5).value = r.unit || '';
    row.getCell(6).value = dash(r.opening);
    for (let d = 1; d <= days; d++) {
      const c = r.cells[String(d)];
      if (c?.in) { row.getCell(colIn(d)).value = c.in; perDayIn[d] += c.in; }
      if (c?.out) { row.getCell(colOut(d)).value = c.out; perDayOut[d] += c.out; }
    }
    row.getCell(totIn).value = dash(r.totals.in);
    row.getCell(totOut).value = dash(r.totals.out);
    row.getCell(retCol).value = dash(r.totals.ret);
    row.getCell(adjCol).value = dash(r.totals.adj);
    row.getCell(closeCol).value = r.closing;
    row.getCell(closeCol).font = { bold: true };
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.closing > 0 ? GREEN : ORANGE } };
    for (let c = 1; c <= FIX; c++) row.getCell(c).fill = fill;
    row.getCell(closeCol).fill = fill;
    sum.opening += r.opening; sum.in += r.totals.in; sum.out += r.totals.out; sum.ret += r.totals.ret; sum.adj += r.totals.adj; sum.closing += r.closing;
  });

  const tr = ws.getRow(5 + rows.length);
  tr.getCell(3).value = 'TOTAL';
  tr.getCell(6).value = sum.opening;
  for (let d = 1; d <= days; d++) { tr.getCell(colIn(d)).value = dash(perDayIn[d]); tr.getCell(colOut(d)).value = dash(perDayOut[d]); }
  tr.getCell(totIn).value = sum.in;
  tr.getCell(totOut).value = sum.out;
  tr.getCell(retCol).value = dash(sum.ret);
  tr.getCell(adjCol).value = dash(sum.adj);
  tr.getCell(closeCol).value = sum.closing;
  tr.font = { bold: true };

  ws.columns.forEach((col, i) => { col.width = i === 0 ? 6 : i === 1 ? 16 : i === 2 ? 38 : i === 3 ? 20 : i === 4 ? 7 : i < FIX ? 9 : i < totIn - 1 || (i >= totIn && i < totOut - 1) ? 4.5 : 10; });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: last } };
  return { rows: rows.length, sum };
}

const TYPE_LABEL = { STOCK_IN: 'Stock in', OPENING_STOCK: 'Opening stock', STOCK_OUT: 'Stock out', RETURN: 'Return', ADJUSTMENT: 'Adjustment', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out' };

/** The movements of the period with customer, PO and invoice for invoice stock-outs, receipt and supplier reference for stock-ins. */
export async function loadStatementMovements(startUtc, endUtc, f) {
  const userTable = await getUserTable();
  const [poReady, invReady] = [await poReceivedReady(), await invoicesReady()];
  const params = [startUtc, endUtc];
  const where = ['m.created_at >= ?', 'm.created_at < ?'];
  if (f.warehouseId) { where.push('m.warehouse_id = ?'); params.push(f.warehouseId); }
  where.push(...productFilters(f, params));
  const refId = `(CASE WHEN m.reference_id ~ '^[0-9]+$' THEN m.reference_id::int END)`;
  const invJoin = invReady
    ? `LEFT JOIN quotation_invoice inv ON m.reference_type IN ('QUOTATION_INVOICE', 'QUOTATION_INVOICE_REMOVED') AND inv.id = ${refId}
       LEFT JOIN quotation qt ON qt.id = inv.quotation_id
       LEFT JOIN company cu ON cu.id = qt.company_id`
    : '';
  const poNumbers = invReady && poReady ? `(SELECT string_agg(po.po_number, ', ' ORDER BY po.po_date, po.id) FROM quotation_po po WHERE po.quotation_id = qt.id)` : 'NULL';
  return db
    .prepare(
      `SELECT to_char(${LOCAL_TIME}, 'DD-MM-YYYY HH24:MI') AS at, p.part_no, p.description, p.make, m.movement_type,
              (m.after_on_hand - m.before_on_hand)::float8 AS change, w.name AS warehouse, m.reference_type, m.reference_id, m.reason,
              u.username AS entered_by, r.receipt_number, r.source_reference,
              ${invReady ? 'inv.invoice_number, cu.name AS customer, qt.number AS quotation_number' : 'NULL AS invoice_number, NULL AS customer, NULL AS quotation_number'},
              ${poNumbers} AS po_numbers
         FROM inventory_movement m
         JOIN product p ON p.id = m.product_id
         JOIN warehouse w ON w.id = m.warehouse_id
         LEFT JOIN ${userTable} u ON u.id = m.created_by
         LEFT JOIN stock_receipt r ON m.reference_type = 'STOCK_RECEIPT' AND r.id = ${refId}
         ${invJoin}
        WHERE ${where.join(' AND ')}
        ORDER BY m.created_at, m.id
        LIMIT 100000`
    )
    .all(...params);
}

function addMovementsSheet(wb, moves) {
  const ws = wb.addWorksheet('Movements');
  ws.columns = [
    { header: 'Date & Time', key: 'at', width: 17 },
    { header: 'Part No', key: 'part_no', width: 16 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Company', key: 'make', width: 18 },
    { header: 'Type', key: 'type', width: 13 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Warehouse', key: 'warehouse', width: 22 },
    { header: 'Customer', key: 'customer', width: 28 },
    { header: 'Quotation', key: 'quotation_number', width: 17 },
    { header: 'PO Number(s)', key: 'po_numbers', width: 20 },
    { header: 'Invoice No', key: 'invoice_number', width: 18 },
    { header: 'Receipt No', key: 'receipt_number', width: 22 },
    { header: 'Supplier / Source Ref', key: 'source_reference', width: 24 },
    { header: 'Reason', key: 'reason', width: 36 },
    { header: 'Entered By', key: 'entered_by', width: 14 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }; });
  for (const m of moves) {
    const type = TYPE_LABEL[m.movement_type] || m.movement_type;
    ws.addRow({ ...m, type, qty: m.change });
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 15 } };
}

/**
 * The workbook for the months from..to. query: from, to ('YYYY-MM'), warehouseId, make, q, all=1 (list parts with no stock
 * and no movement too). Returns { buffer, filename }.
 */
export async function buildStockStatementExcel(query = {}, { warehouseName = null } = {}) {
  const months = monthRange(query.from, query.to);
  const f = { ...cleanParams(query), moved: false };
  const all = query.all === '1' || query.all === 'true' || query.all === true;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TECHNICON SERVICES ERP';
  const filtersText = `Warehouse: ${warehouseName || (f.warehouseId ? `#${f.warehouseId}` : 'All warehouses')}   ·   Company: ${f.make && f.make !== '__none__' ? f.make : f.make === '__none__' ? 'No company set' : 'All'}${f.q ? `   ·   Search: ${f.q}` : ''}`;
  for (const month of months) {
    const period = periodBounds({ view: 'month', month });
    const grid = await loadMovementGrid(period, f);
    addMonthSheet(wb, month, period, grid, { filtersText, all });
  }
  const first = periodBounds({ view: 'month', month: months[0] });
  const last = periodBounds({ view: 'month', month: months[months.length - 1] });
  addMovementsSheet(wb, await loadStatementMovements(utcStartOf(first.start), utcStartOf(last.endExclusive), f));
  const buffer = await wb.xlsx.writeBuffer();
  const tag = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])}_to_${monthLabel(months[months.length - 1])}`;
  return { buffer, filename: `TECHNICON_Stock_Statement_${tag}.xlsx` };
}
