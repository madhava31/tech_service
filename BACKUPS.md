# Backups

The data (quotations, POs, stock, customers) lives only in the Supabase Postgres database. Code can be rolled back from git; deleted data cannot.

## 1. What Supabase keeps for you
Open the Supabase dashboard > Database > Backups.
- **Free plan:** no automatic daily backups. Take a manual backup (section 2) on a schedule.
- **Pro plan:** a daily backup, kept for 7 days. Restore from the same page.
Check which plan this project is on and write the answer here: ________

## 2. A manual backup you control
Needs the Postgres client tools (`pg_dump`). Use the **direct** connection string from Supabase > Project Settings > Database (port 5432), not the 6543 pooler.

```powershell
pg_dump "postgresql://postgres:PASSWORD@HOST:5432/postgres" --no-owner --format=custom --file "technicon-backup-$(Get-Date -Format yyyy-MM-dd).dump"
```
Keep the file somewhere other than this computer (cloud drive). Do the same before running any new migration.

## 3. Restoring
```powershell
pg_restore --no-owner --clean --if-exists --dbname "postgresql://postgres:PASSWORD@HOST:5432/postgres" technicon-backup-YYYY-MM-DD.dump
```
Try a restore once into a spare Supabase project, so you know it works before you need it.
