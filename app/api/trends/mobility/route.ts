import { NextRequest, NextResponse } from "next/server";
import { identityWorkerQuery } from "@/lib/worker-pool";
import { errorResponse, parsePagination } from "@/lib/api-utils";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";

interface FlowRow {
  from_country: string;
  to_country: string;
  n: number;
}

interface TotalsRow {
  country: string;
  year: number;
  inflow: number;
  outflow: number;
  net: number;
}

// Rollups are small, but a drill-down filters mobility_flows by country and
// year, so both paths go through the optional worker pool rather than the
// main thread. A missing identity.db yields [] and the chart hides itself.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const fromYear = parseInt(searchParams.get("fromYear") ?? "1990", 10);
  const toYear = parseInt(searchParams.get("toYear") ?? "2026", 10);
  const { limit } = parsePagination(searchParams, { limit: 40, maxLimit: 200 });

  if (isNaN(fromYear) || isNaN(toYear) || fromYear > toYear) {
    return NextResponse.json({ error: "invalid year range" }, { status: 400 });
  }

  const cacheKey = generateCacheKey("trends:mobility", {
    country: country ?? "",
    fromYear,
    toYear,
    limit,
  });
  const cached = searchCaches.trends.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    // Default view reads the precomputed rollup whole; the country filter is the
    // drill-down escape hatch, still bounded by an aggregate + LIMIT.
    const flows = country
      ? await identityWorkerQuery<FlowRow>(
          `SELECT from_country, to_country, SUM(n) AS n FROM mobility_flows
           WHERE (from_country = ? OR to_country = ?) AND year BETWEEN ? AND ?
           GROUP BY from_country, to_country ORDER BY n DESC LIMIT ?`,
          country, country, fromYear, toYear, limit
        )
      : await identityWorkerQuery<FlowRow>(
          `SELECT from_country, to_country, SUM(n) AS n FROM mobility_flows
           WHERE year BETWEEN ? AND ?
           GROUP BY from_country, to_country ORDER BY n DESC LIMIT ?`,
          fromYear, toYear, limit
        );

    const totals = await identityWorkerQuery<TotalsRow>(
      country
        ? `SELECT country, year, inflow, outflow, net FROM mobility_country_totals
           WHERE country = ? AND year BETWEEN ? AND ? ORDER BY year`
        : `SELECT country, SUM(inflow) AS inflow, SUM(outflow) AS outflow,
                  SUM(net) AS net, 0 AS year
           FROM mobility_country_totals WHERE year BETWEEN ? AND ?
           GROUP BY country ORDER BY ABS(SUM(net)) DESC LIMIT 25`,
      ...(country ? [country, fromYear, toYear] : [fromYear, toYear])
    );

    const totalMoves = flows.reduce((s, f) => s + f.n, 0);
    const payload = {
      flows,
      totals,
      totalMoves,
      // Denominator, not decoration: the charts must state what this covers.
      coverage: {
        source: "ORCID Public Data File 2025 (self-reported)",
        note:
          "Employment history covers 3,934,375 of 100,418,971 authors (3.9%); " +
          "skews young, Global-North and ORCID-adopting.",
      },
    };

    if (flows.length > 0) searchCaches.trends.set(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error, "trends/mobility");
  }
}
