// Instrument quotations ("Quotation for instruments" button). Columns come from migration 006
// (db/migrations/006_instrument_quotation.sql). An instrument quotation always uses one total for
// all items (pricing_mode 'lump_sum', quotations/lumpSum.js) and prints in the instrument format.
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';

const COLUMNS = { quotation: ['quotation_type', 'instrument_title'], quotation_item: ['is_main'] };

let ready = false;
export async function instrumentReady() {
  if (ready) return true;
  ready = (await missingColumns(COLUMNS)).length === 0;
  return ready;
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Checks an instrument quotation before saving. Returns true for an instrument quotation. */
export async function readInstrument(body) {
  if (body?.quotation_type !== 'instrument') return false;
  if (!(await instrumentReady())) {
    throw httpError(503, 'Instrument quotations need a database update (migration 006) that has not been applied yet. Please contact your administrator.');
  }
  if (!String(body.instrument_title || '').trim()) throw httpError(400, 'Please enter the instrument title, e.g. PerkinElmer make FTIR-Spectrum Two with UATR');
  if (body.pricing_mode !== 'lump_sum') throw httpError(400, 'An instrument quotation uses one total amount for all the items');
  return true;
}

/**
 * Saves the type, title and bold (main item) lines, inside the save transaction and after the lines
 * are inserted. Older callers that send no quotation_type leave the quotation untouched.
 */
export async function saveInstrument(quotationId, body) {
  if (body?.quotation_type === undefined || !(await instrumentReady())) return;
  const instrument = body.quotation_type === 'instrument';
  await db
    .prepare(`UPDATE quotation SET quotation_type = ?, instrument_title = ? WHERE id = ?`)
    .run(instrument ? 'instrument' : 'standard', instrument ? String(body.instrument_title).trim().slice(0, 200) : null, quotationId);
  // Lines are inserted in the order sent, so the n-th line by id is the n-th item of the request.
  const lines = await db.prepare(`SELECT id FROM quotation_item WHERE quotation_id = ? ORDER BY id`).all(quotationId);
  const items = Array.isArray(body.items) ? body.items : [];
  const mainIds = lines.filter((_, i) => instrument && items[i] && items[i].is_main === true).map((l) => l.id);
  await db.prepare(`UPDATE quotation_item SET is_main = (id = ANY(?::int[])) WHERE quotation_id = ?`).run(mainIds, quotationId);
}
