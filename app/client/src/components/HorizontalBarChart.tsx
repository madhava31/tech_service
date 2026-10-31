export interface BarDatum {
  label: string;
  sublabel?: string;
  value: number;
}

function defaultFormat(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function HorizontalBarChart({
  data,
  color = 'rgb(var(--chart-fill))',
  formatValue = defaultFormat,
}: {
  data: BarDatum[];
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data || data.length === 0) {
    return <p className="text-xs text-subtle py-4 text-center">No ranked performance data available.</p>;
  }

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const percent = Math.min(100, Math.max(4, (d.value / max) * 100));
        const rankStr = String(i + 1).padStart(2, '0');
        return (
          <div
            key={i}
            className="p-2.5 rounded-lg hover:bg-surface transition-colors border border-transparent hover:border-line2"
            title={`${d.label}: ${formatValue(d.value)}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold text-subtle w-5 shrink-0">{rankStr}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs font-bold text-fg truncate mb-1">
                  <span className="truncate">{d.label}</span>
                  <span className="font-extrabold text-fg ml-2 shrink-0">{formatValue(d.value)}</span>
                </div>
                {/* Visual Bar Track */}
                <div className="w-full bg-tile h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-600"
                    style={{ width: `${percent}%`, backgroundColor: color }}
                  />
                </div>
                {d.sublabel && <div className="text-[11px] font-semibold text-subtle mt-1">{d.sublabel}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
