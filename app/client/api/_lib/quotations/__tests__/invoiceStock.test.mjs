// Tests for the stock that leaves with an invoice. Run with:  npm --prefix app/client run test:po
// An in-memory fake database stands in for Postgres (the SQL is matched by its shape), so the real invoice and stock
// code runs end to end: 10 in stock, an invoice for 5 leaves 5; an invoice for more than is there is refused; removing
// an invoice puts the stock back.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
const { planDeduction, stockShortage, createInvoice, deleteInvoice, listInvoices, invoiceStock, INVOICE_STOCK_REF, INVOICE_VOID_REF } = await import('../invoices.js');
const { default: db } = await import('../../db/index.js');

describe('planDeduction and stockShortage', () => {
  test('lines linked to a product leave stock, others do not', () => {
    const plan = planDeduction([{ quotation_item_id: 1, qty: 5 }, { quotation_item_id: 2, qty: 1 }], new Map([[1, 100]]));
    assert.deepEqual(plan.deduct, [{ quotation_item_id: 1, product_id: 100, qty: 5 }]);
    assert.deepEqual(plan.untracked, [2]);
  });
  test('shortage: several lines of one product add up', () => {
    const deduct = [{ quotation_item_id: 1, product_id: 100, qty: 3 }, { quotation_item_id: 2, product_id: 100, qty: 3 }];
    assert.deepEqual(stockShortage(deduct, new Map([[100, 5]])), { product_id: 100, need: 6, have: 5 });
    assert.equal(stockShortage(deduct, new Map([[100, 6]])), null);
    assert.deepEqual(stockShortage(deduct, new Map()), { product_id: 100, need: 6, have: 0 }, 'no stock row = nothing in stock');
  });
});

// ---------- fake database ----------
let S;
const fresh = () => ({
  stock: new Map([['1:100', { on_hand: 10, reserved: 0 }]]),
  movements: [],
  invoices: [],
  invoiceItems: [],
  // quotation 1: line 11 = product 100 (quoted 10), line 12 = a service line without a product
  lines: [{ id: 11, qty: 10, product_id: 100 }, { id: 12, qty: 2, product_id: null }],
  products: new Map([[100, { id: 100, part_no: 'B0104236', description: 'Vials' }]]),
  warehouses: [{ id: 1, name: 'Hyderabad Central', is_default: 1, is_active: 1 }, { id: 2, name: 'Pune', is_default: 0, is_active: 1 }],
  nextId: 1,
});
const key = (w, p) => `${w}:${p}`;

