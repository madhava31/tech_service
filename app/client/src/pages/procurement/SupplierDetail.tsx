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
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading supplier profile…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Supplier not found'}</p>
          <Link to="/procurement/suppliers" className="ts-btn ts-ghost text-[13.5px] mt-2">
            Back to Suppliers
          </Link>
        </div>
      </div>
    );
  }

  const { supplier, purchaseOrders, summary } = data;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">{supplier.name}</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Contact: {supplier.contact_person || 'N/A'} | Email: {supplier.email || 'N/A'} | Phone: {supplier.phone || 'N/A'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/procurement/suppliers" className="ts-btn ts-ghost">
            ← Suppliers Directory
          </Link>
        </div>
      </div>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Total Purchase Orders</span>
          <span className="ts-val num !mt-1.5 truncate">{summary.totalPurchaseOrders}</span>
          <span className="text-[12.5px] text-faint mt-1">All Time POs</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Open Orders</span>
          <span className="ts-val num !mt-1.5 truncate text-warn">{summary.openOrders}</span>
          <span className="text-[12.5px] text-faint mt-1">Pending Delivery</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col">
          <span className="text-[13.5px] text-subtle">Completed Orders</span>
          <span className="ts-val num !mt-1.5 truncate text-good">{summary.completedOrders}</span>
          <span className="text-[12.5px] text-faint mt-1">Fully Received</span>
        </div>
        <div className="ts-card ts-kpi-sm flex flex-col accent-border">
          <span className="text-[13.5px] text-subtle">Total Procurement Spend</span>
          <span className="ts-val num !mt-1.5 truncate text-fg">₹{summary.totalProcurementValue.toLocaleString('en-IN')}</span>
          <span className="text-[12.5px] text-faint mt-1">Cumulative PO Value</span>
        </div>
      </div>

      {/* PO HISTORY TABLE */}
      <div className="ts-card ts-tbl">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Purchase Orders History</h2>
        {purchaseOrders.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">No purchase orders linked to this supplier yet.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>PO Date</th>
                  <th>Quotation Ref</th>
                  <th>Status</th>
                  <th className="ts-r">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="num">
                      <Link to="/purchase-orders" className="text-fg hover:underline">
                        {po.number}
                      </Link>
                    </td>
                    <td>{po.date}</td>
                    <td className="num text-[13px]">{po.quotation_number}</td>
                    <td>
                      <span className={po.status === 'received' || po.status === 'RECEIVED' ? 'ts-st ts-tone-good' : 'ts-st'}>
                        {po.status}
                      </span>
                    </td>
                    <td className="ts-r">₹{Number(po.total || 0).toLocaleString('en-IN')}</td>
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
