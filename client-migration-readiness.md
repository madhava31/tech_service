# Client migration readiness: Technicon ERP

Prepared 05-11-2026 from a read-only inspection of `D:\3-1\Projects\tech_service`.

**No database, Supabase project, Vercel project or GitHub service was contacted. No `.env` file was read. No migration or deployment ran.** This report is the only file written. It is untracked, and it describes infrastructure, so don't publish it.

**Labels:** VERIFIED means read from the local code or local Git refs. ASSUMPTION means general platform behaviour or something only the live systems can confirm.

## Summary

**The code can move to a new Supabase project, but not by simply pointing it at one.** The application needs only one Supabase value, `DATABASE_URL`, and uses no Supabase SDK, Auth or Storage. No real credential was found in the code or Git history by the checks in section 7.

Fix or decide these before going live:

1. **Database setup order is not automated, and migration 001 fails on an empty database.** It needs `warehouse`, which the app only creates on the first inventory request. See section 10.
2. **23 tables have no row level security, including `app_user` and `session`.** No file in the repository closes this. On Supabase's defaults they may be reachable through the public Data API.
3. **The first visitor to a new deployment can create the administrator.** `POST /api/auth/setup` is open while `app_user` is empty.
4. **Technicon's identity is hardcoded** into PDFs and defaults: GSTIN, bank details, logo, signature and letterhead. This is only correct if the client is that same legal entity.
5. **Customer data sits unprotected in the working folder.** `confidential_import/` isn't in `.gitignore`, so `git add .` would publish it to the client's GitHub.

## 1. Framework, language, package manager and structure (VERIFIED)

| Item | Finding |
|---|---|
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS 3, Radix UI, React Router 6, Recharts |
| Backend | Express 4, JavaScript (ES modules), one Vercel serverless function |
| Database access | `pg` (node-postgres) directly, no ORM and no Supabase client |
| Package manager | npm. Lockfiles exist in `app/`, `app/client/` and `app/server/`, but **not at the repository root** |
| Node version | Not declared: no `engines`, `.nvmrc` or `.node-version` |

| Path | Role | Used in production? |
|---|---|---|
| `api/index.js`, `api/[...all].js` | Vercel entry; re-exports `app/api/index.js` | Yes |
| `app/api/index.js` | The Express app | Yes |
| `app/api/local-dev.js` | Local server, port 4000 | No |
| `app/client/src/` | React frontend | Yes |
| `app/client/api/_lib/` | Routes, services, SQL, PDFs | Yes |
| `app/client/scripts/` | `setup-db.js` and test scripts | Manual |
| `app/apply-followup-schema.cjs`, `app/check-production-db.cjs` | One-off database utilities | Manual |
| `app/server/` | Old SQLite backend with a Dockerfile; live code doesn't import it | No |
| `server.js`, `public/`, root `package.json` scripts | Old static "Flux" dashboard. The root `package.json` dependencies still matter, see section 2 | No |
| `stitch_design/`, `design/`, `Technicon Services Dashboard Redesign/` | Design material | No |

## 2. Vercel settings

| Setting | Value | Status |
|---|---|---|
| Root Directory | **Repository root** (leave blank or `./`) | VERIFIED from `vercel.json`, `api/` and paths. The current dashboard value can't be read locally, and there is no `.vercel` link folder |
| Framework Preset | Other | ASSUMPTION: Vite isn't at the root, and `vercel.json` sets the build and output |
| Build Command | `npm --prefix app run build` | VERIFIED, `vercel.json` |
| Output Directory | `app/client/dist` | VERIFIED, `vercel.json` |
| Install Command | Default (`npm install` at the root) | ASSUMPTION: none is set in `vercel.json` |
| Function | `api/index.js`, with `app/client/api/_lib/pdf/**` included | VERIFIED |
| Rewrites | `/api/*` to the function; everything else to `/index.html` | VERIFIED |
| Region | `icn1` | VERIFIED. Change it if the new Supabase project is in another region |

**Don't use `app` as the Root Directory.** `app/vercel.json` exists, but it doesn't include the PDF assets, so PDF output could lose its fonts and images. Treat it as a leftover.

**The build was not run for this report**, because building writes files. Prove it on a Vercel preview.

## 3. Git (VERIFIED, local refs only; nothing was fetched)

| Item | Value |
|---|---|
| Remote `origin` | `https://github.com/madhava31/tech_service.git` (no credential in the URL) |
| Current branch | `feat/quotation-line-key-features` |
| Latest commit | `691538f1dc4a5e8b25d42ea7a29e5d0519082f74`, 2026-11-03: feat: key features box on each quotation line item |
| `origin/main` | `b0ef69865337674045b77786aa2a703b0db6e8fa`, the merge of that commit. Same files as HEAD |
| Local `main` | `44bda5c`, 2026-10-23: **stale, don't migrate from it** |
| Last fetch | 2026-11-03, so the remote may have moved since |
| History | 110 commits and over 20 local branches |

Uncommitted work: `app/client/scripts/test-migration-001.mjs` is modified. Untracked: `app/client/scripts/inventory-ddl-for-test.sql`, `app/client/scripts/test-migration-001.mjs.safety-backup`, `audit/`, `confidential_import/`, and a stray 73 KB file at the root whose name looks like `tech_service"`.

## 4. Supabase configuration and migration files (VERIFIED)

**There is no `supabase/` folder, `config.toml`, Supabase CLI setup or migration tracking table.** Migrations are run by hand in the SQL Editor.

| File | Purpose | In Git? |
|---|---|---|
| `app/client/api/_lib/db/schema.sql` | Base schema, 14 tables, seeds `company_settings`. Applied by `npm --prefix app/client run setup-db` | Yes |
| `app/client/api/_lib/db/inventorySchema.js` | 7 inventory tables, created on first inventory request | Yes |
| `app/client/api/_lib/db/analysisSchema.js` | 2 analysis tables, created on first analysis request | Yes |
| `app/client/api/_lib/db/migrations/001_erp_missing_tables.sql` | Firms, branches, sale reports, procurement, extra columns, RLS on its new tables | Yes |
| `app/client/api/_lib/db/migrations/002_quotation_module.sql` | Key features, quotation numbering counter, terms | Yes |
| `app/client/api/_lib/db/migrations/003_delivery_challans.sql` | Delivery challans | Yes |
| `app/client/scripts/inventory-ddl-for-test.sql` | Exact copy of the inventory table SQL (compared by script) | **No, untracked** |
| `app/apply-followup-schema.cjs` | Older one-off follow-up schema change. Not needed after `schema.sql` (ASSUMPTION) | Yes |
| `docs/migrations/001-sql-editor-verification.md` | Notes from applying migration 001 | Yes |
| `app/server/src/db/schema.sql` | Old SQLite schema, not for Supabase | Yes |

## 5. Database objects identifiable from the local project (VERIFIED from files)

This describes what the files **define**. The live databases weren't read, and a code comment says some older databases were changed by hand, so a live database may differ.

| Object | Count |
|---|---:|
| Tables | 33 |
| Columns | 425 |
| Declared foreign keys | 56 |
| Named indexes | 27 |
| Triggers | **0** |
| Stored functions | **0** (only anonymous `DO` blocks used during migrations) |
| Views, extensions, custom types | **0** |
| RLS policies | **0** |
| Tables with RLS on, no policies | 10 |
| Tables with RLS not enabled | 23 |

