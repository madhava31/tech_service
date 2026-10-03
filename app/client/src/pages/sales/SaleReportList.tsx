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
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#E0F5EA] text-[#2FBF71] border border-[#D6F2E4] rounded-md text-[11.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2FBF71]" />
        Confirmed
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#F7EFE0] text-[#E8A33D] border border-[#F4E9D6] rounded-md text-[11.5px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-[#E8A33D]" />
        Draft (Staged)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#F7E0E0] text-[#E5484D] border border-[#F4D4D5] rounded-md text-[11.5px] font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-[#E5484D]" />
      Cancelled
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
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[#141B34]">Sale Reports</h1>
            <span className="px-2.5 py-0.5 bg-[#FFFFFF] text-[#7A839E] border border-[#E4E8F2] rounded-full text-xs font-mono">
              Stock OUT
            </span>
          </div>
          <p className="text-sm text-[#7A839E] mt-1">
            Controlled physical stock deduction and sales dispatch ledger
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/sale-reports/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] font-semibold text-sm rounded-lg hover:bg-[#2F5CB8] transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Sale Report</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs text-[#8992AB] font-medium">Total Reports</span>
          <span className="text-2xl font-bold text-[#141B34] mt-2 font-mono">
            {kpi.totalReports}
          </span>
        </div>

        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#E8A33D] font-medium">Draft (Staged)</span>
            <span className="w-2 h-2 rounded-full bg-[#E8A33D]" />
          </div>
          <span className="text-2xl font-bold text-[#E8A33D] mt-2 font-mono">
            {kpi.draftCount}
          </span>
        </div>

        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#2FBF71] font-medium">Confirmed Sales</span>
            <span className="w-2 h-2 rounded-full bg-[#2FBF71]" />
          </div>
          <span className="text-2xl font-bold text-[#2FBF71] mt-2 font-mono">
            {kpi.confirmedCount}
          </span>
        </div>

        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#E5484D] font-medium">Cancelled</span>
            <span className="w-2 h-2 rounded-full bg-[#E5484D]" />
          </div>
          <span className="text-2xl font-bold text-[#E5484D] mt-2 font-mono">
            {kpi.cancelledCount}
          </span>
        </div>

        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs text-[#7A839E] font-medium">Today's Sales</span>
          <span className="text-2xl font-bold text-[#141B34] mt-2 font-mono">
            {kpi.todaySalesCount}
          </span>
        </div>

        <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-4 flex flex-col justify-between">
          <span className="text-xs text-[#3B6FD4] font-medium">Confirmed Value</span>
          <span className="text-lg sm:text-xl font-bold text-[#3B6FD4] mt-2 font-mono truncate" title={formatINR(kpi.confirmedTotalValue)}>
            {formatINR(kpi.confirmedTotalValue)}
          </span>
        </div>
      </div>

      {/* Expandable Search & Filter Bar */}
      <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Expanding Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8AEC4]" />
            <input
              type="text"
              placeholder="Search by Report #, Invoice #, Company, or Part Number..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#141B34] placeholder-[#A8AEC4] focus:outline-none focus:border-[#3B6FD4] transition-colors"
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
                  ? 'bg-[#EAF1FF] border-[#2F6FED] text-[#14213D] shadow-[0_2px_8px_rgba(47,111,237,0.12)]'
                  : 'bg-white border-[#DFE6F2] text-[#71809B] hover:text-[#14213D] hover:border-[#B9CCEE]'
              }`}
            >
              <Filter className="w-4 h-4 text-[#3B6FD4]" />
              <span>Filters</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-[#3B6FD4]" />
              )}
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#7A839E] hover:text-[#141B34] hover:border-[#D4DAEA] transition-colors"
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
          <div id="sale-report-filters" className="pt-4 border-t border-[#DFE6F2] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft (Staged)</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">Warehouse</label>
              <select
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
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
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">Source Type</label>
              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
              >
                <option value="">All Sources</option>
                <option value="INTERNAL_DOCUMENT">Internal (Quote/PO/PI)</option>
                <option value="DIRECT_EXTERNAL">Direct External PO/PI</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8992AB] mb-1.5">Date Range</label>
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value as any);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-[#EDF0F8] border border-[#EEF1F9] rounded-lg text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
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
        <div className="p-4 bg-[#F7E0E0] border border-[#F4D4D5] rounded-xl flex items-center gap-3 text-sm text-[#E5484D]">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reports Table */}
      <div className="bg-[#F7F8FC] border border-[#EEF1F9] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#7A839E]">
            <thead className="bg-[#EDF0F8] border-b border-[#EEF1F9] text-xs text-[#8992AB] uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3.5">Report #</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Company</th>
                <th className="px-4 py-3.5">Invoice #</th>
                <th className="px-4 py-3.5">Source</th>
                <th className="px-4 py-3.5">Warehouse</th>
                <th className="px-4 py-3.5 text-right">Items / Qty</th>
                <th className="px-4 py-3.5 text-right">Total Amount</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F7F8FC]">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[#A8AEC4]">
                    Loading Sale Reports...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center">
                      <Boxes className="w-10 h-10 text-[#CBD3E6] mb-3" />
                      <p className="text-base font-semibold text-[#141B34]">No Sale Reports Found</p>
                      <p className="text-xs text-[#8992AB] mt-1 mb-4">
                        {hasActiveFilters
                          ? 'Try adjusting your search or filters to see more results.'
                          : 'Create your first Sale Report to perform controlled physical stock deduction.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="px-3.5 py-1.5 bg-[#F7F8FC] border border-[#DCE2F0] rounded-lg text-xs text-[#141B34] hover:bg-[#EEF1F9]"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        <Link
                          to="/sale-reports/new"
                          className="px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] font-semibold text-xs rounded-lg hover:bg-[#2F5CB8]"
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
                    className="hover:bg-[#F7F8FC] transition-colors cursor-pointer"
                    onClick={() => navigate(`/sale-reports/${report.id}`)}
                  >
                    <td className="px-4 py-3.5 font-mono font-semibold text-[#141B34] whitespace-nowrap">
                      <Link
                        to={`/sale-reports/${report.id}`}
                        className="hover:text-[#3B6FD4] transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {report.report_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      {formatDate(report.sale_date)}
                    </td>
                    <td className="px-4 py-3.5 font-medium text-[#141B34]">
                      {report.company_id ? (
                        <Link
                          to={`/companies/${report.company_id}/health`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-[#3B6FD4] hover:underline transition-colors"
                        >
                          {report.company_name_snapshot}
                        </Link>
                      ) : (
                        <span>{report.company_name_snapshot}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap text-[#2C3454]">
                      {report.invoice_number || '—'}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E4E8F2] text-[#2C3454]">
                        {report.source_type === 'INTERNAL_DOCUMENT' ? 'Internal Document' : 'Direct External'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <span className="text-[#141B34]">{report.warehouse_name}</span>
                      <span className="text-[11px] text-[#A8AEC4] ml-1.5 font-mono">({report.warehouse_code})</span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs whitespace-nowrap">
                      <span className="text-[#141B34] font-semibold">{report.total_quantity || 0}</span>
                      <span className="text-[#A8AEC4] ml-1">({report.total_items || 0} items)</span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-[#141B34] whitespace-nowrap">
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
                            className="px-2.5 py-1 bg-[#DFF5EA] hover:bg-[#DAF3E7] text-[#2FBF71] border border-[#D7F2E5] rounded text-xs font-medium transition-colors"
                            title="Confirm Sale Report & Deduct Physical Stock"
                          >
                            Confirm
                          </button>
                        )}
                        <Link
                          to={`/sale-reports/${report.id}`}
                          className="px-2.5 py-1 bg-[#F7F8FC] hover:bg-[#EEF1F9] text-[#2C3454] border border-[#DCE2F0] rounded text-xs font-medium transition-colors"
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
          <div className="p-4 border-t border-[#EEF1F9] flex justify-between items-center bg-[#EDF0F8]">
            <span className="text-xs text-[#8992AB]">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141B34]/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#F7F8FC] border border-[#E4E8F2] rounded-xl max-w-md w-full p-6 shadow-lift space-y-4">
            <div className="flex items-center gap-3 text-[#2FBF71]">
              <div className="p-2 bg-[#E0F5EA] border border-[#D6F2E4] rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#141B34]">Confirm Sale Report</h3>
                <p className="text-xs text-[#8992AB]">Execute physical stock deduction</p>
              </div>
            </div>

            <p className="text-sm text-[#2C3454]">
              Confirming this Sale Report will perform an <strong>atomic STOCK OUT</strong> in the selected warehouse.
              Physical on-hand inventory will be deducted, and movements will be added to the audit ledger.
            </p>

            {confirmError && (
              <div className="p-3 bg-[#F7E0E0] border border-[#F4D4D5] rounded-lg text-xs text-[#E5484D]">
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
                className="px-4 py-2 bg-[#F7F8FC] border border-[#DCE2F0] text-[#2C3454] hover:text-[#141B34] rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuickConfirm}
                disabled={confirmSubmitting}
                className="px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] hover:bg-[#2F5CB8] rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
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
