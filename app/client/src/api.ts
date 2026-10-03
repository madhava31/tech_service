// In local dev this stays '/api' and goes through Vite's proxy (vite.config.ts) to localhost:4000.
// In production, frontend and API are served from the same Vercel deployment/domain, so '/api'
// resolves correctly there too. VITE_API_URL is only needed if the API is split to another domain.
const BASE = import.meta.env.VITE_API_URL || '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Company {
  id: number;
  name: string;
  address: string | null;
  state: string | null;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

export type CustomerHealthStatus = 'new' | 'strong' | 'active' | 'at_risk' | 'inactive' | 'no_history';

export interface CompanyHealthData {
  company: { id: number; name: string };
  health: {
    status: CustomerHealthStatus;
    label: string;
    totalRevenue: number;
    orderCount: number;
    avgOrderValue: number;
    firstOrderDate: string | null;
    lastOrderDate: string | null;
    daysSinceLastOrder: number | null;
    lapseMonths: number;
  };
}

export interface CustomerHealthSummaryRow {
  company_id: number;
  company_name: string;
  status: CustomerHealthStatus;
  label: string;
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  lapseMonths: number;
}

export interface CustomerHealthSummaryData {
  customers: CustomerHealthSummaryRow[];
  summary: {
    total: number;
    active: number;
    strong: number;
    atRisk: number;
    inactive: number;
    new: number;
    noHistory: number;
  };
}

export type ProductTrendDirection = 'growing' | 'declining' | 'stable' | 'no_data';

export interface ProductIntelligenceData {
  product: { id: number; part_no: string; description: string };
  sales: {
    revenue: number;
    unitsSold: number;
    customers: number;
    avgSellingPrice: number;
    orderCount: number;
    firstSaleDate: string | null;
    lastSaleDate: string | null;
  };
  trend: {
    direction: ProductTrendDirection;
    pctChange: number | null;
    recentRevenue: number;
    priorRevenue: number;
  };
  quotationActivity: {
    quotedLineCount: number;
    quotedQty: number;
    quotationCount: number;
  };
}

export interface ProductIntelligenceSummaryRow {
  id: number;
  part_no: string;
  description: string;
  revenue: number;
  unitsSold: number;
  customers: number;
  avgSellingPrice: number;
  orderCount: number;
  firstSaleDate: string | null;
  lastSaleDate: string | null;
  trendDirection: ProductTrendDirection;
  pctChange: number | null;
  quotedLineCount: number;
  quotedQty: number;
  quotationCount: number;
}

export interface ProductIntelligenceSummaryData {
  products: ProductIntelligenceSummaryRow[];
  summary: {
    totalProducts: number;
    productsWithSales: number;
    topRevenueProduct: { part_no: string; description: string; revenue: number } | null;
    topUnitsProduct: { part_no: string; description: string; unitsSold: number } | null;
  };
}

export interface Product {
  id: number;
  part_no: string;
  hsn_sac: string | null;
  description: string;
  unit: string;
  default_price: number;
}

export interface ProductImportErrorRow {
  rowNumber: number;
  productName: string | null;
  partNo: string | null;
  price: number | null;
  errors: string[];
}

export interface ProductImportValidRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  price: number;
}

export interface ProductImportNewRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  price: number;
}

export interface ProductImportUpdateRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  currentPrice: number;
  newPrice: number;
}

export interface ProductImportPreview {
  summary: { totalRows: number; newCount: number; updateCount: number; errorCount: number };
  newRows: ProductImportNewRow[];
  updateRows: ProductImportUpdateRow[];
  errorRows: ProductImportErrorRow[];
  validRows: ProductImportValidRow[];
}

export interface ProductImportResult {
  created: number;
  updated: number;
  errors: number;
}

export interface QuotationItem {
  id?: number;
  product_id: number | null;
  part_no: string | null;
  description: string;
  hsn_sac: string | null;
  make?: string | null;
  qty: number;
  actual_unit_price?: number;
  discount_type?: 'none' | 'percentage' | 'amount' | string;
  discount_value?: number;
  product_discount_amount?: number;
  after_product_discount_amount?: number;
  overall_discount_allocated?: number;
  final_unit_price?: number;
  final_line_total?: number;
  price: number;
  amount?: number;
}

export interface Quotation {
  id: number;
  number: string;
  date: string;
  company_id: number;
  company_name?: string;
  sales_engineer_id?: number | null;
  sales_engineer_name?: string | null;
  firm_id?: number | null;
  firm_name?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  status: string;
  gross_subtotal?: number;
  product_discount_total?: number;
  subtotal_after_product_discounts?: number;
  overall_discount_type?: 'none' | 'percentage' | 'amount' | string;
  overall_discount_value?: number;
  overall_discount_amount?: number;
  net_subtotal?: number;
  subtotal: number;
  discount_type?: 'percentage' | 'amount' | string;
  discount_value?: number;
  discount_percent?: number;
  discount_amount?: number;
  taxable_amount?: number;
  tax_percent: number;
  tax_amount: number;
  round_off?: number;
  total: number;
  notes: string;
  items?: QuotationItem[];
}

export interface QuotationStockItemAnalysis {
  product_id: number | null;
  part_no: string;
  description: string;
  quoted_qty: number;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  shortage: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'INCOMING' | 'OUT_OF_STOCK' | 'NOT_TRACKED';
}

export interface QuotationStockAnalysisResponse {
  warehouse_id: number | null;
  warehouse_name: string | null;
  items: QuotationStockItemAnalysis[];
  summary: {
    total_items: number;
    available_count: number;
    partial_count: number;
    incoming_count: number;
    out_of_stock_count: number;
    not_tracked_count: number;
    has_shortage: boolean;
    total_shortage_units: number;
  };
}

export interface SalesEngineer {
  id: number;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  target_amount?: number;
  confirmed_sales_amount?: number;
  achievement_pct?: number;
}

export interface EngineerSalesTarget {
  id: number;
  engineer_id: number;
  fiscal_year: string;
  target_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EngineerPerformance {
  engineer_id: number;
  code: string;
  name: string;
  fiscal_year: string;
  target_amount: number;
  quotation_count: number;
  quoted_amount: number;
  accepted_quotation_count: number;
  accepted_quotation_amount: number;
  confirmed_sales_count: number;
  confirmed_sales_amount: number;
  achievement_pct: number;
  shortfall_amount: number;
  status: 'EXCEEDED' | 'ON_TRACK' | 'BEHIND' | 'NO_TARGET';
}

export interface EngineerPerformanceSummary {
  fiscal_year: string;
  summary: {
    total_engineers: number;
    total_target: number;
    total_quoted: number;
    total_accepted: number;
    total_confirmed: number;
    overall_achievement_pct: number;
    confirmed_sales_available: boolean;
  };
  engineers: EngineerPerformance[];
}

export interface Firm {
  id: number;
  name: string;
  code: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  branch_count?: number;
}

export interface Branch {
  id: number;
  firm_id: number;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  firm_name?: string;
  firm_code?: string;
}

export interface BranchDocumentSettings {
  id: number;
  branch_id: number;
  document_header_title: string | null;
  document_address: string | null;
  gstin: string | null;
  pan: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_account_holder: string | null;
  terms_and_conditions: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  date: string;
  quotation_id: number;
  quotation_number?: string;
  company_name?: string;
  client_po_ref: string | null;
  status: string;
  total?: number;
}

export interface PerformaInvoice {
  id: number;
  number: string;
  date: string;
  quotation_id: number;
  quotation_number?: string;
  purchase_order_id: number | null;
  company_name?: string;
  status: string;
  total?: number;
}

export interface QuotationFollowUp {
  id: number;
  quotation_id: number;
  follow_up_date: string;
  notes: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  created_by: number;
  created_by_username?: string;
  created_at: string;
  completed_at: string | null;
  completed_by: number | null;
  completed_by_username?: string | null;
  outcome: string | null;
  outcome_notes: string | null;
}

export interface QuotationFollowUpsData {
  followUps: QuotationFollowUp[];
}

export interface CompanySettings {
  id: number;
  company_name: string;
  address: string;
  gstin: string;
  state: string;
  phone: string;
  landline: string;
  email: string;
  logo_image: string;
  signature_image: string;
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_account_holder: string;
  quotation_validity_days: number;
  payment_terms: string;
  delivery_time: string;
  quotation_prefix: string;
  po_prefix: string;
  pi_prefix: string;
  default_tax_percent: number;
  default_lapse_months: number;
  stale_quotation_days?: number;
  high_value_threshold?: number;
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'staff';
}

export interface AdminUser {
  id: number;
  username: string;
  role: 'admin' | 'staff';
  created_at: string;
}

export interface PeriodTrendPoint {
  label: string;
  value: number;
}

export interface PeriodTabData {
  total: number;
  trend: PeriodTrendPoint[];
  label: string;
}

export interface DashboardData {
  historicalRevenue: number;
  acceptedQuotationRevenue: number;
  monthlyTrend: { month: string; total: number }[];
  topCompanies: { company_name: string; total: number; orders: number }[];
  topProducts: { part_no: string; product_description: string; total: number; qty: number }[];
  counts: {
    companies: number;
    products: number;
    quotations: number;
    purchaseOrders: number;
    performaInvoices: number;
    rowsNeedingReview: number;
  };
  periodTabs?: {
    thisMonth: PeriodTabData;
    thisQuarter: PeriodTabData;
    thisYear: PeriodTabData;
    allTime: PeriodTabData;
  };
}

export interface BusinessHealthComponent {
  label: string;
  score: number | null;
  detail: string;
}

export interface BusinessHealthRecommendation {
  component: 'sales' | 'customerHealth' | 'followUps' | 'conversions' | 'repeatBusiness';
  title: string;
  detail: string;
}

export interface BusinessHealthData {
  overallScore: number | null;
  tier: 'green' | 'yellow' | 'red' | null;
  tierLabel: string | null;
  components: {
    sales: BusinessHealthComponent;
    customerHealth: BusinessHealthComponent;
    followUps: BusinessHealthComponent;
    conversions: BusinessHealthComponent;
    repeatBusiness: BusinessHealthComponent;
  };
  recommendation: BusinessHealthRecommendation | null;
}

export interface InactiveCustomer {
  company_name: string;
  last_purchase: string;
  months_inactive: number;
  total_revenue: number;
}

export interface InactiveCustomersData {
  count: number;
  months: number;
  customers: InactiveCustomer[];
}

export interface AwaitingResponseQuotation {
  id: number;
  number: string;
  company_name: string;
  date: string;
  total: number;
  status: string;
}

export interface AwaitingCustomerResponseData {
  count: number;
  quotations: AwaitingResponseQuotation[];
}

export interface DraftQuotationSummary {
  id: number;
  number: string;
  company_name: string;
  date: string;
  total: number;
  status: string;
}

export interface DraftQuotationsData {
  count: number;
  quotations: DraftQuotationSummary[];
}

export interface PurchaseOrderNotInvoiced {
  id: number;
  number: string;
  quotation_id: number;
  quotation_number: string;
  company_name: string;
  date: string;
  total: number;
  client_po_ref: string | null;
}

export interface PurchaseOrdersNotInvoicedData {
  count: number;
  purchaseOrders: PurchaseOrderNotInvoiced[];
}

export interface FlaggedSalesRecord {
  id: number;
  sale_date: string | null;
  invoice_no: string | null;
  company_name: string | null;
  po_no: string | null;
  part_no: string | null;
  product_description: string | null;
  price: number | null;
  qty: number | null;
  total_amount: number | null;
  review_reason: string | null;
}

export interface FlaggedSalesRecordsData {
  count: number;
  records: FlaggedSalesRecord[];
}

export type PipelineStageKey = 'draft' | 'sent' | 'accepted' | 'rejected';

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  count: number;
  value: number;
}

