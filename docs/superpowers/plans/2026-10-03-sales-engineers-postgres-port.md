# Sales Engineers Postgres Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Sales Engineers" feature (engineer roster, annual targets, quoted/accepted performance tracking) work against the live Postgres backend (`app/client/api/_lib`), which currently 404s on every `/api/engineers*` request because the feature was never ported from the old SQLite backend (`app/server`).

**Architecture:** Port `app/server/src/services/engineerService.js` + `app/server/src/routes/engineers.js` into `app/client/api/_lib`, adapted for the `db.prepare(sql).run/get/all(...)` Postgres wrapper (see `app/client/api/_lib/db/index.js`) instead of synchronous better-sqlite3 calls. Two schema additions: a new `sales_engineer` + `engineer_sales_targets` table pair, and a `sales_engineer_id` column on the existing `quotation` table (the frontend's quotation form already sends this field — it's just never been persisted because the column doesn't exist). The `branch`/`firm` tables and the `sale_report` table do not exist in Postgres yet (separate, deferred migrations) — every ported query that referenced them is stripped down accordingly: `branch_id` becomes a plain nullable passthrough column with no join, and "confirmed sales" (which can only come from confirmed Sale Reports) is reported as unavailable rather than silently shown as zero.

**Tech Stack:** Express, `pg` via the existing `db.prepare(sql).run/get/all()` wrapper (`?` placeholders, auto-converted to `$1,$2,...`), React + TypeScript frontend already wired for this feature.

## Global Constraints

- Every new/changed SQL statement uses `?` placeholders (not `$1`) — the `db.prepare()` wrapper in `app/client/api/_lib/db/index.js` converts them automatically; this is the house style for every existing route in this directory.
- No `branch`/`firm` join or FK reference — those tables don't exist in this Postgres database. `branch_id` stays a plain nullable `INTEGER` column with no `REFERENCES` clause, for forward compatibility only.
- No `sale_report` reference anywhere — that table doesn't exist either. "Confirmed sales" must never be silently reported as `0` in a way indistinguishable from "zero sales happened"; the API must say explicitly that this figure isn't trackable yet, and the UI must render that distinctly from a real zero.
- All new schema DDL goes in `app/client/api/_lib/db/schema.sql`, using `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` (idempotent, matching every existing statement in that file), applied by re-running `node scripts/setup-db.js` against `DATABASE_URL`.
- Verification happens via small Node scripts run against the live Supabase DB (there is no jest/vitest test runner configured in this project — this mirrors how every other change in this session was verified) plus `npx tsc --noEmit -p tsconfig.json` for the frontend. Scratch verification scripts go in `app/client/scripts/_verify_*.mjs` and are deleted after the task's checks pass — never left in the repo.
- The backend server (`app/api/local-dev.js`, PID bound to port 4000) must be restarted after backend file changes take effect, unless it was started with `node --watch` — confirm which before assuming changes are live.

---

### Task 1: Postgres schema — sales_engineer, engineer_sales_targets, quotation.sales_engineer_id

**Files:**
- Modify: `app/client/api/_lib/db/schema.sql` (append to end of file)

**Interfaces:**
- Produces: tables `sales_engineer(id, employee_code, name, email, phone, designation, department, branch_id, is_active, created_at, updated_at)` and `engineer_sales_targets(id, engineer_id, branch_id, financial_year, target_amount, created_by, created_at, updated_at)`; column `quotation.sales_engineer_id`. Every later task's SQL depends on these exact column names.

- [ ] **Step 1: Append the new tables and column to schema.sql**

Append this block to the end of `app/client/api/_lib/db/schema.sql` (after the existing `quotation_follow_up` indexes):

```sql

-- Sales Engineers (Step: Sales Engineers Postgres port). branch_id is a plain nullable column,
-- not a foreign key — the `branch` table doesn't exist in this database yet (separate,
-- deferred migration), so a REFERENCES clause here would make every insert fail.
CREATE TABLE IF NOT EXISTS sales_engineer (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  designation TEXT DEFAULT 'Sales Engineer',
  department TEXT DEFAULT 'Sales',
  branch_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  joining_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engineer_sales_targets (
  id SERIAL PRIMARY KEY,
  engineer_id INTEGER NOT NULL REFERENCES sales_engineer(id) ON DELETE CASCADE,
  branch_id INTEGER,
  financial_year TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL CHECK (target_amount >= 0),
  created_by INTEGER REFERENCES app_user(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(engineer_id, financial_year, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_target_eng ON engineer_sales_targets(engineer_id, financial_year);

-- Lets a quotation record which sales engineer it belongs to — the frontend quotation form
-- (QuotationNew.tsx) already sends this field on every create/update; it was simply never
-- persisted because this column didn't exist.
ALTER TABLE quotation ADD COLUMN IF NOT EXISTS sales_engineer_id INTEGER REFERENCES sales_engineer(id);
```

- [ ] **Step 2: Apply it to the live database**

Run: `cd app/client && node scripts/setup-db.js` (reads `DATABASE_URL` from `app/client/.env` or the process environment — confirm it's set first; this repo's root `.env` holds the real connection string).

Expected: `Schema applied successfully.` with no errors. Every existing statement in the file is `IF NOT EXISTS`-guarded, so re-running it is safe and changes nothing else.

- [ ] **Step 3: Verify the tables and column exist**

Create `app/client/scripts/_verify_schema.mjs`:

```js
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('sales_engineer','engineer_sales_targets')`);
console.log('tables:', tables.rows.map((r) => r.table_name));
const col = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'quotation' AND column_name = 'sales_engineer_id'`);
console.log('quotation.sales_engineer_id exists:', col.rows.length === 1);
await client.end();
```

