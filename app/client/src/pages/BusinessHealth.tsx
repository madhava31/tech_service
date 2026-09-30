import { useEffect, useState } from 'react';
import { api, type BusinessHealthComponent, type BusinessHealthData } from '../api';

function componentTone(score: number | null): string {
  if (score == null) return '#7A839E';
  if (score >= 70) return '#3B6FD4';
  if (score >= 40) return '#E8A33D';
  return '#E5484D';
}

export default function BusinessHealth() {
  const [businessHealth, setBusinessHealth] = useState<BusinessHealthData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    setError('');
    api.dashboard
      .businessHealth()
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

  const overallScore = businessHealth?.overallScore ?? null;
  const strokeDashoffset = overallScore != null ? 490 - (overallScore / 100) * 490 : 490;

  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      {/* Page Header */}
      <div className="flex flex-col gap-1.5">
        <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
          Business Health
        </h1>
        <p className="margin-0 text-[13.5px] text-[#7A839E]">
          A composite read of momentum, pipeline, collections, retention and mix.
        </p>
      </div>

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
