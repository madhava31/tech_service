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

## 3. Invalidation Rules by Mutation

| Mutation Event | Affected Invalidation Tags | Views Updated Automatically |
|---|---|---|
| **Create / Update / Delete Quotation** | `['dashboard', 'quotations', 'opportunities', 'products']` | Quotations list, Dashboard metrics, Pipeline donut, Attention counter, AppHeader badge |
| **Record Confirmed Sale / Upload Sales Batch** | `['dashboard', 'sales', 'opportunities', 'engineers']` | Dashboard revenue chart, top companies, Sales overview, Engineer performance targets |
| **Create / Update / Delete Company** | `['dashboard', 'companies', 'opportunities']` | Companies list, Company health overview, Quotation company dropdowns |
| **Create / Update / Import Products** | `['dashboard', 'products', 'inventory']` | Products list, Product intelligence, Quotation item selector |
| **Stock Inward / Inventory Transfer / Receipt** | `['inventory']` | Inventory overview, Stock list, Restock queue, Warehouse detail |
| **Set Sales Target / Update Engineer** | `['engineers', 'dashboard']` | Engineer list, Engineer sales report, Dashboard attribution |
| **Create / Update Purchase Order / Performa Invoice** | `['dashboard', 'quotations']` | Purchase orders list, Performa invoices list, Uninvoiced orders attention count |

---

## 4. Real-Time Event & Polling Strategy

### A. Real-Time Events (Server-Sent Events)
- **Transport**: Authenticated HTTP SSE (`GET /api/events`) with `withCredentials: true`.
- **Payload Schema**:
  ```json
  {
    "entity": "/api/quotations",
    "action": "POST",
    "tags": ["dashboard", "quotations", "opportunities"],
    "timestamp": 1729420000000
  }
  ```
- **Security Policy**: Zero database rows, user identifiers, or customer financial values are transmitted across the stream. The event is strictly a cache invalidation signal.
- **Heartbeat**: 25-second ping interval (`: ping\n\n`) to prevent proxy timeout drops.

### B. Controlled Polling Rationale
For environments where SSE streams are terminated by restrictive corporate proxies or intermittent cellular drops:
- **Fallback Recovery**: Every query checks `staleAt`. If an SSE event is missed while disconnected, window focus or tab navigation detects `staleAt: 0` and transparently revalidates against the server.
- **Tab Inactivity Safeguard**: Refetch intervals are automatically suspended when `document.hidden` is true, eliminating runaway background database load.

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

## 6. Local Setup and Test Commands

### Running the Smart Cache Test Suite
```bash
node app/server/scratch/test_smart_cache_suite.js
```
Expected output:
```
--- STARTING TECHNICON ERP SMART CACHE VERIFICATION SUITE ---
✓ Test 1: Initial load fetches required data
✓ Test 2: Returning to a menu reuses fresh cached data (0 network requests)
✓ Test 3: Concurrent identical requests are deduplicated
✓ Test 4: Stale cached data refreshes according to policy
✓ Test 5: Unchanged responses preserve object reference (prevents unnecessary React re-renders)
✓ Test 6: Changed responses update the cache and notify subscribers
✓ Test 7: Rapid filter changes generate isolated deterministic keys with no collisions
✓ Test 8: Successful mutations invalidate the correct queries
✓ Test 9: Failed operations do not corrupt cached data
✓ Test 10: Database notifications invalidate the intended resource only
✓ Test 11: Disconnects and missed events recover safely via revalidation
✓ Test 12: Background refresh lifecycle is cleaned up and does not leak promises
✓ Test 13: Logout and user switching cannot leak cached data
✓ Test 14: Server-side permissions remain authoritative with partitioned scopes

ALL 14/14 TESTS PASSED SUCCESSFULLY!
```

### Building the Client Application
```bash
npm --prefix app/client run build
```

### Running Local Development Environment
```bash
# In terminal 1 (API Server on port 4000):
cd app && npm run dev

# In terminal 2 (Vite Client on port 5173 with proxy):
cd app/client && npm run dev
```

---

## 7. Environment Variables Required

| Variable | Scope | Safe Placeholder Example | Description |
|---|---|---|---|
| `DATABASE_URL` | Backend (`app/server/.env`) | `postgresql://<db_user>:<db_pass>@<host>:5432/<db_name>` | PostgreSQL connection string with native LISTEN/NOTIFY support |
| `CLIENT_ORIGIN` | Backend | `http://localhost:5173` | Allowed CORS origin for local development |
| `PORT` | Backend | `4000` | Local Express API port |
| `VITE_API_URL` | Frontend | `/api` | Base API URL for Vite proxy |

---

## 8. Rollback Instructions

### Code Rollback
If any unexpected frontend or backend caching issue arises:
1. Revert to the prior branch commit:
   ```bash
   git checkout main
   ```
2. Rebuild the frontend bundle:
   ```bash
   npm --prefix app/client run build
   ```
3. Restart the Node.js API process.

### Database Migration Rollback
No destructive schema alterations, column removals, or table drops were introduced. The event mechanism utilizes PostgreSQL's built-in `pg_notify()` function and dedicated client channel listening without schema changes.

---

## 9. Remaining Risks & Follow-Up Work

1. **Proxy Buffering**: In environments behind aggressive enterprise reverse proxies (e.g. standard Nginx configurations without `proxy_buffering off`), SSE chunks may be buffered until buffer saturation. The `X-Accel-Buffering: no` header has been included in `handleSseConnection` to prevent this.
2. **Persistent Storage (IndexedDB)**: Current query caching is entirely in-memory for security and instant tab performance. If offline-first offline draft persistence is desired in the future, an encrypted IndexedDB adapter can be introduced for non-sensitive master data.
