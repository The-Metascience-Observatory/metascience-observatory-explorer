import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type { FieldItem, FieldTopPaper, FieldTopAuthor, FieldTopCitedPaper, FieldDetails } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fieldid: string }> }
) {
  try {
    const { fieldid } = await params;

    // Check if database is available
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        {
          error: "Database not found. Run the preprocessing script first.",
        },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get field summary
    const summary = db
      .prepare(
        `SELECT * FROM field_summary WHERE fieldid = ?`
      )
      .get(fieldid) as FieldItem | undefined;

    if (!summary) {
      return NextResponse.json(
        { error: "Field not found" },
        { status: 404 }
      );
    }

    // Get top papers
    let topPapers: FieldTopPaper[] = [];
    try {
      topPapers = db
        .prepare(
          `SELECT paperid, title, year, cited_by_count, source_name
           FROM field_top_papers
           WHERE fieldid = ?
           ORDER BY cited_by_count DESC
           LIMIT 50`
        )
        .all(fieldid) as FieldTopPaper[];
    } catch {
      console.log("field_top_papers table not found");
    }

    // Get top authors
    let topAuthors: FieldTopAuthor[] = [];
    try {
      topAuthors = db
        .prepare(
          `SELECT authorid, display_name, h_index, paper_count
           FROM field_top_authors
           WHERE fieldid = ?
           ORDER BY paper_count DESC
           LIMIT 50`
        )
        .all(fieldid) as FieldTopAuthor[];
    } catch {
      console.log("field_top_authors table not found");
    }

    // Get top cited papers (with field-normalized citation scores)
    // Select from appropriate table based on field level
    let topCitedPapers: FieldTopCitedPaper[] = [];
    try {
      // Try level 0 first (broad fields)
      const level0Papers = db
        .prepare(
          `SELECT fieldid, paperid, title, year, citation_count, normalized_citations, source_name
           FROM field_top_cited_papers_level0
           WHERE fieldid = ?
           ORDER BY normalized_citations DESC
           LIMIT 20`
        )
        .all(fieldid) as FieldTopCitedPaper[];

      if (level0Papers.length > 0) {
        topCitedPapers = level0Papers;
      } else {
        // Try level 1 (narrower subfields)
        topCitedPapers = db
          .prepare(
            `SELECT fieldid, paperid, title, year, citation_count, normalized_citations, source_name
             FROM field_top_cited_papers_level1
             WHERE fieldid = ?
             ORDER BY normalized_citations DESC
             LIMIT 20`
          )
          .all(fieldid) as FieldTopCitedPaper[];
      }
    } catch {
      console.log("field_top_cited_papers tables not found");
    }

    const response: FieldDetails = {
      summary,
      topPapers,
      topAuthors,
      topCitedPapers,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "fields/[fieldid]");
  }
}
