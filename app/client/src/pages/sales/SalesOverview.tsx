import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesOverviewResponse } from '../../api';
import { LoadingState, ErrorState } from '../../components/ui/state-views';
import { parseSalesOverviewResponse } from '../../lib/salesOverview';

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

// Metrics the server could not calculate arrive as null; show them as unavailable, never as 0.
const NOT_AVAILABLE = '—';
const showCount = (v: number | null) => (v === null ? NOT_AVAILABLE : v);
const showMoney = (v: number | null) => (v === null ? NOT_AVAILABLE : formatCurrency(v));

export default function SalesOverview() {
  const [data, setData] = useState<SalesOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.overview();
      // Throws on a missing or malformed response (e.g. an older API), which shows the error state.
      setData(parseSalesOverviewResponse(res));
    } catch (err: any) {
      console.error('Failed to load sales overview:', err);
      setError(err.message || 'Failed to load sales overview');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading Sales Control Center..." />;
  }

  if (error || !data) {
    return <ErrorState message={error || 'Failed to load sales overview'} onRetry={loadOverview} />;
  }

  const { kpis, pipeline, unavailable } = data;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Sales Overview & Controls</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Unified operational control center for quotations, purchase orders, performa invoices, and sale reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/sales/pipeline"
            className="ts-btn ts-ghost ts-xs"
          >
            Pipeline board
          </Link>
          <Link
            to="/quotations/new"
            className="ts-btn ts-dark ts-xs"
          >
            + New Quotation
          </Link>
          <Link
            to="/sales/orders"
            className="ts-btn ts-ghost ts-xs"
          >
            View Orders
          </Link>
        </div>
      </div>

      {unavailable && (
        <div className="ts-card text-[13px] text-subtle" role="status">
          <span className="text-warn font-medium">Some figures are not available.</span> {unavailable.reason} Values shown as{' '}
          {NOT_AVAILABLE} are not calculated.
        </div>
      )}

      {/* KPI Cards Grid - Fixed text collision */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="text-[13px] text-subtle">Total Quotations</div>
          <div className="ts-val num text-fg !mt-1.5 truncate">{kpis.totalQuotations}</div>
          <div className="text-[12.5px] text-faint pt-1">
            Drafts: <span className="text-fg font-medium">{kpis.draftQuotations}</span> | Sent: <span className="text-fg font-medium">{kpis.sentQuotations}</span>
          </div>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="text-[13px] text-subtle">Accepted Quotes</div>
          <div className="ts-val num text-fg !mt-1.5 truncate">{kpis.acceptedQuotations}</div>
          <div className="text-[12.5px] text-faint pt-1 num">
            {formatCurrency(kpis.acceptedQuotationValue)}
          </div>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="text-[13px] text-subtle">Open Orders</div>
          <div className="ts-val num text-fg !mt-1.5 truncate">{showCount(kpis.openOrders)}</div>
          <div className="text-[12.5px] text-faint pt-1 num">
            {showMoney(kpis.openOrderValue)}
          </div>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="text-[13px] text-subtle">Pending PIs</div>
          <div className="ts-val num text-warn !mt-1.5 truncate">{kpis.pendingPis}</div>
          <div className="text-[12.5px] text-faint pt-1">Awaiting Invoicing</div>
        </div>

        <div className="ts-card ts-kpi-sm space-y-1">
          <div className="text-[13px] text-subtle">Pending Dispatch</div>
          <div className="ts-val num text-warn !mt-1.5 truncate">{showCount(kpis.pendingSaleReports)}</div>
          <div className="text-[12.5px] text-faint pt-1">Draft Sale Reports</div>
        </div>

        <div className="ts-card ts-charcoal ts-kpi-sm space-y-1">
          <div className="text-[13px] opacity-70">Confirmed Sales</div>
          <div className="ts-val num !mt-1.5 truncate">{showMoney(kpis.salesValue)}</div>
          <div className="text-[12.5px] opacity-60 pt-1">
            {kpis.confirmedSales === null ? 'Not available' : `${kpis.confirmedSales} Confirmed Sales`}
          </div>
        </div>
      </div>

      {/* Horizontal Process Stage Flow */}
      <div className="ts-card space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="m-0 text-[15px] font-medium text-fg">Sales Pipeline Stage Flow</h2>
            <p className="text-[13px] text-subtle">Commercial document progression from quotation to confirmed sale</p>
          </div>
          <span className="ts-headtag num">
            Conversion Rate: {kpis.quotationConversionRate}%
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 pt-1">
          {pipeline.map((stage, idx) => (
            <div
              key={stage.stage}
              className="bg-tile rounded-[15px] p-3.5 relative flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-center text-[12px] font-medium text-faint">
                  <span>Stage 0{idx + 1}</span>
                  {idx < pipeline.length - 1 && <span className="hidden lg:inline text-faint font-medium text-sm">→</span>}
                </div>
                <div className="text-[13px] font-medium text-fg mt-1">{stage.label}</div>
              </div>
              <div className="mt-3 pt-2 border-t border-dashed border-line2 flex justify-between items-baseline gap-2">
                <span className="text-[20px] font-medium text-fg num">{showCount(stage.count)}</span>
                <span className="text-[13px] num text-fg font-medium">{showMoney(stage.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls & Financial Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Operational Sales Controls */}
        <div className="ts-card space-y-3">
          <h2 className="m-0 text-[15px] font-medium text-fg">Operational Sales Controls</h2>
          <div className="space-y-2">
            <Link
              to="/sales/pipeline"
              className="flex items-center justify-between gap-3 p-3.5 rounded-[15px] bg-tile hover:bg-surface transition-colors"
            >
              <div>
                <div className="text-[13px] font-medium text-fg">Sales Pipeline Control Center</div>
                <div className="text-[12.5px] text-subtle">Kanban & Table view of all active opportunities & stock risk</div>
              </div>
              <span className="ts-st shrink-0">
                Pipeline Control
              </span>
            </Link>

            <Link
              to="/follow-ups/due-today"
              className="flex items-center justify-between gap-3 p-3.5 rounded-[15px] bg-tile hover:bg-surface transition-colors"
            >
              <div>
                <div className="text-[13px] font-medium text-fg">Follow-ups Due Today</div>
                <div className="text-[12.5px] text-subtle">Scheduled customer actions requiring contact today</div>
              </div>
              <span className="ts-st shrink-0">
                Due Today Queue
              </span>
            </Link>

            <Link
              to="/follow-ups/overdue"
              className="flex items-center justify-between gap-3 p-3.5 rounded-[15px] bg-tile hover:bg-surface transition-colors"
            >
              <div>
                <div className="text-[13px] font-medium text-fg">Overdue Follow-ups</div>
                <div className="text-[12.5px] text-subtle">High priority pending follow-ups requiring escalation</div>
              </div>
              <span className="ts-st ts-tone-bad shrink-0">
                Action Required
              </span>
            </Link>

            <Link
              to="/sales/activity"
              className="flex items-center justify-between gap-3 p-3.5 rounded-[15px] bg-tile hover:bg-surface transition-colors"
            >
              <div>
                <div className="text-[13px] font-medium text-fg">Sales Activity Audit Log</div>
                <div className="text-[12.5px] text-subtle">Chronological event stream of all sales document events</div>
              </div>
              <span className="ts-st shrink-0">
                Audit Stream
              </span>
            </Link>
          </div>
        </div>

        {/* Financial Summary Metrics */}
        <div className="ts-card ts-tbl space-y-3">
          <h2 className="m-0 text-[15px] font-medium text-fg">Financial Summary Metrics</h2>
          <div className="ts-tblwrap">
            <table className="ts-mini">
              <tbody>
                <tr>
                  <td className="text-subtle">Gross Sales (Confirmed)</td>
                  <td className="ts-r text-fg num">{showMoney(kpis.grossSales)}</td>
                </tr>
                <tr>
                  <td className="text-subtle">Accepted Quotation Pipeline</td>
                  <td className="ts-r text-fg num">{formatCurrency(kpis.acceptedQuotationValue)}</td>
                </tr>
                <tr>
                  <td className="text-subtle">Open Order Value</td>
                  <td className="ts-r text-fg num">{showMoney(kpis.openOrderValue)}</td>
                </tr>
                <tr>
                  <td className="text-subtle">Pending Dispatch Value</td>
                  <td className="ts-r text-warn num">{showMoney(kpis.pendingDispatchValue)}</td>
                </tr>
                <tr>
                  <td className="text-subtle">Average Order Value</td>
                  <td className="ts-r text-fg num">{showMoney(kpis.averageOrderValue)}</td>
                </tr>
                <tr>
                  <td className="text-subtle">Quotation Conversion Rate</td>
                  <td className="ts-r text-fg num">{kpis.quotationConversionRate}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
