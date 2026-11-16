import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, type PaymentSchedule, type PaymentStatus, type QuotationPayment } from '../api';
import { fmtDay } from './ds/format';
import { useAuth } from '../auth';

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Colour of a payment status: green paid, red overdue, amber due or partly paid, grey not started. */
export function PaymentStatusPill({ status, label }: { status: PaymentStatus; label: string }) {
  const warn: CSSProperties = { background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn))' };
  if (status === 'paid') return <span className="ts-pill ts-up">{label}</span>;
  if (status === 'overdue') return <span className="ts-pill ts-down">{label}</span>;
  if (status === 'due' || status === 'partly_paid') return <span className="ts-pill" style={warn}>{label}</span>;
  return <span className="ts-pill bg-surface2 text-subtle">{label}</span>;
}

/**
 * The payments card on a quotation. It shows the advance, which is due after the PO, and the balance,
 * which is due after the PI, along with the payments received and a form to record a new one.
 */
export function QuotationPayments({
  quotationId,
  schedule,
  payments,
  onChanged,
  openFormSignal = 0,
}: {
  quotationId: number;
  schedule: PaymentSchedule;
  payments: QuotationPayment[];
  onChanged: () => void;
  /** Each change opens the record-payment form and scrolls it into view (the workflow's "Payment received" button). */
  openFormSignal?: number;
}) {
  const { user } = useAuth();
  const cardRef = useRef<HTMLElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [mode, setMode] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function openForm() {
    setAmount(schedule.outstanding > 0 ? String(schedule.parts.find((p) => p.outstanding > 0)?.outstanding ?? schedule.outstanding) : '');
    setPaidOn(todayIso());
    setReference('');
    setError('');
    setShowForm(true);
  }

  useEffect(() => {
    if (!openFormSignal) return;
    openForm();
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // openForm reads the latest schedule; only a new signal should reopen the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFormSignal]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError('Enter the amount received');
    setBusy(true);
    setError('');
    try {
      await api.quotations.recordPayment(quotationId, { amount: n, paid_on: paidOn, mode, reference: reference.trim() || undefined });
      setShowForm(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(paymentId: number) {
    if (!window.confirm('Delete this payment? This cannot be undone.')) return;
    setError('');
    try {
      await api.quotations.deletePayment(quotationId, paymentId);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section ref={cardRef} className="ts-card ts-white flex flex-col gap-4" style={{ scrollMarginTop: 90 }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[17px] font-medium">Payments</h3>
          <p className="m-0 mt-0.5 text-[12.5px] text-subtle">{schedule.terms_text}</p>
        </div>
        <span className="flex-1" />
        <PaymentStatusPill status={schedule.status} label={schedule.days_overdue > 0 ? `${schedule.status_label} · ${schedule.days_overdue} days` : schedule.status_label} />
        {schedule.outstanding > 0 && !showForm && (
          <button type="button" className="ts-btn ts-dark ts-xs" onClick={openForm}>+ Record payment</button>
        )}
      </div>

      <div className="ts-dw-meta">
        <div><span>Grand total</span><b className="num">{money(schedule.total)}</b></div>
        <div><span>Received</span><b className="num">{money(schedule.received)}</b></div>
        <div><span>Outstanding</span><b className="num">{money(schedule.outstanding)}</b></div>
        <div><span>Next due</span><b>{schedule.next_due_date ? fmtDay(schedule.next_due_date) : '—'}</b></div>
      </div>

      <div className="flex flex-col gap-2">
        {schedule.parts.map((p) => (
          <div key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[14px] bg-surface p-3 text-[13px]">
            <b className="text-fg">{p.label}</b>
            <span className="num text-fg">{money(p.amount)}</span>
            <span className="text-subtle">
              {p.due_date ? `Due ${fmtDay(p.due_date)} (${schedule.payment_due_days} days after the ${p.starts_with})` : `Due date starts when the ${p.starts_with} is created`}
            </span>
            <span className="flex-1" />
            {p.received > 0 && p.outstanding > 0 && <span className="text-subtle">Received {money(p.received)}, {money(p.outstanding)} left</span>}
            <PaymentStatusPill status={p.status} label={p.days_overdue > 0 ? `${p.status_label} · ${p.days_overdue} days` : p.status_label} />
          </div>
        ))}
      </div>

      {showForm && (
        <form onSubmit={save} className="flex flex-col gap-3 rounded-[14px] bg-surface p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="ts-lblwrap">
              AMOUNT RECEIVED (₹)
              <input type="number" min="0.01" step="0.01" className="ts-fi" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </label>
            <label className="ts-lblwrap">
              DATE RECEIVED
              <input type="date" className="ts-fi" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label className="ts-lblwrap">
              MODE
              <select className="ts-fi" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option>Bank transfer</option>
                <option>Cheque</option>
                <option>UPI</option>
                <option>Cash</option>
                <option>Other</option>
              </select>
            </label>
            <label className="ts-lblwrap">
              REFERENCE (OPTIONAL)
              <input type="text" className="ts-fi" maxLength={120} placeholder="UTR / cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="ts-btn ts-dark ts-xs">{busy ? 'Saving…' : 'Save payment'}</button>
            <button type="button" disabled={busy} className="ts-btn ts-ghost ts-xs" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      {payments.length > 0 && (
        <div className="ts-tbl ts-tblwrap">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                <th>Date</th>
                <th className="ts-r">Amount</th>
                <th>Mode</th>
                <th>Reference</th>
                <th>Recorded by</th>
                {user?.role === 'admin' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDay(p.paid_on)}</td>
                  <td className="ts-r num">{money(p.amount)}</td>
                  <td>{p.mode || '—'}</td>
                  <td>{p.reference || '—'}</td>
                  <td>{p.created_by_username || '—'}</td>
                  {user?.role === 'admin' && (
                    <td className="ts-r"><button type="button" className="ts-btn ts-ghost ts-xs" onClick={() => remove(p.id)}>Delete</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
