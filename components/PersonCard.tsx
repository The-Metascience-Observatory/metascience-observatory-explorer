"use client";

import { memo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { PersonSearchItem } from "@/lib/types";
import { User } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface PersonCardProps {
  person: PersonSearchItem;
  compact?: boolean;
}

export const PersonCard = memo(function PersonCard({ person, compact = false }: PersonCardProps) {
  return (
    <Link href={`/persons/${person.authorid}`}>
      <Card className={`${compact ? "p-2" : "p-4"} hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer`}>
        <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
          {!compact && (
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`${compact ? "text-sm" : ""} font-medium truncate`}>{person.display_name}</h3>
              {!compact && person.h_index && person.h_index >= 50 && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                  h:{person.h_index}
                </span>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                {person.last_known_institution && (
                  <span className="truncate">{person.last_known_institution}</span>
                )}
                {person.orcid && (
                  <span>ORCID: {person.orcid}</span>
                )}
                {person.productivity && (
                  <span>{formatNumber(person.productivity)} papers</span>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
});
