import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, type Company, type Product, type SentPoInput, type SentPoTaxType } from '../api';
import SearchableSelect from '../components/SearchableSelect';
import EditableCombo from '../components/EditableCombo';
import { unitOptions } from '../lib/units';
import { INDIAN_STATES } from '../lib/indianStates';
import { poFigures, TAX_CHOICES, taxValue, parseTax, defaultTax } from '../lib/sentPoCalc';
import { showToast } from '../lib/savePdf';

interface Line {
  key: number;
  product_id: number | null;
  part_no: string;
  description: string;
  hsn_sac: string;
  qty: string;
  unit: string;
  price: string;
  discount_percent: string;
  discount_amount: string;
  tax_type: SentPoTaxType;
  tax_percent: number;
}

let keySeq = 0;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A purchase order Technicon sends to a supplier: party, order number (prefix + number, both editable), dates, state of supply,
 * the item table (part, description, HSN, qty, unit, price, discount, tax, amount), totals with round off, advance and balance,
 * the terms (a title and free text) and the payment details. New at /purchase-orders/sent/new, edit at /purchase-orders/sent/:id/edit.
 */
export default function SentPoForm() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ourState, setOurState] = useState('');

  const [companyId, setCompanyId] = useState<number | ''>('');
  const [newSupplier, setNewSupplier] = useState('');
  const [prefix, setPrefix] = useState('');
  const [seq, setSeq] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [stateOfSupply, setStateOfSupply] = useState('');
  const [priceIncludesTax, setPriceIncludesTax] = useState(false);
  const [roundOff, setRoundOff] = useState(false);
  const [advanceOn, setAdvanceOn] = useState(false);
  const [advance, setAdvance] = useState('');
  const [termsTitle, setTermsTitle] = useState('Purchase Order');
  const [termsText, setTermsText] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDesc, setPaymentDesc] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const prefixTouched = useRef(false);

  const blankLine = (tax = defaultTax(stateOfSupply, ourState)): Line => ({
    key: ++keySeq, product_id: null, part_no: '', description: '', hsn_sac: '', qty: '1', unit: 'Nos', price: '', discount_percent: '', discount_amount: '', ...tax,
  });

  useEffect(() => {
    let live = true;
    const base = Promise.all([
      api.companies.list().catch(() => [] as Company[]),
      api.products.list().catch(() => [] as Product[]),
      api.settings.get({ lite: true }).catch(() => null),
    ]);
    base
      .then(async ([cs, ps, st]) => {
        if (!live) return;
        setCompanies(cs);
        setProducts(ps);
        const mine = st?.state || '';
        setOurState(mine);
        if (editId) {
          const po = await api.sentPos.get(editId);
          if (!live) return;
          setCompanyId(po.company_id ?? '');
          setNewSupplier(po.company_id ? '' : po.supplier_name);
          setPrefix(po.prefix || '');
          setSeq(po.seq != null ? String(po.seq) : '');
          setOrderDate(String(po.order_date).slice(0, 10));
          setDueDate(po.due_date ? String(po.due_date).slice(0, 10) : '');
          setStateOfSupply(po.state_of_supply || '');
          setPriceIncludesTax(!!po.price_includes_tax);
          setRoundOff(!!po.round_off_enabled);
          setAdvanceOn(Number(po.advance_amount) > 0);
          setAdvance(Number(po.advance_amount) > 0 ? String(Number(po.advance_amount)) : '');
          setTermsTitle(po.terms_title || '');
          setTermsText(po.terms_text || '');
          setPaymentType(po.payment_type || '');
          setPaymentRef(po.payment_reference || '');
          setPaymentDesc(po.payment_description || '');
          setLines(po.items.map((it) => ({
            key: ++keySeq,
            product_id: it.product_id ?? null,
            part_no: it.part_no || '',
            description: it.description || '',
            hsn_sac: it.hsn_sac || '',
            qty: String(Number(it.qty)),
            unit: it.unit || 'Nos',
            price: String(Number(it.price)),
            discount_percent: Number(it.discount_amount) > 0 ? '' : Number(it.discount_percent) ? String(Number(it.discount_percent)) : '',
            discount_amount: Number(it.discount_amount) > 0 ? String(Number(it.discount_amount)) : '',
            tax_type: it.tax_type,
            tax_percent: Number(it.tax_percent),
          })));
        } else {
          const next = await api.sentPos.nextNumber();
          if (!live) return;
          setPrefix(next.prefix || '');
          setSeq(String(next.seq));
          if (next.last_terms_title) setTermsTitle(next.last_terms_title);
          if (next.last_terms_text) setTermsText(next.last_terms_text);
          setLines([blankLine(defaultTax('', mine)), blankLine(defaultTax('', mine))]);
        }
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the form.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // A new PO: changing the prefix finds the next free number for it.
  useEffect(() => {
    if (editId || !prefixTouched.current) return;
    const t = setTimeout(() => {
      api.sentPos.nextNumber(prefix).then((n) => setSeq(String(n.seq))).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [prefix, editId]);

  // The state of supply decides GST (same state) or IGST for lines still on the default 18%.
  function chooseState(v: string) {
    setStateOfSupply(v);
    const t = defaultTax(v, ourState);
    setLines((prev) => prev.map((l) => ((l.tax_type === 'GST' || l.tax_type === 'IGST') && l.tax_percent === 18 ? { ...l, ...t } : l)));
  }

  const patch = (key: number, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  function pickPart(key: number, partNo: string) {
    const p = products.find((x) => x.part_no.toUpperCase() === partNo.trim().toUpperCase());
    if (!p) return patch(key, { part_no: partNo, product_id: null });
    patch(key, { product_id: p.id, part_no: p.part_no, description: p.description, hsn_sac: p.hsn_sac || '', unit: p.unit || 'Nos' });
  }

  const figures = useMemo(
    () => poFigures(
      lines.map((l) => ({ qty: Number(l.qty) || 0, price: Number(l.price) || 0, discount_percent: Number(l.discount_percent) || 0, discount_amount: Number(l.discount_amount) || 0, tax_type: l.tax_type, tax_percent: l.tax_percent })),
      { priceIncludesTax, roundOff, advance: advanceOn ? Number(advance) || 0 : 0 }
    ),
    [lines, priceIncludesTax, roundOff, advanceOn, advance]
  );

  const partOptions = useMemo(() => products.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.description}` })), [products]);
  const companyOptions = useMemo(() => companies.map((c) => ({ value: String(c.id), label: c.name })), [companies]);

  async function save() {
    if (saving) return;
    if (!companyId && !newSupplier.trim()) return setError('Choose the party (supplier) or type its name.');
    if (!prefix.trim() && !seq.trim()) return setError('Enter the order number.');
    if (seq.trim() && !(Number.isInteger(Number(seq)) && Number(seq) > 0)) return setError('The order number must be a whole number above 0.');
    const filled = lines.filter((l) => l.part_no.trim() || l.description.trim());
    if (!filled.length) return setError('Add at least one item.');
    const bad = filled.find((l) => !(Number(l.qty) > 0));
    if (bad) return setError(`${bad.part_no || bad.description}: the quantity must be more than 0.`);
    if (dueDate && dueDate < orderDate) return setError('The due date cannot be before the order date.');
    if (advanceOn && Number(advance) > figures.total) return setError('The advance cannot be more than the total.');
    const body: SentPoInput = {
      company_id: companyId || null,
      supplier_name: companyId ? companies.find((c) => c.id === companyId)?.name || null : newSupplier.trim(),
      prefix: prefix.trim(),
      seq: seq.trim() ? Number(seq) : null,
      order_date: orderDate,
      due_date: dueDate || null,
      state_of_supply: stateOfSupply || null,
      price_includes_tax: priceIncludesTax,
      round_off_enabled: roundOff,
      advance_amount: advanceOn ? Number(advance) || 0 : 0,
      terms_title: termsTitle.trim() || null,
      terms_text: termsText.trim() || null,
      payment_type: paymentType.trim() || null,
      payment_reference: paymentRef.trim() || null,
      payment_description: paymentDesc.trim() || null,
      items: filled.map((l) => ({
        product_id: l.product_id,
        part_no: l.part_no.trim() || null,
        description: l.description.trim() || null,
        hsn_sac: l.hsn_sac.trim() || null,
        qty: Number(l.qty),
        unit: l.unit.trim() || 'Nos',
        price: Number(l.price) || 0,
        discount_percent: Number(l.discount_percent) || 0,
        discount_amount: Number(l.discount_amount) || 0,
        tax_type: l.tax_type,
        tax_percent: l.tax_percent,
      })),
    };
    setSaving(true);
    setError('');
    try {
      const saved = editId ? await api.sentPos.update(editId, body) : await api.sentPos.create(body);
      showToast(`PO ${saved.number} saved.`);
      navigate('/purchase-orders?tab=sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the PO.');
      setSaving(false);
    }
  }

  if (loading) return <div className="ts-page-pad ts-muted" style={{ paddingTop: 30 }}>Loading…</div>;

  const cellIn = 'w-full bg-transparent border border-transparent hover:border-line2 focus:border-accent2 rounded px-1.5 py-1 text-[12.5px] text-fg outline-none';
  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12.5px] text-subtle"><Link to="/purchase-orders?tab=sent" className="hover:text-fg">Purchase Orders</Link> / Sent POs</div>
          <h1 className="ts-title ts-title-sm m-0">{editId ? 'Edit purchase order' : 'New purchase order'}</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/purchase-orders?tab=sent" className="ts-btn ts-ghost ts-xs">Cancel</Link>
          <button type="button" className="ts-btn ts-dark ts-xs" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save PO'}</button>
        </div>
      </div>

      {/* Header: party on the left, number and dates on the right */}
      <section className="ts-card ts-white grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="ts-fld">
          <label>Party (supplier) *</label>
          <SearchableSelect
            options={companyOptions}
            value={companyId === '' ? newSupplier : String(companyId)}
            onChange={(v) => { if (/^\d+$/.test(v)) { setCompanyId(Number(v)); setNewSupplier(''); } }}
            allowCustom
            onCreateCustom={(name) => { setCompanyId(''); setNewSupplier(name); }}
            customLabel={(name) => `Add new supplier "${name}"`}
            placeholder="Search or type the supplier name…"
          />
          {newSupplier && !companyId && <small className="ts-hint">New supplier: "{newSupplier}" is saved as a supplier with the PO.</small>}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="ts-fld">
            <label htmlFor="spo-prefix">Order no. prefix</label>
            <input id="spo-prefix" className="ts-fi" maxLength={20} value={prefix} onChange={(e) => { prefixTouched.current = true; setPrefix(e.target.value); }} placeholder="e.g. TSMTPO" />
          </div>
          <div className="ts-fld">
            <label htmlFor="spo-seq">Order no. *</label>
            <input id="spo-seq" className="ts-fi" inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value.replace(/[^\d]/g, ''))} />
            <small className="ts-hint">PO number: <b>{prefix}{seq}</b></small>
          </div>
          <div className="ts-fld">
            <label htmlFor="spo-date">Order date *</label>
            <input id="spo-date" type="date" className="ts-fi" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="ts-fld">
            <label htmlFor="spo-due">Due date</label>
            <input id="spo-due" type="date" className="ts-fi" min={orderDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="ts-fld" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="spo-state">State of supply</label>
            <select id="spo-state" className="ts-fi" value={stateOfSupply} onChange={(e) => chooseState(e.target.value)}>
              <option value="">Choose…</option>
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {ourState && <small className="ts-hint">Same state as yours ({ourState}): GST (CGST + SGST). Other states: IGST.</small>}
          </div>
        </div>
      </section>

      {/* Items */}
      <section className="ts-card ts-white ts-tbl flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-fg text-[14px]">Items</b>
          <label className="flex items-center gap-2 text-[12.5px] text-subtle">
            Price/Unit is
            <select className="ts-fi !py-1 !w-auto" value={priceIncludesTax ? 'with' : 'without'} onChange={(e) => setPriceIncludesTax(e.target.value === 'with')}>
              <option value="without">Without tax</option>
              <option value="with">With tax</option>
            </select>
          </label>
        </div>
        <div className="ts-tblwrap !mt-0">
          <table className="!min-w-[1150px]">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ width: 150 }}>Item</th>
                <th>Description</th>
                <th style={{ width: 80 }}>HSN</th>
                <th className="ts-r" style={{ width: 64 }}>Qty</th>
                <th style={{ width: 110 }}>Unit</th>
                <th className="ts-r" style={{ width: 100 }}>Price/Unit</th>
                <th className="ts-r" style={{ width: 64 }}>Disc %</th>
                <th className="ts-r" style={{ width: 90 }}>Disc ₹</th>
                <th style={{ width: 110 }}>Tax</th>
                <th className="ts-r" style={{ width: 90 }}>Tax ₹</th>
                <th className="ts-r" style={{ width: 110 }}>Amount</th>
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const f = figures.lines[i];
                return (
                  <tr key={l.key}>
                    <td className="text-subtle text-[12px]">{i + 1}</td>
                    <td>
                      <EditableCombo options={partOptions} value={l.part_no} onTextChange={(t) => patch(l.key, { part_no: t, product_id: null })} onPick={(v) => pickPart(l.key, v)} onCommit={(t) => pickPart(l.key, t)} placeholder="Part no." ariaLabel={`Item of line ${i + 1}`} />
                    </td>
                    <td><input className={cellIn} value={l.description} maxLength={500} onChange={(e) => patch(l.key, { description: e.target.value })} aria-label={`Description of line ${i + 1}`} /></td>
                    <td><input className={cellIn} value={l.hsn_sac} maxLength={20} onChange={(e) => patch(l.key, { hsn_sac: e.target.value })} aria-label={`HSN of line ${i + 1}`} /></td>
                    <td><input className={`${cellIn} text-right`} inputMode="decimal" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} aria-label={`Quantity of line ${i + 1}`} /></td>
                    <td><EditableCombo options={unitOptions(l.unit)} value={l.unit} onTextChange={(t) => patch(l.key, { unit: t })} onPick={(u) => patch(l.key, { unit: u })} placeholder="Nos" ariaLabel={`Unit of line ${i + 1}`} /></td>
                    <td><input className={`${cellIn} text-right`} inputMode="decimal" value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} placeholder="0.00" aria-label={`Price of line ${i + 1}`} /></td>
                    <td><input className={`${cellIn} text-right`} inputMode="decimal" value={l.discount_percent} onChange={(e) => patch(l.key, { discount_percent: e.target.value, discount_amount: '' })} placeholder={f && f.discount_amount > 0 && !l.discount_percent ? String(f.discount_percent) : ''} aria-label={`Discount % of line ${i + 1}`} /></td>
                    <td><input className={`${cellIn} text-right`} inputMode="decimal" value={l.discount_amount} onChange={(e) => patch(l.key, { discount_amount: e.target.value, discount_percent: '' })} placeholder={f && f.discount_amount > 0 && !l.discount_amount ? inr(f.discount_amount) : ''} aria-label={`Discount amount of line ${i + 1}`} /></td>
                    <td>
                      <select className="ts-fi !py-1 text-[12.5px]" value={taxValue(l.tax_type, l.tax_percent)} onChange={(e) => patch(l.key, parseTax(e.target.value))} aria-label={`Tax of line ${i + 1}`}>
                        {TAX_CHOICES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="ts-r num text-[12.5px]">{f ? inr(f.tax_amount) : ''}</td>
                    <td className="ts-r num text-[12.5px] font-medium">{f ? inr(f.amount) : ''}</td>
                    <td>
                      <button type="button" className="ts-iconx" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : [blankLine()]))}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-fg">
                <td colSpan={2}><button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setLines((prev) => [...prev, blankLine()])}><Plus className="size-3.5" /> Add row</button></td>
                <td className="ts-r" colSpan={2}>Total</td>
                <td className="ts-r num">{figures.qty}</td>
                <td colSpan={3}></td>
                <td className="ts-r num">{inr(figures.discount)}</td>
                <td></td>
                <td className="ts-r num">{inr(figures.tax)}</td>
                <td className="ts-r num">{inr(figures.total - figures.roundOff)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Terms, payment, totals */}
      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="ts-card ts-white flex flex-col gap-2">
          <b className="text-fg text-[14px]">Terms & Conditions</b>
          <div className="ts-fld">
            <label htmlFor="spo-ttitle">Title</label>
            <input id="spo-ttitle" className="ts-fi" maxLength={80} value={termsTitle} onChange={(e) => setTermsTitle(e.target.value)} placeholder="Purchase Order" />
          </div>
          <textarea className="ts-fi" rows={7} maxLength={5000} style={{ height: 'auto', resize: 'vertical', lineHeight: 1.5 }} value={termsText} onChange={(e) => setTermsText(e.target.value)} placeholder="Type the terms for this PO. They print on the PDF exactly as written." aria-label="Terms and conditions" />
        </div>
        <div className="ts-card ts-white flex flex-col gap-2">
          <b className="text-fg text-[14px]">Payment</b>
          <div className="ts-fld">
            <label htmlFor="spo-ptype">Payment type</label>
            <input id="spo-ptype" className="ts-fi" maxLength={100} value={paymentType} onChange={(e) => setPaymentType(e.target.value)} placeholder="e.g. Bank transfer" />
          </div>
          <div className="ts-fld">
            <label htmlFor="spo-pref">Reference No.</label>
            <input id="spo-pref" className="ts-fi" maxLength={100} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
          </div>
          <div className="ts-fld">
            <label htmlFor="spo-pdesc">Description</label>
            <textarea id="spo-pdesc" className="ts-fi" rows={3} maxLength={1000} style={{ height: 'auto', resize: 'vertical' }} value={paymentDesc} onChange={(e) => setPaymentDesc(e.target.value)} placeholder={'Payment due before shipment\nFreight charges: Ex-works'} />
          </div>
        </div>
        <div className="ts-card ts-white flex flex-col gap-2 text-[13px]">
          <b className="text-fg text-[14px]">Totals</b>
          <div className="flex justify-between text-subtle"><span>Sub total</span><span className="num">₹{inr(figures.subTotal)}</span></div>
          <div className="flex justify-between text-subtle"><span>Tax</span><span className="num">₹{inr(figures.tax)}</span></div>
          <label className="flex justify-between items-center text-subtle">
            <span className="flex items-center gap-2"><input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} /> Round off</span>
            <span className="num">₹{inr(figures.roundOff)}</span>
          </label>
          <div className="flex justify-between font-bold text-fg text-[15px] border-t border-line2 pt-1.5"><span>Total</span><span className="num">₹{inr(figures.total)}</span></div>
          <label className="flex justify-between items-center gap-2 text-subtle">
            <span className="flex items-center gap-2"><input type="checkbox" checked={advanceOn} onChange={(e) => setAdvanceOn(e.target.checked)} /> Advance amount</span>
            <input className="ts-fi !py-1 !w-32 text-right" inputMode="decimal" disabled={!advanceOn} value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0.00" aria-label="Advance amount" />
          </label>
          <div className="flex justify-between font-semibold text-fg"><span>Balance</span><span className="num">₹{inr(figures.balance)}</span></div>
        </div>
      </section>

      {error && <div className="ts-warnbox">{error}</div>}
      <div className="flex justify-end gap-2">
        <Link to="/purchase-orders?tab=sent" className="ts-btn ts-ghost ts-xs">Cancel</Link>
        <button type="button" className="ts-btn ts-dark ts-xs" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save PO'}</button>
      </div>
    </div>
  );
}
