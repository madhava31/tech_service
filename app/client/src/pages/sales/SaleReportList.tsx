import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  SaleReport,
  Warehouse,
} from '../../api';
import { Pagination } from '../../components/Pagination';
import {
  Search,
  Filter,
  Plus,
  RotateCcw,
  CheckCircle2,
  FileText,
  AlertCircle,
  XCircle,
  TrendingUp,
  Boxes,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import {
  DATE_RANGE_EVENT,
  getStoredDateRange,
  type DateRangePreset,
} from '../../lib/date-presets';

const PAGE_SIZE = 20;

function formatINR(val: number | undefined | null) {
  return '₹' + Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'CONFIRMED') {
    return (
      <span className="ts-st ts-tone-good">Confirmed
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span className="ts-st ts-tone-warn">Draft (Staged)
      </span>
    );
  }
  return (
    <span className="ts-st ts-tone-bad">Cancelled
    </span>
  );
}

export default function SaleReportList() {
  const navigate = useNavigate();

  const [reports, setReports] = useState<SaleReport[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState({
    totalReports: 0,
    draftCount: 0,
    confirmedCount: 0,
    cancelledCount: 0,
    todaySalesCount: 0,
    confirmedTotalValue: 0,
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & Filter state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [globalDateRange, setGlobalDateRange] = useState<DateRangePreset>(getStoredDateRange);
  const [page, setPage] = useState(1);

  // Quick confirm modal state
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // Calculate start & end date based on datePreset
  const dateRange = useMemo(() => {
    if (datePreset === 'all') {
      return { startDate: globalDateRange.start || '', endDate: globalDateRange.end || '' };
    }
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    if (datePreset === 'today') {
      const s = toStr(y, m, d);
      return { startDate: s, endDate: s };
    }
    if (datePreset === 'week') {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      return {
        startDate: toStr(y, m, d - diff),
        endDate: toStr(y, m, d - diff + 6),
      };
    }
    // Month
    const lastDay = new Date(y, m + 1, 0).getDate();
    return {
      startDate: toStr(y, m, 1),
      endDate: toStr(y, m, lastDay),
    };
  }, [datePreset, globalDateRange]);

  useEffect(() => {
    const handleGlobalDateRange = (event: Event) => {
      const customEvent = event as CustomEvent<DateRangePreset>;
      if (customEvent.detail) {
        setGlobalDateRange(customEvent.detail);
        setPage(1);
      }
    };
    window.addEventListener(DATE_RANGE_EVENT, handleGlobalDateRange);
    return () => window.removeEventListener(DATE_RANGE_EVENT, handleGlobalDateRange);
  }, []);

  // Load warehouses once
  useEffect(() => {
    api.inventory.listWarehouses().then(setWarehouses).catch(console.error);
  }, []);

  // Fetch sale reports
  const fetchReports = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.saleReports.list({
        warehouseId: warehouseFilter ? Number(warehouseFilter) : undefined,
        status: statusFilter || undefined,
        sourceType: sourceFilter || undefined,
        q: searchQuery.trim() || undefined,
        startDate: dateRange.startDate || undefined,
        endDate: dateRange.endDate || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });

      setReports(res.reports);
      setTotal(res.total);
      if (res.kpi) setKpi(res.kpi);
    } catch (err: any) {
      setError(err.message || 'Failed to load sale reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [page, statusFilter, warehouseFilter, sourceFilter, dateRange, searchQuery]);

  // Quick Confirm handler
  const handleQuickConfirm = async () => {
    if (!confirmingId) return;
    setConfirmSubmitting(true);
    setConfirmError('');
    try {
      await api.saleReports.confirm(confirmingId);
      setConfirmingId(null);
      fetchReports();
    } catch (err: any) {
      setConfirmError(err.message || 'Failed to confirm sale report');
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setWarehouseFilter('');
    setSourceFilter('');
    setDatePreset('all');
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(statusFilter) ||
    Boolean(warehouseFilter) ||
    Boolean(sourceFilter) ||
    datePreset !== 'all';

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="ts-title">Sale Reports</h1>
            <span className="ts-headtag">
              Stock OUT
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Controlled physical stock deduction and sales dispatch ledger
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/sale-reports/new"
            className="ts-btn ts-dark"
          >
            <Plus className="w-4 h-4" />
            <span>New Sale Report</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="ts-card flex flex-col justify-between">
          <span className="text-[13.5px] text-subtle">Total Reports</span>
          <span className="ts-val num text-fg">
            {kpi.totalReports}
          </span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-warn">Draft (Staged)</span>
            <span className="w-2 h-2 rounded-full bg-warn" />
          </div>
          <span className="ts-val num text-warn">
            {kpi.draftCount}
          </span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-good">Confirmed Sales</span>
            <span className="w-2 h-2 rounded-full bg-good" />
          </div>
          <span className="ts-val num text-good">
            {kpi.confirmedCount}
          </span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-bad">Cancelled</span>
            <span className="w-2 h-2 rounded-full bg-bad" />
          </div>
          <span className="ts-val num text-bad">
            {kpi.cancelledCount}
          </span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <span className="text-[13.5px] text-subtle">Today's Sales</span>
          <span className="ts-val num text-fg">
            {kpi.todaySalesCount}
          </span>
        </div>

        <div className="ts-card flex flex-col justify-between">
          <span className="text-[13.5px] text-fg">Confirmed Value</span>
          <span className="ts-val num truncate" title={formatINR(kpi.confirmedTotalValue)}>
            {formatINR(kpi.confirmedTotalValue)}
          </span>
        </div>
      </div>

      {/* Expandable Search & Filter Bar */}
      <div className="ts-card space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Expanding Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="text"
              placeholder="Search by Report #, Invoice #, Company, or Part Number..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="ts-fi !pl-10 !rounded-full !bg-tile !border-transparent"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              aria-expanded={isFilterOpen}
              aria-controls="sale-report-filters"
              className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
                isFilterOpen || hasActiveFilters
                  ? 'bg-tile border-fg text-fg shadow-card'
                  : 'bg-surface2 border-line2 text-subtle hover:text-fg hover:border-line2'
              }`}
            >
              <Filter className="w-4 h-4 text-fg" />
              <span>Filters</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-brandorange" />
              )}
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="ts-btn ts-ghost"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Drawer */}
        {isFilterOpen && (
          <div id="sale-report-filters" className="pt-4 border-t border-line2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div>
              <label className="ts-lbl">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft (Staged)</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="ts-lbl">Warehouse</label>
              <select
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ts-lbl">Source Type</label>
              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="">All Sources</option>
                <option value="INTERNAL_DOCUMENT">Internal (Quote/PO/PI)</option>
                <option value="DIRECT_EXTERNAL">Direct External PO/PI</option>
              </select>
            </div>

            <div>
              <label className="ts-lbl">Date Range</label>
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value as any);
                  setPage(1);
                }}
                className="ts-fi"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="ts-warnbox">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reports Table */}
      <div className="ts-card ts-white ts-tbl ts-tcard">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Report #</th>
                <th>Date</th>
                <th>Company</th>
                <th>Invoice #</th>
                <th>Source</th>
                <th>Warehouse</th>
                <th className="ts-r">Items / Qty</th>
                <th className="ts-r">Total Amount</th>
                <th>Status</th>
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-faint">
                    Loading Sale Reports...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center">
                      <Boxes className="w-10 h-10 text-faint mb-3" />
                      <p className="text-base font-semibold text-fg">No Sale Reports Found</p>
                      <p className="text-xs text-subtle mt-1 mb-4">
                        {hasActiveFilters
                          ? 'Try adjusting your search or filters to see more results.'
                          : 'Create your first Sale Report to perform controlled physical stock deduction.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        <Link
                          to="/sale-reports/new"
                          className="ts-btn ts-dark ts-xs"
                        >
                          Create Sale Report
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr
                    key={report.id}
                    className="hover:bg-surface transition-colors cursor-pointer"
                    onClick={() => navigate(`/sale-reports/${report.id}`)}
                  >
                    <td className="px-4 py-3.5 font-mono font-semibold text-fg whitespace-nowrap">
                      <Link
                        to={`/sale-reports/${report.id}`}
                        className="hover:text-fg transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {report.report_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      {formatDate(report.sale_date)}
                    </td>
                    <td className="px-4 py-3.5 font-medium text-fg">
                      {report.company_id ? (
                        <Link
                          to={`/companies/${report.company_id}/health`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-fg hover:underline transition-colors"
                        >
                          {report.company_name_snapshot}
                        </Link>
                      ) : (
                        <span>{report.company_name_snapshot}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-fg">
                      {report.invoice_number || '—'}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-surface2 border border-line2 text-fg">
                        {report.source_type === 'INTERNAL_DOCUMENT' ? 'Internal Document' : 'Direct External'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <span className="text-fg">{report.warehouse_name}</span>
                      <span className="text-[11px] text-faint ml-1.5 font-mono">({report.warehouse_code})</span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs whitespace-nowrap">
                      <span className="text-fg font-semibold">{report.total_quantity || 0}</span>
                      <span className="text-faint ml-1">({report.total_items || 0} items)</span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-fg whitespace-nowrap">
                      {formatINR(report.total_amount)}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-2">
                        {report.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => setConfirmingId(report.id)}
                            className="ts-btn ts-xs bg-goodbg text-good"
                            title="Confirm Sale Report & Deduct Physical Stock"
                          >
                            Confirm
                          </button>
                        )}
                        <Link
                          to={`/sale-reports/${report.id}`}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="pt-4 mt-2 border-t border-line flex flex-wrap gap-3 justify-between items-center">
            <span className="text-xs text-subtle">
              Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} reports
            </span>
            <Pagination
              page={page}
              totalPages={Math.ceil(total / PAGE_SIZE)}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Quick Confirm Modal */}
      {confirmingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full space-y-4">
            <div className="flex items-center gap-3 text-good">
              <div className="p-2 bg-goodbg border border-goodbg rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Confirm Sale Report</h3>
                <p className="text-xs text-subtle">Execute physical stock deduction</p>
              </div>
            </div>

            <p className="text-sm text-fg">
              Confirming this Sale Report will perform an <strong>atomic STOCK OUT</strong> in the selected warehouse.
              Physical on-hand inventory will be deducted, and movements will be added to the audit ledger.
            </p>

            {confirmError && (
              <div className="ts-warnbox">
                {confirmError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmingId(null);
                  setConfirmError('');
                }}
                disabled={confirmSubmitting}
                className="ts-btn ts-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuickConfirm}
                disabled={confirmSubmitting}
                className="ts-btn ts-dark"
              >
                {confirmSubmitting ? 'Confirming...' : 'Yes, Confirm & Deduct Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
