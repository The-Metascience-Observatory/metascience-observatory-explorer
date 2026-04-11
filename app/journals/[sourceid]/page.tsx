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
import { ArrowLeft, Loader2, Info, AlertTriangle, ExternalLink } from "lucide-react";

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
  const [meshTerms, setMeshTerms] = useState<{ meshUi: string; meshName: string; paperCount: number }[]>([]);
  const [showAllMesh, setShowAllMesh] = useState(false);

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

  // Lazy load MeSH terms
  useEffect(() => {
    async function fetchMesh() {
      try {
        const res = await fetch(`/api/journals/${sourceid}/mesh`);
        if (res.ok) {
          const data = await res.json();
          setMeshTerms(data.meshTerms || []);
        }
      } catch (e) {
        console.error("Failed to fetch MeSH terms:", e);
      }
    }
    fetchMesh();
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

  const { summary, yearlyStats, fields, impactFactors, officialMetrics, retractionStats, hijackedInfo, enrichment, predatoryInfo } = data;

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
            {/* Discontinued Journal Warning */}
            {enrichment?.is_discontinued && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                      Discontinued Journal
                    </h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      {enrichment.discontinued_for_quality
                        ? "This journal has been discontinued by Scopus due to quality issues."
                        : "This journal is no longer active in Scopus."}
                    </p>
                    {enrichment.coverage && (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                        Indexed in Scopus: {enrichment.coverage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Hijacked Journal Warning */}
            {hijackedInfo && (
              <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-red-800 dark:text-red-200">
                      Hijacked Journal Warning
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                      This journal has been identified as hijacked by Retraction Watch.
                      A hijacked journal uses the identity of a legitimate journal to deceive authors.
                    </p>
                    {hijackedInfo.original_title && (
                      <p className="text-sm text-red-700 dark:text-red-300 mt-2">
                        <strong>Original journal:</strong> {hijackedInfo.original_title}
                        {hijackedInfo.original_url && (
                          <> (<a href={hijackedInfo.original_url} target="_blank" rel="noopener noreferrer"
                                className="underline hover:no-underline">legitimate site</a>)</>
                        )}
                      </p>
                    )}
                    <a
                      href="https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-red-600 dark:text-red-400 hover:underline mt-2"
                    >
                      Learn more about hijacked journals
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Predatory Journal Warning */}
            {predatoryInfo && (
              <div className="mb-4 bg-orange-50 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-orange-800 dark:text-orange-200">
                      {predatoryInfo.confidence === 'exact'
                        ? "Potential Predatory Journal"
                        : "Published by Potential Predatory Publisher"}
                    </h3>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                      {predatoryInfo.confidence === 'exact'
                        ? "This journal appears on Beall\u2019s List of potential predatory journals."
                        : <>This journal&apos;s publisher (<strong>{predatoryInfo.publisher}</strong>) appears on Beall&apos;s List of potential predatory publishers.</>}
                    </p>
                    <a
                      href="https://beallslist.net/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:underline mt-2"
                    >
                      Learn more about Beall&apos;s List
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Name */}
            <h1 className="text-xl font-bold mb-2 text-center">{summary.display_name}</h1>

            {/* Source type badge (if not a standard Journal) */}
            {enrichment?.source_type && enrichment.source_type !== 'Journal' && (
              <div className="text-center mb-2">
                <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                  {enrichment.source_type}
                </span>
              </div>
            )}

            {/* Publisher and badges */}
            <p className="text-sm text-gray-500 text-center mb-1">
              {summary.publisher}
              {summary.publisher && ' · '}
              {summary.is_oa ? (
                <span className="text-green-700 dark:text-green-400">Open Access</span>
              ) : (
                <span className="text-gray-400">Not Open Access</span>
              )}
              {enrichment?.is_medline && (
                <span className="ml-2 text-blue-600 dark:text-blue-400">· Medline</span>
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
              {(summary.first_year || summary.last_year) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Years Active</span>
                  <span className="font-semibold">{summary.first_year || "?"}–{summary.last_year || "?"}</span>
                </div>
              )}
              {formatIssn(summary.issn) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">ISSN</span>
                  <span className="font-semibold">{formatIssn(summary.issn)}</span>
                </div>
              )}
              {enrichment?.eissn && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">EISSN</span>
                  <span className="font-semibold">{enrichment.eissn}</span>
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

            {/* Retraction Statistics */}
            {retractionStats && (retractionStats.totalRetractions > 0 || retractionStats.totalConcerns > 0) && (
              <div className="border-t pt-4">
                <div className="text-sm font-medium mb-2">Retraction Statistics</div>
                <div className="space-y-2">
                  {retractionStats.totalRetractions > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Retractions</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        {formatNumber(retractionStats.totalRetractions)}
                      </span>
                    </div>
                  )}
                  {retractionStats.totalConcerns > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Expressions of Concern</span>
                      <span className="font-semibold text-orange-600 dark:text-orange-400">
                        {formatNumber(retractionStats.totalConcerns)}
                      </span>
                    </div>
                  )}
                  {retractionStats.totalCorrections > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Corrections</span>
                      <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                        {formatNumber(retractionStats.totalCorrections)}
                      </span>
                    </div>
                  )}
                  {retractionStats.totalReinstatements > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Reinstatements</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        {formatNumber(retractionStats.totalReinstatements)}
                      </span>
                    </div>
                  )}
                  {retractionStats.retractionRate !== null && retractionStats.papersSince2010 && (
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm text-gray-500 cursor-help border-b border-dotted border-gray-400"
                        title={`Rate calculated as retractions / papers published since 2010 (${formatNumber(retractionStats.papersSince2010)} papers)`}
                      >
                        Retraction Rate
                      </span>
                      <span className="font-semibold">
                        {retractionStats.retractionRate < 0.01
                          ? "<0.01%"
                          : `${retractionStats.retractionRate.toFixed(2)}%`}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Based on <a href="https://retractionwatch.com" target="_blank" rel="noopener noreferrer" className="hover:underline">Retraction Watch</a> data.
                  {retractionStats.firstRetractionYear && retractionStats.lastRetractionYear && (
                    <span> Tracked {retractionStats.firstRetractionYear}–{retractionStats.lastRetractionYear}.</span>
                  )}
                </p>
              </div>
            )}

            {/* Publishing Details from Scopus/DOAJ */}
            {enrichment && (enrichment.license_type || enrichment.apc_amount || (enrichment.languages && enrichment.languages.length > 0)) && (
              <div className="border-t pt-4">
                <div className="text-sm font-medium mb-2">Publishing Details</div>
                <div className="space-y-2">
                  {enrichment.license_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">License</span>
                      <span className="font-semibold">{enrichment.license_type}</span>
                    </div>
                  )}
                  {enrichment.apc_amount !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">APC</span>
                      <span className="font-semibold">
                        {enrichment.apc_currency === 'USD' ? '$' : ''}
                        {enrichment.apc_currency === 'EUR' ? '€' : ''}
                        {enrichment.apc_currency === 'GBP' ? '£' : ''}
                        {formatNumber(enrichment.apc_amount)}
                        {enrichment.apc_currency && !['USD', 'EUR', 'GBP'].includes(enrichment.apc_currency) ? ` ${enrichment.apc_currency}` : ''}
                        {enrichment.apc_year ? ` (${enrichment.apc_year})` : ''}
                      </span>
                    </div>
                  )}
                  {enrichment.languages && enrichment.languages.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Languages</span>
                      <span className="font-semibold text-right max-w-[180px]">
                        {enrichment.languages.slice(0, 3).join(', ')}
                        {enrichment.languages.length > 3 && ` +${enrichment.languages.length - 3}`}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Data from {enrichment.data_source === 'both' ? 'Scopus & DOAJ' : enrichment.data_source === 'scopus' ? 'Scopus' : 'DOAJ'}.
                </p>
              </div>
            )}

            {/* Title History (if journal has successors/predecessors) */}
            {enrichment?.title_history && enrichment.related_titles && enrichment.related_titles.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-medium mb-2">Title History</div>
                <div className="space-y-2">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    <span className="text-gray-500">{enrichment.title_history}:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {enrichment.related_titles.map((title, idx) => (
                      <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">
                        {title}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Top MeSH Terms */}
            {meshTerms.length > 0 && (() => {
              const displayedMesh = showAllMesh ? meshTerms : meshTerms.slice(0, 10);
              return (
                <div className="border-t pt-4">
                  <div className="text-sm font-medium mb-2">Top MeSH Terms</div>
                  <div className="flex flex-wrap gap-1.5">
                    {displayedMesh.map((term) => (
                      <Link
                        key={term.meshUi}
                        href={`/mesh/${term.meshUi}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors"
                      >
                        {term.meshName}
                        <span className="text-teal-400">({formatNumber(term.paperCount)})</span>
                      </Link>
                    ))}
                    {meshTerms.length > 10 && !showAllMesh && (
                      <button
                        onClick={() => setShowAllMesh(true)}
                        className="text-xs text-blue-600 hover:underline px-1"
                      >
                        +{meshTerms.length - 10} more
                      </button>
                    )}
                    {meshTerms.length > 10 && showAllMesh && (
                      <button
                        onClick={() => setShowAllMesh(false)}
                        className="text-xs text-blue-600 hover:underline px-1"
                      >
                        show less
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

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
