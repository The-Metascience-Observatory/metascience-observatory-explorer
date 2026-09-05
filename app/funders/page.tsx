import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import PageClient from "./PageClient";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 32,437 Research Funders",
  description:
    "Explore 32,437 research funding bodies worldwide. Grants awarded, funded publications, citation impact and open-access rates for every funder.",
  alternates: { canonical: "/funders" },
  openGraph: {
    title: "Search 32,437 Research Funders",
    description:
      "Explore 32,437 research funding bodies worldwide. Grants awarded, funded publications, citation impact and open-access rates for every funder.",
    url: "/funders",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<Landmark className="h-8 w-8" />}
          title="Funders"
          description="Search through 32,437 research funders by name or country."
        />
      </div>
      <PageClient />
    </>
  );
}
