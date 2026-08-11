import { NextRequest, NextResponse } from "next/server";
import { getOpenaireAbstractsDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

const ID_RE = /^OA[0-9a-f]{32}$/;

interface AbstractRow {
  abstract: string | null;
  language: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!ID_RE.test(id)) {
    return NextResponse.json({ abstract: null, language: null });
  }

  try {
    const db = getOpenaireAbstractsDb();
    if (!db) {
      return NextResponse.json({ abstract: null, language: null });
    }

    const row = db
      .prepare("SELECT abstract, language FROM openaire_abstracts WHERE id = ?")
      .get(id) as AbstractRow | undefined;

    return NextResponse.json({
      abstract: row?.abstract ?? null,
      language: row?.language ?? null,
    });
  } catch (error) {
    return errorResponse(error, "papers/openaire/[id]/abstract");
  }
}
