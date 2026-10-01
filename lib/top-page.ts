import type { Metadata } from "next";

/**
 * Shared pieces of the "top ranked entities" pages (/papers/top, /persons/top,
 * /affiliations/top, /journals/top), which were four near-copies.
 */

/** `?page=` parsing. Anything non-numeric or below 1 falls back to page 1. */
export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface TopPageMeta {
  title: string;
  description: string;
  /** Route path without a query string, e.g. "/papers/top". */
  path: string;
}

/**
 * Metadata for one page of a ranked list.
 *
 * The canonical is self-referencing per page on purpose: pointing page N back at
 * page 1 would de-index the very pages that carry the entity links.
 */
export function topPageMetadata({ title, description, path }: TopPageMeta, page: number): Metadata {
  const suffix = page > 1 ? ` — Page ${page}` : "";
  return {
    title: `${title}${suffix}`,
    description,
    alternates: { canonical: page > 1 ? `${path}?page=${page}` : path },
    openGraph: { title: `${title}${suffix}`, description },
  };
}
