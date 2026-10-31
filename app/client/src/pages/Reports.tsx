import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, Company, Product } from '../api';
import { HorizontalBarChart } from '../components/BarChart';
import { GroupedBarChart } from '../components/BarChart';
import CompanyTrendLineChart from '../components/CompanyTrendLineChart';
import SearchableSelect from '../components/SearchableSelect';
import { ExpandableSearch } from '../components/ExpandableSearch';
import { PastYearAnalysisButton } from '../components/YearAnalysis';

type Tab = 'companies' | 'products' | 'review' | 'import' | 'lapsed' | 'trends';

export default function Reports() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(location.pathname === '/reports/company-trends' ? 'trends' : 'companies');

  useEffect(() => {
    setTab(location.pathname === '/reports/company-trends' ? 'trends' : 'companies');
  }, [location.pathname]);

  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(new Set());
  const [loading, setLoading] = useState(false);

  // Visible regardless of which tab is active, so switching away mid-import (or just the
  // upload taking a while) doesn't hide the result — the inline summary box in the Import
  // Data tab only shows while that tab is selected.
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(type: 'success' | 'error', message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 8000);
  }
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const [companyRows, setCompanyRows] = useState<any[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [companyDateFrom, setCompanyDateFrom] = useState('');
  const [companyDateTo, setCompanyDateTo] = useState('');
  const [companyProductFilter, setCompanyProductFilter] = useState('');
  const [productRows, setProductRows] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productDateFrom, setProductDateFrom] = useState('');
  const [productDateTo, setProductDateTo] = useState('');
  const [productCompanyFilter, setProductCompanyFilter] = useState('');
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [reviewRows, setReviewRows] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [yearComparison, setYearComparison] = useState<{ years: string[]; products: any[] } | null>(null);
  const [error, setError] = useState('');

  // Import Data tab
  const [companiesList, setCompaniesList] = useState<Company[]>([]);
  const [importBatches, setImportBatches] = useState<any[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()));
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<number | null>(null);

  // Lapsed Purchases tab
  const [lapsedMonths, setLapsedMonths] = useState(12);
  const [lapsedRows, setLapsedRows] = useState<any[]>([]);

  // Company Trends tab
  const [trendsCompany, setTrendsCompany] = useState('');
  const [trendProduct, setTrendProduct] = useState('');
  const [trendsData, setTrendsData] = useState<{ products: any[]; years: string[]; rows: any[] } | null>(null);
  const [trendHistory, setTrendHistory] = useState<any[]>([]);
  const [trendGranularity, setTrendGranularity] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

  // Reference lists for the company/product filter dropdowns on the Companies and Products
  // tabs — loaded once up front rather than gated behind a tab visit, since both tabs need them.
  useEffect(() => {
    api.companies.list().then(setCompaniesList).catch(() => {});
    api.products.list().then(setProductsList).catch(() => {});
  }, []);

  function fetchCompanies(overrides?: { dateFrom?: string; dateTo?: string; product?: string }) {
    const dateFrom = overrides?.dateFrom ?? companyDateFrom;
    const dateTo = overrides?.dateTo ?? companyDateTo;
    const product = overrides?.product ?? companyProductFilter;
    setLoading(true);
    api.reports
      .companies({ startDate: dateFrom || undefined, endDate: dateTo || undefined, partNo: product || undefined })
      .then(setCompanyRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function fetchProducts(overrides?: { dateFrom?: string; dateTo?: string; company?: string }) {
    const dateFrom = overrides?.dateFrom ?? productDateFrom;
    const dateTo = overrides?.dateTo ?? productDateTo;
    const company = overrides?.company ?? productCompanyFilter;
    setLoading(true);
    api.reports
      .products({ startDate: dateFrom || undefined, endDate: dateTo || undefined, companyName: company || undefined })
      .then(setProductRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function loadTabData(t: Tab) {
    setLoading(true);
    const done = () => setLoading(false);
    setLoadedTabs((prev) => new Set(prev).add(t));

    if (t === 'companies') api.reports.companies({ startDate: companyDateFrom || undefined, endDate: companyDateTo || undefined, partNo: companyProductFilter || undefined }).then(setCompanyRows).catch((e) => setError(e.message)).finally(done);
    else if (t === 'products') api.reports.products({ startDate: productDateFrom || undefined, endDate: productDateTo || undefined, companyName: productCompanyFilter || undefined }).then(setProductRows).catch((e) => setError(e.message)).finally(done);
    else if (t === 'review') api.reports.reviewQueue().then(setReviewRows).catch((e) => setError(e.message)).finally(done);
    else if (t === 'lapsed') {
      api.settings.get().then((s) => {
        setLapsedMonths(s.default_lapse_months);
        return loadLapsed(s.default_lapse_months);
      }).catch((e) => setError(e.message)).finally(done);
    }
    else if (t === 'trends') api.companies.list().then(setCompaniesList).catch((e) => setError(e.message)).finally(done);
    else if (t === 'import') loadImportBatches().finally(done);
    else done();
  }

  useEffect(() => {
    if (loadedTabs.has(tab)) return;
    loadTabData(tab);
  }, [tab]);

  // Importing or deleting sales data changes what these tabs show, but each tab only fetches
  // once and then trusts `loadedTabs` forever — without this, switching to Import Data, running
  // an import, then switching back to an already-visited tab (e.g. Companies) silently kept
  // showing pre-import data until a full page reload.
  const DATA_DEPENDENT_TABS: Tab[] = ['companies', 'products', 'review', 'lapsed'];
  function invalidateDataTabs() {
    setLoadedTabs((prev) => {
      const next = new Set(prev);
      for (const t of DATA_DEPENDENT_TABS) next.delete(t);
      return next;
    });
    if (DATA_DEPENDENT_TABS.includes(tab)) loadTabData(tab);
  }

  function viewHistory(name: string) {
    setSelectedCompany(name);
    api.reports.companyHistory(name).then(setHistory).catch((e) => setError(e.message));
    api.reports.companyYearComparison(name).then(setYearComparison).catch((e) => setError(e.message));
  }

  function loadImportBatches() {
    return api.imports.list().then(setImportBatches).catch((e) => setError(e.message));
  }

  async function deleteImportBatch(id: number, filename: string) {
    if (!window.confirm(`Delete "${filename}"? This removes every sales record it imported. This cannot be undone.`)) return;
    setDeletingBatchId(id);
    try {
      await api.admin.deleteImport(id);
      await loadImportBatches();
      invalidateDataTabs();
      showToast('success', `Deleted "${filename}" and its sales records.`);
    } catch (e: any) {
      showToast('error', `Could not delete: ${e.message}`);
    } finally {
      setDeletingBatchId(null);
    }
  }

  function loadLapsed(months: number) {
    return api.reports.lapsed(months).then(setLapsedRows).catch((e) => setError(e.message));
  }

  async function submitUpload() {
    if (!uploadFile) return setError('Choose a file first');
    setError('');
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await api.imports.upload(uploadFile, uploadYear);
      setUploadResult(result);
      setUploadFile(null);
      loadImportBatches();
      invalidateDataTabs();
      showToast(
        'success',
        `Import complete — ${result.importedCount} rows imported, ${result.skippedDuplicateCount} duplicates skipped, ${result.flaggedCount} flagged for review.`
      );
    } catch (e: any) {
      setError(e.message);
      showToast('error', `Import failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  function loadTrends(company: string) {
    setTrendsCompany(company);
    if (!company) {
      setTrendsData(null);
      setTrendHistory([]);
      setTrendProduct('');
      return;
    }
    Promise.all([api.reports.companyYearly(company), api.reports.companyHistory(company)])
      .then(([yearly, history]) => {
        setTrendsData(yearly);
        setTrendHistory(history);
      })
      .catch((e) => setError(e.message));
  }

  const lapsedChartData = lapsedRows.slice(0, 15).map((r) => ({
    label: r.company_name,
    sublabel: r.product_description,
    value: r.total_revenue,
  }));

  const yearComparisonChartData = yearComparison
    ? yearComparison.products.map((p) => ({
        category: p.product_description.length > 22 ? p.product_description.slice(0, 22) + '…' : p.product_description,
        series: yearComparison.years.map((year, i) => ({
          name: year,
          value: i === 0 ? p.older_total : p.newer_total ?? 0,
        })),
      }))
    : [];

  const droppedProducts = yearComparison && yearComparison.years.length === 2
    ? yearComparison.products.filter((p) => p.newer_total === 0)
    : [];

  const filteredCompanyRows = companySearch
    ? companyRows.filter((c) => c.company_name.toLowerCase().includes(companySearch.toLowerCase()))
    : companyRows;
  const filteredProductRows = productSearch
    ? productRows.filter(
        (p) =>
          p.product_description.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.part_no.toLowerCase().includes(productSearch.toLowerCase())
      )
    : productRows;

  const trendLine = useMemo(() => {
    if (trendHistory.length === 0) return { data: [], series: [] as { key: string; label: string; color: string }[] };

    const buckets = new Map<string, Map<string, number>>();
    const productTotals = new Map<string, number>();
    const colors = ['rgb(var(--chart-line))', 'rgb(var(--brand-orange))', 'rgb(var(--brand-blue))', 'rgb(var(--good))', 'rgb(var(--warn))', 'rgb(var(--bad))'];

    for (const row of trendHistory) {
      if (!row.sale_date || !row.product_description) continue;
      const date = String(row.sale_date).slice(0, 10);
      const [year, month] = date.split('-').map(Number);
      if (!year || !month) continue;
      const period = trendGranularity === 'yearly'
        ? String(year)
        : trendGranularity === 'quarterly'
        ? `${year} Q${Math.floor((month - 1) / 3) + 1}`
        : `${year}-${String(month).padStart(2, '0')}`;
      const product = String(row.product_description);
      if (trendProduct && product !== trendProduct) continue;
      if (!buckets.has(period)) buckets.set(period, new Map());
      const amount = Number(row.total_amount || 0);
      buckets.get(period)!.set(product, (buckets.get(period)!.get(product) || 0) + amount);
      productTotals.set(product, (productTotals.get(product) || 0) + amount);
    }

    const products = [...productTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label], index) => ({
      key: `product_${index}`,
      label: label.length > 24 ? `${label.slice(0, 24)}…` : label,
      source: label,
      color: colors[index % colors.length],
    }));
    const data = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, values]) => {
      const point: Record<string, string | number> = { period };
      products.forEach((product) => { point[product.key] = values.get(product.source) || 0; });
      return point;
    });

    return { data, series: products.map(({ key, label, color }) => ({ key, label, color })) };
  }, [trendHistory, trendGranularity, trendProduct]);

  const trendProductOptions = [...new Set(trendHistory.map((row) => String(row.product_description)).filter(Boolean))].sort();

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm p-4 rounded-[12px] shadow-lift border flex items-start gap-3 ${
            toast.type === 'success'
              ? 'bg-goodbg border-goodbg text-good'
              : 'bg-badbg border-badbg text-bad'
          }`}
        >
          <span className="text-[13px] font-medium leading-snug flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100 cursor-pointer text-[16px] leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h1>
          Reports Analytics
        </h1>
        <p className="ts-muted m-0 mt-1.5 text-[14px]">
          Historical sales analytics, company purchasing trends, lapsed relationship tracking, and data imports.
        </p>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* Tab Navigation & Export Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface2 border border-line2 rounded-[14px] p-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'companies', label: 'Companies' },
            { id: 'products', label: 'Products' },
            { id: 'lapsed', label: 'Lapsed Purchases' },
            { id: 'trends', label: 'Company Trends' },
            { id: 'review', label: `Review Queue${loadedTabs.has('review') ? ` (${reviewRows.length})` : ''}` },
            { id: 'import', label: 'Import Data' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as Tab)}
              className={`px-3.5 py-1.5 rounded-[9px] text-[12.5px] font-medium transition-colors cursor-pointer ${
                tab === t.id
                  ? 'bg-surface text-fg border border-line2'
                  : 'text-subtle hover:text-fg hover:bg-surface'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(tab === 'companies' || tab === 'products') && (
          <a
            href={api.reports.exportUrl(tab)}
            className="ts-btn ts-ghost ts-xs"
          >
            Export to Excel →
          </a>
        )}
      </div>

      {loading && <p className="text-subtle text-[13px] py-4">Loading report data…</p>}

      {!loading && tab === 'companies' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-line2 pb-3.5">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              From
              <input
                type="date"
                value={companyDateFrom}
                onChange={(e) => {
                  setCompanyDateFrom(e.target.value);
                  fetchCompanies({ dateFrom: e.target.value });
                }}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              To
              <input
                type="date"
                value={companyDateTo}
                onChange={(e) => {
                  setCompanyDateTo(e.target.value);
                  fetchCompanies({ dateTo: e.target.value });
                }}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              Product
              <select
                value={companyProductFilter}
                onChange={(e) => {
                  setCompanyProductFilter(e.target.value);
                  fetchCompanies({ product: e.target.value });
                }}
                className="ts-fi ts-sel"
              >
                <option value="">All products</option>
                {productsList.map((p) => (
                  <option key={p.part_no} value={p.part_no}>
                    {p.part_no} — {p.description}
                  </option>
                ))}
              </select>
            </label>
            {(companyDateFrom || companyDateTo || companyProductFilter) && (
              <button
                type="button"
                onClick={() => {
                  setCompanyDateFrom('');
                  setCompanyDateTo('');
                  setCompanyProductFilter('');
                  fetchCompanies({ dateFrom: '', dateTo: '', product: '' });
                }}
                className="ts-btn ts-ghost ts-xs"
              >
                Clear filters
              </button>
            )}
            <div className="flex-1 min-w-[200px] flex items-center justify-end gap-3">
              <ExpandableSearch
                value={companySearch}
                onChange={setCompanySearch}
                placeholder="Search companies..."
                ariaLabel="Search companies report"
                maxWidth="280px"
              />
            </div>
          </div>
          <div className="flex items-center justify-end -mt-2">
            <span className="ts-showing ts-muted">
              Showing {filteredCompanyRows.length} of {companyRows.length}
            </span>
          </div>
          <div className="ts-tblwrap">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="ts-r">Orders</th>
                  <th className="ts-r">Total qty</th>
                  <th className="ts-r">Revenue</th>
                  <th className="ts-r">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanyRows.map((c) => (
                  <tr key={c.company_name} >
                    <td className="p-[11px_10px] font-medium text-fg">{c.company_name}</td>
                    <td className="p-[11px_10px] text-right text-subtle">{c.order_count}</td>
                    <td className="p-[11px_10px] text-right text-subtle">{c.total_qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-fg">₹{Number(c.total).toLocaleString('en-IN')}</td>
                    <td className="p-[11px_10px] text-right">
                      <button
                        type="button"
                        onClick={() => viewHistory(c.company_name)}
                        className="ts-btn ts-ghost ts-xs"
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCompanyRows.length === 0 && (
                  <tr><td colSpan={5} className="ts-empty">No matching companies found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'products' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-line2 pb-3.5">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              From
              <input
                type="date"
                value={productDateFrom}
                onChange={(e) => {
                  setProductDateFrom(e.target.value);
                  fetchProducts({ dateFrom: e.target.value });
                }}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              To
              <input
                type="date"
                value={productDateTo}
                onChange={(e) => {
                  setProductDateTo(e.target.value);
                  fetchProducts({ dateTo: e.target.value });
                }}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              Company
              <select
                value={productCompanyFilter}
                onChange={(e) => {
                  setProductCompanyFilter(e.target.value);
                  fetchProducts({ company: e.target.value });
                }}
                className="ts-fi ts-sel"
              >
                <option value="">All companies</option>
                {companiesList.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {(productDateFrom || productDateTo || productCompanyFilter) && (
              <button
                type="button"
                onClick={() => {
                  setProductDateFrom('');
                  setProductDateTo('');
                  setProductCompanyFilter('');
                  fetchProducts({ dateFrom: '', dateTo: '', company: '' });
                }}
                className="ts-btn ts-ghost ts-xs"
              >
                Clear filters
              </button>
            )}
            <div className="flex-1 min-w-[200px] flex items-center justify-end gap-3">
              <ExpandableSearch
                value={productSearch}
                onChange={setProductSearch}
                placeholder="Search products..."
                ariaLabel="Search products report"
                maxWidth="280px"
              />
            </div>
          </div>
          <div className="flex items-center justify-end -mt-2">
            <span className="ts-showing ts-muted">
              Showing {filteredProductRows.length} of {productRows.length}
            </span>
          </div>
          <div className="ts-tblwrap">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th>Part no</th>
                  <th>Description</th>
                  <th className="ts-r">Orders</th>
                  <th className="ts-r">Total qty</th>
                  <th className="ts-r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filteredProductRows.map((p) => (
                  <tr key={p.part_no} >
                    <td className="p-[11px_10px] font-mono text-[12px] text-fg">{p.part_no}</td>
                    <td className="p-[11px_10px] text-fg font-medium">{p.product_description}</td>
                    <td className="p-[11px_10px] text-right text-subtle">{p.order_count}</td>
                    <td className="p-[11px_10px] text-right text-subtle">{p.total_qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-fg">₹{Number(p.total).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {filteredProductRows.length === 0 && (
                  <tr><td colSpan={5} className="ts-empty">No matching products found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'review' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Rows imported from sales files with missing or inconsistent data. Review and correct in the source if needed.
          </p>
          <div className="ts-tblwrap">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Company</th>
                  <th>Product</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((r) => (
                  <tr key={r.id} >
                    <td className="p-[11px_10px] text-subtle">{r.sale_date || '-'}</td>
                    <td className="p-[11px_10px] text-fg">{r.invoice_no || '-'}</td>
                    <td className="p-[11px_10px] text-fg">{r.company_name || '-'}</td>
                    <td className="p-[11px_10px] text-subtle">{r.product_description || '-'}</td>
                    <td className="p-[11px_10px] text-bad">{r.review_reason}</td>
                  </tr>
                ))}
                {reviewRows.length === 0 && (
                  <tr><td colSpan={5} className="ts-empty">No records in review queue.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'lapsed' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-6">
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Company–product pairs with no purchase in the last N months, ranked by revenue before lapse.
          </p>
          <div className="flex items-end gap-3 max-w-[320px]">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider flex-1">
              NO PURCHASE IN LAST (MONTHS)
              <input
                type="number"
                min={1}
                value={lapsedMonths}
                onChange={(e) => setLapsedMonths(Number(e.target.value))}
                className="ts-fi ts-sel"
              />
            </label>
            <button
              type="button"
              onClick={() => loadLapsed(lapsedMonths)}
              className="ts-btn ts-dark ts-xs"
            >
              Apply
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="margin-0 text-[16px] font-medium text-fg">Top 15 Lapsed Relationships</h3>
            <HorizontalBarChart data={lapsedChartData} />
          </div>

          <div className="ts-tblwrap">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Product</th>
                  <th>Last purchased</th>
                  <th className="ts-r">Months since</th>
                  <th className="ts-r">Revenue before lapse</th>
                </tr>
              </thead>
              <tbody>
                {lapsedRows.map((r, i) => (
                  <tr key={i} >
                    <td className="p-[11px_10px] font-medium text-fg">{r.company_name}</td>
                    <td className="p-[11px_10px] text-subtle">{r.product_description}</td>
                    <td className="p-[11px_10px] text-subtle">{r.last_purchase}</td>
                    <td className="p-[11px_10px] text-right text-warn">{r.months_since} mo</td>
                    <td className="p-[11px_10px] text-right font-medium text-fg">₹{Number(r.total_revenue).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {lapsedRows.length === 0 && (
                  <tr><td colSpan={5} className="ts-empty">Nothing lapsed at this threshold.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'trends' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-6">
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Revenue trend by product for a chosen company. Switch between monthly, quarterly, and yearly views.
          </p>
          <div className="ts-phead !mb-2 justify-between">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-col gap-1 min-w-[260px]">
                <label className="text-[11px] text-faint uppercase tracking-wider font-medium">SELECT COMPANY</label>
              <SearchableSelect
                options={companiesList.map((c) => ({ value: c.name, label: c.name }))}
                value={trendsCompany}
                onChange={loadTrends}
                placeholder="Search companies…"
              />
              </div>
              <label className="flex flex-col gap-1 min-w-[260px] text-[11px] text-faint uppercase tracking-wider font-medium">
                PRODUCT LINE
                <select
                  value={trendProduct}
                  onChange={(event) => setTrendProduct(event.target.value)}
                  disabled={!trendsCompany}
                  className="ts-fi ts-sel"
                >
                  <option value="">All products</option>
                  {trendProductOptions.map((product) => <option key={product} value={product}>{product}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-[10px] border border-line2 bg-surface">
              {(['monthly', 'quarterly', 'yearly'] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setTrendGranularity(period)}
                  className={`px-3 py-1.5 rounded-[7px] text-[11.5px] font-semibold capitalize transition-colors ${
                    trendGranularity === period
                      ? 'bg-surface2 text-fg shadow-sm border border-line2'
                      : 'text-subtle hover:text-fg'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {trendsData && (
            <div className="flex flex-col gap-6">
              <div className="rounded-[12px] border border-line2 bg-tile p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <h3 className="margin-0 text-[16px] font-bold text-fg">Company product trend</h3>
                    <p className="margin-0 text-[11px] text-subtle mt-0.5">Revenue movement for {trendsCompany}.</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[.08em] text-subtle">{trendGranularity}</span>
                </div>
                <CompanyTrendLineChart data={trendLine.data} series={trendLine.series} />
              </div>

              <div className="ts-tblwrap">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th>Product</th>
                      {trendsData.years.map((y) => (
                        <th key={y} className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">{y}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trendsData.products.map((p) => (
                      <tr key={p.part_no} >
                        <td className="p-[11px_10px] font-medium text-fg">{p.product_description}</td>
                        {trendsData.years.map((y) => {
                          const val = trendsData.rows.find((r) => r.part_no === p.part_no && r.year === y)?.total;
                          return (
                            <td key={y} className="p-[11px_10px] text-right font-mono text-[12px] text-subtle">
                              {val ? `₹${Number(val).toLocaleString('en-IN')}` : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {!loading && tab === 'import' && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-[15px] bg-goodbg">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-fg">Past year analysis</h3>
              <p className="m-0 mt-1 text-[13px] text-subtle">
                View a past year's sales (e.g. 2024 or 2025) from its Excel file without mixing it into the live data. Opens the stored file, or asks for one if none is saved.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PastYearAnalysisButton onOpen={(year) => navigate(`/?analysis=${year}`)} />
            </div>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Upload a year's sales Excel file to import data into the database.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              EXCEL FILE
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="ts-btn ts-dark ts-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              YEAR LABEL
              <input
                value={uploadYear}
                onChange={(e) => setUploadYear(e.target.value)}
                className="ts-fi ts-sel"
              />
            </label>
            <button
              type="button"
              onClick={submitUpload}
              disabled={uploading}
              className="ts-btn ts-dark ts-xs"
            >
              {uploading ? 'Importing…' : 'Import File'}
            </button>
          </div>

          {uploadResult && (
            <div className="p-4 rounded-[12px] border border-line2 bg-tile text-fg text-[13px]">
              <strong>Import complete.</strong> {uploadResult.importedCount} rows imported, {uploadResult.skippedDuplicateCount} duplicates skipped, {uploadResult.flaggedCount} flagged for review, {uploadResult.companiesAdded} new companies, {uploadResult.productsAdded} new products.
            </div>
          )}

          <div className="flex flex-col gap-3">
            <h3 className="margin-0 text-[16px] font-medium text-fg">Import History</h3>
            <div className="ts-tblwrap">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Year</th>
                    <th>Imported at</th>
                    <th className="ts-r">Rows</th>
                    <th className="ts-r">Imported</th>
                    <th className="ts-r">Duplicates</th>
                    <th className="ts-r">Flagged</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {importBatches.map((b) => (
                    <tr key={b.id} >
                      <td className="p-[11px_10px] font-medium text-fg">{b.filename}</td>
                      <td className="p-[11px_10px] text-subtle">{b.year_label || '-'}</td>
                      <td className="p-[11px_10px] text-subtle">{b.imported_at}</td>
                      <td className="p-[11px_10px] text-right text-subtle">{b.row_count}</td>
                      <td className="p-[11px_10px] text-right text-fg font-medium">{b.imported_count}</td>
                      <td className="p-[11px_10px] text-right text-faint">{b.skipped_duplicate_count}</td>
                      <td className="p-[11px_10px] text-right text-bad">{b.flagged_count}</td>
                      <td className="p-[11px_10px] text-right">
                        <button
                          type="button"
                          onClick={() => deleteImportBatch(b.id, b.filename)}
                          disabled={deletingBatchId === b.id}
                          className="text-[11px] font-semibold text-bad hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        >
                          {deletingBatchId === b.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importBatches.length === 0 && (
                    <tr><td colSpan={8} className="ts-empty">No imports yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {selectedCompany && yearComparison && yearComparison.years.length > 0 && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium text-fg">Products Bought — {yearComparison.years.join(' vs ')} — {selectedCompany}</h3>
          {yearComparison.years.length < 2 ? (
            <p className="ts-muted m-0 mt-1.5 text-[14px]">
              Only one year of data on file for this company. Import a second year (Import Data) to see a year-over-year comparison.
            </p>
          ) : (
            <>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Products purchased in {yearComparison.years[0]} vs {yearComparison.years[1]}, biggest drop-offs first.
              </p>
              {droppedProducts.length > 0 && (
                <p className="margin-0 text-[13px] text-bad">
                  <strong>{droppedProducts.length}</strong> product(s) bought in {yearComparison.years[0]} with nothing purchased in {yearComparison.years[1]}.
                </p>
              )}
            </>
          )}
          <GroupedBarChart data={yearComparisonChartData} seriesNames={yearComparison.years} />
        </section>
      )}

      {selectedCompany && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium text-fg">Purchase History — {selectedCompany}</h3>
          <div className="ts-tblwrap">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Part no</th>
                  <th>Description</th>
                  <th className="ts-r">Qty</th>
                  <th className="ts-r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} >
                    <td className="p-[11px_10px] text-subtle">{h.sale_date}</td>
                    <td className="p-[11px_10px] text-fg">{h.invoice_no}</td>
                    <td className="p-[11px_10px] font-mono text-[12px] text-fg">{h.part_no}</td>
                    <td className="p-[11px_10px] text-fg">{h.product_description}</td>
                    <td className="p-[11px_10px] text-right text-subtle">{h.qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-fg">₹{Number(h.total_amount).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
