import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validateQueryLength } from "@/lib/api-utils";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { grantsAvailable, lookupGrantMatches } from "@/lib/queries/grants";
import type { GrantLookupResponse } from "@/lib/types";

/**
 * Resolve a grant number to the grants that carry it.
 *
 *   GET /api/grants/lookup?q=5R25MH101072-02
 *
 * `matches` holds every (funder, key) the input could mean: the exact key,
 * the same key under other funders for a bare number, and for NIH every
 * activity code on the same serial. Paging a grant's papers is a separate
 * call (/api/grants/papers) so offsets stay stable per grant.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const lengthError = validateQueryLength(q, 100);
  if (lengthError) return lengthError;

  if (!grantsAvailable()) {
    const body: GrantLookupResponse = { query: q, available: false, normalized: null, matches: [] };
    return NextResponse.json(body);
  }

  const cacheKey = generateCacheKey(`lookup:${q}`);
  const cached = searchCaches.grants.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const { normalized, matches } = await lookupGrantMatches(q);
    const body: GrantLookupResponse = { query: q, available: true, normalized, matches };
    searchCaches.grants.set(cacheKey, body);
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "grants/lookup");
  }
}
