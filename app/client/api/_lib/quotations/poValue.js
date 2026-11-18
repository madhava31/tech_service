// What a quotation is worth once the customer has sent PO(s) ("PO received", stored status 'accepted').
//
// A customer may order only some items or smaller quantities, and may send repeat POs on the same quotation. So the
// value of a PO-received quotation is what was actually ordered: for every item of every PO, quantity x the quoted
// unit price (after discounts), plus GST. Repeat POs add up. A quotation that was marked accepted before PO received
// existed, or when migration 008 is not applied, keeps its quotation amount.
import { poReceivedReady } from './poReceived.js';

const UNIT_PRICE = 'COALESCE(qi.final_unit_price, qi.actual_unit_price, qi.price, 0)';

/** SQL for the ordered value of quotation `alias` (a correlated sub-select). */
export function orderedValueSql(alias = 'q', { withGst = true } = {}) {
  const sum = `(SELECT COALESCE(SUM(pi.qty * ${UNIT_PRICE}), 0)
      FROM quotation_po_item pi
      JOIN quotation_po p ON p.id = pi.quotation_po_id
      JOIN quotation_item qi ON qi.id = pi.quotation_item_id
     WHERE p.quotation_id = ${alias}.id)`;
  return withGst ? `(${sum} * (1 + COALESCE(${alias}.tax_percent, 0) / 100.0))` : sum;
}

/**
 * SQL expression for the value of a PO-received quotation row `alias`: the ordered value when POs are recorded, else
 * `fallback` (the quotation amount). Before migration 008 it is just `fallback`.
 */
export async function receivedValueSql(alias = 'q', { withGst = true, fallback } = {}) {
  const fb = fallback || `${alias}.total`;
  if (!(await poReceivedReady())) return fb;
  return `CASE WHEN EXISTS (SELECT 1 FROM quotation_po p0 WHERE p0.quotation_id = ${alias}.id) THEN ${orderedValueSql(alias, { withGst })} ELSE ${fb} END`;
}

/**
 * Runs run(valueSql). If that query fails for any reason (it should not), the error is logged and run(fallbackSql) is used
 * instead, so a dashboard or report never breaks because of the PO-received value.
 */
export async function runWithFallback(run, valueSql, fallbackSql, label) {
  if (valueSql === fallbackSql) return run(valueSql);
  try {
    return await run(valueSql);
  } catch (err) {
    console.error(`[${label}] PO-received value query failed, using the quotation amounts:`, err?.message);
    return run(fallbackSql);
  }
}

/** The pre-GST amount of a quotation row, as used for sales-person figures. */
export const preGstSql = (alias = 'q') => `COALESCE(${alias}.taxable_amount, ${alias}.total - COALESCE(${alias}.tax_amount, 0), ${alias}.total)`;
