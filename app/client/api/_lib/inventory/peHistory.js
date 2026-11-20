// Reads the PerkinElmer stock workbook ("PE Stock List-26.xlsx"): one sheet per month, one row per part, then a block of day columns
// (1..31) for stock IN, then a second block for stock OUT. Sheets differ in column order, so columns are found by their headings.
// This file only READS and summarises; writing the history into the system is a separate, approved step.
import ExcelJS from 'exceljs';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Nov-2026" / "June 26" / "Feb 26" -> { year, month } (2-digit years are 20xx). Null when it is not a month sheet. */
export function sheetMonth(name) {
  const m = String(name || '').trim().toLowerCase().match(/^([a-z]+)[\s\-_]*(\d{2}|\d{4})$/);
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].slice(0, 3));
  if (idx < 0) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { year, month: idx + 1 };
}

const plain = (v) => {
  if (v && typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return v.text;
  }
  return v;
};
const qty = (v) => {
  v = plain(v);
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

/** Pure: day-column runs from the header rows. A run is 1,2,3... in consecutive columns. Returns [{ start, days: [{col, day}] }]. */
export function findDayRuns(headerRows) {
  const width = Math.max(...headerRows.map((r) => r.length));
  const at = (c) => {
    for (const r of headerRows) {
      const v = plain(r[c]);
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31) return v;
    }
    return null;
  };
  const runs = [];
  let c = 0;
  while (c < width) {
    if (at(c) === 1) {
      const days = [{ col: c, day: 1 }];
      let d = 1;
      while (at(c + days.length) === d + 1) { d++; days.push({ col: c + days.length, day: d }); }
      if (days.length >= 28) runs.push({ start: c, days });
      c += days.length;
    } else c++;
  }
  return runs;
}

/** Reads one sheet (given as an array of row arrays, 0-based columns). */
export function readSheet(rows, name) {
  const when = sheetMonth(name);
  if (!when) return null;
  let hdr = -1, partCol = -1;
  for (let r = 0; r < Math.min(rows.length, 4); r++) {
    const c = (rows[r] || []).findIndex((v) => /^part\s*no/i.test(String(plain(v) ?? '').trim()));
    if (c >= 0) { hdr = r; partCol = c; break; }
  }
  if (hdr < 0) return { ...when, name, problem: 'no "Part No" heading found', lines: [] };
  const runs = findDayRuns(rows.slice(0, hdr + 1));
  if (runs.length < 2) return { ...when, name, problem: `expected an in block and an out block of day columns, found ${runs.length}`, lines: [] };
  const [inRun, outRun] = runs;
  const descCol = (rows[hdr] || []).findIndex((v) => /^dis?cription|^description/i.test(String(plain(v) ?? '').trim()));
  const openCol = inRun.start - 1; // the "previous month balance" column sits just before the first day
  const lines = [];
  for (let r = hdr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const part = String(plain(row[partCol]) ?? '').trim();
    if (!part) continue;
    const moves = [];
    for (const { col, day } of inRun.days) { const q = qty(row[col]); if (q) moves.push({ day, type: 'IN', qty: q }); }
    for (const { col, day } of outRun.days) { const q = qty(row[col]); if (q) moves.push({ day, type: 'OUT', qty: q }); }
    lines.push({ part, description: descCol >= 0 ? String(plain(row[descCol]) ?? '').trim() : '', opening: qty(row[openCol]), moves });
  }
  return { ...when, name, problem: null, lines };
}

export async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = row.values.slice(1); });
    const s = readSheet(rows, ws.name);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Pure: totals per month. */
export function summarise(sheets) {
  return sheets.map((s) => {
    let inUnits = 0, outUnits = 0, inCells = 0, outCells = 0, parts = 0;
    for (const l of s.lines) {
      if (l.moves.length) parts++;
      for (const m of l.moves) { if (m.type === 'IN') { inUnits += m.qty; inCells++; } else { outUnits += m.qty; outCells++; } }
    }
    return { sheet: s.name, year: s.year, month: s.month, problem: s.problem, partRows: s.lines.length, partsThatMoved: parts, inCells, inUnits, outCells, outUnits };
  });
}
