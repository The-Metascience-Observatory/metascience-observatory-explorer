"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { CitationsChart } from "@/components/CitationsChart";
import { ImpactFactorChart } from "@/components/ImpactFactorChart";
import { FieldBadges } from "@/components/FieldBadges";
import type { JournalDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { ArrowLeft, Loader2, Info } from "lucide-react";

// Format ISSN which may be a JSON array string or a plain string
function formatIssn(issn: string | null): string | null {
  if (!issn) return null;
  try {
    const parsed = JSON.parse(issn);
    if (Array.isArray(parsed)) {
      return parsed.join(", ");
    }
    return String(parsed);
  } catch {
    return issn;
  }
}

// Extract root URL from a full URL (e.g., "http://www.sciencemag.org/foo" -> "sciencemag.org")
function getRootUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function JournalDetailPage() {
  const params = useParams();
  const sourceid = params.sourceid as string;

  const [data, setData] = useState<JournalDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/journals/${sourceid}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load journal");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [sourceid]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading journal details...</span>
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
          <p className="text-red-600 text-lg">{error || "Journal not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run.
          </p>
        </div>
      </div>
    );
  }

  const { summary, yearlyStats, fields, impactFactors, officialMetrics } = data;

  // Get most recent computed metrics
  const latestIF = impactFactors && impactFactors.length > 0
    ? impactFactors[impactFactors.length - 1]
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Main layout: Infobox left, Charts right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Name */}
            <h1 className="text-xl font-bold mb-2 text-center">{summary.display_name}</h1>

            {/* Publisher and Open Access badge */}
            <p className="text-sm text-gray-500 text-center mb-1">
              {summary.publisher}
              {summary.publisher && ' · '}
              {summary.is_oa ? (
                <span className="text-green-700 dark:text-green-400">Open Access</span>
              ) : (
                <span className="text-gray-400">Not Open Access</span>
              )}
            </p>
            {/* Website URL */}
            {summary.homepage_url && (
              <p className="text-sm text-center mb-1">
                <a
                  href={summary.homepage_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {getRootUrl(summary.homepage_url)}
                </a>
              </p>
            )}
            <p className="text-xs text-gray-400 mb-4 text-center">Data up to Jan 2025</p>

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Papers</span>
                <span className="font-semibold">{formatNumber(summary.total_papers)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Citations</span>
                <span className="font-semibold">{formatNumber(summary.total_citations)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">First Year</span>
                <span className="font-semibold">{summary.first_year || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Last Year</span>
                <span className="font-semibold">{summary.last_year || "—"}</span>
              </div>
              {formatIssn(summary.issn) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">ISSN</span>
                  <span className="font-semibold">{formatIssn(summary.issn)}</span>
                </div>
              )}
            </div>

            {/* Primary fields */}
            {(summary.primary_field_l0_name || summary.primary_field_l1_name) && (
              <div className="border-t pt-4 mb-4">
                <div className="text-sm font-medium mb-2">Primary Fields</div>
                <div className="flex flex-wrap gap-2">
                  {summary.primary_field_l0_name && summary.primary_field_l0_id && (
                    <Link
                      href={`/fields/${summary.primary_field_l0_id}`}
                      className="px-3 py-1 text-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    >
                      {summary.primary_field_l0_name}
                    </Link>
                  )}
                  {summary.primary_field_l1_name && summary.primary_field_l1_id && (
                    <Link
                      href={`/fields/${summary.primary_field_l1_id}`}
                      className="px-3 py-1 text-sm bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors"
                    >
                      {summary.primary_field_l1_name}
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Impact Metrics */}
            {(latestIF || officialMetrics) && (
              <div className="border-t pt-4">
                <div className="text-sm font-medium mb-2">Impact Metrics</div>
                <div className="space-y-2">
                  {/* Official CiteScore from Scopus (if available) */}
                  {officialMetrics?.scopus_citescore && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">
                        CiteScore {officialMetrics.scopus_citescore_year}
                        <span className="ml-1 text-xs text-green-600">(official)</span>
                      </span>
                      <span className="font-semibold">{officialMetrics.scopus_citescore.toFixed(1)}</span>
                    </div>
                  )}

                  {/* Computed metrics */}
                  {latestIF?.impact_factor_2yr !== null && latestIF?.impact_factor_2yr !== undefined && (
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm text-gray-500 cursor-help border-b border-dotted border-gray-400"
                        title="2-Year Impact Factor: Average citations received in this year by papers published in the previous 2 years. Higher values indicate greater citation impact."
                      >
                        2-Year IF ({latestIF.year})
                      </span>
                      <span className="font-semibold">{latestIF.impact_factor_2yr.toFixed(2)}</span>
                    </div>
                  )}
                  {latestIF?.impact_factor_5yr !== null && latestIF?.impact_factor_5yr !== undefined && (
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm text-gray-500 cursor-help border-b border-dotted border-gray-400"
                        title="5-Year Impact Factor: Average citations received in this year by papers published in the previous 5 years. Provides a longer-term view of citation impact."
                      >
                        5-Year IF ({latestIF.year})
                      </span>
                      <span className="font-semibold">{latestIF.impact_factor_5yr.toFixed(2)}</span>
                    </div>
                  )}
                  {latestIF?.citescore !== null && latestIF?.citescore !== undefined && (
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm text-gray-500 cursor-help border-b border-dotted border-gray-400"
                        title="CiteScore: Average citations received per document over a 4-year period. Similar to Impact Factor but uses a 4-year window instead of 2."
                      >
                        CiteScore ({latestIF.year})
                      </span>
                      <span className="font-semibold">{latestIF.citescore.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Metrics computed from OpenAlex data unless marked (official).
                </p>
              </div>
            )}

          </CardContent>
        </Card>

        {/* Right: Charts stacked */}
        <div className="space-y-6">
          {impactFactors && impactFactors.length > 0 && (
            <Card>
              <CardHeader className="py-4 px-5 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Impact Metrics Over Time</CardTitle>
                  <span title="Computed from OpenAlex citation data">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-4 pt-0">
                <ImpactFactorChart data={impactFactors} />
              </CardContent>
            </Card>
          )}
          {yearlyStats.length > 0 && (
            <>
              <Card>
                <CardHeader className="py-4 px-5 pb-2">
                  <CardTitle className="text-base">Publications Over Time</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <PublicationsChart data={yearlyStats} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-4 px-5 pb-2">
                  <CardTitle className="text-base">Total Citations by Publication Year</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <CitationsChart data={yearlyStats} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Field distribution */}
      {fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Field Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldBadges fields={fields} sourceid={sourceid} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
