import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Firm, Branch } from '../api';

export default function MultiFirmSettings() {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Firm modal
  const [showFirmModal, setShowFirmModal] = useState(false);
  const [firmName, setFirmName] = useState('');
  const [firmCode, setFirmCode] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [savingFirm, setSavingFirm] = useState(false);

  // Branch modal
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [selectedFirmId, setSelectedFirmId] = useState<number | ''>('');
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchCity, setBranchCity] = useState('');
  const [branchState, setBranchState] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchEmail, setBranchEmail] = useState('');
  const [savingBranch, setSavingBranch] = useState(false);

  function loadData() {
    setLoading(true);
    setError('');
    Promise.all([api.firms.list(), api.firms.branches()])
      .then(([fList, bList]) => {
        setFirms(fList);
        setBranches(bList);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateFirm(e: React.FormEvent) {
    e.preventDefault();
    if (!firmName.trim() || !firmCode.trim()) return;
    setSavingFirm(true);
    try {
      await api.firms.create({
        name: firmName.trim(),
        code: firmCode.trim().toUpperCase(),
        legal_name: legalName.trim() || null,
        gstin: gstin.trim() || null,
        pan: pan.trim() || null,
      });
      setShowFirmModal(false);
      setFirmName('');
      setFirmCode('');
      setLegalName('');
      setGstin('');
      setPan('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingFirm(false);
    }
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFirmId || !branchName.trim() || !branchCode.trim()) return;
    setSavingBranch(true);
    try {
      await api.firms.createBranch({
        firm_id: Number(selectedFirmId),
        name: branchName.trim(),
        code: branchCode.trim().toUpperCase(),
        address: branchAddress.trim() || null,
        city: branchCity.trim() || null,
        state: branchState.trim() || null,
        phone: branchPhone.trim() || null,
        email: branchEmail.trim() || null,
      });
      setShowBranchModal(false);
      setBranchName('');
      setBranchCode('');
      setBranchAddress('');
      setBranchCity('');
      setBranchState('');
      setBranchPhone('');
      setBranchEmail('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingBranch(false);
    }
  }

  return (
    <div className="w-full max-w-6xl space-y-6 px-4 tablet-lg:px-6 pt-2">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line2">
        <div>
          <h1 className="ts-title">Multi-Firm & Branch Setup</h1>
          <p className="text-sm text-subtle mt-1">
            Manage legal entities, operational branches, and branch-specific document print settings.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFirmModal(true)}
            className="px-4 py-2 bg-surface2 hover:bg-tile text-fg border border-line2 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            + Add Legal Firm
          </button>
          <button
            onClick={() => {
              if (firms.length > 0) setSelectedFirmId(firms[0].id);
              setShowBranchModal(true);
            }}
            className="px-4 py-2 bg-ink hover:bg-ink/85 text-onink font-semibold rounded-lg text-xs transition-colors shadow-sm cursor-pointer"
          >
            + Add Branch
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-bad/10 border border-bad/30 rounded-xl text-bad text-sm">
          {error}
        </div>
      )}

      {/* Firms List */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-6 text-center text-subtle text-xs bg-surface2 rounded-xl border border-line2">
            Loading firm entities...
          </div>
        ) : firms.length === 0 ? (
          <div className="p-6 text-center text-subtle text-xs bg-surface2 rounded-xl border border-line2">
            No firms configured. Click "Add Legal Firm" to start.
          </div>
        ) : (
          firms.map((firm) => {
            const firmBranches = branches.filter((b) => b.firm_id === firm.id);
            return (
              <div key={firm.id} className="bg-surface2 border border-line2 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line2 pb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h2 className="text-lg font-bold text-fg">{firm.name}</h2>
                      <span className="px-2 py-0.5 bg-surface text-fg border border-line2 font-mono text-xs rounded font-bold">
                        {firm.code}
                      </span>
                      {firm.is_default === 1 && (
                        <span className="px-2 py-0.5 bg-good/10 text-good border border-good/30 text-[10px] rounded font-semibold">
                          DEFAULT HQ
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-subtle mt-0.5">
                      Legal: {firm.legal_name || '—'} | GSTIN: {firm.gstin || '—'} | PAN: {firm.pan || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFirmId(firm.id);
                      setShowBranchModal(true);
                    }}
                    className="px-3 py-1.5 bg-surface hover:bg-tile text-fg border border-line2 rounded text-xs font-semibold cursor-pointer"
                  >
                    + Add Branch to {firm.code}
                  </button>
                </div>

                {/* Branches List */}
                <div className="space-y-2">
                  <h3 className="text-xs uppercase font-semibold text-subtle tracking-wider">
                    Branches ({firmBranches.length})
                  </h3>
                  {firmBranches.length === 0 ? (
                    <p className="text-xs text-subtle">No branches created under this firm.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {firmBranches.map((b) => (
                        <div key={b.id} className="bg-surface border border-line2 rounded-lg p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-fg text-sm">{b.name}</span>
                              <span className="text-xs font-mono text-fg bg-surface2 px-1.5 py-0.5 rounded border border-line2">
                                {b.code}
                              </span>
                              {b.is_default === 1 && (
                                <span className="text-[10px] text-good font-mono">DEFAULT</span>
                              )}
                            </div>
                            <Link
                              to={`/settings/multi-firm/branches/${b.id}/documents`}
                              className="text-xs text-fg hover:underline font-semibold"
                            >
                              Print Settings →
                            </Link>
                          </div>
                          <div className="text-xs text-subtle space-y-0.5">
                            <div>Address: {b.address || '—'}, {b.city || '—'} {b.state || '—'}</div>
                            <div>Contact: {b.phone || '—'} | {b.email || '—'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Firm Modal */}
      {showFirmModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-surface2 border border-line2 rounded-xl p-6 w-full max-w-md space-y-4 shadow-card">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <h3 className="text-lg font-bold text-fg">Add Legal Firm Entity</h3>
              <button onClick={() => setShowFirmModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleCreateFirm} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Firm Name *</label>
                <input
                  type="text"
                  required
                  placeholder="TECHNICON SERVICES"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value)}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Firm Code *</label>
                <input
                  type="text"
                  required
                  placeholder="TECH-HQ"
                  value={firmCode}
                  onChange={(e) => setFirmCode(e.target.value)}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg uppercase font-mono"
                />
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Legal Registered Name</label>
                <input
                  type="text"
                  placeholder="Technicon Services Pvt. Ltd."
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">GSTIN</label>
                  <input
                    type="text"
                    placeholder="36AAAAA0000A1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">PAN</label>
                  <input
                    type="text"
                    placeholder="AAAAA0000A"
                    value={pan}
                    onChange={(e) => setPan(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg uppercase font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFirmModal(false)}
                  className="px-4 py-2 bg-surface text-subtle border border-line2 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFirm}
                  className="px-4 py-2 bg-ink text-onink font-semibold rounded-lg text-xs"
                >
                  {savingFirm ? 'Saving...' : 'Create Firm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Branch Modal */}
      {showBranchModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
          <div className="bg-surface2 border border-line2 rounded-xl p-6 w-full max-w-md space-y-4 shadow-card">
            <div className="flex justify-between items-center border-b border-line2 pb-3">
              <h3 className="text-lg font-bold text-fg">Add Branch</h3>
              <button onClick={() => setShowBranchModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Select Legal Firm *</label>
                <select
                  required
                  value={selectedFirmId}
                  onChange={(e) => setSelectedFirmId(Number(e.target.value))}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                >
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">Branch Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Bangalore Office"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">Branch Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="BLR-BRANCH"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg uppercase font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase font-semibold text-subtle mb-1">Address</label>
                <input
                  type="text"
                  placeholder="123 Industrial Suburb, Peenya"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">City</label>
                  <input
                    type="text"
                    placeholder="Bengaluru"
                    value={branchCity}
                    onChange={(e) => setBranchCity(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">State</label>
                  <input
                    type="text"
                    placeholder="Karnataka"
                    value={branchState}
                    onChange={(e) => setBranchState(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">Phone</label>
                  <input
                    type="text"
                    placeholder="+91 80 1234 5678"
                    value={branchPhone}
                    onChange={(e) => setBranchPhone(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase font-semibold text-subtle mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="blr@technicon.in"
                    value={branchEmail}
                    onChange={(e) => setBranchEmail(e.target.value)}
                    className="w-full bg-surface border border-line2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-fg"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  className="px-4 py-2 bg-surface text-subtle border border-line2 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBranch}
                  className="px-4 py-2 bg-ink text-onink font-semibold rounded-lg text-xs"
                >
                  {savingBranch ? 'Saving...' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
