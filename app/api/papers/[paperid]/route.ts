import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type {
  PaperSummary,
  PaperAuthor,
  PaperField,
  PaperReference,
  PaperCitation,
  PaperDetails,
  PaperCitationHistory,
  PaperTrial,
  PaperPatent,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ paperid: string }> }
) {
  try {
    const { paperid } = await params;

    // Check if database is available
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        {
          error: "Database not found. Run the preprocessing script first.",
        },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get paper summary
    let summary: PaperSummary | undefined;
    try {
      summary = db
        .prepare(`SELECT * FROM paper_summary WHERE paperid = ?`)
        .get(paperid) as PaperSummary | undefined;
    } catch {
      console.log("paper_summary table not found");
    }

    if (!summary) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404 }
      );
    }

    // Get authors
    let authors: PaperAuthor[] = [];
    try {
      authors = db
        .prepare(
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
             END`
        )
        .all(paperid) as PaperAuthor[];
    } catch {
      console.log("paper_authors table not found, skipping");
    }

    // Get fields
    let fields: PaperField[] = [];
    try {
      fields = db
        .prepare(
          `SELECT paperid, fieldid, field_name, level, score_openalex
           FROM paper_fields
           WHERE paperid = ?
           ORDER BY score_openalex DESC NULLS LAST`
        )
        .all(paperid) as PaperField[];
    } catch {
      console.log("paper_fields table not found, skipping");
    }

    // Get references (papers this paper cites) - all, sorted by citations
    let references: PaperReference[] = [];
    try {
      references = db
        .prepare(
          `SELECT ref_paperid, ref_title, ref_year, ref_cited_by_count
           FROM paper_references
           WHERE paperid = ?
           ORDER BY ref_cited_by_count DESC NULLS LAST`
        )
        .all(paperid) as PaperReference[];
    } catch {
      console.log("paper_references table not found, skipping");
    }

    // Get citations (papers that cite this paper) - first 100, sorted by citations
    let citations: PaperCitation[] = [];
    let citationsTotal = 0;
    try {
      const countResult = db
        .prepare(`SELECT COUNT(*) as count FROM paper_citations WHERE paperid = ?`)
        .get(paperid) as { count: number } | undefined;
      citationsTotal = countResult?.count || 0;

      citations = db
        .prepare(
          `SELECT citing_paperid, citing_title, citing_year, citing_cited_by_count
           FROM paper_citations
           WHERE paperid = ?
           ORDER BY citing_cited_by_count DESC NULLS LAST
           LIMIT 100`
        )
        .all(paperid) as PaperCitation[];
    } catch {
      console.log("paper_citations table not found or not indexed, skipping");
    }

    // Get citation history (citations per year)
    // Try precomputed table first, fall back to on-demand calculation
    let citationHistory: PaperCitationHistory[] = [];
    try {
      citationHistory = db
        .prepare(
          `SELECT year, citation_count
           FROM paper_citation_history
           WHERE paperid = ?
           ORDER BY year`
        )
        .all(paperid) as PaperCitationHistory[];
    } catch {
      // Table doesn't exist, will fall back to on-demand
    }

    // Fall back to on-demand calculation if no precomputed data
    if (citationHistory.length === 0) {
      try {
        citationHistory = db
          .prepare(
            `SELECT citing_year as year, COUNT(*) as citation_count
             FROM paper_citations
             WHERE paperid = ? AND citing_year IS NOT NULL
             GROUP BY citing_year
             ORDER BY citing_year`
          )
          .all(paperid) as PaperCitationHistory[];
      } catch {
        console.log("Could not fetch citation history");
      }
    }

    // Get clinical trials associated with this paper
    let trials: PaperTrial[] = [];
    try {
      trials = db
        .prepare(
          `SELECT paperid, nct_id, reference_type
           FROM paper_trials
           WHERE paperid = ?`
        )
        .all(paperid) as PaperTrial[];
    } catch {
      console.log("paper_trials table not found, skipping");
    }

    // Get patents that cite this paper
    let patents: PaperPatent[] = [];
    try {
      patents = db
        .prepare(
          `SELECT paperid, patent, is_uspto
           FROM paper_patents
           WHERE paperid = ?
           ORDER BY is_uspto DESC, patent`
        )
        .all(paperid) as PaperPatent[];
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

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "papers/[paperid]");
  }
}
