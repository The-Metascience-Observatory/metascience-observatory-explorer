import { cache } from "react";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  FieldDetails,
  FieldItem,
  FieldTopAuthor,
  FieldTopCitedPaper,
  FieldTopPaper,
} from "@/lib/types";

/** Read paths for field_summary and its satellite tables. See lib/queries/mesh.ts for the contract. */

/** Indexed single-row lookup — safe for generateMetadata. */
export const getFieldSummary = cache(
  async (fieldid: string): Promise<FieldItem | null> =>
    (await workerQueryOne<FieldItem>(
      "SELECT * FROM field_summary WHERE fieldid = ?",
      fieldid
    )) ?? null
);

export const getFieldTopPapers = cache(
  async (fieldid: string): Promise<FieldTopPaper[]> => {
    try {
      return await workerQuery<FieldTopPaper>(
        `SELECT paperid, title, year, cited_by_count, source_name
           FROM field_top_papers WHERE fieldid = ?
          ORDER BY cited_by_count DESC LIMIT 50`,
        fieldid
      );
    } catch {
      // Optional precomputed table.
      return [];
    }
  }
);

export const getFieldTopAuthors = cache(
  async (fieldid: string): Promise<FieldTopAuthor[]> => {
    try {
      return await workerQuery<FieldTopAuthor>(
        `SELECT authorid, display_name, h_index, paper_count
           FROM field_top_authors WHERE fieldid = ?
          ORDER BY paper_count DESC LIMIT 50`,
        fieldid
      );
    } catch {
      return [];
    }
  }
);

/**
 * Field-normalised top papers. Level-0 and level-1 fields live in separate
 * precomputed tables, so try the broad one first and fall back.
 */
export const getFieldTopCitedPapers = cache(
  async (fieldid: string): Promise<FieldTopCitedPaper[]> => {
    const select = (table: string) =>
      workerQuery<FieldTopCitedPaper>(
        `SELECT fieldid, paperid, title, year, citation_count, normalized_citations, source_name
           FROM ${table} WHERE fieldid = ?
          ORDER BY normalized_citations DESC LIMIT 20`,
        fieldid
      );

    try {
      const level0 = await select("field_top_cited_papers_level0");
      if (level0.length > 0) return level0;
      return await select("field_top_cited_papers_level1");
    } catch {
      return [];
    }
  }
);

export const getFieldDetails = cache(
  async (fieldid: string): Promise<FieldDetails | null> => {
    const summary = await getFieldSummary(fieldid);
    if (!summary) return null;

    const [topPapers, topAuthors, topCitedPapers] = await Promise.all([
      getFieldTopPapers(fieldid),
      getFieldTopAuthors(fieldid),
      getFieldTopCitedPapers(fieldid),
    ]);

    return { summary, topPapers, topAuthors, topCitedPapers };
  }
);

/**
 * All 303 taxonomy rows (19 level-0 + 284 level-1), keyed by id.
 *
 * Small enough to fetch whole and cache: it backs the crawlable field index on
 * /fields, where the subfield ids come from FIELD_SUBFIELD_MAP but the display
 * names and paper counts have to come from the database.
 */
export const getFieldsById = cache(
  async (): Promise<Map<string, FieldItem>> => {
    const rows = await workerQuery<FieldItem>(
      "SELECT * FROM field_summary WHERE level <= 1"
    );
    return new Map(rows.map((f) => [f.fieldid, f]));
  }
);
