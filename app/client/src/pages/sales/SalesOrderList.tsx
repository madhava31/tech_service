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
        return 'ts-st ts-tone-good';
      case 'PARTIALLY_DISPATCHED':
        return 'ts-st ts-tone-warn';
      case 'READY_TO_DISPATCH':
        return 'ts-st';
      case 'PI_CREATED':
        return 'ts-st';
      case 'PO_CREATED':
        return 'ts-st';
      case 'QUOTATION_DRAFT':
        return 'ts-st';
      default:
        return 'ts-st';
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Sales Orders</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Monitor order fulfillment, purchase order linkage, performa invoices, and partial dispatches.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/sales" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
          <Link to="/quotations/new" className="ts-btn ts-dark">
            + Create Order / Quotation
          </Link>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="ts-card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            className="ts-fi !pl-4 !rounded-full !bg-tile !border-transparent sm:flex-1"
            placeholder="Search PO #, Quotation #, PI #, Company, Ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="ts-fi ts-sel sm:!w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Operational Statuses</option>
            <option value="PO_CREATED">PO Created</option>
            <option value="PI_CREATED">PI Created</option>
            <option value="READY_TO_DISPATCH">Ready to Dispatch</option>
            <option value="PARTIALLY_DISPATCHED">Partially Dispatched</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <button className="ts-btn ts-ghost ts-xs self-start sm:self-auto" onClick={() => { setSearch(''); setStatusFilter(''); }}>
            Reset Filters
          </button>
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <p className="ts-empty">Loading orders...</p>
      ) : error ? (
        <div className="ts-warnbox">
          <p>{error}</p>
          <button className="ts-btn ts-ghost ts-xs" onClick={loadOrders}>Retry</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="ts-empty">
          <p className="text-subtle">No sales orders found matching filters.</p>
        </div>
      ) : (
        <div className="ts-card ts-tbl">
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Company Name</th>
                  <th>Quotation Ref</th>
                  <th>PI Ref</th>
                  <th>Status</th>
                  <th className="ts-r">Ordered Units</th>
                  <th className="ts-r">Dispatched</th>
                  <th className="ts-r">Total Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">
                      <Link to={`/sales/orders/${o.id}`} className="text-fg hover:underline">
                        {o.po_number}
                      </Link>
                      {o.client_po_ref && <div className="text-[13px] text-subtle">Ref: {o.client_po_ref}</div>}
                    </td>
                    <td>
                      <Link to={`/companies/${o.company_id}`} className="text-subtle hover:text-fg">
                        {o.company_name}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/quotations/${o.quotation_id}`} className="text-subtle hover:text-fg text-[13px]">
                        {o.quotation_number}
                      </Link>
                    </td>
                    <td>
                      {o.pi_id ? (
                        <Link to={`/performa-invoices`} className="text-subtle hover:text-fg text-[13px]">
                          {o.pi_number}
                        </Link>
                      ) : (
                        <span className="text-[13px] text-subtle">—</span>
                      )}
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(o.derivedStatus)}>
                        {o.derivedStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="ts-r num">{o.totalOrdered}</td>
                    <td className="ts-r num">
                      <span className={o.totalDispatched > 0 ? 'text-fg font-medium' : 'text-subtle'}>
                        {o.totalDispatched} / {o.totalOrdered}
                      </span>
                    </td>
                    <td className="ts-r">₹{o.total_amount.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/sales/orders/${o.id}`} className="ts-btn ts-ghost ts-xs">
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap p-2 text-subtle text-[13px] border-t border-line2">
            <span>Showing {orders.length} of {total} orders</span>
          </div>
        </div>
      )}
    </div>
  );
}
