import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

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
    return errorResponse(error, "funders/by-country");
  }
}
