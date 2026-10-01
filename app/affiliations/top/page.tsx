import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankedEntityPage } from "@/components/RankedEntityPage";
import { getTopAffiliations, getRankCount } from "@/lib/queries/ranks";
import { formatNumber, getCountryName } from "@/lib/utils";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import { parsePage, topPageMetadata, type TopPageMeta } from "@/lib/top-page";

export const revalidate = 86400;

const META: TopPageMeta = {
  title: "Top Research Institutions by Citations",
  description:
    "Universities, hospitals and research institutions ranked by total citations, with researcher counts and countries.",
  path: "/affiliations/top",
};

type Props = { searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return topPageMetadata(META, parsePage((await searchParams).page));
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const total = await getRankCount("rank_affiliations");
  if (total > 0 && page > Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE))) notFound();

  const rows = await getTopAffiliations((page - 1) * BROWSE_PAGE_SIZE, BROWSE_PAGE_SIZE);

  return (
    <RankedEntityPage
      heading="Top Research Institutions"
      intro="Ranked by total citations across all indexed publications."
      breadcrumb={[
        ["Institutions", "/affiliations"],
        ["Top institutions", "/affiliations/top"],
      ]}
      basePath="/affiliations/top"
      backHref="/affiliations"
      backLabel="Back to search"
      page={page}
      total={total}
      items={rows.map((r) => ({
        href: `/affiliations/${r.institution_id}`,
        title: r.display_name || r.institution_id,
        subtitle: r.country_code ? getCountryName(r.country_code) : null,
        meta: `${formatNumber(r.total_citations)} citations`,
      }))}
    />
  );
}
