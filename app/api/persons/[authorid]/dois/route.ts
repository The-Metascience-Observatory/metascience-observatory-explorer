import { NextRequest, NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { workerQuery } from "@/lib/worker-pool";
import { errorResponse } from "@/lib/api-utils";
import { buildDoiCsv } from "@/lib/doi-csv";

/**
 * CSV export of every DOI attached to an author's publications, most cited
 * first (the same order as the on-page list). Papers without a DOI are omitted.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ authorid: string }> }
) {
  try {
    const { authorid } = await params;

    if (!isDatabaseAvailable()) {
      return NextResponse.json({ error: "Database not found" }, { status: 500 });
    }

    // paperid, cited_by_count and year are selected only so that DISTINCT and
    // ORDER BY agree; buildDoiCsv performs the final per-DOI dedupe.
    const rows = await workerQuery<{ doi: string | null }>(
      `SELECT DISTINCT pp.paperid, ps.doi, pp.cited_by_count, pp.year
       FROM person_publications pp
       JOIN paper_summary ps ON ps.paperid = pp.paperid
       WHERE pp.authorid = ? AND ps.doi IS NOT NULL AND ps.doi != ''
       ORDER BY pp.cited_by_count DESC NULLS LAST, pp.year DESC NULLS LAST`,
      authorid
    );

    const safeId = authorid.replace(/[^A-Za-z0-9_-]/g, "") || "author";
    return new NextResponse(buildDoiCsv(rows.map((r) => r.doi)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeId}-dois.csv"`,
      },
    });
  } catch (error) {
    return errorResponse(error, "persons/[authorid]/dois");
  }
}
