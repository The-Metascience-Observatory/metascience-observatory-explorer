import type { Metadata } from "next";
import PageClient from "./PageClient";
import { ENTITY_COUNTS, SEARCHABLE_PAPERS } from "@/lib/counts";
import { SITE_NAME } from "@/lib/site";

const nf = new Intl.NumberFormat("en-US");

/** "283 million", "100 million" — for prose, where an exact count reads badly. */
function millions(n: number): string {
  return `${Math.round(n / 1_000_000)} million`;
}

const TITLE =
  `The Metascience Observatory Explorer — ${Math.round(SEARCHABLE_PAPERS / 1e6)}M papers, ` +
  `${Math.round(ENTITY_COUNTS.persons / 1e6)}M researchers, ${nf.format(ENTITY_COUNTS.journals)} journals`;
const DESCRIPTION =
  "Free, open explorer for the science of science. Browse and search " +
  `${millions(SEARCHABLE_PAPERS)} papers, ${millions(ENTITY_COUNTS.persons)} researchers, ` +
  `${nf.format(ENTITY_COUNTS.journals)} journals, ${nf.format(ENTITY_COUNTS.affiliations)} institutions, ` +
  `${nf.format(ENTITY_COUNTS.funders)} funders and ${nf.format(ENTITY_COUNTS.trials)} clinical trials. ` +
  "Built on SciSciNet-V2.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/" },
};

/**
 * JSON-LD so search engines can model this as a searchable dataset explorer
 * rather than a generic page. Dataset in particular feeds Google Dataset Search.
 */
function structuredData() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: "/",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "/papers?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "SciSciNet-V2 explorer corpus",
      description: DESCRIPTION,
      url: "/",
      keywords: [
        "science of science",
        "scientometrics",
        "bibliometrics",
        "metascience",
        "citation analysis",
        "research funding",
      ],
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      creator: { "@type": "Organization", name: "The Metascience Observatory" },
      citation:
        "Lin, Z., Yin, Y., Liu, L. et al. SciSciNet: A large-scale open data lake " +
        "for the science of science research. Sci Data 10, 315 (2023).",
    },
  ];
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData()).replace(/</g, "\\u003c"),
        }}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-2 text-center">
        <h1 className="font-clarendon text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          Explore open source Scientometrics data, all in one place
        </h1>
      </div>

      <PageClient />
    </>
  );
}
