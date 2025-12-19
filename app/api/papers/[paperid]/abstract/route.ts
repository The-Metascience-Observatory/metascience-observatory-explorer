import { NextRequest, NextResponse } from "next/server";
import { getAbstractsDb } from "@/lib/db";

interface AbstractRow {
  paperid: string;
  title: string;
  abstract: string;
  language: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  try {
    const db = getAbstractsDb();

    // If abstracts database doesn't exist, return null gracefully
    if (!db) {
      return NextResponse.json({
        abstract: null,
        language: null,
      });
    }

    const row = db
      .prepare(
        `SELECT abstract, language FROM paper_abstracts WHERE paperid = ?`
      )
      .get(paperid) as AbstractRow | undefined;

    if (!row) {
      return NextResponse.json({
        abstract: null,
        language: null,
      });
    }

    return NextResponse.json({
      abstract: row.abstract,
      language: row.language,
    });
  } catch (error) {
    console.error("Error fetching abstract:", error);
    return NextResponse.json(
      { error: "Failed to fetch abstract" },
      { status: 500 }
    );
  }
}
