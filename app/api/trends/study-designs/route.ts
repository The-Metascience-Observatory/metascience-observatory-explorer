import { NextRequest, NextResponse } from "next/server";
import { pubmedWorkerQuery } from "@/lib/worker-pool";
import { errorResponse } from "@/lib/api-utils";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";

interface DesignRow {
  year: number;
  type_name: string;
  n: number;
  year_total: number;
}

// The evidence-hierarchy set. Everything else in paper_pubtypes is a cataloguing or
// funding flag -- "Research Support, Non-U.S. Gov't" is 16% of all articles, "English
// Abstract" 3% -- and plotting those on a study-design chart would misrepresent it.
// They stay queryable in the DB; they just never reach this endpoint.
const DESIGNS = [
  "Randomized Controlled Trial",
  "Systematic Review",
  "Meta-Analysis",
  "Clinical Trial",
  "Observational Study",
  "Comparative Study",
  "Case Reports",
  "Review",
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fromYear = parseInt(searchParams.get("fromYear") ?? "1960", 10);
  const toYear = parseInt(searchParams.get("toYear") ?? "2024", 10);

  if (isNaN(fromYear) || isNaN(toYear) || fromYear > toYear) {
    return NextResponse.json({ error: "invalid year range" }, { status: 400 });
  }

  const cacheKey = generateCacheKey("trends:study-designs", { fromYear, toYear });
  const cached = searchCaches.trends.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const placeholders = DESIGNS.map(() => "?").join(",");
    const rows = await pubmedWorkerQuery<DesignRow>(
      `SELECT d.year, t.type_name, d.n, d.year_total
       FROM design_stats d JOIN pubtype_terms t USING(type_ui)
       WHERE t.type_name IN (${placeholders}) AND d.year BETWEEN ? AND ?
       ORDER BY d.year, t.type_name`,
      ...DESIGNS,
      fromYear,
      toYear
    );

    // Pivot to one object per year. year_total travels with every point so the UI
    // cannot render a share without the base it was computed from.
    const byYear = new Map<number, Record<string, number>>();
    for (const r of rows) {
      let e = byYear.get(r.year);
      if (!e) {
        e = { year: r.year, total: r.year_total };
        byYear.set(r.year, e);
      }
      e[r.type_name] = r.n;
    }
    const series = [...byYear.values()].sort((a, b) => a.year - b.year);

    const payload = {
      series,
      designs: DESIGNS,
      totalArticles: series.reduce((s, y) => s + (y.total ?? 0), 0),
      coverage: {
        source: "PubMed/MEDLINE 2026 annual baseline",
        note:
          "PubMed-indexed biomedical literature only — roughly 31M of 250M papers, " +
          "not all of science. Publication types are assigned by NLM indexers and " +
          "indexing practice has changed over time, so part of any trend reflects " +
          "cataloguing rather than research.",
      },
    };

    if (series.length > 0) searchCaches.trends.set(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error, "trends/study-designs");
  }
}
