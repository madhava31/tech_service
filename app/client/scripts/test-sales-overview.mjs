// Technicon Services ERP - Sales Overview contract tests (no database, no network)
// Run via: node app/client/scripts/test-sales-overview.mjs
//
// 1. Server: getSalesOverview() against a stubbed database, with and without the sale_report table.
// 2. Client: parseSalesOverviewResponse() for valid, unavailable, old-format and malformed responses.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
// db/index.js requires a connection string at import time; the pool never connects in these tests.
process.env.DATABASE_URL = 'postgres://test_user:test_pass@localhost:5432/technicon_test';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

// ---------------------------------------------------------------- server
const { default: db } = await import(pathToFileURL(path.join(clientDir, 'api/_lib/db/index.js')).href);
const { getSalesOverview, SALE_REPORT_METRICS } = await import(
  pathToFileURL(path.join(clientDir, 'api/_lib/sales/overview.js')).href
);

function stubDb({ saleReportExists }) {
  const queries = [];
  db.prepare = (sql) => ({
    async get() {
      queries.push(sql);
      if (sql.includes('to_regclass')) return { present: saleReportExists };
      if (sql.includes('FROM quotation') && sql.includes('total_quotations')) {
        // pg returns COUNT(*) as a string and SUM as a number
        return { total_quotations: '5', draft_quotations: '2', sent_quotations: '1', accepted_quotations: '1', rejected_quotations: '1', quotation_total_value: 5000, accepted_quotation_value: 1200 };
      }
      if (sql.includes('total_pos')) return { total_pos: '2', po_total_value: 2400 };
      if (sql.includes('total_pis')) return { total_pis: '1', pi_total_value: 1200 };
      if (sql.includes('pending_pis')) return { pending_pis: '1' };
      if (sql.includes('total_sale_reports')) return { total_sale_reports: '3', pending_sale_reports: '1', confirmed_sales: '2', confirmed_sales_value: 160, pending_sale_report_value: 40 };
      if (sql.includes('open_orders')) return { open_orders: '1', open_order_value: 1200 };
      if (sql.includes('avg_val')) return { avg_val: 80 };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  });
  return queries;
}

await test('server: sale_report missing -> dependent metrics are null and listed, never 0', async () => {
  const queries = stubDb({ saleReportExists: false });
  const out = await getSalesOverview();
  for (const key of SALE_REPORT_METRICS) assert.strictEqual(out.kpis[key], null, `${key} should be null`);
  assert.deepStrictEqual(out.unavailable.metrics, SALE_REPORT_METRICS);
  assert.deepStrictEqual(out.unavailable.stages, ['Sale Report', 'Confirmed']);
  assert.ok(out.unavailable.reason.length > 0);
  const sr = out.pipeline.filter((s) => out.unavailable.stages.includes(s.stage));
  assert.ok(sr.length === 2 && sr.every((s) => s.count === null && s.value === null));
  assert.ok(!queries.some((q) => /\bFROM sale_report\b/.test(q)), 'must not query sale_report');
});

await test('server: computable metrics are real numbers when sale_report is missing', async () => {
  stubDb({ saleReportExists: false });
  const { kpis, pipeline } = await getSalesOverview();
  assert.deepStrictEqual(
    [kpis.totalQuotations, kpis.draftQuotations, kpis.sentQuotations, kpis.acceptedQuotations, kpis.rejectedQuotations, kpis.pendingPis, kpis.acceptedQuotationValue, kpis.quotationConversionRate],
    [5, 2, 1, 1, 1, 1, 1200, 50]
  );
  assert.deepStrictEqual(pipeline.slice(0, 4).map((s) => [s.stage, s.count, s.value]), [
    ['Quotation', 5, 5000], ['Accepted', 1, 1200], ['PO', 2, 2400], ['PI', 1, 1200],
  ]);
});

await test('server: sale_report present -> every metric computed, unavailable is null', async () => {
  stubDb({ saleReportExists: true });
  const out = await getSalesOverview();
  assert.strictEqual(out.unavailable, null);
  assert.strictEqual(Object.keys(out.kpis).length, 17);
  assert.ok(Object.values(out.kpis).every((v) => typeof v === 'number' && Number.isFinite(v)));
  assert.deepStrictEqual(
    [out.kpis.openOrders, out.kpis.openOrderValue, out.kpis.pendingSaleReports, out.kpis.confirmedSales, out.kpis.salesValue, out.kpis.pendingDispatchValue, out.kpis.averageOrderValue],
    [1, 1200, 1, 2, 160, 40, 80]
  );
  assert.deepStrictEqual(out.pipeline.slice(4).map((s) => [s.stage, s.count, s.value]), [['Sale Report', 3, 200], ['Confirmed', 2, 160]]);
});

// ---------------------------------------------------------------- client parser (TypeScript, bundled with esbuild)
const esbuild = createRequire(path.join(clientDir, 'package.json'))('esbuild');
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sales-overview-')), 'parser.mjs');
esbuild.buildSync({ entryPoints: [path.join(clientDir, 'src/lib/salesOverview.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: outFile, logLevel: 'silent' });
const { parseSalesOverviewResponse } = await import(pathToFileURL(outFile).href);

stubDb({ saleReportExists: true });
const full = await getSalesOverview();
stubDb({ saleReportExists: false });
const partial = JSON.parse(JSON.stringify(await getSalesOverview())); // as received over HTTP
const clone = (o) => JSON.parse(JSON.stringify(o));
const rejects = (raw, pattern) => assert.throws(() => parseSalesOverviewResponse(raw), pattern);

await test('client: accepts the server response with all metrics', async () => {
  const parsed = parseSalesOverviewResponse(clone(full));
  assert.strictEqual(parsed.unavailable, null);
  assert.strictEqual(parsed.kpis.totalQuotations, 5);
  assert.strictEqual(parsed.pipeline.length, 6);
});

await test('client: accepts the server response with unavailable sale-report metrics', async () => {
  const parsed = parseSalesOverviewResponse(clone(partial));
  assert.strictEqual(parsed.kpis.salesValue, null);
  assert.ok(parsed.unavailable.metrics.includes('salesValue'));
});

await test('client: rejects the old production format { totalSales, totalRevenue, sales }', async () => {
  rejects({ totalSales: 0, totalRevenue: 0, sales: [] }, /missing kpis/);
});

await test('client: rejects null, arrays and non-objects', async () => {
  rejects(null, /not an object/);
  rejects([], /not an object/);
  rejects('ok', /not an object/);
});

await test('client: rejects missing pipeline', async () => {
  const r = clone(full);
  delete r.pipeline;
  rejects(r, /missing pipeline/);
});

await test('client: rejects a missing always-required KPI', async () => {
  const r = clone(full);
  delete r.kpis.totalQuotations;
  rejects(r, /kpis\.totalQuotations/);
});

await test('client: rejects a null metric the server did not declare unavailable', async () => {
  const r = clone(full);
  r.kpis.salesValue = null;
  rejects(r, /kpis\.salesValue/);
});

await test('client: rejects a malformed pipeline stage', async () => {
  const r = clone(full);
  r.pipeline[0] = { stage: 'Quotation' };
  rejects(r, /pipeline\[0\]/);
  const r2 = clone(full);
  r2.pipeline[1].count = null;
  rejects(r2, /pipeline\[1\]\.count/);
});

await test('client: rejects a malformed unavailable block', async () => {
  const r = clone(partial);
  r.unavailable = { reason: 1 };
  rejects(r, /unavailable block/);
});

await db.pool.end();
console.log(`\nALL ${passed}/${passed} SALES OVERVIEW TESTS PASSED`);
