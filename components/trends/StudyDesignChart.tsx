"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/**
 * Share of PubMed-indexed articles by evidence tier, over time.
 *
 * PALETTE — validated, not chosen by eye (dataviz skill, scripts/validate_palette.js):
 * these are categorical slots 1,2,3,7 of the reference theme, checked with
 * `--pairs all` because a stacked area invites comparison between ANY two bands,
 * not just neighbours. On the light surface all-pairs CVD is ΔE 9.2 (deutan) /
 * 9.6 (tritan) and normal-vision 16.3 — all clear.
 *
 * TWO CONSTRAINTS THIS ENCODES, both discovered by running the validator:
 *  1. FOUR bands is the ceiling. Five fails the normal-vision floor outright
 *     (magenta↔orange ΔE 12.9, below 15 — full-colour readers cannot separate
 *     them, and the skill is explicit that secondary encoding does not excuse it).
 *     That is why the tiers below are grouped rather than plotted as eight raw types.
 *  2. This set is LIGHT-SURFACE ONLY. The dark steps of violet and blue collapse
 *     to ΔE 1.9 (protan). The app is light-only today — <body> is hardcoded
 *     bg-white and the existing charts carry no dark: classes — so that is
 *     consistent, but ADDING DARK MODE REQUIRES RE-VALIDATING THIS PALETTE.
 * Aqua sits at 2.74:1 against the surface, a contrast WARN, which obligates
 * relief: the legend and the table view below the chart are that relief.
 */
const TIERS: { key: string; label: string; color: string; types: string[] }[] = [
  {
    key: "synthesis",
    label: "Evidence synthesis",
    color: "#2a78d6",
    types: ["Meta-Analysis", "Systematic Review"],
  },
  {
    key: "trials",
    label: "Trials",
    color: "#eb6834",
    types: ["Randomized Controlled Trial", "Clinical Trial"],
  },
  {
    key: "observational",
    label: "Observational",
    color: "#1baf7a",
    types: ["Observational Study", "Comparative Study"],
  },
  {
    key: "case",
    label: "Case reports",
    color: "#4a3aa7",
    types: ["Case Reports"],
  },
];

const GRID = "#e5e7eb";
const AXIS = "#6b7280";

export interface DesignYear {
  year: number;
  total: number;
  [designName: string]: number;
}

interface Point {
  year: number;
  total: number;
  synthesis: number;
  trials: number;
  observational: number;
  case: number;
}

/** Raw per-type counts -> per-tier PERCENTAGE of that year's indexed articles. */
export function toTiers(series: DesignYear[]): Point[] {
  return series
    .filter((y) => y.total > 0)
    .map((y) => {
      const p: Point = {
        year: y.year,
        total: y.total,
        synthesis: 0,
        trials: 0,
        observational: 0,
        case: 0,
      };
      for (const t of TIERS) {
        // An article carrying two types in one tier (e.g. RCT + Clinical Trial)
        // is counted once per type here; the result is a share of type-mentions,
        // not of articles, which is why the axis is labelled "% of articles
        // (type mentions)" rather than implying a clean partition.
        const n = t.types.reduce((s, name) => s + (Number(y[name]) || 0), 0);
        (p as unknown as Record<string, number>)[t.key] = (100 * n) / y.total;
      }
      return p;
    });
}

function DesignTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-sm shadow-xs">
      <div className="font-medium text-gray-900">{label}</div>
      {TIERS.map((t) => (
        <div key={t.key} className="flex items-center gap-1.5 text-gray-600">
          <span
            className="inline-block h-2 w-2 rounded-xs"
            style={{ backgroundColor: t.color }}
            aria-hidden="true"
          />
          {t.label} {((d as unknown as Record<string, number>)[t.key] ?? 0).toFixed(2)}%
        </div>
      ))}
      {/* The denominator travels with the value: 1955 has orders of magnitude
          fewer indexed articles than 2015 and must not look equally solid. */}
      <div className="mt-1 text-xs text-gray-500">
        {d.total.toLocaleString()} indexed articles
      </div>
    </div>
  );
}

export function StudyDesignChart({ series }: { series: DesignYear[] }) {
  const data = toTiers(series);
  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-gray-500">
        No study-design data available
      </div>
    );
  }

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} />
          <YAxis
            tick={{ fontSize: 12, fill: AXIS }}
            stroke={GRID}
            tickFormatter={(v: number) => `${v}%`}
            label={{
              value: "% of indexed articles",
              angle: -90,
              position: "insideLeft",
              fontSize: 12,
              fill: AXIS,
            }}
          />
          <Tooltip content={<DesignTooltip />} />
          {/* >=2 series, so a legend is always present — identity is never colour alone. */}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {TIERS.map((t) => (
            <Area
              key={t.key}
              type="monotone"
              dataKey={t.key}
              name={t.label}
              stackId="1"
              stroke={t.color}
              fill={t.color}
              fillOpacity={0.85}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export { TIERS as STUDY_DESIGN_TIERS };
