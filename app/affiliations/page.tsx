import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import Link from "next/link";
import PageClient from "./PageClient";
import { BrowseList } from "@/components/BrowseList";
import { formatNumber } from "@/lib/utils";
import { getTopAffiliations } from "@/lib/queries/ranks";
import { getCountryName } from "@/lib/utils";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 110,553 Research Institutions",
  description:
    "Browse 110,553 universities, hospitals and research institutions. Publication output, citation counts, h-index, top researchers and collaboration networks.",
  alternates: { canonical: "/affiliations" },
  openGraph: {
    title: "Search 110,553 Research Institutions",
    description:
      "Browse 110,553 universities, hospitals and research institutions. Publication output, citation counts, h-index, top researchers and collaboration networks.",
    url: "/affiliations",
  },
};

export const revalidate = 86400;

export default async function Page() {
  const top = await getTopAffiliations(0, 20);

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<Building2 className="h-8 w-8" />}
          title="Institutions"
          description="Search through 110,553 universities, hospitals and research institutions."
        />
      </div>
      <PageClient />

      {/* Server-rendered browse block. Without this the hub is a search box and
          nothing else, so a crawler reaching it finds no onward links. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {top.length > 0 && (
          <>
            <h2 className="font-clarendon text-lg font-bold mb-1">Top institutions by citations</h2>
            <BrowseList items={top.map((r) => ({
          href: `/affiliations/${r.institution_id}`,
          title: r.display_name || r.institution_id,
          subtitle: r.country_code ? getCountryName(r.country_code) : null,
          meta: `${formatNumber(r.total_citations)} citations`,
        }))} />
            <p className="mt-3 text-sm">
              <Link href="/affiliations/top" className="text-blue-700 underline">
                See the full ranking →
              </Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
