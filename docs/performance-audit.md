# Technicon Services ERP — Performance & Data-Refresh Audit

**Audit Date**: October 20, 2026  
**Auditor**: Antigravity Senior Engineering Team  
**Project Root**: `d:\3-1\Projects\Tech_Services\tech_service`  
**Current Branch**: `main` (Verified clean Git baseline; all pre-existing modifications preserved)  
**Database**: PostgreSQL 16 (via `pg.Pool`, connection string `DATABASE_URL`)  
**Deployment Target**: Node.js Express API (`app/api/index.js` & `app/server/src/app.js`), React 18 SPA (`app/client/src`)

---

## 1. Executive Summary

Technicon Services ERP is a dual-tier business application managing sales quotations, purchase orders, performa invoices, sales reports, inventory tracking, and sales engineer performance. 

The application currently suffers from performance bottlenecks caused by:
1. **Unshared Client State**: Menu navigation between routes completely unmounts page components, discarding their local state and re-fetching identical data every time a user visits or returns to a view.
2. **Ad-Hoc, Incomplete Caching**: While an in-memory `cacheStore` exists in `app/client/src/api.ts`, it is wired to only 4 query methods (`companies_all`, `products_all`, `warehouses_*`, `engineers_*`). Heavy analytical endpoints (`dashboard`, `pipeline`, `healthSummary`, `intelligenceSummary`, `reports`, `quotations`) bypass client cache completely.
3. **Multi-User Data Leakage Risk**: The existing client cache is not partitioned by user session or tenant, and `auth.tsx` does not clear the cache store upon logout or account switching.
4. **Backend In-Memory Cache Invalidation Gaps**: The backend `apiCache.js` (used in `app/client/api/_lib/cache/apiCache.js`) provides 30s TTLs, but lacks client push notifications. Stale responses persist until TTL expiration, or repeated client polls cause avoidable database query load.
5. **Absence of Real-Time Change Notifications**: There is no Server-Sent Events (SSE) or WebSocket channel to broadcast database mutations to connected clients. PostgreSQL native `LISTEN` / `NOTIFY` is not yet utilized.

---

## 2. Findings by File & Function

### 2.1 Frontend Architecture & Repeated Requests

| File Path | Function / Component | Issue Description | Root Cause |
|---|---|---|---|
| `app/client/src/pages/Dashboard.tsx` | `fetchAllData()` (lines 229–284) | 6 distinct API requests fired concurrently on mount: `/api/dashboard`, `/api/dashboard/attention`, `/api/dashboard/draft-quotations`, `/api/dashboard/pipeline`, `/api/dashboard/follow-ups`, `/api/dashboard/recent-activity`. | Component unmounts on navigation. Returning to `/` re-executes all 6 queries from scratch even 3 seconds later. |
| `app/client/src/pages/Quotations.tsx` | `fetchPage()` (lines 98–130) | Full paginated fetch and stage count aggregation on every mount and filter change. | No cache reuse across route transitions. Rapid filter adjustments can cause race conditions if requests return out of order. |
| `app/client/src/pages/Companies.tsx` | `loadData()` | Calls `api.companies.healthSummary()` on every mount. | Heavy aggregation across `sales_record` grouping all companies is recomputed on every visit to the Companies page. |
| `app/client/src/pages/Products.tsx` | `loadData()` | Calls `api.products.intelligenceSummary()` on every mount. | Full product intelligence metric aggregation is re-calculated and transferred over the wire on every visit. |
| `app/client/src/pages/EngineerList.tsx` | `loadData()` | Fetches performance summary for fiscal year on every mount. | Expensive calculation of accepted quotes, confirmed sales, shortfall, and achievement percentages is repeatedly queried. |
| `app/client/src/pages/BusinessHealth.tsx` | `fetchHealth()` | Mount effect fetches `/api/dashboard/business-health`. | Uncached aggregation of 5 health components computed on every visit. |
| `app/client/src/api.ts` | `cachedFetch()` (lines 41–61) | Primitive `Map<string, CacheEntry>` with no cache tagging, no stale-while-revalidate, no user scoping, no reactive subscription mechanism, and no garbage collection. | Caching was partially retrofitted for 4 endpoints without an architectural design. |
| `app/client/src/auth.tsx` | `logout()` (lines 53–56) | Clears auth state and calls `/api/auth/logout`, but never calls `clearCache()`. | Cached customer, product, and quotation data remains accessible in browser memory if a different user logs in. |

