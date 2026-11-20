// Confirmed Sales of a sales person = the payments the user recorded with "Payment received" on a quotation (quotation_payment,
// migration 004), counted before GST like the Quoted column, in the financial year of the payment date. A payment is money in
// the bank, so a quotation counts only as far as the customer has actually paid. A quotation shared by several sales people
// (migration 011) counts for each by their share. Until migration 004 is applied nothing is tracked and the page says so.
import db from '../db/index.js';
import { paymentsReady } from '../payments/service.js';
import { salesTeamReady } from './salesTeam.js';

/** "FY 2026-27" (or "2026-27") -> { start: '2026-04-01', end: '2027-04-01' } (end is exclusive). Null when it is not a year. */
export function fyBounds(fy) {
  const m = String(fy || '').match(/(\d{4})\s*-\s*(\d{2}|\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}

// The part of a quotation that is not GST: taxable amount, else total minus tax, else the total.
const PRE_GST_SHARE = `COALESCE(COALESCE(q.taxable_amount, q.total - COALESCE(q.tax_amount, 0), q.total) / NULLIF(q.total, 0), 1)`;

/** One sales person's confirmed sales in a financial year: { count (quotations paid into), value }. */
export async function engineerConfirmed(engId, fy) {
  const b = fyBounds(fy);
  if (!b || !(await paymentsReady())) return { count: 0, value: 0 };
  const shared = await salesTeamReady();
  const w = shared ? '(COALESCE(sp.share_percent, 100) / 100.0)' : '1';
  const join = shared ? 'LEFT JOIN quotation_sales_person sp ON sp.quotation_id = q.id AND sp.sales_engineer_id = ?' : '';
  const who = shared
    ? `(sp.id IS NOT NULL OR (q.sales_engineer_id = ? AND NOT EXISTS (SELECT 1 FROM quotation_sales_person x WHERE x.quotation_id = q.id)))`
    : `q.sales_engineer_id = ?`;
  const params = shared ? [engId, b.start, b.end, engId] : [b.start, b.end, engId];
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT q.id)::int AS n, COALESCE(SUM(p.amount * ${PRE_GST_SHARE} * ${w}), 0)::float8 AS v
         FROM quotation_payment p
         JOIN quotation q ON q.id = p.quotation_id
         ${join}
        WHERE p.paid_on >= ? AND p.paid_on < ? AND ${who}`
    )
    .get(...params);
  return { count: Number(row?.n || 0), value: Math.round(Number(row?.v || 0) * 100) / 100 };
}
