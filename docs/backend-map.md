# Backend map

Generated from `app/client/src/api.ts` and the page files on the current `main`. Every page reaches the backend only through the `api` object in `api.ts`, which calls the Express routes in `app/server/src/routes` under `/api`. **The redesign keeps all of these calls unchanged**: only markup and styling change.

## Pages and the calls they make

| Page | Lines | API calls — method and endpoint |
|---|---|---|
| `Admin.tsx` | 562 | `admin.backupUrl` — GET /admin/backup<br>`admin.createUser` — POST /admin/users<br>`admin.deleteImport` — DELETE /admin/imports/{…}<br>`admin.deleteReview` — DELETE /admin/review-queue/{…}<br>`admin.deleteUser` — DELETE /admin/users/{…}<br>`admin.dismissReview` — POST /admin/review-queue/{…}/dismiss<br>`admin.getConfig` — GET /admin/config<br>`admin.listUsers` — GET /admin/users<br>`admin.resetPassword` — POST /admin/users/{…}/reset-password<br>`admin.stats` — GET /admin/stats<br>`admin.updateConfig` — PUT /admin/config<br>`imports.list` — GET /imports<br>`reports.reviewQueue` — GET /reports/review-queue |
| `AwaitingCustomerResponse.tsx` | 102 | `dashboard.awaitingCustomerResponse` — GET /dashboard/awaiting-customer-response |
| `BranchDocumentSettings.tsx` | 242 | `firms.updateBranchDocumentSettings` — PUT /branches/{…}/document-settings |
| `BusinessHealth.tsx` | 319 | `dashboard.businessHealth` — GET /dashboard/business-health<br>`dashboard.resetBusinessHealth` — POST /dashboard/business-health/reset<br>`dashboard.restoreBusinessHealth` — POST /dashboard/business-health/restore |
| `ChatWithAI.tsx` | 18 | — (no API calls) |
| `Companies.tsx` | 528 | `companies.bulkDelete`<br>`companies.create` — POST /companies<br>`companies.delete` — DELETE /companies/{…}<br>`companies.list` — GET /companies<br>`companies.update` — PUT /companies/{…} |
| `CompanyHealth.tsx` | 283 | — (no API calls) |
| `CustomerHealthOverview.tsx` | 259 | — (no API calls) |
| `Dashboard.tsx` | 855 | `dashboard.attention` — GET /dashboard/attention<br>`dashboard.draftQuotations` — GET /dashboard/draft-quotations<br>`dashboard.followUps` — GET /dashboard/follow-ups<br>`dashboard.get` — GET /dashboard${qs <br>`dashboard.pipeline` — GET /dashboard/pipeline${qs <br>`dashboard.recentActivity` — GET /dashboard/recent-activity |
| `DraftQuotations.tsx` | 102 | `dashboard.draftQuotations` — GET /dashboard/draft-quotations |
| `EngineerDetail.tsx` | 287 | `engineers.setTarget` — POST /engineers/targets |
| `EngineerList.tsx` | 816 | `engineers.create` — POST /engineers<br>`engineers.delete` — DELETE /engineers/{…}<br>`engineers.import` — POST /engineers/import<br>`engineers.list` — GET /engineers${activeOnly <br>`engineers.performance` — GET /engineers/performance${year <br>`engineers.setTarget` — POST /engineers/targets<br>`export.engineersPerformanceUrl` — GET /export/engineers/performance${year  |
| `EngineerSalesReport.tsx` | 191 | `export.engineersPerformanceUrl` — GET /export/engineers/performance${year  |
| `FlaggedSalesRecords.tsx` | 118 | `dashboard.flaggedSalesRecords` — GET /dashboard/flagged-sales-records |
| `FollowUpsDueToday.tsx` | 327 | — (no API calls) |
| `InactiveCustomers.tsx` | 99 | `dashboard.inactiveCustomers` — GET /dashboard/inactive-customers |
| `Login.tsx` | 212 | — (no API calls) |
| `MultiFirmSettings.tsx` | 432 | `firms.branches` — GET /branches${firmId <br>`firms.create` — POST /firms<br>`firms.createBranch` — POST /branches<br>`firms.list` — GET /firms |
| `Opportunities.tsx` | 310 | — (no API calls) |
| `OverdueFollowUps.tsx` | 334 | — (no API calls) |
| `PerformaInvoices.tsx` | 256 | `performaInvoices.list` — GET /performa-invoices{…}<br>`performaInvoices.pdfUrl` — GET /performa-invoices/{…}/pdf |
| `ProductIntelligence.tsx` | 157 | — (no API calls) |
| `ProductIntelligenceOverview.tsx` | 280 | `products.intelligenceSummary` — GET /products/intelligence-summary |
| `Products.tsx` | 345 | `admin.deleteProduct` — DELETE /admin/products/{…}<br>`products.create` — POST /products<br>`products.list` — GET /products<br>`products.templateUrl` — GET /products/import/template<br>`products.update` — PUT /products/{…} |
| `PurchaseOrders.tsx` | 260 | `purchaseOrders.list` — GET /purchase-orders{…}<br>`purchaseOrders.pdfUrl` — GET /purchase-orders/{…}/pdf |
| `PurchaseOrdersNotInvoiced.tsx` | 111 | `dashboard.purchaseOrdersNotInvoiced` — GET /dashboard/purchase-orders-not-invoiced<br>`purchaseOrders.pdfUrl` — GET /purchase-orders/{…}/pdf |
| `QuotationDetail.tsx` | 670 | `performaInvoices.create` — POST /performa-invoices<br>`performaInvoices.list` — GET /performa-invoices{…}<br>`purchaseOrders.create` — POST /purchase-orders<br>`purchaseOrders.list` — GET /purchase-orders{…}<br>`quotations.followUps.cancel`<br>`quotations.followUps.complete`<br>`quotations.followUps.create`<br>`quotations.get` — GET /quotations/{…}<br>`quotations.pdfUrl` — GET /quotations/{…}/pdf<br>`quotations.setStatus` — POST /quotations/{…}/status |
| `QuotationNew.tsx` | 853 | `companies.create` — POST /companies<br>`companies.list` — GET /companies<br>`engineers.list` — GET /engineers${activeOnly <br>`firms.branches` — GET /branches${firmId <br>`firms.list` — GET /firms<br>`products.create` — POST /products<br>`products.list` — GET /products<br>`quotations.create` — POST /quotations<br>`quotations.update` — PUT /quotations/{…}<br>`settings.get` — GET /settings |
| `Quotations.tsx` | 791 | `export.quotationsUrl` — GET /export/quotations${q <br>`quotations.delete` — DELETE /quotations/{…}<br>`quotations.list` — GET /quotations, /quotations${qs  |
| `Reports.tsx` | 906 | `admin.deleteImport` — DELETE /admin/imports/{…}<br>`companies.list` — GET /companies<br>`imports.list` — GET /imports<br>`imports.upload` — POST /imports, {…}/imports<br>`products.list` — GET /products<br>`reports.companies` — GET /reports/companies${qs <br>`reports.companyHistory` — GET /reports/companies/{…}/history<br>`reports.companyYearComparison` — GET /reports/companies/{…}/year-comparison<br>`reports.companyYearly` — GET /reports/company-yearly<br>`reports.exportUrl` — GET /reports/export<br>`reports.lapsed` — GET /reports/lapsed<br>`reports.products` — GET /reports/products${qs <br>`reports.reviewQueue` — GET /reports/review-queue<br>`settings.get` — GET /settings |
| `Settings.tsx` | 431 | `settings.get` — GET /settings<br>`settings.update` — PUT /settings |
| `Setup.tsx` | 60 | — (no API calls) |
| `inventory/InventoryOperations.tsx` | 1674 | `inventory.fulfillReservation` — POST /inventory/fulfill-reservation/{…}<br>`inventory.getProductStock` — GET /inventory/stock/{…}${warehouseId <br>`inventory.listMovements` — GET /inventory/movements${qs <br>`inventory.listWarehouses` — GET /inventory/warehouses${activeOnly <br>`inventory.operations.alerts`<br>`inventory.operations.audit`<br>`inventory.operations.createAdjustment`<br>`inventory.operations.createReturn`<br>`inventory.operations.createTransfer`<br>`inventory.operations.critical`<br>`inventory.operations.incoming`<br>`inventory.operations.listTransfers`<br>`inventory.operations.outOfStock`<br>`inventory.operations.overview`<br>`inventory.operations.pendingReservations`<br>`inventory.operations.restockQueue`<br>`inventory.releaseReservation` — POST /inventory/release-reservation/{…}<br>`products.list` — GET /products |
| `inventory/InventoryOverview.tsx` | 417 | — (no API calls) |
| `inventory/ProductStockDetail.tsx` | 376 | `inventory.getProductStock` — GET /inventory/stock/{…}${warehouseId <br>`inventory.listMovements` — GET /inventory/movements${qs  |
| `inventory/ReservationDetail.tsx` | 464 | `inventory.fulfillReservation` — POST /inventory/fulfill-reservation/{…}<br>`inventory.getReservation` — GET /inventory/reservations/{…}<br>`inventory.releaseReservation` — POST /inventory/release-reservation/{…} |
| `inventory/ReservationList.tsx` | 876 | `inventory.fulfillReservation` — POST /inventory/fulfill-reservation/{…}<br>`inventory.listReservations` — GET /inventory/reservations${qs <br>`inventory.listWarehouses` — GET /inventory/warehouses${activeOnly <br>`inventory.releaseReservation` — POST /inventory/release-reservation/{…}<br>`inventory.reserveStock` — POST /inventory/reserve<br>`products.list` — GET /products |
| `inventory/StockIntelligence.tsx` | 1665 | `inventory.getStockIntelligence` — GET /inventory/intelligence${qs  |
| `inventory/StockInward.tsx` | 1339 | `inventory.receipts.analyzeExcel`<br>`inventory.receipts.create`<br>`inventory.receipts.previewExcel` |
| `inventory/StockList.tsx` | 330 | — (no API calls) |
| `inventory/StockReceiptDetail.tsx` | 406 | `inventory.receipts.cancel`<br>`inventory.receipts.confirm` |
| `inventory/TransferDetail.tsx` | 203 | — (no API calls) |
| `inventory/WarehouseDetail.tsx` | 433 | — (no API calls) |
| `inventory/WarehouseList.tsx` | 434 | `inventory.createWarehouse` — POST /inventory/warehouses<br>`inventory.updateWarehouse` — PATCH /inventory/warehouses/{…} |
| `procurement/IncomingProcurement.tsx` | 126 | `procurement.incoming` — GET /procurement/incoming${qs  |
| `procurement/ProcurementActivity.tsx` | 115 | `procurement.activity` — GET /procurement/activity${qs  |
| `procurement/ProcurementOverview.tsx` | 165 | `procurement.overview` — GET /procurement/overview |
| `procurement/ProcurementReports.tsx` | 128 | `procurement.reports` — GET /procurement/reports${qs  |
| `procurement/ProcurementRequirementDetail.tsx` | 180 | `procurement.requirementById` — GET /procurement/requirements/{…} |
| `procurement/ProcurementRequirements.tsx` | 167 | `procurement.requirements` — GET /procurement/requirements${qs  |
| `procurement/ReceivingQueue.tsx` | 248 | `inventory.listWarehouses` — GET /inventory/warehouses${activeOnly <br>`procurement.receiveStock` — POST /procurement/receive-stock<br>`procurement.receivingQueue` — GET /procurement/receiving${qs  |
| `procurement/SupplierDetail.tsx` | 134 | `procurement.supplierById` — GET /procurement/suppliers/{…} |
| `procurement/SupplierList.tsx` | 230 | `procurement.createSupplier` — POST /procurement/suppliers<br>`procurement.suppliers` — GET /procurement/suppliers${qs  |
| `sales/SaleReportDetail.tsx` | 570 | `saleReports.cancel` — POST /sale-reports/{…}/cancel<br>`saleReports.confirm` — POST /sale-reports/{…}/confirm<br>`saleReports.get` — GET /sale-reports/{…} |
| `sales/SaleReportList.tsx` | 630 | `inventory.listWarehouses` — GET /inventory/warehouses${activeOnly <br>`saleReports.confirm` — POST /sale-reports/{…}/confirm<br>`saleReports.list` — GET /sale-reports${qs  |
| `sales/SaleReportNew.tsx` | 995 | `companies.list` — GET /companies<br>`inventory.listWarehouses` — GET /inventory/warehouses${activeOnly <br>`performaInvoices.list` — GET /performa-invoices{…}<br>`products.list` — GET /products<br>`purchaseOrders.list` — GET /purchase-orders{…}<br>`quotations.list` — GET /quotations, /quotations${qs <br>`saleReports.confirm` — POST /sale-reports/{…}/confirm<br>`saleReports.create` — POST /sale-reports<br>`saleReports.getSourceDocItems` — GET /sale-reports/source-doc/{…}/{…}<br>`saleReports.update` — PUT /sale-reports/{…} |
| `sales/SalesActivity.tsx` | 186 | `sales.activity` — GET /sales/activity${str  |
| `sales/SalesAnalyticsReports.tsx` | 159 | `sales.reports` — GET /sales/reports${str  |
| `sales/SalesOrderDetail.tsx` | 244 | `sales.orderById` — GET /sales/orders/{…} |
| `sales/SalesOrderList.tsx` | 183 | `sales.orders` — GET /sales/orders${str  |
| `sales/SalesOverview.tsx` | 257 | `sales.overview` — GET /sales/overview |
| `sales/SalesPending.tsx` | 252 | `sales.pending` — GET /sales/pending |
| `sales/SalesPipeline.tsx` | 874 | — (no API calls) |

## Shared components that call the API

- `auth.tsx`: `auth.login` — POST /auth/login; `auth.logout` — POST /auth/logout; `auth.me` — GET /auth/me, {…}/auth/me; `auth.setup` — POST /auth/setup
- `components/AskTechnicon.tsx`: `ai.ask` — POST /ai/ask
- `components/ProductImport.tsx`: `products.importCommit` — POST /products/import; `products.importPreview` — POST /products/import/preview, {…}/products/import/preview
- `components/RestockModal.tsx`: `inventory.receipts.create`
- `components/app-header.tsx`: `dashboard.attention` — GET /dashboard/attention; `dashboard.followUps` — GET /dashboard/follow-ups

## API functions defined but not called from the UI (63)

These may be called indirectly or be unused. Leave them as they are.

`companies.get`, `companies.health`, `companies.healthSummary`, `products.get`, `products.intelligence`, `quotations.calculatePricing`, `quotations.openPdf`, `quotations.stockAnalysis`, `quotations.followUps`, `purchaseOrders.get`, `purchaseOrders.openPdf`, `performaInvoices.get`, `performaInvoices.openPdf`, `dashboard.overdueFollowUps`, `dashboard.followUpsDueToday`, `reports.deleteCompanySales`, `reports.bulkDeleteCompanies`, `reports.deleteProductSales`, `reports.bulkDeleteProducts`, `reports.deleteReviewItem`, `reports.bulkDeleteReviewItems`, `admin.deleteCompany`, `opportunities.list`, `inventory.getOverview`, `inventory.getWarehouse`, `inventory.deleteWarehouse`, `inventory.bulkDeleteWarehouses`, `inventory.getStockSummary`, `inventory.deleteStockItem`, `inventory.bulkDeleteStockItems`, `inventory.importStockExcel`, `inventory.getStockTemplateUrl`, `inventory.recordStockIn`, `inventory.recordStockOut`, `inventory.adjustStock`, `inventory.recordReturn`, `inventory.deleteReservation`, `inventory.bulkDeleteReservations`, `inventory.importReservationsExcel`, `inventory.getReservationsTemplateUrl`, `inventory.receipts`, `inventory.operations`, `saleReports.delete`, `saleReports.bulkDelete`, `sales.companyHistory`, `procurement.createRequirement`, `engineers.get`, `engineers.update`, `engineers.getTargets`, `firms.get`, `firms.update`, `firms.delete`, `firms.deleteMany`, `firms.getBranch`, `firms.updateBranch`, `firms.deleteBranch`, `firms.deleteManyBranches`, `export.inventoryStockUrl`, `export.procurementRequirementsUrl`, `export.stockReceiptsUrl`, `export.reservationsUrl`, `export.stockIntelligenceUrl`, `export.salesReportsUrl`
