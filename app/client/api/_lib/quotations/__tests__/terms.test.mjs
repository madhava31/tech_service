// Terms & Conditions of a quotation: the standard terms, editing them, and what the PDF prints.
// Run with:  npm --prefix app/client run test:po   (no database: queries are stubbed)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { defaultTerms, parseCustomTerms, storedTerms, MAX_TERMS } = await import('../terms.js');
const { default: express } = await import('express');
const { default: router, printableForPdf } = await import('../../routes/quotations.js');
const { default: db } = await import('../../db/index.js');

const SETTINGS = { quotation_validity_days: 15, delivery_time: '', payment_terms: 'Old global text' };

describe('defaultTerms', () => {
  test('No GST (rate 0) adds "GST: 18% extra" last; a GST quotation does not', () => {
    const noGst = defaultTerms({ advance_percent: 100, payment_due_days: 30, tax_percent: 0 }, SETTINGS);
    assert.deepEqual(noGst[noGst.length - 1], { label: 'GST', text: '18% extra' });
    assert.ok(!defaultTerms({ advance_percent: 100, tax_percent: 18 }, SETTINGS).some((t) => t.label === 'GST'));
    assert.ok(!defaultTerms({ advance_percent: 100 }, SETTINGS).some((t) => t.label === 'GST'), 'rate not given: no GST line');
    assert.ok(defaultTerms({ tax_percent: '0' }, SETTINGS).some((t) => t.label === 'GST'), 'rate 0 as text from a query string');
  });
  test('payment from the quotation, validity from Settings, no delivery line when Settings has none', () => {
    assert.deepEqual(defaultTerms({ advance_percent: 100, payment_due_days: 30 }, SETTINGS), [
      { label: 'Payment', text: '100% advance' },
      { label: 'Validity', text: '15 days from the quotation date' },
    ]);
  });
  test('a part advance spells out the balance; Settings delivery time adds a Delivery line', () => {
    const t = defaultTerms({ advance_percent: 30, payment_due_days: 15 }, { ...SETTINGS, delivery_time: '4-6 weeks', quotation_validity_days: 30 });
    assert.equal(t[0].text, '30% advance within 15 days of the purchase order, balance 70% within 15 days of the invoice');
    assert.deepEqual(t.map((x) => x.label), ['Payment', 'Delivery', 'Validity']);
    assert.equal(t[1].text, '4-6 weeks');
    assert.equal(t[2].text, '30 days from the quotation date');
  });
  test('without an advance on the quotation, the payment text of Settings is used', () => {
    assert.equal(defaultTerms({}, SETTINGS)[0].text, 'Old global text');
    assert.deepEqual(defaultTerms({}, {}).map((x) => x.label), ['Validity'], 'nothing set: just the validity, 15 days');
  });
});

describe('parseCustomTerms', () => {
  test('null means back to the standard terms; a list is cleaned', () => {
    assert.equal(parseCustomTerms(null), null);
    assert.deepEqual(parseCustomTerms([{ label: ' Payment ', text: ' 50% advance ' }, { label: '', text: '' }, { label: 'Freight', text: '' }]), [
      { label: 'Payment', text: '50% advance' },
      { label: 'Freight', text: '' },
    ]);
    assert.deepEqual(parseCustomTerms([]), [], 'removing every term is allowed');
    assert.equal(parseCustomTerms([{ label: 'A\u0000B', text: 'x' }])[0].label, 'AB', 'control characters are removed');
  });
  test('bad input is refused with a 400', () => {
    const bad = (v, re) => assert.throws(() => parseCustomTerms(v), (e) => e.status === 400 && re.test(e.message));
    bad('text', /must be a list/);
    bad({}, /must be a list/);
    bad([1], /heading and a text/);
    bad([{ label: 'x'.repeat(61), text: '' }], /at most 60/);
    bad([{ label: 'A', text: 'x'.repeat(501) }], /at most 500/);
    bad(Array.from({ length: MAX_TERMS + 1 }, (_, i) => ({ label: `L${i}`, text: 't' })), /at most 15/);
  });
});

describe('storedTerms', () => {
  test('a saved list, a JSON text, or nothing', () => {
    assert.deepEqual(storedTerms([{ label: 'A', text: 'b' }]), [{ label: 'A', text: 'b' }]);
    assert.deepEqual(storedTerms('[{"label":"A","text":"b"}]'), [{ label: 'A', text: 'b' }]);
    assert.equal(storedTerms(null), null);
    assert.equal(storedTerms(undefined), null);
    assert.equal(storedTerms('not json'), null);
    assert.deepEqual(storedTerms([]), [], 'an empty list is a real choice: no terms');
  });
});

describe('what the PDF prints', () => {
  const q = (terms) => ({ id: 1, number: 'Q-1', advance_percent: 100, payment_due_days: 30, subtotal: 100, tax_percent: 18, terms });
  test('without edits: the standard terms', async () => {
    const p = await printableForPdf(q(null), [], SETTINGS);
    assert.deepEqual(p.quotation.terms.map((t) => t.label), ['Payment', 'Validity']);
  });
  test('with edits: exactly what the user wrote, not the standard terms', async () => {
    const p = await printableForPdf(q([{ label: 'Payment', text: '50% advance, balance on delivery' }, { label: 'Warranty', text: '1 year' }]), [], SETTINGS);
    assert.deepEqual(p.quotation.terms, [{ label: 'Payment', text: '50% advance, balance on delivery' }, { label: 'Warranty', text: '1 year' }]);
  });
  test('all terms removed: none are printed', async () => {
    assert.deepEqual((await printableForPdf(q([]), [], SETTINGS)).quotation.terms, []);
  });
});

describe('GET /api/quotations/terms-defaults', () => {
  beforeEach(() => {
    db.prepare = (sql) => ({
      get: async () => (/FROM company_settings/.test(sql) ? { ...SETTINGS, delivery_time: '3 weeks' } : undefined),
      all: async () => [],
    });
  });
  async function get(query) {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
    app.use('/api/quotations', router);
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/quotations/terms-defaults${query}`);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  test('the standard terms for the advance and due days given (and it is not read as a quotation id)', async () => {
    const r = await get('?advance_percent=45&payment_due_days=20');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.terms.map((t) => t.label), ['Payment', 'Delivery', 'Validity']);
    assert.match(r.body.terms[0].text, /^45% advance within 20 days of the purchase order, balance 55% within 20 days of the invoice$/);
  });
  test('without parameters it uses the Settings text', async () => {
    const r = await get('');
    assert.equal(r.body.terms[0].text, 'Old global text');
  });
});
