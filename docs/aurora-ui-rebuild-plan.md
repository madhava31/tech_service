
# TECHNICON CRM — "Aurora" UI Rebuild

## Context

**Why this is happening.** The user supplied a reference dashboard (`image.pn
g` — the "payno" fintech
dashboard: soft blue-lavender gradient canvas, very rounded white cards, deep-navy primary, a narrow
icon rail on the far left) and asked for the CRM to adopt that look while every existing feature keeps
working.

**What exploration found — this is not a restyle, it's the design system the app never got.**

- `app/client/src/styles.css` is the *only* stylesheet (141 lines). It contains Tailwind directives,
  two HSL theme blocks, chat-widget rules, and chart keyframes.
- **25 of 26 pages reference CSS classes that do not exist anywhere.** `Quotations.tsx`,
  `QuotationNew.tsx`, `QuotationDetail.tsx`, `Companies.tsx`, `Products.tsx`, `Reports.tsx`,
  `Admin.tsx`, `Settings.tsx`, `Login.tsx`, `Setup.tsx` and the 7 drill-down pages use `.card`,
  `.btn`, `.toolbar`, `.filter-bar`, `.field`, `.row`, `.item-row`, `.totals`, `.badge`,
  `.pagination`, `.error`, `.muted`, `.auth-screen`, `.follow-up-*`, `.status-tabs`. **None are
  defined.** Those pages currently render as raw unstyled HTML.
- Only `pages/Dashboard.tsx` is styled — a dark theme with ~60 hardcoded hex values
  (`#101312`, `#171918`, `#B8F23A`), which the reference image replaces with a light one.
- The shell (`components/layout/AppShell.tsx` → `app-sidebar.tsx` + `app-header.tsx`) is a dark-green
  `#003B2B` full-width sidebar — structurally the opposite of the reference's floating icon rail.
- Substantial dead code: a second unused `layout/Sidebar.tsx`/`Header.tsx`/`navLinks.ts` trio, plus
  support-desk template leftovers (`team-on-duty`, `csat-responses-chart`,
  `conversation-volume-chart`, `channel-breakdown-chart`, `first-reply-time-chart`,
  `recent-conversations`, `support-activity`, `stats`, `delta`, `indicator`, `latest-change`,
  `app-shell`, `dashboard`, `dashboard-skeleton`, `nav-user`, `nav-group`, `app-breadcrumbs`,
  `custom-sidebar-trigger`, `app-shared`).

**Outcome.** One coherent light "Aurora" design system in the reference's visual language, applied to
all 26 pages, with the entire functional surface (`src/api.ts`: companies, products, quotations,
purchase orders, performa invoices, dashboard, reports, settings, imports, auth, admin, AI,
opportunities) behaving exactly as it does today.

**Decisions taken with the user:** adapt the reference's *visual language* to real CRM content (no
fake "Send Money"/"Credit Card" widgets); restyle the **whole app**; verify via install + typecheck +
build + dev-server route walk, then hand over a per-page manual checklist (no DB credentials
available, `node_modules` not installed).

---

## Non-negotiable invariant

**Every phase is presentation-only.** For each file touched:

- Every `api.*` call, `onClick`, `onChange`, `onSubmit`, `useEffect` and its dependency array, and
  every piece of `useState` survives unchanged.
- Preserve verbatim the logic that carries a documented rationale:
  - `pages/Quotations.tsx:13-40` — `getDateRange`/`matchesDate` do pure `YYYY-MM-DD` string
    comparison specifically to dodge a timezone off-by-one. Do not "improve" it into `Date` math.
  - `pages/QuotationDetail.tsx:22` — `busyAction` is a single shared in-flight slot; keep the
    one-mutation-at-a-time property.
  - `components/Pagination.tsx:7-9` — deliberately shared, not inlined.
- Loading, empty, and error branches keep their trigger conditions; only their markup changes.
- If a phase tempts a behavioural change, stop and raise it rather than folding it in.

---

## Design tokens ("Aurora")

Derived from the reference image. Defined once in `styles.css` `:root`, surfaced through
`tailwind.config.js`.

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#F4F6FC` | page base |
| `--canvas-wash` | `linear-gradient(180deg,#DFE6F8 0%,#F0F3FB 38%,#F4F6FC 100%)` | top-of-page aurora wash |
| `--surface` | `#FFFFFF` | cards |
| `--surface-sunken` | `#F7F8FC` | inputs, table zebra, inner wells |
| `--ink` | `#141B34` | primary text, big numerals |
| `--ink-muted` | `#7A839E` | labels, secondary text |
| `--ink-faint` | `#A8AEC4` | placeholders, axis ticks |
| `--navy` | `#25417A` | primary brand |
| `--navy-bright` | `#3A5EA8` | hover / gradient stop |
| `--navy-grad` | `linear-gradient(135deg,#3A5EA8,#25417A)` | primary buttons, hero card |
| `--indigo` | `#6B78D6` | chart series 2, secondary accent |
| `--success` | `#2FBF71` | positive deltas, accepted |
| `--warning` | `#E8A33D` | due-soon, sent, draft |
| `--danger` | `#E5484D` | rejected, overdue, destructive |
| `--hairline` | `rgba(20,27,52,0.07)` | card + table borders |
| `--shadow-card` | `0 2px 12px rgba(20,27,52,0.06)` | resting card |
| `--shadow-lift` | `0 8px 24px rgba(20,27,52,0.10)` | hover / floating rail |
| `--radius-card` | `20px` | cards, rail container |
| `--radius-ctl` | `12px` | inputs, small buttons |
| `--radius-pill` | `999px` | badges, primary CTAs, filter chips |

