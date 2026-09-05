"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { MeshRelatedTerm } from "@/lib/types";

/**
 * Collapsible list of narrower MeSH terms.
 *
 * A client island purely for the toggle. Note that every term is rendered into
 * the HTML up front and hidden with CSS rather than sliced away in JS — these
 * are internal links into the taxonomy, and slicing before first paint would
 * drop them out of the crawlable link graph.
 */
export function ChildTerms({ terms }: { terms: MeshRelatedTerm[] }) {
  const [open, setOpen] = useState(false);

  if (terms.length === 0) return null;

  return (
    <div className="border-t pt-4 mb-4">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 uppercase tracking-wide mb-2"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        Narrower Terms / Child Terms ({terms.length})
      </button>
      <div className={`flex flex-wrap gap-1.5 ${open ? "" : "hidden"}`}>
        {terms.map((child) => (
          <Link
            key={child.meshUi}
            href={`/mesh/${child.meshUi}`}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {child.meshName}
          </Link>
        ))}
      </div>
    </div>
  );
}
