import { NextRequest, NextResponse } from "next/server";
import { getDb, isDatabaseAvailable, isSqliteBusyError } from "@/lib/db";
import type { PaperCitation } from "@/lib/types";

const PAGE_SIZE = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  try {
    const { paperid } = await params;
    const searchParams = request.nextUrl.searchParams;
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const limit = parseInt(searchParams.get("limit") || String(PAGE_SIZE), 10);

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
    console.error("Error fetching citations:", error);

    if (isSqliteBusyError(error)) {
      return NextResponse.json(
        { error: "Database is temporarily busy" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch citations" },
      { status: 500 }
    );
  }
}
