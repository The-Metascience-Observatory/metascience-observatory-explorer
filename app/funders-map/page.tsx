import type { Metadata } from "next";
import PageClient from "./PageClient";

export const metadata: Metadata = {
  title: "Research Funding by Country",
  description:
    "Interactive world map of research funding. Compare funders, grant counts and funded publication output across 156 countries.",
  alternates: { canonical: "/funders-map" },
  openGraph: {
    title: "Research Funding by Country",
    description:
      "Interactive world map of research funding. Compare funders, grant counts and funded publication output across 156 countries.",
    url: "/funders-map",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-2xl font-bold mb-1">Research Funding by Country</h1>
      </div>
      <PageClient />
    </>
  );
}
