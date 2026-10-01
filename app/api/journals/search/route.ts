import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
import type { JournalSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery } from "@/lib/worker-pool";
import { buildFtsQuery } from "@/lib/fts";

const STOP_WORDS = new Set(['of', 'the', 'and', 'in', 'for', 'on', 'to', 'a', 'an', 'at', 'by', 'or', 'is', 'it']);

/**
 * Extract significant search words from query (skip stop words and short words).
 * Returns words suitable for individual LIKE matching.
 */
function extractSearchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9-]/g, ''))
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
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
    const searchWords = extractSearchWords(query);

    // Search OpenAlex journals using tokenized word matching.
    // Each significant word must appear in display_name (AND logic),
    // plus exact ISSN/publisher substring match as alternative.
    const wordConditions = searchWords.length > 0
      ? searchWords.map(() => `LOWER(display_name) LIKE ?`).join(' AND ')
      : null;
    const wordParams = searchWords.map(w => `%${w}%`);

    const whereClauses: string[] = [];
    const sqlParams: string[] = [];

    if (wordConditions) {
      whereClauses.push(`(${wordConditions})`);
      sqlParams.push(...wordParams);
    } else {
      // All words were stop words or too short — fall back to full substring on display_name
      whereClauses.push(`LOWER(display_name) LIKE LOWER(?)`);
      sqlParams.push(searchPattern);
    }

    // Also match on ISSN or publisher with the full pattern
    whereClauses.push(`LOWER(issn) LIKE LOWER(?)`);
    sqlParams.push(searchPattern);
    whereClauses.push(`LOWER(publisher) LIKE LOWER(?)`);
    sqlParams.push(searchPattern);

    const openalexSql = `
      SELECT
        sourceid,
        display_name,
        issn,
        publisher,
        is_oa,
        total_papers
      FROM journal_summary
      WHERE ${whereClauses.join('\n         OR ')}
      ORDER BY total_papers DESC NULLS LAST
      LIMIT 40
    `;

    const openalexResults = await workerQuery<JournalSearchItem & { total_papers: number }>(
      openalexSql, ...sqlParams
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
