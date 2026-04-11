"use client";

import { memo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PaperTitle } from "@/components/PaperTitle";
import type { PaperSearchItem } from "@/lib/types";
import { FileText } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface PaperCardProps {
  paper: PaperSearchItem;
  compact?: boolean;
}

export const PaperCard = memo(function PaperCard({ paper, compact = false }: PaperCardProps) {
  return (
    <Link href={`/papers/${paper.paperid}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <FileText className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`${compact ? "text-sm" : ""} font-medium line-clamp-2`}>
                <PaperTitle title={paper.title} />
              </h3>
              {!compact && paper.cited_by_count >= 100 && (
                <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 rounded">
                  {formatNumber(paper.cited_by_count)} cites
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                {paper.year && (
                  <span>{paper.year}</span>
                )}
                {paper.source_name && (
                  <span className="truncate">{paper.source_name}</span>
                )}
                {paper.cited_by_count < 100 && (
                  <span>{formatNumber(paper.cited_by_count)} citations</span>
                )}
              </div>
            )}
            {compact && (
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                {paper.year && <span>{paper.year}</span>}
                {paper.source_name && <span className="truncate max-w-[150px]">{paper.source_name}</span>}
                <span>{formatNumber(paper.cited_by_count)} cites</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
});
