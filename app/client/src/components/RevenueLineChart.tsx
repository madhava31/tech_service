import { useState, useRef, MouseEvent } from 'react';

export interface LinePoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

function defaultFormat(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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

  if (!data || data.length === 0) {
    return <p className="text-xs text-subtle py-8 text-center">No revenue analytics data recorded.</p>;
  }

  const height = 260;
  const width = 680;
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
    <div className="revenue-chart-container relative w-full" ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="limeRevenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--chart-fill))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--chart-fill))" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Minimal Dark Gridlines */}
        <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="rgb(var(--line-rgb) / .13)" strokeDasharray="3 3" />
        <line x1={padding.left} y1={padding.top + innerHeight / 2} x2={width - padding.right} y2={padding.top + innerHeight / 2} stroke="rgb(var(--line-rgb) / .13)" strokeDasharray="3 3" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="rgb(var(--line-rgb) / .13)" />

        {/* Area Gradient Fill */}
        <path d={areaD} fill="url(#limeRevenueGrad)" className="revenue-area-fill" />

        {/* Lime Primary Line */}
        {/* pathLength normalises the line to 1000 units so the 1000-unit draw-in animation
            (styles.css .revenue-line-path) always finishes, however spiky the data is. */}
        <path d={pathD} pathLength={1000} fill="none" stroke="rgb(var(--chart-line))" strokeWidth="3" strokeLinecap="round" className="revenue-line-path" />

        {/* Data Nodes */}
        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={hoverIndex === i ? 6 : 3.5}
            fill={hoverIndex === i ? 'rgb(var(--chart-hi))' : 'rgb(var(--surface-2))'}
            stroke="rgb(var(--chart-line))"
            strokeWidth={hoverIndex === i ? 2.5 : 2}
            className="transition-all duration-150"
          />
        ))}

        {/* Hover Vertical Guide Line & Point Glow */}
        {activePoint && (
          <g>
            <line
              x1={activePoint.x}
              y1={padding.top}
              x2={activePoint.x}
              y2={height - padding.bottom}
              stroke="rgb(var(--chart-line))"
              strokeDasharray="4 4"
              strokeWidth="1.5"
              opacity="0.6"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r={7} fill="rgb(var(--chart-hi))" stroke="rgb(var(--surface-2))" strokeWidth="2.5" />
          </g>
        )}
      </svg>

      {/* Axis Labels */}
      <div className="flex justify-between mt-2 px-1 text-[11px] font-semibold text-subtle">
        {data.map((d, i) => (
          <span key={i} className={hoverIndex === i ? 'text-fg font-bold' : ''}>
            {d.label}
          </span>
        ))}
      </div>

      {/* Cursor Tooltip */}
      {activePoint && (
        <div
          className="absolute bg-ink text-onink px-3 py-2 rounded-lg text-xs font-bold border border-line2 shadow-card pointer-events-none z-30 whitespace-nowrap transition-all duration-75"
          style={{
            left: `${mousePos.x}px`,
            top: `${mousePos.y - 45}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="text-fg text-[10px] uppercase tracking-wider">{activePoint.label}</div>
          <div className="text-sm mt-0.5">{formatValue(activePoint.value)}</div>
        </div>
      )}
    </div>
  );
}
