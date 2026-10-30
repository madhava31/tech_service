# Not implemented: frontend calls with no backend route

**Status: out of scope, future work. These 10 endpoints are NOT implemented.**

(The two company delete routes, `DELETE /api/companies/:id` and `POST /api/companies/bulk-delete`,
were originally on this list. They are now implemented: admin only, and they refuse companies still
used by other records.)

`app/client/src/api.ts` calls them, but no route exists in the Postgres API (`app/api/index.js` and
`app/client/api/_lib/routes`). The legacy SQLite server never had them either. Every call returns
404 (`Cannot <METHOD> /api/...`), so the UI actions that use them do not work.

They were left out of the `fix/sales-overview-contract` work on purpose. There was no earlier
implementation to port, and each one deletes or overwrites business data, so each needs its own
design: who may call it (admin only?), how it treats linked records, and whether it can be undone.

## Dashboard: business health (2)
| Method | Path | Frontend function |
|---|---|---|
| POST | `/api/dashboard/business-health/reset` | `dashboard.resetBusinessHealth` |
| POST | `/api/dashboard/business-health/restore` | `dashboard.restoreBusinessHealth` |

## Reports: deleting historical sales (6)
| Method | Path | Frontend function |
|---|---|---|
| DELETE | `/api/reports/companies/:name` | `reports.deleteCompanySales` |
| POST | `/api/reports/companies/bulk-delete` | `reports.bulkDeleteCompanies` |
| DELETE | `/api/reports/products/:partNo` | `reports.deleteProductSales` |
| POST | `/api/reports/products/bulk-delete` | `reports.bulkDeleteProducts` |
| DELETE | `/api/reports/review-queue/:id` | `reports.deleteReviewItem` |
| POST | `/api/reports/review-queue/bulk-delete` | `reports.bulkDeleteReviewItems` |

The admin-only `DELETE /api/admin/review-queue/:id` does exist; these frontend functions do not call it.

## Sales engineers (2)
| Method | Path | Frontend function |
|---|---|---|
| DELETE | `/api/engineers/:id` | `engineers.delete` |
| POST | `/api/engineers/import` | `engineers.import` |

## Until they are built
Either hide or disable the UI controls that call these endpoints, or show a clear "not available"
message. Do not let them fail silently.
