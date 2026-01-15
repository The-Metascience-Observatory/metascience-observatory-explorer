import { NextRequest, NextResponse } from "next/server";
import { getRetractionsDb } from "@/lib/db";
import { errorResponse, validateQueryLength, parsePagination } from "@/lib/api-utils";

export interface RetractionSearchItem {
  record_id: number;
  title: string;
  journal: string;
  publisher: string;
  retraction_date: string | null;
  original_paper_date: string | null;
  original_paper_doi: string | null;
  retraction_nature: string;
  reasons: string | null;
  paperid: string | null;
}

/**
 * Server-side retraction search using Retraction Watch database.
 * Supports filtering by nature, reason, year, and text search.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  const retractionsDb = getRetractionsDb();
  if (!retractionsDb) {
    return NextResponse.json({
      results: [],
      total: 0,
      message: "Retractions database not available"
    });
  }

  // If no query, return metadata and recent retractions
  if (!query) {
    try {
      const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 100 });

      // Parse filters
      const nature = searchParams.get("nature"); // Retraction, Expression of concern, etc.
      const reason = searchParams.get("reason"); // e.g., "Paper Mill"
      const yearFrom = searchParams.get("yearFrom");
      const yearTo = searchParams.get("yearTo");

      // Build WHERE clauses
      const whereClauses: string[] = [];
      const params: (string | number)[] = [];

      if (nature) {
        whereClauses.push("r.retraction_nature = ?");
        params.push(nature);
      }

      if (reason) {
        whereClauses.push("r.reasons LIKE ?");
        params.push(`%${reason}%`);
      }

      if (yearFrom) {
        whereClauses.push("CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) >= ?");
        params.push(parseInt(yearFrom));
      }

      if (yearTo) {
        whereClauses.push("CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) <= ?");
        params.push(parseInt(yearTo));
      }

      const whereClause = whereClauses.length > 0
        ? "WHERE " + whereClauses.join(" AND ")
        : "";

      // Get total count
      const countResult = retractionsDb.prepare(`
        SELECT COUNT(*) as count FROM retractions r ${whereClause}
      `).get(...params) as { count: number };

      // Get results sorted by retraction date (most recent first)
      const results = retractionsDb.prepare(`
        SELECT
          r.record_id,
          r.title,
          r.journal,
          r.publisher,
          r.retraction_date,
          r.original_paper_date,
          r.original_paper_doi,
          r.retraction_nature,
          r.reasons,
          pr.paperid
        FROM retractions r
        LEFT JOIN paper_retractions pr ON r.record_id = pr.record_id
        ${whereClause}
        ORDER BY r.retraction_date DESC NULLS LAST
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as RetractionSearchItem[];

      // Get available filter options
      const natures = retractionsDb.prepare(`
        SELECT retraction_nature, COUNT(*) as count
        FROM retractions
        GROUP BY retraction_nature
        ORDER BY count DESC
      `).all() as { retraction_nature: string; count: number }[];

      // Get top reasons (they're semicolon-separated, so this is approximate)
      const topReasons = retractionsDb.prepare(`
        SELECT
          CASE
            WHEN reasons LIKE '%Paper Mill%' THEN 'Paper Mill'
            WHEN reasons LIKE '%Fake Peer Review%' THEN 'Fake Peer Review'
            WHEN reasons LIKE '%Plagiarism%' THEN 'Plagiarism'
            WHEN reasons LIKE '%Data Fabrication%' THEN 'Data Fabrication'
            WHEN reasons LIKE '%Duplication%' THEN 'Duplication'
            WHEN reasons LIKE '%Unreliable Results%' THEN 'Unreliable Results'
            WHEN reasons LIKE '%Image Manipulation%' THEN 'Image Manipulation'
            ELSE 'Other'
          END as reason,
          COUNT(*) as count
        FROM retractions
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10
      `).all() as { reason: string; count: number }[];

      return NextResponse.json({
        results,
        total: countResult.count,
        offset,
        limit,
        hasMore: offset + results.length < countResult.count,
        filters: {
          natures,
          topReasons
        }
      });
    } catch (error) {
      return errorResponse(error, "retractions metadata");
    }
  }

  // Validate query length
  const lengthError = validateQueryLength(query, 200);
  if (lengthError) return lengthError;

  // Require at least 2 characters
  if (query.length < 2) {
    return NextResponse.json({ results: [], message: "Query must be at least 2 characters" });
  }

  try {
    const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 100 });

    // Parse filters
    const nature = searchParams.get("nature");
    const reason = searchParams.get("reason");
    const yearFrom = searchParams.get("yearFrom");
    const yearTo = searchParams.get("yearTo");

    // Build WHERE clauses
    const whereClauses: string[] = ["(r.title LIKE ? OR r.journal LIKE ? OR r.original_paper_doi LIKE ?)"];
    const searchPattern = `%${query}%`;
    const params: (string | number)[] = [searchPattern, searchPattern, searchPattern];

    if (nature) {
      whereClauses.push("r.retraction_nature = ?");
      params.push(nature);
    }

    if (reason) {
      whereClauses.push("r.reasons LIKE ?");
      params.push(`%${reason}%`);
    }

    if (yearFrom) {
      whereClauses.push("CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) >= ?");
      params.push(parseInt(yearFrom));
    }

    if (yearTo) {
      whereClauses.push("CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) <= ?");
      params.push(parseInt(yearTo));
    }

    const whereClause = "WHERE " + whereClauses.join(" AND ");

    // Get total count
    const countResult = retractionsDb.prepare(`
      SELECT COUNT(*) as count FROM retractions r ${whereClause}
    `).get(...params) as { count: number };

    // Get results
    const results = retractionsDb.prepare(`
      SELECT
        r.record_id,
        r.title,
        r.journal,
        r.publisher,
        r.retraction_date,
        r.original_paper_date,
        r.original_paper_doi,
        r.retraction_nature,
        r.reasons,
        pr.paperid
      FROM retractions r
      LEFT JOIN paper_retractions pr ON r.record_id = pr.record_id
      ${whereClause}
      ORDER BY r.retraction_date DESC NULLS LAST
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as RetractionSearchItem[];

    return NextResponse.json({
      results,
      total: countResult.count,
      offset,
      limit,
      hasMore: offset + results.length < countResult.count
    });
  } catch (error) {
    return errorResponse(error, "retractions/search");
  }
}