export interface PipelineData {
  stages: PipelineStage[];
  summary: {
    totalOpportunities: number;
    totalValue: number;
    wonCount: number;
    wonValue: number;
    acceptedRate?: number;
    lostCount?: number;
    lostValue?: number;
  };
  fulfillment?: {
    acceptedCount: number;
    purchaseOrderCount: number;
    performaInvoiceCount: number;
  };
}

export interface DashboardFollowUp {
  id: number;
  quotation_id: number;
  quotation_number: string;
  company_name: string;
  follow_up_date: string;
  notes: string | null;
  created_at: string;
  created_by_username: string;
}

export interface DashboardFollowUpsData {
  summary: {
    overdueCount: number;
    dueTodayCount: number;
    upcomingCount: number;
    totalScheduledCount: number;
  };
  overdue: DashboardFollowUp[];
  dueToday: DashboardFollowUp[];
  upcoming: DashboardFollowUp[];
}

export interface OverdueFollowUpsData {
  count: number;
  followUps: DashboardFollowUp[];
}

export interface DueTodayFollowUpsData {
  count: number;
  followUps: DashboardFollowUp[];
}

export interface RecentActivityItem {
  type: 'quotation' | 'purchase_order' | 'performa_invoice';
  id: number;
  number: string;
  company_name: string | null;
  status: string;
  date: string;
}

export interface RecentActivityData {
  activity: RecentActivityItem[];
}

export interface AttentionItem {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  count: number;
  route: string;
}

export interface AttentionData {
  summary: { total: number; highPriority: number };
  items: AttentionItem[];
}

export type OpportunityType = 'cross_sell' | 'at_risk' | 'high_value' | 'quotation_conversion';

export interface Opportunity {
  type: OpportunityType;
  priority: 'high' | 'medium' | 'low';
  company_id: number | null;
  company_name: string;
  title: string;
  description: string;
  action: string;
  evidence: Record<string, any>;
}

export interface OpportunitiesData {
  opportunities: Opportunity[];
  summary: { total: number; highPriority: number };
}

export type AiIntent =
  | 'sales_summary'
  | 'top_customers'
  | 'top_products'
  | 'sales_by_customer'
  | 'sales_by_product'
  | 'revenue_comparison'
  | 'inactive_customers'
  | 'quotation_search'
  | 'quotation_summary'
  | 'pipeline_value'
  | 'awaiting_customer_response'
  | 'purchase_order_summary'
  | 'performa_invoice_summary'
  | 'customer_summary'
  | 'follow_up_summary'
  | 'product_performance'
  | 'business_health_summary'
  | 'customer_health_summary'
  | 'growth_opportunities_summary'
  | null;

export interface AiAskResponse {
  answer: string;
  intent: AiIntent;
  data: Record<string, any> | null;
  sources: { type: string; label: string }[];
  meta: { generatedAt: string; params: Record<string, any> };
}

export interface AiChatMessage {
  role: 'user' | 'model';
  text: string;
}

