import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type TodayStock } from '../api';

const n = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const TYPE: Record<string, string> = { STOCK_IN: 'Stock in', OPENING_STOCK: 'Opening stock', STOCK_OUT: 'Stock out', RETURN: 'Return', ADJUSTMENT: 'Adjustment', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out' };

/**
 * Today at a glance: what came into the warehouse and what went out today, how many customer orders are ready to ship, and
 * the latest movements. It reads the same movement history as every other stock screen, so the figures always agree.
 */
export function TodayPanel() {
  const [t, setT] = useState<TodayStock | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.inventory.today().then((r) => { if (live) setT(r); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load today'); });
    return () => { live = false; };
  }, []);

  if (error) return <div className="ts-card ts-white text-[13px] text-bad">{error}</div>;
  if (!t) return <div className="ts-card ts-white text-[13px] text-subtle">Loading today…</div>;

  const w = t.waiting;
  return (
    <section className="ts-card ts-white flex flex-col gap-3" aria-label="Today">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-fg text-[14px]">Today</b>
        <span className="text-[12.5px] text-subtle">{new Date(`${t.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <span className="ts-grow" />
        <Link to="/inventory/stock-inward" className="ts-btn ts-ghost ts-xs">Receive stock →</Link>
        <Link to="/inventory/waiting-orders" className="ts-btn ts-ghost ts-xs">Waiting orders →</Link>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="rounded-xl border border-line2 px-3 py-2">
          <span className="text-[12px] text-subtle">Received today</span>
          <div className="text-xl font-bold text-good">{n(t.received.units)}</div>
          <small className="text-[11.5px] text-subtle">{t.received.receipts} {t.received.receipts === 1 ? 'receipt' : 'receipts'} · {t.received.lines} {t.received.lines === 1 ? 'line' : 'lines'}</small>
        </div>
        <div className="rounded-xl border border-line2 px-3 py-2">
          <span className="text-[12px] text-subtle">Sent today</span>
          <div className="text-xl font-bold text-bad">{n(t.sent.units)}</div>
          <small className="text-[11.5px] text-subtle">{t.sent.invoices} {t.sent.invoices === 1 ? 'invoice' : 'invoices'} · {t.sent.lines} {t.sent.lines === 1 ? 'line' : 'lines'}</small>
        </div>
        <Link to="/inventory/waiting-orders" className="rounded-xl border border-line2 px-3 py-2 hover:bg-surface">
          <span className="text-[12px] text-subtle">Ready to ship</span>
          <div className="text-xl font-bold text-fg">{w ? w.ready + w.partly : '—'}</div>
          <small className="text-[11.5px] text-subtle">{w ? `${w.customers} ${w.customers === 1 ? 'customer' : 'customers'} waiting` : 'not available'}</small>
        </Link>
        <Link to="/inventory/waiting-orders" className="rounded-xl border border-line2 px-3 py-2 hover:bg-surface">
          <span className="text-[12px] text-subtle">Still to order</span>
          <div className="text-xl font-bold text-warn">{w ? n(w.units_to_order) : '—'}</div>
          <small className="text-[11.5px] text-subtle">{w ? `${w.waiting} ${w.waiting === 1 ? 'line' : 'lines'} short` : ''}</small>
        </Link>
      </div>

      {t.movements.length === 0 ? (
        <small className="text-[12.5px] text-subtle">No stock has moved yet today.</small>
      ) : (
        <div className="ts-tblwrap !mt-0">
          <table className="!min-w-[520px]">
            <thead><tr><th>Time</th><th>Part</th><th>Type</th><th className="ts-r">Change</th></tr></thead>
            <tbody>
              {t.movements.map((m, i) => (
                <tr key={i}>
                  <td className="text-[12px]">{m.at}</td>
                  <td>
                    <span className="font-mono text-[12.5px] text-fg">{m.part_no}</span>
                    <small className="block text-[11.5px] text-subtle max-w-[300px] truncate" title={m.description}>{m.description}</small>
                  </td>
                  <td className="text-[12px]">{TYPE[m.movement_type] || m.movement_type}</td>
                  <td className={`ts-r font-semibold ${m.change >= 0 ? 'text-good' : 'text-bad'}`}>{m.change > 0 ? '+' : ''}{n(m.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
