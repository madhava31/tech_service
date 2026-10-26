import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PurchaseOrder } from '../api';
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

const PO_STATUS_TONES: Record<string, string> = {
  active: '#E8A33D',
  'in production': '#E8A33D',
  dispatched: '#6B78D6',
  delivered: '#3B6FD4',
  completed: '#3B6FD4',
};

export default function PurchaseOrders() {
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.purchaseOrders.list().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFilter]);

  const statuses = useMemo(() => Array.from(new Set(rows.map((po) => po.status))).sort(), [rows]);

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
    const openVal = rows.reduce((sum, po) => sum + (po.total || 0), 0);
    const count = rows.length;
    return { openVal, count };
  }, [rows]);

  return (
    <div className="p-6 flex flex-col gap-6 text-fg min-h-screen">
      {/* Header & KPI Summary */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Purchase Orders
          </h1>
          <p className="margin-0 text-[13.5px] text-subtle">
            Orders raised against accepted quotations, by fulfilment state.
          </p>
        </div>
        <div className="grid grid-cols-2 border border-line2 rounded-[12px] bg-surface2 overflow-hidden">
          <div className="p-[10px_16px] border-r border-line2 flex flex-col gap-[2px]">
            <span className="text-[11px] tracking-[.08em] text-faint">TOTAL VALUE</span>
            <span className="text-[20px] font-medium text-fg">
              ₹{kpis.openVal > 0 ? (kpis.openVal / 100000).toFixed(2) + 'L' : '0.00'}
            </span>
          </div>
          <div className="p-[10px_16px] flex flex-col gap-[2px]">
            <span className="text-[11px] tracking-[.08em] text-faint">TOTAL ORDERS</span>
            <span className="text-[20px] font-medium text-fg">{kpis.count}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-[10px] border border-badbg bg-badbg text-bad text-[12.5px]">
          {error}
        </div>
      )}

      {/* Main Table Container Card */}
      <section className="bg-surface2 border border-line2 rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-line2 pb-3.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ExpandableSearch
              value={search}
              onChange={setSearch}
              placeholder="Search PO or company..."
              ariaLabel="Search purchase orders"
              maxWidth="280px"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-[30px] px-2 rounded-[8px] bg-surface border border-line2 text-fg text-[12px] outline-none cursor-pointer"
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
              className="h-[30px] px-2 rounded-[8px] bg-surface border border-line2 text-fg text-[12px] outline-none cursor-pointer"
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
                className="h-[30px] px-2.5 rounded-[8px] bg-surface border border-line2 text-subtle text-[12px] hover:text-fg cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <span className="text-[11.5px] text-faint">
            Showing {filtered.length} of {rows.length}
          </span>
        </div>

        {/* PO Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line2">
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  ORDER
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  CUSTOMER
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  LINKED QUOTE
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  CLIENT REF
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  RAISED
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  STATUS
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((po) => {
                const tone = PO_STATUS_TONES[po.status.toLowerCase()] || '#3B6FD4';
                return (
                  <tr key={po.id} className="border-b border-line hover:bg-surface transition-colors">
                    <td className="p-[11px_10px] font-medium text-fg">{po.number}</td>
                    <td className="p-[11px_10px] text-fg">{po.company_name || '—'}</td>
                    <td className="p-[11px_10px] text-subtle">
                      <Link to={`/quotations/${po.quotation_id}`} className="text-fg hover:underline">
                        {po.quotation_number}
                      </Link>
                    </td>
                    <td className="p-[11px_10px] text-subtle">{po.client_po_ref || '—'}</td>
                    <td className="p-[11px_10px] text-subtle">{po.date}</td>
                    <td className="p-[11px_10px] text-right">
                      <span className="inline-flex items-center gap-1.5 capitalize" style={{ color: tone }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone }} />
                        {po.status}
                      </span>
                    </td>
                    <td className="p-[11px_10px] text-right">
                      <a
                        href={api.purchaseOrders.pdfUrl(po.id)}
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
                  <td colSpan={7} className="text-center py-8 text-subtle text-[13px]">
                    No purchase orders found.
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
