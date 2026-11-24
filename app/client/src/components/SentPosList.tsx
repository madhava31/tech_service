import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, type SentPoListRow } from '../api';
import { useAuth } from '../auth';
import { fmtDay } from './ds/format';
import { DownloadPdfButton } from './DownloadPdfButton';
import { ExpandableSearch } from './ExpandableSearch';
import { pdfFileName, showToast } from '../lib/savePdf';

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Sent POs: the purchase orders Technicon sends to its suppliers. New, edit, PDF, and delete (admin). */
export function SentPosList() {
  const isAdmin = useAuth().user?.role === 'admin';
  const [rows, setRows] = useState<SentPoListRow[]>([]);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = () => {
    setLoading(true);
    return api.sentPos
      .list({ q: q || undefined })
      .then((r) => { setRows(r); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the POs.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function remove(po: SentPoListRow) {
    if (!window.confirm(`Delete PO ${po.number} to ${po.supplier_name}? It is removed for good.`)) return;
    setDeletingId(po.id);
    try {
      await api.sentPos.remove(po.id);
      showToast(`PO ${po.number} deleted.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the PO.');
    } finally {
      setDeletingId(null);
    }
  }

  const total = rows.reduce((a, r) => a + Number(r.total || 0), 0);
  const balance = rows.reduce((a, r) => a + Number(r.balance || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>Sent POs</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Purchase orders sent to suppliers for the products Technicon buys.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link to="/purchase-orders/sent/new" className="ts-btn ts-dark"><Plus className="size-4" /> New PO</Link>
          </div>
        </div>
        <div className="grid grid-cols-2 rounded-[18px] shadow-card bg-surface2 overflow-hidden">
          <div className="p-[10px_16px] border-r border-line2 flex flex-col gap-[2px]">
            <span className="text-[12px] text-subtle">Total value</span>
            <span className="text-[22px] font-medium text-fg tracking-[-.02em] num">₹{(total / 100000).toFixed(2)}L</span>
          </div>
          <div className="p-[10px_16px] flex flex-col gap-[2px]">
            <span className="text-[12px] text-subtle">Balance to pay</span>
            <span className="text-[22px] font-medium text-fg tracking-[-.02em] num">₹{(balance / 100000).toFixed(2)}L</span>
          </div>
        </div>
      </div>

      {error && <div className="ts-warnbox">{error}</div>}

      <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
          <ExpandableSearch value={search} onChange={setSearch} placeholder="Search PO, supplier or part..." ariaLabel="Search sent POs" maxWidth="300px" />
          <span className="ts-showing ts-muted">{loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'PO' : 'POs'}`}</span>
        </div>
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                <th>PO number</th>
                <th>Supplier</th>
                <th>Order date</th>
                <th>Due date</th>
                <th className="ts-r">Total</th>
                <th className="ts-r">Balance</th>
                <th className="ts-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id}>
                  <td className="p-[11px_10px] font-medium text-fg">
                    <Link to={`/purchase-orders/sent/${po.id}/edit`} className="text-fg hover:underline">{po.number}</Link>
                    <small className="block text-[11.5px] text-subtle">{po.lines} {po.lines === 1 ? 'item' : 'items'}</small>
                  </td>
                  <td className="p-[11px_10px] text-fg">{po.supplier_name}</td>
                  <td className="p-[11px_10px] text-subtle">{fmtDay(po.order_date)}</td>
                  <td className="p-[11px_10px] text-subtle">{po.due_date ? fmtDay(po.due_date) : '—'}</td>
                  <td className="p-[11px_10px] text-right num">{inr(po.total)}</td>
                  <td className="p-[11px_10px] text-right num">{inr(po.balance)}</td>
                  <td className="p-[11px_10px] text-right whitespace-nowrap">
                    <Link to={`/purchase-orders/sent/${po.id}/edit`} className="text-[12px] text-subtle hover:text-fg hover:underline">Edit</Link>
                    <a href={api.sentPos.pdfUrl(po.id)} target="_blank" rel="noreferrer" className="ml-3 text-[12px] text-subtle hover:text-fg hover:underline">PDF →</a>
                    <DownloadPdfButton url={api.sentPos.pdfUrl(po.id)} fileName={pdfFileName(po.number)} kind="purchase-order" className="ml-3 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-subtle hover:text-fg hover:underline" title="Save the PDF to a folder">
                      Save
                    </DownloadPdfButton>
                    {isAdmin && (
                      <button type="button" className="ml-3 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-bad hover:underline disabled:opacity-50" disabled={deletingId === po.id} onClick={() => remove(po)}>
                        {deletingId === po.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="ts-empty">No POs sent yet. Use <b>New PO</b> to raise one to a supplier.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
