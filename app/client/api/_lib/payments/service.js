// Contact persons per company, and the advance %, due days and payments of each quotation.
// The tables and columns used here come from migration 004 (db/migrations/004_quotation_contacts_payments.sql).
//
// How a quotation's payment schedule is worked out:
//   advance = total x advance_percent, due payment_due_days after the first purchase order's date.
//   balance = total - advance, due payment_due_days after the first performa invoice's date.
//   Payments received are applied to the advance first, then to the balance.
//   A part has no due date until its PO or PI exists ("Not started").
import db from '../db/index.js';
import { createSchemaGuard, missingColumns } from '../db/schemaGuard.js';

export const PAYMENTS_COLUMNS = {
  company_contact: ['id', 'company_id', 'name', 'phone', 'email'],
  quotation: ['contact_id', 'contact_person', 'contact_phone', 'contact_email', 'advance_percent', 'payment_due_days'],
  quotation_payment: ['id', 'quotation_id', 'amount', 'paid_on', 'mode', 'reference', 'note'],
  company_settings: ['default_advance_percent', 'default_payment_due_days'],
};

export const requirePayments = createSchemaGuard(
  PAYMENTS_COLUMNS,
  'Contacts and payments',
  'Something went wrong. Please try again.',
  '004'
);

// Lets routes that also work without migration 004, such as quotation create and save, skip the new fields
// until the migration has been applied. Only a positive answer is cached, as in createSchemaGuard.
let ready = false;
export async function paymentsReady() {
  if (ready) return true;
  ready = (await missingColumns(PAYMENTS_COLUMNS)).length === 0;
  return ready;
}

function clientError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cleanText = (v, max = 200) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Today's date in India as YYYY-MM-DD, so "overdue" flips at local midnight, not UTC midnight. */
export function todayIST() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

export function normaliseAdvancePercent(value, fallback = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw clientError('Advance payment must be between 0% and 100%');
  return round2(n);
}

export function normaliseDueDays(value, fallback = 30) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 365) throw clientError('Payment due days must be a whole number from 0 to 365');
  return n;
}

/** The text printed under "Payment" on the quotation, PO and PI. */
export function paymentTermsText(advancePercent, dueDays) {
  const adv = Number(advancePercent ?? 100);
  const days = Number(dueDays ?? 30);
  const fmt = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')}%`;
  if (adv >= 100) return `100% advance, payable within ${days} days of the purchase order`;
  if (adv <= 0) return `100% payable within ${days} days of the invoice`;
  return `${fmt(adv)} advance within ${days} days of the purchase order, balance ${fmt(round2(100 - adv))} within ${days} days of the invoice`;
}

// ---------- Contacts ----------

export async function listContacts(companyId) {
  return db
    .prepare(`SELECT id, company_id, name, phone, email, created_at FROM company_contact WHERE company_id = ? ORDER BY created_at, id`)
    .all(companyId);
}

