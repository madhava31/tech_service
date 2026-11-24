// Sent POs (migration 016): figures, checking a PO, the routes and the PDF. Run with:  npm --prefix app/client run test:sentpo
// No database: queries are stubbed.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { lineFigures, poFigures, defaultTax } = await import('../calc.js');
const { parseSentPoRequest, SENT_PO_COLUMNS } = await import('../service.js');
const { streamSentPoPdf, sentPoLayout, taxRows } = await import('../../pdf/sentPoPdf.js');
const { default: express } = await import('express');
const { default: router } = await import('../../routes/sentPos.js');
const { default: db } = await import('../../db/index.js');

describe('figures', () => {
  test('the Vyapar example: 1 × 85,200 with IGST 18% is 1,00,536', () => {
    const f = lineFigures({ qty: 1, price: 85200, tax_type: 'IGST', tax_percent: 18 });
    assert.equal(f.tax_amount, 15336);
    assert.equal(f.amount, 100536);
  });
  test('discount by % or by amount (the amount wins), never more than the line', () => {
    assert.equal(lineFigures({ qty: 2, price: 100, discount_percent: 10 }).discount_amount, 20);
    const a = lineFigures({ qty: 2, price: 100, discount_percent: 10, discount_amount: 50 });
    assert.equal(a.discount_amount, 50);
    assert.equal(a.discount_percent, 25);
    assert.equal(lineFigures({ qty: 1, price: 100, discount_amount: 500 }).taxable_amount, 0);
  });
  test('prices that include tax are brought back to before tax', () => {
    const f = lineFigures({ qty: 1, price: 118, tax_type: 'GST', tax_percent: 18 }, true);
    assert.equal(f.taxable_amount, 100);
    assert.equal(f.tax_amount, 18);
    assert.equal(f.amount, 118);
  });
  test('no tax and exempt lines carry no tax whatever rate is sent', () => {
    assert.equal(lineFigures({ qty: 1, price: 100, tax_type: 'EXEMPT', tax_percent: 18 }).tax_amount, 0);
    assert.equal(lineFigures({ qty: 1, price: 100, tax_type: 'NONE', tax_percent: 18 }).tax_amount, 0);
  });
  test('totals, round off, advance and balance', () => {
    const f = poFigures({ items: [{ qty: 1, price: 99.6, tax_type: 'IGST', tax_percent: 18 }, { qty: 3, price: 10 }], round_off_enabled: true, advance_amount: 50 });
    assert.equal(f.total_qty, 4);
    assert.equal(f.sub_total, 129.6);
    assert.equal(f.total, 148);
    assert.equal(f.round_off, Math.round((148 - 147.53) * 100) / 100);
    assert.equal(f.balance, 98);
  });
  test('GST in our own state, IGST elsewhere', () => {
    assert.deepEqual(defaultTax('Telangana', 'Telangana'), { tax_type: 'GST', tax_percent: 18 });
    assert.deepEqual(defaultTax('Maharashtra', 'Telangana'), { tax_type: 'IGST', tax_percent: 18 });
    assert.deepEqual(defaultTax('', 'Telangana'), { tax_type: 'IGST', tax_percent: 18 });
  });
});

describe('parseSentPoRequest', () => {
  const ok = (over = {}) => parseSentPoRequest({ supplier_name: 'Mettler Toledo India', prefix: 'TSMTPO', seq: 43, order_date: '2026-11-16', items: [{ part_no: '30880510', qty: 1, price: 85200, tax_type: 'IGST', tax_percent: 18 }], ...over }, '2026-11-24');
  test('number is prefix + sequence; empty rows are dropped; figures are worked out', () => {
    const p = ok({ items: [{ part_no: '30880510', qty: 1, price: 85200, tax_type: 'IGST', tax_percent: 18 }, { part_no: '', description: '  ' }] });
    assert.equal(p.number, 'TSMTPO43');
    assert.equal(p.items.length, 1);
    assert.equal(p.figures.total, 100536);
  });
  test('what is refused', () => {
    assert.throws(() => ok({ supplier_name: '', company_id: null }), /party/);
    assert.throws(() => ok({ prefix: '', seq: null }), /order number/);
    assert.throws(() => ok({ seq: 1.5 }), /whole number/);
    assert.throws(() => ok({ items: [] }), /at least one item/);
    assert.throws(() => ok({ items: [{ part_no: 'X', qty: 0 }] }), /quantity/);
    assert.throws(() => ok({ due_date: '2026-11-01' }), /due date/);
    assert.throws(() => ok({ advance_amount: 999999 }), /advance/);
    assert.throws(() => ok({ items: [{ part_no: 'X', qty: 1, discount_percent: 150 }] }), /discount %/);
  });
  test('defaults: order date today, unknown tax type is none', () => {
    const p = parseSentPoRequest({ supplier_name: 'A', prefix: 'P', seq: 1, items: [{ part_no: 'X', qty: 1, price: 10, tax_type: 'VAT', tax_percent: 5 }] }, '2026-11-24');
    assert.equal(p.order_date, '2026-11-24');
    assert.equal(p.items[0].tax_type, 'NONE');
    assert.equal(p.items[0].tax_percent, 0);
  });
});

