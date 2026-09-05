import type { Metadata } from "next";
import Link from "next/link";
import PageClient from "./PageClient";
import { JsonLd } from "@/components/JsonLd";
import { TOP_LEVEL_FIELDS, FIELD_SUBFIELD_MAP } from "@/lib/field-hierarchy";
import { getFieldsById } from "@/lib/queries/fields";
import { breadcrumbLd } from "@/lib/jsonld";
import { formatNumber } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse 19 Research Fields",
  description:
    "Explore the OpenAlex research taxonomy: 19 top-level fields and 284 subfields, with paper counts, citation totals and leading journals in each.",
  alternates: { canonical: "/fields" },
  openGraph: {
    title: "Browse 19 Research Fields",
    description:
      "Explore the OpenAlex research taxonomy: 19 top-level fields and 284 subfields, with paper counts, citation totals and leading journals in each.",
    url: "/fields",
  },
};

export const revalidate = 86400;

export default async function Page() {
  const fields = await getFieldsById();

  return (
    <>
      <JsonLd data={breadcrumbLd([["Research fields", "/fields"]])} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Research Fields</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Explore 19 broad fields of science and their 284 subfields. Bubble
            size represents number of papers.
          </p>
        </div>
      </div>
      <PageClient />

      {/* Server-rendered taxonomy. The bubble chart above navigates via a
          window.location.href click handler inside an SVG, which no crawler can
          follow — this list is how all 303 field pages actually get discovered. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <h2 className="font-clarendon text-2xl font-bold mb-2">
          Browse all research fields
        </h2>
        <p className="text-gray-500 text-sm mb-8">
          19 broad fields and 284 subfields, from the OpenAlex concept hierarchy.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
          {TOP_LEVEL_FIELDS.map((top) => {
            const parent = fields.get(top.fieldid);
            const children = (FIELD_SUBFIELD_MAP[top.fieldid] ?? [])
              .map((id) => fields.get(id))
              .filter((f): f is NonNullable<typeof f> => Boolean(f))
              .sort((a, b) => a.display_name.localeCompare(b.display_name));

            return (
              <div key={top.fieldid} className="break-inside-avoid">
                <h3 className="font-semibold mb-1">
                  <Link
                    href={`/fields/${top.fieldid}`}
                    className="text-blue-700 hover:underline"
                  >
                    {top.name}
                  </Link>
                  {parent?.paper_count ? (
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {formatNumber(parent.paper_count)} papers
                    </span>
                  ) : null}
                </h3>
                <ul className="space-y-0.5">
                  {children.map((child) => (
                    <li key={child.fieldid}>
                      <Link
                        href={`/fields/${child.fieldid}`}
                        className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-700 hover:underline"
                      >
                        {child.display_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
