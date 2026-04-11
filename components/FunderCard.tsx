"use client";

import { memo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { FunderSearchItem } from "@/lib/types";
import { Banknote, ExternalLink } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface FunderCardProps {
  funder: FunderSearchItem;
  compact?: boolean;
}

export const FunderCard = memo(function FunderCard({ funder, compact = false }: FunderCardProps) {
  return (
    <Link href={`/funders/${funder.funderid}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <Banknote className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`${compact ? "text-sm" : ""} font-medium truncate`}>{funder.display_name}</h3>
              {funder.country_code && !compact && (
                <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                  {funder.country_code}
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 flex-wrap">
                {funder.h_index && (
                  <span>h-index: {funder.h_index}</span>
                )}
                {funder.works_count && (
                  <span>{formatNumber(funder.works_count)} papers</span>
                )}
                {funder.cited_by_count && (
                  <span>{formatNumber(funder.cited_by_count)} citations</span>
                )}
              </div>
            )}
          </div>
          <ExternalLink className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-gray-400 flex-shrink-0`} />
        </div>
      </Card>
    </Link>
  );
});
