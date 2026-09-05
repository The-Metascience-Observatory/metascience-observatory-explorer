"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CitationsChart } from "@/components/CitationsChart";
import { PaperTitle } from "@/components/PaperTitle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TrialDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  BookOpen,
  ArrowUpDown,
  Users,
  Calendar,
  Building2,
  HelpCircle,
} from "lucide-react";

// Tooltips explaining paper reference types
const REFERENCE_TYPE_TOOLTIPS = {
  background: "Publications cited as background literature when the trial was registered. Added manually by study sponsors.",
  result: "Publications reporting the results of this clinical trial. Added manually by study sponsors.",
  derived: "Publications automatically linked by ClinicalTrials.gov by matching PubMed metadata with the trial registration.",
  unknown: "Publications linked to this trial without a specified reference type in the ClinicalTrials.gov data.",
};

function formatStatus(status: string | null): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Interactive shell for the trial page.
 *
 * `data` arrives as a prop from the server component rather than from a
 * useEffect fetch. That is the whole point: with no loading gate, React
 * server-renders this tree into the initial HTML, so a crawler sees the trial
 * title, conditions, sponsor and linked papers. The useState below only drives
 * sorting and the summary toggle after hydration.
 */
export default function TrialDetailClient({ data }: { data: TrialDetails }) {
  const [paperSortBy, setPaperSortBy] = useState<"citations" | "year">("citations");
  const [showFullSummary, setShowFullSummary] = useState(false);

  const { summary, papers, yearlyStats } = data;

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

  // Parse conditions and interventions (pipe-separated)
  const conditions = summary.conditions?.split("|").filter(Boolean) || [];
  const interventions = summary.interventions?.split("|").filter(Boolean) || [];

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

      {/* Main layout: Infobox left, Papers right */}
      <div className="grid lg:grid-cols-[400px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Title */}
            <div className="mb-4">
              <h1 className="text-xl font-bold leading-tight">
                {summary.title || summary.nct_id}
              </h1>
              <p className="text-sm text-gray-500 font-mono mt-1">{summary.nct_id}</p>
            </div>

            {/* Phase and Study Type */}
            {(summary.phase || summary.study_type) && (
              <div className="flex flex-wrap gap-2 mb-4">
                {summary.phase && (
                  <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded">
                    {summary.phase}
                  </span>
                )}
                {summary.study_type && (
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                    {summary.study_type}
                  </span>
                )}
              </div>
            )}

            {/* Sponsor */}
            {summary.sponsor && (
              <div className="flex items-start gap-2 mb-3 text-sm">
                <Building2 className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-gray-600 dark:text-gray-400">{summary.sponsor}</span>
              </div>
            )}

            {/* Enrollment */}
            {summary.enrollment && (
              <div className="flex items-center gap-2 mb-3 text-sm">
                <Users className="h-4 w-4 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">
                  {formatNumber(summary.enrollment)} participants
                </span>
              </div>
            )}

            {/* Dates */}
            {(summary.start_date || summary.completion_date) && (
              <div className="flex items-center gap-2 mb-3 text-sm">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">
                  {summary.start_date && `Started ${summary.start_date}`}
                  {summary.start_date && summary.completion_date && " · "}
                  {summary.completion_date && `Completed ${summary.completion_date}`}
                </span>
              </div>
            )}

            {/* Status */}
            {summary.status && (
              <div className="flex items-center gap-2 mb-4 text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  Status: {formatStatus(summary.status)} (as of 12-23-2025)
                </span>
              </div>
            )}

            {/* Conditions */}
            {conditions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Conditions</h3>
                <div className="flex flex-wrap gap-1">
                  {conditions.slice(0, 5).map((condition, idx) => (
                    <span key={idx} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                      {condition}
                    </span>
                  ))}
                  {conditions.length > 5 && (
                    <span className="px-2 py-1 text-xs text-gray-500">
                      +{conditions.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Interventions */}
            {interventions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Interventions</h3>
                <div className="flex flex-wrap gap-1">
                  {interventions.slice(0, 5).map((intervention, idx) => (
                    <Link
                      key={idx}
                      href={`/trials?intervention=${encodeURIComponent(intervention)}`}
                      className="px-2 py-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 rounded hover:bg-orange-200 dark:hover:bg-orange-800/50 transition-colors"
                    >
                      {intervention}
                    </Link>
                  ))}
                  {interventions.length > 5 && (
                    <span className="px-2 py-1 text-xs text-gray-500">
                      +{interventions.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Paper stats - always show all categories */}
            <div className="border-t pt-4 mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Linked Papers (from SciSciNet-V2)</h3>
              <TooltipProvider>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Total Papers</span>
                    <span className="font-semibold">{formatNumber(summary.paper_count)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Background</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-gray-400" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm">
                          <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.background}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-semibold">{formatNumber(summary.background_paper_count ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Result</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-gray-400" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm">
                          <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.result}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-semibold">{formatNumber(summary.result_paper_count ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Derived</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-gray-400" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm">
                          <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.derived}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-semibold">{formatNumber(summary.derived_paper_count ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">Unknown</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-gray-400" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm">
                          <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.unknown}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-semibold">{formatNumber(summary.unknown_paper_count ?? 0)}</span>
                  </div>
                </div>
              </TooltipProvider>
            </div>

            {/* External Link to ClinicalTrials.gov */}
            <div className="border-t pt-4">
              <a
                href={`https://clinicaltrials.gov/study/${summary.nct_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                View on ClinicalTrials.gov
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Right: Citations chart, then Brief Summary */}
        <div className="space-y-6">
          {/* Citations over time chart */}
          {yearlyStats && yearlyStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Total Citations Per Year</CardTitle>
              </CardHeader>
              <CardContent>
                <CitationsChart data={yearlyStats} />
              </CardContent>
            </Card>
          )}

          {/* Brief Summary Card */}
          {summary.brief_summary && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Brief Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${showFullSummary ? "" : "line-clamp-[10]"}`}>
                  {summary.brief_summary}
                </p>
                {summary.brief_summary.length > 800 && (
                  <button
                    onClick={() => setShowFullSummary(!showFullSummary)}
                    className="text-blue-600 hover:text-blue-800 text-sm mt-2"
                  >
                    {showFullSummary ? "Show less" : "Show more"}
                  </button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Associated Papers - separate cards for each type */}
      {papers.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-gray-500">
              <BookOpen className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No papers linked to this trial in SciSciNet</p>
              <p className="text-xs mt-1">
                Visit ClinicalTrials.gov for more information about this study
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Sort controls */}
          <div className="flex items-center gap-2 justify-end">
            <span className="text-sm text-gray-500">Sort by:</span>
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

          {/* Background Papers Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-gray-600" />
                Background Papers
                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 rounded text-sm font-normal">
                  {backgroundPapers.length}
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-gray-400" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm">
                    <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.background}</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {backgroundPapers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No background papers linked</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {sortPapers(backgroundPapers).map((paper, idx) => (
                    <Link
                      key={`${paper.paperid}-${idx}`}
                      href={`/papers/${paper.paperid}`}
                      className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-2">{paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}</div>
                          <div className="text-sm text-gray-500 mt-1">{paper.year && <span>{paper.year}</span>}</div>
                        </div>
                        <div className="text-right flex-shrink-0 tabular-nums">
                          <span className="text-sm text-gray-500">{formatNumber(paper.cited_by_count)} citations</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Result Papers Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-green-600" />
                Result Papers
                <span className="px-2 py-0.5 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded text-sm font-normal">
                  {resultPapers.length}
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-gray-400" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm">
                    <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.result}</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resultPapers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No result papers linked</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {sortPapers(resultPapers).map((paper, idx) => (
                    <Link
                      key={`${paper.paperid}-${idx}`}
                      href={`/papers/${paper.paperid}`}
                      className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-2">{paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}</div>
                          <div className="text-sm text-gray-500 mt-1">{paper.year && <span>{paper.year}</span>}</div>
                        </div>
                        <div className="text-right flex-shrink-0 tabular-nums">
                          <span className="text-sm text-gray-500">{formatNumber(paper.cited_by_count)} citations</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Derived Papers Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-blue-600" />
                Derived Papers
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded text-sm font-normal">
                  {derivedPapers.length}
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-gray-400" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm">
                    <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.derived}</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {derivedPapers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No derived papers linked</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {sortPapers(derivedPapers).map((paper, idx) => (
                    <Link
                      key={`${paper.paperid}-${idx}`}
                      href={`/papers/${paper.paperid}`}
                      className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-2">{paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}</div>
                          <div className="text-sm text-gray-500 mt-1">{paper.year && <span>{paper.year}</span>}</div>
                        </div>
                        <div className="text-right flex-shrink-0 tabular-nums">
                          <span className="text-sm text-gray-500">{formatNumber(paper.cited_by_count)} citations</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unknown Papers Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-purple-600" />
                Unknown Papers
                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded text-sm font-normal">
                  {otherPapers.length}
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-gray-400" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm">
                    <p className="text-xs">{REFERENCE_TYPE_TOOLTIPS.unknown}</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {otherPapers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No unknown papers linked</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {sortPapers(otherPapers).map((paper, idx) => (
                    <Link
                      key={`${paper.paperid}-${idx}`}
                      href={`/papers/${paper.paperid}`}
                      className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-2">{paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}</div>
                          <div className="text-sm text-gray-500 mt-1">{paper.year && <span>{paper.year}</span>}</div>
                        </div>
                        <div className="text-right flex-shrink-0 tabular-nums">
                          <span className="text-sm text-gray-500">{formatNumber(paper.cited_by_count)} citations</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
