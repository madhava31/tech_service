# Backups

The data (quotations, POs, stock, customers) lives only in the Supabase Postgres database. Code can be rolled back from git; deleted data cannot.

## 1. What Supabase keeps for you
Open the Supabase dashboard > Database > Backups.
- **Free plan:** no automatic backups at all (this project is on the Free plan). Use section 2.
- **Pro plan:** a daily backup, kept for up to 7 days. Restore from the same page. Recommended for live client data.
Check which plan this project is on and write the answer here: ________

## 2. Automatic nightly copy to the client's SharePoint
A GitHub workflow (`.github/workflows/nightly-backup.yml`) runs `pg_dump` every night at 02:00 IST and saves the file in the client's SharePoint
(`Documents / Technicon-ERP-Backups / <year>`). Nothing is deleted, so the full history is kept. It works on the Free and the Pro plan, and
does not replace Supabase's own backups. Setup (about 25 minutes, once): `docs/sharepoint-backup-setup.md`.

The files are not encrypted: keep the SharePoint site private to the admins.

## 2b. Download data backup (Excel), in the ERP
Admin > **Data & Backups** > **Download Backup (Excel)** gives every table in one Excel file (one sheet per table, a README sheet with the row counts).
Passwords, login sessions and API keys are left out. It is a readable copy to keep or hand to the client; it is **not** a restorable database backup.
Admin only; one download at a time, and a 20-second pause between downloads.

## 3. A manual backup you control
Needs the Postgres client tools (`pg_dump`). Use the **direct** connection string from Supabase > Project Settings > Database (port 5432), not the 6543 pooler.

```powershell
pg_dump "postgresql://postgres:PASSWORD@HOST:5432/postgres" --schema=public --no-owner --no-acl --format=custom --file "technicon-backup-$(Get-Date -Format yyyy-MM-dd).dump"
```
Keep the file somewhere other than this computer (OneDrive folder). Do the same before running any new migration.

## 4. Restoring
```powershell
pg_restore --no-owner --clean --if-exists --dbname "postgresql://postgres:PASSWORD@HOST:5432/postgres" technicon-backup-YYYY-MM-DD.dump
```
The backup leaves out access rights (`--no-acl`), so afterwards run `020_enable_rls_all_tables.sql` in the Supabase SQL Editor (safe to repeat) and check that
`select tablename from pg_tables where schemaname = 'public' and not rowsecurity;` returns no rows.

Try a restore once into a spare Supabase project, so you know it works before you need it.
