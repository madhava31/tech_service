// Price negotiation on a sent quotation.
//
// A customer who gets a quotation may ask for a better price. The user clicks "Negotiate": the quotation moves to
// the 'negotiation' status and becomes editable again; after the change it is sent again ("Mark as Sent"). This can
// repeat for as many rounds as needed, always on the same quotation number.
//
// Each time a negotiation starts, the version that was sent is saved as a revision (quotation_revision, migration
// 010), so the price history stays visible: what was offered in each round and what it is now. Without migration
// 010 negotiation still works; only the saved history is missing.
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';

export const NEGOTIATION = 'negotiation';
/**
 * Statuses in which a quotation can be edited. Once a PO is received the lines are tied to the PO items, so it is not
 * editable then (remove the PO first); every earlier state, including a rejected quotation, is.
 */
export const EDITABLE_STATUSES = ['draft', 'sent', NEGOTIATION, 'rejected'];
/** The same for a quotation made with the quotation module. */
export const MODULE_EDITABLE_STATUSES = EDITABLE_STATUSES;
export const ALL_STATUSES = ['draft', 'sent', NEGOTIATION, 'accepted', 'rejected'];

/** Returns an error message when the status change is not allowed, or null. */
export function statusChangeError(from, to) {
  if (!ALL_STATUSES.includes(to)) return 'Invalid status';
  // Negotiation starts from a quotation that has been sent to the customer.
  if (to === NEGOTIATION && from !== 'sent' && from !== NEGOTIATION) return 'Only a quotation that has been sent can go into negotiation';
  return null;
}

export const REVISION_COLUMNS = {
  quotation_revision: ['id', 'quotation_id', 'revision_no', 'total', 'subtotal', 'tax_amount', 'note', 'items', 'created_by_user_id', 'created_at'],
};

let ready = false;
/** True once migration 010 is applied (only a positive answer is cached). */
export async function revisionsReady() {
  if (ready) return true;
  ready = (await missingColumns(REVISION_COLUMNS)).length === 0;
  return ready;
}

/** The items of the version being sent back to negotiation, as a plain list for the history. */
export function snapshotItems(rows) {
  return rows.map((it) => ({
    part_no: it.part_no || null,
    description: it.description || '',
    qty: Number(it.qty) || 0,
    unit_price: Number(it.final_unit_price ?? it.actual_unit_price ?? it.price ?? 0) || 0,
    discount_type: it.discount_type || 'none',
    discount_value: Number(it.discount_value) || 0,
    line_total: Number(it.final_line_total ?? it.amount ?? 0) || 0,
  }));
}

/** Saves the current version of a quotation as the next revision. Returns the new revision number, or null if migration 010 is not applied. */
export async function takeRevisionSnapshot(quotationId, userId, note, database = db) {
  if (!(await revisionsReady())) return null;
  const q = await database.prepare(`SELECT total, subtotal, tax_amount FROM quotation WHERE id = ?`).get(quotationId);
  if (!q) return null;
  const rows = await database.prepare(`SELECT * FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(quotationId);
  const next = Number((await database.prepare(`SELECT COALESCE(MAX(revision_no), 0) + 1 AS n FROM quotation_revision WHERE quotation_id = ?`).get(quotationId)).n);
  await database
    .prepare(`INSERT INTO quotation_revision (quotation_id, revision_no, total, subtotal, tax_amount, note, items, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)`)
    .run(quotationId, next, Number(q.total) || 0, Number(q.subtotal) || 0, Number(q.tax_amount) || 0, note || null, JSON.stringify(snapshotItems(rows)), userId ?? null);
  return next;
}

/**
 * "Undo negotiation": when a negotiation is cancelled before anything was changed, the round that was saved for it is
 * removed again, so the history only shows rounds that really happened.
 */
export async function dropUnchangedRevision(quotationId, database = db) {
  if (!(await revisionsReady())) return false;
  const last = await database.prepare(`SELECT id, total FROM quotation_revision WHERE quotation_id = ? ORDER BY revision_no DESC LIMIT 1`).get(quotationId);
  const now = await database.prepare(`SELECT total FROM quotation WHERE id = ?`).get(quotationId);
  if (!last || !now || Math.abs(Number(last.total) - Number(now.total)) > 0.005) return false;
  await database.prepare(`DELETE FROM quotation_revision WHERE id = ?`).run(last.id);
  return true;
}

export async function listRevisions(quotationId, database = db) {
  if (!(await revisionsReady())) return { ready: false, revisions: [] };
  const revisions = await database
    .prepare(
      `SELECT r.id, r.revision_no, r.total, r.subtotal, r.tax_amount, r.note, r.items, r.created_at, u.username AS created_by_username
         FROM quotation_revision r LEFT JOIN app_user u ON u.id = r.created_by_user_id
        WHERE r.quotation_id = ? ORDER BY r.revision_no`
    )
    .all(quotationId);
  return { ready: true, revisions };
}
