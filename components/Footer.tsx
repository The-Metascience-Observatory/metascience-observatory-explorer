import Link from "next/link";
import { TOP_LEVEL_FIELDS } from "@/lib/field-hierarchy";
import { ORG_NAME, ORG_URL } from "@/lib/site";

/**
 * Site-wide footer. This is a server component on purpose — it is the only
 * source of static internal links in the app, so it has to be present in the
 * server-rendered HTML. Before this existed the whole component returned null,
 * and a crawler could reach exactly one internal URL from the homepage.
 */

const browse: Array<[string, string]> = [
  ["Papers", "/papers"],
  ["Researchers", "/persons"],
  ["Journals", "/journals"],
  ["Institutions", "/affiliations"],
  ["Funders", "/funders"],
  ["Research fields", "/fields"],
  ["Clinical trials", "/trials"],
  ["Retractions", "/retractions"],
];

const rankings: Array<[string, string]> = [
  ["Top journals by impact factor", "/journals/top"],
  ["Funding by country", "/funders-map"],
  ["Search retractions", "/retractions/search"],
];

const observatory: Array<[string, string]> = [
  [ORG_NAME, ORG_URL],
  ["Docs", `${ORG_URL}/docs`],
  ["Bird's-Eye Reviews", `${ORG_URL}/birds-eye-reviews`],
  ["Replications Database", `${ORG_URL}/replications-database`],
  ["Donate", `${ORG_URL}/#donate`],
];

const sources: Array<[string, string]> = [
  ["SciSciNet", "https://www.nature.com/articles/s41597-023-02198-9"],
  ["OpenAIRE Graph", "https://graph.openaire.eu/"],
  ["BIP!", "https://bip.imsi.athenarc.gr/"],
  ["Retraction Watch", "https://retractionwatch.com/"],
  ["ClinicalTrials.gov", "https://clinicaltrials.gov/"],
  ["MeSH", "https://www.nlm.nih.gov/mesh/"],
];

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-clarendon text-sm font-bold text-gray-900 mb-3">
        {title}
      </h2>
      <ul className="space-y-1.5 text-sm">{children}</ul>
    </div>
  );
}

function Internal({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link href={href} className="text-gray-600 hover:text-blue-700 hover:underline">
        {label}
      </Link>
    </li>
  );
}

function External({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        className="text-gray-600 hover:text-blue-700 hover:underline"
        rel="noopener"
      >
        {label}
      </a>
    </li>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 mt-16">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8">
          <Column title="Browse">
            {browse.map(([label, href]) => (
              <Internal key={href} href={href} label={label} />
            ))}
          </Column>

          <Column title="Rankings">
            {rankings.map(([label, href]) => (
              <Internal key={href} href={href} label={label} />
            ))}
          </Column>

          {/* 19 sitewide links straight into the field taxonomy. */}
          <Column title="Research fields">
            {TOP_LEVEL_FIELDS.map((field) => (
              <Internal
                key={field.fieldid}
                href={`/fields/${field.fieldid}`}
                label={field.name}
              />
            ))}
          </Column>

          <Column title={ORG_NAME}>
            {observatory.map(([label, href]) => (
              <External key={href} href={href} label={label} />
            ))}
          </Column>

          <Column title="Data & credits">
            <Internal href="/about" label="About the Explorer" />
            {sources.map(([label, href]) => (
              <External key={href} href={href} label={label} />
            ))}
          </Column>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-xs text-gray-500">
          <p>
            Built on the SciSciNet-V2 data lake. Lin, Z., Yin, Y., Liu, L. et al.{" "}
            <em>
              SciSciNet: A large-scale open data lake for the science of science
              research.
            </em>{" "}
            Sci Data 10, 315 (2023). See{" "}
            <Link href="/about" className="underline hover:text-blue-700">
              about
            </Link>{" "}
            for full sources and licences.
          </p>
        </div>
      </div>
    </footer>
  );
}
