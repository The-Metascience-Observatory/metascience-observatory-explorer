import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable, isSqliteBusyError } from "@/lib/db";
import type { JournalPublication, JournalFieldPaper } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sourceid: string }> }
) {
  try {
    const { sourceid } = await params;
    const { searchParams } = new URL(request.url);
    const fieldid = searchParams.get("fieldid");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

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

    // If fieldid is provided, query journal_field_papers, otherwise journal_publications
    if (fieldid) {
      let papers: JournalFieldPaper[] = [];
      try {
        papers = db
          .prepare(
            `SELECT paperid, sourceid, fieldid, title, year, cited_by_count, field_score
             FROM journal_field_papers
             WHERE sourceid = ? AND fieldid = ?
             ORDER BY cited_by_count DESC NULLS LAST
             LIMIT ? OFFSET ?`
          )
          .all(sourceid, fieldid, limit, offset) as JournalFieldPaper[];
      } catch {
        console.log("journal_field_papers table not found");
        return NextResponse.json(
          { error: "Publication data not available. Run preprocessing with paper tables." },
          { status: 500 }
        );
      }

      // Get total count for pagination
      let total = 0;
      try {
        const countResult = db
          .prepare(
            `SELECT COUNT(*) as count FROM journal_field_papers WHERE sourceid = ? AND fieldid = ?`
          )
          .get(sourceid, fieldid) as { count: number };
        total = countResult.count;
      } catch {
        total = papers.length;
      }

      return NextResponse.json({
        papers,
        total,
        limit,
        offset,
        fieldid,
      });
    } else {
      let papers: JournalPublication[] = [];
      try {
        papers = db
          .prepare(
            `SELECT paperid, sourceid, title, year, cited_by_count
             FROM journal_publications
             WHERE sourceid = ?
             ORDER BY cited_by_count DESC NULLS LAST
             LIMIT ? OFFSET ?`
          )
          .all(sourceid, limit, offset) as JournalPublication[];
      } catch {
        console.log("journal_publications table not found");
        return NextResponse.json(
          { error: "Publication data not available. Run preprocessing with paper tables." },
          { status: 500 }
        );
      }

      // Get total count for pagination
      let total = 0;
      try {
        const countResult = db
          .prepare(
            `SELECT COUNT(*) as count FROM journal_publications WHERE sourceid = ?`
          )
          .get(sourceid) as { count: number };
        total = countResult.count;
      } catch {
        total = papers.length;
      }

      return NextResponse.json({
        papers,
        total,
        limit,
        offset,
      });
    }
  } catch (error) {
    console.error("Error fetching journal publications:", error);

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
        error: "Failed to fetch journal publications",
        details: errorMessage,
        code: errorCode,
        stack: stackTrace,
      },
      { status: 500 }
    );
  }
}
