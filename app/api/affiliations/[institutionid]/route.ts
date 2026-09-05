import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { getAffiliationDetails } from "@/lib/queries/affiliations";
import { errorResponse } from "@/lib/api-utils";

/** Thin adapter over lib/queries/affiliations.ts — the server page uses the same functions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ institutionid: string }> }
) {
  try {
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not found. Run the preprocessing script first." },
        { status: 500 }
      );
    }

    const { institutionid } = await params;
    const data = await getAffiliationDetails(institutionid);
    if (!data) {
      return NextResponse.json({ error: "Affiliation not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "affiliations/[institutionid]");
  }
}
