import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MeSH term not found",
  robots: { index: false, follow: false },
};

export default function MeshNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        MeSH term not found
      </h1>
      <p className="text-gray-600 mb-8">
        No Medical Subject Heading with that descriptor ID exists in the current
        snapshot. MeSH descriptor IDs look like <code>D009369</code>.
      </p>
      <p className="text-sm text-gray-500">
        Browse{" "}
        <Link href="/papers" className="text-blue-700 underline">
          papers
        </Link>
        ,{" "}
        <Link href="/journals" className="text-blue-700 underline">
          journals
        </Link>
        , or look the term up in the{" "}
        <a
          href="https://meshb.nlm.nih.gov/search"
          className="text-blue-700 underline"
          rel="noopener noreferrer"
        >
          NLM MeSH Browser
        </a>
        .
      </p>
    </div>
  );
}