Type: Inter (already preloaded in `index.html`). Scale — hero numeral `clamp(2rem,3.5vw,2.75rem)/800`
with `-0.02em` tracking; card title `15px/700`; body `13px/500`; label `11px/700` uppercase
`0.06em` tracking.

Reduced-motion: extend the existing `@media (prefers-reduced-motion: reduce)` block in
`styles.css:132-141` to cover new transitions.

Single light theme. The `.dashboard-analytics-theme` dark block (`styles.css:50-68`) is removed.

---

## Phase 0 — Store this plan in the repo

Write this document in full to `docs/aurora-ui-rebuild-plan.md` so it is version-controlled alongside
the code and survives the session. Do this before any code change, then keep it current: as each
phase below completes, tick it off in that file.

---

## Phase 1 — Token layer + legacy-class shim  *(highest leverage; do first)*

**Files:** `app/client/src/styles.css` (rewrite), `app/client/tailwind.config.js` (extend).

1. Replace the two HSL theme blocks with the Aurora token set above. Keep the existing
   HSL-var → Tailwind indirection so shadcn primitives (`bg-card`, `text-muted-foreground`,
   `border-border`) resolve to Aurora values with no churn in `ui/*`.
2. Extend `tailwind.config.js` with the new colors, `borderRadius` (`card`, `ctl`, `pill`),
   `boxShadow` (`card`, `lift`), `backgroundImage` (`aurora`, `navy`).
3. **Implement the entire legacy class contract** in `@layer components`: `.card`, `.btn`
   (+ `.secondary` `.danger` `.small`), `.toolbar`, `.filter-bar`, `.filter-count`, `.field`,
   `.row`, `.item-row`, `.totals`, `.badge` (+ per-status `.draft`/`.sent`/`.accepted`/`.rejected`/
   `.scheduled`/`.completed`/`.cancelled`), `table`/`th`/`td`, `.table-scroll`, `.pagination`,
   `.pagination-indicator`, `.error`, `.muted`, `.loading-text`, `.status-tabs`, `.auth-screen`,
   `.auth-card`, `.brand*`, `.follow-up-form`, `.follow-up-list`, `.follow-up-item`,
   `.follow-up-meta`, `.follow-up-date`, `.follow-up-notes`, `.follow-up-outcome`,
   `.follow-up-actions`, `.follow-up-complete-form`.

**Why this ordering matters:** it lifts all 25 broken pages to a correct, on-brand baseline with
**zero JSX edits and therefore zero functional risk**. Later phases refine specific pages from a
working baseline instead of rewriting blind. Grep for the full class list with:
`rg -o 'className="[^"]*"' src/pages src/components | sort -u`

---

## Phase 2 — App shell (rail + top bar)

**New:** `src/components/layout/RailSidebar.tsx`, `src/components/layout/TopBar.tsx`
**Modified:** `src/components/layout/AppShell.tsx`

- `AppShell` renders the aurora wash (`bg-aurora` on a fixed backdrop), the floating rail, and a
  `max-w-[1480px]` content column. Keeps `useAuth()` guard and `<FloatingChat />` mounting.
- `RailSidebar` — ~72px white floating pill (`rounded-card`, `shadow-lift`), icon-only, active item a
  filled navy rounded square. Radix tooltip on hover; groups with a submenu (Reports) open a hover
  flyout. **Route list is the source of truth in `src/components/layout/navLinks.ts`** — reuse it
  (it already holds all routes incl. the `Reports` group and `adminNavLink`) rather than re-hardcoding
  what `app-sidebar.tsx` duplicated. Mobile: rail collapses to a bottom sheet via existing
  `hooks/use-mobile.tsx`.
- `TopBar` — wordmark left; global search input; bell wired to the existing `api.dashboard.attention()`
  for an unread count linking to `item.route`; avatar menu (username, role, Logout → `logout()` from
  `auth.tsx`).
- Keep the `ui/sidebar.tsx` shadcn primitive only if `RailSidebar` genuinely uses it; if the rail is
  simpler standalone, drop the dependency and note it for Phase 7 cleanup.

