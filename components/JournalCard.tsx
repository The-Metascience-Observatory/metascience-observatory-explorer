"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { JournalSearchItem } from "@/lib/types";
import { BookOpen, ExternalLink } from "lucide-react";

interface JournalCardProps {
  journal: JournalSearchItem;
  compact?: boolean;
}

export function JournalCard({ journal, compact = false }: JournalCardProps) {
  return (
    <Link href={`/journals/${journal.sourceid}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <BookOpen className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`${compact ? "text-sm" : ""} font-medium truncate`}>{journal.display_name}</h3>
              {journal.is_oa && (
                <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
                  OA
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                {journal.issn && (
                  <span>ISSN: {journal.issn}</span>
                )}
                {journal.publisher && (
                  <span className="truncate">{journal.publisher}</span>
                )}
              </div>
            )}
          </div>
          <ExternalLink className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-gray-400 flex-shrink-0`} />
        </div>
      </Card>
    </Link>
  );
}
