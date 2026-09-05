import { NextRequest, NextResponse } from "next/server";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import { citationsAvailable, keyForPaperId, loadNeighborPage } from "@/lib/openaire-citations";
import type { OpenaireCitationsResponse } from "@/lib/types";

const PAGE_SIZE = 100;

/**
 * Citations of a SciSciNet paper found in the OpenAIRE Graph.
 *
 * These are strictly ADDITIONAL to journals.db paper_citations: the edge import
 * drops every SciSciNet<->SciSciNet edge, so anything stored against a 'W…' key
 * necessarily has an OpenAIRE-only paper on the other end - i.e. a citing paper
 * SciSciNet has no record of. No overlap, no dedupe needed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;
  const { offset, limit } = parsePagination(request.nextUrl.searchParams, { limit: PAGE_SIZE });

  const empty = (unavailable?: boolean): OpenaireCitationsResponse => ({
    citations: [],
    total: 0,
    offset,
    limit,
    hasMore: false,
    truncated: false,
    ...(unavailable ? { unavailable: true } : {}),
  });

  if (!/^W\d+$/.test(paperid)) return NextResponse.json(empty());

  // Not deployed: answer immediately rather than pay an id-translation worker
  // query for data we know is absent.
  if (!citationsAvailable()) return NextResponse.json(empty(true));

  try {
    const key = await keyForPaperId(paperid);
    if (key === null) return NextResponse.json(empty());

    const page = await loadNeighborPage("openaire_cites", key, offset, limit);
    if (!page) return NextResponse.json(empty(true));

    return NextResponse.json({
      citations: page.items,
      total: page.total,
      offset,
      limit,
      hasMore: offset + page.items.length < page.stored,
      truncated: page.truncated,
    } satisfies OpenaireCitationsResponse);
  } catch (error) {
    return errorResponse(error, "papers/[paperid]/openaire-citations");
  }
}
