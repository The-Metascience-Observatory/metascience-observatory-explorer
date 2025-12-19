"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
// Generic type for yearly stats - works with both JournalYearlyStats and PersonYearlyStats
interface YearlyStatsData {
  year: number;
  total_citations: number;
}

interface CitationsChartProps {
  data: YearlyStatsData[];
}

export function CitationsChart({ data }: CitationsChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[255px] flex items-center justify-center text-gray-500">
        No citation data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    year: d.year,
    citations: d.total_citations,
  }));

  // Calculate max value and add 10% padding to prevent clipping
  const maxCitations = Math.max(...chartData.map(d => d.citations));
  const yMax = Math.ceil(maxCitations * 1.1);

  return (
    <div className="h-[255px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickLine={false}
            domain={[0, yMax]}
            tickFormatter={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
              if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
              return value.toString();
            }}
          />
          <Tooltip
            formatter={(value: number) => [value.toLocaleString(), "Citations"]}
            labelFormatter={(label) => `Year: ${label}`}
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
            }}
          />
          <Line
            type="monotone"
            dataKey="citations"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
