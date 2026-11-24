import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type QuotationItem } from '../api';
import { showToast } from '../lib/savePdf';

/**
 * Edit a PO received (a customer PO entered from a quotation): its number, date, notes, and which items it ordered and how many.
 * Opened from the Purchase Orders page. The server refuses quantities below what has already been invoiced.
 */
export function EditPoReceivedModal({ quotationId, poId, onClose, onSaved }: { quotationId: number; poId: number; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [quotationNumber, setQuotationNumber] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<{ id: number; checked: boolean; qty: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.quotations.get(quotationId), api.quotations.poReceived.list(quotationId)])
      .then(([q, list]) => {
        if (!live) return;
        const po = list.pos.find((p) => p.id === poId);
        if (!po) return setError('This PO no longer exists.');
        const lines = (q.items || []).filter((it) => it.id !== undefined);
        setQuotationNumber(q.number);
        setItems(lines);
        setPoNumber(po.po_number);
        setPoDate(String(po.po_date || '').slice(0, 10));
        setNotes(po.notes || '');
        setRows(lines.map((it) => {
          const ordered = po.items.find((x) => x.quotation_item_id === it.id);
          return { id: it.id as number, checked: !!ordered, qty: String(ordered ? ordered.qty : Number(it.qty)) };
        }));
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the PO.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [quotationId, poId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !savingRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setRow = (id: number, patch: Partial<{ checked: boolean; qty: string }>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (!poNumber.trim()) return setError('Enter the PO number.');
    if (chosen.length === 0) return setError('Tick at least one item that the customer ordered.');
    if (chosen.some((r) => !(Number(r.qty) > 0))) return setError('Every ticked item needs a quantity above 0.');
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.quotations.poReceived.update(quotationId, poId, {
        po_number: poNumber.trim(),
        po_date: poDate || undefined,
        notes: notes.trim() || undefined,
        items: chosen.map((r) => ({ quotation_item_id: r.id, qty: Number(r.qty) })),
      });
      showToast(`PO ${poNumber.trim()} saved.`);
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Edit PO received">
      <form className="ts-modal max-w-3xl w-full flex flex-col gap-4 max-h-[92vh] overflow-y-auto" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Edit PO received</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>
        {loading ? (
          <p className="ts-muted text-[13px]">Loading…</p>
        ) : (
          <>
            <div className="ts-fgrid ts-g3">
              <div className="ts-fld ts-span2">
                <label htmlFor="epo-number">PO number *</label>
                <input id="epo-number" className="ts-fi" maxLength={60} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
              <div className="ts-fld">
                <label htmlFor="epo-date">PO date</label>
                <input id="epo-date" type="date" className="ts-fi" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </div>
            </div>
            <div>
              <b className="text-[13px] text-fg">Items ordered ({chosen.length} of {rows.length})</b>
              <div className="flex flex-col gap-1.5 mt-2">
                {items.map((it) => {
                  const r = rows.find((x) => x.id === it.id);
                  if (!r) return null;
                  return (
                    <label key={it.id} className={`flex items-center gap-3 rounded-lg border border-line2 px-3 py-2 ${r.checked ? 'bg-surface' : ''}`}>
                      <input type="checkbox" checked={r.checked} onChange={(e) => setRow(r.id, { checked: e.target.checked })} />
                      <span className="flex-1 min-w-0 text-[13px]">
                        <b className="text-fg">{it.part_no || '—'}</b> <span className="text-subtle">{it.description}</span>
                        <small className="block text-[11.5px] text-subtle">Quoted {Number(it.qty)}</small>
                      </span>
                      <span className="shrink-0" style={{ width: 96 }}>
                        <input type="number" min="0" step="any" className="ts-fi !py-1.5" aria-label={`Quantity of ${it.part_no || it.description}`} value={r.qty} disabled={!r.checked} onChange={(e) => setRow(r.id, { qty: e.target.value })} />
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="ts-fld">
              <label htmlFor="epo-notes">Notes</label>
              <input id="epo-notes" className="ts-fi" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </>
        )}
        {error && <p className="text-[13px] text-bad m-0">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark ts-xs" disabled={saving || loading}>{saving ? 'Saving…' : 'Save PO'}</button>
        </div>
      </form>
    </div>
  );
}
