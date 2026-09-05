import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Beaker } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { CitationsChart } from "@/components/CitationsChart";
import { JsonLd } from "@/components/JsonLd";
import { getFunderDetails, getFunderSummary } from "@/lib/queries/funders";
import { breadcrumbLd, organizationLd } from "@/lib/jsonld";
import { stripInlineHtml, truncate } from "@/lib/sanitize";
import { formatNumber, getCountryName } from "@/lib/utils";

/** ~32k funders — a bounded, fully indexable set, so cache rather than force dynamic. */
export const revalidate = 86400;

type Props = { params: Promise<{ funderid: string }> };

/** "http://www.nih.gov/foo" -> "nih.gov" */
function getRootUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { funderid } = await params;
  const summary = await getFunderSummary(funderid);

  if (!summary) {
    return { title: "Funder not found", robots: { index: false, follow: false } };
  }

  const country = summary.country_code ? getCountryName(summary.country_code) : null;
  const title = `${summary.display_name} — Funded Publications & Research Impact`;
  // The dataset carries a real description for many funders; prefer it.
  const description = summary.description
    ? truncate(stripInlineHtml(summary.description), 200)
    : `${summary.display_name}${country ? ` (${country})` : ""}: ` +
      `${formatNumber(summary.grants_count)} grants supporting ` +
      `${formatNumber(summary.works_count)} publications with ` +
      `${formatNumber(summary.cited_by_count)} citations (h-index ${summary.h_index ?? "n/a"}). ` +
      "Funding trends and supported research.";
  const canonical = `/funders/${summary.funderid}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function FunderDetailPage({ params }: Props) {
  const { funderid } = await params;
  const data = await getFunderDetails(funderid);
  if (!data) notFound();

  const { summary, yearlyStats, concepts } = data;

  // 2025 is a partial year in this snapshot and would render as a false cliff.
  const chartData = yearlyStats
    .filter((s) => s.year < 2025)
    .map((s) => ({
      year: s.year,
      paper_count: s.works_count,
      total_citations: s.cited_by_count,
    }));

  const broadFields = concepts.filter((c) => c.level === 0);
  const subFields = concepts.filter((c) => c.level === 1);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-hidden">
      <JsonLd
        data={[
          organizationLd({
            id: summary.funderid,
            path: `/funders/${summary.funderid}`,
            name: summary.display_name,
            // Plain Organization rather than schema.org's FundingAgency: the
            // latter is still a pending-extension type and trips warnings in
            // the Rich Results Test for no added benefit.
            type: "Organization",
            countryCode: summary.country_code,
            homepageUrl: summary.homepage_url,
            description: summary.description,
          }),
          breadcrumbLd([
            ["Funders", "/funders"],
            [summary.display_name, `/funders/${summary.funderid}`],
          ]),
        ]}
      />

      <Link
        href="/funders"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        All funders
      </Link>

      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-2">{summary.display_name}</h1>

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
                  <CardTitle className="text-base">Total Citations Per Year</CardTitle>
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
