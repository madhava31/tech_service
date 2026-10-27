import { useState } from 'react';
import { useAuth } from '../auth';
import { BrandMark } from '../components/layout/BrandMark';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both your staff username and password.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Invalid username or password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ts-auth min-h-screen grid grid-cols-1 tablet-lg:grid-cols-[1.05fr_1fr] gap-3 p-3 text-fg antialiased">
      {/* Brand panel */}
      <aside className="ts-card ts-charcoal hidden tablet-lg:flex relative overflow-hidden !p-10 flex-col justify-between gap-10 select-none">
        <BrandMark />

        <div className="flex flex-col gap-5 max-w-[460px]">
          <h1 className="m-0 text-[40px] font-medium tracking-[-.025em] leading-[1.1] text-pretty">
            The quotation-to-invoice line, in one view.
          </h1>
          <p className="m-0 text-[14.5px] leading-[1.6] opacity-65 text-pretty">
            Revenue, pipeline, follow-ups and product performance — reading straight from your live Technicon records.
          </p>
        </div>

        {/* Decorative trend curve, drawn in the panel's own text colour */}
        <svg viewBox="0 0 560 180" aria-hidden="true" className="w-full max-w-[560px] h-auto">
          <defs>
            <linearGradient id="loginArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2="560" y1="150" y2="150" stroke="currentColor" strokeOpacity=".14" />
          <line x1="0" x2="560" y1="100" y2="100" stroke="currentColor" strokeOpacity=".08" strokeDasharray="3 5" />
          <line x1="0" x2="560" y1="50" y2="50" stroke="currentColor" strokeOpacity=".08" strokeDasharray="3 5" />
          <path
            d="M 0 132 C 62 128, 78 108, 140 112 C 202 116, 218 72, 280 66 C 342 60, 358 92, 420 74 C 482 56, 498 28, 560 22 L 560 160 L 0 160 Z"
            fill="url(#loginArea)"
          />
          <path
            className="ts-auth-line"
            d="M 0 132 C 62 128, 78 108, 140 112 C 202 116, 218 72, 280 66 C 342 60, 358 92, 420 74 C 482 56, 498 28, 560 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </aside>

      {/* Sign-in form */}
      <main className="grid place-items-center px-4 py-10">
        <div className="w-full max-w-[396px] flex flex-col gap-6">
          <div className="tablet-lg:hidden"><BrandMark /></div>

          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-[30px] font-medium tracking-[-.025em]">Sign in</h2>
            <p className="ts-muted m-0 text-[14px]">Use your Technicon Services work account.</p>
          </div>

          {error && (
            <div role="alert" className="ts-warnbox">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col">
              <span className="ts-lbl">Username / work email</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="username or name@technicon.in"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="ts-fi"
              />
            </label>

            <label className="flex flex-col">
              <span className="ts-lbl">Password</span>
              <span className="relative flex items-center">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ts-fi !pr-[72px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="ts-btn ts-ghost ts-xs absolute right-[6px]"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 py-0.5">
              <label className="flex items-center gap-2 text-[13px] text-subtle cursor-pointer select-none">
                <input type="checkbox" defaultChecked className="w-4 h-4 accent-[rgb(var(--fg))] cursor-pointer" />
                Keep me signed in
              </label>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-[13px] text-fg hover:underline">
                Forgot password?
              </a>
            </div>

            <button
              type="submit"
              disabled={busy}
              className={`ts-btn ts-dark w-full justify-center !py-3 ${busy ? 'opacity-65 cursor-not-allowed' : ''}`}
            >
              {busy ? (
                <>
                  <span aria-hidden="true" className="w-[13px] h-[13px] rounded-full border-[1.6px] border-current border-t-transparent animate-spin" />
                  Checking...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <span className="flex-1 border-t border-dashed border-line2" />
            <span className="text-[12px] text-faint">or</span>
            <span className="flex-1 border-t border-dashed border-line2" />
          </div>

          <button
            type="button"
            onClick={() => setError('SSO login is managed by your workspace administrator.')}
            className="ts-btn ts-ghost w-full justify-center !py-3"
          >
            Continue with company SSO
          </button>

          <p className="m-0 text-[12.5px] text-faint text-center text-pretty">Access is granted by your workspace admin.</p>
        </div>
      </main>
    </div>
  );
}
