import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

export interface TopJournalEntry {
  sourceid: string;
  display_name: string;
  publisher: string | null;
  total_papers: number | null;
  total_citations: number | null;
  is_oa: boolean | null;
  primary_field_l0_name: string | null;
  impact_factor_2yr: number | null;
  impact_factor_5yr: number | null;
  citescore: number | null;
  year: number;
}

export interface TopJournalsResponse {
  journals: TopJournalEntry[];
  total: number;
  page: number;
  totalPages: number;
  fields: string[];
  metricsYear: number;
}

// Map user-facing sort keys to safe SQL column references
const SORT_COLUMN_MAP: Record<string, { column: string; table: 'jif' | 'js' }> = {
  impact_factor_2yr: { column: 'jif.impact_factor_2yr', table: 'jif' },
  impact_factor_5yr: { column: 'jif.impact_factor_5yr', table: 'jif' },
  citescore: { column: 'jif.citescore', table: 'jif' },
  total_papers: { column: 'js.total_papers', table: 'js' },
  total_citations: { column: 'js.total_citations', table: 'js' },
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const sort = searchParams.get('sort') || 'impact_factor_2yr';
    const order = searchParams.get('order') || 'desc';
    const field = searchParams.get('field') || null;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    // Validate sort field
    const sortEntry = SORT_COLUMN_MAP[sort];
    if (!sortEntry) {
      return NextResponse.json(
        { error: `Invalid sort field. Must be one of: ${Object.keys(SORT_COLUMN_MAP).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate order
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get the most recent year with substantial impact data (at least 1000 journals)
    const latestYear = db.prepare(`
      SELECT year FROM journal_impact_factors
      GROUP BY year
      HAVING COUNT(*) >= 1000
      ORDER BY year DESC
      LIMIT 1
    `).get() as { year: number } | undefined;

    const metricsYear = latestYear?.year || 2024;

    // Build the WHERE clause
    let whereClause = 'WHERE jif.year = ?';
    const params: (string | number)[] = [metricsYear];

    if (field) {
      whereClause += ' AND js.primary_field_l0_name = ?';
      params.push(field);
    }

    // Filter out journals with null values for the sort field
    whereClause += ` AND ${sortEntry.column} IS NOT NULL`;

    // Get total count
    const countResult = db.prepare(`
      SELECT COUNT(*) as count
      FROM journal_summary js
      JOIN journal_impact_factors jif ON js.sourceid = jif.sourceid
      ${whereClause}
    `).get(...params) as { count: number };

    const total = countResult?.count || 0;
    const totalPages = Math.ceil(total / limit);

    // Get journals with pagination
    const journals = db.prepare(`
      SELECT
        js.sourceid,
        js.display_name,
        js.publisher,
        js.total_papers,
        js.total_citations,
        js.is_oa,
        js.primary_field_l0_name,
        jif.impact_factor_2yr,
        jif.impact_factor_5yr,
        jif.citescore,
        jif.year
      FROM journal_summary js
      JOIN journal_impact_factors jif ON js.sourceid = jif.sourceid
      ${whereClause}
      ORDER BY ${sortEntry.column} ${sortOrder} NULLS LAST
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as TopJournalEntry[];

    // Get list of available fields for filtering
    const fieldsResult = db.prepare(`
      SELECT DISTINCT primary_field_l0_name
      FROM journal_summary
      WHERE primary_field_l0_name IS NOT NULL
      ORDER BY primary_field_l0_name
    `).all() as { primary_field_l0_name: string }[];

    const fields = fieldsResult.map(f => f.primary_field_l0_name);

    const response: TopJournalsResponse = {
      journals,
      total,
      page,
      totalPages,
      fields,
      metricsYear,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "journals/top");
  }
}
