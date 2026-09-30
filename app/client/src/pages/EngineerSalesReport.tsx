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
    <div className="space-y-6 max-w-7xl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E8F2]">
        <div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">Engineer Sales & Target Report</h1>
          <p className="text-sm text-[#7A839E] mt-1">
            Year-end annual sales engineer performance report and target achievement summary.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3 py-2 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>

          <a
            href={api.export.engineersPerformanceUrl(fiscalYear)}
            download
            className="px-4 py-2 bg-[#FFFFFF] hover:bg-[#E4E8F2] text-[#2FBF71] border border-[#E4E8F2] rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Export Excel</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-xl text-[#E5484D] text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Annual Sales Target</span>
            <span className="text-2xl font-bold text-[#141B34] mt-1 block font-mono">
              ₹{performance.summary.total_target.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Total Quoted Value</span>
            <span className="text-2xl font-bold text-[#3B6FD4] mt-1 block font-mono">
              ₹{performance.summary.total_quoted.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Confirmed Sales Achieved</span>
            <span className="text-2xl font-bold text-[#2FBF71] mt-1 block font-mono">
              ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Team Achievement Rate</span>
            <span className="text-2xl font-bold text-[#3B6FD4] mt-1 block">
              {performance.summary.overall_achievement_pct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Report Table */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#E4E8F2] flex justify-between items-center">
          <h2 className="text-base font-semibold text-[#141B34]">Sales Engineer Performance Breakdown</h2>
          <span className="text-xs font-mono text-[#7A839E]">{fiscalYear}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F4F6FC] text-xs font-semibold text-[#7A839E] uppercase tracking-wider border-b border-[#E4E8F2]">
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
            <tbody className="divide-y divide-[#E4E8F2] text-[#141B34]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#7A839E] text-xs">
                    Loading report data...
                  </td>
                </tr>
              ) : !performance || performance.engineers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#7A839E] text-xs">
                    No engineer performance data recorded for {fiscalYear}.
                  </td>
                </tr>
              ) : (
                performance.engineers.map((eng) => {
                  let badgeColor = 'bg-[#7A839E]/10 text-[#7A839E] border-[#7A839E]/30';
                  if (eng.status === 'EXCEEDED') badgeColor = 'bg-[#2FBF71]/10 text-[#2FBF71] border-[#2FBF71]/30';
                  else if (eng.status === 'ON_TRACK') badgeColor = 'bg-[#3B6FD4]/10 text-[#3B6FD4] border-[#3B6FD4]/30';
                  else if (eng.status === 'BEHIND') badgeColor = 'bg-[#E5484D]/10 text-[#E5484D] border-[#E5484D]/30';

                  return (
                    <tr key={eng.engineer_id} className="hover:bg-[#F4F6FC]/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-[#141B34] block">{eng.name}</span>
                        <span className="text-xs text-[#7A839E] font-mono">{eng.code}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-[#141B34]">
                        ₹{eng.target_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#3B6FD4]">
                        ₹{eng.quoted_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#3B6FD4]">
                        ₹{eng.accepted_quotation_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#2FBF71] font-bold">
                        ₹{eng.confirmed_sales_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-[#141B34]">
                        {eng.achievement_pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#E5484D]">
                        {eng.shortfall_amount > 0 ? `₹${eng.shortfall_amount.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
                          {eng.status}
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
