// Technicon Services ERP - Sales module tests against a NON-production Postgres database.
// Run via: TEST_DATABASE_URL=postgres://... node app/client/scripts/test-sales-module.mjs
//
// Builds schema.sql + inventory tables + migration 001 in a throwaway schema inside ONE transaction,
// seeds a small realistic data set, exercises every sales service function and every /api/sales
// route (through an Express app), then rolls everything back. Nothing persists.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('- Sales module test: NOT RUN (set TEST_DATABASE_URL to a non-production database)');
  process.exit(0);
}
process.env.DATABASE_URL = url; // the db module requires it; every query below is routed into the test transaction
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
// Route every pool query and every db.transaction() through the single test transaction.
const realQuery = db.pool.query.bind(db.pool);
const realConnect = db.pool.connect.bind(db.pool);
let sp = 0;
// One client serves everything here (production uses separate pooled clients for parallel queries),
// so queries are queued to keep the single client strictly sequential.
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
db.pool.connect = async () => wrapped;

const orders = await imp('api/_lib/sales/orders.js');
const pipeline = await imp('api/_lib/sales/pipeline.js');
const { default: salesRouter } = await imp('api/_lib/routes/sales.js');

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

const S = 'sales_module_test';
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
let server;
try {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${S}`);
  await client.query(`SET LOCAL search_path TO ${S}`);
  await client.query(schemaSql);
  await client.query(inventoryDdl);
  await client.query(migration);

  // ---------------- seed
  const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
  const user = await one(`INSERT INTO app_user (username, password_hash, password_salt, role) VALUES ('tester','h','s','admin') RETURNING id, username, role`);
  const acme = await one(`INSERT INTO company (name, phone, email) VALUES ('Acme Labs', '111', 'a@x.in') RETURNING id`);
  const beta = await one(`INSERT INTO company (name) VALUES ('Beta Pharma') RETURNING id`);
  const p1 = await one(`INSERT INTO product (part_no, description) VALUES ('P-100','Valve') RETURNING id`);
  const p2 = await one(`INSERT INTO product (part_no, description) VALUES ('P-200','Pump') RETURNING id`);
  const wh = await one(`INSERT INTO warehouse (name, code) VALUES ('Main','W1') RETURNING id`);
  await client.query(`INSERT INTO inventory_stock (warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES ($1,$2,10,2), ($1,$3,0,0)`, [wh.id, p1.id, p2.id]);
  const eng = await one(`INSERT INTO sales_engineer (employee_code, name) VALUES ('E1','Ravi') RETURNING id`);
  const firm = await one(`INSERT INTO firm (firm_code, firm_name) VALUES ('F1','Firm One') RETURNING id`);
  const branch = await one(`INSERT INTO branch (firm_id, branch_code, branch_name) VALUES ($1,'B1','Hyderabad') RETURNING id`, [firm.id]);
  const quote = async (number, status, date, total, companyId) =>
    one(`INSERT INTO quotation (number, date, company_id, status, subtotal, tax_amount, total, sales_engineer_id, firm_id, branch_id)
         VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,$8) RETURNING id`, [number, date, companyId, status, total, eng.id, firm.id, branch.id]);
  const qDraft = await quote('Q-1', 'draft', today, 1000, acme.id);
  const qStale = await quote('Q-2', 'sent', daysAgo(45), 2000, acme.id);
  const qBig = await quote('Q-3', 'accepted', daysAgo(5), 600000, beta.id);
  await client.query(`INSERT INTO quotation_item (quotation_id, product_id, part_no, description, qty, price, amount) VALUES
    ($1,$4,'P-100','Valve',5,200,1000), ($2,$5,'P-200','Pump',1,2000,2000), ($3,$4,'P-100','Valve',10,60000,600000)`,
    [qDraft.id, qStale.id, qBig.id, p1.id, p2.id]);
  const po = await one(`INSERT INTO purchase_order (number, date, quotation_id) VALUES ('PO-1',$1,$2) RETURNING id`, [daysAgo(4), qBig.id]);
  const pi = await one(`INSERT INTO performa_invoice (number, date, quotation_id, purchase_order_id) VALUES ('PI-1',$1,$2,$3) RETURNING id`, [daysAgo(3), qBig.id, po.id]);
  const sr = await one(`INSERT INTO sale_report (report_number, company_id, company_name_snapshot, sale_date, warehouse_id, source_type,
                        source_quotation_id, source_po_id, source_pi_id, status, total_amount, created_by)
                        VALUES ('SR-1',$1,'Beta Pharma',$2,$3,'INTERNAL_DOCUMENT',$4,$5,$6,'CONFIRMED',240000,$7) RETURNING id`,
    [beta.id, daysAgo(1), wh.id, qBig.id, po.id, pi.id, user.id]);
  await client.query(`INSERT INTO sale_report_item (sale_report_id, product_id, part_number_snapshot, description_snapshot, quantity, total_price)
                      VALUES ($1,$2,'P-100','Valve',4,240000)`, [sr.id, p1.id]);
  const fuOverdue = await one(`INSERT INTO quotation_follow_up (quotation_id, follow_up_date, status, priority, created_by) VALUES ($1,$2,'scheduled','HIGH',$3) RETURNING id`, [qStale.id, daysAgo(60), user.id]);
  await one(`INSERT INTO quotation_follow_up (quotation_id, follow_up_date, status, priority, created_by) VALUES ($1,$2,'scheduled','NORMAL',$3) RETURNING id`, [qDraft.id, today, user.id]);
  console.log('seeded throwaway schema\n');

  // ---------------- services
  await test('pipeline: derived stages', async () => {
    const p = await pipeline.getSalesPipeline({}, user);
    const stage = (id) => p.items.find((i) => i.quotation_id === id).derived_stage;
    assert.strictEqual(stage(qDraft.id), 'QUOTATION_DRAFT');
    assert.strictEqual(stage(qStale.id), 'AWAITING_CUSTOMER');
    assert.strictEqual(stage(qBig.id), 'PARTIALLY_DISPATCHED');
    assert.strictEqual(p.total, 3);
  });
  await test('pipeline: quantities, documents, stock, flags', async () => {
    const p = await pipeline.getSalesPipeline({}, user);
    const big = p.items.find((i) => i.quotation_id === qBig.id);
    assert.deepStrictEqual([big.total_ordered, big.total_dispatched, big.remaining_quantity], [10, 4, 6]);
    assert.strictEqual(big.purchase_orders.length, 1);
    assert.strictEqual(big.performa_invoices.length, 1);
    assert.strictEqual(big.sale_reports.length, 1);
    assert.strictEqual(big.is_high_value, true);
    assert.strictEqual(big.stock_status, 'PARTIALLY_AVAILABLE'); // needs 10, 8 available
    const stale = p.items.find((i) => i.quotation_id === qStale.id);
    assert.strictEqual(stale.is_stale, true);
    assert.strictEqual(stale.stock_status, 'OUT_OF_STOCK');
    assert.strictEqual(stale.is_follow_up_overdue, true);
    assert.strictEqual(stale.age_group, '31-60 days');
    const draft = p.items.find((i) => i.quotation_id === qDraft.id);
    assert.strictEqual(draft.is_follow_up_due_today, true);
    assert.strictEqual(draft.branch_name, 'Hyderabad');
    assert.strictEqual(draft.firm_name, 'Firm One');
  });
  await test('pipeline: filters (stage, company, search, paging)', async () => {
    assert.strictEqual((await pipeline.getSalesPipeline({ stage: 'QUOTATION_DRAFT' })).total, 1);
    assert.strictEqual((await pipeline.getSalesPipeline({ companyId: String(beta.id) })).total, 1);
    assert.strictEqual((await pipeline.getSalesPipeline({ q: 'acme' })).total, 2); // case-insensitive
    const page = await pipeline.getSalesPipeline({ limit: '1', offset: '1' });
    assert.strictEqual(page.records.length, 1);
    assert.strictEqual(page.total, 3);
  });
  await test('pipeline summary counts', async () => {
    const s = await pipeline.getSalesPipelineSummary({}, user);
    assert.strictEqual(s.open_quotations_count, 3);
    assert.strictEqual(s.overdue_followups_count, 1);
    assert.strictEqual(s.due_today_followups_count, 1);
    assert.strictEqual(s.stale_quotations_count, 1);
    assert.strictEqual(s.high_value_count, 1);
    assert.strictEqual(s.stock_risk_count, 2);
    assert.strictEqual(s.stage_counts.PARTIALLY_DISPATCHED, 1);
  });
  await test('management attention alerts', async () => {
    const m = await pipeline.getManagementAttention({}, user);
    const types = m.alerts.map((a) => a.type).sort();
    assert.deepStrictEqual(types, ['DUE_TODAY_FOLLOWUP', 'HIGH_VALUE_OPPORTUNITY', 'MULTIPLE_OPEN_QUOTES', 'OVERDUE_FOLLOWUP', 'PARTIAL_DISPATCH_PENDING', 'STALE_QUOTATION', 'STOCK_SHORTAGE_RISK']);
    assert.ok(m.alerts.every((a) => ['HIGH', 'MEDIUM'].includes(a.severity) && a.id && a.message));
    assert.strictEqual(m.total, m.alerts.length);
  });
  await test('high-value and stale lists use thresholds', async () => {
    const hv = await pipeline.getHighValueOpportunities({}, user);
    assert.deepStrictEqual(hv.opportunities.map((o) => o.quotation_number), ['Q-3']);
    assert.strictEqual(hv.high_value_threshold, 500000);
    const st = await pipeline.getStaleQuotations({}, user);
    assert.deepStrictEqual(st.stale_quotations.map((o) => o.quotation_number), ['Q-2']);
    assert.strictEqual(st.stale_threshold_days, 30);
  });
  await test('follow-ups: all / due today / overdue', async () => {
    const all = await pipeline.getFollowUps({});
    assert.strictEqual(all.total, 2);
    const due = await pipeline.getFollowUpsDueToday({});
    assert.deepStrictEqual(due.map((f) => f.quotation_number), ['Q-1']);
    const overdue = await pipeline.getFollowUpsOverdue({});
    assert.strictEqual(overdue.length, 1);
    assert.strictEqual(overdue[0].days_overdue, 60);
    assert.strictEqual(overdue[0].created_by_name, 'tester');
    assert.strictEqual(overdue[0].engineer_name, 'Ravi');
  });
  let newFollowUpId;
  await test('create follow-up: inherits quotation context, created_by = app_user', async () => {
    const f = await pipeline.createFollowUp({ quotationId: qBig.id, followUpDate: today, priority: 'URGENT', notes: 'call' }, user);
    newFollowUpId = f.id;
    assert.strictEqual(f.created_by, user.id);
    assert.deepStrictEqual([f.company_id, f.sales_engineer_id, f.firm_id, f.branch_id], [beta.id, eng.id, firm.id, branch.id]);
    assert.strictEqual(f.status, 'scheduled');
  });
  await test('create follow-up: validation errors are 4xx', async () => {
    await assert.rejects(pipeline.createFollowUp({ quotationId: qBig.id }, user), (e) => e.status === 400);
    await assert.rejects(pipeline.createFollowUp({ quotationId: qBig.id, followUpDate: today, status: 'bogus' }, user), (e) => e.status === 400);
    await assert.rejects(pipeline.createFollowUp({ quotationId: 999999, followUpDate: today }, user), (e) => e.status === 404);
    await assert.rejects(pipeline.createFollowUp({ followUpDate: today }, user), (e) => e.status === 400);
  });
  await test('reschedule: closes the old follow-up and creates a new one', async () => {
    const n = await pipeline.rescheduleFollowUp(fuOverdue.id, { followUpDate: daysAgo(-3), notes: 'customer travelling' }, user);
    const old = await one(`SELECT status, outcome, completed_by FROM quotation_follow_up WHERE id = $1`, [fuOverdue.id]);
    assert.deepStrictEqual([old.status, old.outcome, old.completed_by], ['completed', 'Rescheduled', user.id]);
    assert.strictEqual(n.follow_up_date, daysAgo(-3));
    assert.match(n.notes, /^Rescheduled: customer travelling/);
    await assert.rejects(pipeline.rescheduleFollowUp(999999, { followUpDate: today }, user), (e) => e.status === 404);
  });
  await test('complete / update follow-up', async () => {
    const c = await pipeline.completeFollowUp(newFollowUpId, { outcome: 'Order expected', notes: 'ok' }, user);
    assert.deepStrictEqual([c.status, c.outcome, c.completed_by], ['completed', 'Order expected', user.id]);
    const u = await pipeline.updateFollowUp(newFollowUpId, { notes: 'edited', priority: 'LOW' }, user);
    assert.deepStrictEqual([u.notes, u.priority], ['edited', 'LOW']);
    await assert.rejects(pipeline.completeFollowUp(999999, {}, user), (e) => e.status === 404);
  });
  await test('engineer follow-up performance', async () => {
    const e = await pipeline.getEngineerFollowUpPerformance(eng.id, {}, user);
    assert.strictEqual(e.engineer.name, 'Ravi');
    assert.strictEqual(e.completed_this_month_count, 2);
    assert.ok(e.open_quotations_count >= 3 && Array.isArray(e.follow_ups));
    await assert.rejects(pipeline.getEngineerFollowUpPerformance(999999, {}, user), (err) => err.status === 404);
  });
  await test('customer 360', async () => {
    const c = await pipeline.getCustomer360Pipeline(beta.id, user);
    assert.strictEqual(c.sales_summary.confirmed_sales_value, 240000);
    assert.strictEqual(c.sales_summary.open_orders_count, 1);
    assert.strictEqual(c.activity.last_confirmed_sale_date, daysAgo(1));
    assert.strictEqual(c.customer.assigned_engineer, 'Unassigned');
    assert.strictEqual(await pipeline.getCustomer360Pipeline(999999, user), null);
  });
  await test('quotation timeline', async () => {
    const t = await pipeline.getQuotationTimeline(qBig.id);
    assert.deepStrictEqual(t.map((e) => e.stage), ['QUOTATION', 'QUOTATION', 'FOLLOW_UP', 'PURCHASE_ORDER', 'PERFORMA_INVOICE', 'SALE_REPORT']);
    assert.strictEqual(await pipeline.getQuotationTimeline(999999), null);
  });
  await test('orders list: PO-based, dispatched quantities, status', async () => {
    const o = await orders.getSalesOrders({});
    assert.strictEqual(o.total, 1);
    const row = o.orders[0];
    assert.deepStrictEqual([row.po_number, row.pi_number, row.totalOrdered, row.totalDispatched, row.derivedStatus], ['PO-1', 'PI-1', 10, 4, 'PARTIALLY_DISPATCHED']);
    assert.strictEqual(row.saleReports.length, 1);
    assert.strictEqual((await orders.getSalesOrders({ status: 'COMPLETED' })).total, 0);
    assert.strictEqual((await orders.getSalesOrders({ q: 'beta' })).total, 1);
  });
  await test('order detail by PO id and by quotation id', async () => {
    const d = await orders.getSalesOrderById(po.id);
    assert.strictEqual(d.order.po_number, 'PO-1');
    // 10 ordered, 4 dispatched -> 6 remaining; 8 available covers the remaining quantity
    assert.deepStrictEqual([d.items[0].dispatchedQty, d.items[0].remainingQty, d.items[0].available, d.items[0].stockStatus], [4, 6, 8, 'IN_STOCK']);
    assert.strictEqual(d.relatedDocuments.saleReports.length, 1);
    assert.ok(d.timeline.some((e) => e.stage === 'STOCK_OUT'));
    // An id is tried as a PO id first (legacy contract), so use a quotation id that no PO has.
    assert.ok(qStale.id !== po.id);
    const pending = await orders.getSalesOrderById(qStale.id);
    assert.strictEqual(pending.order.po_number, 'PENDING');
    assert.strictEqual(pending.order.quotation_id, qStale.id);
    assert.strictEqual(await orders.getSalesOrderById(999999), null);
  });
  await test('pending sales work queues', async () => {
    const w = await orders.getPendingSalesWork();
    assert.deepStrictEqual(w.quotationsAwaitingResponse.map((x) => x.number), ['Q-2']);
    assert.strictEqual(w.quotationsAwaitingResponse[0].age_days, 45);
    assert.deepStrictEqual([w.acceptedQuotationsWithoutPo.length, w.posWithoutPi.length, w.pisWithoutSaleReport.length, w.saleReportsAwaitingConfirmation.length], [0, 0, 0, 0]);
  });
  await test('document activity: events, filters, paging', async () => {
    const a = await orders.getDocumentActivity({});
    assert.strictEqual(a.total, 6); // 3 quotations, 1 PO, 1 PI, 1 sale report
    assert.strictEqual((await orders.getDocumentActivity({ docType: 'sale_report' })).total, 1);
    const page = await orders.getDocumentActivity({ limit: 2, offset: 0 });
    assert.deepStrictEqual([page.activity.length, page.total, page.limit], [2, 6, 2]);
    assert.strictEqual((await orders.getDocumentActivity({ q: 'PO-1' })).total, 1);
  });
  await test('company history and sales reports', async () => {
    const h = await orders.getCompanySalesHistory(beta.id);
    assert.deepStrictEqual([h.metrics.totalPurchaseOrders, h.metrics.confirmedSalesValue, h.metrics.lastSaleDate], [1, 240000, daysAgo(1)]);
    assert.strictEqual(await orders.getCompanySalesHistory(999999), null);
    const r = await orders.getSalesReportsData();
    assert.deepStrictEqual(r.byCompany.map((c) => [c.company_name, c.total_orders, c.total_sales]), [['Beta Pharma', 1, 240000]]);
    assert.deepStrictEqual(r.byProduct.map((p) => [p.part_no, p.total_qty_sold]), [['P-100', 4]]);
    assert.strictEqual(r.byWarehouse[0].total_sales, 240000);
  });

  // ---------------- HTTP routes (Express, signed-in test user)
  const app = express();
  app.use(express.json());
  app.use((rq, rs, nx) => { rq.user = user; nx(); });
  app.use('/api/sales', salesRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/sales`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  await test('routes: every GET returns 200 with the frontend shape', async () => {
    const shapes = {
      '/pipeline': ['records', 'summary', 'total'],
      '/pipeline/summary': ['open_quotations_count', 'stage_counts'],
      '/management-attention': ['alerts', 'total'],
      '/high-value-opportunities': ['opportunities', 'high_value_threshold', 'total'],
      '/stale-quotations': ['stale_quotations', 'stale_threshold_days', 'total'],
      '/follow-ups': ['followUps', 'total'],
      '/orders': ['orders', 'total', 'limit', 'offset'],
      [`/orders/${po.id}`]: ['order', 'relatedDocuments', 'items', 'timeline'],
      '/pending': ['quotationsAwaitingResponse', 'saleReportsAwaitingConfirmation'],
      '/activity': ['activity', 'total', 'limit', 'offset'],
      [`/companies/${beta.id}/history`]: ['company', 'metrics'],
      '/reports': ['byCompany', 'byProduct', 'byWarehouse'],
      [`/customers/${beta.id}/360`]: ['customer', 'sales_summary', 'activity', 'current_opportunities'],
      [`/quotations/${qBig.id}/timeline`]: ['timeline', 'count'],
      [`/engineers/${eng.id}/follow-up-performance`]: ['engineer', 'follow_ups'],
    };
    for (const [p, keys] of Object.entries(shapes)) {
      const r = await call('GET', p);
      assert.strictEqual(r.status, 200, `${p} -> ${r.status} ${JSON.stringify(r.body)}`);
      for (const k of keys) assert.ok(k in r.body, `${p} missing ${k}`);
    }
    const pipe = await call('GET', '/pipeline');
    assert.ok(!('allItems' in pipe.body), 'internal allItems must not be sent');
    for (const p of ['/follow-ups/due-today', '/follow-ups/overdue']) {
      const r = await call('GET', p);
      assert.ok(r.status === 200 && Array.isArray(r.body), `${p} must return an array`);
    }
  });
  await test('routes: not found -> 404 with a safe message', async () => {
    for (const p of ['/orders/999999', '/customers/999999/360', '/quotations/999999/timeline', '/companies/999999/history', '/engineers/999999/follow-up-performance']) {
      const r = await call('GET', p);
      assert.strictEqual(r.status, 404, p);
      assert.ok(!/relation|column|syntax|SELECT/i.test(r.body.error), `${p} leaked: ${r.body.error}`);
    }
  });
  await test('routes: follow-up writes and validation', async () => {
    const created = await call('POST', '/follow-ups', { quotationId: qDraft.id, followUpDate: today, notes: 'via api' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.created_by, user.id);
    const bad = await call('POST', '/follow-ups', { quotationId: qDraft.id });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /follow-up date/);
    const done = await call('POST', `/follow-ups/${created.body.id}/complete`, { outcome: 'Done', outcome_notes: 'n' });
    assert.deepStrictEqual([done.status, done.body.status], [200, 'completed']);
    const resched = await call('POST', `/follow-ups/${created.body.id}/reschedule`, { follow_up_date: daysAgo(-7) });
    assert.deepStrictEqual([resched.status, resched.body.follow_up_date], [200, daysAgo(-7)]);
    const upd = await call('PUT', `/follow-ups/${resched.body.id}`, { priority: 'HIGH' });
    assert.deepStrictEqual([upd.status, upd.body.priority], [200, 'HIGH']);
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
  console.log(failed ? `${failed} FAILED, ${passed} passed` : `ALL ${passed}/${passed} SALES MODULE TESTS PASSED`);
  process.exit(failed ? 1 : 0);
}
