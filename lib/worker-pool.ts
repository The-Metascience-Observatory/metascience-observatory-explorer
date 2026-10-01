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
}

interface WorkerWrapper {
  worker: Worker;
  ready: boolean;
}

interface PoolOptions {
  dbPath?: string;      // defaults to data/journals.db
  cacheSize?: number;   // SQLite cache_size pragma (negative = KB)
  mmapSize?: number;    // SQLite mmap_size pragma (bytes)
}

class DatabaseWorkerPool {
  private workers: WorkerWrapper[] = [];
  private pendingQueries: Map<number, PendingQuery> = new Map();
  private nextQueryId = 0;
  private nextWorkerIndex = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private poolSize: number;
  private options: PoolOptions;

  constructor(poolSize: number = 4, options: PoolOptions = {}) {
    this.poolSize = poolSize;
    this.options = options;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const workerPath = path.join(process.cwd(), 'lib', 'db-worker.js');
    const dbPath = this.options.dbPath || path.join(process.cwd(), 'data', 'journals.db');

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        try {
          const worker = new Worker(workerPath, {
            workerData: {
              dbPath,
              cacheSize: this.options.cacheSize,
              mmapSize: this.options.mmapSize
            }
          });

          const wrapper: WorkerWrapper = { worker, ready: false };

          worker.on('online', () => {
            wrapper.ready = true;
            resolve();
          });

          worker.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
            const pending = this.pendingQueries.get(msg.id);
            if (pending) {
              this.pendingQueries.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error));
              } else {
                pending.resolve(msg.result);
              }
            }
          });

          worker.on('error', (error) => {
            console.error(`Worker ${i} error:`, error);
            // Reject any pending queries for this worker
            reject(error);
          });

          worker.on('exit', (code) => {
            if (code !== 0) {
              console.error(`Worker ${i} exited with code ${code}`);
            }
            wrapper.ready = false;
          });

          this.workers.push(wrapper);
        } catch (error) {
          reject(error);
        }
      });

      workerPromises.push(promise);
    }

    await Promise.all(workerPromises);
    this.initialized = true;
    console.log(`Database worker pool initialized with ${this.poolSize} workers`);
  }

  private getNextWorker(): Worker {
    // Round-robin worker selection
    const startIndex = this.nextWorkerIndex;

    for (let i = 0; i < this.workers.length; i++) {
      const index = (startIndex + i) % this.workers.length;
      const wrapper = this.workers[index];
      if (wrapper.ready) {
        this.nextWorkerIndex = (index + 1) % this.workers.length;
        return wrapper.worker;
      }
    }

    // Fallback to first worker if none ready (shouldn't happen)
    return this.workers[0].worker;
  }

  async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    await this.initialize();

    return new Promise<T[]>((resolve, reject) => {
      const queryId = this.nextQueryId++;
      this.pendingQueries.set(queryId, {
        resolve: resolve as (value: unknown) => void,
        reject
      });

      const worker = this.getNextWorker();
      worker.postMessage({
        id: queryId,
        type: 'all',
        sql,
        params
      });
    });
  }

  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    await this.initialize();

    return new Promise<T | undefined>((resolve, reject) => {
      const queryId = this.nextQueryId++;
      this.pendingQueries.set(queryId, {
        resolve: resolve as (value: unknown) => void,
        reject
      });

      const worker = this.getNextWorker();
      worker.postMessage({
        id: queryId,
        type: 'get',
        sql,
        params
      });
    });
  }

  async shutdown(): Promise<void> {
    const terminatePromises = this.workers.map(({ worker }) => worker.terminate());
    await Promise.all(terminatePromises);
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
