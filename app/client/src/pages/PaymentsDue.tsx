import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PaymentsDueData } from '../api';
import { ExpandableSearch } from '../components/ExpandableSearch';
import { PaymentStatusPill } from '../components/QuotationPayments';
import { fmtDay } from '../components/ds/format';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Drill-down behind the dashboard's "Payments overdue" alert. It lists every quotation with a PO that
// still has money to come, most overdue first.
export default function PaymentsDue() {
  const [data, setData] = useState<PaymentsDueData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  useEffect(() => {
    api.dashboard.paymentsDue().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="ts-page-pad"><div className="ts-warnbox">{error}</div></div>;
  if (!data) return <p className="text-subtle ts-empty">Loading…</p>;

  const q = search.toLowerCase();
  const filtered = data.items.filter(
    (it) =>
      (!onlyOverdue || it.status === 'overdue') &&
      (!search ||
        it.quotation_number.toLowerCase().includes(q) ||
        it.company_name.toLowerCase().includes(q) ||
        (it.contact_person || '').toLowerCase().includes(q))
  );

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      <div className="ts-phead !mb-2 !block">
        <h1 className="ts-title">Payments Due</h1>
        <p className="ts-muted m-0 mt-1.5 text-[14px]">
          Advance is due after the purchase order, and the balance after the performa invoice, within each quotation's due days.
        </p>
      </div>

      <div className="ts-card ts-kpi-sm flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[22px] font-medium text-fg num tracking-[-.02em]">
          {formatCurrency(data.totals.overdue_amount)} overdue
          <span className="text-[14px] text-subtle font-normal"> · {data.totals.overdue_count} of {data.totals.count} quotations</span>
        </div>
        <div className="text-[13px] text-subtle">{formatCurrency(data.totals.outstanding)} still to be received in total.</div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by quotation, company or contact..."
          ariaLabel="Search payments due"
          maxWidth="340px"
        />
        <label className="flex items-center gap-2 text-[13px] text-subtle">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          Only overdue
        </label>
      </div>

      <div className="ts-card ts-tbl">
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Quotation</th>
                <th>Contact</th>
                <th className="ts-r">Total</th>
                <th className="ts-r">Advance</th>
                <th className="ts-r">Received</th>
                <th className="ts-r">Outstanding</th>
                <th>Next due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.quotation_id}>
                  <td>{it.company_name}</td>
                  <td><Link to={`/quotations/${it.quotation_id}`}>{it.quotation_number}</Link></td>
                  <td>{it.contact_person ? `${it.contact_person}${it.contact_phone ? ` · ${it.contact_phone}` : ''}` : '—'}</td>
                  <td className="ts-r">{formatCurrency(it.total)}</td>
                  <td className="ts-r">{it.advance_percent}%</td>
                  <td className="ts-r">{formatCurrency(it.received)}</td>
                  <td className="ts-r">
                    {formatCurrency(it.outstanding)}
                    {it.overdue_amount > 0 && <span className="block text-[12px] text-bad">{formatCurrency(it.overdue_amount)} overdue</span>}
                  </td>
                  <td>{it.next_due_date ? fmtDay(it.next_due_date) : 'Waiting for PI'}</td>
                  <td>
                    <PaymentStatusPill status={it.status} label={it.days_overdue > 0 ? `${it.status_label} · ${it.days_overdue} days` : it.status_label} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-subtle">
                    {data.items.length === 0 ? 'No payments outstanding. You\'re all caught up.' : 'No matches.'}
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
