import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let db: Database.Database | null = null;
let cacheDb: Database.Database | null = null;
let abstractsDb: Database.Database | null = null;
let papersExtraDb: Database.Database | null = null;
let retractionsDb: Database.Database | null = null;
let meshDb: Database.Database | null = null;
let openaireDb: Database.Database | null = null;
let openaireAbstractsDb: Database.Database | null = null;
let openaireCitationsDb: Database.Database | null = null;
let identityDb: Database.Database | null = null;
let pubmedDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), "data", "journals.db");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Performance tuning for 24GB+ RAM systems
    // Allocate 8GB cache for this database (1/3 of available RAM)
    db.pragma('cache_size = -8000000'); // Negative = KB, so -8000000 = 8GB
    db.pragma('mmap_size = 8589934592'); // 8GB memory-mapped I/O
    db.pragma('temp_store = MEMORY'); // Use RAM for temporary tables
    db.pragma('synchronous = NORMAL'); // Faster with acceptable safety (readonly anyway)
    db.pragma('journal_mode = WAL'); // Better concurrency
  }
  return db;
}

// Get a writable database for caching (separate from main readonly db)
export function getCacheDb(): Database.Database {
  if (!cacheDb) {
    const dbPath = path.join(process.cwd(), "data", "cache.db");
    cacheDb = new Database(dbPath);

    // Initialize grant cache table if it doesn't exist
    cacheDb.exec(`
      CREATE TABLE IF NOT EXISTS grant_cache (
        award_id TEXT PRIMARY KEY,
        funder_type TEXT NOT NULL,
        response_json TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      )
    `);

    // Create index on cached_at for TTL cleanup
    cacheDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_grant_cache_cached_at ON grant_cache(cached_at)
    `);

    // Initialize ORCID cache table
    cacheDb.exec(`
      CREATE TABLE IF NOT EXISTS orcid_cache (
        orcid TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      )
    `);
  }
  return cacheDb;
}

// Cache TTL: 365 days in milliseconds
const GRANT_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// ORCID cache TTL: 90 days (education/employment changes less frequently)
const ORCID_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Get cached grant details
export function getCachedGrant(awardId: string): { data: unknown; cached_at: number } | null {
  try {
    const db = getCacheDb();
    const row = db.prepare(
      'SELECT response_json, cached_at FROM grant_cache WHERE award_id = ?'
    ).get(awardId) as { response_json: string; cached_at: number } | undefined;

    if (!row) return null;

    // Check if cache is expired
    if (Date.now() - row.cached_at > GRANT_CACHE_TTL_MS) {
      // Delete expired entry
      db.prepare('DELETE FROM grant_cache WHERE award_id = ?').run(awardId);
      return null;
    }

    return { data: JSON.parse(row.response_json), cached_at: row.cached_at };
  } catch {
    return null;
  }
}

// Cache grant details
export function setCachedGrant(awardId: string, funderType: string, data: unknown): void {
  try {
    const db = getCacheDb();
    db.prepare(`
      INSERT OR REPLACE INTO grant_cache (award_id, funder_type, response_json, cached_at)
      VALUES (?, ?, ?, ?)
    `).run(awardId, funderType, JSON.stringify(data), Date.now());
  } catch (error) {
    console.error('Failed to cache grant:', error);
  }
}

// Get multiple cached grants at once
export function getCachedGrants(awardIds: string[]): Map<string, unknown> {
  const results = new Map<string, unknown>();
  if (awardIds.length === 0) return results;

  try {
    const db = getCacheDb();
    const placeholders = awardIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT award_id, response_json, cached_at FROM grant_cache WHERE award_id IN (${placeholders})`
    ).all(...awardIds) as Array<{ award_id: string; response_json: string; cached_at: number }>;

    const now = Date.now();
    const expiredIds: string[] = [];

    for (const row of rows) {
      if (now - row.cached_at > GRANT_CACHE_TTL_MS) {
        expiredIds.push(row.award_id);
      } else {
        results.set(row.award_id, JSON.parse(row.response_json));
      }
    }

    // Clean up expired entries
    if (expiredIds.length > 0) {
      const expiredPlaceholders = expiredIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM grant_cache WHERE award_id IN (${expiredPlaceholders})`).run(...expiredIds);
    }
  } catch (error) {
    console.error('Failed to read grant cache:', error);
  }

  return results;
}

// Get abstracts database (separate from main db for performance)
export function getAbstractsDb(): Database.Database | null {
  if (abstractsDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "abstracts.db");
      abstractsDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // abstracts.db may not exist in dev environments - return null
      return null;
    }
  }
  return abstractsDb;
}

// Get papers extra database (newsfeed mentions, PMID/PMCID)
export function getPapersExtraDb(): Database.Database | null {
  if (papersExtraDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "papers_extra.db");
      papersExtraDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // papers_extra.db may not exist in dev environments - return null
      return null;
    }
  }
  return papersExtraDb;
}

// Get retractions database (Retraction Watch data)
export function getRetractionsDb(): Database.Database | null {
  if (retractionsDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "retractions.db");
      retractionsDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // retractions.db may not exist - return null
      return null;
    }
  }
  return retractionsDb;
}

// Get MeSH database (MeSH terms, PMID mappings, precomputed stats)
export function getMeshDb(): Database.Database | null {
  if (meshDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "mesh.db");
      meshDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // mesh.db may not exist - return null
      return null;
    }
  }
  return meshDb;
}

// Get PubMed database (publication types, grant links, databank accessions
// from the MEDLINE annual baseline). Optional, like mesh/retractions.
export function getPubmedDb(): Database.Database | null {
  if (pubmedDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "pubmed.db");
      pubmedDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // pubmed.db may not exist - return null
      return null;
    }
  }
  return pubmedDb;
}

// Get identity database (ORCID-derived career trajectories: employment,
// education, mobility and career-age rollups). Optional, like mesh/retractions.
export function getIdentityDb(): Database.Database | null {
  if (identityDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "identity.db");
      identityDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // identity.db may not exist - return null
      return null;
    }
  }
  return identityDb;
}

// Get OpenAIRE Graph database (projects/grants, OA status, linked products, orgs)
export function getOpenaireDb(): Database.Database | null {
  if (openaireDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "openaire.db");
      openaireDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // openaire.db may not exist - return null
      return null;
    }
  }
  return openaireDb;
}

// Get OpenAIRE abstracts database (abstracts for first-class OpenAIRE papers)
export function getOpenaireAbstractsDb(): Database.Database | null {
  if (openaireAbstractsDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "openaire_abstracts.db");
      openaireAbstractsDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // openaire_abstracts.db may not exist - return null
      return null;
    }
  }
  return openaireAbstractsDb;
}

// Get OpenAIRE citation database (BiP! impact indicators + packed citation edges).
//
// Built by scripts/openaire_import_citation_counts.py and openaire_pack_citations.py.
// Small enough (~3-13GB) to query on the main thread: every read is a single
// INTEGER PRIMARY KEY or WITHOUT ROWID PK seek. Resolving the resulting neighbor
// ids to titles is NOT - that must go through the worker pools (see
// lib/openaire-citations.ts).
export function getOpenaireCitationsDb(): Database.Database | null {
  if (openaireCitationsDb === null) {
    try {
      const dbPath = path.join(process.cwd(), "data", "openaire_citations.db");
      openaireCitationsDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      // openaire_citations.db may not exist - return null.
      // Note this retries the open on every call while the file is absent, which
      // is what lets the DB go live without a server restart once it's dropped in.
      return null;
    }
  }
  return openaireCitationsDb;
}

// Helper to check if database exists and is accessible.
//
// Memoized: this is called by every detail API route on every request, and it
// used to open and close a fresh Database handle each time. Under SSR that
// lands on the render path. The database file is mounted for the life of the
// process, so one check is enough.
let databaseAvailable: boolean | null = null;

export function isDatabaseAvailable(): boolean {
  if (databaseAvailable === null) {
    databaseAvailable = fs.existsSync(path.join(process.cwd(), "data", "journals.db"));
  }
  return databaseAvailable;
}

// Helper to detect SQLite busy errors (database locked)
export function isSqliteBusyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code: string }).code === "SQLITE_BUSY"
  );
}

// Get cached ORCID data
export function getCachedOrcid(orcid: string): { data: unknown; cached_at: number } | null {
  try {
    const db = getCacheDb();
    const row = db.prepare(
      'SELECT response_json, cached_at FROM orcid_cache WHERE orcid = ?'
    ).get(orcid) as { response_json: string; cached_at: number } | undefined;

    if (!row) return null;

    // Check if cache is expired
    if (Date.now() - row.cached_at > ORCID_CACHE_TTL_MS) {
      db.prepare('DELETE FROM orcid_cache WHERE orcid = ?').run(orcid);
      return null;
    }

    return { data: JSON.parse(row.response_json), cached_at: row.cached_at };
  } catch {
    return null;
  }
}

// Cache ORCID data
export function setCachedOrcid(orcid: string, data: unknown): void {
  try {
    const db = getCacheDb();
    db.prepare(`
      INSERT OR REPLACE INTO orcid_cache (orcid, response_json, cached_at)
      VALUES (?, ?, ?)
    `).run(orcid, JSON.stringify(data), Date.now());
  } catch (error) {
    console.error('Failed to cache ORCID data:', error);
  }
}

// Analytics database for visitor tracking
let analyticsDb: Database.Database | null = null;

export function getAnalyticsDb(): Database.Database {
  if (!analyticsDb) {
    const dbPath = path.join(process.cwd(), "data", "analytics.db");
    analyticsDb = new Database(dbPath);

    // Initialize visitor_logs table
    analyticsDb.exec(`
      CREATE TABLE IF NOT EXISTS visitor_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        path TEXT NOT NULL,
        user_agent TEXT,
        country TEXT,
        city TEXT,
        lat REAL,
        lon REAL,
        os TEXT,
        device_type TEXT,
        browser TEXT
      )
    `);

    // Indexes for efficient querying
    analyticsDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_visitor_timestamp ON visitor_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_visitor_ip ON visitor_logs(ip);
      CREATE INDEX IF NOT EXISTS idx_visitor_country ON visitor_logs(country);
    `);

    // IP geolocation cache table
    analyticsDb.exec(`
      CREATE TABLE IF NOT EXISTS ip_geo_cache (
        ip TEXT PRIMARY KEY,
        country TEXT,
        city TEXT,
        lat REAL,
        lon REAL,
        timezone TEXT,
        cached_at INTEGER NOT NULL
      )
    `);

    // Migration: add timezone column if missing
    try {
      analyticsDb.exec(`ALTER TABLE ip_geo_cache ADD COLUMN timezone TEXT`);
    } catch {
      // Column already exists
    }
  }
  return analyticsDb;
}
