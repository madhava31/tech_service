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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Procurement Activity Audit Stream</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Chronological log of procurement requirements, PO creations, and stock intake receipts.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="ts-card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            className="ts-fi !pl-4 !rounded-full !bg-tile !border-transparent sm:flex-1"
            placeholder="Search document number, part number, description..."
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
        <p className="ts-empty">Loading procurement activity log…</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadActivity}>Retry</button>
        </div>
      ) : activity.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No procurement activity recorded yet.</p>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
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
                    <td className="text-[13px] text-subtle num">{item.event_timestamp}</td>
                    <td>
                      <span className={item.doc_type === 'STOCK_RECEIPT' ? 'ts-st ts-tone-good' : 'ts-st'}>
                        {item.doc_type}
                      </span>
                    </td>
                    <td className="font-medium num">{item.doc_number}</td>
                    <td className="num text-[13px]">{item.product_part || '—'}</td>
                    <td>
                      <span className="ts-st">{item.status}</span>
                    </td>
                    <td className="text-[13.5px]">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap p-2 text-subtle text-[13px] border-t border-line2">
            <span>Showing {activity.length} of {total} activity records</span>
          </div>
        </div>
      )}
    </div>
  );
}
