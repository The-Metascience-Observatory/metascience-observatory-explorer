/**
 * In-memory LRU cache for search results
 *
 * With 24GB of free RAM, we can cache:
 * - Recent search queries and their results
 * - Frequently accessed search results
 * - Pagination data
 *
 * This dramatically speeds up repeat searches and common queries.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private ttlMs: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update access time and hit count
    entry.timestamp = Date.now();
    entry.hits++;
    this.hits++;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(key: string, data: T): void {
    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0
    });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  // Remove expired entries
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.cache.delete(key);
    }
  }
}

// Create separate caches for each search type
// Allocate ~10GB total for search caches (40% of available RAM)

// Paper search: most queries, largest dataset (250M papers)
// Cache 50,000 queries * ~50KB avg = ~2.5GB
const paperSearchCache = new LRUCache<unknown>(50000, 10 * 60 * 1000); // 10 min TTL

// Person search: 100M authors, complex name matching
// Cache 20,000 queries * ~30KB avg = ~600MB
const personSearchCache = new LRUCache<unknown>(20000, 10 * 60 * 1000);

// Journal search: 260K journals, smaller dataset
// Cache 10,000 queries * ~20KB avg = ~200MB
const journalSearchCache = new LRUCache<unknown>(10000, 15 * 60 * 1000);

// Affiliation search: 110K institutions
// Cache 10,000 queries * ~20KB avg = ~200MB
const affiliationSearchCache = new LRUCache<unknown>(10000, 15 * 60 * 1000);

// Funder search: smaller dataset
// Cache 5,000 queries * ~10KB avg = ~50MB
const funderSearchCache = new LRUCache<unknown>(5000, 15 * 60 * 1000);

// Clinical trials search
// Cache 5,000 queries * ~20KB avg = ~100MB
const trialSearchCache = new LRUCache<unknown>(5000, 15 * 60 * 1000);

// Trends aggregates: a bounded set of precomputed-rollup views plus country
// drill-downs. Its own cache so trends traffic can never evict paper-search
// results, and a long TTL because the rollups only change on reimport.
// Cache 2,000 views * ~40KB avg = ~80MB
const trendsCache = new LRUCache<unknown>(2000, 60 * 60 * 1000); // 1 hour TTL

// Export cache instances
export const searchCaches = {
  trends: trendsCache,
  papers: paperSearchCache,
  persons: personSearchCache,
  journals: journalSearchCache,
  affiliations: affiliationSearchCache,
  funders: funderSearchCache,
  trials: trialSearchCache
};

// Helper to generate cache key from search params
export function generateCacheKey(query: string, params?: Record<string, string | number>): string {
  const baseKey = query.toLowerCase().trim();
  if (!params || Object.keys(params).length === 0) {
    return baseKey;
  }

  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');

  return `${baseKey}::${paramStr}`;
}

// Cleanup expired entries every 5 minutes.
// Iterate searchCaches rather than listing the caches: the hand-written list
// silently omitted `trends` when it was added, so its entries were never swept.
setInterval(() => {
  for (const cache of Object.values(searchCaches)) cache.cleanup();
}, 5 * 60 * 1000);

// API endpoint to get cache stats (for monitoring)
export function getAllCacheStats(): Record<string, ReturnType<LRUCache<unknown>["getStats"]>> {
  return Object.fromEntries(
    Object.entries(searchCaches).map(([name, cache]) => [name, cache.getStats()])
  );
}

// Clear all caches (useful for debugging or manual refresh)
export function clearAllCaches(): void {
  for (const cache of Object.values(searchCaches)) cache.clear();
}
