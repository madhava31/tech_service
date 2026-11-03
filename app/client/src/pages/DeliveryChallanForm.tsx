import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ChallanType, DeliveryChallanInput, Product } from '../api';

// Delivery challan form: blank (manual), pre-filled from a quotation (?quotation=<id>), or editing an
// existing challan (/:id/edit). Part number, description and quantity only: there are no price fields.

interface Line {
  key: number;
  part_no: string;
  description: string;
  qty: string;
}

let lineKey = 0;
const newLine = (p: Partial<Line> = {}): Line => ({ key: ++lineKey, part_no: '', description: '', qty: '1', ...p });
const today = () => new Date().toISOString().slice(0, 10);
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

const blankForm = () => ({
  challan_type: 'non_returnable' as ChallanType,
  date: today(),
  invoice_no: '',
  customer_name: '',
  customer_address: '',
  attention: '',
  phone: '',
  order_date: '',
  work_order_no: '',
  job: '',
  remarks: '',
});

export default function DeliveryChallanForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isEdit = Boolean(id);
  const challanId = Number(id);
  const fromQuotationId = !isEdit && search.get('quotation') ? Number(search.get('quotation')) : null;
  const typedWorkOrder = search.get('wo') || '';

  const [form, setForm] = useState(blankForm());
  const [lines, setLines] = useState<Line[]>(fromQuotationId || isEdit ? [] : [newLine()]);
  const [quotation, setQuotation] = useState<{ id: number; number: string } | null>(null);
  const [number, setNumber] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(Boolean(fromQuotationId || isEdit));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.products.list().then(setProducts).catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    let stale = false;
    const done = () => !stale && setLoading(false);
    if (fromQuotationId) {
      api.deliveryChallans
        .fromQuotation(fromQuotationId)
        .then((d) => {
          if (stale) return;
          setForm({
            challan_type: d.challan_type,
            date: d.date,
            invoice_no: d.invoice_no || '',
            customer_name: d.customer_name || '',
            customer_address: d.customer_address || '',
            attention: d.attention || '',
            phone: d.phone || '',
            order_date: day(d.order_date),
            // A PO's reference wins; otherwise what was typed in the quotation's Client PO box.
            work_order_no: d.work_order_no || typedWorkOrder,
            job: d.job || '',
            remarks: d.remarks || '',
          });
          setQuotation(d.quotation_id ? { id: d.quotation_id, number: d.quotation_number || '' } : null);
          setLines(d.items.map((it) => newLine({ part_no: it.part_no || '', description: it.description || '', qty: String(it.qty) })));
        })
        .catch((e) => !stale && setErrors([e.message]))
        .finally(done);
    } else if (isEdit) {
      api.deliveryChallans
        .get(challanId)
        .then((dc) => {
          if (stale) return;
          setNumber(dc.number);
          setForm({
            challan_type: dc.challan_type,
            date: day(dc.date),
            invoice_no: dc.invoice_no || '',
            customer_name: dc.customer_name || '',
            customer_address: dc.customer_address || '',
            attention: dc.attention || '',
            phone: dc.phone || '',
            order_date: day(dc.order_date),
            work_order_no: dc.work_order_no || '',
            job: dc.job || '',
            remarks: dc.remarks || '',
          });
          setQuotation(dc.quotation_id ? { id: dc.quotation_id, number: dc.quotation_number || '' } : null);
          setLines(dc.items.map((it) => newLine({ part_no: it.part_no || '', description: it.description, qty: String(it.qty) })));
        })
        .catch((e) => !stale && setErrors([e.message]))
        .finally(done);
    }
    return () => {
      stale = true;
    };
  }, [fromQuotationId, isEdit, challanId, typedWorkOrder]);

  const productByPart = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.part_no.toUpperCase(), p);
    return m;
  }, [products]);

  const set = (k: keyof ReturnType<typeof blankForm>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const updateLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function changePart(key: number, value: string) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const p = productByPart.get(value.trim().toUpperCase());
        return { ...l, part_no: value, description: !l.description.trim() && p ? p.description : l.description };
      })
    );
  }
  const removeLine = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));
  const isManual = !quotation;

  function validate(kept: Line[]): string[] {
    const problems: string[] = [];
    if (!form.customer_name.trim()) problems.push('Enter the customer name.');
    if (!form.date) problems.push('Enter the challan date.');
    if (!kept.length) problems.push('Add at least one item.');
    kept.forEach((l, i) => {
      if (!l.description.trim()) problems.push(`Item ${i + 1}: enter a description.`);
      if (!(Number(l.qty) > 0)) problems.push(`Item ${i + 1}: quantity must be more than 0.`);
    });
    return problems;
  }

  async function generate() {
    if (saving) return;
    const kept = lines.filter((l) => l.part_no.trim() || l.description.trim()); // drop blank rows
    const problems = validate(kept);
    setErrors(problems);
    if (problems.length) return;
    const payload: DeliveryChallanInput = {
      ...form,
      quotation_id: quotation?.id ?? null,
      items: kept.map((l) => ({ part_no: l.part_no.trim(), description: l.description.trim(), qty: Number(l.qty) })),
    };
    setSaving(true);
    try {
      const saved = isEdit ? await api.deliveryChallans.update(challanId, payload) : await api.deliveryChallans.create(payload);
      navigate(`/delivery-challans/${saved.id}/preview`);
    } catch (e: any) {
      setErrors([e.message]);
    } finally {
      setSaving(false);
    }
  }

  const backTo = quotation && !isEdit ? `/quotations/${quotation.id}` : '/delivery-challans';
  const title = isEdit ? `Edit delivery challan ${number}` : quotation ? 'Convert to Delivery Challan' : 'New delivery challan';

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div>
          <Link to={backTo} className="ts-back">← {quotation && !isEdit ? `Quotation ${quotation.number}` : 'Delivery Challans'}</Link>
          <h1>{title}</h1>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            {quotation ? `Pre-filled from quotation ${quotation.number}. Every field can be changed.` : 'Type the challan details. The DC number is assigned when you generate it.'}
          </p>
        </div>
        <span className="ts-grow" />
        <button type="button" onClick={generate} disabled={saving || loading} className="ts-btn ts-dark">
          <CheckIcon /> {saving ? 'Generating…' : 'Generate delivery challan'}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="ts-warnbox" role="alert">
          <span>
            {errors.length === 1 ? errors[0] : (
              <>Fix these before generating:<ul className="m-0 mt-1 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></>
            )}
          </span>
        </div>
      )}

      {loading ? (
        <div className="ts-card ts-white"><span className="ts-muted">Loading…</span></div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="ts-card ts-white" style={{ ['--i' as string]: 0 }}>
            <div className="ts-ch"><b>Challan</b></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="ts-fld">
                <label htmlFor="dc-type">Challan type</label>
                <select id="dc-type" className="ts-fi" value={form.challan_type} onChange={(e) => setForm((f) => ({ ...f, challan_type: e.target.value as ChallanType }))}>
                  <option value="non_returnable">Non Returnable</option>
                  <option value="returnable">Returnable</option>
                </select>
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-date">Date</label>
                <input id="dc-date" type="date" className="ts-fi" value={form.date} onChange={set('date')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-inv">Invoice No. (optional)</label>
                <input id="dc-inv" className="ts-fi" value={form.invoice_no} onChange={set('invoice_no')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-odate">Order date</label>
                <input id="dc-odate" type="date" className="ts-fi" value={form.order_date} onChange={set('order_date')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-wo">Work order no.</label>
                <input id="dc-wo" className="ts-fi" value={form.work_order_no} onChange={set('work_order_no')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-job">Job</label>
                <input id="dc-job" className="ts-fi" value={form.job} onChange={set('job')} />
              </div>
              <div className="ts-fld">
                <label>Quotation ref.</label>
                <div className="ts-fi ts-muted" aria-readonly="true">{quotation ? quotation.number : '— (manual challan)'}</div>
              </div>
            </div>
          </section>

          <section className="ts-card ts-white" style={{ ['--i' as string]: 1 }}>
            <div className="ts-ch"><b>Deliver to</b></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="ts-fld">
                <label htmlFor="dc-cust">Customer name</label>
                <input id="dc-cust" className="ts-fi" value={form.customer_name} onChange={set('customer_name')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-att">Attention</label>
                <input id="dc-att" className="ts-fi" value={form.attention} onChange={set('attention')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-addr">Address</label>
                <textarea id="dc-addr" className="ts-fi" rows={3} value={form.customer_address} onChange={set('customer_address')} />
              </div>
              <div className="ts-fld">
                <label htmlFor="dc-phone">Phone no.</label>
                <input id="dc-phone" className="ts-fi" value={form.phone} onChange={set('phone')} />
              </div>
            </div>
          </section>

          <section className="ts-card ts-white" style={{ ['--i' as string]: 2 }}>
            <div className="ts-rhead">
              <div className="ts-ch"><b>Items</b></div>
              <span className="ts-muted" style={{ fontSize: 13 }}>Part no., description and quantity only</span>
            </div>
            <datalist id="dc-parts">
              {products.map((p) => <option key={p.id} value={p.part_no}>{p.description}</option>)}
            </datalist>
            <div className="ts-tblwrap mt-3">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>S.No.</th>
                    <th style={{ width: '24%' }}>Part no.</th>
                    <th>Description</th>
                    <th className="ts-r" style={{ width: 110 }}>Qty</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td className="ts-muted">{i + 1}</td>
                      <td><input className="ts-fi font-mono" list="dc-parts" value={l.part_no} onChange={(e) => changePart(l.key, e.target.value)} aria-label={`Item ${i + 1} part number`} /></td>
                      <td><input className="ts-fi" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} aria-label={`Item ${i + 1} description`} /></td>
                      <td><input className="ts-fi ts-r" type="number" min="0" step="any" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} aria-label={`Item ${i + 1} quantity`} /></td>
                      <td>
                        <button type="button" className="ts-iconx" onClick={() => removeLine(l.key)} aria-label={`Remove item ${i + 1}`}><Trash2Icon className="size-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={5} className="ts-empty">No items. {isManual ? 'Add one below.' : 'All quotation lines were removed.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {isManual && (
              <div className="mt-3">
                <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setLines((ls) => [...ls, newLine()])}><PlusIcon /> Add item</button>
              </div>
            )}
          </section>

          <section className="ts-card ts-white" style={{ ['--i' as string]: 3 }}>
            <div className="ts-ch"><b>Remarks</b></div>
            <textarea className="ts-fi mt-3" rows={2} value={form.remarks} onChange={set('remarks')} aria-label="Remarks" />
          </section>
        </div>
      )}
    </div>
  );
}