**Row level security.** The 10 protected tables deny every role without `BYPASSRLS`, and migrations also revoke `anon` and `authenticated` access to them. The migration comments say the backend connects as `postgres`, so RLS doesn't affect the app.

**RLS not enabled on:** `company`, `product`, `import_batch`, `sales_record`, `company_settings`, `app_user`, `session`, `quotation`, `quotation_item`, `purchase_order`, `performa_invoice`, `quotation_follow_up`, `sales_engineer`, `engineer_sales_targets`, `warehouse`, `inventory_stock`, `inventory_movement`, `stock_reservation`, `stock_receipt`, `stock_receipt_item`, `stock_transfer`, `analysis_batch`, `analysis_record`.

**Other database behaviour:**
- The app sends `pg_notify` on channel `technicon_events`. `LISTEN` is skipped on Vercel.
- `app/client/api/_lib/routes/inventory.js:92` and `saleReports.js:458` can insert a default warehouse when none exists.
- The code tolerates an older `"user"` table if a foreign key points at it. A new database won't have one.
- Every table the code's SQL uses is defined above, and no `INSERT` or `UPDATE` column is missing. That was a static text check, and it doesn't check `SELECT` columns or dynamically built SQL.

### Foreign keys

| From | To | On delete |
|---|---|---|
| `sales_record.company_id` | `company.id` | NO ACTION (default) |
| `sales_record.import_batch_id` | `import_batch.id` | NO ACTION (default) |
| `session.user_id` | `app_user.id` | CASCADE |
| `quotation.company_id` | `company.id` | NO ACTION (default) |
| `quotation.created_by_user_id` | `app_user.id` | NO ACTION (default) |
| `quotation_item.quotation_id` | `quotation.id` | CASCADE |
| `quotation_item.product_id` | `product.id` | NO ACTION (default) |
| `purchase_order.quotation_id` | `quotation.id` | NO ACTION (default) |
| `performa_invoice.quotation_id` | `quotation.id` | NO ACTION (default) |
| `performa_invoice.purchase_order_id` | `purchase_order.id` | NO ACTION (default) |
| `quotation_follow_up.quotation_id` | `quotation.id` | CASCADE |
| `quotation_follow_up.created_by` | `app_user.id` | NO ACTION (default) |
| `quotation_follow_up.completed_by` | `app_user.id` | NO ACTION (default) |
| `engineer_sales_targets.engineer_id` | `sales_engineer.id` | CASCADE |
| `engineer_sales_targets.created_by` | `app_user.id` | NO ACTION (default) |
| `quotation.sales_engineer_id` | `sales_engineer.id` | NO ACTION (default) |
| `inventory_stock.warehouse_id` | `warehouse.id` | CASCADE |
| `inventory_stock.product_id` | `product.id` | RESTRICT |
| `inventory_movement.warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `inventory_movement.product_id` | `product.id` | NO ACTION (default) |
| `inventory_movement.created_by` | `app_user.id` | SET NULL |
| `stock_reservation.warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `stock_reservation.product_id` | `product.id` | NO ACTION (default) |
| `stock_reservation.reserved_by` | `app_user.id` | SET NULL |
| `stock_receipt.warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `stock_receipt.created_by` | `app_user.id` | SET NULL |
| `stock_receipt_item.receipt_id` | `stock_receipt.id` | CASCADE |
| `stock_receipt_item.product_id` | `product.id` | NO ACTION (default) |
| `stock_transfer.source_warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `stock_transfer.destination_warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `stock_transfer.product_id` | `product.id` | NO ACTION (default) |
| `stock_transfer.created_by` | `app_user.id` | SET NULL |
| `analysis_record.batch_id` | `analysis_batch.id` | CASCADE |
| `branch.firm_id` | `firm.id` | CASCADE |
| `branch_document_settings.branch_id` | `branch.id` | CASCADE |
| `sale_report.company_id` | `company.id` | NO ACTION (default) |
| `sale_report.warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `sale_report.source_quotation_id` | `quotation.id` | NO ACTION (default) |
| `sale_report.source_po_id` | `purchase_order.id` | NO ACTION (default) |
| `sale_report.source_pi_id` | `performa_invoice.id` | NO ACTION (default) |
| `sale_report.sales_engineer_id` | `sales_engineer.id` | NO ACTION (default) |
| `sale_report.firm_id` | `firm.id` | NO ACTION (default) |
| `sale_report.branch_id` | `branch.id` | NO ACTION (default) |
| `sale_report.created_by` | `app_user.id` | SET NULL |
| `sale_report.confirmed_by` | `app_user.id` | SET NULL |
| `sale_report_item.sale_report_id` | `sale_report.id` | CASCADE |
| `sale_report_item.product_id` | `product.id` | NO ACTION (default) |
| `procurement_requirement.product_id` | `product.id` | NO ACTION (default) |
| `procurement_requirement.warehouse_id` | `warehouse.id` | NO ACTION (default) |
| `procurement_requirement.supplier_id` | `company.id` | NO ACTION (default) |
| `procurement_requirement.purchase_order_id` | `purchase_order.id` | NO ACTION (default) |
| `procurement_requirement.created_by` | `app_user.id` | SET NULL |
| `delivery_challan.quotation_id` | `quotation.id` | SET NULL |
| `delivery_challan.created_by_user_id` | `app_user.id` | SET NULL |
| `delivery_challan_item.delivery_challan_id` | `delivery_challan.id` | CASCADE |
| `delivery_challan_item.product_id` | `product.id` | SET NULL |

### Relationships without a foreign key

These columns hold references that the database doesn't enforce:

| Column | Refers to |
|---|---|
| `quotation.firm_id, quotation.branch_id` | firm, branch |
| `quotation_follow_up.firm_id, branch_id, company_id, sales_engineer_id` | firm, branch, company, sales_engineer |
| `sales_engineer.branch_id, engineer_sales_targets.branch_id, warehouse.branch_id` | branch |
| `purchase_order.supplier_id, procurement_requirement_id` | company, procurement_requirement |
| `sales_record.company_name, analysis_record.company_name` | company.name (matched by text) |

### Tables and columns

#### `company`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `name` | TEXT NOT NULL UNIQUE | schema.sql |
| `address` | TEXT | schema.sql |
| `state` | TEXT | schema.sql |
| `gstin` | TEXT | schema.sql |
| `contact_person` | TEXT | schema.sql |
| `phone` | TEXT | schema.sql |
| `email` | TEXT | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `is_supplier` | INTEGER | 001 |
| `company_type` | TEXT | 001 |

#### `product`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `part_no` | TEXT NOT NULL UNIQUE | schema.sql |
| `hsn_sac` | TEXT | schema.sql |
| `description` | TEXT NOT NULL | schema.sql |
| `unit` | TEXT DEFAULT 'Nos' | schema.sql |
| `default_price` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `make` | TEXT | 002 |
| `key_features` | JSONB NOT NULL DEFAULT '[]'::jsonb | 002 |

