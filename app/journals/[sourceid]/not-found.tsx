import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Journal not found",
  robots: { index: false, follow: false },
};

export default function JournalNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Journal not found
      </h1>
      <p className="text-gray-600 mb-8">
        No journal with that ID exists in the current snapshot. Journal IDs look
        like <code>S137773608</code>.
      </p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/journals" className="text-blue-700 underline">
          all journals
        </Link>{" "}
        or browse the{" "}
        <Link href="/journals/top" className="text-blue-700 underline">
          top journals by impact factor
        </Link>
        .
      </p>
    </div>
  );
}
