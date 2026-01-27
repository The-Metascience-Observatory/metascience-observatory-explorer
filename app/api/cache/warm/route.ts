import { NextResponse } from "next/server";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery } from "@/lib/worker-pool";

/**
 * Cache warming endpoint - preloads common searches into memory
 * Called automatically on server startup
 */

// Common search terms to pre-warm (based on likely user queries)
const COMMON_PAPER_QUERIES = [
  "machine learning", "deep learning", "artificial intelligence", "neural network",
  "covid", "cancer", "diabetes", "alzheimer", "parkinson",
  "climate change", "renewable energy", "sustainability",
  "quantum", "graphene", "crispr", "genomics", "proteomics",
  "immunotherapy", "vaccine", "antibody", "inflammation",
  "psychology", "depression", "anxiety", "cognitive",
  "economics", "finance", "market", "policy",
];

const COMMON_PERSON_QUERIES = [
  "smith", "johnson", "wang", "zhang", "li", "chen", "kumar", "kim",
  "brown", "wilson", "moore", "taylor", "anderson", "thomas", "jackson",
];

const COMMON_JOURNAL_QUERIES = [
  "nature", "science", "cell", "lancet", "nejm", "jama", "bmj",
  "plos", "frontiers", "ieee", "acm", "acs", "rsc", "wiley",
  "springer", "elsevier", "oxford", "cambridge",
];

const COMMON_AFFILIATION_QUERIES = [
  "harvard", "stanford", "mit", "berkeley", "oxford", "cambridge",
  "yale", "princeton", "columbia", "chicago", "caltech",
  "max planck", "nih", "cdc", "who",
];

export async function POST() {
  const startTime = Date.now();
  const results = {
    papers: { cached: 0, errors: 0 },
    persons: { cached: 0, errors: 0 },
    journals: { cached: 0, errors: 0 },
    affiliations: { cached: 0, errors: 0 },
  };

  try {
    // Warm paper search cache
    for (const query of COMMON_PAPER_QUERIES) {
      try {
        const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(' ');
        const cacheKey = generateCacheKey(ftsQuery, { offset: 0, limit: 50 });

        if (!searchCaches.papers.has(cacheKey)) {
          const sql = `
            SELECT p.paperid, p.title, p.doi, p.year, p.cited_by_count, p.source_name
            FROM paper_title_fts f
            JOIN paper_summary p ON f.paperid = p.paperid
            WHERE paper_title_fts MATCH ?
            ORDER BY p.cited_by_count DESC NULLS LAST
            LIMIT 51 OFFSET 0
          `;
          const rawResults = await workerQuery<Record<string, unknown>>(sql, ftsQuery);
          const hasMore = rawResults.length > 50;
          if (hasMore) rawResults.pop();

          searchCaches.papers.set(cacheKey, {
            results: rawResults,
            total: hasMore ? -1 : rawResults.length,
            offset: 0,
            limit: 50,
            hasMore
          });
          results.papers.cached++;
        }
      } catch {
        results.papers.errors++;
      }
    }

    // Warm person search cache (using FTS if available)
    for (const query of COMMON_PERSON_QUERIES) {
      try {
        const ftsQuery = `"${query}"*`;
        const cacheKey = generateCacheKey(ftsQuery, { offset: 0, limit: 50 });

        if (!searchCaches.persons.has(cacheKey)) {
          const sql = `
            SELECT p.authorid, p.display_name, p.orcid, p.last_known_institution, p.h_index, p.productivity
            FROM person_fts f
            JOIN person_summary p ON f.authorid = p.authorid
            WHERE person_fts MATCH ?
            ORDER BY p.h_index DESC NULLS LAST
            LIMIT 50
          `;
          const rawResults = await workerQuery<Record<string, unknown>>(sql, ftsQuery);

          searchCaches.persons.set(cacheKey, {
            results: rawResults,
            total: rawResults.length,
            offset: 0,
            limit: 50,
            hasMore: false
          });
          results.persons.cached++;
        }
      } catch {
        results.persons.errors++;
      }
    }

    // Warm journal search cache
    for (const query of COMMON_JOURNAL_QUERIES) {
      try {
        const cacheKey = generateCacheKey(query);

        if (!searchCaches.journals.has(cacheKey)) {
          const searchPattern = `%${query}%`;
          const sql = `
            SELECT sourceid, display_name, issn, publisher, homepage_url, is_oa,
                   total_papers, total_citations, first_year, last_year,
                   primary_field_l0_id, primary_field_l0_name, primary_field_l1_id, primary_field_l1_name
            FROM journal_summary
            WHERE LOWER(display_name) LIKE LOWER(?)
               OR LOWER(issn) LIKE LOWER(?)
               OR LOWER(publisher) LIKE LOWER(?)
            ORDER BY total_papers DESC NULLS LAST
            LIMIT 50
          `;
          const rawResults = await workerQuery<Record<string, unknown>>(sql, searchPattern, searchPattern, searchPattern);

          searchCaches.journals.set(cacheKey, { results: rawResults });
          results.journals.cached++;
        }
      } catch {
        results.journals.errors++;
      }
    }

    // Warm affiliation search cache
    for (const query of COMMON_AFFILIATION_QUERIES) {
      try {
        const cacheKey = generateCacheKey(query);

        if (!searchCaches.affiliations.has(cacheKey)) {
          const searchPattern = `%${query}%`;
          const sql = `
            SELECT institution_id, display_name, country_code, type, ror, homepage_url,
                   h_index, productivity, total_citations, researcher_count, first_year, last_year
            FROM affiliation_summary
            WHERE LOWER(display_name) LIKE LOWER(?)
               OR LOWER(country_code) LIKE LOWER(?)
               OR LOWER(type) LIKE LOWER(?)
            ORDER BY h_index DESC NULLS LAST
            LIMIT 50
          `;
          const rawResults = await workerQuery<Record<string, unknown>>(sql, searchPattern, searchPattern, searchPattern);

          searchCaches.affiliations.set(cacheKey, { results: rawResults });
          results.affiliations.cached++;
        }
      } catch {
        results.affiliations.errors++;
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      results,
      message: "Cache warming complete"
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      results
    }, { status: 500 });
  }
}

// Also allow GET for easy testing
export async function GET() {
  return POST();
}
