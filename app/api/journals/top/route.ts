import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { getTopJournalsPage } from "@/lib/queries/journals-top";
import { errorResponse } from "@/lib/api-utils";

export type { TopJournalEntry, TopJournalsResponse } from "@/lib/queries/journals-top";

/** Thin adapter over lib/queries/journals-top.ts — the server page uses the same function. */
export async function GET(request: Request) {
  try {
    if (!isDatabaseAvailable()) {
      return NextResponse.json({ error: "Database not available" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const data = await getTopJournalsPage(page, limit, {
      sort: searchParams.get("sort") || undefined,
      order: searchParams.get("order") || undefined,
      field: searchParams.get("field"),
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "journals/top");
  }
}
