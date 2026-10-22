# Technicon Services ERP — Smart Data Refresh & Caching Architecture

## 1. Architectural Overview

Technicon Services ERP implements a dual-tier, reactive smart data-refresh architecture combining:
1. **Client-Side Shared Query Cache (`app/client/src/lib/queryClient.ts`)**:
   - In-memory deterministic query cache partitioned by authenticated user scope (`u:${userId}:...`).
   - In-flight promise deduplication to eliminate duplicate concurrent network calls.
   - Deep structural equality comparison (`isDeepEqual`) to prevent unnecessary React re-renders when data has not changed.
   - Tag-based invalidation across views and components.
   - Complete cache purge on user logout or session switch to prevent data leakage.
2. **PostgreSQL Native Event Stream & Server-Sent Events (`app/client/api/_lib/db/events.js`)**:
   - Dedicated PostgreSQL client running outside the 20-connection query pool subscribing to `LISTEN technicon_events`.
   - Transactional `SELECT pg_notify('technicon_events', ...)` notifications that only fire when mutations successfully commit.
   - Authenticated, signal-only Server-Sent Events (SSE) stream (`/api/events`) pushing minimal tag invalidation signals to connected browser clients with zero confidential row payloads.
3. **Controlled Tab-Aware Background Refresh (`app/client/src/lib/useQuery.ts`)**:
   - Tab visibility detection (`document.hidden`) pausing non-essential polling when tabs are inactive.
   - Window focus revalidation ensuring fresh state upon returning to the browser.

---

## 2. Cache Keys & Freshness Rules

| Resource / Query | Deterministic Cache Key Format | Freshness TTL (`staleTime`) | Garbage Collection (`cacheTime`) | Invalidation Tags |
|---|---|---|---|---|
| **Dashboard Metrics** | `['dashboard', 'main', { period, start, end }]` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `quotations`, `sales` |
| **Attention Queue** | `['dashboard', 'attention']` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `attention`, `quotations`, `companies` |
| **Follow-Ups** | `['dashboard', 'followUps']` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `followUps`, `quotations` |
| **Pipeline Stages** | `['dashboard', 'pipeline', { start, end }]` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `pipeline`, `quotations` |
| **Draft Quotations** | `['dashboard', 'draftQuotations']` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `quotations` |
| **Recent Activity** | `['dashboard', 'recentActivity']` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `recentActivity`, `quotations` |
| **Business Health** | `['dashboard', 'businessHealth']` | 60,000 ms (60s) | 300,000 ms (5 min) | `dashboard`, `businessHealth` |
| **Quotations List** | `['quotations', 'list', params]` | 30,000 ms (30s) | 300,000 ms (5 min) | `quotations` |
| **Companies List** | `'companies_all'` | 60,000 ms (60s) | 300,000 ms (5 min) | `companies` |
| **Products List** | `'products_all'` | 60,000 ms (60s) | 300,000 ms (5 min) | `products` |
| **Product Intelligence** | `['products', 'intelligenceSummary']` | 60,000 ms (60s) | 300,000 ms (5 min) | `products`, `intelligence` |
| **Engineers Summary** | `['engineers', 'performance', fiscalYear]` | 60,000 ms (60s) | 300,000 ms (5 min) | `engineers` |
| **Warehouse Master** | `'warehouses_true'` | 300,000 ms (5 min) | 600,000 ms (10 min) | `inventory`, `warehouses` |

---

## 3. Route-to-Invalidation-Tag Matrix

| Route Pattern / Mutation Entity | Affected Invalidation Tags | Views Automatically Updated |
|---|---|---|
| **`/api/quotations*`** (Create, update, delete, status change) | `['quotations', 'dashboard', 'opportunities']` | Quotation list, Dashboard metric cards, Pipeline donut, Attention queue, AppHeader badges |
| **`/api/sale-reports*` / `/api/sales*`** (New report, batch sync, record change) | `['sales', 'dashboard', 'opportunities', 'engineers', 'reports']` | Dashboard revenue trend, Top accounts, Sales overview, Engineer quotas & reports |
| **`/api/companies*`** (Create, edit, delete, bulk delete) | `['companies', 'dashboard', 'opportunities']` | Company directory, Customer health matrix, Quotation customer selects |
| **`/api/products*`** (Create, edit, import commit) | `['products', 'dashboard', 'inventory']` | Product master, Product intelligence, Quotation part search |
| **`/api/inventory*` / `/api/stocks*` / `/api/warehouses*`** (Stock inward, transfer, reservation) | `['inventory', 'products', 'dashboard']` | Inventory overview, Stock lists, Restock alerts, Warehouse details |
| **`/api/engineers*`** (Target adjustments, assignments) | `['engineers', 'dashboard', 'sales']` | Sales engineer directory, Attributed performance, Quota achievement |
| **`/api/purchase-orders*`** (Create, update, link) | `['purchase_orders', 'dashboard', 'quotations']` | Purchase orders list, Uninvoiced orders attention count |
| **`/api/performa-invoices*`** (Create, update, convert) | `['performa_invoices', 'dashboard', 'quotations']` | Performa invoices table, Quotation financial tracking |
| **`/api/firms*`** (Multi-firm configuration) | `['firms', 'dashboard', 'settings']` | Firm dropdowns, Multi-firm settings page |
| **`/api/branches*`** (Branch details & doc sequence settings) | `['branches', 'firms', 'dashboard', 'settings']` | Branch selector, Document numbering presets |
| **`/api/settings*`** (Company info, tax rules) | `['settings', 'dashboard', 'quotations']` | Settings view, Tax calculations in new quotes |
| **`/api/admin*`** (User permissions, role changes) | `['admin', 'engineers', 'dashboard']` | Admin user table, Engineer attribution controls |
| **`/api/reports*`** (Bulk sales deletion, queue cleanup) | `['reports', 'sales', 'companies', 'products', 'dashboard']` | Review queue, Company sales history, Product sales totals |
| **`/api/opportunities*`** (Pipeline stage progressions) | `['opportunities', 'dashboard']` | Opportunity board, Stage conversion analytics |