describe('PDF', () => {
  const render = async (items, extra = {}) => {
    const f = poFigures({ items, advance_amount: extra.advance_amount || 0 });
    const lines = items.map((it, i) => ({ ...it, ...f.lines[i], price: it.price }));
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    streamSentPoPdf(out, { po: { number: 'TSMTPO43', order_date: '2026-11-16', supplier_name: 'Supplier', ...f, ...extra }, items: lines, settings: {} });
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('PDF did not finish')), 8000))]);
    return Buffer.concat(chunks);
  };
  test('columns always fill the page width; Discount and Tax only when used', () => {
    for (const [d, t] of [[true, true], [true, false], [false, true], [false, false]]) {
      const l = sentPoLayout(d, t);
      assert.ok(Math.abs(l.cols.reduce((a, c) => a + c.w, 0) - (595.28 - 60)) < 1e-6);
      assert.equal(l.cols.some((c) => c.key === 'disc'), d);
      assert.equal(l.cols.some((c) => c.key === 'tax'), t);
    }
  });
  test('tax rows: GST splits into CGST + SGST, IGST stays one, one row per rate', () => {
    assert.deepEqual(taxRows([{ tax_type: 'GST', tax_percent: 18, tax_amount: 36 }, { tax_type: 'IGST', tax_percent: 12, tax_amount: 12 }, { tax_type: 'NONE', tax_amount: 0 }]), [
      ['CGST @ 9%', 18], ['SGST @ 9%', 18], ['IGST @ 12%', 12],
    ]);
  });
  test('renders with IGST, GST, a mix, none, an advance, and with many rows over two pages', async () => {
    const line = (tax_type, tax_percent) => ({ part_no: 'P1', description: 'Analytical balance', hsn_sac: '8423', qty: 2, unit: 'Nos', price: 1000, discount_percent: 5, tax_type, tax_percent });
    for (const items of [[line('IGST', 18)], [line('GST', 18)], [line('GST', 18), line('IGST', 12)], [line('NONE', 0)], Array.from({ length: 40 }, () => line('IGST', 18))]) {
      const pdf = await render(items, { advance_amount: 100, terms_title: 'Purchase Order', terms_text: 'Mention the PO number on the invoice.', payment_type: 'Bank' });
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    }
  });
});

