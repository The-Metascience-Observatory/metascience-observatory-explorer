import { cache } from "react";
import { getCacheDb } from "@/lib/db";

/**
 * Reads the precomputed rank_* tables in cache.db.
 *
 * These exist because the live queries are impossible on the hot path:
 * person_summary has no index on cited_by_count, so "top researchers" would be
 * a full scan of 100M rows per page. scripts/generate-sitemaps.mjs materialises
 * the top 5,000 of each entity type offline, which turns every ranked page into
 * a `rank BETWEEN ? AND ?` over a few thousand small rows.
 *
 * The tables are optional: if the generator has never run, every function here
 * returns an empty array and callers simply render nothing.
 */

export interface RankedPaper {
  rank: number;
  paperid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
  source_name: string | null;
}

export interface RankedPerson {
  rank: number;
  authorid: string;
  display_name: string | null;
  cited_by_count: number | null;
  h_index: number | null;
  works_count: number | null;
  last_known_institution: string | null;
}

export interface RankedAffiliation {
  rank: number;
  institution_id: string;
  display_name: string | null;
  country_code: string | null;
  total_citations: number | null;
  researcher_count: number | null;
}

function selectRange<T>(table: string, offset: number, limit: number): T[] {
  try {
    return getCacheDb()
      .prepare(
        `SELECT * FROM ${table} WHERE rank > ? AND rank <= ? ORDER BY rank`
      )
      .all(offset, offset + limit) as T[];
  } catch {
    // Table absent until scripts/generate-sitemaps.mjs has run.
    return [];
  }
}

function countRows(table: string): number {
  try {
    const row = getCacheDb()
      .prepare(`SELECT COUNT(*) as n FROM ${table}`)
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export const getTopPapers = cache(
  async (offset = 0, limit = 50): Promise<RankedPaper[]> =>
    selectRange<RankedPaper>("rank_papers", offset, limit)
);

export const getTopPersons = cache(
  async (offset = 0, limit = 50): Promise<RankedPerson[]> =>
    selectRange<RankedPerson>("rank_persons", offset, limit)
);

export const getTopAffiliations = cache(
  async (offset = 0, limit = 50): Promise<RankedAffiliation[]> =>
    selectRange<RankedAffiliation>("rank_affiliations", offset, limit)
);

export const getRankCount = cache(
  async (table: "rank_papers" | "rank_persons" | "rank_affiliations"): Promise<number> =>
    countRows(table)
);