#### `import_batch`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `filename` | TEXT NOT NULL | schema.sql |
| `year_label` | TEXT | schema.sql |
| `imported_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `row_count` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `imported_count` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `skipped_duplicate_count` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `flagged_count` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `companies_added` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `products_added` | INTEGER NOT NULL DEFAULT 0 | schema.sql |

#### `sales_record`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `sale_date` | DATE | schema.sql |
| `invoice_no` | TEXT | schema.sql |
| `company_name` | TEXT | schema.sql |
| `company_id` | INTEGER REFERENCES company(id) | schema.sql |
| `po_no` | TEXT | schema.sql |
| `state` | TEXT | schema.sql |
| `hsn_sac` | TEXT | schema.sql |
| `part_no` | TEXT | schema.sql |
| `product_description` | TEXT | schema.sql |
| `price` | DOUBLE PRECISION | schema.sql |
| `qty` | DOUBLE PRECISION | schema.sql |
| `total_amount` | DOUBLE PRECISION | schema.sql |
| `needs_review` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `review_reason` | TEXT | schema.sql |
| `review_dismissed` | INTEGER NOT NULL DEFAULT 0 | schema.sql |
| `import_batch_id` | INTEGER REFERENCES import_batch(id) | schema.sql |

Indexes: `idx_sales_company` (company_id); `idx_sales_part` (part_no)

#### `company_settings`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | INTEGER PRIMARY KEY CHECK (id = 1) | schema.sql |
| `company_name` | TEXT NOT NULL DEFAULT 'TECHNICON SERVICES' | schema.sql |
| `address` | TEXT DEFAULT '' | schema.sql |
| `gstin` | TEXT DEFAULT '' | schema.sql |
| `state` | TEXT DEFAULT '' | schema.sql |
| `phone` | TEXT DEFAULT '' | schema.sql |
| `landline` | TEXT DEFAULT '' | schema.sql |
| `email` | TEXT DEFAULT '' | schema.sql |
| `logo_image` | TEXT DEFAULT '' | schema.sql |
| `signature_image` | TEXT DEFAULT '' | schema.sql |
| `bank_name` | TEXT DEFAULT '' | schema.sql |
| `bank_account_no` | TEXT DEFAULT '' | schema.sql |
| `bank_ifsc` | TEXT DEFAULT '' | schema.sql |
| `bank_account_holder` | TEXT DEFAULT '' | schema.sql |
| `quotation_validity_days` | INTEGER DEFAULT 15 | schema.sql |
| `payment_terms` | TEXT DEFAULT '' | schema.sql |
| `delivery_time` | TEXT DEFAULT '' | schema.sql |
| `quotation_prefix` | TEXT DEFAULT 'QTN' | schema.sql |
| `po_prefix` | TEXT DEFAULT 'PO' | schema.sql |
| `pi_prefix` | TEXT DEFAULT 'PI' | schema.sql |
| `default_tax_percent` | DOUBLE PRECISION NOT NULL DEFAULT 18 | schema.sql |
| `default_lapse_months` | INTEGER NOT NULL DEFAULT 12 | schema.sql |

#### `app_user`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `username` | TEXT NOT NULL UNIQUE | schema.sql |
| `password_hash` | TEXT NOT NULL | schema.sql |
| `password_salt` | TEXT NOT NULL | schema.sql |
| `role` | TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')) | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |

#### `session`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `token` | TEXT PRIMARY KEY | schema.sql |
| `user_id` | INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE | schema.sql |
| `expires_at` | TIMESTAMP NOT NULL | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |

#### `quotation`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `number` | TEXT NOT NULL UNIQUE | schema.sql |
| `date` | DATE NOT NULL | schema.sql |
| `company_id` | INTEGER NOT NULL REFERENCES company(id) | schema.sql |
| `status` | TEXT NOT NULL DEFAULT 'draft' | schema.sql |
| `subtotal` | DOUBLE PRECISION NOT NULL DEFAULT 0 | schema.sql |
| `discount_type` | TEXT DEFAULT 'percentage' | schema.sql |
| `discount_value` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `discount_percent` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `discount_amount` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `taxable_amount` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `tax_percent` | DOUBLE PRECISION NOT NULL DEFAULT 18 | schema.sql |
| `tax_amount` | DOUBLE PRECISION NOT NULL DEFAULT 0 | schema.sql |
| `round_off` | DOUBLE PRECISION DEFAULT 0 | schema.sql |
| `total` | DOUBLE PRECISION NOT NULL DEFAULT 0 | schema.sql |
| `notes` | TEXT DEFAULT '' | schema.sql |
| `created_by_user_id` | INTEGER REFERENCES app_user(id) | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `sales_engineer_id` | INTEGER REFERENCES sales_engineer(id) | schema.sql |
| `firm_id` | INTEGER | 001 |
| `branch_id` | INTEGER | 001 |
| `gross_subtotal` | DOUBLE PRECISION | 001 |
| `product_discount_total` | DOUBLE PRECISION | 001 |
| `subtotal_after_product_discounts` | DOUBLE PRECISION | 001 |
| `overall_discount_type` | TEXT | 001 |
| `overall_discount_value` | DOUBLE PRECISION | 001 |
| `overall_discount_amount` | DOUBLE PRECISION | 001 |
| `net_subtotal` | DOUBLE PRECISION | 001 |
| `contact_person` | TEXT | 002 |
| `opportunity_ref` | TEXT | 002 |
| `terms` | JSONB | 002 |

Indexes: `idx_quotation_company` (company_id); `idx_quotation_created_by` (created_by_user_id)

#### `quotation_item`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `quotation_id` | INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE | schema.sql |
| `product_id` | INTEGER REFERENCES product(id) | schema.sql |
| `part_no` | TEXT | schema.sql |
| `description` | TEXT NOT NULL | schema.sql |
| `hsn_sac` | TEXT | schema.sql |
| `make` | TEXT | schema.sql |
| `qty` | DOUBLE PRECISION NOT NULL DEFAULT 1 | schema.sql |
| `price` | DOUBLE PRECISION NOT NULL DEFAULT 0 | schema.sql |
| `amount` | DOUBLE PRECISION NOT NULL DEFAULT 0 | schema.sql |
| `actual_unit_price` | DOUBLE PRECISION | 001 |
| `discount_type` | TEXT | 001 |
| `discount_value` | DOUBLE PRECISION | 001 |
| `product_discount_amount` | DOUBLE PRECISION | 001 |
| `after_product_discount_amount` | DOUBLE PRECISION | 001 |
| `overall_discount_allocated` | DOUBLE PRECISION | 001 |
| `final_unit_price` | DOUBLE PRECISION | 001 |
| `final_line_total` | DOUBLE PRECISION | 001 |
| `product_name` | TEXT | 002 |
| `key_features` | JSONB | 002 |

Indexes: `idx_quotation_item_quotation` (quotation_id)

#### `purchase_order`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `number` | TEXT NOT NULL UNIQUE | schema.sql |
| `date` | DATE NOT NULL | schema.sql |
| `quotation_id` | INTEGER NOT NULL REFERENCES quotation(id) | schema.sql |
| `client_po_ref` | TEXT | schema.sql |
| `status` | TEXT NOT NULL DEFAULT 'open' | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `supplier_id` | INTEGER | 001 |
| `received_quantity` | DOUBLE PRECISION | 001 |
| `procurement_requirement_id` | INTEGER | 001 |

#### `performa_invoice`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `number` | TEXT NOT NULL UNIQUE | schema.sql |
| `date` | DATE NOT NULL | schema.sql |
| `quotation_id` | INTEGER NOT NULL REFERENCES quotation(id) | schema.sql |
| `purchase_order_id` | INTEGER REFERENCES purchase_order(id) | schema.sql |
| `status` | TEXT NOT NULL DEFAULT 'issued' | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |

#### `quotation_follow_up`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `quotation_id` | INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE | schema.sql |
| `follow_up_date` | DATE NOT NULL | schema.sql |
| `notes` | TEXT DEFAULT '' | schema.sql |
| `status` | TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')) | schema.sql |
| `created_by` | INTEGER NOT NULL REFERENCES app_user(id) | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `completed_at` | TIMESTAMP | schema.sql |
| `completed_by` | INTEGER REFERENCES app_user(id) | schema.sql |
| `outcome` | TEXT | schema.sql |
| `outcome_notes` | TEXT | schema.sql |
| `follow_up_time` | TEXT | 001 |
| `priority` | TEXT | 001 |
| `firm_id` | INTEGER | 001 |
| `branch_id` | INTEGER | 001 |
| `company_id` | INTEGER | 001 |
| `sales_engineer_id` | INTEGER | 001 |

Indexes: `idx_follow_up_quotation` (quotation_id); `idx_follow_up_date_status` (follow_up_date, status)

#### `sales_engineer`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `employee_code` | TEXT NOT NULL UNIQUE | schema.sql |
| `name` | TEXT NOT NULL | schema.sql |
| `email` | TEXT | schema.sql |
| `phone` | TEXT | schema.sql |
| `designation` | TEXT DEFAULT 'Sales Engineer' | schema.sql |
| `department` | TEXT DEFAULT 'Sales' | schema.sql |
| `branch_id` | INTEGER | schema.sql |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | schema.sql |
| `joining_date` | DATE | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |

#### `engineer_sales_targets`
Created by `schema.sql`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | schema.sql |
| `engineer_id` | INTEGER NOT NULL REFERENCES sales_engineer(id) ON DELETE CASCADE | schema.sql |
| `branch_id` | INTEGER | schema.sql |
| `financial_year` | TEXT NOT NULL | schema.sql |
| `target_amount` | DOUBLE PRECISION NOT NULL CHECK (target_amount >= 0) | schema.sql |
| `created_by` | INTEGER REFERENCES app_user(id) | schema.sql |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | schema.sql |

Table constraints: `UNIQUE(engineer_id, financial_year, branch_id)`

Indexes: `idx_sales_target_eng` (engineer_id, financial_year)

#### `warehouse`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `name` | TEXT NOT NULL | inventorySchema.js |
| `code` | TEXT NOT NULL UNIQUE | inventorySchema.js |
| `address` | TEXT | inventorySchema.js |
| `city` | TEXT | inventorySchema.js |
| `state` | TEXT | inventorySchema.js |
| `branch_id` | INTEGER | inventorySchema.js |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | inventorySchema.js |
| `is_default` | INTEGER NOT NULL DEFAULT 0 | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |

#### `inventory_stock`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE | inventorySchema.js |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) ON DELETE RESTRICT | inventorySchema.js |
| `on_hand_quantity` | DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0) | inventorySchema.js |
| `reserved_quantity` | DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0) | inventorySchema.js |
| `incoming_quantity` | DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (incoming_quantity >= 0) | inventorySchema.js |
| `low_stock_threshold` | DOUBLE PRECISION DEFAULT 10 | inventorySchema.js |
| `critical_stock_threshold` | DOUBLE PRECISION DEFAULT 5 | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |

Table constraints: `UNIQUE (warehouse_id, product_id)`; `CHECK (on_hand_quantity >= reserved_quantity)`

Indexes: `idx_inventory_stock_product` (product_id)

#### `inventory_movement`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | inventorySchema.js |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | inventorySchema.js |
| `movement_type` | TEXT NOT NULL CHECK (movement_type IN ('STOCK_IN', 'STOCK_OUT', 'RETURN', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK')) | inventorySchema.js |
| `quantity` | DOUBLE PRECISION NOT NULL | inventorySchema.js |
| `before_on_hand` | DOUBLE PRECISION NOT NULL | inventorySchema.js |
| `after_on_hand` | DOUBLE PRECISION NOT NULL | inventorySchema.js |
| `before_reserved` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `after_reserved` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `reference_type` | TEXT | inventorySchema.js |
| `reference_id` | TEXT | inventorySchema.js |
| `reason` | TEXT | inventorySchema.js |
| `created_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |

