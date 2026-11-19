// Tests for invoices and the payment due date. Run with:  npm --prefix app/client run test:po
// No database: a dummy DATABASE_URL is set only because the modules import the database module; nothing connects.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { parseInvoiceRequest, overInvoiced, InvoiceRequestError } = await import('../invoices.js');
const { computeSchedule } = await import('../../payments/service.js');

const IDS = new Set([11, 12]);
const TODAY = '2026-11-19';
const ok = (body, opts = {}) => parseInvoiceRequest({ invoice_number: 'INV-1', items: [{ quotation_item_id: 11, qty: 1 }], ...body }, IDS, { today: TODAY, ...opts });
const bad = (body, re) => assert.throws(() => parseInvoiceRequest(body, IDS, { today: TODAY }), (e) => e instanceof InvoiceRequestError && re.test(e.message));

describe('parseInvoiceRequest', () => {
  test('defaults: dated today, payment due after the quotation due days', () => {
    const r = ok({}, { dueDays: 30 });
    assert.equal(r.invoice_date, TODAY);
    assert.equal(r.payment_due_date, '2026-12-19');
  });

  test('PO today, invoice tomorrow: the payment due date counts from the invoice date', () => {
    const r = ok({ invoice_date: '2026-11-20' }, { dueDays: 30 });
    assert.equal(r.payment_due_date, '2026-12-20');
  });

  test('a typed payment due date wins, and may not be before the invoice date', () => {
    assert.equal(ok({ invoice_date: '2026-11-20', payment_due_date: '2026-12-05' }).payment_due_date, '2026-12-05');
    assert.equal(ok({ invoice_date: '2026-11-20', payment_due_date: '2026-11-20' }).payment_due_date, '2026-11-20', 'same day is fine');
    bad({ invoice_number: 'I', invoice_date: '2026-11-20', payment_due_date: '2026-11-19', items: [{ quotation_item_id: 11, qty: 1 }] }, /before the invoice date/);
  });

  test('number, dates and items are checked', () => {
    bad({ items: [{ quotation_item_id: 11, qty: 1 }] }, /invoice number/);
    bad({ invoice_number: '   ', items: [{ quotation_item_id: 11, qty: 1 }] }, /invoice number/);
    bad({ invoice_number: 'x'.repeat(61), items: [{ quotation_item_id: 11, qty: 1 }] }, /at most 60/);
    bad({ invoice_number: 'I', invoice_date: '2026-02-30', items: [{ quotation_item_id: 11, qty: 1 }] }, /valid invoice date/);
    bad({ invoice_number: 'I', payment_due_date: '20-12-2026', items: [{ quotation_item_id: 11, qty: 1 }] }, /valid payment due date/);
    bad({ invoice_number: 'I', items: [] }, /at least one item/);
    bad({ invoice_number: 'I', items: [{ quotation_item_id: 99, qty: 1 }] }, /does not belong/);
    bad({ invoice_number: 'I', items: [{ quotation_item_id: 11, qty: 1 }, { quotation_item_id: 11, qty: 2 }] }, /twice/);
    bad({ invoice_number: 'I', items: [{ quotation_item_id: 11, qty: 0 }] }, /above 0/);
    assert.equal(ok({ invoice_number: '  INV/26-27/014 ' }).invoice_number, 'INV/26-27/014');
  });
});

describe('overInvoiced', () => {
  const quoted = new Map([[11, 10], [12, 5]]);
  test('limited by the PO quantities, minus earlier invoices', () => {
    const ordered = new Map([[11, 6]]);
    assert.equal(overInvoiced([{ quotation_item_id: 11, qty: 6 }], { ordered, quoted, invoiced: new Map() }), null);
    const over = overInvoiced([{ quotation_item_id: 11, qty: 3 }], { ordered, quoted, invoiced: new Map([[11, 4]]) });
    assert.deepEqual(over, { quotation_item_id: 11, limit: 6, already: 4, left: 2 });
    assert.ok(overInvoiced([{ quotation_item_id: 12, qty: 1 }], { ordered, quoted, invoiced: new Map() }), 'an item not on any PO cannot be invoiced');
  });
  test('without PO items the quoted quantity is the limit', () => {
    assert.equal(overInvoiced([{ quotation_item_id: 12, qty: 5 }], { ordered: new Map(), quoted, invoiced: new Map() }), null);
    assert.ok(overInvoiced([{ quotation_item_id: 12, qty: 6 }], { ordered: new Map(), quoted, invoiced: new Map() }));
  });
});

describe('payment schedule with an invoice', () => {
  const base = { total: 1000, advance_percent: 100, payment_due_days: 30, received: 0 };

  test('without an invoice nothing changes: full payment due 30 days after the PO', () => {
    const s = computeSchedule({ ...base, po_date: '2026-11-19' }, '2026-11-19');
    assert.equal(s.parts[0].due_date, '2026-12-19');
    assert.equal(s.parts[0].starts_with, 'purchase order');
  });

  test('the PO received date counts as the PO date, the earliest one wins', () => {
    assert.equal(computeSchedule({ ...base, po_received_date: '2026-11-10' }, '2026-11-19').parts[0].due_date, '2026-12-10');
    assert.equal(computeSchedule({ ...base, po_date: '2026-11-15', po_received_date: '2026-11-10' }, '2026-11-19').parts[0].due_date, '2026-12-10');
  });

  test('with an invoice, the payment is due on its payment due date', () => {
    const s = computeSchedule({ ...base, po_date: '2026-11-19', invoice_date: '2026-11-20', invoice_due_date: '2026-12-20' }, '2026-11-21');
    assert.equal(s.parts.length, 1);
    assert.equal(s.parts[0].due_date, '2026-12-20');
    assert.equal(s.parts[0].starts_with, 'invoice');
    assert.equal(s.status, 'due');
    assert.equal(computeSchedule({ ...base, po_date: '2026-11-19', invoice_date: '2026-11-20', invoice_due_date: '2026-12-20' }, '2026-12-21').status, 'overdue');
  });

  test('with an advance, only the balance moves to the invoice due date', () => {
    const s = computeSchedule({ ...base, advance_percent: 30, po_date: '2026-11-19', pi_date: '2026-11-19', invoice_date: '2026-11-25', invoice_due_date: '2026-12-10' }, '2026-11-25');
    assert.equal(s.parts[0].key, 'advance');
    assert.equal(s.parts[0].due_date, '2026-12-19');
    assert.equal(s.parts[1].key, 'balance');
    assert.equal(s.parts[1].due_date, '2026-12-10');
  });
});
