"use client";

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toTiers, STUDY_DESIGN_TIERS } from "./StudyDesignChart";
import type { DesignYear } from "./StudyDesignChart";

const GRID = "#e5e7eb";
const AXIS = "#6b7280";
const SINGLE = "#2a78d6"; // categorical slot 1; a lone series needs no palette check

// ---------------------------------------------------------------------------
// B. Trajectories — same four tiers, unstacked lines.
//
// Stacking is good for composition but bad for reading any single tier: a band's
// thickness is easy to misread as its height. Unstacked lines make each tier's
// trajectory directly readable, at the cost of losing the "adds to the whole"
// reading. Same validated 4-hue light palette as the stacked version.
// ---------------------------------------------------------------------------
export function StudyDesignLines({ series }: { series: DesignYear[] }) {
  const data = toTiers(series);
  if (data.length === 0) return null;

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ fontSize: 13, borderRadius: 6, borderColor: GRID }}
            formatter={(v: number, n: string) => [`${v.toFixed(2)}%`, n]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {STUDY_DESIGN_TIERS.map((t) => (
            <Line
              key={t.key}
              type="monotone"
              dataKey={t.key}
              name={t.label}
              stroke={t.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C. Small multiples — every publication type, one panel each.
//
// This is the dataviz skill's prescribed escape from the series-count ceiling.
// Each panel carries ONE series, so no categorical palette is involved and the
// CVD limit that capped the stacked chart at four bands does not apply: all
// eight designs can be shown at full detail. The trade is that cross-type
// comparison becomes a saccade rather than a glance, and each panel has its own
// y-scale — so shapes are comparable, heights are not.
// ---------------------------------------------------------------------------
const ALL_DESIGNS = [
  "Randomized Controlled Trial",
  "Systematic Review",
  "Meta-Analysis",
  "Clinical Trial",
  "Observational Study",
  "Comparative Study",
  "Case Reports",
  "Review",
];

export function StudyDesignFacets({ series }: { series: DesignYear[] }) {
  const rows = series.filter((y) => y.total > 0);
  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {ALL_DESIGNS.map((name) => {
        const data = rows.map((y) => ({
          year: y.year,
          pct: (100 * (Number(y[name]) || 0)) / y.total,
          total: y.total,
        }));
        const peak = Math.max(...data.map((d) => d.pct));
        return (
          <div key={name} className="rounded-sm border border-gray-200 p-2">
            <div className="mb-1 text-xs font-medium text-gray-700">{name}</div>
            {/* Each panel states its own peak: with independent y-scales, a shape
                without its scale is not interpretable. */}
            <div className="mb-1 text-[10px] text-gray-500">peak {peak.toFixed(2)}%</div>
            <div className="h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
                  <XAxis dataKey="year" tick={{ fontSize: 9, fill: AXIS }} stroke={GRID} />
                  <YAxis hide domain={[0, peak * 1.1 || 1]} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: GRID }}
                    formatter={(v: number) => [`${v.toFixed(2)}%`, name]}
                    labelFormatter={(l) => `${l}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="pct"
                    stroke={SINGLE}
                    fill={SINGLE}
                    fillOpacity={0.25}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// D. The headline finding on its own — RCT share over time.
//
// Sometimes the answer is one series, not a composition. "Randomised trials went
// from ~0% to a few percent of the indexed literature" is the single most cited
// metascience fact available from this dataset, and a lone line states it without
// the reader having to pick a band out of a stack. One series => no legend, and
// no palette validation needed.
// ---------------------------------------------------------------------------
export function RctTrendChart({ series }: { series: DesignYear[] }) {
  const data = series
    .filter((y) => y.total > 0)
    .map((y) => ({
      year: y.year,
      pct: (100 * (Number(y["Randomized Controlled Trial"]) || 0)) / y.total,
      n: Number(y["Randomized Controlled Trial"]) || 0,
      total: y.total,
    }));
  if (data.length === 0) return null;

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ fontSize: 13, borderRadius: 6, borderColor: GRID }}
            formatter={(v: number, _n, p) => [
              `${v.toFixed(2)}%  (${(p?.payload?.n ?? 0).toLocaleString()} of ${(
                p?.payload?.total ?? 0
              ).toLocaleString()})`,
              "RCTs",
            ]}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke={SINGLE}
            fill={SINGLE}
            fillOpacity={0.25}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
