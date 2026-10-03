import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface CompanyTrendSeries {
  key: string;
  label: string;
  color: string;
}

export default function CompanyTrendLineChart({
  data,
  series,
}: {
  data: Array<Record<string, string | number>>;
  series: CompanyTrendSeries[];
}) {
  if (data.length === 0 || series.length === 0) {
    return <p className="text-[13px] text-[#71809B] py-8 text-center">No product trend data for this company.</p>;
  }

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 18, left: 4, bottom: 8 }}>
          <CartesianGrid stroke="#DFE6F2" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: '#71809B', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#71809B', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => `₹${Number(value).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 })}`}
          />
          <Tooltip
            contentStyle={{ border: '1px solid #DFE6F2', borderRadius: 10, boxShadow: '0 8px 24px rgba(20,33,61,.12)' }}
            formatter={(value: number, name: string) => [`₹${Number(value).toLocaleString('en-IN')}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2.5}
              dot={{ r: 3, fill: item.color, strokeWidth: 2, stroke: '#FFFFFF' }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#FFFFFF' }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
