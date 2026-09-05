import type { Metadata } from "next";
import { Users } from "lucide-react";
import Link from "next/link";
import PageClient from "./PageClient";
import { BrowseList } from "@/components/BrowseList";
import { formatNumber } from "@/lib/utils";
import { getTopPersons } from "@/lib/queries/ranks";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 100 Million Researchers",
  description:
    "Find researchers across 100 million indexed authors. Publication records, citation counts, h-index, co-authors, institutions and funding for every researcher.",
  alternates: { canonical: "/persons" },
  openGraph: {
    title: "Search 100 Million Researchers",
    description:
      "Find researchers across 100 million indexed authors. Publication records, citation counts, h-index, co-authors, institutions and funding for every researcher.",
    url: "/persons",
  },
};

export const revalidate = 86400;

export default async function Page() {
  const top = await getTopPersons(0, 20);

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<Users className="h-8 w-8" />}
          title="Researchers"
          description="Search through 100,418,971 researchers by name, institution or ORCID."
        />
      </div>
      <PageClient />

      {/* Server-rendered browse block. Without this the hub is a search box and
          nothing else, so a crawler reaching it finds no onward links. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {top.length > 0 && (
          <>
            <h2 className="font-clarendon text-lg font-bold mb-1">Most-cited researchers</h2>
            <BrowseList items={top.map((r) => ({
          href: `/persons/${r.authorid}`,
          title: r.display_name || "Unknown researcher",
          subtitle: r.last_known_institution || null,
          meta: `${formatNumber(r.cited_by_count)} citations`,
        }))} />
            <p className="mt-3 text-sm">
              <Link href="/persons/top" className="text-blue-700 underline">
                See the full ranking →
              </Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
