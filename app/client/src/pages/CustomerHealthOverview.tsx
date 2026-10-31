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
  new: 'rgb(var(--good))',
  strong: 'rgb(var(--good))',
  active: 'rgb(var(--good))',
  at_risk: 'rgb(var(--warn))',
  inactive: 'rgb(var(--bad))',
  no_history: 'rgb(var(--faint))',
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
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Page Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>
            Customer Health
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Account scores from order recency, frequency and value movement.
          </p>
        </div>

        {/* Stacked Distribution Summary Bar */}
        {data && (
          <div className="flex flex-col gap-2 min-w-[300px]">
            <div className="flex h-2 rounded-[5px] overflow-hidden bg-surface">
              <div
                style={{ width: `${((data.summary.strong + data.summary.active + data.summary.new) / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-brandblue h-full"
              />
              <div
                style={{ width: `${(data.summary.atRisk / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-warn h-full"
              />
              <div
                style={{ width: `${(data.summary.inactive / Math.max(1, data.summary.total)) * 100}%` }}
                className="bg-bad h-full"
              />
            </div>
            <div className="flex gap-4 text-[11.5px] text-subtle">
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-brandblue" />
                Healthy {data.summary.strong + data.summary.active + data.summary.new}
              </span>
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-warn" />
                Watch {data.summary.atRisk}
              </span>
              <span className="inline-flex gap-1.5 items-center">
                <span className="w-2 h-2 rounded-[2px] bg-bad" />
                At risk {data.summary.inactive}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-[12px] bg-badbg border border-badbg text-bad text-[13px] flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="px-3 py-1.5 rounded-[8px] bg-badbg hover:bg-badbg text-fg text-xs font-semibold cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-subtle text-[13px] rounded-[16px] bg-surface2 border border-line2">
          Loading customer health summary...
        </div>
      )}

      {data && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          {/* Filter Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
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
                className="ts-fi ts-sel"
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
            <span className="ts-showing ts-muted">
              Showing {filtered.length} of {data.customers.length} accounts
            </span>
          </div>

          {/* Table */}
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>
                    Customer
                  </th>
                  <th>
                    Health band
                  </th>
                  <th className="ts-r">
                    Total revenue
                  </th>
                  <th className="ts-r">
                    Orders
                  </th>
                  <th>
                    Last order
                  </th>
                  <th className="ts-r">
                    Recency
                  </th>
                  <th className="ts-r">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => {
                  const color = STATUS_COLORS[c.status] || 'rgb(var(--muted))';
                  return (
                    <tr key={c.company_id} >
                      <td className="p-[11px_10px] font-medium text-fg">{c.company_name}</td>
                      <td className="p-[11px_10px]">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border border-line2 text-[11px] font-medium" style={{ color }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="p-[11px_10px] text-right font-medium text-fg">
                        {formatCurrency(c.totalRevenue)}
                      </td>
                      <td className="p-[11px_10px] text-right text-subtle">{c.orderCount}</td>
                      <td className="p-[11px_10px] text-subtle">{formatDate(c.lastOrderDate)}</td>
                      <td className="p-[11px_10px] text-right text-subtle">{relativeDays(c.daysSinceLastOrder)}</td>
                      <td className="p-[11px_10px] text-right">
                        <Link
                          to={`/companies/${c.company_id}/health`}
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
                    <td colSpan={7} className="ts-empty">
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
