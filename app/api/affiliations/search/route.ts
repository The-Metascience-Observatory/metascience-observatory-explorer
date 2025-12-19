import { NextRequest, NextResponse } from "next/server";
import { getDb, isSqliteBusyError } from "@/lib/db";
import type { AffiliationSearchItem } from "@/lib/types";

/**
 * Server-side affiliation search using SQLite.
 * With ~110K affiliations, simple LIKE queries are fast enough.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available affiliations
  if (!query) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM affiliation_summary").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term to search affiliations"
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

    // Search by display_name, country_code, or type
    // Order by h_index to show most relevant institutions first
    const stmt = db.prepare(`
      SELECT
        institution_id,
        display_name,
        country_code,
        type,
        ror,
        homepage_url,
        h_index,
        productivity,
        total_citations,
        researcher_count,
        first_year,
        last_year
      FROM affiliation_summary
      WHERE LOWER(display_name) LIKE LOWER(?)
         OR LOWER(country_code) LIKE LOWER(?)
         OR LOWER(type) LIKE LOWER(?)
      ORDER BY h_index DESC NULLS LAST
      LIMIT 50
    `);

    const results = stmt.all(searchPattern, searchPattern, searchPattern) as AffiliationSearchItem[];

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Affiliation search error:", error);

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
