import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import PageClient from "./PageClient";
import { HubHeader } from "@/components/HubHeader";

export const metadata: Metadata = {
  title: "Search 260,918 Academic Journals",
  description:
    "Search 260,918 academic journals by name, ISSN or publisher. Impact factors, CiteScore, open-access status, publication trends and retraction statistics.",
  alternates: { canonical: "/journals" },
  openGraph: {
    title: "Search 260,918 Academic Journals",
    description:
      "Search 260,918 academic journals by name, ISSN or publisher. Impact factors, CiteScore, open-access status, publication trends and retraction statistics.",
    url: "/journals",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<BookOpen className="h-8 w-8" />}
          title="Journals"
          description="Search through 260,918 academic journals by name, ISSN or publisher."
        />
      </div>
      <PageClient />
    </>
  );
}
