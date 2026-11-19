// Terms & Conditions printed on a quotation PDF.
//
// By default they are worked out when the PDF is made: the payment terms of the quotation (advance % and due days), the
// delivery time from Settings (if set) and the validity from Settings. The user can edit them on the quotation form; the
// edited list is then saved with the quotation (quotation.terms) and printed exactly as written. "Special terms and notes"
// typed on the form still print below the list.
import db from '../db/index.js';
import { paymentTermsText } from '../payments/service.js';

class TermsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export const MAX_TERMS = 15;
const MAX_LABEL = 60;
const MAX_TEXT = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * The standard terms: Payment (from the quotation's advance %, else the text in Settings), Delivery (when Settings has a
 * delivery time) and Validity. q needs advance_percent and payment_due_days when known.
 */
export function defaultTerms(q = {}, settings = {}) {
  const s = settings || {};
  const hasAdvance = q.advance_percent !== undefined && q.advance_percent !== null && q.advance_percent !== '';
  return [
    hasAdvance
      ? { label: 'Payment', text: paymentTermsText(q.advance_percent, q.payment_due_days) }
      : s.payment_terms ? { label: 'Payment', text: String(s.payment_terms) } : null,
    s.delivery_time ? { label: 'Delivery', text: String(s.delivery_time) } : null,
    { label: 'Validity', text: `${Number(s.quotation_validity_days) || 15} days from the quotation date` },
  ].filter(Boolean);
}

/**
 * Checks the terms sent from the form. null means "back to the standard terms". Otherwise a list of { label, text };
 * rows with nothing in them are dropped and text is trimmed. Throws a 400 error for a list that is too long or a value
 * that is not a list.
 */
export function parseCustomTerms(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new TermsError('The terms must be a list.');
  if (value.length > MAX_TERMS * 2) throw new TermsError(`Use at most ${MAX_TERMS} terms.`);
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') throw new TermsError('Each term needs a heading and a text.');
    const label = String(row.label ?? '').replace(CONTROL, '').trim();
    const text = String(row.text ?? '').replace(CONTROL, '').trim();
    if (!label && !text) continue;
    if (label.length > MAX_LABEL) throw new TermsError(`A term heading can be at most ${MAX_LABEL} characters.`);
    if (text.length > MAX_TEXT) throw new TermsError(`A term text can be at most ${MAX_TEXT} characters.`);
    out.push({ label, text });
  }
  if (out.length > MAX_TERMS) throw new TermsError(`Use at most ${MAX_TERMS} terms.`);
  return out;
}

/** The saved terms of a quotation row as a clean list, or null when it has none (it then prints the standard terms). */
export function storedTerms(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  const rows = v.filter((t) => t && (String(t.label || '').trim() || String(t.text || '').trim())).map((t) => ({ label: String(t.label || ''), text: String(t.text || '') }));
  return rows;
}

/** Saves (or clears, with null) the terms of a quotation. `value` is checked with parseCustomTerms. */
export async function saveCustomTerms(quotationId, value) {
  const terms = parseCustomTerms(value);
  await db.prepare(`UPDATE quotation SET terms = ?::jsonb WHERE id = ?`).run(terms === null ? null : JSON.stringify(terms), quotationId);
}
