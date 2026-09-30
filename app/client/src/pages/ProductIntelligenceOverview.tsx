import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ProductIntelligenceSummaryData, type ProductTrendDirection } from '../api';
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
  growing: '#3B6FD4',
  declining: '#E5484D',
  stable: '#E8A33D',
  no_data: '#A8AEC4',
};

const TREND_FILTERS: ProductTrendDirection[] = ['growing', 'declining', 'stable', 'no_data'];

export default function ProductIntelligenceOverview() {
  const [data, setData] = useState<ProductIntelligenceSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [trendFilter, setTrendFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadSummary = () => {
    setLoading(true);
    setError('');
    api.products
      .intelligenceSummary()
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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header & Top Summary Strip */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Product Intelligence
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Which codes carry revenue, which are slipping, and quotation activity vs sales.
          </p>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 border border-[#E4E8F2] rounded-[12px] bg-[#FFFFFF] overflow-hidden">
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">TOTAL PRODUCTS</span>
              <span className="text-[18px] font-medium text-[#141B34]">{data.summary.totalProducts}</span>
            </div>
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">WITH SALES</span>
              <span className="text-[18px] font-medium text-[#3B6FD4]">{data.summary.productsWithSales}</span>
            </div>
            <div className="p-[10px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">TOP REVENUE</span>
              <span className="text-[14px] font-medium text-[#141B34] truncate max-w-[120px]">
                {data.summary.topRevenueProduct?.part_no || '—'}
              </span>
            </div>
            <div className="p-[10px_14px] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">TOP UNITS</span>
              <span className="text-[14px] font-medium text-[#141B34] truncate max-w-[120px]">
                {data.summary.topUnitsProduct?.part_no || '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-[12px] bg-[#F8E4E4] border border-[#F4D6D7] text-[#E5484D] text-[13px] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={loadSummary}
            className="px-3 py-1.5 rounded-[8px] bg-[#F7E0E1] border border-[#F4D6D7] hover:bg-[#F6DCDD] text-[#141B34] text-[12px] font-medium transition-colors cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-[#7A839E] text-[13px]">Loading product intelligence summary...</div>
      )}

      {!loading && !error && data && data.products.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] border border-[#E4E8F2] rounded-[14px] text-[#7A839E] text-[13px]">
          No products found in the catalog.
        </div>
      )}

      {data && data.products.length > 0 && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
          {/* Search & Trend Filter Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-[#EEF1F9] pb-3.5">
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
                className="h-[30px] px-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none cursor-pointer"
              >
                <option value="">All Trends</option>
                {TREND_FILTERS.map((t) => (
                  <option key={t} value={t}>
                    {TREND_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filtered.length} of {data.products.length} products
            </span>
          </div>

          {/* Intelligence Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    PRODUCT CODE & DESCRIPTION
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    REVENUE
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    UNITS
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    CUSTOMERS
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    AVG SELLING PRICE
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    QUOTES
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    TREND
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    ACTION
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const tone = TREND_COLORS[p.trendDirection] || '#7A839E';
                  return (
                    <tr key={p.id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                      <td className="p-[11px_10px]">
                        <div className="flex flex-col">
                          <Link
                            to={`/products/${p.id}/intelligence`}
                            className="text-[#3B6FD4] font-mono text-[12px] font-medium hover:underline"
                          >
                            {p.part_no}
                          </Link>
                          <span className="text-[#141B34] text-[12.5px] truncate max-w-[260px]">
                            {p.description}
                          </span>
                        </div>
                      </td>
                      <td className="p-[11px_10px] text-right font-medium text-[#141B34]">
                        {formatCurrency(p.revenue)}
                      </td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{p.unitsSold}</td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{p.customers}</td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">
                        {formatCurrency(p.avgSellingPrice)}
                      </td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{p.quotationCount}</td>
                      <td className="p-[11px_10px] text-right">
                        <span className="inline-flex items-center gap-1.5 capitalize text-[11px] font-medium" style={{ color: tone }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone }} />
                          {TREND_LABELS[p.trendDirection]}
                        </span>
                      </td>
                      <td className="p-[11px_10px] text-right">
                        <Link
                          to={`/products/${p.id}/intelligence`}
                          className="text-[12px] text-[#3B6FD4] hover:underline font-medium"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-[#7A839E] text-[13px]">
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
