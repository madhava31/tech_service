import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { parseWorkbookRows, normalizeDate, normalizeState } from '../db/importer.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INSERT_CHUNK_SIZE = 500;
const MAX_SKIPPED_SAMPLES = 20;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNumber(raw) {
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && raw.result != null) return Number(raw.result);
  return Number(String(raw).replace(/[₹,\s]/g, ''));
}

function toText(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') {
    if (Array.isArray(raw.richText)) return raw.richText.map((t) => t.text || '').join('').trim() || null;
    if (typeof raw.text === 'string') return raw.text.trim() || null;
    if (raw.result != null) return String(raw.result).trim() || null;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    return null;
  }
  return String(raw).trim() || null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function parseYear(raw) {
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw httpError(400, 'Invalid year');
  return year;
}

/**
 * Returns the stored analysis file for a year, or null when none has been uploaded.
 */
export async function getAnalysisStatus(year) {
  const batch = await db
    .prepare(`SELECT id, year, filename, row_count, imported_count, skipped_count, uploaded_at
              FROM analysis_batch WHERE year = ? ORDER BY id DESC LIMIT 1`)
    .get(year);
  if (!batch) return { year, exists: false };
  return {
    year,
    exists: true,
    batchId: batch.id,
    filename: batch.filename,
    rowCount: Number(batch.row_count),
    importedCount: Number(batch.imported_count),
    skippedCount: Number(batch.skipped_count),
    uploadedAt: batch.uploaded_at,
  };
}

/**
 * Parses a sales workbook (same layout as the Import Data sales file) and stores the rows dated
 * in `year` as that year's analysis data, replacing any previous upload for the year.
 * Rows from other years, or without a date / company / amount, are skipped and reported.
 */
export async function importAnalysisWorkbook(buffer, { filename, year }) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw httpError(400, 'Could not read the file. Please upload a valid .xlsx Excel file.');
  }
  if (!workbook.worksheets.length) throw httpError(400, 'The Excel file has no sheets.');

  const rows = parseWorkbookRows(workbook);
  if (!rows.length) throw httpError(400, 'The Excel file has no data rows.');

  const valid = [];
  const skipped = [];
  rows.forEach((r, i) => {
    const reasons = [];
    const dateRes = normalizeDate(r.date);
    if (!dateRes.value) reasons.push('missing or unreadable date');
    else if (dateRes.year !== year) reasons.push(`date is in ${dateRes.year}, not ${year}`);

    const companyName = toText(r.companyName);
    if (!companyName) reasons.push('missing company name');

    const totalAmount = toNumber(r.totalAmount);
    if (Number.isNaN(totalAmount)) reasons.push('missing or invalid total amount');

    if (reasons.length) {
      skipped.push({ row: i + 1, reasons });
      return;
    }

    const price = toNumber(r.price);
    const qty = toNumber(r.qty);
    valid.push([
      year,
      dateRes.value,
      toText(r.invoiceNo),
      companyName,
      toText(r.poNo),
      normalizeState(r.state).value,
      toText(r.hsnSac),
      toText(r.partNo),
      toText(r.description),
      Number.isNaN(price) ? null : price,
      Number.isNaN(qty) ? null : qty,
      totalAmount,
    ]);
  });

  if (!valid.length) {
    const firstReason = skipped[0]?.reasons[0];
    throw httpError(
      400,
      `No rows dated in ${year} were found in this file${firstReason ? ` (e.g. row 1: ${firstReason})` : ''}.`
    );
  }

  const batchId = await db.transaction(async () => {
    // One file per year: a new upload replaces the old one (rows go with it via ON DELETE CASCADE).
    await db.prepare(`DELETE FROM analysis_batch WHERE year = ?`).run(year);
    const batch = await db
      .prepare(`INSERT INTO analysis_batch (year, filename, row_count, imported_count, skipped_count)
                VALUES (?, ?, ?, ?, ?) RETURNING id`)
      .run(year, filename, rows.length, valid.length, skipped.length);
    const id = batch.lastInsertRowid;

    for (const group of chunk(valid, INSERT_CHUNK_SIZE)) {
      const placeholders = group.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      await db
        .prepare(`INSERT INTO analysis_record
                    (batch_id, year, sale_date, invoice_no, company_name, po_no, state, hsn_sac,
                     part_no, product_description, price, qty, total_amount)
                  VALUES ${placeholders}`)
        .run(...group.flatMap((v) => [id, ...v]));
    }
    return id;
  });

  return {
    year,
    batchId,
    filename,
    rowCount: rows.length,
    importedCount: valid.length,
    skippedCount: skipped.length,
    skippedSamples: skipped.slice(0, MAX_SKIPPED_SAMPLES),
  };
}

