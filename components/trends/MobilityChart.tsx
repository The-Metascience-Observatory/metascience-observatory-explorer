"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList,
} from "recharts";

// Diverging pair, validated with the dataviz palette validator against the light
// surface: CVD ΔE 32.8 (protan) / 28.1 (tritan), normal-vision ΔE 38.0 — all well
// clear of the floors. The validator WARNs that amber is 2.09:1 against the
// surface, which obligates relief: every bar is therefore direct-labeled and a
// table view is offered below the chart. Do not remove those without re-checking.
const INFLOW = "#3b82f6"; // blue-500, matches the app's existing charts
const OUTFLOW = "#f59e0b"; // amber-500
const GRID = "#e5e7eb";
const AXIS = "#6b7280";

export interface CountryTotal {
  country: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface Flow {
  from_country: string;
  to_country: string;
  n: number;
}

function NetTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CountryTotal }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
      <div className="font-medium text-gray-900">{d.country}</div>
      <div className="text-gray-600">
        In {d.inflow.toLocaleString()} · Out {d.outflow.toLocaleString()}
      </div>
      <div className="font-medium text-gray-900">
        Net {d.net > 0 ? "+" : ""}
        {d.net.toLocaleString()}
      </div>
    </div>
  );
}

export function NetMobilityChart({ data }: { data: CountryTotal[] }) {
  if (data.length === 0) return null;
  // Rank by magnitude of net flow; a diverging bar reads polarity, so the sort
  // must be by signed value to keep gainers and losers on opposite ends.
  const rows = [...data].sort((a, b) => b.net - a.net);
  const height = Math.max(280, rows.length * 22);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <YAxis
            type="category"
            dataKey="country"
            width={44}
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
          />
          {/* Zero is the meaningful midpoint of a diverging scale — mark it. */}
          <ReferenceLine x={0} stroke={AXIS} strokeWidth={1} />
          <Tooltip content={<NetTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Bar dataKey="net" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.country} fill={r.net >= 0 ? INFLOW : OUTFLOW} />
            ))}
            {/* Required relief for the amber contrast WARN. */}
            <LabelList
              dataKey="net"
              position="right"
              className="fill-gray-600"
              fontSize={11}
              formatter={(v: number) => (v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString())}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TopFlowsChart({ data }: { data: Flow[] }) {
  if (data.length === 0) return null;
  const rows = data.slice(0, 20).map((f) => ({
    pair: `${f.from_country} → ${f.to_country}`,
    n: f.n,
  }));
  const height = Math.max(280, rows.length * 22);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <YAxis
            type="category"
            dataKey="pair"
            width={92}
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
          />
          {/* Single series carrying magnitude only — one hue, no legend needed. */}
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            formatter={(v: number) => [v.toLocaleString(), "moves"]}
            contentStyle={{ fontSize: 13, borderRadius: 6, borderColor: GRID }}
          />
          <Bar
            dataKey="n"
            fill={INFLOW}
            radius={[0, 4, 4, 0]}
            barSize={12}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="n"
              position="right"
              className="fill-gray-600"
              fontSize={11}
              formatter={(v: number) => v.toLocaleString()}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
