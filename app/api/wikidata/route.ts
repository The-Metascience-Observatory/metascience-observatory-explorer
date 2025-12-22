import { NextRequest, NextResponse } from "next/server";
import { getCacheDb } from "@/lib/db";
import { errorResponse, fetchWithTimeout } from "@/lib/api-utils";

interface WikidataResult {
  wikidata_id: string | null;
  wikipedia_url: string | null;
  birth_date: string | null;
  death_date: string | null;
  image_url: string | null;
  description: string | null;
  scopus_id: string | null;
  researcher_id: string | null;
  twitter_username: string | null;
  cached_at: string | null;
}

interface WikidataCacheRow {
  orcid: string;
  wikidata_id: string | null;
  wikipedia_url: string | null;
  birth_date: string | null;
  death_date: string | null;
  image_url: string | null;
  description: string | null;
  scopus_id: string | null;
  researcher_id: string | null;
  twitter_username: string | null;
  cached_at: string;
}

/**
 * Sanitize ORCID for safe use in SPARQL query.
 * ORCID format: 0000-0000-0000-0000 (with optional X at end)
 * This function ensures only valid ORCID characters are included.
 */
function sanitizeOrcid(orcid: string): string {
  // Remove URL prefix if present
  const cleaned = orcid.replace(/^https?:\/\/orcid\.org\//, "");
  // Only allow digits, hyphens, and X (for checksum)
  return cleaned.replace(/[^0-9\-X]/gi, '');
}

// SPARQL query to get person info by ORCID
// Wikidata properties: P496=ORCID, P569=birth, P570=death, P18=image, P1153=Scopus, P1053=ResearcherID, P2002=Twitter
function buildSparqlQuery(orcid: string): string {
  // Sanitize ORCID to prevent SPARQL injection
  const cleanOrcid = sanitizeOrcid(orcid);

  return `
    SELECT ?item ?itemLabel ?itemDescription ?birthDate ?deathDate ?image ?article ?scopusId ?researcherId ?twitterUsername WHERE {
      ?item wdt:P496 "${cleanOrcid}" .
      OPTIONAL { ?item wdt:P569 ?birthDate . }
      OPTIONAL { ?item wdt:P570 ?deathDate . }
      OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?item wdt:P1153 ?scopusId . }
      OPTIONAL { ?item wdt:P1053 ?researcherId . }
      OPTIONAL { ?item wdt:P2002 ?twitterUsername . }
      OPTIONAL {
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
    }
    LIMIT 1
  `;
}

// Ensure cache table exists with all columns
function ensureCacheTable(db: ReturnType<typeof getCacheDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wikidata_cache (
      orcid TEXT PRIMARY KEY,
      wikidata_id TEXT,
      wikipedia_url TEXT,
      birth_date TEXT,
      death_date TEXT,
      image_url TEXT,
      description TEXT,
      scopus_id TEXT,
      researcher_id TEXT,
      twitter_username TEXT,
      cached_at TEXT NOT NULL
    )
  `);
  // Add new columns if they don't exist (for existing tables)
  try { db.exec(`ALTER TABLE wikidata_cache ADD COLUMN scopus_id TEXT`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE wikidata_cache ADD COLUMN researcher_id TEXT`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE wikidata_cache ADD COLUMN twitter_username TEXT`); } catch { /* column exists */ }
}

// Check cache (valid for 30 days)
function getCachedResult(db: ReturnType<typeof getCacheDb>, orcid: string): WikidataResult | null {
  const cleanOrcid = orcid.replace(/^https?:\/\/orcid\.org\//, "");

  try {
    const row = db.prepare(`
      SELECT * FROM wikidata_cache
      WHERE orcid = ?
      AND datetime(cached_at) > datetime('now', '-30 days')
    `).get(cleanOrcid) as WikidataCacheRow | undefined;

    if (row) {
      return {
        wikidata_id: row.wikidata_id,
        wikipedia_url: row.wikipedia_url,
        birth_date: row.birth_date,
        death_date: row.death_date,
        image_url: row.image_url,
        description: row.description,
        scopus_id: row.scopus_id,
        researcher_id: row.researcher_id,
        twitter_username: row.twitter_username,
        cached_at: row.cached_at,
      };
    }
  } catch {
    // Table might not exist yet
  }
  return null;
}

// Save to cache
function saveToCache(db: ReturnType<typeof getCacheDb>, orcid: string, result: WikidataResult): void {
  const cleanOrcid = orcid.replace(/^https?:\/\/orcid\.org\//, "");

  try {
    ensureCacheTable(db);
    db.prepare(`
      INSERT OR REPLACE INTO wikidata_cache
      (orcid, wikidata_id, wikipedia_url, birth_date, death_date, image_url, description, scopus_id, researcher_id, twitter_username, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      cleanOrcid,
      result.wikidata_id,
      result.wikipedia_url,
      result.birth_date,
      result.death_date,
      result.image_url,
      result.description,
      result.scopus_id,
      result.researcher_id,
      result.twitter_username
    );
  } catch (error) {
    console.error("Failed to cache Wikidata result:", error);
  }
}

