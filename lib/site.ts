/**
 * Public identity of this deployment.
 *
 * Deliberately NOT a NEXT_PUBLIC_* var: `metadataBase` and the sitemap/robots
 * routes are server-only, and a NEXT_PUBLIC_ var must exist at *build* time.
 * `.dockerignore` excludes `.env*` and docker-compose only passes NODE_ENV, so
 * a public var would silently be `undefined` in the image. A plain server env
 * var read at runtime works with zero build plumbing.
 */
export const SITE_URL = (
  process.env.SITE_URL ?? "https://explore.metascienceobservatory.org"
).replace(/\/$/, "");

export const SITE_NAME = "The Metascience Observatory Explorer";

/** The separate marketing site at the apex domain. */
export const ORG_URL = "https://metascienceobservatory.org";
export const ORG_NAME = "The Metascience Observatory";

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
