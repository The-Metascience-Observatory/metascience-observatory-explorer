import { NextRequest, NextResponse } from "next/server";
import { getDb, isSqliteBusyError } from "@/lib/db";
import type { FunderSearchItem } from "@/lib/types";

/**
 * Check if the funder_summary table exists in the database.
 */
function funderTableExists(db: ReturnType<typeof getDb>): boolean {
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='funder_summary'"
    ).get() as { name: string } | undefined;
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Server-side funder search using SQLite.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available funders
  if (!query) {
    try {
      const db = getDb();

      // Check if funder_summary table exists
      if (!funderTableExists(db)) {
        return NextResponse.json({
          total: 0,
          message: "Funder data not yet available. Run preprocessing script with funders.parquet."
        });
      }

      const countResult = db.prepare("SELECT COUNT(*) as count FROM funder_summary").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term to search funders"
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

    // Check if funder_summary table exists
    if (!funderTableExists(db)) {
      return NextResponse.json({
        results: [],
        message: "Funder data not yet available. Run preprocessing script with funders.parquet."
      });
    }

    const searchPattern = `%${query}%`;

    // Search by display_name or country_code
    // Order by works_count to show most relevant funders first
    const stmt = db.prepare(`
      SELECT
        funderid,
        display_name,
        country_code,
        works_count,
        cited_by_count,
        h_index
      FROM funder_summary
      WHERE LOWER(display_name) LIKE LOWER(?)
         OR LOWER(country_code) LIKE LOWER(?)
      ORDER BY works_count DESC NULLS LAST
      LIMIT 50
    `);

    const results = stmt.all(searchPattern, searchPattern) as FunderSearchItem[];

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Funder search error:", error);

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
