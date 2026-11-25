# Nightly database backup to SharePoint: setup

Every night at 02:00 IST a GitHub workflow copies the whole ERP database (`pg_dump`) and saves the file in the client's
SharePoint site, in `Documents / Technicon-ERP-Backups / <year>`. Nothing is ever deleted, so the folder keeps the full history.

Two people do the setup: a **Microsoft 365 admin** (Part A) and **you**, who own the GitHub repository and Supabase (Part B).

> The backup files are **not encrypted**. They contain all customer data and the password hashes. Keep the SharePoint
> site private: members = the admins only.

---

## Part A. Microsoft 365 admin (about 15 minutes, once)

### A1. A private SharePoint site
1. Open https://admin.microsoft.com > **Show all > SharePoint** > **Sites > Active sites > Create**.
2. **Team site**, name **Technicon Backups**, privacy **Private**. Owners/members: only the admins who may see backups.
3. Note the site address, for example `https://contoso.sharepoint.com/sites/TechniconBackups`.
   The setting you will need is the short form: `contoso.sharepoint.com:/sites/TechniconBackups`.

### A2. An app registration just for backups
(Do not reuse the email app: each one gets only the permission it needs.)
1. https://entra.microsoft.com > **Identity > Applications > App registrations > New registration**.
   Name `Technicon ERP backup`, "this organizational directory only", no redirect URI > **Register**.
2. Copy **Application (client) ID** and **Directory (tenant) ID**.
3. **API permissions > Add a permission > Microsoft Graph > Application permissions**, search **Sites.Selected**, tick it,
   **Add permissions**, then **Grant admin consent** (green tick).
4. **Certificates & secrets > New client secret**, description `GitHub backup`, 24 months. Copy the **Value** now
   (shown once). Put a calendar reminder 23 months from today: **Renew the backup secret**, or the backups stop.

### A3. Let that app write to the one site only
`Sites.Selected` gives the app access to **nothing** until the site is granted.
1. Find the site id. In a browser, signed in as an admin, open
   `https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/TechniconBackups` (Graph Explorer:
   https://developer.microsoft.com/graph/graph-explorer) and copy the `id` value.
2. In Graph Explorer (signed in as an admin, permission `Sites.FullControl.All` consented) send:

   `POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions`
   ```json
   {
     "roles": ["write"],
     "grantedToIdentities": [
       { "application": { "id": "<Application (client) ID>", "displayName": "Technicon ERP backup" } }
     ]
   }
   ```
   A `201 Created` answer means it worked.

---

## Part B. You (about 10 minutes, once)

### B1. The database connection string for backups
Supabase > **Connect** > **Session pooler** (port **5432**, host like `aws-0-...pooler.supabase.com`, user `postgres.<project-ref>`).
Use the **session** pooler. The direct connection does not work from GitHub (it needs IPv6), and the transaction pooler (port 6543)
cannot run `pg_dump`. Put the real database password in the string.

### B2. The five GitHub secrets
GitHub > the repository > **Settings > Secrets and variables > Actions > New repository secret**:

| Name | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the session pooler string from B1 |
| `BACKUP_TENANT_ID` | Directory (tenant) ID |
| `BACKUP_CLIENT_ID` | Application (client) ID of `Technicon ERP backup` |
| `BACKUP_CLIENT_SECRET` | the secret's Value |
| `BACKUP_SHAREPOINT_SITE` | `contoso.sharepoint.com:/sites/TechniconBackups` |

### B3. First run, by hand
1. GitHub > **Actions > Nightly database backup > Run workflow**.
2. Wait for the green tick (a minute or two). The run summary shows the size and the number of tables.
3. In SharePoint open **Documents > Technicon-ERP-Backups > 2026**: the file `technicon-YYYY-MM-DD-HHmm.dump` is there.
4. The next morning check that a second file arrived on its own.

### B4. Keep GitHub's failure emails on
GitHub > your profile > **Settings > Notifications > Actions**: tick "Send notifications for failed workflows only".
A failed run (wrong secret, expired secret, Supabase down) emails you. A repository with no commits for 60 days has its
scheduled runs switched off by GitHub; any commit turns them back on.

### B5. Try a restore once
Do this before you promise the client a restore time. Create a spare Supabase project, then:
```powershell
pg_restore --no-owner --clean --if-exists --dbname "<direct connection string of the spare project>" technicon-YYYY-MM-DD-HHmm.dump
```
Then run migration `020_enable_rls_all_tables.sql` in that project (the backup leaves out access rights) and the check:
```sql
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
```
(no rows = good). Open the ERP against the spare project and look at a few quotations.

---

## If a run fails
| The run says | Meaning |
|---|---|
| `BACKUP_DATABASE_URL is not set` | The secret is missing or misspelled. |
| `connection ... failed` / `password authentication failed` | Wrong password or not the session pooler string. |
| `The dump has no table ...` | The dump is not the ERP database (wrong project). It was not uploaded. |
| `Microsoft sign-in failed (401 invalid_client)` | The client secret is wrong or has expired. |
| `SharePoint site lookup failed (403/404)` | Step A3 not done, or `BACKUP_SHAREPOINT_SITE` is wrong. |
| `Upload verification failed` | The stored file has a different size; run again. |

## Storage
One dump is added every night and none is deleted. Look at the site's storage use once a year. If it grows large, ask for an
automatic clean-up (for example, keep every night for 30 days, then one a week).
