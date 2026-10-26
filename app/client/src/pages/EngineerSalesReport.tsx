import { useEffect, useState } from 'react';
import { api, EngineerPerformanceSummary } from '../api';

export default function EngineerSalesReport() {
  const [fiscalYear, setFiscalYear] = useState('2026-27');
  const [performance, setPerformance] = useState<EngineerPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.engineers
      .performance(fiscalYear)
      .then(setPerformance)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fiscalYear]);

  return (
    <div className="w-full max-w-7xl space-y-6 px-4 tablet-lg:px-6 pt-2">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line2">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Engineer Sales & Target Report</h1>
          <p className="text-sm text-subtle mt-1">
            Year-end annual sales engineer performance report and target achievement summary.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="h-9 bg-surface2 border border-line2 rounded-lg px-3 text-xs text-fg focus:outline-none focus:border-fg"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>

          <a
            href={api.export.engineersPerformanceUrl(fiscalYear)}
            download
            className="h-9 px-4 bg-surface2 hover:bg-tile text-good border border-line2 rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Export Excel</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-bad/10 border border-bad/30 rounded-xl text-bad text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface2 border border-line2 rounded-xl p-4">
            <span className="text-xs text-subtle uppercase tracking-wider block font-medium">Annual Sales Target</span>
            <span className="text-2xl font-bold text-fg mt-1 block font-mono">
              ₹{performance.summary.total_target.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-surface2 border border-line2 rounded-xl p-4">
            <span className="text-xs text-subtle uppercase tracking-wider block font-medium">Total Quoted Value</span>
            <span className="text-2xl font-bold text-fg mt-1 block font-mono">
              ₹{performance.summary.total_quoted.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-surface2 border border-line2 rounded-xl p-4">
            <span className="text-xs text-subtle uppercase tracking-wider block font-medium">Confirmed Sales Achieved</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="text-2xl font-bold text-good mt-1 block font-mono">
                ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
              </span>
            ) : (
              <span className="text-sm font-semibold text-faint mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                Not tracked yet
              </span>
            )}
          </div>

          <div className="bg-surface2 border border-line2 rounded-xl p-4">
            <span className="text-xs text-subtle uppercase tracking-wider block font-medium">Team Achievement Rate</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="text-2xl font-bold text-fg mt-1 block">
                {performance.summary.overall_achievement_pct.toFixed(1)}%
              </span>
            ) : (
              <span className="text-sm font-semibold text-faint mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                —
              </span>
            )}
          </div>
        </div>
      )}

      {/* Report Table */}
      <div className="bg-surface2 border border-line2 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-line2 flex justify-between items-center">
          <h2 className="text-base font-semibold text-fg">Sales Engineer Performance Breakdown</h2>
          <span className="text-xs font-mono text-subtle">{fiscalYear}</span>
        </div>
        {performance && !performance.summary.confirmed_sales_available && (
          <p className="px-4 pb-3 text-xs text-faint">
            Confirmed sales figures require the Sale Reports feature, which isn't available yet. Quoted and accepted quotation totals below are all-time figures, not scoped to the selected fiscal year.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs font-semibold text-subtle uppercase tracking-wider border-b border-line2">
              <tr>
                <th className="px-4 py-3">Code / Engineer</th>
                <th className="px-4 py-3 text-right">Target (₹)</th>
                <th className="px-4 py-3 text-right">Quoted (₹)</th>
                <th className="px-4 py-3 text-right">Accepted (₹)</th>
                <th className="px-4 py-3 text-right">Confirmed Sales (₹)</th>
                <th className="px-4 py-3 text-right">Achieved %</th>
                <th className="px-4 py-3 text-right">Shortfall (₹)</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line2 text-fg">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-subtle text-xs">
                    Loading report data...
                  </td>
                </tr>
              ) : !performance || performance.engineers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-subtle text-xs">
                    No engineer performance data recorded for {fiscalYear}.
                  </td>
                </tr>
              ) : (
                performance.engineers.map((eng) => {
                  const confirmedAvailable = performance.summary.confirmed_sales_available;
                  let badgeColor = 'bg-subtle/10 text-subtle border-line2';
                  if (confirmedAvailable) {
                    if (eng.status === 'EXCEEDED') badgeColor = 'bg-good/10 text-good border-good/30';
                    else if (eng.status === 'ON_TRACK') badgeColor = 'bg-ink/10 text-fg border-fg/30';
                    else if (eng.status === 'BEHIND') badgeColor = 'bg-bad/10 text-bad border-bad/30';
                  }

                  return (
                    <tr key={eng.engineer_id} className="hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-fg block">{eng.name}</span>
                        <span className="text-xs text-subtle font-mono">{eng.code}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-fg">
                        ₹{eng.target_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-fg">
                        ₹{eng.quoted_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-fg">
                        ₹{eng.accepted_quotation_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-fg">
                        {performance?.summary.confirmed_sales_available ? `₹${eng.confirmed_sales_amount.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-fg">
                        {confirmedAvailable ? `${eng.achievement_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-bad">
                        {confirmedAvailable ? (eng.shortfall_amount > 0 ? `₹${eng.shortfall_amount.toLocaleString('en-IN')}` : '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`} title={!confirmedAvailable ? "Confirmed sales come from the Sale Reports feature, which isn't available yet." : undefined}>
                          {confirmedAvailable ? eng.status : 'Not tracked'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
