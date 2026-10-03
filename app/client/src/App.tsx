import { Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import BusinessHealth from './pages/BusinessHealth';
import Companies from './pages/Companies';
import CompanyHealth from './pages/CompanyHealth';
import CustomerHealthOverview from './pages/CustomerHealthOverview';
import Opportunities from './pages/Opportunities';
import Products from './pages/Products';
import ProductIntelligence from './pages/ProductIntelligence';
import ProductIntelligenceOverview from './pages/ProductIntelligenceOverview';
import ChatWithAI from './pages/ChatWithAI';
import Quotations from './pages/Quotations';
import QuotationNew from './pages/QuotationNew';
import QuotationDetail from './pages/QuotationDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import PerformaInvoices from './pages/PerformaInvoices';
import Reports from './pages/Reports';
import InactiveCustomers from './pages/InactiveCustomers';
import AwaitingCustomerResponse from './pages/AwaitingCustomerResponse';
import DraftQuotations from './pages/DraftQuotations';
import PurchaseOrdersNotInvoiced from './pages/PurchaseOrdersNotInvoiced';
import FlaggedSalesRecords from './pages/FlaggedSalesRecords';
import OverdueFollowUps from './pages/OverdueFollowUps';
import FollowUpsDueToday from './pages/FollowUpsDueToday';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import Login from './pages/Login';
import Setup from './pages/Setup';
import InventoryOverview from './pages/inventory/InventoryOverview';
import InventoryOperations from './pages/inventory/InventoryOperations';
import TransferDetail from './pages/inventory/TransferDetail';
import WarehouseList from './pages/inventory/WarehouseList';
import WarehouseDetail from './pages/inventory/WarehouseDetail';
import StockList from './pages/inventory/StockList';
import ProductStockDetail from './pages/inventory/ProductStockDetail';
import StockInward from './pages/inventory/StockInward';
import StockReceiptDetail from './pages/inventory/StockReceiptDetail';
import ReservationList from './pages/inventory/ReservationList';
import ReservationDetail from './pages/inventory/ReservationDetail';
import StockIntelligence from './pages/inventory/StockIntelligence';
import SaleReportList from './pages/sales/SaleReportList';
import SaleReportNew from './pages/sales/SaleReportNew';
import SaleReportDetail from './pages/sales/SaleReportDetail';
import SalesOverview from './pages/sales/SalesOverview';
import SalesPipeline from './pages/sales/SalesPipeline';
import SalesOrderList from './pages/sales/SalesOrderList';
import SalesOrderDetail from './pages/sales/SalesOrderDetail';
import SalesPending from './pages/sales/SalesPending';
import SalesActivity from './pages/sales/SalesActivity';
import SalesAnalyticsReports from './pages/sales/SalesAnalyticsReports';
import ProcurementOverview from './pages/procurement/ProcurementOverview';
import ProcurementRequirements from './pages/procurement/ProcurementRequirements';
import ProcurementRequirementDetail from './pages/procurement/ProcurementRequirementDetail';
import SupplierList from './pages/procurement/SupplierList';
import SupplierDetail from './pages/procurement/SupplierDetail';
import IncomingProcurement from './pages/procurement/IncomingProcurement';
import ReceivingQueue from './pages/procurement/ReceivingQueue';
import ProcurementReports from './pages/procurement/ProcurementReports';
import ProcurementActivity from './pages/procurement/ProcurementActivity';
import EngineerList from './pages/EngineerList';
import EngineerDetail from './pages/EngineerDetail';
import EngineerSalesReport from './pages/EngineerSalesReport';
import MultiFirmSettings from './pages/MultiFirmSettings';
import BranchDocumentSettings from './pages/BranchDocumentSettings';
import { useAuth } from './auth';
import AppShell from './components/layout/AppShell';

export default function App() {
  const { user, needsSetup, loading } = useAuth();

  if (loading) return <p className="muted loading-text">Loading…</p>;
  if (needsSetup) return <Setup />;
  if (!user) return <Login />;

  return (
    <AppShell>
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
    </AppShell>
  );
}
