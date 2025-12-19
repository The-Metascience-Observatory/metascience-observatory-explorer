import { NextResponse } from "next/server";
import { getDb, isSqliteBusyError } from "@/lib/db";

interface CountryFunderCount {
  country_code: string;
  funder_count: number;
  total_works: number;
}

/**
 * Get funder counts aggregated by country for the world map.
 */
export async function GET() {
  try {
    const db = getDb();

    // Check if funder_summary table exists
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='funder_summary'"
      )
      .get();

    if (!tableCheck) {
      return NextResponse.json({
        countries: [],
        message: "Funder data not yet available.",
      });
    }

    // Get funder counts and total works by country
    const countries = db
      .prepare(
        `SELECT
          country_code,
          COUNT(*) as funder_count,
          SUM(works_count) as total_works
        FROM funder_summary
        WHERE country_code IS NOT NULL AND country_code != ''
        GROUP BY country_code
        ORDER BY funder_count DESC`
      )
      .all() as CountryFunderCount[];

    return NextResponse.json({ countries });
  } catch (error) {
    console.error("Error fetching funder countries:", error);

    const stackTrace = error instanceof Error ? error.stack : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? (error as { code: string }).code
        : undefined;

    if (isSqliteBusyError(error)) {
      return NextResponse.json(
        {
          error: "Database is temporarily busy",
          code: "SQLITE_BUSY",
          stack: stackTrace,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to fetch funder countries",
        details: error instanceof Error ? error.message : "Unknown error",
        code: errorCode,
        stack: stackTrace,
      },
      { status: 500 }
    );
  }
}
