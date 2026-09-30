import { useEffect, useState } from 'react';
import { api, Company } from '../api';
import { HorizontalBarChart, GroupedBarChart } from '../components/BarChart';
import SearchableSelect from '../components/SearchableSelect';
import { ExpandableSearch } from '../components/ExpandableSearch';

type Tab = 'companies' | 'products' | 'review' | 'import' | 'lapsed' | 'trends';

export default function Reports() {
  const [tab, setTab] = useState<Tab>('companies');
  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(new Set());
  const [loading, setLoading] = useState(false);

  const [companyRows, setCompanyRows] = useState<any[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [productRows, setProductRows] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
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

  // Lapsed Purchases tab
  const [lapsedMonths, setLapsedMonths] = useState(12);
  const [lapsedRows, setLapsedRows] = useState<any[]>([]);

  // Company Trends tab
  const [trendsCompany, setTrendsCompany] = useState('');
  const [trendsData, setTrendsData] = useState<{ products: any[]; years: string[]; rows: any[] } | null>(null);

  useEffect(() => {
    if (loadedTabs.has(tab)) return;
    setLoading(true);
    const done = () => setLoading(false);
    setLoadedTabs((prev) => new Set(prev).add(tab));

    if (tab === 'companies') api.reports.companies().then(setCompanyRows).catch((e) => setError(e.message)).finally(done);
    else if (tab === 'products') api.reports.products().then(setProductRows).catch((e) => setError(e.message)).finally(done);
    else if (tab === 'review') api.reports.reviewQueue().then(setReviewRows).catch((e) => setError(e.message)).finally(done);
    else if (tab === 'lapsed') {
      api.settings.get().then((s) => {
        setLapsedMonths(s.default_lapse_months);
        return loadLapsed(s.default_lapse_months);
      }).catch((e) => setError(e.message)).finally(done);
    }
    else if (tab === 'trends') api.companies.list().then(setCompaniesList).catch((e) => setError(e.message)).finally(done);
    else if (tab === 'import') loadImportBatches().finally(done);
    else done();
  }, [tab]);

  function viewHistory(name: string) {
    setSelectedCompany(name);
    api.reports.companyHistory(name).then(setHistory).catch((e) => setError(e.message));
    api.reports.companyYearComparison(name).then(setYearComparison).catch((e) => setError(e.message));
  }

  function loadImportBatches() {
    return api.imports.list().then(setImportBatches).catch((e) => setError(e.message));
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
      setLoadedTabs(new Set(['import']));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  function loadTrends(company: string) {
    setTrendsCompany(company);
    if (!company) { setTrendsData(null); return; }
    api.reports.companyYearly(company).then(setTrendsData).catch((e) => setError(e.message));
  }

  const lapsedChartData = lapsedRows.slice(0, 15).map((r) => ({
    label: r.company_name,
    sublabel: r.product_description,
    value: r.total_revenue,
  }));

  const trendsChartData = trendsData
    ? trendsData.products.map((p) => ({
        category: p.product_description.length > 22 ? p.product_description.slice(0, 22) + '…' : p.product_description,
        series: trendsData.years.map((year) => ({
          name: year,
          value: trendsData.rows.find((r) => r.part_no === p.part_no && r.year === year)?.total || 0,
        })),
      }))
    : [];

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

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
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
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF1F9] pb-3.5">
            <ExpandableSearch
              value={companySearch}
              onChange={setCompanySearch}
              placeholder="Search companies..."
              ariaLabel="Search companies report"
              maxWidth="280px"
            />
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
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF1F9] pb-3.5">
            <ExpandableSearch
              value={productSearch}
              onChange={setProductSearch}
              placeholder="Search products..."
              ariaLabel="Search products report"
              maxWidth="280px"
            />
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
            Purchases per product per year for a chosen company — missing bars indicate gap years.
          </p>
          <div className="flex flex-col gap-1 max-w-[340px]">
            <label className="text-[11px] text-[#A8AEC4] uppercase tracking-wider font-medium">SELECT COMPANY</label>
            <SearchableSelect
              options={companiesList.map((c) => ({ value: c.name, label: c.name }))}
              value={trendsCompany}
              onChange={loadTrends}
              placeholder="Search companies…"
            />
          </div>

          {trendsData && (
            <div className="flex flex-col gap-6">
              <h3 className="margin-0 text-[16px] font-medium text-[#141B34]">Top Products by Year</h3>
              <GroupedBarChart data={trendsChartData} seriesNames={trendsData.years} />

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
                    </tr>
                  ))}
                  {importBatches.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-[#7A839E] text-[13px]">No imports yet.</td></tr>
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
