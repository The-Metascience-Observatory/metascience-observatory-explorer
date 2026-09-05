import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import PageClient from "./PageClient";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 562,856 Clinical Trials",
  description:
    "Search clinical trials registered on ClinicalTrials.gov by title, condition or intervention. Study status, phase, sponsor, enrollment and linked publications.",
  alternates: { canonical: "/trials" },
  openGraph: {
    title: "Search 562,856 Clinical Trials",
    description:
      "Search clinical trials registered on ClinicalTrials.gov by title, condition or intervention. Study status, phase, sponsor, enrollment and linked publications.",
    url: "/trials",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<FlaskConical className="h-8 w-8" />}
          title="Clinical Trials"
          description="Search through 562,856 clinical trials from ClinicalTrials.gov."
        />
      </div>
      <PageClient />
    </>
  );
}