Indexes: `idx_inventory_movement_wh_prod` (warehouse_id, product_id); `idx_inventory_movement_ref` (reference_type, reference_id)

#### `stock_reservation`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | inventorySchema.js |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | inventorySchema.js |
| `quantity` | DOUBLE PRECISION NOT NULL CHECK (quantity > 0) | inventorySchema.js |
| `status` | TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FULFILLED', 'CANCELLED', 'RELEASED')) | inventorySchema.js |
| `reference_type` | TEXT | inventorySchema.js |
| `reference_id` | TEXT | inventorySchema.js |
| `notes` | TEXT | inventorySchema.js |
| `reserved_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |
| `released_at` | TIMESTAMP | inventorySchema.js |
| `fulfilled_at` | TIMESTAMP | inventorySchema.js |

#### `stock_receipt`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | inventorySchema.js |
| `receipt_number` | TEXT NOT NULL UNIQUE | inventorySchema.js |
| `source_type` | TEXT NOT NULL DEFAULT 'MANUAL' | inventorySchema.js |
| `source_reference` | TEXT | inventorySchema.js |
| `status` | TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')) | inventorySchema.js |
| `notes` | TEXT | inventorySchema.js |
| `created_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |
| `confirmed_at` | TIMESTAMP | inventorySchema.js |

Indexes: `idx_stock_receipt_wh` (warehouse_id)

#### `stock_receipt_item`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `receipt_id` | INTEGER NOT NULL REFERENCES stock_receipt(id) ON DELETE CASCADE | inventorySchema.js |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | inventorySchema.js |
| `quantity` | DOUBLE PRECISION NOT NULL CHECK (quantity > 0) | inventorySchema.js |
| `before_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `after_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `notes` | TEXT | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |

#### `stock_transfer`
Created by `inventorySchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | inventorySchema.js |
| `transfer_number` | TEXT NOT NULL UNIQUE | inventorySchema.js |
| `source_warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | inventorySchema.js |
| `destination_warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | inventorySchema.js |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | inventorySchema.js |
| `quantity` | DOUBLE PRECISION NOT NULL CHECK (quantity > 0) | inventorySchema.js |
| `status` | TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('DRAFT', 'COMPLETED', 'CANCELLED')) | inventorySchema.js |
| `reference` | TEXT | inventorySchema.js |
| `notes` | TEXT | inventorySchema.js |
| `source_before_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `source_after_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `dest_before_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `dest_after_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | inventorySchema.js |
| `created_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | inventorySchema.js |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | inventorySchema.js |
| `confirmed_at` | TIMESTAMP | inventorySchema.js |

Indexes: `idx_stock_transfer_src_wh` (source_warehouse_id); `idx_stock_transfer_dest_wh` (destination_warehouse_id)

