import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type PerformaInvoice } from '../api';
import { showToast } from '../lib/savePdf';

/**
 * Edit a performa invoice: its number and its date. The PDF is built from the saved values, so it shows the change the
 * next time it is opened. New PIs are numbered after the highest number of the year, so renaming a PI to TSPI2627/49
 * makes the next one TSPI2627/50.
 */
export function PIEditModal({ pi, onClose, onSaved }: { pi: PerformaInvoice; onClose: () => void; onSaved: () => void }) {
  const [number, setNumber] = useState(pi.number);
  const [date, setDate] = useState(String(pi.date).slice(0, 10));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !savingRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    const n = number.trim();
    if (!n) return setError('Enter the PI number.');
    if (/\s/.test(n)) return setError('The PI number cannot contain spaces.');
    if (!date) return setError('Enter the PI date.');
    if (n === pi.number && date === String(pi.date).slice(0, 10)) return onClose();
    setError('');
    savingRef.current = true;
    setSaving(true);
    try {
      await api.performaInvoices.update(pi.id, { number: n, date });
      showToast(`PI saved as ${n}. Its PDF now shows the new ${n !== pi.number ? 'number' : 'date'}.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the PI. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Edit PI">
      <form className="ts-modal max-w-md w-full flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-medium text-fg">Edit performa invoice</h3>
            <p className="ts-muted m-0 mt-1.5 text-[13px]">{pi.company_name || ''}{pi.quotation_number ? ` · ${pi.quotation_number}` : ''}</p>
          </div>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2.5" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="ts-fld">
          <label htmlFor="pi-number">PI number *</label>
          <input id="pi-number" className="ts-fi" maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
          <small className="ts-hint">The number printed on the PDF. It must be different from every other PI. The next new PI continues after the highest number of this year.</small>
        </div>
        <div className="ts-fld">
          <label htmlFor="pi-date">PI date *</label>
          <input id="pi-date" type="date" className="ts-fi" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {error && <p className="text-[13px] text-bad m-0">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost ts-xs" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark ts-xs" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