export const api = {
  companies: {
    list: (q?: string) => request<Company[]>(`/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (id: number) => request<Company>(`/companies/${id}`),
    create: (data: Partial<Company>) => request<Company>('/companies', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Company>) =>
      request<Company>(`/companies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    health: (id: number) => request<CompanyHealthData>(`/companies/${id}/health`),
    healthSummary: () => request<CustomerHealthSummaryData>('/companies/health-summary'),
  },
  products: {
    list: (q?: string) => request<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (id: number) => request<Product>(`/products/${id}`),
    create: (data: Partial<Product>) => request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Product>) =>
      request<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    intelligence: (id: number) => request<ProductIntelligenceData>(`/products/${id}/intelligence`),
    intelligenceSummary: () => request<ProductIntelligenceSummaryData>('/products/intelligence-summary'),
    templateUrl: () => `${BASE}/products/import/template`,
    importPreview: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/products/import/preview`, { method: 'POST', body: formData, credentials: 'include' });
      const body = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(body.error || `Preview failed: ${res.status}`);
      return body as ProductImportPreview;
    },
    importCommit: (rows: ProductImportValidRow[]) =>
      request<ProductImportResult>('/products/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  },
  quotations: {
    list: () => request<Quotation[]>('/quotations'),
    get: (id: number) => request<Quotation>(`/quotations/${id}`),
    create: (data: Partial<Quotation>) => request<Quotation>('/quotations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Quotation>) =>
      request<Quotation>(`/quotations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    calculatePricing: (data: {
      items: any[];
      overallDiscountType?: string;
      overallDiscountValue?: number;
      taxPercent?: number;
    }) => request<any>('/quotations/calculate-pricing', { method: 'POST', body: JSON.stringify(data) }),
    setStatus: (id: number, status: string) =>
      request<Quotation>(`/quotations/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    pdfUrl: (id: number) => `${BASE}/quotations/${id}/pdf`,
    stockAnalysis: (data: { warehouse_id?: number; items: { product_id?: number; part_no?: string; qty: number }[] }) =>
      request<QuotationStockAnalysisResponse>('/quotations/stock-analysis', { method: 'POST', body: JSON.stringify(data) }),
    followUps: {
      list: (quotationId: number) => request<QuotationFollowUpsData>(`/quotations/${quotationId}/follow-ups`),
      create: (quotationId: number, data: { follow_up_date: string; notes?: string }) =>
        request<QuotationFollowUp>(`/quotations/${quotationId}/follow-ups`, { method: 'POST', body: JSON.stringify(data) }),
      complete: (quotationId: number, followUpId: number, data: { outcome?: string; outcome_notes?: string }) =>
        request<QuotationFollowUp>(`/quotations/${quotationId}/follow-ups/${followUpId}/complete`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      cancel: (quotationId: number, followUpId: number) =>
        request<QuotationFollowUp>(`/quotations/${quotationId}/follow-ups/${followUpId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
    },
  },
  purchaseOrders: {
    list: () => request<PurchaseOrder[]>('/purchase-orders'),
    get: (id: number) => request<PurchaseOrder>(`/purchase-orders/${id}`),
    create: (data: { quotation_id: number; client_po_ref?: string; date?: string }) =>
      request<PurchaseOrder>('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    pdfUrl: (id: number) => `${BASE}/purchase-orders/${id}/pdf`,
  },
  performaInvoices: {
    list: () => request<PerformaInvoice[]>('/performa-invoices'),
    get: (id: number) => request<PerformaInvoice>(`/performa-invoices/${id}`),
    create: (data: { quotation_id: number; purchase_order_id?: number; date?: string }) =>
      request<PerformaInvoice>('/performa-invoices', { method: 'POST', body: JSON.stringify(data) }),
    pdfUrl: (id: number) => `${BASE}/performa-invoices/${id}/pdf`,
  },
  dashboard: {
    get: (params?: { start?: string; end?: string; period?: string }) => {
      const q = new URLSearchParams();
      if (params?.start) q.set('start', params.start);
      if (params?.end) q.set('end', params.end);
      if (params?.period) q.set('period', params.period);
      const qs = q.toString();
      return request<DashboardData>(`/dashboard${qs ? `?${qs}` : ''}`);
    },
    attention: () => request<AttentionData>('/dashboard/attention'),
    pipeline: (params?: { start?: string; end?: string }) => {
      const q = new URLSearchParams();
      if (params?.start) q.set('start', params.start);
      if (params?.end) q.set('end', params.end);
      const qs = q.toString();
      return request<PipelineData>(`/dashboard/pipeline${qs ? `?${qs}` : ''}`);
    },
    inactiveCustomers: () => request<InactiveCustomersData>('/dashboard/inactive-customers'),
    awaitingCustomerResponse: () => request<AwaitingCustomerResponseData>('/dashboard/awaiting-customer-response'),
    draftQuotations: () => request<DraftQuotationsData>('/dashboard/draft-quotations'),
    purchaseOrdersNotInvoiced: () => request<PurchaseOrdersNotInvoicedData>('/dashboard/purchase-orders-not-invoiced'),
    flaggedSalesRecords: () => request<FlaggedSalesRecordsData>('/dashboard/flagged-sales-records'),
    followUps: () => request<DashboardFollowUpsData>('/dashboard/follow-ups'),
    overdueFollowUps: () => request<OverdueFollowUpsData>('/dashboard/overdue-follow-ups'),
    followUpsDueToday: () => request<DueTodayFollowUpsData>('/dashboard/follow-ups-due-today'),
    recentActivity: () => request<RecentActivityData>('/dashboard/recent-activity'),
    businessHealth: () => request<BusinessHealthData>('/dashboard/business-health'),
  },
  reports: {
    companies: (filters?: { startDate?: string; endDate?: string; partNo?: string }) => {
      const params = new URLSearchParams();
      if (filters?.startDate) params.set('startDate', filters.startDate);
      if (filters?.endDate) params.set('endDate', filters.endDate);
      if (filters?.partNo) params.set('partNo', filters.partNo);
      const qs = params.toString();
      return request<any[]>(`/reports/companies${qs ? `?${qs}` : ''}`);
    },
    companyHistory: (name: string) => request<any[]>(`/reports/companies/${encodeURIComponent(name)}/history`),
    products: (filters?: { startDate?: string; endDate?: string; companyName?: string }) => {
      const params = new URLSearchParams();
      if (filters?.startDate) params.set('startDate', filters.startDate);
      if (filters?.endDate) params.set('endDate', filters.endDate);
      if (filters?.companyName) params.set('companyName', filters.companyName);
      const qs = params.toString();
      return request<any[]>(`/reports/products${qs ? `?${qs}` : ''}`);
    },
    reviewQueue: () => request<any[]>('/reports/review-queue'),
    lapsed: (months: number) => request<any[]>(`/reports/lapsed?months=${months}`),
    companyYearly: (company: string) => request<any>(`/reports/company-yearly?company=${encodeURIComponent(company)}`),
    companyYearComparison: (company: string) =>
      request<{ years: string[]; products: any[] }>(`/reports/companies/${encodeURIComponent(company)}/year-comparison`),
    exportUrl: (type: 'companies' | 'products') => `${BASE}/reports/export?type=${type}`,
  },
  settings: {
    get: () => request<CompanySettings>('/settings'),
    update: (data: Partial<CompanySettings>) => request<CompanySettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
  imports: {
    list: () => request<any[]>('/imports'),
    upload: async (file: File, yearLabel: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('year_label', yearLabel);
      // Safety net only — the import itself is now batched and should finish in seconds, not
      // minutes. This just guarantees the UI can't spin forever if the connection genuinely
      // stalls (vs. the request just being slow, which it no longer should be).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
      let res: Response;
      try {
        res = await fetch(`${BASE}/imports`, { method: 'POST', body: formData, credentials: 'include', signal: controller.signal });
      } catch (e: any) {
        if (e.name === 'AbortError') throw new Error('Import timed out after 5 minutes. Please try again.');
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
      const body = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(body.error || `Upload failed: ${res.status}`);
      return body;
    },
  },
  auth: {
    me: async (): Promise<{ needsSetup?: boolean; user?: AuthUser }> => {
      const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' });
      if (res.status === 401) return {};
      return res.json();
    },
    setup: (username: string, password: string) =>
      request<{ user: AuthUser }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
    login: (username: string, password: string) =>
      request<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  },
  admin: {
    stats: () => request<{ counts: Record<string, number>; dbSizeBytes: number }>('/admin/stats'),
    deleteImport: (id: number) => request<{ ok: true }>(`/admin/imports/${id}`, { method: 'DELETE' }),
    deleteCompany: (id: number) => request<{ ok: true }>(`/admin/companies/${id}`, { method: 'DELETE' }),
    deleteProduct: (id: number) => request<{ ok: true }>(`/admin/products/${id}`, { method: 'DELETE' }),
    dismissReview: (id: number) => request<{ ok: true }>(`/admin/review-queue/${id}/dismiss`, { method: 'POST' }),
    deleteReview: (id: number) => request<{ ok: true }>(`/admin/review-queue/${id}`, { method: 'DELETE' }),
    getConfig: () => request<{ default_tax_percent: number; default_lapse_months: number }>('/admin/config'),
    updateConfig: (data: { default_tax_percent?: number; default_lapse_months?: number }) =>
      request<{ default_tax_percent: number; default_lapse_months: number }>('/admin/config', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    backupUrl: () => `${BASE}/admin/backup`,
    listUsers: () => request<AdminUser[]>('/admin/users'),
    createUser: (data: { username: string; password: string; role: string }) =>
      request<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
    deleteUser: (id: number) => request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id: number, password: string) =>
      request<{ ok: true }>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  },
  ai: {
    ask: (question: string, history?: AiChatMessage[]) =>
      request<AiAskResponse>('/ai/ask', { method: 'POST', body: JSON.stringify({ question, history: history || [] }) }),
  },
  opportunities: {
    list: () => request<OpportunitiesData>('/opportunities'),
  },
  inventory: {
    getOverview: () => request<InventoryOverviewData>('/inventory/overview'),
    listWarehouses: (activeOnly?: boolean) =>
      request<Warehouse[]>(`/inventory/warehouses${activeOnly ? '?active=true' : ''}`),
    getWarehouse: (id: number) => request<WarehouseDetailResponse>(`/inventory/warehouses/${id}`),
    createWarehouse: (data: { name: string; code: string; address?: string; city?: string; state?: string; isDefault?: boolean }) =>
      request<Warehouse>('/inventory/warehouses', { method: 'POST', body: JSON.stringify(data) }),
    updateWarehouse: (id: number, data: Partial<{ name: string; code: string; address: string; city: string; state: string; isActive: boolean; isDefault: boolean }>) =>
      request<Warehouse>(`/inventory/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    getStockSummary: (params?: { warehouseId?: number; lowStock?: boolean; status?: string; q?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.lowStock) q.set('lowStock', 'true');
      if (params?.status) q.set('status', params.status);
      if (params?.q) q.set('q', params.q);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<InventoryStockSummaryResponse>(`/inventory/stock${qs ? `?${qs}` : ''}`);
    },
    getProductStock: (productId: number, warehouseId?: number) =>
      request<ProductStockDetailResponse>(`/inventory/stock/${productId}${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
    recordStockIn: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string }) =>
      request<{ stock: any; movement: InventoryMovement }>('/inventory/stock-in', { method: 'POST', body: JSON.stringify(data) }),
    recordStockOut: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string }) =>
      request<{ stock: any; movement: InventoryMovement }>('/inventory/stock-out', { method: 'POST', body: JSON.stringify(data) }),
    adjustStock: (data: { warehouseId: number; productId: number; newOnHandQuantity: number; reason?: string; referenceType?: string; referenceId?: string }) =>
      request<{ stock: any; movement: InventoryMovement | null }>('/inventory/adjust', { method: 'POST', body: JSON.stringify(data) }),
    reserveStock: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; notes?: string }) =>
      request<{ reservation: StockReservation; stock: any }>('/inventory/reserve', { method: 'POST', body: JSON.stringify(data) }),
    releaseReservation: (id: number) =>
      request<{ reservation: StockReservation; stock: any }>(`/inventory/release-reservation/${id}`, { method: 'POST' }),
    fulfillReservation: (id: number) =>
      request<{ reservation: StockReservation; stock: any; movement: InventoryMovement }>(`/inventory/fulfill-reservation/${id}`, { method: 'POST' }),
    recordReturn: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string }) =>
      request<{ stock: any; movement: InventoryMovement }>('/inventory/return', { method: 'POST', body: JSON.stringify(data) }),
    listMovements: (params?: { warehouseId?: number; productId?: number; movementType?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.productId) q.set('productId', String(params.productId));
      if (params?.movementType) q.set('movementType', params.movementType);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<{ movements: InventoryMovement[]; total: number; limit: number; offset: number }>(`/inventory/movements${qs ? `?${qs}` : ''}`);
    },
    listReservations: (params?: { warehouseId?: number; productId?: number; status?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.productId) q.set('productId', String(params.productId));
      if (params?.status) q.set('status', params.status);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<{ reservations: StockReservation[]; total: number; limit: number; offset: number }>(`/inventory/reservations${qs ? `?${qs}` : ''}`);
    },
    getReservation: (id: number) => request<StockReservationDetailResponse>(`/inventory/reservations/${id}`),
    getStockIntelligence: (params?: { warehouseId?: number; productId?: number; period?: number; start?: string; end?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.productId) q.set('productId', String(params.productId));
      if (params?.period) q.set('period', String(params.period));
      if (params?.start) q.set('start', params.start);
      if (params?.end) q.set('end', params.end);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<StockIntelligenceResponse>(`/inventory/intelligence${qs ? `?${qs}` : ''}`);
    },
    receipts: {
      list: (params?: { warehouseId?: number; status?: string; sourceType?: string; q?: string; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.status) q.set('status', params.status);
        if (params?.sourceType) q.set('sourceType', params.sourceType);
        if (params?.q) q.set('q', params.q);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<StockReceiptListResponse>(`/inventory/receipts${qs ? `?${qs}` : ''}`);
      },
      get: (id: number) => request<StockReceiptDetailResponse>(`/inventory/receipts/${id}`),
      create: (data: {
        warehouseId: number;
        receiptNumber?: string;
        sourceType?: string;
        sourceReference?: string;
        notes?: string;
        items: { productId?: number; partNo?: string; quantity: number; notes?: string }[];
        confirmImmediately?: boolean;
      }) => request<StockReceiptDetailResponse>('/inventory/receipts', { method: 'POST', body: JSON.stringify(data) }),
      confirm: (id: number) =>
        request<StockReceiptDetailResponse>(`/inventory/receipts/${id}/confirm`, { method: 'POST' }),
      cancel: (id: number) =>
        request<StockReceiptDetailResponse>(`/inventory/receipts/${id}/cancel`, { method: 'POST' }),
      analyzeExcel: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE}/inventory/receipts/analyze-excel`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        const body = await res.json().catch(() => ({ error: res.statusText }));
        if (!res.ok) throw new Error(body.error || `Excel analysis failed: ${res.status}`);
        return body as ExcelAnalyzeResponse;
      },
      previewExcel: async (data: {
        file: File;
        warehouseId: number;
        sheetName?: string;
        partNoColumn: string;
        quantityColumn: string;
        notesColumn?: string;
      }) => {
        const formData = new FormData();
        formData.append('file', data.file);
        formData.append('warehouseId', String(data.warehouseId));
        if (data.sheetName) formData.append('sheetName', data.sheetName);
        formData.append('partNoColumn', data.partNoColumn);
        formData.append('quantityColumn', data.quantityColumn);
        if (data.notesColumn) formData.append('notesColumn', data.notesColumn);

        const res = await fetch(`${BASE}/inventory/receipts/preview-excel`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        const body = await res.json().catch(() => ({ error: res.statusText }));
        if (!res.ok) throw new Error(body.error || `Preview failed: ${res.status}`);
        return body as ExcelPreviewResponse;
      },
      previewRows: (data: { warehouseId: number; rows: { partNo: string; quantity: number | string; notes?: string; rowNumber?: number }[] }) =>
        request<ExcelPreviewResponse>('/inventory/receipts/preview-rows', { method: 'POST', body: JSON.stringify(data) }),
    },
    operations: {
      overview: (warehouseId?: number) =>
        request<OperationsOverviewResponse>(`/inventory/operations/overview${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
      alerts: (params?: { warehouseId?: number; category?: string; severity?: string; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.category) q.set('category', params.category);
        if (params?.severity) q.set('severity', params.severity);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<StockAlertsResponse>(`/inventory/operations/alerts${qs ? `?${qs}` : ''}`);
      },
      critical: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<CriticalStockResponse>(`/inventory/operations/critical${qs ? `?${qs}` : ''}`);
      },
      outOfStock: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<OutOfStockResponse>(`/inventory/operations/out-of-stock${qs ? `?${qs}` : ''}`);
      },
      restockQueue: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<RestockQueueResponse>(`/inventory/operations/restock-queue${qs ? `?${qs}` : ''}`);
      },
      incoming: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<IncomingStockResponse>(`/inventory/operations/incoming${qs ? `?${qs}` : ''}`);
      },
      pendingReservations: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<PendingReservationsResponse>(`/inventory/operations/pending-reservations${qs ? `?${qs}` : ''}`);
      },
      createAdjustment: (data: { warehouseId: number; productId: number; direction: 'INCREASE' | 'DECREASE'; quantity: number; reason?: string; notes?: string }) =>
        request<{ stock: any; movement: InventoryMovement }>('/inventory/adjustments', { method: 'POST', body: JSON.stringify(data) }),
      createReturn: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string; notes?: string }) =>
        request<{ stock: any; movement: InventoryMovement }>('/inventory/returns', { method: 'POST', body: JSON.stringify(data) }),
      listTransfers: (params?: { warehouseId?: number; status?: string; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.status) q.set('status', params.status);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<StockTransfersResponse>(`/inventory/transfers${qs ? `?${qs}` : ''}`);
      },
      getTransfer: (id: number) => request<StockTransferDetailResponse>(`/inventory/transfers/${id}`),
      createTransfer: (data: { sourceWarehouseId: number; destinationWarehouseId: number; productId: number; quantity: number; reference?: string; notes?: string }) =>
        request<StockTransferDetailResponse>('/inventory/transfers', { method: 'POST', body: JSON.stringify(data) }),
      audit: (params?: { warehouseId?: number; productId?: number; movementType?: string; limit?: number; offset?: number }) => {
        const q = new URLSearchParams();
        if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
        if (params?.productId) q.set('productId', String(params.productId));
        if (params?.movementType) q.set('movementType', params.movementType);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const qs = q.toString();
        return request<InventoryAuditResponse>(`/inventory/operations/audit${qs ? `?${qs}` : ''}`);
      },
    },
  },
  saleReports: {
    list: (params?: { warehouseId?: number; status?: string; sourceType?: string; companyId?: number; q?: string; startDate?: string; endDate?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.status) q.set('status', params.status);
      if (params?.sourceType) q.set('sourceType', params.sourceType);
      if (params?.companyId) q.set('companyId', String(params.companyId));
      if (params?.q) q.set('q', params.q);
      if (params?.startDate) q.set('startDate', params.startDate);
      if (params?.endDate) q.set('endDate', params.endDate);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<SaleReportListResponse>(`/sale-reports${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => request<SaleReportDetailResponse>(`/sale-reports/${id}`),
    getSourceDocItems: (type: 'quotation' | 'po' | 'pi', id: number) =>
      request<SaleReportSourceDocResponse>(`/sale-reports/source-doc/${type}/${id}`),
    create: (data: {
      companyId?: number;
      companyName?: string;
      invoiceNumber?: string;
      saleDate?: string;
      phoneNumber?: string;
      warehouseId: number;
      sourceType: 'INTERNAL_DOCUMENT' | 'DIRECT_EXTERNAL';
      sourceReference?: string;
      quotationId?: number;
      poId?: number;
      piId?: number;
      notes?: string;
      taxPercent?: number;
      items: { productId?: number; partNo?: string; quantity: number; unitPrice?: number }[];
      confirmImmediately?: boolean;
    }) => request<SaleReportDetailResponse>('/sale-reports', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) =>
      request<SaleReportDetailResponse>(`/sale-reports/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    confirm: (id: number) =>
      request<SaleReportDetailResponse>(`/sale-reports/${id}/confirm`, { method: 'POST' }),
    cancel: (id: number) =>
      request<SaleReportDetailResponse>(`/sale-reports/${id}/cancel`, { method: 'POST' }),
  },
  sales: {
    overview: () => request<SalesOverviewResponse>('/sales/overview'),
    orders: (params?: { q?: string; status?: string; companyId?: number; startDate?: string; endDate?: string; limit?: number; offset?: number }) => {
      const qParams = new URLSearchParams();
      if (params?.q) qParams.set('q', params.q);
      if (params?.status) qParams.set('status', params.status);
      if (params?.companyId) qParams.set('companyId', String(params.companyId));
      if (params?.startDate) qParams.set('startDate', params.startDate);
      if (params?.endDate) qParams.set('endDate', params.endDate);
      if (params?.limit) qParams.set('limit', String(params.limit));
      if (params?.offset) qParams.set('offset', String(params.offset));
      const str = qParams.toString();
      return request<SalesOrdersListResponse>(`/sales/orders${str ? `?${str}` : ''}`);
    },
    orderById: (id: string | number) => request<SalesOrderDetailResponse>(`/sales/orders/${id}`),
    pending: () => request<PendingSalesWorkResponse>('/sales/pending'),
    activity: (params?: { q?: string; companyId?: number; docType?: string; startDate?: string; endDate?: string; limit?: number; offset?: number }) => {
      const qParams = new URLSearchParams();
      if (params?.q) qParams.set('q', params.q);
      if (params?.companyId) qParams.set('companyId', String(params.companyId));
      if (params?.docType) qParams.set('docType', params.docType);
      if (params?.startDate) qParams.set('startDate', params.startDate);
      if (params?.endDate) qParams.set('endDate', params.endDate);
      if (params?.limit) qParams.set('limit', String(params.limit));
      if (params?.offset) qParams.set('offset', String(params.offset));
      const str = qParams.toString();
      return request<SalesActivityResponse>(`/sales/activity${str ? `?${str}` : ''}`);
    },
    companyHistory: (id: string | number) => request<CompanySalesHistoryResponse>(`/sales/companies/${id}/history`),
    reports: (params?: { period?: string; companyId?: number; productId?: number; warehouseId?: number }) => {
      const qParams = new URLSearchParams();
      if (params?.period) qParams.set('period', params.period);
      if (params?.companyId) qParams.set('companyId', String(params.companyId));
      if (params?.productId) qParams.set('productId', String(params.productId));
      if (params?.warehouseId) qParams.set('warehouseId', String(params.warehouseId));
      const str = qParams.toString();
      return request<SalesReportsDataResponse>(`/sales/reports${str ? `?${str}` : ''}`);
    },
  },
  procurement: {
    overview: () => request<ProcurementOverviewResponse>('/procurement/overview'),
    requirements: (params?: { q?: string; priority?: string; status?: string; sourceType?: string; warehouseId?: number; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.q) q.set('q', params.q);
      if (params?.priority) q.set('priority', params.priority);
      if (params?.status) q.set('status', params.status);
      if (params?.sourceType) q.set('sourceType', params.sourceType);
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<ProcurementRequirementsResponse>(`/procurement/requirements${qs ? `?${qs}` : ''}`);
    },
    requirementById: (id: string | number) => request<ProcurementRequirementDetailResponse>(`/procurement/requirements/${id}`),
    createRequirement: (data: any) => request<ProcurementRequirementDetailResponse>('/procurement/requirements', { method: 'POST', body: JSON.stringify(data) }),
    suppliers: (params?: { q?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.q) q.set('q', params.q);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<SupplierListResponse>(`/procurement/suppliers${qs ? `?${qs}` : ''}`);
    },
    supplierById: (id: string | number) => request<SupplierDetailResponse>(`/procurement/suppliers/${id}`),
    createSupplier: (data: any) => request<SupplierDetailResponse>('/procurement/suppliers', { method: 'POST', body: JSON.stringify(data) }),
    incoming: (params?: { q?: string; supplierId?: number; warehouseId?: number; status?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.q) q.set('q', params.q);
      if (params?.supplierId) q.set('supplierId', String(params.supplierId));
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.status) q.set('status', params.status);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<IncomingProcurementResponse>(`/procurement/incoming${qs ? `?${qs}` : ''}`);
    },
    receivingQueue: (params?: { warehouseId?: number; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<IncomingProcurementResponse>(`/procurement/receiving${qs ? `?${qs}` : ''}`);
    },
    receiveStock: (data: { poId: number; warehouseId: number; items: { productId: number; receiveQty: number }[]; reference?: string; notes?: string }) =>
      request<{ po: any; stockReceipt: any; totalReceivedInBatch: number }>('/procurement/receive-stock', { method: 'POST', body: JSON.stringify(data) }),
    reports: (params?: { period?: string; supplierId?: number; productId?: number; warehouseId?: number }) => {
      const q = new URLSearchParams();
      if (params?.period) q.set('period', params.period);
      if (params?.supplierId) q.set('supplierId', String(params.supplierId));
      if (params?.productId) q.set('productId', String(params.productId));
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      const qs = q.toString();
      return request<ProcurementReportsResponse>(`/procurement/reports${qs ? `?${qs}` : ''}`);
    },
    activity: (params?: { q?: string; supplierId?: number; docType?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.q) q.set('q', params.q);
      if (params?.supplierId) q.set('supplierId', String(params.supplierId));
      if (params?.docType) q.set('docType', params.docType);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<ProcurementActivityResponse>(`/procurement/activity${qs ? `?${qs}` : ''}`);
    },
  },
  engineers: {
    list: (activeOnly?: boolean) => request<SalesEngineer[]>(`/engineers${activeOnly ? '?active=true' : ''}`),
    get: (id: number) => request<SalesEngineer & { current_year_target?: EngineerSalesTarget; performance?: EngineerPerformance }>(`/engineers/${id}`),
    create: (data: Partial<SalesEngineer>) => request<SalesEngineer>('/engineers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<SalesEngineer>) => request<SalesEngineer>(`/engineers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    performance: (year?: string) => request<EngineerPerformanceSummary>(`/engineers/performance${year ? `?year=${year}` : ''}`),
    setTarget: (data: { engineer_id: number; fiscal_year: string; target_amount: number; notes?: string }) =>
      request<EngineerSalesTarget>('/engineers/targets', { method: 'POST', body: JSON.stringify(data) }),
    getTargets: (year?: string) => request<EngineerSalesTarget[]>(`/engineers/targets${year ? `?year=${year}` : ''}`),
  },
  firms: {
    list: () => request<Firm[]>('/firms'),
    get: (id: number) => request<Firm & { branches: Branch[] }>(`/firms/${id}`),
    create: (data: Partial<Firm>) => request<Firm>('/firms', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Firm>) => request<Firm>(`/firms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    branches: (firmId?: number) => request<Branch[]>(`/branches${firmId ? `?firm_id=${firmId}` : ''}`),
    getBranch: (id: number) => request<Branch & { document_settings: BranchDocumentSettings }>(`/branches/${id}`),
    createBranch: (data: Partial<Branch>) => request<Branch>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    updateBranch: (id: number, data: Partial<Branch>) => request<Branch>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateBranchDocumentSettings: (branchId: number, data: Partial<BranchDocumentSettings>) =>
      request<BranchDocumentSettings>(`/branches/${branchId}/document-settings`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  export: {
    quotationsUrl: (params?: { status?: string; start?: string; end?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return `${BASE}/export/quotations${q ? `?${q}` : ''}`;
    },
    engineersPerformanceUrl: (year?: string) => `${BASE}/export/engineers/performance${year ? `?year=${year}` : ''}`,
    inventoryStockUrl: (warehouseId?: number) => `${BASE}/export/inventory/stock${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`,
    procurementRequirementsUrl: (status?: string) => `${BASE}/export/procurement/requirements${status ? `?status=${status}` : ''}`,
    salesReportsUrl: (startDate?: string, endDate?: string) => {
      const q = new URLSearchParams();
      if (startDate) q.set('startDate', startDate);
      if (endDate) q.set('endDate', endDate);
      const str = q.toString();
      return `${BASE}/export/sales/reports${str ? `?${str}` : ''}`;
    },
  },
};

export interface Warehouse {
  id: number;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  product_count?: number;
  total_on_hand?: number;
}

export interface WarehouseDetailResponse extends Warehouse {
  metrics?: {
    productCount: number;
    totalOnHand: number;
    totalReserved: number;
    totalAvailable: number;
    totalIncoming: number;
    lowStockCount: number;
    criticalStockCount: number;
    outOfStockCount: number;
  };
  stock?: InventoryStockItem[];
  recentMovements?: InventoryMovement[];
}

export interface InventoryOverviewData {
  metrics: {
    totalWarehouses: number;
    activeWarehouses: number;
    totalTrackedProducts: number;
    productsWithStock: number;
    totalOnHandQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
    totalIncomingQuantity: number;
    lowStockCount: number;
    criticalStockCount: number;
    outOfStockCount: number;
  };
  warehouses: Warehouse[];
  recentMovements: InventoryMovement[];
  lowStockItems: InventoryStockItem[];
}

export interface InventoryStockItem {
  productId: number;
  partNo: string;
  description: string;
  unit: string;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  criticalStockThreshold: number;
  isLowStock: boolean;
  isCriticalStock: boolean;
  warehouseCount: number;
  status?: 'healthy' | 'low_stock' | 'critical' | 'out_of_stock';
}

export interface InventoryStockSummaryResponse {
  items: InventoryStockItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductWarehouseStock {
  warehouseId: number;
  warehouseName: string;
  warehouseCode: string;
  warehouseIsDefault: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  criticalStockThreshold: number;
  updatedAt: string;
}

export interface ProductStockDetailResponse {
  product: Product;
  totals: {
    onHandQuantity: number;
    reservedQuantity: number;
    incomingQuantity: number;
    availableQuantity: number;
  };
  warehouses: ProductWarehouseStock[];
}

export type InventoryMovementType =
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'OPENING_STOCK';

export interface InventoryMovement {
  id: number;
  warehouse_id: number;
  product_id: number;
  movement_type: InventoryMovementType;
  quantity: number;
  before_on_hand: number;
  after_on_hand: number;
  before_reserved: number;
  after_reserved: number;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  created_by: number | null;
  created_at: string;
  warehouse_name?: string;
  warehouse_code?: string;
  part_no?: string;
  product_description?: string;
  unit?: string;
  created_by_username?: string | null;
}

export interface StockReservation {
  id: number;
  warehouse_id: number;
  product_id: number;
  quantity: number;
  status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'RELEASED';
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  reserved_by: number | null;
  created_at: string;
  released_at: string | null;
  fulfilled_at: string | null;
  warehouse_name?: string;
  warehouse_code?: string;
  part_no?: string;
  product_description?: string;
  reserved_by_username?: string | null;
}

export interface StockReceiptItem {
  id: number;
  receipt_id: number;
  product_id: number;
  quantity: number;
  before_on_hand: number;
  after_on_hand: number;
  notes: string | null;
  created_at: string;
  part_no?: string;
  product_description?: string;
  unit?: string;
  hsn_sac?: string | null;
  default_price?: number;
}

export interface StockReceipt {
  id: number;
  warehouse_id: number;
  warehouse_name?: string;
  warehouse_code?: string;
  receipt_number: string;
  source_type: 'MANUAL' | 'EXCEL_IMPORT' | 'VENDOR_DELIVERY' | string;
  source_reference: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  notes: string | null;
  created_by: number | null;
  created_by_username?: string | null;
  created_at: string;
  confirmed_at: string | null;
  product_count?: number;
  total_quantity?: number;
}

export interface StockReceiptDetailResponse extends StockReceipt {
  items: StockReceiptItem[];
  movements: InventoryMovement[];
  totalQuantity: number;
  productCount: number;
}

export interface StockReceiptListResponse {
  receipts: StockReceipt[];
  total: number;
  limit: number;
  offset: number;
}

export interface ExcelAnalyzeResponse {
  sheets: {
    name: string;
    rowCount: number;
    headers: string[];
    sampleRows: Record<string, string>[];
  }[];
  suggestedPartNoColumn: string | null;
  suggestedQuantityColumn: string | null;
  suggestedNotesColumn: string | null;
}

export interface ExcelPreviewItem {
  productId: number;
  partNo: string;
  description: string;
  unit: string;
  currentOnHand: number;
  incomingQuantity: number;
  projectedOnHand: number;
  currentAvailable: number;
  projectedAvailable: number;
  aggregatedFromRows: number[];
  notes: string | null;
}

export interface ExcelPreviewResponse {
  summary: {
    totalRows: number;
    validItemCount: number;
    invalidRowCount: number;
    totalIncomingUnits: number;
  };
  warehouse: {
    id: number;
    name: string;
    code: string;
  };
  validItems: ExcelPreviewItem[];
  invalidRows: {
    rowNumber: number;
    partNo: string;
    quantity: any;
    reason: string;
  }[];
  warnings: string[];
}

export interface StockReservationDetailResponse extends StockReservation {
  warehouse_address?: string | null;
  unit?: string;
  hsn_sac?: string | null;
  stock: {
    onHand: number;
    reserved: number;
    available: number;
  };
  movements: InventoryMovement[];
}

export interface SaleReportItem {
  id: number;
  sale_report_id: number;
  product_id: number;
  part_number_snapshot: string;
  description_snapshot: string;
  hsn_code_snapshot: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  before_on_hand: number;
  after_on_hand: number;
  created_at: string;
  unit?: string;
  current_on_hand?: number;
  current_reserved?: number;
  current_available?: number;
}

export interface SaleReport {
  id: number;
  report_number: string;
  company_id: number | null;
  company_name_snapshot: string;
  company_name?: string;
  invoice_number: string | null;
  sale_date: string;
  phone_number_snapshot: string | null;
  warehouse_id: number;
  warehouse_name?: string;
  warehouse_code?: string;
  source_type: 'INTERNAL_DOCUMENT' | 'DIRECT_EXTERNAL';
  source_reference: string | null;
  source_quotation_id: number | null;
  source_po_id: number | null;
  source_pi_id: number | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
  created_by: number | null;
  created_by_username?: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmed_by: number | null;
  confirmed_by_username?: string | null;
  total_items?: number;
  total_quantity?: number;
}

export interface SaleReportDetailResponse extends SaleReport {
  company_address?: string | null;
  company_state?: string | null;
  company_gstin?: string | null;
  items: SaleReportItem[];
  movements: InventoryMovement[];
  totalQuantity: number;
  productCount: number;
  sourceDocument?: {
    type: 'QUOTATION' | 'PURCHASE_ORDER' | 'PERFORMA_INVOICE';
    document: any;
  } | null;
}

export interface SaleReportListResponse {
  reports: SaleReport[];
  total: number;
  limit: number;
  offset: number;
  kpi: {
    totalReports: number;
    draftCount: number;
    confirmedCount: number;
    cancelledCount: number;
    todaySalesCount: number;
    confirmedTotalValue: number;
  };
}

export interface SaleReportSourceDocResponse {
  sourceType: string;
  documentId: number;
  quotationId: number;
  poId: number | null;
  piId: number | null;
  documentNumber: string;
  documentDate: string;
  company: { id: number; name: string; phone: string | null };
  items: {
    id: number;
    productId: number;
    partNo: string;
    description: string;
    hsnSac: string | null;
    unit: string;
    originalQty: number;
    previouslySoldQty: number;
    remainingQty: number;
    unitPrice: number;
  }[];
  warehouses: Warehouse[];
}

export type StockDemandTrend = 'INCREASING' | 'STABLE' | 'DECREASING' | 'NO_DEMAND';
export type StockRecommendationStatus = 'NO_ACTION' | 'MONITOR' | 'RESTOCK_SOON' | 'RESTOCK_NOW' | 'OUT_OF_STOCK';
export type RestockPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface StockIntelligenceItem {
  productId: number;
  partNo: string;
  description: string;
  unit: string;
  hsnSac: string | null;
  defaultPrice: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  lowStockThreshold: number;
  criticalStockThreshold: number;
  unitsSoldRecent: number;
  unitsSoldPrevious: number;
  revenue: number;
  salesCount: number;
  dailyVelocity: number;
  monthlyConsumption: number;
  daysOfStockRemaining: number | null;
  projectedDaysWithIncoming: number | null;
  demandTrend: StockDemandTrend;
  stockStatus: 'healthy' | 'low_stock' | 'critical' | 'out_of_stock';
  recommendation: StockRecommendationStatus;
  suggestedRestockQty: number;
  priority: RestockPriority;
  explanation: string;
  firstSaleDate: string | null;
  lastSaleDate: string | null;
}

export interface RecentSaleImpact {
  id: number;
  report_number: string;
  sale_date: string;
  company_name: string;
  total_amount: number;
  warehouse_name: string;
  product_count: number;
  total_quantity: number;
}

export interface StockDemandAnalysis {
  productId: number;
  partNo: string;
  description: string;
  unitsSold: number;
  salesCount: number;
  customerCount: number;
  revenue: number;
  avgSellingPrice: number;
  firstSaleDate: string | null;
  lastSaleDate: string | null;
  salesFrequency: number;
  demandClassification: 'HIGH DEMAND' | 'MEDIUM DEMAND' | 'LOW DEMAND' | 'NO RECENT DEMAND';
}

export interface StockSalesVelocity {
  productId: number;
  partNo: string;
  description: string;
  currentAvailableStock: number;
  unitsSold30Day: number;
  dailyVelocity: number;
  weeklyVelocity: number;
  monthlyVelocity: number;
  trend: StockDemandTrend;
  velocityStatus: 'FAST_MOVING' | 'MODERATE_MOVING' | 'SLOW_MOVING' | 'DORMANT';
}

export interface StockCoverageAnalysis {
  productId: number;
  partNo: string;
  description: string;
  onHand: number;
  reserved: number;
  availableStock: number;
  incoming: number;
  dailyVelocity: number;
  coverageDays: number | null;
  coverageStatus: 'OUT OF STOCK' | 'CRITICAL' | 'LOW' | 'HEALTHY' | 'OVERSTOCKED' | 'NO DEMAND';
}

export interface StockRestockRecommendation {
  productId: number;
  partNo: string;
  description: string;
  available: number;
  reserved: number;
  incoming: number;
  dailyVelocity: number;
  coverageDays: number | null;
  leadTime: number;
  safetyStock: number;
  reorderPoint: number;
  recommendedQty: number;
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NO ACTION';
  reason: string;
}

export interface StockIncomingImpact {
  productId: number;
  partNo: string;
  description: string;
  available: number;
  incoming: number;
  currentCoverageDays: number | null;
  projectedCoverageDays: number | null;
  impact: string;
}

export interface StockOverstockItem {
  productId: number;
  partNo: string;
  description: string;
  availableStock: number;
  dailyVelocity: number;
  coverageDays: number | null;
  overstockType: 'POTENTIAL_OVERSTOCK' | 'SLOW_DORMANT';
  reason: string;
}

export interface StockIntelligenceResponse {
  summary: {
    totalProducts: number;
    productsAnalyzed?: number;
    productsSelling?: number;
    withStock: number;
    lowStock: number;
    criticalStock: number;
    outOfStock: number;
    needsRestock: number;
    productsRequiringRestock?: number;
    averageStockCoverage?: number;
    incomingUnits?: number;
    totalOnHand: number;
    totalReserved: number;
    totalAvailable: number;
    totalIncoming: number;
  };
  health: {
    healthy: number;
    low: number;
    critical: number;
    outOfStock: number;
    incoming: number;
  };
  demand?: StockDemandAnalysis[];
  velocity?: StockSalesVelocity[];
  coverage?: StockCoverageAnalysis[];
  recommendations?: StockRestockRecommendation[];
  incomingImpact?: StockIncomingImpact[];
  overstock?: StockOverstockItem[];
  products: StockIntelligenceItem[];
  recentSales: RecentSaleImpact[];
  warehouses: Warehouse[];
  meta: {
    periodDays: number;
    warehouseId: number | null;
    productId?: number | null;
    start?: string | null;
    end?: string | null;
  };
}

export interface OperationsOverviewResponse {
  totalStockItems: number;
  totalTrackedProducts: number;
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  criticalStockCount: number;
  outOfStockCount: number;
  healthyCount: number;
  incomingStockQuantity: number;
  pendingReservationsCount: number;
  pendingReservationsUnits: number;
}

export interface StockAlertItem {
  id: string;
  alertType: 'LOW_STOCK' | 'CRITICAL_STOCK' | 'OUT_OF_STOCK' | 'OVERSTOCK' | 'PENDING_RESTOCK' | 'INCOMING_DELAY' | 'RESERVATION_PRESSURE';
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  productId: number;
  partNumber: string;
  description: string;
  warehouseId: number | null;
  warehouseName: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  recommendedAction: string;
  createdAt: string;
}

export interface StockAlertsResponse {
  alerts: StockAlertItem[];
  total: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  limit: number;
  offset: number;
}

export interface CriticalStockResponse {
  items: InventoryStockItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface OutOfStockItem extends InventoryStockItem {
  incomingStatus: 'INCOMING' | 'NO INCOMING STOCK';
  lastStockIn: string | null;
  lastStockOut: string | null;
}

export interface OutOfStockResponse {
  items: OutOfStockItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RestockQueueItem {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  rank: number;
  productId: number;
  partNumber: string;
  description: string;
  warehouseId: number | null;
  warehouseName: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  safetyStock: number;
  incoming: number;
  suggestedRestockQuantity: number;
  reason: string;
  status: 'NEEDS_RESTOCK' | 'PARTIALLY_COVERED' | 'INCOMING' | 'RESOLVED';
}

export interface RestockQueueResponse {
  items: RestockQueueItem[];
  total: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  limit: number;
  offset: number;
}

export interface IncomingStockItem {
  receiptId: number;
  receiptNumber: string;
  productId: number;
  partNumber: string;
  description: string;
  warehouseId: number;
  warehouseName: string;
  incomingQuantity: number;
  currentOnHand: number;
  reserved: number;
  available: number;
  source: string;
  reference: string;
  status: 'EXPECTED' | 'RECEIVED' | 'PARTIAL';
  createdAt: string;
}

export interface IncomingStockResponse {
  items: IncomingStockItem[];
  total: number;
  totalIncomingUnits: number;
  limit: number;
  offset: number;
}

export interface PendingReservationsResponse {
  reservations: StockReservation[];
  total: number;
  summary: {
    activeReservationsCount: number;
    totalReservedUnits: number;
    productsAffectedCount: number;
    warehousesAffectedCount: number;
  };
  limit: number;
  offset: number;
}

export interface StockTransfer {
  id: number;
  transferNumber: string;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  sourceWarehouseCode: string;
  destinationWarehouseId: number;
  destinationWarehouseName: string;
  destinationWarehouseCode: string;
  productId: number;
  partNumber: string;
  productDescription: string;
  productUnit: string;
  quantity: number;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  reference?: string;
  notes?: string;
  sourceBeforeOnHand: number;
  sourceAfterOnHand: number;
  destBeforeOnHand: number;
  destAfterOnHand: number;
  createdBy: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface StockTransfersResponse {
  transfers: StockTransfer[];
  total: number;
  limit: number;
  offset: number;
}

export interface StockTransferDetailResponse extends StockTransfer {
  movements: InventoryMovement[];
}

export interface InventoryAuditResponse {
  movements: InventoryMovement[];
  total: number;
  summary: {
    totalMovements: number;
    stockInUnits: number;
    stockOutUnits: number;
    returnUnits: number;
    adjustmentUnits: number;
    transferUnits: number;
  };
  limit: number;
  offset: number;
}

export type DerivedSalesOrderStatus =
  | 'QUOTATION_DRAFT'
  | 'AWAITING_CUSTOMER'
  | 'QUOTATION_REJECTED'
  | 'ORDER_CONFIRMED'
  | 'PO_CREATED'
  | 'PI_CREATED'
  | 'READY_TO_DISPATCH'
  | 'PARTIALLY_DISPATCHED'
  | 'COMPLETED';

export interface SalesPipelineStage {
  stage: string;
  label: string;
  count: number;
  value: number;
}

export interface SalesOverviewKpis {
  totalQuotations: number;
  draftQuotations: number;
  sentQuotations: number;
  acceptedQuotations: number;
  rejectedQuotations: number;
  openOrders: number;
  pendingPis: number;
  pendingSaleReports: number;
  confirmedSales: number;
  salesValue: number;
  grossSales: number;
  acceptedQuotationValue: number;
  openOrderValue: number;
  pendingDispatchValue: number;
  completedSalesValue: number;
  averageOrderValue: number;
  quotationConversionRate: number;
}

export interface SalesOverviewResponse {
  kpis: SalesOverviewKpis;
  pipeline: SalesPipelineStage[];
}

export interface SalesOrderItem {
  id: number;
  quotation_id: number;
  product_id: number | null;
  part_no: string | null;
  description: string;
  hsn_sac: string | null;
  qty: number;
  price: number;
  amount: number;
  dispatchedQty: number;
  remainingQty: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  stockStatus: 'IN_STOCK' | 'PARTIALLY_AVAILABLE' | 'OUT_OF_STOCK';
  shortage: number;
}

export interface TimelineEvent {
  stage: string;
  title: string;
  timestamp: string;
  status: 'completed' | 'pending' | 'warning';
}

export interface SalesOrder {
  id: number;
  po_id: number | null;
  po_number: string;
  po_date: string;
  client_po_ref: string | null;
  quotation_id: number;
  quotation_number: string;
  quotation_date: string;
  quotation_status: string;
  total_amount: number;
  taxable_amount: number;
  tax_amount: number;
  company_id: number;
  company_name: string;
  company_email: string | null;
  company_phone: string | null;
  pi_id: number | null;
  pi_number: string | null;
  pi_date: string | null;
  derivedStatus: DerivedSalesOrderStatus;
  totalOrdered: number;
  totalDispatched: number;
  remainingQuantity: number;
  hasStockConstraint?: boolean;
  totalShortage?: number;
  saleReports?: any[];
}

export interface SalesOrdersListResponse {
  orders: SalesOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface SalesOrderDetailResponse {
  order: SalesOrder;
  relatedDocuments: {
    quotation: { id: number; number: string; date: string; status: string; total: number } | null;
    purchaseOrder: { id: number; number: string; date: string; clientRef: string | null } | null;
    performaInvoice: { id: number; number: string; date: string; status: string } | null;
    saleReports: { id: number; number: string; date: string; status: string; total: number }[];
  };
  items: SalesOrderItem[];
  timeline: TimelineEvent[];
}

export interface PendingActionItem {
  id: number;
  number?: string;
  report_number?: string;
  date?: string;
  sale_date?: string;
  total?: number;
  total_amount?: number;
  company_name: string;
  age_days: number;
  nextAction: string;
  quotation_id?: number;
  purchase_order_id?: number;
}

export interface PendingSalesWorkResponse {
  quotationsAwaitingResponse: PendingActionItem[];
  acceptedQuotationsWithoutPo: PendingActionItem[];
  posWithoutPi: PendingActionItem[];
  pisWithoutSaleReport: PendingActionItem[];
  saleReportsAwaitingConfirmation: PendingActionItem[];
}

export interface SalesActivityItem {
  doc_type: 'QUOTATION' | 'PURCHASE_ORDER' | 'PERFORMA_INVOICE' | 'SALE_REPORT';
  doc_id: number;
  doc_number: string;
  company_name: string;
  company_id: number;
  amount: number;
  status: string;
  event_timestamp: string;
  description: string;
}

export interface SalesActivityResponse {
  activity: SalesActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CompanySalesHistoryResponse {
  company: Company;
  quotations: Quotation[];
  purchaseOrders: any[];
  performaInvoices: any[];
  saleReports: SaleReport[];
  metrics: {
    totalQuotations: number;
    totalPurchaseOrders: number;
    totalPerformaInvoices: number;
    totalSaleReports: number;
    confirmedSalesValue: number;
    lastSaleDate: string | null;
    openOrdersCount: number;
    pendingQuotationsCount: number;
  };
}

export interface SalesReportsDataResponse {
  byCompany: { company_id: number; company_name: string; total_orders: number; total_sales: number }[];
  byProduct: { product_id: number; part_no: string; description: string; total_qty_sold: number; total_revenue: number }[];
  byWarehouse: { warehouse_id: number; warehouse_name: string; warehouse_code: string; total_reports: number; total_sales: number }[];
}

export interface ProcurementOverviewKpis {
  openPurchaseOrders: number;
  pendingSupplierOrders: number;
  ordersAwaitingReceipt: number;
  partiallyReceivedOrders: number;
  fullyReceivedOrders: number;
  pendingRequirements: number;
  incomingUnits: number;
  incomingPurchaseValue: number;
  totalSuppliers: number;
  procurementValue: number;
}

export interface ProcurementOverviewResponse {
  kpis: ProcurementOverviewKpis;
}

export interface ProcurementRequirement {
  id: number;
  requirement_code: string;
  product_id: number;
  warehouse_id: number;
  required_quantity: number;
  suggested_quantity: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  source_type: 'STOCK_INTELLIGENCE' | 'RESTOCK_QUEUE' | 'SALES_DEMAND' | 'MANUAL';
  source_reference: string | null;
  supplier_id: number | null;
  status: 'OPEN' | 'PARTIALLY_COVERED' | 'ORDERED' | 'RECEIVING' | 'FULFILLED';
  purchase_order_id: number | null;
  created_at: string;
  part_no: string;
  product_description: string;
  unit: string;
  default_price: number;
  warehouse_name: string;
  warehouse_code: string;
  supplier_name: string | null;
  po_number: string | null;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
}

export interface ProcurementRequirementsResponse {
  requirements: ProcurementRequirement[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProcurementRequirementDetailResponse {
  requirement: ProcurementRequirement & {
    hsn_sac: string | null;
    supplier_email: string | null;
    supplier_phone: string | null;
    po_date: string | null;
    po_status: string | null;
    reorderPoint: number;
    safetyStock: number;
  };
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  gstin: string | null;
  is_supplier: number;
  company_type: string;
  totalPos: number;
  totalProcurementValue: number;
  pendingOrders: number;
}

export interface SupplierListResponse {
  suppliers: Supplier[];
  total: number;
  limit: number;
  offset: number;
}

export interface SupplierDetailResponse {
  supplier: Supplier;
  purchaseOrders: any[];
  summary: {
    totalPurchaseOrders: number;
    totalProcurementValue: number;
    openOrders: number;
    completedOrders: number;
    pendingReceipts: number;
  };
}

export interface IncomingProcurementItem {
  po_id: number;
  po_number: string;
  po_date: string;
  po_status: string;
  po_value: number;
  supplier_id: number;
  supplier_name: string;
  product_id: number;
  part_no: string;
  product_description: string;
  ordered_quantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
}

export interface IncomingProcurementResponse {
  items: IncomingProcurementItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProcurementReportsResponse {
  bySupplier: { supplier_id: number; supplier_name: string; total_pos: number; total_spend: number }[];
  byProduct: { product_id: number; part_no: string; description: string; total_ordered_qty: number; total_spend: number }[];
}

export interface ProcurementActivityItem {
  doc_type: 'REQUIREMENT' | 'STOCK_RECEIPT';
  doc_id: number;
  doc_number: string;
  product_part: string;
  status: string;
  event_timestamp: string;
  description: string;
}

export interface ProcurementActivityResponse {
  activity: ProcurementActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================
// STEP 2B — SALES PIPELINE & FOLLOW-UP CONTROL CENTER TYPES & APIS
// ============================================================

export type DerivedPipelineStage =
  | 'QUOTATION_DRAFT'
  | 'AWAITING_CUSTOMER'
  | 'PO_CREATED'
  | 'PI_CREATED'
  | 'READY_TO_DISPATCH'
  | 'PARTIALLY_DISPATCHED'
  | 'COMPLETED';

export type FollowUpStatus = 'PENDING' | 'CONTACTED' | 'CUSTOMER_RESPONDED' | 'RESCHEDULED' | 'COMPLETED';
export type FollowUpPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type StockStatusType = 'FULLY_AVAILABLE' | 'PARTIAL_STOCK' | 'NO_STOCK' | 'INCOMING_STOCK' | 'NOT_TRACKED';

export interface SalesPipelineRecord {
  quotation_id: number;
  quotation_number: string;
  quotation_date: string;
  quotation_status: string;
  net_subtotal: number;
  total_amount: number;
  company_id: number;
  customer_name: string;
  sales_engineer_id: number | null;
  engineer_name: string;
  branch_id: number | null;
  branch_name: string;
  firm_id: number | null;
  firm_name: string;
  pipeline_stage: DerivedPipelineStage;
  pipeline_stage_label: string;
  age_days: number;
  age_group: string;
  is_stale: boolean;
  is_high_value: boolean;
  next_follow_up_date: string | null;
  next_follow_up_time: string | null;
  next_follow_up_status: string | null;
  next_follow_up_priority: string | null;
  stock_status: StockStatusType;
  next_action: string;
}

export interface SalesPipelineSummary {
  open_quotations_count: number;
  open_pipeline_value: number;
  stage_counts: Record<string, number>;
  stage_values: Record<string, number>;
  high_value_count: number;
  high_value_value: number;
  overdue_followups_count: number;
  due_today_followups_count: number;
  stale_quotations_count: number;
  stale_quotations_value: number;
  stock_risk_count: number;
}

export interface SalesPipelineResponse {
  records: SalesPipelineRecord[];
  summary: SalesPipelineSummary;
  total: number;
}

export interface SalesFollowUp {
  id: number;
  firm_id: number | null;
  branch_id: number | null;
  customer_id: number | null;
  company_id: number | null;
  quotation_id: number | null;
  sales_engineer_id: number | null;
  follow_up_date: string;
  follow_up_time: string | null;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  notes: string | null;
  completed_at: string | null;
  completed_by: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  quotation_number: string | null;
  customer_name: string | null;
  engineer_name: string | null;
  branch_name: string | null;
  net_subtotal: number | null;
  created_by_name: string | null;
  completed_by_name: string | null;
  days_overdue?: number;
}

export interface ManagementAttentionAlert {
  id: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'URGENT';
  title: string;
  message: string;
  quotation_id?: number;
  quotation_number?: string;
  company_id?: number;
  customer_name?: string;
  sales_engineer_id?: number;
  engineer_name?: string;
  branch_id?: number;
  branch_name?: string;
  action_link?: string;
}

export interface ManagementAttentionResponse {
  alerts: ManagementAttentionAlert[];
  total: number;
}

export interface HighValueOpportunitiesResponse {
  opportunities: SalesPipelineRecord[];
  high_value_threshold: number;
  total: number;
}

export interface StaleQuotationsResponse {
  stale_quotations: SalesPipelineRecord[];
  stale_threshold_days: number;
  total: number;
}

export interface Customer360Pipeline {
  customer: {
    id: number;
    name: string;
    assigned_engineer: string | null;
    branch: string | null;
    phone: string | null;
    email: string | null;
  };
  sales_summary: {
    confirmed_sales_value: number;
    open_pipeline_value: number;
    open_quotations_count: number;
    open_orders_count: number;
  };
  activity: {
    last_quotation_date: string | null;
    last_follow_up_date: string | null;
    last_order_date: string | null;
    last_confirmed_sale_date: string | null;
  };
  current_opportunities: SalesPipelineRecord[];
}

export interface EngineerFollowUpPerformance {
  engineer: {
    id: number;
    name: string;
    designation: string | null;
    branch_name: string | null;
  };
  due_today_count: number;
  overdue_count: number;
  upcoming_count: number;
  completed_this_month_count: number;
  open_quotations_count: number;
  stale_quotations_count: number;
  follow_ups: SalesFollowUp[];
}

export interface QuotationTimelineEvent {
  event_type?: string;
  stage?: string;
  title: string;
  description: string;
  timestamp?: string;
  event_timestamp?: string;
  status?: string;
  user_name?: string;
}

export interface QuotationTimelineResponse {
  timeline: QuotationTimelineEvent[];
  count?: number;
}

function buildQuery(params: Record<string, any>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      query.append(k, String(v));
    }
  });
  const str = query.toString();
  return str ? `?${str}` : '';
}

export async function fetchSalesPipeline(params: Record<string, any> = {}): Promise<SalesPipelineResponse> {
  return request<SalesPipelineResponse>(`/sales/pipeline${buildQuery(params)}`);
}

export async function fetchSalesPipelineSummary(params: Record<string, any> = {}): Promise<SalesPipelineSummary> {
  return request<SalesPipelineSummary>(`/sales/pipeline/summary${buildQuery(params)}`);
}

export async function fetchManagementAttention(params: Record<string, any> = {}): Promise<ManagementAttentionResponse> {
  return request<ManagementAttentionResponse>(`/sales/management-attention${buildQuery(params)}`);
}

export async function fetchHighValueOpportunities(params: Record<string, any> = {}): Promise<HighValueOpportunitiesResponse> {
  return request<HighValueOpportunitiesResponse>(`/sales/high-value-opportunities${buildQuery(params)}`);
}

export async function fetchStaleQuotations(params: Record<string, any> = {}): Promise<StaleQuotationsResponse> {
  return request<StaleQuotationsResponse>(`/sales/stale-quotations${buildQuery(params)}`);
}

export async function fetchFollowUps(params: Record<string, any> = {}): Promise<SalesFollowUp[]> {
  return request<SalesFollowUp[]>(`/sales/follow-ups${buildQuery(params)}`);
}

export async function fetchFollowUpsDueToday(params: Record<string, any> = {}): Promise<SalesFollowUp[]> {
  return request<SalesFollowUp[]>(`/sales/follow-ups/due-today${buildQuery(params)}`);
}

export async function fetchFollowUpsOverdue(params: Record<string, any> = {}): Promise<SalesFollowUp[]> {
  return request<SalesFollowUp[]>(`/sales/follow-ups/overdue${buildQuery(params)}`);
}

export async function createFollowUpApi(data: {
  quotationId?: number;
  companyId?: number;
  salesEngineerId?: number;
  branchId?: number;
  firmId?: number;
  followUpDate: string;
  followUpTime?: string;
  priority?: FollowUpPriority;
  status?: FollowUpStatus;
  notes?: string;
}): Promise<SalesFollowUp> {
  return request<SalesFollowUp>('/sales/follow-ups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rescheduleFollowUpApi(
  id: number,
  data: { followUpDate: string; followUpTime?: string; notes?: string }
): Promise<SalesFollowUp> {
  return request<SalesFollowUp>(`/sales/follow-ups/${id}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function completeFollowUpApi(
  id: number,
  data: { outcome?: string; notes?: string }
): Promise<SalesFollowUp> {
  return request<SalesFollowUp>(`/sales/follow-ups/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchEngineerFollowUpPerformance(
  engineerId: number,
  params: Record<string, any> = {}
): Promise<EngineerFollowUpPerformance> {
  return request<EngineerFollowUpPerformance>(`/sales/engineers/${engineerId}/follow-up-performance${buildQuery(params)}`);
}

export async function fetchCustomer360Pipeline(customerId: number): Promise<Customer360Pipeline> {
  return request<Customer360Pipeline>(`/sales/customers/${customerId}/360`);
}


export async function fetchQuotationTimeline(quotationId: number): Promise<QuotationTimelineResponse> {
  const res = await request<any>(`/sales/quotations/${quotationId}/timeline`);
  if (Array.isArray(res)) {
    return { timeline: res, count: res.length };
  }
  return { timeline: Array.isArray(res?.timeline) ? res.timeline : [], count: res?.count || 0 };
}

export async function fetchSalesActivityApi(params: Record<string, any> = {}): Promise<{ activities: any[]; total: number }> {
  return request<{ activities: any[]; total: number }>(`/sales/activity${buildQuery(params)}`);
}

export interface SearchResultItem {
  type: 'PRODUCT' | 'PRODUCT_STOCK' | 'CUSTOMER' | 'QUOTATION' | 'PURCHASE_ORDER' | 'PERFORMA_INVOICE' | 'SALE_REPORT' | 'SALES_ENGINEER' | 'WAREHOUSE' | 'FOLLOW_UP';
  id: number;
  title: string;
  subtitle: string;
  metadata?: Record<string, any>;
  route: string;
  score: number;
}

export interface GlobalSearchResponse {
  query: string;
  intent: string;
  isExactMatch: boolean;
  bestMatch: SearchResultItem | null;
  results: SearchResultItem[];
  groups: Record<string, SearchResultItem[]>;
}

export async function searchGlobalApi(q: string, limit: number = 30): Promise<GlobalSearchResponse> {
  return request<GlobalSearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}







