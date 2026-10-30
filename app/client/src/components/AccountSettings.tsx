import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

// Mirrors the server rules in api/_lib/routes/auth.js (the server re-validates everything).
const USERNAME_RULE = /^[A-Za-z0-9._@-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

type Message = { type: 'ok' | 'error'; text: string } | null;

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col">
      <span className="ts-lbl">{label}</span>
      <span className="relative flex items-center">
        <input
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className="ts-fi !pr-[72px]"
        />
        <button type="button" onClick={() => setShow(!show)} className="ts-btn ts-ghost ts-xs absolute right-[6px]">
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return <div className={message.type === 'ok' ? 'ts-okbox' : 'ts-warnbox'} role="status"><span>{message.text}</span></div>;
}

export default function AccountSettings() {
  const { user, refresh } = useAuth();

  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<Message>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<Message>(null);

  function cancelUsername() {
    setNewUsername('');
    setUsernamePassword('');
    setUsernameMsg(null);
  }

  function cancelPassword() {
    setCurrentPassword('');
    setNextPassword('');
    setConfirmPassword('');
    setPasswordMsg(null);
  }

  async function saveUsername() {
    if (savingUsername) return;
    const name = newUsername.trim();
    if (!USERNAME_RULE.test(name)) {
      return setUsernameMsg({ type: 'error', text: 'Username must be 3-32 characters: letters, digits, dot, underscore, hyphen or @.' });
    }
    if (name === user?.username) return setUsernameMsg({ type: 'error', text: 'That is already your username.' });
    if (!usernamePassword) return setUsernameMsg({ type: 'error', text: 'Enter your current password to confirm the change.' });
    setSavingUsername(true);
    setUsernameMsg(null);
    try {
      const res = await api.auth.changeUsername(name, usernamePassword);
      await refresh();
      cancelUsername();
      setUsernameMsg({ type: 'ok', text: `Username changed to "${res.user.username}". Use it the next time you sign in.` });
    } catch (e: any) {
      setUsernameMsg({ type: 'error', text: e.message || 'Unable to change the username.' });
    } finally {
      setSavingUsername(false);
    }
  }

  async function savePassword() {
    if (savingPassword) return;
    if (!currentPassword) return setPasswordMsg({ type: 'error', text: 'Enter your current password.' });
    if (nextPassword.length < PASSWORD_MIN || nextPassword.length > PASSWORD_MAX) {
      return setPasswordMsg({ type: 'error', text: `New password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` });
    }
    if (nextPassword !== confirmPassword) return setPasswordMsg({ type: 'error', text: 'New password and confirmation do not match.' });
    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      await api.auth.changePassword(currentPassword, nextPassword, confirmPassword);
      cancelPassword();
      setPasswordMsg({ type: 'ok', text: 'Password changed. You stay signed in here; other devices were signed out.' });
    } catch (e: any) {
      setPasswordMsg({ type: 'error', text: e.message || 'Unable to change the password.' });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="ts-card ts-white ts-tbl">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-4 pb-3 border-dashed border-line2 border-b">Change Username</h2>
        <p className="ts-muted m-0 mb-4 text-[13px]">
          Current username: <span className="text-fg font-medium">{user?.username}</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col">
            <span className="ts-lbl">New username</span>
            <input
              type="text"
              autoComplete="username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="e.g. admin.office"
              maxLength={32}
              className="ts-fi"
            />
          </label>
          <PasswordField label="Current password" value={usernamePassword} onChange={setUsernamePassword} autoComplete="current-password" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={saveUsername} disabled={savingUsername || !newUsername.trim() || !usernamePassword} className="ts-btn ts-dark">
            {savingUsername ? 'Saving...' : 'Save username'}
          </button>
          <button onClick={cancelUsername} disabled={savingUsername} className="ts-btn ts-ghost">Cancel</button>
        </div>
        <div className="mt-4"><Feedback message={usernameMsg} /></div>
      </div>

      <div className="ts-card ts-white ts-tbl">
        <h2 className="m-0 text-[15px] font-medium text-fg mb-4 pb-3 border-dashed border-line2 border-b">Change Password</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label={`New password (${PASSWORD_MIN}+ characters)`} value={nextPassword} onChange={setNextPassword} autoComplete="new-password" />
          <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={savePassword} disabled={savingPassword || !currentPassword || !nextPassword || !confirmPassword} className="ts-btn ts-dark">
            {savingPassword ? 'Saving...' : 'Save password'}
          </button>
          <button onClick={cancelPassword} disabled={savingPassword} className="ts-btn ts-ghost">Cancel</button>
        </div>
        <div className="mt-4"><Feedback message={passwordMsg} /></div>
      </div>
    </div>
  );
}
