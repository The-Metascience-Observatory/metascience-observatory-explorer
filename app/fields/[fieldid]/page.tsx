import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperTitle } from "@/components/PaperTitle";
import { JsonLd } from "@/components/JsonLd";
import { getFieldDetails, getFieldSummary } from "@/lib/queries/fields";
import { breadcrumbLd, researchFieldLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";

/**
 * Fully server-rendered: this page has no interactive state at all, so after
 * the conversion it ships zero client JS of its own. 303 fields, so it is
 * cached rather than dynamic.
 */
export const revalidate = 86400;

type Props = { params: Promise<{ fieldid: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fieldid } = await params;
  const summary = await getFieldSummary(fieldid);

  if (!summary) {
    return { title: "Research field not found", robots: { index: false, follow: false } };
  }

  const title = `${summary.display_name} Research — Papers, Top Authors & Impact`;
  const description =
    `${summary.display_name} in the SciSciNet dataset: ` +
    `${formatNumber(summary.paper_count)} papers and ` +
    `${formatNumber(summary.total_citations)} citations. ` +
    "Highest-impact work by field-normalised citations, leading authors and publication trends.";
  const canonical = `/fields/${summary.fieldid}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function FieldDetailPage({ params }: Props) {
  const { fieldid } = await params;
  const data = await getFieldDetails(fieldid);
  if (!data) notFound();

  const { summary, topPapers, topAuthors, topCitedPapers } = data;
  const isBroad = summary.level === 0;
  // Explicit class strings: Tailwind cannot generate `bg-${x}-100` at build
  // time, so the previous interpolated version rendered unstyled.
  const badgeClass = isBroad
    ? "bg-blue-100 text-blue-700"
    : "bg-purple-100 text-purple-700";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
      <JsonLd
        data={[
          researchFieldLd({
            fieldid: summary.fieldid,
            displayName: summary.display_name,
            level: summary.level,
            paperCount: summary.paper_count,
          }),
          breadcrumbLd([
            ["Research fields", "/fields"],
            [summary.display_name, `/fields/${summary.fieldid}`],
          ]),
        ]}
      />

      <Link
        href="/fields"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        All research fields
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-8 w-8 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {summary.display_name}
          </h1>
        </div>
        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-sm ${badgeClass}`}>
          {isBroad ? "Broad Field" : "Subfield"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Papers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNumber(summary.paper_count)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Citations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNumber(summary.total_citations)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
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
                    className="flex items-center justify-between p-2 rounded-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 w-6">{idx + 1}.</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {author.display_name || "Unknown"}
                        </p>
                        {author.h_index && (
                          <p className="text-xs text-gray-500">h-index: {author.h_index}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {formatNumber(author.paper_count)} papers
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Highest Impact Papers
              <span className="text-xs font-normal text-gray-400 ml-1">
                (field-normalized)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCitedPapers.length === 0 ? (
              <p className="text-sm text-gray-500">
                No field-normalized citation data available.
                {topPapers.length === 0 &&
                  " Run preprocessing with normalized_citations parquet files."}
              </p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {topCitedPapers.map((paper, idx) => (
                  <Link
                    key={paper.paperid}
                    href={`/papers/${paper.paperid}`}
                    className="block p-2 rounded-sm border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-gray-400 mt-0.5">{idx + 1}.</span>
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
