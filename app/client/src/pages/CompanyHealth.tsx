import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CompanyHealthData, type CustomerHealthStatus } from '../api';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relativeDays(days: number | null) {
  if (days == null) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

const STATUS_COLORS: Record<CustomerHealthStatus, string> = {
  new: '#3B6FD4',
  strong: '#3B6FD4',
  active: '#3B6FD4',
  at_risk: '#E8A33D',
  inactive: '#E5484D',
  no_history: '#A8AEC4',
};

const DESCRIPTION: Record<CustomerHealthStatus, string> = {
  new: 'First purchase was recent — not enough history yet to judge a long-term trend.',
  strong: 'Buying recently and well above average order value for this business.',
  active: 'Buying recently, within normal purchasing patterns.',
  at_risk: 'Purchasing has slowed — approaching the inactivity threshold.',
  inactive: 'No purchases within the configured lapse window.',
  no_history: 'No sales records found for this company yet.',
};

export default function CompanyHealth() {
  const { id } = useParams();
  const [data, setData] = useState<CompanyHealthData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    if (!id || isNaN(Number(id))) {
      setError('Invalid company ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    api.companies
      .health(Number(id))
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load company health.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const color = data ? STATUS_COLORS[data.health.status] || '#7A839E' : '#7A839E';

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-4 text-[12.5px]">
        <Link to="/customer-health" className="text-[#3B6FD4] hover:underline font-medium">
          ← Back to Customer Health
        </Link>
        <span className="text-[#A8AEC4]">·</span>
        <Link to="/companies" className="text-[#7A839E] hover:text-[#141B34] transition-colors">
          View All Companies
        </Link>
      </div>

      {/* Page Header */}
      <div className="flex flex-col gap-1.5">
        <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
          {data ? data.company.name : 'Company Health'}
        </h1>
        <p className="margin-0 text-[13.5px] text-[#7A839E]">
          Detailed health profile, order history, and account metrics.
        </p>
      </div>

      {error ? (
        <div className="p-4 rounded-[12px] bg-[#F8E4E4] border border-[#F4D6D7] text-[#E5484D] text-[13px] flex items-center justify-between gap-4">
          <span>{error === 'Company not found' ? `Company #${id} was not found in the database.` : error}</span>
          {error !== 'Company not found' && (
            <button
              type="button"
              onClick={fetchData}
              className="px-3 py-1.5 rounded-[8px] bg-[#F7DFE0] hover:bg-[#F5DADB] text-[#141B34] text-xs font-semibold cursor-pointer transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      ) : loading && !data ? (
        <div className="p-8 text-center text-[#7A839E] text-[13px] rounded-[16px] bg-[#FFFFFF] border border-[#E4E8F2]">
          Loading company health details...
        </div>
      ) : data ? (
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EEF1F9] pb-4">
            <div>
              <h2 className="text-xl font-bold text-[#141B34]">{data.company.name}</h2>
              <p className="text-xs text-[#7A839E] mt-0.5">Account ID: #{data.company.id}</p>
            </div>
            <div>
              <span
                className="inline-flex items-center gap-2 px-3 py-1 rounded-[8px] border border-[#E4E8F2] text-xs font-semibold"
                style={{ color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                {data.health.label}
              </span>
            </div>
          </div>

          <p className="text-sm text-[#7A839E] leading-relaxed">
            {DESCRIPTION[data.health.status]}
          </p>

          {data.health.status !== 'no_history' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2]">
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A839E]">Total Business</span>
                <span className="text-xl font-extrabold text-[#141B34] mt-1">{formatCurrency(data.health.totalRevenue)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A839E]">Total Orders</span>
                <span className="text-xl font-extrabold text-[#141B34] mt-1">{data.health.orderCount}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A839E]">Last Order</span>
                <span className="text-xl font-extrabold text-[#141B34] mt-1">{relativeDays(data.health.daysSinceLastOrder)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A839E]">Avg Order Value</span>
                <span className="text-xl font-extrabold text-[#3B6FD4] mt-1">{formatCurrency(data.health.avgOrderValue)}</span>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-[#7A839E] text-xs rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2]">
              No sales records or order history recorded for this company.
            </div>
          )}

          {data.health.status !== 'no_history' && (
            <div className="text-xs text-[#A8AEC4] flex flex-wrap gap-x-4 gap-y-1">
              <span>First order: <strong className="text-[#7A839E]">{formatDate(data.health.firstOrderDate)}</strong></span>
              <span>·</span>
              <span>Last order: <strong className="text-[#7A839E]">{formatDate(data.health.lastOrderDate)}</strong></span>
              <span>·</span>
              <span>Inactivity threshold: <strong className="text-[#7A839E]">{data.health.lapseMonths} months</strong></span>
            </div>
          )}
        </div>
      ) : null}

      {/* SALES HISTORY INTEGRATION & CUSTOMER 360 PIPELINE */}
      {data && <Customer360Section companyId={Number(id)} companyName={data.company.name} />}
    </div>
  );
}

function Customer360Section({ companyId, companyName }: { companyId: number; companyName: string }) {
  const [c360, setC360] = useState<any>(null);

  useEffect(() => {
    import('../api').then(({ fetchCustomer360Pipeline }) => {
      fetchCustomer360Pipeline(companyId).then(setC360).catch(console.error);
    });
  }, [companyId]);

  if (!c360) return <div className="text-xs text-[#A8AEC4] p-4">Loading Customer 360 Pipeline...</div>;

  return (
    <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4E8F2] pb-4">
        <div>
          <h2 className="text-lg font-bold text-[#141B34]">Customer 360 Pipeline Control</h2>
          <p className="text-xs text-[#7A839E]">
            Assigned Engineer: <strong className="text-[#141B34]">{c360.customer.assigned_engineer || 'Unassigned'}</strong> | Branch: <strong className="text-[#141B34]">{c360.customer.branch || 'Main'}</strong>
          </p>
        </div>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#F4F6FC] p-3 rounded-lg border border-[#E4E8F2]">
          <span className="text-[10px] uppercase text-[#7A839E] block">Confirmed Sales</span>
          <span className="text-lg font-bold text-[#3B6FD4]">{formatCurrency(c360.sales_summary.confirmed_sales_value)}</span>
        </div>
        <div className="bg-[#F4F6FC] p-3 rounded-lg border border-[#E4E8F2]">
          <span className="text-[10px] uppercase text-[#7A839E] block">Open Pipeline Value</span>
          <span className="text-lg font-bold text-[#6B78D6]">{formatCurrency(c360.sales_summary.open_pipeline_value)}</span>
        </div>
        <div className="bg-[#F4F6FC] p-3 rounded-lg border border-[#E4E8F2]">
          <span className="text-[10px] uppercase text-[#7A839E] block">Open Quotations</span>
          <span className="text-lg font-bold text-[#141B34]">{c360.sales_summary.open_quotations_count}</span>
        </div>
        <div className="bg-[#F4F6FC] p-3 rounded-lg border border-[#E4E8F2]">
          <span className="text-[10px] uppercase text-[#7A839E] block">Open Orders</span>
          <span className="text-lg font-bold text-[#E8A33D]">{c360.sales_summary.open_orders_count}</span>
        </div>
      </div>

      {/* Activity Timestamps */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-[#F4F6FC] p-3 rounded-lg border border-[#E4E8F2]">
        <div>
          <span className="text-[#7A839E] block">Last Quotation:</span>
          <strong className="text-[#141B34]">{formatDate(c360.activity.last_quotation_date)}</strong>
        </div>
        <div>
          <span className="text-[#7A839E] block">Last Follow-up:</span>
          <strong className="text-[#141B34]">{formatDate(c360.activity.last_follow_up_date)}</strong>
        </div>
        <div>
          <span className="text-[#7A839E] block">Last PO / Order:</span>
          <strong className="text-[#141B34]">{formatDate(c360.activity.last_order_date)}</strong>
        </div>
        <div>
          <span className="text-[#7A839E] block">Last Confirmed Sale:</span>
          <strong className="text-[#3B6FD4]">{formatDate(c360.activity.last_confirmed_sale_date)}</strong>
        </div>
      </div>

      {/* Current Active Opportunities */}
      <div>
        <h3 className="text-xs font-semibold text-[#7A839E] uppercase mb-2">Active Commercial Opportunities</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[#E4E8F2] text-[#7A839E]">
                <th className="p-2">Quotation No</th>
                <th className="p-2 text-right">Value (₹)</th>
                <th className="p-2">Stage</th>
                <th className="p-2 text-right">Age</th>
                <th className="p-2">Next Follow-up</th>
                <th className="p-2">Stock State</th>
              </tr>
            </thead>
            <tbody>
              {c360.current_opportunities?.map((op: any) => (
                <tr key={op.quotation_id} className="border-b border-[#E4E8F2]/50">
                  <td className="p-2 font-bold text-[#3B6FD4]">
                    <Link to={`/quotations/${op.quotation_id}`}>{op.quotation_number}</Link>
                  </td>
                  <td className="p-2 text-right font-semibold text-[#141B34]">{formatCurrency(op.net_subtotal)}</td>
                  <td className="p-2"><span className="badge info">{op.pipeline_stage_label}</span></td>
                  <td className="p-2 text-right text-[#7A839E]">{op.age_days}d</td>
                  <td className="p-2 text-[#6B78D6]">{op.next_follow_up_date ? formatDate(op.next_follow_up_date) : 'None'}</td>
                  <td className="p-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${op.stock_status === 'FULLY_AVAILABLE' ? 'bg-[#3B6FD4]/10 text-[#3B6FD4]' : 'bg-[#E8A33D]/10 text-[#E8A33D]'}`}>
                      {op.stock_status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!c360.current_opportunities || c360.current_opportunities.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-[#A8AEC4]">
                    No active open opportunities for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

