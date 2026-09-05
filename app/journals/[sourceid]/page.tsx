import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { getJournalDetails, getJournalSummary } from "@/lib/queries/journals";
import { breadcrumbLd } from "@/lib/jsonld";
import { absoluteUrl } from "@/lib/site";
import { formatNumber } from "@/lib/utils";
import JournalDetailClient from "./JournalDetailClient";

/** ~261k journals — bounded and fully indexable, so cache rather than force dynamic. */
export const revalidate = 86400;

type Props = { params: Promise<{ sourceid: string }> };

/**
 * ISSN is stored either as a bare string or as a JSON array string, depending
 * on the source record. Both forms have to be handled everywhere it is read.
 */
function parseIssn(issn: string | null | undefined): string[] {
  if (!issn) return [];
  if (!issn.startsWith("[")) return [issn];
  try {
    const parsed = JSON.parse(issn);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sourceid } = await params;
  const summary = await getJournalSummary(sourceid);

  if (!summary) {
    return { title: "Journal not found", robots: { index: false, follow: false } };
  }

  const issns = parseIssn(summary.issn);
  const title = `${summary.display_name}${summary.publisher ? ` — ${summary.publisher}` : ""}`;
  const description =
    `${summary.display_name}` +
    `${summary.publisher ? `, published by ${summary.publisher}` : ""}` +
    `${issns[0] ? ` (ISSN ${issns[0]})` : ""}. ` +
    `${formatNumber(summary.total_papers)} papers and ` +
    `${formatNumber(summary.total_citations)} citations` +
    `${summary.first_year && summary.last_year ? `, ${summary.first_year}–${summary.last_year}` : ""}` +
    `${summary.is_oa ? ". Open access" : ""}. ` +
    "Impact factor history, publication trends, subject fields and retraction statistics.";
  const canonical = `/journals/${summary.sourceid}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function JournalDetailPage({ params }: Props) {
  const { sourceid } = await params;
  // includeScopus omitted: the external CiteScore lookup stays off the render
  // path. The API route still returns it for clients that can wait.
  const data = await getJournalDetails(sourceid);
  if (!data) notFound();

  const { summary } = data;
  const issns = parseIssn(summary.issn);

  const periodicalLd = {
    "@context": "https://schema.org",
    "@type": "Periodical",
    "@id": absoluteUrl(`/journals/${summary.sourceid}`),
    name: summary.display_name,
    url: absoluteUrl(`/journals/${summary.sourceid}`),
    ...(issns.length > 0 ? { issn: issns } : {}),
    ...(summary.publisher
      ? { publisher: { "@type": "Organization", name: summary.publisher } }
      : {}),
    ...(summary.homepage_url ? { sameAs: summary.homepage_url } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: "The Metascience Observatory Explorer",
      url: absoluteUrl("/"),
    },
  };

  return (
    <>
      <JsonLd
        data={[
          periodicalLd,
          breadcrumbLd([
            ["Journals", "/journals"],
            [summary.display_name, `/journals/${summary.sourceid}`],
          ]),
        ]}
      />
      <JournalDetailClient data={data} sourceid={summary.sourceid} />
    </>
  );
}