### 2.2 Backend Architecture & Database Connection Risks

| File Path | Function / Route | Issue Description | Risk |
|---|---|---|---|
| `app/client/api/_lib/db/index.js` | `pool` config (lines 15–26) | Max pool size = 20. | Under high concurrent traffic with 6+ requests per page load, 4 simultaneous users navigating tabs can saturate the 20-connection pool. |
| `app/client/api/_lib/routes/dashboard.js` | `getInactiveCustomers()`, `getSalesRecordsNeedingReview()` | Multiple separate queries executed per dashboard visit without server-side batching. | Increased round-trips to PostgreSQL and query pool contention. |
| `app/api/index.js` | Mutation Invalidation middleware (lines 72–79) | Simple path-based tag invalidation on `POST`/`PUT`/`DELETE` (`apiCache.invalidateTags(...)`). | In-memory only; does not inform other worker processes or connected frontend clients. |

---

## 3. Root Causes of Repeated Requests

1. **Local Component Lifecycle Coupling**: State is owned exclusively by page components via `useState`. When the user navigates from Dashboard to Quotations to Companies, the React tree unmounts the previous page component, destroying its state. When navigating back, the page mounts fresh, creating new closures and re-triggering network queries.
2. **Lack of a Unified Query Cache**: Without a centralized reactive client cache (similar to a lightweight TanStack Query pattern tailored for vanilla TS/React), pages have no shared store to check if fresh data already exists in memory.
3. **No Reactive Cache Invalidation**: When a mutation occurs (e.g. creating a quotation or updating a company), other views (e.g. Dashboard counts, pipeline charts, attention queues) are unaware unless explicitly refetched, forcing components to reload everything on every entry.

---

## 4. Data Freshness and Consistency Risks

1. **Stale Data on Navigation**: If data is cached without an invalidation mechanism, a quotation updated on `/quotations/1` would remain stale if the user returns to `/quotations` or `/dashboard`.
2. **Race Conditions on Fast Filtering**: In pages with search/filter inputs, older network responses with high latency can arrive *after* newer responses, overwriting fresh data with stale results.
3. **Cross-User Data Pollution**: Single shared cache store in memory without user ID or authorization scoping means if an admin logs out and a staff user logs in, cached administrative data or previous session data could be displayed.

---

## 5. Database and Connection Pool Risks

1. **Connection Pool Exhaustion**: PostgreSQL connection pool defaults to 20 connections (`max: 20`). A single dashboard load launches 6 concurrent requests. If multiple users load dashboards concurrently while background tasks run, pool connections can be starved, leading to `connectionTimeoutMillis: 5000` timeouts.
2. **LISTEN Connection Starvation**: A PostgreSQL `LISTEN` channel requires a dedicated persistent connection that cannot be shared with ordinary pooled transactional queries. If an ordinary pooled connection is hijacked for `LISTEN`, it permanently reduces available pooled connections.

---

## 6. Baseline Request Counts & Measurement

Representative navigation sequence: **Login → Dashboard → Quotations → Companies → Products → Dashboard**

