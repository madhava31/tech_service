// Invoices of a quotation: typed by the user from their tax invoice, with the items and quantities billed and the date
// the customer has to pay by. Saving an invoice takes the billed quantities out of the chosen warehouse (a Stock Out
// movement per line, referenced to the invoice); removing the invoice puts them back. If the warehouse does not hold
// enough, the invoice is not saved. Works like "PO received". Tables come from migration 012; until it is applied the routes
// answer 503 MIGRATION_REQUIRED and the payment schedule keeps its earlier rules.
import db from '../db/index.js';
import { createSchemaGuard, missingColumns } from '../db/schemaGuard.js';
import { sendRouteError } from '../http/errors.js';
import { poReceivedReady } from './poReceived.js';
import { resolveUserId } from '../db/inventorySchema.js';
import { recordStockOut, recordStockIn } from '../inventory/service.js';
import { todayIST } from '../inventory/movementReport.js';

export const INVOICE_COLUMNS = {
  quotation_invoice: ['id', 'quotation_id', 'invoice_number', 'invoice_date', 'payment_due_date', 'notes', 'created_by_user_id', 'created_at'],
  quotation_invoice_item: ['id', 'quotation_invoice_id', 'quotation_item_id', 'qty'],
};

export const requireInvoices = createSchemaGuard(INVOICE_COLUMNS, 'Invoices', 'Something went wrong. Please try again.', '012');

let ready = false;
/** True once migration 012 is applied (only a positive answer is cached). */
export async function invoicesReady() {
  if (ready) return true;
  ready = (await missingColumns(INVOICE_COLUMNS)).length === 0;
  return ready;
}

export class InvoiceRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InvoiceRequestError';
    this.status = status;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function isoDay(value) {
  const d = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) return null;
  return d;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Validates an invoice request. `validItemIds` are the ids of the quotation's own lines; `dueDays` is the quotation's
 * payment due days, used when no payment due date is given. Returns
 * { invoice_number, invoice_date, payment_due_date, notes, warehouse_id (or null), items: [{ quotation_item_id, qty }] } or throws.
 */
export function parseInvoiceRequest(body, validItemIds, { dueDays = 30, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InvoiceRequestError('Invalid request');

  if (typeof body.invoice_number !== 'string') throw new InvoiceRequestError('Enter the invoice number');
  if (CONTROL.test(body.invoice_number)) throw new InvoiceRequestError('The invoice number contains invalid characters');
  const number = body.invoice_number.trim();
  if (!number) throw new InvoiceRequestError('Enter the invoice number');
  if (number.length > 60) throw new InvoiceRequestError('The invoice number can be at most 60 characters');

  let invoiceDate = today;
  if (body.invoice_date !== undefined && body.invoice_date !== null && body.invoice_date !== '') {
    invoiceDate = isoDay(body.invoice_date);
    if (!invoiceDate) throw new InvoiceRequestError('Enter a valid invoice date');
  }

  let dueDate = addDays(invoiceDate, Number.isFinite(Number(dueDays)) ? Number(dueDays) : 30);
  if (body.payment_due_date !== undefined && body.payment_due_date !== null && body.payment_due_date !== '') {
    dueDate = isoDay(body.payment_due_date);
    if (!dueDate) throw new InvoiceRequestError('Enter a valid payment due date');
  }
  if (dueDate < invoiceDate) throw new InvoiceRequestError('The payment due date cannot be before the invoice date');

  let notes = null;
  if (body.notes !== undefined && body.notes !== null && body.notes !== '') {
    if (typeof body.notes !== 'string') throw new InvoiceRequestError('Invalid notes');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.notes)) throw new InvoiceRequestError('The notes contain invalid characters');
    notes = body.notes.trim().slice(0, 500) || null;
  }

  let warehouseId = null;
  if (body.warehouse_id !== undefined && body.warehouse_id !== null && body.warehouse_id !== '') {
    warehouseId = Number(body.warehouse_id);
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) throw new InvoiceRequestError('Choose a valid warehouse');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) throw new InvoiceRequestError('Select at least one item on this invoice');
  if (body.items.length > 500) throw new InvoiceRequestError('Too many items');
  const seen = new Set();
  const items = body.items.map((it) => {
    const id = Number(it?.quotation_item_id);
    const qty = Number(it?.qty);
    if (!Number.isInteger(id) || !validItemIds.has(id)) throw new InvoiceRequestError('One of the items does not belong to this quotation');
    if (seen.has(id)) throw new InvoiceRequestError('An item is listed twice');
    seen.add(id);
    if (!Number.isFinite(qty) || qty <= 0) throw new InvoiceRequestError('Every invoiced item needs a quantity above 0');
    if (qty > 1e7) throw new InvoiceRequestError('A quantity is too large');
    return { quotation_item_id: id, qty };
  });
  return { invoice_number: number, invoice_date: invoiceDate, payment_due_date: dueDate, notes, warehouse_id: warehouseId, items };
}

