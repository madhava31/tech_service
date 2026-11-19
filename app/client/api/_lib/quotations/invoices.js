// Invoices of a quotation: typed by the user from their tax invoice, with the items and quantities billed and the date
// the customer has to pay by. Works like "PO received". Tables come from migration 012; until it is applied the routes
// answer 503 MIGRATION_REQUIRED and the payment schedule keeps its earlier rules.
import db from '../db/index.js';
import { createSchemaGuard, missingColumns } from '../db/schemaGuard.js';
import { sendRouteError } from '../http/errors.js';
import { poReceivedReady } from './poReceived.js';

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
 * { invoice_number, invoice_date, payment_due_date, notes, items: [{ quotation_item_id, qty }] } or throws.
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
  return { invoice_number: number, invoice_date: invoiceDate, payment_due_date: dueDate, notes, items };
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
    res.json({
      quoted_items: quotedCount,
      invoices: invoices.map((inv) => {
        const mine = items.filter((i) => i.quotation_invoice_id === inv.id);
        return { ...inv, invoiced_items: mine.length, items: mine };
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

    let invoiceId;
    try {
      invoiceId = await db.transaction(async () => {
        const info = await db
          .prepare(`INSERT INTO quotation_invoice (quotation_id, invoice_number, invoice_date, payment_due_date, notes, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
          .run(id, parsed.invoice_number, parsed.invoice_date, parsed.payment_due_date, parsed.notes, req.user?.id ?? null);
        const newId = info.lastInsertRowid;
        const insertItem = db.prepare(`INSERT INTO quotation_invoice_item (quotation_invoice_id, quotation_item_id, qty) VALUES (?, ?, ?)`);
        for (const it of parsed.items) await insertItem.run(newId, it.quotation_item_id, it.qty);
        return newId;
      });
    } catch (err) {
      if (err?.code === '23505') return res.status(409).json({ error: `Invoice ${parsed.invoice_number} is already recorded for this quotation` });
      throw err;
    }
    res.status(201).json({ id: invoiceId, invoice_number: parsed.invoice_number, payment_due_date: parsed.payment_due_date, invoiced_items: parsed.items.length });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the invoice. Please try again.');
  }
}

/** DELETE /api/quotations/:id/invoices/:invoiceId : removes an invoice recorded by mistake. */
export async function deleteInvoice(req, res) {
  try {
    if (!isId(req.params.id) || !isId(req.params.invoiceId)) return res.status(400).json({ error: 'Invalid id' });
    const del = await db.prepare(`DELETE FROM quotation_invoice WHERE id = ? AND quotation_id = ?`).run(Number(req.params.invoiceId), Number(req.params.id));
    if (!del.changes) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to remove the invoice. Please try again.');
  }
}
