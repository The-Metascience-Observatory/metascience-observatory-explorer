import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";
import { stripInlineHtml } from "@/lib/sanitize";

/**
 * schema.org builders for the entity pages.
 *
 * Be clear-eyed about what this buys: Google retired the dedicated
 * scholarly-article rich result, so this is not a route to a fancier SERP
 * listing. The value is entity grounding in the Knowledge Graph, plus
 * consumption by Bing and the AI answer engines that robots.txt admits — which
 * is the traffic actually worth courting for this content.
 *
 * Google Scholar reads none of this. It reads Highwire Press `citation_*` meta
 * tags, which are emitted from the paper page's generateMetadata instead.
 */

const CONTEXT = "https://schema.org";

/** The site itself, referenced by every entity so they hang off one node. */
function isPartOfSite() {
  return { "@type": "WebSite", name: SITE_NAME, url: SITE_URL };
}

/** Home > Papers > <title>. Breadcrumbs are still a live rich result. */
export function breadcrumbLd(trail: Array<[label: string, path: string]>) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: [["Home", "/"], ...trail].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: stripInlineHtml(name).slice(0, 200),
      item: absoluteUrl(path),
    })),
  };
}

export function webSiteLd() {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/papers?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface MeshLdInput {
  meshUi: string;
  meshName: string;
  scopeNote: string | null;
}

export function meshTermLd(m: MeshLdInput) {
  const url = absoluteUrl(`/mesh/${m.meshUi}`);
  return {
    "@context": CONTEXT,
    "@type": "DefinedTerm",
    "@id": url,
    name: m.meshName,
    termCode: m.meshUi,
    ...(m.scopeNote ? { description: stripInlineHtml(m.scopeNote) } : {}),
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "Medical Subject Headings (MeSH)",
      url: "https://www.nlm.nih.gov/mesh/",
    },
    // The authoritative NLM record for this term.
    sameAs: `https://meshb.nlm.nih.gov/record/ui?ui=${encodeURIComponent(m.meshUi)}`,
    url,
    isPartOf: isPartOfSite(),
    // The broader/narrower hierarchy is deliberately not encoded here:
    // schema.org's DefinedTerm has no such properties (that's SKOS), and
    // inventing vocabulary adds bytes without adding meaning. The rendered
    // <a href> links to parent and child terms carry that signal instead.
  };
}

export interface FieldLdInput {
  fieldid: string;
  displayName: string;
  level: number;
  paperCount: number | null;
}

export function researchFieldLd(f: FieldLdInput) {
  const url = absoluteUrl(`/fields/${f.fieldid}`);
  return {
    "@context": CONTEXT,
    "@type": "DefinedTerm",
    "@id": url,
    name: f.displayName,
    termCode: f.fieldid,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "OpenAlex research fields",
      url: "https://openalex.org/",
    },
    url,
    isPartOf: isPartOfSite(),
  };
}

export interface OrganizationLdInput {
  id: string;
  path: string;
  name: string;
  /** schema.org subtype, e.g. CollegeOrUniversity. */
  type?: string;
  countryCode?: string | null;
  homepageUrl?: string | null;
  ror?: string | null;
  description?: string | null;
}

export function organizationLd(o: OrganizationLdInput) {
  const url = absoluteUrl(o.path);
  const sameAs = [
    o.homepageUrl || null,
    o.ror ? `https://ror.org/${String(o.ror).replace(/^https?:\/\/ror\.org\//, "")}` : null,
  ].filter(Boolean);

  return {
    "@context": CONTEXT,
    "@type": o.type ?? "Organization",
    "@id": url,
    name: o.name,
    url,
    ...(o.description ? { description: stripInlineHtml(o.description).slice(0, 500) } : {}),
    ...(o.ror
      ? { identifier: { "@type": "PropertyValue", propertyID: "ROR", value: o.ror } }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(o.countryCode
      ? { address: { "@type": "PostalAddress", addressCountry: o.countryCode } }
      : {}),
    isPartOf: isPartOfSite(),
  };
}

/**
 * Map the dataset's institution `type` onto the most specific schema.org type
 * that fits. Anything unrecognised stays a plain Organization.
 */
export function institutionSchemaType(type: string | null | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "education":
      return "CollegeOrUniversity";
    case "healthcare":
      return "MedicalOrganization";
    case "government":
      return "GovernmentOrganization";
    case "company":
      return "Corporation";
    case "facility":
    case "archive":
    case "nonprofit":
    case "other":
      return "Organization";
    default:
      return "Organization";
  }
}
