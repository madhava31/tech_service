import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AwaitingCustomerResponseData } from '../api';
import { ExpandableSearch } from '../components/ExpandableSearch';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AwaitingCustomerResponse() {
  const [data, setData] = useState<AwaitingCustomerResponseData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.dashboard.awaitingCustomerResponse().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted loading-text">Loading…</p>;

  const q = search.toLowerCase();
  const filtered = search
    ? data.quotations.filter((it) => it.number.toLowerCase().includes(q) || it.company_name.toLowerCase().includes(q))
    : data.quotations;

  return (
    <div>
      <h2>Awaiting Customer Response</h2>
      <p className="page-subtitle">Quotations that have been sent and are awaiting a response from the customer.</p>

      <div className="inactive-summary">
        <div className="inactive-summary-count">
          {data.count} Awaiting Response
        </div>
        <div className="inactive-summary-hint">Sent to the customer but not yet accepted or rejected.</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by quotation number or company..."
          ariaLabel="Search awaiting customer response quotations"
          maxWidth="320px"
        />
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quotation Number</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="text-right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td>{it.number}</td>
                  <td>{it.company_name}</td>
                  <td>{formatDate(it.date)}</td>
                  <td className="text-right">{formatCurrency(it.total)}</td>
                  <td>
                    <Link className="btn small secondary" to={`/quotations/${it.id}`}>
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && data.quotations.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No quotations awaiting customer response.
                    <br />
                    You're all caught up.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && data.quotations.length > 0 && (
                <tr>
                  <td colSpan={5} className="muted">
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
