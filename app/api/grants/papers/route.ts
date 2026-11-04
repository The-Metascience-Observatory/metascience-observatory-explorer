import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { getGrantPapersPage, grantsAvailable } from "@/lib/queries/grants";
import { GRANT_SOURCE_MASKS, type GrantSourceFilter } from "@/lib/grant-id";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import type { GrantPapersResponse } from "@/lib/types";

const FUNDER_RE = /^[A-Z0-9]{1,8}$/i;
const KEY_RE = /^[A-Z0-9]{1,40}$/i;

/**
 * One page of the papers linked to a grant, most cited first.
 *
 *   GET /api/grants/papers?funder=NIH&key=R25MH101072&source=reported&offset=0&limit=50
 *
 * `source` is `all` (default), `reported` (NIH RePORTER / NSF link files) or
 * `acknowledged` (PubMed grant field / OpenAIRE project links).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const funder = (sp.get("funder") ?? "").toUpperCase();
  const key = (sp.get("key") ?? "").toUpperCase();
  const source = (sp.get("source") ?? "all") as GrantSourceFilter;

  if (!FUNDER_RE.test(funder) || !KEY_RE.test(key)) {
    return NextResponse.json({ error: "funder and key are required" }, { status: 400 });
  }
  if (!(source in GRANT_SOURCE_MASKS)) {
    return NextResponse.json({ error: "source must be all, reported or acknowledged" }, { status: 400 });
  }
  const { offset, limit } = parsePagination(sp, { limit: BROWSE_PAGE_SIZE, maxLimit: 100 });

  if (!grantsAvailable()) {
    const body: GrantPapersResponse = { results: [], total: 0, offset, limit, hasMore: false };
    return NextResponse.json(body);
  }

  const cacheKey = generateCacheKey(`papers:${funder}:${key}`, { source, offset, limit });
  const cached = searchCaches.grants.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const { results, total } = await getGrantPapersPage(
      funder,
      key,
      GRANT_SOURCE_MASKS[source],
      offset,
      limit
    );
    const body: GrantPapersResponse = {
      results,
      total,
      offset,
      limit,
      hasMore: offset + results.length < total,
    };
    searchCaches.grants.set(cacheKey, body);
    return NextResponse.json(body);
  } catch (error) {
    return errorResponse(error, "grants/papers");
  }
}