| Action / Route | Baseline Requests Before Optimization | Target Requests with Smart Caching & Dedup |
|---|---|---|
| 1. Dashboard initial load | 6 requests (`dashboard`, `attention`, `draftQuotations`, `pipeline`, `followUps`, `recentActivity`) | 6 requests (cached, deduplicated) |
| 2. Navigate to Quotations | 2 requests (`quotations?page=1`, stage counts) | 2 requests (cached with 30s fresh TTL) |
| 3. Navigate to Companies | 2 requests (`companies`, `health-summary`) | 1 request (reusing fresh companies list) |
| 4. Navigate to Products | 2 requests (`products`, `intelligence-summary`) | 1 request (reusing fresh products list) |
| 5. Return to Dashboard (within 60s) | 6 requests (complete re-fetch) | **0 network requests** (served instantly from fresh cache) |
| 6. Return to Quotations (within 30s) | 2 requests (complete re-fetch) | **0 network requests** (served instantly from fresh cache) |
| **Total Requests for Sequence** | **18 requests** | **10 requests** (~45% immediate reduction on initial tour; 100% reduction on subsequent tab flips) |

---

## 7. Proposed Implementation Plan

### Phase 2: Shared Client Data-Access & Smart Cache Architecture
1. **Develop `queryClient.ts`**:
   - Deterministic cache keys with user authorization scoping: `${userId}:${resource}:${hash(params)}`.
   - Freshness lifecycle: `fresh` (within staleTime), `stale` (serves cached, revalidates in background), `fetching`, `error`.
   - In-flight request deduplication: identical concurrent requests share the exact same promise.
   - Deep structural equality comparison (`shallowEqual` / `fastDeepEqual`) to preserve object identities and prevent unnecessary React re-renders.
   - Event emitter for cache updates and tag-based invalidations.
   - Automatic cache eviction on logout (`queryClient.clear()`).
2. **Create Reusable Query Hooks**:
   - `useQuery({ queryKey, queryFn, staleTime, cacheTime, refetchOnWindowFocus })`.
   - `useMutation({ mutationFn, onMutate, onSuccess, onError, invalidateTags })`.
3. **Debounced Search & Request Cancellation**:
   - `useDebounce` hook with `AbortController` cancellation to eliminate in-flight race conditions.

### Phase 3: PostgreSQL Change Notification & Server-Sent Events (SSE)
1. **Dedicated PostgreSQL Notification Listener**:
   - Create a dedicated managed listener using `pg.Client` (outside the 20-connection pool) listening to `technicon_events`.
   - Reconnect loop with exponential backoff on network blips.
2. **SSE Real-Time Push Endpoint (`/api/events`)**:
   - Authenticated SSE stream sending minimal change payloads: `{ entity: 'quotation', action: 'create', id: 123, tags: ['quotations', 'dashboard'] }`.
   - Zero confidential business data in notification payload (signal-only architecture).
   - Authenticated client connection management with heartbeat (keep-alive ping every 25s).
3. **Client-Side Real-Time Invalidation**:
   - SSE client hook automatically invalidates matching tags in `queryClient`.

### Phase 4: Controlled Background Refresh
1. Focus-based and visibility-aware revalidation: pauses polling when tab is hidden (`document.hidden`).
2. Resource-specific refresh intervals (e.g. Dashboard metrics: 60s; Settings: 5m; Quotations: on-demand or SSE-driven).

### Phase 5: Mutation Invalidation
1. Automatic invalidation of affected tags upon create, update, delete, status change.
2. Safe optimistic rollbacks.

### Phase 6: Verification & Testing
1. Comprehensive tests verifying cache hits, request deduplication, tag invalidation, logout clearance, SSE event processing, and structural comparison.

---

## 5. Post-Audit Findings & Resolutions (Target Commit `92ab3fb`)

Following the initial implementation in commit `92ab3fb`, a rigorous read-only audit revealed 6 critical architectural and operational issues. Below is each finding and its resolution:

### Finding 1: Vercel Serverless vs. Realtime Runtime Conflict
- **Issue**: `app/vercel.json` routes `/api/(.*)` to `/api/index.js` as serverless lambdas. Long-running PostgreSQL `LISTEN` sockets and continuous SSE streams freeze or abort in serverless environments, risking unmanaged connection leaks and execution timeouts.
- **Resolution**: Implemented runtime environment detection (`isServerless = !!process.env.VERCEL`). When deployed in serverless mode:
  1. Unmanaged persistent `LISTEN` socket initialization is cleanly bypassed in `initPgNotificationListener`.
  2. The `/api/events` endpoint gracefully informs the client (`501 Not Implemented, mode: polling`), and the frontend safely falls back to window-focus and tab-visibility revalidation with exponential backoff.
  3. When hosted via persistent Node.js instances (Docker / VPS / `app/server/src/index.js`), the full dedicated `pg.Client` `LISTEN` listener and SSE streaming activate automatically.

