"use client";

import { Database, ExternalLink, Landmark, Package } from "lucide-react";
import type {
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
