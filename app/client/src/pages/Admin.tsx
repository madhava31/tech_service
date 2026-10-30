import { useEffect, useState } from 'react';
import { api, AdminUser } from '../api';
import { useAuth } from '../auth';
import AccountSettings from '../components/AccountSettings';

type Tab = 'users' | 'data' | 'config' | 'account';

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
    <div className="ts-page-pad flex flex-col gap-4 pb-6 min-w-0">
      {/* Page Header & Navigation Tabs */}
      <div className="ts-phead !mb-2 justify-between">
        <div>
          <h1 className="ts-title">System Administration</h1>
          <p className="ts-muted m-0 mt-1.5 text-[14px]">Manage platform accounts, database backups, data imports, and system rules.</p>
        </div>

        {/* Tab Buttons */}
        <div className="ts-tabs self-start sm:self-auto">
          <button
            onClick={() => setTab('users')}
            className={`ts-tab ${tab === 'users' ? 'ts-on' : ''}`}
          >
            User Accounts
          </button>
          <button
            onClick={() => setTab('data')}
            className={`ts-tab ${tab === 'data' ? 'ts-on' : ''}`}
          >
            Data & Backups
          </button>
          <button
            onClick={() => setTab('config')}
            className={`ts-tab ${tab === 'config' ? 'ts-on' : ''}`}
          >
            Configuration
          </button>
          <button
            onClick={() => setTab('account')}
            className={`ts-tab ${tab === 'account' ? 'ts-on' : ''}`}
          >
            Account Settings
          </button>
        </div>
      </div>

      {error && (
        <div className="ts-warnbox">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="ts-okbox flex items-center gap-2">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>{notice}</span>
        </div>
      )}

      {tab === 'account' && <AccountSettings />}

      {/* TAB 1: USERS */}
      {tab === 'users' && (
        <div className="space-y-6">
          {/* Add User Form Card */}
          <div className="ts-card ts-white ts-tbl">
            <h2 className="m-0 text-[15px] font-medium text-fg mb-4 pb-3 border-dashed border-line2 flex items-center gap-2 border-b">
              <svg className="w-5 h-5 text-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              <span>Add New User Account</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div>
                <label className="ts-lbl">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. john_doe"
                  className="ts-fi"
                />
              </div>

              <div>
                <label className="ts-lbl">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="ts-fi"
                />
              </div>

              <div>
                <label className="ts-lbl">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="ts-fi"
                >
                  <option value="staff">Staff (Standard)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <button
                  onClick={createUser}
                  disabled={creatingUser || !newUsername || !newPassword}
                  className="ts-btn ts-dark w-full justify-center"
                >
                  {creatingUser ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>

          {/* User Table */}
          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="flex justify-between items-center gap-3 pb-1">
              <h3 className="m-0 text-[15px] font-medium text-fg">Registered Platform Users</h3>
              <span className="ts-headtag">
                {users.length} Active Accounts
              </span>
            </div>

            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Created Date</th>
                    <th className="ts-r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface border border-line2 flex items-center justify-center text-fg font-medium text-[13px]">
                          {u.username.substring(0, 2)}
                        </div>
                        <span>{u.username}</span>
                      </td>
                      <td>
                        <span
                          className={`ts-st ${u.role === 'admin' ? 'ts-tone-good' : ''}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="text-subtle num">{u.created_at}</td>
                      <td className="ts-r gap-2">
                        <button
                          disabled={userActionId === u.id}
                          onClick={() => { setResetTarget(u.id); setResetPassword(''); }}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          Reset Password
                        </button>

                        {u.id !== user?.id && (
                          <button
                            disabled={userActionId === u.id}
                            onClick={() => deleteUser(u.id)}
                            className="ts-btn ts-ghost ts-xs !text-bad"
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
            <div className="bg-surface2 border border-fg/50 rounded-xl p-6 shadow-card">
              <h3 className="m-0 text-[15px] font-medium text-fg mb-3">Reset Password for User #{resetTarget}</h3>
              <div className="flex items-center gap-3 max-w-md">
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="ts-fi flex-1"
                />
                <button
                  onClick={() => submitResetPassword(resetTarget)}
                  disabled={resettingPassword || !resetPassword}
                  className="ts-btn ts-dark ts-xs"
                >
                  {resettingPassword ? 'Saving...' : 'Confirm Reset'}
                </button>
                <button
                  onClick={() => setResetTarget(null)}
                  className="ts-btn ts-ghost ts-xs"
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
                <div key={table} className="ts-card">
                  <div className="text-[13px] font-medium text-subtle truncate">
                    {table.replace(/_/g, ' ')}
                  </div>
                  <div className="ts-val num block text-fg">
                    {count.toLocaleString()}
                  </div>
                </div>
              ))}
              <div className="ts-card">
                <div className="text-[13px] font-medium text-subtle">
                  Database Size
                </div>
                <div className="ts-val num block text-fg">
                  {formatBytes(stats.dbSizeBytes)}
                </div>
              </div>
            </div>
          )}

          {/* Import Batches */}
          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="p-6 border-b border-line2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="m-0 text-[15px] font-medium text-fg">Excel Import Batches</h3>
                <p className="ts-muted m-0 mt-1.5 text-[14px]">Historical sales imports logged in database</p>
              </div>
              <a
                href={api.admin.backupUrl()}
                className="ts-btn ts-ghost ts-xs"
              >
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download SQL Database Backup
              </a>
            </div>

            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Financial Year</th>
                    <th>Imported At</th>
                    <th className="ts-r">Rows</th>
                    <th className="ts-r">Processed</th>
                    <th className="ts-r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {importBatches.map((b) => (
                    <tr key={b.id}>
                      <td className="num">{b.filename}</td>
                      <td className="text-subtle">{b.year_label || '-'}</td>
                      <td className="text-subtle num">{b.imported_at}</td>
                      <td className="ts-r tabular-nums">{b.row_count}</td>
                      <td className="ts-r tabular-nums text-fg">{b.imported_count}</td>
                      <td className="ts-r">
                        <button
                          onClick={() => deleteImportBatch(b.id)}
                          className="ts-btn ts-ghost ts-xs !text-bad"
                        >
                          Delete Batch
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-faint">
                        No import batches found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Review Queue */}
          <div className="ts-card ts-white ts-tbl overflow-hidden">
            <div className="pb-4">
              <h3 className="m-0 text-[15px] font-medium text-fg">Data Review Queue</h3>
              <p className="ts-muted m-0 mt-1.5 text-[14px]">
                Rows flagged for missing, ambiguous, or unmapped data during excel ingestion.
              </p>
            </div>

            <div className="ts-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Sale Date</th>
                    <th>Company</th>
                    <th>Product Description</th>
                    <th>Flag Reason</th>
                    <th className="ts-r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((r) => (
                    <tr key={r.id}>
                      <td className="num text-subtle">{r.sale_date || '-'}</td>
                      <td>{r.company_name || '-'}</td>
                      <td className="text-subtle">{r.product_description || '-'}</td>
                      <td className="text-warn font-medium">{r.review_reason}</td>
                      <td className="ts-r gap-2">
                        <button
                          onClick={() => dismissReview(r.id)}
                          className="ts-btn ts-ghost ts-xs"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => deleteReview(r.id)}
                          className="ts-btn ts-ghost ts-xs !text-bad"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {reviewRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-faint">
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
        <div className="ts-card ts-white ts-tbl max-w-2xl">
          <h2 className="m-0 text-[15px] font-medium text-fg mb-4 pb-3 border-dashed border-line2 flex items-center gap-2 border-b">
            <svg className="w-5 h-5 text-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Global System Defaults</span>
          </h2>

          <div className="space-y-4">
            <div>
              <label className="ts-lbl">
                Default Quotation Tax Rate (%)
              </label>
              <input
                type="number"
                value={taxPercent}
                onChange={(e) => setTaxPercent(Number(e.target.value))}
                className="ts-fi"
              />
              <p className="text-[13px] text-faint mt-1">Default GST tax percentage applied to newly generated quotations.</p>
            </div>

            <div>
              <label className="ts-lbl">
                Lapsed-Purchases Window (Months)
              </label>
              <input
                type="number"
                value={lapseMonths}
                onChange={(e) => setLapseMonths(Number(e.target.value))}
                className="ts-fi"
              />
              <p className="text-[13px] text-faint mt-1">Inactivity timeframe used to flag customers under At Risk / Inactive health states.</p>
            </div>

            <div className="pt-2">
              <button
                onClick={saveConfig}
                disabled={savingConfig}
                className="ts-btn ts-dark"
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

