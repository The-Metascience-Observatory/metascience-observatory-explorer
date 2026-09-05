"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { AffiliationResearcher } from "@/lib/types";

/**
 * Top researchers, collapsed to 10 with a "show more" toggle.
 *
 * Every researcher is rendered into the HTML and the overflow is hidden with
 * CSS rather than sliced away in JS. These are links to /persons/ pages, and
 * slicing before first paint would keep 40 of them out of the crawlable graph.
 */
export function ResearcherList({ researchers }: { researchers: AffiliationResearcher[] }) {
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = researchers.length - 10;

  return (
    <>
      <div className="space-y-3">
        {researchers.map((researcher, idx) => (
          <Link
            key={`${researcher.authorid}-${idx}`}
            href={`/persons/${researcher.authorid}`}
            className={`block ${idx >= 10 && !showAll ? "hidden" : ""}`}
          >
            <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <div>
                <div className="font-medium">
                  {researcher.display_name || "Unknown Researcher"}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium">h-index: {researcher.h_index || "—"}</div>
                <div className="text-gray-500">
                  {formatNumber(researcher.paper_count)} papers
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ChevronDown className="h-4 w-4" />
          Show {hiddenCount} more researchers
        </button>
      )}
    </>
  );
}
