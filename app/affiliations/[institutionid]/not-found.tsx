import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Institution not found",
  robots: { index: false, follow: false },
};

export default function AffiliationNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Institution not found
      </h1>
      <p className="text-gray-600 mb-8">
        No institution with that ID exists in the current snapshot. Institution
        IDs look like <code>I136199984</code>.
      </p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/affiliations" className="text-blue-700 underline">
          all institutions
        </Link>
        .
      </p>
    </div>
  );
}
