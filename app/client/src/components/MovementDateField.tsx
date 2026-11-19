import { useEffect, useRef, useState } from 'react';

/** Today in India as YYYY-MM-DD: the latest date a stock movement can be recorded for. */
export const todayIST = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

/**
 * The date a stock movement happened. Stock in, stock out, returns, adjustments and transfers all ask for it, so the
 * stock history shows when each unit came and when it went. Defaults to today; a future date is not allowed.
 */
export function MovementDateField({
  id,
  label,
  value,
  onChange,
  hint = 'Leave it as today, or pick the day the stock actually moved.',
  labelClass = 'ts-lbl',
  inputClass = 'ts-fi',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  labelClass?: string;
  inputClass?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input id={id} type="date" className={inputClass} max={todayIST()} value={value} onChange={(e) => onChange(e.target.value)} required />
      {hint && <small className="block text-[11.5px] text-subtle mt-1">{hint}</small>}
    </div>
  );
}

/** A small confirm dialog that also asks for the date, for actions that take stock out (fulfilling a reservation). */
export function DateConfirmModal({
  title,
  message,
  dateLabel = 'Date the stock went out',
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  dateLabel?: string;
  confirmLabel: string;
  onConfirm: (date: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIST());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function go() {
    if (busyRef.current) return;
    if (!date) return setError('Choose the date.');
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm(date);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not save. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="ts-modal max-w-md w-full space-y-4">
        <h3 className="m-0 text-[15px] font-medium text-fg">{title}</h3>
        <p className="text-sm text-fg m-0">{message}</p>
        <MovementDateField id="dc-date" label={dateLabel} value={date} onChange={setDate} />
        {error && <div className="ts-warnbox">{error}</div>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ts-btn ts-dark" onClick={go} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
