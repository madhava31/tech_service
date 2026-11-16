// "Add total amount" on a quotation: the user lists the items without prices and enters one total.
// The total is split across the lines in proportion to quantity, so every line still has a price and
// POs, PIs, payments and reports keep working. pricing_mode = 'lump_sum' tells the quotation PDF to
// print only the total. The columns come from migration 005 (db/migrations/005_quotation_lump_sum.sql).
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';

const COLUMNS = { quotation: ['pricing_mode', 'lump_sum_amount'] };

let ready = false;
export async function lumpSumReady() {
  if (ready) return true;
  ready = (await missingColumns(COLUMNS)).length === 0;
  return ready;
}

// sendRouteError shows the message for 4xx statuses. The 503 below is answered by the route itself.
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** The lump-sum total sent with a quotation save, or null for normal per-item pricing. Throws on bad input. */
export async function readLumpSum(body) {
  if (body?.pricing_mode !== 'lump_sum') return null;
  if (!(await lumpSumReady())) {
    throw httpError(503, 'Total-amount pricing needs a database update (migration 005) that has not been applied yet. Please contact your administrator.');
  }
  const amount = Math.round(Number(body.lump_sum_amount) * 100) / 100;
  if (!(amount > 0)) throw httpError(400, 'Please enter the total amount for all the items');
  return amount;
}

/**
 * Splits the total across the lines in proportion to quantity, to the paisa. The last line takes
 * any remainder, so the line totals always add up to the total exactly.
 */
export function splitLumpSum(items, amount) {
  const qtys = items.map((it) => Math.max(Number(it.qty) || 1, 0.0001));
  const totalQty = qtys.reduce((a, b) => a + b, 0);
  const paise = Math.round(amount * 100);
  let given = 0;
  return items.map((it, i) => {
    const share = i === items.length - 1 ? paise - given : Math.floor((paise * qtys[i]) / totalQty);
    given += share;
    const unit = share / 100 / qtys[i];
    return {
      ...it,
      qty: qtys[i],
      price: unit,
      actual_unit_price: unit,
      unit_price: unit,
      discount_type: 'none',
      discount_value: 0,
    };
  });
}

/** Saves the pricing mode on the quotation (inside the save transaction). Older callers send neither field. */
export async function savePricingMode(quotationId, body, lumpSumAmount) {
  if (body?.pricing_mode === undefined || !(await lumpSumReady())) return;
  await db
    .prepare(`UPDATE quotation SET pricing_mode = ?, lump_sum_amount = ? WHERE id = ?`)
    .run(lumpSumAmount ? 'lump_sum' : 'itemized', lumpSumAmount || null, quotationId);
}
