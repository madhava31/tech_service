# Feature Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify every backend feature works against the new Postgres database via a scripted API
smoke test (fixing any bug found immediately), verify the frontend compiles/builds cleanly, and hand
the user a manual UI checklist for anything better judged visually.

**Architecture:** One Node ESM script (`app/scratch/audit.mjs`, not committed — throwaway tooling) run
against the already-running local dev API (`http://localhost:4000`), using `fetch` with a real session
cookie obtained by logging in as the admin account created during the Postgres migration. The script
walks the full business lifecycle in dependency order (companies/products → quotation → PO → PI →
reports/dashboard/admin) and prints `PASS`/`FAIL: <reason>` per check. Any `FAIL` is fixed in the
relevant route file immediately, then that section is re-run before moving on.

**Tech Stack:** Node 22 built-in `fetch`, the already-running Express/Postgres API — no new
dependencies.

## Global Constraints

- Test data (companies/products) is created through the app's own API, not raw SQL — confirmed with
  the user.
- Bugs are fixed immediately when found, not batched — confirmed with the user.
- No changes to `docs/aurora-ui-rebuild-plan.md` or any UI styling — out of scope, that's sub-project 3.
- The AI endpoint (`POST /api/ai/ask`) is only tested if `GEMINI_API_KEY` is set in `app/client/.env`;
  otherwise report SKIPPED, not FAILED.
- `app/scratch/` is already gitignored (per root `.gitignore`) — the audit script itself is never
  committed; only bug fixes to actual source files are.

---

### Task 1: Script scaffold + auth

**Files:**
- Create: `app/scratch/audit.mjs`

**Interfaces:**
- Produces: a `request(method, path, body)` helper that sends cookies from a module-level `sessionCookie`
  variable and returns `{ status, json }`; a `check(label, condition)` helper that prints
  `PASS: <label>` or `FAIL: <label>` and pushes to a `failures` array; `report()` prints a final
  summary and sets `process.exitCode = failures.length ? 1 : 0`.

- [ ] **Step 1: Write the scaffold**

```js
// app/scratch/audit.mjs — throwaway API smoke test, not committed to the repo.
const BASE = 'http://localhost:4000';
let sessionCookie = '';
const failures = [];

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response (PDF/Excel binary) — caller checks status/content-type instead
  }
  return { status: res.status, json };
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

function report() {
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURE(S)`}`);
  if (failures.length) console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = failures.length ? 1 : 0;
}

// --- Auth: log in as the admin account created during the Postgres migration ---
// Replace with the actual admin credentials you created during Task 4/5 of the Postgres plan.
const ADMIN_USERNAME = process.env.AUDIT_USERNAME;
const ADMIN_PASSWORD = process.env.AUDIT_PASSWORD;
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('Set AUDIT_USERNAME and AUDIT_PASSWORD env vars to the admin account you created.');
  process.exit(1);
}

{
  const { status, json } = await request('POST', '/api/auth/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  check('login succeeds', status === 200 && json?.user?.role === 'admin', JSON.stringify(json));
}

{
  const { status, json } = await request('GET', '/api/auth/me');
  check('session persists (/api/auth/me)', status === 200 && json?.user?.username === ADMIN_USERNAME);
}

report();
```

- [ ] **Step 2: Run it**

From `app/`: `AUDIT_USERNAME=<your admin username> AUDIT_PASSWORD=<your admin password> node scratch/audit.mjs`
Expected: `PASS: login succeeds`, `PASS: session persists (/api/auth/me)`, then `ALL PASS`.

- [ ] **Step 3: Fix any failure immediately**

If login fails, check `app/client/api/_lib/routes/auth.js` and the running server log
(`bt01svken` task output) for the actual error before changing anything.

---

### Task 2: Companies & Products (test data + CRUD)

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `request`, `check` from Task 1.
- Produces: module-level `companyIds` (array of 3 ids) and `productIds` (array of 3 ids) for later tasks.

