import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDay } from '../components/ds/format';
import { api, PerformaInvoice } from '../api';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const PAGE_SIZE = 20;

type DateFilter = 'all' | 'today' | 'week' | 'month';

function getDateRange(filter: DateFilter): { start: string; end: string } | null {
  if (filter === 'all') return null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  if (filter === 'today') {
    const s = toStr(y, m, d);
    return { start: s, end: s };
  }
  if (filter === 'week') {
    const dayOfWeek = new Date(y, m, d).getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return { start: toStr(y, m, d - diffToMonday), end: toStr(y, m, d - diffToMonday + 6) };
  }
  const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
  return { start: toStr(y, m, 1), end: toStr(y, m, lastDayOfMonth) };
}

function matchesDate(dateStr: string | null | undefined, range: { start: string; end: string } | null) {
  if (!range) return true;
  if (!dateStr) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

const PI_STATUS_TONES: Record<string, string> = {
  issued: '#6B78D6',
  active: '#6B78D6',
  paid: '#3B6FD4',
  overdue: '#E5484D',
  cancelled: '#A8AEC4',
};

export default function PerformaInvoices() {
  const [rows, setRows] = useState<PerformaInvoice[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.performaInvoices.list().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFilter]);

  const statuses = useMemo(() => Array.from(new Set(rows.map((pi) => pi.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = getDateRange(dateFilter);
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!matchesDate(r.date, range)) return false;
      if (q) {
        const number = (r.number || '').toLowerCase();
        const company = (r.company_name || '').toLowerCase();
        if (!number.includes(q) && !company.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  const hasActiveFilters = search !== '' || statusFilter !== '' || dateFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setStatusFilter('');
    setDateFilter('all');
  }

  const kpis = useMemo(() => {
    const totalVal = rows.reduce((sum, pi) => sum + (pi.total || 0), 0);
    const count = rows.length;
    return { totalVal, count };
  }, [rows]);

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header & KPI Summary Bar */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>
            Performa Invoices
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Issued invoices and where collection currently stands.
          </p>
        </div>
        <div className="grid grid-cols-2  rounded-[18px] shadow-card bg-surface2 overflow-hidden">
          <div className="p-[10px_16px] border-r border-line2 flex flex-col gap-[2px]">
            <span className="text-[12px] text-subtle">Total value</span>
            <span className="text-[22px] font-medium text-fg tracking-[-.02em] num">
              ₹{kpis.totalVal > 0 ? (kpis.totalVal / 100000).toFixed(2) + 'L' : '0.00'}
            </span>
          </div>
          <div className="p-[10px_16px] flex flex-col gap-[2px]">
            <span className="text-[12px] text-subtle">Total invoices</span>
            <span className="text-[22px] font-medium text-fg tracking-[-.02em] num">{kpis.count}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* Main Table Container Card */}
      <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ExpandableSearch
              value={search}
              onChange={setSearch}
              placeholder="Search PI or company..."
              ariaLabel="Search performa invoices"
              maxWidth="280px"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ts-fi ts-sel"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="ts-fi ts-sel"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="ts-btn ts-ghost ts-xs"
              >
                Clear
              </button>
            )}
          </div>
          <span className="ts-showing ts-muted">
            Showing {filtered.length} of {rows.length}
          </span>
        </div>

        {/* PI Table */}
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>
                  Invoice
                </th>
                <th>
                  Customer
                </th>
                <th>
                  Linked quote
                </th>
                <th>
                  Issued
                </th>
                <th className="ts-r">
                  Status
                </th>
                <th className="ts-r">
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((pi) => {
                const tone = PI_STATUS_TONES[pi.status.toLowerCase()] || '#6B78D6';
                return (
                  <tr key={pi.id} >
                    <td className="p-[11px_10px] font-medium text-fg">{pi.number}</td>
                    <td className="p-[11px_10px] text-fg">{pi.company_name || '—'}</td>
                    <td className="p-[11px_10px] text-subtle">
                      <Link to={`/quotations/${pi.quotation_id}`} className="text-fg hover:underline">
                        {pi.quotation_number}
                      </Link>
                    </td>
                    <td className="p-[11px_10px] text-subtle">{fmtDay(pi.date)}</td>
                    <td className="p-[11px_10px] text-right">
                      <span className={`ts-st ts-${String(pi.status).toLowerCase().replace(/\s+/g, '_')}`}>{pi.status}</span>
                    </td>
                    <td className="p-[11px_10px] text-right">
                      <a
                        href={api.performaInvoices.pdfUrl(pi.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-subtle hover:text-fg hover:underline"
                      >
                        PDF →
                      </a>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="ts-empty">
                    No performa invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pagination Footer */}
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
