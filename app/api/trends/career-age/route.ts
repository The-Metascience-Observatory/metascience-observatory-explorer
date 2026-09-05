import { NextRequest, NextResponse } from "next/server";
import { identityWorkerQuery } from "@/lib/worker-pool";
import { errorResponse } from "@/lib/api-utils";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";

interface CareerAgeRow {
  career_age: number;
  n_authors: number;
  median_works: number | null;
  median_citations: number | null;
}

interface PhdYearRow {
  phd_year: number;
  n_authors: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Authors with very few peers in a bucket produce noisy medians; the floor is
  // adjustable but defaults high enough to keep the curve meaningful.
  const minAuthors = parseInt(searchParams.get("minAuthors") ?? "50", 10);

  const cacheKey = generateCacheKey("trends:career-age", { minAuthors });
  const cached = searchCaches.trends.get(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const [careerAge, phdYears] = await Promise.all([
      identityWorkerQuery<CareerAgeRow>(
        `SELECT career_age, n_authors, median_works, median_citations
         FROM career_age_stats WHERE n_authors >= ? ORDER BY career_age`,
        isNaN(minAuthors) ? 50 : minAuthors
      ),
      identityWorkerQuery<PhdYearRow>(
        `SELECT phd_year, n_authors FROM phd_year_stats ORDER BY phd_year`
      ),
    ]);

    const payload = {
      careerAge,
      phdYears,
      totalAuthors: careerAge.reduce((s, r) => s + r.n_authors, 0),
      coverage: {
        source: "ORCID Public Data File 2025 (self-reported)",
        note:
          "Career age = last publication year minus self-reported doctorate year. " +
          "Only the 1,327,875 authors who state a doctorate are included, of " +
          "100,418,971 total. Values are LIFETIME cumulative works, not a per-year rate.",
      },
    };

    if (careerAge.length > 0) searchCaches.trends.set(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error, "trends/career-age");
  }
}
