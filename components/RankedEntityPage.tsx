import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { BrowseList, Pagination } from "@/components/BrowseList";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";

interface BrowseItem {
  href: string;
  title: string;
  subtitle: string | null;
  meta: string;
}

interface RankedEntityPageProps {
  heading: string;
  /** Sentence before the "Showing ranks X–Y of Z" clause. */
  intro: string;
  /** Breadcrumb trail as [label, href] pairs. */
  breadcrumb: [string, string][];
  /** Route path used for pagination links, e.g. "/papers/top". */
  basePath: string;
  /** Link back to the entity's search page. */
  backHref: string;
  backLabel: string;
  page: number;
  total: number;
  items: BrowseItem[];
}

/**
 * Shell for a ranked "top entities" listing. The three rank-table pages
 * (papers, persons, affiliations) were identical here apart from their strings
 * and their row mapper, so they pass those in and keep their own queries.
 */
export function RankedEntityPage({
  heading,
  intro,
  breadcrumb,
  basePath,
  backHref,
  backLabel,
  page,
  total,
  items,
}: RankedEntityPageProps) {
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const firstRank = (page - 1) * BROWSE_PAGE_SIZE + 1;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <JsonLd data={breadcrumbLd(breadcrumb)} />

      <h1 className="font-clarendon text-3xl font-bold mb-2">{heading}</h1>
      <p className="text-gray-500 mb-6">
        {intro}
        {total > 0 && (
          <>
            {" "}
            Showing ranks {firstRank}–{Math.min(page * BROWSE_PAGE_SIZE, total)} of{" "}
            {formatNumber(total)}.
          </>
        )}
      </p>

      {items.length > 0 ? (
        <>
          <BrowseList items={items} startRank={firstRank} />
          <Pagination basePath={basePath} page={page} totalPages={totalPages} />
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Rankings have not been generated yet. Run{" "}
          <code>scripts/generate-sitemaps.mjs</code> to build them.
        </p>
      )}

      <p className="mt-10 text-sm text-gray-500">
        <Link href={backHref} className="text-blue-700 underline">
          {backLabel}
        </Link>
      </p>
    </div>
  );
}
