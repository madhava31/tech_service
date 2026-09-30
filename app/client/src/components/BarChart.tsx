import { useState, useRef, MouseEvent } from 'react';

const PALETTE = ['#2FBF71', '#6D9BE8', '#2563EB', '#D2561F'];

function defaultFormat(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export interface BarDatum {
  label: string;
  sublabel?: string;
  value: number;
}

/* -------------------------------------------------------------------------- */
/* Clean Ranked Horizontal Bar Chart for Top Customers & Products            */
/* -------------------------------------------------------------------------- */
export function HorizontalBarChart({
  data,
  color = PALETTE[0],
  formatValue = defaultFormat,
}: {
  data: BarDatum[];
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data || data.length === 0) return <p className="muted" style={{ padding: '12px 0', fontSize: '13px' }}>No performance data available.</p>;

  return (
    <div className="ranked-list space-y-3">
      {data.map((d, i) => {
        const percent = Math.min(100, Math.max(4, (d.value / max) * 100));
        const rankStr = String(i + 1).padStart(2, '0');
        return (
          <div className="ranked-item flex items-center justify-between p-2.5 rounded-xl hover:bg-[#0E1428] transition-colors border border-transparent hover:border-[#1E2540]" key={i} title={`${d.label}: ${formatValue(d.value)}`}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="ranked-num font-mono text-xs font-bold text-[#A8AEC4] w-5 shrink-0">{rankStr}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs font-bold text-[#141B34] truncate mb-1">
                  <span className="truncate">{d.label}</span>
                  <span className="font-extrabold text-[#3B6FD4] ml-2 shrink-0">{formatValue(d.value)}</span>
                </div>
                {/* Visual Bar Track */}
                <div className="w-full bg-[#1E2540] h-1.5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, backgroundColor: color }} />
                </div>
                {d.sublabel && <div className="text-[11px] font-medium text-[#A8AEC4] mt-1">{d.sublabel}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface GroupedDatum {
  category: string;
  series: { name: string; value: number }[];
}

export function GroupedBarChart({
  data,
  seriesNames,
  formatValue = defaultFormat,
}: {
  data: GroupedDatum[];
  seriesNames: string[];
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.series.map((s) => s.value)));
  if (!data || data.length === 0 || seriesNames.length === 0) return <p className="muted">No data available.</p>;

  return (
    <div className="barchart-g">
      {seriesNames.length > 1 && (
        <div className="barchart-g-legend">
          {seriesNames.map((name, i) => (
            <span key={name} className="barchart-g-legend-item">
              <span className="barchart-g-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
              {name}
            </span>
          ))}
        </div>
      )}
      <div className="barchart-g-plot">
        {data.map((d) => (
          <div className="barchart-g-group" key={d.category}>
            <div className="barchart-g-bars">
              {seriesNames.map((name, i) => {
                const point = d.series.find((s) => s.name === name);
                const value = point?.value || 0;
                return (
                  <div
                    key={name}
                    className="barchart-g-bar"
                    title={`${d.category} — ${name}: ${formatValue(value)}`}
                    style={{ height: `${(value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }}
                  />
                );
              })}
            </div>
            <div className="barchart-g-label" title={d.category}>{d.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Enterprise Primary Centerpiece: Clean SVG Revenue Line Chart              */
/* -------------------------------------------------------------------------- */
export interface LinePoint {
  label: string;
  value: number;
}

export function RevenueLineChart({
  data,
  formatValue = defaultFormat,
}: {
  data: LinePoint[];
  formatValue?: (n: number) => string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  if (!data || data.length === 0) return <p className="muted" style={{ padding: '24px 0' }}>No revenue trend data recorded.</p>;

  const height = 240;
  const width = 640;
  const padding = { top: 20, right: 20, bottom: 40, left: 20 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const maxVal = Math.max(1, ...data.map((d) => d.value));

  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(1, data.length - 1)) * innerWidth;
    const y = padding.top + innerHeight - (d.value / maxVal) * innerHeight;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = points.reduce((acc, point, i, a) => {
    if (i === 0) return `M ${point.x},${point.y}`;
    const prev = a[i - 1];
    const cp1x = prev.x + (point.x - prev.x) / 2;
    const cp1y = prev.y;
    const cp2x = prev.x + (point.x - prev.x) / 2;
    const cp2y = point.y;
    return `${acc} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${point.x},${point.y}`;
  }, '');

  const areaD = `${pathD} L ${points[points.length - 1].x},${height - padding.bottom} L ${points[0].x},${height - padding.bottom} Z`;

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const relativeY = e.clientY - rect.top;

    const index = Math.min(points.length - 1, Math.max(0, Math.floor((relativeX / rect.width) * points.length)));
    
    setHoverIndex(index);
    setMousePos({ x: relativeX, y: relativeY });
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="revenue-chart-container" ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="revenue-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id="revenueCleanGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B6FD4" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#3B6FD4" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Clean Subtle Gridlines */}
        <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#2C3454" strokeDasharray="3 3" />
        <line x1={padding.left} y1={padding.top + innerHeight / 2} x2={width - padding.right} y2={padding.top + innerHeight / 2} stroke="#2C3454" strokeDasharray="3 3" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#2C3454" />

        {/* Gradient Area Fill */}
        <path d={areaD} fill="url(#revenueCleanGrad)" className="revenue-area-fill" />

        {/* Deep Green Curve Line */}
        <path d={pathD} fill="none" stroke="#3B6FD4" strokeWidth="3" strokeLinecap="round" className="revenue-line-path" />

        {/* Data Nodes */}
        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={hoverIndex === i ? 6 : 3.5}
            fill={hoverIndex === i ? '#3B6FD4' : '#FFFFFF'}
            stroke="#3B6FD4"
            strokeWidth={hoverIndex === i ? 2.5 : 2}
            className="revenue-node"
          />
        ))}

        {/* Hover Guide Line */}
        {activePoint && (
          <g className="revenue-hover-group">
            <line
              x1={activePoint.x}
              y1={padding.top}
              x2={activePoint.x}
              y2={height - padding.bottom}
              stroke="#3B6FD4"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r={6} fill="#6D9BE8" stroke="#3B6FD4" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Axis Month Labels */}
      <div className="revenue-x-labels" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', padding: '0 4px', fontSize: '12px', fontWeight: 600, color: '#A8AEC4' }}>
        {data.map((d, i) => (
          <span key={i} style={{ color: hoverIndex === i ? '#3B6FD4' : 'inherit', fontWeight: hoverIndex === i ? 800 : 600 }}>
            {d.label}
          </span>
        ))}
      </div>

      {/* Floating Interactive Tooltip */}
      {activePoint && (
        <div
          className="chart-tooltip-floating"
          style={{
            position: 'absolute',
            left: `${mousePos.x}px`,
            top: `${mousePos.y - 45}px`,
            transform: 'translate(-50%, -100%)',
            background: '#3B6FD4',
            color: '#FFFFFF',
            padding: '7px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(59,111,212,0.18)',
            pointerEvents: 'none',
            zIndex: 30,
            whiteSpace: 'nowrap',
            transition: 'left 150ms ease-out, top 150ms ease-out',
          }}
        >
          <div style={{ color: '#6D9BE8', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{activePoint.label}</div>
          <div style={{ fontSize: '14px', marginTop: '2px' }}>{formatValue(activePoint.value)}</div>
        </div>
      )}
    </div>
  );
}
