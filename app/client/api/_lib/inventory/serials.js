// Serial numbers of stock units (migration 014). Mettler instruments are received one serial number at a time, an invoice picks the
// serial numbers that ship, and a removed invoice puts them back. The Excel list shows each unit: HSN/SAC, part number, description,
// serial number, inward date, outward date and whether it is in hand.
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';
import { todayIST } from './movementReport.js';

export const SERIAL_COLUMNS = { stock_serial: ['id', 'product_id', 'serial_number', 'warehouse_id', 'receipt_id', 'inward_date', 'outward_date', 'invoice_id'] };

let ready = false;
/** True once migration 014 is applied (only a positive answer is cached). */
export async function serialsReady() {
  if (ready) return true;
  try {
    ready = (await missingColumns(SERIAL_COLUMNS)).length === 0;
  } catch (err) {
    // Serial numbers are an add-on: if the check itself fails, invoices and receipts carry on without them.
    console.error('[serials] could not check the serial number table:', err?.message);
    return false;
  }
  return ready;
}

export class SerialError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SerialError';
    this.status = status;
  }
}

/** Serial numbers are only asked for on Mettler products. */
export const isMettler = (make) => /mettler/i.test(String(make || ''));

const key = (s) => String(s).trim().toLowerCase();

/** Pure: serial numbers from a list or from pasted text (one per line, or separated by commas or semicolons). Trimmed, no blanks. */
export function parseSerials(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\r\n,;]+/);
  const out = [];
  for (const r of raw) {
    const s = String(r ?? '').trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
  }
  return out;
}

/**
 * Pure: checks the serial numbers typed on a receipt. items: [{ productId, quantity, serials }]. Returns a list of
 * { productId, serials } with serials cleaned; throws SerialError for a count that does not match the quantity, or a serial
 * number typed twice for one product.
 */
export function checkReceiptSerials(items) {
  const out = [];
  const seen = new Map();
  for (const it of items) {
    const serials = parseSerials(it.serials);
    if (!serials.length) continue;
    const productId = Number(it.productId);
    const qty = Number(it.quantity);
    if (serials.length !== qty) throw new SerialError(`${serials.length} serial ${serials.length === 1 ? 'number was' : 'numbers were'} entered for a quantity of ${qty}. Enter one serial number per unit.`);
    if (serials.some((s) => s.length > 80)) throw new SerialError('A serial number is longer than 80 characters.');
    const mine = seen.get(productId) || new Set();
    for (const s of serials) {
      if (mine.has(key(s))) throw new SerialError(`Serial number ${s} is entered twice for the same product.`);
      mine.add(key(s));
    }
    seen.set(productId, mine);
    out.push({ productId, serials });
  }
  return out;
}

/** Refuses serial numbers that already exist for the product. */
export async function assertSerialsFree(checked) {
  const find = db.prepare(`SELECT serial_number FROM stock_serial WHERE product_id = ? AND lower(btrim(serial_number)) = ?`);
  for (const c of checked) {
    for (const s of c.serials) {
      const hit = await find.get(c.productId, key(s));
      if (hit) throw new SerialError(`Serial number ${hit.serial_number} is already recorded for this product.`, 409);
    }
  }
}

/** Records the units of a confirmed receipt (inward date = the receipt date). */
export async function insertReceiptSerials(checked, { receiptId, warehouseId, inwardDate }) {
  const ins = db.prepare(`INSERT INTO stock_serial (product_id, serial_number, warehouse_id, receipt_id, inward_date) VALUES (?, ?, ?, ?, ?)`);
  for (const c of checked) for (const s of c.serials) await ins.run(c.productId, s, warehouseId, receiptId, inwardDate);
}

/** Voiding a receipt takes its units out of the list again (only units that have not shipped; shipped ones block the void anyway). */
export async function deleteReceiptSerials(receiptId) {
  await db.prepare(`DELETE FROM stock_serial WHERE receipt_id = ? AND outward_date IS NULL`).run(receiptId);
}

/** Units that were on the invoice go back into stock when it is removed. Call inside the transaction that removes the invoice. */
export async function releaseInvoiceSerials(invoiceIds) {
  if (!invoiceIds.length || !(await serialsReady())) return 0;
  const r = await db.prepare(`UPDATE stock_serial SET outward_date = NULL, invoice_id = NULL WHERE invoice_id = ANY(?::int[])`).run(`{${invoiceIds.join(',')}}`);
  return Number(r?.changes || 0);
}

/** The units of each product still in stock, for the invoice dialog. productIds -> { productId: [{ id, serial_number }] }. */
export async function serialsInStock(productIds, warehouseId = null) {
  if (!productIds.length || !(await serialsReady())) return {};
  const rows = await db
    .prepare(
      `SELECT id, product_id, serial_number FROM stock_serial
        WHERE outward_date IS NULL AND product_id = ANY(?::int[])${warehouseId ? ' AND (warehouse_id = ? OR warehouse_id IS NULL)' : ''}
        ORDER BY inward_date, id`
    )
    .all(...[`{${productIds.join(',')}}`, ...(warehouseId ? [warehouseId] : [])]);
  const out = {};
  for (const r of rows) (out[r.product_id] ||= []).push({ id: Number(r.id), serial_number: r.serial_number });
  return out;
}

/** Products that have serial-numbered units in stock: Map product id -> number of units in stock. */
export async function trackedProducts(productIds) {
  if (!productIds.length || !(await serialsReady())) return new Map();
  const rows = await db
    .prepare(`SELECT product_id, COUNT(*)::int AS n FROM stock_serial WHERE outward_date IS NULL AND product_id = ANY(?::int[]) GROUP BY product_id`)
    .all(`{${productIds.join(',')}}`);
  return new Map(rows.map((r) => [Number(r.product_id), Number(r.n)]));
}

