import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { getPersonDetails, getPersonSummary } from "@/lib/queries/persons";
import { breadcrumbLd } from "@/lib/jsonld";
import { absoluteUrl } from "@/lib/site";
import { formatNumber } from "@/lib/utils";
import PersonDetailClient from "./PersonDetailClient";

/**
 * 100M authors is an unbounded key space — never populate the Full Route Cache
 * for this route. See the same note on app/papers/[paperid]/page.tsx.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ authorid: string }> };

/** "https://orcid.org/0000-…" -> "0000-…" */
function bareOrcid(orcid: string | null | undefined): string | null {
  if (!orcid) return null;
  return orcid.replace(/^https?:\/\/orcid\.org\//i, "");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { authorid } = await params;
  const summary = await getPersonSummary(authorid);

  if (!summary) {
    return { title: "Researcher not found", robots: { index: false, follow: false } };
  }

  const name = summary.display_name || "Unknown researcher";
  const institution = summary.last_known_institution;
  const works = summary.works_count ?? 0;

  const title = `${name}${institution ? ` — ${institution}` : ""}`;
  const description =
    `${name} is a researcher${institution ? ` at ${institution}` : ""} with ` +
    `${formatNumber(works)} publications and ` +
    `${formatNumber(summary.cited_by_count ?? 0)} citations ` +
    `(h-index ${summary.h_index ?? "n/a"})` +
    `${summary.first_year && summary.last_year ? `, publishing ${summary.first_year}–${summary.last_year}` : ""}. ` +
    "Publication record, co-authors, funding and citation metrics.";
  const canonical = `/persons/${summary.authorid}`;

  return {
    title,
    description,
    alternates: { canonical },
    // Crawl-budget gating: authors with almost no output are thin pages across
    // a 100M-URL space. Followed, but not indexed.
    robots: works >= 3 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "profile", title, description, url: canonical },
  };
}

export default async function PersonDetailPage({ params }: Props) {
  const { authorid } = await params;
  const data = await getPersonDetails(authorid);
  if (!data) notFound();

  const { summary, affiliations } = data;
  const name = summary.display_name || "Unknown researcher";
  const orcid = bareOrcid(summary.orcid);

  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": absoluteUrl(`/persons/${summary.authorid}`),
    name,
    url: absoluteUrl(`/persons/${summary.authorid}`),
    ...(orcid
      ? {
          identifier: { "@type": "PropertyValue", propertyID: "ORCID", value: orcid },
          sameAs: [`https://orcid.org/${orcid}`],
        }
      : {}),
    ...(summary.last_known_institution
      ? {
          affiliation: {
            "@type": "Organization",
            name: summary.last_known_institution,
            ...(affiliations?.[0]?.institutionid
              ? { "@id": absoluteUrl(`/affiliations/${affiliations[0].institutionid}`) }
              : {}),
          },
        }
      : {}),
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
          personLd,
          breadcrumbLd([
            ["Researchers", "/persons"],
            [name, `/persons/${summary.authorid}`],
          ]),
        ]}
      />
      <PersonDetailClient data={data} authorid={summary.authorid} />
    </>
  );
}
