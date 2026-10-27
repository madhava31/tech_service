import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PendingSalesWorkResponse } from '../../api';

export default function SalesPending() {
  const [data, setData] = useState<PendingSalesWorkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPendingWork();
  }, []);

  const loadPendingWork = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.sales.pending();
      setData(res);
    } catch (err: any) {
      console.error('Failed to load pending sales work:', err);
      setError(err.message || 'Failed to load pending sales work');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <p className="ts-empty">Loading pending sales queue…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
        <div className="ts-warnbox">
          <p>{error || 'Failed to load pending sales queue'}</p>
          <button className="ts-btn ts-ghost ts-xs" onClick={loadPendingWork}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">Pending Sales Work Queue</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Actionable pipeline bottlenecks requiring document creation or follow-up.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/sales" className="ts-btn ts-ghost">
            ← Control Center
          </Link>
        </div>
      </div>

      {/* 1. QUOTATIONS AWAITING RESPONSE */}
      <div className="ts-card ts-tbl mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="m-0 text-[15px] font-medium text-fg text-warn flex items-center gap-2 flex-wrap">
            <span>Quotations Awaiting Customer Response</span>
          </h2>
          <span className="ts-st ts-tone-warn num">{data.quotationsAwaitingResponse.length} Pending</span>
        </div>
        {data.quotationsAwaitingResponse.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">No pending quotations awaiting customer response.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Quotation Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th>Age (Days)</th>
                  <th className="ts-r">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.quotationsAwaitingResponse.map((q) => (
                  <tr key={q.id}>
                    <td className="font-medium">
                      <Link to={`/quotations/${q.id}`} className="text-fg hover:underline">
                        {q.number}
                      </Link>
                    </td>
                    <td>{q.company_name}</td>
                    <td>{q.date}</td>
                    <td>
                      <span className={q.age_days > 7 ? 'ts-st ts-tone-bad' : 'ts-st ts-tone-warn'}>
                        {q.age_days} days
                      </span>
                    </td>
                    <td className="ts-r">₹{q.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/quotations/${q.id}`} className="ts-btn ts-ghost ts-xs">
                        Follow Up
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. ACCEPTED QUOTATIONS WITHOUT PO */}
      <div className="ts-card ts-tbl mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2 flex-wrap">
            <span>Accepted Quotations Awaiting Purchase Order</span>
          </h2>
          <span className="ts-st num">{data.acceptedQuotationsWithoutPo.length} Pending</span>
        </div>
        {data.acceptedQuotationsWithoutPo.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">All accepted quotations have linked purchase orders.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Quotation Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th className="ts-r">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.acceptedQuotationsWithoutPo.map((q) => (
                  <tr key={q.id}>
                    <td className="font-medium">
                      <Link to={`/quotations/${q.id}`} className="text-fg hover:underline">
                        {q.number}
                      </Link>
                    </td>
                    <td>{q.company_name}</td>
                    <td>{q.date}</td>
                    <td className="ts-r">₹{q.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/purchase-orders`} className="ts-btn ts-dark text-[13px]">
                        + Create PO
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. POs WITHOUT PI */}
      <div className="ts-card ts-tbl mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="m-0 text-[15px] font-medium text-fg flex items-center gap-2 flex-wrap">
            <span>Purchase Orders Awaiting Performa Invoice</span>
          </h2>
          <span className="ts-st num">{data.posWithoutPi.length} Pending</span>
        </div>
        {data.posWithoutPi.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">All purchase orders have linked performa invoices.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th className="ts-r">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.posWithoutPi.map((po) => (
                  <tr key={po.id}>
                    <td className="font-medium">
                      <Link to={`/sales/orders/${po.id}`} className="text-fg hover:underline">
                        {po.number}
                      </Link>
                    </td>
                    <td>{po.company_name}</td>
                    <td>{po.date}</td>
                    <td className="ts-r">₹{po.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/performa-invoices`} className="ts-btn ts-dark text-[13px]">
                        + Create PI
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. SALE REPORTS AWAITING CONFIRMATION */}
      <div className="ts-card ts-tbl mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="m-0 text-[15px] font-medium text-fg text-warn flex items-center gap-2 flex-wrap">
            <span>Draft Sale Reports Awaiting Confirmation & Stock-Out</span>
          </h2>
          <span className="ts-st ts-tone-warn num">{data.saleReportsAwaitingConfirmation.length} Pending</span>
        </div>
        {data.saleReportsAwaitingConfirmation.length === 0 ? (
          <p className="text-[13px] text-subtle p-2">No draft sale reports pending confirmation.</p>
        ) : (
          <div className="ts-tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Report Number</th>
                  <th>Company</th>
                  <th>Sale Date</th>
                  <th className="ts-r">Total Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.saleReportsAwaitingConfirmation.map((sr) => (
                  <tr key={sr.id}>
                    <td className="font-medium">
                      <Link to={`/sale-reports/${sr.id}`} className="text-fg hover:underline">
                        {sr.report_number}
                      </Link>
                    </td>
                    <td>{sr.company_name}</td>
                    <td>{sr.sale_date}</td>
                    <td className="ts-r">₹{sr.total_amount?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/sale-reports/${sr.id}`} className="ts-btn ts-ghost accent text-[13px]">
                        Confirm & Stock Out
                      </Link>
                    </td>
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
