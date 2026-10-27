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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Page Header */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Multi-Firm & Branch Setup</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Manage legal entities, operational branches, and branch-specific document print settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFirmModal(true)}
            className="ts-btn ts-ghost ts-xs"
          >
            + Add Legal Firm
          </button>
          <button
            onClick={() => {
              if (firms.length > 0) setSelectedFirmId(firms[0].id);
              setShowBranchModal(true);
            }}
            className="ts-btn ts-dark ts-xs"
          >
            + Add Branch
          </button>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* Firms List */}
      <div className="space-y-4">
        {loading ? (
          <div className="ts-card ts-empty">
            Loading firm entities...
          </div>
        ) : firms.length === 0 ? (
          <div className="ts-card ts-empty">
            No firms configured. Click "Add Legal Firm" to start.
          </div>
        ) : (
          firms.map((firm) => {
            const firmBranches = branches.filter((b) => b.firm_id === firm.id);
            return (
              <div key={firm.id} className="ts-card ts-white ts-tbl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-dashed border-line2 pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="m-0 text-[15px] font-medium text-fg">{firm.name}</h2>
                      <span className="ts-st num">
                        {firm.code}
                      </span>
                      {firm.is_default === 1 && (
                        <span className="ts-st ts-tone-good">
                          DEFAULT HQ
                        </span>
                      )}
                    </div>
                    <p className="ts-muted m-0 mt-1.5 text-[14px]">
                      Legal: {firm.legal_name || '—'} | GSTIN: {firm.gstin || '—'} | PAN: {firm.pan || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFirmId(firm.id);
                      setShowBranchModal(true);
                    }}
                    className="ts-btn ts-ghost ts-xs"
                  >
                    + Add Branch to {firm.code}
                  </button>
                </div>

                {/* Branches List */}
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium text-subtle">
                    Branches ({firmBranches.length})
                  </h3>
                  {firmBranches.length === 0 ? (
                    <p className="text-[13px] text-subtle">No branches created under this firm.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {firmBranches.map((b) => (
                        <div key={b.id} className="bg-tile rounded-[14px] p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-fg text-sm">{b.name}</span>
                              <span className="ts-st num">
                                {b.code}
                              </span>
                              {b.is_default === 1 && (
                                <span className="text-[12px] text-good num">DEFAULT</span>
                              )}
                            </div>
                            <Link
                              to={`/settings/multi-firm/branches/${b.id}/documents`}
                              className="text-[13px] text-fg hover:underline font-medium"
                            >
                              Print Settings →
                            </Link>
                          </div>
                          <div className="text-[13px] text-subtle space-y-0.5">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-card ts-white ts-tbl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center gap-3">
              <h3 className="m-0 text-[15px] font-medium text-fg">Add Legal Firm Entity</h3>
              <button onClick={() => setShowFirmModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleCreateFirm} className="space-y-4">
              <div>
                <label className="ts-lbl">Firm Name *</label>
                <input
                  type="text"
                  required
                  placeholder="TECHNICON SERVICES"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="ts-lbl">Firm Code *</label>
                <input
                  type="text"
                  required
                  placeholder="TECH-HQ"
                  value={firmCode}
                  onChange={(e) => setFirmCode(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div>
                <label className="ts-lbl">Legal Registered Name</label>
                <input
                  type="text"
                  placeholder="Technicon Services Pvt. Ltd."
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">GSTIN</label>
                  <input
                    type="text"
                    placeholder="36AAAAA0000A1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="ts-fi"
                  />
                </div>
                <div>
                  <label className="ts-lbl">PAN</label>
                  <input
                    type="text"
                    placeholder="AAAAA0000A"
                    value={pan}
                    onChange={(e) => setPan(e.target.value)}
                    className="ts-fi"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFirmModal(false)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFirm}
                  className="ts-btn ts-dark ts-xs"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="ts-card ts-white ts-tbl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center gap-3">
              <h3 className="m-0 text-[15px] font-medium text-fg">Add Branch</h3>
              <button onClick={() => setShowBranchModal(false)} className="text-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div>
                <label className="ts-lbl">Select Legal Firm *</label>
                <select
                  required
                  value={selectedFirmId}
                  onChange={(e) => setSelectedFirmId(Number(e.target.value))}
                  className="ts-fi"
                >
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">Branch Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Bangalore Office"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="ts-fi"
                  />
                </div>
                <div>
                  <label className="ts-lbl">Branch Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="BLR-BRANCH"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    className="ts-fi"
                  />
                </div>
              </div>
              <div>
                <label className="ts-lbl">Address</label>
                <input
                  type="text"
                  placeholder="123 Industrial Suburb, Peenya"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="ts-fi"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">City</label>
                  <input
                    type="text"
                    placeholder="Bengaluru"
                    value={branchCity}
                    onChange={(e) => setBranchCity(e.target.value)}
                    className="ts-fi"
                  />
                </div>
                <div>
                  <label className="ts-lbl">State</label>
                  <input
                    type="text"
                    placeholder="Karnataka"
                    value={branchState}
                    onChange={(e) => setBranchState(e.target.value)}
                    className="ts-fi"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ts-lbl">Phone</label>
                  <input
                    type="text"
                    placeholder="+91 80 1234 5678"
                    value={branchPhone}
                    onChange={(e) => setBranchPhone(e.target.value)}
                    className="ts-fi"
                  />
                </div>
                <div>
                  <label className="ts-lbl">Email</label>
                  <input
                    type="email"
                    placeholder="blr@technicon.in"
                    value={branchEmail}
                    onChange={(e) => setBranchEmail(e.target.value)}
                    className="ts-fi"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  className="ts-btn ts-ghost ts-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBranch}
                  className="ts-btn ts-dark ts-xs"
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
