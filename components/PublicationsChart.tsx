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
  paper_count: number;
}

interface PublicationsChartProps {
  data: YearlyStatsData[];
}

export function PublicationsChart({ data }: PublicationsChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[255px] flex items-center justify-center text-gray-500">
        No publication data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    year: d.year,
    papers: d.paper_count,
  }));

  return (
    <div className="h-[255px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickLine={false}
            tickFormatter={(value) => value.toLocaleString()}
          />
          <Tooltip
            formatter={(value: number) => [value.toLocaleString(), "Papers"]}
            labelFormatter={(label) => `Year: ${label}`}
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
            }}
          />
          <Line
            type="monotone"
            dataKey="papers"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
