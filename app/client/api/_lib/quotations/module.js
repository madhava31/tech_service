import db from '../db/index.js';
import { createSchemaGuard } from '../db/schemaGuard.js';

// Quotation module (migration 002): catalogue-only lines, TS/<FY>/<6-digit> numbering, editable
// terms printed exactly as saved, and a snapshot of each product's name and key features.

export const QUOTATION_MODULE_COLUMNS = {
  product: ['make', 'key_features'],
  quotation: ['contact_person', 'opportunity_ref', 'terms', 'created_by_user_id'],
  quotation_item: ['product_name', 'make', 'key_features'],
  quotation_number_counter: ['fy', 'last_seq'],
};

export const requireQuotationModule = createSchemaGuard(
  QUOTATION_MODULE_COLUMNS, 'Quotation', 'Unable to save the quotation. Please try again.', '002'
);

export const WARRANTY_REQUIRED = 'Enter the warranty for this quotation.';

/** Indian financial year (April to March) of an ISO date: 2026-11-03 -> "26-27". */
export function financialYear(isoDate) {
  const [y, m] = String(isoDate).slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/**
 * Next quotation number for the financial year of `isoDate`, e.g. TS/26-27/000001. One atomic
 * upsert: concurrent callers are serialised on the counter row, so a number is never handed out
 * twice. Call it inside the transaction that inserts the quotation, so a failed save does not
 * consume a number.
 */
export async function nextQuotationNumber(isoDate) {
  const fy = financialYear(isoDate);
  const row = await db
    .prepare(
      `INSERT INTO quotation_number_counter (fy, last_seq) VALUES (?, 1)
       ON CONFLICT (fy) DO UPDATE SET last_seq = quotation_number_counter.last_seq + 1
       RETURNING last_seq`
    )
    .get(fy);
  return `TS/${fy}/${String(row.last_seq).padStart(6, '0')}`;
}

export function cleanFeatures(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : [];
  return list.map((f) => String(f ?? '').trim()).filter(Boolean);
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Validates a quotation request from the new form and builds everything to store. Throws
 * { status, message } on invalid input. Lines must reference catalogue products by part number;
 * nothing is created in the catalogue and no list price is changed.
 */
export async function buildQuotation(body) {
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, expose: true }); };

  const companyId = Number(body.company_id);
  if (!companyId) fail('Select a customer.');
  const company = await db.prepare(`SELECT id, name FROM company WHERE id = ?`).get(companyId);
  if (!company) fail('The selected customer no longer exists.', 404);

  const date = String(body.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail('Enter a valid quotation date.');

  const taxPercent = body.tax_percent === undefined || body.tax_percent === '' ? 18 : Number(body.tax_percent);
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) fail('GST % must be between 0 and 100.');

  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) fail('Add at least one product.');

  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const it = lines[i] || {};
    const partNo = String(it.part_no ?? '').trim();
    if (!partNo) fail(`Line ${n}: select a part number.`);
    const product = await db.prepare(`SELECT * FROM product WHERE UPPER(part_no) = UPPER(?)`).get(partNo);
    if (!product) fail(`Line ${n}: part number ${partNo} is not in the product catalogue.`);
    const features = cleanFeatures(product.key_features);
    if (!features.length) fail(`Line ${n}: ${product.part_no} has no key features in the catalogue. Add them on the Products page first.`);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) fail(`Line ${n}: quantity must be more than 0.`);
    const unitPrice = Number(it.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) fail(`Line ${n}: unit price must be more than 0.`);
    const discount = it.discount_percent === undefined || it.discount_percent === '' ? 0 : Number(it.discount_percent);
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) fail(`Line ${n}: discount must be 0 or more and less than 100%.`);

    const unitSalesPrice = round2(unitPrice * (1 - discount / 100));
    const lineTotal = round2(unitSalesPrice * qty);
    items.push({
      product_id: product.id,
      part_no: product.part_no,
      product_name: product.description,
      make: product.make || null,
      key_features: features,
      hsn_sac: product.hsn_sac || null,
      qty,
      unit_price: unitPrice,
      discount_percent: discount,
      unit_sales_price: unitSalesPrice,
      gross: round2(unitPrice * qty),
      discount_amount: round2(unitPrice * qty - lineTotal),
      line_total: lineTotal,
    });
  }

  const rawTerms = Array.isArray(body.terms) ? body.terms : [];
  const terms = rawTerms
    .map((t) => ({ label: String(t?.label ?? '').trim(), text: String(t?.text ?? '').trim() }))
    .filter((t) => t.label || t.text);
  for (const t of terms) if (!t.label) fail('Every term needs a label.');
  const warranty = terms.find((t) => t.label.toLowerCase() === 'warranty');
  if (!warranty || !warranty.text) fail(WARRANTY_REQUIRED);

  const subtotal = round2(items.reduce((s, it) => s + it.line_total, 0));
  const gross = round2(items.reduce((s, it) => s + it.gross, 0));
  const taxAmount = round2(subtotal * (taxPercent / 100));
  const total = round2(subtotal + taxAmount);

  return {
    companyId,
    date,
    contactPerson: String(body.contact_person ?? '').trim() || null,
    opportunityRef: String(body.opportunity_ref ?? '').trim() || null,
    taxPercent,
    items,
    terms,
    totals: { gross, discount: round2(gross - subtotal), subtotal, taxAmount, total },
  };
}

/** Writes the header money/columns shared by insert and update. */
export function headerValues(q) {
  return [
    q.companyId, q.date, q.contactPerson, q.opportunityRef, JSON.stringify(q.terms),
    q.totals.gross, q.totals.discount, q.totals.subtotal, q.totals.subtotal,
    q.totals.subtotal, q.totals.subtotal, q.taxPercent, q.totals.taxAmount, q.totals.total,
  ];
}

export async function insertItems(quotationId, items) {
  const insert = db.prepare(
    `INSERT INTO quotation_item (
       quotation_id, product_id, part_no, description, product_name, make, key_features, hsn_sac,
       qty, price, amount, actual_unit_price, discount_type, discount_value, product_discount_amount,
       after_product_discount_amount, overall_discount_allocated, final_unit_price, final_line_total
     ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, 'percentage', ?, ?, ?, 0, ?, ?)`
  );
  for (const it of items) {
    await insert.run(
      quotationId, it.product_id, it.part_no, it.product_name, it.product_name, it.make, JSON.stringify(it.key_features), it.hsn_sac,
      it.qty, it.unit_price, it.line_total, it.unit_price, it.discount_percent, it.discount_amount,
      it.line_total, it.unit_sales_price, it.line_total
    );
  }
}