- [ ] **Step 1: Append company + product creation and CRUD checks**

```js
// --- Companies & Products ---
const companyPayloads = [
  { name: 'Alpha Diagnostics Pvt Ltd', address: 'Plot 12, MIDC, Pune', state: 'Maharashtra', gstin: '27AAAAA0000A1Z5', contact_person: 'Rakesh Mehta', phone: '9820012345', email: 'rakesh@alphadiag.in' },
  { name: 'Bright Labs Solutions', address: 'Sector 18, Gurugram', state: 'Haryana', gstin: '06BBBBB1111B2Z6', contact_person: 'Neha Kapoor', phone: '9871123456', email: 'neha@brightlabs.in' },
  { name: 'Coastal Analytical Instruments', address: 'Marine Drive, Kochi', state: 'Kerala', gstin: '32CCCCC2222C3Z7', contact_person: 'Thomas Varghese', phone: '9447234567', email: 'thomas@coastalai.in' },
];
const companyIds = [];
for (const payload of companyPayloads) {
  const { status, json } = await request('POST', '/api/companies', payload);
  check(`create company "${payload.name}"`, status === 201 && json?.id, JSON.stringify(json));
  if (json?.id) companyIds.push(json.id);
}

{
  const { status, json } = await request('GET', '/api/companies');
  check('list companies', status === 200 && Array.isArray(json) && json.length >= 3);
}
{
  const { status, json } = await request('GET', `/api/companies?q=Alpha`);
  check('search companies by name', status === 200 && json.some((c) => c.name.includes('Alpha')));
}
{
  const { status, json } = await request('PUT', `/api/companies/${companyIds[0]}`, { ...companyPayloads[0], contact_person: 'Rakesh Mehta Jr.' });
  check('edit company', status === 200 && json.contact_person === 'Rakesh Mehta Jr.');
}

const productPayloads = [
  { part_no: 'PN-1001', hsn_sac: '9027', description: 'UV-Visible Spectrophotometer', unit: 'Nos', default_price: 185000 },
  { part_no: 'PN-1002', hsn_sac: '9027', description: 'Digital pH Meter', unit: 'Nos', default_price: 12500 },
  { part_no: 'PN-1003', hsn_sac: '9018', description: 'Laboratory Centrifuge 24-Slot', unit: 'Nos', default_price: 64500 },
];
const productIds = [];
for (const payload of productPayloads) {
  const { status, json } = await request('POST', '/api/products', payload);
  check(`create product "${payload.part_no}"`, status === 201 && json?.id, JSON.stringify(json));
  if (json?.id) productIds.push(json.id);
}

{
  const { status, json } = await request('GET', '/api/products');
  check('list products', status === 200 && Array.isArray(json) && json.length >= 3);
}
{
  const { status, json } = await request('GET', '/api/products?q=pH');
  check('search products by description', status === 200 && json.some((p) => p.description.includes('pH')));
}
{
  const { status, json } = await request('PUT', `/api/products/${productIds[0]}`, { ...productPayloads[0], default_price: 190000 });
  check('edit product', status === 200 && Number(json.default_price) === 190000);
}

report();
```

- [ ] **Step 2: Run and verify**

Run the same command as Task 1. Expected: all new checks PASS, `companyIds`/`productIds` populated
(add a temporary `console.log(companyIds, productIds)` if you need to confirm, then remove it).

- [ ] **Step 3: Fix any failure immediately, then re-run**

---

### Task 3: Product Excel import (template, preview, commit)

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `request`, `check`.

- [ ] **Step 1: Append import checks**

