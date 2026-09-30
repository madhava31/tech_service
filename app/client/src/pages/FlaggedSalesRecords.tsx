import { useEffect, useState } from 'react';
import { api, type FlaggedSalesRecordsData } from '../api';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const PAGE_SIZE = 20;

function formatCurrency(n: number | null) {
  if (n === null) return '-';
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function FlaggedSalesRecords() {
  const [data, setData] = useState<FlaggedSalesRecordsData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.dashboard.flaggedSalesRecords().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted loading-text">Loading…</p>;

  const q = search.toLowerCase();
  const filtered = search
    ? data.records.filter((r) =>
        [r.company_name, r.invoice_no, r.part_no, r.review_reason].some((field) => (field || '').toLowerCase().includes(q))
      )
    : data.records;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <h2>Flagged Sales Records</h2>
      <p className="page-subtitle">Imported sales rows with missing or unclear data that need review.</p>

      <div className="inactive-summary">
        <div className="inactive-summary-count">
          {data.count} Flagged Record{data.count === 1 ? '' : 's'}
        </div>
        <div className="inactive-summary-hint">Data quality issues found during import (missing or unclear fields).</div>
      </div>

      <div className="mb-3">
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by company, invoice, part no, or reason..."
          ariaLabel="Search flagged sales records"
          maxWidth="340px"
        />
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Company</th>
                <th>Part No</th>
                <th>Product</th>
                <th className="text-right">Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.sale_date)}</td>
                  <td>{r.invoice_no || '-'}</td>
                  <td>{r.company_name || '-'}</td>
                  <td>{r.part_no || '-'}</td>
                  <td>{r.product_description || '-'}</td>
                  <td className="text-right">{formatCurrency(r.total_amount)}</td>
                  <td className="muted">{r.review_reason || '-'}</td>
                </tr>
              ))}
              {filtered.length === 0 && data.records.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No flagged sales records.
                    <br />
                    You're all caught up.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && data.records.length > 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
