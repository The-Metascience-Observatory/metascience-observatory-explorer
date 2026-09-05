import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Pagination } from "@/components/BrowseList";
import { getTopJournalsPage } from "@/lib/queries/journals-top";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";
import PageClient from "./PageClient";

export const revalidate = 86400;

const PER_PAGE = 50;
const TITLE = "Top Journals by Impact Factor";
const DESCRIPTION =
  "Academic journals ranked by 2-year impact factor, with CiteScore, total " +
  "papers and citation counts. Filter by research field or sort by any metric.";

/**
 * Cap on crawlable pagination depth. There are ~1,460 pages of journals; the
 * long tail past this point is thin and eats crawl budget, so those pages are
 * marked noindex but still followed, which keeps their links discoverable.
 */
const MAX_INDEXED_PAGE = 100;

type Props = { searchParams: Promise<{ page?: string }> };

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const suffix = page > 1 ? ` — Page ${page}` : "";

  return {
    title: `${TITLE}${suffix}`,
    description: DESCRIPTION,
    alternates: { canonical: page > 1 ? `/journals/top?page=${page}` : "/journals/top" },
    robots:
      page > MAX_INDEXED_PAGE
        ? { index: false, follow: true }
        : { index: true, follow: true },
    openGraph: { title: `${TITLE}${suffix}`, description: DESCRIPTION },
  };
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const data = await getTopJournalsPage(page, PER_PAGE);
  if (data.totalPages > 0 && page > data.totalPages) notFound();

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          ["Journals", "/journals"],
          ["Top journals", "/journals/top"],
        ])}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-3xl font-bold mb-2">{TITLE}</h1>
        <p className="text-gray-500 mb-2">
          {formatNumber(data.total)} journals ranked by 2-year impact factor
          {data.metricsYear ? ` for ${data.metricsYear}` : ""}, with CiteScore,
          total papers and citation counts.
        </p>
      </div>

      <PageClient initialData={data} page={page} />

      {/* Real <a href="?page=N"> links, server-rendered: this is what makes the
          whole ranking crawlable. The client table's own controls only handle
          sorting and field filtering. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <Pagination
          basePath="/journals/top"
          page={page}
          totalPages={Math.min(data.totalPages, MAX_INDEXED_PAGE)}
        />
      </div>
    </>
  );
}
