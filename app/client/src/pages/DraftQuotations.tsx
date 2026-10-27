import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DraftQuotationsData } from '../api';
import { ExpandableSearch } from '../components/ExpandableSearch';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DraftQuotations() {
  const [data, setData] = useState<DraftQuotationsData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.dashboard.draftQuotations().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="ts-warnbox">{error}</div>;
  if (!data) return <p className="text-subtle ts-empty">Loading…</p>;

  const q = search.toLowerCase();
  const filtered = search
    ? data.quotations.filter((it) => it.number.toLowerCase().includes(q) || it.company_name.toLowerCase().includes(q))
    : data.quotations;

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 !block">
      <h1 className="ts-title">Draft Quotations</h1>
      <p className="ts-muted m-0 mt-1.5 text-[14px]">Quotations that are still being prepared and have not yet been sent to the customer.</p>
      </div>

      <div className="ts-card ts-kpi-sm flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[22px] font-medium text-fg num tracking-[-.02em]">
          {data.count} Draft Quotation{data.count === 1 ? '' : 's'}
        </div>
        <div className="text-[13px] text-subtle">Not yet sent to the customer.</div>
      </div>

      <div>
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by quotation number or company..."
          ariaLabel="Search draft quotations"
          maxWidth="320px"
        />
      </div>

      <div className="ts-card ts-tbl">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Quotation Number</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="ts-r">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td>{it.number}</td>
                  <td>{it.company_name}</td>
                  <td>{formatDate(it.date)}</td>
                  <td className="ts-r">{formatCurrency(it.total)}</td>
                  <td>
                    <Link className="ts-btn ts-ghost ts-xs" to={`/quotations/${it.id}`}>
                      Continue →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && data.quotations.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-subtle">
                    No draft quotations.
                    <br />
                    You're all caught up.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && data.quotations.length > 0 && (
                <tr>
                  <td colSpan={5} className="text-subtle">
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
