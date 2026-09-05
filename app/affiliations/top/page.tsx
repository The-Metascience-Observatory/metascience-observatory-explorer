import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { BrowseList, Pagination } from "@/components/BrowseList";
import { getTopAffiliations, getRankCount } from "@/lib/queries/ranks";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber, getCountryName } from "@/lib/utils";

export const revalidate = 86400;

const PER_PAGE = 50;
const TITLE = "Top Research Institutions by Citations";
const DESCRIPTION = "Universities, hospitals and research institutions ranked by total citations, with researcher counts and countries.";

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
    alternates: { canonical: page > 1 ? "/affiliations/top?page=" + page : "/affiliations/top" },
    openGraph: { title: `${TITLE}${suffix}`, description: DESCRIPTION },
  };
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const total = await getRankCount("rank_affiliations");
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (total > 0 && page > totalPages) notFound();

  const rows = await getTopAffiliations((page - 1) * PER_PAGE, PER_PAGE);
  const items = rows.map((r) => ({
        href: `/affiliations/${r.institution_id}`,
        title: r.display_name || r.institution_id,
        subtitle: r.country_code ? getCountryName(r.country_code) : null,
        meta: `${formatNumber(r.total_citations)} citations`,
      }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <JsonLd data={breadcrumbLd([["Institutions", "/affiliations"], ["Top institutions", "/affiliations/top"]])} />

      <h1 className="font-clarendon text-3xl font-bold mb-2">Top Research Institutions</h1>
      <p className="text-gray-500 mb-6">
        Ranked by total citations across all indexed publications.
        {total > 0 && (
          <> Showing ranks {(page - 1) * PER_PAGE + 1}–
          {Math.min(page * PER_PAGE, total)} of {formatNumber(total)}.</>
        )}
      </p>

      {items.length > 0 ? (
        <>
          <BrowseList items={items} startRank={(page - 1) * PER_PAGE + 1} />
          <Pagination basePath="/affiliations/top" page={page} totalPages={totalPages} />
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Rankings have not been generated yet. Run{" "}
          <code>scripts/generate-sitemaps.mjs</code> to build them.
        </p>
      )}

      <p className="mt-10 text-sm text-gray-500">
        <Link href="/affiliations" className="text-blue-700 underline">
          Back to search
        </Link>
      </p>
    </div>
  );
}