```js
// --- Product import ---
{
  const res = await fetch(`${BASE}/api/products/import/template`, { headers: { Cookie: sessionCookie } });
  check(
    'download product import template',
    res.status === 200 && res.headers.get('content-type')?.includes('spreadsheetml')
  );
}

// Build a tiny in-memory workbook: one new part, one update to an existing part (PN-1002).
const ExcelJS = await import('exceljs');
const wb = new ExcelJS.default.Workbook();
const sheet = wb.addWorksheet('Products');
sheet.columns = [
  { header: 'Product Name', key: 'productName' },
  { header: 'Part No', key: 'partNo' },
  { header: 'Price', key: 'price' },
];
sheet.addRow({ productName: 'Analytical Balance 220g', partNo: 'PN-2001', price: 45000 });
sheet.addRow({ productName: 'Digital pH Meter (Updated)', partNo: 'PN-1002', price: 13000 });
const buffer = await wb.xlsx.writeBuffer();

const form = new FormData();
form.append('file', new Blob([buffer]), 'import.xlsx');
const previewRes = await fetch(`${BASE}/api/products/import/preview`, {
  method: 'POST',
  headers: { Cookie: sessionCookie },
  body: form,
});
const preview = await previewRes.json();
check('import preview: one new + one update row, zero errors', previewRes.status === 200 && preview.summary.newCount === 1 && preview.summary.updateCount === 1 && preview.summary.errorCount === 0, JSON.stringify(preview.summary));

const commitRes = await request('POST', '/api/products/import', { rows: preview.validRows });
check('import commit succeeds', commitRes.status === 200 && commitRes.json.created === 1 && commitRes.json.updated === 1, JSON.stringify(commitRes.json));

report();
```

- [ ] **Step 2: Run and verify.** Fix any failure immediately, then re-run.

---

### Task 4: Quotation full lifecycle

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `companyIds`, `productIds` from Task 2.
- Produces: `quotationId`, `poId`, `piId` for later reference (not needed by later tasks, but kept for
  clarity/debugging).

- [ ] **Step 1: Append quotation creation + totals-math check**

```js
// --- Quotations ---
const { status: qCreateStatus, json: quotation } = await request('POST', '/api/quotations', {
  company_id: companyIds[0],
  date: new Date().toISOString().slice(0, 10),
  tax_percent: 18,
  discount_type: 'percentage',
  discount_value: 5,
  notes: 'Audit test quotation',
  items: [
    { product_id: productIds[0], part_no: 'PN-1001', description: 'UV-Visible Spectrophotometer', hsn_sac: '9027', qty: 1, price: 190000 },
    { product_id: productIds[1], part_no: 'PN-1002', description: 'Digital pH Meter', hsn_sac: '9027', qty: 2, price: 13000 },
  ],
});
check('create quotation', qCreateStatus === 201 && quotation?.id, JSON.stringify(quotation));
const quotationId = quotation.id;

// subtotal = 190000*1 + 13000*2 = 216000; 5% discount = 10800; taxable = 205200; 18% tax = 36936;
// exact total = 242136 (already an integer, so round_off should be 0).
check('quotation totals math (subtotal)', Number(quotation.subtotal) === 216000, quotation.subtotal);
check('quotation totals math (discount_amount)', Number(quotation.discount_amount) === 10800, quotation.discount_amount);
check('quotation totals math (tax_amount)', Number(quotation.tax_amount) === 36936, quotation.tax_amount);
check('quotation totals math (total)', Number(quotation.total) === 242136, quotation.total);
check('quotation starts as draft', quotation.status === 'draft');

{
  const { status, json } = await request('GET', `/api/quotations/${quotationId}`);
  check('fetch quotation detail with items', status === 200 && json.items.length === 2 && json.items[0].description === 'UV-Visible Spectrophotometer');
}
{
  const { status, json } = await request('GET', '/api/quotations');
  check('list quotations', status === 200 && json.some((q) => q.id === quotationId));
}

// Part-no auto-fill is a frontend behavior (SearchableSelect autofilling description/HSN/price from
// GET /api/products/:id) — verified here at the data level: the product record has the fields the
// frontend reads for autofill.
{
  const { status, json } = await request('GET', `/api/products/${productIds[0]}`);
  check('product has fields frontend uses for autofill', status === 200 && json.description && json.hsn_sac && json.default_price != null);
}

// Status transitions: draft -> sent -> accepted
{
  const { status, json } = await request('POST', `/api/quotations/${quotationId}/status`, { status: 'sent' });
  check('quotation draft -> sent', status === 200 && json.status === 'sent');
}

// Follow-up: schedule, then complete
const { status: fuStatus, json: followUp } = await request('POST', `/api/quotations/${quotationId}/follow-ups`, {
  follow_up_date: new Date().toISOString().slice(0, 10),
  notes: 'Audit test follow-up',
});
check('schedule follow-up on sent quotation', fuStatus === 201 && followUp?.id, JSON.stringify(followUp));
{
  const { status, json } = await request('GET', `/api/quotations/${quotationId}/follow-ups`);
  check('list follow-ups', status === 200 && json.followUps.some((f) => f.id === followUp.id));
}
{
  const { status, json } = await request('POST', `/api/quotations/${quotationId}/follow-ups/${followUp.id}/complete`, {
    outcome: 'positive',
    outcome_notes: 'Customer wants a revised quote',
  });
  check('complete follow-up', status === 200 && json.status === 'completed');
}

// Second follow-up to exercise cancel path
const { json: followUp2 } = await request('POST', `/api/quotations/${quotationId}/follow-ups`, {
  follow_up_date: new Date().toISOString().slice(0, 10),
  notes: 'Audit test follow-up 2',
});
{
  const { status, json } = await request('POST', `/api/quotations/${quotationId}/follow-ups/${followUp2.id}/cancel`);
  check('cancel follow-up', status === 200 && json.status === 'cancelled');
}

// PDF generation
{
  const res = await fetch(`${BASE}/api/quotations/${quotationId}/pdf`, { headers: { Cookie: sessionCookie } });
  check('quotation PDF generates', res.status === 200 && res.headers.get('content-type') === 'application/pdf');
}

report();
```

