import { SITE_URL } from "@/lib/site";

/**
 * robots.txt as a route handler rather than `app/robots.ts`, because
 * MetadataRoute.Robots cannot emit the Content-Signal comment block and gives
 * no control over group ordering.
 *
 * NOTE: `public/robots.txt` must not exist — a static public file shadows this
 * route and Next fails the build with a conflicting-route error.
 *
 * Group semantics matter here: a crawler obeys ONLY the single most-specific
 * group that matches it. Anything Googlebot should honour has to be repeated
 * inside the Googlebot group; rules in `User-agent: *` do not apply to it.
 */

// Answer engines send cited referral traffic, so they are welcome.
const ALLOWED_BOTS = [
  "Googlebot",
  "Googlebot-Image",
  "Google-InspectionTool",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Claude-SearchBot",
  "Claude-User",
];

// Commercial SEO/bulk scrapers: pure CPU cost to a small origin, no referrals.
const BLOCKED_BOTS = [
  "AhrefsBot",
  "SemrushBot",
  "DataForSeoBot",
  "MJ12bot",
  "DotBot",
  "Barkrowler",
  "Bytespider",
  "PetalBot",
  "Amazonbot",
  "ImagesiftBot",
];

/**
 * Paths worth excluding for every crawler that we actually want indexing us.
 *
 * These MUST be repeated in each named group: a crawler applies only its own
 * most-specific group, so a Disallow that lives solely under `User-agent: *`
 * does nothing for Googlebot.
 *
 * `/analytics` is deliberately absent — it is kept out of the index with an
 * X-Robots-Tag header instead. A disallowed URL can still be indexed from an
 * external link precisely because the crawler never fetches it to discover the
 * noindex, so for that page the header is strictly stronger than a Disallow.
 */
const COMMON_DISALLOW = [
  "Disallow: /api/",
  // Unbounded redirect surface: unknown DOIs forward to doi.org.
  "Disallow: /doi/",
  // Internal search results are the canonical thin/duplicate-content case.
  "Disallow: /*?q=",
  "Disallow: /*?offset=",
  "Disallow: /*?intervention=",
  "Disallow: /*?token=",
  // NOTE: ?page= and ?sort= are deliberately NOT blocked — hub pagination is
  // how detail pages get discovered. Non-canonical sort variants are kept out
  // of the index with <meta robots="noindex,follow"> instead, which still
  // allows the links on them to be followed.
];

function buildRobotsTxt(): string {
  const lines: string[] = [
    "# Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "#",
    "# Mirrors metascienceobservatory.org. Everything here is derived from",
    "# openly licensed sources (SciSciNet-V2, OpenAIRE Graph, Retraction Watch,",
    "# ClinicalTrials.gov, MeSH) and is meant to be read, cited and reused.",
    "",
  ];

  // Search engines and answer engines: full crawl of the content, no pacing.
  for (const bot of ALLOWED_BOTS) {
    lines.push(`User-agent: ${bot}`);
  }
  lines.push("Allow: /", ...COMMON_DISALLOW, "");

  for (const bot of BLOCKED_BOTS) {
    lines.push(`User-agent: ${bot}`);
  }
  lines.push("Disallow: /", "");

  // Everything else, including training crawlers: allowed but paced. The
  // binding constraint on this deployment is a small origin server, not
  // licensing.
  lines.push(
    "User-agent: *",
    "Allow: /",
    "Crawl-delay: 10",
    ...COMMON_DISALLOW,
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  );

  return lines.join("\n");
}

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildRobotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
