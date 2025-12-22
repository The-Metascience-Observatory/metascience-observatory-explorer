import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import { fetchScopusCiteScore } from "@/lib/scopus";
import type {
  JournalSummary,
  JournalYearlyStats,
  JournalField,
  JournalImpactFactor,
  JournalOfficialMetrics,
  JournalDetails,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sourceid: string }> }
) {
  try {
    const { sourceid } = await params;

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

    // Get journal summary
    const summary = db
      .prepare(
        `SELECT * FROM journal_summary WHERE sourceid = ?`
      )
      .get(sourceid) as JournalSummary | undefined;

    if (!summary) {
      return NextResponse.json(
        { error: "Journal not found" },
        { status: 404 }
      );
    }

    // Get yearly statistics
    const yearlyStats = db
      .prepare(
        `SELECT sourceid, year, paper_count, total_citations
         FROM journal_yearly_stats
         WHERE sourceid = ?
         ORDER BY year`
      )
      .all(sourceid) as JournalYearlyStats[];

    // Get field associations
    let fields: JournalField[] = [];
    try {
      fields = db
        .prepare(
          `SELECT sourceid, fieldid, field_name, level, paper_count, score_sum
           FROM journal_fields
           WHERE sourceid = ?
           ORDER BY paper_count DESC
           LIMIT 20`
        )
        .all(sourceid) as JournalField[];
    } catch {
      // journal_fields table might not exist if --skip-fields was used
      console.log("journal_fields table not found, skipping");
    }

    // Get computed impact factors
    let impactFactors: JournalImpactFactor[] = [];
    try {
      impactFactors = db
        .prepare(
          `SELECT sourceid, year, citations_2yr, papers_2yr, impact_factor_2yr,
                  citations_5yr, papers_5yr, impact_factor_5yr,
                  citations_citescore, papers_citescore, citescore
           FROM journal_impact_factors
           WHERE sourceid = ?
           ORDER BY year`
        )
        .all(sourceid) as JournalImpactFactor[];
    } catch {
      // journal_impact_factors table might not exist yet
      console.log("journal_impact_factors table not found, skipping");
    }

    // Fetch official CiteScore from Scopus API (if ISSN available)
    let officialMetrics: JournalOfficialMetrics | undefined;
    if (summary.issn) {
      try {
        // Parse ISSN (may be JSON array string)
        const issnList: string[] = summary.issn.startsWith('[')
          ? JSON.parse(summary.issn)
          : [summary.issn];

        for (const issn of issnList) {
          const scopusData = await fetchScopusCiteScore(issn);
          if (scopusData?.citescore) {
            officialMetrics = {
              scopus_citescore: scopusData.citescore,
              scopus_citescore_year: scopusData.citescoreYear,
              scopus_percentile: scopusData.percentile,
              scopus_rank: scopusData.rank,
            };
            break; // Found valid data
          }
        }
      } catch (e) {
        console.error("Error fetching Scopus data:", e);
      }
    }

    const response: JournalDetails = {
      summary,
      yearlyStats,
      fields,
      impactFactors: impactFactors.length > 0 ? impactFactors : undefined,
      officialMetrics,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "journals/[sourceid]");
  }
}
