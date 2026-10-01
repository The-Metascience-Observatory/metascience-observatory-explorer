/**
 * Values that must agree across the server, the client, and (in one case) the
 * Python importers.
 *
 * This module deliberately imports nothing. Several of these are needed by
 * client components, which cannot import from modules that reach better-sqlite3
 * — that constraint is why EDGE_CAP previously existed as three separate
 * literals under three different names.
 */

/**
 * Maximum neighbours stored per paper in the packed OpenAIRE citation edges.
 *
 * MUST match `--cap` in scripts/openaire_pack_citations.py. Nothing enforces
 * that across the language boundary, so the two are linked only by this comment.
 */
export const EDGE_CAP = 1000;

/** Rows per page for citation and reference lists. */
export const CITATION_PAGE_SIZE = 100;

/** Rows per page for the paginated browse/list pages. */
export const BROWSE_PAGE_SIZE = 50;
