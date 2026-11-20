import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type QuotationItem, type Warehouse } from '../api';
import { showToast } from '../lib/savePdf';

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * "Invoice" dialog, like "PO received": the user types the invoice number from their tax invoice, the invoice date,
 * the items and quantities billed, and the payment due date. The list starts with what is still left to invoice
 * (ordered on the POs minus earlier invoices); the payment due date starts as the invoice date plus the quotation's
 * payment due days and can be changed.
 */
export function InvoiceModal({
  quotationId,
  quotationNumber,
  items,
  ordered,
  invoiced,
  dueDays,
  prefill,
  onClose,
  onSaved,
}: {
  quotationId: number;
  quotationNumber: string;
  items: QuotationItem[];
  /** Quantities ordered on the POs received, per quotation item id. Empty when no PO items were recorded: the quoted quantity is used. */
  ordered: Record<number, number>;
  /** Quantities already billed by earlier invoices, per quotation item id. */
  invoiced: Record<number, number>;
  /** The quotation's payment due days (default 30). */
  dueDays: number;
  /** Dispatch from the waiting orders: the items to tick and how many of each, per quotation item id. */
  prefill?: Record<number, number> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, dueDays));
  const [dueTouched, setDueTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const hasOrders = Object.keys(ordered).length > 0;
  const limitOf = (it: QuotationItem) => (hasOrders ? ordered[it.id as number] || 0 : Number(it.qty));
  const leftOf = (it: QuotationItem) => Math.max(0, limitOf(it) - (invoiced[it.id as number] || 0));
  const lines = items.filter((it) => it.id !== undefined && limitOf(it) > 0);
  const [rows, setRows] = useState(() =>
    lines.map((it) => {
      const id = it.id as number;
      if (prefill) {
        const want = Math.min(Number(prefill[id]) || 0, leftOf(it));
        return { id, checked: want > 0, qty: want > 0 ? String(want) : '' };
      }
      return { id, checked: leftOf(it) > 0, qty: String(leftOf(it) || '') };
    })
  );
  // The warehouse the goods leave from, and the stock each line has there.
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [stock, setStock] = useState<Record<number, { tracked: boolean; on_hand: number; available: number; serials?: { id: number; serial_number: string }[] }> | null>(null);
  // Serial numbers picked per line (products kept by serial number, such as Mettler instruments).
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !savingRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    api.inventory.listWarehouses(true).then((w) => setWarehouses(w)).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    api.quotations.invoices
      .stock(quotationId, warehouseId === '' ? undefined : warehouseId)
      .then((r) => {
        if (!live) return;
        setStock(Object.fromEntries(r.items.map((x) => [x.quotation_item_id, { tracked: x.tracked, on_hand: x.on_hand, available: x.available, serials: x.serials }])));
        if (warehouseId === '' && r.warehouse) setWarehouseId(r.warehouse.id);
      })
      .catch(() => { if (live) setStock(null); });
    return () => { live = false; };
  }, [quotationId, warehouseId]);

  // The payment due date follows the invoice date until the user changes it by hand.
  const changeInvoiceDate = (v: string) => {
    setInvoiceDate(v);
    if (!dueTouched && v) setDueDate(addDays(v, dueDays));
  };

  const setRow = (id: number, patch: Partial<{ checked: boolean; qty: string }>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);
  // How many serial numbers a line needs: one per unit, at most the serial-numbered units in stock.
  const serialsNeeded = (id: number, qty: string) => {
    const list = stock?.[id]?.serials;
    return list && list.length ? Math.min(Math.floor(Number(qty) || 0), list.length) : 0;
  };
  // Keep the picks in step with the ticked lines and quantities: the oldest units are picked first, and can be changed.
  useEffect(() => {
    if (!stock) return;
    setPicks((prev) => {
      const next: Record<number, number[]> = {};
      const taken = new Set<number>();
      let changed = false;
      for (const r of rows) {
        const list = stock[r.id]?.serials;
        const need = r.checked ? serialsNeeded(r.id, r.qty) : 0;
        if (!list || need === 0) { if ((prev[r.id] || []).length) changed = true; continue; }
        const valid = (prev[r.id] || []).filter((x) => list.some((s) => s.id === x) && !taken.has(x)).slice(0, need);
        for (const s of list) { if (valid.length >= need) break; if (!valid.includes(s.id) && !taken.has(s.id)) valid.push(s.id); }
        valid.forEach((x) => taken.add(x));
        next[r.id] = valid;
        if (valid.length !== (prev[r.id] || []).length || valid.some((x, i) => x !== (prev[r.id] || [])[i])) changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, stock]);
  const togglePick = (id: number, serialId: number) =>
    setPicks((prev) => {
      const have = prev[id] || [];
      const need = serialsNeeded(id, rows.find((r) => r.id === id)?.qty || '');
      if (have.includes(serialId)) return { ...prev, [id]: have.filter((x) => x !== serialId) };
      // Picking one more than needed swaps out the oldest pick, so the count stays right.
      const base = have.length >= need ? have.slice(1) : have;
      return { ...prev, [id]: [...base, serialId] };
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!invoiceNumber.trim()) return setError('Enter the invoice number.');
    if (invoiceNumber.trim().length > 60) return setError('The invoice number can be at most 60 characters.');
    if (!invoiceDate) return setError('Enter the invoice date.');
    if (!dueDate) return setError('Enter the payment due date.');
    if (dueDate < invoiceDate) return setError('The payment due date cannot be before the invoice date.');
    if (chosen.length === 0) return setError('Tick at least one item on this invoice.');
    if (chosen.some((r) => !(Number(r.qty) > 0))) return setError('Every ticked item needs a quantity above 0.');
    // Stock: items linked to a product leave the warehouse, so there must be enough there.
    const tracked = chosen.filter((r) => stock?.[r.id]?.tracked);
    if (tracked.length && warehouseId === '') return setError('Choose the warehouse the goods leave from.');
    const short = tracked.find((r) => Number(r.qty) > (stock?.[r.id]?.available ?? 0));
    if (short) {
      const it = lines.find((x) => x.id === short.id);
      return setError(`${it?.part_no || 'An item'}: only ${stock?.[short.id]?.available ?? 0} in stock here, but the invoice needs ${short.qty}.`);
    }
    for (const r of chosen) {
      const need = serialsNeeded(r.id, r.qty);
      if (need > 0 && (picks[r.id] || []).length !== need) {
        const it = lines.find((x) => x.id === r.id);
        return setError(`${it?.part_no || 'An item'}: pick ${need} serial number${need === 1 ? '' : 's'} (${(picks[r.id] || []).length} picked).`);
      }
    }
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await api.quotations.invoices.create(quotationId, {
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        payment_due_date: dueDate,
        warehouse_id: warehouseId === '' ? undefined : warehouseId,
        notes: notes.trim() || undefined,
        items: chosen.map((r) => ({ quotation_item_id: r.id, qty: Number(r.qty) })),
        serials: Object.fromEntries(chosen.filter((r) => serialsNeeded(r.id, r.qty) > 0).map((r) => [r.id, picks[r.id] || []])),
      });
      const out = res?.stock?.deducted ? ` ${res.stock.deducted} ${res.stock.deducted === 1 ? 'item' : 'items'} taken out of ${res.stock.warehouse}.` : '';
      showToast(`Invoice ${invoiceNumber.trim()} recorded for ${quotationNumber}. Payment due ${dueDate}.${out}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the invoice. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Invoice">
      <form className="ts-modal max-w-3xl w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Invoice</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="ts-fgrid ts-g3">
          <div className="ts-fld">
            <label htmlFor="inv-number">Invoice number *</label>
            <input id="inv-number" className="ts-fi" maxLength={60} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="As on your tax invoice" autoFocus />
          </div>
          <div className="ts-fld">
            <label htmlFor="inv-date">Invoice date *</label>
            <input id="inv-date" type="date" className="ts-fi" value={invoiceDate} onChange={(e) => changeInvoiceDate(e.target.value)} />
          </div>
          <div className="ts-fld">
            <label htmlFor="inv-due">Payment due date *</label>
            <input id="inv-due" type="date" className="ts-fi" min={invoiceDate} value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true); }} />
            <small className="ts-hint">
              {dueTouched ? 'Set by hand. ' : `Invoice date + ${dueDays} days. `}
              {dueTouched && (
                <button type="button" className="underline" onClick={() => { setDueTouched(false); setDueDate(addDays(invoiceDate, dueDays)); }}>Reset</button>
              )}
            </small>
          </div>
        </div>

        <div className="ts-fld">
          <label htmlFor="inv-wh">Goods leave from (warehouse)</label>
          <select id="inv-wh" className="ts-fi" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
            {warehouseId === '' && <option value="">Loading…</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <small className="ts-hint">The quantities on this invoice are taken out of this warehouse's stock when you save.</small>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <b className="text-[13px] text-fg">Items on this invoice ({chosen.length} of {rows.length})</b>
            <span className="flex gap-2">
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setRows(lines.map((it) => ({ id: it.id as number, checked: leftOf(it) > 0, qty: String(leftOf(it) || '') })))}>
                Everything left
              </button>
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: false })))}>
                Clear all
              </button>
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="ts-muted text-[13px]">No ordered items to invoice.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {lines.map((it) => {
                const r = rows.find((x) => x.id === it.id)!;
                const left = leftOf(it);
                return (
                  <label key={it.id} className={`flex items-center gap-3 rounded-lg border border-line2 px-3 py-2 ${r.checked ? 'bg-surface' : ''}`}>
                    <input type="checkbox" className="shrink-0" checked={r.checked} onChange={(e) => setRow(r.id, { checked: e.target.checked })} />
                    <span className="flex-1 min-w-0 text-[13px]">
                      <b className="text-fg">{it.part_no || '—'}</b> <span className="text-subtle">{it.description}</span>
                      <small className="block text-[11.5px] text-subtle">
                        {hasOrders ? 'Ordered' : 'Quoted'} {limitOf(it)}
                        {invoiced[it.id as number] ? ` · already invoiced ${invoiced[it.id as number]}` : ''} · left {left}
                      </small>
                      {stock && (
                        <small className={`block text-[11.5px] ${stock[it.id as number]?.tracked && r.checked && Number(r.qty) > (stock[it.id as number]?.available ?? 0) ? 'text-bad' : 'text-subtle'}`}>
                          {stock[it.id as number]?.tracked ? `In stock here: ${stock[it.id as number].available}` : 'Not tracked in stock'}
                        </small>
                      )}
                      {r.checked && serialsNeeded(r.id, r.qty) > 0 && (
                        <span className="mt-1.5 block" onClick={(e) => e.preventDefault()}>
                          <small className="block text-[11.5px] text-subtle mb-1">Serial numbers to send ({(picks[r.id] || []).length} of {serialsNeeded(r.id, r.qty)} picked). The oldest are picked first; tap to change.</small>
                          <span className="flex flex-wrap gap-1.5">
                            {stock?.[r.id]?.serials?.map((s) => {
                              const on = (picks[r.id] || []).includes(s.id);
                              return (
                                <button key={s.id} type="button" onClick={() => togglePick(r.id, s.id)} className={`px-2 py-0.5 rounded border text-[11.5px] font-mono ${on ? 'bg-ink text-onink border-ink' : 'bg-surface border-line2 text-subtle'}`}>
                                  {s.serial_number}
                                </button>
                              );
                            })}
                          </span>
                        </span>
                      )}
                    </span>
                    {/* .ts-fi is width:100%, so the width is set on a wrapper that cannot shrink or grow */}
                    <span className="shrink-0" style={{ width: 96 }}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="ts-fi !py-1.5"
                        aria-label={`Quantity of ${it.part_no || it.description}`}
                        value={r.qty}
                        disabled={!r.checked}
                        onChange={(e) => setRow(r.id, { qty: e.target.value })}
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="ts-fld">
          <label htmlFor="inv-notes">Notes</label>
          <input id="inv-notes" className="ts-fi" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, for example the delivery or e-way bill" />
        </div>

        {error && <p className="text-[13px] text-bad m-0">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark ts-xs" disabled={saving}>{saving ? 'Saving…' : 'Save invoice'}</button>
        </div>
      </form>
    </div>
  );
}
