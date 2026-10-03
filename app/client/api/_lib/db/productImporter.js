import ExcelJS from 'exceljs';

// Manually-maintained catalogue files are small; this is a generous but bounded cap against
// pathological memory use, not a real-world limit anyone should hit.
export const MAX_IMPORT_ROWS = 2000;
export const MAX_FIELD_LENGTH = 200;

// Header text is matched case-insensitively against these aliases (not by column position —
// unlike the sales-record importer, this format is small, named, and human-maintained, so
// matching by header text is more forgiving of column reordering).
const HEADER_ALIASES = {
  productName: ['product name', 'name', 'description'],
  partNo: ['part no', 'part number', 'partno', 'part_no'],
  price: ['price', 'default price', 'unit price'],
};
const REQUIRED_COLUMN_LABELS = { productName: 'Product Name', partNo: 'Part No', price: 'Price' };

export class MissingColumnError extends Error {
  constructor(label) {
    super(`Required column "${label}" is missing.`);
    this.label = label;
  }
}

export class TooManyRowsError extends Error {
  constructor() {
    super('The file contains too many rows. Please split it into smaller files.');
  }
}

// A styled/pasted header ("Product **Name**", a hyperlink, etc.) comes back from ExcelJS as a
// rich-text/hyperlink object rather than a plain string — String(obj) would stringify to
// "[object Object]" and silently fail every alias match, so its text is extracted explicitly.
function cellTextValue(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    if (Array.isArray(raw.richText)) return raw.richText.map((t) => t.text || '').join('');
    if (typeof raw.text === 'string') return raw.text; // hyperlink cell: { text, hyperlink }
    if (raw.result != null) return String(raw.result); // formula cell
    return '';
  }
  return String(raw);
}

function findColumnIndexes(headerRow) {
  // headerRow.values is 1-indexed, values[0] is empty (ExcelJS convention).
  const indexes = {};
  for (let i = 1; i < headerRow.length; i++) {
    const raw = headerRow[i];
    if (raw == null) continue;
    const text = cellTextValue(raw).trim().toLowerCase();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (indexes[key] == null && aliases.includes(text)) indexes[key] = i;
    }
  }
  return indexes;
}

const REQUIRED_KEYS = Object.keys(REQUIRED_COLUMN_LABELS);
// How many leading rows to check for the header — tolerates a title/logo row (e.g. "Product
// Catalogue Export") sitting above the real header row, which real-world exports commonly have.
const MAX_HEADER_SCAN_ROWS = 10;

// A formula/rich-text/hyperlink cell comes back from ExcelJS as an object, not a primitive —
// treated as unusable rather than evaluated, so no spreadsheet formula is ever executed.
function cellToPrimitive(value) {
  if (value == null) return null;
  if (typeof value === 'object') return undefined; // signals "unusable", distinct from null/empty
  return value;
}

export function parseProductWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.load(buffer).then(() => {
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('The workbook has no sheets.');

    // The header row isn't assumed to be row 1 — a title row above the real headers is common
    // in real-world exports, so the first few rows are scanned for one that has every required
    // column (in any order; see HEADER_ALIASES/findColumnIndexes above).
    let headerRowNumber = null;
    let columnIndexes = null;
    const lastRowToScan = Math.min(MAX_HEADER_SCAN_ROWS, sheet.rowCount || MAX_HEADER_SCAN_ROWS);
    for (let r = 1; r <= lastRowToScan; r++) {
      const candidate = findColumnIndexes(sheet.getRow(r).values);
      if (REQUIRED_KEYS.every((key) => candidate[key] != null)) {
        headerRowNumber = r;
        columnIndexes = candidate;
        break;
      }
    }
    if (!columnIndexes) {
      // No row had every required column — report against row 1 so the error names the specific
      // column that's missing there, same as before.
      columnIndexes = findColumnIndexes(sheet.getRow(1).values);
      for (const key of REQUIRED_KEYS) {
        if (columnIndexes[key] == null) throw new MissingColumnError(REQUIRED_COLUMN_LABELS[key]);
      }
      headerRowNumber = 1;
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const values = row.values;
      const productName = cellToPrimitive(values[columnIndexes.productName]);
      const partNo = cellToPrimitive(values[columnIndexes.partNo]);
      const price = cellToPrimitive(values[columnIndexes.price]);
      const isBlank = [productName, partNo, price].every((v) => v == null || v === '');
      if (isBlank) return;
      rows.push({ rowNumber, productName, partNo, price });
    });

    if (rows.length > MAX_IMPORT_ROWS) throw new TooManyRowsError();
    return rows;
  });
}

// Every row is validated fresh here — called both by the preview endpoint and, independently,
// by the commit endpoint (which never trusts a client-supplied preview snapshot).
export function validateProductRows(rawRows) {
  const errorRows = [];
  const okRows = [];

  // In-file duplicate part_no detection first, so every affected row (not just the second
  // occurrence) is flagged — ambiguous imports are blocked outright, never guessed at.
  const rowsByPartNo = new Map();
  for (const r of rawRows) {
    const partNo = r.partNo == null ? '' : String(r.partNo).trim();
    if (!partNo) continue;
    if (!rowsByPartNo.has(partNo)) rowsByPartNo.set(partNo, []);
    rowsByPartNo.get(partNo).push(r.rowNumber);
  }

  for (const r of rawRows) {
    const errors = [];

    const productName = r.productName === undefined ? null : r.productName;
    const partNoRaw = r.partNo === undefined ? null : r.partNo;
    const priceRaw = r.price === undefined ? null : r.price;

    const nameStr = productName == null ? '' : String(productName).trim();
    if (!nameStr) errors.push('Product Name is required.');
    else if (nameStr.length > MAX_FIELD_LENGTH) errors.push(`Product Name is too long (max ${MAX_FIELD_LENGTH} characters).`);

    const partNoStr = partNoRaw == null ? '' : String(partNoRaw).trim();
    if (!partNoStr) errors.push('Part No is required.');
    else if (partNoStr.length > MAX_FIELD_LENGTH) errors.push(`Part No is too long (max ${MAX_FIELD_LENGTH} characters).`);

    let price = null;
    if (priceRaw == null || priceRaw === '') {
      errors.push('Price is required.');
    } else {
      const n = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
      if (!Number.isFinite(n)) errors.push(`Price "${priceRaw}" is not a valid number.`);
      else price = n; // no negative-price rule — none exists for products today, so none is added here
    }

    if (partNoStr) {
      const dupeRows = (rowsByPartNo.get(partNoStr) || []).filter((n) => n !== r.rowNumber);
      if (dupeRows.length > 0) {
        errors.push(`Duplicate Part No "${partNoStr}" also appears in row ${dupeRows.join(', ')}.`);
      }
    }

    if (errors.length > 0) {
      errorRows.push({ rowNumber: r.rowNumber, productName: nameStr || null, partNo: partNoStr || null, price, errors });
    } else {
      okRows.push({ rowNumber: r.rowNumber, productName: nameStr, partNo: partNoStr, price });
    }
  }

  return { validRows: okRows, errorRows };
}
