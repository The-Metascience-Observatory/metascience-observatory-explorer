import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { BrowseList, Pagination } from "@/components/BrowseList";
import { getTopPersons, getRankCount } from "@/lib/queries/ranks";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";

export const revalidate = 86400;

const PER_PAGE = 50;
const TITLE = "Most-Cited Researchers";
const DESCRIPTION = "Researchers ranked by total citations across 100 million indexed authors, with h-index, publication counts and institutions.";

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
    // Self-referencing canonical per page. Canonicalising page N back to page 1
    // would de-index the very pages carrying the entity links.
    alternates: { canonical: page > 1 ? "/persons/top?page=" + page : "/persons/top" },
    openGraph: { title: `${TITLE}${suffix}`, description: DESCRIPTION },
  };
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const total = await getRankCount("rank_persons");
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (total > 0 && page > totalPages) notFound();

  const rows = await getTopPersons((page - 1) * PER_PAGE, PER_PAGE);
  const items = rows.map((r) => ({
        href: `/persons/${r.authorid}`,
        title: r.display_name || "Unknown researcher",
        subtitle: r.last_known_institution || null,
        meta: `${formatNumber(r.cited_by_count)} citations · h-index ${r.h_index ?? "—"}`,
      }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <JsonLd data={breadcrumbLd([["Researchers", "/persons"], ["Most-cited researchers", "/persons/top"]])} />

      <h1 className="font-clarendon text-3xl font-bold mb-2">Most-Cited Researchers</h1>
      <p className="text-gray-500 mb-6">
        Ranked by total citations across every indexed author.
        {total > 0 && (
          <> Showing ranks {(page - 1) * PER_PAGE + 1}–
          {Math.min(page * PER_PAGE, total)} of {formatNumber(total)}.</>
        )}
      </p>

      {items.length > 0 ? (
        <>
          <BrowseList items={items} startRank={(page - 1) * PER_PAGE + 1} />
          <Pagination basePath="/persons/top" page={page} totalPages={totalPages} />
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Rankings have not been generated yet. Run{" "}
          <code>scripts/generate-sitemaps.mjs</code> to build them.
        </p>
      )}

      <p className="mt-10 text-sm text-gray-500">
        <Link href="/persons" className="text-blue-700 underline">
          Back to search
        </Link>
      </p>
    </div>
  );
}
