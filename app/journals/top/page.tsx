import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Pagination } from "@/components/BrowseList";
import { getTopJournalsPage } from "@/lib/queries/journals-top";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";
import PageClient from "./PageClient";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import { parsePage, topPageMetadata, type TopPageMeta } from "@/lib/top-page";

export const revalidate = 86400;

const META: TopPageMeta = {
  title: "Top Journals by Impact Factor",
  description:
    "Academic journals ranked by 2-year impact factor, with CiteScore, total " +
    "papers and citation counts. Filter by research field or sort by any metric.",
  path: "/journals/top",
};

/**
 * Cap on crawlable pagination depth. There are ~1,460 pages of journals; the
 * long tail past this point is thin and eats crawl budget, so those pages are
 * marked noindex but still followed, which keeps their links discoverable.
 */
const MAX_INDEXED_PAGE = 100;

type Props = { searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  return {
    ...topPageMetadata(META, page),
    // Unlike the other ranked pages, the journal tail is long and thin, so deep
    // pages are noindex-but-follow.
    robots:
      page > MAX_INDEXED_PAGE ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const data = await getTopJournalsPage(page, BROWSE_PAGE_SIZE);
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
        <h1 className="text-3xl font-bold mb-2">{META.title}</h1>
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
