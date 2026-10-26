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
      <div className="page-container">
        <p className="loading-text">Loading pending sales queue…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="error-banner">
          <p>{error || 'Failed to load pending sales queue'}</p>
          <button className="btn secondary text-sm" onClick={loadPendingWork}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex-between mb-3">
        <div>
          <h1 className="ts-title">Pending Sales Work Queue</h1>
          <p className="muted text-sm">Actionable pipeline bottlenecks requiring document creation or follow-up.</p>
        </div>
        <div className="flex-gap">
          <Link to="/sales" className="btn secondary">
            ← Control Center
          </Link>
        </div>
      </div>

      {/* 1. QUOTATIONS AWAITING RESPONSE */}
      <div className="card mb-3">
        <div className="flex-between mb-2">
          <h2 className="card-title warning flex-gap align-center">
            <span>Quotations Awaiting Customer Response</span>
          </h2>
          <span className="badge warning font-mono">{data.quotationsAwaitingResponse.length} Pending</span>
        </div>
        {data.quotationsAwaitingResponse.length === 0 ? (
          <p className="text-xs muted p-2">No pending quotations awaiting customer response.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quotation Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th>Age (Days)</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.quotationsAwaitingResponse.map((q) => (
                  <tr key={q.id}>
                    <td className="font-medium">
                      <Link to={`/quotations/${q.id}`} className="accent-link">
                        {q.number}
                      </Link>
                    </td>
                    <td>{q.company_name}</td>
                    <td>{q.date}</td>
                    <td>
                      <span className={q.age_days > 7 ? 'badge danger text-xs' : 'badge warning text-xs'}>
                        {q.age_days} days
                      </span>
                    </td>
                    <td className="text-right font-bold">₹{q.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/quotations/${q.id}`} className="btn secondary text-xs">
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
      <div className="card mb-3">
        <div className="flex-between mb-2">
          <h2 className="card-title info flex-gap align-center">
            <span>Accepted Quotations Awaiting Purchase Order</span>
          </h2>
          <span className="badge info font-mono">{data.acceptedQuotationsWithoutPo.length} Pending</span>
        </div>
        {data.acceptedQuotationsWithoutPo.length === 0 ? (
          <p className="text-xs muted p-2">All accepted quotations have linked purchase orders.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quotation Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.acceptedQuotationsWithoutPo.map((q) => (
                  <tr key={q.id}>
                    <td className="font-medium">
                      <Link to={`/quotations/${q.id}`} className="accent-link">
                        {q.number}
                      </Link>
                    </td>
                    <td>{q.company_name}</td>
                    <td>{q.date}</td>
                    <td className="text-right font-bold">₹{q.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/purchase-orders`} className="btn primary text-xs">
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
      <div className="card mb-3">
        <div className="flex-between mb-2">
          <h2 className="card-title flex-gap align-center">
            <span>Purchase Orders Awaiting Performa Invoice</span>
          </h2>
          <span className="badge font-mono">{data.posWithoutPi.length} Pending</span>
        </div>
        {data.posWithoutPi.length === 0 ? (
          <p className="text-xs muted p-2">All purchase orders have linked performa invoices.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.posWithoutPi.map((po) => (
                  <tr key={po.id}>
                    <td className="font-medium">
                      <Link to={`/sales/orders/${po.id}`} className="accent-link">
                        {po.number}
                      </Link>
                    </td>
                    <td>{po.company_name}</td>
                    <td>{po.date}</td>
                    <td className="text-right font-bold">₹{po.total?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/performa-invoices`} className="btn primary text-xs">
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
      <div className="card mb-3">
        <div className="flex-between mb-2">
          <h2 className="card-title warning flex-gap align-center">
            <span>Draft Sale Reports Awaiting Confirmation & Stock-Out</span>
          </h2>
          <span className="badge warning font-mono">{data.saleReportsAwaitingConfirmation.length} Pending</span>
        </div>
        {data.saleReportsAwaitingConfirmation.length === 0 ? (
          <p className="text-xs muted p-2">No draft sale reports pending confirmation.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report Number</th>
                  <th>Company</th>
                  <th>Sale Date</th>
                  <th className="text-right">Total Amount</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.saleReportsAwaitingConfirmation.map((sr) => (
                  <tr key={sr.id}>
                    <td className="font-medium">
                      <Link to={`/sale-reports/${sr.id}`} className="accent-link">
                        {sr.report_number}
                      </Link>
                    </td>
                    <td>{sr.company_name}</td>
                    <td>{sr.sale_date}</td>
                    <td className="text-right font-bold">₹{sr.total_amount?.toLocaleString('en-IN')}</td>
                    <td className="text-center">
                      <Link to={`/sale-reports/${sr.id}`} className="btn accent text-xs">
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