Run: `node app/client/scripts/_verify_schema.mjs` (with `DATABASE_URL` set in the shell).

Expected: `tables: [ 'sales_engineer', 'engineer_sales_targets' ]` and `quotation.sales_engineer_id exists: true`.

- [ ] **Step 4: Delete the verification script and commit**

```bash
rm app/client/scripts/_verify_schema.mjs
git add app/client/api/_lib/db/schema.sql
git commit -m "feat: add sales_engineer, engineer_sales_targets tables and quotation.sales_engineer_id column"
```

---

### Task 2: Backend engineer service

**Files:**
- Create: `app/client/api/_lib/db/engineerService.js`

**Interfaces:**
- Consumes: `db` default export from `app/client/api/_lib/db/index.js` (`db.prepare(sql).run/get/all(...params)`, all async).
- Produces: `getEngineers`, `getEngineerById`, `createEngineer`, `updateEngineer`, `getEngineerPerformance`, `setEngineerTarget`, `getEngineerTargets` — all exported `async` functions, consumed by Task 3's routes with these exact names and parameter shapes (documented in each step below).

- [ ] **Step 1: Write the service file**

Create `app/client/api/_lib/db/engineerService.js`:

```js
import db from './index.js';

function normalizeFy(yearStr) {
  if (!yearStr) return 'FY 2026-27';
  const str = String(yearStr).trim();
  if (str.startsWith('FY ')) return str;
  return `FY ${str}`;
}

export async function getEngineers({ branchId = null, activeOnly = false, q = null, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT id, employee_code AS code, employee_code, name, email, phone, designation, department,
           branch_id, is_active AS active, is_active, created_at, updated_at
    FROM sales_engineer
    WHERE 1=1
  `;
  const params = [];
  if (branchId) {
    sql += ` AND branch_id = ?`;
    params.push(branchId);
  }
  if (activeOnly) sql += ` AND is_active = 1`;
  if (q) {
    sql += ` AND (name ILIKE ? OR employee_code ILIKE ? OR email ILIKE ? OR designation ILIKE ?)`;
    const s = `%${q}%`;
    params.push(s, s, s, s);
  }
  sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export async function getEngineerById(id, { financialYear = 'FY 2026-27' } = {}) {
  const engId = Number(id);
  if (!engId) return null;

  const engineer = await db.prepare(`
    SELECT id, employee_code AS code, employee_code, name, email, phone, designation, department,
           branch_id, is_active AS active, is_active, created_at, updated_at
    FROM sales_engineer WHERE id = ?
  `).get(engId);
  if (!engineer) return null;

  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  const quoteStats = await db.prepare(`
    SELECT COUNT(*) AS total_quotations,
           COALESCE(SUM(total), 0) AS total_quoted_value,
           SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
           COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) AS accepted_value
    FROM quotation WHERE sales_engineer_id = ?
  `).get(engId);

  const targetRow = await db.prepare(`
    SELECT target_amount, financial_year FROM engineer_sales_targets
    WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?) LIMIT 1
  `).get(engId, fy, rawFy);

  const perf = buildPerformanceEntry(engineer, fy, quoteStats, targetRow);

  return {
    ...engineer,
    current_year_target: targetRow ? { engineer_id: engId, fiscal_year: targetRow.financial_year, target_amount: Number(targetRow.target_amount) } : undefined,
    performance: perf,
  };
}

