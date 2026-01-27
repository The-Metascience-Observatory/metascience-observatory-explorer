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

class DatabaseWorkerPool {
  private workers: WorkerWrapper[] = [];
  private pendingQueries: Map<number, PendingQuery> = new Map();
  private nextQueryId = 0;
  private nextWorkerIndex = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private poolSize: number;

  constructor(poolSize: number = 4) {
    this.poolSize = poolSize;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const workerPath = path.join(process.cwd(), 'lib', 'db-worker.js');
    const dbPath = path.join(process.cwd(), 'data', 'journals.db');

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        try {
          const worker = new Worker(workerPath, {
            workerData: { dbPath }
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
