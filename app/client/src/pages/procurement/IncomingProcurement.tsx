import { useEffect, useState } from 'react';
import { Link, Link as RouterLink } from 'react-router-dom';
import { api, IncomingProcurementItem } from '../../api';

export default function IncomingProcurement() {
  const [items, setItems] = useState<IncomingProcurementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');

  useEffect(() => {
    loadIncoming();
  }, [search]);

  const loadIncoming = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.incoming({ q: search || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load incoming procurement:', err);
      setError(err.message || 'Failed to load incoming procurement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Incoming Procurement</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Open purchase orders with pending receivable quantities.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RouterLink to="/procurement" className="ts-btn ts-ghost">
            ← Control Center
          </RouterLink>
          <RouterLink to="/procurement/receiving" className="ts-btn ts-ghost text-fg">
            Operational Receiving Desk →
          </RouterLink>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="ts-card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            className="ts-fi !pl-4 !rounded-full !bg-tile !border-transparent sm:flex-1"
            placeholder="Search PO #, supplier name, part number, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="ts-btn ts-ghost ts-xs self-start sm:self-auto" onClick={() => setSearch('')}>
            Reset Filter
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="ts-empty">Loading incoming procurement...</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadIncoming}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No incoming procurement orders found.</p>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Supplier</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="ts-r">Ordered Qty</th>
                  <th className="ts-r">Received</th>
                  <th className="ts-r">Pending Qty</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="num">
                      <RouterLink to="/purchase-orders" className="text-fg hover:underline">
                        {it.po_number}
                      </RouterLink>
                    </td>
                    <td>{it.po_date}</td>
                    <td>{it.supplier_name}</td>
                    <td className="num">{it.part_no}</td>
                    <td>{it.product_description}</td>
                    <td className="ts-r num">{it.ordered_quantity}</td>
                    <td className="ts-r num text-fg">{it.receivedQuantity}</td>
                    <td className="ts-r num text-warn">{it.pendingQuantity}</td>
                    <td className="text-center">
                      <RouterLink to="/procurement/receiving" className="ts-btn ts-ghost ts-xs text-fg">
                        Receive Stock
                      </RouterLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap p-2 text-subtle text-[13px] border-t border-line2">
            <span>Showing {items.length} of {total} incoming items</span>
          </div>
        </div>
      )}
    </div>
  );
}