export async function createEngineer({ code, employeeCode, name, email, phone, designation, department, branchId, joiningDate }) {
  if (!name || !name.trim()) throw new Error('Engineer name is required');
  const codeVal = (code || employeeCode) ? String(code || employeeCode).trim() : `ENG-${Math.floor(1000 + Math.random() * 9000)}`;

  const existing = await db.prepare(`SELECT id FROM sales_engineer WHERE employee_code = ?`).get(codeVal);
  if (existing) throw new Error(`Employee code '${codeVal}' already exists`);

  const info = await db.prepare(`
    INSERT INTO sales_engineer (employee_code, name, email, phone, designation, department, branch_id, is_active, joining_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id
  `).run(
    codeVal,
    name.trim(),
    email ? email.trim() : null,
    phone ? phone.trim() : null,
    designation || 'Sales Engineer',
    department || 'Sales',
    branchId || null,
    joiningDate || new Date().toISOString().slice(0, 10)
  );

  return getEngineerById(info.lastInsertRowid);
}

export async function updateEngineer(id, { code, employeeCode, name, email, phone, designation, department, branchId, active, isActive, joiningDate }) {
  const engId = Number(id);
  const existing = await db.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(engId);
  if (!existing) throw new Error('Sales Engineer not found');

  const activeVal = active !== undefined ? (active ? 1 : 0) : (isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active);
  const codeVal = code !== undefined ? String(code).trim() : (employeeCode !== undefined ? String(employeeCode).trim() : existing.employee_code);

  await db.prepare(`
    UPDATE sales_engineer
    SET employee_code = ?, name = ?, email = ?, phone = ?, designation = ?, department = ?,
        branch_id = ?, is_active = ?, joining_date = ?, updated_at = NOW()
    WHERE id = ?
  `).run(
    codeVal,
    name !== undefined ? String(name).trim() : existing.name,
    email !== undefined ? String(email).trim() : existing.email,
    phone !== undefined ? String(phone).trim() : existing.phone,
    designation !== undefined ? String(designation).trim() : existing.designation,
    department !== undefined ? String(department).trim() : existing.department,
    branchId !== undefined ? branchId : existing.branch_id,
    activeVal,
    joiningDate !== undefined ? joiningDate : existing.joining_date,
    engId
  );

  return getEngineerById(engId);
}

// "Confirmed sales" can only come from confirmed Sale Reports, and that feature doesn't exist in
// this backend yet (separate, deferred migration). Rather than silently reporting 0 — which looks
// identical to "this engineer genuinely closed no sales" — this is always 0 here, paired with the
// `confirmed_sales_available: false` flag the frontend uses to show "not tracked yet" instead of a
// real zero.
function buildPerformanceEntry(eng, fy, quoteStats, targetRow) {
  const targetAmount = targetRow ? Number(targetRow.target_amount) : 0;
  const confirmedSalesValue = 0;
  const confirmedSalesCount = 0;
  const totalQuotedValue = Number(quoteStats?.total_quoted_value || 0);
  const totalQuotations = Number(quoteStats?.total_quotations || 0);
  const acceptedCount = Number(quoteStats?.accepted_count || 0);
  const acceptedValue = Number(quoteStats?.accepted_value || 0);

  let achievementPercent = 0;
  if (targetAmount > 0) achievementPercent = Number(((confirmedSalesValue / targetAmount) * 100).toFixed(1));

  const shortfallAmount = targetAmount > confirmedSalesValue ? targetAmount - confirmedSalesValue : 0;
  let status = 'NO_TARGET';
  if (targetAmount > 0) {
    if (confirmedSalesValue >= targetAmount) status = 'EXCEEDED';
    else if (confirmedSalesValue >= targetAmount * 0.7) status = 'ON_TRACK';
    else status = 'BEHIND';
  }

  return {
    engineer_id: eng.id,
    code: eng.code,
    employeeCode: eng.employee_code,
    name: eng.name,
    fiscal_year: fy,
    financial_year: fy,
    target_amount: targetAmount,
    quotation_count: totalQuotations,
    quoted_amount: totalQuotedValue,
    accepted_quotation_count: acceptedCount,
    accepted_quotation_amount: acceptedValue,
    confirmed_sales_count: confirmedSalesCount,
    confirmed_sales_amount: confirmedSalesValue,
    achievement_pct: achievementPercent,
    shortfall_amount: shortfallAmount,
    status,
  };
}