/**
 * The most that can still be invoiced per quotation item: what the customer ordered (the POs received, or the quoted
 * quantity when no PO items were recorded) minus what earlier invoices already billed. Returns the first item that
 * would go over, or null.
 */
export function overInvoiced(items, { ordered, quoted, invoiced }) {
  for (const it of items) {
    const id = it.quotation_item_id;
    const limit = ordered.size ? ordered.get(id) || 0 : quoted.get(id) || 0;
    const already = invoiced.get(id) || 0;
    if (already + it.qty > limit + 1e-9) return { quotation_item_id: id, limit, already, left: Math.max(0, limit - already) };
  }
  return null;
}

/** Movement references: the stock out of an invoice, and the correcting entry when the invoice is removed. */
export const INVOICE_STOCK_REF = 'QUOTATION_INVOICE';
export const INVOICE_VOID_REF = 'QUOTATION_INVOICE_REMOVED';

/**
 * Splits the lines of an invoice into those that leave stock (the quotation line is linked to a product) and those that
 * do not (for example a service line). productOf: Map quotation_item_id -> product_id.
 */
export function planDeduction(items, productOf) {
  const deduct = [];
  const untracked = [];
  for (const it of items) {
    const productId = productOf.get(it.quotation_item_id);
    if (productId) deduct.push({ quotation_item_id: it.quotation_item_id, product_id: productId, qty: it.qty });
    else untracked.push(it.quotation_item_id);
  }
  return { deduct, untracked };
}

/**
 * The first product for which the warehouse holds less than the invoice needs, or null. available: Map product_id ->
 * quantity available (on hand minus reserved). Several lines of one product add up.
 */
export function stockShortage(deduct, available) {
  const need = new Map();
  for (const d of deduct) need.set(d.product_id, (need.get(d.product_id) || 0) + d.qty);
  for (const [productId, qty] of need) {
    const have = available.get(productId) || 0;
    if (qty > have + 1e-9) return { product_id: productId, need: qty, have };
  }
  return null;
}

const fmtQty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/** The warehouse the goods leave from: the one asked for (must be active), else the default, else the first active one. */
async function resolveWarehouse(id) {
  if (id) return (await db.prepare(`SELECT id, name FROM warehouse WHERE id = ? AND is_active = 1`).get(id)) || null;
  return (await db.prepare(`SELECT id, name FROM warehouse WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1`).get()) || null;
}

async function availableStock(warehouseId, productIds) {
  const rows = await db
    .prepare(`SELECT product_id, (on_hand_quantity - reserved_quantity)::float8 AS available FROM inventory_stock WHERE warehouse_id = ? AND product_id = ANY(?::int[])`)
    .all(warehouseId, `{${productIds.join(',')}}`);
  return new Map(rows.map((r) => [Number(r.product_id), Number(r.available)]));
}

const isId = (v) => /^\d{1,9}$/.test(String(v)) && Number(v) > 0;
const sumBy = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(Number(r.quotation_item_id), (m.get(Number(r.quotation_item_id)) || 0) + Number(r.qty));
  return m;
};

/** GET /api/quotations/:id/invoices : the invoices of a quotation, each with its items. */
export async function listInvoices(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
    const id = Number(req.params.id);
    if (!(await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(id))) return res.status(404).json({ error: 'Quotation not found' });
    const invoices = await db
      .prepare(
        `SELECT i.id, i.invoice_number, i.invoice_date, i.payment_due_date, i.notes, i.created_at, u.username AS created_by_username
         FROM quotation_invoice i LEFT JOIN app_user u ON u.id = i.created_by_user_id
         WHERE i.quotation_id = ? ORDER BY i.invoice_date, i.id`
      )
      .all(id);
    const items = await db
      .prepare(
        `SELECT ii.quotation_invoice_id, ii.quotation_item_id, ii.qty, qi.part_no, qi.description, qi.qty AS quoted_qty
         FROM quotation_invoice_item ii
         JOIN quotation_invoice i ON i.id = ii.quotation_invoice_id
         JOIN quotation_item qi ON qi.id = ii.quotation_item_id
         WHERE i.quotation_id = ? ORDER BY ii.quotation_invoice_id, qi.id`
      )
      .all(id);
    const quotedCount = Number((await db.prepare(`SELECT COUNT(*) AS n FROM quotation_item WHERE quotation_id = ?`).get(id)).n);
    // The stock that left the warehouse with each invoice.
    let moves = [];
    if (invoices.length) {
      try {
        moves = await db
          .prepare(
            `SELECT m.reference_id, m.product_id, m.quantity::float8 AS qty, w.name AS warehouse_name, p.part_no
               FROM inventory_movement m JOIN warehouse w ON w.id = m.warehouse_id JOIN product p ON p.id = m.product_id
              WHERE m.reference_type = ? AND m.reference_id = ANY(?::text[]) ORDER BY m.id`
          )
          .all(INVOICE_STOCK_REF, `{${invoices.map((i) => i.id).join(',')}}`);
      } catch (err) {
        console.error('[invoices] could not read the stock movements:', err?.message);
      }
    }
    res.json({
      quoted_items: quotedCount,
      invoices: invoices.map((inv) => {
        const mine = items.filter((i) => i.quotation_invoice_id === inv.id);
        const stock = moves.filter((m) => String(m.reference_id) === String(inv.id)).map((m) => ({ product_id: m.product_id, part_no: m.part_no, qty: m.qty, warehouse_name: m.warehouse_name }));
        return { ...inv, invoiced_items: mine.length, items: mine, stock_movements: stock };
      }),
    });
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
}

