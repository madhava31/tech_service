import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * "Negotiate" dialog. The customer asked for a price change on a sent quotation: the user notes what was asked (optional),
 * the quotation becomes editable, and after the change it is sent again. The version that was sent is kept in the history.
 */
export function NegotiateModal({
  quotationNumber,
  round,
  onClose,
  onConfirm,
}: {
  quotationNumber: string;
  round: number;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not start the negotiation. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Negotiate">
      <form className="ts-modal max-w-md w-full flex flex-col gap-4" onSubmit={submit}>
        <div>
          <h3 className="m-0 text-[15px] font-medium text-fg">Negotiate the price</h3>
          <p className="ts-muted m-0 mt-1.5 text-[13px]">{quotationNumber} · round {round}</p>
        </div>
        <p className="m-0 text-[13px] text-subtle">
          The quotation becomes editable. Change the prices, then send it again to the customer. The version you sent is kept in the negotiation history.
        </p>
        <div className="ts-fld">
          <label htmlFor="neg-note">What did the customer ask for? (optional)</label>
          <textarea id="neg-note" rows={3} className="ts-fi" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 5% lower price on the HPLC column, or a better rate for 10 units" autoFocus />
        </div>
        {error && <div className="ts-warnbox" role="alert"><span>{error}</span></div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="ts-btn ts-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="ts-btn ts-dark" disabled={busy} aria-busy={busy}>{busy ? 'Starting…' : 'Start negotiation'}</button>
        </div>
      </form>
    </div>
  );
}
