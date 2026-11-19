// The customer's PO number(s) and date(s) of a quotation, for the performa invoice (PI).
//
// A PI is raised against the customer's purchase order, so it shows the PO number and PO date, not the quotation
// number. The POs come from "PO received" (quotation_po, migration 008); a quotation whose PO was entered the older
// way (Convert to Purchase Order, with the customer's reference) is included too. A quotation without any PO keeps
// the quotation number as its reference.
import db from '../db/index.js';
import { poReceivedReady } from './poReceived.js';

const day = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Merges the POs of one quotation into one list, oldest first, without repeating a PO number.
 * received: [{ po_number, po_date }] from PO received; legacy: [{ po_number, po_date }] from purchase orders.
 */
export function mergePoRefs(received = [], legacy = []) {
  const seen = new Set();
  const out = [];
  for (const r of [...received, ...legacy]) {
    const number = String(r?.po_number ?? '').trim();
    if (!number) continue;
    const k = number.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ po_number: number, po_date: day(r.po_date) });
  }
  return out.sort((a, b) => String(a.po_date || '9999').localeCompare(String(b.po_date || '9999')));
}

/**
 * The reference lines printed on a PI: "Against PO No." and "PO Date" when the quotation has a PO, else the quotation
 * number. formatDate turns YYYY-MM-DD into the printed date.
 */
export function piReferenceLines(refs, quotationNumber, formatDate = (d) => d) {
  if (!refs || refs.length === 0) return quotationNumber ? [`Against Quotation: ${quotationNumber}`] : [];
  const dates = refs.map((r) => (r.po_date ? formatDate(r.po_date) : '—'));
  return [`Against PO No. : ${refs.map((r) => r.po_number).join(', ')}`, `PO Date : ${dates.join(', ')}`];
}

/** Loads the PO references for several quotations: Map quotation_id -> [{ po_number, po_date }]. */
export async function loadPoRefs(quotationIds) {
  const ids = [...new Set((quotationIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const result = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const arr = `{${ids.join(',')}}`;
  const received = new Map();
  if (await poReceivedReady()) {
    const rows = await db.prepare(`SELECT quotation_id, po_number, po_date FROM quotation_po WHERE quotation_id = ANY(?::int[]) ORDER BY po_date, id`).all(arr);
    for (const r of rows) (received.get(Number(r.quotation_id)) || received.set(Number(r.quotation_id), []).get(Number(r.quotation_id))).push(r);
  }
  const legacy = new Map();
  try {
    const rows = await db
      .prepare(
        `SELECT quotation_id, COALESCE(NULLIF(BTRIM(client_po_ref), ''), number) AS po_number, date AS po_date
           FROM purchase_order WHERE quotation_id = ANY(?::int[]) AND supplier_id IS NULL ORDER BY date, id`
      )
      .all(arr);
    for (const r of rows) (legacy.get(Number(r.quotation_id)) || legacy.set(Number(r.quotation_id), []).get(Number(r.quotation_id))).push(r);
  } catch (err) {
    console.error('[poRefs] could not read the purchase orders:', err?.message);
  }
  for (const id of ids) result.set(id, mergePoRefs(received.get(id), legacy.get(id)));
  return result;
}
