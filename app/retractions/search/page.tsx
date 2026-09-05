import type { Metadata } from "next";
import PageClient from "./PageClient";

export const metadata: Metadata = {
  title: "Search Retracted Papers",
  description:
    "Search the Retraction Watch database of 68,123 retracted papers, expressions of concern and corrections by title, author, journal or reason for retraction.",
  alternates: { canonical: "/retractions/search" },
  openGraph: {
    title: "Search Retracted Papers",
    description:
      "Search the Retraction Watch database of 68,123 retracted papers, expressions of concern and corrections by title, author, journal or reason for retraction.",
    url: "/retractions/search",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-3xl font-bold mb-2">Search Retracted Papers</h1>
      </div>
      <PageClient />
    </>
  );
}
