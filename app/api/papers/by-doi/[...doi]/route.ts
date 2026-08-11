import { NextResponse } from "next/server";
import { getDb, getOpenaireDb, isDatabaseAvailable } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ doi: string[] }> }
) {
  const { doi } = await params;
  const doiPath = doi.join("/"); // Reconstruct DOI from path segments

  if (!isDatabaseAvailable()) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const db = getDb();

  // Try matching with https://doi.org/ prefix (how DOIs are stored in database)
  const result = db.prepare(`
    SELECT paperid FROM paper_summary
    WHERE doi = ? OR doi = ?
    LIMIT 1
  `).get(`https://doi.org/${doiPath}`, doiPath) as { paperid: string } | undefined;

  if (result) {
    return NextResponse.json({ paperid: result.paperid });
  }

  // Fallback: first-class OpenAIRE papers (bare lowercase DOI, indexed)
  const openaireDb = getOpenaireDb();
  if (openaireDb) {
    try {
      const oa = openaireDb
        .prepare("SELECT id FROM openaire_papers WHERE doi = ? LIMIT 1")
        .get(doiPath.toLowerCase()) as { id: string } | undefined;
      if (oa) {
        return NextResponse.json({ paperid: oa.id, openaire: true });
      }
    } catch {
      // openaire tables may not exist yet - fall through
    }
  }

  return NextResponse.json({ error: "Paper not found for this DOI" }, { status: 404 });
}
