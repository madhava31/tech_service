// Sent POs (migration 016): the purchase orders Technicon sends to its suppliers. Reading, checking and saving them.
import db from '../db/index.js';
import { missingColumns } from '../db/schemaGuard.js';
import { poFigures, SentPoError, TAX_TYPES } from './calc.js';
import { cleanUnit } from '../quotations/quotationUnit.js';

export const SENT_PO_COLUMNS = {
  sent_po: ['id', 'prefix', 'seq', 'number', 'company_id', 'supplier_name', 'order_date', 'due_date', 'state_of_supply', 'total', 'balance', 'terms_text'],
  sent_po_item: ['id', 'sent_po_id', 'line_no', 'qty', 'price', 'tax_type', 'amount'],
};

let ready = false;
/** True once migration 016 is applied (only a positive answer is cached). A failing check counts as "not yet". */
export async function sentPoReady() {
  if (ready) return true;
  try {
    ready = (await missingColumns(SENT_PO_COLUMNS)).length === 0;
  } catch (err) {
    console.error('[sent po] could not check the tables:', err?.message);
    return false;
  }
  return ready;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const str = (v, max, field, { multiline = false } = {}) => {
  if (v === undefined || v === null) return null;
  // Tabs and invisible characters (pasted from Excel or Word) would print as boxes on the PDF: tabs become one space.
  let s = String(v).replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '').replace(/[\t\u00a0]+/g, ' ').replace(CONTROL, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/ {2,}/g, ' ').trimEnd()).join('\n') : s.replace(/[\r\n]+/g, ' ');
  s = s.trim();
  if (s.length > max) throw new SentPoError(`${field} can be at most ${max} characters.`);
  return s || null;
};
const isoDay = (v) => {
  const d = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d ? d : null;
};
const numIn = (v, min, max, field) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new SentPoError(`${field} must be between ${min} and ${max}.`);
  return n;
};
const isId = (v) => /^\d{1,9}$/.test(String(v ?? '')) && Number(v) > 0;

/**
 * Checks a PO sent from the form. Returns everything to store; throws SentPoError (400) for anything wrong.
 * Lines with no part number, description or quantity are dropped (empty rows of the table).
 */
