"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { JournalImpactFactor } from "@/lib/types";

interface Props {
  data: JournalImpactFactor[];
}

export function ImpactFactorChart({ data }: Props) {
  // Filter to years with valid IF data and transform for chart
  const chartData = data
    .filter(
      (d) =>
        d.impact_factor_2yr !== null ||
        d.impact_factor_5yr !== null ||
        d.citescore !== null
    )
    .map((d) => ({
      year: d.year,
      "2-Year IF": d.impact_factor_2yr,
      "5-Year IF": d.impact_factor_5yr,
      CiteScore: d.citescore,
    }));

  if (chartData.length === 0) {
    return (
      <p className="text-gray-500 text-sm">No impact factor data available</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value) =>
            typeof value === "number" ? value.toFixed(2) : "N/A"
          }
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Line
          type="monotone"
          dataKey="2-Year IF"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="5-Year IF"
          stroke="#8b5cf6"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="CiteScore"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
