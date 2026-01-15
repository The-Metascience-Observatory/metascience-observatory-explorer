import { NextRequest, NextResponse } from "next/server";
import { getRetractionsDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

export interface RetractionStats {
  // Overall counts
  totalRetractions: number;
  totalConcerns: number;
  totalCorrections: number;
  totalReinstatements: number;
  matchedToPapers: number;

  // By year
  byYear: { year: number; count: number; nature: string }[];

  // Top reasons
  topReasons: { reason: string; count: number }[];

  // Top journals (by retraction count)
  topJournals: { journal: string; count: number }[];

  // Top publishers
  topPublishers: { publisher: string; count: number }[];

  // Paper Mill trend (year over year)
  paperMillByYear: { year: number; count: number }[];

  // Journals by retraction rate
  journalsByRate: {
    sourceid: string;
    journal: string;
    rate: number;
    retractions: number;
    papersSince2010: number;
  }[];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startYear = parseInt(searchParams.get("startYear") || "2010");
  const endYear = parseInt(searchParams.get("endYear") || "2025");

  const retractionsDb = getRetractionsDb();
  if (!retractionsDb) {
    return NextResponse.json({
      error: "Retractions database not available"
    }, { status: 500 });
  }

  try {
    // Overall counts by nature
    const natureCounts = retractionsDb.prepare(`
      SELECT retraction_nature, COUNT(*) as count
      FROM retractions
      GROUP BY retraction_nature
    `).all() as { retraction_nature: string; count: number }[];

    const countMap: Record<string, number> = {};
    for (const row of natureCounts) {
      countMap[row.retraction_nature] = row.count;
    }

    // Count matched to papers
    const matchedCount = retractionsDb.prepare(`
      SELECT COUNT(DISTINCT record_id) as count FROM paper_retractions
    `).get() as { count: number };

    // By year and nature
    const byYear = retractionsDb.prepare(`
      SELECT
        CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) as year,
        retraction_nature as nature,
        COUNT(*) as count
      FROM retractions
      WHERE retraction_date IS NOT NULL
        AND LENGTH(retraction_date) >= 4
        AND CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) >= 1980
        AND CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) <= 2025
      GROUP BY year, nature
      ORDER BY year
    `).all() as { year: number; count: number; nature: string }[];

    // Top reasons (parsed from semicolon-separated list)
    // This is a bit complex since reasons are stored as semicolon-separated strings
    const topReasons = retractionsDb.prepare(`
      WITH RECURSIVE split(record_id, reason, rest) AS (
        SELECT record_id, '', reasons || ';'
        FROM retractions
        WHERE reasons IS NOT NULL AND reasons != ''
        UNION ALL
        SELECT
          record_id,
          TRIM(SUBSTR(rest, 1, INSTR(rest, ';') - 1)),
          SUBSTR(rest, INSTR(rest, ';') + 1)
        FROM split
        WHERE rest != ''
      )
      SELECT reason, COUNT(*) as count
      FROM split
      WHERE reason != ''
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 20
    `).all() as { reason: string; count: number }[];

    // Top journals by retraction count
    const topJournals = retractionsDb.prepare(`
      SELECT journal, COUNT(*) as count
      FROM retractions
      WHERE journal IS NOT NULL AND journal != ''
      GROUP BY journal
      ORDER BY count DESC
      LIMIT 25
    `).all() as { journal: string; count: number }[];

    // Top publishers
    const topPublishers = retractionsDb.prepare(`
      SELECT publisher, COUNT(*) as count
      FROM retractions
      WHERE publisher IS NOT NULL AND publisher != ''
      GROUP BY publisher
      ORDER BY count DESC
      LIMIT 20
    `).all() as { publisher: string; count: number }[];

    // Paper Mill trend
    const paperMillByYear = retractionsDb.prepare(`
      SELECT
        CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) as year,
        COUNT(*) as count
      FROM retractions
      WHERE reasons LIKE '%Paper Mill%'
        AND retraction_date IS NOT NULL
        AND LENGTH(retraction_date) >= 4
        AND CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) >= 2015
        AND CAST(SUBSTR(retraction_date, 1, 4) AS INTEGER) <= 2025
      GROUP BY year
      ORDER BY year
    `).all() as { year: number; count: number }[];

    // Journals by retraction rate
    // If using default date range (2010-2025), use pre-computed stats
    // Otherwise, compute from raw data with date filter
    let journalsByRate: {
      sourceid: string;
      journal: string;
      retractions: number;
      papersSince2010: number;
      rate: number;
    }[];

    if (startYear === 2010 && endYear === 2025) {
      // Use pre-computed stats for default range
      journalsByRate = retractionsDb.prepare(`
        SELECT
          sourceid,
          journal_name as journal,
          total_retractions as retractions,
          papers_since_2010 as papersSince2010,
          (CAST(total_retractions AS FLOAT) / papers_since_2010 * 100) as rate
        FROM journal_retraction_stats
        WHERE papers_since_2010 >= 100
          AND total_retractions > 0
        ORDER BY rate DESC
        LIMIT 100
      `).all() as typeof journalsByRate;
    } else {
      // Compute from raw retractions data with date filter
      // Count retractions per journal in the date range
      journalsByRate = retractionsDb.prepare(`
        WITH retraction_counts AS (
          SELECT
            r.sourceid,
            r.journal,
            COUNT(*) as retractions
          FROM retractions r
          WHERE r.retraction_nature = 'Retraction'
            AND r.sourceid IS NOT NULL
            AND r.retraction_date IS NOT NULL
            AND LENGTH(r.retraction_date) >= 4
            AND CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) >= ?
            AND CAST(SUBSTR(r.retraction_date, 1, 4) AS INTEGER) <= ?
          GROUP BY r.sourceid
        )
        SELECT
          rc.sourceid,
          COALESCE(js.journal_name, rc.journal) as journal,
          rc.retractions,
          js.papers_since_2010 as papersSince2010,
          (CAST(rc.retractions AS FLOAT) / js.papers_since_2010 * 100) as rate
        FROM retraction_counts rc
        JOIN journal_retraction_stats js ON rc.sourceid = js.sourceid
        WHERE js.papers_since_2010 >= 100
        ORDER BY rate DESC
        LIMIT 100
      `).all(startYear, endYear) as typeof journalsByRate;
    }

    const stats: RetractionStats = {
      totalRetractions: countMap["Retraction"] || 0,
      totalConcerns: countMap["Expression of concern"] || 0,
      totalCorrections: countMap["Correction"] || 0,
      totalReinstatements: countMap["Reinstatement"] || 0,
      matchedToPapers: matchedCount.count,
      byYear,
      topReasons,
      topJournals,
      topPublishers,
      paperMillByYear,
      journalsByRate,
    };

    return NextResponse.json(stats);
  } catch (error) {
    return errorResponse(error, "retractions/stats");
  }
}
