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
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading order details…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Order not found'}</p>
          <Link to="/sales/orders" className="ts-btn ts-ghost text-sm mt-2">
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
        return <span className="ts-st ts-tone-good">IN STOCK</span>;
      case 'PARTIALLY_AVAILABLE':
        return <span className="ts-st ts-tone-warn">PARTIALLY AVAILABLE</span>;
      case 'OUT_OF_STOCK':
        return <span className="ts-st ts-tone-bad">OUT OF STOCK</span>;
      default:
        return <span className="ts-st">{status}</span>;
    }
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* PAGE HEADER */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="ts-title">{order.po_number || `Order #${order.id}`}</h1>
            <span className="ts-st  font-medium">{order.derivedStatus.replace(/_/g, ' ')}</span>
          </div>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            Customer: <Link to={`/companies/${order.company_id}`} className="text-fg hover:underline">{order.company_name}</Link> | Date: {order.po_date}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/sales/orders" className="ts-btn ts-ghost">
            ← Orders List
          </Link>
          {!relatedDocuments.performaInvoice && relatedDocuments.purchaseOrder && (
            <Link to="/performa-invoices" className="ts-btn ts-dark">
              + Create PI
            </Link>
          )}
          <Link to="/sale-reports/new" className="ts-btn ts-ghost accent">
            + Create Sale Report / Dispatch
          </Link>
        </div>
      </div>

      {/* DOCUMENT RELATIONSHIPS & WORKFLOW CARD */}
      <div className="ts-card ts-tbl mb-3">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Linked Document Lifecycle</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {/* QUOTATION */}
          <div className="bg-tile rounded-[14px] p-3.5">
            <div className="text-[13px] text-subtle">Step 1 · Quotation</div>
            {relatedDocuments.quotation ? (
              <div className="mt-1">
                <Link to={`/quotations/${relatedDocuments.quotation.id}`} className="font-medium text-fg hover:underline">
                  {relatedDocuments.quotation.number}
                </Link>
                <div className="text-[13px] text-subtle">Status: {relatedDocuments.quotation.status}</div>
                <div className="text-[13px] mt-1 num">₹{relatedDocuments.quotation.total.toLocaleString('en-IN')}</div>
              </div>
            ) : (
              <div className="text-[13px] text-subtle mt-1">Not Linked</div>
            )}
          </div>

          {/* PO */}
          <div className="bg-tile rounded-[14px] p-3.5">
            <div className="text-[13px] text-subtle">Step 2 · Purchase order</div>
            {relatedDocuments.purchaseOrder ? (
              <div className="mt-1">
                <Link to={`/purchase-orders/${relatedDocuments.purchaseOrder.id}`} className="font-medium text-fg hover:underline">
                  {relatedDocuments.purchaseOrder.number}
                </Link>
                <div className="text-[13px] text-subtle">Date: {relatedDocuments.purchaseOrder.date}</div>
                {relatedDocuments.purchaseOrder.clientRef && (
                  <div className="text-[13px] text-subtle">Ref: {relatedDocuments.purchaseOrder.clientRef}</div>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-warn mt-1">Awaiting PO Creation</div>
            )}
          </div>

          {/* PI */}
          <div className="bg-tile rounded-[14px] p-3.5">
            <div className="text-[13px] text-subtle">Step 3 · Performa invoice</div>
            {relatedDocuments.performaInvoice ? (
              <div className="mt-1">
                <Link to={`/performa-invoices`} className="font-medium text-fg hover:underline">
                  {relatedDocuments.performaInvoice.number}
                </Link>
                <div className="text-[13px] text-subtle">Status: {relatedDocuments.performaInvoice.status}</div>
              </div>
            ) : (
              <div className="text-[13px] text-warn mt-1">Pending Performa Invoice</div>
            )}
          </div>

          {/* SALE REPORT */}
          <div className="bg-tile rounded-[14px] p-3.5">
            <div className="text-[13px] text-subtle">Step 4 · Dispatch / sale report</div>
            {relatedDocuments.saleReports.length > 0 ? (
              <div className="mt-1 flex-col gap-1">
                {relatedDocuments.saleReports.map((sr) => (
                  <div key={sr.id} className="text-[13px]">
                    <Link to={`/sale-reports/${sr.id}`} className="font-medium text-fg hover:underline">
                      {sr.number}
                    </Link>{' '}
                    <span className={sr.status === 'CONFIRMED' ? 'ts-st ts-tone-good' : 'ts-st ts-tone-warn'}>
                      {sr.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-subtle mt-1">No Dispatches Yet</div>
            )}
          </div>
        </div>
      </div>

      {/* STOCK CONSTRAINT ALERT IF SHORTAGE EXISTS */}
      {order.hasStockConstraint && (
        <div className="ts-card !bg-warnbg">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-warn flex items-center gap-2 flex-wrap">
                <span>Stock constraint detected</span>
              </h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Available inventory is insufficient to fulfill total remaining order line items. Total Shortage: {order.totalShortage} units.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link to="/inventory/stock" className="ts-btn ts-ghost ts-xs">
                View Stock
              </Link>
              <Link to="/inventory/operations/restock-queue" className="ts-btn ts-ghost ts-xs">
                View Restock Queue
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* LINE ITEMS & DISPATCH AVAILABILITY TABLE */}
      <div className="ts-card ts-tbl mb-3">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Order Line Items & Inventory Availability</h2>
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Description</th>
                <th className="ts-r">Ordered Qty</th>
                <th className="ts-r">Dispatched</th>
                <th className="ts-r">Remaining</th>
                <th className="ts-r">On Hand</th>
                <th className="ts-r">Reserved</th>
                <th className="ts-r">Available</th>
                <th className="text-center">Stock Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="num font-medium">{it.part_no || 'N/A'}</td>
                  <td>{it.description}</td>
                  <td className="ts-r num">{it.qty}</td>
                  <td className="ts-r num text-fg">{it.dispatchedQty}</td>
                  <td className="ts-r num">{it.remainingQty}</td>
                  <td className="ts-r num text-subtle">{it.onHand}</td>
                  <td className="ts-r num text-subtle">{it.reserved}</td>
                  <td className="ts-r num font-medium">{it.available}</td>
                  <td className="text-center">{getStockBadge(it.stockStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ORDER TIMELINE */}
      <div className="ts-card ts-tbl">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-2">Document & Fulfillment Timeline</h2>
        <div className="flex flex-col mt-1">
          {timeline.map((event, idx) => (
            <div key={idx} className="flex items-baseline justify-between gap-3 flex-wrap py-2.5 border-b border-dashed border-line2 last:border-0">
              <div className="font-medium text-[13.5px]">{event.title}</div>
              <div className="text-[13px] text-subtle">{event.timestamp}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
