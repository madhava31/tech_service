// In local dev this stays '/api' and goes through Vite's proxy (vite.config.ts) to localhost:4000.
// In production, frontend and API are served from the same Vercel deployment/domain, so '/api'
// resolves correctly there too. VITE_API_URL is only needed if the API is split to another domain.
const BASE = import.meta.env.VITE_API_URL || '/api';

// Right after a deploy or a cold start the server can answer a few requests with a 500 while it
// reconnects to the database. Reads (GET) are safe to repeat, so they are retried quietly twice
// before the user sees an error. Writes are never repeated. A 503 MIGRATION_REQUIRED is a real
// answer, not a blip, so it is not retried either.
const RETRY_DELAYS_MS = [400, 1200];
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A page opens with a burst of reads (the dashboard asks for about eight things at once). Every concurrent request can start its own
// server instance with its own database connections, and the database allows only so many ("too many clients"), most visibly right
// after a deploy. Reads are therefore sent a few at a time; the rest wait their turn (a few milliseconds each).
const MAX_CONCURRENT_READS = 4;
let activeReads = 0;
const waitingReads: Array<() => void> = [];
async function withReadSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeReads >= MAX_CONCURRENT_READS) await new Promise<void>((resolve) => waitingReads.push(resolve));
  activeReads++;
  try {
    return await run();
  } finally {
    activeReads--;
    waitingReads.shift()?.();
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isRead = (options?.method || 'GET').toUpperCase() === 'GET';
  return isRead ? withReadSlot(() => requestOnce<T>(path, options, isRead)) : requestOnce<T>(path, options, isRead);
}

async function requestOnce<T>(path: string, options: RequestInit | undefined, isRead: boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options,
    });
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return res.json();
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (isRead && attempt < RETRY_DELAYS_MS.length && RETRYABLE_STATUSES.has(res.status) && body?.code !== 'MIGRATION_REQUIRED') {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    // status lets callers tell e.g. "already deleted" (404) apart from real failures
    throw Object.assign(new Error(body.error || `Request failed: ${res.status}`), { status: res.status });
  }
}

