import { NextResponse } from "next/server";
import { getMeshDetails } from "@/lib/queries/mesh";
import { errorResponse } from "@/lib/api-utils";

/**
 * Thin adapter over lib/queries/mesh.ts. The SQL lives there so the server
 * component and this route share one implementation — the page no longer calls
 * this endpoint, but the client island that paginates papers still does.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ meshui: string }> }
) {
  try {
    const { meshui } = await params;
    const data = await getMeshDetails(meshui);

    if (!data) {
      return NextResponse.json({ error: "MeSH term not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return errorResponse(error, "mesh/[meshui]");
  }
}
