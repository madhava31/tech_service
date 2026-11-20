import { useEffect, useMemo, useState } from 'react';
import { api, type QuickEntryLine, type QuickEntryPreview, type Warehouse } from '../api';
import { MovementDateField, todayIST } from './MovementDateField';

type Row = QuickEntryLine & {
  key: number;
  qtyText: string;
  skip: boolean;
  /** Description typed for a part that is not in the catalogue yet. */
  newDescription: string;
  creating: boolean;
  createError: string;
};

/**
 * Quick entry of incoming stock: paste or type "part number, quantity" lines (from Excel, a packing list or a message), check
 * the list, and save it as one confirmed stock receipt. Parts are found even when the leading zero or a dash is missing.
 * After saving, the receipt page shows which customers are waiting for the stock.
 */
export function QuickEntryModal({ warehouses, onClose, onSaved }: { warehouses: Warehouse[]; onClose: () => void; onSaved: (receiptId: number) => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<QuickEntryPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [date, setDate] = useState(todayIST());
  const [reference, setReference] = useState('');
  const [make, setMake] = useState('');
  const [makes, setMakes] = useState<string[]>([]);

  useEffect(() => { api.inventory.getStockMakes().then(setMakes).catch(() => {}); }, []);
  useEffect(() => {
    if (!warehouseId && warehouses.length) setWarehouseId(String((warehouses.find((w) => w.is_default) || warehouses[0]).id));
  }, [warehouses, warehouseId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function check() {
    if (!text.trim()) return setError('Paste or type the lines first, for example: N8152473, 5');
    setChecking(true);
    setError('');
    try {
      const r = await api.inventory.quickEntryPreview(text);
      setPreview(r);
      setRows(r.lines.map((l, i) => ({ ...l, key: i, qtyText: String(l.qty), skip: false, newDescription: '', creating: false, createError: '' })));
      if (r.lines.length === 0) setError('No lines with a part number and a quantity were found.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the lines.');
    } finally {
      setChecking(false);
    }
  }

  const patch = (key: number, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function createProduct(r: Row) {
    if (!r.newDescription.trim()) return patch(r.key, { createError: 'Type the product description first.' });
    patch(r.key, { creating: true, createError: '' });
    try {
      const p = await api.products.create({ part_no: r.part, description: r.newDescription.trim(), default_price: 0, unit: 'Nos' } as never);
      patch(r.key, { creating: false, status: 'matched', product: { id: p.id, part_no: p.part_no, description: p.description, unit: p.unit ?? 'Nos', make: p.make ?? null } });
    } catch (e) {
      patch(r.key, { creating: false, createError: e instanceof Error ? e.message : 'Could not add the product.' });
    }
  }

  const ready = useMemo(() => rows.filter((r) => !r.skip && r.status === 'matched' && r.product && Number(r.qtyText) > 0), [rows]);
  const open = rows.filter((r) => !r.skip && r.status !== 'matched');
  const units = ready.reduce((a, r) => a + Number(r.qtyText), 0);

  async function save() {
    if (!ready.length) return setError('There is nothing to save yet.');
    if (!warehouseId) return setError('Choose the warehouse.');
    if (!date) return setError('Choose the date received.');
    setSaving(true);
    setError('');
    try {
      const res = await api.inventory.receipts.create({
        warehouseId: Number(warehouseId),
        sourceType: 'MANUAL',
        sourceReference: reference.trim() || undefined,
        notes: 'Quick entry',
        items: ready.map((r) => ({ productId: r.product!.id, quantity: Number(r.qtyText) })),
        confirmImmediately: true,
        make: make || undefined,
        receiptDate: date,
      });
      onSaved(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the receipt.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Quick entry">
      <div className="ts-modal max-w-4xl w-full flex flex-col gap-4 max-h-[94vh] overflow-y-auto">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Quick entry: receive stock from a list</h3>
            <p className="m-0 mt-1.5 text-[13px] text-subtle">Paste or type one line per part: <b>part number, quantity</b>. Copying two columns from Excel works. A missing leading zero or dash is fine.</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="ts-fgrid ts-g3">
          <div className="ts-fld">
            <label htmlFor="qe-wh">Warehouse *</label>
            <select id="qe-wh" className="ts-fi" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <MovementDateField id="qe-date" label="Date received *" value={date} onChange={setDate} hint="" />
          <div className="ts-fld">
            <label htmlFor="qe-ref">Supplier / order reference</label>
            <input id="qe-ref" className="ts-fi" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PE251119-03" />
          </div>
        </div>

        <div className="ts-fld">
          <label htmlFor="qe-text">Lines</label>
          <textarea id="qe-text" rows={rows.length ? 4 : 8} className="ts-fi font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'N8152473, 5\n09923536  10\nB0143019\t2'} />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="ts-btn ts-dark ts-xs" onClick={check} disabled={checking || saving}>{checking ? 'Checking…' : rows.length ? 'Check again' : 'Check the list'}</button>
            {preview && <span className="text-[12.5px] text-subtle">{preview.summary.matched} found · {preview.summary.not_found} not in the catalogue · {preview.summary.ambiguous} to choose · {preview.summary.units} units</span>}
          </div>
        </div>

        {preview && preview.problems.length > 0 && (
          <div className="ts-warnbox text-[12.5px]">
            {preview.problems.length} {preview.problems.length === 1 ? 'line was' : 'lines were'} skipped: {preview.problems.slice(0, 4).map((p) => `“${p.text}” (${p.problem})`).join(', ')}{preview.problems.length > 4 ? ' …' : ''}
          </div>
        )}

        {rows.length > 0 && (
          <div className="ts-tblwrap !mt-0">
            <table className="!min-w-[640px]">
              <thead><tr><th>Part number</th><th>Product</th><th className="ts-r">Quantity</th><th>Status</th><th className="ts-r"></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.skip ? 'opacity-40' : ''}>
                    <td className="font-mono text-[12.5px]">{r.part}{r.merged > 0 && <small className="block text-[11px] text-subtle">{r.merged + 1} lines added up</small>}</td>
                    <td className="text-[12.5px] whitespace-normal max-w-[280px]">
                      {r.status === 'matched' && r.product && <><span className="text-fg">{r.product.description}</span>{r.product.part_no !== r.part && <small className="block text-[11px] text-subtle">catalogue: {r.product.part_no}</small>}</>}
                      {r.status === 'ambiguous' && (
                        <select className="ts-fi !py-1" value="" onChange={(e) => { const c = r.candidates?.find((x) => x.id === Number(e.target.value)); if (c) patch(r.key, { status: 'matched', product: c }); }}>
                          <option value="">Choose the product…</option>
                          {r.candidates?.map((c) => <option key={c.id} value={c.id}>{c.part_no} · {c.description}</option>)}
                        </select>
                      )}
                      {r.status === 'not_found' && (
                        <div className="flex flex-col gap-1">
                          <input className="ts-fi !py-1" placeholder="Not in the catalogue. Type its description to add it" value={r.newDescription} onChange={(e) => patch(r.key, { newDescription: e.target.value, createError: '' })} />
                          {r.createError && <small className="text-bad text-[11px]">{r.createError}</small>}
                        </div>
                      )}
                    </td>
                    <td className="ts-r" style={{ width: 96 }}>
                      <input type="number" min="0" step="any" className="ts-fi !py-1 text-right" aria-label={`Quantity of ${r.part}`} value={r.qtyText} disabled={r.skip} onChange={(e) => patch(r.key, { qtyText: e.target.value })} />
                    </td>
                    <td>
                      {r.status === 'matched' && <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-goodbg text-good">Found</span>}
                      {r.status === 'ambiguous' && <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-warnbg text-warn">Choose</span>}
                      {r.status === 'not_found' && <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-badbg text-bad">New part</span>}
                    </td>
                    <td className="ts-r whitespace-nowrap">
                      {r.status === 'not_found' && !r.skip && <button type="button" className="ts-btn ts-ghost ts-xs mr-1" disabled={r.creating} onClick={() => createProduct(r)}>{r.creating ? 'Adding…' : 'Add part'}</button>}
                      <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => patch(r.key, { skip: !r.skip })}>{r.skip ? 'Include' : 'Skip'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && open.length > 0 && <small className="text-[12.5px] text-warn">{open.length} {open.length === 1 ? 'line is' : 'lines are'} not ready and will be left out unless you choose, add or skip {open.length === 1 ? 'it' : 'them'}.</small>}
        {error && <p className="text-[13px] text-bad m-0">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ts-fld" style={{ minWidth: 220 }}>
            <label htmlFor="qe-make">Company for these parts (optional)</label>
            <select id="qe-make" className="ts-fi !py-1.5" value={make} onChange={(e) => setMake(e.target.value)}>
              <option value="">Leave the company as it is</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="ts-btn ts-dark ts-xs" onClick={save} disabled={saving || ready.length === 0}>
              {saving ? 'Saving…' : ready.length ? `Save receipt: ${ready.length} ${ready.length === 1 ? 'part' : 'parts'}, ${units} units` : 'Save receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
