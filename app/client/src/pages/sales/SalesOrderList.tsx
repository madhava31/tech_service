import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesOrder } from '../../api';

export default function SalesOrderList() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadOrders();
  }, [search, statusFilter]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.orders({
        q: search || undefined,
        status: statusFilter || undefined,
      });
      setOrders(res.orders);
      setTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load orders:', err);
      setError(err.message || 'Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'badge success';
      case 'PARTIALLY_DISPATCHED':
        return 'badge warning';
      case 'READY_TO_DISPATCH':
        return 'badge info';
      case 'PI_CREATED':
        return 'badge secondary';
      case 'PO_CREATED':
        return 'badge info';
      case 'QUOTATION_DRAFT':
        return 'badge muted';
      default:
        return 'badge secondary';
    }
  };

  return (
    <div className="page-container">
      <div className="flex-between mb-2">
        <div>
          <h1 className="ts-title">Sales Orders</h1>
          <p className="muted text-sm">Monitor order fulfillment, purchase order linkage, performa invoices, and partial dispatches.</p>
        </div>
        <div className="flex-gap">
          <Link to="/sales" className="btn secondary">
            ← Control Center
          </Link>
          <Link to="/quotations/new" className="btn primary">
            + Create Order / Quotation
          </Link>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="card mb-3 p-2">
        <div className="flex-gap">
          <input
            type="text"
            className="input-field"
            placeholder="Search PO #, Quotation #, PI #, Company, Ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Operational Statuses</option>
            <option value="PO_CREATED">PO Created</option>
            <option value="PI_CREATED">PI Created</option>
            <option value="READY_TO_DISPATCH">Ready to Dispatch</option>
            <option value="PARTIALLY_DISPATCHED">Partially Dispatched</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <button className="btn secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>
            Reset Filters
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="loading-text">Loading orders...</p>
      ) : error ? (
        <div className="error-banner">
          <p>{error}</p>
          <button className="btn secondary text-sm" onClick={loadOrders}>Retry</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <p className="muted">No sales orders found matching filters.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Company Name</th>
                  <th>Quotation Ref</th>
                  <th>PI Ref</th>
                  <th>Status</th>
                  <th className="text-right">Ordered Units</th>
                  <th className="text-right">Dispatched</th>
                  <th className="text-right">Total Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">
                      <Link to={`/sales/orders/${o.id}`} className="accent-link">
                        {o.po_number}
                      </Link>
                      {o.client_po_ref && <div className="text-xs muted">Ref: {o.client_po_ref}</div>}
                    </td>
                    <td>
                      <Link to={`/companies/${o.company_id}`} className="muted-link">
                        {o.company_name}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/quotations/${o.quotation_id}`} className="muted-link text-xs">
                        {o.quotation_number}
                      </Link>
                    </td>
                    <td>
                      {o.pi_id ? (
                        <Link to={`/performa-invoices`} className="muted-link text-xs">
                          {o.pi_number}
                        </Link>
                      ) : (
                        <span className="text-xs muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(o.derivedStatus)}>
                        {o.derivedStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-right font-mono">{o.totalOrdered}</td>
                    <td className="text-right font-mono">
                      <span className={o.totalDispatched > 0 ? 'accent font-bold' : 'muted'}>
                        {o.totalDispatched} / {o.totalOrdered}
                      </span>
                    </td>
                    <td className="text-right font-bold">₹{o.total_amount.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/sales/orders/${o.id}`} className="btn secondary text-xs">
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex-between p-2 muted text-xs border-top">
            <span>Showing {orders.length} of {total} orders</span>
          </div>
        </div>
      )}
    </div>
  );
}