export function parseSentPoRequest(body = {}, today = new Date().toISOString().slice(0, 10)) {
  const companyId = isId(body.company_id) ? Number(body.company_id) : null;
  const supplierName = str(body.supplier_name, 200, 'The party name');
  if (!companyId && !supplierName) throw new SentPoError('Choose the party (supplier) or type its name.');

  const prefix = str(body.prefix, 20, 'The order number prefix') || '';
  let seq = null;
  if (body.seq !== undefined && body.seq !== null && body.seq !== '') {
    seq = Number(body.seq);
    if (!Number.isInteger(seq) || seq < 1 || seq > 999999999) throw new SentPoError('The order number must be a whole number above 0.');
  }
  const number = `${prefix}${seq ?? ''}`.trim();
  if (!number) throw new SentPoError('Enter the order number.');

  const orderDate = body.order_date ? isoDay(body.order_date) : today;
  if (!orderDate) throw new SentPoError('Enter a valid order date.');
  let dueDate = null;
  if (body.due_date) {
    dueDate = isoDay(body.due_date);
    if (!dueDate) throw new SentPoError('Enter a valid due date.');
    if (dueDate < orderDate) throw new SentPoError('The due date cannot be before the order date.');
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = [];
  for (const [i, it] of rawItems.entries()) {
    const partNo = str(it?.part_no, 60, `Line ${i + 1}: the item`);
    const description = str(it?.description, 500, `Line ${i + 1}: the description`, { multiline: true });
    if (!partNo && !description) continue; // an empty row
    const qty = Number(it?.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new SentPoError(`Line ${i + 1}: the quantity must be more than 0.`);
    const taxType = TAX_TYPES.includes(it?.tax_type) ? it.tax_type : 'NONE';
    items.push({
      product_id: isId(it?.product_id) ? Number(it.product_id) : null,
      part_no: partNo,
      description,
      hsn_sac: str(it?.hsn_sac, 20, `Line ${i + 1}: the HSN`),
      qty,
      unit: cleanUnit(it?.unit),
      price: numIn(it?.price, 0, 1e11, `Line ${i + 1}: the price`),
      discount_percent: numIn(it?.discount_percent, 0, 100, `Line ${i + 1}: the discount %`),
      discount_amount: numIn(it?.discount_amount, 0, 1e11, `Line ${i + 1}: the discount amount`),
      tax_type: taxType,
      tax_percent: taxType === 'GST' || taxType === 'IGST' ? numIn(it?.tax_percent, 0, 100, `Line ${i + 1}: the tax %`) : 0,
    });
  }
  if (!items.length) throw new SentPoError('Add at least one item.');
  if (items.length > 200) throw new SentPoError('A PO can have at most 200 lines.');

  const out = {
    company_id: companyId,
    supplier_name: supplierName,
    prefix,
    seq,
    number,
    order_date: orderDate,
    due_date: dueDate,
    state_of_supply: str(body.state_of_supply, 60, 'The state of supply'),
    price_includes_tax: body.price_includes_tax === true,
    round_off_enabled: body.round_off_enabled === true,
    advance_amount: numIn(body.advance_amount, 0, 1e12, 'The advance amount'),
    terms_title: str(body.terms_title, 80, 'The terms title'),
    terms_text: str(body.terms_text, 5000, 'The terms', { multiline: true }),
    payment_type: str(body.payment_type, 100, 'The payment type'),
    payment_reference: str(body.payment_reference, 100, 'The reference number'),
    payment_description: str(body.payment_description, 1000, 'The payment description', { multiline: true }),
    notes: str(body.notes, 1000, 'The notes', { multiline: true }),
    items,
  };
  const figures = poFigures(out);
  if (figures.advance_amount > figures.total + 0.005) throw new SentPoError('The advance cannot be more than the total.');
  return { ...out, figures };
}

/** The supplier company: the one chosen, else one with the typed name, else a new company saved as a supplier. */
async function resolveSupplier(parsed) {
  if (parsed.company_id) {
    const c = await db.prepare(`SELECT id, name FROM company WHERE id = ?`).get(parsed.company_id);
    if (!c) throw new SentPoError('The chosen party no longer exists.', 404);
    await db.prepare(`UPDATE company SET is_supplier = 1 WHERE id = ? AND COALESCE(is_supplier, 0) = 0`).run(c.id);
    return { id: c.id, name: c.name };
  }
  const found = await db.prepare(`SELECT id, name FROM company WHERE lower(btrim(name)) = lower(btrim(?)) ORDER BY id LIMIT 1`).get(parsed.supplier_name);
  if (found) {
    await db.prepare(`UPDATE company SET is_supplier = 1 WHERE id = ? AND COALESCE(is_supplier, 0) = 0`).run(found.id);
    return { id: found.id, name: found.name };
  }
  const created = await db
    .prepare(`INSERT INTO company (name, is_supplier, company_type) VALUES (?, 1, 'supplier') RETURNING id`)
    .run(parsed.supplier_name);
  return { id: created.lastInsertRowid, name: parsed.supplier_name };
}

const HEADER_COLUMNS = [
  'prefix', 'seq', 'number', 'company_id', 'supplier_name', 'order_date', 'due_date', 'state_of_supply', 'price_includes_tax',
  'round_off_enabled', 'round_off', 'total_qty', 'sub_total', 'total_discount', 'total_tax', 'total', 'advance_amount', 'balance',
  'terms_title', 'terms_text', 'payment_type', 'payment_reference', 'payment_description', 'notes',
];
const headerValues = (p, supplier) => [
  p.prefix, p.seq, p.number, supplier.id, supplier.name, p.order_date, p.due_date, p.state_of_supply, p.price_includes_tax,
  p.round_off_enabled, p.figures.round_off, p.figures.total_qty, p.figures.sub_total, p.figures.total_discount, p.figures.total_tax,
  p.figures.total, p.figures.advance_amount, p.figures.balance,
  p.terms_title, p.terms_text, p.payment_type, p.payment_reference, p.payment_description, p.notes,
];

async function insertLines(poId, parsed) {
  const ins = db.prepare(
    `INSERT INTO sent_po_item (sent_po_id, line_no, product_id, part_no, description, hsn_sac, qty, unit, price, discount_percent,
       discount_amount, taxable_amount, tax_type, tax_percent, tax_amount, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [i, it] of parsed.items.entries()) {
    const f = parsed.figures.lines[i];
    // A part typed that is in the catalogue is linked to it.
    let productId = it.product_id;
    if (!productId && it.part_no) {
      const p = await db.prepare(`SELECT id FROM product WHERE UPPER(part_no) = UPPER(?)`).get(it.part_no);
      productId = p ? p.id : null;
    }
    await ins.run(poId, i + 1, productId, it.part_no, it.description, it.hsn_sac, it.qty, it.unit, it.price, f.discount_percent,
      f.discount_amount, f.taxable_amount, f.tax_type, f.tax_percent, f.tax_amount, f.amount);
  }
}

const duplicate = (err, number) => (err?.code === '23505' ? new SentPoError(`PO number ${number} is already used. Choose another number.`, 409) : err);

export async function createSentPo(body, userId) {
  // A new PO always has prices before GST: the discount comes off, then GST is added on top (as on quotations).
  const parsed = parseSentPoRequest({ ...(body || {}), price_includes_tax: false });
  try {
    return await db.transaction(async () => {
      const supplier = await resolveSupplier(parsed);
      const info = await db
        .prepare(`INSERT INTO sent_po (${HEADER_COLUMNS.join(', ')}, created_by_user_id) VALUES (${HEADER_COLUMNS.map(() => '?').join(', ')}, ?) RETURNING id`)
        .run(...headerValues(parsed, supplier), userId ?? null);
      await insertLines(info.lastInsertRowid, parsed);
      return info.lastInsertRowid;
    });
  } catch (err) {
    throw duplicate(err, parsed.number);
  }
}

export async function updateSentPo(id, body) {
  let parsed = parseSentPoRequest({ ...(body || {}), price_includes_tax: false });
  try {
    return await db.transaction(async () => {
      const exists = await db.prepare(`SELECT id, price_includes_tax FROM sent_po WHERE id = ? FOR UPDATE`).get(id);
      if (!exists) throw new SentPoError('PO not found', 404);
      // An older PO saved with prices that already include GST may keep that, or be changed to prices before GST.
      // A PO can never be changed to "prices include GST": that is how GST ended up not being added.
      if (exists.price_includes_tax === true && body?.price_includes_tax === true) parsed = parseSentPoRequest(body);
      const supplier = await resolveSupplier(parsed);
      await db
        .prepare(`UPDATE sent_po SET ${HEADER_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`)
        .run(...headerValues(parsed, supplier), id);
      await db.prepare(`DELETE FROM sent_po_item WHERE sent_po_id = ?`).run(id);
      await insertLines(id, parsed);
      return id;
    });
  } catch (err) {
    throw duplicate(err, parsed.number);
  }
}

export async function deleteSentPo(id) {
  const r = await db.prepare(`DELETE FROM sent_po WHERE id = ?`).run(id);
  if (!r.changes) throw new SentPoError('PO not found', 404);
}

/** The PO with its lines and the supplier's address details (for the page and the PDF). */
export async function getSentPo(id) {
  const po = await db
    .prepare(
      `SELECT s.*, c.address AS company_address, c.state AS company_state, c.gstin AS company_gstin, c.phone AS company_phone,
              c.email AS company_email, c.contact_person AS company_contact_person, u.username AS created_by_username
         FROM sent_po s LEFT JOIN company c ON c.id = s.company_id LEFT JOIN app_user u ON u.id = s.created_by_user_id
        WHERE s.id = ?`
    )
    .get(id);
  if (!po) return null;
  const items = await db.prepare(`SELECT * FROM sent_po_item WHERE sent_po_id = ? ORDER BY line_no, id`).all(id);
  return { ...po, items };
}

/** The list, newest first. Filters: q (number, supplier or part), from / to (order date). */
export async function listSentPos(query = {}) {
  const where = [];
  const params = [];
  const q = String(query.q ?? '').trim();
  if (q) {
    where.push(`(s.number ILIKE ? OR s.supplier_name ILIKE ? OR EXISTS (SELECT 1 FROM sent_po_item i WHERE i.sent_po_id = s.id AND (i.part_no ILIKE ? OR i.description ILIKE ?)))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (isoDay(query.from)) { where.push(`s.order_date >= ?`); params.push(isoDay(query.from)); }
  if (isoDay(query.to)) { where.push(`s.order_date <= ?`); params.push(isoDay(query.to)); }
  const rows = await db
    .prepare(
      `SELECT s.id, s.number, s.order_date, s.due_date, s.supplier_name, s.company_id, s.state_of_supply,
              s.total::float8 AS total, s.advance_amount::float8 AS advance_amount, s.balance::float8 AS balance,
              (SELECT COUNT(*) FROM sent_po_item i WHERE i.sent_po_id = s.id)::int AS lines
         FROM sent_po s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY s.order_date DESC, s.id DESC LIMIT 500`
    )
    .all(...params);
  return rows;
}

/** The next number for a prefix (highest used + 1), and the prefix used last, so a new PO starts from it. */
export async function nextSentPoNumber(prefix) {
  const last = await db.prepare(`SELECT prefix, terms_title, terms_text FROM sent_po ORDER BY id DESC LIMIT 1`).get();
  const p = prefix !== undefined && prefix !== null ? String(prefix) : last?.prefix ?? '';
  const row = await db.prepare(`SELECT COALESCE(MAX(seq), 0)::int AS n FROM sent_po WHERE lower(prefix) = lower(?)`).get(p);
  return {
    prefix: p,
    seq: Number(row?.n || 0) + 1,
    last_prefix: last?.prefix ?? null,
    // A new PO starts with the terms of the last one, which is usually what is wanted.
    last_terms_title: last?.terms_title ?? null,
    last_terms_text: last?.terms_text ?? null,
  };
}
