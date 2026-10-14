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

const SERIES = "#3b82f6"; // blue-500, the app's established single-series hue
const GRID = "#e5e7eb";
const AXIS = "#6b7280";

export interface CareerAgePoint {
  career_age: number;
  n_authors: number;
  median_works: number | null;
  median_citations: number | null;
}

function CareerTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: CareerAgePoint }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-sm shadow-xs">
      <div className="font-medium text-gray-900">{label} years since doctorate</div>
      <div className="text-gray-600">
        Median lifetime works {d.median_works?.toLocaleString() ?? "—"}
      </div>
      {/* The denominator travels with the value: a bucket of 60 authors and one of
          60,000 must not look equally trustworthy in the tooltip. */}
      <div className="text-gray-500">
        based on {d.n_authors.toLocaleString()} authors
      </div>
    </div>
  );
}

/**
 * Median LIFETIME works by career age (cumulative, not a per-year rate — the curve
 * rises by construction). ONE series, so no legend — the title names it.
 * Deliberately not a dual-axis chart with citations: two measures of different
 * scale get two charts, never two y-scales.
 */
export function CareerAgeChart({
  data,
  metric = "median_works",
}: {
  data: CareerAgePoint[];
  metric?: "median_works" | "median_citations";
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-gray-500">
        No career-age data available
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="career_age"
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
            label={{
              value: "Years since doctorate",
              position: "insideBottom",
              offset: -12,
              fontSize: 12,
              fill: AXIS,
            }}
          />
          <YAxis tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <Tooltip content={<CareerTooltip />} />
          <Line
            type="monotone"
            dataKey={metric}
            stroke={SERIES}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
