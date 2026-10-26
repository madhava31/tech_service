import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, SupplierDetailResponse } from '../../api';

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SupplierDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadDetail();
  }, [id]);

  const loadDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.procurement.supplierById(id!);
      setData(res);
    } catch (err: any) {
      console.error('Failed to load supplier detail:', err);
      setError(err.message || 'Failed to load supplier detail');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="loading-text">Loading supplier profile…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Supplier not found'}</p>
          <Link to="/procurement/suppliers" className="btn secondary text-sm mt-2">
            Back to Suppliers
          </Link>
        </div>
      </div>
    );
  }

  const { supplier, purchaseOrders, summary } = data;

  return (
    <div className="page-container">
      <div className="flex-between mb-3">
        <div>
          <h1 className="ts-title">{supplier.name}</h1>
          <p className="muted text-sm mt-1">
            Contact: {supplier.contact_person || 'N/A'} | Email: {supplier.email || 'N/A'} | Phone: {supplier.phone || 'N/A'}
          </p>
        </div>
        <div className="flex-gap">
          <Link to="/procurement/suppliers" className="btn secondary">
            ← Suppliers Directory
          </Link>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div className="grid-cards mb-3">
        <div className="stat-card">
          <span className="stat-label">Total Purchase Orders</span>
          <span className="stat-value">{summary.totalPurchaseOrders}</span>
          <span className="text-xs muted mt-1">All Time POs</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open Orders</span>
          <span className="stat-value warning">{summary.openOrders}</span>
          <span className="text-xs muted mt-1">Pending Delivery</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Completed Orders</span>
          <span className="stat-value success">{summary.completedOrders}</span>
          <span className="text-xs muted mt-1">Fully Received</span>
        </div>
        <div className="stat-card accent-border">
          <span className="stat-label">Total Procurement Spend</span>
          <span className="stat-value accent">₹{summary.totalProcurementValue.toLocaleString('en-IN')}</span>
          <span className="text-xs muted mt-1">Cumulative PO Value</span>
        </div>
      </div>

      {/* PO HISTORY TABLE */}
      <div className="card">
        <h2 className="card-title mb-2">Purchase Orders History</h2>
        {purchaseOrders.length === 0 ? (
          <p className="text-xs muted p-2">No purchase orders linked to this supplier yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Quotation Ref</th>
                  <th>Status</th>
                  <th className="text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="font-mono font-bold">
                      <Link to="/purchase-orders" className="accent-link">
                        {po.number}
                      </Link>
                    </td>
                    <td>{po.date}</td>
                    <td className="font-mono text-xs">{po.quotation_number}</td>
                    <td>
                      <span className={po.status === 'received' || po.status === 'RECEIVED' ? 'badge success' : 'badge info'}>
                        {po.status}
                      </span>
                    </td>
                    <td className="text-right font-bold">₹{Number(po.total || 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
