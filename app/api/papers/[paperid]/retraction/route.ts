import { NextRequest, NextResponse } from "next/server";
import { getRetractionsDb } from "@/lib/db";

interface RetractionRow {
  record_id: number;
  title: string;
  journal: string;
  publisher: string;
  retraction_date: string | null;
  retraction_doi: string | null;
  retraction_pmid: number | null;
  original_paper_date: string | null;
  original_paper_doi: string | null;
  retraction_nature: string;
  reasons: string | null;
  notes: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  const db = getRetractionsDb();
  if (!db) {
    return NextResponse.json({ retraction: null });
  }

  try {
    // Look up retraction by paperid
    const row = db.prepare(`
      SELECT
        r.record_id,
        r.title,
        r.journal,
        r.publisher,
        r.retraction_date,
        r.retraction_doi,
        r.retraction_pmid,
        r.original_paper_date,
        r.original_paper_doi,
        r.retraction_nature,
        r.reasons,
        r.notes
      FROM retractions r
      WHERE r.paperid = ?
      LIMIT 1
    `).get(paperid) as RetractionRow | undefined;

    if (!row) {
      return NextResponse.json({ retraction: null });
    }

    // Parse reasons into array
    const reasons = row.reasons
      ? row.reasons.split(';').map(r => r.trim()).filter(r => r.length > 0)
      : [];

    return NextResponse.json({
      retraction: {
        recordId: row.record_id,
        title: row.title,
        journal: row.journal,
        publisher: row.publisher,
        retractionDate: row.retraction_date,
        retractionDoi: row.retraction_doi,
        retractionPmid: row.retraction_pmid,
        originalPaperDate: row.original_paper_date,
        originalPaperDoi: row.original_paper_doi,
        retractionNature: row.retraction_nature,
        reasons,
        notes: row.notes,
      }
    });
  } catch (error) {
    console.error("Error fetching retraction:", error);
    return NextResponse.json({ retraction: null });
  }
}
