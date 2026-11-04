"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Landmark } from "lucide-react";
import type { GrantSummary } from "@/lib/types";
import { describeNihActivity, funderLabel, grantPath } from "@/lib/grant-id";
import { formatNumber } from "@/lib/utils";
import { GrantSourceBadges } from "@/components/GrantSourceBadges";

export function GrantCard({ grant, compact = false }: { grant: GrantSummary; compact?: boolean }) {
  const title = grant.acronym && grant.title ? `${grant.acronym}: ${grant.title}` : grant.title || grant.acronym;
  const activity = grant.funder === "NIH" ? describeNihActivity(grant.activity) : null;
  const years =
    grant.first_year && grant.last_year
      ? grant.first_year === grant.last_year
        ? String(grant.first_year)
        : `${grant.first_year}–${grant.last_year}`
      : null;
  return (
    <Link href={grantPath(grant.funder, grant.key)}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-sm">
              <Landmark className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`${compact ? "text-sm" : ""} font-medium font-mono`}>{grant.display}</span>
              <span className="shrink-0 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-sm" title={funderLabel(grant.funder)}>
                {grant.funder}
              </span>
              {activity && !compact && <span className="text-xs text-gray-400">{activity}</span>}
            </div>
            {title && (
              <div className={`${compact ? "text-xs" : "text-sm"} text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2`}>
                {title}
              </div>
            )}
            <div className={`flex items-center gap-3 mt-1 ${compact ? "text-xs" : "text-sm"} text-gray-500 flex-wrap`}>
              <span>
                {formatNumber(grant.paper_count)} paper{grant.paper_count === 1 ? "" : "s"}
              </span>
              {years && <span>{years}</span>}
              {!compact && <GrantSourceBadges sources={grant.sources} />}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
