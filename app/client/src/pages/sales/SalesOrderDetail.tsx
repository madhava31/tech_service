import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, SalesOrderDetailResponse } from '../../api';

export default function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SalesOrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadDetail();
  }, [id]);

  const loadDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.orderById(id!);
      setData(res);
    } catch (err: any) {
      console.error('Failed to load sales order detail:', err);
      setError(err.message || 'Failed to load sales order detail');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="loading-text">Loading order details…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Order not found'}</p>
          <Link to="/sales/orders" className="btn secondary text-sm mt-2">
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const { order, relatedDocuments, items, timeline } = data;

  const getStockBadge = (status: string) => {
    switch (status) {
      case 'IN_STOCK':
        return <span className="badge success">IN STOCK</span>;
      case 'PARTIALLY_AVAILABLE':
        return <span className="badge warning">PARTIALLY AVAILABLE</span>;
      case 'OUT_OF_STOCK':
        return <span className="badge danger">OUT OF STOCK</span>;
      default:
        return <span className="badge secondary">{status}</span>;
    }
  };

  return (
    <div className="page-container">
      {/* PAGE HEADER */}
      <div className="flex-between mb-3">
        <div>
          <div className="flex-gap align-center">
            <h1 className="ts-title">{order.po_number || `Order #${order.id}`}</h1>
            <span className="badge info font-medium">{order.derivedStatus.replace(/_/g, ' ')}</span>
          </div>
          <p className="muted text-sm mt-1">
            Customer: <Link to={`/companies/${order.company_id}`} className="accent-link">{order.company_name}</Link> | Date: {order.po_date}
          </p>
        </div>
        <div className="flex-gap">
          <Link to="/sales/orders" className="btn secondary">
            ← Orders List
          </Link>
          {!relatedDocuments.performaInvoice && relatedDocuments.purchaseOrder && (
            <Link to="/performa-invoices" className="btn primary">
              + Create PI
            </Link>
          )}
          <Link to="/sale-reports/new" className="btn accent">
            + Create Sale Report / Dispatch
          </Link>
        </div>
      </div>

      {/* DOCUMENT RELATIONSHIPS & WORKFLOW CARD */}
      <div className="card mb-3">
        <h2 className="card-title mb-2">Linked Document Lifecycle</h2>
        <div className="grid-4 gap-2">
          {/* QUOTATION */}
          <div className="p-2 border rounded bg-secondary-dark">
            <div className="text-xs muted font-mono">STEP 1: QUOTATION</div>
            {relatedDocuments.quotation ? (
              <div className="mt-1">
                <Link to={`/quotations/${relatedDocuments.quotation.id}`} className="font-bold accent-link">
                  {relatedDocuments.quotation.number}
                </Link>
                <div className="text-xs muted">Status: {relatedDocuments.quotation.status}</div>
                <div className="text-xs mt-1 font-mono">₹{relatedDocuments.quotation.total.toLocaleString('en-IN')}</div>
              </div>
            ) : (
              <div className="text-xs muted mt-1">Not Linked</div>
            )}
          </div>

          {/* PO */}
          <div className="p-2 border rounded bg-secondary-dark">
            <div className="text-xs muted font-mono">STEP 2: PURCHASE ORDER</div>
            {relatedDocuments.purchaseOrder ? (
              <div className="mt-1">
                <Link to={`/purchase-orders/${relatedDocuments.purchaseOrder.id}`} className="font-bold accent-link">
                  {relatedDocuments.purchaseOrder.number}
                </Link>
                <div className="text-xs muted">Date: {relatedDocuments.purchaseOrder.date}</div>
                {relatedDocuments.purchaseOrder.clientRef && (
                  <div className="text-xs muted">Ref: {relatedDocuments.purchaseOrder.clientRef}</div>
                )}
              </div>
            ) : (
              <div className="text-xs warning mt-1">Awaiting PO Creation</div>
            )}
          </div>

          {/* PI */}
          <div className="p-2 border rounded bg-secondary-dark">
            <div className="text-xs muted font-mono">STEP 3: PERFORMA INVOICE</div>
            {relatedDocuments.performaInvoice ? (
              <div className="mt-1">
                <Link to={`/performa-invoices`} className="font-bold accent-link">
                  {relatedDocuments.performaInvoice.number}
                </Link>
                <div className="text-xs muted">Status: {relatedDocuments.performaInvoice.status}</div>
              </div>
            ) : (
              <div className="text-xs warning mt-1">Pending Performa Invoice</div>
            )}
          </div>

          {/* SALE REPORT */}
          <div className="p-2 border rounded bg-secondary-dark">
            <div className="text-xs muted font-mono">STEP 4: DISPATCH / SALE REPORT</div>
            {relatedDocuments.saleReports.length > 0 ? (
              <div className="mt-1 flex-col gap-1">
                {relatedDocuments.saleReports.map((sr) => (
                  <div key={sr.id} className="text-xs">
                    <Link to={`/sale-reports/${sr.id}`} className="font-bold accent-link">
                      {sr.number}
                    </Link>{' '}
                    <span className={sr.status === 'CONFIRMED' ? 'badge success text-xs' : 'badge warning text-xs'}>
                      {sr.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs muted mt-1">No Dispatches Yet</div>
            )}
          </div>
        </div>
      </div>

      {/* STOCK CONSTRAINT ALERT IF SHORTAGE EXISTS */}
      {order.hasStockConstraint && (
        <div className="card border-warning mb-3 p-3">
          <div className="flex-between">
            <div>
              <h3 className="font-bold warning flex-gap align-center">
                <span>⚠️ Stock Constraint Detected</span>
              </h3>
              <p className="text-sm muted mt-1">
                Available inventory is insufficient to fulfill total remaining order line items. Total Shortage: {order.totalShortage} units.
              </p>
            </div>
            <div className="flex-gap">
              <Link to="/inventory/stock" className="btn secondary text-xs">
                View Stock
              </Link>
              <Link to="/inventory/operations/restock-queue" className="btn warning text-xs">
                View Restock Queue
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* LINE ITEMS & DISPATCH AVAILABILITY TABLE */}
      <div className="card mb-3">
        <h2 className="card-title mb-2">Order Line Items & Inventory Availability</h2>
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Description</th>
                <th className="text-right">Ordered Qty</th>
                <th className="text-right">Dispatched</th>
                <th className="text-right">Remaining</th>
                <th className="text-right">On Hand</th>
                <th className="text-right">Reserved</th>
                <th className="text-right">Available</th>
                <th className="text-center">Stock Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono font-medium">{it.part_no || 'N/A'}</td>
                  <td>{it.description}</td>
                  <td className="text-right font-mono font-bold">{it.qty}</td>
                  <td className="text-right font-mono accent">{it.dispatchedQty}</td>
                  <td className="text-right font-mono">{it.remainingQty}</td>
                  <td className="text-right font-mono muted">{it.onHand}</td>
                  <td className="text-right font-mono muted">{it.reserved}</td>
                  <td className="text-right font-mono font-medium">{it.available}</td>
                  <td className="text-center">{getStockBadge(it.stockStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ORDER TIMELINE */}
      <div className="card">
        <h2 className="card-title mb-2">Document & Fulfillment Timeline</h2>
        <div className="timeline-list pl-2 border-left mt-2">
          {timeline.map((event, idx) => (
            <div key={idx} className="timeline-item mb-2 pl-3 relative">
              <div className="font-medium text-sm">{event.title}</div>
              <div className="text-xs muted">{event.timestamp}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
