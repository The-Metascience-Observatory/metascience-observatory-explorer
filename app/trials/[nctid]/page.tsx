"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrialDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  FileText,
  FlaskConical,
  BookOpen,
  ArrowUpDown,
} from "lucide-react";

export default function TrialDetailPage() {
  const params = useParams();
  const nctid = params.nctid as string;

  const [data, setData] = useState<TrialDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paperSortBy, setPaperSortBy] = useState<"citations" | "year">("citations");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/trials/${nctid}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load trial");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [nctid]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading trial details...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Trial not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run with clinical trials data.
          </p>
        </div>
      </div>
    );
  }

  const { summary, papers } = data;

  // Separate papers by reference type
  const resultPapers = papers.filter(p => p.reference_type === "RESULT");
  const derivedPapers = papers.filter(p => p.reference_type === "DERIVED");
  const backgroundPapers = papers.filter(p => p.reference_type === "BACKGROUND");
  const otherPapers = papers.filter(p => !p.reference_type || !["RESULT", "DERIVED", "BACKGROUND"].includes(p.reference_type));

  // Sort papers
  const sortPapers = (papers: typeof data.papers) => {
    return [...papers].sort((a, b) => {
      if (paperSortBy === "citations") {
        return (b.cited_by_count || 0) - (a.cited_by_count || 0);
      } else {
        return (b.year || 0) - (a.year || 0);
      }
    });
  };

  const renderPaperSection = (title: string, sectionPapers: typeof papers, icon: React.ReactNode, badgeColor: string) => {
    if (sectionPapers.length === 0) return null;

    return (
      <div className="mb-6">
        <h3 className="flex items-center gap-2 text-md font-medium mb-3">
          {icon}
          {title}
          <span className={`px-2 py-0.5 ${badgeColor} rounded text-xs`}>
            {sectionPapers.length}
          </span>
        </h3>
        <div className="divide-y dark:divide-gray-800">
          {sortPapers(sectionPapers).map((paper, idx) => (
            <Link
              key={`${paper.paperid}-${idx}`}
              href={`/papers/${paper.paperid}`}
              className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium line-clamp-2">
                    {paper.title || "Untitled"}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {paper.year && <span>{paper.year}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 tabular-nums">
                  <span className="text-sm text-gray-500">
                    {formatNumber(paper.cited_by_count)} citations
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Main layout: Infobox left, Papers right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* NCT ID */}
            <h1 className="text-2xl font-bold mb-4">{summary.nct_id}</h1>

            <p className="text-xs text-gray-400 mb-4">Data up to Jan 2025</p>

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Papers</span>
                <span className="font-semibold">{formatNumber(summary.paper_count)}</span>
              </div>
              {summary.result_paper_count !== null && summary.result_paper_count > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Result Papers</span>
                  <span className="font-semibold">{formatNumber(summary.result_paper_count)}</span>
                </div>
              )}
              {summary.derived_paper_count !== null && summary.derived_paper_count > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Derived Papers</span>
                  <span className="font-semibold">{formatNumber(summary.derived_paper_count)}</span>
                </div>
              )}
              {summary.background_paper_count !== null && summary.background_paper_count > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Background Papers</span>
                  <span className="font-semibold">{formatNumber(summary.background_paper_count)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Citations</span>
                <span className="font-semibold">{formatNumber(summary.total_citations)}</span>
              </div>
              {summary.first_year && summary.last_year && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Publication Years</span>
                  <span className="font-semibold">
                    {summary.first_year === summary.last_year
                      ? summary.first_year
                      : `${summary.first_year}–${summary.last_year}`}
                  </span>
                </div>
              )}
            </div>

            {/* External Link to ClinicalTrials.gov */}
            <div className="border-t pt-4">
              <a
                href={`https://clinicaltrials.gov/study/${summary.nct_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                <FlaskConical className="h-4 w-4" />
                View on ClinicalTrials.gov
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Right: Papers */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Associated Papers ({papers.length})
              </CardTitle>
              <div className="flex items-center gap-1">
                <ArrowUpDown className="h-4 w-4 text-gray-400" />
                <button
                  onClick={() => setPaperSortBy("citations")}
                  className={`px-2 py-1 text-sm rounded transition-colors ${
                    paperSortBy === "citations"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                      : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  Citations
                </button>
                <button
                  onClick={() => setPaperSortBy("year")}
                  className={`px-2 py-1 text-sm rounded transition-colors ${
                    paperSortBy === "year"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                      : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  Year
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {papers.length === 0 ? (
              <p className="text-gray-500 text-sm">No papers associated with this trial</p>
            ) : (
              <div className="max-h-[700px] overflow-y-auto">
                {renderPaperSection(
                  "Result Papers",
                  resultPapers,
                  <FileText className="h-4 w-4 text-green-600" />,
                  "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                )}
                {renderPaperSection(
                  "Derived Papers",
                  derivedPapers,
                  <FileText className="h-4 w-4 text-blue-600" />,
                  "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                )}
                {renderPaperSection(
                  "Background Papers",
                  backgroundPapers,
                  <FileText className="h-4 w-4 text-gray-600" />,
                  "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                )}
                {renderPaperSection(
                  "Other Papers",
                  otherPapers,
                  <FileText className="h-4 w-4 text-purple-600" />,
                  "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
