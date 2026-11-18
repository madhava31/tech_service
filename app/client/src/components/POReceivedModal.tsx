import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type QuotationItem } from '../api';
import { showToast } from '../lib/savePdf';

/**
 * "PO received" dialog. The user types the customer's PO number, and every quoted item is listed ticked with its
 * quoted quantity already filled in:
 *   - the customer ordered everything: type the PO number and save (one step);
 *   - the customer ordered only some items or smaller quantities: untick items or change quantities.
 */
export function POReceivedModal({
  quotationId,
  quotationNumber,
  items,
  alreadyOrdered,
  onClose,
  onSaved,
}: {
  quotationId: number;
  quotationNumber: string;
  items: QuotationItem[];
  /** Quantities already covered by earlier POs of this quotation, per quotation item id (for the hint). */
  alreadyOrdered: Record<number, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState(today);
  const [notes, setNotes] = useState('');
  // Lines of the quotation, each ticked with its quoted quantity.
  // What is left to order of a line: the quoted quantity minus what earlier POs already covered.
  const remaining = (it: QuotationItem) => Math.max(0, Number(it.qty) - (alreadyOrdered[it.id as number] || 0));
  const freshRows = (asQuoted: boolean) =>
    items
      .filter((it) => it.id !== undefined)
      .map((it) => {
        const left = remaining(it);
        const qty = asQuoted || left <= 0 ? Number(it.qty) : left;
        return { id: it.id as number, checked: asQuoted || left > 0, qty: String(qty) };
      });
  const [rows, setRows] = useState(() => freshRows(false));
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

  const setRow = (id: number, patch: Partial<{ checked: boolean; qty: string }>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!poNumber.trim()) return setError('Enter the PO number.');
    if (poNumber.trim().length > 60) return setError('The PO number can be at most 60 characters.');
    if (chosen.length === 0) return setError('Tick at least one item that the customer ordered.');
    const bad = chosen.find((r) => !(Number(r.qty) > 0));
    if (bad) return setError('Every ticked item needs a quantity above 0.');
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.quotations.poReceived.create(quotationId, {
        po_number: poNumber.trim(),
        po_date: poDate || undefined,
        notes: notes.trim() || undefined,
        items: chosen.map((r) => ({ quotation_item_id: r.id, qty: Number(r.qty) })),
      });
      showToast(`PO ${poNumber.trim()} recorded for ${quotationNumber}.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the PO. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="PO received">
      <form className="ts-modal max-w-3xl w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">PO received</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="ts-fgrid ts-g3">
          <div className="ts-fld ts-span2">
            <label htmlFor="po-number">PO number *</label>
            <input id="po-number" className="ts-fi" maxLength={60} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="The customer's PO number, as written on their PO" autoFocus />
          </div>
          <div className="ts-fld">
            <label htmlFor="po-date">PO date</label>
            <input id="po-date" type="date" className="ts-fi" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <b className="text-[13px] text-fg">Items ordered ({chosen.length} of {rows.length})</b>
            <span className="flex gap-2">
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setRows(freshRows(true))}>
                All items as quoted
              </button>
              <button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: false })))}>
                Clear all
              </button>
            </span>
          </div>
          {/* One row per quoted item: tick, item, quoted quantity, ordered quantity (editable). No sideways scrolling. */}
          <div className="rounded-lg border border-line2">
            <div className="grid items-center gap-2 border-b border-line2 px-3 py-2 text-[11.5px] uppercase tracking-wider text-faint" style={{ gridTemplateColumns: '22px minmax(0,1fr) 64px 96px' }}>
              <span />
              <span>Item</span>
              <span className="text-right">Quoted</span>
              <span className="text-right">Ordered</span>
            </div>
            {items.filter((it) => it.id !== undefined).map((it) => {
              const r = rows.find((x) => x.id === it.id)!;
              const before = alreadyOrdered[it.id as number];
              const over = r.checked && Number(r.qty) > Number(it.qty);
              return (
                <div key={it.id} className={`grid items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 ${r.checked ? '' : 'opacity-50'}`} style={{ gridTemplateColumns: '22px minmax(0,1fr) 64px 96px' }}>
                  <input type="checkbox" checked={r.checked} onChange={(e) => setRow(r.id, { checked: e.target.checked })} aria-label={`Item ${it.part_no || it.description} ordered`} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-fg">{it.description}</div>
                    <div className="truncate font-mono text-[11px] text-faint">{it.part_no || '-'}</div>
                    {before ? <div className="text-[11px] text-faint">Already ordered on an earlier PO: {before}</div> : null}
                    {over ? <div className="text-[11px] text-bad">More than the quoted {it.qty}</div> : null}
                  </div>
                  <div className="text-right text-[13px] text-subtle">{it.qty}</div>
                  <input type="number" min="0" step="any" className="ts-fi ts-r" disabled={!r.checked} value={r.qty} onChange={(e) => setRow(r.id, { qty: e.target.value })} onFocus={(e) => e.target.select()} aria-label={`Ordered quantity of ${it.part_no || it.description}`} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="ts-fld">
          <label htmlFor="po-notes">Notes (optional)</label>
          <input id="po-notes" className="ts-fi" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. partial PO, balance items to follow" />
        </div>

        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Save PO received'}</button>
        </div>
      </form>
    </div>
  );
}
