import ExcelJS from 'exceljs';
import db from './index.js';

const STATE_MAP = {
  'a.p': 'Andhra Pradesh',
  'a.p.': 'Andhra Pradesh',
  'h.p': 'Himachal Pradesh',
  'himachal pradesh': 'Himachal Pradesh',
  telangana: 'Telangana',
  chennai: 'Chennai',
  bangalore: 'Bangalore',
  chandigarh: 'Chandigarh',
  karnataka: 'Karnataka',
  maharashtra: 'Maharashtra',
  gujarat: 'Gujarat',
  delhi: 'Delhi',
};

function normalizeState(raw) {
  if (raw == null) return { value: null, ok: true };
  const s = String(raw).trim();
  if (!s) return { value: null, ok: true };
  const key = s.toLowerCase();
  if (STATE_MAP[key]) return { value: STATE_MAP[key], ok: true };
  // Not a recognizable state name (e.g. stray numbers) -> flag for review, keep raw value visible
  if (!/[a-zA-Z]/.test(s)) return { value: s, ok: false };
  return { value: s, ok: true };
}

// Source files mix "M-D-YYYY" (dash) and ambiguous D/M or M/D (slash) strings
// alongside native Excel date objects. Disambiguate using whichever component is >12.
function buildDateFromParts(aStr, bStr, yStr, kind) {
  const a = parseInt(aStr, 10);
  const b = parseInt(bStr, 10);
  const y = parseInt(yStr, 10);
  let day, month;
  if (kind === 'dash') {
    // dash strings observed as M-D-YYYY, e.g. "1-18-2024"
    if (a <= 12 && b > 12) { month = a; day = b; }
    else if (b <= 12 && a > 12) { month = b; day = a; }
    else { month = a; day = b; } // both <=12: default to M-D-Y
  } else {
    // slash strings observed as D/M/YYYY, e.g. "25/1/2024", but some are M/D/YYYY
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else { day = a; month = b; } // both <=12: default to D/M/Y (India convention)
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { iso: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year: y };
}

function normalizeDate(raw) {
  if (raw == null) return { value: null, year: null };

  if (raw instanceof Date) {
    return { value: raw.toISOString().slice(0, 10), year: raw.getFullYear() };
  }

  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const parsed = buildDateFromParts(m[1], m[2], m[3], 'dash');
    return parsed ? { value: parsed.iso, year: parsed.year } : { value: null, year: null };
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const parsed = buildDateFromParts(m[1], m[2], m[3], 'slash');
    return parsed ? { value: parsed.iso, year: parsed.year } : { value: null, year: null };
  }

  const fallback = new Date(s);
  if (Number.isNaN(fallback.getTime())) return { value: null, year: null };
  return { value: fallback.toISOString().slice(0, 10), year: fallback.getFullYear() };
}

function normalizePoNo(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

// Header text is matched case-insensitively against these aliases, order-independent — source
// files arrive from different customers/teams whose column order (and exact wording) varies.
const HEADER_ALIASES = {
  date: ['date', 'sale date', 'invoice date'],
  invoiceNo: ['invoice no', 'invoice number', 'invoice no.', 'inv no'],
  companyName: ['company name', 'company', 'customer', 'customer name', 'client', 'client name'],
  poNo: ['po no', 'po number', 'p.o. no', 'purchase order no', 'po'],
  state: ['state'],
  hsnSac: ['hsn/sac', 'hsn sac', 'hsn', 'sac', 'hsn/sac code'],
  partNo: ['part no', 'part number', 'partno', 'part_no'],
  description: ['description', 'product description', 'product name', 'item description', 'item'],
  price: ['price', 'unit price', 'rate'],
  qty: ['qty', 'quantity'],
  totalAmount: ['total amount', 'total', 'amount', 'total value'],
};
// Fields relied on for business logic (de-dup, product catalogue, company linking) — a header
// row is only trusted as "found" once these resolve; the rest (date/po/state/hsn) are optional
// even in a well-formed file, same as always.
const CORE_FIELDS = ['companyName', 'partNo', 'description', 'totalAmount'];
const MAX_HEADER_SCAN_ROWS = 10;

function cellTextValue(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    if (Array.isArray(raw.richText)) return raw.richText.map((t) => t.text || '').join('');
    if (typeof raw.text === 'string') return raw.text;
    if (raw.result != null) return String(raw.result);
    return '';
  }
  return String(raw);
}

