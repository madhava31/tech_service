import db from './index.js';

// Generates sequential numbers like TSQOT2627/446 based on Indian FY (Apr-Mar) — prefix and FY
// tag run together with no separator, then a single slash before an unpadded sequence number.
export async function nextNumber(prefix, table, column = 'number') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error('Invalid numbering table or column');
  }
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyTag = `${String(fyStartYear).slice(2)}${String(fyStartYear + 1).slice(2)}`;
  const likePattern = `${prefix}${fyTag}/%`;

  const row = await db
    .prepare(`SELECT ${column} AS number FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(likePattern);

  let nextSeq = 1;
  if (row) {
    const parts = row.number.split('/');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${fyTag}/${nextSeq}`;
}
