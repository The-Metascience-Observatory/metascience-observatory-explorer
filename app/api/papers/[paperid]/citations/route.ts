import { NextRequest, NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import type { PaperCitation } from "@/lib/types";
import { CITATION_PAGE_SIZE } from "@/lib/constants";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  try {
    const { paperid } = await params;
    const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: CITATION_PAGE_SIZE });

    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not found" },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get total count
    let totalCount = 0;
    try {
      const countResult = db
        .prepare(`SELECT COUNT(*) as count FROM paper_citations WHERE paperid = ?`)
        .get(paperid) as { count: number } | undefined;
      totalCount = countResult?.count || 0;
    } catch {
      console.log("paper_citations table not found");
    }

    // Get paginated citations
    let citations: PaperCitation[] = [];
    try {
      citations = db
        .prepare(
          `SELECT citing_paperid, citing_title, citing_year, citing_cited_by_count
           FROM paper_citations
           WHERE paperid = ?
           ORDER BY citing_cited_by_count DESC NULLS LAST
           LIMIT ? OFFSET ?`
        )
        .all(paperid, limit, offset) as PaperCitation[];
    } catch {
      console.log("paper_citations table not found");
    }

    return NextResponse.json({
      citations,
      total: totalCount,
      offset,
      limit,
      hasMore: offset + citations.length < totalCount,
    });
  } catch (error) {
    return errorResponse(error, "papers/[paperid]/citations");
  }
}