export async function openPdfDocument(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Failed to generate PDF (${res.status})`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}

import { queryClient } from './lib/queryClient';

export async function cachedFetch<T>(
  key: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  ttlMs = 60000,
  signal?: AbortSignal
): Promise<T> {
  const tag = key.split('_')[0] || key;
  return queryClient.fetchQuery<T>({
    queryKey: key,
    queryFn: (s) => fetcher(signal || s),
    staleTime: ttlMs,
    tags: [tag],
  });
}

export function clearCache(keyPattern?: string) {
  if (!keyPattern) {
    queryClient.clear();
    return;
  }
  queryClient.invalidateTags([keyPattern]);
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

/** One contact person of a company (migration 004). A quotation picks one, or adds a new one. */
export interface CompanyContact {
  id: number;
  company_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  created_at?: string;
}

export type PaymentStatus = 'paid' | 'partly_paid' | 'due' | 'overdue' | 'not_started';

/** One part of a quotation's payment schedule: the advance (due after the PO) or the balance (due after the PI). */
export interface PaymentPart {
  key: 'advance' | 'balance';
  label: string;
  amount: number;
  starts_on: string | null;
  starts_with: string;
  due_date: string | null;
  received: number;
  outstanding: number;
  status: PaymentStatus;
  status_label: string;
  days_overdue: number;
}

export interface PaymentSchedule {
  total: number;
  advance_percent: number;
  payment_due_days: number;
  terms_text: string;
  received: number;
  outstanding: number;
  parts: PaymentPart[];
  next_due_date: string | null;
  days_overdue: number;
  status: PaymentStatus;
  status_label: string;
}

export interface QuotationPayment {
  id: number;
  amount: number;
  paid_on: string;
  mode: string | null;
  reference: string | null;
  note: string | null;
  created_by_username?: string | null;
}

export interface QuotationPaymentsData {
  schedule: PaymentSchedule;
  payments: QuotationPayment[];
}

export interface PaymentDueItem {
  quotation_id: number;
  quotation_number: string;
  company_id: number;
  company_name: string;
  contact_person: string | null;
  contact_phone: string | null;
  po_date: string | null;
  pi_date: string | null;
  total: number;
  advance_percent: number;
  received: number;
  outstanding: number;
  /** Unpaid amount of the parts already past their due date. */
  overdue_amount: number;
  next_due_date: string | null;
  days_overdue: number;
  status: PaymentStatus;
  status_label: string;
}

export interface PaymentsDueData {
  today: string;
  items: PaymentDueItem[];
  totals: { count: number; outstanding: number; overdue_count: number; overdue_amount: number };
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
  purchaseActivity?: {
    timesPurchased: number;
    purchasedQty: number;
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
  /** The product name. */
  description: string;
  unit: string;
  /** List price (INR): the default unit price on quotations. */
  default_price: number;
  make?: string | null;
  key_features?: string[];
}

export interface ProductImportErrorRow {
  rowNumber: number;
  productName: string | null;
  partNo: string | null;
  price: number | null;
  hsnSac?: string;
  unit?: string;
  errors: string[];
}

export interface ProductImportValidRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  price: number;
  hsnSac?: string;
  unit?: string;
}

export interface ProductImportNewRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  price: number;
  hsnSac?: string;
  unit?: string;
}

export interface ProductImportUpdateRow {
  rowNumber: number;
  productName: string;
  partNo: string;
  currentPrice: number;
  newPrice: number;
  hsnSac?: string;
  unit?: string;
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

export interface QuotationRevision {
  id: number;
  revision_no: number;
  total: number;
  subtotal: number;
  tax_amount: number;
  note: string | null;
  created_at: string;
  created_by_username: string | null;
  items: { part_no: string | null; description: string; qty: number; unit_price: number; discount_type: string; discount_value: number; line_total: number }[];
}
export interface QuotationRevisionList {
  ready: boolean;
  revisions: QuotationRevision[];
}

export interface ExportKey {
  id: number;
  label: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface QuotationPoItem {
  quotation_item_id: number;
  qty: number;
  quoted_qty: number;
  part_no: string | null;
  description: string;
}
export interface QuotationPo {
  id: number;
  po_number: string;
  po_date: string;
  notes: string | null;
  created_at: string;
  created_by_username: string | null;
  ordered_items: number;
  items: QuotationPoItem[];
}
export interface QuotationPoList {
  quoted_items: number;
  pos: QuotationPo[];
}

/** An invoice of a quotation (migration 012): number typed from the tax invoice, items billed, payment due date. */
export interface QuotationInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  payment_due_date: string;
  notes: string | null;
  created_at: string;
  created_by_username: string | null;
  invoiced_items: number;
  /** The stock that left the warehouse with this invoice. */
  stock_movements?: { product_id: number; part_no: string | null; qty: number; warehouse_name: string }[];
  items: { quotation_invoice_id: number; quotation_item_id: number; qty: number; part_no: string | null; description: string; quoted_qty: number }[];
}
export interface SerialUnit {
  id: number;
  product_id: number;
  part_no: string;
  description: string;
  hsn_sac: string | null;
  make: string | null;
  serial_number: string;
  inward_date: string;
  outward_date: string | null;
  invoice_number: string | null;
  in_hand: 0 | 1;
}
export interface SerialListParams {
  q?: string;
  make?: string;
  status?: '' | 'in_stock' | 'sent';
  from?: string;
  to?: string;
}
function serialQuery(p?: SerialListParams) {
  const qs = new URLSearchParams();
  if (p?.q?.trim()) qs.set('q', p.q.trim());
  if (p?.make?.trim()) qs.set('make', p.make.trim());
  if (p?.status) qs.set('status', p.status);
  if (p?.from) qs.set('from', p.from);
  if (p?.to) qs.set('to', p.to);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface QuotationInvoiceList {
  quoted_items: number;
  invoices: QuotationInvoice[];
}

export interface QuotationEmailResult {
  ok: boolean;
  status: 'SIMULATED_NOT_SENT' | 'SENT';
  simulated: boolean;
  provider: string;
  filename: string;
  attachment_bytes: number;
  log_id: number;
  message: string;
}

export interface QuotationItem {
  id?: number;
  /** Instrument quotation: the line prints in bold as a main unit (migration 006). */
  is_main?: boolean;
  /** Unit of the product (Nos, Pkt, ...), joined in by the quotation endpoints. */
  unit?: string | null;
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
  /** Snapshot of the catalogue product when the quotation was saved (quotation module). */
  product_name?: string | null;
  key_features?: string[] | null;
}

export interface QuotationTerm {
  label: string;
  text: string;
}

/** Body sent by the quotation module's form (POST /quotations and PUT /quotations/:id). */
export interface QuotationModulePayload {
  company_id: number;
  contact_person: string;
  date: string;
  opportunity_ref: string;
  tax_percent: number;
  items: { part_no: string; qty: number; unit_price: number; discount_percent: number }[];
  terms: QuotationTerm[];
}

export interface Quotation {
  id: number;
  number: string;
  date: string;
  company_id: number;
  company_name?: string;
  sales_engineer_id?: number | null;
  sales_engineer_name?: string | null;
  /** How many performa invoices this quotation has (the status then shows "PI generated"). */
  pi_count?: number;
  sales_engineer_code?: string | null;
  /** The sales people who worked on this quotation with their share of the sales target; empty with a single sales person. */
  sales_team?: { sales_engineer_id: number; name: string; code: string | null; share_percent: number; is_primary: boolean }[];
  /** False until the sales team database update (migration 011) is applied. */
  sales_team_available?: boolean;
  firm_id?: number | null;
  firm_name?: string | null;
  firm_address?: string | null;
  firm_gstin?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  branch_address?: string | null;
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
  contact_person?: string | null;
  /** 'lump_sum': one total for all items, no per-item prices on the PDF (migration 005). */
  pricing_mode?: 'itemized' | 'lump_sum';
  /** 'instrument' prints in the instrument format under instrument_title (migration 006). */
  quotation_type?: 'standard' | 'instrument';
  instrument_title?: string | null;
  lump_sum_amount?: number | string | null;
  /** Contact chosen for this quotation and a snapshot of its phone and email (migration 004). */
  contact_id?: number | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** Saved contact to use, or a new contact to add to the company, when saving (request only). */
  new_contact?: { name: string; phone?: string; email?: string } | null;
  /** Advance payment %, default 100. Due payment_due_days after the PO; the balance after the PI. */
  advance_percent?: number | string | null;
  payment_due_days?: number | null;
  payment_schedule?: PaymentSchedule | null;
  payments?: QuotationPayment[];
  company_phone?: string | null;
  company_email?: string | null;
  opportunity_ref?: string | null;
  /** Ordered terms printed on the PDF; null for quotations made before the quotation module. */
  terms?: QuotationTerm[] | null;
  created_by_user_id?: number | null;
  created_by_username?: string | null;
  /** Comma-separated part numbers of the lines (list endpoint). */
  items_part_nos?: string | null;
  company_address?: string | null;
  company_state?: string | null;
}

export type ChallanType = 'non_returnable' | 'returnable';

export interface DeliveryChallanItem {
  id?: number;
  line_no?: number;
  product_id?: number | null;
  part_no: string | null;
  description: string;
  qty: number;
}

/** A delivery challan never carries a price: only part no, description and quantity. */
export interface DeliveryChallan {
  id: number;
  number: string;
  date: string;
  challan_type: ChallanType;
  invoice_no: string | null;
  quotation_id: number | null;
  quotation_number: string | null;
  customer_name: string;
  customer_address: string | null;
  attention: string | null;
  phone: string | null;
  order_date: string | null;
  work_order_no: string | null;
  job: string | null;
  remarks: string | null;
  created_by_user_id: number | null;
  created_by_username?: string | null;
  items: DeliveryChallanItem[];
}

export interface DeliveryChallanListRow {
  id: number;
  number: string;
  date: string;
  challan_type: ChallanType;
  customer_name: string;
  quotation_id: number | null;
  quotation_number: string | null;
  created_by_user_id: number | null;
  created_by_username: string | null;
  /** e.g. "TS-PE-AAS × 1, TS-MT-ANBAL × 2" */
  items_summary: string | null;
}

/** Body of POST/PUT /delivery-challans; also what /from-quotation returns to pre-fill the form. */
export interface DeliveryChallanInput {
  challan_type: ChallanType;
  date: string;
  invoice_no: string;
  quotation_id?: number | null;
  quotation_number?: string | null;
  customer_name: string;
  customer_address: string;
  attention: string;
  phone: string;
  order_date: string;
  work_order_no: string;
  job: string;
  remarks: string;
  items: { part_no: string; description: string; qty: number | string }[];
}

export interface QuotationListParams {
  page?: number;
  pageSize?: number;
  searchNumber?: string;
  searchCompany?: string;
  status?: string;
  dateStart?: string;
  dateEnd?: string;
  minAmount?: number;
  maxAmount?: number;
  paginated?: boolean;
  /** Admin only: quotations created by this user id. */
  createdBy?: number;
  /** Admin only: quotations whose sales person (sales engineer) is this one. */
  salesEngineerId?: number;
}

export interface QuotationPageResponse {
  items: Quotation[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
  stageCounts: {
    All: number;
    Draft: number;
    Sent: number;
    Negotiation: number;
    Accepted: number;
    Rejected: number;
    [key: string]: number;
  };
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
  employee_code?: string;
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
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  quotation_prefix?: string | null;
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
  gstin?: string | null;
  pan?: string | null;
  quotation_prefix?: string | null;
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

export type SentPoTaxType = 'NONE' | 'GST' | 'IGST' | 'EXEMPT';
export interface SentPoLine {
  id?: number;
  product_id?: number | null;
  part_no: string | null;
  description: string | null;
  hsn_sac: string | null;
  qty: number;
  unit: string | null;
  price: number;
  discount_percent: number;
  discount_amount: number;
  tax_type: SentPoTaxType;
  tax_percent: number;
  taxable_amount?: number;
  tax_amount?: number;
  amount?: number;
}
export interface SentPoInput {
  company_id?: number | null;
  supplier_name?: string | null;
  prefix: string;
  seq: number | null;
  order_date: string;
  due_date?: string | null;
  state_of_supply?: string | null;
  price_includes_tax: boolean;
  round_off_enabled: boolean;
  advance_amount: number;
  terms_title?: string | null;
  terms_text?: string | null;
  payment_type?: string | null;
  payment_reference?: string | null;
  payment_description?: string | null;
  notes?: string | null;
  items: SentPoLine[];
}
export interface SentPo extends Omit<SentPoInput, 'items'> {
  id: number;
  number: string;
  supplier_name: string;
  total: number;
  balance: number;
  total_tax: number;
  sub_total: number;
  round_off: number;
  items: SentPoLine[];
  created_by_username?: string | null;
}
export interface SentPoListRow {
  id: number;
  number: string;
  order_date: string;
  due_date: string | null;
  supplier_name: string;
  company_id: number | null;
  state_of_supply: string | null;
  total: number;
  advance_amount: number;
  balance: number;
  lines: number;
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
  /** The customer's PO number(s) and date(s) this PI is raised against. */
  po_refs?: { po_number: string; po_date: string | null }[];
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
  /** Defaults for new quotations (migration 004). */
  default_advance_percent?: number | string;
  default_payment_due_days?: number;
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
  periodRevenue?: number;
  acceptedQuotationRevenue: number;
  monthlyTrend: { month: string; label?: string; total: number }[];
  trend?: { label: string; value: number; key?: string }[];
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
  isReset?: boolean;
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

export type PipelineStageKey = 'draft' | 'sent' | 'negotiation' | 'accepted' | 'rejected';

export interface YearAnalysisStatus {
  year: number;
  exists: boolean;
  batchId?: number;
  filename?: string;
  rowCount?: number;
  importedCount?: number;
  skippedCount?: number;
  uploadedAt?: string;
}

export interface StoredAnalysisYear {
  year: number;
  filename: string;
  importedCount: number;
  uploadedAt: string;
}

export interface YearAnalysisUploadResult {
  year: number;
  batchId: number;
  filename: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  skippedSamples: { row: number; reasons: string[] }[];
}

export interface YearAnalysisSummary extends YearAnalysisStatus {
  kpis: {
    totalRevenue: number;
    invoiceCount: number;
    lineCount: number;
    companyCount: number;
    productCount: number;
    totalQty: number;
    avgInvoiceValue: number;
    avgMonthlyRevenue: number;
    bestMonth: { label: string; revenue: number } | null;
  };
  monthly: { month: number; label: string; revenue: number; invoices: number }[];
  topCompanies: { name: string; revenue: number; invoices: number }[];
  topProducts: { partNo: string | null; description: string; revenue: number; qty: number }[];
  byState: { state: string; revenue: number }[];
}

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
    list: (q?: string, signal?: AbortSignal) =>
      q
        ? request<Company[]>(`/companies?q=${encodeURIComponent(q)}`, { signal })
        : cachedFetch('companies_all', (s) => request<Company[]>('/companies', { signal: signal || s }), 60000, signal),
    get: (id: number) => request<Company>(`/companies/${id}`),
    contacts: (companyId: number) => request<CompanyContact[]>(`/companies/${companyId}/contacts`),
    addContact: (companyId: number, data: { name: string; phone?: string; email?: string }) =>
      request<CompanyContact>(`/companies/${companyId}/contacts`, { method: 'POST', body: JSON.stringify(data) }),
    create: async (data: Partial<Company>) => {
      const res = await request<Company>('/companies', { method: 'POST', body: JSON.stringify(data) });
      clearCache('companies');
      return res;
    },
    update: async (id: number, data: Partial<Company>) => {
      const res = await request<Company>(`/companies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      clearCache('companies');
      return res;
    },
    health: (id: number) => request<CompanyHealthData>(`/companies/${id}/health`),
    healthSummary: () => request<CustomerHealthSummaryData>('/companies/health-summary'),
    delete: async (id: number) => {
      const res = await request<{ ok: boolean }>(`/companies/${id}`, { method: 'DELETE' });
      clearCache('companies');
      return res;
    },
    bulkDelete: async (ids: number[]) => {
      const res = await request<{ success: boolean; deletedCount: number; blockedCount?: number; blockedNames?: string[]; message?: string }>(
        '/companies/bulk-delete',
        { method: 'POST', body: JSON.stringify({ ids }) }
      );
      clearCache('companies');
      return res;
    },
  },
  products: {
    list: (q?: string, signal?: AbortSignal) =>
      q
        ? request<Product[]>(`/products?q=${encodeURIComponent(q)}`, { signal })
        : cachedFetch('products_all', (s) => request<Product[]>('/products', { signal: signal || s }), 60000, signal),
    get: (id: number) => request<Product>(`/products/${id}`),
    create: async (data: Partial<Product>) => {
      const res = await request<Product>('/products', { method: 'POST', body: JSON.stringify(data) });
      clearCache('products');
      return res;
    },
    update: async (id: number, data: Partial<Product>) => {
      const res = await request<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      clearCache('products');
      return res;
    },
    makes: () => request<string[]>('/products/makes'),
    intelligence: (id: number) => request<ProductIntelligenceData>(`/products/${id}/intelligence`),
    intelligenceSummary: () => request<ProductIntelligenceSummaryData>('/products/intelligence-summary'),
    templateUrl: () => `${BASE}/products/import/template`,
    /** The catalogue as Excel, filtered the same way as the Products page (search and company). */
    exportUrl: (params?: { q?: string; make?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q?.trim()) qs.set('q', params.q.trim());
      if (params?.make?.trim()) qs.set('make', params.make.trim());
      const str = qs.toString();
      return `${BASE}/products/export.xlsx${str ? `?${str}` : ''}`;
    },
    importPreview: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/products/import/preview`, { method: 'POST', body: formData, credentials: 'include' });
      const body = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(body.error || `Preview failed: ${res.status}`);
      return body as ProductImportPreview;
    },
    importCommit: async (rows: ProductImportValidRow[]) => {
      const res = await request<ProductImportResult>('/products/import', { method: 'POST', body: JSON.stringify({ rows }) });
      clearCache('products');
      return res;
    },
  },
  quotations: {
    list: ((params?: QuotationListParams, signal?: AbortSignal) => {
      if (!params || (!params.page && !params.pageSize && !params.paginated && !params.searchNumber && !params.searchCompany && !params.status && !params.dateStart && !params.dateEnd && params.minAmount === undefined && params.maxAmount === undefined)) {
        return request<Quotation[]>('/quotations', { signal });
      }
      const q = new URLSearchParams();
      if (params.page !== undefined) q.set('page', String(params.page));
      if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
      if (params.searchNumber) q.set('searchNumber', params.searchNumber);
      if (params.searchCompany) q.set('searchCompany', params.searchCompany);
      if (params.status) q.set('status', params.status);
      if (params.dateStart) q.set('dateStart', params.dateStart);
      if (params.dateEnd) q.set('dateEnd', params.dateEnd);
      if (params.minAmount !== undefined) q.set('minAmount', String(params.minAmount));
      if (params.maxAmount !== undefined) q.set('maxAmount', String(params.maxAmount));
      if (params.paginated) q.set('paginated', 'true');
      if (params.createdBy) q.set('createdBy', String(params.createdBy));
      if (params.salesEngineerId) q.set('salesEngineerId', String(params.salesEngineerId));
      const qs = q.toString();
      return request<QuotationPageResponse>(`/quotations${qs ? `?${qs}` : ''}`, { signal });
    }) as {
      (params: QuotationListParams, signal?: AbortSignal): Promise<QuotationPageResponse>;
      (params?: undefined, signal?: AbortSignal): Promise<Quotation[]>;
    },
    get: (id: number) => request<Quotation>(`/quotations/${id}`),
    nextNumber: (params?: string | { date?: string; prefix?: string; firmId?: number; branchId?: number }) => {
      let qs = '';
      if (typeof params === 'string') {
        qs = params ? `?date=${encodeURIComponent(params)}` : '';
      } else if (params) {
        const q = new URLSearchParams();
        if (params.date) q.set('date', params.date);
        if (params.prefix) q.set('prefix', params.prefix);
        if (params.firmId) q.set('firmId', String(params.firmId));
        if (params.branchId) q.set('branchId', String(params.branchId));
        const s = q.toString();
        if (s) qs = `?${s}`;
      }
      return request<{ number: string; prefix?: string }>(`/quotations/next-number${qs}`);
    },
    payments: (id: number) => request<QuotationPaymentsData>(`/quotations/${id}/payments`),
    recordPayment: (id: number, data: { amount: number; paid_on: string; mode?: string; reference?: string; note?: string }) =>
      request<QuotationPaymentsData>(`/quotations/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
    deletePayment: (id: number, paymentId: number) =>
      request<QuotationPaymentsData>(`/quotations/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    create: async (data: Partial<Quotation> | QuotationModulePayload) => {
      const res = await request<Quotation>('/quotations', { method: 'POST', body: JSON.stringify(data) });
      clearCache('quotations');
      clearCache('products');
      return res;
    },
    update: async (id: number, data: Partial<Quotation> | QuotationModulePayload) => {
      const res = await request<Quotation>(`/quotations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      clearCache('quotations');
      clearCache('products');
      return res;
    },
    delete: async (id: number) => {
      const res = await request<{ success: boolean; message: string }>(`/quotations/${id}`, { method: 'DELETE' });
      clearCache('quotations');
      return res;
    },
    calculatePricing: (data: {
      items: any[];
      overallDiscountType?: string;
      overallDiscountValue?: number;
      taxPercent?: number;
    }) => request<any>('/quotations/calculate-pricing', { method: 'POST', body: JSON.stringify(data) }),
    setStatus: async (id: number, status: string, note?: string) => {
      const res = await request<Quotation>(`/quotations/${id}/status`, { method: 'POST', body: JSON.stringify(note ? { status, note } : { status }) });
      clearCache('quotations');
      return res;
    },
    /** Negotiation history: the versions that were sent before each round (migration 010; empty and ready:false until then). */
    revisions: (id: number) => request<QuotationRevisionList>(`/quotations/${id}/revisions`),
    pdfUrl: (id: number) => `${BASE}/quotations/${id}/pdf`,
    downloadPdfUrl: (id: number) => `${BASE}/quotations/${id}/pdf?download=1`,
    openPdf: (id: number) => openPdfDocument(`/quotations/${id}/pdf`),
    /** Admin only. Emails the quotation PDF; with the mock provider the result is SIMULATED_NOT_SENT and nothing is sent. */
    sendEmail: (id: number, data: { to: string; cc?: string; subject: string; message: string }) =>
      request<QuotationEmailResult>(`/quotations/${id}/send-email`, { method: 'POST', body: JSON.stringify(data) }),
    /** PO received (migration 008): the customer POs of a quotation, typed by hand, with the items each one ordered. */
    salesTeam: {
      save: async (id: number, members: { sales_engineer_id: number; share_percent: number }[]) => {
        const res = await request<{ members: unknown[] }>(`/quotations/${id}/sales-team`, { method: 'PUT', body: JSON.stringify({ members }) });
        clearCache('quotations');
        clearCache('engineers');
        return res;
      },
    },
    invoices: {
      list: (id: number) => request<QuotationInvoiceList>(`/quotations/${id}/invoices`),
      /** Stock on hand and available of each line, in the warehouse (the default one when none is given). */
      stock: (id: number, warehouseId?: number) =>
        request<{ warehouse: { id: number; name: string } | null; items: { quotation_item_id: number; tracked: boolean; on_hand: number; available: number; serials?: { id: number; serial_number: string }[] }[] }>(`/quotations/${id}/invoice-stock${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
      create: async (id: number, data: { invoice_number: string; invoice_date?: string; payment_due_date?: string; notes?: string; warehouse_id?: number; items: { quotation_item_id: number; qty: number }[]; /** Serial numbers picked per quotation item id, for products kept by serial number. */ serials?: Record<number, number[]> }) => {
        const res = await request<{ id: number; invoice_number: string; payment_due_date: string; invoiced_items: number; stock?: { warehouse: string | null; deducted: number; untracked: number } }>(`/quotations/${id}/invoices`, { method: 'POST', body: JSON.stringify(data) });
        clearCache('quotations');
        return res;
      },
      remove: async (id: number, invoiceId: number) => {
        const res = await request<{ ok: boolean }>(`/quotations/${id}/invoices/${invoiceId}`, { method: 'DELETE' });
        clearCache('quotations');
        return res;
      },
    },
    /** The standard Terms & Conditions for an advance % and due days (what prints unless the user edits them). */
    termsDefaults: (params?: { advance_percent?: number; payment_due_days?: number; /** 0 = No GST: the terms add "GST: 18% extra". */ tax_percent?: number }) => {
      const q = new URLSearchParams();
      if (params?.tax_percent !== undefined && Number.isFinite(params.tax_percent)) q.set('tax_percent', String(params.tax_percent));
      if (params?.advance_percent !== undefined && Number.isFinite(params.advance_percent)) q.set('advance_percent', String(params.advance_percent));
      if (params?.payment_due_days !== undefined && Number.isFinite(params.payment_due_days)) q.set('payment_due_days', String(params.payment_due_days));
      const qs = q.toString();
      return request<{ terms: QuotationTerm[] }>(`/quotations/terms-defaults${qs ? `?${qs}` : ''}`);
    },
    poReceived: {
      list: (id: number) => request<QuotationPoList>(`/quotations/${id}/po-received`),
      create: async (id: number, data: { po_number: string; po_date?: string; notes?: string; items: { quotation_item_id: number; qty: number }[] }) => {
        const res = await request<{ id: number; po_number: string; ordered_items: number }>(`/quotations/${id}/po-received`, { method: 'POST', body: JSON.stringify(data) });
        clearCache('quotations');
        return res;
      },
      remove: async (id: number, poId: number) => {
        const res = await request<{ ok: boolean }>(`/quotations/${id}/po-received/${poId}`, { method: 'DELETE' });
        clearCache('quotations');
        return res;
      },
      /** Changes a PO received: number, date, notes, items and quantities. */
      update: async (id: number, poId: number, data: { po_number: string; po_date?: string; notes?: string; items: { quotation_item_id: number; qty: number }[] }) => {
        const res = await request<{ id: number; po_number: string; ordered_items: number }>(`/quotations/${id}/po-received/${poId}`, { method: 'PUT', body: JSON.stringify(data) });
        clearCache('quotations');
        return res;
      },
    },
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
    /** Customer POs recorded with PO received or a manual order (one row per PO). */
    received: () => request<PurchaseOrder[]>('/purchase-orders/received'),
    list: (params?: { quotation_id?: number }) => {
      const qs = params?.quotation_id ? `?quotation_id=${encodeURIComponent(params.quotation_id)}` : '';
      return request<PurchaseOrder[]>(`/purchase-orders${qs}`);
    },
    get: (id: number) => request<PurchaseOrder>(`/purchase-orders/${id}`),
    create: (data: { quotation_id: number; client_po_ref?: string; date?: string }) =>
      request<PurchaseOrder>('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    pdfUrl: (id: number) => `${BASE}/purchase-orders/${id}/pdf`,
    openPdf: (id: number) => openPdfDocument(`/purchase-orders/${id}/pdf`),
  },
  /** POs Technicon sends to its suppliers (migration 016). */
  sentPos: {
    list: (params?: { q?: string; from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q?.trim()) qs.set('q', params.q.trim());
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      const str = qs.toString();
      return request<SentPoListRow[]>(`/sent-pos${str ? `?${str}` : ''}`);
    },
    get: (id: number) => request<SentPo>(`/sent-pos/${id}`),
    nextNumber: (prefix?: string) =>
      request<{ prefix: string; seq: number; last_prefix: string | null; last_terms_title: string | null; last_terms_text: string | null }>(
        `/sent-pos/next-number${prefix !== undefined ? `?prefix=${encodeURIComponent(prefix)}` : ''}`
      ),
    create: (data: SentPoInput) => request<SentPo>('/sent-pos', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: SentPoInput) => request<SentPo>(`/sent-pos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<{ ok: boolean }>(`/sent-pos/${id}`, { method: 'DELETE' }),
    pdfUrl: (id: number) => `${BASE}/sent-pos/${id}/pdf`,
  },
  performaInvoices: {
    list: (params?: { quotation_id?: number }) => {
      const qs = params?.quotation_id ? `?quotation_id=${encodeURIComponent(params.quotation_id)}` : '';
      return request<PerformaInvoice[]>(`/performa-invoices${qs}`);
    },
    get: (id: number) => request<PerformaInvoice>(`/performa-invoices/${id}`),
    create: (data: { quotation_id: number; purchase_order_id?: number; date?: string }) =>
      request<PerformaInvoice>('/performa-invoices', { method: 'POST', body: JSON.stringify(data) }),
    /** Changes the PI number and date; the PDF shows the change at once. */
    update: (id: number, data: { number: string; date: string }) =>
      request<PerformaInvoice>(`/performa-invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ success: boolean; id: number; message?: string }>(`/performa-invoices/${id}`, { method: 'DELETE' }),
    pdfUrl: (id: number) => `${BASE}/performa-invoices/${id}/pdf`,
    openPdf: (id: number) => openPdfDocument(`/performa-invoices/${id}/pdf`),
  },
  dashboard: {
    get: (params?: { start?: string; end?: string; period?: string }, signal?: AbortSignal) => {
      const q = new URLSearchParams();
      if (params?.start) q.set('start', params.start);
      if (params?.end) q.set('end', params.end);
      if (params?.period) q.set('period', params.period);
      const qs = q.toString();
      return request<DashboardData>(`/dashboard${qs ? `?${qs}` : ''}`, { signal });
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
    paymentsDue: () => request<PaymentsDueData>('/dashboard/payments-due'),
    flaggedSalesRecords: () => request<FlaggedSalesRecordsData>('/dashboard/flagged-sales-records'),
    followUps: () => request<DashboardFollowUpsData>('/dashboard/follow-ups'),
    overdueFollowUps: () => request<OverdueFollowUpsData>('/dashboard/overdue-follow-ups'),
    followUpsDueToday: () => request<DueTodayFollowUpsData>('/dashboard/follow-ups-due-today'),
    recentActivity: () => request<RecentActivityData>('/dashboard/recent-activity'),
    businessHealth: () => request<BusinessHealthData>('/dashboard/business-health'),
    resetBusinessHealth: () =>
      request<{ success: boolean; message: string }>('/dashboard/business-health/reset', { method: 'POST' }),
    restoreBusinessHealth: () =>
      request<{ success: boolean; message: string }>('/dashboard/business-health/restore', { method: 'POST' }),
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
    deleteCompanySales: (name: string) =>
      request<{ success: boolean; deletedCount: number }>(`/reports/companies/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    bulkDeleteCompanies: (companyNames: string[]) =>
      request<{ success: boolean; deletedCount: number; message: string }>('/reports/companies/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ companyNames }),
      }),
    deleteProductSales: (partNo: string) =>
      request<{ success: boolean; deletedCount: number }>(`/reports/products/${encodeURIComponent(partNo)}`, {
        method: 'DELETE',
      }),
    bulkDeleteProducts: (partNos: string[]) =>
      request<{ success: boolean; deletedCount: number; message: string }>('/reports/products/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ partNos }),
      }),
    deleteReviewItem: (id: number) =>
      request<{ success: boolean; deletedCount: number }>(`/reports/review-queue/${id}`, {
        method: 'DELETE',
      }),
    bulkDeleteReviewItems: (ids: number[]) =>
      request<{ success: boolean; deletedCount: number; message: string }>('/reports/review-queue/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },
  settings: {
    /** lite leaves out the logo and signature images, which make the full response about 1 MB. */
    get: (opts?: { lite?: boolean }) => request<CompanySettings>(opts?.lite ? '/settings?lite=1' : '/settings'),
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
  analysis: {
    years: () => request<StoredAnalysisYear[]>('/analysis/years'),
    status: (year: number) => request<YearAnalysisStatus>(`/analysis/${year}/status`),
    summary: (year: number) => request<YearAnalysisSummary>(`/analysis/${year}/summary`),
    upload: async (year: number, file: File): Promise<YearAnalysisUploadResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/analysis/${year}/upload`, { method: 'POST', body: formData, credentials: 'include' });
      const body = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(body.error || `Upload failed: ${res.status}`);
      return body;
    },
    remove: (year: number) => request<{ ok: true; year: number }>(`/analysis/${year}`, { method: 'DELETE' }),
  },
  auth: {
    me: async (): Promise<{ needsSetup?: boolean; user?: AuthUser | null; /** The server could not reach its database for a moment (right after a deploy): ask again, this is not "signed out". */ pending?: boolean; reason?: string }> => {
      // A server error here would otherwise look like "signed out" and show the login page, so it is
      // retried (same quiet retries as other reads) before giving up.
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' });
        if (res.status === 401) return {};
        if (res.ok) return res.json();
        if (attempt < RETRY_DELAYS_MS.length && RETRYABLE_STATUSES.has(res.status)) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw Object.assign(new Error(`Request failed: ${res.status}`), { status: res.status });
      }
    },
    setup: (username: string, password: string) =>
      request<{ user: AuthUser }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
    login: (username: string, password: string) =>
      request<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
    // The signed-in admin's own account; the server never takes a user id from here.
    changeUsername: (newUsername: string, currentPassword: string) =>
      request<{ user: AuthUser }>('/auth/username', { method: 'PUT', body: JSON.stringify({ newUsername, currentPassword }) }),
    changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
      request<{ ok: true }>('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) }),
  },
  admin: {
    stats: () => request<{ counts: Record<string, number>; dbSizeBytes: number }>('/admin/stats'),
    deleteImport: (id: number) => request<{ ok: true }>(`/admin/imports/${id}`, { method: 'DELETE' }),
    // Clear the cached lists so the deleted row doesn't stay on screen for up to 60s
    // (there is no realtime push on Vercel to invalidate them).
    deleteCompany: async (id: number) => {
      const res = await request<{ ok: true }>(`/admin/companies/${id}`, { method: 'DELETE' });
      clearCache('companies');
      return res;
    },
    deleteProduct: async (id: number) => {
      const res = await request<{ ok: true }>(`/admin/products/${id}`, { method: 'DELETE' });
      clearCache('products');
      return res;
    },
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
  deliveryChallans: {
    list: (params?: { quotationId?: number; createdBy?: number }) => {
      const q = new URLSearchParams();
      if (params?.quotationId) q.set('quotationId', String(params.quotationId));
      if (params?.createdBy) q.set('createdBy', String(params.createdBy));
      const qs = q.toString();
      return request<DeliveryChallanListRow[]>(`/delivery-challans${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => request<DeliveryChallan>(`/delivery-challans/${id}`),
    fromQuotation: (quotationId: number) => request<DeliveryChallanInput>(`/delivery-challans/from-quotation/${quotationId}`),
    create: (data: DeliveryChallanInput) => request<DeliveryChallan>('/delivery-challans', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: DeliveryChallanInput) => request<DeliveryChallan>(`/delivery-challans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<{ success: boolean; id: number }>(`/delivery-challans/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => request<{ success: boolean; deletedCount: number }>('/delivery-challans/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    pdfUrl: (id: number) => `${BASE}/delivery-challans/${id}/pdf`,
    downloadPdfUrl: (id: number) => `${BASE}/delivery-challans/${id}/pdf?download=1`,
    blankPdfUrl: () => `${BASE}/delivery-challans/blank/pdf`,
  },
  opportunities: {
    list: () => request<OpportunitiesData>('/opportunities'),
  },
  inventory: {
    getOverview: () => request<InventoryOverviewData>('/inventory/overview'),
    listWarehouses: (activeOnly?: boolean) =>
      cachedFetch(`warehouses_${!!activeOnly}`, () => request<Warehouse[]>(`/inventory/warehouses${activeOnly ? '?active=true' : ''}`)),
    getWarehouse: (id: number) => request<WarehouseDetailResponse>(`/inventory/warehouses/${id}`),
    createWarehouse: async (data: { name: string; code: string; address?: string; city?: string; state?: string; isDefault?: boolean }) => {
      const res = await request<Warehouse>('/inventory/warehouses', { method: 'POST', body: JSON.stringify(data) });
      clearCache('warehouses');
      return res;
    },
    updateWarehouse: async (id: number, data: Partial<{ name: string; code: string; address: string; city: string; state: string; isActive: boolean; isDefault: boolean }>) => {
      const res = await request<Warehouse>(`/inventory/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
      clearCache('warehouses');
      return res;
    },
    deleteWarehouse: async (id: number) => {
      const res = await request<{ success: boolean; id: number; name: string }>(`/inventory/warehouses/${id}`, { method: 'DELETE' });
      clearCache('warehouses');
      return res;
    },
    bulkDeleteWarehouses: async (ids: number[]) => {
      const res = await request<{ success: boolean; deletedCount: number }>('/inventory/warehouses/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      clearCache('warehouses');
      return res;
    },
    getStockSummary: (params?: { warehouseId?: number; lowStock?: boolean; status?: string; q?: string; make?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.lowStock) q.set('lowStock', 'true');
      if (params?.status) q.set('status', params.status);
      if (params?.q) q.set('q', params.q);
      if (params?.make) q.set('make', params.make);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<InventoryStockSummaryResponse>(`/inventory/stock${qs ? `?${qs}` : ''}`);
    },
    getStockMakes: () => request<string[]>('/inventory/stock/makes'),
    setStockMake: (productIds: number[], make: string) =>
      request<{ success: boolean; updated: number }>('/inventory/stock/set-make', {
        method: 'POST',
        body: JSON.stringify({ productIds, make }),
      }),
    // Downloads the stock ledger as .xlsx. `make` may be NO_MAKE for products without a company.
    downloadStockExcel: async (params: { make?: string; warehouseId?: number; status?: string; q?: string }) => {
      const q = new URLSearchParams();
      if (params.make) q.set('make', params.make);
      if (params.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params.status) q.set('status', params.status);
      if (params.q) q.set('q', params.q);
      const res = await fetch(`${BASE}/inventory/stock/export?${q.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Failed to download stock (${res.status})`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Stock_Ledger.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    deleteStockItem: (productId: number) =>
      request<{ success: boolean; id: number; partNo?: string }>(`/inventory/stock/${productId}`, { method: 'DELETE' }),
    bulkDeleteStockItems: (productIds: number[]) =>
      request<{ success: boolean; deletedCount: number }>('/inventory/stock/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ productIds }),
      }),
    importStockExcel: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/inventory/stock/import-excel`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(body.error || 'Failed to import Excel file');
      }
      return res.json() as Promise<{
        success: boolean;
        totalRows: number;
        created: number;
        updated: number;
        errors: string[];
      }>;
    },
    getStockTemplateUrl: () => `${BASE}/inventory/stock/template`,
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
    /** `date` (YYYY-MM-DD) is the day the stock went out; today when left out. */
    fulfillReservation: (id: number, date?: string) =>
      request<{ reservation: StockReservation; stock: any; movement: InventoryMovement }>(`/inventory/fulfill-reservation/${id}`, { method: 'POST', body: JSON.stringify({ date }) }),
    recordReturn: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string }) =>
      request<{ stock: any; movement: InventoryMovement }>('/inventory/return', { method: 'POST', body: JSON.stringify(data) }),
    listMovements: (params?: { warehouseId?: number; productId?: number; movementType?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
      if (params?.dateTo) q.set('dateTo', params.dateTo);
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
    deleteReservation: (id: number) => request<{ success: boolean; id: number }>(`/inventory/reservations/${id}`, { method: 'DELETE' }),
    bulkDeleteReservations: (ids: number[]) =>
      request<{ success: boolean; deletedCount: number }>('/inventory/reservations/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    importReservationsExcel: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}/inventory/reservations/import-excel`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Failed to import reservations');
      }
      return res.json() as Promise<{ success: boolean; createdCount: number; errors: string[] }>;
    },
    getReservationsTemplateUrl: () => `${BASE}/inventory/reservations/template`,
    /** Stock in / out per day of a month or per month of a year (financial or calendar). */
    movementReport: (params: MovementReportParams) => request<MovementReport>(`/inventory/movement-report?${movementReportQuery(params)}`),
    movementReportXlsxUrl: (params: MovementReportParams) => `${BASE}/inventory/movement-report.xlsx?${movementReportQuery({ ...params, limit: undefined, offset: undefined })}`,
    /** Customer orders waiting to be invoiced and what can ship now (oldest PO first). */
    waitingOrders: (params?: WaitingOrdersParams) => request<WaitingOrdersResponse>(`/inventory/waiting-orders${waitingOrdersQuery(params)}`),
    /** The stock statement for sending: one sheet per month plus a Movements sheet. Months are 'YYYY-MM'. */
    stockStatementXlsxUrl: (p: { from: string; to: string; warehouseId?: number; make?: string; all?: boolean }) => {
      const q = new URLSearchParams({ from: p.from, to: p.to });
      if (p.warehouseId) q.set('warehouseId', String(p.warehouseId));
      if (p.make) q.set('make', p.make);
      if (p.all) q.set('all', '1');
      return `${BASE}/inventory/stock-statement.xlsx?${q.toString()}`;
    },
    /** Reads pasted "part number, quantity" lines and finds the products. Nothing is saved. */
    quickEntryPreview: (text: string) => request<QuickEntryPreview>('/inventory/quick-entry/preview', { method: 'POST', body: JSON.stringify({ text }) }),
    today: () => request<TodayStock>('/inventory/today'),
    serials: (params?: SerialListParams) => request<{ available: boolean; rows: SerialUnit[] }>(`/inventory/serials${serialQuery(params)}`),
    serialsXlsxUrl: (params?: SerialListParams) => `${BASE}/inventory/serials.xlsx${serialQuery(params)}`,
    /** Sets a product's low and critical stock limits (admin). */
    setLimits: (productId: number, low: number, critical: number) => request<{ productId: number; lowStockThreshold: number; criticalStockThreshold: number }>(`/inventory/stock/${productId}/limits`, { method: 'PUT', body: JSON.stringify({ low, critical }) }),
    waitingOrdersXlsxUrl: (params?: WaitingOrdersParams) => `${BASE}/inventory/waiting-orders.xlsx${waitingOrdersQuery(params)}`,
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
        items: { productId?: number; partNo?: string; quantity: number; notes?: string; /** One serial number per unit (Mettler). */ serials?: string[] }[];
        confirmImmediately?: boolean;
        /** Company (product make) saved on every product in the receipt. */
        make?: string;
        /** The date the stock came in (YYYY-MM-DD); today when left out. */
        receiptDate?: string;
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
        descriptionColumn?: string;
        notesColumn?: string;
        autoCreateProducts?: boolean;
      }) => {
        const formData = new FormData();
        formData.append('file', data.file);
        formData.append('warehouseId', String(data.warehouseId));
        if (data.sheetName) formData.append('sheetName', data.sheetName);
        formData.append('partNoColumn', data.partNoColumn);
        formData.append('quantityColumn', data.quantityColumn);
        if (data.descriptionColumn) formData.append('descriptionColumn', data.descriptionColumn);
        if (data.notesColumn) formData.append('notesColumn', data.notesColumn);
        if (data.autoCreateProducts) formData.append('autoCreateProducts', 'true');

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
      delete: (id: number) => request<{ success: boolean; id: number }>(`/inventory/receipts/${id}`, { method: 'DELETE' }),
      /** Undoes a confirmed receipt with a correcting entry (the history is kept). Admin only. */
      void: (id: number, reason?: string) => request<StockReceiptDetailResponse>(`/inventory/receipts/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
      bulkDelete: (ids: number[]) =>
        request<{ success: boolean; deletedCount: number }>('/inventory/receipts/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        }),
      importExcel: async (file: File, date?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (date) formData.append('date', date);
        const res = await fetch(`${BASE}/inventory/receipts/import-excel`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Import failed' }));
          throw new Error(err.error || 'Failed to import stock receipts from Excel');
        }
        return res.json() as Promise<{
          success: boolean;
          receiptId: number;
          receiptNumber: string;
          totalItems: number;
          totalQuantity: number;
        }>;
      },
      getTemplateUrl: () => `${BASE}/inventory/receipts/template`,
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
      createAdjustment: (data: { warehouseId: number; productId: number; direction: 'INCREASE' | 'DECREASE'; quantity: number; reason?: string; notes?: string; date?: string }) =>
        request<{ stock: any; movement: InventoryMovement }>('/inventory/adjustments', { method: 'POST', body: JSON.stringify(data) }),
      createReturn: (data: { warehouseId: number; productId: number; quantity: number; referenceType?: string; referenceId?: string; reason?: string; notes?: string; date?: string }) =>
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
      createTransfer: (data: { sourceWarehouseId: number; destinationWarehouseId: number; productId: number; quantity: number; reference?: string; notes?: string; date?: string }) =>
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
      sales_engineer_id?: number | null;
      salesEngineerId?: number | null;
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
    delete: (id: number) =>
      request<{ success: boolean; id: number }>(`/sale-reports/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) =>
      request<{ success: boolean; deletedCount: number }>('/sale-reports/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
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
    list: (activeOnly?: boolean) =>
      cachedFetch(`engineers_${!!activeOnly}`, () => request<SalesEngineer[]>(`/engineers${activeOnly ? '?active=true' : ''}`)),
    get: (id: number, year?: string) => request<SalesEngineer & { current_year_target?: EngineerSalesTarget; performance?: EngineerPerformance }>(`/engineers/${id}${year ? `?financial_year=${encodeURIComponent(year)}` : ''}`),
    create: async (data: Partial<SalesEngineer>) => {
      const res = await request<SalesEngineer>('/engineers', { method: 'POST', body: JSON.stringify(data) });
      clearCache('engineers');
      return res;
    },
    update: async (id: number, data: Partial<SalesEngineer>) => {
      const res = await request<SalesEngineer>(`/engineers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      clearCache('engineers');
      return res;
    },
    performance: (year?: string) => request<EngineerPerformanceSummary>(`/engineers/performance${year ? `?year=${year}` : ''}`),
    setTarget: (data: { engineer_id: number; fiscal_year: string; target_amount: number; notes?: string }) =>
      request<EngineerSalesTarget>('/engineers/targets', { method: 'POST', body: JSON.stringify(data) }),
    getTargets: (year?: string) => request<EngineerSalesTarget[]>(`/engineers/targets${year ? `?year=${year}` : ''}`),
    delete: async (id: number) => {
      const res = await request<{ ok: true }>(`/engineers/${id}`, { method: 'DELETE' });
      clearCache('engineers');
      return res;
    },
    import: async (rows: any[]) => {
      const res = await request<{ createdCount: number; updatedCount: number; errorCount: number; errors: string[] }>('/engineers/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      clearCache('engineers');
      return res;
    },
  },
  firms: {
    list: () => request<Firm[]>('/firms'),
    get: (id: number) => request<Firm & { branches: Branch[] }>(`/firms/${id}`),
    create: (data: Partial<Firm>) => request<Firm>('/firms', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Firm>) => request<Firm>(`/firms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<{ ok: boolean }>(`/firms/${id}`, { method: 'DELETE' }),
    deleteMany: (ids: number[]) => request<{ ok: boolean; deletedCount: number }>('/firms/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    branches: (firmId?: number) => request<Branch[]>(`/branches${firmId ? `?firm_id=${firmId}` : ''}`),
    getBranch: (id: number) => request<Branch & { document_settings: BranchDocumentSettings }>(`/branches/${id}`),
    createBranch: (data: Partial<Branch>) => request<Branch>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    updateBranch: (id: number, data: Partial<Branch>) => request<Branch>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteBranch: (id: number) => request<{ ok: boolean }>(`/branches/${id}`, { method: 'DELETE' }),
    deleteManyBranches: (ids: number[]) => request<{ ok: boolean; deletedCount: number }>('/branches/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    updateBranchDocumentSettings: (branchId: number, data: Partial<BranchDocumentSettings>) =>
      request<BranchDocumentSettings>(`/branches/${branchId}/document-settings`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  export: {
    quotationsUrl: (params?: { status?: string; start?: string; end?: string; columns?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return `${BASE}/export/quotations${q ? `?${q}` : ''}`;
    },
    /** The columns the "Export to Excel" window offers (the PO columns appear once migration 008 is applied). */
    quotationColumns: () => request<{ po_available: boolean; columns: { key: string; label: string; default: boolean; po: boolean }[] }>('/export/quotations/columns'),
    /** Private keys for the live Excel link (migration 009). The key itself is returned only by create. */
    keys: {
      list: () => request<{ keys: ExportKey[]; max_active: number }>('/export/keys'),
      create: (label: string) => request<{ id: number; label: string; hint: string; key: string; created_at: string }>('/export/keys', { method: 'POST', body: JSON.stringify({ label }) }),
      revoke: (id: number) => request<{ ok: boolean }>(`/export/keys/${id}`, { method: 'DELETE' }),
      /** Deletes a link that is already revoked, so it leaves the list. */
      remove: (id: number) => request<{ ok: boolean }>(`/export/keys/${id}/permanent`, { method: 'DELETE' }),
      removeRevoked: () => request<{ ok: boolean; deleted: number }>('/export/keys/revoked', { method: 'DELETE' }),
    },
    engineersPerformanceUrl: (year?: string) => `${BASE}/export/engineers/performance${year ? `?year=${year}` : ''}`,
    inventoryStockUrl: (params?: { warehouseId?: number; status?: string; q?: string }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.status) q.set('status', params.status);
      if (params?.q) q.set('q', params.q);
      const str = q.toString();
      return `${BASE}/export/inventory/stock${str ? `?${str}` : ''}`;
    },
    procurementRequirementsUrl: (status?: string) => `${BASE}/export/procurement/requirements${status ? `?status=${status}` : ''}`,
    stockReceiptsUrl: (params?: { warehouseId?: number; status?: string; sourceType?: string; q?: string }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.status) q.set('status', params.status);
      if (params?.sourceType) q.set('sourceType', params.sourceType);
      if (params?.q) q.set('q', params.q);
      const str = q.toString();
      return `${BASE}/export/inventory/receipts${str ? `?${str}` : ''}`;
    },
    reservationsUrl: (params?: { warehouseId?: number; status?: string; referenceType?: string; q?: string }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      if (params?.status) q.set('status', params.status);
      if (params?.referenceType) q.set('referenceType', params.referenceType);
      if (params?.q) q.set('q', params.q);
      const str = q.toString();
      return `${BASE}/export/inventory/reservations${str ? `?${str}` : ''}`;
    },
    stockIntelligenceUrl: (params?: { warehouseId?: number }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', String(params.warehouseId));
      const str = q.toString();
      return `${BASE}/export/inventory/intelligence${str ? `?${str}` : ''}`;
    },

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
  make?: string;
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

/** One line of a customer order that is waiting to be invoiced, with what the warehouse can ship for it now. */
export interface WaitingOrder {
  quotation_id: number;
  quotation_number: string;
  company_id: number;
  company_name: string;
  quotation_item_id: number;
  product_id: number;
  part_no: string | null;
  description: string;
  unit: string | null;
  ordered: number;
  invoiced: number;
  pending: number;
  /** Stock available for this product (on hand minus reserved). */
  available: number;
  /** What can be shipped now once older orders for the same product have been served. */
  can_ship: number;
  /** What is still missing and has to be ordered from the supplier. */
  short: number;
  status: 'ready' | 'partly' | 'waiting';
  po_date: string | null;
  po_numbers: string | null;
}
export interface WaitingOrdersResponse {
  summary: { lines: number; ready: number; partly: number; waiting: number; customers: number; units_to_order: number };
  orders: WaitingOrder[];
}
/** One line of a quick entry (pasted "part number, quantity") after the product has been looked up. */
export interface QuickEntryLine {
  line: number;
  part: string;
  qty: number;
  merged: number;
  status: 'matched' | 'ambiguous' | 'not_found';
  product?: { id: number; part_no: string; description: string; unit: string | null; make: string | null };
  candidates?: { id: number; part_no: string; description: string; unit: string | null; make: string | null }[];
}
export interface QuickEntryPreview {
  lines: QuickEntryLine[];
  problems: { line: number; text: string; problem: string }[];
  summary: { lines: number; matched: number; ambiguous: number; not_found: number; units: number };
}

/** Today's stock at a glance (India day): what came in, what went out, what is ready to ship and the latest movements. */
export interface TodayStock {
  date: string;
  received: { lines: number; units: number; receipts: number };
  sent: { lines: number; units: number; invoices: number };
  returned: { lines: number; units: number };
  adjusted: { lines: number; units: number };
  waiting: { lines: number; ready: number; partly: number; waiting: number; customers: number; units_to_order: number } | null;
  movements: { at: string; part_no: string; description: string; movement_type: string; change: number; reference_type: string | null; reference_id: string | null; reason: string | null }[];
}

export interface WaitingOrdersParams {
  status?: 'ready' | 'partly' | 'waiting';
  q?: string;
  warehouseId?: number;
  productId?: number;
  /** Comma-separated product ids. */
  productIds?: string;
}
export function waitingOrdersQuery(p?: WaitingOrdersParams) {
  const q = new URLSearchParams();
  if (p?.status) q.set('status', p.status);
  if (p?.q) q.set('q', p.q);
  if (p?.warehouseId) q.set('warehouseId', String(p.warehouseId));
  if (p?.productId) q.set('productId', String(p.productId));
  if (p?.productIds) q.set('productIds', p.productIds);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface MovementReportParams {
  view: 'month' | 'year';
  month?: string;
  year?: number;
  yearType?: 'fy' | 'calendar';
  warehouseId?: number | '';
  productId?: number | '';
  q?: string;
  make?: string;
  moved?: boolean;
  limit?: number;
  offset?: number;
}
export function movementReportQuery(p: MovementReportParams) {
  const q = new URLSearchParams({ view: p.view });
  if (p.view === 'month' && p.month) q.set('month', p.month);
  if (p.view === 'year') {
    if (p.year) q.set('year', String(p.year));
    q.set('yearType', p.yearType || 'fy');
  }
  if (p.warehouseId) q.set('warehouseId', String(p.warehouseId));
  if (p.productId) q.set('productId', String(p.productId));
  if (p.q) q.set('q', p.q);
  if (p.make) q.set('make', p.make);
  q.set('moved', p.moved === false ? '0' : '1');
  if (p.limit) q.set('limit', String(p.limit));
  if (p.offset) q.set('offset', String(p.offset));
  return q.toString();
}
/** One cell of the report: stock in, out, customer returns, corrections (signed) and transfers (net). */
export interface MovementCell { in: number; out: number; ret: number; adj: number; xfer: number }
export interface MovementReportRow {
  id: number;
  part_no: string;
  description: string;
  unit: string | null;
  make: string | null;
  opening: number;
  cells: Record<string, MovementCell>;
  totals: MovementCell;
  closing: number;
}
export interface MovementReport {
  period: { view: 'month' | 'year'; label: string; start: string; end_exclusive: string; month: string | null; year: number | null; year_type: 'fy' | 'calendar' | null };
  buckets: { key: string; label: string }[];
  single_warehouse: boolean;
  products: MovementReportRow[];
  total_products: number;
  totals: MovementCell & { opening: number; closing: number; columns: Record<string, MovementCell> };
  limit: number;
  offset: number;
}

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
  isDamaged?: boolean;
}

export interface ExcelPreviewResponse {
  summary: {
    totalRows: number;
    validItemCount: number;
    zeroStockCount?: number;
    damagedItemCount?: number;
    invalidRowCount: number;
    totalIncomingUnits: number;
  };
  warehouse: {
    id: number;
    name: string;
    code: string;
  };
  validItems: ExcelPreviewItem[];
  zeroStockItems?: {
    rowNumber: number;
    productId: number;
    partNo: string;
    description: string;
    unit: string;
    quantity: number;
    status: string;
  }[];
  invalidRows: {
    rowNumber: number;
    partNo: string;
    quantity: any;
    reason: string;
    canAutoCreate?: boolean;
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
  sales_engineer_id?: number | null;
  sales_engineer_name?: string | null;
  sales_engineer_code?: string | null;
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
  salesEngineerId?: number | null;
  salesEngineerName?: string | null;
  salesEngineerCode?: string | null;
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

// count/value are null when the stage cannot be calculated (listed in SalesOverviewResponse.unavailable).
export interface SalesPipelineStage {
  stage: string;
  label: string;
  count: number | null;
  value: number | null;
}

// Fields typed `number | null` depend on sale reports; they are null (never 0) when sale reports
// are not set up in the database, and are then listed in SalesOverviewResponse.unavailable.
export interface SalesOverviewKpis {
  totalQuotations: number;
  draftQuotations: number;
  sentQuotations: number;
  acceptedQuotations: number;
  rejectedQuotations: number;
  openOrders: number | null;
  pendingPis: number;
  pendingSaleReports: number | null;
  confirmedSales: number | null;
  salesValue: number | null;
  grossSales: number | null;
  acceptedQuotationValue: number;
  openOrderValue: number | null;
  pendingDispatchValue: number | null;
  completedSalesValue: number | null;
  averageOrderValue: number | null;
  quotationConversionRate: number;
}

export interface SalesOverviewUnavailable {
  reason: string;
  metrics: (keyof SalesOverviewKpis)[];
  stages: string[];
}

export interface SalesOverviewResponse {
  kpis: SalesOverviewKpis;
  pipeline: SalesPipelineStage[];
  unavailable: SalesOverviewUnavailable | null;
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

export async function searchGlobalApi(q: string, limit: number = 30, signal?: AbortSignal): Promise<GlobalSearchResponse> {
  return request<GlobalSearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal });
}







