import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type QuotationItem } from '../api';
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
  const [rows, setRows] = useState(() => lines.map((it) => ({ id: it.id as number, checked: leftOf(it) > 0, qty: String(leftOf(it) || '') })));
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

  // The payment due date follows the invoice date until the user changes it by hand.
  const changeInvoiceDate = (v: string) => {
    setInvoiceDate(v);
    if (!dueTouched && v) setDueDate(addDays(v, dueDays));
  };

  const setRow = (id: number, patch: Partial<{ checked: boolean; qty: string }>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);

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
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.quotations.invoices.create(quotationId, {
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        payment_due_date: dueDate,
        notes: notes.trim() || undefined,
        items: chosen.map((r) => ({ quotation_item_id: r.id, qty: Number(r.qty) })),
      });
      showToast(`Invoice ${invoiceNumber.trim()} recorded for ${quotationNumber}. Payment due ${dueDate}.`);
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
