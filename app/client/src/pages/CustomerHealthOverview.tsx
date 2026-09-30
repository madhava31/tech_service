import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CustomerHealthStatus, CustomerHealthSummaryData } from '../api';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const PAGE_SIZE = 20;

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relativeDays(days: number | null) {
  if (days == null) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

const STATUS_LABELS: Record<CustomerHealthStatus, string> = {
  new: 'New',
  strong: 'Healthy',
  active: 'Healthy',
  at_risk: 'Watch',
  inactive: 'At Risk',
  no_history: 'Dormant',
};

const STATUS_COLORS: Record<CustomerHealthStatus, string> = {
  new: '#3B6FD4',
  strong: '#3B6FD4',
  active: '#3B6FD4',
  at_risk: '#E8A33D',
  inactive: '#E5484D',
  no_history: '#A8AEC4',
};

export default function CustomerHealthOverview() {
  const [data, setData] = useState<CustomerHealthSummaryData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const fetchData = () => {
    setLoading(true);
    setError('');
    api.companies
      .healthSummary()
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load customer health summary.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.customers.filter(
      (c) => (!q || c.company_name.toLowerCase().includes(q)) && (!statusFilter || c.status === statusFilter)
    );
  }, [data, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Customer Health
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            Account scores from order recency, frequency and value movement.
          </p>
        </div>

        {/* Stacked Distribution Summary Bar */}
        {data && (
          <div className="flex flex-col gap-2 min-w-[300px]">
            <div className="flex h-2 rounded-[5px] overflow-hidden bg-[#F7F8FC]">
              <div
                style={{ width: `${((data.summary.strong + data.summary.active + data.summary.new) / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-[#3B6FD4] h-full"
              />
              <div
                style={{ width: `${(data.summary.atRisk / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-[#E8A33D] h-full"
              />
              <div
                style={{ width: `${(data.summary.inactive / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-[#E5484D] h-full"
              />
            </div>
            <div className="flex gap-4 text-[11.5px] text-[#7A839E]">
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-[#3B6FD4]" />
                Healthy {data.summary.strong + data.summary.active + data.summary.new}
              </span>
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-[#E8A33D]" />
                Watch {data.summary.atRisk}
              </span>
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-[#E5484D]" />
                At risk {data.summary.inactive}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-[12px] bg-[#F8E4E4] border border-[#F4D6D7] text-[#E5484D] text-[13px] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="px-3 py-1.5 rounded-[8px] bg-[#F7DFE0] hover:bg-[#F5DADB] text-[#141B34] text-xs font-semibold cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-[#7A839E] text-[13px] rounded-[16px] bg-[#FFFFFF] border border-[#E4E8F2]">
          Loading customer health summary...
        </div>
      )}

      {data && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
          {/* Filter Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-[#EEF1F9] pb-3.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <ExpandableSearch
                value={search}
                onChange={setSearch}
                placeholder="Search company name..."
                ariaLabel="Search customer health by company name"
                maxWidth="280px"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-[30px] px-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none cursor-pointer"
              >
                <option value="">All Health Statuses</option>
                <option value="strong">Healthy (Strong)</option>
                <option value="active">Healthy (Active)</option>
                <option value="new">Healthy (New)</option>
                <option value="at_risk">Watch (At Risk)</option>
                <option value="inactive">At Risk (Inactive)</option>
                <option value="no_history">Dormant (No History)</option>
              </select>
            </div>
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filtered.length} of {data.customers.length} accounts
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF1F9]">
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    CUSTOMER
                  </th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    HEALTH BAND
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    TOTAL REVENUE
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    ORDERS
                  </th>
                  <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    LAST ORDER
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    RECENCY
                  </th>
                  <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                    ACTION
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => {
                  const color = STATUS_COLORS[c.status] || '#7A839E';
                  return (
                    <tr key={c.company_id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
                      <td className="p-[11px_10px] font-medium text-[#141B34]">{c.company_name}</td>
                      <td className="p-[11px_10px]">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border border-[#E4E8F2] text-[11px] font-medium" style={{ color }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="p-[11px_10px] text-right font-medium text-[#141B34]">
                        {formatCurrency(c.totalRevenue)}
                      </td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{c.orderCount}</td>
                      <td className="p-[11px_10px] text-[#7A839E]">{formatDate(c.lastOrderDate)}</td>
                      <td className="p-[11px_10px] text-right text-[#7A839E]">{relativeDays(c.daysSinceLastOrder)}</td>
                      <td className="p-[11px_10px] text-right">
                        <Link
                          to={`/companies/${c.company_id}/health`}
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
                    <td colSpan={7} className="text-center py-8 text-[#7A839E] text-[13px]">
                      No matching accounts found.
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
