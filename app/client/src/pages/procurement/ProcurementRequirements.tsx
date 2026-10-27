import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProcurementRequirement } from '../../api';

export default function ProcurementRequirements() {
  const [requirements, setRequirements] = useState<ProcurementRequirement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadRequirements();
  }, [search, priorityFilter, statusFilter]);

  const loadRequirements = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.requirements({
        q: search || undefined,
        priority: priorityFilter || undefined,
        status: statusFilter || undefined,
      });
      setRequirements(res.requirements);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load procurement requirements:', err);
      setError(err.message || 'Failed to load procurement requirements');
    } finally {
      setLoading(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'CRITICAL':
        return <span className="ts-st ts-tone-bad">CRITICAL</span>;
      case 'HIGH':
        return <span className="ts-st ts-tone-warn">HIGH</span>;
      case 'MEDIUM':
        return <span className="ts-st">MEDIUM</span>;
      default:
        return <span className="ts-st">LOW</span>;
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Procurement Requirements</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Consolidated demand recommendations originating from Restock Queue, Stock Intelligence, and Sales Constraints.</p>
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
            placeholder="Search part #, description, requirement code, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="ts-fi ts-sel sm:!w-56" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select className="ts-fi" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="PARTIALLY_COVERED">Partially Covered</option>
            <option value="ORDERED">Ordered</option>
            <option value="RECEIVING">Receiving</option>
            <option value="FULFILLED">Fulfilled</option>
          </select>
          <button className="ts-btn ts-ghost ts-xs self-start sm:self-auto" onClick={() => { setSearch(''); setPriorityFilter(''); setStatusFilter(''); }}>
            Reset Filters
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="ts-empty">Loading procurement requirements...</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost text-[13.5px]" onClick={loadRequirements}>Retry</button>
        </div>
      ) : requirements.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No procurement requirements found matching filters.</p>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Requirement Code</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th>Warehouse</th>
                  <th className="ts-r">Available</th>
                  <th className="ts-r">Incoming</th>
                  <th className="ts-r">Suggested Qty</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id}>
                    <td>{getPriorityBadge(r.priority)}</td>
                    <td className="num font-medium">
                      <Link to={`/procurement/requirements/${r.id}`} className="text-fg hover:underline">
                        {r.requirement_code}
                      </Link>
                    </td>
                    <td className="num">{r.part_no}</td>
                    <td>{r.product_description}</td>
                    <td>{r.warehouse_name}</td>
                    <td className="ts-r num">{r.available}</td>
                    <td className="ts-r num text-fg">{r.incoming}</td>
                    <td className="ts-r num text-fg">{r.suggested_quantity}</td>
                    <td>
                      <span className="ts-st">{r.source_type}</span>
                    </td>
                    <td>
                      <span className={r.status === 'FULFILLED' ? 'ts-st ts-tone-good' : r.status === 'ORDERED' ? 'ts-st' : 'ts-st ts-tone-warn'}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-center">
                      <Link to={`/procurement/requirements/${r.id}`} className="ts-btn ts-ghost ts-xs">
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap p-2 text-subtle text-[13px] border-t border-line2">
            <span>Showing {requirements.length} of {total} requirements</span>
          </div>
        </div>
      )}
    </div>
  );
}