/**
 * Pure: the serial numbers picked for an invoice against its lines. lines: [{ quotation_item_id, product_id, qty, label }],
 * picks: { quotation_item_id: [serial ids] }, inStock: Map product id -> serial-numbered units in stock. A product with
 * serial-numbered units in stock needs one picked serial number per unit (units received before serial numbers were kept have
 * none, so at most the serial-numbered units in stock are asked for). Returns [{ quotation_item_id, product_id, ids }].
 */
export function planInvoiceSerials(lines, picks, inStock) {
  const out = [];
  const used = new Set();
  const left = new Map(inStock);
  for (const l of lines) {
    const pid = Number(l.product_id);
    const have = left.get(pid) || 0;
    const need = Math.min(Number(l.qty), have);
    if (need <= 0) continue;
    const ids = [...new Set((picks?.[l.quotation_item_id] || picks?.[String(l.quotation_item_id)] || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length !== need) throw new SerialError(`${l.label || 'A line'}: pick ${need} serial number${need === 1 ? '' : 's'} (${ids.length} picked).`);
    for (const id of ids) {
      if (used.has(id)) throw new SerialError('A serial number is picked on two lines.');
      used.add(id);
    }
    left.set(pid, have - need);
    out.push({ quotation_item_id: l.quotation_item_id, product_id: pid, ids });
  }
  return out;
}

/** Marks the picked units as gone on the invoice date. Each must belong to the line's product and still be in stock. */
export async function assignInvoiceSerials(plan, { invoiceId, outwardDate }) {
  for (const p of plan) {
    const r = await db
      .prepare(`UPDATE stock_serial SET outward_date = ?, invoice_id = ? WHERE id = ANY(?::int[]) AND product_id = ? AND outward_date IS NULL`)
      .run(outwardDate, invoiceId, `{${p.ids.join(',')}}`, p.product_id);
    if (Number(r?.changes || 0) !== p.ids.length) throw new SerialError('One of the picked serial numbers is no longer in stock. Reload and pick again.', 409);
  }
}

const day = (d) => (d ? String(d).slice(0, 10) : '');

/** The units, with filters: q (part, description, serial), make, status (in_stock | sent), from/to (inward date). */
export async function listSerials(query = {}) {
  const where = [];
  const params = [];
  const q = String(query.q ?? '').trim();
  if (q) {
    where.push(`(p.part_no ILIKE ? OR p.description ILIKE ? OR s.serial_number ILIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const make = String(query.make ?? '').trim();
  if (make) { where.push(`p.make ILIKE ?`); params.push(make); }
  if (query.status === 'in_stock') where.push(`s.outward_date IS NULL`);
  else if (query.status === 'sent') where.push(`s.outward_date IS NOT NULL`);
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
  if (iso(query.from)) { where.push(`s.inward_date >= ?`); params.push(iso(query.from)); }
  if (iso(query.to)) { where.push(`s.inward_date <= ?`); params.push(iso(query.to)); }
  const rows = await db
    .prepare(
      `SELECT s.id, s.serial_number, to_char(s.inward_date, 'YYYY-MM-DD') AS inward_date, to_char(s.outward_date, 'YYYY-MM-DD') AS outward_date,
              p.id AS product_id, p.part_no, p.description, p.hsn_sac, p.make, i.invoice_number
         FROM stock_serial s JOIN product p ON p.id = s.product_id LEFT JOIN quotation_invoice i ON i.id = s.invoice_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY p.part_no, s.inward_date, s.id`
    )
    .all(...params);
  return rows.map((r) => ({ ...r, id: Number(r.id), product_id: Number(r.product_id), in_hand: r.outward_date ? 0 : 1 }));
}

/** The Excel list, in the order: HSN/SAC, Part Number, Description, Serial Number, Stock Inward Date, Stock Outward Date, Available Stock In Hand. */
export async function buildSerialsExcel(query = {}) {
  const rows = await listSerials(query);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Serial numbers');
  ws.columns = [
    { header: 'HSN/SAC', key: 'hsn', width: 14 },
    { header: 'Part Number', key: 'part', width: 18 },
    { header: 'Description', key: 'desc', width: 44 },
    { header: 'Serial Number', key: 'serial', width: 22 },
    { header: 'Stock Inward Date', key: 'inward', width: 18 },
    { header: 'Stock Outward Date', key: 'outward', width: 18 },
    { header: 'Available Stock In Hand', key: 'hand', width: 24 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } };
  const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
  const RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF7C80' } };
  const dateCell = (d) => (d ? new Date(`${d}T00:00:00Z`) : null);
  for (const r of rows) {
    const row = ws.addRow({ hsn: r.hsn_sac || null, part: r.part_no, desc: r.description, serial: r.serial_number, inward: dateCell(r.inward_date), outward: dateCell(r.outward_date), hand: r.in_hand });
    row.eachCell({ includeEmpty: true }, (c) => { c.fill = r.in_hand ? GREEN : RED; });
    row.getCell('inward').numFmt = 'd/m/yyyy';
    row.getCell('outward').numFmt = 'd/m/yyyy';
  }
  ws.getColumn('part').numFmt = '@';
  ws.getColumn('serial').numFmt = '@';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await wb.xlsx.writeBuffer();
  const label = String(query.make || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'all';
  return { buffer, filename: `serial-numbers-${label}-${todayIST()}.xlsx`, count: rows.length };
}