- [ ] **Step 2: Run and verify.** If the totals-math checks fail, compare the actual numbers printed
  against the hand-computed comment above — that tells you whether the bug is in `computeTotals()`
  (`app/client/api/_lib/routes/quotations.js`) or in the audit script's own arithmetic. Fix and re-run.

---

### Task 5: Convert to PO, Generate Performa Invoice, PDFs

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `quotationId` from Task 4.

- [ ] **Step 1: Append PO/PI checks**

```js
// --- Purchase Order (Convert to PO) ---
const { status: poStatus, json: po } = await request('POST', '/api/purchase-orders', {
  quotation_id: quotationId,
  client_po_ref: 'PO-AUDIT-001',
  date: new Date().toISOString().slice(0, 10),
});
check('convert quotation to purchase order', poStatus === 201 && po?.id, JSON.stringify(po));

{
  const { status, json } = await request('GET', `/api/quotations/${quotationId}`);
  check('quotation auto-accepted after PO conversion', status === 200 && json.status === 'accepted');
}
{
  const { status, json } = await request('GET', `/api/purchase-orders/${po.id}`);
  check('fetch PO detail with items', status === 200 && json.items.length === 2);
}
{
  const { status, json } = await request('GET', '/api/purchase-orders');
  check('list purchase orders', status === 200 && json.some((r) => r.id === po.id));
}
{
  const res = await fetch(`${BASE}/api/purchase-orders/${po.id}/pdf`, { headers: { Cookie: sessionCookie } });
  check('PO PDF generates', res.status === 200 && res.headers.get('content-type') === 'application/pdf');
}

// --- Performa Invoice (Generate PI) ---
const { status: piStatus, json: pi } = await request('POST', '/api/performa-invoices', {
  quotation_id: quotationId,
  purchase_order_id: po.id,
  date: new Date().toISOString().slice(0, 10),
});
check('generate performa invoice', piStatus === 201 && pi?.id, JSON.stringify(pi));
{
  const { status, json } = await request('GET', `/api/performa-invoices/${pi.id}`);
  check('fetch PI detail with items', status === 200 && json.items.length === 2);
}
{
  const { status, json } = await request('GET', '/api/performa-invoices');
  check('list performa invoices', status === 200 && json.some((r) => r.id === pi.id));
}
{
  const res = await fetch(`${BASE}/api/performa-invoices/${pi.id}/pdf`, { headers: { Cookie: sessionCookie } });
  check('PI PDF generates', res.status === 200 && res.headers.get('content-type') === 'application/pdf');
}

report();
```

