import { useEffect, useRef, useState } from 'react';
import { api, type BusinessHealthComponent, type BusinessHealthData } from '../api';
import { queryClient } from '../lib/queryClient';
import { RotateCcw, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

function componentTone(score: number | null): string {
  if (score == null) return '#7A839E';
  if (score >= 70) return '#3B6FD4';
  if (score >= 40) return '#E8A33D';
  return '#E5484D';
}

export default function BusinessHealth() {
  const cachedHealth = queryClient.getQueryData<BusinessHealthData>(['dashboard', 'businessHealth']);
  const [businessHealth, setBusinessHealth] = useState<BusinessHealthData | null>(cachedHealth || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!cachedHealth);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(type: 'success' | 'error', message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const fetchData = (force: boolean | unknown = false) => {
    const shouldForce = force === true;
    if (!businessHealth || shouldForce) {
      setLoading(true);
    }
    setError('');
    queryClient
      .fetchQuery({
        queryKey: ['dashboard', 'businessHealth'],
        queryFn: () => api.dashboard.businessHealth(),
        staleTime: 60000,
        tags: ['dashboard', 'businessHealth'],
        force: shouldForce,
      })
      .then((data) => {
        setBusinessHealth(data);
      })
      .catch((e) => {
        setError(e.message || 'Unable to load business health score.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleReset = async () => {
    if (actionLoading) return;
    const confirmMsg =
      'Are you sure you want to reset the Business Health data?\n\n' +
      'This will reset only this page\'s score and metrics.\n' +
      'Your actual company records, products, quotations, and reports will NOT be affected.';
    if (!window.confirm(confirmMsg)) return;

    setActionLoading(true);
    try {
      const res = await api.dashboard.resetBusinessHealth();
      showToast('success', res.message || 'Business Health page data has been reset.');
      fetchData();
    } catch (e: any) {
      const errorMsg =
        e.message === 'Internal Server Error'
          ? 'Unable to connect to server. Please try again.'
          : (e.message || 'Failed to reset page data.');
      showToast('error', errorMsg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.dashboard.restoreBusinessHealth();
      showToast('success', res.message || 'Business Health re-synced with system data.');
      fetchData();
    } catch (e: any) {
      const errorMsg =
        e.message === 'Internal Server Error'
          ? 'Unable to connect to server. Please try again.'
          : (e.message || 'Failed to sync page data.');
      showToast('error', errorMsg);
    } finally {
      setActionLoading(false);
    }
  };

  const overallScore = businessHealth?.overallScore ?? null;
  const strokeDashoffset = overallScore != null ? 490 - (overallScore / 100) * 490 : 490;

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm p-4 rounded-[12px] shadow-lg border flex items-start gap-3 transition-all ${
            toast.type === 'success'
              ? 'bg-[#E3F7EC] border-[#BFEAD3] text-[#1E8A52]'
              : 'bg-[#F8E4E4] border-[#F4D6D7] text-[#C8323A]'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="text-[13px] font-medium leading-snug flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100 cursor-pointer text-[16px] leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
            Business Health
          </h1>
          <p className="margin-0 text-[13.5px] text-[#7A839E]">
            A composite read of momentum, pipeline, collections, retention and mix.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {businessHealth?.isReset ? (
            <button
              type="button"
              onClick={handleRestore}
              disabled={actionLoading || loading}
              className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#D9E2F4] text-[#3B6FD4] hover:bg-[#F4F6FC] text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
              title="Sync with Live System Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
              <span>{actionLoading ? 'Syncing...' : 'Re-sync System Data'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReset}
              disabled={actionLoading || loading}
              className="h-[34px] px-3.5 rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#E5484D] hover:bg-[#FDF2F2] hover:border-[#F4D6D7] text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
              title="Reset Business Health page data only"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
              <span>{actionLoading ? 'Resetting...' : 'Reset Page Data'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchData}
            disabled={loading || actionLoading}
            className="h-[34px] w-[34px] rounded-[9px] bg-[#FFFFFF] border border-[#E4E8F2] text-[#7A839E] hover:text-[#141B34] hover:bg-[#F4F6FC] flex items-center justify-center cursor-pointer transition-colors shadow-sm disabled:opacity-50"
            title="Refresh Score"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Reset State Notice Banner */}
      {businessHealth?.isReset && (
        <div className="p-3.5 rounded-[12px] bg-[#FFF8EB] border border-[#F6ECDC] text-[#D97706] text-[12.5px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold shrink-0">Notice:</span>
            <span>Business Health page data has been reset. All other system records (companies, products, quotations, reports) remain completely untouched.</span>
          </div>
          <button
            type="button"
            onClick={handleRestore}
            disabled={actionLoading}
            className="px-3 py-1 rounded-[7px] bg-[#FFFFFF] border border-[#E8D7BE] text-[#B45309] font-medium text-[11.5px] hover:bg-[#FEF3C7] cursor-pointer shrink-0 transition-colors"
          >
            Restore Live Data
          </button>
        </div>
      )}

      {error ? (
        <div className="p-4 rounded-[12px] bg-[#F8E4E4] border border-[#F4D6D7] text-[#E5484D] text-[13px] flex items-center justify-between gap-4">
          <span>Unable to load business health score.</span>
          <button
            type="button"
            onClick={fetchData}
            className="px-3 py-1.5 rounded-[8px] bg-[#F7DFE0] hover:bg-[#F5DADB] text-[#141B34] text-xs font-semibold cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      ) : !businessHealth ? (
        <div className="p-8 text-center text-[#7A839E] text-[13px] rounded-[16px] bg-[#FFFFFF] border border-[#E4E8F2]">
          Loading business health score...
        </div>
      ) : businessHealth.overallScore == null ? (
        <div className="p-8 text-center text-[#7A839E] text-[13px] rounded-[16px] bg-[#FFFFFF] border border-[#E4E8F2]">
          Not enough data yet to calculate a business health score.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Gauge & Component Breakdown Card (7 Cols) */}
          <section className="lg:col-span-7 bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-6">
            <div className="flex flex-col md:flex-row items-center gap-7">
              {/* Circular SVG Donut Gauge */}
              <div className="relative grid place-items-center w-[168px] h-[168px] shrink-0">
                <svg viewBox="0 0 200 200" role="img" aria-label={`Overall business health score ${overallScore} out of 100`} className="w-[168px] h-[168px] -rotate-90">
                  <circle cx="100" cy="100" r="78" fill="none" stroke="#F7F8FC" strokeWidth="14" />
                  <circle
                    cx="100"
                    cy="100"
                    r="78"
                    fill="none"
                    stroke="#3B6FD4"
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeDasharray="490"
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute flex flex-col items-center select-none pointer-events-none">
                  <span className="text-[38px] font-medium tracking-[-.02em] leading-none text-[#141B34]">
                    {overallScore}
                  </span>
                  <span className="text-[11.5px] text-[#7A839E] mt-1">out of 100</span>
                </div>
              </div>

              {/* Component Score Bars */}
              <div className="flex-1 min-w-0 flex flex-col gap-3 w-full">
                {Object.values(businessHealth.components).map((c: BusinessHealthComponent) => {
                  const tone = componentTone(c.score);
                  const scoreVal = c.score ?? 0;
                  return (
                    <div key={c.label} className="flex flex-col gap-1.25">
                      <div className="flex justify-between gap-3 text-[12.5px]">
                        <span className="text-[#141B34] font-medium">{c.label}</span>
                        <span style={{ color: tone }} className="font-bold">{c.score ?? '—'}</span>
                      </div>
                      <div className="h-1.5 rounded-[3px] bg-[#F7F8FC] overflow-hidden">
                        <div
                          className="h-full rounded-[3px] transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, scoreVal))}%`, backgroundColor: tone }}
                        />
                      </div>
                      <span className="text-[11px] text-[#A8AEC4]">{c.detail}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Recommendation & Insights Column (5 Cols) */}
          <section className="lg:col-span-5 bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-6 flex flex-col gap-4">
            <h2 className="margin-0 text-[16px] font-medium text-[#141B34]">
              What is influencing the score
            </h2>

            {businessHealth.recommendation ? (
              <div className="flex gap-3 p-3.5 rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2]">
                <span aria-hidden="true" className="shrink-0 w-7 h-7 rounded-[8px] bg-[#FFFFFF] border border-[#DCE2F0] text-[#E8A33D] grid place-items-center text-[13px] font-bold">
                  !
                </span>
                <div className="flex flex-col gap-1 text-[12.5px]">
                  <span className="font-medium text-[#141B34]">{businessHealth.recommendation.title}</span>
                  <p className="margin-0 text-[#7A839E] leading-[1.5]">{businessHealth.recommendation.detail}</p>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 p-3.5 rounded-[12px] bg-[#F7F8FC] border border-[#E4E8F2]">
                <span aria-hidden="true" className="shrink-0 w-7 h-7 rounded-[8px] bg-[#FFFFFF] border border-[#DCE2F0] text-[#3B6FD4] grid place-items-center text-[13px] font-bold">
                  ▲
                </span>
                <div className="flex flex-col gap-1 text-[12.5px]">
                  <span className="font-medium text-[#141B34]">All key metrics healthy</span>
                  <p className="margin-0 text-[#7A839E] leading-[1.5]">Every scored operational area is performing within target bounds.</p>
                </div>
              </div>
            )}

            {/* General Highlights derived from components */}
            <div className="flex flex-col gap-2.5 pt-2">
              {Object.values(businessHealth.components).map((c: BusinessHealthComponent) => (
                <div key={c.label} className="p-3 rounded-[10px] bg-[#F7F8FC]/50 border border-[#E4E8F2]/60 flex items-start gap-2.5 text-[12px]">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: componentTone(c.score) }} />
                  <div className="flex flex-col">
                    <span className="font-medium text-[#141B34]">{c.label} ({c.score ?? '—'})</span>
                    <span className="text-[#7A839E]">{c.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
