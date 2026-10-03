import { useEffect, useState } from 'react';
import { api, CompanySettings } from '../api';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Settings() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get().then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function save() {
    if (!settings || saving) return;
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const updated = await api.settings.update(settings);
      setSettings(updated);
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function onImageChange(field: 'logo_image' | 'signature_image', file: File | null) {
    if (!settings || !file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSettings({ ...settings, [field]: dataUrl });
    } catch {
      setError('Could not read that image file.');
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center space-x-3 text-[#7A839E]">
          <div className="w-5 h-5 border-2 border-[#3B6FD4] border-t-transparent rounded-full animate-spin"></div>
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl space-y-6 px-4 tablet-lg:px-6 pt-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E8F2]">
        <div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">System & Organisation Settings</h1>
          <p className="text-sm text-[#7A839E] mt-1">
            Configure organisation details, branding, default quotation terms, and invoice numbering.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto"
        >
          {saving ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#F4F6FC]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Saving Changes...
            </>
          ) : (
            'Save All Settings'
          )}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-xl text-[#E5484D] text-sm flex items-center space-x-2">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div className="p-4 bg-[#3B6FD4]/10 border border-[#3B6FD4]/30 rounded-xl text-[#3B6FD4] text-sm flex items-center space-x-2">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>Settings saved successfully! Updated details will apply to new documents.</span>
        </div>
      )}

      {/* 1. Company Details */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m3 0v-4a1 1 0 011-1h2a1 1 0 011 1v4m-4 0h4" />
          </svg>
          <span>Company & Contact Information</span>
        </h2>
        
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Company Name</label>
              <input
                type="text"
                value={settings.company_name}
                onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">GSTIN Number</label>
              <input
                type="text"
                value={settings.gstin}
                onChange={(e) => setSettings({ ...settings, gstin: e.target.value })}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Registered Address</label>
            <input
              type="text"
              value={settings.address}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">State (GST Location)</label>
              <input
                type="text"
                value={settings.state}
                onChange={(e) => setSettings({ ...settings, state: e.target.value })}
                placeholder="e.g. Telangana"
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Mobile Phone</label>
              <input
                type="text"
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Landline Phone</label>
              <input
                type="text"
                value={settings.landline}
                onChange={(e) => setSettings({ ...settings, landline: e.target.value })}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Email Address</label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
            </div>
          </div>
          
          <p className="text-xs text-[#A8AEC4] italic">
            * Setting your State lets quotations automatically calculate IGST (out-of-state) vs. CGST+SGST (in-state).
          </p>
        </div>
      </div>

      {/* 2. Logo & Signature */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Branding Assets</span>
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-2">Company Logo</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onImageChange('logo_image', e.target.files?.[0] || null)}
              className="block w-full text-xs text-[#7A839E] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#F7F8FC] file:text-[#3B6FD4] hover:file:bg-[#E4E8F2] file:cursor-pointer cursor-pointer"
            />
            {settings.logo_image && (
              <div className="mt-4 p-3 bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg inline-block">
                <img src={settings.logo_image} alt="Logo preview" className="max-h-16 max-w-[200px] object-contain" />
              </div>
            )}
          </div>

          <div className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-2">Authorized Signature / Stamp</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onImageChange('signature_image', e.target.files?.[0] || null)}
              className="block w-full text-xs text-[#7A839E] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#F7F8FC] file:text-[#3B6FD4] hover:file:bg-[#E4E8F2] file:cursor-pointer cursor-pointer"
            />
            {settings.signature_image && (
              <div className="mt-4 p-3 bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg inline-block">
                <img src={settings.signature_image} alt="Signature preview" className="max-h-16 max-w-[200px] object-contain" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Bank Details */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span>Bank Account Details (Printed on Invoices & Quotes)</span>
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Bank Name</label>
            <input
              type="text"
              value={settings.bank_name}
              onChange={(e) => setSettings({ ...settings, bank_name: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Account Number</label>
            <input
              type="text"
              value={settings.bank_account_no}
              onChange={(e) => setSettings({ ...settings, bank_account_no: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">IFSC Code</label>
            <input
              type="text"
              value={settings.bank_ifsc}
              onChange={(e) => setSettings({ ...settings, bank_ifsc: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Account Holder Name</label>
            <input
              type="text"
              value={settings.bank_account_holder}
              onChange={(e) => setSettings({ ...settings, bank_account_holder: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* 4. Default Terms */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Default Quotation Terms</span>
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Quotation Validity (Days)</label>
            <input
              type="number"
              value={settings.quotation_validity_days}
              onChange={(e) => setSettings({ ...settings, quotation_validity_days: Number(e.target.value) })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Payment Terms</label>
            <input
              type="text"
              value={settings.payment_terms}
              onChange={(e) => setSettings({ ...settings, payment_terms: e.target.value })}
              placeholder="e.g. 100% Advance"
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Delivery Time</label>
            <input
              type="text"
              value={settings.delivery_time}
              onChange={(e) => setSettings({ ...settings, delivery_time: e.target.value })}
              placeholder="e.g. Ready stock"
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* 5. Document Numbering */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
          <span>Document Numbering Prefixes</span>
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Quotation Prefix</label>
            <input
              type="text"
              value={settings.quotation_prefix}
              onChange={(e) => setSettings({ ...settings, quotation_prefix: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">PO Prefix</label>
            <input
              type="text"
              value={settings.po_prefix}
              onChange={(e) => setSettings({ ...settings, po_prefix: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">PI Prefix</label>
            <input
              type="text"
              value={settings.pi_prefix}
              onChange={(e) => setSettings({ ...settings, pi_prefix: e.target.value })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
          </div>
        </div>
        <p className="text-xs text-[#A8AEC4]">
          * Numbers are generated as PREFIX + Financial Year / Sequence (e.g., Quotation prefix "TSQOT" produces TSQOT2627/1, TSQOT2627/2...).
        </p>
      </div>

      {/* 6. Step 2B — Sales Pipeline & Threshold Controls */}
      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#141B34] pb-3 mb-5 border-b border-[#E4E8F2] flex items-center space-x-2">
          <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <span>Sales Pipeline & Threshold Controls</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">
              Quotation Aging Threshold (Days)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={settings.stale_quotation_days || 30}
              onChange={(e) => setSettings({ ...settings, stale_quotation_days: Number(e.target.value) })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
            <span className="text-[11px] text-[#A8AEC4] mt-1 block">
              Active quotations exceeding this age with no customer activity will be flagged as stale.
            </span>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">
              High-Value Opportunity Threshold (₹)
            </label>
            <input
              type="number"
              min="1000"
              step="50000"
              value={settings.high_value_threshold || 500000}
              onChange={(e) => setSettings({ ...settings, high_value_threshold: Number(e.target.value) })}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors font-mono"
            />
            <span className="text-[11px] text-[#A8AEC4] mt-1 block">
              Quotations equal to or exceeding this value will trigger High Value management alerts.
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save All Settings'}
        </button>
      </div>
    </div>
  );
}