---

## Phase 3 — Shared primitives

**Upgrade in place** (all consumers keep working — these are additive style changes):
`ui/card.tsx` (→ `rounded-card border-hairline shadow-card`, `p-5` header/content rhythm),
`ui/button.tsx` (default → navy gradient `rounded-pill`; add `soft` and `chip` variants; sizes
`sm`/`default`/`lg`/`icon`), `ui/input.tsx`, `ui/badge.tsx` (status variants matching the CSS badge
statuses), `ui/table.tsx`, `ui/select.tsx`, `ui/skeleton.tsx`.

**New, to kill repetition across pages:**

| Component | Replaces | Used by |
|---|---|---|
| `ui/page-header.tsx` | the `.toolbar` + `<h2>` + action-link pattern | every page |
| `ui/stat-tile.tsx` | KPI tiles (label / big numeral / delta pill / footnote) | Dashboard, BusinessHealth, CustomerHealthOverview, ProductIntelligenceOverview, Admin |
| `ui/filter-bar.tsx` | the `.filter-bar` search + selects + clear + count block | Quotations, Companies, Products, PurchaseOrders, PerformaInvoices |
| `ui/data-table.tsx` | the repeated `<table>` + empty-row markup | all 14 list pages |
| `ui/empty-state.tsx` | `<td colSpan>No X yet.</td>` rows | list pages |
| `ui/alert.tsx` | `<div className="error">` | every page with `error` state |

Restyle `components/Pagination.tsx` and `components/SearchableSelect.tsx` (keep both APIs identical —
`SearchableSelect` is load-bearing in `QuotationNew.tsx`).

---

## Phase 4 — Dashboard

**File:** `src/pages/Dashboard.tsx` (full visual rewrite, data layer untouched).

Keep `fetchAllData()` and all six parallel calls (`get`, `attention`, `draftQuotations`, `pipeline`,
`followUps`, `recentActivity`), every independent error state, every per-widget `WidgetErrorState`
retry, and every skeleton branch. Strip the `dashboard-analytics-theme` wrapper and all `#171918`-era
hex.

Layout per the approved sketch — 12-col grid, three visual columns:

- **Left (4):** hero card — accepted revenue as the big numeral with a delta pill, plus a Quick
  Actions icon row (New Quotation, New Company, Import Products, Reports); below it, Recent Activity
  as avatar-initial rows (from `recentActivity`).
- **Centre (5):** two small stat tiles (Open Quotations, Pipeline Value); Revenue Analytics card with
  `RevenueLineChart`; Follow-Ups card (overdue + due-today rows from `followUps`).
- **Right (3):** navy gradient CTA card (New Quotation); Pipeline donut (`PipelineDonutChart`); Key
  Insights (from `attention`).

Recolor the three custom SVG charts — `RevenueLineChart.tsx`, `PipelineDonutChart.tsx`,
`HorizontalBarChart.tsx` — to the Aurora series ramp (`--navy`, `--indigo`, `--success`, `--warning`,
`--danger`). Drive colors from tokens rather than the current `color="#B8F23A"` prop literals; keep
each component's props signature so Dashboard and the intelligence pages don't break. The
`.revenue-line-path` / `.revenue-area-fill` keyframes in `styles.css:82-96` carry over.

---

## Phase 5 — Page passes

Baseline styling already lands in Phase 1; this phase upgrades markup to the new primitives. Run as
separate reviewable commits.

| Group | Files | Notes |
|---|---|---|
| **5a Auth** | `Login.tsx`, `Setup.tsx` | Centred card on the aurora wash; brand lockup; full-width navy CTA. First thing the user sees. |
| **5b Transactions** | `Quotations.tsx`, `QuotationNew.tsx`, `QuotationDetail.tsx`, `PurchaseOrders.tsx`, `PerformaInvoices.tsx` | Highest-density work. `QuotationNew` line-item editor → card rows with sticky totals panel; `QuotationDetail` → status timeline + follow-up thread + PO/PI sections. Preserve every status transition, PDF link, and the follow-up create/complete/cancel flows. |
| **5c Master data** | `Companies.tsx`, `Products.tsx`, `components/ProductImport.tsx` | Inline create/edit forms → sheet/dialog using existing `ui/sheet.tsx`. Keep `admin.deleteCompany`/`deleteProduct` guards. |
| **5d Intelligence** | `BusinessHealth.tsx`, `CustomerHealthOverview.tsx`, `CompanyHealth.tsx`, `ProductIntelligenceOverview.tsx`, `ProductIntelligence.tsx`, `Opportunities.tsx`, `ChatWithAI.tsx`, `components/AskTechnicon.tsx`, `components/FloatingChat.tsx` | Score gauges as `stat-tile` + ring; opportunity cards with priority pills. Chat: light bubbles; replace the hardcoded `.chat-bubble`/`.chat-teaser` colors in `styles.css:99-129` with tokens. |
| **5e Drill-downs** | `InactiveCustomers.tsx`, `AwaitingCustomerResponse.tsx`, `DraftQuotations.tsx`, `PurchaseOrdersNotInvoiced.tsx`, `FlaggedSalesRecords.tsx`, `OverdueFollowUps.tsx`, `FollowUpsDueToday.tsx` | Seven near-identical single-fetch list pages. Apply one pattern: `PageHeader` + count `stat-tile` + `DataTable` + `EmptyState`. Cheapest group. |
| **5f Ops** | `Reports.tsx`, `Settings.tsx`, `Admin.tsx` | `Reports` is the largest (409 lines, 12 endpoints, Excel upload/export) — tabbed sections. `Admin` → stat tiles + user-management table + danger-zone card; keep every destructive confirm. |

