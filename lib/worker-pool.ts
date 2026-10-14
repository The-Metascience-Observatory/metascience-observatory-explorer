/**
 * Worker Pool for non-blocking SQLite queries
 *
 * Creates a pool of worker threads, each with its own database connection.
 * Queries are distributed across workers using round-robin, allowing
 * multiple queries to run truly in parallel without blocking the main thread.
 */

import { Worker } from 'worker_threads';
import path from 'path';

interface PendingQuery {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Which worker this was dispatched to, so its failure can settle it. */
  workerIndex: number;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerWrapper {
  worker: Worker | null;
  ready: boolean;
  /** Queries dispatched to this worker and not yet settled. */
  inFlight: number;
  spawnedAt: number;
}

interface PoolOptions {
  dbPath?: string;      // defaults to data/journals.db
  cacheSize?: number;   // SQLite cache_size pragma (negative = KB)
  mmapSize?: number;    // SQLite mmap_size pragma (bytes)
  /** Reject a query after this long and replace the worker running it. */
  queryTimeoutMs?: number;
  /** Reject immediately once this many queries are outstanding pool-wide. */
  maxInFlight?: number;
}

/**
 * better-sqlite3 is synchronous inside the worker, so a slow statement wedges
 * that whole thread and cannot be cancelled. The only recovery is to stop
 * waiting and terminate the thread, which is what the timeout does.
 *
 * 60s is sized from measurement, and it is a ceiling around a known pathology
 * rather than an endorsement of it. Cold paper searches for very common terms
 * are genuinely slow: "cancer" and "brain" at the UI's limit=50 measured 14.4s
 * and 13.6s, the underlying FTS-join-sort takes 21.8s run directly, and a cold
 * `?q=cancer&limit=5` took 44.0s end to end. A 30s budget turned that into a
 * 500 and 45s left a one-second margin, so neither is safe.
 *
 * The point of the timeout is to convert an unbounded hang into a bounded
 * failure, not to police latency. A 44s search is its own bug — the query sorts
 * the entire FTS match set by cited_by_count, which for a common term means
 * joining millions of rows to paper_summary — and it wants a precomputed
 * ranking, not a larger number here.
 */
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
/**
 * Past this many outstanding queries pool-wide, fail fast rather than queueing.
 *
 * Normal queries settle in single-digit milliseconds, so this is never reached
 * by legitimate traffic; it is the ceiling that stops a slow-query flood from
 * building a backlog nothing can work through. Deliberately not generous: with
 * four workers that is 64 outstanding, so a flood fails quickly instead of
 * accumulating hundreds of requests that each wait out the timeout.
 */
const DEFAULT_MAX_IN_FLIGHT_PER_WORKER = 16;
/** Don't respawn in a tight loop when the database itself is the problem. */
const RESPAWN_DELAY_MS = 2_000;
const MAX_CONSECUTIVE_SPAWN_FAILURES = 6;

class DatabaseWorkerPool {
  private workers: WorkerWrapper[] = [];
  private pendingQueries: Map<number, PendingQuery> = new Map();
  private nextQueryId = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private poolSize: number;
  private options: PoolOptions;
  private workerPath: string;
  private dbPath: string;
  private consecutiveSpawnFailures = 0;
  private permanentlyDegraded = false;

  constructor(poolSize: number = 4, options: PoolOptions = {}) {
    this.poolSize = poolSize;
    this.options = options;
    this.workerPath = path.join(process.cwd(), 'lib', 'db-worker.js');
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'journals.db');
  }

  private get queryTimeoutMs(): number {
    return this.options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  }

  private get maxInFlight(): number {
    return this.options.maxInFlight ?? this.poolSize * DEFAULT_MAX_IN_FLIGHT_PER_WORKER;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    this.workers = Array.from({ length: this.poolSize }, () => ({
      worker: null,
      ready: false,
      inFlight: 0,
      spawnedAt: 0,
    }));
    await Promise.all(this.workers.map((_, i) => this.spawnWorker(i)));
    this.initialized = true;
    console.log(`Database worker pool initialized with ${this.poolSize} workers`);
  }

  /** Create (or replace) the worker in slot `index` and wire its handlers. */
  private spawnWorker(index: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settledOnline = false;
      try {
        const worker = new Worker(this.workerPath, {
          workerData: {
            dbPath: this.dbPath,
            cacheSize: this.options.cacheSize,
            mmapSize: this.options.mmapSize,
          },
        });

        const wrapper = this.workers[index];
        wrapper.worker = worker;
        wrapper.ready = false;
        wrapper.inFlight = 0;
        wrapper.spawnedAt = Date.now();

        worker.on('online', () => {
          wrapper.ready = true;
          settledOnline = true;
          resolve();
        });

        worker.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
          this.settle(msg.id, msg.error ? new Error(msg.error) : null, msg.result);
        });

