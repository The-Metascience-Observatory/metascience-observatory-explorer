"use client";

import { Database, ExternalLink, Landmark, Package, TrendingUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type {
  BipClass,
  OpenaireImpactIndicators,
  OpenaireLinkedProduct,
  OpenairePaperInfo,
  OpenaireProject,
} from "@/lib/types";

const OA_COLOR_STYLES: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  hybrid: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  bronze: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-200",
};

// Open-access status pills (data: OpenAIRE Graph)
export function OpenAccessBadges({ info }: { info: OpenairePaperInfo }) {
  const badges: Array<{ key: string; label: string; className: string }> = [];

  if (info.oaColor && OA_COLOR_STYLES[info.oaColor]) {
    badges.push({
      key: "color",
      label: `${info.oaColor.charAt(0).toUpperCase()}${info.oaColor.slice(1)} OA`,
      className: OA_COLOR_STYLES[info.oaColor],
    });
  } else if (info.bestAccessRight === "OPEN") {
    badges.push({
      key: "open",
      label: "Open Access",
      className: OA_COLOR_STYLES.green,
    });
  }
  if (info.isGreen && info.oaColor !== "green") {
    badges.push({
      key: "green",
      label: "Green OA",
      className: OA_COLOR_STYLES.green,
    });
  }
  if (info.isDiamond) {
    badges.push({
      key: "diamond",
      label: "Diamond OA",
      className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
    });
  }
  if (badges.length === 0) return null;

  return (
    <>
      {badges.map((b) => (
        <span
          key={b.key}
          className={`px-2 py-1 text-xs font-medium rounded ${b.className}`}
          title="Open-access status from the OpenAIRE Graph"
        >
          {b.label}
        </span>
      ))}
    </>
  );
}

function projectUrl(project: OpenaireProject): string | null {
  if (project.funderShortname === "EC" && project.code) {
    return `https://cordis.europa.eu/project/id/${project.code}`;
  }
  return null;
}

