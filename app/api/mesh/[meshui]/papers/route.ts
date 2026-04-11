import { NextRequest, NextResponse } from "next/server";
import { getMeshDb, getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

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
  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

  try {
    const meshDb = getMeshDb();
    const journalsDb = getDb();

    if (!meshDb || !journalsDb) {
      return NextResponse.json({ papers: [], hasMore: false });
    }

    // Get random PMIDs for this MeSH term, then lookup paper IDs
    // Using RANDOM() for randomness, with offset/limit for pagination
    // Note: For true randomness on each page load, we'd need a seed
    const pmidRows = meshDb
      .prepare(
        `SELECT DISTINCT p.paperid
         FROM pmid_mesh m
         JOIN paperid_pmid p ON m.pmid = p.pmid
         WHERE m.mesh_ui = ?
         ORDER BY RANDOM()
         LIMIT ? OFFSET ?`
      )
      .all(meshui, limit + 1, offset) as { paperid: string }[];

    const hasMore = pmidRows.length > limit;
    const paperIds = pmidRows.slice(0, limit).map((r) => r.paperid);

    if (paperIds.length === 0) {
      return NextResponse.json({ papers: [], hasMore: false });
    }

    // Get paper details from journals.db
    const placeholders = paperIds.map(() => "?").join(",");
    const papers = journalsDb
      .prepare(
        `SELECT paperid, title, year, cited_by_count, source_name
         FROM paper_summary
         WHERE paperid IN (${placeholders})
         ORDER BY cited_by_count DESC`
      )
      .all(...paperIds) as PaperRow[];

    return NextResponse.json({
      papers: papers.map((p) => ({
        paperId: p.paperid,
        title: p.title,
        year: p.year,
        citedByCount: p.cited_by_count,
        sourceName: p.source_name,
      })),
      hasMore,
    });
  } catch (error) {
    return errorResponse(error, "mesh/[meshui]/papers");
  }
}
