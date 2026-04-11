"use client";

import { memo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { AffiliationSearchItem } from "@/lib/types";
import { Building2, ExternalLink } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface AffiliationCardProps {
  affiliation: AffiliationSearchItem;
  compact?: boolean;
}

const typeColors: Record<string, string> = {
  education: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  company: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  government: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  healthcare: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  nonprofit: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  facility: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  archive: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export const AffiliationCard = memo(function AffiliationCard({ affiliation, compact = false }: AffiliationCardProps) {
  const typeColor = affiliation.type ? typeColors[affiliation.type] || typeColors.other : typeColors.other;

  return (
    <Link href={`/affiliations/${affiliation.institution_id}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <Building2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`${compact ? "text-sm" : ""} font-medium truncate`}>{affiliation.display_name}</h3>
              {affiliation.type && !compact && (
                <span className={`px-2 py-0.5 text-xs rounded ${typeColor}`}>
                  {affiliation.type}
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 flex-wrap">
                {affiliation.country_code && (
                  <span>{affiliation.country_code}</span>
                )}
                {affiliation.h_index && (
                  <span>h-index: {affiliation.h_index}</span>
                )}
                {affiliation.productivity && (
                  <span>{formatNumber(affiliation.productivity)} papers</span>
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