        // 'online' fires when the thread starts, BEFORE db-worker.js opens the
        // database — so init can succeed and the worker die immediately after.
        // Both handlers below must therefore settle this worker's queries, or
        // the awaiting request hangs forever instead of failing.
        worker.on('error', (error) => {
          console.error(`[worker-pool] worker ${index} (${path.basename(this.dbPath)}) error:`, error);
          wrapper.ready = false;
          this.failWorkerQueries(index, error instanceof Error ? error : new Error(String(error)));
          if (!settledOnline) reject(error);
          this.handleWorkerLoss(index);
        });

        worker.on('exit', (code) => {
          wrapper.ready = false;
          if (code !== 0) {
            console.error(`[worker-pool] worker ${index} (${path.basename(this.dbPath)}) exited with code ${code}`);
          }
          this.failWorkerQueries(index, new Error(`Database worker exited (code ${code})`));
          if (!settledOnline) reject(new Error(`Database worker exited during startup (code ${code})`));
          this.handleWorkerLoss(index);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Respawn a lost worker, unless the database itself is clearly the problem.
   * A worker that dies almost immediately after spawning means a bad or missing
   * file, and respawning that in a loop would burn the box.
   */
  private handleWorkerLoss(index: number): void {
    if (this.permanentlyDegraded) return;
    const wrapper = this.workers[index];
    if (wrapper.worker) {
      wrapper.worker.removeAllListeners();
      wrapper.worker = null;
    }

    const diedFast = Date.now() - wrapper.spawnedAt < RESPAWN_DELAY_MS;
    this.consecutiveSpawnFailures = diedFast ? this.consecutiveSpawnFailures + 1 : 0;

    if (this.consecutiveSpawnFailures >= MAX_CONSECUTIVE_SPAWN_FAILURES) {
      this.permanentlyDegraded = true;
      console.error(
        `[worker-pool] ${path.basename(this.dbPath)}: giving up after ` +
          `${this.consecutiveSpawnFailures} immediate worker failures; queries will now fail fast`
      );
      return;
    }

    setTimeout(() => {
      if (this.permanentlyDegraded) return;
      this.spawnWorker(index).catch(() => {
        // Already logged by the handlers above; handleWorkerLoss will retry.
      });
    }, diedFast ? RESPAWN_DELAY_MS : 0);
  }

  private settle(queryId: number, error: Error | null, result?: unknown): void {
    const pending = this.pendingQueries.get(queryId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingQueries.delete(queryId);
    const wrapper = this.workers[pending.workerIndex];
    if (wrapper && wrapper.inFlight > 0) wrapper.inFlight--;
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private failWorkerQueries(index: number, error: Error): void {
    for (const [id, pending] of this.pendingQueries) {
      if (pending.workerIndex === index) this.settle(id, error);
    }
    const wrapper = this.workers[index];
    if (wrapper) wrapper.inFlight = 0;
  }

  /** Least-loaded ready worker. Throws rather than returning a dead one. */
  private pickWorker(): number {
    let best = -1;
    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[i];
      if (!w.ready || !w.worker) continue;
      if (best === -1 || w.inFlight < this.workers[best].inFlight) best = i;
    }
    if (best === -1) {
      throw new Error('No database worker is available');
    }
    return best;
  }

  private dispatch<T>(type: 'all' | 'get', sql: string, params: unknown[]): Promise<T> {
    if (this.permanentlyDegraded) {
      return Promise.reject(new Error('Database worker pool is unavailable'));
    }
    if (this.pendingQueries.size >= this.maxInFlight) {
      // Fail fast so the route returns an error instead of queueing behind a
      // backlog the pool cannot work through.
      return Promise.reject(new Error('Database worker pool is saturated'));
    }

    return new Promise<T>((resolve, reject) => {
      let index: number;
      try {
        index = this.pickWorker();
      } catch (error) {
        reject(error);
        return;
      }

      const queryId = this.nextQueryId++;
      const timer = setTimeout(() => {
        // The worker is stuck inside a synchronous SQLite call and cannot be
        // interrupted, so stop waiting and replace the thread.
        console.error(
          `[worker-pool] query ${queryId} on ${path.basename(this.dbPath)} exceeded ` +
            `${this.queryTimeoutMs}ms; terminating worker ${index}`
        );
        const wrapper = this.workers[index];
        this.failWorkerQueries(index, new Error('Database query timed out'));
        wrapper.ready = false;
        void wrapper.worker?.terminate();
      }, this.queryTimeoutMs);

      this.pendingQueries.set(queryId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        workerIndex: index,
        timer,
      });
      this.workers[index].inFlight++;
      this.workers[index].worker?.postMessage({ id: queryId, type, sql, params });
    });
  }

  async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    await this.initialize();
    return this.dispatch<T[]>('all', sql, params);
  }

  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    await this.initialize();
    return this.dispatch<T | undefined>('get', sql, params);
  }

