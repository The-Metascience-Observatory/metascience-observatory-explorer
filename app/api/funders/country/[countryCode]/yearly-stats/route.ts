import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

interface YearlyStats {
  year: number;
  works_count: number;
  cited_by_count: number;
}

/**
 * Get aggregated yearly stats for all funders in a country.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  try {
    const { countryCode } = await params;
    const db = getDb();

    // Check if tables exist
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='funder_yearly_stats'"
      )
      .get();

    if (!tableCheck) {
      return NextResponse.json({
        yearlyStats: [],
        message: "Yearly stats data not yet available.",
      });
    }

    // Aggregate yearly stats for all funders in this country
    const yearlyStats = db
      .prepare(
        `SELECT
          fys.year,
          SUM(fys.works_count) as works_count,
          SUM(fys.cited_by_count) as cited_by_count
        FROM funder_yearly_stats fys
        INNER JOIN funder_summary fs ON fys.funderid = fs.funderid
        WHERE fs.country_code = ?
        GROUP BY fys.year
        ORDER BY fys.year`
      )
      .all(countryCode.toUpperCase()) as YearlyStats[];

    return NextResponse.json({ yearlyStats });
  } catch (error) {
    return errorResponse(error, "funders/country/[countryCode]/yearly-stats");
  }
}
