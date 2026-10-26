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
        return <span className="badge danger">CRITICAL</span>;
      case 'HIGH':
        return <span className="badge warning">HIGH</span>;
      case 'MEDIUM':
        return <span className="badge info">MEDIUM</span>;
      default:
        return <span className="badge secondary">LOW</span>;
    }
  };

  return (
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Procurement Requirements</h1>
          <p className="muted text-sm">Consolidated demand recommendations originating from Restock Queue, Stock Intelligence, and Sales Constraints.</p>
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
            placeholder="Search part #, description, requirement code, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input-field" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select className="input-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="PARTIALLY_COVERED">Partially Covered</option>
            <option value="ORDERED">Ordered</option>
            <option value="RECEIVING">Receiving</option>
            <option value="FULFILLED">Fulfilled</option>
          </select>
          <button className="btn secondary" onClick={() => { setSearch(''); setPriorityFilter(''); setStatusFilter(''); }}>
            Reset Filters
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="loading-text">Loading procurement requirements...</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadRequirements}>Retry</button>
        </div>
      ) : requirements.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No procurement requirements found matching filters.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Requirement Code</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th>Warehouse</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Incoming</th>
                  <th className="text-right">Suggested Qty</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id}>
                    <td>{getPriorityBadge(r.priority)}</td>
                    <td className="font-mono font-medium">
                      <Link to={`/procurement/requirements/${r.id}`} className="accent-link">
                        {r.requirement_code}
                      </Link>
                    </td>
                    <td className="font-mono font-bold">{r.part_no}</td>
                    <td>{r.product_description}</td>
                    <td>{r.warehouse_name}</td>
                    <td className="text-right font-mono font-bold">{r.available}</td>
                    <td className="text-right font-mono info">{r.incoming}</td>
                    <td className="text-right font-mono accent font-bold">{r.suggested_quantity}</td>
                    <td>
                      <span className="badge secondary text-xs">{r.source_type}</span>
                    </td>
                    <td>
                      <span className={r.status === 'FULFILLED' ? 'badge success' : r.status === 'ORDERED' ? 'badge info' : 'badge warning'}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-center">
                      <Link to={`/procurement/requirements/${r.id}`} className="btn secondary text-xs">
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between p-2 muted text-xs border-top">
            <span>Showing {requirements.length} of {total} requirements</span>
          </div>
        </div>
      )}
    </div>
  );
}
