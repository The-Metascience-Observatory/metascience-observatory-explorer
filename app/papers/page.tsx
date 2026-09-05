import type { Metadata } from "next";
import { FileText } from "lucide-react";
import Link from "next/link";
import PageClient from "./PageClient";
import { BrowseList } from "@/components/BrowseList";
import { formatNumber } from "@/lib/utils";
import { TOP_LEVEL_FIELDS } from "@/lib/field-hierarchy";
import { getTopPapers } from "@/lib/queries/ranks";
import { stripInlineHtml } from "@/lib/sanitize";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 283 Million Research Papers",
  description:
    "Search and browse 283 million research papers by title, DOI or author. Citation counts, references, citing works, MeSH terms, funding and open-access status for every paper.",
  alternates: { canonical: "/papers" },
  openGraph: {
    title: "Search 283 Million Research Papers",
    description:
      "Search and browse 283 million research papers by title, DOI or author. Citation counts, references, citing works, MeSH terms, funding and open-access status for every paper.",
    url: "/papers",
  },
};

export const revalidate = 86400;

export default async function Page() {
  const top = await getTopPapers(0, 20);

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<FileText className="h-8 w-8" />}
          title="Papers"
          description="Search through 283,312,323 academic papers by title, DOI or author."
        />
      </div>
      <PageClient />

      {/* Server-rendered browse block. Without this the hub is a search box and
          nothing else, so a crawler reaching it finds no onward links. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {top.length > 0 && (
          <>
            <h2 className="font-clarendon text-lg font-bold mb-1">Most-cited papers</h2>
            <BrowseList items={top.map((r) => ({
          href: `/papers/${r.paperid}`,
          title: stripInlineHtml(r.title || "Untitled"),
          subtitle: [r.source_name, r.year].filter(Boolean).join(" · ") || null,
          meta: `${formatNumber(r.cited_by_count)} citations`,
        }))} />
            <p className="mt-3 text-sm">
              <Link href="/papers/top" className="text-blue-700 underline">
                See the full ranking →
              </Link>
            </p>
          </>
        )}

        <h2 className="font-clarendon text-lg font-bold mt-10 mb-3">
          Browse by research field
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {TOP_LEVEL_FIELDS.map((f) => (
            <li key={f.fieldid}>
              <Link href={`/fields/${f.fieldid}`} className="text-blue-700 hover:underline">
                {f.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
