# Security checklist for the Technicon Services ERP

What the code already does, and the steps only the account owner can do.

## Already in the code
- Every API route needs a signed-in session, except `/api/health`, `/api/auth/*` and the live Excel feed (private hashed key, rate limited).
- Admin routes (`/api/admin/*`) need the admin role. So do all deletes (stock, warehouses, receipts, sale reports, firms, branches, purchase orders), the stock Excel overwrite import, and changes to settings, firms, branches and sales engineers. Staff keep the daily work (quotations, follow-ups, stock inward, invoices, new POs). A test (`adminOnly.test.mjs`) fails if one of these routes loses its guard.
- Passwords are stored with scrypt. New passwords are 8-128 characters.
- Login: 5 wrong passwords lock the account for 15 minutes (needs migration `018_login_lockout.sql`); one address is limited to 30 failed attempts per 10 minutes.
- CORS: in production no other website may call the API unless `CLIENT_ORIGIN` names it.
- Errors sent to the browser are generic; details stay in the server log.
- HSTS and `Permissions-Policy` headers are sent.
- Secrets live only in Vercel environment variables (`DATABASE_URL`, `ANTHROPIC_API_KEY`, ...). `.env` files are git-ignored.

## Your steps
1. **Two-factor sign-in** on GitHub (Settings > Password and authentication), Vercel (Account Settings > Authentication) and Supabase (Account > Security).
2. **Run migration 018** in the Supabase SQL Editor (the login lock).
3. **Run migration 020** (`app/client/api/_lib/db/migrations/020_enable_rls_all_tables.sql`) in the Supabase SQL Editor. Supabase's security advisor reports "RLS Disabled in Public" for the older tables (including `app_user` and `session`); the migration turns RLS on for every table and removes the API roles' access. The ERP is not affected because it connects directly as the table owner. Afterwards check that this returns no rows:
   ```sql
   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
   ```
4. **Before each deploy:** `npm --prefix app/client audit --omit=dev` and fix anything critical or high with `npm audit fix` (not `--force`).
5. **Backups:** the Supabase Free plan has none. Set up the nightly SharePoint copy (`docs/sharepoint-backup-setup.md`) and consider the Pro plan; see `BACKUPS.md`. The backup files are not encrypted, so keep the SharePoint site private and never store a dump as a GitHub artifact (this repository is public).
6. If `CLIENT_ORIGIN` is set in Vercel, it must be exactly the address people open the ERP at.
