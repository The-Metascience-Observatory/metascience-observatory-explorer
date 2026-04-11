"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2, AlertTriangle, Info } from "lucide-react";
import type { ScopusOnlyJournal } from "@/app/api/journals/scopus/[scopusid]/route";

export default function ScopusOnlyJournalPage() {
  const params = useParams();
  const scopusid = params.scopusid as string;

  const [data, setData] = useState<ScopusOnlyJournal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/journals/scopus/${scopusid}`);
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
  }, [scopusid]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading journal details...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <Link
          href="/journals"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to journals
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Journal not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Back link */}
      <Link
        href="/journals"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to journals
      </Link>

      {/* Scopus-only notice */}
      <div className="mb-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span>This journal has metadata from Scopus only. Publication and citation data is not available.</span>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Discontinued Journal Warning */}
          {data.is_discontinued && (
            <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                    Discontinued Journal
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    {data.discontinued_for_quality
                      ? "This journal has been discontinued by Scopus due to quality issues."
                      : "This journal is no longer active in Scopus."}
                  </p>
                  {data.coverage && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                      Indexed in Scopus: {data.coverage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Name */}
          <h1 className="text-xl font-bold mb-2 text-center">{data.display_name}</h1>

          {/* Source type badge (if not a standard Journal) */}
          {data.source_type && data.source_type !== 'Journal' && (
            <div className="text-center mb-2">
              <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                {data.source_type}
              </span>
            </div>
          )}

          {/* Publisher and badges */}
          <p className="text-sm text-gray-500 text-center mb-1">
            {data.publisher}
            {data.is_medline && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">· Medline</span>
            )}
          </p>

          {data.open_access_status && (
            <p className="text-sm text-gray-500 text-center mb-4">
              <span className="text-green-700 dark:text-green-400">{data.open_access_status}</span>
            </p>
          )}

          {/* Key stats */}
          <div className="space-y-3 mb-6 mt-4">
            {data.issn && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">ISSN</span>
                <span className="font-semibold">{data.issn}</span>
              </div>
            )}
            {data.eissn && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">EISSN</span>
                <span className="font-semibold">{data.eissn}</span>
              </div>
            )}
            {data.languages && data.languages.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Languages</span>
                <span className="font-semibold text-right max-w-[200px]">
                  {data.languages.slice(0, 3).join(', ')}
                  {data.languages.length > 3 && ` +${data.languages.length - 3}`}
                </span>
              </div>
            )}
          </div>

          {/* Subject Areas */}
          {data.top_level_categories && Object.keys(data.top_level_categories).length > 0 && (
            <div className="border-t pt-4 mb-4">
              <div className="text-sm font-medium mb-2">Subject Areas</div>
              <div className="flex flex-wrap gap-2">
                {data.top_level_categories.life_sciences && (
                  <span className="px-3 py-1 text-sm bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                    Life Sciences
                  </span>
                )}
                {data.top_level_categories.health_sciences && (
                  <span className="px-3 py-1 text-sm bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                    Health Sciences
                  </span>
                )}
                {data.top_level_categories.physical_sciences && (
                  <span className="px-3 py-1 text-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full">
                    Physical Sciences
                  </span>
                )}
                {data.top_level_categories.social_sciences && (
                  <span className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded-full">
                    Social Sciences
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ASJC Codes */}
          {data.asjc_codes && data.asjc_codes.length > 0 && (
            <div className="border-t pt-4 mb-4">
              <div className="text-sm font-medium mb-2">ASJC Subject Codes</div>
              <div className="flex flex-wrap gap-1.5">
                {data.asjc_codes.slice(0, 10).map((code, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded"
                  >
                    {code}
                  </span>
                ))}
                {data.asjc_codes.length > 10 && (
                  <span className="text-xs text-gray-500">
                    +{data.asjc_codes.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Title History */}
          {data.title_history && data.related_titles && data.related_titles.length > 0 && (
            <div className="border-t pt-4">
              <div className="text-sm font-medium mb-2">Title History</div>
              <div className="space-y-2">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="text-gray-500">{data.title_history}:</span>
                </div>
                <ul className="list-disc list-inside space-y-1">
                  {data.related_titles.map((title, idx) => (
                    <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">
                      {title}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Data source attribution */}
          <div className="border-t pt-4 mt-4">
            <p className="text-xs text-gray-400 text-center">
              Data from Scopus Source List (Nov 2025)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
