import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;
let cacheDb: Database.Database | null = null;
let abstractsDb: Database.Database | null = null;
let papersExtraDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), "data", "journals.db");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
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

// Helper to check if database exists and is accessible
export function isDatabaseAvailable(): boolean {
  try {
    const dbPath = path.join(process.cwd(), "data", "journals.db");
    const testDb = new Database(dbPath, { readonly: true });
    testDb.close();
    return true;
  } catch {
    return false;
  }
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
