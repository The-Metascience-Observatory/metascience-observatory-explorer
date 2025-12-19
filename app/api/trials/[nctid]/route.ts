import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable, isSqliteBusyError } from "@/lib/db";
import type {
  TrialSummary,
  TrialPaper,
  TrialDetails,
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

    // Get trial summary
    let summary: TrialSummary | undefined;
    try {
      summary = db
        .prepare(`SELECT * FROM trial_summary WHERE nct_id = ?`)
        .get(nctid) as TrialSummary | undefined;
    } catch {
      console.log("trial_summary table not found");
    }

    if (!summary) {
      return NextResponse.json(
        { error: "Clinical trial not found" },
        { status: 404 }
      );
    }

    // Get papers linked to this trial
    let papers: TrialPaper[] = [];
    try {
      papers = db
        .prepare(
          `SELECT nct_id, paperid, title, year, cited_by_count, reference_type
           FROM trial_papers
           WHERE nct_id = ?
           ORDER BY cited_by_count DESC NULLS LAST`
        )
        .all(nctid) as TrialPaper[];
    } catch {
      console.log("trial_papers table not found, skipping");
    }

    const response: TrialDetails = {
      summary,
      papers,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching trial details:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const stackTrace = error instanceof Error ? error.stack : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : undefined;

    if (isSqliteBusyError(error)) {
      return NextResponse.json(
        {
          error: "Database is temporarily busy",
          details:
            "The database is currently being updated (e.g., creating indexes). Please try again in a few moments.",
          code: "SQLITE_BUSY",
          stack: stackTrace,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to fetch trial details",
        details: errorMessage,
        code: errorCode,
        stack: stackTrace,
      },
      { status: 500 }
    );
  }
}
