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
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Companies
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
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
                className="h-[34px] px-3.5 rounded-[9px] bg-[#E5484D] hover:bg-[#D13438] disabled:opacity-50 text-[#FFFFFF] text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
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
                className="h-[34px] px-3 rounded-[9px] bg-[#F4F6FC] hover:bg-[#E4E8F2] text-[#7A839E] border border-[#E4E8F2] text-[12.5px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsSelectionMode(true)}
              className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#E5484D] hover:bg-[#F4F6FC] hover:border-[#D4DAEA] text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
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
            className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-semibold text-[12.5px] inline-flex items-center gap-1.5 cursor-pointer hover:bg-[#E3EAF7] transition-colors"
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
              ? 'border-[#D6F2E4] bg-[#E0F5EB] text-[#2FBF71]'
              : feedback.type === 'warning'
              ? 'border-[#F6ECDC] bg-[#FFF8EB] text-[#D97706]'
              : 'border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D]'
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
        <div className="p-3 rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] text-[#E5484D] text-[12.5px]">
          {error}
        </div>
      )}

      {/* Edit / New Modal Card */}
      {editing && (
        <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
          <h3 className="margin-0 text-[18px] font-medium">
            {editing.id ? 'Edit Company' : 'New Company'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              NAME
              <input
                value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              STATE
              <input
                value={editing.state || ''}
                onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider md:col-span-2">
              ADDRESS
              <input
                value={editing.address || ''}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              GSTIN
              <input
                value={editing.gstin || ''}
                onChange={(e) => setEditing({ ...editing, gstin: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              CONTACT PERSON
              <input
                value={editing.contact_person || ''}
                onChange={(e) => setEditing({ ...editing, contact_person: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              PHONE
              <input
                value={editing.phone || ''}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#A8AEC4] uppercase tracking-wider">
              EMAIL
              <input
                value={editing.email || ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="h-[36px] px-3 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none"
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              disabled={saving}
              className="h-[34px] px-4 rounded-[9px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#7A839E] text-[12.5px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-[34px] px-4 rounded-[9px] bg-[#3B6FD4] text-[#F4F6FC] font-bold text-[12.5px] cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Company'}
            </button>
          </div>
        </section>
      )}

      {/* Main Table Container Card */}
      <section className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-[16px_18px_12px] flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 border-b border-[#EEF1F9] pb-3.5">
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
              className="h-[30px] px-2 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[12px] outline-none cursor-pointer"
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
                className="h-[30px] px-2.5 rounded-[8px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#7A839E] text-[12px] cursor-pointer"
              >
                Clear
              </button>
            )}
            <span className="text-[11.5px] text-[#A8AEC4]">
              Showing {filteredCompanies.length} of {companies.length}
            </span>
          </div>
        </div>

        {/* Selection Info Bar when Selection Mode is Active */}
        {isSelectionMode && (
          <div className="flex items-center justify-between p-2.5 px-3.5 bg-[#FFF5F5] border border-[#F4D4D5] rounded-xl text-xs text-[#E5484D] animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="font-bold">
                {selectedIds.length} of {filteredCompanies.length} company account(s) selected
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-xs font-semibold underline hover:text-[#D13438] cursor-pointer"
              >
                Select All {filteredCompanies.length}
              </button>
              {selectedIds.length > 0 && (
                <>
                  <span className="text-[#E5484D]/40">•</span>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-xs font-semibold underline hover:text-[#D13438] cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Companies Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F9]">
                {isSelectionMode && (
                  <th className="w-12 p-[8px_10px] text-center">
                    <input
                      type="checkbox"
                      checked={isAllCurrentPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-[#CBD5E1] text-[#E5484D] focus:ring-[#E5484D] accent-[#E5484D] cursor-pointer"
                      title="Select all on this page"
                    />
                  </th>
                )}
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  COMPANY
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  STATE
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  GSTIN
                </th>
                <th className="text-left p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  CONTACT
                </th>
                <th className="text-right p-[8px_10px] font-normal text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
                  ACTIONS
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
                        ? 'bg-[#FEF2F2] border-[#FCE2E2]'
                        : 'border-[#F7F8FC] hover:bg-[#F7F8FC]'
                    } ${isSelectionMode ? 'cursor-pointer' : ''}`}
                  >
                    {isSelectionMode && (
                      <td className="p-[11px_10px] text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(c.id)}
                          className="w-4 h-4 rounded border-[#CBD5E1] text-[#E5484D] focus:ring-[#E5484D] accent-[#E5484D] cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="p-[11px_10px]">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-[8px] bg-[#F7F8FC] border border-[#DCE2F0] text-[#3B6FD4] grid place-items-center text-[11px] font-bold shrink-0">
                          {getInitials(c.name)}
                        </span>
                        <span className="font-medium text-[#141B34]">{c.name}</span>
                      </div>
                    </td>
                    <td className="p-[11px_10px] text-[#7A839E]">{c.state || '—'}</td>
                    <td className="p-[11px_10px] text-[#7A839E] font-mono text-[11.5px]">{c.gstin || '—'}</td>
                    <td className="p-[11px_10px] text-[#7A839E]">{c.phone || c.email || '—'}</td>
                    <td className="p-[11px_10px] text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/companies/${c.id}/health`}
                          className="text-[12px] text-[#3B6FD4] hover:underline font-medium"
                        >
                          Health
                        </Link>
                        <button
                          type="button"
                          onClick={() => setEditing(c)}
                          disabled={deletingId === c.id}
                          className="text-[12px] text-[#7A839E] hover:text-[#141B34] cursor-pointer"
                        >
                          Edit
                        </button>
                        {user?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => remove(c.id, c.name)}
                            disabled={deletingId === c.id}
                            className="text-[12px] text-[#E5484D] hover:underline cursor-pointer"
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
                  <td colSpan={isSelectionMode ? 6 : 5} className="text-center py-8 text-[#7A839E] text-[13px]">
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
