"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperTitle } from "@/components/PaperTitle";
import { formatNumber } from "@/lib/utils";
import type { PaperItem } from "@/lib/types";
import { ArrowUpRight, Quote, Loader2 } from "lucide-react";

interface PaperListCardProps {
  type: "references" | "citations";
  papers: PaperItem[];
  totalCount?: number;
  isLoading?: boolean;
  hasMore?: boolean;
  emptyMessage?: string;
  maxNote?: string;
  /** Small provenance line under the list, e.g. a data-source credit. */
  footnote?: React.ReactNode;
  containerRef?: React.RefObject<HTMLDivElement>;
  sentinelRef?: React.RefObject<HTMLDivElement>;
}

export function PaperListCard({
  type,
  papers,
  totalCount,
  isLoading,
  hasMore,
  emptyMessage,
  maxNote,
  footnote,
  containerRef,
  sentinelRef,
}: PaperListCardProps) {
  const isReferences = type === "references";
  const Icon = isReferences ? Quote : ArrowUpRight;
  const title = isReferences ? "References" : "Cited By";
  const defaultEmptyMessage = isReferences
    ? "No references found"
    : "No citing papers found in database";

  // Build count display. totalCount is exact on both sides (a COUNT(*) for
  // SciSciNet, the true edge degree for OpenAIRE); what the list can actually
  // reach is communicated by maxNote, not by fudging the header.
  let countDisplay = `${papers.length}`;
  if (totalCount && totalCount > papers.length) {
    countDisplay = `${papers.length} of ${formatNumber(totalCount)}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title} ({countDisplay})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {papers.length === 0 ? (
          <div ref={containerRef}>
            {isLoading ? (
              <div className="flex items-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading...</span>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">{emptyMessage || defaultEmptyMessage}</p>
            )}
            {/* Keep the sentinel mounted: a merged list can legitimately start
                empty while it waits on its first page. */}
            {sentinelRef && <div ref={sentinelRef} className="h-1" />}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="space-y-2 max-h-[500px] overflow-y-auto"
          >
            {papers.map((paper) => {
              const body = (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">
                      {paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {paper.year && `${paper.year} • `}
                      {paper.cited_by_count === null
                        ? "Citations unknown"
                        : `${formatNumber(paper.cited_by_count)} citations`}
                    </p>
                  </div>
                  {paper.openaire && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 text-xs bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 rounded-sm"
                      title="Paper from the OpenAIRE Graph; citation count from BIP! indicators"
                    >
                      OpenAIRE
                    </span>
                  )}
                  {!paper.unresolved && (
                    <ArrowUpRight className="h-4 w-4 text-gray-400 shrink-0" />
                  )}
                </div>
              );

              // A known edge whose other end we can't name: show it, don't link it.
              if (paper.unresolved) {
                return (
                  <div
                    key={paper.paperid}
                    className="block p-2 rounded-md border border-dashed border-gray-200 dark:border-gray-700 opacity-70"
                    title="This citation exists in the source data, but the paper record could not be resolved"
                  >
                    {body}
                  </div>
                );
              }

              return (
                <ListItemLink
                  key={paper.paperid}
                  href={
                    paper.openaire
                      ? `/papers/openaire/${paper.paperid}`
                      : `/papers/${paper.paperid}`
                  }
                >
                  {body}
                </ListItemLink>
              );
            })}
            {/* Sentinel for infinite scroll */}
            {sentinelRef && <div ref={sentinelRef} className="h-1" />}
            {isLoading && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading more...</span>
              </div>
            )}
            {maxNote && !hasMore && (
              <p className="text-xs text-gray-400 text-center py-2">
                {maxNote}
              </p>
            )}
          </div>
        )}
        {footnote && papers.length > 0 && (
          <div className="text-xs text-gray-400 mt-2">{footnote}</div>
        )}
      </CardContent>
    </Card>
  );
}
