import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
import type { JournalSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery } from "@/lib/worker-pool";

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
      return errorResponse(error, "journals/search metadata");
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
    // Check cache first
    const cacheKey = generateCacheKey(query);
    const cached = searchCaches.journals.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const searchPattern = `%${query}%`;

    // Search by display_name, issn, or publisher
    // Order by total_papers to show most relevant journals first
    const sql = `
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
    `;

    const results = await workerQuery<JournalSearchItem>(sql, searchPattern, searchPattern, searchPattern);

    const response = { results };
    searchCaches.journals.set(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "journals/search");
  }
}