export async function getEngineerPerformance({ financialYear, branchId = null, engineerId = null, q = null } = {}) {
  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  let engSql = `SELECT id, employee_code AS code, employee_code, name, designation, department, branch_id FROM sales_engineer WHERE is_active = 1`;
  const engParams = [];
  if (branchId) {
    engSql += ` AND branch_id = ?`;
    engParams.push(branchId);
  }
  if (engineerId) {
    engSql += ` AND id = ?`;
    engParams.push(engineerId);
  }
  if (q) {
    engSql += ` AND (name ILIKE ? OR employee_code ILIKE ?)`;
    const s = `%${q}%`;
    engParams.push(s, s);
  }
  engSql += ` ORDER BY name ASC`;
  const engineers = await db.prepare(engSql).all(...engParams);

  const performanceList = [];
  for (const eng of engineers) {
    const quoteStats = await db.prepare(`
      SELECT COUNT(*) AS total_quotations,
             COALESCE(SUM(total), 0) AS total_quoted_value,
             SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
             COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) AS accepted_value
      FROM quotation WHERE sales_engineer_id = ?
    `).get(eng.id);

    const targetRow = await db.prepare(`
      SELECT target_amount FROM engineer_sales_targets
      WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?) LIMIT 1
    `).get(eng.id, fy, rawFy);

    performanceList.push(buildPerformanceEntry(eng, fy, quoteStats, targetRow));
  }

  const totalEngineers = performanceList.length;
  const totalTarget = performanceList.reduce((sum, item) => sum + (item.target_amount || 0), 0);
  const totalQuotedValue = performanceList.reduce((sum, item) => sum + item.quoted_amount, 0);
  const totalAccepted = performanceList.reduce((sum, item) => sum + item.accepted_quotation_amount, 0);
  const totalConfirmedSales = performanceList.reduce((sum, item) => sum + item.confirmed_sales_amount, 0);
  const overallAchievementPercent = totalTarget > 0 ? Number(((totalConfirmedSales / totalTarget) * 100).toFixed(1)) : 0;

  return {
    fiscal_year: fy,
    summary: {
      total_engineers: totalEngineers,
      total_target: totalTarget,
      total_quoted: totalQuotedValue,
      total_accepted: totalAccepted,
      total_confirmed: totalConfirmedSales,
      overall_achievement_pct: overallAchievementPercent,
      confirmed_sales_available: false,
    },
    engineers: performanceList,
  };
}

