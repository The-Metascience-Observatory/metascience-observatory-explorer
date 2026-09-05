import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Paper not found",
  robots: { index: false, follow: false },
};

export default function PaperNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Paper not found
      </h1>
      <p className="text-gray-600 mb-8">
        This paper isn&apos;t in the current SciSciNet-V2 snapshot. Paper IDs
        look like <code>W2064815984</code>. If you have a DOI, try looking it up
        directly.
      </p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/papers" className="text-blue-700 underline">
          all papers
        </Link>
        .
      </p>
    </div>
  );
}
