import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/ErrorBoundary';
import PageSkeleton from './components/PageSkeleton';
import Login from './pages/Login';
import Setup from './pages/Setup';

// Route Code-Splitting for Fast Initial Bundle & Instant Tab Transitions
const Dashboard = lazy(() => import('./pages/Dashboard'));
const BusinessHealth = lazy(() => import('./pages/BusinessHealth'));
const Companies = lazy(() => import('./pages/Companies'));
const CompanyHealth = lazy(() => import('./pages/CompanyHealth'));
const CustomerHealthOverview = lazy(() => import('./pages/CustomerHealthOverview'));
const Opportunities = lazy(() => import('./pages/Opportunities'));
const Products = lazy(() => import('./pages/Products'));
const ProductIntelligence = lazy(() => import('./pages/ProductIntelligence'));
const ProductIntelligenceOverview = lazy(() => import('./pages/ProductIntelligenceOverview'));
const ChatWithAI = lazy(() => import('./pages/ChatWithAI'));
const Quotations = lazy(() => import('./pages/Quotations'));
const QuotationNew = lazy(() => import('./pages/QuotationNew'));
const QuotationDetail = lazy(() => import('./pages/QuotationDetail'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const PerformaInvoices = lazy(() => import('./pages/PerformaInvoices'));
const Reports = lazy(() => import('./pages/Reports'));
const InactiveCustomers = lazy(() => import('./pages/InactiveCustomers'));
const AwaitingCustomerResponse = lazy(() => import('./pages/AwaitingCustomerResponse'));
const DraftQuotations = lazy(() => import('./pages/DraftQuotations'));
const PurchaseOrdersNotInvoiced = lazy(() => import('./pages/PurchaseOrdersNotInvoiced'));
const FlaggedSalesRecords = lazy(() => import('./pages/FlaggedSalesRecords'));
const OverdueFollowUps = lazy(() => import('./pages/OverdueFollowUps'));
const FollowUpsDueToday = lazy(() => import('./pages/FollowUpsDueToday'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));

const InventoryOverview = lazy(() => import('./pages/inventory/InventoryOverview'));
const InventoryOperations = lazy(() => import('./pages/inventory/InventoryOperations'));
const TransferDetail = lazy(() => import('./pages/inventory/TransferDetail'));
const WarehouseList = lazy(() => import('./pages/inventory/WarehouseList'));
const WarehouseDetail = lazy(() => import('./pages/inventory/WarehouseDetail'));
const StockList = lazy(() => import('./pages/inventory/StockList'));
const ProductStockDetail = lazy(() => import('./pages/inventory/ProductStockDetail'));
const StockInward = lazy(() => import('./pages/inventory/StockInward'));
const StockReceiptDetail = lazy(() => import('./pages/inventory/StockReceiptDetail'));
const ReservationList = lazy(() => import('./pages/inventory/ReservationList'));
const ReservationDetail = lazy(() => import('./pages/inventory/ReservationDetail'));
const StockIntelligence = lazy(() => import('./pages/inventory/StockIntelligence'));

const SaleReportList = lazy(() => import('./pages/sales/SaleReportList'));
const SaleReportNew = lazy(() => import('./pages/sales/SaleReportNew'));
const SaleReportDetail = lazy(() => import('./pages/sales/SaleReportDetail'));
const SalesOverview = lazy(() => import('./pages/sales/SalesOverview'));
const SalesPipeline = lazy(() => import('./pages/sales/SalesPipeline'));
const SalesOrderList = lazy(() => import('./pages/sales/SalesOrderList'));
const SalesOrderDetail = lazy(() => import('./pages/sales/SalesOrderDetail'));
const SalesPending = lazy(() => import('./pages/sales/SalesPending'));
const SalesActivity = lazy(() => import('./pages/sales/SalesActivity'));
const SalesAnalyticsReports = lazy(() => import('./pages/sales/SalesAnalyticsReports'));

const ProcurementOverview = lazy(() => import('./pages/procurement/ProcurementOverview'));
const ProcurementRequirements = lazy(() => import('./pages/procurement/ProcurementRequirements'));
const ProcurementRequirementDetail = lazy(() => import('./pages/procurement/ProcurementRequirementDetail'));
const SupplierList = lazy(() => import('./pages/procurement/SupplierList'));
const SupplierDetail = lazy(() => import('./pages/procurement/SupplierDetail'));
const IncomingProcurement = lazy(() => import('./pages/procurement/IncomingProcurement'));
const ReceivingQueue = lazy(() => import('./pages/procurement/ReceivingQueue'));
const ProcurementReports = lazy(() => import('./pages/procurement/ProcurementReports'));
const ProcurementActivity = lazy(() => import('./pages/procurement/ProcurementActivity'));

const EngineerList = lazy(() => import('./pages/EngineerList'));
const EngineerDetail = lazy(() => import('./pages/EngineerDetail'));
const EngineerSalesReport = lazy(() => import('./pages/EngineerSalesReport'));
const MultiFirmSettings = lazy(() => import('./pages/MultiFirmSettings'));
const BranchDocumentSettings = lazy(() => import('./pages/BranchDocumentSettings'));

import { useRealtimeSync } from './lib/useRealtimeSync';

export default function App() {
  const { user, needsSetup, loading } = useAuth();
  useRealtimeSync(!!user);

  if (loading) return <p className="muted loading-text">Loading…</p>;
  if (needsSetup) return <Setup />;
  if (!user) return <Login />;

  return (
    <AppShell>
      <ErrorBoundary>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={<SalesOverview />} />
            <Route path="/sales/pipeline" element={<SalesPipeline />} />
            <Route path="/sales/engineers" element={<EngineerList />} />
            <Route path="/sales/engineers/:id" element={<EngineerDetail />} />
            <Route path="/sales/orders" element={<SalesOrderList />} />
            <Route path="/sales/orders/:id" element={<SalesOrderDetail />} />
            <Route path="/sales/pending" element={<SalesPending />} />
            <Route path="/sales/activity" element={<SalesActivity />} />
            <Route path="/sales/reports" element={<SalesAnalyticsReports />} />
            <Route path="/procurement" element={<ProcurementOverview />} />
            <Route path="/procurement/requirements" element={<ProcurementRequirements />} />
            <Route path="/procurement/requirements/:id" element={<ProcurementRequirementDetail />} />
            <Route path="/procurement/suppliers" element={<SupplierList />} />
            <Route path="/procurement/suppliers/:id" element={<SupplierDetail />} />
            <Route path="/procurement/incoming" element={<IncomingProcurement />} />
            <Route path="/procurement/receiving" element={<ReceivingQueue />} />
            <Route path="/procurement/reports" element={<ProcurementReports />} />
            <Route path="/procurement/activity" element={<ProcurementActivity />} />
            <Route path="/business-health" element={<BusinessHealth />} />
            <Route path="/customer-health" element={<CustomerHealthOverview />} />
            <Route path="/product-intelligence" element={<ProductIntelligenceOverview />} />
            <Route path="/chat-with-ai" element={<ChatWithAI />} />
            <Route path="/quotations" element={<Quotations />} />
            <Route path="/quotations/new" element={<QuotationNew />} />
            <Route path="/quotations/:id/edit" element={<QuotationNew />} />
            <Route path="/quotations/:id" element={<QuotationDetail />} />
            <Route path="/purchase-orders" element={<PurchaseOrders />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrders />} />
            <Route path="/performa-invoices" element={<PerformaInvoices />} />
            <Route path="/performa-invoices/:id" element={<PerformaInvoices />} />
            <Route path="/sale-reports" element={<SaleReportList />} />
            <Route path="/sale-reports/new" element={<SaleReportNew />} />
            <Route path="/sale-reports/:id/edit" element={<SaleReportNew />} />
            <Route path="/sale-reports/:id" element={<SaleReportDetail />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/companies/:id" element={<CompanyHealth />} />
            <Route path="/companies/:id/health" element={<CompanyHealth />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/import" element={<Products />} />
            <Route path="/products/:id/intelligence" element={<ProductIntelligence />} />
            <Route path="/inventory" element={<InventoryOverview />} />
            <Route path="/inventory/operations" element={<InventoryOperations />} />
            <Route path="/inventory/operations/critical-stock" element={<InventoryOperations />} />
            <Route path="/inventory/operations/out-of-stock" element={<InventoryOperations />} />
            <Route path="/inventory/operations/restock-queue" element={<InventoryOperations />} />
            <Route path="/inventory/operations/incoming" element={<InventoryOperations />} />
            <Route path="/inventory/operations/pending-reservations" element={<InventoryOperations />} />
            <Route path="/inventory/operations/movements" element={<InventoryOperations />} />
            <Route path="/inventory/operations/adjustments" element={<InventoryOperations />} />
            <Route path="/inventory/operations/returns" element={<InventoryOperations />} />
            <Route path="/inventory/operations/transfers" element={<InventoryOperations />} />
            <Route path="/inventory/operations/transfers/:id" element={<TransferDetail />} />
            <Route path="/inventory/operations/audit" element={<InventoryOperations />} />
            <Route path="/inventory/warehouses" element={<WarehouseList />} />
            <Route path="/inventory/warehouses/:id" element={<WarehouseDetail />} />
            <Route path="/inventory/stock" element={<StockList />} />
            <Route path="/inventory/stock/:productId" element={<ProductStockDetail />} />
            <Route path="/inventory/stock-inward" element={<StockInward />} />
            <Route path="/inventory/stock-inward/:id" element={<StockReceiptDetail />} />
            <Route path="/inventory/reservations" element={<ReservationList />} />
            <Route path="/inventory/reservations/:id" element={<ReservationDetail />} />
            <Route path="/inventory/intelligence" element={<StockIntelligence />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/company-trends" element={<Reports />} />
            <Route path="/reports/engineer-sales" element={<EngineerSalesReport />} />
            <Route path="/inactive-customers" element={<InactiveCustomers />} />
            <Route path="/awaiting-customer-response" element={<AwaitingCustomerResponse />} />
            <Route path="/draft-quotations" element={<DraftQuotations />} />
            <Route path="/purchase-orders-not-invoiced" element={<PurchaseOrdersNotInvoiced />} />
            <Route path="/flagged-sales-records" element={<FlaggedSalesRecords />} />
            <Route path="/overdue-follow-ups" element={<OverdueFollowUps />} />
            <Route path="/follow-ups/overdue" element={<OverdueFollowUps />} />
            <Route path="/follow-ups-due-today" element={<FollowUpsDueToday />} />
            <Route path="/follow-ups/due-today" element={<FollowUpsDueToday />} />

            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/multi-firm" element={<MultiFirmSettings />} />
            <Route path="/settings/multi-firm/branches/:branchId/documents" element={<BranchDocumentSettings />} />
            {user.role === 'admin' && <Route path="/admin" element={<Admin />} />}
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