export async function setEngineerTarget({ engineer_id, engineerId, branchId = null, fiscal_year, financial_year, financialYear, target_amount, targetAmount, userId = null }) {
  const engId = Number(engineerId || engineer_id);
  const amount = Number(targetAmount !== undefined ? targetAmount : target_amount);
  const fy = normalizeFy(financialYear || financial_year || fiscal_year);

  if (!engId) throw new Error('Engineer ID is required');
  if (Number.isNaN(amount) || amount < 0) throw new Error('Target amount must be a non-negative number');

  const engineer = await db.prepare(`SELECT * FROM sales_engineer WHERE id = ?`).get(engId);
  if (!engineer) throw new Error('Sales Engineer not found');

  const targetBranchId = branchId || engineer.branch_id;
  const rawFy = fy.replace('FY ', '');

  const existing = await db.prepare(`
    SELECT id FROM engineer_sales_targets WHERE engineer_id = ? AND (financial_year = ? OR financial_year = ?)
  `).get(engId, fy, rawFy);

  if (existing) {
    await db.prepare(`UPDATE engineer_sales_targets SET target_amount = ?, financial_year = ?, updated_at = NOW() WHERE id = ?`)
      .run(amount, fy, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO engineer_sales_targets (engineer_id, branch_id, financial_year, target_amount, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(engId, targetBranchId, fy, amount, userId || null);
  }

  return { engineer_id: engId, fiscal_year: fy, financial_year: fy, target_amount: amount };
}

export async function getEngineerTargets({ financialYear, branchId = null, engineerId = null } = {}) {
  const fy = normalizeFy(financialYear);
  const rawFy = fy.replace('FY ', '');

  let sql = `
    SELECT t.id, t.engineer_id, t.branch_id, t.financial_year AS fiscal_year, t.financial_year,
           t.target_amount, t.created_at, t.updated_at, e.name AS engineer_name, e.employee_code AS code
    FROM engineer_sales_targets t
    JOIN sales_engineer e ON e.id = t.engineer_id
    WHERE (t.financial_year = ? OR t.financial_year = ?)
  `;
  const params = [fy, rawFy];
  if (branchId) {
    sql += ` AND t.branch_id = ?`;
    params.push(branchId);
  }
  if (engineerId) {
    sql += ` AND t.engineer_id = ?`;
    params.push(engineerId);
  }
  sql += ` ORDER BY e.name ASC`;
  return db.prepare(sql).all(...params);
}
```

- [ ] **Step 2: Syntax-check it**

Run: `node --check app/client/api/_lib/db/engineerService.js`

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add app/client/api/_lib/db/engineerService.js
git commit -m "feat: add engineer service ported from the legacy SQLite backend"
```

---

### Task 3: Backend routes + mounting

**Files:**
- Create: `app/client/api/_lib/routes/engineers.js`
- Modify: `app/api/index.js`

**Interfaces:**
- Consumes: every export from Task 2's `engineerService.js`.
- Produces: `GET/POST /api/engineers`, `GET/PUT /api/engineers/:id`, `GET/POST /api/engineers/targets`, `GET /api/engineers/performance` — exact paths and query/body field names the frontend (`src/api.ts`'s `engineers` object, already written) expects.

- [ ] **Step 1: Write the routes file**

Create `app/client/api/_lib/routes/engineers.js`. Note the frontend (`src/api.ts`) sends the fiscal year as `?year=` on GET requests — not `?financialYear=` like the old SQLite backend's routes — so these routes read `year` first:

```js
import { Router } from 'express';
import {
  getEngineers,
  getEngineerById,
  createEngineer,
  updateEngineer,
  getEngineerPerformance,
  setEngineerTarget,
  getEngineerTargets,
} from '../db/engineerService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { branchId, active, activeOnly, q, limit, offset } = req.query;
    const result = await getEngineers({
      branchId: branchId ? Number(branchId) : null,
      activeOnly: active === 'true' || activeOnly === 'true' || activeOnly === '1',
      q: q ? String(q).trim() : null,
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/performance', async (req, res) => {
  try {
    const { year, financialYear, branchId, engineerId, q } = req.query;
    const performance = await getEngineerPerformance({
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
      branchId: branchId ? Number(branchId) : null,
      engineerId: engineerId ? Number(engineerId) : null,
      q: q ? String(q).trim() : null,
    });
    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/targets', async (req, res) => {
  try {
    const { year, financialYear, branchId, engineerId } = req.query;
    const targets = await getEngineerTargets({
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
      branchId: branchId ? Number(branchId) : null,
      engineerId: engineerId ? Number(engineerId) : null,
    });
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/targets', async (req, res) => {
  try {
    const result = await setEngineerTarget({
      engineer_id: req.body.engineer_id,
      engineerId: req.body.engineerId,
      branchId: req.body.branch_id || req.body.branchId,
      fiscal_year: req.body.fiscal_year,
      financial_year: req.body.financial_year,
      financialYear: req.body.financialYear,
      target_amount: req.body.target_amount,
      targetAmount: req.body.targetAmount,
      userId: req.user?.id || null,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to set engineer target' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { year, financialYear } = req.query;
    const engineer = await getEngineerById(req.params.id, {
      financialYear: year ? String(year) : (financialYear ? String(financialYear) : 'FY 2026-27'),
    });
    if (!engineer) return res.status(404).json({ error: 'Sales Engineer not found' });
    res.json(engineer);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const engineer = await createEngineer(req.body);
    res.status(201).json(engineer);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create engineer' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const engineer = await updateEngineer(req.params.id, req.body);
    res.json(engineer);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update engineer' });
  }
});

export default router;
```

- [ ] **Step 2: Mount it in app/api/index.js**

In `app/api/index.js`, add the import alongside the other route imports:

```js
import engineersRouter from '../client/api/_lib/routes/engineers.js';
```

And mount it alongside the other `requireAuth`-gated routes (after the `opportunitiesRouter` line):

```js
app.use('/api/engineers', requireAuth, engineersRouter);
```

- [ ] **Step 3: Syntax-check both files**

Run: `node --check app/client/api/_lib/routes/engineers.js && node --check app/api/index.js`

Expected: no output (success).

- [ ] **Step 4: Restart the backend and verify the route responds**

The backend only reloads on file changes if it was started with `node --watch`. Check first:

Run (PowerShell): `Get-CimInstance Win32_Process -Filter "ProcessId=<pid from netstat -ano | findstr :4000>" | Select-Object CommandLine`

If it doesn't include `--watch`, stop it and restart with `cd app && npm run dev`.

Then verify:

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/engineers`

Expected: `401` (route exists, requires auth — same as `/api/companies`), not `404`.

- [ ] **Step 5: Commit**

```bash
git add app/client/api/_lib/routes/engineers.js app/api/index.js
git commit -m "feat: wire up /api/engineers routes on the Postgres backend"
```

---

### Task 4: Persist sales_engineer_id on quotations

**Files:**
- Modify: `app/client/api/_lib/routes/quotations.js:66-113` (POST, create), `app/client/api/_lib/routes/quotations.js:115-151` (PUT, update)

**Interfaces:**
- Consumes: `sales_engineer_id` from the request body — `QuotationNew.tsx` (frontend, already written) already sends this on every create/update call.

- [ ] **Step 1: Persist it on create**

In `app/client/api/_lib/routes/quotations.js`, the `POST /` handler currently destructures `const { company_id, date, items, tax_percent, notes, discount_type, discount_value } = req.body;` (line 66) and inserts into `quotation` without `sales_engineer_id` (lines 82-85). Change both:

```js
    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, sales_engineer_id } = req.body;
```

```js
      const info = await db
        .prepare(
          `INSERT INTO quotation (number, date, company_id, sales_engineer_id, status, subtotal, discount_type, discount_value, discount_percent, discount_amount, taxable_amount, tax_percent, tax_amount, round_off, total, notes, created_by_user_id)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(number, date || new Date().toISOString().slice(0, 10), company_id, sales_engineer_id || null, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxPercent, taxAmount, roundOff, total, notes || '', req.user.id);
```

- [ ] **Step 2: Persist it on update**

The `PUT /:id` handler currently destructures `const { company_id, date, items, tax_percent, notes, discount_type, discount_value } = req.body;` (line 121) and updates `quotation` without `sales_engineer_id` (lines 131-135). Change both:

```js
    const { company_id, date, items, tax_percent, notes, discount_type, discount_value, sales_engineer_id } = req.body;
```

```js
      await db
        .prepare(
          `UPDATE quotation SET company_id = ?, sales_engineer_id = ?, date = ?, subtotal = ?, discount_type = ?, discount_value = ?, discount_percent = ?, discount_amount = ?, taxable_amount = ?, tax_percent = ?, tax_amount = ?, round_off = ?, total = ?, notes = ? WHERE id = ?`
        )
        .run(company_id || existing.company_id, sales_engineer_id !== undefined ? (sales_engineer_id || null) : existing.sales_engineer_id, date || existing.date, subtotal, discountType, discountValue, discountPercent, discountAmount, taxableAmount, taxPercent, taxAmount, roundOff, total, notes ?? existing.notes, req.params.id);
```

- [ ] **Step 3: Syntax-check**

Run: `node --check app/client/api/_lib/routes/quotations.js`

Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add app/client/api/_lib/routes/quotations.js
git commit -m "feat: persist sales_engineer_id when creating or updating a quotation"
```

---

### Task 5: Frontend — distinguish "not tracked yet" from a real zero

**Files:**
- Modify: `app/client/src/api.ts:306-317` (add `confirmed_sales_available` to the `EngineerPerformanceSummary` type)
- Modify: `app/client/src/pages/EngineerSalesReport.tsx:76-81,95-96,106,148` (Confirmed Sales KPI card, table header, table cell)
- Modify: `app/client/src/pages/EngineerList.tsx` (same treatment — find via the earlier `confirmed_sales_amount` grep hits)

**Interfaces:**
- Consumes: `confirmed_sales_available: boolean` on `EngineerPerformanceSummary.summary`, produced by Task 2/3's `/api/engineers/performance` response.

- [ ] **Step 1: Add the field to the TypeScript type**

In `app/client/src/api.ts`, extend `EngineerPerformanceSummary`:

```ts
export interface EngineerPerformanceSummary {
  fiscal_year: string;
  summary: {
    total_engineers: number;
    total_target: number;
    total_quoted: number;
    total_accepted: number;
    total_confirmed: number;
    overall_achievement_pct: number;
    confirmed_sales_available: boolean;
  };
  engineers: EngineerPerformance[];
}
```

- [ ] **Step 2: Update EngineerSalesReport.tsx**

Replace the "Confirmed Sales Achieved" KPI card (lines 76-81):

```tsx
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Confirmed Sales Achieved</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="text-2xl font-bold text-[#2FBF71] mt-1 block font-mono">
                ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
              </span>
            ) : (
              <span className="text-sm font-semibold text-[#A8AEC4] mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                Not tracked yet
              </span>
            )}
          </div>
```

Add a notice under the section header (after line 96's `<span className="text-xs font-mono text-[#7A839E]">{fiscalYear}</span>`, still inside that flex row's parent `div`, as a new line below it):

```tsx
        {performance && !performance.summary.confirmed_sales_available && (
          <p className="px-4 pb-3 text-xs text-[#A8AEC4]">
            Confirmed sales figures require the Sale Reports feature, which isn't available yet — quoted and accepted quotation values below are accurate.
          </p>
        )}
```

Replace the table cell rendering confirmed sales (line 148, inside the engineer row mapping):

```tsx
                      <td className="px-4 py-3 text-right font-mono text-[#141B34]">
                        {performance?.summary.confirmed_sales_available ? `₹${eng.confirmed_sales_amount.toLocaleString('en-IN')}` : '—'}
                      </td>
```

- [ ] **Step 3: Update EngineerList.tsx with the same treatment**

Apply the equivalent change at `src/pages/EngineerList.tsx`'s "Confirmed Sales" KPI card and table cell (found via the `confirmed_sales_amount`/`confirmedVal` references from the earlier grep) — same pattern: check `performance.summary.confirmed_sales_available`, show `'Not tracked yet'` / `'—'` instead of a `₹0`-rendering real value when `false`.

- [ ] **Step 4: Type-check**

Run: `cd app/client && npx tsc --noEmit -p tsconfig.json`

Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add app/client/src/api.ts app/client/src/pages/EngineerSalesReport.tsx app/client/src/pages/EngineerList.tsx
git commit -m "fix: show confirmed sales as not-yet-tracked instead of a misleading zero"
```

---

### Task 6: End-to-end verification

**Files:**
- Test only — no production files created.

- [ ] **Step 1: Write and run a live verification script**

Create `app/client/scripts/_verify_engineers_e2e.mjs`:

```js
process.env.DATABASE_URL = process.env.DATABASE_URL; // must already be set in the shell
const { createEngineer, setEngineerTarget, getEngineerPerformance } = await import('../api/_lib/db/engineerService.js');
const db = (await import('../api/_lib/db/index.js')).default;

// Clean slate for repeatable runs
await db.pool.query(`DELETE FROM engineer_sales_targets`);
await db.pool.query(`DELETE FROM quotation WHERE number LIKE 'TEST-ENG-%'`);
await db.pool.query(`DELETE FROM sales_engineer WHERE employee_code = 'ENG-TEST-1'`);

const eng = await createEngineer({ code: 'ENG-TEST-1', name: 'Test Engineer', email: 't@example.com' });
console.log('created engineer:', JSON.stringify(eng.id), eng.name);

await setEngineerTarget({ engineer_id: eng.id, fiscal_year: '2026-27', target_amount: 100000 });

// Simulate what quotations.js now does: a quotation tagged with this engineer.
const company = (await db.pool.query(`SELECT id FROM company LIMIT 1`)).rows[0];
if (!company) throw new Error('Need at least one company row to test against — create one first.');
await db.pool.query(
  `INSERT INTO quotation (number, date, company_id, sales_engineer_id, status, subtotal, tax_percent, tax_amount, total, created_by_user_id)
   VALUES ('TEST-ENG-1', CURRENT_DATE, $1, $2, 'accepted', 50000, 18, 9000, 59000, (SELECT id FROM app_user LIMIT 1))`,
  [company.id, eng.id]
);

const perf = await getEngineerPerformance({ financialYear: '2026-27' });
const row = perf.engineers.find((e) => e.engineer_id === eng.id);
console.log('performance row:', JSON.stringify(row));
console.log('confirmed_sales_available:', perf.summary.confirmed_sales_available);

const checks = [
  ['target_amount is 100000', row.target_amount === 100000],
  ['quoted_amount is 59000', row.quoted_amount === 59000],
  ['accepted_quotation_amount is 59000', row.accepted_quotation_amount === 59000],
  ['confirmed_sales_amount is 0', row.confirmed_sales_amount === 0],
  ['confirmed_sales_available is false', perf.summary.confirmed_sales_available === false],
];
for (const [label, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', '-', label);

// cleanup
await db.pool.query(`DELETE FROM quotation WHERE number = 'TEST-ENG-1'`);
await db.pool.query(`DELETE FROM engineer_sales_targets WHERE engineer_id = $1`, [eng.id]);
await db.pool.query(`DELETE FROM sales_engineer WHERE id = $1`, [eng.id]);
await db.pool.end();
```

Run: `node app/client/scripts/_verify_engineers_e2e.mjs` (with `DATABASE_URL` set in the shell to the real connection string).

Expected: all five lines print `PASS`.

- [ ] **Step 2: Manual walkthrough**

With the backend restarted (Task 3, Step 4) and frontend dev server running:
1. Navigate to Sales Engineers (sidebar) — create an engineer, set a target for FY 2026-27.
2. Create a new quotation, pick that engineer from the Sales Engineer dropdown (now populated — it was empty before because `/api/engineers` 404'd), save it, then mark it Accepted.
3. Revisit Sales Engineers / Engineer Sales Report — confirm the quoted/accepted figures reflect that quotation, and the "Confirmed Sales" card reads "Not tracked yet" rather than ₹0.

- [ ] **Step 3: Delete the verification script**

```bash
rm app/client/scripts/_verify_engineers_e2e.mjs
```

(Nothing to commit — this step produces no tracked file changes.)

---

## Self-Review Notes

- **Spec coverage:** engineer CRUD (Task 2/3), annual targets (Task 2/3), quoted/accepted performance tied to real quotations (Task 4), confirmed-sales honesty constraint (Task 2 + Task 5), schema (Task 1), end-to-end proof (Task 6). No requirement from the brainstorming discussion is left uncovered.
- **No placeholders:** every step has runnable code or an exact command; no "add validation" or "similar to Task N" shortcuts.
- **Type consistency:** `engineerService.js` function names/signatures in Task 2 match exactly what Task 3's routes import; `confirmed_sales_available` is spelled identically in Task 2's service output, Task 5's TypeScript type, and Task 5's component reads.
