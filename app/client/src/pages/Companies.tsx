import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Company } from '../api';
import { useAuth } from '../auth';
import { Pagination } from '../components/Pagination';
import { ExpandableSearch } from '../components/ExpandableSearch';

const empty: Partial<Company> = { name: '', address: '', state: '', gstin: '', contact_person: '', phone: '', email: '' };
const PAGE_SIZE = 20;

export default function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allStates, setAllStates] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [editing, setEditing] = useState<Partial<Company> | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load(q?: string) {
    api.companies.list(q).then(setCompanies).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    api.companies.list().then((all) => {
      const states = Array.from(new Set(all.map((c) => c.state).filter((s): s is string => !!s))).sort();
      setAllStates(states);
    });
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

  async function remove(id: number) {
    if (deletingId !== null) return;
    setError('');
    setDeletingId(id);
    try {
      await api.admin.deleteCompany(id);
      load(query);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
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
        <button
          type="button"
          onClick={() => setEditing({ ...empty })}
          className="h-[34px] px-3.5 rounded-[9px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-medium text-[12.5px] cursor-pointer hover:bg-[#E3EAF7] transition-colors"
        >
          + Add Company
        </button>
      </div>

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

        {/* Companies Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F9]">
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
              {pagedCompanies.map((c) => (
                <tr key={c.id} className="border-b border-[#F7F8FC] hover:bg-[#F7F8FC] transition-colors">
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
                  <td className="p-[11px_10px] text-right">
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
                          onClick={() => remove(c.id)}
                          disabled={deletingId === c.id}
                          className="text-[12px] text-[#E5484D] hover:underline cursor-pointer"
                        >
                          {deletingId === c.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCompanies.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-[#7A839E] text-[13px]">
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
