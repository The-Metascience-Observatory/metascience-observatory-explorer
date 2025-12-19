import { NextRequest, NextResponse } from "next/server";
import { getPapersExtraDb, getDb } from "@/lib/db";

interface PaperCoreRow {
  paperid: string;
  title: string | null;
  doi: string | null;
  publication_date: string | null;
  doc_type: string | null;
  language: string | null;
  cited_by_count: number | null;
  is_retracted: number | null;
}

interface PaperAuthorRow {
  authorid: string;
  display_name: string | null;
  author_position: string | null;
  institutionid: string | null;
  raw_affiliation: string | null;
}

interface PaperFieldRow {
  fieldid: string;
  score: number | null;
}

interface PaperSourceRow {
  sourceid: string | null;
  landing_page_url: string | null;
  pdf_url: string | null;
  is_oa: number | null;
  version: string | null;
  license: string | null;
}

interface FieldInfo {
  fieldid: string;
  name: string;
}

interface SourceInfo {
  sourceid: string;
  name: string;
}

// Helper to check if a table exists
function tableExists(
  db: ReturnType<typeof getPapersExtraDb>,
  tableName: string
): boolean {
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

// Get field names from main db
function getFieldNames(fieldIds: string[]): Map<string, string> {
  const results = new Map<string, string>();
  if (fieldIds.length === 0) return results;

  try {
    const db = getDb();
    const placeholders = fieldIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT fieldid, display_name FROM fields WHERE fieldid IN (${placeholders})`
      )
      .all(...fieldIds) as Array<{ fieldid: string; display_name: string }>;

    for (const row of rows) {
      results.set(row.fieldid, row.display_name);
    }
  } catch {
    // Main DB might not be available
  }

  return results;
}

// Get source names from main db
function getSourceNames(sourceIds: string[]): Map<string, string> {
  const results = new Map<string, string>();
  if (sourceIds.length === 0) return results;

  try {
    const db = getDb();
    const placeholders = sourceIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT sourceid, display_name FROM sources WHERE sourceid IN (${placeholders})`
      )
      .all(...sourceIds) as Array<{ sourceid: string; display_name: string }>;

    for (const row of rows) {
      results.set(row.sourceid, row.display_name);
    }
  } catch {
    // Main DB might not be available
  }

  return results;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  try {
    const db = getPapersExtraDb();

    // If papers_extra database doesn't exist, return 404
    if (!db) {
      return NextResponse.json(
        { error: "Lite paper data not available" },
        { status: 404 }
      );
    }

    // Check if paper_core table exists (indicates lite data is available)
    if (!tableExists(db, "paper_core")) {
      return NextResponse.json(
        { error: "Lite paper data not processed" },
        { status: 404 }
      );
    }

    // Get core paper data
    const coreRow = db
      .prepare(`SELECT * FROM paper_core WHERE paperid = ?`)
      .get(paperid) as PaperCoreRow | undefined;

    if (!coreRow) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    // Get authors
    let authors: PaperAuthorRow[] = [];
    if (tableExists(db, "paper_authors")) {
      authors = db
        .prepare(
          `SELECT authorid, display_name, author_position, institutionid, raw_affiliation
           FROM paper_authors
           WHERE paperid = ?
           ORDER BY
             CASE author_position
               WHEN 'first' THEN 1
               WHEN 'middle' THEN 2
               WHEN 'last' THEN 3
               ELSE 4
             END`
        )
        .all(paperid) as PaperAuthorRow[];
    }

    // Get fields
    let fields: PaperFieldRow[] = [];
    if (tableExists(db, "paper_fields")) {
      fields = db
        .prepare(
          `SELECT fieldid, score FROM paper_fields WHERE paperid = ? ORDER BY score DESC LIMIT 10`
        )
        .all(paperid) as PaperFieldRow[];
    }

    // Get source
    let source: PaperSourceRow | undefined;
    if (tableExists(db, "paper_sources")) {
      source = db
        .prepare(`SELECT * FROM paper_sources WHERE paperid = ?`)
        .get(paperid) as PaperSourceRow | undefined;
    }

    // Enrich fields with names from main DB
    const fieldIds = fields.map((f) => f.fieldid);
    const fieldNames = getFieldNames(fieldIds);

    // Enrich source with name from main DB
    const sourceIds = source?.sourceid ? [source.sourceid] : [];
    const sourceNames = getSourceNames(sourceIds);

    return NextResponse.json({
      paperid: coreRow.paperid,
      title: coreRow.title,
      doi: coreRow.doi,
      publicationDate: coreRow.publication_date,
      docType: coreRow.doc_type,
      language: coreRow.language,
      citedByCount: coreRow.cited_by_count,
      isRetracted: Boolean(coreRow.is_retracted),
      authors: authors.map((a) => ({
        authorid: a.authorid,
        displayName: a.display_name,
        position: a.author_position,
        institutionid: a.institutionid,
        affiliation: a.raw_affiliation,
      })),
      fields: fields.map((f) => ({
        fieldid: f.fieldid,
        name: fieldNames.get(f.fieldid) || f.fieldid,
        score: f.score,
      })),
      source: source
        ? {
            sourceid: source.sourceid,
            name: source.sourceid
              ? sourceNames.get(source.sourceid) || null
              : null,
            landingPageUrl: source.landing_page_url,
            pdfUrl: source.pdf_url,
            isOa: Boolean(source.is_oa),
            version: source.version,
            license: source.license,
          }
        : null,
      isLite: true, // Flag to indicate this is lite data
    });
  } catch (error) {
    console.error("Error fetching lite paper data:", error);
    return NextResponse.json(
      { error: "Failed to fetch lite paper data" },
      { status: 500 }
    );
  }
}
