import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { JsonLd } from "@/components/JsonLd";
import { getMeshDetails, getMeshSummary } from "@/lib/queries/mesh";
import { breadcrumbLd, meshTermLd } from "@/lib/jsonld";
import { stripInlineHtml, truncate } from "@/lib/sanitize";
import { formatNumber } from "@/lib/utils";
import { ChildTerms } from "./parts/ChildTerms";
import { MeshPapers } from "./parts/MeshPapers";

/**
 * REFERENCE IMPLEMENTATION for the entity detail routes.
 *
 * The shape to copy:
 *   1. async server component, `await params`
 *   2. generateMetadata doing only fast, indexed lookups (it blocks the entire
 *      first flush, so never put a slow database on this path)
 *   3. notFound() on a miss, so a bad id is a real 404 rather than a 200 with
 *      a client-side "not found" — at this scale soft-404s are a site-quality
 *      signal, and the id space is unbounded
 *   4. JSON-LD + a server-rendered above-the-fold block containing the <h1>
 *   5. client islands only where something is genuinely interactive
 *
 * ~30k MeSH terms is a bounded, fully indexable set, so this route is worth
 * caching rather than forcing dynamic.
 */

export const revalidate = 86400;

type Props = { params: Promise<{ meshui: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { meshui } = await params;
  const summary = await getMeshSummary(meshui); // cache()d — reused by the page

  if (!summary) {
    return { title: "MeSH term not found", robots: { index: false, follow: false } };
  }

  const title = `${summary.meshName} — ${formatNumber(summary.totalPapers)} Indexed Papers`;
  // The NLM scope note is a real definition written by librarians — far better
  // than anything generated from the metrics. Use it whenever it exists.
  const description = summary.scopeNote
    ? truncate(stripInlineHtml(summary.scopeNote), 200)
    : `MeSH term ${summary.meshName} (${summary.meshUi}): ${formatNumber(summary.totalPapers)} ` +
      `indexed publications with ${formatNumber(summary.totalCitations)} citations. ` +
      "Publication trend, leading journals and related terms.";
  const canonical = `/mesh/${summary.meshUi}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function MeshDetailPage({ params }: Props) {
  const { meshui } = await params;
  const data = await getMeshDetails(meshui);
  if (!data) notFound();

  const { summary, yearlyStats, topJournals, parentTerms, childTerms } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <JsonLd
        data={[
          meshTermLd({
            meshUi: summary.meshUi,
            meshName: summary.meshName,
            scopeNote: summary.scopeNote,
          }),
          breadcrumbLd([[summary.meshName, `/mesh/${summary.meshUi}`]]),
        ]}
      />

      {/* Top row: infobox left, chart right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        <Card>
          <CardContent className="pt-6">
            {parentTerms.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 mb-2">
                {parentTerms.map((parent, idx) => (
                  <span key={parent.meshUi} className="flex items-center">
                    <Link
                      href={`/mesh/${parent.meshUi}`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {parent.meshName}
                    </Link>
                    {idx < parentTerms.length - 1 && (
                      <ChevronRight className="h-3 w-3 mx-0.5 text-gray-400" />
                    )}
                  </span>
                ))}
                <ChevronRight className="h-3 w-3 mx-0.5 text-gray-400" />
              </div>
            )}

            <h1 className="text-lg font-bold mb-3 leading-tight">{summary.meshName}</h1>

            <p className="text-xs text-gray-400 mb-4">
              MeSH Descriptor: {summary.meshUi}
            </p>

            {summary.scopeNote && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {summary.scopeNote}
                </p>
              </div>
            )}

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Papers</span>
                <span className="font-semibold">{formatNumber(summary.totalPapers)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Citations</span>
                <span className="font-semibold">{formatNumber(summary.totalCitations)}</span>
              </div>
            </div>

            <ChildTerms terms={childTerms} />

            <div className="border-t pt-4">
              <a
                href={`https://meshb.nlm.nih.gov/record/ui?ui=${summary.meshUi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                View in NLM MeSH Browser
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Publications Per Year</CardTitle>
          </CardHeader>
          <CardContent>
            <PublicationsChart data={yearlyStats} />
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: top journals left, sampled papers right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8">
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Journals ({topJournals.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {topJournals.length > 0 ? (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {topJournals.map((journal, idx) => (
                  <Link
                    key={journal.sourceid}
                    href={`/journals/${journal.sourceid}`}
                    className="flex items-center justify-between gap-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">
                        {idx + 1}.
                      </span>
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {journal.sourceName}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatNumber(journal.paperCount)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No journals found.</p>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Random Papers</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            <MeshPapers meshUi={summary.meshUi} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
