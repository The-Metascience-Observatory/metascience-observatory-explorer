"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { CitationsChart } from "@/components/CitationsChart";
import type { FunderDetails } from "@/lib/types";
import { formatNumber, getCountryName } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  Beaker,
} from "lucide-react";

// Extract root URL from a full URL (e.g., "http://www.nih.gov/foo" -> "nih.gov")
function getRootUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function FunderDetailPage() {
  const params = useParams();
  const funderid = params.funderid as string;

  const [data, setData] = useState<FunderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/funders/${funderid}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load funder");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [funderid]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading funder details...</span>
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
          <p className="text-red-600 text-lg">{error || "Funder not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run with funder data.
          </p>
        </div>
      </div>
    );
  }

  const { summary, yearlyStats, concepts } = data;

  // Convert yearlyStats to chart format (filter out 2025 since data is incomplete)
  const chartData = yearlyStats
    .filter(s => s.year < 2025)
    .map(s => ({
      year: s.year,
      paper_count: s.works_count,
      total_citations: s.cited_by_count,
    }));

  // Separate concepts by level
  const broadFields = concepts.filter(c => c.level === 0);
  const subFields = concepts.filter(c => c.level === 1);

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
            <h1 className="text-2xl font-bold mb-2">{summary.display_name}</h1>

            {/* Description */}
            {summary.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {summary.description}
              </p>
            )}

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

            <p className="text-xs text-gray-400 mb-4">Data for Jan 2012 – Jan 2025</p>

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              {summary.country_code && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Country</span>
                  <Link
                    href={`/funders-map/${summary.country_code}`}
                    className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {getCountryName(summary.country_code)}
                  </Link>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Works Funded</span>
                <span className="font-semibold">{formatNumber(summary.works_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Grants</span>
                <span className="font-semibold">{formatNumber(summary.grants_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Citations</span>
                <span className="font-semibold">{formatNumber(summary.cited_by_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">h-index</span>
                <span className="font-semibold">{summary.h_index || "—"}</span>
              </div>
              {summary.i10_index && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">i10-index</span>
                  <span className="font-semibold">{formatNumber(summary.i10_index)}</span>
                </div>
              )}
              {summary.oa_percent !== null && summary.oa_percent !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Open Access</span>
                  <span className="font-semibold">{summary.oa_percent.toFixed(1)}%</span>
                </div>
              )}
            </div>

            {/* Research Fields */}
            {concepts.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Beaker className="h-4 w-4" />
                  Top Research Fields
                </div>
                <div className="flex flex-wrap gap-2">
                  {broadFields.slice(0, 5).map((concept) => (
                    <Link
                      key={concept.fieldid}
                      href={`/fields/${concept.fieldid}`}
                      className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    >
                      {concept.field_name}
                    </Link>
                  ))}
                  {subFields.slice(0, 5).map((concept) => (
                    <Link
                      key={concept.fieldid}
                      href={`/fields/${concept.fieldid}`}
                      className="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors"
                    >
                      {concept.field_name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Charts stacked */}
        <div className="space-y-6">
          {chartData.length > 0 && (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Works Funded Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <PublicationsChart data={chartData} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Total Citations Per Yeare</CardTitle>
                  <p className="text-xs text-gray-500 mt-1">
                    Total citations received by works published in each year
                  </p>
                </CardHeader>
                <CardContent>
                  <CitationsChart data={chartData} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
