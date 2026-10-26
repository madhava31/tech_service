import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, Quotation, QuotationPageResponse } from '../api';
import { queryClient } from '../lib/queryClient';
import { ChevronDown, ChevronUp, Search, X, Filter, RotateCcw, Trash2, Loader2, RefreshCw } from 'lucide-react';

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
  draft: '#7A839E',
  sent: '#6B78D6',
  accepted: '#3B6FD4',
  rejected: '#E5484D',
  po_created: '#6B78D6',
  pi_created: '#6B78D6',
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

  return (
    <div className="p-4 md:p-6 flex flex-col gap-6 text-fg min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Quotations
          </h1>
          <p className="margin-0 text-[13.5px] text-subtle">
            Every quotation with its stage, value and follow-up position.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/quotations/new"
            className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-line2 text-fg font-medium text-[12.5px] flex items-center justify-center hover:bg-tile transition-colors no-underline"
          >
            + New quotation
          </Link>
          <a
            href={api.export.quotationsUrl(statusFilter ? { status: statusFilter } : undefined)}
            download
            className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-line2 text-good font-medium text-[12.5px] flex items-center justify-center hover:bg-surface transition-colors no-underline cursor-pointer"
          >
            Export Excel
          </a>
          {!isSelectionMode ? (
            <button
              type="button"
              onClick={() => setIsSelectionMode(true)}
              className="h-[34px] px-3.5 rounded-[9px] font-medium text-[12.5px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer border bg-transparent border-line2 text-bad hover:bg-badbg"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Select to Delete</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className={`h-[34px] px-3.5 rounded-[9px] font-medium text-[12.5px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  selectedIds.length > 0
                    ? 'bg-bad text-onink border-bad hover:bg-[#D93D42]'
                    : 'bg-transparent border-line2 text-bad hover:bg-badbg'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isBulkDeleting
                    ? 'Deleting...'
                    : selectedIds.length > 0
                    ? `Delete Selected (${selectedIds.length})`
                    : 'Delete Selected'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedIds([]);
                }}
                className="h-[34px] px-3 rounded-[9px] font-medium text-[12.5px] bg-surface border border-line2 text-subtle hover:bg-tile transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-[10px] border border-badbg bg-badbg text-bad text-[12.5px] flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchPage(1, true)}
            className="inline-flex items-center gap-1 font-semibold underline cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Main Table Container Card */}
      <section className="bg-surface2 border border-line2 rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4 shadow-card">
        
        {/* Stage Filter Chips & Expandable Search Toggle */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-line2 pb-3.5">
          {/* Status Stage Chips */}
          <div className="flex gap-2 flex-wrap items-center">
            {[
              { name: 'All', key: '' },
              { name: 'Draft', key: 'draft' },
              { name: 'Sent', key: 'sent' },
              { name: 'Accepted', key: 'accepted' },
              { name: 'Rejected', key: 'rejected' },
            ].map((chip) => {
              const active = statusFilter === chip.key;
              const count = stageCounts[chip.name] || 0;
              return (
                <button
                  key={chip.name}
                  type="button"
                  onClick={() => setStatusFilter(chip.key)}
                  className={`inline-flex items-center gap-2 h-[32px] px-3 rounded-[8px] text-[12px] cursor-pointer transition-colors border ${
                    active
                      ? 'bg-surface border-line2 text-fg font-semibold'
                      : 'bg-transparent border-line2 text-subtle hover:border-line2'
                  }`}
                >
                  <span>{chip.name}</span>
                  <span className="text-faint text-[11px]">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Search Trigger Button & Summary Stats */}
          <div className="flex items-center gap-2.5 self-start md:self-auto flex-wrap">
            <button
              type="button"
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              aria-expanded={isSearchOpen}
              aria-controls="quotation-search-panel"
              aria-label={isSearchOpen ? 'Hide search options' : 'Show search options'}
              className={`inline-flex items-center gap-2 h-[32px] px-3.5 rounded-[8px] text-[12px] font-semibold cursor-pointer transition-all border ${
                isSearchOpen || hasSearchFilters
                  ? 'bg-surface border-fg text-fg shadow-xs'
                  : 'bg-surface border-line2 text-fg hover:border-line2'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-fg" />
              <span>Search & Filter</span>
              {hasSearchFilters && (
                <span className="w-2 h-2 rounded-full bg-ink animate-pulse" />
              )}
              {isSearchOpen ? (
                <ChevronUp className="w-3.5 h-3.5 ml-0.5 text-fg" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 ml-0.5 text-subtle" />
              )}
            </button>

            {hasAnyActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 h-[32px] px-3 rounded-[8px] bg-surface border border-line2 text-subtle text-[12px] hover:text-fg hover:border-line2 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset All</span>
              </button>
            )}

            <span className="text-[11.5px] text-faint ml-1">
              Showing {rows.length} of {total}
            </span>
          </div>
        </div>

        {/* EXPANDED POP-DOWN SEARCH PANEL */}
        {isSearchOpen && (
          <div
            id="quotation-search-panel"
            className="bg-surface border border-line2 rounded-[12px] p-4 transition-all duration-200 animate-in fade-in slide-in-from-top-2 shadow-lift"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-line2">
              <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                <Filter className="w-3.5 h-3.5 text-fg" />
                <span>Advanced Quotation Search</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                className="text-faint hover:text-fg p-1 rounded-md transition-colors"
                aria-label="Close search panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* 1. Search Quotation Number */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                  Quotation No.
                </label>
                <input
                  type="text"
                  placeholder="e.g. TSQOT2627/1"
                  value={searchNumber}
                  onChange={(e) => setSearchNumber(e.target.value)}
                  className="w-full h-[34px] px-3 rounded-[8px] bg-surface2 border border-line2 text-fg text-[12.5px] outline-none focus:border-fg placeholder-faint transition-colors"
                />
              </div>

              {/* 2. Search Customer Company */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                  Customer / Company
                </label>
                <input
                  type="text"
                  placeholder="e.g. Basil"
                  value={searchCompany}
                  onChange={(e) => setSearchCompany(e.target.value)}
                  className="w-full h-[34px] px-3 rounded-[8px] bg-surface2 border border-line2 text-fg text-[12.5px] outline-none focus:border-fg placeholder-faint transition-colors"
                />
              </div>

              {/* 3. Date Range */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                  Time Period
                </label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                  className="w-full h-[34px] px-3 rounded-[8px] bg-surface2 border border-line2 text-fg text-[12.5px] outline-none focus:border-fg cursor-pointer transition-colors"
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                </select>
              </div>

              {/* 4. Min Amount */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                  Min Amount (₹)
                </label>
                <input
                  type="number"
                  placeholder="Min ₹"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full h-[34px] px-3 rounded-[8px] bg-surface2 border border-line2 text-fg text-[12.5px] outline-none focus:border-fg placeholder-faint tabular-nums transition-colors"
                />
              </div>

              {/* 5. Max Amount */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                  Max Amount (₹)
                </label>
                <input
                  type="number"
                  placeholder="Max ₹"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-full h-[34px] px-3 rounded-[8px] bg-surface2 border border-line2 text-fg text-[12.5px] outline-none focus:border-fg placeholder-faint tabular-nums transition-colors"
                />
              </div>
            </div>

            {/* Panel Footer / Clear Action */}
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-line2">
              <span className="text-[11.5px] text-subtle">
                {total} matching quotations
              </span>
              {hasSearchFilters && (
                <button
                  type="button"
                  onClick={clearSearchPanelFilters}
                  className="px-3 py-1 bg-surface hover:bg-tile text-bad border border-bad/30 text-xs font-semibold rounded-lg transition-colors inline-flex items-center space-x-1"
                >
                  <X className="w-3 h-3" />
                  <span>Clear Search Filters</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quotations Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line2">
                {isSelectionMode && (
                  <th className="w-10 text-center p-[8px_10px]">
                    <input
                      type="checkbox"
                      checked={isAllRowsSelected}
                      onChange={toggleSelectAll}
                      title="Select all currently loaded quotations"
                      className="w-4 h-4 accent-fg rounded cursor-pointer align-middle"
                    />
                  </th>
                )}
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  QUOTATION
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  CUSTOMER
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  DATE
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  AMOUNT
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  STAGE
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-faint uppercase">
                  ACTION
                </th>
              </tr>
            </thead>
            <tbody>
              {/* SKELETON LOADING ROWS (Initial Viewport) */}
              {initialLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`skeleton-${idx}`} className="border-b border-line animate-pulse">
                    {isSelectionMode && (
                      <td className="p-[11px_10px] w-10 text-center">
                        <div className="w-4 h-4 bg-tile rounded mx-auto" />
                      </td>
                    )}
                    <td className="p-[11px_10px]">
                      <div className="h-4 w-28 bg-tile rounded" />
                    </td>
                    <td className="p-[11px_10px]">
                      <div className="h-4 w-40 bg-tile rounded" />
                    </td>
                    <td className="p-[11px_10px]">
                      <div className="h-4 w-20 bg-tile rounded" />
                    </td>
                    <td className="p-[11px_10px] text-right">
                      <div className="h-4 w-24 bg-tile rounded ml-auto" />
                    </td>
                    <td className="p-[11px_10px]">
                      <div className="h-4 w-16 bg-tile rounded" />
                    </td>
                    <td className="p-[11px_10px] text-right">
                      <div className="h-4 w-12 bg-tile rounded ml-auto" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={isSelectionMode ? 7 : 6} className="text-center py-10 text-subtle text-[13px]">
                    No quotations found matching your search criteria.
                  </td>
                </tr>
              ) : (
                rows.map((q) => {
                  const color = STAGE_COLORS[q.status] || '#7A839E';
                  const isSelected = selectedIds.includes(q.id);
                  return (
                    <tr
                      key={q.id}
                      className={`border-b border-line hover:bg-surface transition-colors ${
                        isSelectionMode && isSelected ? 'bg-[#F0F4FD]' : ''
                      }`}
                    >
                      {isSelectionMode && (
                        <td className="p-[11px_10px] w-10 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(q.id)}
                            title={`Select quotation ${q.number}`}
                            className="w-4 h-4 accent-fg rounded cursor-pointer align-middle"
                          />
                        </td>
                      )}
                      <td className="p-[11px_10px]">
                        <Link
                          to={`/quotations/${q.id}`}
                          className="text-fg hover:underline font-medium"
                        >
                          {q.number}
                        </Link>
                      </td>
                      <td className="p-[11px_10px] text-fg">{q.company_name || '—'}</td>
                      <td className="p-[11px_10px] text-subtle">{q.date}</td>
                      <td className="p-[11px_10px] text-right font-medium text-fg">
                        ₹{Number(q.total || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="p-[11px_10px]">
                        <span className="inline-flex items-center gap-1.5 capitalize" style={{ color }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          {q.status}
                        </span>
                      </td>
                      <td className="p-[11px_10px] text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <Link
                            to={`/quotations/${q.id}`}
                            className="text-[12px] font-semibold text-fg hover:underline"
                          >
                            View →
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(q.id, q.number, q.status)}
                            disabled={deletingId === q.id}
                            className="p-1.5 rounded-lg text-bad hover:bg-badbg transition-colors cursor-pointer"
                            title={`Delete Quotation ${q.number}`}
                          >
                            <Trash2 className="size-3.5" />
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

        {/* PROGRESSIVE LOADING SENTINEL & FOOTER */}
        <div className="flex flex-col items-center justify-center pt-3 pb-1 gap-2.5">
          {/* Intersection Observer Sentinel */}
          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

          {loadingMore && (
            <div className="inline-flex items-center gap-2 text-xs text-fg py-2">
              <Loader2 className="w-4 h-4 animate-spin text-fg" />
              <span>Loading additional quotations...</span>
            </div>
          )}

          {loadMoreError && (
            <div className="inline-flex items-center gap-2 text-xs text-bad bg-badbg px-3 py-1.5 rounded-lg border border-[#F2C4C6]">
              <span>{loadMoreError}</span>
              <button
                type="button"
                onClick={handleLoadMore}
                className="underline font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {!initialLoading && hasMore && !loadingMore && !loadMoreError && (
            <button
              type="button"
              onClick={handleLoadMore}
              className="h-[32px] px-4 rounded-[8px] bg-surface hover:bg-tile text-fg border border-line2 text-xs font-semibold cursor-pointer transition-colors"
            >
              Load More ({rows.length} of {total})
            </button>
          )}

          {!initialLoading && !hasMore && rows.length > 0 && (
            <span className="text-[11.5px] text-faint">
              Showing all {total} quotations
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
