# Postgres Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the already-Postgres-ready backend actually connected to a real Postgres database (Supabase), in both local dev and Vercel production, and stop local dev from silently falling back to the legacy SQLite backend.

**Architecture:** No query-layer or route code changes. This is: (a) two small changes to the local dev bootstrap (`app/api/local-dev.js`) — load `.env`, and require `DATABASE_URL` instead of falling back to SQLite; (b) provisioning steps against an existing paused Supabase project (unpause, apply `schema.sql`); (c) environment variable wiring in `app/client/.env` (local) and Vercel project settings (production).

**Tech Stack:** Node.js (ESM), Express, `pg` (already wired in `app/client/api/_lib/db/index.js`), `dotenv`, Supabase (Postgres 17), Vercel.

## Global Constraints

- No changes to `app/client/api/_lib/db/index.js` (query wrapper), any `routes/*.js`, or `db/schema.sql` — that layer is already correct for Postgres (per spec `docs/superpowers/specs/2026-09-26-postgres-migration-design.md`).
- No data migration — starting fresh, confirmed with user.
- Local dev and production share **one** Supabase database — confirmed with user.
- Reuse the existing Supabase project (ref `uvakxcznypwbkqgisuqi`, region `ap-south-1`), do not create a new one.
- Do not delete `app/server` (Fly.io/SQLite) or remove the `better-sqlite3` dependency from `app/package.json` — out of scope for this plan (confirmed with user), even though it becomes unused after Task 2.
- `app/` and `app/client/` each have their own `node_modules` (no npm workspaces) — dependency additions must go in the right `package.json`.

---

### Task 1: Stop the SQLite fallback and load `.env` in local dev

**Files:**
- Modify: `app/api/local-dev.js`
- Modify: `app/package.json` (add `dotenv` dependency)
- Modify: `app/client/.env.example` (document `DATABASE_URL`)

**Interfaces:**
- Produces: `app/api/local-dev.js` now requires `process.env.DATABASE_URL` to be set (reading it from `app/client/.env` via `dotenv`) and exits with a clear error if it's missing, instead of silently importing `../server/src/app.js`.

- [x] **Step 1: Add `dotenv` to `app/package.json`**

Edit `app/package.json` — add `"dotenv": "^16.4.5"` to `dependencies` (matches the version already used in `app/client/package.json`):

```json
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "exceljs": "^4.4.0",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "pdfkit": "^0.15.0",
    "pg": "^8.23.0"
  },
```

- [x] **Step 2: Install it**

Run (from `app/`): `npm install`
Expected: adds `dotenv` to `node_modules` and `package-lock.json`, no errors.

- [x] **Step 3: Rewrite `app/api/local-dev.js`**

Replace the whole file with:

```js
// Runs the local backend Express app locally with a plain `.listen()`,
// so the app can be tested manually without needing external services.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../client/.env') });

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Add it to app/client/.env (copy app/client/.env.example) — ' +
      'point it at your Postgres connection string.'
  );
  process.exit(1);
}

const app = (await import('./index.js')).default;

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`TECHNICON API listening on http://localhost:${PORT}`));
```

This removes the `try { import('./index.js') } catch { import('../server/src/app.js') }` fallback
entirely — there is now exactly one code path, and it requires Postgres.

- [x] **Step 4: Verify the failure mode**

Run (from `app/`, with no `.env` file present yet and no `DATABASE_URL` exported):
`node api/local-dev.js`
Expected: prints the `DATABASE_URL is not set...` message and exits (non-zero), does **not** start
a server and does **not** touch `../server/src/app.js`.

- [x] **Step 5: Document `DATABASE_URL` in `.env.example`**

Edit `app/client/.env.example`, add at the end:

```
# Server-side only. Required to run the API at all — local dev (app/api/local-dev.js reads this
# file directly) and in Vercel production (set as a project Environment Variable there instead).
# Postgres connection string. For Supabase, use the "Transaction pooler" connection string
# (port 6543) from Project Settings > Database > Connection string.
DATABASE_URL=
```

- [ ] **Step 6: Commit** (user will commit/push these changes themselves)

```bash
git add app/package.json app/package-lock.json app/api/local-dev.js app/client/.env.example
git commit -m "$(cat <<'EOF'
feat: require Postgres in local dev, remove SQLite fallback

local-dev.js silently imported the legacy SQLite backend whenever
DATABASE_URL was unset. Load it from app/client/.env via dotenv instead,
and fail loudly if it's missing, so local dev always exercises the same
Postgres-backed code path as production.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Unpause the Supabase project and collect connection strings

**This task has no code — it's manual, performed by the user in the Supabase dashboard, because it
requires a password/secret that shouldn't need to pass through the assistant.**

> **Deviation from plan:** the user used a different, already-active project than the one found
> during design (ref `cihuudfplqsbpnvntuym`, region `ap-south-1`, not `uvakxcznypwbkqgisuqi` — that
> one belongs to a different Supabase login than the CLI here is authenticated as). No unpausing was
> needed. The **direct** connection host (`db.cihuudfplqsbpnvntuym.supabase.co:5432`) resolves to an
> IPv6-only address, which this network can't reach (`getaddrinfo ENOTFOUND`) — worked around by using
> the **Transaction pooler** connection for schema setup too (Task 3), not just Tasks 4/5.

