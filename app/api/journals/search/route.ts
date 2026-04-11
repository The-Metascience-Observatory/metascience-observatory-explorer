import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
import type { JournalSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery } from "@/lib/worker-pool";

function sanitizeFtsWord(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').trim();
}

function buildFtsQuery(query: string): string {
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';
  return words.flatMap(word => {
    const parts = word.split('-').filter(p => p.length > 0);
    return parts.map(part => {
      const sanitized = sanitizeFtsWord(part);
      if (!sanitized || sanitized.length < 2) return '';
      return `"${sanitized}"*`;
    });
  }).filter(w => w.length > 0).join(' ');
}

/**
 * Server-side journal search using SQLite.
 * Searches both OpenAlex journals and Scopus-only journals.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available journals
  if (!query) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM journal_summary").get() as { count: number };
      let scopusOnlyCount = 0;
      try {
        const scopusResult = db.prepare("SELECT COUNT(*) as count FROM scopus_only_journals").get() as { count: number };
        scopusOnlyCount = scopusResult.count;
      } catch {
        // Table may not exist
      }
      return NextResponse.json({
        total: countResult.count + scopusOnlyCount,
        openalexCount: countResult.count,
        scopusOnlyCount: scopusOnlyCount,
        message: "Use ?q=search_term to search journals"
      });
    } catch (error) {
      return errorResponse(error, "journals/search metadata");
    }
  }

  // Validate query length (prevent DoS with extremely long queries)
  const lengthError = validateQueryLength(query, 200);
  if (lengthError) return lengthError;

  // Require at least 2 characters
  if (query.length < 2) {
    return NextResponse.json({ results: [], message: "Query must be at least 2 characters" });
  }

  try {
    // Check cache first
    const cacheKey = generateCacheKey(query);
    const cached = searchCaches.journals.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const searchPattern = `%${query}%`;

    // Search OpenAlex journals (with total_papers for ranking)
    const openalexSql = `
      SELECT
        sourceid,
        display_name,
        issn,
        publisher,
        is_oa,
        total_papers
      FROM journal_summary
      WHERE LOWER(display_name) LIKE LOWER(?)
         OR LOWER(issn) LIKE LOWER(?)
         OR LOWER(publisher) LIKE LOWER(?)
      ORDER BY total_papers DESC NULLS LAST
      LIMIT 40
    `;

    const openalexResults = await workerQuery<JournalSearchItem & { total_papers: number }>(
      openalexSql, searchPattern, searchPattern, searchPattern
    );

    // Search Scopus-only journals using FTS for speed
    let scopusResults: JournalSearchItem[] = [];
    try {
      const db = getDb();
      const scopusSql = `
        SELECT
          scopus_source_id as sourceid,
          display_name,
          issn,
          publisher,
          NULL as is_oa
        FROM scopus_only_journals
        WHERE scopus_source_id IN (
          SELECT scopus_source_id FROM scopus_only_journals_fts
          WHERE scopus_only_journals_fts MATCH ?
        )
        LIMIT 15
      `;
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) {
        scopusResults = [];
      } else {
        scopusResults = db.prepare(scopusSql).all(ftsQuery) as JournalSearchItem[];
      }
      // Mark as scopus_only
      scopusResults = scopusResults.map(r => ({ ...r, scopus_only: true }));
    } catch {
      // FTS table may not exist, fall back to LIKE search
      try {
        const db = getDb();
        const scopusFallbackSql = `
          SELECT
            scopus_source_id as sourceid,
            display_name,
            issn,
            publisher,
            NULL as is_oa
          FROM scopus_only_journals
          WHERE LOWER(display_name) LIKE LOWER(?)
             OR LOWER(issn) LIKE LOWER(?)
             OR LOWER(publisher) LIKE LOWER(?)
          LIMIT 15
        `;
        scopusResults = db.prepare(scopusFallbackSql).all(searchPattern, searchPattern, searchPattern) as JournalSearchItem[];
        scopusResults = scopusResults.map(r => ({ ...r, scopus_only: true }));
      } catch {
        // Table doesn't exist
      }
    }

    // Combine results - OpenAlex first (they have more data), then Scopus-only
    const allResults: JournalSearchItem[] = [
      ...openalexResults.map(r => ({ ...r, scopus_only: false })),
      ...scopusResults
    ].slice(0, 50);

    const response = { results: allResults };
    searchCaches.journals.set(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "journals/search");
  }
}
