import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Researcher not found",
  robots: { index: false, follow: false },
};

export default function PersonNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Researcher not found
      </h1>
      <p className="text-gray-600 mb-8">
        No researcher with that ID is in the current snapshot. Author IDs look
        like <code>A5023888391</code>.
      </p>
      <p className="text-sm text-gray-500">
        Search{" "}
        <Link href="/persons" className="text-blue-700 underline">
          all researchers
        </Link>
        .
      </p>
    </div>
  );
}
