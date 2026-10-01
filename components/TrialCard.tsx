"use client";

import { memo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { TrialSearchItem } from "@/lib/types";
import { ExternalLink } from "lucide-react";
import { formatTrialStatus } from "@/lib/format";

interface TrialCardProps {
  trial: TrialSearchItem;
  compact?: boolean;
  hideStatus?: boolean;
}

// Status badge colors
function getStatusColor(status: string | null): string {
  if (!status) return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  switch (status.toUpperCase()) {
    case "RECRUITING":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "ACTIVE_NOT_RECRUITING":
    case "ACTIVE, NOT RECRUITING":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "COMPLETED":
      return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    case "TERMINATED":
    case "WITHDRAWN":
    case "SUSPENDED":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

export const TrialCard = memo(function TrialCard({ trial, compact = false, hideStatus = false }: TrialCardProps) {
  return (
    <Link href={`/trials/${trial.nct_id}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`${compact ? "text-sm" : ""} font-medium ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
                {trial.title || trial.nct_id}
              </h3>
              {!hideStatus && trial.status && (
                <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${getStatusColor(trial.status)}`}>
                  {formatTrialStatus(trial.status)}
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                <span className="font-mono text-xs">{trial.nct_id}</span>
                {trial.phase && (
                  <span>{trial.phase}</span>
                )}
                {trial.sponsor && (
                  <span className="truncate">{trial.sponsor}</span>
                )}
              </div>
            )}
            {compact && (
              <div className="text-xs text-gray-500 mt-0.5">
                {trial.nct_id}
                {trial.paper_count ? ` · ${trial.paper_count} papers` : ""}
              </div>
            )}
          </div>
          <ExternalLink className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-gray-400 flex-shrink-0`} />
        </div>
      </Card>
    </Link>
  );
});