function findColumnIndexes(headerRowValues) {
  const indexes = {};
  for (let i = 1; i < headerRowValues.length; i++) {
    const text = cellTextValue(headerRowValues[i]).trim().toLowerCase();
    if (!text) continue;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (indexes[key] == null && aliases.includes(text)) indexes[key] = i;
    }
  }
  return indexes;
}

export function parseWorkbookRows(workbook) {
  const sheet = workbook.worksheets[0];

  // Try to find a real header row (any order, possibly below a title row) in the first few
  // rows. If none is found, fall back to the legacy fixed-position layout (row 1 = header,
  // columns A-K in the original order) so files without recognizable header text still work.
  let headerRowNumber = null;
  let columnIndexes = null;
  const lastRowToScan = Math.min(MAX_HEADER_SCAN_ROWS, sheet.rowCount || MAX_HEADER_SCAN_ROWS);
  for (let r = 1; r <= lastRowToScan; r++) {
    const candidate = findColumnIndexes(sheet.getRow(r).values);
    if (CORE_FIELDS.every((key) => candidate[key] != null)) {
      headerRowNumber = r;
      columnIndexes = candidate;
      break;
    }
  }
  if (!columnIndexes) {
    headerRowNumber = 1;
    columnIndexes = { date: 1, invoiceNo: 2, companyName: 3, poNo: 4, state: 5, hsnSac: 6, partNo: 7, description: 8, price: 9, qty: 10, totalAmount: 11 };
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const values = row.values; // 1-indexed, values[0] is empty
    const isBlank = Object.values(columnIndexes).every((i) => {
      const v = values[i];
      return v == null || v === '';
    });
    if (isBlank) return;
    rows.push({
      date: values[columnIndexes.date],
      invoiceNo: values[columnIndexes.invoiceNo],
      companyName: values[columnIndexes.companyName],
      poNo: values[columnIndexes.poNo],
      state: values[columnIndexes.state],
      hsnSac: values[columnIndexes.hsnSac],
      partNo: values[columnIndexes.partNo],
      description: values[columnIndexes.description],
      price: values[columnIndexes.price],
      qty: values[columnIndexes.qty],
      totalAmount: values[columnIndexes.totalAmount],
    });
  });
  return rows;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Mirrors the old `COALESCE(col,'') = ? ... COALESCE(num,0) = ?` SQL comparison used for
// duplicate detection, as an in-memory key instead of a per-row query. \u0001 (a control
// character that can't appear in normal spreadsheet text) separates fields so concatenation
// can't produce a false match across a field boundary (e.g. "AB"+"" vs "A"+"B").
function dedupeKey({ invoiceNo, companyName, dateValue, partNo, qty, price, totalAmount }) {
  return [
    invoiceNo || '',
    companyName || '',
    dateValue || '',
    partNo || '',
    Number.isNaN(qty) ? 0 : qty,
    Number.isNaN(price) ? 0 : price,
    Number.isNaN(totalAmount) ? 0 : totalAmount,
  ].join('\u0001');
}

/**
 * Imports a sales workbook (as a Buffer) into the database.
 * @param {Buffer} buffer
 * @param {{ filename: string, yearLabel?: string }} options
 */
