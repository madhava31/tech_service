import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesEngineer, EngineerPerformanceSummary, EngineerPerformance } from '../api';

export default function EngineerList() {
  const [engineers, setEngineers] = useState<SalesEngineer[]>([]);
  const [performance, setPerformance] = useState<EngineerPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [fiscalYear, setFiscalYear] = useState('2026-27');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [savingEngineer, setSavingEngineer] = useState(false);

  const [targetModalEngineer, setTargetModalEngineer] = useState<SalesEngineer | null>(null);
  const [targetAmountInput, setTargetAmountInput] = useState<number | string>('');
  const [savingTarget, setSavingTarget] = useState(false);

  function loadData() {
    setLoading(true);
    setError('');
    Promise.all([
      api.engineers.list(),
      api.engineers.performance(fiscalYear),
    ])
      .then(([engList, perfData]) => {
        setEngineers(engList);
        setPerformance(perfData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [fiscalYear]);

  async function handleCreateEngineer(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSavingEngineer(true);
    try {
      await api.engineers.create({
        code: newCode.trim(),
        name: newName.trim(),
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
      });
      setShowAddModal(false);
      setNewCode('');
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingEngineer(false);
    }
  }

  async function handleSetTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!targetModalEngineer || !targetAmountInput) return;
    setSavingTarget(true);
    try {
      await api.engineers.setTarget({
        engineer_id: targetModalEngineer.id,
        fiscal_year: fiscalYear,
        target_amount: Number(targetAmountInput),
      });
      setTargetModalEngineer(null);
      setTargetAmountInput('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTarget(false);
    }
  }

  const perfMap = new Map<number, EngineerPerformance>();
  performance?.engineers.forEach((p) => perfMap.set(p.engineer_id, p));

  return (
    <div className="w-full max-w-7xl space-y-6 px-4 tablet-lg:px-6 pt-2">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E4E8F2]">
        <div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">Sales Engineers & Target Management</h1>
          <p className="text-sm text-[#7A839E] mt-1">
            Track sales team attribution, annual target achievements, and revenue performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="h-9 bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
          >
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>

          <a
            href={api.export.engineersPerformanceUrl(fiscalYear)}
            download
            className="h-9 px-4 bg-[#FFFFFF] hover:bg-[#E4E8F2] text-[#2FBF71] border border-[#E4E8F2] rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Export Excel</span>
          </a>

          <button
            onClick={() => setShowAddModal(true)}
            className="h-9 px-4 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-xs transition-colors shadow-sm inline-flex items-center space-x-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Sales Engineer</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-xl text-[#E5484D] text-sm">
          {error}
        </div>
      )}

      {/* Overview Cards */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Sales Engineers</span>
            <span className="text-2xl font-bold text-[#141B34] mt-1 block">{performance.summary.total_engineers}</span>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Total Target ({fiscalYear})</span>
            <span className="text-2xl font-bold text-[#141B34] mt-1 block font-mono">
              ₹{performance.summary.total_target.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Total Quoted</span>
            <span className="text-2xl font-bold text-[#3B6FD4] mt-1 block font-mono">
              ₹{performance.summary.total_quoted.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Confirmed Sales</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="text-2xl font-bold text-[#2FBF71] mt-1 block font-mono">
                ₹{performance.summary.total_confirmed.toLocaleString('en-IN')}
              </span>
            ) : (
              <span className="text-sm font-semibold text-[#A8AEC4] mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                Not tracked yet
              </span>
            )}
          </div>
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-4">
            <span className="text-xs text-[#7A839E] uppercase tracking-wider block font-medium">Overall Achievement</span>
            {performance.summary.confirmed_sales_available ? (
              <span className="text-2xl font-bold text-[#3B6FD4] mt-1 block">
                {performance.summary.overall_achievement_pct.toFixed(1)}%
              </span>
            ) : (
              <span className="text-sm font-semibold text-[#A8AEC4] mt-1 block" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                —
              </span>
            )}
          </div>
        </div>
      )}

      {/* Engineer Table */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F4F6FC] text-xs font-semibold text-[#7A839E] uppercase tracking-wider border-b border-[#E4E8F2]">
              <tr>
                <th className="px-4 py-3">Code / Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">FY Target (₹)</th>
                <th className="px-4 py-3 text-right">Quoted (₹)</th>
                <th className="px-4 py-3 text-right">Confirmed Sales (₹)</th>
                <th className="px-4 py-3 text-right">Achievement %</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E8F2] text-[#141B34]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#7A839E] text-xs">
                    Loading sales engineers...
                  </td>
                </tr>
              ) : engineers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#7A839E] text-xs">
                    No sales engineers found. Click "Add Sales Engineer" to create one.
                  </td>
                </tr>
              ) : (
                engineers.map((eng) => {
                  const perf = perfMap.get(eng.id);
                  const targetVal = perf?.target_amount || 0;
                  const confirmedVal = perf?.confirmed_sales_amount || 0;
                  const quotedVal = perf?.quoted_amount || 0;
                  const pct = perf?.achievement_pct || 0;
                  const confirmedAvailable = performance?.summary.confirmed_sales_available ?? false;

                  let statusBadge = 'bg-[#7A839E]/10 text-[#7A839E] border-[#7A839E]/30';
                  let statusLabel = 'NO TARGET';

                  if (!confirmedAvailable) {
                    statusLabel = 'NOT TRACKED';
                  } else if (perf?.status === 'EXCEEDED') {
                    statusBadge = 'bg-[#2FBF71]/10 text-[#2FBF71] border-[#2FBF71]/30';
                    statusLabel = 'EXCEEDED';
                  } else if (perf?.status === 'ON_TRACK') {
                    statusBadge = 'bg-[#3B6FD4]/10 text-[#3B6FD4] border-[#3B6FD4]/30';
                    statusLabel = 'ON TRACK';
                  } else if (perf?.status === 'BEHIND') {
                    statusBadge = 'bg-[#E5484D]/10 text-[#E5484D] border-[#E5484D]/30';
                    statusLabel = 'BEHIND';
                  }

                  return (
                    <tr key={eng.id} className="hover:bg-[#F4F6FC]/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/sales/engineers/${eng.id}`} className="font-semibold text-[#141B34] hover:text-[#3B6FD4] block">
                          {eng.name}
                        </Link>
                        <span className="text-xs text-[#7A839E] font-mono">{eng.code}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7A839E]">
                        <div>{eng.email || '—'}</div>
                        <div>{eng.phone || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-[#141B34]">
                        ₹{targetVal.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#3B6FD4]">
                        ₹{quotedVal.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#141B34]">
                        {performance?.summary.confirmed_sales_available ? `₹${confirmedVal.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {confirmedAvailable ? (
                          <div className="flex items-center justify-end space-x-2">
                            <div className="w-16 bg-[#F4F6FC] border border-[#E4E8F2] rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-[#3B6FD4] h-full transition-all"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-[#141B34]">{pct.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-[#A8AEC4]" title="Confirmed sales come from the Sale Reports feature, which isn't available yet.">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusBadge}`} title={!confirmedAvailable ? "Confirmed sales come from the Sale Reports feature, which isn't available yet." : undefined}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => {
                            setTargetModalEngineer(eng);
                            setTargetAmountInput(targetVal > 0 ? targetVal : '');
                          }}
                          className="px-2.5 py-1 bg-[#F4F6FC] hover:bg-[#E4E8F2] text-[#3B6FD4] border border-[#E4E8F2] rounded text-xs transition-colors cursor-pointer"
                        >
                          Set Target
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Engineer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#141B34]/40 flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6 w-full max-w-md space-y-4 shadow-card">
            <div className="flex justify-between items-center border-b border-[#E4E8F2] pb-3">
              <h3 className="text-lg font-bold text-[#141B34]">Add Sales Engineer</h3>
              <button onClick={() => setShowAddModal(false)} className="text-[#7A839E] hover:text-[#141B34]">✕</button>
            </div>
            <form onSubmit={handleCreateEngineer} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Engineer Code *</label>
                <input
                  type="text"
                  required
                  placeholder="ENG-005"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Vijay Kumar"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Email</label>
                <input
                  type="email"
                  placeholder="vijay@technicon.in"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Phone</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-[#F4F6FC] text-[#7A839E] border border-[#E4E8F2] rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEngineer}
                  className="px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] font-semibold rounded-lg text-xs"
                >
                  {savingEngineer ? 'Saving...' : 'Create Engineer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Target Set Modal */}
      {targetModalEngineer && (
        <div className="fixed inset-0 z-50 bg-[#141B34]/40 flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6 w-full max-w-md space-y-4 shadow-card">
            <div className="flex justify-between items-center border-b border-[#E4E8F2] pb-3">
              <h3 className="text-lg font-bold text-[#141B34]">Set Annual Target for {targetModalEngineer.name}</h3>
              <button onClick={() => setTargetModalEngineer(null)} className="text-[#7A839E] hover:text-[#141B34]">✕</button>
            </div>
            <form onSubmit={handleSetTarget} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Fiscal Year</label>
                <input
                  type="text"
                  disabled
                  value={fiscalYear}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#7A839E]"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-[#7A839E] mb-1">Annual Sales Target (₹) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="10000"
                  placeholder="5000000"
                  value={targetAmountInput}
                  onChange={(e) => setTargetAmountInput(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] font-mono"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetModalEngineer(null)}
                  className="px-4 py-2 bg-[#F4F6FC] text-[#7A839E] border border-[#E4E8F2] rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTarget}
                  className="px-4 py-2 bg-[#3B6FD4] text-[#F4F6FC] font-semibold rounded-lg text-xs"
                >
                  {savingTarget ? 'Saving Target...' : 'Save Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
