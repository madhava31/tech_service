import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type WaitingOrdersResponse } from '../api';
import { WaitingOrdersTable } from './WaitingOrdersTable';

/**
 * "Who needs this stock?": after stock comes in, the customer orders waiting for those products, oldest PO first, with what
 * can be shipped now. Each customer has a Dispatch button that opens their invoice dialog already filled in, so stock that
 * arrives and leaves on the same day is two quick steps.
 */
export function WaitingMatches({ productIds, title = 'Who needs this stock?', onNone }: { productIds: number[]; title?: string; onNone?: () => void }) {
  const [data, setData] = useState<WaitingOrdersResponse | null>(null);
  const [error, setError] = useState('');
  const key = [...new Set(productIds)].sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!key) { setData({ summary: { lines: 0, ready: 0, partly: 0, waiting: 0, customers: 0, units_to_order: 0 }, orders: [] }); return; }
    let live = true;
    setError('');
    api.inventory
      .waitingOrders({ productIds: key })
      .then((r) => { if (live) { setData(r); if (r.orders.length === 0) onNone?.(); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the waiting orders'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <div className="ts-card ts-white text-[13px] text-bad">{error}</div>;
  if (!data) return <div className="ts-card ts-white text-[13px] text-subtle">Checking which customers are waiting for this stock…</div>;
  if (data.orders.length === 0) {
    return (
      <div className="ts-card ts-white text-[13px] text-subtle">
        <b className="text-fg">{title}</b> No customer order is waiting for these products, so this stock stays in the warehouse.
      </div>
    );
  }
  return (
    <div className="ts-card ts-white flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-fg text-[14px]">{title}</b>
        <span className="text-[12.5px] text-subtle">
          {data.summary.customers} {data.summary.customers === 1 ? 'customer' : 'customers'} waiting · {data.summary.ready} ready to ship
          {data.summary.partly ? ` · ${data.summary.partly} partly` : ''}{data.summary.waiting ? ` · ${data.summary.waiting} still short` : ''}
        </span>
        <span className="ts-grow" />
        <Link to="/inventory/waiting-orders" className="ts-btn ts-ghost ts-xs">All waiting orders →</Link>
      </div>
      <WaitingOrdersTable orders={data.orders} compact />
    </div>
  );
}