- [x] **Step 1: Open the project** — done (existing active project, no restore needed).

- [x] **Step 2: Get (or reset) the database password** — done.

- [x] **Step 3: Copy both connection strings** — done. Pooler:
  `postgresql://postgres.cihuudfplqsbpnvntuym:***@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
  (direct string obtained but unusable from this network — see deviation note above).

- [x] **Step 4: Hand off** — user pasted both strings in chat.

---

### Task 3: Apply the schema to the Supabase database

**Files:**
- Uses (unchanged): `app/client/scripts/setup-db.js`, `app/client/api/_lib/db/schema.sql`

**Interfaces:**
- Consumes: the pooler connection string from Task 2 (direct connection was unreachable — see Task 2
  deviation note).
- Produces: all tables from `schema.sql` created in the Supabase database (idempotent —
  `CREATE TABLE IF NOT EXISTS`, safe to re-run).

- [x] **Step 1: Run the schema script** — ran against the pooler connection instead of direct
  (direct host is IPv6-only, unreachable from this network):

```bash
DATABASE_URL="postgresql://postgres.cihuudfplqsbpnvntuym:***@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres" npm run setup-db
```

Output: `Connected. Running schema...` then `Schema applied successfully.` ✓

- [x] **Step 2: Verify tables exist** — confirmed indirectly via Task 4 (`/api/auth/me` correctly
  queried the empty `app_user` table and returned `{"needsSetup":true}`).

- [x] **Step 3: No commit needed** — n/a, remote-only change.

---

### Task 4: Local dev end-to-end

**Files:**
- Create (not committed — gitignored): `app/client/.env`

**Interfaces:**
- Consumes: `app/api/local-dev.js` from Task 1 (reads `app/client/.env`), the pooled connection
  string from Task 2.

- [x] **Step 1: Create `app/client/.env`** — created with the pooler `DATABASE_URL`, confirmed
  gitignored (`git check-ignore -v` confirms `app/client/.gitignore` covers it).

- [x] **Step 2: Start the API** — running in background (task `bt01svken`); log shows
  `TECHNICON API listening on http://localhost:4000`, no SQLite fallback triggered.

- [x] **Step 3: Confirm the health endpoint** — `curl http://localhost:4000/api/health` →
  `{"ok":true}`; also confirmed `/api/auth/me` → `{"needsSetup":true}` (proves the Postgres query
  path itself works, not just that the process is up).

- [x] **Step 4: Start the frontend** — `npm install` completed (517 packages), Vite running in
  background (task `b9rd2xspf`) on `http://localhost:5173`; confirmed its `/api` proxy reaches the
  backend (`curl http://localhost:5173/api/auth/me` → `{"needsSetup":true}`).

- [x] **Step 5: Manual walkthrough** — user confirmed working: Setup → admin account created →
  dashboard → refresh stays logged in → logout/login all work.

- [x] **Step 6: No commit needed** — n/a, `.env` is gitignored.

---

### Task 5: Production (Vercel) wiring

**Files:** none in the repo — Vercel project configuration only.

**Interfaces:**
- Consumes: the pooled connection string from Task 2 (same value as Task 4's `.env`).

- [ ] **Step 1: Add the environment variable**

In the Vercel dashboard, open this project → **Settings → Environment Variables**. Add:
- Key: `DATABASE_URL`
- Value: the same pooled (port 6543) connection string used in Task 4
- Environment: Production (add to Preview too if you want preview deployments to work against the
  same database)

- [ ] **Step 2: Redeploy**

Trigger a new deployment (push any commit, e.g. this plan's Task 1 commit if not already pushed, or
use **Redeploy** on the latest deployment in the Vercel dashboard) so the new env var takes effect.

- [ ] **Step 3: Verify production health**

`curl https://<your-vercel-domain>/api/health`
Expected: `{"ok":true}` (replace `<your-vercel-domain>` with your actual deployment domain).

- [ ] **Step 4: Manual walkthrough in production**

Visit the production URL in a browser and repeat Task 4 Step 5 (Setup → create admin → dashboard →
refresh stays logged in → logout/login) against production.

- [ ] **Step 5: No commit needed**

Environment variables live in Vercel's project settings, not the repo.

---

## Self-review notes

- **Spec coverage:** all 6 steps from the design spec map onto tasks above — unpause+strings (Task 2),
  apply schema (Task 3), local `.env`/dotenv load (Tasks 1 & 4), remove SQLite fallback (Task 1),
  production env var (Task 5), verification (Tasks 4 & 5). Out-of-scope items (Fly.io/`better-sqlite3`
  cleanup, data migration) are not touched, matching the spec.
- **Placeholders:** `[PASSWORD]` and `<pooler-host>`/`<your-vercel-domain>` are intentional — real
  secrets/domains can't be known ahead of Task 2, and shouldn't be hardcoded into a committed plan
  file. Every other step has concrete, runnable content.
- **Type/signature consistency:** n/a — no new functions or shared interfaces are introduced between
  tasks beyond the `DATABASE_URL` environment variable, used identically in Tasks 3, 4, and 5.
