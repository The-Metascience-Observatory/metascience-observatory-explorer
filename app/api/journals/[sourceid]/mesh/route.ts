import { NextRequest, NextResponse } from "next/server";
import { getMeshDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

interface MeshJournalRow {
  mesh_ui: string;
  mesh_name: string;
  paper_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceid: string }> }
) {
  const { sourceid } = await params;

  try {
    const db = getMeshDb();

    if (!db) {
      return NextResponse.json({ meshTerms: [] });
    }

    const rows = db
      .prepare(
        `SELECT t.mesh_ui, s.mesh_name, t.paper_count
         FROM mesh_top_journals t
         JOIN mesh_summary s ON t.mesh_ui = s.mesh_ui
         WHERE t.sourceid = ?
         ORDER BY t.paper_count DESC
         LIMIT 20`
      )
      .all(sourceid) as MeshJournalRow[];

    return NextResponse.json({
      meshTerms: rows.map((row) => ({
        meshUi: row.mesh_ui,
        meshName: row.mesh_name,
        paperCount: row.paper_count,
      })),
    });
  } catch (error) {
    return errorResponse(error, "journals/[sourceid]/mesh");
  }
}
