import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research field not found",
  robots: { index: false, follow: false },
};

export default function FieldNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Research field not found
      </h1>
      <p className="text-gray-600 mb-8">
        No field with that ID exists. The taxonomy has 19 broad fields and 284
        subfields, with IDs that look like <code>C41008148</code>.
      </p>
      <p className="text-sm text-gray-500">
        Browse{" "}
        <Link href="/fields" className="text-blue-700 underline">
          all research fields
        </Link>
        .
      </p>
    </div>
  );
}
