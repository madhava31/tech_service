// The unit of each quotation line (migration 015): Nos, Box, Pack of 100, Kg, … picked or typed on the quotation form. Lines saved
// before the migration, or without a unit, print the product's unit. Until migration 015 is applied the unit is not saved.
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';

export const UNIT_COLUMNS = { quotation_item: ['unit'] };
export const MAX_UNIT_LENGTH = 30;

let ready = false;
/** True once migration 015 is applied (only a positive answer is cached). A failing check counts as "not yet". */
export async function quotationUnitReady() {
  if (ready) return true;
  try {
    ready = (await missingColumns(UNIT_COLUMNS)).length === 0;
  } catch (err) {
    console.error('[quotation unit] could not check the unit column:', err?.message);
    return false;
  }
  return ready;
}

/** Pure: a unit as typed, tidied: trimmed, single spaces, at most 30 characters. Empty gives null (the product's unit is used). */
export function cleanUnit(value) {
  if (value === undefined || value === null) return null;
  // eslint-disable-next-line no-control-regex
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_UNIT_LENGTH);
  return s || null;
}

/** The SQL for a line's unit in queries that join quotation_item qi with product p. */
export async function itemUnitSql() {
  return (await quotationUnitReady()) ? 'COALESCE(qi.unit, p.unit)' : 'p.unit';
}

/** The items of a quotation with their unit (the line's own, else the product's). */
export async function quotationItemsWithUnit(quotationId) {
  const unit = await itemUnitSql();
  return db
    .prepare(`SELECT qi.*, ${unit} AS unit FROM quotation_item qi LEFT JOIN product p ON p.id = qi.product_id WHERE qi.quotation_id = ? ORDER BY qi.id`)
    .all(quotationId);
}
