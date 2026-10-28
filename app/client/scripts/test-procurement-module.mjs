// Technicon Services ERP - Procurement module tests against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-procurement-module.mjs
//
// Builds schema.sql + inventory tables + migration 001 in a throwaway schema inside ONE transaction,
// seeds supplier and customer purchase orders, exercises the procurement services and routes, then
// rolls everything back. Nothing persists.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('- Procurement module test: NOT RUN (set TEST_DATABASE_URL to a non-production database)');
  process.exit(0);
}
process.env.DATABASE_URL = url;
const req = createRequire(path.join(APP, 'package.json'));
const pg = req('pg');
const express = req('express');
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);

const schemaSql = fs.readFileSync(path.join(APP, 'api/_lib/db/schema.sql'), 'utf8');
const invSrc = fs.readFileSync(path.join(APP, 'api/_lib/db/inventorySchema.js'), 'utf8');
const inventoryDdl = invSrc.slice(invSrc.indexOf('const INVENTORY_DDL = `') + 'const INVENTORY_DDL = `'.length, invSrc.indexOf('`;', invSrc.indexOf('const INVENTORY_DDL')));
const migration = fs.readFileSync(path.join(APP, 'api/_lib/db/migrations/001_erp_missing_tables.sql'), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();
const { default: db } = await imp('api/_lib/db/index.js');
const realQuery = db.pool.query.bind(db.pool);
const realConnect = db.pool.connect.bind(db.pool);
let connects = 0;
let sp = 0;
let queue = Promise.resolve();
const run = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};
const wrapped = {
  query: (sql, params) => run(() => {
    const s = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
    if (s === 'BEGIN') return client.query(`SAVEPOINT tx${++sp}`);
    if (s === 'COMMIT') return client.query(`RELEASE SAVEPOINT tx${sp--}`);
    if (s === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT tx${sp--}`);
    return client.query(sql, params);
  }),
  release: () => {},
};
db.pool.query = wrapped.query;
db.pool.connect = async () => { connects++; return wrapped; };

const svc = await imp('api/_lib/procurement/service.js');
const { default: router } = await imp('api/_lib/routes/procurement.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}

const S = 'procurement_module_test';
const today = new Date().toISOString().slice(0, 10);
let server;
try {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${S}`);
  await client.query(`SET LOCAL search_path TO ${S}`);
  await client.query(schemaSql);
  await client.query(inventoryDdl);
  await client.query(migration);

  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  const user = await one(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES ('buyer','h','s','admin') RETURNING id, username, role`);
  const customer = await one(`INSERT INTO company (name) VALUES ('Customer Co') RETURNING id`);
  const supplier = await one(`INSERT INTO company (name, is_supplier, company_type) VALUES ('Parts Supplier', 1, 'supplier') RETURNING id`);
  const prod = await one(`INSERT INTO product (part_no, description, default_price) VALUES ('P-9','Seal Kit', 50) RETURNING id`);
  const other = await one(`INSERT INTO product (part_no, description) VALUES ('P-8','Gasket') RETURNING id`);
  const wh = await one(`INSERT INTO warehouse (name, code) VALUES ('Main','W1') RETURNING id`);
  const quote = await one(`INSERT INTO quotation (number, date, company_id, status, subtotal, tax_amount, total) VALUES ('Q-1',$1,$2,'accepted',100,0,100) RETURNING id`, [today, customer.id]);
  // customer purchase order (goods going OUT): must never appear in procurement
  await one(`INSERT INTO purchase_order (number, date, quotation_id) VALUES ('CPO-1',$1,$2) RETURNING id`, [today, quote.id]);
  const req = await one(`INSERT INTO procurement_requirement (requirement_code, product_id, warehouse_id, required_quantity, suggested_quantity, source_type, status, supplier_id)
                         VALUES ('REQ-1',$1,$2,10,10,'MANUAL','ORDERED',$3) RETURNING id`, [prod.id, wh.id, supplier.id]);
  const spo = await one(`INSERT INTO purchase_order (number, date, quotation_id, status, supplier_id, procurement_requirement_id, received_quantity)
                         VALUES ('SPO-1',$1,$2,'ORDERED',$3,$4,0) RETURNING id`, [today, quote.id, supplier.id, req.id]);
  await client.query(`UPDATE procurement_requirement SET purchase_order_id = $1 WHERE id = $2`, [spo.id, req.id]);
  console.log('seeded throwaway schema\n');

  await test('overview counts only supplier purchase orders', async () => {
    const { kpis } = await svc.getProcurementOverview();
    assert.deepStrictEqual([kpis.openPurchaseOrders, kpis.pendingRequirements, kpis.totalSuppliers, kpis.incomingUnits, kpis.incomingPurchaseValue], [1, 0, 1, 10, 500]);
  });
  await test('incoming/receiving list the supplier PO, never the customer PO', async () => {
    const inc = await svc.getIncomingProcurement({});
    assert.deepStrictEqual(inc.orders.map((o) => o.po_number), ['SPO-1']);
    const o = inc.orders[0];
    assert.deepStrictEqual([o.supplier_name, o.part_no, o.ordered_quantity, o.receivedQuantity, o.pendingQuantity, o.po_value], ['Parts Supplier', 'P-9', 10, 0, 10, 500]);
    assert.deepStrictEqual((await svc.getReceivingQueue({})).queue.map((x) => x.po_number), ['SPO-1']);
  });
  await test('requirements: create (code from id, created_by app_user), list, detail', async () => {
    const created = await svc.createProcurementRequirement({ productId: other.id, warehouseId: wh.id, requiredQuantity: 5, priority: 'high' }, user);
    const r = created.requirement;
    assert.match(r.requirement_code, /^REQ-\d{8}-\d{5}$/);
    assert.deepStrictEqual([r.priority, r.status, r.created_by, r.suggested_quantity, r.reorderPoint], ['HIGH', 'OPEN', user.id, 5, 10]);
    const list = await svc.getProcurementRequirements({ q: 'gasket' });
    assert.deepStrictEqual([list.total, list.requirements[0].part_no], [1, 'P-8']);
    assert.strictEqual((await svc.getProcurementRequirements({ status: 'ordered' })).total, 1);
    assert.strictEqual(await svc.getProcurementRequirementById(999999), null);
  });
  await test('requirements: validation errors are 4xx', async () => {
    await assert.rejects(svc.createProcurementRequirement({ productId: prod.id, warehouseId: wh.id, requiredQuantity: 0 }, user), (e) => e.status === 400);
    await assert.rejects(svc.createProcurementRequirement({ productId: prod.id, warehouseId: wh.id, requiredQuantity: 1, priority: 'URGENT' }, user), (e) => e.status === 400);
    await assert.rejects(svc.createProcurementRequirement({ productId: 999999, warehouseId: wh.id, requiredQuantity: 1 }, user), (e) => e.status === 404);
  });
  await test('suppliers: list, detail, create (and mark existing company)', async () => {
    const list = await svc.getSuppliers({});
    assert.deepStrictEqual(list.suppliers.map((s) => [s.name, s.totalPos, s.pendingOrders, s.totalProcurementValue]), [['Parts Supplier', 1, 1, 500]]);
    const d = await svc.getSupplierById(supplier.id);
    assert.deepStrictEqual([d.summary.totalPurchaseOrders, d.summary.openOrders], [1, 1]);
    assert.strictEqual(await svc.getSupplierById(customer.id), null, 'a customer is not a supplier');
    const made = await svc.createSupplier({ name: 'New Vendor', phone: '9' });
    assert.strictEqual(made.supplier.company_type, 'supplier');
    const flagged = await svc.createSupplier({ name: 'customer co' });
    assert.strictEqual(flagged.supplier.id, customer.id);
    await assert.rejects(svc.createSupplier({ name: '  ' }), (e) => e.status === 400);
  });
  await test('receive-stock: refuses customer POs, wrong product, over-receipt', async () => {
    const cpo = await one(`SELECT id FROM purchase_order WHERE number = 'CPO-1'`);
    await assert.rejects(svc.receivePoStock({ poId: cpo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 1 }] }, user), (e) => e.status === 400 && /customer purchase order/.test(e.message));
    await assert.rejects(svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: other.id, receiveQty: 1 }] }, user), (e) => e.status === 400);
    await assert.rejects(svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 11 }] }, user), (e) => e.status === 400 && /remaining/.test(e.message));
  });
  await test('receive-stock is all-or-nothing (nested stock-in joins the transaction)', async () => {
    const before = connects;
    await assert.rejects(
      svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 6 }, { productId: prod.id, receiveQty: 6 }] }, user),
      (e) => e.status === 400
    );
    const stock = await one(`SELECT COALESCE(SUM(on_hand_quantity),0)::float AS q FROM inventory_stock WHERE product_id = $1`, [prod.id]);
    const receipts = await one(`SELECT COUNT(*)::int AS n FROM stock_receipt`);
    assert.deepStrictEqual([stock.q, receipts.n], [0, 0]);
    assert.ok(connects - before <= 1, 'one connection per receive, not one per nested transaction');
  });
  await test('db.transaction joins an open transaction: a nested recordStockIn is rolled back with it', async () => {
    const { recordStockIn } = await imp('api/_lib/inventory/service.js');
    const before = connects;
    await assert.rejects(
      db.transaction(async () => {
        await recordStockIn({ warehouseId: wh.id, productId: prod.id, quantity: 7, userId: user.id });
        const mid = await db.prepare(`SELECT on_hand_quantity FROM inventory_stock WHERE product_id = ? AND warehouse_id = ?`).get(prod.id, wh.id);
        assert.strictEqual(Number(mid.on_hand_quantity), 7, 'stock-in visible inside the transaction');
        throw new Error('fail after stock-in');
      }),
      /fail after stock-in/
    );
    const after = await one(`SELECT COALESCE(SUM(on_hand_quantity),0)::float AS q FROM inventory_stock WHERE product_id = $1`, [prod.id]);
    const moves = await one(`SELECT COUNT(*)::int AS n FROM inventory_movement WHERE product_id = $1`, [prod.id]);
    assert.deepStrictEqual([after.q, moves.n], [0, 0]);
    assert.strictEqual(connects - before, 1, 'nested transaction must not check out a second connection');
  });
  await test('receive-stock: partial then full receipt updates stock, PO and requirement', async () => {
    const r1 = await svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 4 }], reference: 'DN-77' }, user);
    assert.deepStrictEqual([r1.poStatus, r1.totalReceivedInBatch, r1.po.received_quantity], ['PARTIALLY_RECEIVED', 4, 4]);
    assert.strictEqual(r1.stockReceipt.source_reference, 'SPO-1');
    assert.match(r1.stockReceipt.notes, /DN-77/);
    const r2 = await svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 6 }] }, user);
    assert.strictEqual(r2.poStatus, 'FULFILLED');
    const stock = await one(`SELECT on_hand_quantity::float AS q FROM inventory_stock WHERE product_id = $1 AND warehouse_id = $2`, [prod.id, wh.id]);
    const reqRow = await one(`SELECT status FROM procurement_requirement WHERE id = $1`, [req.id]);
    assert.deepStrictEqual([stock.q, reqRow.status], [10, 'FULFILLED']);
    await assert.rejects(svc.receivePoStock({ poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 1 }] }, user), (e) => e.status === 400);
  });
  await test('reports and activity', async () => {
    const r = await svc.getProcurementReportsData();
    assert.deepStrictEqual(r.bySupplier.map((s) => [s.supplier_name, s.total_pos, s.total_spend]), [['Parts Supplier', 1, 500]]);
    assert.deepStrictEqual(r.byProduct.map((p) => [p.part_no, p.total_ordered_qty]), [['P-9', 10]]);
    assert.deepStrictEqual(r.summary, { totalProcurementSpend: 500, totalPurchaseOrders: 1, activeSuppliers: 1 });
    const a = await svc.getProcurementActivity({});
    assert.strictEqual(a.total, 4); // 2 requirements + 2 PO receipts
    assert.strictEqual((await svc.getProcurementActivity({ docType: 'stock_receipt' })).total, 2);
  });

  const app = express();
  app.use(express.json());
  app.use((rq, rs, nx) => { rq.user = user; nx(); });
  app.use('/api/procurement', router);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/procurement`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  await test('routes: GETs return 200 with the frontend shape; not found is 404', async () => {
    const shapes = {
      '/overview': ['kpis'], '/requirements': ['requirements', 'total'], [`/requirements/${req.id}`]: ['requirement'],
      '/suppliers': ['suppliers', 'total'], [`/suppliers/${supplier.id}`]: ['supplier', 'purchaseOrders', 'summary'],
      '/incoming': ['orders', 'total'], '/receiving': ['queue', 'total'], '/reports': ['bySupplier', 'byProduct'], '/activity': ['activity', 'total'],
    };
    for (const [p, keys] of Object.entries(shapes)) {
      const r = await call('GET', p);
      assert.strictEqual(r.status, 200, `${p} -> ${r.status} ${JSON.stringify(r.body)}`);
      for (const k of keys) assert.ok(k in r.body, `${p} missing ${k}`);
    }
    for (const p of ['/requirements/999999', '/suppliers/999999']) assert.strictEqual((await call('GET', p)).status, 404, p);
  });
  await test('routes: writes and validation', async () => {
    const r = await call('POST', '/requirements', { productId: prod.id, warehouseId: wh.id, requiredQuantity: 3 });
    assert.strictEqual(r.status, 201);
    const bad = await call('POST', '/requirements', { productId: prod.id, warehouseId: wh.id, requiredQuantity: -1 });
    assert.deepStrictEqual([bad.status, bad.body.error], [400, 'Required quantity must be greater than zero']);
    const s = await call('POST', '/suppliers', { name: 'Route Vendor' });
    assert.strictEqual(s.status, 201);
    const rec = await call('POST', '/receive-stock', { poId: spo.id, warehouseId: wh.id, items: [{ productId: prod.id, receiveQty: 1 }] });
    assert.strictEqual(rec.status, 400);
    assert.ok(!/relation|column|SELECT/i.test(rec.body.error));
  });
} catch (e) {
  failed++;
  console.error('ERROR', e);
} finally {
  if (server) server.close();
  await client.query('ROLLBACK').catch(() => {});
  const still = (await client.query(`SELECT to_regnamespace($1) IS NOT NULL AS present`, [S])).rows[0].present;
  console.log(`\nrolled back; throwaway schema still present: ${still}`);
  if (still) failed++;
  db.pool.query = realQuery;
  db.pool.connect = realConnect;
  await client.end();
  await db.pool.end().catch(() => {});
  console.log(failed ? `${failed} FAILED, ${passed} passed` : `ALL ${passed}/${passed} PROCUREMENT MODULE TESTS PASSED`);
  process.exit(failed ? 1 : 0);
}
