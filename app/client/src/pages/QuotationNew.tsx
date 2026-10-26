import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { CountUp } from '../components/ds/CountUp';
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
  const [successToast, setSuccessToast] = useState('');
  const [savingItemIdx, setSavingItemIdx] = useState<number | null>(null);
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

  async function handleCreateCompany(customName: string) {
    const trimmed = customName.trim();
    if (!trimmed) return;
    setError('');
    try {
      const created = await api.companies.create({ name: trimmed });
      setCompanies((prev) => {
        if (prev.some((c) => c.id === created.id)) return prev;
        return [created, ...prev];
      });
      setCompanyId(created.id);
      setSuccessToast(`Saved new customer "${created.name}" to database! Available for future quotations.`);
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to create company');
    }
  }

  function pickProductForItem(idx: number, partNo: string) {
    const trimmed = partNo.trim();
    const p = products.find((pr) => pr.part_no.toUpperCase() === trimmed.toUpperCase());
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
      updateItem(idx, { product_id: null, part_no: trimmed });
    }
  }

  function pickProductByDescription(idx: number, descOrPart: string) {
    const trimmed = descOrPart.trim();
    const p = products.find(
      (pr) =>
        pr.description.toLowerCase() === trimmed.toLowerCase() ||
        pr.part_no.toUpperCase() === trimmed.toUpperCase()
    );
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
      updateItem(idx, { product_id: null, description: trimmed });
    }
  }

  async function handleCreateDescription(idx: number, customDesc: string) {
    const trimmed = customDesc.trim();
    if (!trimmed) return;
    const existing = products.find((p) => p.description.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      pickProductForItem(idx, existing.part_no);
      return;
    }
    updateItem(idx, {
      product_id: null,
      description: trimmed,
    });
  }

  async function handleCreatePartNo(idx: number, customPartNo: string) {
    const trimmed = customPartNo.trim();
    if (!trimmed) return;
    const existing = products.find((p) => p.part_no.toUpperCase() === trimmed.toUpperCase());
    if (existing) {
      pickProductForItem(idx, existing.part_no);
      return;
    }
    updateItem(idx, {
      product_id: null,
      part_no: trimmed,
    });
  }

  async function saveItemToCatalogue(idx: number) {
    const it = items[idx];
    if (!it) return;
    const cleanPart = it.part_no?.trim();
    const cleanDesc = it.description?.trim();
    if (!cleanPart && !cleanDesc) {
      setError('Please enter either a product description or a part number before saving to DB.');
      return;
    }

    let finalPart = cleanPart;
    if (!finalPart) {
      const prefix = cleanDesc!
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.toUpperCase().slice(0, 4))
        .join('-');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      finalPart = prefix ? `${prefix}-${randomSuffix}` : `PART-${randomSuffix}`;
    }
    const finalDesc = cleanDesc || finalPart;
    const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;

    setSavingItemIdx(idx);
    setError('');
    try {
      const created = await api.products.create({
        part_no: finalPart,
        description: finalDesc,
        default_price: itemPrice,
        hsn_sac: it.hsn_sac?.trim() || null,
        unit: 'Nos',
      });
      setProducts((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
      updateItem(idx, {
        product_id: created.id,
        part_no: created.part_no,
        description: created.description,
        actual_unit_price: itemPrice,
        price: itemPrice,
        hsn_sac: created.hsn_sac || it.hsn_sac,
      });
      setSuccessToast(`Saved Part No "${created.part_no}" & Description to DB catalogue! Ready for future quotations.`);
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (e: any) {
      setError(e.message || 'Failed to save product to DB');
    } finally {
      setSavingItemIdx(null);
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
      // Auto-save any custom products into catalogue before creating/updating quotation
      const currentItems = [...items];
      for (let i = 0; i < currentItems.length; i++) {
        const it = currentItems[i];
        if (!it.product_id && (it.part_no || it.description)) {
          try {
            const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : it.price) || 0;
            const desc = it.description?.trim() || it.part_no?.trim() || 'Custom Product';
            let partNo = it.part_no?.trim();
            if (!partNo) {
              const prefix = desc
                .replace(/[^a-zA-Z0-9\s]/g, '')
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w.toUpperCase().slice(0, 4))
                .join('-');
              const randomSuffix = Math.floor(1000 + Math.random() * 9000);
              partNo = prefix ? `${prefix}-${randomSuffix}` : `PART-${randomSuffix}`;
              it.part_no = partNo;
            }
            const created = await api.products.create({
              part_no: partNo,
              description: desc,
              default_price: itemPrice,
              hsn_sac: it.hsn_sac?.trim() || null,
              unit: 'Nos',
            });
            it.product_id = created.id;
            it.part_no = created.part_no;
            setProducts((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
          } catch (e) {
            // Handled safely
          }
        }
      }

      const compObj = companies.find((c) => c.id === Number(companyId));
      const payload = {
        company_id: Number(companyId),
        company_name: compObj?.name || undefined,
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
        items: currentItems.map((it) => {
          const itemPrice = Number(it.actual_unit_price !== undefined ? it.actual_unit_price : (it.price !== undefined ? it.price : 0)) || 0;
          return {
            product_id: it.product_id || null,
            part_no: it.part_no || null,
            description: it.description || '',
            hsn_sac: it.hsn_sac || null,
            make: it.make || null,
            qty: Number(it.qty) || 1,
            price: itemPrice,
            actual_unit_price: itemPrice,
            discount_type: it.discount_type || 'none',
            discount_value: Number(it.discount_value) || 0,
          };
        }),
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
    return <div className="ts-page-pad ts-muted" style={{ paddingTop: 30, fontSize: 14 }}>Loading quotation details…</div>;
  }

  const money2 = (v: number) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const custName = companies.find((c) => c.id === companyId)?.name;
  const eng = engineers.find((e) => e.id === salesEngineerId);
  const br = branches.find((b) => b.id === branchId);
  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save quotation' : 'Save and generate';

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div style={{ minWidth: 0 }}>
          <Link to={isEdit ? `/quotations/${quotationId}` : '/quotations'} className="ts-back">← {isEdit ? 'Back to quotation' : 'Quotations'}</Link>
          <h1>{isEdit ? `Edit quotation${quotationNumber ? ` ${quotationNumber}` : ''}` : 'New quotation'}</h1>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            {isEdit ? 'Change terms, product discounts, the overall discount or line items.' : 'Build a formal pricing proposal with line and overall discounts.'}
          </p>
        </div>
        <span className="ts-grow" />
        <button type="button" onClick={submit} disabled={saving} className="ts-btn ts-dark"><CheckIcon /> {saveLabel}</button>
      </div>

      {successToast && (
        <div className="ts-okbox" style={{ marginBottom: 16 }}><span>{successToast}</span><button type="button" onClick={() => setSuccessToast('')}>Dismiss</button></div>
      )}
      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      <div className="ts-qgrid">
        <div className="ts-qmain">
          {/* Customer and issuer */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 0 }}>
            <div className="ts-ch"><b>Customer and issuer</b></div>
            <div className="ts-fgrid ts-g4">
              <div className="ts-fld ts-span2">
                <div className="ts-fl"><label>Customer / company</label><span>{companyId ? '✓ Selected' : 'Pick existing or type new'}</span></div>
                <SearchableSelect
                  options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
                  value={companyId === '' ? '' : String(companyId)}
                  onChange={(v) => setCompanyId(v ? Number(v) : '')}
                  placeholder="Search or enter customer name…"
                  allowCustom={true}
                  onCreateCustom={handleCreateCompany}
                  customLabel={(val) => `Add and save new customer "${val}"`}
                />
                <small className="ts-hint">Select an existing customer or type a new name to save it.</small>
              </div>
              <div className="ts-fld">
                <label htmlFor="q-date">Quotation date</label>
                <input id="q-date" type="date" className="ts-fi" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-gst">GST rate</label>
                <div className="ts-suffix">
                  <input id="q-gst" type="number" className="ts-fi ts-r" value={!taxPercent || taxPercent === 0 ? '' : taxPercent} onFocus={(e) => e.target.select()} onChange={(e) => setTaxPercent(e.target.value === '' ? 0 : Number(e.target.value))} placeholder="18" />
                  <span>%</span>
                </div>
              </div>
            </div>
            <div className="ts-fgrid ts-g3 ts-issuer">
              <div className="ts-fld">
                <label>Assigned sales engineer</label>
                <SearchableSelect
                  options={engineers.map((e) => ({ value: String(e.id), label: `${e.name} (${e.code})` }))}
                  value={salesEngineerId === '' ? '' : String(salesEngineerId)}
                  onChange={(v) => setSalesEngineerId(v ? Number(v) : '')}
                  placeholder="Select sales engineer…"
                />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-firm">Issuing legal firm</label>
                <select id="q-firm" className="ts-fi" value={firmId} onChange={(e) => handleFirmChange(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select firm…</option>
                  {firms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
              <div className="ts-fld">
                <label htmlFor="q-branch">Issuing branch</label>
                <select id="q-branch" className="ts-fi" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select branch…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Line items */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
            <div className="ts-rhead"><div className="ts-ch"><b>Line items and product discounts</b></div><span className="ts-muted" style={{ fontSize: 13 }}>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
            <div className="flex flex-col gap-3 mt-4">
              {computedItems.map((it, idx) => {
                const noDisc = !it.discount_type || it.discount_type === 'none';
                return (
                  <div key={idx} className="ts-qline">
                    <div className="ts-ql-h">
                      <b>Line item {idx + 1}</b>
                      {it.product_id ? <span className="ts-lb ts-saved">In catalogue</span> : <span className="ts-lb ts-new">New item</span>}
                      <span style={{ flex: 1 }} />
                      {!it.product_id && (
                        <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => saveItemToCatalogue(idx)} disabled={savingItemIdx === idx || (!it.part_no?.trim() && !it.description?.trim())} title="Save this part number and description to the catalogue">
                          {savingItemIdx === idx ? 'Saving…' : 'Save part to catalogue'}
                        </button>
                      )}
                      <button type="button" className="ts-iconx" onClick={() => removeItem(idx)} disabled={items.length === 1} aria-label={`Remove line item ${idx + 1}`} title="Remove line item"><Trash2Icon className="size-4" /></button>
                    </div>
                    <div className="ts-fgrid ts-ql-a">
                      <div className="ts-fld">
                        <label>Product description</label>
                        <SearchableSelect
                          options={products.map((p) => ({ value: p.description, label: p.description }))}
                          value={it.description || ''}
                          onChange={(v) => pickProductByDescription(idx, v)}
                          placeholder="Enter or select product…"
                          allowCustom={true}
                          onCreateCustom={(val) => handleCreateDescription(idx, val)}
                          customLabel={(val) => `Use description "${val}"`}
                          size="sm"
                        />
                      </div>
                      <div className="ts-fld">
                        <label>Part no (catalogue)</label>
                        <SearchableSelect
                          options={products.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.description}` }))}
                          value={it.part_no || ''}
                          onChange={(v) => pickProductForItem(idx, v)}
                          placeholder="Part no…"
                          allowCustom={true}
                          onCreateCustom={(val) => handleCreatePartNo(idx, val)}
                          customLabel={(val) => `Use part no "${val}"`}
                          size="sm"
                        />
                      </div>
                      <div className="ts-fld">
                        <label>HSN/SAC</label>
                        <input type="text" className="ts-fi" placeholder="HSN" value={it.hsn_sac || ''} onChange={(e) => updateItem(idx, { hsn_sac: e.target.value })} inputMode="numeric" />
                      </div>
                    </div>
                    <div className="ts-fgrid ts-ql-b">
                      <div className="ts-fld">
                        <label>Qty</label>
                        <input type="number" min="1" className="ts-fi ts-r" value={!it.qty || it.qty === 0 ? '' : it.qty} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { qty: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="1" />
                      </div>
                      <div className="ts-fld">
                        <label>Price per unit (₹)</label>
                        <input type="number" min="0" step="0.01" className="ts-fi ts-r" value={!it.actual_unit_price || it.actual_unit_price === 0 ? '' : it.actual_unit_price} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { actual_unit_price: e.target.value === '' ? 0 : Number(e.target.value), price: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="0.00" />
                      </div>
                      <div className="ts-fld">
                        <label>Product discount</label>
                        <select className="ts-fi" value={it.discount_type || 'none'} onChange={(e) => updateItem(idx, { discount_type: e.target.value as any })}>
                          <option value="none">No discount</option>
                          <option value="percentage">Percentage</option>
                          <option value="amount">Flat ₹ per unit</option>
                        </select>
                      </div>
                      <div className="ts-fld">
                        <label>Disc value{it.discount_type === 'percentage' ? ' (%)' : it.discount_type === 'amount' ? ' (₹)' : ''}</label>
                        <input type="number" min="0" step="0.01" className="ts-fi ts-r" disabled={noDisc} value={!it.discount_value || it.discount_value === 0 ? '' : it.discount_value} onFocus={(e) => e.target.select()} onChange={(e) => updateItem(idx, { discount_value: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="0" />
                      </div>
                      <div className="ts-fld ts-ltotw">
                        <span className="ts-lbl" style={{ fontSize: 11.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgb(var(--muted))', fontWeight: 500 }}>Line total</span>
                        <div className="ts-ltot">{money2(it.after_product_discount_amount)}</div>
                        {it.product_discount_amount > 0 && <small className="ts-lalloc">Saves {money2(it.product_discount_amount)}</small>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="ts-btn ts-ghost ts-addline" onClick={addItem}><PlusIcon /> Add line item</button>
          </section>

          {/* Live stock check */}
          <section className="ts-card" style={{ ['--i' as string]: 2 }}>
            <div className="ts-rhead"><div className="ts-ch"><b>Live stock check</b></div><span className="ts-headtag">Read-only · updates as you type</span></div>
            {!items.some((x) => x.part_no?.trim() || x.description?.trim()) && <p className="ts-muted ts-small" style={{ marginTop: 12 }}>Type a product name or part number in a line item to see live stock across your warehouses.</p>}
            <div className="mt-3"><StockAnalysisWidget items={items} /></div>
          </section>

          {/* Overall discount */}
          <section className="ts-card" style={{ ['--i' as string]: 3 }}>
            <div className="ts-ch"><b>Overall quotation discount</b></div>
            <p className="ts-muted ts-small">Applied to the subtotal after product discounts, and shared across line items in proportion to their value.</p>
            <div className="ts-fgrid ts-g2">
              <div className="ts-fld">
                <label htmlFor="q-ot">Overall discount type</label>
                <select id="q-ot" className="ts-fi" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'none' | 'percentage' | 'amount')}>
                  <option value="none">No overall discount</option>
                  <option value="percentage">Percentage</option>
                  <option value="amount">Flat amount</option>
                </select>
              </div>
              <div className="ts-fld">
                <label htmlFor="q-ov">Overall discount value {discountType === 'percentage' ? '(%)' : discountType === 'amount' ? '(₹)' : ''}</label>
                <input id="q-ov" type="number" min="0" step={discountType === 'percentage' ? '0.1' : '1'} className="ts-fi ts-r" disabled={discountType === 'none'} value={!discountValue || discountValue === 0 || discountValue === '0' ? '' : discountValue} onFocus={(e) => e.target.select()} onChange={(e) => setDiscountValue(e.target.value === '' ? '' : e.target.value)} placeholder="0" />
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 4 }}>
            <div className="ts-fld">
              <label htmlFor="q-notes">Special terms and notes</label>
              <textarea id="q-notes" rows={4} className="ts-fi" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, validity, delivery terms…" />
            </div>
          </section>
        </div>

        {/* Summary */}
        <aside className="ts-qside">
          <div className="ts-card ts-charcoal ts-qsum" style={{ ['--i' as string]: 1 }}>
            <div className="ts-ch">Quotation summary</div>
            <div className="ts-qno">{isEdit ? quotationNumber || 'Quotation' : 'New quotation'} <span className="ts-pill ts-up">{isEdit ? 'Editing' : 'Draft'}</span></div>
            <dl className="ts-sumrows">
              <div><dt>Gross subtotal</dt><dd>{money2(grossSubtotal)}</dd></div>
              <div><dt>Product discounts</dt><dd>− {money2(productDiscountTotal)}</dd></div>
              <div><dt>Overall discount</dt><dd>− {money2(overallDiscountAmount)}</dd></div>
              <div className="ts-sep"><dt>Net taxable subtotal</dt><dd>{money2(netSubtotal)}</dd></div>
              <div><dt>GST ({taxPercent}%)</dt><dd>{money2(taxAmount)}</dd></div>
              {Math.abs(roundOff) > 0.001 && <div><dt>Round off</dt><dd>₹{roundOff.toFixed(2)}</dd></div>}
            </dl>
            <div className="ts-grand"><span>Grand total</span><b className="num"><CountUp value={total} format={money2} duration={500} /></b></div>
            <div className="ts-qmeta">
              <div><span>Customer</span><b>{custName || 'Not selected'}</b></div>
              <div><span>Engineer</span><b>{eng ? `${eng.name} (${eng.code})` : 'Not assigned'}</b></div>
              <div><span>Branch</span><b>{br ? `${br.name} (${br.code})` : 'Not selected'}</b></div>
              <div><span>Line items</span><b>{items.length}</b></div>
            </div>
            <button type="button" onClick={submit} disabled={saving} className="ts-btn" style={{ width: '100%', justifyContent: 'center', background: 'rgb(var(--on-charcoal))', color: 'rgb(var(--charcoal))' }}>
              <CheckIcon /> {saving ? 'Saving…' : isEdit ? 'Save quotation' : 'Save and generate quotation'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
