// "PO received": the customer purchase orders that arrived for a quotation, with the items and quantities each
// one ordered. Tables come from migration 008 (db/migrations/008_quotation_po_received.sql); until it is applied
// the routes answer 503 MIGRATION_REQUIRED and the Excel export simply leaves the PO columns out.
import db from '../db/index.js';
import { createSchemaGuard, missingColumns } from '../db/schemaGuard.js';
import { sendRouteError } from '../http/errors.js';

export const PO_COLUMNS = {
  quotation_po: ['id', 'quotation_id', 'po_number', 'po_date', 'notes', 'created_by_user_id', 'created_at'],
  quotation_po_item: ['id', 'quotation_po_id', 'quotation_item_id', 'qty'],
};

export const requirePoReceived = createSchemaGuard(PO_COLUMNS, 'PO received', 'Something went wrong. Please try again.', '008');

let ready = false;
/** True once migration 008 is applied (only a positive answer is cached). */
export async function poReceivedReady() {
  if (ready) return true;
  ready = (await missingColumns(PO_COLUMNS)).length === 0;
  return ready;
}

export class PoRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PoRequestError';
    this.status = status;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Validates a "PO received" request. `validItemIds` are the ids of the quotation's own lines.
 * Returns { po_number, po_date, notes, items: [{ quotation_item_id, qty }] } or throws PoRequestError.
 */
export function parsePoRequest(body, validItemIds, today = new Date().toISOString().slice(0, 10)) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PoRequestError('Invalid request');

  if (typeof body.po_number !== 'string') throw new PoRequestError('Enter the PO number');
  if (CONTROL.test(body.po_number)) throw new PoRequestError('The PO number contains invalid characters');
  const poNumber = body.po_number.trim();
  if (!poNumber) throw new PoRequestError('Enter the PO number');
  if (poNumber.length > 60) throw new PoRequestError('The PO number can be at most 60 characters');

  let poDate = today;
  if (body.po_date !== undefined && body.po_date !== null && body.po_date !== '') {
    const d = String(body.po_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) {
      throw new PoRequestError('Enter a valid PO date');
    }
    poDate = d;
  }

  let notes = null;
  if (body.notes !== undefined && body.notes !== null && body.notes !== '') {
    if (typeof body.notes !== 'string') throw new PoRequestError('Invalid notes');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.notes)) throw new PoRequestError('The notes contain invalid characters');
    notes = body.notes.trim().slice(0, 500) || null;
  }

  if (!Array.isArray(body.items) || body.items.length === 0) throw new PoRequestError('Select at least one item that the customer ordered');
  if (body.items.length > 500) throw new PoRequestError('Too many items');
  const seen = new Set();
  const items = body.items.map((it) => {
    const id = Number(it?.quotation_item_id);
    const qty = Number(it?.qty);
    if (!Number.isInteger(id) || !validItemIds.has(id)) throw new PoRequestError('One of the items does not belong to this quotation');
    if (seen.has(id)) throw new PoRequestError('An item is listed twice');
    seen.add(id);
    if (!Number.isFinite(qty) || qty <= 0) throw new PoRequestError('Every ordered item needs a quantity above 0');
    if (qty > 1e7) throw new PoRequestError('A quantity is too large');
    return { quotation_item_id: id, qty };
  });
  return { po_number: poNumber, po_date: poDate, notes, items };
}

const isId = (v) => /^\d{1,9}$/.test(String(v)) && Number(v) > 0;