  async shutdown(): Promise<void> {
    for (const [id] of this.pendingQueries) {
      this.settle(id, new Error('Database worker pool shutting down'));
    }
    this.permanentlyDegraded = true;
    await Promise.all(
      this.workers.map(({ worker }) => {
        worker?.removeAllListeners();
        return worker?.terminate();
      })
    );
    this.workers = [];
    this.initialized = false;
    this.initPromise = null;
  }
}

// Global singleton instance
let pool: DatabaseWorkerPool | null = null;

export function getWorkerPool(): DatabaseWorkerPool {
  if (!pool) {
    // Use 4 workers - allows 4 concurrent queries
    pool = new DatabaseWorkerPool(4);
  }
  return pool;
}

// Convenience functions that use the global pool
export async function workerQuery<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return getWorkerPool().query<T>(sql, ...params);
}

export async function workerQueryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return getWorkerPool().queryOne<T>(sql, ...params);
}

// ── Dedicated small pool for openaire.db ─────────────────────────────────────
// FTS queries over ~33M OpenAIRE titles are too slow for the main thread.
// openaire.db is optional: if the file is missing, pool init fails once and the
// failure is cached — callers must catch and degrade (skip OpenAIRE results).

import fs from 'fs';

let openairePool: DatabaseWorkerPool | null = null;
let openairePoolUnavailable = false;

export function getOpenaireWorkerPool(): DatabaseWorkerPool | null {
  if (openairePoolUnavailable) return null;
  if (!openairePool) {
    const dbPath = path.join(process.cwd(), 'data', 'openaire.db');
    if (!fs.existsSync(dbPath)) {
      openairePoolUnavailable = true;
      return null;
    }
    openairePool = new DatabaseWorkerPool(2, {
      dbPath,
      cacheSize: -524288, // 512MB per worker
      mmapSize: 2147483648 // 2GB mmap
    });
  }
  return openairePool;
}

export async function openaireWorkerQuery<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const p = getOpenaireWorkerPool();
  if (!p) return [];
  return p.query<T>(sql, ...params);
}


// ── Dedicated pools for the other large, optional databases ──────────────────
// Server components render these on the request path, so their reads must not
// run on the main thread: mesh.db is 32GB, papers_extra.db 20GB and
// abstracts.db 185GB, and a cold read is disk-seek bound. Two workers each is
// enough — these back a single section of a detail page, not a search.
//
// Each is optional. A missing file caches the failure and callers degrade to
// an empty result, matching the getAbstractsDb()/getMeshDb() contract.

interface OptionalPool {
  get(): DatabaseWorkerPool | null;
}

function makeOptionalPool(fileName: string): OptionalPool {
  let instance: DatabaseWorkerPool | null = null;
  let unavailable = false;

  return {
    get() {
      if (unavailable) return null;
      if (!instance) {
        const dbPath = path.join(process.cwd(), 'data', fileName);
        if (!fs.existsSync(dbPath)) {
          unavailable = true;
          return null;
        }
        instance = new DatabaseWorkerPool(2, {
          dbPath,
          cacheSize: -262144,  // 256MB per worker
          mmapSize: 2147483648 // 2GB mmap
        });
      }
      return instance;
    },
  };
}

const meshPool = makeOptionalPool('mesh.db');
const identityPool = makeOptionalPool('identity.db');
const pubmedPool = makeOptionalPool('pubmed.db');

async function optionalQuery<T>(
  p: OptionalPool,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const instance = p.get();
  if (!instance) return [];
  return instance.query<T>(sql, ...params);
}

async function optionalQueryOne<T>(
  p: OptionalPool,
  sql: string,
  params: unknown[]
): Promise<T | undefined> {
  const instance = p.get();
  if (!instance) return undefined;
  return instance.queryOne<T>(sql, ...params);
}

export const meshWorkerQuery = <T>(sql: string, ...params: unknown[]) =>
  optionalQuery<T>(meshPool, sql, params);
export const meshWorkerQueryOne = <T>(sql: string, ...params: unknown[]) =>
  optionalQueryOne<T>(meshPool, sql, params);

// identity.db backs both per-author career panels and the Trends rollups. The
// rollup tables are small, but a mobility drill-down can scan mobility_flows, so
// it stays off the main thread like the other optional DBs.
export const identityWorkerQuery = <T>(sql: string, ...params: unknown[]) =>
  optionalQuery<T>(identityPool, sql, params);
export const identityWorkerQueryOne = <T>(sql: string, ...params: unknown[]) =>
  optionalQueryOne<T>(identityPool, sql, params);

// pubmed.db backs study-design badges on paper pages and the design-trend rollup.
// paper_pubtypes is ~62M rows, so this stays off the main thread like the others.
export const pubmedWorkerQuery = <T>(sql: string, ...params: unknown[]) =>
  optionalQuery<T>(pubmedPool, sql, params);
