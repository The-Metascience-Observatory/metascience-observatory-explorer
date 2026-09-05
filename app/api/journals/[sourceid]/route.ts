import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { getJournalDetails } from "@/lib/queries/journals";
import { errorResponse } from "@/lib/api-utils";

/**
 * Thin adapter over lib/queries/journals.ts.
 *
 * Passes includeScopus=true: an API consumer can afford to wait on the
 * external CiteScore lookup, whereas the server-rendered page cannot.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sourceid: string }> }
) {
  try {
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not found. Run the preprocessing script first." },
        { status: 500 }
      );
    }

    const { sourceid } = await params;
    const data = await getJournalDetails(sourceid, true);
    if (!data) {
      return NextResponse.json({ error: "Journal not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "journals/[sourceid]");
  }
}
