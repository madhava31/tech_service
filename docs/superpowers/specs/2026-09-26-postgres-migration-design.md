# Postgres Migration — Design Spec

## Context

This is sub-project 1 of 3 the user asked for in one request:
1. **Migrate SQLite → Postgres** (this spec)
2. Full feature audit — verify every feature in the CRM works
3. Aurora UI rebuild (see `docs/aurora-ui-rebuild-plan.md`)

Agreed order: Postgres first, then the feature audit (against the real Postgres-backed app), then the UI rebuild last.

## Current state (as found)

The app has two backend deployments:
- **Live: Vercel** — `app/api/index.js` (thin Express entrypoint) importing routers from
  `app/client/api/_lib/**`. This backend is **already written for Postgres**: `db/index.js` uses
  `pg.Pool` with an async `prepare().get/all/run()` wrapper that rewrites `?` placeholders to
  `$1..$n`; `db/schema.sql` is Postgres dialect (`SERIAL`, `TIMESTAMP`, `DOUBLE PRECISION`); there is
  a `scripts/setup-db.js` that applies that schema to any `DATABASE_URL`.
- **Legacy/dead: Fly.io** — `app/server/src/**`, still `better-sqlite3`. Confirmed by the user to hold
  no real data and to be out of scope (ignore, do not migrate its data).

**The actual gap is not code — it's that `DATABASE_URL` is not configured anywhere:**
- In production, every DB call throws `DATABASE_URL is not set` (site is effectively non-functional).
- Locally, `app/api/local-dev.js` has a fallback: if `DATABASE_URL` is unset, it silently imports and
  runs the old SQLite `app/server/src/app.js` instead. This is almost certainly why the app has
  appeared to still be "on SQLite."

The user confirmed: no existing production data needs to be migrated (starting fresh), and to reuse
an existing paused Supabase project already on their account (ref `uvakxcznypwbkqgisuqi`,
region `ap-south-1`, Postgres 17) rather than create a new one.

## Non-negotiable invariant

No changes to query logic, route handlers, or the `db/index.js` query wrapper — that layer is already
correct for Postgres. This work is connection/config plumbing plus removing the SQLite fallback path,
not a rewrite.

## Plan

1. **Unpause the existing Supabase project** (`uvakxcznypwbkqgisuqi`) via the Supabase dashboard, and
   retrieve its two connection strings: the **direct** connection (port 5432) and the **pooled /
   transaction-mode** connection (port 6543, Supavisor).
2. **Apply schema:** run `npm run setup-db` (`app/client/scripts/setup-db.js`) with `DATABASE_URL` set
   to the **direct** connection string, to create all tables from `db/schema.sql` on the fresh database.
3. **Local dev config:**
   - Create `app/client/.env` (already gitignored) with `DATABASE_URL=<pooled connection string>`.
   - Add a `dotenv` load at the top of `app/api/local-dev.js` (or wherever the process boots) — `dotenv`
     is already an `app/client` dependency but nothing currently calls `.config()`, so today
     `DATABASE_URL` only works if exported manually in the shell each session.
4. **Remove the SQLite fallback** in `app/api/local-dev.js`: today it does
   `try { import('./index.js') } catch { import('../server/src/app.js') }` when `DATABASE_URL` is unset;
   change this so local dev always boots the Postgres-backed `app/api/index.js` app, and fails loudly
   (clear error) if `DATABASE_URL` is missing, rather than silently falling back to SQLite.
5. **Production config:** set the **pooled** connection string as the `DATABASE_URL` environment
   variable in the Vercel project settings, then redeploy.
6. **Verification:**
   - `GET /api/health` returns `{ ok: true }` in both local dev and production.
   - Load the site: `/` redirects to Setup (since `app_user` table is empty) → create the first admin
     account → redirected into the dashboard (empty-state widgets, since there's no data yet — expected).
   - Confirm login persists across a page refresh (session cookie + `/api/auth/me`).

## Explicitly out of scope for this spec

- Deleting `app/server` (Fly.io/SQLite) and the unused `better-sqlite3` dependency in root
  `app/package.json`. Confirmed inert once the fallback in step 4 is removed; left as optional
  cleanup, not required for correctness. Not actioned without separate confirmation.
- Any data migration (none needed — starting fresh per user confirmation).
- Any change to `db/schema.sql` or query logic.
- Sub-projects 2 (feature audit) and 3 (Aurora UI rebuild) — separate specs/plans after this lands.

## Testing / done criteria

- `npm run setup-db` completes without error against the Supabase database.
- Local `npm run dev` (root `app/`) boots the Postgres-backed API (no SQLite fallback), reachable at
  `http://localhost:4000/api/health`.
- Vite dev server (`app/client`) proxies through to it; Setup → login → dashboard flow works end to end
  locally.
- Vercel production deployment: same Setup → login → dashboard flow works end to end against the same
  Supabase database. Confirmed with the user: local dev and production share one database (no
  separate dev/prod split) — simplest given there's no existing data to keep isolated.