export async function importWorkbook(buffer, { filename, yearLabel }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = parseWorkbookRows(workbook);

  const expectedYear = yearLabel && /^\d{4}$/.test(yearLabel) ? Number(yearLabel) : null;

  // Pass 1: normalize + validate every row in memory — identical per-row logic to the
  // original row-by-row implementation, just no longer interleaved with DB round-trips.
  const prepared = rows.map((r) => {
    const reasons = [];

    const dateRes = normalizeDate(r.date);
    if (!dateRes.value) reasons.push('unparseable date');
    else if (expectedYear && dateRes.year !== expectedYear) {
      reasons.push(`date year ${dateRes.year} does not match declared year ${expectedYear}`);
    }

    const stateRes = normalizeState(r.state);
    if (!stateRes.ok) reasons.push('unrecognized state value');

    const companyName = r.companyName ? String(r.companyName).trim() : null;
    if (!companyName) reasons.push('missing company name');

    const partNo = r.partNo ? String(r.partNo).trim() : null;
    const description = r.description ? String(r.description).trim() : null;
    if (!partNo || !description) reasons.push('missing product info');

    const price = typeof r.price === 'number' ? r.price : Number(r.price);
    const qty = typeof r.qty === 'number' ? r.qty : Number(r.qty);
    const totalAmount = typeof r.totalAmount === 'number' ? r.totalAmount : Number(r.totalAmount);
    if (Number.isNaN(totalAmount)) reasons.push('missing/invalid total amount');

    return {
      reasons,
      dateValue: dateRes.value,
      stateValue: stateRes.value,
      companyName,
      partNo,
      description,
      price,
      qty,
      totalAmount,
      invoiceNo: r.invoiceNo != null ? String(r.invoiceNo) : null,
      hsnSac: r.hsnSac != null ? String(r.hsnSac) : null,
      poNo: normalizePoNo(r.poNo),
    };
  });

  const companiesBefore = (await db.prepare(`SELECT COUNT(*) c FROM company`).get()).c;
  const productsBefore = (await db.prepare(`SELECT COUNT(*) c FROM product`).get()).c;

  const insertBatch = db.prepare(
    `INSERT INTO import_batch (filename, year_label, row_count) VALUES (?, ?, ?) RETURNING id`
  );
  const batchInfo = await insertBatch.run(filename, yearLabel || null, rows.length);
  const batchId = batchInfo.lastInsertRowid;

  let importedCount = 0;
  let skippedDuplicateCount = 0;
  let flaggedCount = 0;

  await db.transaction(async () => {
    // --- Pass 2: duplicate detection, done once against the whole table instead of once per
    // row. Matches on full row content (not just invoice_no+part_no) because a meaningful share
    // of rows are missing invoice_no, and matching on invoice_no alone let those slip through as
    // "new" on every re-upload, silently double-counting revenue. Rows with nothing distinctive
    // to match on skip the check entirely (same "hasEnoughToDedupe" rule as before) but still
    // join the key set afterward, since they do get inserted and so become checkable state for
    // later rows — exactly mirroring how the old per-row loop saw its own prior inserts within
    // the same transaction. ---
    const existing = await db.prepare(
      `SELECT invoice_no AS "invoiceNo", company_name AS "companyName", sale_date::text AS "dateValue",
              part_no AS "partNo", qty, price, total_amount AS "totalAmount"
       FROM sales_record`
    ).all();
    const seenKeys = new Set(existing.map(dedupeKey));

    const keptRows = [];
    for (const p of prepared) {
      const key = dedupeKey(p);
      const hasEnoughToDedupe = (p.invoiceNo || p.partNo) && p.companyName;
      if (hasEnoughToDedupe && seenKeys.has(key)) {
        skippedDuplicateCount += 1;
        continue;
      }
      seenKeys.add(key);
      keptRows.push(p);
    }

    // --- Companies: resolve existing ids in bulk, then bulk-insert any new names. A name's
    // state is whichever kept row first introduced it, matching the old per-row
    // "INSERT ... ON CONFLICT (name) DO NOTHING" (only the first insert attempt for a given
    // name ever took effect; later ones silently no-opped). ---
    const companyNames = [...new Set(keptRows.filter((p) => p.companyName).map((p) => p.companyName))];
    const companyIdByName = new Map();
    if (companyNames.length > 0) {
      const existingCompanies = await db.prepare(`SELECT id, name FROM company WHERE name = ANY(?::text[])`).all(companyNames);
      for (const c of existingCompanies) companyIdByName.set(c.name, c.id);

      const newCompanyState = new Map();
      for (const p of keptRows) {
        if (p.companyName && !companyIdByName.has(p.companyName) && !newCompanyState.has(p.companyName)) {
          newCompanyState.set(p.companyName, p.stateValue);
        }
      }
      if (newCompanyState.size > 0) {
        const entries = [...newCompanyState.entries()];
        for (const batch of chunk(entries, 500)) {
          const placeholders = batch.map(() => '(?, ?)').join(', ');
          const params = batch.flatMap(([name, state]) => [name, state]);
          await db.prepare(
            `INSERT INTO company (name, state) VALUES ${placeholders} ON CONFLICT (name) DO NOTHING`
          ).run(...params);
        }
        const newNames = entries.map(([name]) => name);
        const refetched = await db.prepare(`SELECT id, name FROM company WHERE name = ANY(?::text[])`).all(newNames);
        for (const c of refetched) companyIdByName.set(c.name, c.id);
      }
    }

    // --- Products: same bulk upsert, preserving "last kept row wins" for description/hsn_sac
    // (each row's UPSERT used to overwrite the previous one, so the last one standing wins) and
    // "first kept row wins" for price — because the UPDATE branch never touched default_price,
    // only a genuinely new product's initial INSERT ever set it. ---
    const eligibleForProduct = keptRows.filter((p) => p.partNo && p.description && !Number.isNaN(p.price));
    const productLast = new Map(); // partNo -> { hsnSac, description }
    const productFirstPrice = new Map(); // partNo -> price
    for (const p of eligibleForProduct) {
      productLast.set(p.partNo, { hsnSac: p.hsnSac, description: p.description });
      if (!productFirstPrice.has(p.partNo)) productFirstPrice.set(p.partNo, p.price);
    }
    if (productLast.size > 0) {
      const entries = [...productLast.entries()];
      for (const batch of chunk(entries, 500)) {
        const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
        const params = batch.flatMap(([partNo, v]) => [partNo, v.hsnSac, v.description, productFirstPrice.get(partNo)]);
        await db.prepare(
          `INSERT INTO product (part_no, hsn_sac, description, default_price) VALUES ${placeholders}
           ON CONFLICT (part_no) DO UPDATE SET description = excluded.description, hsn_sac = excluded.hsn_sac`
        ).run(...params);
      }
    }

    // --- Sales records: one bulk insert per chunk instead of one statement per row. ---
    for (const batch of chunk(keptRows, 500)) {
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = batch.flatMap((p) => [
        p.dateValue,
        p.invoiceNo,
        p.companyName,
        p.companyName ? companyIdByName.get(p.companyName) ?? null : null,
        p.poNo,
        p.stateValue,
        p.hsnSac,
        p.partNo,
        p.description,
        Number.isNaN(p.price) ? null : p.price,
        Number.isNaN(p.qty) ? null : p.qty,
        Number.isNaN(p.totalAmount) ? null : p.totalAmount,
        p.reasons.length > 0 ? 1 : 0,
        p.reasons.join('; ') || null,
        batchId,
      ]);
      await db.prepare(
        `INSERT INTO sales_record
          (sale_date, invoice_no, company_name, company_id, po_no, state, hsn_sac, part_no, product_description, price, qty, total_amount, needs_review, review_reason, import_batch_id)
         VALUES ${placeholders}`
      ).run(...params);
    }

    importedCount = keptRows.length;
    flaggedCount = keptRows.filter((p) => p.reasons.length > 0).length;
  });

  const companiesAdded = (await db.prepare(`SELECT COUNT(*) c FROM company`).get()).c - companiesBefore;
  const productsAdded = (await db.prepare(`SELECT COUNT(*) c FROM product`).get()).c - productsBefore;

  await db.prepare(
    `UPDATE import_batch SET imported_count = ?, skipped_duplicate_count = ?, flagged_count = ?, companies_added = ?, products_added = ? WHERE id = ?`
  ).run(importedCount, skippedDuplicateCount, flaggedCount, companiesAdded, productsAdded, batchId);

  return {
    batchId,
    rowCount: rows.length,
    importedCount,
    skippedDuplicateCount,
    flaggedCount,
    companiesAdded,
    productsAdded,
  };
}
