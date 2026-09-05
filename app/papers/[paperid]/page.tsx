import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import {
  getPaperAuthors,
  getPaperDetails,
  getPaperSummary,
  paperExistsInLiteDb,
} from "@/lib/queries/papers";
import { breadcrumbLd } from "@/lib/jsonld";
import { absoluteUrl } from "@/lib/site";
import { stripInlineHtml, truncate } from "@/lib/sanitize";
import PaperDetailClient from "./PaperDetailClient";
import LitePaperPage from "./LitePaperPage";

/**
 * 250M papers is an unbounded key space, so this route must never populate the
 * Full Route Cache: a dynamic segment with no generateStaticParams is
 * static-on-demand and, with the default `revalidate: false`, cached forever.
 * That would fill the container's writable layer.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ paperid: string }> };

/** Strip a DOI down to the bare 10.x/... form Scholar and Crossref expect. */
function bareDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { paperid } = await params;
  const summary = await getPaperSummary(paperid); // cache()d — reused by the page

  if (!summary) {
    return { title: "Paper not found", robots: { index: false, follow: false } };
  }

  // Indexed lookup on paper_authors. Note what is NOT here: the abstract.
  // generateMetadata blocks the entire first flush, and abstracts.db is 185GB —
  // reading it to build a meta description would put a cold disk seek in front
  // of every byte of HTML.
  const authors = await getPaperAuthors(paperid);

  const plainTitle = stripInlineHtml(summary.title || "Untitled");
  const names = [
    ...new Map(authors.map((a) => [a.authorid, a])).values(),
  ]
    .map((a) => a.display_name)
    .filter((n): n is string => Boolean(n));
  const byline =
    names.length === 0 ? "" : names.length <= 3 ? names.join(", ") : `${names[0]} et al.`;

  const cites = summary.cited_by_count ?? 0;
  const doi = bareDoi(summary.doi);
  const canonical = `/papers/${summary.paperid}`;

  const title =
    `${truncate(plainTitle, 90)}` +
    `${summary.year ? ` (${summary.year})` : ""}` +
    `${summary.source_name ? ` – ${summary.source_name}` : ""}`;

  const description = truncate(
    [
      byline ? `${byline}.` : "",
      summary.source_name || "",
      summary.year ? `(${summary.year}).` : "",
      `Cited by ${cites.toLocaleString("en-US")}.`,
      "References, citing works, MeSH terms, funding and open-access status.",
    ]
      .filter(Boolean)
      .join(" "),
    250
  );

  return {
    title: { absolute: `${title} | Metascience Observatory Explorer` },
    description,
    alternates: { canonical },
    // Crawl-budget gating: 250M paper URLs cannot all be crawled, so thin
    // records — no citations and no DOI — are followed but not indexed.
    // follow:true keeps their outbound link equity flowing.
    robots:
      cites >= 1 || doi
        ? { index: true, follow: true }
        : { index: false, follow: true },
    openGraph: {
      type: "article",
      title: plainTitle,
      description,
      url: canonical,
      ...(summary.year ? { publishedTime: `${summary.year}-01-01` } : {}),
      authors: names.slice(0, 10),
    },
    twitter: { card: "summary", title: truncate(plainTitle, 70), description },
    // Highwire Press tags. Google Scholar reads these (it ignores JSON-LD
    // entirely), but the reliable payoff is reference-manager interop: Zotero,
    // Mendeley, EndNote and ReadCube all auto-detect them, which makes every
    // paper page one-click citable.
    //
    // Deliberately no citation_pdf_url — this site hosts metadata, not full
    // text, and claiming otherwise would be wrong.
    other: {
      citation_title: plainTitle,
      ...(names.length > 0 ? { citation_author: names.slice(0, 50) } : {}),
      ...(summary.year ? { citation_publication_date: String(summary.year) } : {}),
      ...(summary.source_name ? { citation_journal_title: summary.source_name } : {}),
      ...(doi ? { citation_doi: doi } : {}),
      citation_abstract_html_url: absoluteUrl(canonical),
    },
  };
}

export default async function PaperDetailPage({ params }: Props) {
  const { paperid } = await params;
  const data = await getPaperDetails(paperid);

  if (!data) {
    // Some papers exist only in the reduced paper_core table. Check before
    // 404ing, or the conversion silently turns every lite paper into a 404.
    if (await paperExistsInLiteDb(paperid)) {
      return <LitePaperPage paperid={paperid} />;
    }
    notFound();
  }

  const { summary, authors, fields, references } = data;
  const plainTitle = stripInlineHtml(summary.title || "Untitled");
  const doi = bareDoi(summary.doi);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    "@id": absoluteUrl(`/papers/${summary.paperid}`),
    headline: truncate(plainTitle, 110),
    name: plainTitle,
    url: absoluteUrl(`/papers/${summary.paperid}`),
    ...(summary.year ? { datePublished: String(summary.year) } : {}),
    ...(doi
      ? {
          sameAs: `https://doi.org/${doi}`,
          identifier: { "@type": "PropertyValue", propertyID: "DOI", value: doi },
        }
      : {}),
    ...(authors.length > 0
      ? {
          author: [...new Map(authors.map((a) => [a.authorid, a])).values()]
            .slice(0, 50)
            .map((a) => ({
              "@type": "Person",
              name: a.display_name,
              ...(a.authorid ? { "@id": absoluteUrl(`/persons/${a.authorid}`) } : {}),
              ...(a.institution_name
                ? { affiliation: { "@type": "Organization", name: a.institution_name } }
                : {}),
            })),
        }
      : {}),
    ...(summary.source_name
      ? {
          isPartOf: {
            "@type": "Periodical",
            name: summary.source_name,
            ...(summary.sourceid
              ? { "@id": absoluteUrl(`/journals/${summary.sourceid}`) }
              : {}),
          },
        }
      : {}),
    ...(fields.length > 0
      ? {
          about: fields.slice(0, 10).map((f) => ({
            "@type": "DefinedTerm",
            name: f.field_name,
            ...(f.fieldid ? { "@id": absoluteUrl(`/fields/${f.fieldid}`) } : {}),
          })),
        }
      : {}),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CiteAction",
      userInteractionCount: summary.cited_by_count ?? 0,
    },
    // Cap the reference list: a full one can run to hundreds of nodes and adds
    // page weight without adding indexing value.
    ...(references.length > 0
      ? {
          citation: references.slice(0, 20).map((r) => ({
            "@type": "ScholarlyArticle",
            name: stripInlineHtml(r.ref_title || "Untitled"),
            ...(r.ref_year ? { datePublished: String(r.ref_year) } : {}),
            ...(r.ref_paperid
              ? { "@id": absoluteUrl(`/papers/${r.ref_paperid}`) }
              : {}),
          })),
        }
      : {}),
  };

  return (
    <>
      <JsonLd
        data={[
          articleLd,
          breadcrumbLd([
            ["Papers", "/papers"],
            [plainTitle, `/papers/${summary.paperid}`],
          ]),
        ]}
      />
      <PaperDetailClient data={data} paperid={summary.paperid} />
    </>
  );
}
