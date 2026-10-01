import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RankedEntityPage } from "@/components/RankedEntityPage";
import { getTopPapers, getRankCount } from "@/lib/queries/ranks";
import { formatNumber } from "@/lib/utils";
import { stripInlineHtml } from "@/lib/sanitize";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import { parsePage, topPageMetadata, type TopPageMeta } from "@/lib/top-page";

export const revalidate = 86400;

const META: TopPageMeta = {
  title: "Most-Cited Papers of All Time",
  description:
    "The most-cited research papers across all fields, ranked by total citations from 250 million indexed papers.",
  path: "/papers/top",
};

type Props = { searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return topPageMetadata(META, parsePage((await searchParams).page));
}

export default async function Page({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const total = await getRankCount("rank_papers");
  if (total > 0 && page > Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE))) notFound();

  const rows = await getTopPapers((page - 1) * BROWSE_PAGE_SIZE, BROWSE_PAGE_SIZE);

  return (
    <RankedEntityPage
      heading="Most-Cited Papers of All Time"
      intro="Ranked by total citations across every field in the SciSciNet-V2 corpus."
      breadcrumb={[
        ["Papers", "/papers"],
        ["Most-cited papers", "/papers/top"],
      ]}
      basePath="/papers/top"
      backHref="/papers"
      backLabel="Back to search"
      page={page}
      total={total}
      items={rows.map((r) => ({
        href: `/papers/${r.paperid}`,
        title: stripInlineHtml(r.title || "Untitled"),
        subtitle: [r.source_name, r.year].filter(Boolean).join(" · ") || null,
        meta: `${formatNumber(r.cited_by_count)} citations`,
      }))}
    />
  );
}
