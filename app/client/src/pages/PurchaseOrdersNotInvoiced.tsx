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

  if (error) return <div className="ts-warnbox">{error}</div>;
  if (!data) return <p className="text-subtle ts-empty">Loading…</p>;

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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 !block">
      <h1 className="ts-title">Purchase Orders Not Yet Invoiced</h1>
      <p className="ts-muted m-0 mt-1.5 text-[14px]">Purchase orders with no performa invoice issued yet.</p>
      </div>

      <div className="ts-card ts-kpi-sm flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[22px] font-medium text-fg num tracking-[-.02em]">
          {data.count} Not Yet Invoiced
        </div>
        <div className="text-[13px] text-subtle">These orders have no performa invoice issued yet.</div>
      </div>

      <div>
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by PO number, quotation number, or company..."
          ariaLabel="Search purchase orders not invoiced"
          maxWidth="340px"
        />
      </div>

      <div className="ts-card ts-tbl">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Quotation</th>
                <th>Company</th>
                <th>Date</th>
                <th className="ts-r">Amount</th>
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
                  <td className="ts-r">{formatCurrency(po.total)}</td>
                  <td>
                    <a className="ts-btn ts-ghost ts-xs" href={api.purchaseOrders.pdfUrl(po.id)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && data.purchaseOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-subtle">
                    No purchase orders awaiting invoicing.
                    <br />
                    You're all caught up.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && data.purchaseOrders.length > 0 && (
                <tr>
                  <td colSpan={6} className="text-subtle">
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
