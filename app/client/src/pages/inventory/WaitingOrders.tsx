import { useEffect, useState } from 'react';
import { DownloadLink } from '../../components/DownloadLink';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type WaitingOrdersResponse, type Warehouse } from '../../api';
import { WaitingOrdersTable } from '../../components/WaitingOrdersTable';

type StatusFilter = '' | 'ready' | 'partly' | 'waiting';

/**
 * Waiting orders: every customer order (PO received) that has not been invoiced yet, and what the warehouse can ship for
 * it now. Stock is shared out oldest PO first. This is the daily "what do I send today" list.
 */
export default function WaitingOrders() {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const productId = Number(sp.get('productId')) || undefined;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [data, setData] = useState<WaitingOrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { api.inventory.listWarehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = { status: status || undefined, q: q || undefined, warehouseId: warehouseId ? Number(warehouseId) : undefined, productId };

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.inventory
      .waitingOrders(params)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the waiting orders'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q, warehouseId, productId]);

  const s = data?.summary;
  const chip = (value: StatusFilter, label: string, count?: number) => (
    <button key={value} type="button" className={`ts-btn ts-xs ${status === value ? 'ts-dark' : 'ts-ghost'}`} onClick={() => setStatus(value)}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12.5px] text-subtle"><Link to="/inventory" className="hover:text-fg">Inventory</Link> / Waiting orders</div>
          <h1 className="ts-title ts-title-sm m-0">Waiting orders</h1>
          <p className="m-0 mt-1 text-[13px] text-subtle">Customer orders not yet invoiced, and what you can ship for each from the stock you have now (oldest PO first).</p>
        </div>
        <DownloadLink className="ts-btn ts-dark ts-xs" href={api.inventory.waitingOrdersXlsxUrl(params)}>Download Excel</DownloadLink>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Ready to ship</span><div className="text-2xl font-bold text-good">{s?.ready ?? '…'}</div><small className="text-[11.5px] text-subtle">order lines</small></div>
        <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Partly ready</span><div className="text-2xl font-bold text-warn">{s?.partly ?? '…'}</div><small className="text-[11.5px] text-subtle">order lines</small></div>
        <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Waiting for stock</span><div className="text-2xl font-bold text-bad">{s?.waiting ?? '…'}</div><small className="text-[11.5px] text-subtle">{s ? `${s.units_to_order} units to order` : ''}</small></div>
        <div className="ts-card ts-white"><span className="text-[12px] text-subtle">Customers waiting</span><div className="text-2xl font-bold text-fg">{s?.customers ?? '…'}</div></div>
      </div>

      <div className="ts-card ts-white flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip('', 'All')}
          {chip('ready', 'Ready to ship', s?.ready)}
          {chip('partly', 'Partly ready', s?.partly)}
          {chip('waiting', 'Waiting for stock', s?.waiting)}
          <span className="ts-grow" />
          <select className="ts-fi !py-1.5 !w-auto" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input className="ts-fi !py-1.5 !w-auto" style={{ minWidth: 220 }} placeholder="Search customer, PO or part" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {productId && <small className="text-[12.5px] text-subtle">Showing one product only. <Link to="/inventory/waiting-orders" className="underline">Show all</Link></small>}
      </div>

      {error && <div className="ts-card ts-white text-bad text-[13px]">{error}</div>}
      {loading && !data && <div className="ts-card ts-white text-[13px] text-subtle">Loading…</div>}
      {data && data.orders.length === 0 && !loading && (
        <div className="ts-card ts-white text-[13px] text-subtle">
          No customer order is waiting{status || q ? ' for this filter' : ''}. Orders appear here once a quotation has a <b>PO received</b> and is not fully invoiced.
        </div>
      )}
      {data && <WaitingOrdersTable orders={data.orders} />}
    </div>
  );
}
