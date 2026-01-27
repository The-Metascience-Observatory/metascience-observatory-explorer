import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
import type { FunderSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery } from "@/lib/worker-pool";

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
      return errorResponse(error, "funders/search metadata");
    }
  }

  // Validate query length (prevent DoS with extremely long queries)
  const lengthError = validateQueryLength(query, 200);
  if (lengthError) return lengthError;

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

    // Check cache first
    const cacheKey = generateCacheKey(query);
    const cached = searchCaches.funders.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const searchPattern = `%${query}%`;

    // Search by display_name or country_code
    // Order by works_count to show most relevant funders first
    const sql = `
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
    `;

    const results = await workerQuery<FunderSearchItem>(sql, searchPattern, searchPattern);

    const response = { results };
    searchCaches.funders.set(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "funders/search");
  }
}
