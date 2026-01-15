import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength, parsePagination } from "@/lib/api-utils";
import type { PersonSearchItem } from "@/lib/types";

/**
 * Sanitize a word for FTS5 query.
 * FTS5 special chars: " * - ^ ( ) : AND OR NOT NEAR
 * We strip these to prevent injection attacks.
 */
function sanitizeFtsWord(word: string): string {
  // Only keep alphanumeric characters and common name characters (apostrophe, period)
  // This prevents any FTS5 syntax injection
  return word.replace(/[^a-zA-Z0-9'.]/g, '').trim();
}

/**
 * Build FTS5 query from user input.
 * "daniel elton" -> "daniel"* "elton"*
 * This matches names containing words starting with these terms.
 */
function buildFtsQuery(query: string): string {
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';

  // Each word becomes a prefix search term
  // Use quotes to ensure exact word prefix matching
  return words.map(word => {
    // Handle hyphenated names: "fernandez-serra" -> fernandez OR serra
    if (word.includes('-')) {
      const parts = word.split('-').filter(p => p.length > 0);
      return parts
        .map(p => sanitizeFtsWord(p))
        .filter(p => p.length > 0)
        .map(p => `"${p}"*`)
        .join(' ');
    }
    const sanitized = sanitizeFtsWord(word);
    if (!sanitized) return '';
    return `"${sanitized}"*`;
  }).filter(w => w.length > 0).join(' ');
}

/**
 * Check if a first name in the database matches the search first name.
 * Handles initials: "Phil" matches "Philip", "Phillip", "P.", "P"
 */
function firstNameMatches(dbFirstName: string, searchFirstName: string): boolean {
  const dbLower = dbFirstName.toLowerCase();
  const searchLower = searchFirstName.toLowerCase();

  // Exact match
  if (dbLower === searchLower) return true;

  // Search is initial (1-2 chars): DB name must start with it
  if (searchLower.length <= 2) {
    const searchInitial = searchLower.replace(/\./g, '')[0];
    const dbInitial = dbLower.replace(/\./g, '')[0];
    return searchInitial === dbInitial;
  }

  // Search is full name: DB name must start with search term OR be an initial of search term
  if (dbLower.startsWith(searchLower)) return true;

  // DB name is initial: check if search starts with same letter
  if (dbLower.length <= 2) {
    const dbInitial = dbLower.replace(/\./g, '')[0];
    return searchLower[0] === dbInitial;
  }

  // DB name is longer: check if search is a prefix
  if (searchLower.length >= 3 && dbLower.startsWith(searchLower.slice(0, 3))) {
    return true;
  }

  return false;
}

/**
 * Check if the surname matches. For FTS results, we verify the last word of the name
 * matches our search term (to avoid false positives from middle names matching).
 */
function surnameMatches(displayName: string, searchSurname: string): boolean {
  const nameParts = displayName.toLowerCase().split(/\s+/);
  if (nameParts.length === 0) return false;

  const dbSurname = nameParts[nameParts.length - 1];
  const searchLower = searchSurname.toLowerCase();

  // Exact match
  if (dbSurname === searchLower) return true;

  // Handle hyphenated surnames
  const dbParts = dbSurname.split('-');
  if (dbParts.some(part => part === searchLower || part.startsWith(searchLower))) return true;

  // Search is hyphenated
  const searchParts = searchLower.split('-');
  if (searchParts.length > 1) {
    return searchParts.every(sp => dbParts.some(dp => dp === sp || dp.startsWith(sp)));
  }

  // Prefix match
  if (searchLower.length >= 3 && dbParts.some(part => part.startsWith(searchLower))) {
    return true;
  }

  return false;
}

/**
 * Filter and re-rank results based on name matching quality.
 */
function filterAndRankResults(
  results: PersonSearchItem[],
  query: string
): PersonSearchItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return results;

  const surname = words[words.length - 1];
  const firstNames = words.slice(0, -1);

  // Filter by surname (last word must match search surname)
  let filtered = results.filter(person => surnameMatches(person.display_name, surname));

  // Filter by first name if provided
  if (firstNames.length > 0) {
    filtered = filtered.filter(person => {
      const nameParts = person.display_name.split(/\s+/);
      if (nameParts.length < 2) return false;

      const dbFirstNames = nameParts.slice(0, -1);
      const searchFirst = firstNames[0];
      const dbFirst = dbFirstNames[0];

      if (!firstNameMatches(dbFirst, searchFirst)) return false;

      // Check middle name if provided
      if (firstNames.length > 1 && dbFirstNames.length > 1) {
        if (!firstNameMatches(dbFirstNames[1], firstNames[1])) return false;
      }

      return true;
    });
  }

  return filtered;
}

// Server-side search using SQLite FTS5
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  // If no query, return metadata about available authors
  if (!query) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM person_summary").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term to search authors"
      });
    } catch (error) {
      return errorResponse(error, "persons/search metadata");
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

    // Use FTS5 for fast full-text search, join with person_summary for full data
    // FTS5 is ~50x faster than LIKE on 100M rows
    // Fetch more than needed to account for post-filtering
    const fetchLimit = Math.min((offset + limit) * 3, 500);
    const stmt = db.prepare(`
      SELECT
        p.authorid,
        p.display_name,
        p.orcid,
        p.last_known_institution,
        p.h_index,
        p.productivity
      FROM person_fts f
      JOIN person_summary p ON f.authorid = p.authorid
      WHERE person_fts MATCH ?
      ORDER BY p.h_index DESC NULLS LAST
      LIMIT ?
    `);

    let results = stmt.all(ftsQuery, fetchLimit) as PersonSearchItem[];

    // Post-filter to ensure surname matches (FTS can match any word)
    results = filterAndRankResults(results, query);

    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    return NextResponse.json({
      results: paginatedResults,
      total,
      offset,
      limit,
      hasMore: offset + paginatedResults.length < total
    });
  } catch (error) {
    // If FTS table doesn't exist, fall back to LIKE search
    if (error instanceof Error && error.message.includes("no such table: person_fts")) {
      console.log("FTS table not found, falling back to LIKE search");
      return fallbackLikeSearch(query);
    }

    return errorResponse(error, "persons/search");
  }
}

// Fallback LIKE search if FTS5 table doesn't exist
async function fallbackLikeSearch(query: string): Promise<NextResponse> {
  try {
    const db = getDb();
    const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const surname = words[words.length - 1];
    const surnamePattern = `% ${surname}%`;
    const surnamePatternAlt = `${surname}%`;

    const stmt = db.prepare(`
      SELECT
        authorid,
        display_name,
        orcid,
        last_known_institution,
        h_index,
        productivity
      FROM person_summary
      WHERE LOWER(display_name) LIKE ? OR LOWER(display_name) LIKE ?
      ORDER BY h_index DESC NULLS LAST
      LIMIT 100
    `);

    let results = stmt.all(surnamePattern, surnamePatternAlt) as PersonSearchItem[];
    results = filterAndRankResults(results, query);
    results = results.slice(0, 20);

    return NextResponse.json({ results });
  } catch (error) {
    return errorResponse(error, "persons/search fallback");
  }
}
