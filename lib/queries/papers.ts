import { cache } from "react";
import { getPapersExtraDb } from "@/lib/db";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  PaperAuthor,
  PaperCitation,
  PaperCitationHistory,
  PaperDetails,
  PaperField,
  PaperPatent,
  PaperReference,
  PaperSummary,
  PaperTrial,
} from "@/lib/types";

/**
 * Read paths for paper_summary and its satellite tables.
 * See lib/queries/mesh.ts for the contract.
 *
 * Every journals.db read goes through the worker pool. A paper render is ~11
 * statements, and under a crawl at 5-10 renders/s with a cold page cache the
 * synchronous getDb() handle kept the main thread in disk wait for minutes at
 * a time (measured 2026-11-03: main thread in state D, 54 GB of 4 KB random
 * reads, all four workers idle, accept backlog full, and the load shedder
 * never firing because its timer could not run either).
 */

/** Indexed single-row lookup — safe for generateMetadata, which blocks the first flush. */
export const getPaperSummary = cache(
  async (paperid: string): Promise<PaperSummary | null> =>
    (await workerQueryOne<PaperSummary>(
      "SELECT * FROM paper_summary WHERE paperid = ?",
      paperid
    )) ?? null
);

/** Authors, ordered first → middle → last. Indexed on paperid; cheap enough for metadata. */
export const getPaperAuthors = cache(
  async (paperid: string): Promise<PaperAuthor[]> =>
    workerQuery<PaperAuthor>(
      `SELECT paperid, authorid, display_name, author_position, institutionid, institution_name
         FROM paper_authors WHERE paperid = ?
        ORDER BY CASE author_position
                   WHEN 'first' THEN 1 WHEN 'middle' THEN 2 WHEN 'last' THEN 3 ELSE 4 END`,
      paperid
    )
);

export const getPaperDetails = cache(
  async (paperid: string): Promise<PaperDetails | null> => {
  try {
  // Get paper summary
  let summary: PaperSummary | undefined;
  try {
    summary = await workerQueryOne<PaperSummary>(
      `SELECT * FROM paper_summary WHERE paperid = ?`,
      paperid
    );
  } catch {
    console.log("paper_summary table not found");
  }

  if (!summary) return null;

  // Get authors
  let authors: PaperAuthor[] = [];
  try {
    authors = await workerQuery<PaperAuthor>(
      `SELECT paperid, authorid, display_name, author_position,
              institutionid, institution_name
       FROM paper_authors
       WHERE paperid = ?
       ORDER BY
         CASE author_position
           WHEN 'first' THEN 1
           WHEN 'middle' THEN 2
           WHEN 'last' THEN 3
           ELSE 4
         END`,
      paperid
    );
  } catch {
    console.log("paper_authors table not found, skipping");
  }

  // Get fields
  let fields: PaperField[] = [];
  try {
    fields = await workerQuery<PaperField>(
      `SELECT paperid, fieldid, field_name, level, score_openalex
       FROM paper_fields
       WHERE paperid = ?
       ORDER BY score_openalex DESC NULLS LAST`,
      paperid
    );
  } catch {
    console.log("paper_fields table not found, skipping");
  }

  // Get references (papers this paper cites) - all, sorted by citations
  let references: PaperReference[] = [];
  try {
    references = await workerQuery<PaperReference>(
      `SELECT ref_paperid, ref_title, ref_year, ref_cited_by_count
       FROM paper_references
       WHERE paperid = ?
       ORDER BY ref_cited_by_count DESC NULLS LAST`,
      paperid
    );
  } catch {
    console.log("paper_references table not found, skipping");
  }

  // Get citations (papers that cite this paper) - first 100, sorted by citations
  let citations: PaperCitation[] = [];
  let citationsTotal = 0;
  try {
    const countResult = await workerQueryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM paper_citations WHERE paperid = ?`,
      paperid
    );
    citationsTotal = countResult?.count || 0;

    citations = await workerQuery<PaperCitation>(
      `SELECT citing_paperid, citing_title, citing_year, citing_cited_by_count
       FROM paper_citations
       WHERE paperid = ?
       ORDER BY citing_cited_by_count DESC NULLS LAST
       LIMIT 100`,
      paperid
    );
  } catch {
    console.log("paper_citations table not found or not indexed, skipping");
  }

  // Get citation history (citations per year)
  // Try precomputed table first, fall back to on-demand calculation
  let citationHistory: PaperCitationHistory[] = [];
  try {
    citationHistory = await workerQuery<PaperCitationHistory>(
      `SELECT year, citation_count
       FROM paper_citation_history
       WHERE paperid = ?
       ORDER BY year`,
      paperid
    );
  } catch {
    // Table doesn't exist, will fall back to on-demand
  }

  // Fall back to on-demand calculation if no precomputed data
  if (citationHistory.length === 0) {
    try {
      citationHistory = await workerQuery<PaperCitationHistory>(
        `SELECT citing_year as year, COUNT(*) as citation_count
         FROM paper_citations
         WHERE paperid = ? AND citing_year IS NOT NULL
         GROUP BY citing_year
         ORDER BY citing_year`,
        paperid
      );
    } catch {
      console.log("Could not fetch citation history");
    }
  }

  // Get clinical trials associated with this paper
  let trials: PaperTrial[] = [];
  try {
    trials = await workerQuery<PaperTrial>(
      `SELECT paperid, nct_id, reference_type
       FROM paper_trials
       WHERE paperid = ?`,
      paperid
    );
  } catch {
    console.log("paper_trials table not found, skipping");
  }

  // Get patents that cite this paper
  let patents: PaperPatent[] = [];
  try {
    patents = await workerQuery<PaperPatent>(
      `SELECT paperid, patent, is_uspto
       FROM paper_patents
       WHERE paperid = ?
       ORDER BY is_uspto DESC, patent`,
      paperid
    );
  } catch {
    // Table doesn't exist yet - will be created by add_paper_patents.py
  }

  const response: PaperDetails = {
    summary,
    authors,
    fields,
    references,
    citations,
    citationsTotal,
    citationHistory,
    trials,
    patents,
  };

    return response;
  } catch (error) {
    console.error("papers/[paperid] query failed:", error);
    throw error;
  }
});

/**
 * True when a paper is absent from paper_summary but present in the reduced
 * `paper_core` table in papers_extra.db.
 *
 * This is the "lite paper" case: the page renders a cut-down view instead of
 * 404ing. The check has to happen before notFound(), or the conversion would
 * turn every lite paper into a hard 404 — the one place a naive port regresses
 * behaviour.
 *
 * Still a synchronous main-thread read: papers_extra.db has no worker pool. It
 * is one indexed lookup and only runs for ids missing from paper_summary.
 */
export const paperExistsInLiteDb = cache(async (paperid: string): Promise<boolean> => {
  const extra = getPapersExtraDb();
  if (!extra) return false;
  try {
    const row = extra
      .prepare("SELECT 1 as ok FROM paper_core WHERE paperid = ?")
      .get(paperid) as { ok: number } | undefined;
    return Boolean(row);
  } catch {
    // paper_core is optional.
    return false;
  }
});
