import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type {
  TrialSummary,
  TrialPaper,
  TrialDetails,
  TrialYearlyStats,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nctid: string }> }
) {
  try {
    const { nctid } = await params;

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

    // Get trial data by joining trial_summary (paper stats) with ctg_studies (CTG metadata)
    // Use LEFT JOINs so we can show trials that exist in either table
    let summary: TrialSummary | undefined;
    try {
      summary = db
        .prepare(`
          SELECT
            COALESCE(ts.nct_id, ctg.nct_id) as nct_id,
            COALESCE(ts.paper_count, 0) as paper_count,
            ts.result_paper_count,
            ts.derived_paper_count,
            ts.background_paper_count,
            ctg.title,
            ctg.status,
            ctg.phase,
            ctg.study_type,
            ctg.conditions,
            ctg.interventions,
            ctg.sponsor,
            ctg.enrollment,
            ctg.start_date,
            ctg.completion_date,
            ctg.brief_summary
          FROM ctg_studies ctg
          LEFT JOIN trial_summary ts ON ctg.nct_id = ts.nct_id
          WHERE ctg.nct_id = ?

          UNION ALL

          SELECT
            ts.nct_id,
            ts.paper_count,
            ts.result_paper_count,
            ts.derived_paper_count,
            ts.background_paper_count,
            NULL as title,
            NULL as status,
            NULL as phase,
            NULL as study_type,
            NULL as conditions,
            NULL as interventions,
            NULL as sponsor,
            NULL as enrollment,
            NULL as start_date,
            NULL as completion_date,
            NULL as brief_summary
          FROM trial_summary ts
          WHERE ts.nct_id = ?
            AND NOT EXISTS (SELECT 1 FROM ctg_studies ctg WHERE ctg.nct_id = ts.nct_id)

          LIMIT 1
        `)
        .get(nctid, nctid) as TrialSummary | undefined;
    } catch (e) {
      console.log("Error querying trial:", e);
    }

    if (!summary) {
      return NextResponse.json(
        { error: "Clinical trial not found" },
        { status: 404 }
      );
    }

    // Compute unknown_paper_count (papers without a known reference type)
    const knownCount =
      (summary.result_paper_count ?? 0) +
      (summary.derived_paper_count ?? 0) +
      (summary.background_paper_count ?? 0);
    summary.unknown_paper_count = Math.max(0, summary.paper_count - knownCount);

    // Get papers linked to this trial
    let papers: TrialPaper[] = [];
    try {
      papers = db
        .prepare(
          `SELECT tp.nct_id, tp.paperid, ps.title, ps.year, ps.cited_by_count, tp.reference_type
           FROM trial_papers tp
           LEFT JOIN paper_summary ps ON tp.paperid = ps.paperid
           WHERE tp.nct_id = ?
           ORDER BY ps.cited_by_count DESC NULLS LAST`
        )
        .all(nctid) as TrialPaper[];
    } catch {
      console.log("trial_papers table not found, skipping");
    }

    // Get yearly stats for citations/publications over time chart
    let yearlyStats: TrialYearlyStats[] = [];
    try {
      yearlyStats = db
        .prepare(
          `SELECT
            tp.nct_id,
            ps.year,
            COUNT(DISTINCT tp.paperid) as paper_count,
            COALESCE(SUM(ps.cited_by_count), 0) as total_citations
           FROM trial_papers tp
           LEFT JOIN paper_summary ps ON tp.paperid = ps.paperid
           WHERE tp.nct_id = ?
             AND ps.year IS NOT NULL
             AND ps.year > 1800
             AND ps.year < 2100
           GROUP BY tp.nct_id, ps.year
           ORDER BY ps.year`
        )
        .all(nctid) as TrialYearlyStats[];
    } catch {
      console.log("Error fetching yearly stats, skipping");
    }

    const response: TrialDetails = {
      summary,
      papers,
      yearlyStats,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "trials/[nctid]");
  }
}
