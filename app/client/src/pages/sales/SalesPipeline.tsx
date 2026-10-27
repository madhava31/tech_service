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
import { Seg } from '../../components/ds/Seg';

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

const PIPELINE_STAGES: { key: DerivedPipelineStage; label: string }[] = [
  { key: 'QUOTATION_DRAFT', label: 'Quotation Draft' },
  { key: 'AWAITING_CUSTOMER', label: 'Awaiting Customer' },
  { key: 'PO_CREATED', label: 'PO Created' },
  { key: 'PI_CREATED', label: 'PI Created' },
  { key: 'READY_TO_DISPATCH', label: 'Ready to Dispatch' },
  { key: 'PARTIALLY_DISPATCHED', label: 'Partially Dispatched' },
  { key: 'COMPLETED', label: 'Completed' },
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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Page Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ts-title">Sales Pipeline</h1>
            <span className="ts-headtag">
              Live Control
            </span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Real-time opportunity & follow-up control center anchored on backend-authoritative stage tracking.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            className="ts-btn ts-ghost ts-xs"
            title="Refresh Data"
          >
            Refresh
          </button>

          <Seg small label="View" value={viewMode} onChange={setViewMode} options={[{ value: 'kanban', label: 'Board' }, { value: 'table', label: 'Table' }]} />

          <button
            className="ts-btn ts-dark ts-xs"
            onClick={handleExportExcel}
          >
            Export Excel
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* KPI Summary Block */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">Open Pipeline</div>
            <div className="ts-val num text-fg truncate">{formatCurrency(summary.open_pipeline_value)}</div>
            <div className="text-[12px] text-faint mt-1 truncate">{summary.open_quotations_count} Active Quotes</div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">Awaiting Customer</div>
            <div className="ts-val num text-warn truncate">
              {summary.stage_counts.AWAITING_CUSTOMER || 0}
            </div>
            <div className="text-[12px] text-faint mt-1 truncate">
              {formatCurrency(summary.stage_values.AWAITING_CUSTOMER || 0)}
            </div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">PO Created</div>
            <div className="ts-val num text-fg truncate">{summary.stage_counts.PO_CREATED || 0}</div>
            <div className="text-[12px] text-faint mt-1 truncate">{formatCurrency(summary.stage_values.PO_CREATED || 0)}</div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">PI Created</div>
            <div className="ts-val num text-fg truncate">{summary.stage_counts.PI_CREATED || 0}</div>
            <div className="text-[12px] text-faint mt-1 truncate">{formatCurrency(summary.stage_values.PI_CREATED || 0)}</div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">Ready Dispatch</div>
            <div className="ts-val num text-fg truncate">
              {summary.stage_counts.READY_TO_DISPATCH || 0}
            </div>
            <div className="text-[12px] text-faint mt-1 truncate">
              {formatCurrency(summary.stage_values.READY_TO_DISPATCH || 0)}
            </div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">Follow-Ups Due</div>
            <div className="ts-val num text-fg truncate">{summary.due_today_followups_count}</div>
            <div className="text-[12px] text-faint mt-1 truncate">Due Today</div>
          </div>

          <div
            className={`ts-card ts-kpi-sm ${summary.overdue_followups_count > 0 ? '!bg-badbg' : ''}`}
          >
            <div className="text-[13px] text-subtle truncate">Overdue</div>
            <div className="ts-val num text-bad truncate">{summary.overdue_followups_count}</div>
            <div className="text-[12px] text-faint mt-1 truncate">Requires Action</div>
          </div>

          <div className="ts-card ts-kpi-sm">
            <div className="text-[13px] text-subtle truncate">Stale / Stock Risk</div>
            <div className="ts-val num text-warn truncate">
              {summary.stale_quotations_count} / {summary.stock_risk_count}
            </div>
            <div className="text-[12px] text-faint mt-1 truncate">High Value: {summary.high_value_count}</div>
          </div>
        </div>
      )}

      {/* Collapsible Management Attention Panel */}
      {alerts.length > 0 && (
        <div className="ts-card !p-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setAlertsOpen((prev) => !prev)}
            className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-[14.5px] font-medium text-fg hover:bg-tile transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span>Management attention</span>
              <span className="ts-st ts-tone-warn">
                {alerts.length} actionable alerts
              </span>
            </div>
            <span className="text-[13px] text-subtle shrink-0">{alertsOpen ? 'Collapse' : 'Expand'}</span>
          </button>

          {alertsOpen && (
            <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="bg-tile p-3.5 rounded-[15px] text-[13px] flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 font-medium text-fg mb-1.5">
                      <span>{a.title}</span>
                      <span
                        className={`ts-st ${a.severity === 'HIGH' || a.severity === 'URGENT' ? 'ts-tone-bad' : 'ts-tone-warn'}`}
                      >
                        {a.severity}
                      </span>
                    </div>
                    <p className="text-subtle text-[12.5px] leading-relaxed m-0">{a.message}</p>
                  </div>
                  {a.quotation_id && (
                    <div className="mt-2.5 pt-2 border-t border-dashed border-line2 flex justify-end">
                      <Link
                        to={`/quotations/${a.quotation_id}`}
                        className="text-fg text-[12.5px] hover:underline flex items-center gap-1"
                      >
                        Inspect quotation →
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
      <div className="ts-card flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="ts-lbl">Search Keywords</label>
            <input
              type="text"
              className="ts-fi"
              placeholder="Search quotation, customer, engineer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="ts-lbl">Pipeline Stage</label>
            <select
              className="ts-fi"
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
            <label className="ts-lbl">Stock Risk Status</label>
            <select
              className="ts-fi"
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
            <label className="ts-lbl">Date Range</label>
            <select
              className="ts-fi"
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

          <div className="flex items-center gap-4 flex-wrap sm:col-span-2 lg:col-span-2 pt-1 sm:pt-6">
            <label className="flex items-center gap-2 cursor-pointer text-fg select-none text-[13.5px]">
              <input
                type="checkbox"
                className="accent-[rgb(var(--fg))] w-4 h-4"
                checked={onlyHighValue}
                onChange={(e) => setOnlyHighValue(e.target.checked)}
              />
              High Value Only (≥ ₹5L)
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-fg select-none text-[13.5px]">
              <input
                type="checkbox"
                className="accent-[rgb(var(--fg))] w-4 h-4"
                checked={onlyStale}
                onChange={(e) => setOnlyStale(e.target.checked)}
              />
              Stale Only (&gt; 30d)
            </label>
          </div>
        </div>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 pt-3 border-t border-dashed border-line2 flex-wrap text-[12.5px]">
            <span className="text-subtle">Active filters</span>
            {search && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                Search: "{search}"
                <button onClick={() => setSearch('')} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            {selectedStage && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                Stage: {PIPELINE_STAGES.find((s) => s.key === selectedStage)?.label || selectedStage}
                <button onClick={() => setSelectedStage('')} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            {selectedStockStatus && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                Stock: {selectedStockStatus.replace('_', ' ')}
                <button onClick={() => setSelectedStockStatus('')} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            {selectedDateRange && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                Date: {selectedDateRange}
                <button onClick={() => setSelectedDateRange('')} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            {onlyHighValue && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                High Value Only
                <button onClick={() => setOnlyHighValue(false)} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            {onlyStale && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tile text-fg">
                Stale Only
                <button onClick={() => setOnlyStale(false)} className="hover:text-bad ml-1 text-subtle">×</button>
              </span>
            )}
            <button
              onClick={resetFilters}
              className="ts-btn ts-ghost ts-xs text-bad ml-auto"
            >
              Clear all
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
          <div className="ts-kboard">
            {PIPELINE_STAGES.map((stage, i) => {
              const cols = kanbanColumns[stage.key] || [];
              const colValue = cols.reduce((sum, r) => sum + r.net_subtotal, 0);

              return (
                <section key={stage.key} className="ts-kcol" style={{ ['--i' as any]: i }}>
                  <header>
                    <i className={stage.key === 'COMPLETED' ? 'won' : ''} />
                    {stage.label} <span>{cols.length}</span>
                    <b className="num">{formatCurrency(colValue)}</b>
                  </header>

                  <div className="ts-kcards">
                    {cols.length === 0 ? (
                      <div className="ts-kempty">No opportunities</div>
                    ) : (
                      cols.map((rec) => (
                        <article key={rec.quotation_id} className="ts-kcard">
                          <div className="ts-kc-top">
                            <Link to={`/quotations/${rec.quotation_id}`} className="ts-ktag num hover:text-fg">
                              {rec.quotation_number}
                            </Link>
                            <span className="text-[13.5px] text-fg num">{formatCurrency(rec.net_subtotal)}</span>
                          </div>

                          <h5 title={rec.customer_name}>{rec.customer_name}</h5>

                          <div className="ts-kmeta">
                            <span className="truncate">{rec.engineer_name}</span>
                            <span className="truncate">{rec.branch_name}</span>
                          </div>

                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            <span className={`ts-ktag ${rec.is_stale ? 'ts-ktag-bad' : ''}`}>
                              {rec.age_days}d old
                            </span>
                            <span
                              className={`ts-ktag ${rec.stock_status === 'FULLY_AVAILABLE' ? 'ts-ktag-good' : rec.stock_status === 'PARTIAL_STOCK' ? 'ts-ktag-warn' : 'ts-ktag-bad'}`}
                            >
                              {rec.stock_status.replace('_', ' ').toLowerCase()}
                            </span>
                            {rec.is_high_value && <span className="ts-ktag ts-ktag-ink">High value</span>}
                          </div>

                          <div className="ts-knext">
                            <div className="truncate">
                              <span className="text-fg">Next:</span> {rec.next_action}
                            </div>
                            {rec.next_follow_up_date && (
                              <div className="mt-1 text-fg">
                                Follow-up {formatDate(rec.next_follow_up_date)} {rec.next_follow_up_time || ''}
                              </div>
                            )}
                          </div>

                          <div className="ts-kfoot">
                            <Link to={`/quotations/${rec.quotation_id}`} className="text-[12.5px] text-subtle hover:text-fg transition-colors">
                              View detail →
                            </Link>
                            <button className="ts-btn ts-ghost ts-xs" onClick={() => openCreateFollowUp(rec)}>
                              + Follow-up
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        /* Table View */
        <div className="ts-card ts-white ts-tbl overflow-hidden">
          {records.length === 0 ? (
            <EmptyState
              title="No pipeline records found"
              message="No sales opportunities match the selected stage and search filters."
              onAction={resetFilters}
            />
          ) : (
            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Quotation no</th>
                    <th>Customer</th>
                    <th>Engineer</th>
                    <th>Branch</th>
                    <th className="ts-r">Value (₹)</th>
                    <th>Current stage</th>
                    <th className="ts-r">Age</th>
                    <th>Next follow-up</th>
                    <th>Stock risk</th>
                    <th>Next action</th>
                    <th className="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.quotation_id}>
                      <td className="num">
                        <Link to={`/quotations/${r.quotation_id}`} className="text-fg hover:underline">
                          {r.quotation_number}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate" title={r.customer_name}>
                        {r.customer_name}
                      </td>
                      <td className="text-subtle">{r.engineer_name}</td>
                      <td className="text-subtle">{r.branch_name}</td>
                      <td className="ts-r num">
                        {formatCurrency(r.net_subtotal)}
                      </td>
                      <td>
                        <span className="ts-st">
                          {r.pipeline_stage_label}
                        </span>
                      </td>
                      <td className="ts-r num text-subtle">{r.age_days}d</td>
                      <td className="">
                        {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : 'None'}
                      </td>
                      <td>
                        <span
                          className={`ts-ktag ${r.stock_status === 'FULLY_AVAILABLE' ? 'ts-ktag-good' : r.stock_status === 'PARTIAL_STOCK' ? 'ts-ktag-warn' : 'ts-ktag-bad'}`}
                        >
                          {r.stock_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate" title={r.next_action}>
                        {r.next_action}
                      </td>
                      <td className="text-center">
                        <button
                          className="ts-btn ts-ghost ts-xs"
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]">
          <div className="ts-modal max-w-md w-full flex flex-col gap-4">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">
                  Schedule Follow-up for {followUpModal.quotationNumber}
                </h3>
                <p className="ts-muted m-0 mt-1.5 text-[14px]">
                  Record follow-up schedule and notes for this sales opportunity.
                </p>
              </div>
              <button
                onClick={() => setFollowUpModal({ open: false, mode: 'create' })}
                className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">Follow-up Date</label>
                  <input
                    type="date"
                    className="ts-fi"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="ts-lbl">Time</label>
                  <input
                    type="time"
                    className="ts-fi"
                    value={modalTime}
                    onChange={(e) => setModalTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">Priority</label>
                  <select
                    className="ts-fi"
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
                  <label className="ts-lbl">Follow-up Status</label>
                  <select
                    className="ts-fi"
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
                <label className="ts-lbl">Notes & Action Required</label>
                <textarea
                  rows={3}
                  className="ts-fi"
                  placeholder="Record customer response details, technical questions, or next required action..."
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                className="ts-btn ts-ghost ts-xs"
                onClick={() => setFollowUpModal({ open: false, mode: 'create' })}
                disabled={submittingModal}
              >
                Cancel
              </button>
              <button
                className="ts-btn ts-dark ts-xs"
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
