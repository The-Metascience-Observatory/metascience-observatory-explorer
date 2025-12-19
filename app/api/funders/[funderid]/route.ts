import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable, isSqliteBusyError } from "@/lib/db";
import type {
  FunderSummary,
  FunderYearlyStats,
  FunderConcept,
  FunderDetails,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ funderid: string }> }
) {
  try {
    const { funderid } = await params;

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

    // Get funder summary
    let summary: FunderSummary | undefined;
    try {
      summary = db
        .prepare(`SELECT * FROM funder_summary WHERE funderid = ?`)
        .get(funderid) as FunderSummary | undefined;
    } catch {
      console.log("funder_summary table not found");
    }

    if (!summary) {
      return NextResponse.json(
        { error: "Funder not found" },
        { status: 404 }
      );
    }

    // Get yearly statistics
    let yearlyStats: FunderYearlyStats[] = [];
    try {
      yearlyStats = db
        .prepare(
          `SELECT funderid, year, works_count, cited_by_count
           FROM funder_yearly_stats
           WHERE funderid = ?
           ORDER BY year`
        )
        .all(funderid) as FunderYearlyStats[];
    } catch {
      console.log("funder_yearly_stats table not found, skipping");
    }

    // Get concepts (fields associated with funder)
    let concepts: FunderConcept[] = [];
    try {
      concepts = db
        .prepare(
          `SELECT funderid, fieldid, field_name, level, score
           FROM funder_concepts
           WHERE funderid = ?
           ORDER BY score DESC`
        )
        .all(funderid) as FunderConcept[];
    } catch {
      console.log("funder_concepts table not found, skipping");
    }

    const response: FunderDetails = {
      summary,
      yearlyStats,
      concepts,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching funder details:", error);

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
        error: "Failed to fetch funder details",
        details: errorMessage,
        code: errorCode,
        stack: stackTrace,
      },
      { status: 500 }
    );
  }
}