function fakePrepare(sql) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const run = (params, mode) => {
    if (/FROM information_schema\.columns/.test(q)) return [];
    if (/^SELECT \* FROM quotation WHERE id = \?/.test(q)) return [{ id: 1, status: 'accepted', payment_due_days: 30 }];
    if (/^SELECT id, qty FROM quotation_item WHERE quotation_id/.test(q)) return S.lines.map((l) => ({ id: l.id, qty: l.qty }));
    if (/^SELECT ii\.quotation_item_id, ii\.qty FROM quotation_invoice_item/.test(q)) return S.invoiceItems.map((i) => ({ quotation_item_id: i.item, qty: i.qty }));
    if (/^SELECT qi\.id, qi\.product_id FROM quotation_item qi JOIN product p/.test(q)) return S.lines.filter((l) => l.product_id).map((l) => ({ id: l.id, product_id: l.product_id }));
    if (/^SELECT id, name FROM warehouse WHERE id = \? AND is_active = 1/.test(q)) return S.warehouses.filter((w) => w.id === params[0] && w.is_active).map((w) => ({ id: w.id, name: w.name }));
    if (/^SELECT id, name FROM warehouse WHERE is_active = 1 ORDER BY is_default/.test(q)) return S.warehouses.filter((w) => w.is_active).sort((a, b) => b.is_default - a.is_default).slice(0, 1).map((w) => ({ id: w.id, name: w.name }));
    if (/FROM inventory_stock WHERE warehouse_id = \? AND product_id = ANY/.test(q)) {
      const ids = String(params[1]).replace(/[{}]/g, '').split(',').map(Number);
      return ids.filter((p) => S.stock.has(key(params[0], p))).map((p) => ({ product_id: p, available: S.stock.get(key(params[0], p)).on_hand - S.stock.get(key(params[0], p)).reserved }));
    }
    if (/^SELECT part_no, description FROM quotation_item WHERE id/.test(q)) { const l = S.lines.find((x) => x.id === params[0]); return l ? [{ part_no: S.products.get(l.product_id)?.part_no || null, description: 'line' }] : []; }
    if (/^SELECT part_no, description FROM product WHERE id/.test(q)) return [S.products.get(params[0])].filter(Boolean);
    if (/^SELECT id, part_no, description FROM product WHERE id/.test(q)) return [S.products.get(params[0])].filter(Boolean);
    if (/^SELECT \* FROM warehouse WHERE id = \?/.test(q)) return S.warehouses.filter((w) => w.id === params[0]);
    if (/^INSERT INTO inventory_stock/.test(q)) { if (!S.stock.has(key(params[0], params[1]))) S.stock.set(key(params[0], params[1]), { on_hand: 0, reserved: 0 }); return []; }
    if (/^SELECT \* FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(q)) { const s = S.stock.get(key(params[0], params[1])); return [{ on_hand_quantity: s.on_hand, reserved_quantity: s.reserved }]; }
    if (/^UPDATE inventory_stock SET on_hand_quantity/.test(q)) { const s = S.stock.get(key(params[2], params[3])); s.on_hand = params[0]; s.reserved = params[1]; return [{ on_hand_quantity: s.on_hand }]; }
    if (/^INSERT INTO inventory_movement/.test(q)) {
      const m = { id: S.nextId++, warehouse_id: params[0], product_id: params[1], movement_type: params[2], quantity: params[3], before_on_hand: params[4], after_on_hand: params[5], reference_type: params[8], reference_id: params[9], reason: params[10] };
      S.movements.push(m);
      return [m];
    }
    if (/^INSERT INTO quotation_invoice \(/.test(q)) { const id = S.nextId++; S.invoices.push({ id, quotation_id: params[0], invoice_number: params[1], invoice_date: params[2], payment_due_date: params[3] }); return [{ id }]; }
    if (/^INSERT INTO quotation_invoice_item/.test(q)) { S.invoiceItems.push({ invoice: params[0], item: params[1], qty: params[2] }); return []; }
    if (/^SELECT id, invoice_number FROM quotation_invoice WHERE id = \? AND quotation_id/.test(q)) return S.invoices.filter((i) => i.id === params[0]).map((i) => ({ id: i.id, invoice_number: i.invoice_number }));
    if (/FROM inventory_movement WHERE reference_type = \? AND reference_id = \? AND movement_type = 'STOCK_OUT'/.test(q)) return S.movements.filter((m) => m.reference_type === params[0] && String(m.reference_id) === params[1] && m.movement_type === 'STOCK_OUT');
    if (/^DELETE FROM quotation_invoice WHERE id/.test(q)) { S.invoices = S.invoices.filter((i) => i.id !== params[0]); S.invoiceItems = S.invoiceItems.filter((i) => i.invoice !== params[0]); return []; }
    throw new Error(`fake db: unhandled SQL: ${q.slice(0, 120)}`);
  };
  return {
    get: async (...p) => run(p)[0],
    all: async (...p) => run(p),
    run: async (...p) => { const rows = run(p); return { changes: rows.length || 1, lastInsertRowid: rows[0]?.id }; },
  };
}

let real;
beforeEach(() => {
  S = fresh();
  real = real || { prepare: db.prepare, transaction: db.transaction };
  db.prepare = fakePrepare;
  // all or nothing: undo everything if the work throws
  db.transaction = async (fn) => {
    const snap = { stock: new Map([...S.stock].map(([k, v]) => [k, { ...v }])), movements: [...S.movements], invoices: [...S.invoices], invoiceItems: [...S.invoiceItems] };
    try { return await fn(); } catch (e) { Object.assign(S, snap); throw e; }
  };
});

const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const post = async (body) => { const r = res(); await createInvoice({ params: { id: '1' }, body, user: null }, r); return r; };
const base = { invoice_number: 'INV-1', invoice_date: '2026-11-20' };
const onHand = () => S.stock.get('1:100').on_hand;

