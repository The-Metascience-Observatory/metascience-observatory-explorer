"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PaperCitationHistory {
  year: number;
  citation_count: number;
}

export type CitationViewMode = "yearly" | "cumulative";

interface PaperCitationsChartProps {
  data: PaperCitationHistory[];
  viewMode: CitationViewMode;
}

export function PaperCitationsChart({ data, viewMode }: PaperCitationsChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        No citation history available
      </div>
    );
  }

  // Fill in missing years with zeros, extending to 2024
  const dataMap = new Map(data.map(d => [d.year, d.citation_count]));
  const minYear = Math.min(...data.map(d => d.year));
  const maxYear = 2024; // Always extend to 2024

  const filledData: { year: number; citations: number }[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    filledData.push({
      year,
      citations: dataMap.get(year) || 0,
    });
  }

  // Calculate chart data based on view mode
  let chartData: { year: number; citations: number }[];

  if (viewMode === "cumulative") {
    let cumulative = 0;
    chartData = filledData.map((d) => {
      cumulative += d.citations;
      return {
        year: d.year,
        citations: cumulative,
      };
    });
  } else {
    chartData = filledData;
  }

  // Calculate max value and add 10% padding to prevent clipping
  const maxCitations = Math.max(...chartData.map(d => d.citations));
  const yMax = Math.ceil(maxCitations * 1.1);

  const commonProps = {
    data: chartData,
    margin: { top: 20, right: 30, left: 20, bottom: 5 },
  };

  const tooltipLabel = viewMode === "cumulative" ? "Total Citations" : "Citations";

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {viewMode === "cumulative" ? (
          <LineChart {...commonProps}>
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
              formatter={(value: number) => [value.toLocaleString(), tooltipLabel]}
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
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        ) : (
          <BarChart {...commonProps}>
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
              formatter={(value: number) => [value.toLocaleString(), tooltipLabel]}
              labelFormatter={(label) => `Year: ${label}`}
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
              }}
            />
            <Bar
              dataKey="citations"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