/** POST /api/quotations/:id/invoices : records an invoice (number typed by the user) with its items and payment due date. */
export async function createInvoice(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
    const id = Number(req.params.id);
    const quotation = await db.prepare(`SELECT * FROM quotation WHERE id = ?`).get(id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.status !== 'accepted') return res.status(409).json({ error: 'Record the PO received first. An invoice follows the PO.' });
    const lines = await db.prepare(`SELECT id, qty FROM quotation_item WHERE quotation_id = ?`).all(id);
    let parsed;
    try {
      parsed = parseInvoiceRequest(req.body, new Set(lines.map((l) => Number(l.id))), { dueDays: quotation.payment_due_days ?? 30 });
    } catch (err) {
      if (err instanceof InvoiceRequestError) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    // Not more than was ordered: the PO quantities (or the quoted ones), minus earlier invoices.
    const ordered = (await poReceivedReady())
      ? sumBy(await db.prepare(`SELECT pi.quotation_item_id, pi.qty FROM quotation_po_item pi JOIN quotation_po p ON p.id = pi.quotation_po_id WHERE p.quotation_id = ?`).all(id))
      : new Map();
    const quoted = new Map(lines.map((l) => [Number(l.id), Number(l.qty)]));
    const invoiced = sumBy(await db.prepare(`SELECT ii.quotation_item_id, ii.qty FROM quotation_invoice_item ii JOIN quotation_invoice i ON i.id = ii.quotation_invoice_id WHERE i.quotation_id = ?`).all(id));
    const over = overInvoiced(parsed.items, { ordered, quoted, invoiced });
    if (over) {
      const line = await db.prepare(`SELECT part_no, description FROM quotation_item WHERE id = ?`).get(over.quotation_item_id);
      const what = line?.part_no || line?.description || 'An item';
      return res.status(400).json({ error: `${what}: only ${over.left} left to invoice (ordered ${over.limit}, already invoiced ${over.already}).` });
    }

    // Stock: lines linked to a product leave the warehouse; refuse before saving anything when it does not hold enough.
    const productOf = new Map(
      (await db.prepare(`SELECT qi.id, qi.product_id FROM quotation_item qi JOIN product p ON p.id = qi.product_id WHERE qi.quotation_id = ?`).all(id)).map((r) => [Number(r.id), Number(r.product_id)])
    );
    const plan = planDeduction(parsed.items, productOf);
    let warehouse = null;
    if (plan.deduct.length) {
      warehouse = await resolveWarehouse(parsed.warehouse_id);
      if (!warehouse) return res.status(400).json({ error: 'Choose the warehouse the goods leave from.' });
      const short = stockShortage(plan.deduct, await availableStock(warehouse.id, [...new Set(plan.deduct.map((d) => d.product_id))]));
      if (short) {
        const prod = await db.prepare(`SELECT part_no, description FROM product WHERE id = ?`).get(short.product_id);
        return res.status(400).json({ error: `${prod?.part_no || prod?.description || 'An item'}: only ${fmtQty(short.have)} in stock at ${warehouse.name} (the invoice needs ${fmtQty(short.need)}). Receive stock first or lower the quantity.` });
      }
    }
    const stockUserId = await resolveUserId(req.user);

    let invoiceId;
    try {
      invoiceId = await db.transaction(async () => {
        const info = await db
          .prepare(`INSERT INTO quotation_invoice (quotation_id, invoice_number, invoice_date, payment_due_date, notes, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
          .run(id, parsed.invoice_number, parsed.invoice_date, parsed.payment_due_date, parsed.notes, req.user?.id ?? null);
        const newId = info.lastInsertRowid;
        const insertItem = db.prepare(`INSERT INTO quotation_invoice_item (quotation_invoice_id, quotation_item_id, qty) VALUES (?, ?, ?)`);
        for (const it of parsed.items) await insertItem.run(newId, it.quotation_item_id, it.qty);
        // All or nothing: if a stock out fails, the invoice is not saved either.
        for (const d of plan.deduct) {
          await recordStockOut({
            warehouseId: warehouse.id,
            productId: d.product_id,
            quantity: d.qty,
            referenceType: INVOICE_STOCK_REF,
            referenceId: newId,
            reason: `Invoice ${parsed.invoice_number}`,
            userId: stockUserId,
            // The goods left on the invoice date (an invoice dated in the future takes the stock out today).
            occurredOn: parsed.invoice_date <= todayIST() ? parsed.invoice_date : undefined,
          });
        }
        return newId;
      });
    } catch (err) {
      if (err?.code === '23505') return res.status(409).json({ error: `Invoice ${parsed.invoice_number} is already recorded for this quotation` });
      throw err;
    }
    res.status(201).json({
      id: invoiceId,
      invoice_number: parsed.invoice_number,
      payment_due_date: parsed.payment_due_date,
      invoiced_items: parsed.items.length,
      stock: { warehouse: warehouse?.name || null, deducted: plan.deduct.length, untracked: plan.untracked.length },
    });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the invoice. Please try again.');
  }
}

/**
 * Puts back the stock that left with the given invoices: a correcting Adjustment (up) per stock out, so the history keeps
 * both the out and the correction. Call it inside the transaction that deletes the invoices (or the quotation they belong
 * to), so the stock and the invoices change together. invoices: [{ id, invoice_number }]. Returns the units put back.
 */
export async function restoreInvoiceStock(invoices, userId, why = 'removed') {
  let units = 0;
  for (const inv of invoices) {
    const outs = await db
      .prepare(`SELECT warehouse_id, product_id, quantity::float8 AS quantity FROM inventory_movement WHERE reference_type = ? AND reference_id = ? AND movement_type = 'STOCK_OUT' ORDER BY id`)
      .all(INVOICE_STOCK_REF, String(inv.id));
    for (const m of outs) {
      await recordStockIn({
        warehouseId: m.warehouse_id,
        productId: m.product_id,
        quantity: m.quantity,
        referenceType: INVOICE_VOID_REF,
        referenceId: inv.id,
        reason: `Invoice ${inv.invoice_number} ${why}`,
        userId,
        movementType: 'ADJUSTMENT',
      });
      units += Number(m.quantity);
    }
  }
  return units;
}

/** DELETE /api/quotations/:id/invoices/:invoiceId : removes an invoice recorded by mistake and puts its stock back. */
export async function deleteInvoice(req, res) {
  try {
    if (!isId(req.params.id) || !isId(req.params.invoiceId)) return res.status(400).json({ error: 'Invalid id' });
    const inv = await db.prepare(`SELECT id, invoice_number FROM quotation_invoice WHERE id = ? AND quotation_id = ?`).get(Number(req.params.invoiceId), Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const userId = await resolveUserId(req.user);
    await db.transaction(async () => {
      await restoreInvoiceStock([inv], userId, 'removed');
      await db.prepare(`DELETE FROM quotation_invoice WHERE id = ?`).run(inv.id);
    });
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to remove the invoice. Please try again.');
  }
}

/**
 * GET /api/quotations/:id/invoice-stock?warehouseId= : for each line of the quotation, the stock on hand and available in
 * the warehouse (the default one when none is asked for), so the invoice dialog can show "In stock 10".
 */
export async function invoiceStock(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
    const warehouse = await resolveWarehouse(isId(req.query.warehouseId) ? Number(req.query.warehouseId) : null);
    const rows = await db
      .prepare(
        `SELECT qi.id AS quotation_item_id, (p.id IS NOT NULL) AS tracked,
                COALESCE(s.on_hand_quantity, 0)::float8 AS on_hand, COALESCE(s.on_hand_quantity - s.reserved_quantity, 0)::float8 AS available
           FROM quotation_item qi
           LEFT JOIN product p ON p.id = qi.product_id
           LEFT JOIN inventory_stock s ON s.product_id = qi.product_id AND s.warehouse_id = ?
          WHERE qi.quotation_id = ? ORDER BY qi.id`
      )
      .all(warehouse?.id ?? 0, Number(req.params.id));
    res.json({ warehouse, items: rows.map((r) => ({ quotation_item_id: Number(r.quotation_item_id), tracked: !!r.tracked, on_hand: Number(r.on_hand), available: Number(r.available) })) });
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
}
