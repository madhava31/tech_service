import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, Branch, BranchDocumentSettings as SettingsType } from '../api';

export default function BranchDocumentSettings() {
  const { branchId } = useParams();
  const bId = Number(branchId);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  // Form states
  const [headerTitle, setHeaderTitle] = useState('');
  const [docAddress, setDocAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [terms, setTerms] = useState('');

  useEffect(() => {
    if (!bId) return;
    setLoading(true);
    setError('');
    api.firms
      .getBranch(bId)
      .then((res) => {
        setBranch(res);
        if (res.document_settings) {
          const ds = res.document_settings;
          setSettings(ds);
          setHeaderTitle(ds.document_header_title || '');
          setDocAddress(ds.document_address || '');
          setGstin(ds.gstin || '');
          setPan(ds.pan || '');
          setBankName(ds.bank_name || '');
          setBankAccountNo(ds.bank_account_no || '');
          setBankIfsc(ds.bank_ifsc || '');
          setBankAccountHolder(ds.bank_account_holder || '');
          setTerms(ds.terms_and_conditions || '');
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.firms.updateBranchDocumentSettings(bId, {
        document_header_title: headerTitle.trim() || null,
        document_address: docAddress.trim() || null,
        gstin: gstin.trim() || null,
        pan: pan.trim() || null,
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        bank_ifsc: bankIfsc.trim() || null,
        bank_account_holder: bankAccountHolder.trim() || null,
        terms_and_conditions: terms.trim() || null,
      });
      setSuccess('Branch document print settings updated successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-subtle text-sm">Loading branch document print settings...</div>;
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0 max-w-4xl">
      {/* Header */}
      <div className="ts-phead !mb-2 !block">
        <div className="flex items-center gap-2 mb-1">
          <Link to="/settings/multi-firm" className="text-[13px] text-subtle hover:text-fg">
            ← Back to Multi-Firm Settings
          </Link>
        </div>
        <h1 className="ts-title">
          Document Print Settings — {branch?.name} ({branch?.code})
        </h1>
        <p className="ts-muted m-0 mt-1.5 text-[14px]">
          Customize company header, bank details, GSTIN, and legal terms printed on PDF Quotations generated from this branch.
        </p>
      </div>

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {success && (
        <div className="ts-okbox">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="ts-card ts-white ts-tbl space-y-6">
        {/* Company Header Settings */}
        <div className="space-y-4 border-b border-dashed border-line2 pb-6">
          <h2 className="m-0 text-[15px] font-medium text-fg">
            PDF Document Header & Tax Details
          </h2>
          <div>
            <label className="ts-lbl">
              Document Header Title
            </label>
            <input
              type="text"
              placeholder="TECHNICON SERVICES — HYDERABAD MAIN"
              value={headerTitle}
              onChange={(e) => setHeaderTitle(e.target.value)}
              className="ts-fi"
            />
          </div>

          <div>
            <label className="ts-lbl">
              Branch Document Printed Address
            </label>
            <textarea
              rows={2}
              placeholder="Plot No. 45, Auto Nagar, Industrial Area, Hyderabad, Telangana - 500070"
              value={docAddress}
              onChange={(e) => setDocAddress(e.target.value)}
              className="ts-fi"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="ts-lbl">Branch GSTIN</label>
              <input
                type="text"
                placeholder="36AAAAA0000A1Z5"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="ts-fi"
              />
            </div>
            <div>
              <label className="ts-lbl">PAN Number</label>
              <input
                type="text"
                placeholder="AAAAA0000A"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
                className="ts-fi"
              />
            </div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="space-y-4 border-b border-dashed border-line2 pb-6">
          <h2 className="m-0 text-[15px] font-medium text-fg">
            Branch Bank Account Details (For PDF Payments)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="ts-lbl">Bank Name</label>
              <input
                type="text"
                placeholder="HDFC Bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="ts-fi"
              />
            </div>
            <div>
              <label className="ts-lbl">Account Holder Name</label>
              <input
                type="text"
                placeholder="TECHNICON SERVICES"
                value={bankAccountHolder}
                onChange={(e) => setBankAccountHolder(e.target.value)}
                className="ts-fi"
              />
            </div>
            <div>
              <label className="ts-lbl">Account Number</label>
              <input
                type="text"
                placeholder="50200012345678"
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                className="ts-fi"
              />
            </div>
            <div>
              <label className="ts-lbl">IFSC Code</label>
              <input
                type="text"
                placeholder="HDFC0000123"
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value)}
                className="ts-fi"
              />
            </div>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div className="space-y-4">
          <h2 className="m-0 text-[15px] font-medium text-fg">
            Branch Standard Terms & Conditions
          </h2>
          <textarea
            rows={4}
            placeholder="1. Payment terms: 30 days net from invoice date.\n2. Goods once sold will not be taken back.\n3. Subject to Hyderabad Jurisdiction."
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="ts-fi"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="ts-btn ts-dark"
          >
            {saving ? 'Saving Settings...' : 'Save Branch Document Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
