import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { getGrantSummary } from "@/lib/queries/grants";
import { breadcrumbLd } from "@/lib/jsonld";
import { absoluteUrl } from "@/lib/site";
import { stripInlineHtml, truncate } from "@/lib/sanitize";
import { funderLabel, grantExternalUrl, grantPath } from "@/lib/grant-id";
import GrantDetailClient from "./GrantDetailClient";

/** Millions of grants, but each page is a PK seek; cache like the other entity pages. */
export const revalidate = 86400;

type Props = { params: Promise<{ funder: string; key: string }> };

const FUNDER_RE = /^[a-z0-9]{1,8}$/i;
const KEY_RE = /^[a-z0-9]{1,40}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { funder, key } = await params;
  const summary = FUNDER_RE.test(funder) && KEY_RE.test(key) ? await getGrantSummary(funder, key) : null;
  if (!summary) {
    return { title: "Grant not found", robots: { index: false, follow: false } };
  }
  const grantTitle = summary.title ? stripInlineHtml(summary.title) : null;
  const title = grantTitle
    ? `${summary.display}: ${truncate(grantTitle, 80)}`
    : `Grant ${summary.display} (${funderLabel(summary.funder)})`;
  const description = truncate(
    [
      `${funderLabel(summary.funder)} grant ${summary.display}${grantTitle ? `, "${grantTitle}"` : ""}.`,
      `${summary.paper_count} linked papers`,
      summary.reported_count ? `(${summary.reported_count} reported by the funder` : "",
      summary.acknowledged_count
        ? `${summary.reported_count ? ", " : "("}${summary.acknowledged_count} acknowledging the grant)`
        : summary.reported_count
          ? ")"
          : "",
      summary.first_year && summary.last_year ? `, ${summary.first_year}–${summary.last_year}.` : ".",
    ]
      .filter(Boolean)
      .join(" "),
    250
  );
  const canonical = grantPath(summary.funder, summary.key);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function GrantDetailPage({ params }: Props) {
  const { funder, key } = await params;
  if (!FUNDER_RE.test(funder) || !KEY_RE.test(key)) notFound();
  const summary = await getGrantSummary(funder, key);
  if (!summary) notFound();

  const path = grantPath(summary.funder, summary.key);
  const external = grantExternalUrl(summary.funder, summary.key, summary.display);
  const grantLd = {
    "@context": "https://schema.org",
    "@type": "MonetaryGrant",
    "@id": absoluteUrl(path),
    identifier: summary.display,
    url: absoluteUrl(path),
    ...(summary.title ? { name: stripInlineHtml(summary.title) } : {}),
    funder: { "@type": "Organization", name: summary.funder_name || funderLabel(summary.funder) },
    ...(external ? { sameAs: external } : {}),
    ...(summary.funded_amount
      ? {
          amount: {
            "@type": "MonetaryAmount",
            value: summary.funded_amount,
            ...(summary.currency ? { currency: summary.currency } : {}),
          },
        }
      : {}),
  };

  return (
    <>
      <JsonLd
        data={[
          grantLd,
          breadcrumbLd([
            ["Grants", "/grants"],
            [summary.display, path],
          ]),
        ]}
      />
      <GrantDetailClient summary={summary} />
    </>
  );
}
