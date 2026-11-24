# Security checklist for the Technicon Services ERP

What the code already does, and the steps only the account owner can do.

## Already in the code
- Every API route needs a signed-in session, except `/api/health`, `/api/auth/*` and the live Excel feed (private hashed key, rate limited).
- Admin routes (`/api/admin/*`) need the admin role.
- Passwords are stored with scrypt. New passwords are 8-128 characters.
- Login: 5 wrong passwords lock the account for 15 minutes (needs migration `018_login_lockout.sql`); one address is limited to 30 failed attempts per 10 minutes.
- CORS: in production no other website may call the API unless `CLIENT_ORIGIN` names it.
- Errors sent to the browser are generic; details stay in the server log.
- HSTS and `Permissions-Policy` headers are sent.
- Secrets live only in Vercel environment variables (`DATABASE_URL`, `ANTHROPIC_API_KEY`, ...). `.env` files are git-ignored.

## Your steps
1. **Two-factor sign-in** on GitHub (Settings > Password and authentication), Vercel (Account Settings > Authentication) and Supabase (Account > Security).
2. **Run migration 018** in the Supabase SQL Editor (the login lock).
3. **Check row level security** in the Supabase SQL Editor. This should return no rows:
   ```sql
   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
   ```
4. **Before each deploy:** `npm --prefix app/client audit --omit=dev` and fix anything critical or high with `npm audit fix` (not `--force`).
5. **Backups:** see `BACKUPS.md`.
6. If `CLIENT_ORIGIN` is set in Vercel, it must be exactly the address people open the ERP at.
