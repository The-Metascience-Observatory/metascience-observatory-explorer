"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperTitle } from "@/components/PaperTitle";
import { formatNumber } from "@/lib/utils";
import { ArrowUpRight, Quote, Loader2 } from "lucide-react";

interface PaperItem {
  paperid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
}

interface PaperListCardProps {
  type: "references" | "citations";
  papers: PaperItem[];
  totalCount?: number;
  isLoading?: boolean;
  hasMore?: boolean;
  emptyMessage?: string;
  maxNote?: string;
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
  containerRef,
  sentinelRef,
}: PaperListCardProps) {
  const isReferences = type === "references";
  const Icon = isReferences ? Quote : ArrowUpRight;
  const title = isReferences ? "References" : "Cited By";
  const defaultEmptyMessage = isReferences
    ? "No references found"
    : "No citing papers found in database";

  // Build count display
  let countDisplay = `${papers.length}`;
  if (totalCount && totalCount > papers.length) {
    countDisplay = `${papers.length} of ${totalCount > 1000 ? "1,000+" : formatNumber(totalCount)}`;
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
          <p className="text-gray-500 text-sm">{emptyMessage || defaultEmptyMessage}</p>
        ) : (
          <div
            ref={containerRef}
            className="space-y-2 max-h-[500px] overflow-y-auto"
          >
            {papers.map((paper) => (
              <ListItemLink
                key={paper.paperid}
                href={`/papers/${paper.paperid}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">
                      {paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {paper.year && `${paper.year} • `}
                      {formatNumber(paper.cited_by_count ?? 0)} citations
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </div>
              </ListItemLink>
            ))}
            {/* Sentinel for infinite scroll */}
            {sentinelRef && <div ref={sentinelRef} className="h-1" />}
            {isLoading && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading more...</span>
              </div>
            )}
            {maxNote && !hasMore && papers.length >= 1000 && (
              <p className="text-xs text-gray-400 text-center py-2">
                {maxNote}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