- [ ] **Step 2: Run and verify.** Fix any failure immediately, then re-run.

---

### Task 6: Dashboard, Reports, Opportunities

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `request`, `check`. No new state produced.

- [ ] **Step 1: Append dashboard aggregate checks**

```js
// --- Dashboard ---
for (const path of ['/api/dashboard', '/api/dashboard/attention', '/api/dashboard/pipeline', '/api/dashboard/follow-ups', '/api/dashboard/recent-activity', '/api/dashboard/business-health']) {
  const { status } = await request('GET', path);
  check(`dashboard endpoint ${path}`, status === 200);
}
{
  const { status, json } = await request('GET', '/api/dashboard');
  check('dashboard counts reflect seeded data', status === 200 && json.counts.companies >= 3 && json.counts.quotations >= 1);
}
{
  const { status, json } = await request('GET', '/api/dashboard/draft-quotations');
  check('drill-down: draft-quotations', status === 200 && Array.isArray(json.quotations));
}
{
  const { status, json } = await request('GET', '/api/dashboard/purchase-orders-not-invoiced');
  check('drill-down: purchase-orders-not-invoiced', status === 200 && Array.isArray(json.purchaseOrders));
}
{
  const { status, json } = await request('GET', '/api/dashboard/inactive-customers');
  check('drill-down: inactive-customers', status === 200 && Array.isArray(json.customers));
}
{
  const { status, json } = await request('GET', '/api/dashboard/flagged-sales-records');
  check('drill-down: flagged-sales-records', status === 200 && Array.isArray(json.records));
}
{
  const { status, json } = await request('GET', '/api/dashboard/overdue-follow-ups');
  check('drill-down: overdue-follow-ups', status === 200 && Array.isArray(json.followUps));
}
{
  const { status, json } = await request('GET', '/api/dashboard/follow-ups-due-today');
  check('drill-down: follow-ups-due-today', status === 200 && Array.isArray(json.followUps));
}

// --- Reports (no sales_record data yet, so expect empty arrays, not errors) ---
for (const path of ['/api/reports/companies', '/api/reports/products', '/api/reports/review-queue', '/api/reports/lapsed']) {
  const { status, json } = await request('GET', path);
  check(`report endpoint ${path}`, status === 200 && Array.isArray(json));
}
{
  const { status, json } = await request('GET', `/api/reports/companies/${encodeURIComponent('Alpha Diagnostics Pvt Ltd')}/history`);
  check('report: company history', status === 200 && Array.isArray(json));
}
{
  const { status, json } = await request('GET', `/api/reports/company-yearly?company=${encodeURIComponent('Alpha Diagnostics Pvt Ltd')}`);
  check('report: company-yearly', status === 200 && Array.isArray(json.products));
}
{
  const res = await fetch(`${BASE}/api/reports/export?type=companies`, { headers: { Cookie: sessionCookie } });
  check('report export (companies xlsx)', res.status === 200 && res.headers.get('content-type')?.includes('spreadsheetml'));
}
{
  const res = await fetch(`${BASE}/api/reports/export?type=products`, { headers: { Cookie: sessionCookie } });
  check('report export (products xlsx)', res.status === 200 && res.headers.get('content-type')?.includes('spreadsheetml'));
}

// --- Opportunities ---
{
  const { status } = await request('GET', '/api/opportunities');
  check('opportunities endpoint', status === 200);
}

report();
```

- [ ] **Step 2: Run and verify.** Fix any failure immediately, then re-run.

---

### Task 7: Settings & Admin

**Files:** Modify `app/scratch/audit.mjs` (append)

