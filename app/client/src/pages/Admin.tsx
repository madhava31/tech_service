import { useEffect, useState } from 'react';
import { api, AdminUser } from '../api';
import { useAuth } from '../auth';

type Tab = 'users' | 'data' | 'config';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [resetTarget, setResetTarget] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userActionId, setUserActionId] = useState<number | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Data
  const [importBatches, setImportBatches] = useState<any[]>([]);
  const [reviewRows, setReviewRows] = useState<any[]>([]);
  const [stats, setStats] = useState<{ counts: Record<string, number>; dbSizeBytes: number } | null>(null);

  // Config
  const [taxPercent, setTaxPercent] = useState(18);
  const [lapseMonths, setLapseMonths] = useState(12);
  const [savingConfig, setSavingConfig] = useState(false);

  function loadUsers() {
    api.admin.listUsers().then(setUsers).catch((e) => setError(e.message));
  }

  function loadData() {
    api.imports.list().then(setImportBatches).catch((e) => setError(e.message));
    api.reports.reviewQueue().then(setReviewRows).catch((e) => setError(e.message));
    api.admin.stats().then(setStats).catch((e) => setError(e.message));
  }

  function loadConfig() {
    api.admin.getConfig().then((c) => {
      setTaxPercent(c.default_tax_percent);
      setLapseMonths(c.default_lapse_months);
    }).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (tab === 'users') loadUsers();
    else if (tab === 'data') loadData();
    else if (tab === 'config') loadConfig();
  }, [tab]);

  async function createUser() {
    if (creatingUser) return;
    setError('');
    setCreatingUser(true);
    try {
      await api.admin.createUser({ username: newUsername, password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setNewRole('staff');
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingUser(false);
    }
  }

  async function deleteUser(id: number) {
    if (userActionId !== null) return;
    setError('');
    setUserActionId(id);
    try {
      await api.admin.deleteUser(id);
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUserActionId(null);
    }
  }

  async function submitResetPassword(id: number) {
    if (resettingPassword) return;
    setError('');
    setResettingPassword(true);
    try {
      await api.admin.resetPassword(id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
      setNotice('Password updated.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResettingPassword(false);
    }
  }

  async function deleteImportBatch(id: number) {
    setError('');
    try {
      await api.admin.deleteImport(id);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function dismissReview(id: number) {
    setError('');
    try {
      await api.admin.dismissReview(id);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteReview(id: number) {
    setError('');
    try {
      await api.admin.deleteReview(id);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveConfig() {
    setError('');
    setSavingConfig(true);
    try {
      await api.admin.updateConfig({ default_tax_percent: taxPercent, default_lapse_months: lapseMonths });
      setNotice('Configuration saved.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingConfig(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header & Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E8F2]">
        <div>
          <h1 className="text-2xl font-bold text-[#141B34] tracking-tight">System Administration</h1>
          <p className="text-sm text-[#7A839E] mt-1">Manage platform accounts, database backups, data imports, and system rules.</p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center space-x-1 bg-[#FFFFFF] p-1 border border-[#E4E8F2] rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
              tab === 'users' ? 'bg-[#3B6FD4] text-[#F4F6FC]' : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F7F8FC]'
            }`}
          >
            User Accounts
          </button>
          <button
            onClick={() => setTab('data')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
              tab === 'data' ? 'bg-[#3B6FD4] text-[#F4F6FC]' : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F7F8FC]'
            }`}
          >
            Data & Backups
          </button>
          <button
            onClick={() => setTab('config')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
              tab === 'config' ? 'bg-[#3B6FD4] text-[#F4F6FC]' : 'text-[#7A839E] hover:text-[#141B34] hover:bg-[#F7F8FC]'
            }`}
          >
            Configuration
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[#E5484D]/10 border border-[#E5484D]/30 rounded-xl text-[#E5484D] text-sm flex items-center space-x-2">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-4 bg-[#3B6FD4]/10 border border-[#3B6FD4]/30 rounded-xl text-[#3B6FD4] text-sm flex items-center space-x-2">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: USERS */}
      {tab === 'users' && (
        <div className="space-y-6">
          {/* Add User Form Card */}
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[#141B34] mb-4 pb-3 border-b border-[#E4E8F2] flex items-center space-x-2">
              <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              <span>Add New User Account</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. john_doe"
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors cursor-pointer"
                >
                  <option value="staff">Staff (Standard)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <button
                  onClick={createUser}
                  disabled={creatingUser || !newUsername || !newPassword}
                  className="w-full px-4 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
                >
                  {creatingUser ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>

          {/* User Table */}
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden shadow-card">
            <div className="px-6 py-4 border-b border-[#E4E8F2] flex justify-between items-center">
              <h3 className="text-base font-semibold text-[#141B34]">Registered Platform Users</h3>
              <span className="text-xs text-[#7A839E] bg-[#F4F6FC] px-3 py-1 rounded-full border border-[#E4E8F2]">
                {users.length} Active Accounts
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F4F6FC] text-[#7A839E] text-xs uppercase font-semibold border-b border-[#E4E8F2]">
                    <th className="px-6 py-3.5">User</th>
                    <th className="px-6 py-3.5">Role</th>
                    <th className="px-6 py-3.5">Created Date</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E8F2] text-sm text-[#141B34]">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-[#F7F8FC]/50 transition-colors">
                      <td className="px-6 py-4 font-semibold flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-[#F7F8FC] border border-[#E4E8F2] flex items-center justify-center text-[#3B6FD4] font-bold text-xs uppercase">
                          {u.username.substring(0, 2)}
                        </div>
                        <span>{u.username}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            u.role === 'admin'
                              ? 'bg-[#3B6FD4]/10 text-[#3B6FD4] border border-[#3B6FD4]/30'
                              : 'bg-[#6B78D6]/10 text-[#6B78D6] border border-[#6B78D6]/30'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[#7A839E] text-xs font-mono">{u.created_at}</td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          disabled={userActionId === u.id}
                          onClick={() => { setResetTarget(u.id); setResetPassword(''); }}
                          className="px-3 py-1.5 bg-[#F7F8FC] hover:bg-[#E4E8F2] text-[#141B34] text-xs font-medium rounded-lg border border-[#E4E8F2] transition-colors"
                        >
                          Reset Password
                        </button>

                        {u.id !== user?.id && (
                          <button
                            disabled={userActionId === u.id}
                            onClick={() => deleteUser(u.id)}
                            className="px-3 py-1.5 bg-[#E5484D]/10 hover:bg-[#E5484D]/20 text-[#E5484D] border border-[#E5484D]/30 text-xs font-medium rounded-lg transition-colors"
                          >
                            {userActionId === u.id ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reset Password Modal / Card */}
          {resetTarget != null && (
            <div className="bg-[#FFFFFF] border border-[#3B6FD4]/50 rounded-xl p-6 shadow-card">
              <h3 className="text-base font-semibold text-[#141B34] mb-3">Reset Password for User #{resetTarget}</h3>
              <div className="flex items-center space-x-3 max-w-md">
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="flex-1 bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4]"
                />
                <button
                  onClick={() => submitResetPassword(resetTarget)}
                  disabled={resettingPassword || !resetPassword}
                  className="px-4 py-2 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold text-xs rounded-lg transition-colors"
                >
                  {resettingPassword ? 'Saving...' : 'Confirm Reset'}
                </button>
                <button
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 bg-[#F7F8FC] text-[#7A839E] hover:text-[#141B34] font-semibold text-xs rounded-lg border border-[#E4E8F2]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DATA & BACKUPS */}
      {tab === 'data' && (
        <div className="space-y-6">
          {/* Stats Cards Grid */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Object.entries(stats.counts).map(([table, count]) => (
                <div key={table} className="bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl">
                  <div className="text-xs uppercase font-semibold text-[#7A839E] tracking-wider truncate">
                    {table.replace(/_/g, ' ')}
                  </div>
                  <div className="text-2xl font-bold text-[#141B34] mt-1 tabular-nums">
                    {count.toLocaleString()}
                  </div>
                </div>
              ))}
              <div className="bg-[#FFFFFF] border border-[#E4E8F2] p-4 rounded-xl">
                <div className="text-xs uppercase font-semibold text-[#7A839E] tracking-wider">
                  Database Size
                </div>
                <div className="text-2xl font-bold text-[#3B6FD4] mt-1 tabular-nums">
                  {formatBytes(stats.dbSizeBytes)}
                </div>
              </div>
            </div>
          )}

          {/* Import Batches */}
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden">
            <div className="p-6 border-b border-[#E4E8F2] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[#141B34]">Excel Import Batches</h3>
                <p className="text-xs text-[#7A839E] mt-0.5">Historical sales imports logged in database</p>
              </div>
              <a
                href={api.admin.backupUrl()}
                className="inline-flex items-center px-4 py-2 bg-[#F7F8FC] hover:bg-[#E4E8F2] text-[#3B6FD4] border border-[#E4E8F2] font-semibold rounded-lg text-xs transition-colors self-start sm:self-auto"
              >
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download SQL Database Backup
              </a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F4F6FC] text-[#7A839E] text-xs uppercase font-semibold border-b border-[#E4E8F2]">
                    <th className="px-6 py-3.5">Filename</th>
                    <th className="px-6 py-3.5">Financial Year</th>
                    <th className="px-6 py-3.5">Imported At</th>
                    <th className="px-6 py-3.5 text-right">Rows</th>
                    <th className="px-6 py-3.5 text-right">Processed</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E8F2] text-sm text-[#141B34]">
                  {importBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-[#F7F8FC]/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs">{b.filename}</td>
                      <td className="px-6 py-4 text-[#7A839E] text-xs">{b.year_label || '-'}</td>
                      <td className="px-6 py-4 text-[#7A839E] text-xs font-mono">{b.imported_at}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{b.row_count}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-[#3B6FD4]">{b.imported_count}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteImportBatch(b.id)}
                          className="px-3 py-1 bg-[#E5484D]/10 hover:bg-[#E5484D]/20 text-[#E5484D] border border-[#E5484D]/30 text-xs rounded-lg transition-colors"
                        >
                          Delete Batch
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-[#A8AEC4]">
                        No import batches found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Review Queue */}
          <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl overflow-hidden">
            <div className="p-6 border-b border-[#E4E8F2]">
              <h3 className="text-base font-semibold text-[#141B34]">Data Review Queue</h3>
              <p className="text-xs text-[#7A839E] mt-0.5">
                Rows flagged for missing, ambiguous, or unmapped data during excel ingestion.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F4F6FC] text-[#7A839E] text-xs uppercase font-semibold border-b border-[#E4E8F2]">
                    <th className="px-6 py-3.5">Sale Date</th>
                    <th className="px-6 py-3.5">Company</th>
                    <th className="px-6 py-3.5">Product Description</th>
                    <th className="px-6 py-3.5">Flag Reason</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E8F2] text-sm text-[#141B34]">
                  {reviewRows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#F7F8FC]/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-[#7A839E]">{r.sale_date || '-'}</td>
                      <td className="px-6 py-4 font-semibold">{r.company_name || '-'}</td>
                      <td className="px-6 py-4 text-[#7A839E] text-xs">{r.product_description || '-'}</td>
                      <td className="px-6 py-4 text-[#E8A33D] text-xs font-medium">{r.review_reason}</td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => dismissReview(r.id)}
                          className="px-3 py-1 bg-[#F7F8FC] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] text-xs rounded-lg transition-colors"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => deleteReview(r.id)}
                          className="px-3 py-1 bg-[#E5484D]/10 hover:bg-[#E5484D]/20 text-[#E5484D] border border-[#E5484D]/30 text-xs rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {reviewRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-[#A8AEC4]">
                        Review queue is empty. All data is clean!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CONFIGURATION */}
      {tab === 'config' && (
        <div className="bg-[#FFFFFF] border border-[#E4E8F2] rounded-xl p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-[#141B34] mb-4 pb-3 border-b border-[#E4E8F2] flex items-center space-x-2">
            <svg className="w-5 h-5 text-[#3B6FD4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Global System Defaults</span>
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">
                Default Quotation Tax Rate (%)
              </label>
              <input
                type="number"
                value={taxPercent}
                onChange={(e) => setTaxPercent(Number(e.target.value))}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
              <p className="text-xs text-[#A8AEC4] mt-1">Default GST tax percentage applied to newly generated quotations.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A839E] mb-1.5">
                Lapsed-Purchases Window (Months)
              </label>
              <input
                type="number"
                value={lapseMonths}
                onChange={(e) => setLapseMonths(Number(e.target.value))}
                className="w-full bg-[#F4F6FC] border border-[#E4E8F2] rounded-lg px-3.5 py-2.5 text-sm text-[#141B34] focus:outline-none focus:border-[#3B6FD4] transition-colors"
              />
              <p className="text-xs text-[#A8AEC4] mt-1">Inactivity timeframe used to flag customers under At Risk / Inactive health states.</p>
            </div>

            <div className="pt-2">
              <button
                onClick={saveConfig}
                disabled={savingConfig}
                className="px-5 py-2.5 bg-[#3B6FD4] hover:bg-[#2F5CB8] text-[#F4F6FC] font-semibold rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                {savingConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

