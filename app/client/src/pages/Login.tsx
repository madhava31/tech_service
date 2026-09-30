import { useState } from 'react';
import { useAuth } from '../auth';

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
    <div className="min-h-screen grid grid-cols-1 tablet-lg:grid-cols-[1.05fr_1fr] bg-[#F4F6FC] text-[#141B34] font-sans antialiased selection:bg-[#3B6FD4]/25">
      {/* Brand Showcase Sidebar */}
      <aside className="hidden tablet-lg:flex relative overflow-hidden bg-[#E9EDF7] border-r border-[#F7F8FC] p-10 flex-col justify-between gap-10 select-none">
        {/* Brand Header */}
        <div className="flex items-center gap-2.75">
          <div className="w-8 h-8 rounded-[9px] border border-[#D9E2F4] bg-[#F7F8FC] text-[#3B6FD4] grid place-items-center text-[12px] font-semibold tracking-[.02em]">
            TS
          </div>
          <div className="flex flex-col leading-[1.1]">
            <span className="text-[13.5px] font-semibold tracking-[.04em]">TECHNICON</span>
            <span className="text-[10.5px] tracking-[.18em] text-[#7A839E]">SERVICES</span>
          </div>
        </div>

        {/* Value Proposition */}
        <div className="flex flex-col gap-5.5 max-w-[460px]">
          <h1 className="margin-0 text-[38px] font-medium tracking-[-.025em] leading-[1.1] text-pretty">
            The quotation-to-invoice line, in one view.
          </h1>
          <p className="margin-0 text-[14px] leading-[1.6] text-[#7A839E] text-pretty">
            Revenue, pipeline, follow-ups and product performance — reading straight from your live Technicon records.
          </p>

          {/* Metric Strip */}
          <div className="grid grid-cols-3 border border-[#E4E8F2] rounded-[12px] bg-[#FFFFFF] overflow-hidden">
            <div className="p-[12px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">REVENUE</span>
              <span className="text-[18px] font-medium">₹24.12L</span>
            </div>
            <div className="p-[12px_14px] border-r border-[#EEF1F9] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">ORDERS</span>
              <span className="text-[18px] font-medium">380</span>
            </div>
            <div className="p-[12px_14px] flex flex-col gap-[2px]">
              <span className="text-[10.5px] tracking-[.08em] text-[#A8AEC4]">CUSTOMERS</span>
              <span className="text-[18px] font-medium">152</span>
            </div>
          </div>
        </div>

        {/* Decorative SVG Trend Curve */}
        <svg viewBox="0 0 560 180" aria-hidden="true" className="w-full max-w-[560px] h-auto opacity-90">
          <defs>
            <linearGradient id="loginArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B6FD4" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#3B6FD4" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2="560" y1="150" y2="150" stroke="#EEF1F9" />
          <line x1="0" x2="560" y1="100" y2="100" stroke="#F7F8FC" />
          <line x1="0" x2="560" y1="50" y2="50" stroke="#F7F8FC" />
          <path
            d="M 0 132 C 62 128, 78 108, 140 112 C 202 116, 218 72, 280 66 C 342 60, 358 92, 420 74 C 482 56, 498 28, 560 22 L 560 160 L 0 160 Z"
            fill="url(#loginArea)"
          />
          <path
            d="M 0 132 C 62 128, 78 108, 140 112 C 202 116, 218 72, 280 66 C 342 60, 358 92, 420 74 C 482 56, 498 28, 560 22"
            fill="none"
            stroke="#3B6FD4"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </aside>

      {/* Main Authentication Form Area */}
      <main className="grid place-items-center p-10 tablet-lg:p-7">
        <div className="w-full max-w-[396px] flex flex-col gap-[22px]">
          {/* Header */}
          <div className="flex flex-col gap-1.75">
            <h2 className="margin-0 text-[26px] font-medium tracking-[-.02em]">Sign in</h2>
            <p className="margin-0 text-[13px] text-[#7A839E]">
              Use your Technicon Services work account.
            </p>
          </div>

          {/* Error Alert Box */}
          {error && (
            <div
              role="alert"
              className="flex gap-2.5 items-start p-[11px_13px] rounded-[10px] border border-[#F4D6D7] bg-[#F8E4E4] animate-in fade-in duration-200"
            >
              <span aria-hidden="true" className="text-[#E5484D] text-[13px] leading-[1.3]">
                !
              </span>
              <span className="text-[12.5px] text-[#F6D5D6]">{error}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.75 text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
              USERNAME / WORK EMAIL
              <input
                type="text"
                autoComplete="username"
                placeholder="username or name@technicon.in"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="h-[42px] px-3.25 rounded-[10px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] text-[13.5px] tracking-normal outline-none focus:border-[#3B6FD4] hover:border-[#D4DAEA] transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1.75 text-[11px] tracking-[.08em] text-[#A8AEC4] uppercase">
              PASSWORD
              <span className="relative flex items-center">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[42px] pl-3.25 pr-[66px] rounded-[10px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] text-[13.5px] tracking-normal outline-none focus:border-[#3B6FD4] hover:border-[#D4DAEA] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-[7px] h-[28px] px-2.25 rounded-[7px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#7A839E] text-[11px] tracking-normal cursor-pointer hover:text-[#141B34] hover:border-[#D4DAEA] transition-colors"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 py-1">
              <label className="flex items-center gap-2 text-[12.5px] text-[#7A839E] cursor-pointer select-none">
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-[15px] h-[15px] accent-[#3B6FD4] cursor-pointer"
                />
                Keep me signed in
              </label>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px] text-[#3B6FD4] hover:underline">
                Forgot password?
              </a>
            </div>

            <button
              type="submit"
              disabled={busy}
              className={`flex items-center justify-center gap-2.25 h-[44px] rounded-[11px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-medium text-[14px] cursor-pointer hover:bg-[#E3EAF7] transition-colors ${
                busy ? 'opacity-65 cursor-not-allowed' : ''
              }`}
            >
              {busy ? (
                <>
                  <span
                    aria-hidden="true"
                    className="w-[13px] h-[13px] rounded-full border-[1.6px] border-current border-t-transparent animate-spin"
                  />
                  Checking...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-[#EEF1F9]" />
            <span className="text-[11px] tracking-[.08em] text-[#A8AEC4]">OR</span>
            <span className="flex-1 h-px bg-[#EEF1F9]" />
          </div>

          <button
            type="button"
            onClick={() => setError('SSO login is managed by your workspace administrator.')}
            className="h-[42px] rounded-[11px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#141B34] text-[13.5px] cursor-pointer hover:border-[#D4DAEA] transition-colors"
          >
            Continue with company SSO
          </button>

          <p className="margin-0 text-[11.5px] text-[#A8AEC4] text-center text-pretty">
            Access is granted by your workspace admin.
          </p>
        </div>
      </main>
    </div>
  );
}
