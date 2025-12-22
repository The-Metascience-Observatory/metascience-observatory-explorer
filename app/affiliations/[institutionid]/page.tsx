"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AffiliationDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Users,
  Handshake,
  Building2,
  ChevronDown,
} from "lucide-react";

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

export default function AffiliationDetailPage() {
  const params = useParams();
  const institutionid = params.institutionid as string;

  const [data, setData] = useState<AffiliationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllResearchers, setShowAllResearchers] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/affiliations/${institutionid}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load affiliation");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [institutionid]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading institution details...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Institution not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run with affiliation data.
          </p>
        </div>
      </div>
    );
  }

  const { summary, topResearchers, topCollaborators, childInstitutions, parentInstitution } = data;
  const typeColor = summary.type ? typeColors[summary.type] || typeColors.other : typeColors.other;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Infobox */}
      <Card className="mb-8 max-w-md">
        <CardContent className="pt-6">
          {/* Name */}
          <h1 className="text-xl font-bold mb-2 text-center">{summary.display_name}</h1>

          {/* Type badge */}
          {summary.type && (
            <div className="flex justify-center mb-2">
              <span className={`px-3 py-1 text-sm rounded-full ${typeColor}`}>
                {summary.type}
              </span>
            </div>
          )}

          {/* Country */}
          {summary.country_code && (
            <p className="text-sm text-gray-500 text-center mb-2">
              {summary.country_code}
            </p>
          )}

          {/* Parent Institution */}
          {parentInstitution && parentInstitution.display_name && (
            <p className="text-sm text-gray-500 text-center mb-2">
              Part of{" "}
              <Link
                href={`/affiliations/${parentInstitution.institution_id}`}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {parentInstitution.display_name}
              </Link>
            </p>
          )}

          <p className="text-xs text-gray-400 mb-4 text-center">Data up to Jan 2025</p>

          {/* Key stats */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Publications</span>
              <span className="font-semibold">{formatNumber(summary.productivity)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Citations</span>
              <span className="font-semibold">{formatNumber(summary.total_citations)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">h-index</span>
              <span className="font-semibold">{summary.h_index || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Researchers</span>
              <span className="font-semibold">{formatNumber(summary.researcher_count)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Years Active</span>
              <span className="font-semibold">
                {summary.first_year && summary.last_year
                  ? `${summary.first_year}–${summary.last_year}`
                  : "—"}
              </span>
            </div>
          </div>

          {/* External Links */}
          {(summary.ror || summary.homepage_url) && (
            <div className="border-t pt-4">
              <div className="flex flex-col gap-2">
                {summary.ror && (
                  <a
                    href={`https://ror.org/${summary.ror}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    ROR Registry
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {summary.homepage_url && (
                  <a
                    href={summary.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Institution Website
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Researchers */}
      {topResearchers.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Top Researchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(showAllResearchers ? topResearchers : topResearchers.slice(0, 10)).map((researcher, idx) => (
                <Link
                  key={`${researcher.authorid}-${idx}`}
                  href={`/persons/${researcher.authorid}`}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <div>
                      <div className="font-medium">
                        {researcher.display_name || "Unknown Researcher"}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium">h-index: {researcher.h_index || "—"}</div>
                      <div className="text-gray-500">{formatNumber(researcher.paper_count)} papers</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            {topResearchers.length > 10 && !showAllResearchers && (
              <button
                onClick={() => setShowAllResearchers(true)}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
                Show {topResearchers.length - 10} more researchers
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Subinstitutions */}
      {childInstitutions && childInstitutions.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Subinstitutions ({childInstitutions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {childInstitutions.map((child, idx) => {
                const childTypeColor = child.type ? typeColors[child.type] || typeColors.other : typeColors.other;
                return (
                  <Link
                    key={`${child.institution_id}-${idx}`}
                    href={`/affiliations/${child.institution_id}`}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <div>
                        <div className="font-medium">
                          {child.display_name || child.institution_id}
                        </div>
                        {child.country_code && (
                          <div className="text-sm text-gray-500">
                            {child.country_code}
                          </div>
                        )}
                      </div>
                      {child.type && (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${childTypeColor}`}>
                          {child.type}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Collaborators */}
      {topCollaborators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Handshake className="h-5 w-5" />
              Top Collaborating Institutions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCollaborators.map((collaborator, idx) => (
                <Link
                  key={`${collaborator.institution_id}-${idx}`}
                  href={`/affiliations/${collaborator.institution_id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <div>
                      <div className="font-medium">
                        {collaborator.display_name || collaborator.institution_id}
                      </div>
                      {collaborator.country_code && (
                        <div className="text-sm text-gray-500">
                          {collaborator.country_code}
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatNumber(collaborator.joint_papers)} joint papers
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
