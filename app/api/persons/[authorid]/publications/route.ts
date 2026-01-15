import { NextRequest, NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import type { PersonPublication } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ authorid: string }> }
) {
  try {
    const { authorid } = await params;
    const searchParams = request.nextUrl.searchParams;
    const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 200 });
    const sortBy = searchParams.get("sort") || "citations"; // "citations" or "year"

    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not found" },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get total count of unique publications
    let total = 0;
    try {
      const countResult = db
        .prepare(
          `SELECT COUNT(*) as count FROM (
             SELECT DISTINCT paperid FROM person_publications WHERE authorid = ?
           )`
        )
        .get(authorid) as { count: number };
      total = countResult.count;
    } catch {
      return NextResponse.json({ publications: [], total: 0, offset, limit, hasMore: false });
    }

    // Get paginated publications with proper deduplication
    const orderClause = sortBy === "year"
      ? "ORDER BY year DESC NULLS LAST, cited_by_count DESC NULLS LAST"
      : "ORDER BY cited_by_count DESC NULLS LAST, year DESC NULLS LAST";

    let publications: PersonPublication[] = [];
    try {
      publications = db
        .prepare(
          `SELECT DISTINCT paperid, title, year, cited_by_count, author_position,
                  sourceid, source_name
           FROM person_publications
           WHERE authorid = ?
           ${orderClause}
           LIMIT ? OFFSET ?`
        )
        .all(authorid, limit, offset) as PersonPublication[];
    } catch {
      console.log("person_publications table not found");
    }

    return NextResponse.json({
      publications,
      total,
      offset,
      limit,
      hasMore: offset + publications.length < total
    });
  } catch (error) {
    return errorResponse(error, "persons/[authorid]/publications");
  }
}