// "Funding" section listing grants/projects linked via the OpenAIRE Graph
export function OpenaireFundingSection({ projects }: { projects: OpenaireProject[] }) {
  if (projects.length === 0) return null;
  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        <Landmark className="h-4 w-4" />
        Funding ({projects.length})
      </div>
      <div className="space-y-2">
        {projects.map((p) => {
          const url = projectUrl(p);
          const heading = [p.funderShortname, p.code].filter(Boolean).join(" ");
          const title = p.acronym && p.title ? `${p.acronym}: ${p.title}` : p.title || p.acronym;
          return (
            <div
              key={p.openaireProjectId}
              className="rounded-md border p-2 text-sm bg-gray-50 dark:bg-gray-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{heading || "Unknown grant"}</span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-xs"
                  >
                    CORDIS <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {title && <div className="text-gray-600 dark:text-gray-400 mt-0.5">{title}</div>}
              {p.fundingStream && (
                <div className="text-xs text-gray-500 mt-0.5">{p.fundingStream}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-gray-400 mt-1">Source: OpenAIRE Graph</div>
    </div>
  );
}

// BIP! percentile bands. "C3" means nothing to a reader; "Top 1%" does.
// Ramp is a single hue light->dark (sequential, since the bands are ordered) with
// a neutral gray terminal for the unremarkable bottom 90%. Every pill also states
// its percentile in words, so the ranking is never encoded by color alone.
const BIP_CLASS: Record<BipClass, { label: string; className: string }> = {
  C1: { label: "Top 0.01%", className: "bg-indigo-600 text-white dark:bg-indigo-500" },
  C2: { label: "Top 0.1%", className: "bg-indigo-400 text-indigo-950 dark:bg-indigo-600 dark:text-white" },
  C3: { label: "Top 1%", className: "bg-indigo-200 text-indigo-900 dark:bg-indigo-800 dark:text-indigo-100" },
  C4: { label: "Top 10%", className: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-200" },
  C5: { label: "Bottom 90%", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};

const BIP_METRICS: Array<{
  key: "influence" | "popularity" | "impulse";
  classKey: "influenceClass" | "popularityClass" | "impulseClass";
  label: string;
  help: string;
}> = [
  {
    key: "influence",
    classKey: "influenceClass",
    label: "Influence",
    help: "Overall/total impact across the whole citation network, measured diachronically (PageRank-family).",
  },
  {
    key: "popularity",
    classKey: "popularityClass",
    label: "Popularity",
    help: "Current attention -- the 'hype' -- computed with AttRank so newer papers aren't penalized.",
  },
  {
    key: "impulse",
    classKey: "impulseClass",
    label: "Impulse",
    help: "Initial momentum: citations received in a fixed 3-year window after publication.",
  },
];

function BipPill({ cls }: { cls: BipClass | null }) {
  if (!cls || !BIP_CLASS[cls]) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const { label, className } = BIP_CLASS[cls];
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-xs font-medium rounded ${className}`}
      title={`BIP! impact class ${cls}`}
    >
      {label}
    </span>
  );
}

function fmtScore(v: number | null): string {
  if (v === null) return "";
  if (v === 0) return "0";
  // influence/popularity are tiny probabilities; impulse is a small integer
  return Math.abs(v) < 0.001 ? v.toExponential(1) : formatNumber(v);
}

// "Research impact" section: BIP! citation-based indicators shipped in the
// OpenAIRE Graph. The percentile band is the readable signal; the raw score is
// subordinate because the floats are unreadable on their own.
export function OpenaireImpactSection({
  impact,
}: {
  impact: OpenaireImpactIndicators | null;
}) {
  if (!impact) return null;
  const tiles = BIP_METRICS.filter(
    (m) => impact[m.key] !== null || impact[m.classKey] !== null
  );
  if (impact.citationCount === null && tiles.length === 0) return null;

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        <TrendingUp className="h-4 w-4" />
        Research Impact
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-md border p-2 bg-gray-50 dark:bg-gray-900">
          <div className="text-xs text-gray-500">Citations</div>
          <div className="text-lg font-semibold leading-tight">
            {formatNumber(impact.citationCount ?? 0)}
          </div>
          <div className="mt-1">
            <BipPill cls={impact.citationClass} />
          </div>
        </div>
        {tiles.map((m) => (
          <div
            key={m.key}
            className="rounded-md border p-2 bg-gray-50 dark:bg-gray-900"
            title={m.help}
          >
            <div className="text-xs text-gray-500">{m.label}</div>
            <div className="text-xs text-gray-400 leading-tight h-[1.5rem] flex items-end">
              {fmtScore(impact[m.key])}
            </div>
            <div className="mt-1">
              <BipPill cls={impact[m.classKey]} />
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-1">
        Source:{" "}
        <a
          href="https://bip.imsi.athenarc.gr/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-600 underline"
        >
          BIP!
        </a>{" "}
        indicators, via the OpenAIRE Graph (CC-BY)
      </div>
    </div>
  );
}

// "Linked datasets & software" section (result↔result relations from OpenAIRE)
export function OpenaireLinkedProductsSection({
  products,
}: {
  products: OpenaireLinkedProduct[];
}) {
  if (products.length === 0) return null;
  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        <Database className="h-4 w-4" />
        Linked Datasets &amp; Software ({products.length})
      </div>
      <div className="space-y-2">
        {products.map((lp, i) => (
          <div
            key={`${lp.doi || lp.title || "lp"}-${i}`}
            className="rounded-md border p-2 text-sm bg-gray-50 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {lp.productType === "software" ? (
                  <Package className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                ) : (
                  <Database className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                )}
                <span className="truncate">{lp.title || lp.doi || "Untitled"}</span>
              </div>
              {lp.doi && (
                <a
                  href={`https://doi.org/${lp.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-xs shrink-0"
                >
                  DOI <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {[lp.productType, lp.year].filter(Boolean).join(" · ")}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-1">Source: OpenAIRE Graph</div>
    </div>
  );
}
