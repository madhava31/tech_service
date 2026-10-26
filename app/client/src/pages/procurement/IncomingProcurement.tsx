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
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Incoming Procurement</h1>
          <p className="muted text-sm">Open purchase orders with pending receivable quantities.</p>
        </div>
        <div className="flex-gap">
          <RouterLink to="/procurement" className="btn secondary">
            ← Control Center
          </RouterLink>
          <RouterLink to="/procurement/receiving" className="btn accent">
            Operational Receiving Desk →
          </RouterLink>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="card mb-3 p-2">
        <div className="flex-gap">
          <input
            type="text"
            className="input-field"
            placeholder="Search PO #, supplier name, part number, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn secondary" onClick={() => setSearch('')}>
            Reset Filter
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="loading-text">Loading incoming procurement...</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadIncoming}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No incoming procurement orders found.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Supplier</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="text-right">Ordered Qty</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Pending Qty</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="font-mono font-bold">
                      <RouterLink to="/purchase-orders" className="accent-link">
                        {it.po_number}
                      </RouterLink>
                    </td>
                    <td>{it.po_date}</td>
                    <td>{it.supplier_name}</td>
                    <td className="font-mono">{it.part_no}</td>
                    <td>{it.product_description}</td>
                    <td className="text-right font-mono font-bold">{it.ordered_quantity}</td>
                    <td className="text-right font-mono info">{it.receivedQuantity}</td>
                    <td className="text-right font-mono warning font-bold">{it.pendingQuantity}</td>
                    <td className="text-center">
                      <RouterLink to="/procurement/receiving" className="btn accent text-xs">
                        Receive Stock
                      </RouterLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between p-2 muted text-xs border-top">
            <span>Showing {items.length} of {total} incoming items</span>
          </div>
        </div>
      )}
    </div>
  );
}
