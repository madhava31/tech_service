// Several sales people on one quotation, and each one's share of the sales target.
//
// quotation.sales_engineer_id is the main sales person. When more people worked on the quotation, every one of them
// (the main one included) is a row in quotation_sales_person with a share_percent; the shares add up to 100. With no
// rows the main person counts 100%. The table comes from migration 011; without it the routes answer 503
// MIGRATION_REQUIRED and the sales-person figures use the old 100% rule.
import db from '../db/index.js';
import { createSchemaGuard, missingColumns } from '../db/schemaGuard.js';

export const SALES_TEAM_COLUMNS = {
  quotation_sales_person: ['id', 'quotation_id', 'sales_engineer_id', 'share_percent', 'created_at'],
};
export const requireSalesTeam = createSchemaGuard(SALES_TEAM_COLUMNS, 'Sales team', 'Something went wrong. Please try again.', '011');

let ready = false;
/** True once migration 011 is applied (only a positive answer is cached). */
export async function salesTeamReady() {
  if (ready) return true;
  ready = (await missingColumns(SALES_TEAM_COLUMNS)).length === 0;
  return ready;
}

export class SalesTeamError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** n equal shares in hundredths of a percent that add up to exactly 100 (the first people get the extra hundredths). */
export function equalShares(n) {
  if (n < 1) return [];
  const total = 10000;
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/**
 * Checks a team: members is [{ sales_engineer_id, share_percent }]. The main sales person must be in it, nobody twice,
 * every share above 0, and the shares must add up to 100. Returns the cleaned list. A team of one person is fine (it is
 * stored as "no team").
 */
export function validateTeam(members, primaryId) {
  if (!Array.isArray(members) || members.length === 0) throw new SalesTeamError('Add at least one sales person.');
  if (members.length > 10) throw new SalesTeamError('At most 10 sales people can share a quotation.');
  const seen = new Set();
  const out = [];
  for (const m of members) {
    const id = Number(m?.sales_engineer_id);
    if (!Number.isInteger(id) || id <= 0) throw new SalesTeamError('Choose a sales person for every row.');
    if (seen.has(id)) throw new SalesTeamError('A sales person can be added only once.');
    seen.add(id);
    const share = Math.round(Number(m?.share_percent) * 100) / 100;
    if (!(share > 0) || share > 100) throw new SalesTeamError('Every share must be above 0% and at most 100%.');
    out.push({ sales_engineer_id: id, share_percent: share });
  }
  if (primaryId && !seen.has(Number(primaryId))) throw new SalesTeamError('The sales person assigned to the quotation must be on the team.');
  const sum = Math.round(out.reduce((s, m) => s + m.share_percent, 0) * 100) / 100;
  if (Math.abs(sum - 100) > 0.001) throw new SalesTeamError(`The shares add up to ${sum}%. They must add up to 100%.`);
  return out;
}

/** The sales team of a quotation (main person first), or [] when it has a single sales person. */
export async function getSalesTeam(quotationId, database = db) {
  if (!(await salesTeamReady())) return [];
  return database
    .prepare(
      `SELECT sp.sales_engineer_id, e.name, e.employee_code AS code, sp.share_percent::float8 AS share_percent,
              (sp.sales_engineer_id = q.sales_engineer_id) AS is_primary
         FROM quotation_sales_person sp
         JOIN sales_engineer e ON e.id = sp.sales_engineer_id
         JOIN quotation q ON q.id = sp.quotation_id
        WHERE sp.quotation_id = ?
        ORDER BY (sp.sales_engineer_id = q.sales_engineer_id) DESC, sp.id`
    )
    .all(quotationId);
}

/** Replaces the team of a quotation. A team of one person is stored as no rows (that person counts 100%). */
export async function saveSalesTeam(quotationId, members, database = db) {
  await database.prepare(`DELETE FROM quotation_sales_person WHERE quotation_id = ?`).run(quotationId);
  if (members.length < 2) return;
  for (const m of members) {
    await database
      .prepare(`INSERT INTO quotation_sales_person (quotation_id, sales_engineer_id, share_percent) VALUES (?, ?, ?)`)
      .run(quotationId, m.sales_engineer_id, m.share_percent);
  }
}

/**
 * Used when a quotation is created or edited with "add another sales person": team = main person + the others, kept
 * on the shares already set when the same people are still on it, otherwise split equally.
 */
export async function setTeamFromIds(quotationId, primaryId, otherIds, database = db) {
  const ids = [];
  for (const v of [primaryId, ...(Array.isArray(otherIds) ? otherIds : [])]) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  if (ids.length < 2) {
    if (await salesTeamReady()) await saveSalesTeam(quotationId, ids.map((id) => ({ sales_engineer_id: id, share_percent: 100 })), database);
    return;
  }
  if (!(await salesTeamReady())) throw new SalesTeamError('Adding another sales person needs the sales team database update (migration 011).');
  const existing = await getSalesTeam(quotationId, database);
  const same = existing.length === ids.length && existing.every((e) => ids.includes(Number(e.sales_engineer_id)));
  const shares = same ? existing.map((e) => e.share_percent) : equalShares(ids.length);
  const members = same
    ? existing.map((e) => ({ sales_engineer_id: Number(e.sales_engineer_id), share_percent: e.share_percent }))
    : ids.map((id, i) => ({ sales_engineer_id: id, share_percent: shares[i] }));
  await saveSalesTeam(quotationId, validateTeam(members, primaryId), database);
}
