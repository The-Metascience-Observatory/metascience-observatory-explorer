import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { TOP_LEVEL_FIELDS } from "@/lib/field-hierarchy";
import { ORG_NAME, ORG_URL } from "@/lib/site";

/** Level-0 fields left out of the footer to keep the column focused. */
const FOOTER_FIELD_EXCLUDES = new Set(["Art", "Business", "Geography", "History", "Philosophy"]);
const footerFields = TOP_LEVEL_FIELDS.filter((f) => !FOOTER_FIELD_EXCLUDES.has(f.name));

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
  href,
  children,
}: {
  title: string;
  /** Optional URL the column heading links to: an internal route or an external site. */
  href?: string;
  children: React.ReactNode;
}) {
  const headingClass = "hover:text-blue-700 hover:underline";
  return (
    <div>
      <h2 className="font-clarendon text-sm font-bold text-gray-900 mb-3">
        {href === undefined ? (
          title
        ) : href.startsWith("/") ? (
          <Link href={href} className={headingClass}>
            {title}
          </Link>
        ) : (
          <a href={href} className={headingClass} rel="noopener">
            {title}
          </a>
        )}
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

function External({
  href,
  label,
  marked = false,
}: {
  href: string;
  label: string;
  /** Show an external-link icon after the label. */
  marked?: boolean;
}) {
  return (
    <li>
      <a
        href={href}
        className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-700 hover:underline"
        rel="noopener"
      >
        {label}
        {marked && (
          <ExternalLink className="h-3 w-3 text-gray-400 shrink-0" aria-hidden="true" />
        )}
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

          {/* Sitewide links straight into the field taxonomy. */}
          <Column title="Research fields" href="/fields">
            {footerFields.map((field) => (
              <Internal
                key={field.fieldid}
                href={`/fields/${field.fieldid}`}
                label={field.name}
              />
            ))}
          </Column>

          <Column title={ORG_NAME} href={ORG_URL}>
            {observatory.map(([label, href]) => (
              <External key={href} href={href} label={label} />
            ))}
          </Column>

          <Column title="Data & credits">
            <Internal href="/about" label="About the Explorer" />
            {sources.map(([label, href]) => (
              <External key={href} href={href} label={label} marked />
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
