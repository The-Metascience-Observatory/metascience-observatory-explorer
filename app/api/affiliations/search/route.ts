import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
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
      return errorResponse(error, "affiliations/search metadata");
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
    return errorResponse(error, "affiliations/search");
  }
}