#### `analysis_batch`
Created by `analysisSchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | analysisSchema.js |
| `year` | INTEGER NOT NULL | analysisSchema.js |
| `filename` | TEXT NOT NULL | analysisSchema.js |
| `row_count` | INTEGER NOT NULL DEFAULT 0 | analysisSchema.js |
| `imported_count` | INTEGER NOT NULL DEFAULT 0 | analysisSchema.js |
| `skipped_count` | INTEGER NOT NULL DEFAULT 0 | analysisSchema.js |
| `uploaded_at` | TIMESTAMP NOT NULL DEFAULT NOW() | analysisSchema.js |

Indexes: `idx_analysis_batch_year` (year)

#### `analysis_record`
Created by `analysisSchema.js`. RLS: **not enabled**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | analysisSchema.js |
| `batch_id` | INTEGER NOT NULL REFERENCES analysis_batch(id) ON DELETE CASCADE | analysisSchema.js |
| `year` | INTEGER NOT NULL | analysisSchema.js |
| `sale_date` | DATE NOT NULL | analysisSchema.js |
| `invoice_no` | TEXT | analysisSchema.js |
| `company_name` | TEXT NOT NULL | analysisSchema.js |
| `po_no` | TEXT | analysisSchema.js |
| `state` | TEXT | analysisSchema.js |
| `hsn_sac` | TEXT | analysisSchema.js |
| `part_no` | TEXT | analysisSchema.js |
| `product_description` | TEXT | analysisSchema.js |
| `price` | DOUBLE PRECISION | analysisSchema.js |
| `qty` | DOUBLE PRECISION | analysisSchema.js |
| `total_amount` | DOUBLE PRECISION NOT NULL | analysisSchema.js |

Indexes: `idx_analysis_record_batch` (batch_id); `idx_analysis_record_year` (year)

#### `firm`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `firm_code` | TEXT NOT NULL UNIQUE | 001 |
| `firm_name` | TEXT NOT NULL | 001 |
| `legal_name` | TEXT | 001 |
| `gstin` | TEXT | 001 |
| `pan` | TEXT | 001 |
| `email` | TEXT | 001 |
| `phone` | TEXT | 001 |
| `address_line_1` | TEXT | 001 |
| `address_line_2` | TEXT | 001 |
| `city` | TEXT | 001 |
| `state` | TEXT | 001 |
| `pincode` | TEXT | 001 |
| `country` | TEXT DEFAULT 'India' | 001 |
| `logo` | TEXT | 001 |
| `quotation_prefix` | TEXT DEFAULT 'QTN' | 001 |
| `invoice_prefix` | TEXT DEFAULT 'INV' | 001 |
| `is_default` | INTEGER NOT NULL DEFAULT 0 | 001 |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |

#### `branch`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `firm_id` | INTEGER NOT NULL REFERENCES firm(id) ON DELETE CASCADE | 001 |
| `branch_code` | TEXT NOT NULL UNIQUE | 001 |
| `branch_name` | TEXT NOT NULL | 001 |
| `address_line_1` | TEXT | 001 |
| `address_line_2` | TEXT | 001 |
| `city` | TEXT | 001 |
| `state` | TEXT | 001 |
| `pincode` | TEXT | 001 |
| `phone` | TEXT | 001 |
| `email` | TEXT | 001 |
| `gstin` | TEXT | 001 |
| `pan` | TEXT | 001 |
| `bank_details` | TEXT | 001 |
| `terms_conditions` | TEXT | 001 |
| `quotation_prefix` | TEXT | 001 |
| `is_default` | INTEGER NOT NULL DEFAULT 0 | 001 |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |

Indexes: `idx_branch_firm` (firm_id)

#### `branch_document_settings`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `branch_id` | INTEGER NOT NULL UNIQUE REFERENCES branch(id) ON DELETE CASCADE | 001 |
| `document_title_prefix` | TEXT | 001 |
| `logo_path` | TEXT | 001 |
| `header_text` | TEXT | 001 |
| `footer_text` | TEXT | 001 |
| `authorized_signatory` | TEXT | 001 |
| `bank_name` | TEXT | 001 |
| `account_number` | TEXT | 001 |
| `ifsc_code` | TEXT | 001 |
| `branch_bank_name` | TEXT | 001 |
| `terms_conditions` | TEXT | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |

#### `sale_report`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `report_number` | TEXT NOT NULL UNIQUE | 001 |
| `company_id` | INTEGER REFERENCES company(id) | 001 |
| `company_name_snapshot` | TEXT NOT NULL | 001 |
| `invoice_number` | TEXT | 001 |
| `sale_date` | DATE NOT NULL | 001 |
| `phone_number_snapshot` | TEXT | 001 |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | 001 |
| `source_type` | TEXT NOT NULL CHECK (source_type IN ('INTERNAL_DOCUMENT', 'DIRECT_EXTERNAL')) | 001 |
| `source_reference` | TEXT | 001 |
| `source_quotation_id` | INTEGER REFERENCES quotation(id) | 001 |
| `source_po_id` | INTEGER REFERENCES purchase_order(id) | 001 |
| `source_pi_id` | INTEGER REFERENCES performa_invoice(id) | 001 |
| `sales_engineer_id` | INTEGER REFERENCES sales_engineer(id) | 001 |
| `firm_id` | INTEGER REFERENCES firm(id) | 001 |
| `branch_id` | INTEGER REFERENCES branch(id) | 001 |
| `status` | TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')) | 001 |
| `subtotal` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `tax_percent` | DOUBLE PRECISION NOT NULL DEFAULT 18 | 001 |
| `tax_amount` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `total_amount` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `notes` | TEXT | 001 |
| `created_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `confirmed_at` | TIMESTAMP | 001 |
| `confirmed_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | 001 |

Indexes: `idx_sale_report_company` (company_id); `idx_sale_report_date` (sale_date); `idx_sale_report_status` (status); `idx_sale_report_wh` (warehouse_id)

#### `sale_report_item`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `sale_report_id` | INTEGER NOT NULL REFERENCES sale_report(id) ON DELETE CASCADE | 001 |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | 001 |
| `part_number_snapshot` | TEXT NOT NULL | 001 |
| `description_snapshot` | TEXT NOT NULL | 001 |
| `hsn_code_snapshot` | TEXT | 001 |
| `quantity` | DOUBLE PRECISION NOT NULL CHECK (quantity > 0) | 001 |
| `unit_price` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `total_price` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `before_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `after_on_hand` | DOUBLE PRECISION NOT NULL DEFAULT 0 | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |

#### `procurement_requirement`
Created by `001`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 001 |
| `requirement_code` | TEXT NOT NULL UNIQUE | 001 |
| `product_id` | INTEGER NOT NULL REFERENCES product(id) | 001 |
| `warehouse_id` | INTEGER NOT NULL REFERENCES warehouse(id) | 001 |
| `required_quantity` | DOUBLE PRECISION NOT NULL CHECK (required_quantity > 0) | 001 |
| `suggested_quantity` | DOUBLE PRECISION NOT NULL CHECK (suggested_quantity > 0) | 001 |
| `priority` | TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')) | 001 |
| `reason` | TEXT | 001 |
| `source_type` | TEXT NOT NULL CHECK (source_type IN ('STOCK_INTELLIGENCE', 'RESTOCK_QUEUE', 'SALES_DEMAND', 'MANUAL')) | 001 |
| `source_reference` | TEXT | 001 |
| `supplier_id` | INTEGER REFERENCES company(id) | 001 |
| `status` | TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_COVERED', 'ORDERED', 'RECEIVING', 'FULFILLED')) | 001 |
| `purchase_order_id` | INTEGER REFERENCES purchase_order(id) | 001 |
| `created_by` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | 001 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 001 |

