import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength, parsePagination } from "@/lib/api-utils";
import type { PaperSearchItem } from "@/lib/types";

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
 * This matches titles containing words starting with these terms.
 */
function buildFtsQuery(query: string): string {
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';

  // Each word becomes a prefix search term
  return words.map(word => {
    const sanitized = sanitizeFtsWord(word);
    if (!sanitized || sanitized.length < 2) return '';
    return `"${sanitized}"*`;
  }).filter(w => w.length > 0).join(' ');
}

// Server-side search using SQLite FTS5
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available papers
  if (!query) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM paper_summary").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term to search papers by title"
      });
    } catch (error) {
      return errorResponse(error, "papers/search metadata");
    }
  }

  // Validate query length (prevent DoS with extremely long queries)
  const lengthError = validateQueryLength(query, 200);
  if (lengthError) return lengthError;

  // Require at least 3 characters
  if (query.length < 3) {
    return NextResponse.json({ results: [], message: "Query must be at least 3 characters" });
  }

  try {
    const db = getDb();
    const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 100 });
    const ftsQuery = buildFtsQuery(query);

    if (!ftsQuery) {
      return NextResponse.json({ results: [], total: 0, offset: 0, limit, hasMore: false });
    }

    // Get total count for pagination
    const countStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM paper_title_fts f
      WHERE paper_title_fts MATCH ?
    `);
    const total = (countStmt.get(ftsQuery) as { count: number }).count;

    // Use FTS5 for fast full-text search, join with paper_summary for full data
    const stmt = db.prepare(`
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
    `);

    const results = stmt.all(ftsQuery, limit, offset) as PaperSearchItem[];

    return NextResponse.json({
      results,
      total,
      offset,
      limit,
      hasMore: offset + results.length < total
    });
  } catch (error) {
    // If FTS table doesn't exist, return informative message
    if (error instanceof Error && error.message.includes("no such table: paper_title_fts")) {
      console.log("paper_title_fts table not found - FTS index needs to be created");
      return NextResponse.json({
        results: [],
        message: "Paper search index not available. Run CREATE VIRTUAL TABLE paper_title_fts to enable.",
        indexRequired: true
      });
    }

    return errorResponse(error, "papers/search");
  }
}