describe('routes', () => {
  let state;
  let tablesExist;
  const admin = { id: 1, role: 'admin' };
  const staff = { id: 2, role: 'staff' };
  beforeEach(() => {
    tablesExist = true;
    state = { pos: [], items: [], companies: [{ id: 10, name: 'Mettler Toledo India Pvt Ltd', is_supplier: 0 }], nextId: 1 };
    db.transaction = async (fn) => fn();
    db.prepare = (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      const run = (p) => {
        if (/information_schema/.test(q)) {
          if (!tablesExist) return [];
          return Object.entries(SENT_PO_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ table_name: t, column_name: c })));
        }
        if ((q.replace(/'[^']*'/g, '').match(/\?/g) || []).length !== p.length) throw new Error('parameter count mismatch in: ' + q.slice(0, 80));
        if (/^SELECT id, name FROM company WHERE id = \?/.test(q)) return state.companies.filter((c) => c.id === p[0]);
        if (/^UPDATE company SET is_supplier = 1/.test(q)) { const c = state.companies.find((x) => x.id === p[0]); if (c) c.is_supplier = 1; return []; }
        if (/^SELECT id, name FROM company WHERE lower/.test(q)) return state.companies.filter((c) => c.name.toLowerCase() === String(p[0]).trim().toLowerCase());
        if (/^INSERT INTO company/.test(q)) { const c = { id: 100 + state.companies.length, name: p[0], is_supplier: 1 }; state.companies.push(c); return [{ id: c.id }]; }
        if (/^INSERT INTO sent_po \(/.test(q)) {
          const number = p[2];
          if (state.pos.some((x) => x.number.toLowerCase() === String(number).toLowerCase())) throw Object.assign(new Error('dup'), { code: '23505' });
          const po = { id: state.nextId++, prefix: p[0], seq: p[1], number, company_id: p[3], supplier_name: p[4], total: p[15], items: [] };
          state.pos.push(po);
          return [{ id: po.id }];
        }
        if (/^SELECT id FROM sent_po WHERE id = \? FOR UPDATE/.test(q)) return state.pos.filter((x) => x.id === p[0]);
        if (/^UPDATE sent_po SET/.test(q)) {
          const id = p[p.length - 1];
          const po = state.pos.find((x) => x.id === id);
          if (state.pos.some((x) => x.id !== id && x.number.toLowerCase() === String(p[2]).toLowerCase())) throw Object.assign(new Error('dup'), { code: '23505' });
          Object.assign(po, { prefix: p[0], seq: p[1], number: p[2], supplier_name: p[4], total: p[15] });
          return [];
        }
        if (/^DELETE FROM sent_po_item/.test(q)) { state.items = state.items.filter((i) => i.sent_po_id !== p[0]); return []; }
        if (/^SELECT id FROM product WHERE UPPER/.test(q)) return [];
        if (/^INSERT INTO sent_po_item/.test(q)) { state.items.push({ sent_po_id: p[0], line_no: p[1], part_no: p[3], qty: p[6], amount: p[15] }); return []; }
        if (/^DELETE FROM sent_po WHERE id = \?/.test(q)) { const before = state.pos.length; state.pos = state.pos.filter((x) => x.id !== p[0]); return { changes: before - state.pos.length }; }
        if (/FROM sent_po s LEFT JOIN company c/.test(q)) return state.pos.filter((x) => x.id === p[0]);
        if (/^SELECT \* FROM sent_po_item/.test(q)) return state.items.filter((i) => i.sent_po_id === p[0]);
        if (/^SELECT prefix, terms_title, terms_text FROM sent_po/.test(q)) return state.pos.slice(-1);
        if (/^SELECT COALESCE\(MAX\(seq\), 0\)::int AS n FROM sent_po/.test(q)) {
          const seqs = state.pos.filter((x) => x.prefix.toLowerCase() === String(p[0]).toLowerCase()).map((x) => x.seq || 0);
          return [{ n: seqs.length ? Math.max(...seqs) : 0 }];
        }
        if (/FROM sent_po s/.test(q)) return state.pos;
        throw new Error('fake db: unhandled SQL: ' + q.slice(0, 100));
      };
      return {
        get: async (...p) => { const r = run(p); return Array.isArray(r) ? r[0] : r; },
        all: async (...p) => { const r = run(p); return Array.isArray(r) ? r : []; },
        run: async (...p) => { const r = run(p); return Array.isArray(r) ? { changes: 1, lastInsertRowid: r[0]?.id } : r; },
      };
    };
  });

  async function call(method, path, user, body) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/sent-pos', router);
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sent-pos${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
  const po = (over = {}) => ({ prefix: 'TSMTPO', seq: 43, order_date: '2026-11-16', items: [{ part_no: '30880510', qty: 1, price: 85200, tax_type: 'IGST', tax_percent: 18 }], ...over });

  test('create with an existing company marks it as a supplier; the total is worked out by the server', async () => {
    const r = await call('POST', '/', staff, po({ company_id: 10 }));
    assert.equal(r.status, 201);
    assert.equal(state.pos[0].number, 'TSMTPO43');
    assert.equal(state.pos[0].total, 100536);
    assert.equal(state.companies[0].is_supplier, 1);
    assert.equal(state.items.length, 1);
  });
  test('a typed new party is saved as a supplier company', async () => {
    const r = await call('POST', '/', staff, po({ supplier_name: 'PerkinElmer India' }));
    assert.equal(r.status, 201);
    assert.ok(state.companies.some((c) => c.name === 'PerkinElmer India' && c.is_supplier === 1));
  });
  test('the same number twice is refused with 409', async () => {
    await call('POST', '/', staff, po({ company_id: 10 }));
    const r = await call('POST', '/', staff, po({ company_id: 10 }));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already used/);
  });
  test('next number follows the highest of the prefix', async () => {
    await call('POST', '/', staff, po({ company_id: 10, seq: 43 }));
    const r = await call('GET', '/next-number?prefix=TSMTPO', staff);
    assert.equal(r.body.seq, 44);
    assert.equal(r.body.prefix, 'TSMTPO');
  });
  test('edit replaces the lines; delete is admin only', async () => {
    await call('POST', '/', staff, po({ company_id: 10 }));
    const e = await call('PUT', '/1', staff, po({ company_id: 10, seq: 50, items: [{ part_no: 'A', qty: 2, price: 10 }, { part_no: 'B', qty: 1, price: 5 }] }));
    assert.equal(e.status, 200);
    assert.equal(state.pos[0].number, 'TSMTPO50');
    assert.equal(state.items.length, 2);
    assert.equal((await call('DELETE', '/1', staff)).status, 403);
    assert.equal((await call('DELETE', '/1', admin)).status, 200);
    assert.equal(state.pos.length, 0);
    assert.equal((await call('DELETE', '/1', admin)).status, 404);
  });
  test('a bad PO answers 400 with the reason', async () => {
    const r = await call('POST', '/', staff, po({ company_id: 10, items: [] }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /at least one item/);
  });
});
