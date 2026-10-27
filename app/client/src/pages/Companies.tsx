import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Company } from '../api';
import { useAuth } from '../auth';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';
import { Trash2, X, RefreshCw, Plus } from 'lucide-react';

const empty: Partial<Company> = { name: '', address: '', state: '', gstin: '', contact_person: '', phone: '', email: '' };
const PAGE_SIZE = 20;

export default function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [editing, setEditing] = useState<Partial<Company> | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const allStates = useMemo(() => {
    return Array.from(new Set(companies.map((c) => c.state).filter((s): s is string => !!s))).sort();
  }, [companies]);

  function load(q?: string) {
    api.companies.list(q).then(setCompanies).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [companies, stateFilter]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    load(query);
  }

  async function save() {
    if (!editing || saving) return;
    setError('');
    setSaving(true);
    try {
      if (editing.id) {
        await api.companies.update(editing.id, editing);
      } else {
        await api.companies.create(editing);
      }
      setEditing(null);
      load(query);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredCompanies = useMemo(
    () => (stateFilter ? companies.filter((c) => c.state === stateFilter) : companies),
    [companies, stateFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedCompanies = useMemo(
    () => filteredCompanies.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredCompanies, currentPage]
  );

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const isAllCurrentPageSelected =
    pagedCompanies.length > 0 && pagedCompanies.every((c) => selectedIds.includes(c.id));

  const toggleSelectAll = () => {
    if (isAllCurrentPageSelected) {
      const pageIds = new Set(pagedCompanies.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
    } else {
      const newIds = new Set([...selectedIds, ...pagedCompanies.map((c) => c.id)]);
      setSelectedIds(Array.from(newIds));
    }
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds(filteredCompanies.map((c) => c.id));
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || isBulkDeleting) return;
    const confirmMsg = `Are you sure you want to delete ${selectedIds.length} selected company account(s)?`;
    if (!window.confirm(confirmMsg)) return;

    setIsBulkDeleting(true);
    setFeedback(null);
    setError('');

    try {
      const res = await api.companies.bulkDelete(selectedIds);
      if (res.blockedCount && res.blockedCount > 0) {
        setFeedback({
          type: 'warning',
          message: res.message || `Deleted ${res.deletedCount} companies. ${res.blockedCount} could not be deleted because they have associated records.`,
        });
      } else {
        setFeedback({
          type: 'success',
          message: res.message || `Successfully deleted ${res.deletedCount} companies.`,
        });
      }
      setSelectedIds([]);
      setIsSelectionMode(false);
      load(query);
    } catch (err: any) {
      console.error('Failed to bulk delete companies:', err);
      setError(err.message || 'Failed to bulk delete companies.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  async function remove(id: number, name?: string) {
    if (deletingId !== null) return;
    if (!window.confirm(`Are you sure you want to delete "${name || 'this company'}"?`)) return;
    setError('');
    setFeedback(null);
    setDeletingId(id);
    try {
      await api.companies.delete(id);
      setFeedback({ type: 'success', message: `Company "${name || id}" was deleted successfully.` });
      load(query);
    } catch (e: any) {
      setError(e.message || 'Failed to delete company.');
    } finally {
      setDeletingId(null);
    }
  }

  const getInitials = (name: string) => {
    if (!name) return 'CO';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      {/* Header Bar */}
      <div className="ts-phead !mb-2 justify-between">
        <div className="flex flex-col gap-1.5">
          <h1>
            Companies
          </h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">
            {companies.length} customer records and organizational accounts.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Select to Delete / Bulk Delete Controls */}
          {isSelectionMode ? (
            <>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0 || isBulkDeleting}
                className="ts-btn ts-danger ts-xs"
              >
                {isBulkDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isBulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.length})`}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedIds([]);
                }}
                disabled={isBulkDeleting}
                className="ts-btn ts-ghost ts-xs"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsSelectionMode(true)}
              className="ts-btn ts-ghost ts-xs text-bad"
              title="Select Companies to Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Select to Delete</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setEditing({ ...empty });
              setIsSelectionMode(false);
            }}
            className="ts-btn ts-ghost ts-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Company</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-[10px] border text-[12.5px] flex items-center justify-between transition-all ${
            feedback.type === 'success'
              ? 'border-goodbg bg-goodbg text-good'
              : feedback.type === 'warning'
              ? 'border-warnbg bg-warnbg text-warn'
              : 'border-badbg bg-badbg text-bad'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold px-1.5 py-0.5 hover:opacity-70 cursor-pointer ml-2"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="ts-warnbox">
          {error}
        </div>
      )}

      {/* Edit / New Modal Card */}
      {editing && (
        <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium">
            {editing.id ? 'Edit Company' : 'New Company'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              NAME
              <input
                value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              STATE
              <input
                value={editing.state || ''}
                onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider md:col-span-2">
              ADDRESS
              <input
                value={editing.address || ''}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              GSTIN
              <input
                value={editing.gstin || ''}
                onChange={(e) => setEditing({ ...editing, gstin: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              CONTACT PERSON
              <input
                value={editing.contact_person || ''}
                onChange={(e) => setEditing({ ...editing, contact_person: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              PHONE
              <input
                value={editing.phone || ''}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-faint uppercase tracking-wider">
              EMAIL
              <input
                value={editing.email || ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="ts-fi ts-sel"
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              disabled={saving}
              className="ts-btn ts-ghost ts-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ts-btn ts-dark ts-xs"
            >
              {saving ? 'Saving...' : 'Save Company'}
            </button>
          </div>
        </section>
      )}

      {/* Main Table Container Card */}
      <section className="ts-card ts-white ts-tbl flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 ts-tbar">
          <div className="flex items-center gap-2 flex-wrap">
            <ExpandableSearch
              value={query}
              onChange={setQuery}
              onSubmit={() => load(query)}
              placeholder="Search by company name..."
              ariaLabel="Search companies"
              maxWidth="280px"
            />
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="ts-fi ts-sel"
            >
              <option value="">All States</option>
              {allStates.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {stateFilter && (
              <button
                type="button"
                onClick={() => setStateFilter('')}
                className="ts-btn ts-ghost ts-xs"
              >
                Clear
              </button>
            )}
            <span className="ts-showing ts-muted">
              Showing {filteredCompanies.length} of {companies.length}
            </span>
          </div>
        </div>

        {/* Selection Info Bar when Selection Mode is Active */}
        {isSelectionMode && (
          <div className="flex items-center justify-between p-2.5 px-3.5 bg-badbg border border-badbg rounded-xl text-xs text-bad animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="font-bold">
                {selectedIds.length} of {filteredCompanies.length} company account(s) selected
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-xs font-semibold underline hover:text-bad cursor-pointer"
              >
                Select All {filteredCompanies.length}
              </button>
              {selectedIds.length > 0 && (
                <>
                  <span className="text-bad/40">•</span>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-xs font-semibold underline hover:text-bad cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Companies Table */}
        <div className="ts-tblwrap">
          <table>
            <thead>
              <tr>
                {isSelectionMode && (
                  <th className="w-12 p-[8px_10px] text-center">
                    <input
                      type="checkbox"
                      checked={isAllCurrentPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-line2 text-bad focus:ring-bad accent-bad cursor-pointer"
                      title="Select all on this page"
                    />
                  </th>
                )}
                <th>
                  Company
                </th>
                <th>
                  State
                </th>
                <th>
                  Gstin
                </th>
                <th>
                  Contact
                </th>
                <th className="ts-r">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedCompanies.map((c) => {
                const isSelected = selectedIds.includes(c.id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => {
                      if (isSelectionMode) toggleSelectRow(c.id);
                    }}
                    className={`border-b transition-colors ${
                      isSelected
                        ? 'bg-badbg border-badbg'
                        : 'border-line hover:bg-surface'
                    } ${isSelectionMode ? 'cursor-pointer' : ''}`}
                  >
                    {isSelectionMode && (
                      <td className="p-[11px_10px] text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(c.id)}
                          className="w-4 h-4 rounded border-line2 text-bad focus:ring-bad accent-bad cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="p-[11px_10px]">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-[8px] bg-surface border border-line2 text-fg grid place-items-center text-[11px] font-bold shrink-0">
                          {getInitials(c.name)}
                        </span>
                        <span className="font-medium text-fg">{c.name}</span>
                      </div>
                    </td>
                    <td className="p-[11px_10px] text-subtle">{c.state || '—'}</td>
                    <td className="p-[11px_10px] text-subtle font-mono text-[11.5px]">{c.gstin || '—'}</td>
                    <td className="p-[11px_10px] text-subtle">{c.phone || c.email || '—'}</td>
                    <td className="p-[11px_10px] text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/companies/${c.id}/health`}
                          className="text-[12px] text-fg hover:underline font-medium"
                        >
                          Health
                        </Link>
                        <button
                          type="button"
                          onClick={() => setEditing(c)}
                          disabled={deletingId === c.id}
                          className="text-[12px] text-subtle hover:text-fg cursor-pointer"
                        >
                          Edit
                        </button>
                        {user?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => remove(c.id, c.name)}
                            disabled={deletingId === c.id}
                            className="text-[12px] text-bad hover:underline cursor-pointer"
                          >
                            {deletingId === c.id ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredCompanies.length === 0 && (
                <tr>
                  <td colSpan={isSelectionMode ? 6 : 5} className="ts-empty">
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pagination Footer */}
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
