import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

export interface ScopusOnlyJournal {
  scopus_source_id: string;
  display_name: string;
  publisher: string | null;
  issn: string | null;
  eissn: string | null;
  is_active: boolean;
  is_discontinued: boolean;
  discontinued_for_quality: boolean;
  coverage: string | null;
  source_type: string | null;
  is_medline: boolean;
  articles_in_press: boolean;
  languages: string[] | null;
  open_access_status: string | null;
  title_history: string | null;
  related_titles: string[] | null;
  asjc_codes: string[] | null;
  top_level_categories: {
    life_sciences?: boolean;
    social_sciences?: boolean;
    physical_sciences?: boolean;
    health_sciences?: boolean;
  } | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scopusid: string }> }
) {
  try {
    const { scopusid } = await params;

    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not found." },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get Scopus-only journal
    const row = db.prepare(`
      SELECT scopus_source_id, display_name, publisher, issn, eissn,
             is_active, is_discontinued, discontinued_for_quality,
             coverage, source_type, is_medline, articles_in_press,
             languages, open_access_status, title_history, related_titles,
             asjc_codes, top_level_categories
      FROM scopus_only_journals
      WHERE scopus_source_id = ?
    `).get(scopusid) as {
      scopus_source_id: string;
      display_name: string;
      publisher: string | null;
      issn: string | null;
      eissn: string | null;
      is_active: number;
      is_discontinued: number;
      discontinued_for_quality: number;
      coverage: string | null;
      source_type: string | null;
      is_medline: number;
      articles_in_press: number;
      languages: string | null;
      open_access_status: string | null;
      title_history: string | null;
      related_titles: string | null;
      asjc_codes: string | null;
      top_level_categories: string | null;
    } | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Journal not found" },
        { status: 404 }
      );
    }

    const journal: ScopusOnlyJournal = {
      scopus_source_id: row.scopus_source_id,
      display_name: row.display_name,
      publisher: row.publisher,
      issn: row.issn,
      eissn: row.eissn,
      is_active: row.is_active === 1,
      is_discontinued: row.is_discontinued === 1,
      discontinued_for_quality: row.discontinued_for_quality === 1,
      coverage: row.coverage,
      source_type: row.source_type,
      is_medline: row.is_medline === 1,
      articles_in_press: row.articles_in_press === 1,
      languages: row.languages ? JSON.parse(row.languages) : null,
      open_access_status: row.open_access_status,
      title_history: row.title_history,
      related_titles: row.related_titles ? JSON.parse(row.related_titles) : null,
      asjc_codes: row.asjc_codes ? JSON.parse(row.asjc_codes) : null,
      top_level_categories: row.top_level_categories ? JSON.parse(row.top_level_categories) : null,
    };

    return NextResponse.json(journal);
  } catch (error) {
    return errorResponse(error, "journals/scopus/[scopusid]");
  }
}
