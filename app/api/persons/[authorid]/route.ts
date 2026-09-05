import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";
import { getPersonDetails } from "@/lib/queries/persons";
import { errorResponse } from "@/lib/api-utils";

/** Thin adapter over lib/queries/persons.ts — the server page uses the same functions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ authorid: string }> }
) {
  try {
    if (!isDatabaseAvailable()) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    const { authorid } = await params;
    const data = await getPersonDetails(authorid);
    if (!data) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "persons/[authorid]");
  }
}
