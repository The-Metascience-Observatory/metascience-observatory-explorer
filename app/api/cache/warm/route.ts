import { NextResponse } from "next/server";
import { searchCaches, generateCacheKey } from "@/lib/search-cache";
import { workerQuery, openaireWorkerQuery, getOpenaireWorkerPool } from "@/lib/worker-pool";
import { getOpenaireCitationsDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

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

const OPENAIRE_WARM_TIMEOUT_MS = 10000;

// The paper search route appends OpenAIRE first-class papers to the first page
// and caches the COMBINED payload under the same key we write here. Warming with
// SciSciNet-only rows would poison that cache: warmed queries would show no
// OpenAIRE results until the TTL expired. So warm the OpenAIRE leg too — which
// doubles as page-cache warming for the cold 47GB openaire.db FTS.
// Returns [] when OpenAIRE is genuinely unavailable, or null when the answer is
// unknown (slow/errored) so the caller can leave the key unwarmed instead.
async function warmOpenairePapers(
  ftsQuery: string
): Promise<Record<string, unknown>[] | null> {
  // Missing openaire.db isn't an error — the search route would also return
  // SciSciNet-only results, so caching those is correct.
  if (!getOpenaireWorkerPool()) return [];

  // Exact-token MATCH: the openaire FTS has no prefix indexes, so prefix terms
  // must be stripped (mirrors app/api/papers/search/route.ts).
  const openaireFtsQuery = ftsQuery.replaceAll('"*', '"').replaceAll("*", "");
  if (!openaireFtsQuery) return [];

  const sql = `
    SELECT p.id AS paperid, p.title, p.doi, p.year,
           NULL AS cited_by_count, p.journal_name AS source_name
    FROM openaire_title_fts f
    JOIN openaire_papers p ON p.rowid = f.rowid
    WHERE openaire_title_fts MATCH ?
    ORDER BY rank
    LIMIT 10
  `;

  // Warming runs in the background, so it can wait far longer than the search
  // route's 2s guard — but never indefinitely.
  const raced = await Promise.race([
    openaireWorkerQuery<Record<string, unknown>>(sql, openaireFtsQuery).then(
      (rows) => ({ rows })
    ),
    new Promise<{ rows: null }>((resolve) =>
      setTimeout(() => resolve({ rows: null }), OPENAIRE_WARM_TIMEOUT_MS)
    ),
  ]).catch(() => ({ rows: null }));

  // Touch the BIP! impact table for these hits too. The search route does the
  // same lookup per query, and a cold openaire_citations.db can otherwise trip
  // its 2s race on the first few requests after a deploy.
  if (raced.rows?.length) {
    try {
      const cdb = getOpenaireCitationsDb();
      const ids = raced.rows
        .map((r) => r.paperid)
        .filter((v): v is string => typeof v === "string");
      if (cdb && ids.length) {
        cdb
          .prepare(
            `SELECT id FROM openaire_paper_impact WHERE id IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids);
      }
    } catch {
      // impact table is optional
    }
  }

  return raced.rows;
}

/**
 * Cache warming is expensive — ~78 FTS/LIKE queries over 250M papers plus an
 * OpenAIRE pass with a 10s budget each; scripts/start-with-cache.sh notes it
 * "takes minutes". It was previously reachable by anyone, with a GET alias, so
 * a single curl could trigger minutes of server work.
 *
 * Two guards now. Loopback-only, matching the loopback branch in middleware.ts:
 * the only legitimate caller is the start script curling localhost. And a
 * module-level in-flight promise, because the `searchCaches.has()` checks inside
 * do not stop concurrent callers from all missing and all executing.
 */
function isLoopback(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  // Behind Cloudflare these are always set, so their presence means the request
  // arrived over the tunnel rather than from the box itself.
  return !request.headers.get("cf-connecting-ip") && !request.headers.get("x-forwarded-for");
}

let inFlight: Promise<NextResponse> | null = null;

export async function POST(request: Request) {
  if (!isLoopback(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (inFlight) return inFlight;
  inFlight = warmCaches().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function warmCaches(): Promise<NextResponse> {
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

          const openaireResults = await warmOpenairePapers(ftsQuery);
          if (openaireResults === null) {
            // Too slow or errored — leave this key unwarmed so the first real
            // request builds the correct combined response.
            results.papers.errors++;
            continue;
          }

          // Same shape the search route produces: OpenAIRE rows appended after
          // SciSciNet's (they have no citation counts to rank by).
          const combined = rawResults.concat(
            openaireResults.map((r) => ({ ...r, openaire: true }))
          );

          searchCaches.papers.set(cacheKey, {
            results: combined,
            total: hasMore ? -1 : combined.length,
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
    // Was returning error.message verbatim, which leaks table names and
    // absolute container paths out of SQLite errors.
    return errorResponse(error, "cache/warm");
  }
}

