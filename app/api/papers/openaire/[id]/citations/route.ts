import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import {
  citationHistoryIfExact,
  citationsAvailable,
  keyForPaperId,
  loadNeighborPage,
} from "@/lib/openaire-citations";
import type { OpenaireCitationsResponse } from "@/lib/types";
import { CITATION_PAGE_SIZE } from "@/lib/constants";

const ID_RE = /^OA[0-9a-f]{32}$/;

/** Papers citing this OpenAIRE paper, from the OpenAIRE Graph Cites relations. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: CITATION_PAGE_SIZE });

  const empty = (unavailable?: boolean): OpenaireCitationsResponse => ({
    citations: [],
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

    const page = await loadNeighborPage("openaire_cites", key, offset, limit);
    if (!page) return NextResponse.json(empty(true));

    // Only compute the histogram on the first page, and only when the full
    // citing list is stored - see citationHistoryIfExact.
    const citationHistory =
      offset === 0 ? await citationHistoryIfExact(key, page.total, page.stored) : undefined;

    return NextResponse.json({
      citations: page.items,
      total: page.total,
      offset,
      limit,
      hasMore: offset + page.items.length < page.stored,
      truncated: page.truncated,
      ...(citationHistory ? { citationHistory } : {}),
    } satisfies OpenaireCitationsResponse);
  } catch (error) {
    return errorResponse(error, "papers/openaire/[id]/citations");
  }
}
