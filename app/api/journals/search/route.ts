import { NextRequest, NextResponse } from "next/server";
import { getDb, isSqliteBusyError } from "@/lib/db";
import type { JournalSearchItem } from "@/lib/types";

/**
 * Server-side journal search using SQLite.
 * With ~260K journals, simple LIKE queries are fast enough.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available journals
  if (!query) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM journal_summary").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term to search journals"
      });
    } catch (error) {
      const stackTrace = error instanceof Error ? error.stack : String(error);
      const errorCode =
        error instanceof Error && "code" in error
          ? (error as { code: string }).code
          : undefined;

      if (isSqliteBusyError(error)) {
        return NextResponse.json(
          {
            error: "Database is temporarily busy",
            details: "The database is currently being updated. Please try again in a few moments.",
            code: "SQLITE_BUSY",
            stack: stackTrace,
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: "Database not available", details: error instanceof Error ? error.message : "Unknown error", code: errorCode, stack: stackTrace },
        { status: 500 }
      );
    }
  }

  // Require at least 2 characters
  if (query.length < 2) {
    return NextResponse.json({ results: [], message: "Query must be at least 2 characters" });
  }

  try {
    const db = getDb();
    const searchPattern = `%${query}%`;

    // Search by display_name, issn, or publisher
    // Order by total_papers to show most relevant journals first
    const stmt = db.prepare(`
      SELECT
        sourceid,
        display_name,
        issn,
        publisher,
        homepage_url,
        is_oa,
        total_papers,
        total_citations,
        first_year,
        last_year,
        primary_field_l0_id,
        primary_field_l0_name,
        primary_field_l1_id,
        primary_field_l1_name
      FROM journal_summary
      WHERE LOWER(display_name) LIKE LOWER(?)
         OR LOWER(issn) LIKE LOWER(?)
         OR LOWER(publisher) LIKE LOWER(?)
      ORDER BY total_papers DESC NULLS LAST
      LIMIT 50
    `);

    const results = stmt.all(searchPattern, searchPattern, searchPattern) as JournalSearchItem[];

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Journal search error:", error);

    const stackTrace = error instanceof Error ? error.stack : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : undefined;

    if (isSqliteBusyError(error)) {
      return NextResponse.json(
        {
          error: "Database is temporarily busy",
          details: "The database is currently being updated. Please try again in a few moments.",
          code: "SQLITE_BUSY",
          stack: stackTrace,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Search failed", details: error instanceof Error ? error.message : "Unknown error", code: errorCode, stack: stackTrace },
      { status: 500 }
    );
  }
}
