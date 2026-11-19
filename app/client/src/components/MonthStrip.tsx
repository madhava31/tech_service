import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MovementReport } from '../api';

const thisMonth = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7);
const shift = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** One product's stock in / out on each day of a month, with a link to the full report. */
export function MonthStrip({ productId }: { productId: number }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<MovementReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    api.inventory
      .movementReport({ view: 'month', month, productId, moved: false })
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the month'); });
    return () => { live = false; };
  }, [month, productId]);

  const row = data?.products[0];
  return (
    <div className="ts-card ts-white">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg m-0">Stock in / out by day</h2>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}>◀</button>
          <span className="text-[13px] min-w-[70px] text-center">{data?.period.label || month}</span>
          <button type="button" className="ts-btn ts-ghost ts-xs !px-2" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}>▶</button>
        </div>
        {row && (
          <span className="text-[12.5px] text-subtle">
            Opening {fmt(row.opening)} · <span className="text-good">In {fmt(row.totals.in)}</span> · <span className="text-bad">Out {fmt(row.totals.out)}</span> · Closing <b className="text-fg">{fmt(row.closing)}</b>
          </span>
        )}
        <Link to={`/inventory/movement-report?productId=${productId}&month=${month}`} className="ts-btn ts-ghost ts-xs">Full report →</Link>
      </div>
      {error && <p className="text-[12.5px] text-bad m-0">{error}</p>}
      {data && (
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {data.buckets.map((b) => {
              const c = row?.cells[b.key];
              return (
                <div key={b.key} className={`w-9 rounded-md border border-line2 text-center py-1 ${c ? 'bg-surface' : ''}`} title={c ? `Day ${b.label}: in ${c.in}, out ${c.out}${c.ret ? `, returns ${c.ret}` : ''}${c.adj ? `, corrections ${c.adj}` : ''}` : `Day ${b.label}`}>
                  <div className="text-[10.5px] text-subtle">{b.label}</div>
                  <div className="text-[11px] leading-tight text-good min-h-[13px]">{c?.in ? `+${fmt(c.in)}` : ''}</div>
                  <div className="text-[11px] leading-tight text-bad min-h-[13px]">{c?.out ? `−${fmt(c.out)}` : ''}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
