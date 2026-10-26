import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchSalesPipeline,
  fetchManagementAttention,
  createFollowUpApi,
  type SalesPipelineRecord,
  type SalesPipelineSummary,
  type ManagementAttentionAlert,
  type DerivedPipelineStage,
  type FollowUpPriority,
  type FollowUpStatus,
} from '../../api';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/state-views';

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

function formatDate(d: string | null) {
  if (!d) return 'None';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PIPELINE_STAGES: { key: DerivedPipelineStage; label: string; color: string }[] = [
  { key: 'QUOTATION_DRAFT', label: 'Quotation Draft', color: '#7A839E' },
  { key: 'AWAITING_CUSTOMER', label: 'Awaiting Customer', color: '#E8A33D' },
  { key: 'PO_CREATED', label: 'PO Created', color: '#6B78D6' },
  { key: 'PI_CREATED', label: 'PI Created', color: '#9333EA' },
  { key: 'READY_TO_DISPATCH', label: 'Ready to Dispatch', color: '#2563EB' },
  { key: 'PARTIALLY_DISPATCHED', label: 'Partially Dispatched', color: '#E07B39' },
  { key: 'COMPLETED', label: 'Completed', color: '#3B6FD4' },
];

export default function SalesPipeline() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<SalesPipelineRecord[]>([]);
  const [summary, setSummary] = useState<SalesPipelineSummary | null>(null);
  const [alerts, setAlerts] = useState<ManagementAttentionAlert[]>([]);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [alertsOpen, setAlertsOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [selectedEngineer, setSelectedEngineer] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedFirm, setSelectedFirm] = useState('');
  const [selectedStockStatus, setSelectedStockStatus] = useState('');
  const [selectedDateRange, setSelectedDateRange] = useState('');
  const [onlyHighValue, setOnlyHighValue] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);

  // Modal State for Follow-up
  const [followUpModal, setFollowUpModal] = useState<{
    open: boolean;
    mode: 'create' | 'reschedule' | 'complete';
    quotationId?: number;
    quotationNumber?: string;
    companyId?: number;
    engineerId?: number;
    branchId?: number;
    firmId?: number;
    followUpId?: number;
  }>({ open: false, mode: 'create' });

  const [modalDate, setModalDate] = useState(new Date().toISOString().split('T')[0]);
  const [modalTime, setModalTime] = useState('11:00');
  const [modalPriority, setModalPriority] = useState<FollowUpPriority>('NORMAL');
  const [modalStatus, setModalStatus] = useState<FollowUpStatus>('PENDING');
  const [modalNotes, setModalNotes] = useState('');
  const [submittingModal, setSubmittingModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        q: search,
        stage: selectedStage,
        engineerId: selectedEngineer,
        branchId: selectedBranch,
        firmId: selectedFirm,
        stockStatus: selectedStockStatus,
        dateRange: selectedDateRange,
        limit: 1000,
      };

      if (onlyHighValue) params.isHighValue = 'true';
      if (onlyStale) params.isStale = 'true';

      const [pRes, aRes] = await Promise.all([
        fetchSalesPipeline(params),
        fetchManagementAttention(),
      ]);

      setRecords(pRes.records);
      setSummary(pRes.summary);
      setAlerts(aRes.alerts);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load sales pipeline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [
    search,
    selectedStage,
    selectedEngineer,
    selectedBranch,
    selectedFirm,
    selectedStockStatus,
    selectedDateRange,
    onlyHighValue,
    onlyStale,
  ]);

  const resetFilters = () => {
    setSearch('');
    setSelectedStage('');
    setSelectedEngineer('');
    setSelectedBranch('');
    setSelectedFirm('');
    setSelectedStockStatus('');
    setSelectedDateRange('');
    setOnlyHighValue(false);
    setOnlyStale(false);
  };

  const hasActiveFilters = Boolean(
    search ||
      selectedStage ||
      selectedEngineer ||
      selectedBranch ||
      selectedFirm ||
      selectedStockStatus ||
      selectedDateRange ||
      onlyHighValue ||
      onlyStale
  );

  const handleExportExcel = () => {
    const params = new URLSearchParams({
      q: search,
      stage: selectedStage,
      engineerId: selectedEngineer,
      branchId: selectedBranch,
      firmId: selectedFirm,
      stockStatus: selectedStockStatus,
      dateRange: selectedDateRange,
    });
    if (onlyHighValue) params.append('isHighValue', 'true');
    if (onlyStale) params.append('isStale', 'true');
    window.location.href = `/api/sales/pipeline/export?${params.toString()}`;
  };

  const openCreateFollowUp = (rec: SalesPipelineRecord) => {
    setFollowUpModal({
      open: true,
      mode: 'create',
      quotationId: rec.quotation_id,
      quotationNumber: rec.quotation_number,
      companyId: rec.company_id,
      engineerId: rec.sales_engineer_id || undefined,
      branchId: rec.branch_id || undefined,
      firmId: rec.firm_id || undefined,
    });
    setModalDate(new Date().toISOString().split('T')[0]);
    setModalTime('11:00');
    setModalPriority('NORMAL');
    setModalStatus('PENDING');
    setModalNotes('');
  };

  const submitFollowUpModal = async () => {
    setSubmittingModal(true);
    try {
      if (followUpModal.mode === 'create') {
        await createFollowUpApi({
          quotationId: followUpModal.quotationId,
          companyId: followUpModal.companyId,
          salesEngineerId: followUpModal.engineerId,
          branchId: followUpModal.branchId,
          firmId: followUpModal.firmId,
          followUpDate: modalDate,
          followUpTime: modalTime,
          priority: modalPriority,
          status: modalStatus,
          notes: modalNotes,
        });
      }
      setFollowUpModal({ open: false, mode: 'create' });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to submit follow-up action');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Group records by stage for Kanban
  const kanbanColumns = useMemo(() => {
    const cols: Record<DerivedPipelineStage, SalesPipelineRecord[]> = {
      QUOTATION_DRAFT: [],
      AWAITING_CUSTOMER: [],
      PO_CREATED: [],
      PI_CREATED: [],
      READY_TO_DISPATCH: [],
      PARTIALLY_DISPATCHED: [],
      COMPLETED: [],
    };
    records.forEach((r) => {
      if (cols[r.pipeline_stage]) {
        cols[r.pipeline_stage].push(r);
      }
    });
    return cols;
  }, [records]);

  if (loading && !summary) {
    return <LoadingState message="Loading Sales Pipeline Control Center..." />;
  }

  return (
    <div className="sales-pipeline-container p-4 space-y-4 max-w-[1700px] mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface2 border border-line2 p-4 rounded-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="ts-title">Sales Pipeline</h1>
            <span className="bg-surface text-fg text-xs font-semibold px-2.5 py-0.5 rounded-full border border-line2">
              Live Control
            </span>
          </div>
          <p className="text-xs text-subtle mt-1">
            Real-time opportunity & follow-up control center anchored on backend-authoritative stage tracking.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            className="btn small secondary bg-surface text-fg border-line2 hover:bg-tile transition-colors"
            title="Refresh Data"
          >
            🔄 Refresh
          </button>

          <div className="inline-flex p-0.5 bg-surface border border-line2 rounded-lg">
            <button
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-surface text-fg font-semibold border border-line2'
                  : 'text-subtle hover:text-fg'
              }`}
              onClick={() => setViewMode('kanban')}
            >
              📊 Kanban
            </button>
            <button
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'table'
                  ? 'bg-surface text-fg font-semibold border border-line2'
                  : 'text-subtle hover:text-fg'
              }`}
              onClick={() => setViewMode('table')}
            >
              📋 Table
            </button>
          </div>

          <button
            className="btn small bg-ink hover:bg-ink/85 text-onink font-semibold transition-colors px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs"
            onClick={handleExportExcel}
          >
            📥 Export Excel
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* KPI Summary Block */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Open Pipeline</div>
            <div className="text-lg font-bold text-fg mt-1">{formatCurrency(summary.open_pipeline_value)}</div>
            <div className="text-[11px] text-faint mt-0.5">{summary.open_quotations_count} Active Quotes</div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Awaiting Customer</div>
            <div className="text-lg font-bold text-warn mt-1">
              {summary.stage_counts.AWAITING_CUSTOMER || 0}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              {formatCurrency(summary.stage_values.AWAITING_CUSTOMER || 0)}
            </div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">PO Created</div>
            <div className="text-lg font-bold text-fg mt-1">{summary.stage_counts.PO_CREATED || 0}</div>
            <div className="text-[11px] text-faint mt-0.5">{formatCurrency(summary.stage_values.PO_CREATED || 0)}</div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">PI Created</div>
            <div className="text-lg font-bold text-[#9333EA] mt-1">{summary.stage_counts.PI_CREATED || 0}</div>
            <div className="text-[11px] text-faint mt-0.5">{formatCurrency(summary.stage_values.PI_CREATED || 0)}</div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Ready Dispatch</div>
            <div className="text-lg font-bold text-fg mt-1">
              {summary.stage_counts.READY_TO_DISPATCH || 0}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              {formatCurrency(summary.stage_values.READY_TO_DISPATCH || 0)}
            </div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Follow-Ups Due</div>
            <div className="text-lg font-bold text-fg mt-1">{summary.due_today_followups_count}</div>
            <div className="text-[11px] text-faint mt-0.5">Due Today</div>
          </div>

          <div
            className={`bg-surface2 border p-3 rounded-xl transition-colors ${
              summary.overdue_followups_count > 0
                ? 'border-bad/40 bg-bad/5'
                : 'border-line2'
            }`}
          >
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Overdue</div>
            <div className="text-lg font-bold text-bad mt-1">{summary.overdue_followups_count}</div>
            <div className="text-[11px] text-faint mt-0.5">Requires Action</div>
          </div>

          <div className="bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 transition-colors">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-subtle">Stale / Stock Risk</div>
            <div className="text-lg font-bold text-warn mt-1">
              {summary.stale_quotations_count} / {summary.stock_risk_count}
            </div>
            <div className="text-[11px] text-faint mt-0.5">High Value: {summary.high_value_count}</div>
          </div>
        </div>
      )}

      {/* Collapsible Management Attention Panel */}
      {alerts.length > 0 && (
        <div className="bg-surface2 border border-warn/40 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setAlertsOpen((prev) => !prev)}
            className="w-full px-4 py-2.5 bg-surface/80 flex items-center justify-between text-xs font-semibold text-warn hover:bg-surface transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <span>⚠️ Management Attention Controls</span>
              <span className="bg-warn/20 text-warn px-2 py-0.5 rounded-full text-[11px] border border-warn/30">
                {alerts.length} Actionable Alerts
              </span>
            </div>
            <span className="text-xs font-bold text-subtle">{alertsOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>

          {alertsOpen && (
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 border-t border-line2">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="bg-surface border border-line2 p-2.5 rounded-lg text-xs flex flex-col justify-between hover:border-line2 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between font-semibold text-fg mb-1">
                      <span>{a.title}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          a.severity === 'HIGH' || a.severity === 'URGENT'
                            ? 'bg-bad/20 text-bad border border-bad/30'
                            : 'bg-warn/20 text-warn border border-warn/30'
                        }`}
                      >
                        {a.severity}
                      </span>
                    </div>
                    <p className="text-subtle text-[11px] leading-relaxed">{a.message}</p>
                  </div>
                  {a.quotation_id && (
                    <div className="mt-2 pt-1.5 border-t border-line2 flex justify-end">
                      <Link
                        to={`/quotations/${a.quotation_id}`}
                        className="text-fg text-[11px] font-semibold hover:underline flex items-center gap-1"
                      >
                        Inspect Quotation →
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Responsive Filter Bar */}
      <div className="bg-surface2 border border-line2 p-3.5 rounded-xl space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div>
            <label className="block text-subtle font-medium mb-1">Search Keywords</label>
            <input
              type="text"
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg focus:border-fg outline-none text-xs"
              placeholder="Search quotation, customer, engineer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Pipeline Stage</label>
            <select
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg focus:border-fg outline-none text-xs"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
            >
              <option value="">All Pipeline Stages</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Stock Risk Status</label>
            <select
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg focus:border-fg outline-none text-xs"
              value={selectedStockStatus}
              onChange={(e) => setSelectedStockStatus(e.target.value)}
            >
              <option value="">All Stock States</option>
              <option value="FULLY_AVAILABLE">Fully Available</option>
              <option value="PARTIAL_STOCK">Partial Stock</option>
              <option value="NO_STOCK">No Stock</option>
              <option value="INCOMING_STOCK">Incoming Stock</option>
            </select>
          </div>

          <div>
            <label className="block text-subtle font-medium mb-1">Date Range</label>
            <select
              className="w-full bg-surface border border-line2 text-fg px-3 py-1.5 rounded-lg focus:border-fg outline-none text-xs"
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value)}
            >
              <option value="">All Transaction Dates</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="fy">This Financial Year</option>
            </select>
          </div>

          <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-2 pt-2 sm:pt-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-fg select-none text-xs font-medium">
              <input
                type="checkbox"
                className="accent-fg rounded w-3.5 h-3.5"
                checked={onlyHighValue}
                onChange={(e) => setOnlyHighValue(e.target.checked)}
              />
              High Value Only (≥ ₹5L)
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-fg select-none text-xs font-medium">
              <input
                type="checkbox"
                className="accent-fg rounded w-3.5 h-3.5"
                checked={onlyStale}
                onChange={(e) => setOnlyStale(e.target.checked)}
              />
              Stale Only (&gt; 30d)
            </label>
          </div>
        </div>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 pt-2 border-t border-line2 flex-wrap text-xs">
            <span className="text-subtle font-semibold text-[11px] uppercase tracking-wider">Active Filters:</span>
            {search && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-surface text-fg border border-line2">
                Search: "{search}"
                <button onClick={() => setSearch('')} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            {selectedStage && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-surface text-fg border border-line2">
                Stage: {PIPELINE_STAGES.find((s) => s.key === selectedStage)?.label || selectedStage}
                <button onClick={() => setSelectedStage('')} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            {selectedStockStatus && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-surface text-warn border border-line2">
                Stock: {selectedStockStatus.replace('_', ' ')}
                <button onClick={() => setSelectedStockStatus('')} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            {selectedDateRange && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-surface text-fg border border-line2">
                Date: {selectedDateRange}
                <button onClick={() => setSelectedDateRange('')} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            {onlyHighValue && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-ink/10 text-fg border border-fg/30 font-semibold">
                High Value Only
                <button onClick={() => setOnlyHighValue(false)} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            {onlyStale && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bad/10 text-bad border border-bad/30 font-semibold">
                Stale Only
                <button onClick={() => setOnlyStale(false)} className="hover:text-bad ml-1 font-bold">×</button>
              </span>
            )}
            <button
              onClick={resetFilters}
              className="text-xs text-bad hover:underline font-semibold ml-auto"
            >
              Clear All Filters
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area: Kanban Board vs Table View */}
      {viewMode === 'kanban' ? (
        records.length === 0 ? (
          <EmptyState
            title="No pipeline opportunities found"
            message="There are currently no sales opportunities matching your applied filter criteria."
            onAction={resetFilters}
          />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-6 items-start w-full min-h-[650px] scrollbar-thin">
            {PIPELINE_STAGES.map((stage) => {
              const cols = kanbanColumns[stage.key] || [];
              const colValue = cols.reduce((sum, r) => sum + r.net_subtotal, 0);

              return (
                <div
                  key={stage.key}
                  className="w-[320px] min-w-[320px] shrink-0 bg-surface border border-line2 rounded-xl p-3 flex flex-col max-h-[calc(100vh-220px)]"
                >
                  {/* Sticky Stage Header */}
                  <div className="sticky top-0 bg-surface z-10 pb-2.5 mb-2.5 border-b border-line2 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }}></div>
                      <span className="font-bold text-xs text-fg">{stage.label}</span>
                      <span className="text-[11px] bg-surface text-subtle px-2 py-0.5 rounded-full font-semibold border border-line2">
                        {cols.length}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-fg font-mono">{formatCurrency(colValue)}</div>
                  </div>

                  {/* Stage Opportunities Cards List */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
                    {cols.length === 0 ? (
                      <div className="text-xs text-faint text-center py-10 italic bg-surface2/30 rounded-lg border border-dashed border-line2">
                        No opportunities
                      </div>
                    ) : (
                      cols.map((rec) => (
                        <div
                          key={rec.quotation_id}
                          className="card bg-surface2 border border-line2 p-3 rounded-xl hover:border-line2 hover:bg-surface transition-all shadow-sm group"
                        >
                          {/* Header: QTN Number & Net Subtotal */}
                          <div className="flex justify-between items-start gap-2 mb-1.5">
                            <Link
                              to={`/quotations/${rec.quotation_id}`}
                              className="font-mono text-xs font-bold text-fg hover:underline"
                            >
                              {rec.quotation_number}
                            </Link>
                            <span className="font-bold text-xs text-fg font-mono">
                              {formatCurrency(rec.net_subtotal)}
                            </span>
                          </div>

                          {/* Customer Name */}
                          <div className="text-xs font-bold text-fg truncate mb-1.5" title={rec.customer_name}>
                            {rec.customer_name}
                          </div>

                          {/* Engineer & Branch */}
                          <div className="text-[11px] text-subtle flex justify-between mb-2 pb-1.5 border-b border-line2">
                            <span>👤 {rec.engineer_name}</span>
                            <span>🏢 {rec.branch_name}</span>
                          </div>

                          {/* Status & Metadata Badges */}
                          <div className="flex flex-wrap gap-1 mb-2.5">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                rec.is_stale
                                  ? 'bg-bad/20 text-bad border border-bad/30'
                                  : 'bg-surface text-subtle border border-line2'
                              }`}
                            >
                              Age: {rec.age_days}d
                            </span>

                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                rec.stock_status === 'FULLY_AVAILABLE'
                                  ? 'bg-ink/10 text-fg border border-fg/30'
                                  : rec.stock_status === 'PARTIAL_STOCK'
                                  ? 'bg-warn/10 text-warn border border-warn/30'
                                  : 'bg-bad/10 text-bad border border-bad/30'
                              }`}
                            >
                              Stock: {rec.stock_status.replace('_', ' ')}
                            </span>

                            {rec.is_high_value && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-ink/20 text-fg font-bold border border-fg/40">
                                ★ High Value
                              </span>
                            )}
                          </div>

                          {/* Next Action Box */}
                          <div className="text-[11px] bg-surface p-2 rounded-lg border border-line2 mb-2.5 text-subtle space-y-1">
                            <div className="truncate">
                              <strong className="text-fg">Next:</strong> {rec.next_action}
                            </div>
                            {rec.next_follow_up_date && (
                              <div className="text-[10px] text-fg font-medium flex items-center gap-1 pt-1 border-t border-line2">
                                📅 Follow-up: {formatDate(rec.next_follow_up_date)} {rec.next_follow_up_time || ''}
                              </div>
                            )}
                          </div>

                          {/* Card Action Links */}
                          <div className="flex justify-between items-center pt-1.5 border-t border-line2">
                            <Link
                              to={`/quotations/${rec.quotation_id}`}
                              className="text-[11px] font-semibold text-subtle hover:text-fg transition-colors"
                            >
                              View Detail →
                            </Link>
                            <button
                              className="btn tiny bg-surface text-fg border border-line2 hover:bg-tile text-[11px] font-semibold px-2.5 py-1 rounded-md"
                              onClick={() => openCreateFollowUp(rec)}
                            >
                              + Follow-up
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Table View */
        <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden shadow-sm">
          {records.length === 0 ? (
            <EmptyState
              title="No pipeline records found"
              message="No sales opportunities match the selected stage and search filters."
              onAction={resetFilters}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-line2 bg-surface/80 text-subtle uppercase text-[10px] tracking-wider font-semibold">
                    <th className="p-3">Quotation No</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Engineer</th>
                    <th className="p-3">Branch</th>
                    <th className="p-3 text-right">Value (₹)</th>
                    <th className="p-3">Current Stage</th>
                    <th className="p-3 text-right">Age</th>
                    <th className="p-3">Next Follow-up</th>
                    <th className="p-3">Stock Risk</th>
                    <th className="p-3">Next Action</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line2">
                  {records.map((r) => (
                    <tr key={r.quotation_id} className="hover:bg-surface/60 transition-colors">
                      <td className="p-3 font-bold font-mono">
                        <Link to={`/quotations/${r.quotation_id}`} className="text-fg hover:underline">
                          {r.quotation_number}
                        </Link>
                      </td>
                      <td className="p-3 text-fg font-medium max-w-[200px] truncate" title={r.customer_name}>
                        {r.customer_name}
                      </td>
                      <td className="p-3 text-subtle">{r.engineer_name}</td>
                      <td className="p-3 text-subtle">{r.branch_name}</td>
                      <td className="p-3 text-right font-bold text-fg font-mono">
                        {formatCurrency(r.net_subtotal)}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface text-fg border border-line2">
                          {r.pipeline_stage_label}
                        </span>
                      </td>
                      <td className="p-3 text-right text-subtle font-mono">{r.age_days}d</td>
                      <td className="p-3 text-fg">
                        {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : 'None'}
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            r.stock_status === 'FULLY_AVAILABLE'
                              ? 'bg-ink/10 text-fg border border-fg/30'
                              : r.stock_status === 'PARTIAL_STOCK'
                              ? 'bg-warn/10 text-warn border border-warn/30'
                              : 'bg-bad/10 text-bad border border-bad/30'
                          }`}
                        >
                          {r.stock_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-3 text-fg max-w-[180px] truncate" title={r.next_action}>
                        {r.next_action}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          className="btn tiny bg-surface text-fg border border-line2 hover:bg-tile text-[11px] font-semibold px-2.5 py-1 rounded-md"
                          onClick={() => openCreateFollowUp(r)}
                        >
                          Follow-up
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Follow-up Action Modal */}
      {followUpModal.open && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50 backdrop-blur-xs">
          <div className="bg-surface2 border border-line2 p-5 rounded-xl max-w-md w-full shadow-lift space-y-4">
            <div className="flex justify-between items-start border-b border-line2 pb-3">
              <div>
                <h3 className="text-base font-bold text-fg">
                  Schedule Follow-up for {followUpModal.quotationNumber}
                </h3>
                <p className="text-xs text-subtle mt-0.5">
                  Record follow-up schedule and notes for this sales opportunity.
                </p>
              </div>
              <button
                onClick={() => setFollowUpModal({ open: false, mode: 'create' })}
                className="text-subtle hover:text-fg font-bold text-lg"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-subtle font-medium mb-1">Follow-up Date</label>
                  <input
                    type="date"
                    className="w-full bg-surface border border-line2 text-fg p-2 rounded-lg outline-none focus:border-fg"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-subtle font-medium mb-1">Time</label>
                  <input
                    type="time"
                    className="w-full bg-surface border border-line2 text-fg p-2 rounded-lg outline-none focus:border-fg"
                    value={modalTime}
                    onChange={(e) => setModalTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-subtle font-medium mb-1">Priority</label>
                  <select
                    className="w-full bg-surface border border-line2 text-fg p-2 rounded-lg outline-none focus:border-fg"
                    value={modalPriority}
                    onChange={(e) => setModalPriority(e.target.value as FollowUpPriority)}
                  >
                    <option value="LOW">Low Priority</option>
                    <option value="NORMAL">Normal Priority</option>
                    <option value="HIGH">High Priority</option>
                    <option value="URGENT">Urgent Priority</option>
                  </select>
                </div>
                <div>
                  <label className="block text-subtle font-medium mb-1">Follow-up Status</label>
                  <select
                    className="w-full bg-surface border border-line2 text-fg p-2 rounded-lg outline-none focus:border-fg"
                    value={modalStatus}
                    onChange={(e) => setModalStatus(e.target.value as FollowUpStatus)}
                  >
                    <option value="PENDING">Pending Action</option>
                    <option value="CONTACTED">Customer Contacted</option>
                    <option value="CUSTOMER_RESPONDED">Customer Responded</option>
                    <option value="RESCHEDULED">Rescheduled</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-subtle font-medium mb-1">Notes & Action Required</label>
                <textarea
                  rows={3}
                  className="w-full bg-surface border border-line2 text-fg p-2.5 rounded-lg outline-none focus:border-fg"
                  placeholder="Record customer response details, technical questions, or next required action..."
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-line2">
              <button
                className="btn small bg-surface text-fg border border-line2 hover:bg-tile px-4 py-2 text-xs font-semibold rounded-lg"
                onClick={() => setFollowUpModal({ open: false, mode: 'create' })}
                disabled={submittingModal}
              >
                Cancel
              </button>
              <button
                className="btn small bg-ink hover:bg-ink/85 text-onink font-semibold px-4 py-2 text-xs rounded-lg"
                onClick={submitFollowUpModal}
                disabled={submittingModal}
              >
                {submittingModal ? 'Saving...' : 'Save Follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