/**
 * Everything the analysis view's charts need for one year, computed from analysis_record only.
 */
export async function getAnalysisSummary(year) {
  const status = await getAnalysisStatus(year);
  if (!status.exists) throw httpError(404, `No ${year} analysis data found. Please add a file.`);

  const totals = await db
    .prepare(`SELECT COALESCE(SUM(total_amount), 0) AS revenue,
                     COALESCE(SUM(qty), 0) AS qty,
                     COUNT(*) AS line_count,
                     COUNT(DISTINCT NULLIF(invoice_no, '')) AS invoice_count,
                     COUNT(DISTINCT company_name) AS company_count,
                     COUNT(DISTINCT COALESCE(NULLIF(part_no, ''), product_description)) AS product_count
              FROM analysis_record WHERE year = ?`)
    .get(year);

  const monthlyRows = await db
    .prepare(`SELECT EXTRACT(MONTH FROM sale_date)::int AS month,
                     COALESCE(SUM(total_amount), 0) AS revenue,
                     COUNT(DISTINCT NULLIF(invoice_no, '')) AS invoices
              FROM analysis_record WHERE year = ?
              GROUP BY 1 ORDER BY 1`)
    .all(year);
  const byMonth = new Map(monthlyRows.map((m) => [Number(m.month), m]));
  const monthly = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    revenue: Number(byMonth.get(i + 1)?.revenue || 0),
    invoices: Number(byMonth.get(i + 1)?.invoices || 0),
  }));

  const topCompanies = await db
    .prepare(`SELECT company_name AS name,
                     SUM(total_amount) AS revenue,
                     COUNT(DISTINCT NULLIF(invoice_no, '')) AS invoices
              FROM analysis_record WHERE year = ?
              GROUP BY company_name ORDER BY revenue DESC LIMIT 10`)
    .all(year);

  const topProducts = await db
    .prepare(`SELECT MAX(part_no) AS part_no,
                     MAX(COALESCE(product_description, part_no, 'Unknown product')) AS description,
                     SUM(total_amount) AS revenue,
                     COALESCE(SUM(qty), 0) AS qty
              FROM analysis_record WHERE year = ?
              GROUP BY COALESCE(NULLIF(part_no, ''), product_description)
              ORDER BY revenue DESC LIMIT 10`)
    .all(year);

  const byState = await db
    .prepare(`SELECT COALESCE(NULLIF(state, ''), 'Unknown') AS state, SUM(total_amount) AS revenue
              FROM analysis_record WHERE year = ?
              GROUP BY 1 ORDER BY revenue DESC LIMIT 10`)
    .all(year);

  const revenue = Number(totals.revenue);
  const invoiceCount = Number(totals.invoice_count);
  const activeMonths = monthly.filter((m) => m.revenue > 0);
  const best = activeMonths.reduce((a, b) => (b.revenue > (a?.revenue ?? -Infinity) ? b : a), null);

  return {
    ...status,
    kpis: {
      totalRevenue: revenue,
      invoiceCount,
      lineCount: Number(totals.line_count),
      companyCount: Number(totals.company_count),
      productCount: Number(totals.product_count),
      totalQty: Number(totals.qty),
      avgInvoiceValue: invoiceCount ? revenue / invoiceCount : 0,
      avgMonthlyRevenue: activeMonths.length ? revenue / activeMonths.length : 0,
      bestMonth: best ? { label: best.label, revenue: best.revenue } : null,
    },
    monthly,
    topCompanies: topCompanies.map((c) => ({ name: c.name, revenue: Number(c.revenue), invoices: Number(c.invoices) })),
    topProducts: topProducts.map((p) => ({
      partNo: p.part_no || null,
      description: p.description,
      revenue: Number(p.revenue),
      qty: Number(p.qty),
    })),
    byState: byState.map((s) => ({ state: s.state, revenue: Number(s.revenue) })),
  };
}

/**
 * Removes the year's analysis file and all its rows. Returns whether anything was deleted.
 */
export async function deleteAnalysis(year) {
  const result = await db.prepare(`DELETE FROM analysis_batch WHERE year = ?`).run(year);
  return result.changes > 0;
}