**Interfaces:**
- Consumes: `request`, `check`.

- [ ] **Step 1: Append settings + admin checks**

```js
// --- Settings ---
{
  const { status, json } = await request('GET', '/api/settings');
  check('load settings', status === 200 && json.id === 1);
}
{
  const { status, json } = await request('PUT', '/api/settings', { payment_terms: 'Audit test: 50% advance, balance on delivery' });
  check('save settings', status === 200 && json.payment_terms === 'Audit test: 50% advance, balance on delivery');
}
{
  const { status, json } = await request('GET', '/api/settings');
  check('settings reload persists', status === 200 && json.payment_terms === 'Audit test: 50% advance, balance on delivery');
}

// --- Admin ---
{
  const { status, json } = await request('GET', '/api/admin/stats');
  check('admin stats', status === 200 && json.counts.company >= 3);
}
{
  const { status, json } = await request('GET', '/api/admin/config');
  check('admin config load', status === 200 && json.default_tax_percent != null);
}
{
  const { status, json } = await request('PUT', '/api/admin/config', { default_lapse_months: 9 });
  check('admin config save', status === 200 && Number(json.default_lapse_months) === 9);
}
{
  const { status, json } = await request('GET', '/api/admin/users');
  check('admin list users', status === 200 && json.length >= 1);
}
const { status: userCreateStatus, json: newUser } = await request('POST', '/api/admin/users', {
  username: 'audit_staff',
  password: 'audit123',
  role: 'staff',
});
check('admin create user', userCreateStatus === 201 && newUser?.id, JSON.stringify(newUser));
{
  const { status } = await request('POST', `/api/admin/users/${newUser.id}/reset-password`, { password: 'audit1234' });
  check('admin reset user password', status === 200);
}
{
  const { status, json } = await request('DELETE', `/api/admin/users/${newUser.id}`);
  check('admin delete user', status === 200 && json.ok === true);
}

// Delete-guard checks: the audit's own quotation now references companyIds[0]/productIds[0-1], so
// deleting those must be blocked (409), proving the guard works — then delete the untouched
// third company/product to prove the guard does NOT over-block unrelated records.
{
  const { status } = await request('DELETE', `/api/admin/companies/${companyIds[0]}`);
  check('admin delete-guard blocks company referenced by a quotation', status === 409);
}
{
  const { status } = await request('DELETE', `/api/admin/companies/${companyIds[2]}`);
  check('admin deletes unreferenced company', status === 200);
}
{
  const { status } = await request('DELETE', `/api/admin/products/${productIds[0]}`);
  check('admin delete-guard blocks product referenced by a quotation line', status === 409);
}

report();
```

- [ ] **Step 2: Run and verify.** Fix any failure immediately, then re-run.

---

### Task 8: AI endpoint (conditional) + static frontend checks

**Files:**
- Modify: `app/scratch/audit.mjs` (append)

- [ ] **Step 1: Append the conditional AI check**

```js
// --- AI (only if a key is configured) ---
if (process.env.GEMINI_API_KEY_PRESENT === '1') {
  const { status, json } = await request('POST', '/api/ai/ask', { question: 'How many companies are in the system?' });
  check('AI ask endpoint responds', status === 200 && typeof json?.answer === 'string');
} else {
  console.log('SKIP: AI ask endpoint (no GEMINI_API_KEY configured)');
}

report();
```

- [ ] **Step 2: Run the full script one final time**

From `app/`:
```bash
GEMINI_API_KEY_PRESENT=$(grep -q '^GEMINI_API_KEY=.' client/.env && echo 1 || echo 0) \
AUDIT_USERNAME=<your admin username> AUDIT_PASSWORD=<your admin password> \
node scratch/audit.mjs
```
Expected: `ALL PASS` (or `SKIP` for AI only).

- [ ] **Step 3: Static frontend checks**

From `app/client/`:
```bash
npx tsc -b
npm run build
```
Expected: both commands exit 0 with no errors.

