import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import { meshWorkerQuery, workerQuery } from "@/lib/worker-pool";

interface PaperRow {
  paperid: string;
  title: string;
  year: number;
  cited_by_count: number;
  source_name: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meshui: string }> }
) {
  const { meshui } = await params;
  const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: 50 });

  try {
    // Index order, deliberately unsorted.
    //
    // This previously ran `ORDER BY RANDOM()` with DISTINCT, which forces SQLite
    // to materialise and sort every matching row before returning the first.
    // "Humans" (D006801) matches 22,445,201 rows, so a single request sorted 22M
    // rows — and it ran on the synchronous main-thread handle, freezing the whole
    // event loop. Measured: the query below returns in ~0ms for that descriptor
    // because both indexes are used and LIMIT stops the scan early.
    //
    // Dropping the random order also fixes pagination. RANDOM() is re-evaluated
    // per statement, so page 2 was an independent sample rather than a
    // continuation: scrolling repeated and skipped papers and produced duplicate
    // React keys. Index order is stable across requests, so pages now compose.
    const pmidRows = await meshWorkerQuery<{ paperid: string }>(
      `SELECT p.paperid
         FROM pmid_mesh m
         JOIN paperid_pmid p ON m.pmid = p.pmid
        WHERE m.mesh_ui = ?
        LIMIT ? OFFSET ?`,
      meshui,
      limit + 1,
      offset
    );

    const hasMore = pmidRows.length > limit;
    // paperid_pmid has no uniqueness constraint, so dedupe within the page
    // rather than paying for a DISTINCT over the whole match set.
    const paperIds = [...new Set(pmidRows.slice(0, limit).map((r) => r.paperid))];

    if (paperIds.length === 0) {
      return NextResponse.json({ papers: [], hasMore: false });
    }

    const placeholders = paperIds.map(() => "?").join(",");
    const papers = await workerQuery<PaperRow>(
      `SELECT paperid, title, year, cited_by_count, source_name
         FROM paper_summary
        WHERE paperid IN (${placeholders})
        ORDER BY cited_by_count DESC`,
      ...paperIds
    );

    return NextResponse.json({
      papers: papers.map((p) => ({
        paperId: p.paperid,
        title: p.title,
        year: p.year,
        citedByCount: p.cited_by_count,
        sourceName: p.source_name,
      })),
      // Reported against the mesh window, not the resolved rows: a paperid
      // missing from paper_summary must not look like the end of the list.
      hasMore,
    });
  } catch (error) {
    return errorResponse(error, "mesh/[meshui]/papers");
  }
}
