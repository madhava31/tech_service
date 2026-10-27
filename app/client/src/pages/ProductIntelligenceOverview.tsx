import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ProductIntelligenceSummaryData, type ProductTrendDirection } from '../api';
import { queryClient } from '../lib/queryClient';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const PAGE_SIZE = 20;

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const TREND_LABELS: Record<ProductTrendDirection, string> = {
  growing: 'Growing',
  declining: 'Declining',
  stable: 'Stable',
  no_data: 'No Recent Trend Data',
};

const TREND_COLORS: Record<ProductTrendDirection, string> = {
  growing: 'rgb(var(--good))',
  declining: 'rgb(var(--bad))',
  stable: 'rgb(var(--warn))',
  no_data: 'rgb(var(--faint))',
};

const TREND_FILTERS: ProductTrendDirection[] = ['growing', 'declining', 'stable', 'no_data'];

export default function ProductIntelligenceOverview() {
  const cachedData = queryClient.getQueryData<ProductIntelligenceSummaryData>(['products', 'intelligenceSummary']);
  const [data, setData] = useState<ProductIntelligenceSummaryData | null>(cachedData || null);
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [trendFilter, setTrendFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadSummary = (force: boolean | unknown = false) => {
    const shouldForce = force === true;
    if (!data || shouldForce) {
      setLoading(true);
    }
    setError('');
    queryClient
      .fetchQuery({
        queryKey: ['products', 'intelligenceSummary'],
        queryFn: () => api.products.intelligenceSummary(),
        staleTime: 60000,
        tags: ['products', 'intelligence'],
        force: shouldForce,
      })
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('401')) {
          setError('Session expired or unauthorized. Please log in again.');
        } else if (msg.includes('404')) {
          setError('Product intelligence summary endpoint not found (404).');
        } else if (msg.includes('500')) {
          setError('Server error while computing product intelligence (500). Please try again.');
        } else {
          setError(msg || 'Unable to load product intelligence. Please try again.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, trendFilter]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.products.filter(
      (p) =>
        (!q || p.description.toLowerCase().includes(q) || p.part_no.toLowerCase().includes(q)) &&
        (!trendFilter || p.trendDirection === trendFilter)
    );
  }, [data, search, trendFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header & Top Summary Strip */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>
            Product Intelligence
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Which codes carry revenue, which are slipping, and quotation activity vs sales.
          </p>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4  rounded-[18px] shadow-card bg-surface2 overflow-hidden">
            <div className="p-[10px_14px] border-r border-line2 flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-faint">TOTAL PRODUCTS</span>
              <span className="text-[18px] font-medium text-fg">{data.summary.totalProducts}</span>
            </div>
            <div className="p-[10px_14px] border-r border-line2 flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-faint">WITH SALES</span>
              <span className="text-[18px] font-medium text-fg">{data.summary.productsWithSales}</span>
            </div>
            <div className="p-[10px_14px] border-r border-line2 flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-faint">TOP REVENUE</span>
              <span className="text-[14px] font-medium text-fg truncate max-w-[120px]">
                {data.summary.topRevenueProduct?.part_no || '—'}
              </span>
            </div>
            <div className="p-[10px_14px] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-faint">TOP UNITS</span>
              <span className="text-[14px] font-medium text-fg truncate max-w-[120px]">
                {data.summary.topUnitsProduct?.part_no || '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-[12px] bg-badbg border border-badbg text-bad text-[13px] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={loadSummary}
            className="px-3 py-1.5 rounded-[8px] bg-badbg border border-badbg hover:bg-badbg text-fg text-[12px] font-medium transition-colors cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-subtle text-[13px]">Loading product intelligence summary...</div>
      )}

      {!loading && !error && data && data.products.length === 0 && (
        <div className="p-12 text-center bg-surface2 border border-line2 rounded-[14px] text-subtle text-[13px]">
          No products found in the catalog.
        </div>
      )}

      {data && data.products.length > 0 && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          {/* Search & Trend Filter Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
            <div className="flex items-center gap-2.5 flex-wrap">
              <ExpandableSearch
                value={search}
                onChange={setSearch}
                placeholder="Search by name or part code..."
                ariaLabel="Search product intelligence catalogue"
                maxWidth="280px"
              />
              <select
                value={trendFilter}
                onChange={(e) => setTrendFilter(e.target.value)}
                className="ts-fi ts-sel"
              >
                <option value="">All Trends</option>
                {TREND_FILTERS.map((t) => (
                  <option key={t} value={t}>
                    {TREND_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <span className="ts-showing ts-muted">
              Showing {filtered.length} of {data.products.length} products
            </span>
          </div>

          {/* Intelligence Table */}
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>
                    Product code & description
                  </th>
                  <th className="ts-r">
                    Revenue
                  </th>
                  <th className="ts-r">
                    Units
                  </th>
                  <th className="ts-r">
                    Customers
                  </th>
                  <th className="ts-r">
                    Avg selling price
                  </th>
                  <th className="ts-r">
                    Quotes
                  </th>
                  <th className="ts-r">
                    Trend
                  </th>
                  <th className="ts-r">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const tone = TREND_COLORS[p.trendDirection] || 'rgb(var(--muted))';
                  return (
                    <tr key={p.id} >
                      <td className="p-[11px_10px]">
                        <div className="flex flex-col">
                          <Link
                            to={`/products/${p.id}/intelligence`}
                            className="text-fg font-mono text-[12px] font-medium hover:underline"
                          >
                            {p.part_no}
                          </Link>
                          <span className="text-fg text-[12.5px] truncate max-w-[260px]">
                            {p.description}
                          </span>
                        </div>
                      </td>
                      <td className="p-[11px_10px] text-right font-medium text-fg">
                        {formatCurrency(p.revenue)}
                      </td>
                      <td className="p-[11px_10px] text-right text-subtle">{p.unitsSold}</td>
                      <td className="p-[11px_10px] text-right text-subtle">{p.customers}</td>
                      <td className="p-[11px_10px] text-right text-subtle">
                        {formatCurrency(p.avgSellingPrice)}
                      </td>
                      <td className="p-[11px_10px] text-right text-subtle">{p.quotationCount}</td>
                      <td className="p-[11px_10px] text-right">
                        <span className="inline-flex items-center gap-1.5 capitalize text-[11px] font-medium" style={{ color: tone }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone }} />
                          {TREND_LABELS[p.trendDirection]}
                        </span>
                      </td>
                      <td className="p-[11px_10px] text-right">
                        <Link
                          to={`/products/${p.id}/intelligence`}
                          className="text-[12px] text-fg hover:underline font-medium"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ts-empty">
                      No matching products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}
