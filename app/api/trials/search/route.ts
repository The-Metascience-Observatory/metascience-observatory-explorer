import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, validateQueryLength, parsePagination } from "@/lib/api-utils";
import type { TrialSearchItem } from "@/lib/types";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";

/**
 * Server-side trial search using SQLite.
 * Searches ClinicalTrials.gov data by NCT ID or title.
 * Supports filtering by intervention/drug name.
 * Supports pagination with offset/limit query params.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const intervention = searchParams.get("intervention");

  // If no query and no intervention filter, return metadata about available trials
  if (!query && !intervention) {
    try {
      const db = getDb();
      const countResult = db.prepare("SELECT COUNT(*) as count FROM ctg_studies").get() as { count: number };
      return NextResponse.json({
        total: countResult.count,
        message: "Use ?q=search_term or ?intervention=drug_name to search trials"
      });
    } catch (error) {
      return errorResponse(error, "trials/search metadata");
    }
  }

  // Validate query length if provided
  if (query) {
    const lengthError = validateQueryLength(query, 200);
    if (lengthError) return lengthError;

    // Require at least 2 characters for text search
    if (query.length < 2) {
      return NextResponse.json({ results: [], message: "Query must be at least 2 characters" });
    }
  }

  // Validate intervention length if provided
  if (intervention) {
    const lengthError = validateQueryLength(intervention, 200);
    if (lengthError) return lengthError;
  }

  try {
    // Build cache key including all search parameters
    const cacheParams: Record<string, string | number> = {
      offset: 0,
      limit: 0
    };

    const { offset, limit } = parsePagination(searchParams, { limit: 50, maxLimit: 100 });
    cacheParams.offset = offset;
    cacheParams.limit = limit;

    // Parse phase filter (comma-separated list)
    const phasesParam = searchParams.get("phases");
    const phases = phasesParam ? phasesParam.split(",").filter(p => p) : null;
    if (phasesParam) cacheParams.phases = phasesParam;

    // Check if query looks like an NCT ID (starts with NCT)
    const isNctQuery = query?.toUpperCase().startsWith("NCT");

    let results: TrialSearchItem[];
    let total: number;

    // Build phase filter clause
    let phaseClause = "";
    const phaseParams: string[] = [];
    if (phases && phases.length > 0) {
      // Handle special cases: NULL phase and "NA" phase
      const hasNull = phases.includes("NULL");
      const regularPhases = phases.filter(p => p !== "NULL");

      if (regularPhases.length > 0 && hasNull) {
        phaseClause = `AND (ctg.phase IN (${regularPhases.map(() => "?").join(",")}) OR ctg.phase IS NULL)`;
        phaseParams.push(...regularPhases);
      } else if (regularPhases.length > 0) {
        phaseClause = `AND ctg.phase IN (${regularPhases.map(() => "?").join(",")})`;
        phaseParams.push(...regularPhases);
      } else if (hasNull) {
        phaseClause = "AND ctg.phase IS NULL";
      }
    }

    // Build intervention filter clause
    let interventionClause = "";
    const interventionParams: string[] = [];
    if (intervention) {
      // Match intervention anywhere in the pipe-separated list (case-insensitive)
      interventionClause = "AND LOWER(ctg.interventions) LIKE LOWER(?)";
      interventionParams.push(`%${intervention}%`);
      cacheParams.intervention = intervention;
    }

    // Check cache first
    const cacheKey = generateCacheKey(query || intervention || '', cacheParams);
    const cached = searchCaches.trials.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    if (intervention && !query) {
      // Intervention-only search (no text query)
      // Get total count
      const countSql = `
        SELECT COUNT(*) as count
        FROM ctg_studies ctg
        WHERE ctg.interventions IS NOT NULL ${interventionClause} ${phaseClause}
      `;
      const countResult = await workerQueryOne<{ count: number }>(countSql, ...interventionParams, ...phaseParams);
      total = countResult?.count ?? 0;

      // Search by intervention
      const sql = `
        SELECT
          ctg.nct_id,
          ctg.title,
          ctg.status,
          ctg.phase,
          ctg.sponsor,
          ctg.enrollment,
          ts.paper_count
        FROM ctg_studies ctg
        LEFT JOIN trial_summary ts ON ctg.nct_id = ts.nct_id
        WHERE ctg.interventions IS NOT NULL ${interventionClause} ${phaseClause}
        ORDER BY ctg.enrollment DESC NULLS LAST
        LIMIT ? OFFSET ?
      `;
      results = await workerQuery<TrialSearchItem>(sql, ...interventionParams, ...phaseParams, limit, offset);
    } else if (isNctQuery) {
      const searchPattern = `${query!.toUpperCase()}%`;

      // Get total count
      const countSql = `
        SELECT COUNT(*) as count
        FROM ctg_studies ctg
        WHERE ctg.nct_id LIKE ? ${interventionClause} ${phaseClause}
      `;
      const countResult = await workerQueryOne<{ count: number }>(countSql, searchPattern, ...interventionParams, ...phaseParams);
      total = countResult?.count ?? 0;

      // Search by NCT ID prefix match with pagination
      const sql = `
        SELECT
          ctg.nct_id,
          ctg.title,
          ctg.status,
          ctg.phase,
          ctg.sponsor,
          ctg.enrollment,
          ts.paper_count
        FROM ctg_studies ctg
        LEFT JOIN trial_summary ts ON ctg.nct_id = ts.nct_id
        WHERE ctg.nct_id LIKE ? ${interventionClause} ${phaseClause}
        ORDER BY ctg.enrollment DESC NULLS LAST
        LIMIT ? OFFSET ?
      `;
      results = await workerQuery<TrialSearchItem>(sql, searchPattern, ...interventionParams, ...phaseParams, limit, offset);
    } else {
      const searchPattern = `%${query}%`;

      // Get total count
      const countSql = `
        SELECT COUNT(*) as count
        FROM ctg_studies ctg
        WHERE LOWER(ctg.title) LIKE LOWER(?) ${interventionClause} ${phaseClause}
      `;
      const countResult = await workerQueryOne<{ count: number }>(countSql, searchPattern, ...interventionParams, ...phaseParams);
      total = countResult?.count ?? 0;

      // Search by title with pagination
      const sql = `
        SELECT
          ctg.nct_id,
          ctg.title,
          ctg.status,
          ctg.phase,
          ctg.sponsor,
          ctg.enrollment,
          ts.paper_count
        FROM ctg_studies ctg
        LEFT JOIN trial_summary ts ON ctg.nct_id = ts.nct_id
        WHERE LOWER(ctg.title) LIKE LOWER(?) ${interventionClause} ${phaseClause}
        ORDER BY ctg.enrollment DESC NULLS LAST
        LIMIT ? OFFSET ?
      `;
      results = await workerQuery<TrialSearchItem>(sql, searchPattern, ...interventionParams, ...phaseParams, limit, offset);
    }

    const response = {
      results,
      total,
      offset,
      limit,
      hasMore: offset + results.length < total,
      intervention: intervention || undefined
    };

    // Cache the response
    searchCaches.trials.set(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "trials/search");
  }
}
