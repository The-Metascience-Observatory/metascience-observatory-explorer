import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import PageClient from "./PageClient";
import { HubHeader } from "@/components/HubHeader";
import { ENTITY_COUNTS } from "@/lib/counts";
import { formatNumber } from "@/lib/utils";

const description =
  "Look up a grant by its award number and see every paper linked to it: NIH, NSF and 100+ funders in the OpenAIRE Graph, " +
  "with papers reported by the funder and papers that acknowledge the grant.";

export const metadata: Metadata = {
  title: "Search Grants by Award Number",
  description,
  alternates: { canonical: "/grants" },
  openGraph: { title: "Search Grants by Award Number", description, url: "/grants" },
};

/** Server-rendered so a crawler reaching the hub finds onward links. */
const EXAMPLES: Array<[label: string, href: string, note: string]> = [
  ["R25MH101072", "/grants/nih/R25MH101072", "NIH education grant"],
  ["AG066215", "/grants/nih/R56AG066215", "NIH serial number, any activity code"],
  ["NSF-1907207", "/grants/nsf/1907207", "NSF award"],
  ["733280", "/grants/ec/733280", "EU Horizon 2020 project"],
  ["ST/W001845/1", "/grants/ukri/STW0018451", "UKRI council reference"],
];

export default function Page() {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <HubHeader
          icon={<Landmark className="h-8 w-8" />}
          title="Grants"
          description={`Search ${formatNumber(ENTITY_COUNTS.grants)} grants by award number and see the papers linked to each.`}
        />
      </div>
      <PageClient />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 text-sm text-gray-600 dark:text-gray-400 space-y-4">
        <div>
          <h2 className="font-clarendon text-lg font-bold mb-1 text-gray-900 dark:text-gray-100">Examples</h2>
          <ul className="space-y-1">
            {EXAMPLES.map(([label, href, note]) => (
              <li key={href}>
                <Link href={href} className="font-mono text-blue-700 underline">
                  {label}
                </Link>
                <span className="ml-2">{note}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-clarendon text-lg font-bold mb-1 text-gray-900 dark:text-gray-100">Two kinds of link</h2>
          <p>
            <strong>Reported by the funder</strong> means the funder&apos;s own records attribute the paper to the award:
            NIH RePORTER/ExPORTER publication links and NSF award publication links, as distributed in SciSciNet.
          </p>
          <p className="mt-1">
            <strong>Acknowledged in the paper</strong> means the paper itself cites the award number: the grant field
            PubMed records from each article, and project links mined by the OpenAIRE Graph. The two overlap heavily;
            each paper is listed once with badges for every source that links it.
          </p>
          <p className="mt-1">
            NIH numbers resolve on their core project number, so <span className="font-mono">5R25MH101072-02</span>,{" "}
            <span className="font-mono">R25 MH101072</span> and <span className="font-mono">R25MH101072</span> are one grant,
            and a bare serial like <span className="font-mono">MH101072</span> finds every activity code on that project.
          </p>
        </div>
      </div>
    </>
  );
}
