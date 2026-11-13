import ExcelJS from 'exceljs';

// Manually-maintained catalogue files are small; this is a generous but bounded cap against
// pathological memory use, not a real-world limit anyone should hit.
export const MAX_IMPORT_ROWS = 2000;
export const MAX_FIELD_LENGTH = 200;

function normalizeHeader(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[_\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Header text is matched case-insensitively against these aliases (not by column position —
// unlike the sales-record importer, this format is small, named, and human-maintained, so
// matching by header text is more forgiving of column reordering).
const HEADER_ALIASES = {
  productName: [
    'product name',
    'product_name',
    'name',
    'description',
    'discription',
    'discription material',
    'description material',
    'material',
    'product description',
    'item name',
    'item description',
    'product',
    'item',
    'part description',
  ],
  partNo: [
    'part no',
    'part_no',
    'part number',
    'part_number',
    'partno',
    'part#',
    'part',
    'sku',
    'item code',
    'item_code',
    'product code',
    'product_code',
    'model no',
    'model_no',
    'code',
  ],
  price: [
    'price',
    'default price',
    'default_price',
    'unit price',
    'unit_price',
    'rate',
    'mrp',
    'list price',
    'list_price',
    'amount',
    'standard price',
  ],
  hsnSac: [
    'hsn',
    'hsn/sac',
    'hsn_sac',
    'hsn sac',
    'hsnsac',
    'hsn code',
    'hsn_code',
    'sac',
  ],
  unit: [
    'unit',
    'uom',
    'unit of measure',
    'units',
  ],
};

const REQUIRED_COLUMN_LABELS = { productName: 'Product Name', partNo: 'Part No' };
const REQUIRED_KEYS = ['productName', 'partNo'];

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
  if (!headerRow) return indexes;
  for (let i = 1; i < headerRow.length; i++) {
    const raw = headerRow[i];
    if (raw == null) continue;
    const rawText = cellTextValue(raw).trim().toLowerCase();
    const normalizedText = normalizeHeader(rawText);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (indexes[key] == null && (aliases.includes(rawText) || aliases.includes(normalizedText))) {
        indexes[key] = i;
      }
    }
  }
  return indexes;
}

// How many leading rows to check for the header — tolerates a title/logo row (e.g. "Product
// Catalogue Export") sitting above the real header row, which real-world exports commonly have.
const MAX_HEADER_SCAN_ROWS = 10;

// A formula/rich-text/hyperlink cell comes back from ExcelJS as an object, not a primitive —
// treated as unusable rather than evaluated, so no spreadsheet formula is ever executed.
function cellToPrimitive(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return value.result;
    if (value.text != null) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text || '').join('');
    return undefined; // signals "unusable", distinct from null/empty
  }
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

    // 1. First, search for a single row that contains all required columns
    for (let r = 1; r <= lastRowToScan; r++) {
      const candidate = findColumnIndexes(sheet.getRow(r).values);
      if (REQUIRED_KEYS.every((key) => candidate[key] != null)) {
        headerRowNumber = r;
        columnIndexes = candidate;
        break;
      }
    }

    // 2. If not found in a single row, combine candidate columns across rows 1..r (handles split/multiline headers)
    if (!columnIndexes) {
      const accumulated = {};
      for (let r = 1; r <= lastRowToScan; r++) {
        const candidate = findColumnIndexes(sheet.getRow(r).values);
        for (const [k, v] of Object.entries(candidate)) {
          if (accumulated[k] == null) accumulated[k] = v;
        }
        if (REQUIRED_KEYS.every((key) => accumulated[key] != null)) {
          headerRowNumber = r;
          columnIndexes = accumulated;
          break;
        }
      }
    }

    if (!columnIndexes) {
      // Collect best attempt to report accurately which required column is missing
      const bestAttempt = {};
      for (let r = 1; r <= lastRowToScan; r++) {
        const candidate = findColumnIndexes(sheet.getRow(r).values);
        for (const [k, v] of Object.entries(candidate)) {
          if (bestAttempt[k] == null) bestAttempt[k] = v;
        }
      }
      for (const key of REQUIRED_KEYS) {
        if (bestAttempt[key] == null) throw new MissingColumnError(REQUIRED_COLUMN_LABELS[key]);
      }
      headerRowNumber = 1;
      columnIndexes = bestAttempt;
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const values = row.values;
      const productName = cellToPrimitive(columnIndexes.productName ? values[columnIndexes.productName] : null);
      const partNo = cellToPrimitive(columnIndexes.partNo ? values[columnIndexes.partNo] : null);
      const price = cellToPrimitive(columnIndexes.price ? values[columnIndexes.price] : null);
      const hsnSac = cellToPrimitive(columnIndexes.hsnSac ? values[columnIndexes.hsnSac] : null);
      const unit = cellToPrimitive(columnIndexes.unit ? values[columnIndexes.unit] : null);

      const isBlank = [productName, partNo, price, hsnSac].every((v) => v == null || v === '');
      if (isBlank) return;
      rows.push({ rowNumber, productName, partNo, price, hsnSac, unit });
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
    const hsnSacRaw = r.hsnSac === undefined ? null : r.hsnSac;
    const unitRaw = r.unit === undefined ? null : r.unit;

    const nameStr = productName == null ? '' : String(productName).trim();
    if (!nameStr) errors.push('Product Name is required.');
    else if (nameStr.length > MAX_FIELD_LENGTH) errors.push(`Product Name is too long (max ${MAX_FIELD_LENGTH} characters).`);

    const partNoStr = partNoRaw == null ? '' : String(partNoRaw).trim();
    if (!partNoStr) errors.push('Part No is required.');
    else if (partNoStr.length > MAX_FIELD_LENGTH) errors.push(`Part No is too long (max ${MAX_FIELD_LENGTH} characters).`);

    let price = 0;
    if (priceRaw != null && priceRaw !== '') {
      const n = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`Price "${priceRaw}" is not a valid number.`);
      } else {
        price = n;
      }
    }

    let hsnSac = null;
    if (hsnSacRaw != null) {
      const cleanHsn = String(hsnSacRaw).trim();
      if (cleanHsn && cleanHsn !== '-') hsnSac = cleanHsn;
    }

    let unit = 'Nos';
    if (unitRaw != null) {
      const cleanUnit = String(unitRaw).trim();
      if (cleanUnit) unit = cleanUnit;
    }

    if (partNoStr) {
      const dupeRows = (rowsByPartNo.get(partNoStr) || []).filter((n) => n !== r.rowNumber);
      if (dupeRows.length > 0) {
        errors.push(`Duplicate Part No "${partNoStr}" also appears in row ${dupeRows.join(', ')}.`);
      }
    }

    if (errors.length > 0) {
      errorRows.push({ rowNumber: r.rowNumber, productName: nameStr || null, partNo: partNoStr || null, price, hsnSac, unit, errors });
    } else {
      okRows.push({ rowNumber: r.rowNumber, productName: nameStr, partNo: partNoStr, price, hsnSac, unit });
    }
  }

  return { validRows: okRows, errorRows };
}
