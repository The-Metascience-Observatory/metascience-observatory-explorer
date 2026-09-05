import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { getTrialDetails, getTrialSummary } from "@/lib/queries/trials";
import { breadcrumbLd } from "@/lib/jsonld";
import { absoluteUrl } from "@/lib/site";
import { stripInlineHtml, truncate } from "@/lib/sanitize";
import TrialDetailClient from "./TrialDetailClient";

/** ~563k trials — bounded, so cache rather than force dynamic. */
export const revalidate = 86400;

type Props = { params: Promise<{ nctid: string }> };

function formatStatus(status: string | null | undefined): string {
  if (!status) return "";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nctid } = await params;
  const summary = await getTrialSummary(nctid);

  if (!summary) {
    return { title: "Clinical trial not found", robots: { index: false, follow: false } };
  }

  const trialTitle = stripInlineHtml(summary.title || summary.nct_id);
  const title = `${summary.nct_id}: ${truncate(trialTitle, 90)}`;

  const description = summary.brief_summary
    ? truncate(stripInlineHtml(summary.brief_summary), 200)
    : truncate(
        [
          trialTitle + ".",
          [summary.phase, summary.study_type].filter(Boolean).join(" "),
          summary.sponsor ? `Sponsored by ${summary.sponsor}.` : "",
          summary.status ? `Status: ${formatStatus(summary.status)}.` : "",
          summary.enrollment ? `Enrollment ${summary.enrollment}.` : "",
          summary.conditions ? `Conditions: ${summary.conditions}.` : "",
          `${summary.paper_count} linked publications.`,
        ]
          .filter(Boolean)
          .join(" "),
        250
      );

  const canonical = `/trials/${summary.nct_id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function TrialDetailPage({ params }: Props) {
  const { nctid } = await params;
  const data = await getTrialDetails(nctid);
  if (!data) notFound();

  const { summary } = data;

  // MedicalTrial is one of the few types here that can still produce an
  // enhanced result, and the registry fields map onto it almost exactly.
  const trialLd = {
    "@context": "https://schema.org",
    "@type": "MedicalTrial",
    "@id": absoluteUrl(`/trials/${summary.nct_id}`),
    name: stripInlineHtml(summary.title || summary.nct_id),
    identifier: {
      "@type": "PropertyValue",
      propertyID: "ClinicalTrials.gov",
      value: summary.nct_id,
    },
    url: absoluteUrl(`/trials/${summary.nct_id}`),
    sameAs: `https://clinicaltrials.gov/study/${summary.nct_id}`,
    ...(summary.brief_summary
      ? { description: truncate(stripInlineHtml(summary.brief_summary), 500) }
      : {}),
    ...(summary.phase ? { phase: summary.phase } : {}),
    ...(summary.status ? { status: formatStatus(summary.status) } : {}),
    ...(summary.sponsor
      ? { sponsor: { "@type": "Organization", name: summary.sponsor } }
      : {}),
    ...(summary.conditions
      ? {
          healthCondition: summary.conditions
            .split(/[;|]/)
            .map((c) => c.trim())
            .filter(Boolean)
            .slice(0, 10)
            .map((name) => ({ "@type": "MedicalCondition", name })),
        }
      : {}),
  };

  return (
    <>
      <JsonLd
        data={[
          trialLd,
          breadcrumbLd([
            ["Clinical trials", "/trials"],
            [summary.nct_id, `/trials/${summary.nct_id}`],
          ]),
        ]}
      />
      <TrialDetailClient data={data} />
    </>
  );
}