### Finding 2: Premature Mutation Notification Timing
- **Issue**: Middleware in `app/api/index.js` broadcasted invalidation events *before* passing execution to route handlers (`next()`). Unauthenticated requests (401/403), invalid payloads (400), or database rollbacks (500) broadcasted false invalidations.
- **Resolution**: Moved invalidation emission to `res.on('finish')`. Events are emitted **only** when `res.statusCode >= 200 && res.statusCode < 300` and `!res.locals.mutationFailed`, guaranteeing that database writes have successfully committed before any invalidation signal is published.

### Finding 3: Missing Invalidation Coverage
- **Issue**: Mutations for secondary resources (`firms`, `branches`, `settings`, `admin`, `reports`) lacked tag mapping, resulting in stale data on configuration changes.
- **Resolution**: Implemented comprehensive `getMutationTags(path, customTags)` with explicit allowlist matching covering all 15 ERP entity groups.

### Finding 4: In-Process Duplicate Event Delivery
- **Issue**: `broadcastEvent` emitted immediately to the local in-memory event bus *and* executed `pg_notify`. When PostgreSQL echoed the notification back to the same process, the listener re-emitted the event, causing local clients to receive duplicate invalidations.
- **Resolution**: Added unique event tracking (`eventId: ${pid}-${timestamp}-${rand}`) in `recentLocalEventIds` with automatic TTL pruning. When a notification arrives from PostgreSQL, `events.js` checks if the ID was originated locally; if so, it suppresses the duplicate echo while preserving cross-process delivery.

### Finding 5: Incomplete Request Cancellation & Shared Query Ref-Counting
- **Issue**: `cancelQuery` indiscriminately aborted queries even if other concurrent components were awaiting the deduplicated promise. `api.ts` methods also lacked `AbortSignal` parameters.
- **Resolution**: Added subscriber reference counting in `queryClient.ts` (`getActiveSubscribers()`). Shared in-flight queries are preserved if other active subscribers still exist. Threaded optional `AbortSignal` through `cachedFetch`, `api.companies.list`, `api.products.list`, `api.quotations.list`, `api.dashboard.get`, and `searchGlobalApi` into `fetch()`. Handled `AbortError` gracefully as cancellation rather than an application failure.

### Finding 6: Missing Real Non-Production Integration Tests
- **Issue**: Previous test suite relied on a simulated runner rather than real HTTP/SSE endpoints.
- **Resolution**: Created `app/client/scripts/test-integration-suite.cjs` executing real HTTP SSE streaming, header validation, heartbeat handling, response-finish timing, and cross-session cache isolation.

---

## 6. Test Results & Verification

- **Smart Cache Verification Suite (`app/client/scripts/test-smart-cache.js`)**:
  - `14/14` tests passed cleanly (deterministic keys, deduplication, stale-while-revalidate, structural equality, tag invalidation, session boundary purge).
- **Integration Test Suite (`app/client/scripts/test-integration-suite.cjs`)**:
  - `8/8` applicable tests passed cleanly (tag allowlisting, full route matrix, mutation commit finish timing, duplicate suppression, real HTTP SSE streaming, AbortSignal propagation, subscriber ref-counting, session isolation).
  - Test 9 (Real PostgreSQL LISTEN/NOTIFY against dedicated non-production test DB): **NOT RUN** (No designated non-production test database specified in `TEST_DATABASE_URL`; production safety policy strictly enforced).
- **TypeScript Production Build (`npm --prefix app/client run build`)**:
  - `tsc -b`: 0 errors.
  - `vite build`: Completed cleanly in 32.18s (2722 modules transformed).

