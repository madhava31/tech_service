// Quick entry for incoming stock: the user pastes or types lines like "N8152473, 5" (copied from an Excel sheet, a packing
// list or a message) and the ERP finds the products, so a delivery is entered in one step instead of picking every product.
//
//   parse   each line is a part number and a quantity: separated by a tab, comma, semicolon or spaces, quantity last
//           ("N8152473 5", "N8152473<TAB>5", "N8152473, Quartz torch, 5", "N8152473 x5"); lines without a digit are ignored
//           (headings); the same part on two lines is added up
//   match   part numbers are compared ignoring case, spaces, dashes and leading zeros ("9923536" finds "09923536"); when
//           several products match, the one with exactly that part number wins, else the line is "ambiguous"
import db from '../db/index.js';

export const MAX_LINES = 500;
export const MAX_TEXT = 60000;

/** A part number as compared for matching: upper case, letters and digits only, no leading zeros. */
export function normalizePart(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}

const QTY = /^[x×*]?(\d+(?:\.\d+)?)$/i;

/** Splits pasted text into lines of { line, part, qty, merged } plus the lines that could not be read. */
export function parseQuickLines(text) {
  const src = String(text ?? '');
  if (src.length > MAX_TEXT) throw Object.assign(new Error('That is too much text. Paste at most 500 lines.'), { status: 400 });
  const lines = [];
  const problems = [];
  const seen = new Map();
  src.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const tokens = raw.split(/[\t;,]+|\s+/).map((t) => t.replace(/^["']+|["']+$/g, '').trim()).filter(Boolean);
    if (tokens.length === 0 || !/\d/.test(raw)) return; // blank line or a heading such as "Part No  Qty"
    const part = tokens[0];
    const last = tokens.length > 1 ? tokens[tokens.length - 1] : '';
    const m = last ? QTY.exec(last) : null;
    if (!m) { problems.push({ line: lineNo, text: raw.trim().slice(0, 80), problem: 'no quantity' }); return; }
    const qty = Number(m[1]);
    if (!(qty > 0) || qty > 1e7) { problems.push({ line: lineNo, text: raw.trim().slice(0, 80), problem: 'bad quantity' }); return; }
    const key = normalizePart(part);
    if (!key) { problems.push({ line: lineNo, text: raw.trim().slice(0, 80), problem: 'no part number' }); return; }
    if (seen.has(key)) { const prev = seen.get(key); prev.qty = Math.round((prev.qty + qty) * 1000) / 1000; prev.merged += 1; return; }
    const entry = { line: lineNo, part, key, qty, merged: 0 };
    seen.set(key, entry);
    lines.push(entry);
  });
  if (lines.length > MAX_LINES) throw Object.assign(new Error(`Paste at most ${MAX_LINES} lines at a time.`), { status: 400 });
  return { lines, problems };
}

/**
 * Pure: matches parsed lines to products. productsByKey: Map normalizedPart -> [{ id, part_no, description, unit, make }].
 * status: 'matched' (one product), 'ambiguous' (several; candidates listed) or 'not_found'.
 */
export function matchLines(lines, productsByKey) {
  return lines.map((l) => {
    const found = productsByKey.get(l.key) || [];
    const base = { line: l.line, part: l.part, qty: l.qty, merged: l.merged };
    if (found.length === 1) return { ...base, status: 'matched', product: found[0] };
    if (found.length > 1) {
      const exact = found.filter((p) => String(p.part_no).trim().toUpperCase() === l.part.trim().toUpperCase());
      if (exact.length === 1) return { ...base, status: 'matched', product: exact[0] };
      return { ...base, status: 'ambiguous', candidates: found.slice(0, 5) };
    }
    return { ...base, status: 'not_found' };
  });
}

/** Reads the pasted text and looks the part numbers up. Returns { lines, problems, summary }. */
export async function previewQuickEntry(text) {
  const { lines, problems } = parseQuickLines(text);
  const productsByKey = new Map();
  if (lines.length) {
    const keys = lines.map((l) => l.key);
    const rows = await db
      .prepare(
        `SELECT id, part_no, description, unit, make FROM product
          WHERE ltrim(regexp_replace(upper(part_no), '[^A-Z0-9]', '', 'g'), '0') = ANY(?::text[])`
      )
      .all(`{${keys.map((k) => `"${k}"`).join(',')}}`);
    for (const r of rows) {
      const k = normalizePart(r.part_no);
      if (!productsByKey.has(k)) productsByKey.set(k, []);
      productsByKey.get(k).push({ id: Number(r.id), part_no: r.part_no, description: r.description, unit: r.unit, make: r.make });
    }
  }
  const matched = matchLines(lines, productsByKey);
  const count = (s) => matched.filter((m) => m.status === s).length;
  return {
    lines: matched,
    problems,
    summary: { lines: matched.length, matched: count('matched'), ambiguous: count('ambiguous'), not_found: count('not_found'), units: Math.round(matched.reduce((a, m) => a + m.qty, 0) * 1000) / 1000 },
  };
}
