import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PurchaseOrdersNotInvoicedData } from '../api';
import { ExpandableSearch } from '../components/ExpandableSearch';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PurchaseOrdersNotInvoiced() {
  const [data, setData] = useState<PurchaseOrdersNotInvoicedData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.dashboard.purchaseOrdersNotInvoiced().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted loading-text">Loading…</p>;

  const q = search.toLowerCase();
  const filtered = search
    ? data.purchaseOrders.filter(
        (po) =>
          po.number.toLowerCase().includes(q) ||
          po.quotation_number.toLowerCase().includes(q) ||
          po.company_name.toLowerCase().includes(q)
      )
    : data.purchaseOrders;

  return (
    <div>
      <h2>Purchase Orders Not Yet Invoiced</h2>
      <p className="page-subtitle">Purchase orders with no performa invoice issued yet.</p>

      <div className="inactive-summary">
        <div className="inactive-summary-count">
          {data.count} Not Yet Invoiced
        </div>
        <div className="inactive-summary-hint">These orders have no performa invoice issued yet.</div>
      </div>

      <div className="mb-3">
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by PO number, quotation number, or company..."
          ariaLabel="Search purchase orders not invoiced"
          maxWidth="340px"
        />
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Quotation</th>
                <th>Company</th>
                <th>Date</th>
                <th className="text-right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => (
                <tr key={po.id}>
                  <td>{po.number}</td>
                  <td>
                    <Link to={`/quotations/${po.quotation_id}`}>{po.quotation_number}</Link>
                  </td>
                  <td>{po.company_name}</td>
                  <td>{formatDate(po.date)}</td>
                  <td className="text-right">{formatCurrency(po.total)}</td>
                  <td>
                    <a className="btn small secondary" href={api.purchaseOrders.pdfUrl(po.id)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && data.purchaseOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No purchase orders awaiting invoicing.
                    <br />
                    You're all caught up.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && data.purchaseOrders.length > 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
