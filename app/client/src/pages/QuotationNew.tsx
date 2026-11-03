import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, Company, Opportunity, Product, QuotationModulePayload, QuotationTerm } from '../api';
import SearchableSelect from '../components/SearchableSelect';

// Quotation module form: customer, catalogue product lines, GST, and the terms printed on the PDF.

interface Line {
  key: number;
  part_no: string;
  qty: string;
  unit_price: string;
  discount_percent: string;
}

const WARRANTY_REQUIRED = 'Enter the warranty for this quotation.';

/** Fresh copy for every new quotation, so edits never change the defaults. */
function defaultTerms(): QuotationTerm[] {
  return [
    { label: 'Payment', text: '100% advance' },
    { label: 'Delivery', text: '4 to 6 weeks from the date of PO' },
    { label: 'Warranty', text: '' },
    { label: 'Validity', text: '30 days from the quotation date' },
  ];
}

let lineKey = 0;
const newLine = (): Line => ({ key: ++lineKey, part_no: '', qty: '1', unit_price: '', discount_percent: '0' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const isCustomer = (c: Company & { is_supplier?: number | null; company_type?: string | null }) =>
  Number(c.is_supplier) !== 1 && (c.company_type || '').toLowerCase() !== 'supplier';

export default function QuotationNew() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const quotationId = Number(id);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);

  const [companyId, setCompanyId] = useState<number | ''>('');
  const [contactPerson, setContactPerson] = useState('');
  const [date, setDate] = useState(today());
  const [opportunityRef, setOpportunityRef] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [taxPercent, setTaxPercent] = useState('18');
  const [terms, setTerms] = useState<QuotationTerm[]>(defaultTerms());
  const [number, setNumber] = useState('');

  const [errors, setErrors] = useState<string[]>([]);
  const [warrantyError, setWarrantyError] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.companies.list().then((cs) => setCompanies((cs as Company[]).filter(isCustomer))).catch((e) => setLoadError(e.message));
    api.products.list().then(setProducts).catch((e) => setLoadError(e.message));
    api.opportunities.list().then((d) => setOpportunities(d.opportunities || [])).catch(() => setOpportunities([]));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    // A response that arrives after this effect was cleaned up (route change, or React running the
    // effect twice in development) must not overwrite what the user has typed since.
    let stale = false;
    api.quotations
      .get(quotationId)
      .then((q) => {
        if (stale) return;
        setNumber(q.number);
        setCompanyId(q.company_id);
        setContactPerson(q.contact_person || '');
        setDate(String(q.date).slice(0, 10));
        setOpportunityRef(q.opportunity_ref || '');
        setTaxPercent(String(q.tax_percent ?? 18));
        setTerms(Array.isArray(q.terms) && q.terms.length ? q.terms.map((t) => ({ ...t })) : defaultTerms());
        const items = q.items || [];
        setLines(
          items.length
            ? items.map((it) => ({
                key: ++lineKey,
                part_no: it.part_no || '',
                qty: String(it.qty ?? 1),
                unit_price: String(it.actual_unit_price ?? it.price ?? ''),
                discount_percent: String(it.discount_type === 'percentage' ? it.discount_value ?? 0 : 0),
              }))
            : [newLine()]
        );
      })
      .catch((e) => {
        if (!stale) setLoadError(e.message);
      });
    return () => {
      stale = true;
    };
  }, [isEdit, quotationId]);

  const productByPart = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.part_no.toUpperCase(), p);
    return m;
  }, [products]);
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.part_no, label: `${p.part_no} — ${p.description}${p.make ? ` (${p.make})` : ''}` })),
    [products]
  );
  const companyOptions = useMemo(() => companies.map((c) => ({ value: String(c.id), label: c.name })), [companies]);
  const companyOpportunities = useMemo(
    () => opportunities.filter((o) => companyId && o.company_id === companyId),
    [opportunities, companyId]
  );

  // ---- live calculation ----
  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = Number(l.qty) || 0;
      const price = Number(l.unit_price) || 0;
      const disc = Number(l.discount_percent) || 0;
      const unitSales = round2(price * (1 - disc / 100));
      return { unitSales, total: round2(unitSales * qty) };
    });
    const subtotal = round2(rows.reduce((s, r) => s + r.total, 0));
    const gst = Number(taxPercent) || 0;
    const gstAmount = round2(subtotal * (gst / 100));
    return { rows, subtotal, gst, gstAmount, grand: round2(subtotal + gstAmount) };
  }, [lines, taxPercent]);

  // ---- line editing ----
  const updateLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function pickPart(key: number, partNo: string) {
    const p = productByPart.get(partNo.toUpperCase());
    updateLine(key, { part_no: partNo, ...(p ? { unit_price: p.default_price ? String(p.default_price) : '' } : {}) });
  }
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  // ---- terms editing ----
  const setTerm = (i: number, patch: Partial<QuotationTerm>) => {
    setTerms((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    if (patch.text !== undefined) setWarrantyError(false);
  };
  const moveTerm = (i: number, dir: -1 | 1) =>
    setTerms((ts) => {
      const j = i + dir;
      if (j < 0 || j >= ts.length) return ts;
      const next = [...ts];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addTerm = () => setTerms((ts) => [...ts, { label: '', text: '' }]);
  const removeTerm = (i: number) => setTerms((ts) => ts.filter((_, j) => j !== i));

  function onCompanyChange(v: string) {
    const idNum = v ? Number(v) : '';
    setCompanyId(idNum);
    setOpportunityRef('');
    const c = companies.find((x) => x.id === idNum);
    if (c && !contactPerson.trim()) setContactPerson(c.contact_person || '');
  }

  // ---- validation (the server checks the same rules) ----
  function validate(): string[] {
    const problems: string[] = [];
    if (!companyId) problems.push('Select a customer.');
    if (!date) problems.push('Enter the quotation date.');
    const gst = Number(taxPercent);
    if (taxPercent === '' || Number.isNaN(gst) || gst < 0 || gst > 100) problems.push('GST % must be between 0 and 100.');
    if (!lines.length) problems.push('Add at least one product.');
    lines.forEach((l, i) => {
      const n = i + 1;
      const p = l.part_no ? productByPart.get(l.part_no.toUpperCase()) : undefined;
      if (!l.part_no) problems.push(`Line ${n}: select a part number.`);
      else if (!p) problems.push(`Line ${n}: ${l.part_no} is not in the product catalogue.`);
      else if (!(p.key_features || []).some((f) => f.trim())) problems.push(`Line ${n}: ${p.part_no} has no key features. Add them on the Products page first.`);
      if (!(Number(l.qty) > 0)) problems.push(`Line ${n}: quantity must be more than 0.`);
      if (!(Number(l.unit_price) > 0)) problems.push(`Line ${n}: unit price must be more than 0.`);
      const d = Number(l.discount_percent);
      if (l.discount_percent !== '' && (Number.isNaN(d) || d < 0 || d >= 100)) problems.push(`Line ${n}: discount must be 0 or more and less than 100%.`);
    });
    if (terms.some((t) => !t.label.trim() && t.text.trim())) problems.push('Every term needs a label.');
    return problems;
  }

  async function generate() {
    if (saving) return;
    const problems = validate();
    const warranty = terms.find((t) => t.label.trim().toLowerCase() === 'warranty');
    const noWarranty = !warranty || !warranty.text.trim();
    setWarrantyError(noWarranty);
    if (noWarranty) problems.push(WARRANTY_REQUIRED);
    setErrors(problems);
    if (problems.length) return;

    const payload: QuotationModulePayload = {
      company_id: Number(companyId),
      contact_person: contactPerson.trim(),
      date,
      opportunity_ref: opportunityRef,
      tax_percent: Number(taxPercent),
      items: lines.map((l) => ({
        part_no: l.part_no,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
        discount_percent: Number(l.discount_percent) || 0,
      })),
      terms: terms.map((t) => ({ label: t.label.trim(), text: t.text.trim() })).filter((t) => t.label || t.text),
    };
    setSaving(true);
    try {
      const saved = isEdit ? await api.quotations.update(quotationId, payload) : await api.quotations.create(payload);
      navigate(`/quotations/${saved.id}/preview`);
    } catch (e: any) {
      setErrors([e.message]);
      if (e.message === WARRANTY_REQUIRED) setWarrantyError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div>
          <Link to={isEdit ? `/quotations/${quotationId}` : '/quotations'} className="ts-back">
            ← {isEdit ? 'Back to quotation' : 'Quotations'}
          </Link>
          <h1>{isEdit ? `Edit quotation ${number}` : 'New quotation'}</h1>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            {isEdit ? 'Saving regenerates the PDF with the same quotation number.' : 'The quotation number is assigned when you generate it.'}
          </p>
        </div>
        <span className="ts-grow" />
        <button type="button" onClick={generate} disabled={saving} className="ts-btn ts-dark">
          <CheckIcon /> {saving ? 'Generating…' : 'Generate quotation'}
        </button>
      </div>

      {loadError && <div className="ts-warnbox"><span>{loadError}</span></div>}
      {errors.length > 0 && (
        <div className="ts-warnbox" role="alert">
          <span>
            {errors.length === 1 ? errors[0] : (
              <>Fix these before generating:<ul className="m-0 mt-1 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></>
            )}
          </span>
        </div>
      )}

      <div className="ts-qgrid">
        <div className="ts-qmain">
          {/* Customer */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 0 }}>
            <div className="ts-ch"><b>Customer</b></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="ts-fld">
                <label>Customer</label>
                <SearchableSelect
                  options={companyOptions}
                  value={companyId ? String(companyId) : ''}
                  onChange={onCompanyChange}
                  placeholder="Select a customer account"
                />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-contact">Contact person</label>
                <input id="q-contact" className="ts-fi" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="e.g. R. Prasad" />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-date">Quotation date</label>
                <input id="q-date" type="date" className="ts-fi" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="ts-fld">
                <label htmlFor="q-opp">Linked opportunity (optional)</label>
                <select id="q-opp" className="ts-fi" value={opportunityRef} onChange={(e) => setOpportunityRef(e.target.value)} disabled={!companyId}>
                  <option value="">None</option>
                  {opportunityRef && !companyOpportunities.some((o) => `${o.type}: ${o.title}` === opportunityRef) && (
                    <option value={opportunityRef}>{opportunityRef}</option>
                  )}
                  {companyOpportunities.map((o) => {
                    const ref = `${o.type}: ${o.title}`;
                    return <option key={ref} value={ref}>{o.title}</option>;
                  })}
                </select>
                <small className="ts-hint">{companyId ? `${companyOpportunities.length} open opportunit${companyOpportunities.length === 1 ? 'y' : 'ies'} for this customer` : 'Select a customer first'}</small>
              </div>
            </div>
          </section>

          {/* Products */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
            <div className="ts-rhead">
              <div className="ts-ch"><b>Products</b></div>
              <span className="ts-muted" style={{ fontSize: 13 }}>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-col gap-3 mt-4">
              {lines.map((l, idx) => {
                const p = l.part_no ? productByPart.get(l.part_no.toUpperCase()) : undefined;
                const feats = (p?.key_features || []).filter((f) => f.trim());
                const r = calc.rows[idx];
                return (
                  <div key={l.key} className="ts-qline">
                    <div className="ts-ql-h">
                      <b>Line {idx + 1}</b>
                      <span className="ts-grow" />
                      <button type="button" className="ts-iconx" onClick={() => removeLine(l.key)} disabled={lines.length === 1} aria-label={`Remove line ${idx + 1}`}>
                        <Trash2Icon className="size-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 mt-3">
                      <div className="ts-fld">
                        <label>Part number</label>
                        <SearchableSelect options={productOptions} value={l.part_no} onChange={(v) => pickPart(l.key, v)} placeholder="Search part number or name" />
                      </div>
                      <div className="ts-fld">
                        <label>Qty</label>
                        <input type="number" min="0" step="any" className="ts-fi ts-r" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} />
                      </div>
                      <div className="ts-fld">
                        <label>Unit price (INR)</label>
                        <input type="number" min="0" step="any" className="ts-fi ts-r" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: e.target.value })} />
                      </div>
                      <div className="ts-fld">
                        <label>Discount %</label>
                        <input type="number" min="0" max="99.99" step="any" className="ts-fi ts-r" value={l.discount_percent} onChange={(e) => updateLine(l.key, { discount_percent: e.target.value })} />
                      </div>
                    </div>
                    {p ? (
                      <div className="mt-3 text-[13px]">
                        <div className="font-medium text-fg">{p.description}{p.make ? <span className="ts-muted font-normal"> · {p.make}</span> : null}</div>
                        {feats.length ? (
                          <ul className="m-0 mt-1 pl-5 text-subtle">{feats.map((f) => <li key={f}>{f}</li>)}</ul>
                        ) : (
                          <div className="text-warn mt-1">No key features in the catalogue: add them on the Products page.</div>
                        )}
                      </div>
                    ) : null}
                    <div className="flex justify-end gap-6 mt-3 text-[13px]">
                      <span className="ts-muted">Unit sales price <b className="text-fg num">{inr(r.unitSales)}</b></span>
                      <span className="ts-muted">Line total <b className="text-fg num">{inr(r.total)}</b></span>
                    </div>
                  </div>
                );
              })}
              <div>
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={addLine}><PlusIcon /> Add product</button>
              </div>
            </div>
          </section>

          {/* Terms & Conditions */}
          <section className="ts-card ts-white" style={{ ['--i' as string]: 2 }}>
            <div className="ts-rhead">
              <div className="ts-ch"><b>Terms &amp; Conditions</b></div>
              <span className="ts-muted" style={{ fontSize: 13 }}>Printed exactly as shown, in this order</span>
            </div>
            <div className="flex flex-col gap-2 mt-4">
              {terms.map((t, i) => {
                const isWarranty = t.label.trim().toLowerCase() === 'warranty';
                const bad = isWarranty && warrantyError && !t.text.trim();
                return (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)_auto] gap-2 md:items-start">
                    <input
                      className="ts-fi"
                      value={t.label}
                      onChange={(e) => setTerm(i, { label: e.target.value })}
                      placeholder="Label"
                      aria-label={`Term ${i + 1} label`}
                    />
                    <div className={`ts-fld ${bad ? 'ts-bad' : ''}`}>
                      <input
                        className="ts-fi"
                        value={t.text}
                        onChange={(e) => setTerm(i, { text: e.target.value })}
                        placeholder={isWarranty ? 'Required, e.g. 12 months from the date of installation' : 'Text'}
                        aria-label={`Term ${i + 1} text`}
                      />
                      {bad && <small className="text-bad text-[12px]">{WARRANTY_REQUIRED}</small>}
                    </div>
                    {/* Same height as the inputs so the icons sit centred on the row */}
                    <div className="flex items-center gap-1 h-[44px]">
                      <button type="button" className="ts-btn ts-ghost ts-xs !p-0 w-8 h-8 justify-center" onClick={() => moveTerm(i, -1)} disabled={i === 0} aria-label={`Move term ${i + 1} up`} title="Move up"><ArrowUpIcon className="size-4" /></button>
                      <button type="button" className="ts-btn ts-ghost ts-xs !p-0 w-8 h-8 justify-center" onClick={() => moveTerm(i, 1)} disabled={i === terms.length - 1} aria-label={`Move term ${i + 1} down`} title="Move down"><ArrowDownIcon className="size-4" /></button>
                      <button type="button" className="ts-iconx" onClick={() => removeTerm(i)} aria-label={`Remove term ${i + 1}`} title="Remove term"><Trash2Icon className="size-4" /></button>
                    </div>
                  </div>
                );
              })}
              <div>
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={addTerm}><PlusIcon /> Add term</button>
              </div>
            </div>
          </section>
        </div>

        {/* Summary */}
        <aside className="ts-qside">
          <div className="ts-card ts-white ts-qsum" style={{ ['--i' as string]: 1 }}>
            <div className="ts-ch">Quotation summary</div>
            <div className="ts-qno">{isEdit ? number : 'New quotation'}</div>
            <div className="ts-fld mt-4">
              <label htmlFor="q-gst">GST %</label>
              <div className="ts-suffix">
                <input id="q-gst" type="number" min="0" max="100" step="any" className="ts-fi ts-r" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
                <span>%</span>
              </div>
            </div>
            <dl className="ts-sumrows">
              <div><dt>Sub total</dt><dd className="num">{inr(calc.subtotal)}</dd></div>
              <div><dt>GST @ {calc.gst}%</dt><dd className="num">{inr(calc.gstAmount)}</dd></div>
            </dl>
            <div className="ts-grand"><span>Grand total</span><b className="num">{inr(calc.grand)}</b></div>
            <button type="button" onClick={generate} disabled={saving} className="ts-btn ts-dark mt-4 w-full justify-center">
              <CheckIcon /> {saving ? 'Generating…' : 'Generate quotation'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
