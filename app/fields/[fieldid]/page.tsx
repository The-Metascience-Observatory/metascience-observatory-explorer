"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Users, BookOpen, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperTitle } from "@/components/PaperTitle";
import type { FieldDetails } from "@/lib/types";

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "N/A";
  return num.toLocaleString();
}

export default function FieldDetailPage({
  params,
}: {
  params: Promise<{ fieldid: string }>;
}) {
  const { fieldid } = use(params);
  const [data, setData] = useState<FieldDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/fields/${fieldid}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Field not found");
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (json.error) {
          throw new Error(json.error);
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load field data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [fieldid]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading field data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="text-center py-12">
          <p className="text-red-600">{error}</p>
          <p className="text-sm text-gray-500 mt-2">
            Make sure the preprocessing script has been run.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, topPapers, topAuthors, topCitedPapers } = data;
  const levelLabel = summary.level === 0 ? "Broad Field" : "Subfield";
  const levelColor = summary.level === 0 ? "blue" : "purple";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-8 w-8 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900">
            {summary.display_name}
          </h1>
        </div>
        <span
          className={`inline-block px-2 py-0.5 text-xs font-medium rounded bg-${levelColor}-100 text-${levelColor}-700`}
        >
          {levelLabel}
        </span>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Papers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatNumber(summary.paper_count)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Citations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatNumber(summary.total_citations)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Authors */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Top Authors by Paper Count
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topAuthors.length === 0 ? (
              <p className="text-sm text-gray-500">No author data available</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {topAuthors.map((author, idx) => (
                  <Link
                    key={author.authorid}
                    href={`/persons/${author.authorid}`}
                    className="flex items-center justify-between p-2 rounded hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 w-6">
                        {idx + 1}.
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {author.display_name || "Unknown"}
                        </p>
                        {author.h_index && (
                          <p className="text-xs text-gray-500">
                            h-index: {author.h_index}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-gray-600">
                      {formatNumber(author.paper_count)} papers
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Cited Papers - Field Normalized */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Highest Impact Papers
              <span className="text-xs font-normal text-gray-400 ml-1">(field-normalized)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCitedPapers.length === 0 ? (
              <p className="text-sm text-gray-500">
                No field-normalized citation data available.
                {topPapers.length === 0 && " Run preprocessing with normalized_citations parquet files."}
              </p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {topCitedPapers.map((paper, idx) => (
                  <Link
                    key={paper.paperid}
                    href={`/papers/${paper.paperid}`}
                    className="block p-2 rounded border border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-gray-400 mt-0.5">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                          {paper.title ? <PaperTitle title={paper.title} /> : "Untitled"}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          {paper.year && <span>{paper.year}</span>}
                          {paper.source_name && (
                            <>
                              <span>•</span>
                              <span className="truncate">{paper.source_name}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs font-medium text-emerald-600">
                            {paper.normalized_citations.toFixed(1)}x field average
                          </span>
                          <span className="text-xs text-gray-500">
                            ({formatNumber(paper.citation_count)} citations)
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
