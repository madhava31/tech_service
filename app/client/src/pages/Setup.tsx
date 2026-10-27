import { useState } from 'react';
import { useAuth } from '../auth';
import { BrandMark } from '../components/layout/BrandMark';

export default function Setup() {
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    setBusy(true);
    try {
      await setup(username, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ts-auth min-h-screen grid place-items-center px-4 py-10 text-fg antialiased">
      <form className="ts-card w-full max-w-[420px] !p-7 flex flex-col gap-5" onSubmit={submit}>
        <BrandMark />
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[26px] font-medium tracking-[-.02em]">Create the admin account</h2>
          <p className="ts-muted m-0 text-[14px]">
            No accounts exist yet. Set up the first admin account to start using the app.
          </p>
        </div>
        {error && <div className="ts-warnbox">{error}</div>}
        <label className="flex flex-col">
          <span className="ts-lbl">Username</span>
          <input className="ts-fi" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col">
          <span className="ts-lbl">Password</span>
          <input className="ts-fi" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="ts-lbl">Confirm password</span>
          <input className="ts-fi" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button className="ts-btn ts-dark w-full justify-center !py-3" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </div>
  );
}
