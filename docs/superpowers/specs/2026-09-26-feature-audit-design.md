# Feature Audit — Design Spec

## Context

Sub-project 2 of 3 (Postgres migration done for local dev; Vercel deployment deferred to the very end
per user request). This spec covers verifying every feature in the CRM actually works against the new
Postgres-backed local dev environment, fixing bugs as found. Sub-project 3 (Aurora UI rebuild,
`docs/aurora-ui-rebuild-plan.md`) follows this.

## Constraints from the user

- No working browser-automation tool is available this session (Playwright MCP and the Chrome
  extension both failed to connect). The audit cannot be driven by the assistant clicking through the
  UI directly.
- Split: the assistant does backend/API-level testing plus static frontend checks; the user does a
  manual UI walkthrough from a checklist the assistant provides.
- Bugs found are fixed immediately as encountered, not batched for a later review pass.
- Test data (a handful of realistic companies/products) is created by the assistant through the app's
  own API — not raw SQL inserts — so the create path itself is exercised as part of the audit.

## Scope

**Static checks** (assistant, automated):
- `npx tsc -b` in `app/client` — zero type errors.
- `npm run build` (vite build) — clean build.

**Backend API smoke test** (assistant, one sequential Node script run against local dev on
`http://localhost:4000`, using a real session cookie from login — not raw SQL):
1. Companies & Products: create, list/search, edit, delete-guard (admin-only delete).
2. Product import: template download, Excel preview (new/update/error-row detection), commit.
3. Quotations: create with multiple line items (part-no auto-fill of description/HSN/price, per-line
   and overall discounts, tax, rounding, totals math), list/search/date-filter/pagination, status
   transitions (Draft → Sent → Accepted / Rejected), PDF generation, follow-ups (schedule / complete /
   cancel), Convert to Purchase Order, Generate Performa Invoice.
4. Purchase Orders & Performa Invoices: list, detail, PDF.
5. Dashboard: all six aggregate endpoints (`get`, `attention`, `draftQuotations`, `pipeline`,
   `followUps`, `recentActivity`).
6. Reports: all report endpoints, Excel upload, both export downloads.
7. Settings: load, edit, save, reload persists.
8. Admin: stats, user create/delete/reset-password, config update, backup download, review-queue
   dismiss/delete.
9. Opportunities and the Step 1-2 sales-pipeline / multi-firm / branch / sales-engineer endpoints
   (per the "Step 1-2 upgrades... sales pipeline, quotation pricing" commit already in history).
10. AI endpoint (`POST /api/ai/ask`): only if `GEMINI_API_KEY` is set in `app/client/.env`; otherwise
    explicitly reported as **SKIPPED** (not failed) with the reason.

Each step logs PASS/FAIL (and the response/assertion that failed) to the console; any FAIL is fixed
immediately in the relevant route/service file before moving on, then re-verified.

**Manual UI checklist** (handed to the user, adapted from the existing checklist in
`docs/aurora-ui-rebuild-plan.md`'s Phase 7): auth flows (setup/login/logout/session-restore),
visual/interactive correctness of each page, dialogs, and responsive breakpoints — anything better
judged by eye than by an API assertion. The user reports back what's broken; the assistant fixes those
too, following the same "fix as you go" rule.

## Out of scope

- The Aurora UI restyle itself (sub-project 3) — the audit runs against the current, unstyled/legacy
  UI. Visual polish is not this sub-project's job, only "does it work."
- Vercel/production verification — deferred to the very end per the user.
- Any change to the Aurora plan document.

## Done criteria

- `tsc -b` and `vite build` both clean.
- Backend smoke-test script reports all PASS or an explicitly justified SKIP (AI endpoint only, if no
  API key).
- User confirms the manual UI checklist.
- Any bug found during either pass has been fixed and re-verified, not just logged.
