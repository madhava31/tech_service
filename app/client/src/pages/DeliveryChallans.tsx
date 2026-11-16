import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileDown, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, AdminUser, DeliveryChallanListRow } from '../api';
import { DownloadPdfButton } from '../components/DownloadPdfButton';
import { pdfFileName } from '../lib/savePdf';
import { useAuth } from '../auth';
import { fmtDay } from '../components/ds/format';

const typeLabel = (t: string) => (t === 'returnable' ? 'Returnable' : 'Non returnable');

/** Delivery challans: list, new (manual), and the blank printable form. Never shows prices. */
export default function DeliveryChallans() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState<DeliveryChallanListRow[] | null>(null);
  const [error, setError] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const [search, setSearch] = useState('');
  const [salesPeople, setSalesPeople] = useState<AdminUser[]>([]);
  const [salesPerson, setSalesPerson] = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    if (isAdmin) api.admin.listUsers().then(setSalesPeople).catch(() => setSalesPeople([]));
  }, [isAdmin]);

  const loadChallans = () => {
    setRows(null);
    setError('');
    api.deliveryChallans
      .list(isAdmin && salesPerson ? { createdBy: Number(salesPerson) } : undefined)
      .then(setRows)
      .catch((e) => {
        setError(e.message);
        setRows([]);
      });
  };

  useEffect(() => {
    loadChallans();
  }, [isAdmin, salesPerson]);

  const handleDelete = async (id: number, number: string) => {
    if (!window.confirm(`Are you sure you want to delete Delivery Challan "${number}"? This action cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setError('');
    try {
      await api.deliveryChallans.delete(id);
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : []));
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      setSuccessToast(`Delivery Challan ${number} deleted.`);
      setTimeout(() => setSuccessToast(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Failed to delete delivery challan.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} delivery challan(s)? This action cannot be undone.`)) {
      return;
    }
    setIsBulkDeleting(true);
    setError('');
    try {
      const res = await api.deliveryChallans.bulkDelete(selectedIds);
      setRows((prev) => (prev ? prev.filter((r) => !selectedIds.includes(r.id)) : []));
      setSuccessToast(`Deleted ${res.deletedCount || selectedIds.length} delivery challan(s).`);
      setSelectedIds([]);
      setIsSelectionMode(false);
      setTimeout(() => setSuccessToast(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Failed to delete selected delivery challans.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.customer_name, r.quotation_number, r.items_summary].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [rows, search]);

  const toggleSelectAll = () => {
    if (!filtered.length) return;
    const allFilteredSelected = filtered.every((r) => selectedIds.includes(r.id));
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filtered.some((r) => r.id === id)));
    } else {
      const newIds = new Set([...selectedIds, ...filtered.map((r) => r.id)]);
      setSelectedIds(Array.from(newIds));
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const cols = (isAdmin ? 8 : 7) + (isSelectionMode ? 1 : 0);

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
        <div className="flex gap-2 flex-wrap items-center">
          {!isSelectionMode ? (
            <button
              type="button"
              className="ts-btn ts-ghost cursor-pointer"
              onClick={() => setIsSelectionMode(true)}
              disabled={!rows || rows.length === 0}
            >
              <Trash2 className="size-4" /> Select to delete
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`ts-btn ${selectedIds.length ? 'ts-danger' : 'ts-ghost'} cursor-pointer`}
                onClick={handleBulkDelete}
                disabled={isBulkDeleting || selectedIds.length === 0}
              >
                {isBulkDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {isBulkDeleting ? 'Deleting…' : selectedIds.length ? `Delete ${selectedIds.length} selected` : 'Delete selected'}
              </button>
              <button
                type="button"
                className="ts-btn ts-ghost cursor-pointer"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedIds([]);
                }}
              >
                Cancel
              </button>
            </>
          )}
          <DownloadPdfButton url={api.deliveryChallans.blankPdfUrl()} fileName="Blank-Delivery-Challan.pdf" kind="delivery-challan" className="ts-btn ts-ghost">
            <Download /> Download blank challan
          </DownloadPdfButton>
          <Link className="ts-btn ts-dark" to="/delivery-challans/new">
            <Plus /> New delivery challan
          </Link>
        </div>
      </div>

      {successToast && (
        <div className="ts-okbox" style={{ marginBottom: 16 }}>
          <span>{successToast}</span>
          <button type="button" onClick={() => setSuccessToast('')}>Dismiss</button>
        </div>
      )}
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
                {isSelectionMode && (
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      className="ts-chk cursor-pointer"
                      checked={filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id))}
                      onChange={toggleSelectAll}
                      aria-label="Select all delivery challans"
                    />
                  </th>
                )}
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
                filtered.map((r) => {
                  const isSelected = selectedIds.includes(r.id);
                  return (
                    <tr key={r.id} className={isSelectionMode && isSelected ? 'ts-picked' : ''}>
                      {isSelectionMode && (
                        <td>
                          <input
                            type="checkbox"
                            className="ts-chk cursor-pointer"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(r.id)}
                            aria-label={`Select delivery challan ${r.number}`}
                          />
                        </td>
                      )}
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
                          <DownloadPdfButton url={api.deliveryChallans.downloadPdfUrl(r.id)} fileName={pdfFileName(r.number)} kind="delivery-challan" className="ts-btn ts-ghost ts-xs" ariaLabel={`Download PDF of ${r.number}`}><FileDown className="size-3.5" /> PDF</DownloadPdfButton>
                          <button
                            type="button"
                            className="ts-btn ts-ghost ts-xs text-bad hover:bg-bad/10 cursor-pointer"
                            onClick={() => handleDelete(r.id, r.number)}
                            disabled={deletingId === r.id}
                            aria-label={`Delete ${r.number}`}
                            title="Delete"
                          >
                            {deletingId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
