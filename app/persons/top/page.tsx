import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankedEntityPage } from "@/components/RankedEntityPage";
import { getTopPersons, getRankCount } from "@/lib/queries/ranks";
import { formatNumber } from "@/lib/utils";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import { parsePage, topPageMetadata, type TopPageMeta } from "@/lib/top-page";

export const revalidate = 86400;

const META: TopPageMeta = {
  title: "Most-Cited Researchers",
  description:
    "Researchers ranked by total citations across 100 million indexed authors, with h-index, publication counts and institutions.",
  path: "/persons/top",
};

type Props = { searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return topPageMetadata(META, parsePage((await searchParams).page));
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const total = await getRankCount("rank_persons");
  if (total > 0 && page > Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE))) notFound();

  const rows = await getTopPersons((page - 1) * BROWSE_PAGE_SIZE, BROWSE_PAGE_SIZE);

  return (
    <RankedEntityPage
      heading="Most-Cited Researchers"
      intro="Ranked by total citations across every indexed author."
      breadcrumb={[
        ["Researchers", "/persons"],
        ["Most-cited researchers", "/persons/top"],
      ]}
      basePath="/persons/top"
      backHref="/persons"
      backLabel="Back to search"
      page={page}
      total={total}
      items={rows.map((r) => ({
        href: `/persons/${r.authorid}`,
        title: r.display_name || "Unknown researcher",
        subtitle: r.last_known_institution || null,
        meta: `${formatNumber(r.cited_by_count)} citations · h-index ${r.h_index ?? "—"}`,
      }))}
    />
  );
}
