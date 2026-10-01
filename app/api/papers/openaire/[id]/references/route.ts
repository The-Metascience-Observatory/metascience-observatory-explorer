import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import { citationsAvailable, keyForPaperId, loadNeighborPage } from "@/lib/openaire-citations";
import type { OpenaireReferencesResponse } from "@/lib/types";
import { CITATION_PAGE_SIZE } from "@/lib/constants";

const ID_RE = /^OA[0-9a-f]{32}$/;

/** Papers this OpenAIRE paper cites, from the OpenAIRE Graph Cites relations. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: CITATION_PAGE_SIZE });

  // Fail soft rather than 400/500: this is a side panel on a page that must
  // still render without it (matches the abstract route's behavior).
  const empty = (unavailable?: boolean): OpenaireReferencesResponse => ({
    references: [],
    total: 0,
    offset,
    limit,
    hasMore: false,
    truncated: false,
    ...(unavailable ? { unavailable: true } : {}),
  });

  if (!ID_RE.test(id)) return NextResponse.json(empty());

  // Not deployed: answer immediately rather than pay an id-translation worker
  // query for data we know is absent.
  if (!citationsAvailable()) return NextResponse.json(empty(true));

  try {
    const key = await keyForPaperId(id);
    if (key === null) return NextResponse.json(empty());

    const page = await loadNeighborPage("openaire_refs", key, offset, limit);
    if (!page) return NextResponse.json(empty(true));

    return NextResponse.json({
      references: page.items,
      total: page.total,
      offset,
      limit,
      hasMore: offset + page.items.length < page.stored,
      truncated: page.truncated,
    } satisfies OpenaireReferencesResponse);
  } catch (error) {
    return errorResponse(error, "papers/openaire/[id]/references");
  }
}
