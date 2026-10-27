import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, Quotation, QuotationPageResponse } from '../api';
import { queryClient } from '../lib/queryClient';
import { ChevronDown, ChevronUp, Search, X, Filter, RotateCcw, Trash2, Loader2, RefreshCw, Download, Plus } from 'lucide-react';
import { Seg } from '../components/ds/Seg';
import { fmtDay } from '../components/ds/format';

const PAGE_SIZE = 25;

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

const STAGE_COLORS: Record<string, string> = {
  draft: 'rgb(var(--muted))',
  sent: 'rgb(var(--fg))',
  accepted: 'rgb(var(--good))',
  rejected: 'rgb(var(--bad))',
  po_created: 'rgb(var(--fg))',
  pi_created: 'rgb(var(--fg))',
};

export default function Quotations() {
  // Data & Pagination state
  const [rows, setRows] = useState<Quotation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({
    All: 0,
    Draft: 0,
    Sent: 0,
    Accepted: 0,
    Rejected: 0,
  });

  // Loading & Error states
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Selection & Bulk Actions State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Expandable Search & Filter State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchNumber, setSearchNumber] = useState('');
  const [searchCompany, setSearchCompany] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Debounced input terms
  const [debouncedNumber, setDebouncedNumber] = useState('');
  const [debouncedCompany, setDebouncedCompany] = useState('');
  const [debouncedMinAmount, setDebouncedMinAmount] = useState('');
  const [debouncedMaxAmount, setDebouncedMaxAmount] = useState('');

  // Debounce effect (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNumber(searchNumber.trim());
      setDebouncedCompany(searchCompany.trim());
      setDebouncedMinAmount(minAmount.trim());
      setDebouncedMaxAmount(maxAmount.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchNumber, searchCompany, minAmount, maxAmount]);

  // Request ID ref to prevent stale async race conditions
  const activeReqIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Core fetch function
  const fetchPage = useCallback(
    async (targetPage: number, isReset: boolean) => {
      const reqId = ++activeReqIdRef.current;
      const dateRange = getDateRange(dateFilter);
      const params = {
        page: targetPage,
        pageSize: PAGE_SIZE,
        status: statusFilter || undefined,
        searchNumber: debouncedNumber || undefined,
        searchCompany: debouncedCompany || undefined,
        dateStart: dateRange?.start,
        dateEnd: dateRange?.end,
        minAmount: debouncedMinAmount ? Number(debouncedMinAmount) : undefined,
        maxAmount: debouncedMaxAmount ? Number(debouncedMaxAmount) : undefined,
        paginated: true,
      };

      const queryKey = ['quotations', 'list', params];

      if (isReset) {
        // Instant client cache reuse on navigation
        const cached = queryClient.getQueryData<QuotationPageResponse>(queryKey);
        if (cached && Array.isArray(cached.items)) {
          setRows(cached.items);
          setPage(cached.page);
          setTotal(cached.total);
          setHasMore(cached.hasMore);
          if (cached.stageCounts) setStageCounts(cached.stageCounts);
          setInitialLoading(false);
        } else {
          setInitialLoading(true);
        }
        setError('');
      } else {
        setLoadingMore(true);
        setLoadMoreError('');
      }

      try {
        const response = await queryClient.fetchQuery<QuotationPageResponse>({
          queryKey,
          queryFn: () => api.quotations.list(params),
          staleTime: 30000,
          tags: ['quotations'],
          force: !isReset,
        });

        // Ensure this response matches the latest query
        if (reqId !== activeReqIdRef.current) return;

        if (response && Array.isArray(response.items)) {
          if (isReset) {
            setRows(response.items);
          } else {
            setRows((prev) => [...prev, ...response.items]);
          }
          setPage(response.page);
          setTotal(response.total);
          setHasMore(response.hasMore);
          if (response.stageCounts) {
            setStageCounts(response.stageCounts);
          }
        }
      } catch (err: any) {
        if (reqId !== activeReqIdRef.current) return;
        if (isReset) {
          setError(err.message || 'Failed to load quotations');
        } else {
          setLoadMoreError(err.message || 'Failed to load more quotations');
        }
      } finally {
        if (reqId === activeReqIdRef.current) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [statusFilter, debouncedNumber, debouncedCompany, dateFilter, debouncedMinAmount, debouncedMaxAmount]
  );

  // Trigger reset load on filter or search changes
  useEffect(() => {
    fetchPage(1, true);
  }, [fetchPage]);

  // Listen to tag invalidations so external mutations refresh quotations automatically
  useEffect(() => {
    const unsubscribe = queryClient.subscribe(['quotations'], (entry) => {
      if (entry.staleAt === 0) {
        fetchPage(1, true);
      }
    });
    return unsubscribe;
  }, [fetchPage]);

  // Progressive scroll observer (IntersectionObserver)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMore && !loadingMore && !initialLoading && !loadMoreError) {
          fetchPage(page + 1, false);
        }
      },
      { rootMargin: '250px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, initialLoading, loadMoreError, page, fetchPage]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchPage(page + 1, false);
    }
  };

  const handleDelete = async (id: number, number: string, status?: string) => {
    const isAccepted = status === 'accepted';

    if (isAccepted) {
      const step1Message = `Step 1 of 2: Quotation "${number}" is currently ACCEPTED. Are you sure you want to initiate deletion?`;
      if (!window.confirm(step1Message)) return;

      const step2Message = `FINAL CONFIRMATION (Step 2 of 2): Are you 100% SURE you want to PERMANENTLY DELETE ACCEPTED quotation "${number}"? This will remove all associated line items, follow-ups, and linked documents!`;
      if (!window.confirm(step2Message)) return;
    } else {
      const confirmMessage = `Are you sure you want to delete quotation "${number}"?`;
      if (!window.confirm(confirmMessage)) return;
    }

    setDeletingId(id);
    try {
      await api.quotations.delete(id);
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      // Refresh starting from page 1 to maintain deterministic list state
      fetchPage(1, true);
    } catch (err: any) {
      alert(err.message || 'Failed to delete quotation');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one quotation to delete.');
      return;
    }

    const selectedQuotations = rows.filter((q) => selectedIds.includes(q.id));
    const hasAccepted = selectedQuotations.some((q) => q.status === 'accepted');

    if (hasAccepted) {
      const step1Message = `Step 1 of 2: You have selected ${selectedIds.length} quotation(s), which includes ACCEPTED quotation(s). Are you sure you want to initiate deletion?`;
      if (!window.confirm(step1Message)) return;

      const step2Message = `FINAL CONFIRMATION (Step 2 of 2): Are you 100% SURE you want to PERMANENTLY DELETE these ${selectedIds.length} selected quotation(s)? This will remove all associated line items, follow-ups, and linked documents!`;
      if (!window.confirm(step2Message)) return;
    } else {
      const confirmMessage = `Are you sure you want to delete the ${selectedIds.length} selected quotation(s)?`;
      if (!window.confirm(confirmMessage)) return;
    }

    setIsBulkDeleting(true);

    const results = await Promise.allSettled(
      selectedIds.map((id) => api.quotations.delete(id))
    );

    const failedCount = results.filter((r) => r.status === 'rejected').length;

    setSelectedIds([]);
    setIsSelectionMode(false);
    setIsBulkDeleting(false);

    if (failedCount > 0) {
      alert(`Deleted ${selectedIds.length - failedCount} quotation(s). Failed to delete ${failedCount} quotation(s).`);
    }

    fetchPage(1, true);
  };

  const hasSearchFilters =
    searchNumber !== '' ||
    searchCompany !== '' ||
    dateFilter !== 'all' ||
    minAmount !== '' ||
    maxAmount !== '';

  const hasAnyActiveFilters = hasSearchFilters || statusFilter !== '';

  function resetFilters() {
    setSearchNumber('');
    setSearchCompany('');
    setStatusFilter('');
    setDateFilter('all');
    setMinAmount('');
    setMaxAmount('');
  }

  function clearSearchPanelFilters() {
    setSearchNumber('');
    setSearchCompany('');
    setDateFilter('all');
    setMinAmount('');
    setMaxAmount('');
  }

  const isAllRowsSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((q) => selectedIds.includes(q.id));
  }, [rows, selectedIds]);

  const toggleSelectAll = () => {
    if (isAllRowsSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rows.map((q) => q.id));
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const STAGES = [
    { name: 'All', key: '' },
    { name: 'Draft', key: 'draft' },
    { name: 'Sent', key: 'sent' },
    { name: 'Accepted', key: 'accepted' },
    { name: 'Rejected', key: 'rejected' },
  ];
  const cols = isSelectionMode ? 7 : 6;
  const money = (v: number) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div style={{ minWidth: 0 }}>
          <div className="ts-crumb" style={{ fontSize: 13, color: 'rgb(var(--muted))', marginBottom: 6 }}>Sales</div>
          <h1>Quotations</h1>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Every quotation with its stage, value and follow-up position.</p>
        </div>
        <span className="ts-grow" />
      </div>

      <div className="ts-toolbar">
        <div className="max-w-full overflow-x-auto no-scrollbar rounded-full">
          <Seg
            label="Filter by stage"
            value={statusFilter || 'all'}
            options={STAGES.map((st) => ({ value: st.key || 'all', label: st.name, count: stageCounts[st.name] || 0 }))}
            onChange={(v) => setStatusFilter(v === 'all' ? '' : v)}
          />
        </div>
        <div className="ts-end">
          <a className="ts-btn ts-ghost" href={api.export.quotationsUrl(statusFilter ? { status: statusFilter } : undefined)} download>
            <Download /> Export to Excel
          </a>
          {!isSelectionMode ? (
            <button type="button" className="ts-btn ts-ghost" onClick={() => setIsSelectionMode(true)}>
              <Trash2 /> Select to delete
            </button>
          ) : (
            <>
              <button type="button" className={`ts-btn ${selectedIds.length ? 'ts-danger' : 'ts-ghost'}`} onClick={handleBulkDelete} disabled={isBulkDeleting}>
                <Trash2 /> {isBulkDeleting ? 'Deleting…' : selectedIds.length ? `Delete ${selectedIds.length} selected` : 'Delete selected'}
              </button>
              <button type="button" className="ts-btn ts-ghost" onClick={() => { setIsSelectionMode(false); setSelectedIds([]); }}>Cancel</button>
            </>
          )}
          <Link className="ts-btn ts-dark" to="/quotations/new"><Plus /> New quotation</Link>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox"><span>{error}</span>
          <button type="button" className="ts-btn" onClick={() => fetchPage(1, true)}><RefreshCw /> Retry</button></div>
      )}

      <section className="ts-card ts-white ts-tcard ts-tbl" style={{ ['--i' as string]: 0 }}>
        <div className="ts-tbar">
          <label className="ts-search">
            <Search className="size-4" />
            <input value={searchNumber} onChange={(e) => setSearchNumber(e.target.value)} placeholder="Search quotation number" aria-label="Search quotation number" />
          </label>
          <label className="ts-search">
            <Search className="size-4" />
            <input value={searchCompany} onChange={(e) => setSearchCompany(e.target.value)} placeholder="Search customer" aria-label="Search customer" />
          </label>
          <button
            type="button"
            className="ts-btn ts-ghost ts-xs"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            aria-expanded={isSearchOpen}
            aria-controls="quotation-search-panel"
          >
            <Filter /> More filters
            {(dateFilter !== 'all' || minAmount !== '' || maxAmount !== '') && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
            {isSearchOpen ? <ChevronUp /> : <ChevronDown />}
          </button>
          {hasAnyActiveFilters && (
            <button type="button" className="ts-btn ts-ghost ts-xs" onClick={resetFilters}><RotateCcw /> Reset</button>
          )}
          <span className="ts-showing ts-muted">Showing {rows.length} of {total}</span>
        </div>

        {isSearchOpen && (
          <div id="quotation-search-panel" className="ts-filters">
            <div className="ts-fld">
              <label htmlFor="qf-date">Time period</label>
              <select id="qf-date" className="ts-fi" value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}>
                <option value="all">All dates</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>
            </div>
            <div className="ts-fld">
              <label htmlFor="qf-min">Min amount (₹)</label>
              <input id="qf-min" className="ts-fi ts-r" type="number" placeholder="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </div>
            <div className="ts-fld">
              <label htmlFor="qf-max">Max amount (₹)</label>
              <input id="qf-max" className="ts-fi ts-r" type="number" placeholder="Any" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            </div>
            <div className="ts-fld" style={{ justifyContent: 'flex-end' }}>
              <span className="ts-muted" style={{ fontSize: 13, paddingBottom: 12 }}>{total} matching</span>
            </div>
            <div className="ts-fld" style={{ justifyContent: 'flex-end', alignItems: 'flex-end' }}>
              {hasSearchFilters && <button type="button" className="ts-btn ts-ghost ts-xs" onClick={clearSearchPanelFilters}><X /> Clear filters</button>}
            </div>
          </div>
        )}

        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                {isSelectionMode && (
                  <th style={{ width: 40 }}>
                    <input type="checkbox" className="ts-chk" checked={isAllRowsSelected} onChange={toggleSelectAll} aria-label="Select all loaded quotations" />
                  </th>
                )}
                <th>Number</th>
                <th>Company</th>
                <th>Date</th>
                <th className="ts-r">Value</th>
                <th>Status</th>
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`sk-${idx}`}>
                    {Array.from({ length: cols }).map((__, c) => (
                      <td key={c}><span className="ts-skel" style={{ display: 'block', height: 14, width: c === 1 ? 160 : 80 }} /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={cols} className="ts-empty">{hasAnyActiveFilters ? 'No quotations match these filters.' : 'No quotations yet. Create one with New quotation.'}</td></tr>
              ) : (
                rows.map((q, idx) => {
                  const isSelected = selectedIds.includes(q.id);
                  return (
                    <tr key={q.id} className={isSelectionMode && isSelected ? 'ts-picked' : ''} style={{ ['--r' as string]: Math.min(idx, 20) }}>
                      {isSelectionMode && (
                        <td><input type="checkbox" className="ts-chk" checked={isSelected} onChange={() => toggleSelectRow(q.id)} aria-label={`Select quotation ${q.number}`} /></td>
                      )}
                      <td><Link to={`/quotations/${q.id}`} className="ts-lnk" style={{ color: 'inherit', fontWeight: 500 }}>{q.number}</Link></td>
                      <td>{q.company_name || '—'}</td>
                      <td className="ts-muted">{fmtDay(q.date)}</td>
                      <td className="ts-r num">{money(q.total)}</td>
                      <td><span className={`ts-st ts-${q.status}`}>{String(q.status || '').replace(/_/g, ' ')}</span></td>
                      <td className="ts-r">
                        <div className="ts-racts">
                          <Link to={`/quotations/${q.id}`} className="ts-btn ts-ghost ts-xs">View</Link>
                          <button type="button" className="ts-iconx" onClick={() => handleDelete(q.id, q.number, q.status)} disabled={deletingId === q.id} aria-label={`Delete quotation ${q.number}`} title="Delete">
                            {deletingId === q.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-center pt-3 pb-1 gap-2.5">
          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
          {loadingMore && <div className="inline-flex items-center gap-2 text-[13px] text-subtle py-2"><Loader2 className="size-4 animate-spin" /> Loading more quotations…</div>}
          {loadMoreError && (
            <div className="ts-warnbox" style={{ margin: 0 }}><span>{loadMoreError}</span><button type="button" className="ts-btn" onClick={handleLoadMore}>Retry</button></div>
          )}
          {!initialLoading && hasMore && !loadingMore && !loadMoreError && (
            <button type="button" className="ts-btn ts-ghost ts-xs" onClick={handleLoadMore}>Load more ({rows.length} of {total})</button>
          )}
          {!initialLoading && !hasMore && rows.length > 0 && <span className="text-[12.5px] text-faint">Showing all {total} quotations</span>}
        </div>
      </section>
    </div>
  );
}
