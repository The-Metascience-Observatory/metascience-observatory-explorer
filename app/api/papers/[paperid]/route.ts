import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { getPaperDetails } from "@/lib/queries/papers";
import { errorResponse } from "@/lib/api-utils";

/** Thin adapter over lib/queries/papers.ts — the server page uses the same functions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperid: string }> }
) {
  try {
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 503 }
      );
    }

    const { paperid } = await params;
    const data = await getPaperDetails(paperid);
    if (!data) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "papers/[paperid]");
  }
}
