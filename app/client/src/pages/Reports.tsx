import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, Company, Product } from '../api';
import { HorizontalBarChart } from '../components/BarChart';
import { GroupedBarChart } from '../components/BarChart';
import CompanyTrendLineChart from '../components/CompanyTrendLineChart';
import SearchableSelect from '../components/SearchableSelect';
import { ExpandableSearch } from '../components/ExpandableSearch';

type Tab = 'companies' | 'products' | 'review' | 'import' | 'lapsed' | 'trends';

export default function Reports() {
  const location = useLocation();
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
    const colors = ['#2F6FED', '#39A0ED', '#6577C8', '#2FBF71', '#D28A26', '#C75C5C'];

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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm p-4 rounded-[12px] shadow-lift border flex items-start gap-3 ${
            toast.type === 'success'
              ? 'bg-[#E3F7EC] border-[#BFEAD3] text-[#1E8A52]'
              : 'bg-[#F8E4E4] border-[#F4D6D7] text-[#C8323A]'
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
        <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
          Reports Analytics
        </h1>
        <p className="margin-0 text-[13.5px] text-[#7A839E]">
          Historical sales analytics, company purchasing trends, lapsed relationship tracking, and data imports.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D] text-[12.5px]">
          {error}
        </div>
      )}

      {/* Tab Navigation & Export Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-[#FFFFFF] border border-[#E4E8F2] rounded-[14px] p-2">
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
                  ? 'bg-[#F7F8FC] text-[#3B6FD4] border border-[#D9E2F4]'
                  : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F7F8FC]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(tab === 'companies' || tab === 'products') && (
          <a
            href={api.reports.exportUrl(tab)}
            className="h-[32px] px-3.5 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#3B6FD4] hover:border-[#D9E2F4] text-[12px] font-medium inline-flex items-center no-underline transition-colors"
          >
            Export to Excel →
          </a>
        )}
      </div>

      {loading && <p className="text-[#7A839E] text-[13px] py-4">Loading report data…</p>}

      {!loading && tab === 'companies' && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-[#EEF1F9] pb-3.5">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              From
              <input
                type="date"
                value={companyDateFrom}
                onChange={(e) => {
                  setCompanyDateFrom(e.target.value);
                  fetchCompanies({ dateFrom: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              To
              <input
                type="date"
                value={companyDateTo}
                onChange={(e) => {
                  setCompanyDateTo(e.target.value);
                  fetchCompanies({ dateTo: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              Product
              <select
                value={companyProductFilter}
                onChange={(e) => {
                  setCompanyProductFilter(e.target.value);
                  fetchCompanies({ product: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none min-w-[180px]"
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
                className="h-[34px] px-3 rounded-[8px] text-[#7A839E] hover:text-[#141B34] text-[12px] font-medium cursor-pointer"
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
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filteredCompanyRows.length} of {companyRows.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">COMPANY</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">ORDERS</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">TOTAL QTY</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">REVENUE</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanyRows.map((c) => (
                  <tr key={c.company_name} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                    <td className="p-[11px_10px] font-medium text-[#141B34]">{c.company_name}</td>
                    <td className="p-[11px_10px] text-right text-[#7A839E]">{c.order_count}</td>
                    <td className="p-[11px_10px] text-right text-[#7A839E]">{c.total_qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-[#3B6FD4]">₹{Number(c.total).toLocaleString('en-IN')}</td>
                    <td className="p-[11px_10px] text-right">
                      <button
                        type="button"
                        onClick={() => viewHistory(c.company_name)}
                        className="h-[28px] px-2.5 rounded-[7px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#3B6FD4] text-[11.5px] font-medium hover:border-[#D9E2F4] cursor-pointer"
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCompanyRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-[#7A839E] text-[13px]">No matching companies found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'products' && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-[#EEF1F9] pb-3.5">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              From
              <input
                type="date"
                value={productDateFrom}
                onChange={(e) => {
                  setProductDateFrom(e.target.value);
                  fetchProducts({ dateFrom: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              To
              <input
                type="date"
                value={productDateTo}
                onChange={(e) => {
                  setProductDateTo(e.target.value);
                  fetchProducts({ dateTo: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              Company
              <select
                value={productCompanyFilter}
                onChange={(e) => {
                  setProductCompanyFilter(e.target.value);
                  fetchProducts({ company: e.target.value });
                }}
                className="h-[34px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12.5px] outline-none min-w-[180px]"
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
                className="h-[34px] px-3 rounded-[8px] text-[#7A839E] hover:text-[#141B34] text-[12px] font-medium cursor-pointer"
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
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filteredProductRows.length} of {productRows.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PART NO</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DESCRIPTION</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">ORDERS</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">TOTAL QTY</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">REVENUE</th>
                </tr>
              </thead>
              <tbody>
                {filteredProductRows.map((p) => (
                  <tr key={p.part_no} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                    <td className="p-[11px_10px] font-mono text-[12px] text-[#3B6FD4]">{p.part_no}</td>
                    <td className="p-[11px_10px] text-[#141B34] font-medium">{p.product_description}</td>
                    <td className="p-[11px_10px] text-right text-[#7A839E]">{p.order_count}</td>
                    <td className="p-[11px_10px] text-right text-[#7A839E]">{p.total_qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-[#141B34]">₹{Number(p.total).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {filteredProductRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-[#7A839E] text-[13px]">No matching products found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'review' && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
          <p className="margin-0 text-[13px] text-[#7A839E]">
            Rows imported from sales files with missing or inconsistent data. Review and correct in the source if needed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DATE</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">INVOICE</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">COMPANY</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PRODUCT</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">REASON</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((r) => (
                  <tr key={r.id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                    <td className="p-[11px_10px] text-[#7A839E]">{r.sale_date || '-'}</td>
                    <td className="p-[11px_10px] text-[#141B34]">{r.invoice_no || '-'}</td>
                    <td className="p-[11px_10px] text-[#141B34]">{r.company_name || '-'}</td>
                    <td className="p-[11px_10px] text-[#7A839E]">{r.product_description || '-'}</td>
                    <td className="p-[11px_10px] text-[#E5484D]">{r.review_reason}</td>
                  </tr>
                ))}
                {reviewRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-[#7A839E] text-[13px]">No records in review queue.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'lapsed' && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
          <p className="margin-0 text-[13px] text-[#7A839E]">
            Company–product pairs with no purchase in the last N months, ranked by revenue before lapse.
          </p>
          <div className="flex items-end gap-3 max-w-[320px]">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider flex-1">
              NO PURCHASE IN LAST (MONTHS)
              <input
                type="number"
                min={1}
                value={lapsedMonths}
                onChange={(e) => setLapsedMonths(Number(e.target.value))}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => loadLapsed(lapsedMonths)}
              className="h-[36px] px-4 rounded-[9px] bg-[#3B6FD4] text-[#F4F6FC] font-bold text-[12.5px] cursor-pointer"
            >
              Apply
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="margin-0 text-[16px] font-medium text-[#141B34]">Top 15 Lapsed Relationships</h3>
            <HorizontalBarChart data={lapsedChartData} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">COMPANY</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PRODUCT</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">LAST PURCHASED</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">MONTHS SINCE</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">REVENUE BEFORE LAPSE</th>
                </tr>
              </thead>
              <tbody>
                {lapsedRows.map((r, i) => (
                  <tr key={i} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                    <td className="p-[11px_10px] font-medium text-[#141B34]">{r.company_name}</td>
                    <td className="p-[11px_10px] text-[#7A839E]">{r.product_description}</td>
                    <td className="p-[11px_10px] text-[#7A839E]">{r.last_purchase}</td>
                    <td className="p-[11px_10px] text-right text-[#E8A33D]">{r.months_since} mo</td>
                    <td className="p-[11px_10px] text-right font-medium text-[#3B6FD4]">₹{Number(r.total_revenue).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {lapsedRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-[#7A839E] text-[13px]">Nothing lapsed at this threshold.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === 'trends' && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
          <p className="margin-0 text-[13px] text-[#7A839E]">
            Revenue trend by product for a chosen company. Switch between monthly, quarterly, and yearly views.
          </p>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-col gap-1 min-w-[260px]">
                <label className="text-[11px] text-[#A8AEC4] uppercase tracking-wider font-medium">SELECT COMPANY</label>
              <SearchableSelect
                options={companiesList.map((c) => ({ value: c.name, label: c.name }))}
                value={trendsCompany}
                onChange={loadTrends}
                placeholder="Search companies…"
              />
              </div>
              <label className="flex flex-col gap-1 min-w-[260px] text-[11px] text-[#A8AEC4] uppercase tracking-wider font-medium">
                PRODUCT LINE
                <select
                  value={trendProduct}
                  onChange={(event) => setTrendProduct(event.target.value)}
                  disabled={!trendsCompany}
                  className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#14213D] text-[12.5px] outline-none disabled:opacity-50"
                >
                  <option value="">All products</option>
                  {trendProductOptions.map((product) => <option key={product} value={product}>{product}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-[10px] border border-[#DFE6F2] bg-[#F4F7FC]">
              {(['monthly', 'quarterly', 'yearly'] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setTrendGranularity(period)}
                  className={`px-3 py-1.5 rounded-[7px] text-[11.5px] font-semibold capitalize transition-colors ${
                    trendGranularity === period
                      ? 'bg-white text-[#2F6FED] shadow-sm border border-[#D7E4FF]'
                      : 'text-[#71809B] hover:text-[#14213D]'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {trendsData && (
            <div className="flex flex-col gap-6">
              <div className="rounded-[12px] border border-[#DFE6F2] bg-[#F8FAFE] p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <h3 className="margin-0 text-[16px] font-bold text-[#14213D]">Company product trend</h3>
                    <p className="margin-0 text-[11px] text-[#71809B] mt-0.5">Revenue movement for {trendsCompany}.</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[.08em] text-[#71809B]">{trendGranularity}</span>
                </div>
                <CompanyTrendLineChart data={trendLine.data} series={trendLine.series} />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#EEF1F9]">
                      <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PRODUCT</th>
                      {trendsData.years.map((y) => (
                        <th key={y} className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">{y}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trendsData.products.map((p) => (
                      <tr key={p.part_no} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                        <td className="p-[11px_10px] font-medium text-[#141B34]">{p.product_description}</td>
                        {trendsData.years.map((y) => {
                          const val = trendsData.rows.find((r) => r.part_no === p.part_no && r.year === y)?.total;
                          return (
                            <td key={y} className="p-[11px_10px] text-right font-mono text-[12px] text-[#7A839E]">
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
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
          <p className="margin-0 text-[13px] text-[#7A839E]">
            Upload a year's sales Excel file to import data into the database.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              EXCEL FILE
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] file:mr-3 file:py-1 file:px-2 file:rounded-md file:border-0 file:bg-[#3B6FD4] file:text-[#F4F6FC] file:font-bold text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              YEAR LABEL
              <input
                value={uploadYear}
                onChange={(e) => setUploadYear(e.target.value)}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <button
              type="button"
              onClick={submitUpload}
              disabled={uploading}
              className="h-[36px] px-4 rounded-[9px] bg-[#3B6FD4] text-[#F4F6FC] font-bold text-[12.5px] cursor-pointer"
            >
              {uploading ? 'Importing…' : 'Import File'}
            </button>
          </div>

          {uploadResult && (
            <div className="p-4 rounded-[12px] border border-[#D9E2F4] bg-[#E3EAF7] text-[#3B6FD4] text-[13px]">
              <strong>Import complete.</strong> {uploadResult.importedCount} rows imported, {uploadResult.skippedDuplicateCount} duplicates skipped, {uploadResult.flaggedCount} flagged for review, {uploadResult.companiesAdded} new companies, {uploadResult.productsAdded} new products.
            </div>
          )}

          <div className="flex flex-col gap-3">
            <h3 className="margin-0 text-[16px] font-medium text-[#141B34]">Import History</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#EEF1F9]">
                    <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">FILE</th>
                    <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">YEAR</th>
                    <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">IMPORTED AT</th>
                    <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">ROWS</th>
                    <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">IMPORTED</th>
                    <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DUPLICATES</th>
                    <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">FLAGGED</th>
                    <th className="p-[8px_10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {importBatches.map((b) => (
                    <tr key={b.id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                      <td className="p-[11px_10px] font-medium text-[#141B34]">{b.filename}</td>
                      <td className="p-[11px_10px] text-[#7A839E]">{b.year_label || '-'}</td>
                      <td className="p-[11px_10px] text-[#7A839E]">{b.imported_at}</td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{b.row_count}</td>
                      <td className="p-[11px_10px] text-right text-[#3B6FD4] font-medium">{b.imported_count}</td>
                      <td className="p-[11px_10px] text-right text-[#A8AEC4]">{b.skipped_duplicate_count}</td>
                      <td className="p-[11px_10px] text-right text-[#E5484D]">{b.flagged_count}</td>
                      <td className="p-[11px_10px] text-right">
                        <button
                          type="button"
                          onClick={() => deleteImportBatch(b.id, b.filename)}
                          disabled={deletingBatchId === b.id}
                          className="text-[11px] font-semibold text-[#C8323A] hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        >
                          {deletingBatchId === b.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importBatches.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-[#7A839E] text-[13px]">No imports yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {selectedCompany && yearComparison && yearComparison.years.length > 0 && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium text-[#141B34]">Products Bought — {yearComparison.years.join(' vs ')} — {selectedCompany}</h3>
          {yearComparison.years.length < 2 ? (
            <p className="margin-0 text-[13px] text-[#7A839E]">
              Only one year of data on file for this company. Import a second year (Import Data) to see a year-over-year comparison.
            </p>
          ) : (
            <>
              <p className="margin-0 text-[13px] text-[#7A839E]">
                Products purchased in {yearComparison.years[0]} vs {yearComparison.years[1]}, biggest drop-offs first.
              </p>
              {droppedProducts.length > 0 && (
                <p className="margin-0 text-[13px] text-[#E5484D]">
                  <strong>{droppedProducts.length}</strong> product(s) bought in {yearComparison.years[0]} with nothing purchased in {yearComparison.years[1]}.
                </p>
              )}
            </>
          )}
          <GroupedBarChart data={yearComparisonChartData} seriesNames={yearComparison.years} />
        </section>
      )}

      {selectedCompany && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium text-[#141B34]">Purchase History — {selectedCompany}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DATE</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">INVOICE</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">PART NO</th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">DESCRIPTION</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">QTY</th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                    <td className="p-[11px_10px] text-[#7A839E]">{h.sale_date}</td>
                    <td className="p-[11px_10px] text-[#141B34]">{h.invoice_no}</td>
                    <td className="p-[11px_10px] font-mono text-[12px] text-[#3B6FD4]">{h.part_no}</td>
                    <td className="p-[11px_10px] text-[#141B34]">{h.product_description}</td>
                    <td className="p-[11px_10px] text-right text-[#7A839E]">{h.qty}</td>
                    <td className="p-[11px_10px] text-right font-medium text-[#141B34]">₹{Number(h.total_amount).toLocaleString('en-IN')}</td>
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
