import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Funder not found",
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Funder not found
      </h1>
      <p className="text-gray-600 mb-8">No research funder with that ID exists in the current snapshot. Funder IDs look like <code>F4320306076</code>.</p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/funders" className="text-blue-700 underline">
          all funders
        </Link>
        .
      </p>
    </div>
  );
}
