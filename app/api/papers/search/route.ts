import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validateQueryLength, parsePagination } from "@/lib/api-utils";
import { ENTITY_COUNTS } from "@/lib/counts";
import type { PaperSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery, openaireWorkerQuery } from "@/lib/worker-pool";

/**
 * Sanitize a word for FTS5 query.
 * FTS5 special chars: " * - ^ ( ) : AND OR NOT NEAR
 * We strip these to prevent injection attacks.
 */
function sanitizeFtsWord(word: string): string {
  // Keep alphanumeric characters and common punctuation in titles
  return word.replace(/[^a-zA-Z0-9]/g, '').trim();
}

/**
 * Build FTS5 query from user input.
 * "machine learning" -> "machine"* "learning"*
 * "Cerebrolysin-Improved" -> "cerebrolysin"* "improved"*
 * This matches titles containing words starting with these terms.
 */
function buildFtsQuery(query: string): string {
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';

  // Each word becomes a prefix search term
  // Handle hyphenated words by splitting them
  return words.flatMap(word => {
    // Split on hyphens to handle hyphenated words
    const parts = word.split('-').filter(p => p.length > 0);
    return parts.map(part => {
      const sanitized = sanitizeFtsWord(part);
      if (!sanitized || sanitized.length < 2) return '';
      return `"${sanitized}"*`;
    });
  }).filter(w => w.length > 0).join(' ');
}

// Server-side search using SQLite FTS5
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available papers.
  // Use the static count instead of COUNT(*) on paper_summary: that table has
  // ~250M rows, so the scan takes ~8s AND runs synchronously via getDb() on the
  // main thread, stalling every other request. See lib/counts.ts.
  if (!query) {
    return NextResponse.json({
      total: ENTITY_COUNTS.papers,
      message: "Use ?q=search_term to search papers by title"
    });
  }

  // Validate query length (prevent DoS with extremely long queries)
  const lengthError = validateQueryLength(query, 200);
  if (lengthError) return lengthError;

  // Require at least 3 characters
  if (query.length < 3) {
    return NextResponse.json({ results: [], message: "Query must be at least 3 characters" });
  }

  try {
    const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 100 });
    const ftsQuery = buildFtsQuery(query);

    if (!ftsQuery) {
      return NextResponse.json({ results: [], total: 0, offset: 0, limit, hasMore: false });
    }

    // Check cache first
    const cacheKey = generateCacheKey(ftsQuery, { offset, limit });
    const cached = searchCaches.papers.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Use FTS5 for fast full-text search, join with paper_summary for full data
    // Fetch limit+1 to detect if there are more results (avoids expensive COUNT query)
    const sql = `
      SELECT
        p.paperid,
        p.title,
        p.doi,
        p.year,
        p.cited_by_count,
        p.source_name
      FROM paper_title_fts f
      JOIN paper_summary p ON f.paperid = p.paperid
      WHERE paper_title_fts MATCH ?
      ORDER BY p.cited_by_count DESC NULLS LAST
      LIMIT ? OFFSET ?
    `;

    // OpenAIRE first-class papers: search their FTS in parallel on the dedicated
    // small pool. First page only; failure or missing DB degrades to no extras.
    // Exact-token MATCH (no `*` prefix) — the openaire FTS has no prefix indexes,
    // so prefix queries would scan millions of doclist entries. A 2s race keeps
    // a slow OpenAIRE leg from ever delaying the main results.
    const openaireFtsQuery = ftsQuery.replaceAll('"*', '"').replaceAll("*", "");
    const openairePromise: Promise<PaperSearchItem[]> =
      offset === 0 && openaireFtsQuery
        ? Promise.race([
            openaireWorkerQuery<PaperSearchItem>(
              `SELECT p.id AS paperid, p.title, p.doi, p.year,
                      NULL AS cited_by_count, p.journal_name AS source_name
               FROM openaire_title_fts f
               JOIN openaire_papers p ON p.rowid = f.rowid
               WHERE openaire_title_fts MATCH ?
               ORDER BY rank
               LIMIT 10`,
              openaireFtsQuery
            ),
            new Promise<PaperSearchItem[]>((resolve) =>
              setTimeout(() => resolve([]), 2000)
            ),
          ]).catch(() => [])
        : Promise.resolve([]);

    // Run query in worker thread to avoid blocking the main event loop
    const [results, openaireResults] = await Promise.all([
      workerQuery<PaperSearchItem>(sql, ftsQuery, limit + 1, offset),
      openairePromise,
    ]);

    // Check if there are more results beyond this page
    const hasMore = results.length > limit;
    if (hasMore) {
      results.pop(); // Remove the extra result used for hasMore detection
    }

    // Append OpenAIRE results after SciSciNet's (no citation counts to rank by)
    const combined = results.concat(
      openaireResults.map((r) => ({ ...r, openaire: true }))
    );

    const response = {
      results: combined,
      total: hasMore ? -1 : offset + combined.length, // -1 indicates unknown total (has more pages)
      offset,
      limit,
      hasMore
    };

    // Cache the response
    searchCaches.papers.set(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) {
      console.error("Search index not available:", error.message);
      return NextResponse.json({
        results: [],
        message: "Search temporarily unavailable.",
      });
    }

    return errorResponse(error, "papers/search");
  }
}
