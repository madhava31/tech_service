import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileDown, Pencil, Plus, Search } from 'lucide-react';
import { api, AdminUser, DeliveryChallanListRow } from '../api';
import { useAuth } from '../auth';
import { fmtDay } from '../components/ds/format';

const typeLabel = (t: string) => (t === 'returnable' ? 'Returnable' : 'Non returnable');

/** Delivery challans: list, new (manual), and the blank printable form. Never shows prices. */
export default function DeliveryChallans() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState<DeliveryChallanListRow[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [salesPeople, setSalesPeople] = useState<AdminUser[]>([]);
  const [salesPerson, setSalesPerson] = useState('');

  useEffect(() => {
    if (isAdmin) api.admin.listUsers().then(setSalesPeople).catch(() => setSalesPeople([]));
  }, [isAdmin]);

  useEffect(() => {
    setRows(null);
    setError('');
    api.deliveryChallans
      .list(isAdmin && salesPerson ? { createdBy: Number(salesPerson) } : undefined)
      .then(setRows)
      .catch((e) => {
        setError(e.message);
        setRows([]);
      });
  }, [isAdmin, salesPerson]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.customer_name, r.quotation_number, r.items_summary].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [rows, search]);

  const cols = isAdmin ? 8 : 7;

  return (
    <div className="ts-page-pad">
      <div className="ts-phead">
        <div style={{ minWidth: 0 }}>
          <div className="ts-crumb" style={{ fontSize: 13, color: 'rgb(var(--muted))', marginBottom: 6 }}>Sales</div>
          <h1>Delivery Challans</h1>
          <p className="ts-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            Dispatch documents listing part numbers and quantities only, never prices.
          </p>
        </div>
        <span className="ts-grow" />
        <div className="flex gap-2 flex-wrap">
          <a className="ts-btn ts-ghost" href={api.deliveryChallans.blankPdfUrl()}>
            <Download /> Download blank challan
          </a>
          <Link className="ts-btn ts-dark" to="/delivery-challans/new">
            <Plus /> New delivery challan
          </Link>
        </div>
      </div>

      {error && <div className="ts-warnbox"><span>{error}</span></div>}

      <section className="ts-card ts-white ts-tcard ts-tbl" style={{ ['--i' as string]: 0 }}>
        <div className="ts-tbar">
          <label className="ts-search">
            <Search className="size-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search DC no., customer, quotation, part" aria-label="Search delivery challans" />
          </label>
          {isAdmin && (
            <select className="ts-fi ts-sel" value={salesPerson} onChange={(e) => setSalesPerson(e.target.value)} aria-label="Filter by sales person">
              <option value="">All sales people</option>
              {salesPeople.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          )}
          <span className="ts-showing ts-muted">Showing {filtered.length} of {rows?.length ?? 0}</span>
        </div>

        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>DC No.</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Items</th>
                <th>Source quotation</th>
                {isAdmin && <th>Sales person</th>}
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`}>{Array.from({ length: cols }).map((__, c) => <td key={c}><span className="ts-skel" style={{ display: 'block', height: 14, width: 90 }} /></td>)}</tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={cols} className="ts-empty">{rows.length ? 'No delivery challans match this search.' : 'No delivery challans yet. Create one with New delivery challan, or from a quotation.'}</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/delivery-challans/${r.id}/preview`} className="ts-lnk" style={{ color: 'inherit', fontWeight: 500 }}>{r.number}</Link></td>
                    <td className="ts-muted">{fmtDay(r.date)}</td>
                    <td>{r.customer_name}</td>
                    <td><span className={`ts-st ${r.challan_type === 'returnable' ? 'ts-tone-warn' : ''}`}>{typeLabel(r.challan_type)}</span></td>
                    <td className="ts-muted font-mono text-[12px]" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.items_summary || ''}>{r.items_summary || '—'}</td>
                    <td>{r.quotation_id ? <Link to={`/quotations/${r.quotation_id}`} className="ts-lnk">{r.quotation_number}</Link> : <span className="ts-muted">Manual</span>}</td>
                    {isAdmin && <td className="ts-muted">{r.created_by_username || '—'}</td>}
                    <td className="ts-r">
                      <div className="ts-racts">
                        <Link to={`/delivery-challans/${r.id}/preview`} className="ts-btn ts-ghost ts-xs">View</Link>
                        <Link to={`/delivery-challans/${r.id}/edit`} className="ts-btn ts-ghost ts-xs" aria-label={`Edit ${r.number}`}><Pencil className="size-3.5" /> Edit</Link>
                        <a href={api.deliveryChallans.downloadPdfUrl(r.id)} className="ts-btn ts-ghost ts-xs" aria-label={`Download PDF of ${r.number}`}><FileDown className="size-3.5" /> PDF</a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
