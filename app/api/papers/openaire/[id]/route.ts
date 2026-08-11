import { NextRequest, NextResponse } from "next/server";
import { getDb, getOpenaireDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type { OpenairePaperAuthor, OpenairePaperDetails } from "@/lib/types";

const ID_RE = /^OA[0-9a-f]{32}$/;

interface PaperRow {
  id: string;
  doi: string;
  pmid: string | null;
  title: string | null;
  subtitle: string | null;
  publication_date: string | null;
  year: number | null;
  type: string | null;
  language: string | null;
  publisher: string | null;
  journal_name: string | null;
  issn_printed: string | null;
  issn_online: string | null;
  matched_sourceid: string | null;
  volume: string | null;
  issue: string | null;
  start_page: string | null;
  end_page: string | null;
  best_access_right: string | null;
  oa_color: string | null;
  is_green: number | null;
  is_diamond: number | null;
  publicly_funded: number | null;
  author_count: number;
  has_abstract: number;
}

interface AuthorRow {
  rank: number;
  full_name: string | null;
  orcid: string | null;
  matched_authorid: string | null;
}

function toBool(v: number | null): boolean | null {
  return v === null ? null : Boolean(v);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid OpenAIRE paper id" }, { status: 400 });
  }

  try {
    const db = getOpenaireDb();
    if (!db) {
      return NextResponse.json({ error: "OpenAIRE data not available" }, { status: 404 });
    }

    const row = db
      .prepare("SELECT * FROM openaire_papers WHERE id = ?")
      .get(id) as PaperRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    const authorRows = db
      .prepare(
        `SELECT rank, full_name, orcid, matched_authorid
         FROM openaire_paper_authors WHERE id = ? ORDER BY rank LIMIT 500`
      )
      .all(id) as AuthorRow[];

    // Resolve journal display name from the main DB when ISSN-matched
    let journalDisplayName: string | null = null;
    if (row.matched_sourceid) {
      try {
        const j = getDb()
          .prepare("SELECT display_name FROM journal_summary WHERE sourceid = ?")
          .get(row.matched_sourceid) as { display_name: string | null } | undefined;
        journalDisplayName = j?.display_name ?? null;
      } catch {
        // journal lookup is best-effort
      }
    }

    const details: OpenairePaperDetails = {
      summary: {
        id: row.id,
        doi: row.doi,
        pmid: row.pmid,
        title: row.title,
        subtitle: row.subtitle,
        publicationDate: row.publication_date,
        year: row.year,
        type: row.type,
        language: row.language,
        publisher: row.publisher,
        journalName: row.journal_name,
        issnPrinted: row.issn_printed,
        issnOnline: row.issn_online,
        matchedSourceid: row.matched_sourceid,
        volume: row.volume,
        issue: row.issue,
        startPage: row.start_page,
        endPage: row.end_page,
        bestAccessRight: row.best_access_right,
        oaColor: row.oa_color,
        isGreen: toBool(row.is_green),
        isDiamond: toBool(row.is_diamond),
        publiclyFunded: toBool(row.publicly_funded),
        authorCount: row.author_count,
        hasAbstract: Boolean(row.has_abstract),
      },
      authors: authorRows.map(
        (a): OpenairePaperAuthor => ({
          rank: a.rank,
          fullName: a.full_name,
          orcid: a.orcid,
          matchedAuthorid: a.matched_authorid,
        })
      ),
      journalDisplayName,
    };

    return NextResponse.json(details);
  } catch (error) {
    return errorResponse(error, "papers/openaire/[id]");
  }
}
