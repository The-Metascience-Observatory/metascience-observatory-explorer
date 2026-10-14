"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import type { OpenaireOrgInfo } from "@/lib/types";

/**
 * Funded-project portfolio from the OpenAIRE Graph.
 *
 * Deliberately still a client island rather than a server <Suspense> child:
 * openaire.db is a separate 47GB file that has been observed reporting
 * "database disk image is malformed" on this host. Keeping it off the render
 * path means a corrupt or missing OpenAIRE database degrades this one card
 * instead of failing the whole institution page.
 */
export function OpenaireProjects({ institutionId }: { institutionId: string }) {
  const [org, setOrg] = useState<OpenaireOrgInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/affiliations/${institutionId}/openaire`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setOrg(json.org);
      } catch (e) {
        console.error("Failed to fetch OpenAIRE org data:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  if (!org || org.projects.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Funded Projects ({formatNumber(org.projectCount)})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {org.projects.map((project) => (
            <div
              key={project.openaireProjectId}
              className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">
                    {project.acronym || project.code || "Untitled project"}
                    {project.funderShortname && (
                      <span className="ml-2 px-2 py-0.5 rounded-sm text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {project.funderShortname}
                      </span>
                    )}
                  </div>
                  {project.title && (
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {project.title}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    {[
                      project.code,
                      [project.startDate?.slice(0, 4), project.endDate?.slice(0, 4)]
                        .filter(Boolean)
                        .join("–"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {project.fundedAmount ? (
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {formatNumber(Math.round(project.fundedAmount))} {project.currency || ""}
                    </span>
                  ) : null}
                  {project.funderShortname === "EC" && project.code && (
                    <a
                      href={`https://cordis.europa.eu/project/id/${project.code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-xs"
                    >
                      CORDIS <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {org.projectCount > org.projects.length && (
          <div className="text-xs text-gray-500 mt-3">
            Showing top {org.projects.length} of {formatNumber(org.projectCount)} projects by
            funded amount.
          </div>
        )}
        <div className="text-xs text-gray-400 mt-2">Source: OpenAIRE Graph</div>
      </CardContent>
    </Card>
  );
}
