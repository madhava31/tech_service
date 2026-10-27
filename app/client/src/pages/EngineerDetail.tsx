import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, SalesEngineer, EngineerSalesTarget, EngineerPerformance } from '../api';

export default function EngineerDetail() {
  const { id } = useParams();
  const engineerId = Number(id);

  const [engineer, setEngineer] = useState<SalesEngineer | null>(null);
  const [target, setTarget] = useState<EngineerSalesTarget | null>(null);
  const [performance, setPerformance] = useState<EngineerPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [fiscalYear, setFiscalYear] = useState('2026-27');
  const [targetInput, setTargetInput] = useState<number | string>('');
  const [savingTarget, setSavingTarget] = useState(false);

  function loadData() {
    setLoading(true);
    setError('');
    api.engineers
      .get(engineerId)
      .then((data) => {
        setEngineer(data);
        if (data.current_year_target) setTarget(data.current_year_target);
        if (data.performance) {
          setPerformance(data.performance);
          setTargetInput(data.performance.target_amount || '');
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [engineerId, fiscalYear]);

  async function handleSaveTarget(e: React.FormEvent) {
    e.preventDefault();
    setSavingTarget(true);
    try {
      await api.engineers.setTarget({
        engineer_id: engineerId,
        fiscal_year: fiscalYear,
        target_amount: Number(targetInput) || 0,
      });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTarget(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-subtle text-sm">Loading engineer performance...</div>;
  }

  if (error || !engineer) {
    return (
      <div className="p-6 text-bad text-sm bg-bad/10 border border-bad/20 rounded-xl">
        {error || 'Engineer not found.'}
      </div>
    );
  }

  const pct = performance?.achievement_pct || 0;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Header */}
      <div className="ts-phead !mb-2 block">
        <div className="flex items-center gap-2 mb-1">
          <Link to="/sales/engineers" className="text-xs text-subtle hover:text-fg">
            ← Sales Engineers
          </Link>
        </div>
        <div className="ts-phead !mb-2 justify-between">
          <div>
            <h1 className="ts-title">{engineer.name}</h1>
            <p className="text-xs text-subtle font-mono mt-0.5">Code: {engineer.code} | Email: {engineer.email || '—'} | Phone: {engineer.phone || '—'}</p>
          </div>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="bg-surface2 border border-line2 rounded-lg px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-fg"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>
        </div>
      </div>

      {/* Target Progress Card */}
      <div className="ts-card ts-white ts-tbl space-y-4">
        <div className="ts-phead !mb-2 justify-between">
          <div>
            <h2 className="m-0 text-[15px] font-medium text-fg">Annual Target Progress ({fiscalYear})</h2>
            <p className="text-xs text-subtle">Confirmed sales achievement vs allocated annual sales target.</p>
          </div>
          <span className="text-xl font-bold text-fg">{pct.toFixed(1)}% Achieved</span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-subtle">
            <span>Confirmed: ₹{(performance?.confirmed_sales_amount || 0).toLocaleString('en-IN')}</span>
            <span>Target: ₹{(performance?.target_amount || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="w-full bg-surface border border-line2 rounded-full h-3 overflow-hidden">
            <div
              className="bg-ink h-full transition-all duration-500"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {performance?.shortfall_amount && performance.shortfall_amount > 0 ? (
            <p className="text-xs text-bad font-mono text-right">
              Shortfall to Target: ₹{performance.shortfall_amount.toLocaleString('en-IN')}
            </p>
          ) : (
            <p className="text-xs text-good font-mono text-right">Target Achieved / Exceeded!</p>
          )}
        </div>

        {/* Breakdown Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
          <div className="bg-surface p-3 rounded-lg border border-line2">
            <span className="text-[10px] uppercase text-subtle block">Total Quotations</span>
            <span className="text-lg font-bold text-fg">{performance?.quotation_count || 0}</span>
            <span className="text-xs font-mono text-fg block">
              ₹{(performance?.quoted_amount || 0).toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-surface p-3 rounded-lg border border-line2">
            <span className="text-[10px] uppercase text-subtle block">Accepted Proposals</span>
            <span className="text-lg font-bold text-fg">{performance?.accepted_quotation_count || 0}</span>
            <span className="text-xs font-mono text-fg block">
              ₹{(performance?.accepted_quotation_amount || 0).toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-surface p-3 rounded-lg border border-line2">
            <span className="text-[10px] uppercase text-subtle block">Confirmed Sales</span>
            <span className="text-lg font-bold text-fg">{performance?.confirmed_sales_count || 0}</span>
            <span className="text-xs font-mono text-good block font-bold">
              ₹{(performance?.confirmed_sales_amount || 0).toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-surface p-3 rounded-lg border border-line2">
            <span className="text-[10px] uppercase text-subtle block">Status</span>
            <span className="text-lg font-bold text-fg">{performance?.status || 'NO TARGET'}</span>
          </div>
        </div>
      </div>

      {/* Target Management Form */}
      <div className="ts-card ts-white ts-tbl mb-6">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-4 pb-2 border-dashed border-line2 border-b">
          Update Sales Target for {fiscalYear}
        </h2>
        <form onSubmit={handleSaveTarget} className="flex flex-col sm:flex-row items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs uppercase font-semibold text-subtle mb-1">
              Target Amount (₹)
            </label>
            <input
              type="number"
              required
              min="0"
              step="50000"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="ts-fi"
            />
          </div>
          <button
            type="submit"
            disabled={savingTarget}
            className="ts-btn ts-dark"
          >
            {savingTarget ? 'Saving...' : 'Save Target'}
          </button>
        </form>
      </div>

      {/* Step 2B — Follow-up Workload & Opportunity Performance */}
      <EngineerFollowUpSection engineerId={engineerId} />
    </div>
  );
}

function EngineerFollowUpSection({ engineerId }: { engineerId: number }) {
  const [fuPerf, setFuPerf] = useState<any>(null);

  useEffect(() => {
    import('../api').then(({ fetchEngineerFollowUpPerformance }) => {
      fetchEngineerFollowUpPerformance(engineerId).then(setFuPerf).catch(console.error);
    });
  }, [engineerId]);

  if (!fuPerf) return <div className="text-xs text-faint">Loading follow-up workload...</div>;

  return (
    <div className="ts-card ts-white ts-tbl space-y-4">
      <h2 className="m-0 text-[15px] font-medium text-fg pb-2 border-dashed border-line2 border-b">
        Follow-Up Performance & Opportunity Workload
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Due Today</span>
          <span className="text-xl font-bold text-warn">{fuPerf.due_today_count}</span>
        </div>
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Overdue</span>
          <span className="text-xl font-bold text-bad">{fuPerf.overdue_count}</span>
        </div>
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Upcoming</span>
          <span className="text-xl font-bold text-fg">{fuPerf.upcoming_count}</span>
        </div>
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Done This Month</span>
          <span className="text-xl font-bold text-fg">{fuPerf.completed_this_month_count}</span>
        </div>
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Open Quotations</span>
          <span className="text-xl font-bold text-fg">{fuPerf.open_quotations_count}</span>
        </div>
        <div className="bg-surface p-3 rounded-lg border border-line2">
          <span className="text-[10px] uppercase text-subtle block">Stale Quotations</span>
          <span className="text-xl font-bold text-warn">{fuPerf.stale_quotations_count}</span>
        </div>
      </div>

      <div className="pt-2">
        <h3 className="text-xs font-semibold text-subtle uppercase mb-2">Assigned Follow-ups</h3>
        <div className="ts-tblwrap">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-line2 text-subtle">
                <th>Date</th>
                <th>Customer</th>
                <th>Quotation</th>
                <th className="text-center">Priority</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fuPerf.follow_ups?.map((f: any) => (
                <tr key={f.id}>
                  <td className="p-2 text-fg">{f.follow_up_date}</td>
                  <td className="p-2 text-subtle">{f.customer_name || 'N/A'}</td>
                  <td className="p-2 font-bold text-fg">
                    <Link to={`/quotations/${f.quotation_id}`}>{f.quotation_number}</Link>
                  </td>
                  <td className="p-2 text-center">
                    <span className={`badge ${f.priority === 'HIGH' || f.priority === 'URGENT' ? 'danger' : 'secondary'}`}>
                      {f.priority}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className="badge warning">{f.status}</span>
                  </td>
                  <td className="p-2 text-subtle">{f.notes || '-'}</td>
                </tr>
              ))}
              {(!fuPerf.follow_ups || fuPerf.follow_ups.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-faint">
                    No follow-ups recorded for this sales engineer.
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

