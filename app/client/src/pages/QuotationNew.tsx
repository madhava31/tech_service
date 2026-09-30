import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, Company, Product, QuotationItem, SalesEngineer, Firm, Branch } from '../api';
import SearchableSelect from '../components/SearchableSelect';
import StockAnalysisWidget from '../components/StockAnalysisWidget';

function emptyItem(): QuotationItem {
  return {
    product_id: null,
    part_no: '',
    description: '',
    hsn_sac: '',
    make: '',
    qty: 1,
    actual_unit_price: 0,
    discount_type: 'none',
    discount_value: 0,
    price: 0,
  };
}

export default function QuotationNew() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const quotationId = Number(id);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [engineers, setEngineers] = useState<SalesEngineer[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [companyId, setCompanyId] = useState<number | ''>('');
  const [salesEngineerId, setSalesEngineerId] = useState<number | ''>('');
  const [firmId, setFirmId] = useState<number | ''>('');
  const [branchId, setBranchId] = useState<number | ''>('');

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxPercent, setTaxPercent] = useState(18);
  const [discountType, setDiscountType] = useState<'none' | 'percentage' | 'amount'>('none');
  const [discountValue, setDiscountValue] = useState<number | string>(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([emptyItem()]);
  const [quotationNumber, setQuotationNumber] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.companies.list().then(setCompanies);
    api.products.list().then(setProducts);
    api.engineers.list(true).then(setEngineers);

    api.firms.list().then((fList) => {
      setFirms(fList);
      if (fList.length > 0 && !isEdit) {
        const defFirm = fList.find((f) => f.is_default === 1) || fList[0];
        setFirmId(defFirm.id);
        api.firms.branches(defFirm.id).then((bList) => {
          setBranches(bList);
          if (bList.length > 0 && !isEdit) {
            const defBranch = bList.find((b) => b.is_default === 1) || bList[0];
            setBranchId(defBranch.id);
          }
        });
      }
    });

    if (isEdit && quotationId) {
      api.quotations
        .get(quotationId)
        .then((q) => {
          setCompanyId(q.company_id);
          setSalesEngineerId(q.sales_engineer_id || '');
          setFirmId(q.firm_id || '');
          setBranchId(q.branch_id || '');
          setDate(q.date);
          setTaxPercent(q.tax_percent);
          const oType = (q.overall_discount_type || q.discount_type || 'none') as 'none' | 'percentage' | 'amount';
          setDiscountType(oType);
          setDiscountValue(q.overall_discount_value ?? q.discount_value ?? q.discount_percent ?? 0);
          setNotes(q.notes || '');
          setQuotationNumber(q.number || '');
          if (q.items && q.items.length > 0) {
            setItems(
              q.items.map((it) => ({
                ...it,
                actual_unit_price: it.actual_unit_price !== undefined ? it.actual_unit_price : it.price,
                discount_type: it.discount_type || 'none',
                discount_value: it.discount_value || 0,
              }))
            );
          }
          if (q.firm_id) {
            api.firms.branches(q.firm_id).then(setBranches);
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      api.settings.get().then((s) => setTaxPercent(s.default_tax_percent));
    }
  }, [isEdit, quotationId]);

  function handleFirmChange(newFirmId: number | '') {
    setFirmId(newFirmId);
    setBranchId('');
    if (newFirmId) {
      api.firms.branches(newFirmId).then((bList) => {
        setBranches(bList);
        if (bList.length > 0) setBranchId(bList[0].id);
      });
    } else {
      setBranches([]);
    }
  }

  function updateItem(idx: number, patch: Partial<QuotationItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function pickProductForItem(idx: number, partNo: string) {
    const p = products.find((pr) => pr.part_no === partNo);
    if (p) {
      updateItem(idx, {
        product_id: p.id,
        part_no: p.part_no,
        description: p.description,
        hsn_sac: p.hsn_sac || '',
        actual_unit_price: p.default_price,
        price: p.default_price,
      });
    } else {
      updateItem(idx, { product_id: null, part_no: partNo });
    }
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Real-time financial calculations with product & overall discount breakdown
  const computedItems = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const actualUnitPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;
    const grossLineTotal = actualUnitPrice * qty;
    const discType = it.discount_type || 'none';
    const discVal = Number(it.discount_value) || 0;

    let productDiscountAmount = 0;
    if (discType === 'percentage' && discVal > 0) {
      productDiscountAmount = ((actualUnitPrice * discVal) / 100) * qty;
    } else if (discType === 'amount' && discVal > 0) {
      productDiscountAmount = Math.min(discVal, actualUnitPrice) * qty;
    }
    productDiscountAmount = Math.min(productDiscountAmount, grossLineTotal);
    const afterProductDiscountAmount = Math.max(0, grossLineTotal - productDiscountAmount);

    return {
      ...it,
      actual_unit_price: actualUnitPrice,
      gross_line_total: grossLineTotal,
      product_discount_amount: productDiscountAmount,
      after_product_discount_amount: afterProductDiscountAmount,
    };
  });

  const grossSubtotal = computedItems.reduce((sum, it) => sum + it.gross_line_total, 0);
  const productDiscountTotal = computedItems.reduce((sum, it) => sum + it.product_discount_amount, 0);
  const subtotalAfterProductDiscounts = Math.max(0, grossSubtotal - productDiscountTotal);

  const numOverallDiscountVal = Number(discountValue) || 0;
  let overallDiscountAmount = 0;
  if (discountType === 'percentage' && numOverallDiscountVal > 0) {
    overallDiscountAmount = (subtotalAfterProductDiscounts * numOverallDiscountVal) / 100;
  } else if (discountType === 'amount' && numOverallDiscountVal > 0) {
    overallDiscountAmount = Math.min(numOverallDiscountVal, subtotalAfterProductDiscounts);
  }
  overallDiscountAmount = Math.min(overallDiscountAmount, subtotalAfterProductDiscounts);

  const netSubtotal = Math.max(0, subtotalAfterProductDiscounts - overallDiscountAmount);
  const taxAmount = (netSubtotal * taxPercent) / 100;
  const exactTotal = netSubtotal + taxAmount;
  const total = Math.round(exactTotal);
  const roundOff = total - exactTotal;

  async function submit() {
    setError('');
    if (!companyId) return setError('Please select a company');
    if (items.length === 0 || items.some((it) => !it.description || !it.qty)) {
      return setError('Every line item needs a description and quantity');
    }
    setSaving(true);
    try {
      const payload = {
        company_id: Number(companyId),
        sales_engineer_id: salesEngineerId ? Number(salesEngineerId) : null,
        firm_id: firmId ? Number(firmId) : null,
        branch_id: branchId ? Number(branchId) : null,
        date,
        tax_percent: taxPercent,
        overall_discount_type: discountType,
        overall_discount_value: numOverallDiscountVal,
        discount_type: discountType,
        discount_value: numOverallDiscountVal,
        notes,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          part_no: it.part_no || null,
          description: it.description || '',
          hsn_sac: it.hsn_sac || null,
          make: it.make || null,
          qty: Number(it.qty) || 1,
          actual_unit_price: Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0,
          discount_type: it.discount_type || 'none',
          discount_value: Number(it.discount_value) || 0,
        })),
      };

      if (isEdit) {
        await api.quotations.update(quotationId, payload as any);
        navigate(`/quotations/${quotationId}`);
      } else {
        const created = await api.quotations.create(payload as any);
        navigate(`/quotations/${created.id}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-[#7A839E] text-sm">
        Loading quotation details...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E8F2]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to={isEdit ? `/quotations/${quotationId}` : '/quotations'} className="text-xs text-[#7A839E] hover:text-[#3B6FD4]">
              ← {isEdit ? 'Back to Quotation' : 'Quotations'}
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">
            {isEdit ? `Edit Quotation ${quotationNumber ? `(${quotationNumber})` : ''}` : 'Create New Quotation'}
          </h1>
          <p className="text-sm text-[#7A839E] mt-1">
            {isEdit ? 'Modify proposal terms, product discounts, overall discount, or line items.' : 'Generate a formal pricing proposal with advanced line & overall discounts.'}
          </p>
        </div>
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto cursor-pointer"
        >
          {saving ? (isEdit ? 'Saving Quotation...' : 'Saving Proposal...') : (isEdit ? 'Save Quotation' : 'Save & Generate Quotation')}
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

      <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6 space-y-6">
        {/* Primary Quotation Details Header Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Customer / Company</label>
            <SearchableSelect
              options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
              value={companyId === '' ? '' : String(companyId)}
              onChange={(v) => setCompanyId(v ? Number(v) : '')}
              placeholder="Search or select company..."
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Quotation Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">GST Tax Rate (%)</label>
            <input
              type="number"
              value={!taxPercent || taxPercent === 0 ? '' : taxPercent}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setTaxPercent(e.target.value === '' ? 0 : Number(e.target.value))}
              placeholder="18"
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Assigned Sales Engineer</label>
            <SearchableSelect
              options={engineers.map((e) => ({ value: String(e.id), label: `${e.name} (${e.code})` }))}
              value={salesEngineerId === '' ? '' : String(salesEngineerId)}
              onChange={(v) => setSalesEngineerId(v ? Number(v) : '')}
              placeholder="Select sales engineer..."
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Issuing Legal Firm</label>
            <select
              value={firmId}
              onChange={(e) => handleFirmChange(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            >
              <option value="">Select Firm...</option>
              {firms.map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Issuing Branch</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
            >
              <option value="">Select Branch...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Read-Only Stock Analysis Widget */}
        <StockAnalysisWidget items={items} />

        {/* Line Items Section */}
        <div>
          <h2 className="text-base font-semibold text-[#141B34] mb-3 pb-2 border-b border-[#E4E8F2]">
            Quotation Line Items & Product Discounts
          </h2>

          {/* Line Item Rows */}
          <div className="space-y-4">
            {computedItems.map((it, idx) => (
              <div key={idx} className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-3.5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Product Description</label>
                    <input
                      type="text"
                      placeholder="Product description or service details..."
                      value={it.description}
                      onChange={(e) => updateItem(idx, { description: e.target.value })}
                      className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Part No (Catalogue)</label>
                    <SearchableSelect
                      options={products.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.description}` }))}
                      value={it.part_no || ''}
                      onChange={(v) => pickProductForItem(idx, v)}
                      placeholder="Part no..."
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">HSN/SAC</label>
                    <input
                      type="text"
                      placeholder="HSN"
                      value={it.hsn_sac || ''}
                      onChange={(e) => updateItem(idx, { hsn_sac: e.target.value })}
                      className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-2.5 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Make</label>
                    <input
                      type="text"
                      placeholder="Brand"
                      value={it.make || ''}
                      onChange={(e) => updateItem(idx, { make: e.target.value })}
                      className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-2.5 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                    />
                  </div>

                  <div className="sm:col-span-1 flex justify-end items-center pt-4 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      className="p-1.5 text-[#E5484D] hover:bg-[#E5484D]/10 rounded-lg disabled:opacity-30 transition-colors cursor-pointer"
                      title="Remove line item"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Line Pricing & Product Discount Controls Row */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-[#F7F8FC] items-center bg-[#F7F8FC] p-2.5 rounded-lg">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Qty</label>
                    <input
                      type="number"
                      min="1"
                      value={!it.qty || it.qty === 0 ? '' : it.qty}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateItem(idx, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                      placeholder="1"
                      className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-2.5 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Actual Price / Unit (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={!it.actual_unit_price || it.actual_unit_price === 0 ? '' : it.actual_unit_price}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateItem(idx, { actual_unit_price: e.target.value === '' ? 0 : Number(e.target.value), price: e.target.value === '' ? 0 : Number(e.target.value) })}
                      placeholder="0"
                      className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-2.5 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] text-right tabular-nums font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Product Disc Type</label>
                    <select
                      value={it.discount_type || 'none'}
                      onChange={(e) => updateItem(idx, { discount_type: e.target.value as any })}
                      className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-2 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                    >
                      <option value="none">No Disc</option>
                      <option value="percentage">Percentage (%)</option>
                      <option value="amount">Fixed Amount (₹)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-[#7A839E] mb-1">Product Disc Val</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!it.discount_type || it.discount_type === 'none'}
                      value={!it.discount_value || it.discount_value === 0 ? '' : it.discount_value}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateItem(idx, { discount_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                      placeholder="0"
                      className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-2 py-1.5 text-xs text-[#141B34] focus:outline-none focus:border-[#3B6FD4] text-right tabular-nums disabled:opacity-40"
                    />
                  </div>

                  <div className="sm:col-span-3 text-right">
                    <div className="text-[10px] font-bold uppercase text-[#7A839E] mb-1">Post-Disc Line Total</div>
                    <div className="text-xs font-mono font-bold text-[#3B6FD4]">
                      ₹{it.after_product_discount_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                    {it.product_discount_amount > 0 && (
                      <div className="text-[10px] text-[#E5484D] font-mono">
                        Saved -₹{it.product_discount_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={addItem}
              className="px-3.5 py-2 bg-[#F7F8FC] hover:bg-[#E4E8F2] text-[#3B6FD4] border border-[#E4E8F2] font-semibold text-xs rounded-lg transition-colors inline-flex items-center space-x-1.5 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Line Item</span>
            </button>
          </div>
        </div>

        {/* Overall Quotation Discount Section */}
        <div className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Overall Quotation Discount</h3>
          <p className="text-xs text-[#A8AEC4] mb-3">
            Applied on subtotal after product-level discounts. Allocated proportionally across line items.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#7A839E] mb-1.5 font-medium">Overall Discount Type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'none' | 'percentage' | 'amount')}
                className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              >
                <option value="none">No Overall Discount</option>
                <option value="percentage">Percentage (%)</option>
                <option value="amount">Fixed Amount (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#7A839E] mb-1.5 font-medium">
                Overall Discount Value {discountType === 'percentage' ? '(%)' : '(₹)'}
              </label>
              <input
                type="number"
                min="0"
                step={discountType === 'percentage' ? '0.1' : '1'}
                disabled={discountType === 'none'}
                value={!discountValue || discountValue === 0 || discountValue === '0' ? '' : discountValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDiscountValue(e.target.value === '' ? '' : e.target.value)}
                placeholder="0"
                className="w-full bg-[#FFFFFF] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Special Terms & Notes</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add payment terms, validity notes, or delivery terms..."
            className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
          />
        </div>

        {/* Financial Totals Breakdown Box */}
        <div className="bg-[#F4F6FC] border border-[#E4E8F2] rounded-xl p-4 flex flex-col items-end space-y-1.5 text-sm">
          <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
            <span>Gross Subtotal:</span>
            <span className="tabular-nums font-mono text-[#141B34]">₹{grossSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          {productDiscountTotal > 0 && (
            <>
              <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
                <span>Product Discounts:</span>
                <span className="tabular-nums font-mono text-[#E5484D]">-₹{productDiscountTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
                <span>Subtotal (Post-Product Disc):</span>
                <span className="tabular-nums font-mono text-[#141B34]">₹{subtotalAfterProductDiscounts.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </>
          )}

          {overallDiscountAmount > 0 && (
            <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
              <span>Overall Quotation Discount:</span>
              <span className="tabular-nums font-mono text-[#E5484D]">-₹{overallDiscountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          <div className="flex justify-between w-full max-w-sm text-[#7A839E] font-medium pt-1 border-t border-[#E4E8F2]">
            <span>Net Taxable Subtotal:</span>
            <span className="tabular-nums font-mono text-[#141B34]">₹{netSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
            <span>GST Tax ({taxPercent}%):</span>
            <span className="tabular-nums font-mono text-[#141B34]">₹{taxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>

          {Math.abs(roundOff) > 0.001 && (
            <div className="flex justify-between w-full max-w-sm text-[#7A839E]">
              <span>Round Off:</span>
              <span className="tabular-nums font-mono text-[#141B34]">₹{roundOff.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between w-full max-w-sm pt-2 border-t border-[#E4E8F2] text-base font-bold text-[#141B34]">
            <span>Grand Total:</span>
            <span className="tabular-nums font-mono text-[#3B6FD4]">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={submit}
            disabled={saving}
            className="px-6 py-3 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {saving ? (isEdit ? 'Saving...' : 'Saving...') : (isEdit ? 'Save Quotation' : 'Save & Generate Quotation')}
          </button>
        </div>
      </div>
    </div>
  );
}