- [ ] **Step 4: Fix any remaining failure immediately, then re-run both Step 2 and Step 3.**

---

### Task 9: Hand off the manual UI checklist

**Files:** none — this task is a message to the user, not code.

- [ ] **Step 1: Give the user this checklist** (adapted from `docs/aurora-ui-rebuild-plan.md` Phase 7's
  manual section) to walk through in the browser at `http://localhost:5173`, reporting back anything
  broken:
  - Auth: logout, then log back in; refresh mid-session (stays logged in).
  - Companies/Products pages: the 3 companies and products created by the audit script are visible;
    search filters correctly.
  - Quotations: the audit's test quotation appears in the list with status "Accepted"; open it and
    confirm the follow-up history, the linked PO and PI, and both PDF links open.
  - New Quotation: create one from scratch through the UI — company search-select, part-no
    autocomplete filling description/HSN/price, qty/price edits recomputing totals live.
  - Reports: open each report tab in the UI; Excel upload with a real sales file (if the user has one)
    and both export buttons.
  - Settings: change a field, save, reload the page, confirm it persisted.
  - Admin: user management table, create/delete a test user through the UI.
  - Responsive: resize to ~768px and ~390px — no horizontal page scroll, tables scroll internally.

- [ ] **Step 2: Fix anything the user reports, then ask them to re-check just that item.**

---

## Execution log

All 9 tasks completed; full backend smoke test (`app/scratch/audit.mjs`) reports **ALL PASS**, `tsc -b`
and `vite build` both clean. Two real bugs were found and fixed along the way:

1. **`quotation` table was missing 6 columns** (`discount_type`, `discount_value`,
   `discount_percent`, `discount_amount`, `taxable_amount`, `round_off`) that
   `routes/quotations.js` and `pdf/documents.js` both read/write — every quotation creation/edit was
   broken. Fixed in `db/schema.sql` (for future fresh installs) and applied via `ALTER TABLE ADD
   COLUMN IF NOT EXISTS` to the live Supabase database (no data loss — table was empty).
2. **`GET /api/dashboard/business-health` crashed 500** — `getBusinessHealth()` looked up pipeline
   stages keyed `'purchase_order'`/`'performa_invoice'`, but `PIPELINE_STAGES` only defines
   `draft/sent/accepted/rejected`, so `.find(...).count` threw on `undefined`. Fixed in
   `routes/dashboard.js` to use a `COUNT(DISTINCT quotation_id)` query across the `purchase_order`
   and `performa_invoice` tables instead — this also fixed a second, subtler bug the crash was
   masking: the original fulfillment-count-based approach could double-count a quotation that has
   both a PO and a PI, which (once the crash was naively patched) produced a "Conversions" score
   over 100%.

The local dev API server had to be restarted once mid-audit (`node api/local-dev.js` has no
`--watch`, so route-file edits don't hot-reload).

Task 9's manual UI checklist was handed to the user after the frontend dev server was restarted
(it had been killed by the harness's low-memory background-process reaper, unrelated to any bug).

## Self-review notes

- **Spec coverage:** every numbered item in the design spec's "Backend API smoke test" section (1-10)
  has a corresponding task above (Tasks 2-8); the manual UI checklist (Task 9) covers the
  visually-judged items the spec calls out. Static checks are Task 8 Step 3.
- **Placeholders:** `<your admin username>`/`<your admin password>` are intentional — real credentials
  were created interactively during the Postgres migration plan and aren't known ahead of execution;
  every other step has concrete, runnable code.
- **Type/signature consistency:** `request()`, `check()`, `report()`, `companyIds`, `productIds`,
  `quotationId` are defined once (Tasks 1-2 and 4) and reused with the same names/shapes in every later
  task — verified by re-reading each task's "Consumes" line against the task that produces it.
- **`app/scratch/`** is confirmed gitignored by the root `.gitignore` (`scratch/` pattern) — the audit
  script itself never needs a commit step; only fixes to real source files do.
