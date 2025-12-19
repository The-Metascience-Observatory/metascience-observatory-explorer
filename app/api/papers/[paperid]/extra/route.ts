import { NextRequest, NextResponse } from "next/server";
import { getPapersExtraDb } from "@/lib/db";

interface NewsfeedRow {
  url: string;
  timestamp: string;
}

interface PubmedRow {
  pmid: number | null;
  pmcid: number | null;
}

interface MetadataRow {
  publication_date: string | null;
  doc_type: string | null;
  openalex_cited_by_count: number | null;
  is_retracted: number | null;
  is_paratext: number | null;
  language: string | null;
}

interface PatentRow {
  patent: string;
  uspto: number | null;
}

// Helper to check if a table exists
function tableExists(db: ReturnType<typeof getPapersExtraDb>, tableName: string): boolean {
  if (!db) return false;
  try {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  try {
    const db = getPapersExtraDb();

    // If papers_extra database doesn't exist, return empty data gracefully
    if (!db) {
      return NextResponse.json({
        newsfeed: [],
        pubmed: null,
        metadata: null,
      });
    }

    // Get newsfeed mentions (if table exists)
    let newsfeed: NewsfeedRow[] = [];
    if (tableExists(db, "paper_newsfeed")) {
      newsfeed = db
        .prepare(
          `SELECT url, timestamp FROM paper_newsfeed WHERE paperid = ? ORDER BY timestamp DESC LIMIT 20`
        )
        .all(paperid) as NewsfeedRow[];
    }

    // Get PMID/PMCID (if table exists)
    let pubmedRow: PubmedRow | undefined;
    if (tableExists(db, "paper_pubmed")) {
      pubmedRow = db
        .prepare(`SELECT pmid, pmcid FROM paper_pubmed WHERE paperid = ?`)
        .get(paperid) as PubmedRow | undefined;
    }

    // Get paper metadata (if table exists)
    let metadataRow: MetadataRow | undefined;
    if (tableExists(db, "paper_metadata")) {
      metadataRow = db
        .prepare(
          `SELECT publication_date, doc_type, openalex_cited_by_count, is_retracted, is_paratext, language
           FROM paper_metadata WHERE paperid = ?`
        )
        .get(paperid) as MetadataRow | undefined;
    }

    // Get patents (if table exists)
    let patents: PatentRow[] = [];
    if (tableExists(db, "paper_patents")) {
      patents = db
        .prepare(`SELECT patent, uspto FROM paper_patents WHERE paperid = ? ORDER BY patent LIMIT 50`)
        .all(paperid) as PatentRow[];
    }

    return NextResponse.json({
      newsfeed: newsfeed.map((row) => ({
        url: row.url,
        timestamp: row.timestamp,
      })),
      pubmed: pubmedRow
        ? {
            pmid: pubmedRow.pmid,
            pmcid: pubmedRow.pmcid,
          }
        : null,
      metadata: metadataRow
        ? {
            publicationDate: metadataRow.publication_date,
            docType: metadataRow.doc_type,
            openalexCitedByCount: metadataRow.openalex_cited_by_count,
            isRetracted: Boolean(metadataRow.is_retracted),
            isParatext: Boolean(metadataRow.is_paratext),
            language: metadataRow.language,
          }
        : null,
      patents: patents.map((row) => ({
        patent: row.patent,
        isUspto: Boolean(row.uspto),
      })),
    });
  } catch (error) {
    console.error("Error fetching paper extra data:", error);
    return NextResponse.json(
      { error: "Failed to fetch paper extra data" },
      { status: 500 }
    );
  }
}
