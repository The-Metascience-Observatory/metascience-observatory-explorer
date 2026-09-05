import type { Metadata } from "next";
import PageClient from "./PageClient";

export const metadata: Metadata = {
  title: "Retraction Statistics and Trends",
  description:
    "Analysis of 68,123 retractions, expressions of concern and corrections from the Retraction Watch database: trends by year, journals with the most retractions, and reasons.",
  alternates: { canonical: "/retractions" },
  openGraph: {
    title: "Retraction Statistics and Trends",
    description:
      "Analysis of 68,123 retractions, expressions of concern and corrections from the Retraction Watch database: trends by year, journals with the most retractions, and reasons.",
    url: "/retractions",
  },
};

export default function Page() {
  return (
    <>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-3xl font-bold mb-2">Retraction Analytics</h1>
      </div>
      <PageClient />
    </>
  );
}