---

## 4. Real-Time Event & Polling Strategy

### A. Runtime Environment Architecture: Hybrid Serverless & Persistent Node.js
Technicon ERP supports two deployment environments:
1. **Serverless (Vercel)**:
   - Serverless functions freeze between invocations and cannot sustain long-lived sockets.
   - `initPgNotificationListener` detects `process.env.VERCEL` and gracefully disables persistent LISTEN sockets, preventing database connection exhaustion.
   - `/api/events` returns `501 Not Implemented (mode: polling)`.
   - The frontend automatically falls back to window-focus revalidation, tab-visibility detection, and smart TTL cache invalidation.
2. **Persistent Node.js Service (Option B / VPS / Docker / `app/server/src/index.js`)**:
   - Opens a dedicated `pg.Client` listening to `technicon_events` outside the 20-connection pool.
   - Powers continuous HTTP SSE streams (`/api/events`) with 25s heartbeat pings (`: ping\n\n`) and `X-Accel-Buffering: no`.

### B. Mutation Commit Boundary
Invalidations are never emitted prematurely. Middleware in `app/api/index.js` attaches a listener to `res.on('finish')`:
- Invalidation signals broadcast **only if** `res.statusCode >= 200 && res.statusCode < 300` and `!res.locals.mutationFailed`.
- Failed authentications (401/403), validation rejections (400), and rolled-back database errors (500) emit **zero** invalidation events.

### C. In-Process Duplicate Event Suppression
When a local mutation broadcasts an event:
1. It assigns a unique ID (`eventId: ${pid}-${timestamp}-${rand}`) and records it in `recentLocalEventIds`.
2. It pushes the event directly to local SSE subscribers.
3. It executes `SELECT pg_notify('technicon_events', ...)`.
4. When PostgreSQL echoes the notification back to this process, the listener checks `recentLocalEventIds.has(payload.id)` and drops the duplicate.
5. Other worker processes (e.g. horizontal instances) receive the notification and deliver it to their connected clients, ensuring cross-process delivery without local duplicates.

### D. Request Cancellation and Subscriber Ref-Counting
1. `AbortSignal` is accepted and forwarded through `cachedFetch`, `api.companies.list`, `api.products.list`, `api.quotations.list`, `api.dashboard.get`, and `searchGlobalApi` to `fetch()`.
2. `queryClient.cancelQuery(key, force = false)` uses subscriber reference counting (`getActiveSubscribers()`). In-flight deduplicated requests are NOT aborted if other components are still waiting for the result.
3. `AbortError` is treated as user cancellation rather than a query failure, preserving existing cache state.

---

## 5. Multi-User Security & Partitioning

1. **User-Scoped Query Keys**:
   All internal cache keys are partitioned using `u:${userId}:<queryKey>`. If User A is logged in as an administrator and views confidential executive summaries, those cached entries are strictly inaccessible to User B.
2. **Logout Purge**:
   When `api.auth.logout()` is called, `queryClient.clear()` immediately:
   - Aborts all in-flight requests.
   - Clears all cached memory maps.
   - Resets user scope to `'anon'`.
   - Clears the legacy fallback cache.

---

## 6. Test Suites and Commands

### 1. Smart Cache Verification Suite
```bash
node app/client/scripts/test-smart-cache.js
```
*Validates 14/14 client caching guarantees: key serialization, deduplication, stale-while-revalidate, structural equality, tag invalidation, and session purge.*

### 2. Integration Verification Suite
```bash
node app/client/scripts/test-integration-suite.cjs
```
*Validates 8/8 integration requirements: real HTTP SSE stream headers, handshake & heartbeat, mutation finish commit timing, duplicate suppression, AbortSignal forwarding, subscriber ref-counting, and complete route matrix.*

### 3. Production Frontend Build
```bash
npm --prefix app/client run build
```
*Verifies 0 TypeScript errors and builds the production bundle.*

---

## 7. Rollback Instructions

1. **Code Rollback**:
   ```bash
   git checkout origin/main
   npm --prefix app/client run build
   ```
2. **Database Rollback**:
   No schema changes or table alterations were introduced. All real-time signals use PostgreSQL native `pg_notify()` channels.