describe('invoice and stock', () => {
  test('company X has 10; an invoice for 5 leaves 5, as one Stock Out tied to the invoice', async () => {
    const r = await post({ ...base, items: [{ quotation_item_id: 11, qty: 5 }] });
    assert.equal(r.code, 201);
    assert.equal(onHand(), 5);
    assert.equal(S.movements.length, 1);
    const m = S.movements[0];
    assert.deepEqual([m.movement_type, m.quantity, m.before_on_hand, m.after_on_hand, m.reference_type, String(m.reference_id), m.reason], ['STOCK_OUT', 5, 10, 5, INVOICE_STOCK_REF, String(r.body.id), 'Invoice INV-1']);
    assert.deepEqual(r.body.stock, { warehouse: 'Hyderabad Central', deducted: 1, untracked: 0 });
  });

  test('a second invoice for the other 5 takes the rest; a third is over the quoted quantity', async () => {
    assert.equal((await post({ ...base, items: [{ quotation_item_id: 11, qty: 5 }] })).code, 201);
    assert.equal((await post({ ...base, invoice_number: 'INV-2', items: [{ quotation_item_id: 11, qty: 5 }] })).code, 201);
    assert.equal(onHand(), 0);
    const over = await post({ ...base, invoice_number: 'INV-3', items: [{ quotation_item_id: 11, qty: 1 }] });
    assert.equal(over.code, 400);
    assert.match(over.body.error, /only 0 left to invoice/);
  });

  test('more than the warehouse holds: refused with a clear message, nothing saved, stock untouched', async () => {
    S.stock.set('1:100', { on_hand: 3, reserved: 0 });
    const r = await post({ ...base, items: [{ quotation_item_id: 11, qty: 5 }] });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /B0104236: only 3 in stock at Hyderabad Central \(the invoice needs 5\)/);
    assert.equal(S.invoices.length, 0, 'no invoice saved');
    assert.equal(S.movements.length, 0);
    assert.equal(onHand(), 3);
  });

  test('stock reserved for other orders is not available', async () => {
    S.stock.set('1:100', { on_hand: 10, reserved: 8 });
    const r = await post({ ...base, items: [{ quotation_item_id: 11, qty: 5 }] });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /only 2 in stock/);
  });

  test('a line without a stock product is saved but not deducted', async () => {
    const r = await post({ ...base, items: [{ quotation_item_id: 12, qty: 2 }] });
    assert.equal(r.code, 201);
    assert.deepEqual(r.body.stock, { warehouse: null, deducted: 0, untracked: 1 });
    assert.equal(S.movements.length, 0);
    assert.equal(onHand(), 10);
  });

  test('the warehouse can be chosen; an unknown or inactive one is refused', async () => {
    S.stock.set('2:100', { on_hand: 4, reserved: 0 });
    const ok = await post({ ...base, warehouse_id: 2, items: [{ quotation_item_id: 11, qty: 4 }] });
    assert.equal(ok.code, 201);
    assert.equal(S.stock.get('2:100').on_hand, 0);
    assert.equal(onHand(), 10, 'the other warehouse is untouched');
    const bad = await post({ ...base, invoice_number: 'INV-9', warehouse_id: 99, items: [{ quotation_item_id: 11, qty: 1 }] });
    assert.equal(bad.code, 400);
    assert.match(bad.body.error, /Choose the warehouse/);
  });

  test('removing the invoice puts the 5 back as a correcting Adjustment; the Stock Out stays in the history', async () => {
    const r = await post({ ...base, items: [{ quotation_item_id: 11, qty: 5 }] });
    const del = res();
    await deleteInvoice({ params: { id: '1', invoiceId: String(r.body.id) }, user: null }, del);
    assert.equal(del.code, 200);
    assert.equal(onHand(), 10);
    assert.equal(S.invoices.length, 0);
    assert.deepEqual(S.movements.map((m) => [m.movement_type, m.quantity, m.reference_type]), [['STOCK_OUT', 5, INVOICE_STOCK_REF], ['ADJUSTMENT', 5, INVOICE_VOID_REF]]);
    assert.equal(S.movements[1].reason, 'Invoice INV-1 removed');
  });

  test('removing an invoice that had no stock lines changes no stock', async () => {
    const r = await post({ ...base, items: [{ quotation_item_id: 12, qty: 1 }] });
    const del = res();
    await deleteInvoice({ params: { id: '1', invoiceId: String(r.body.id) }, user: null }, del);
    assert.equal(del.code, 200);
    assert.equal(S.movements.length, 0);
  });

  test('if the stock out fails halfway, the whole invoice is undone', async () => {
    // Two lines on product 100: the check passes (10 available), then the stock changes under us before the second stock out.
    S.lines.push({ id: 13, qty: 10, product_id: 100 });
    const inner = fakePrepare;
    let outs = 0;
    db.prepare = (sql) => {
      const st = inner(sql);
      if (/^SELECT \* FROM inventory_stock WHERE warehouse_id = \? AND product_id = \? FOR UPDATE/.test(sql.replace(/\s+/g, ' ').trim())) {
        return { ...st, get: async (...p) => { outs++; if (outs === 2) S.stock.get('1:100').on_hand = 1; return st.get(...p); } };
      }
      return st;
    };
    const r = await post({ ...base, items: [{ quotation_item_id: 11, qty: 4 }, { quotation_item_id: 13, qty: 4 }] });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /Insufficient/);
    assert.equal(S.invoices.length, 0, 'the invoice was rolled back');
    assert.equal(S.invoiceItems.length, 0);
    assert.equal(S.movements.length, 0, 'and so was the first stock out');
  });
});

describe('stock hints for the dialog', () => {
  test('per line: on hand and available in the chosen warehouse; the service line is not tracked', async () => {
    const orig = db.prepare;
    db.prepare = (sql) => {
      if (/FROM quotation_item qi LEFT JOIN product p/.test(sql.replace(/\s+/g, ' '))) {
        return { all: async (wh) => S.lines.map((l) => { const s = S.stock.get(key(wh, l.product_id)); return { quotation_item_id: l.id, tracked: !!l.product_id, on_hand: s?.on_hand ?? 0, available: s ? s.on_hand - s.reserved : 0 }; }) };
      }
      return orig(sql);
    };
    const r = res();
    await invoiceStock({ params: { id: '1' }, query: {} }, r);
    assert.deepEqual(r.body.warehouse, { id: 1, name: 'Hyderabad Central' });
    assert.deepEqual(r.body.items, [
      { quotation_item_id: 11, tracked: true, on_hand: 10, available: 10 },
      { quotation_item_id: 12, tracked: false, on_hand: 0, available: 0 },
    ]);
  });
});
