import { useEffect, useState } from 'react';
import { api, type InactiveCustomersData } from '../api';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const PAGE_SIZE = 20;

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function InactiveCustomers() {
  const [data, setData] = useState<InactiveCustomersData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.dashboard.inactiveCustomers().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search]);

  if (error) return <div className="ts-warnbox">{error}</div>;
  if (!data) return <p className="text-subtle ts-empty">Loading…</p>;

  const filtered = search
    ? data.customers.filter((c) => c.company_name.toLowerCase().includes(search.toLowerCase()))
    : data.customers;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 !block">
      <h1 className="ts-title">Inactive Customers</h1>
      <p className="ts-muted m-0 mt-1.5 text-[14px]">Customers with no purchases in the last {data.months} months.</p>
      </div>

      <div className="ts-card ts-kpi-sm flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[22px] font-medium text-fg num tracking-[-.02em]">
          {data.count} Inactive Customer{data.count === 1 ? '' : 's'}
        </div>
        <div className="text-[13px] text-subtle">No purchases in the last {data.months} months.</div>
      </div>

      <div>
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search inactive customers..."
          ariaLabel="Search inactive customers"
          maxWidth="280px"
        />
      </div>

      <div className="ts-card ts-tbl">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Last Purchase</th>
                <th className="ts-r">Months Inactive</th>
                <th className="ts-r">Historical Revenue</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.company_name}>
                  <td>{c.company_name}</td>
                  <td>{formatDate(c.last_purchase)}</td>
                  <td className="ts-r">{c.months_inactive} months</td>
                  <td className="ts-r">{formatCurrency(c.total_revenue)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-subtle">
                    No inactive customers found.
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