// Fetch from Wikidata SPARQL endpoint
async function fetchFromWikidata(orcid: string): Promise<WikidataResult> {
  const query = buildSparqlQuery(orcid);
  const endpoint = "https://query.wikidata.org/sparql";

  const response = await fetchWithTimeout(`${endpoint}?query=${encodeURIComponent(query)}`, {
    headers: {
      "Accept": "application/sparql-results+json",
      "User-Agent": "SciSciNet-Dashboard/1.0 (https://metascienceobservatory.org; contact@metascienceobservatory.org)",
    },
  }, 10000);

  if (!response.ok) {
    throw new Error(`Wikidata API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.results?.bindings?.length) {
    return {
      wikidata_id: null,
      wikipedia_url: null,
      birth_date: null,
      death_date: null,
      image_url: null,
      description: null,
      scopus_id: null,
      researcher_id: null,
      twitter_username: null,
      cached_at: null,
    };
  }

  const binding = data.results.bindings[0];

  // Extract Wikidata ID from URI (e.g., "http://www.wikidata.org/entity/Q937" -> "Q937")
  const wikidataUri = binding.item?.value || "";
  const wikidataId = wikidataUri.split("/").pop() || null;

  // Format dates (Wikidata returns ISO format like "1879-03-14T00:00:00Z")
  const formatDate = (dateStr: string | undefined): string | null => {
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    // Handle year-only dates
    const yearMatch = dateStr.match(/^(\d{4})/);
    if (yearMatch) {
      return yearMatch[1];
    }
    return null;
  };

  return {
    wikidata_id: wikidataId,
    wikipedia_url: binding.article?.value || null,
    birth_date: formatDate(binding.birthDate?.value),
    death_date: formatDate(binding.deathDate?.value),
    image_url: binding.image?.value || null,
    description: binding.itemDescription?.value || null,
    scopus_id: binding.scopusId?.value || null,
    researcher_id: binding.researcherId?.value || null,
    twitter_username: binding.twitterUsername?.value || null,
    cached_at: null,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const orcid = searchParams.get("orcid");

  if (!orcid) {
    return NextResponse.json(
      { error: "ORCID parameter required" },
      { status: 400 }
    );
  }

  // Clean the ORCID
  const cleanOrcid = orcid.replace(/^https?:\/\/orcid\.org\//, "");

  // Validate ORCID format (should be like 0000-0003-1829-7482)
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(cleanOrcid)) {
    return NextResponse.json(
      { error: "Invalid ORCID format" },
      { status: 400 }
    );
  }

  try {
    // Check cache first
    const cacheDb = getCacheDb();
    const cached = getCachedResult(cacheDb, cleanOrcid);
    if (cached) {
      return NextResponse.json({ ...cached, fromCache: true });
    }

    // Fetch from Wikidata
    const result = await fetchFromWikidata(cleanOrcid);

    // Cache the result (even if empty, to avoid repeated lookups)
    saveToCache(cacheDb, cleanOrcid, result);

    return NextResponse.json({ ...result, fromCache: false });
  } catch (error) {
    return errorResponse(error, "wikidata");
  }
}
