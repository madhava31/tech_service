# Technicon Services

ERP for quotations, purchase orders, companies, products, and sales follow-up. The React app lives in `app/client`. Two backends exist:

| Backend | Database | When to use it |
|---|---|---|
| `app/server` | Local SQLite file `app/server/data/technicon.db` | Local testing. This is what the PE Funnel load uses. |
| `app/api` (`local-dev.js`) | Postgres via `DATABASE_URL` in `app/client/.env` (Supabase in production) | Hosted or shared database. Do not start this if you want to stay on the local file. |

The Vite dev server proxies `/api` to `http://localhost:4000`. Whichever backend is listening on port 4000 is the one the website uses.

## Run locally on SQLite

Use Node.js 22. From a fresh clone the SQLite file is created on first start.

```powershell
cd app/server
npm install
npm start
```

In a second terminal:

```powershell
cd app/client
npm install
npm run dev
```

Open http://127.0.0.1:5173. The first visit asks you to create an admin account when the `user` table is empty. After that, sign in with that account.

`app/client/.env` and `*.db` are gitignored. The connection string and the loaded database are not in git.

## PE Funnel workbook (local only)

On 7 November 2026 the workbook `PE Funnel-26 (2).xlsx` was loaded into the local SQLite database so the website shows that funnel instead of the seeded sample engineers. Supabase was not modified.

Full mapping, counts, and re-run steps: [docs/local-pe-funnel-import.md](docs/local-pe-funnel-import.md).

```powershell
cd app/server
npm run import:funnel -- "C:\path\to\PE Funnel-26 (2).xlsx"
```

Then start `app/server` (not `app/api/local-dev.js`) and the Vite app as above.

## What the load produced

These counts are from the local file after the import. They are not in Supabase.

| | |
|---|---|
| Companies | 375 |
| Products | 861 |
| Quotations | 890 (481 sent, 404 accepted, 5 rejected) |
| Quotation lines | 2,304 |
| Purchase orders | 403 |
| Sales people | 12 from the workbook |
| Follow-ups | 254 |
| Quoted value | ₹24,54,24,185.75 |

Quotations keep the workbook numbers (`TSQOT2526/747` and similar). Customer PO numbers are stored on the purchase order as `client_po_ref`. The app’s own PO numbers look like `PO/2526/0001`.

The quotation list defaults to all dates. The dashboard’s default range is Oct 2025–Sep 2026, so October 2026 quotes appear under **This Year** or **All Time**.

## Production database

Production and `app/api/local-dev.js` use Postgres. See `docs/superpowers/plans/2026-09-26-postgres-migration.md`. That database was not part of the funnel load. Set `DATABASE_URL` only in `app/client/.env` or in the host’s environment variables. Never commit it.
