import { useState } from 'react';
import type { PipelineStage } from '../api';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Authentic quotation stage color palette
const STAGE_COLORS: Record<string, string> = {
  draft: '#7A839E',
  sent: '#6B78D6',
  accepted: '#3B6FD4',
  rejected: '#E5484D',
};

export function PipelineDonutChart({
  stages,
  totalValue,
  acceptedRate,
}: {
  stages: PipelineStage[];
  totalValue: number;
  acceptedRate: number;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const totalCount = stages ? stages.reduce((sum, s) => sum + s.count, 0) : 0;

  if (!stages || stages.length === 0 || (totalValue === 0 && totalCount === 0)) {
    return <p className="text-xs text-[#7A839E] py-6 text-center">No pipeline data recorded.</p>;
  }

  const radius = 64;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  const useCountForSegments = totalValue <= 0 && totalCount > 0;
  const denominator = useCountForSegments ? totalCount : Math.max(1, totalValue);

  let accumulatedAngle = 0;
  const segments = stages.map((s) => {
    const metric = useCountForSegments ? s.count : s.value;
    const strokeDasharray = (metric / denominator) * circumference;
    const strokeDashoffset = -accumulatedAngle;
    accumulatedAngle += strokeDasharray;
    return {
      ...s,
      color: STAGE_COLORS[s.key] || '#6B78D6',
      strokeDasharray: `${strokeDasharray} ${circumference}`,
      strokeDashoffset,
    };
  });

  const activeStage = hoveredKey ? stages.find((s) => s.key === hoveredKey) : null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
      
      {/* SVG Donut Ring */}
      <div className="relative size-44 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90 overflow-visible">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#E4E8F2" strokeWidth={strokeWidth} />
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={hoveredKey === seg.key ? strokeWidth + 3 : strokeWidth}
              strokeDasharray={seg.strokeDasharray}
              strokeDashoffset={seg.strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-300 cursor-pointer"
              style={{
                opacity: hoveredKey && hoveredKey !== seg.key ? 0.4 : 1,
              }}
              onMouseEnter={() => setHoveredKey(seg.key)}
              onMouseLeave={() => setHoveredKey(null)}
            />
          ))}
        </svg>

        {/* Center Conversion Metrics */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[10px] font-bold text-[#7A839E] uppercase tracking-wider">Accepted Rate</span>
          <span className="text-xl font-extrabold text-[#3B6FD4] mt-0.5">{acceptedRate}%</span>
          <span className="text-[10px] text-[#7A839E] font-semibold">{formatCurrency(totalValue)}</span>
        </div>
      </div>

      {/* Stage Breakdown & Progress Bars */}
      <div className="flex-1 space-y-2.5 w-full">
        {stages.map((stage) => {
          const color = STAGE_COLORS[stage.key] || '#6B78D6';
          const metric = useCountForSegments ? stage.count : stage.value;
          const percent = Math.min(100, Math.max(3, (metric / denominator) * 100));
          return (
            <div
              key={stage.key}
              className={`p-2 rounded-lg transition-colors border ${
                hoveredKey === stage.key ? 'bg-[#F7F8FC] border-[#3B6FD4]/40' : 'border-transparent hover:border-[#E4E8F2]'
              }`}
              onMouseEnter={() => setHoveredKey(stage.key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <div className="flex items-center justify-between text-xs font-bold text-[#141B34] mb-1">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span>{stage.label}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold">{formatCurrency(stage.value)}</span>
                  <span className="bg-[#E4E8F2] text-[#7A839E] px-1.5 py-0.5 rounded text-[10px]">{stage.count}</span>
                </div>
              </div>
              <div className="w-full bg-[#E4E8F2] rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${percent}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
