"use client";

import { useState } from "react";
import Link from "next/link";
import type { JournalField, JournalFieldPaper } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface FieldBadgesProps {
  fields: JournalField[];
  sourceid: string;
  maxDisplay?: number;
}

// Color palette for field bars
const FIELD_COLORS: Record<number, { bg: string; text: string; hover: string }> = {
  0: {
    bg: "bg-blue-200 dark:bg-blue-800",
    text: "text-blue-900 dark:text-blue-100",
    hover: "hover:bg-blue-300 dark:hover:bg-blue-700",
  },
  1: {
    bg: "bg-purple-200 dark:bg-purple-800",
    text: "text-purple-900 dark:text-purple-100",
    hover: "hover:bg-purple-300 dark:hover:bg-purple-700",
  },
};

interface ExpandedFieldData {
  papers: JournalFieldPaper[];
  total: number;
  loading: boolean;
  error: string | null;
}

export function FieldBadges({ fields, sourceid, maxDisplay = 10 }: FieldBadgesProps) {
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [fieldData, setFieldData] = useState<Record<string, ExpandedFieldData>>({});

  if (fields.length === 0) {
    return (
      <div className="text-gray-500 text-sm">No field data available</div>
    );
  }

  // Sort by paper count and take top N
  const sortedFields = [...fields]
    .sort((a, b) => b.paper_count - a.paper_count)
    .slice(0, maxDisplay);

  // Separate by level
  const level0Fields = sortedFields.filter((f) => f.level === 0);
  const level1Fields = sortedFields.filter((f) => f.level === 1);

  // Calculate max paper count per level for proportional bar widths
  const maxLevel0 = level0Fields.length > 0
    ? Math.max(...level0Fields.map(f => f.paper_count))
    : 1;
  const maxLevel1 = level1Fields.length > 0
    ? Math.max(...level1Fields.map(f => f.paper_count))
    : 1;

  const handleFieldClick = async (fieldid: string) => {
    // Toggle off if already expanded
    if (expandedField === fieldid) {
      setExpandedField(null);
      return;
    }

    setExpandedField(fieldid);

    // If we already have data, don't fetch again
    if (fieldData[fieldid]?.papers.length > 0) {
      return;
    }

    // Set loading state
    setFieldData((prev) => ({
      ...prev,
      [fieldid]: { papers: [], total: 0, loading: true, error: null },
    }));

    try {
      const res = await fetch(
        `/api/journals/${sourceid}/publications?fieldid=${fieldid}&limit=10`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch papers");
      }
      const data = await res.json();
      setFieldData((prev) => ({
        ...prev,
        [fieldid]: {
          papers: data.papers,
          total: data.total,
          loading: false,
          error: null,
        },
      }));
    } catch (e) {
      setFieldData((prev) => ({
        ...prev,
        [fieldid]: {
          papers: [],
          total: 0,
          loading: false,
          error: e instanceof Error ? e.message : "Unknown error",
        },
      }));
    }
  };

  const renderFieldBar = (field: JournalField, maxPaperCount: number) => {
    const colors = FIELD_COLORS[field.level] || FIELD_COLORS[0];
    const isExpanded = expandedField === field.fieldid;
    const data = fieldData[field.fieldid];

    // Calculate bar width as percentage (minimum 25% to ensure text fits)
    const widthPercent = Math.max(25, (field.paper_count / maxPaperCount) * 100);

    return (
      <div key={field.fieldid} className="w-full">
        <button
          onClick={() => handleFieldClick(field.fieldid)}
          className={`px-3 py-1.5 rounded text-sm ${colors.bg} ${colors.text} ${colors.hover} transition-all cursor-pointer flex items-center justify-between gap-2`}
          style={{ width: `${widthPercent}%`, minWidth: 'fit-content' }}
          title={`${field.paper_count.toLocaleString()} papers - Click to see top papers`}
        >
          <span className="truncate">{field.field_name}</span>
          <span className="flex items-center gap-1 shrink-0 opacity-80">
            <span className="text-xs">
              {field.paper_count.toLocaleString()}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </span>
        </button>

        {/* Expanded paper list */}
        {isExpanded && (
          <div className="mt-2 ml-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            {data?.loading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading papers...
              </div>
            ) : data?.error ? (
              <div className="text-red-500 text-sm">{data.error}</div>
            ) : data?.papers.length === 0 ? (
              <div className="text-gray-500 text-sm">No papers found</div>
            ) : (
              <>
                <div className="space-y-2">
                  {data.papers.map((paper) => (
                    <Link
                      key={paper.paperid}
                      href={`/papers/${paper.paperid}`}
                      className="block p-2 bg-white dark:bg-gray-900 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-2">
                            {paper.title || "Untitled"}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {paper.year && `${paper.year} • `}
                            {formatNumber(paper.cited_by_count)} citations
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                {data.total > 10 && (
                  <p className="text-xs text-gray-500 mt-2">
                    Showing 10 of {formatNumber(data.total)} papers
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {level0Fields.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Broad Fields
          </h4>
          <div className="space-y-1.5">
            {level0Fields.map(field => renderFieldBar(field, maxLevel0))}
          </div>
        </div>
      )}

      {level1Fields.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Subfields
          </h4>
          <div className="space-y-1.5">
            {level1Fields.map(field => renderFieldBar(field, maxLevel1))}
          </div>
        </div>
      )}
    </div>
  );
}