/** Returns the company's matching contact (same name and phone), or adds it. Never changes an existing contact. */
export async function addContact(companyId, input, userId = null) {
  const name = cleanText(input?.name, 120);
  const phone = cleanText(input?.phone, 40);
  const email = cleanText(input?.email, 160);
  if (!name) throw clientError('Contact person name is required');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw clientError('Please enter a valid email address');
  const company = await db.prepare(`SELECT id FROM company WHERE id = ?`).get(companyId);
  if (!company) throw Object.assign(new Error('Company not found'), { status: 404 });

  const existing = await db
    .prepare(
      `SELECT id, company_id, name, phone, email, created_at FROM company_contact
       WHERE company_id = ? AND lower(btrim(name)) = lower(?) AND coalesce(btrim(phone), '') = ?`
    )
    .get(companyId, name, phone || '');
  if (existing) return { contact: existing, created: false };

  const info = await db
    .prepare(`INSERT INTO company_contact (company_id, name, phone, email, created_by_user_id) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .run(companyId, name, phone, email, userId);
  const contact = await db.prepare(`SELECT id, company_id, name, phone, email, created_at FROM company_contact WHERE id = ?`).get(info.lastInsertRowid);
  return { contact, created: true };
}

/**
 * Saves the contact person and payment terms sent with a quotation create or save.
 * - contact_id picks one of the company's saved contacts.
 * - new_contact {name, phone, email} adds a contact to the company, then picks it.
 * The name, phone and email are copied onto the quotation, so a later change of company never changes it.
 * Older callers that send none of these fields leave the quotation untouched.
 */
export async function applyQuotationContactAndTerms(quotationId, companyId, body, userId, { isNew = false } = {}) {
  if (!(await paymentsReady())) return;
  const sent = (k) => body[k] !== undefined;
  const sets = [];
  const values = [];

  if (sent('contact_id') || sent('new_contact')) {
    let contact = null;
    if (body.new_contact && typeof body.new_contact === 'object' && cleanText(body.new_contact.name)) {
      contact = (await addContact(companyId, body.new_contact, userId)).contact;
    } else if (body.contact_id) {
      contact = await db.prepare(`SELECT * FROM company_contact WHERE id = ? AND company_id = ?`).get(Number(body.contact_id), companyId);
      if (!contact) throw clientError('The selected contact person does not belong to this company');
    }
    sets.push('contact_id = ?', 'contact_person = ?', 'contact_phone = ?', 'contact_email = ?');
    values.push(contact?.id ?? null, contact?.name ?? null, contact?.phone ?? null, contact?.email ?? null);
  }

  let defaults = null;
  if (isNew && (!sent('advance_percent') || !sent('payment_due_days'))) {
    defaults = await db.prepare(`SELECT default_advance_percent, default_payment_due_days FROM company_settings WHERE id = 1`).get();
  }
  if (sent('advance_percent') || defaults) {
    sets.push('advance_percent = ?');
    values.push(normaliseAdvancePercent(body.advance_percent, Number(defaults?.default_advance_percent ?? 100)));
  }
  if (sent('payment_due_days') || defaults) {
    sets.push('payment_due_days = ?');
    values.push(normaliseDueDays(body.payment_due_days, Number(defaults?.default_payment_due_days ?? 30)));
  }

  if (sets.length) await db.prepare(`UPDATE quotation SET ${sets.join(', ')} WHERE id = ?`).run(...values, quotationId);
}

// ---------- Payment schedule ----------

const STATUS_LABEL = {
  paid: 'Paid',
  partly_paid: 'Partly paid',
  due: 'Due',
  overdue: 'Overdue',
  not_started: 'Not started',
};

function partStatus(part, today) {
  if (part.amount <= 0.005 || part.received >= part.amount - 0.5) return 'paid';
  if (!part.due_date) return part.received > 0 ? 'partly_paid' : 'not_started';
  if (today > part.due_date) return 'overdue';
  return part.received > 0 ? 'partly_paid' : 'due';
}

/**
 * q needs total, advance_percent, payment_due_days, and optionally po_date, pi_date and received.
 * Returns the advance and balance parts, totals and the overall status.
 */
export function computeSchedule(q, today = todayIST()) {
  const total = round2(q.total);
  const advancePercent = Number(q.advance_percent ?? 100);
  const dueDays = Number(q.payment_due_days ?? 30);
  const received = round2(q.received);
  const advanceAmount = round2((total * advancePercent) / 100);
  const balanceAmount = round2(total - advanceAmount);

  const parts = [];
  let left = received;
  const take = (amount) => {
    const used = Math.min(left, amount);
    left = round2(left - used);
    return round2(used);
  };
  if (advanceAmount > 0) {
    parts.push({
      key: 'advance',
      label: advancePercent >= 100 ? 'Full payment (100% advance)' : `Advance (${advancePercent}%)`,
      amount: advanceAmount,
      starts_on: q.po_date || null,
      starts_with: 'purchase order',
      due_date: q.po_date ? addDays(q.po_date, dueDays) : null,
      received: take(advanceAmount),
    });
  }
  if (balanceAmount > 0) {
    parts.push({
      key: 'balance',
      label: advanceAmount > 0 ? `Balance (${round2(100 - advancePercent)}%)` : 'Full payment',
      amount: balanceAmount,
      starts_on: q.pi_date || null,
      starts_with: 'performa invoice',
      due_date: q.pi_date ? addDays(q.pi_date, dueDays) : null,
      received: take(balanceAmount),
    });
  }
  for (const p of parts) {
    p.outstanding = round2(p.amount - p.received);
    p.status = partStatus(p, today);
    p.status_label = STATUS_LABEL[p.status];
    p.days_overdue = p.status === 'overdue' ? daysBetween(p.due_date, today) : 0;
  }

  const outstanding = round2(Math.max(0, total - received));
  const unpaid = parts.filter((p) => p.status !== 'paid');
  const nextDue = unpaid.filter((p) => p.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
  let status;
  if (total > 0 && outstanding <= 0.5) status = 'paid';
  else if (unpaid.some((p) => p.status === 'overdue')) status = 'overdue';
  else if (nextDue) status = received > 0 ? 'partly_paid' : 'due';
  else status = received > 0 ? 'partly_paid' : 'not_started';

  return {
    total,
    advance_percent: advancePercent,
    payment_due_days: dueDays,
    terms_text: paymentTermsText(advancePercent, dueDays),
    received,
    outstanding,
    parts,
    next_due_date: nextDue?.due_date || null,
    days_overdue: Math.max(0, ...parts.map((p) => p.days_overdue)),
    status,
    status_label: STATUS_LABEL[status],
  };
}

const SCHEDULE_SQL = `
  SELECT q.id, q.number, q.date, q.total, q.status AS quotation_status, q.advance_percent, q.payment_due_days,
         q.contact_person, q.contact_phone, q.contact_email, q.created_by_user_id,
         c.id AS company_id, c.name AS company_name,
         (SELECT MIN(po.date) FROM purchase_order po WHERE po.quotation_id = q.id) AS po_date,
         (SELECT MIN(pi.date) FROM performa_invoice pi WHERE pi.quotation_id = q.id) AS pi_date,
         (SELECT COALESCE(SUM(p.amount), 0) FROM quotation_payment p WHERE p.quotation_id = q.id) AS received
  FROM quotation q JOIN company c ON c.id = q.company_id`;

/** The schedule and the payments recorded for one quotation. */
export async function getQuotationPayments(quotationId) {
  const q = await db.prepare(`${SCHEDULE_SQL} WHERE q.id = ?`).get(quotationId);
  if (!q) return null;
  const payments = await db
    .prepare(
      `SELECT p.id, p.amount, p.paid_on, p.mode, p.reference, p.note, p.created_at, u.username AS created_by_username
       FROM quotation_payment p LEFT JOIN app_user u ON u.id = p.created_by_user_id
       WHERE p.quotation_id = ? ORDER BY p.paid_on, p.id`
    )
    .all(quotationId);
  return {
    schedule: computeSchedule(q),
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

/**
 * Every quotation with a purchase order that still has money to come, most overdue first.
 * Pass userId to limit the list to one sales person's quotations.
 */
export async function listOutstanding({ userId = null } = {}) {
  const where = [`EXISTS (SELECT 1 FROM purchase_order po WHERE po.quotation_id = q.id)`];
  const params = [];
  if (userId) {
    where.push('q.created_by_user_id = ?');
    params.push(userId);
  }
  const rows = await db.prepare(`${SCHEDULE_SQL} WHERE ${where.join(' AND ')}`).all(...params);
  const today = todayIST();
  const items = rows
    .map((q) => {
      const s = computeSchedule(q, today);
      return {
        quotation_id: q.id,
        quotation_number: q.number,
        company_id: q.company_id,
        company_name: q.company_name,
        contact_person: q.contact_person,
        contact_phone: q.contact_phone,
        po_date: q.po_date,
        pi_date: q.pi_date,
        total: s.total,
        advance_percent: s.advance_percent,
        received: s.received,
        outstanding: s.outstanding,
        // Only the parts already past their due date, e.g. the unpaid advance while the balance is still due.
        overdue_amount: round2(s.parts.filter((p) => p.status === 'overdue').reduce((t, p) => t + p.outstanding, 0)),
        next_due_date: s.next_due_date,
        days_overdue: s.days_overdue,
        status: s.status,
        status_label: s.status_label,
      };
    })
    .filter((it) => it.status !== 'paid' && it.outstanding > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue || String(a.next_due_date || '9999').localeCompare(String(b.next_due_date || '9999')));

  const sum = (list) => round2(list.reduce((t, it) => t + it.outstanding, 0));
  const overdue = items.filter((it) => it.status === 'overdue');
  return {
    today,
    items,
    totals: {
      count: items.length,
      outstanding: sum(items),
      overdue_count: overdue.length,
      overdue_amount: round2(overdue.reduce((t, it) => t + it.overdue_amount, 0)),
    },
  };
}

export async function recordPayment(quotationId, input, userId) {
  const amount = round2(input?.amount);
  if (!(amount > 0)) throw clientError('Payment amount must be more than zero');
  const paidOn = cleanText(input?.paid_on, 10) || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) throw clientError('Please enter a valid payment date');
  if (paidOn > todayIST()) throw clientError('The payment date cannot be in the future');
  const info = await db
    .prepare(
      `INSERT INTO quotation_payment (quotation_id, amount, paid_on, mode, reference, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .run(quotationId, amount, paidOn, cleanText(input?.mode, 40), cleanText(input?.reference, 120), cleanText(input?.note, 500), userId);
  return info.lastInsertRowid;
}