---

## Phase 6 — Dead code removal

Only after Phase 5 is green. For each candidate run
`rg -l '<basename>' app/client/src --type ts --type tsx` and delete **only** on zero hits:

`components/app-sidebar.tsx`, `components/app-header.tsx`, `components/app-shell.tsx`,
`components/layout/Sidebar.tsx`, `components/layout/Header.tsx`, `components/app-shared.tsx`,
`components/app-breadcrumbs.tsx`, `components/custom-sidebar-trigger.tsx`, `components/nav-user.tsx`,
`components/nav-group.tsx`, `components/dashboard.tsx`, `components/dashboard-skeleton.tsx`,
`components/stats.tsx`, `components/delta.tsx`, `components/indicator.tsx`,
`components/latest-change.tsx`, `components/team-on-duty.tsx`, `components/support-activity.tsx`,
`components/recent-conversations.tsx`, `components/channel-breakdown-chart.tsx`,
`components/conversation-volume-chart.tsx`, `components/csat-responses-chart.tsx`,
`components/first-reply-time-chart.tsx`, `components/BarChart.tsx`.

Keep `components/layout/navLinks.ts` — Phase 2 makes it the route source of truth.

`recharts` and `@radix-ui/*` packages orphaned by these deletions: report the list; do not uninstall
without confirmation.

---

## Phase 7 — Verification

```bash
cd "app/client"
npm install
npx tsc -b            # zero errors
npm run build         # clean vite build
npm run dev           # serve on :5173
```

**Automated / self-checkable:**
1. `tsc -b` and `vite build` both clean.
2. `rg -n 'className="(card|btn|toolbar|filter-bar|field|row|item-row|totals|badge|pagination|error|muted)' src/` — every remaining hit must have a matching rule in `styles.css`. No orphan classes.
3. `rg -n '#(101312|171918|1D211E|292E2A|B8F23A|D8F98D|708D31|003B2B|9CF45D|F4F7F4|E3E8E4|69736E|111714)' src/` — must return **zero**. All old-theme hex retired.
4. Visit every route from `App.tsx:42-66` in the dev server; each must mount without a console error (API calls will 401/500 without a DB — that exercises the error branches, which is useful).
5. Diff review per phase: confirm no `api.*` call, handler, or `useState` was added, removed, or reordered.

**Manual checklist handed to the user** (needs a live DB, which I don't have):

- Auth: setup → login → logout → session restore on refresh.
- Quotations: list loads; status tabs; search; date filter (today / week / month); clear filters;
  pagination past page 1.
- New Quotation: company search-select; add/remove line items; part-no select auto-fills description,
  HSN and price; qty/price edits recompute subtotal/tax/total; save navigates to the detail page.
- Quotation Detail: Mark Sent → Accepted → Rejected; View PDF opens; schedule a follow-up; complete it
  with an outcome; cancel one; Convert to Purchase Order; Generate Performa Invoice; both PDFs open.
- Companies / Products: create, edit, delete; search; download product template; import preview shows
  new / update / error rows; commit import.
- Reports: each of the 12 report views; Excel upload; both export downloads.
- Settings: load, edit, save, reload persists.
- Admin: stats; user create / delete / reset-password; config update; backup download; review-queue
  dismiss and delete.
- AI: Ask TECHNICON panel and the floating chat both answer (needs `GEMINI_API_KEY`).
- Responsive: 1440 / 1024 / 768 / 390 px — rail collapses, tables scroll, no horizontal page scroll.

---

## Out of scope (flagged, not actioned)

Three near-duplicate backend copies exist — `app/api/index.js`, `app/client/api/_lib/**` (Vercel,
has `ai.js` + `opportunities.js`), `app/server/src/**` (Fly.io, lacks both). The legacy static site
under `public/` and the `stitch_design/` HTML mockups are likewise untouched. Consolidating these is
real work but unrelated to the UI request — worth a separate pass.
