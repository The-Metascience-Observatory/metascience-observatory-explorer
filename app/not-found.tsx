import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

const hubs: Array<[string, string, string]> = [
  ["Papers", "/papers", "283 million research papers"],
  ["Researchers", "/persons", "100 million authors"],
  ["Journals", "/journals", "260,918 journals"],
  ["Institutions", "/affiliations", "110,553 institutions"],
  ["Funders", "/funders", "32,437 funding bodies"],
  ["Clinical trials", "/trials", "562,856 registered studies"],
];

export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="font-clarendon text-3xl font-bold text-gray-900 mb-3">
        Page not found
      </h1>
      <p className="text-gray-600 mb-10">
        That URL isn&apos;t in the Explorer. It may have been mistyped, or the
        record may not exist in the current data snapshot.
      </p>

      <h2 className="font-clarendon text-lg font-bold text-gray-900 mb-4">
        Try one of these instead
      </h2>
      <ul className="grid sm:grid-cols-2 gap-3">
        {hubs.map(([label, href, blurb]) => (
          <li key={href}>
            <Link
              href={href}
              className="block rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:shadow-xs transition-all"
            >
              <span className="block font-semibold text-blue-700">{label}</span>
              <span className="block text-sm text-gray-500">{blurb}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-gray-500">
        Or go back to the{" "}
        <Link href="/" className="text-blue-700 underline">
          homepage
        </Link>
        .
      </p>
    </div>
  );
}
