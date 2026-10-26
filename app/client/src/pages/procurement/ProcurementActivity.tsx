import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProcurementActivityItem } from '../../api';

export default function ProcurementActivity() {
  const [activity, setActivity] = useState<ProcurementActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');

  useEffect(() => {
    loadActivity();
  }, [search]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.activity({ q: search || undefined });
      setActivity(res.activity);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load procurement activity log:', err);
      setError(err.message || 'Failed to load procurement activity');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Procurement Activity Audit Stream</h1>
          <p className="muted text-sm">Chronological log of procurement requirements, PO creations, and stock intake receipts.</p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement" className="btn secondary">
            ← Control Center
          </Link>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="card mb-3 p-2">
        <div className="flex-gap">
          <input
            type="text"
            className="input-field"
            placeholder="Search document number, part number, description..."
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
        <p className="loading-text">Loading procurement activity log…</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadActivity}>Retry</button>
        </div>
      ) : activity.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No procurement activity recorded yet.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Document Type</th>
                  <th>Document Number</th>
                  <th>Product / Reference</th>
                  <th>Status</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((item, idx) => (
                  <tr key={idx}>
                    <td className="text-xs muted font-mono">{item.event_timestamp}</td>
                    <td>
                      <span className={item.doc_type === 'STOCK_RECEIPT' ? 'badge success' : 'badge info'}>
                        {item.doc_type}
                      </span>
                    </td>
                    <td className="font-medium font-mono">{item.doc_number}</td>
                    <td className="font-mono text-xs">{item.product_part || '—'}</td>
                    <td>
                      <span className="badge secondary text-xs">{item.status}</span>
                    </td>
                    <td className="text-sm">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between p-2 muted text-xs border-top">
            <span>Showing {activity.length} of {total} activity records</span>
          </div>
        </div>
      )}
    </div>
  );
}
