import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesOverviewResponse } from '../../api';
import { LoadingState, ErrorState } from '../../components/ui/state-views';

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

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
      setData(res);
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

  const { kpis, pipeline } = data;

  return (
    <div className="p-4 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl">
        <div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">Sales Overview & Controls</h1>
          <p className="text-xs text-[#7A839E] mt-1">
            Unified operational control center for quotations, purchase orders, performa invoices, and sale reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/sales/pipeline"
            className="btn small bg-[#F7F8FC] text-[#3B6FD4] border border-[#D4DAEA] hover:bg-[#E4E8F2] text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            📊 Pipeline Board
          </Link>
          <Link
            to="/quotations/new"
            className="btn small bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold text-xs px-3 py-1.5 rounded-lg"
          >
            + New Quotation
          </Link>
          <Link
            to="/sales/orders"
            className="btn small bg-[#F7F8FC] text-[#141B34] border border-[#E4E8F2] hover:bg-[#E4E8F2] text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            View Orders
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid - Fixed text collision */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-3.5 rounded-xl hover:border-[#D4DAEA] transition-colors space-y-1">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7A839E]">Total Quotations</div>
          <div className="text-xl font-bold text-[#141B34]">{kpis.totalQuotations}</div>
          <div className="text-[11px] text-[#A8AEC4] pt-1 border-t border-[#E4E8F2]/50">
            Drafts: <span className="text-[#141B34] font-medium">{kpis.draftQuotations}</span> | Sent: <span className="text-[#141B34] font-medium">{kpis.sentQuotations}</span>
          </div>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-3.5 rounded-xl hover:border-[#D4DAEA] transition-colors space-y-1">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7A839E]">Accepted Quotes</div>
          <div className="text-xl font-bold text-[#3B6FD4]">{kpis.acceptedQuotations}</div>
          <div className="text-[11px] text-[#A8AEC4] pt-1 border-t border-[#E4E8F2]/50 font-mono">
            {formatCurrency(kpis.acceptedQuotationValue)}
          </div>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-3.5 rounded-xl hover:border-[#D4DAEA] transition-colors space-y-1">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7A839E]">Open Orders</div>
          <div className="text-xl font-bold text-[#6B78D6]">{kpis.openOrders}</div>
          <div className="text-[11px] text-[#A8AEC4] pt-1 border-t border-[#E4E8F2]/50 font-mono">
            {formatCurrency(kpis.openOrderValue)}
          </div>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-3.5 rounded-xl hover:border-[#D4DAEA] transition-colors space-y-1">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7A839E]">Pending PIs</div>
          <div className="text-xl font-bold text-[#E8A33D]">{kpis.pendingPis}</div>
          <div className="text-[11px] text-[#A8AEC4] pt-1 border-t border-[#E4E8F2]/50">Awaiting Invoicing</div>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-3.5 rounded-xl hover:border-[#D4DAEA] transition-colors space-y-1">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7A839E]">Pending Dispatch</div>
          <div className="text-xl font-bold text-[#E07B39]">{kpis.pendingSaleReports}</div>
          <div className="text-[11px] text-[#A8AEC4] pt-1 border-t border-[#E4E8F2]/50">Draft Sale Reports</div>
        </div>

        <div className="bg-[#FFFFFF] border border-[#3B6FD4]/40 p-3.5 rounded-xl hover:border-[#3B6FD4] transition-colors space-y-1 bg-[#3B6FD4]/5">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-[#3B6FD4]">Confirmed Sales</div>
          <div className="text-xl font-bold text-[#3B6FD4] font-mono">{formatCurrency(kpis.salesValue)}</div>
          <div className="text-[11px] text-[#7A839E] pt-1 border-t border-[#3B6FD4]/20">
            {kpis.confirmedSales} Confirmed Sales
          </div>
        </div>
      </div>

      {/* Horizontal Process Stage Flow */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#141B34]">Sales Pipeline Stage Flow</h2>
            <p className="text-xs text-[#7A839E]">Commercial document progression from quotation to confirmed sale</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F7F8FC] text-[#3B6FD4] border border-[#D4DAEA] font-mono">
            Conversion Rate: {kpis.quotationConversionRate}%
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 pt-1">
          {pipeline.map((stage, idx) => (
            <div
              key={stage.stage}
              className="relative bg-[#F4F6FC] border border-[#E4E8F2] p-3 rounded-xl flex flex-col justify-between hover:border-[#D4DAEA] transition-colors"
            >
              <div>
                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-[#A8AEC4]">
                  <span>Stage 0{idx + 1}</span>
                  {idx < pipeline.length - 1 && <span className="hidden lg:inline text-[#E4E8F2] font-bold text-sm">→</span>}
                </div>
                <div className="text-xs font-bold text-[#141B34] mt-1">{stage.label}</div>
              </div>
              <div className="mt-3 pt-2 border-t border-[#E4E8F2]/60 flex justify-between items-baseline">
                <span className="text-base font-bold text-[#141B34]">{stage.count}</span>
                <span className="text-xs font-mono text-[#3B6FD4] font-semibold">{formatCurrency(Number(stage.value))}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls & Financial Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Operational Sales Controls */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl space-y-3">
          <h2 className="text-sm font-bold text-[#141B34]">Operational Sales Controls</h2>
          <div className="space-y-2">
            <Link
              to="/sales/pipeline"
              className="flex items-center justify-between p-3 rounded-xl bg-[#F4F6FC] border border-[#E4E8F2] hover:border-[#D4DAEA] hover:bg-[#F7F8FC]/80 transition-all"
            >
              <div>
                <div className="text-xs font-bold text-[#141B34]">Sales Pipeline Control Center</div>
                <div className="text-[11px] text-[#7A839E]">Kanban & Table view of all active opportunities & stock risk</div>
              </div>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-[#3B6FD4]/10 text-[#3B6FD4] border border-[#3B6FD4]/30">
                Pipeline Control
              </span>
            </Link>

            <Link
              to="/follow-ups/due-today"
              className="flex items-center justify-between p-3 rounded-xl bg-[#F4F6FC] border border-[#E4E8F2] hover:border-[#D4DAEA] hover:bg-[#F7F8FC]/80 transition-all"
            >
              <div>
                <div className="text-xs font-bold text-[#141B34]">Follow-ups Due Today</div>
                <div className="text-[11px] text-[#7A839E]">Scheduled customer actions requiring contact today</div>
              </div>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-[#6B78D6]/10 text-[#6B78D6] border border-[#6B78D6]/30">
                Due Today Queue
              </span>
            </Link>

            <Link
              to="/follow-ups/overdue"
              className="flex items-center justify-between p-3 rounded-xl bg-[#F4F6FC] border border-[#E4E8F2] hover:border-[#D4DAEA] hover:bg-[#F7F8FC]/80 transition-all"
            >
              <div>
                <div className="text-xs font-bold text-[#141B34]">Overdue Follow-ups</div>
                <div className="text-[11px] text-[#7A839E]">High priority pending follow-ups requiring escalation</div>
              </div>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-[#E5484D]/10 text-[#E5484D] border border-[#E5484D]/30">
                Action Required
              </span>
            </Link>

            <Link
              to="/sales/activity"
              className="flex items-center justify-between p-3 rounded-xl bg-[#F4F6FC] border border-[#E4E8F2] hover:border-[#D4DAEA] hover:bg-[#F7F8FC]/80 transition-all"
            >
              <div>
                <div className="text-xs font-bold text-[#141B34]">Sales Activity Audit Log</div>
                <div className="text-[11px] text-[#7A839E]">Chronological event stream of all sales document events</div>
              </div>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-[#F7F8FC] text-[#7A839E] border border-[#E4E8F2]">
                Audit Stream
              </span>
            </Link>
          </div>
        </div>

        {/* Financial Summary Metrics */}
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl space-y-3">
          <h2 className="text-sm font-bold text-[#141B34]">Financial Summary Metrics</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <tbody className="divide-y divide-[#E4E8F2]/50">
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Gross Sales (Confirmed)</td>
                  <td className="py-2.5 text-right font-bold text-[#3B6FD4] font-mono">{formatCurrency(kpis.grossSales)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Accepted Quotation Pipeline</td>
                  <td className="py-2.5 text-right font-bold text-[#141B34] font-mono">{formatCurrency(kpis.acceptedQuotationValue)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Open Order Value</td>
                  <td className="py-2.5 text-right font-bold text-[#141B34] font-mono">{formatCurrency(kpis.openOrderValue)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Pending Dispatch Value</td>
                  <td className="py-2.5 text-right font-bold text-[#E8A33D] font-mono">{formatCurrency(kpis.pendingDispatchValue)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Average Order Value</td>
                  <td className="py-2.5 text-right font-bold text-[#141B34] font-mono">{formatCurrency(kpis.averageOrderValue)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[#7A839E]">Quotation Conversion Rate</td>
                  <td className="py-2.5 text-right font-bold text-[#6B78D6] font-mono">{kpis.quotationConversionRate}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
