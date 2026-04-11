import { NextRequest, NextResponse } from "next/server";
import { getMeshDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

interface PmidRow {
  pmid: number;
}

interface MeshRow {
  mesh_ui: string;
  mesh_name: string;
  is_major: number;
  qualifier_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;
  const { searchParams } = new URL(request.url);
  const pmidParam = searchParams.get("pmid");

  try {
    const db = getMeshDb();

    if (!db) {
      return NextResponse.json({ meshTerms: [] });
    }

    // Use provided PMID or look it up from paperid_pmid table
    let pmid: number | null = pmidParam ? parseInt(pmidParam, 10) : null;

    if (!pmid || isNaN(pmid)) {
      const pmidRow = db
        .prepare("SELECT pmid FROM paperid_pmid WHERE paperid = ?")
        .get(paperid) as PmidRow | undefined;

      if (!pmidRow) {
        return NextResponse.json({ meshTerms: [] });
      }
      pmid = pmidRow.pmid;
    }

    // Get MeSH terms for this PMID (deduplicate by mesh_ui, major topics first)
    const meshRows = db
      .prepare(
        `SELECT DISTINCT mesh_ui, mesh_name, MAX(is_major) as is_major, qualifier_name
         FROM pmid_mesh
         WHERE pmid = ?
         GROUP BY mesh_ui, qualifier_name
         ORDER BY MAX(is_major) DESC, mesh_name ASC`
      )
      .all(pmid) as MeshRow[];

    return NextResponse.json({
      meshTerms: meshRows.map((row) => ({
        meshUi: row.mesh_ui,
        meshName: row.mesh_name,
        isMajor: Boolean(row.is_major),
        qualifierName: row.qualifier_name,
      })),
    });
  } catch (error) {
    return errorResponse(error, "papers/[paperid]/mesh");
  }
}
