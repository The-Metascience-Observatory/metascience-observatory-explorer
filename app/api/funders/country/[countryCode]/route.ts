import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, parsePagination } from "@/lib/api-utils";

interface CountryStats {
  funder_count: number;
  total_works: number;
  total_citations: number;
}

interface FunderWithRecentStats {
  funderid: string;
  display_name: string;
  country_code: string;
  grants_count: number | null;
  works_since_2012: number;
  citations_since_2012: number;
}

const DEFAULT_LIMIT = 50;

/**
 * Get funders for a specific country with pagination.
 * Includes works and citations since 2012 aggregated from yearly stats.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ countryCode: string }> }
) {
  try {
    const { countryCode } = await params;
    const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: DEFAULT_LIMIT });

    const db = getDb();

    // Check if funder_summary table exists
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='funder_summary'"
      )
      .get();

    if (!tableCheck) {
      return NextResponse.json(
        { error: "Funder data not yet available." },
        { status: 404 }
      );
    }

    // Get country stats
    const stats = db
      .prepare(
        `SELECT
          COUNT(*) as funder_count,
          SUM(works_count) as total_works,
          SUM(cited_by_count) as total_citations
        FROM funder_summary
        WHERE country_code = ?`
      )
      .get(countryCode.toUpperCase()) as CountryStats;

    if (!stats || stats.funder_count === 0) {
      return NextResponse.json(
        { error: "No funders found for this country" },
        { status: 404 }
      );
    }

    // Get funders with aggregated stats since 2012
    const funders = db
      .prepare(
        `SELECT
          fs.funderid,
          fs.display_name,
          fs.country_code,
          fs.grants_count,
          COALESCE(recent.works_since_2012, 0) as works_since_2012,
          COALESCE(recent.citations_since_2012, 0) as citations_since_2012
        FROM funder_summary fs
        LEFT JOIN (
          SELECT
            funderid,
            SUM(works_count) as works_since_2012,
            SUM(cited_by_count) as citations_since_2012
          FROM funder_yearly_stats
          WHERE year >= 2012
          GROUP BY funderid
        ) recent ON fs.funderid = recent.funderid
        WHERE fs.country_code = ?
        ORDER BY works_since_2012 DESC NULLS LAST
        LIMIT ? OFFSET ?`
      )
      .all(countryCode.toUpperCase(), limit, offset) as FunderWithRecentStats[];

    const hasMore = offset + funders.length < stats.funder_count;

    return NextResponse.json({
      country_code: countryCode.toUpperCase(),
      stats,
      funders,
      hasMore,
      offset,
      limit,
    });
  } catch (error) {
    return errorResponse(error, "funders/country/[countryCode]");
  }
}
