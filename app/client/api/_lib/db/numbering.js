import db from './index.js';

// Generates sequential numbers like TSQOT2627/446 based on Indian FY (Apr-Mar) — prefix and FY
// tag run together with no separator, then a single slash before an unpadded sequence number.
export async function nextNumber(prefix, table, isoDate) {
  let now = new Date();
  if (isoDate) {
    const parsed = new Date(isoDate);
    if (!isNaN(parsed.getTime())) now = parsed;
  }
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyTag = `${String(fyStartYear).slice(2)}${String(fyStartYear + 1).slice(2)}`;
  const likePattern = `${prefix}${fyTag}/%`;

  // Continue from the highest number used this financial year, not from the latest row: a user can
  // edit a quotation's number (e.g. to TSQOT2627/639), and every new one must then follow it (640),
  // even if an older quotation is later renumbered lower.
  const row = await db
    .prepare(
      `SELECT MAX(CAST(substring(number from '/([0-9]+)$') AS INTEGER)) AS max_seq
       FROM ${table} WHERE number LIKE ?`
    )
    .get(likePattern);

  const maxSeq = Number(row?.max_seq);
  const nextSeq = Number.isFinite(maxSeq) && maxSeq > 0 ? maxSeq + 1 : 1;

  return `${prefix}${fyTag}/${nextSeq}`;
}