Indexes: `idx_proc_req_prod` (product_id); `idx_proc_req_wh` (warehouse_id)

#### `quotation_number_counter`
Created by `002`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `fy` | TEXT PRIMARY KEY | 002 |
| `last_seq` | INTEGER NOT NULL CHECK (last_seq >= 0) | 002 |

#### `delivery_challan`
Created by `003`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 003 |
| `number` | TEXT NOT NULL UNIQUE | 003 |
| `date` | DATE NOT NULL | 003 |
| `challan_type` | TEXT NOT NULL DEFAULT 'non_returnable' CHECK (challan_type IN ('non_returnable', 'returnable')) | 003 |
| `invoice_no` | TEXT | 003 |
| `quotation_id` | INTEGER REFERENCES quotation(id) ON DELETE SET NULL | 003 |
| `quotation_number` | TEXT | 003 |
| `customer_name` | TEXT NOT NULL | 003 |
| `customer_address` | TEXT | 003 |
| `attention` | TEXT | 003 |
| `phone` | TEXT | 003 |
| `order_date` | DATE | 003 |
| `work_order_no` | TEXT | 003 |
| `job` | TEXT | 003 |
| `remarks` | TEXT | 003 |
| `created_by_user_id` | INTEGER REFERENCES app_user(id) ON DELETE SET NULL | 003 |
| `created_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 003 |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT NOW() | 003 |

Indexes: `idx_delivery_challan_quotation` (quotation_id); `idx_delivery_challan_created_by` (created_by_user_id)

#### `delivery_challan_item`
Created by `003`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `id` | SERIAL PRIMARY KEY | 003 |
| `delivery_challan_id` | INTEGER NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE | 003 |
| `line_no` | INTEGER NOT NULL | 003 |
| `product_id` | INTEGER REFERENCES product(id) ON DELETE SET NULL | 003 |
| `part_no` | TEXT | 003 |
| `description` | TEXT NOT NULL | 003 |
| `qty` | DOUBLE PRECISION NOT NULL CHECK (qty > 0) | 003 |

Indexes: `idx_delivery_challan_item_challan` (delivery_challan_id)

#### `delivery_challan_number_counter`
Created by `003`. RLS: **on, no policies**.

| Column | Definition | Added by |
|---|---|---|
| `fy` | TEXT PRIMARY KEY | 003 |
| `last_seq` | INTEGER NOT NULL CHECK (last_seq >= 0) | 003 |

### Old SQLite schema (not for migration)

`app/server/src/db/schema.sql` defines 27 SQLite tables and 37 indexes, with no triggers or views. Live code doesn't use it.

## 6. Environment variable names (VERIFIED; no values read)

**Only one Supabase-related variable is used in live code: `DATABASE_URL`.** No `SUPABASE_URL`, anon key or service role key appears anywhere in the code.

| Name | Used by | Needed on Vercel? |
|---|---|---|
| `DATABASE_URL` | API, scripts | **Required.** The API throws at startup without it |
| `CLIENT_ORIGIN` | CORS, `app/api/index.js:136` | **Set it.** Unset, any origin is reflected with credentials |
| `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` | AI assistant | Optional; either selects Claude |
| `GEMINI_API_KEY` | AI assistant | Optional; used when no Claude key is set |
| `CLAUDE_MODEL` | AI assistant | Optional |
| `VITE_API_URL` | Frontend | Leave unset; defaults to same-origin `/api` |
| `NODE_ENV`, `VERCEL` | Secure cookie and pool size | Set by Vercel (ASSUMPTION) |
| `TEST_DATABASE_URL` | Test scripts | No, local only |
| `PORT`, `DATA_DIR`, `PDF_OUT` | Local server, old backend, one test | No |

`app/client/.env.example` lists only `VITE_API_URL`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `GEMINI_API_KEY` and `DATABASE_URL`. It omits `CLIENT_ORIGIN`, `CLAUDE_API_KEY` and `TEST_DATABASE_URL`.

Env-named paths present: `app/client/.env` (gitignored, not read), `app/client/.env.example` (variable names only were read), and `.env` at the root, which is an **empty folder**, not a file. Git history has never tracked any env file except the example.

## 7. Hardcoded credentials, secrets and database URLs (VERIFIED by pattern scan; values not printed)

**No real credential was found.** Every connection string with a password points at a local or placeholder host, or holds a placeholder password. The classification looked at host type and password shape only.

| Finding | Paths | Variable | Assessment |
|---|---|---|---|
| Local test connection string fallback | `app/client/scripts/`: `test-account-settings.mjs`, `test-auth-errors.mjs`, `test-company-delete.mjs`, `test-db-acquire-retry.mjs`, `test-firm-branch-guard.mjs`, `test-integration-suite.cjs`, `test-sale-reports-guard.mjs`, `test-sales-guard.mjs`, `test-sales-overview.mjs`, `test-user-attribution.mjs` | `process.env.DATABASE_URL` | Local host, placeholder-like password |
| Example Supabase connection strings | `docs/superpowers/plans/2026-09-26-postgres-migration.md` (lines 132, 141, 163) | `DATABASE_URL` | Placeholder password, but includes **a real project reference and pooler host** |
| Test account password literals | `app/client/scripts/test-account-settings-db.mjs`, `test-account-settings.mjs`, `test-auth-errors.mjs`, `test-migration-001.mjs`, `test-migration-001.mjs.safety-backup` | `password`, `PASS` | Test-only values |
| Real Supabase project references (identifiers, not secrets) | `app/client/scripts/test-account-settings-db.mjs`, `app/client/scripts/test-migration-001.mjs` | `PRODUCTION_REF`, `PRODUCTION_PROJECT_REF` | Used as safety guards; see section 10 |
| Real Supabase project references in text | `docs/migrations/001-sql-editor-verification.md`, `docs/superpowers/plans/2026-09-26-postgres-migration.md`, untracked `audit/01-repository-inventory.md` and `audit/02-environment-audit.md`, and the stray root file | None | Remove or review before handover |

**Git history:** all refs (110 commits) were searched for connection strings, Anthropic and Google key shapes, and JWT shapes. The same placeholder files turned up, plus placeholders in `docs/data-refresh-architecture.md`. No key or JWT shape was found.

**Limits of this scan:** it is pattern matching. It skipped `.env` files, `node_modules`, `confidential_import` and binary files, and the history search covered only the shapes listed above. Run a dedicated scanner such as gitleaks before pushing to the client's GitHub.

**Business data hardcoded in code (not secrets, but they will print on documents):**

| Data | Location | Variable |
|---|---|---|
| Company name, address, phones, email, GSTIN, bank details, account holder | `app/client/api/_lib/pdf/documents.js:41-52` | `DEFAULT_COMPANY_SETTINGS` |
| Bundled logo, signature, letterhead | `app/client/api/_lib/pdf/logo.png`, `signature.png`, `technicon-letterhead.png` | `DEFAULT_LOGO_PATH`, `DEFAULT_SIG_PATH` |
| Letterhead identity including GSTIN and email | `app/client/api/_lib/pdf/deliveryChallanPdf.js:24-29` | None |
| Letterhead identity | `app/client/api/_lib/pdf/quotationPdf.js:7-27` | None |
| Default bank name, account number, IFSC and holder, written to the database | `app/client/api/_lib/routes/branches.js:68-73, 281-283, 420-424` | `bank_name`, `bank_account_no`, `account_number`, `bank_ifsc`, `ifsc_code` |
| Default company name | `app/client/api/_lib/db/schema.sql:58` | `company_name` |
| Default warehouse | `app/client/api/_lib/routes/inventory.js:92`, `saleReports.js:458` | None |
| Branding in exports, AI persona and UI text | `routes/export.js`, `routes/inventory.js`, `ai/prompt.js`, `src/pages/Login.tsx`, `src/components/` | Various |

## 8. Storage, authentication, email, payment and other integrations (VERIFIED from code)

| Area | Finding |
|---|---|
| File storage | **No object storage.** No Supabase Storage, S3 or Vercel Blob. Uploads are parsed in memory (`multer.memoryStorage`). Comments say logo and signature images are stored as base64 in `company_settings` |
| Authentication | **Custom, not Supabase Auth.** Scrypt password hashes in `app_user`; random tokens in `session`; `httpOnly`, `sameSite=lax` cookie, `secure` in production; roles `admin` and `staff` |
| Email | None found |
| Payment | None found |
| SMS, WhatsApp | None found |
| AI | Anthropic API (`ai/claude.js`, calls `api.anthropic.com`) or Google Gemini (`ai/gemini.js`). Business data from tool results is sent to the provider. Default models are hardcoded in those files; confirm they're still available |
| Documents | PDFKit for PDFs, ExcelJS for Excel import and export |
| Realtime | Server-Sent Events with in-memory fan-out; Postgres `LISTEN` is off on Vercel |
| External web assets | Google Fonts, from `app/client/index.html` |
| Monitoring, analytics, OAuth | None found. The only pattern hits were the variable name successEntry, and no such package is declared |
| Browser storage | Date range, recent searches and theme only |

## 9. Application modules and dependencies (VERIFIED)

Handler counts are `router.*` calls per route file. All routes need a signed-in user unless noted. Tables include those used through the module's services.

| Module | Route file | Handlers | Main tables | Other dependencies |
|---|---|---:|---|---|
| Auth and setup | `auth.js` | 6 | `app_user`, `session` | `auth/password`. `/setup` and `/login` are public |
| Admin | `admin.js` | 12 | `app_user`, `session`, `sales_record`, `import_batch`, others | Admin only |
| Companies | `companies.js` | 8 | `company`, `company_settings`, `sales_record` | |
| Products | `products.js` | 10 | `product`, `quotation_item`, `sales_record` | `multer`, `exceljs` |
| Quotations | `quotations.js` | 14 | `quotation`, `quotation_item`, `quotation_follow_up`, `quotation_number_counter` | `pdfkit`, `quotations/module` |
| Purchase orders | `purchaseOrders.js` | 4 | `purchase_order`, `quotation` | `pdf/documents`, `db/numbering` |
| Proforma invoices | `performaInvoices.js` | 4 | `performa_invoice`, `purchase_order` | `pdf/documents`, `db/numbering` |
| Delivery challans | `deliveryChallans.js` | 7 | `delivery_challan`, `delivery_challan_item`, `delivery_challan_number_counter` | `pdfkit`, needs migration 003 |
| Sales | `sales.js` | 21 | `quotation`, `purchase_order`, `sale_report`, `sales_engineer`, others | Needs migration 001 |
| Sale reports | `saleReports.js` | 9 | `sale_report`, `sale_report_item`, `warehouse` | Needs inventory tables and migration 001 |
| Sales engineers | `engineers.js` | 7 | `sales_engineer`, `engineer_sales_targets` | `db/engineerService` |
| Inventory | `inventory.js` | 49 | `warehouse`, `inventory_*`, `stock_*` | `multer`, `exceljs`, creates its tables on first use |
| Procurement | `procurement.js` | 12 | `procurement_requirement`, `purchase_order`, `stock_receipt` | Needs migration 001 |
| Firms and branches | `firms.js`, `branches.js` | 14 | `firm`, `branch`, `branch_document_settings` | Needs migration 001 |
| Settings | `settings.js` | 2 | `company_settings` | |
| Sales import | `imports.js` | 2 | `import_batch`, `sales_record` | `multer`, `exceljs` |
| Past-year analysis | `analysis.js` | 5 | `analysis_batch`, `analysis_record` | `multer`, `exceljs`, creates its tables on first use |
| Dashboard | `dashboard.js` | 13 | `sales_record`, `quotation`, `purchase_order`, others | |
| Reports | `reports.js` | 8 | `sales_record` | `exceljs` |
| Opportunities | `opportunities.js` | 1 | `company`, `quotation`, `sales_record`, others | |
| Exports | `export.js` | 11 | Many | `exceljs` |
| AI assistant | `ai.js` | 1 | `company`, `quotation`, `sales_record`, others | Anthropic or Gemini |
| Global search | `search.js` | 1 | Many | |
| Realtime, cache, health | `app/api/index.js`, `db/events.js`, `cache/apiCache.js` | Direct | None | `compression` |

**Frontend modules** (`app/client/src/pages/`): Dashboard, Sales, Sale Reports, Engineers, Quotations, Purchase Orders, Proforma Invoices, Delivery Challans, Companies, Products, Inventory, Procurement, Opportunities, Reports, Business and Customer Health, Product Intelligence, Chat with AI, Settings, Firms and Branches, Admin, Login and Setup. All data goes through `src/api.ts` to `/api`.

**Known gap:** `docs/future-work-unimplemented-endpoints.md` lists 10 frontend calls with no backend route, which return 404.

## 10. Missing configuration and risks to deployment

### Must fix or decide before go-live

| # | Issue | Evidence | Effect |
|---:|---|---|---|
| 1 | **Setup order isn't scripted, and migration 001 fails on an empty database.** It requires `warehouse`, which `schema.sql` doesn't create. The app creates it on the first inventory request | `001_erp_missing_tables.sql:46-51`, `inventorySchema.js` | Run the order in section 11. The SQL file holding the inventory tables isn't in Git, so **it won't travel with a clone** |
| 2 | **23 tables have no RLS**, including `app_user` (password hashes) and `session` (login tokens). Tables created at runtime also get no restrictions | Section 5 | ASSUMPTION: on Supabase defaults these may be readable and writable through the public Data API with the project's public key. Enable RLS and revoke `anon` and `authenticated` on all tables, or turn off the Data API, then test from outside |
| 3 | **First-run admin is open.** `POST /api/auth/setup` is public while `app_user` is empty, and the check isn't atomic. Passwords need only 6 characters | `routes/auth.js:54-72` | Complete setup immediately after the first deploy, before sharing the URL |
| 4 | **Hardcoded identity** | Section 7 | Wrong GSTIN, bank details or signature on documents if the client is a different legal entity. If it's the same entity, confirm the details are still correct |
| 5 | **`confidential_import/` and `audit/` aren't gitignored** | `git check-ignore` matched neither | `git add .` would publish customer data and infrastructure details |
| 6 | **`CLIENT_ORIGIN` unset allows any origin with credentials** | `app/api/index.js:136` | Set it to the client's production URL |

### Should fix or test

| # | Issue | Evidence | Effect |
|---:|---|---|---|
| 7 | **Authorisation is thin.** `settings.js`, `firms.js`, `branches.js`, `inventory.js` and `analysis.js` have no admin check, including `PUT /api/settings` and firm and branch deletes | `routes/settings.js:23`, `firms.js:217`, `branches.js:451` | Any staff user can change bank details or delete these records |
| 8 | **File-path read.** A logo or signature value that isn't a data URI is read from the server's disk | `pdf/documents.js:134` | Limited file read by anyone who can edit settings, which item 7 allows for staff |
| 9 | **Build risks.** No root lockfile, so root dependencies aren't pinned; no declared Node version; `app/client` depends on `technicon-services: file:..`, which pulls in native `better-sqlite3` although live code doesn't use it | `package.json` files | Build could differ or fail on a new project. Set the Node version and test on a preview |
| 10 | **Connection mode.** Pool size is 3 per function instance | `db/index.js:28` | Use Supabase's transaction pooler (port 6543). A project note from 30-10-2026 records session mode exhausting its client limit. The code uses no named prepared statements |
| 11 | **Region** fixed at `icn1` | `vercel.json` | Match it to the new Supabase region, or expect slower queries |
| 12 | **TLS** isn't verified: `rejectUnauthorized: false` | `db/index.js:27` | Works, but doesn't verify the server's identity |
| 13 | **Upload size.** Upload limits are up to 25 MB and JSON bodies 10 MB | `routes/*.js`, `app/api/index.js:157` | ASSUMPTION: Vercel's function body limit (about 4.5 MB) is lower, so larger uploads could fail. Test with real files |
| 14 | **Test safety guards** name the old production project | `PRODUCTION_REF`, `PRODUCTION_PROJECT_REF` | They won't protect the new production database until updated |
| 15 | **No migration tracking** | Section 4 | Nothing records what was applied. Keep a written log |
| 16 | **Session and login hardening.** Session tokens are stored unhashed, and `routes/auth.js` has no login throttling | `auth/middleware.js`, `routes/auth.js` | Plan these for after go-live if not sooner |
| 17 | **Stray files** | Section 3 | Don't carry them over |

### Not in the repository at all

- Any data migration. A new database starts empty, and historical import remains unauthorised: v4 is the last approved decision checkpoint, and no import is approved.
- A way to copy company settings, logo and signature. These must be re-entered or moved deliberately.
- Backup, monitoring or error-reporting setup.

## 11. Safe migration checklist

### Verified facts this checklist relies on

- The app needs `DATABASE_URL`, and `CLIENT_ORIGIN` should be set. AI keys are optional.
- It uses no Supabase Auth, Storage, Edge Functions, triggers or stored functions.
- Vercel Root Directory is the repository root, build `npm --prefix app run build`, output `app/client/dist`.
- `origin/main` (`b0ef698`) has the same files as the current HEAD, as of the last fetch on 2026-11-03.

### Assumptions to confirm

- [ ] The current production database matches these files. Hand-made differences can't be ruled out without reading it.
- [ ] `origin/main` hasn't moved since 2026-11-03.
- [ ] The Vercel dashboard has no overrides beyond `vercel.json`.
- [ ] Current Vercel variables are only those in section 6. Vercel wasn't read.
- [ ] The client is, or isn't, the same legal entity as the hardcoded identity.
- [ ] Supabase's current defaults for Data API access on new projects.
- [ ] Which Node version the new Vercel project defaults to, and that the build passes on it.
- [ ] The AI default models are still available, and the client accepts business data going to the provider.

### Phase A: prepare (no client systems touched)

- [ ] Decide who owns each account, and create the client's GitHub, Vercel and Supabase accounts under the client's control.
- [ ] Decide on the items in section 10, especially 2, 3, 4 and 7.
- [ ] Decide whether to carry Git history or start fresh. **Starting fresh from `origin/main` is the cleaner choice:** it drops old branches and project references in history. It's your call.
- [ ] Run a secret scanner on the code and history you will push.
- [ ] Put `inventory-ddl-for-test.sql` under version control, or add a proper combined setup migration.
- [ ] Remove real project references from docs and tests in the new copy.

### Phase B: GitHub

- [ ] Clone `origin/main` into a **new, clean folder**, so `confidential_import/`, `audit/`, `.env` files and stray files can't be included.
- [ ] Confirm the clone contains none of them, and add them to `.gitignore`.
- [ ] Push to the client's private repository, with its own branch protection.

### Phase C: new Supabase project (test first)

- [ ] Create a **test project** first, in the chosen region, with a new strong database password.
- [ ] Run the setup in this order, and stop on any error:
  1. `schema.sql`
  2. The inventory table SQL (`INVENTORY_DDL`, same as `inventory-ddl-for-test.sql`)
  3. `001_erp_missing_tables.sql`
  4. `002_quotation_module.sql`
  5. `003_delivery_challans.sql`
  6. The analysis table SQL (`ANALYSIS_DDL`), so its tables are protected from the start
  7. A new, reviewed step closing RLS and grants on the 23 open tables. **This doesn't exist yet**
- [ ] Confirm 33 tables, then compare columns against section 5.
- [ ] Confirm from outside the app that the public key can't read `app_user` or `session`.
- [ ] Repeat on the production project only after the test passes.

### Phase D: Vercel

- [ ] Import the client's repository with the Root Directory left at the repository root.
- [ ] Confirm the build, output and region settings in section 2, and set the Node version explicitly.
- [ ] Set `DATABASE_URL` (transaction pooler) and `CLIENT_ORIGIN` as encrypted variables. Use **separate databases for Preview and Production**.
- [ ] Add AI keys only if approved, using new keys owned by the client.
- [ ] Deploy a preview against the test database, then run the checks in Phase E.

### Phase E: verify on the test deployment

- [ ] `/api/health` responds, and the first-run setup works once and then refuses.
- [ ] Log in and out, and confirm the session cookie is `secure`.
- [ ] Create one of each record: company, product, quotation, PO, proforma invoice, delivery challan, sale report, warehouse and stock receipt. Confirm each survives a refresh.
- [ ] Confirm quotation and challan numbers increment.
- [ ] Generate each PDF, and check the identity, bank details, signature, fonts and images.
- [ ] Test Excel import and export with real file sizes.
- [ ] Confirm a staff user is refused on any route you decided to restrict.
- [ ] Test requests sequentially, not in large parallel bursts, which can exhaust the pooler.

### Phase F: production cutover

- [ ] Take a backup of the current production database, and keep the current deployment running until sign-off.
- [ ] Apply the setup to the production project, and keep a log of what ran and when.
- [ ] Deploy, and **complete the first-run admin setup immediately**.
- [ ] Enter company settings, logo and signature.
- [ ] Move data only under separate written approval, and reconcile row counts afterwards.
- [ ] Point the domain, and watch the logs.

### Phase G: after cutover

- [ ] Rotate or retire credentials that were used in old environments. Don't reuse them.
- [ ] Remove old people's access from the client's accounts.
- [ ] Confirm Supabase backups match the client's needs.
- [ ] Decide when to retire the old Vercel and Supabase projects, and only do so after a retention period and a verified backup.

## Inspection record

- **Read:** source files, SQL, package manifests, `vercel.json`, docs listings, and local Git refs and history.
- **Names only:** `.env.example` variable names, and the fact that `.env` paths exist.
- **Not read:** `app/client/.env`, `confidential_import/` contents, any live system.
- **Not run:** any build, install, test, migration, deployment, database connection or network call.
- **Written:** this file only. Git refs, branches and commits are unchanged, and this file appears as untracked.
