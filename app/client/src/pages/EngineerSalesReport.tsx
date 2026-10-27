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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Page Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Engineer Sales & Target Report</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Year-end annual sales engineer performance report and target achievement summary.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="ts-fi ts-sel"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>

          <a
            href={api.export.engineersPerformanceUrl(fiscalYear)}
            download
            className="ts-btn ts-ghost ts-xs"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Export Excel</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Annual Sales Target</span>
            <span className="ts-val num block text-fg">
              ₹{performance.summary.total_target.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Total Quoted Value</span>
            <span className="ts-val num block text-fg">
              ₹{performance.summary.total_quoted.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Confirmed Sales Achieved</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="ts-val num block text-good">
                ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
              </span>
            ) : (
              <span className="text-sm font-semibold text-faint mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                Not tracked yet
              </span>
            )}
          </div>

          <div className="ts-card ts-white ts-tbl">
            <span className="text-[13.5px] text-subtle block">Team Achievement Rate</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="ts-val num block text-fg">
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
      <div className="ts-card ts-white ts-tbl overflow-hidden">
        <div className="p-4 border-b border-line2 flex justify-between items-center">
          <h2 className="m-0 text-[15px] font-medium text-fg">Sales Engineer Performance Breakdown</h2>
          <span className="text-xs font-mono text-subtle">{fiscalYear}</span>
        </div>
        {performance && !performance.summary.confirmed_sales_available && (
          <p className="px-4 pb-3 text-xs text-faint">
            Confirmed sales figures require the Sale Reports feature, which isn't available yet. Quoted and accepted quotation totals below are all-time figures, not scoped to the selected fiscal year.
          </p>
        )}
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Code / Engineer</th>
                <th className="ts-r">Target (₹)</th>
                <th className="ts-r">Quoted (₹)</th>
                <th className="ts-r">Accepted (₹)</th>
                <th className="ts-r">Confirmed Sales (₹)</th>
                <th className="ts-r">Achieved %</th>
                <th className="ts-r">Shortfall (₹)</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
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
                  let badgeColor = '';
                  if (confirmedAvailable) {
                    if (eng.status === 'EXCEEDED') badgeColor = 'ts-tone-good';
                    else if (eng.status === 'ON_TRACK') badgeColor = 'ts-tone-good';
                    else if (eng.status === 'BEHIND') badgeColor = 'ts-tone-bad';
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
                        <span className={`ts-st ${badgeColor}`} title={!confirmedAvailable ? "Confirmed sales come from the Sale Reports feature, which isn't available yet." : undefined}>
                          {confirmedAvailable ? String(eng.status).replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase()) : 'Not tracked'}
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
