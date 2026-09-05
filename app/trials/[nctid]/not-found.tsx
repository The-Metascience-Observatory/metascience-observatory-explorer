import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clinical trial not found",
  robots: { index: false, follow: false },
};

export default function TrialNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Clinical trial not found
      </h1>
      <p className="text-gray-600 mb-8">
        No trial with that registry ID is in the current snapshot. NCT IDs look
        like <code>NCT00000102</code>.
      </p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/trials" className="text-blue-700 underline">
          all clinical trials
        </Link>
        .
      </p>
    </div>
  );
}