/** GET /api/quotations/:id/po-received : the POs of a quotation, each with its items. */
export async function listPos(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
    const id = Number(req.params.id);
    if (!(await db.prepare(`SELECT id FROM quotation WHERE id = ?`).get(id))) return res.status(404).json({ error: 'Quotation not found' });
    const pos = await db
      .prepare(
        `SELECT po.id, po.po_number, po.po_date, po.notes, po.created_at, u.username AS created_by_username
         FROM quotation_po po LEFT JOIN app_user u ON u.id = po.created_by_user_id
         WHERE po.quotation_id = ? ORDER BY po.created_at, po.id`
      )
      .all(id);
    const items = await db
      .prepare(
        `SELECT pi.quotation_po_id, pi.quotation_item_id, pi.qty, qi.part_no, qi.description, qi.qty AS quoted_qty
         FROM quotation_po_item pi
         JOIN quotation_po po ON po.id = pi.quotation_po_id
         JOIN quotation_item qi ON qi.id = pi.quotation_item_id
         WHERE po.quotation_id = ? ORDER BY pi.quotation_po_id, qi.id`
      )
      .all(id);
    const quotedCount = Number((await db.prepare(`SELECT COUNT(*) AS n FROM quotation_item WHERE quotation_id = ?`).get(id)).n);
    res.json({
      quoted_items: quotedCount,
      pos: pos.map((p) => {
        const mine = items.filter((i) => i.quotation_po_id === p.id);
        return { ...p, ordered_items: mine.length, items: mine };
      }),
    });
  } catch (err) {
    sendRouteError(res, err, 500, 'Something went wrong. Please try again.');
  }
}

/** POST /api/quotations/:id/po-received : records a PO (number typed by the user) with its ordered items. */
export async function createPo(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid quotation id' });
    const id = Number(req.params.id);
    const quotation = await db.prepare(`SELECT id, status FROM quotation WHERE id = ?`).get(id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const lines = await db.prepare(`SELECT id FROM quotation_item WHERE quotation_id = ?`).all(id);
    let parsed;
    try {
      parsed = parsePoRequest(req.body, new Set(lines.map((l) => Number(l.id))));
    } catch (err) {
      if (err instanceof PoRequestError) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    let poId;
    try {
      poId = await db.transaction(async () => {
        const info = await db
          .prepare(`INSERT INTO quotation_po (quotation_id, po_number, po_date, notes, created_by_user_id) VALUES (?, ?, ?, ?, ?) RETURNING id`)
          .run(id, parsed.po_number, parsed.po_date, parsed.notes, req.user?.id ?? null);
        const newId = info.lastInsertRowid;
        const insertItem = db.prepare(`INSERT INTO quotation_po_item (quotation_po_id, quotation_item_id, qty) VALUES (?, ?, ?)`);
        for (const it of parsed.items) await insertItem.run(newId, it.quotation_item_id, it.qty);
        // A PO means the quotation was accepted. Same rule as the older PO route: open follow-ups are cancelled.
        if (['draft', 'sent', 'rejected'].includes(quotation.status)) {
          await db.prepare(`UPDATE quotation SET status = 'accepted' WHERE id = ?`).run(id);
        }
        await db.prepare(`UPDATE quotation_follow_up SET status = 'cancelled' WHERE quotation_id = ? AND status = 'scheduled'`).run(id);
        return newId;
      });
    } catch (err) {
      if (err?.code === '23505') return res.status(409).json({ error: `PO number ${parsed.po_number} is already recorded for this quotation` });
      throw err;
    }
    res.status(201).json({ id: poId, po_number: parsed.po_number, ordered_items: parsed.items.length });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to save the PO. Please try again.');
  }
}

/** DELETE /api/quotations/:id/po-received/:poId : removes a PO recorded by mistake. */
export async function deletePo(req, res) {
  try {
    if (!isId(req.params.id) || !isId(req.params.poId)) return res.status(400).json({ error: 'Invalid id' });
    const id = Number(req.params.id);
    const del = await db.prepare(`DELETE FROM quotation_po WHERE id = ? AND quotation_id = ?`).run(Number(req.params.poId), id);
    if (!del.changes) return res.status(404).json({ error: 'PO not found' });
    // With no PO left the quotation is back to "sent".
    const left = Number((await db.prepare(`SELECT COUNT(*) AS n FROM quotation_po WHERE quotation_id = ?`).get(id)).n);
    if (left === 0) await db.prepare(`UPDATE quotation SET status = 'sent' WHERE id = ? AND status = 'accepted'`).run(id);
    res.json({ ok: true });
  } catch (err) {
    sendRouteError(res, err, 500, 'Unable to remove the PO. Please try again.');
  }
}
