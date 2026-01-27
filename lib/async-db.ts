/**
 * Async wrapper for better-sqlite3 to prevent blocking the event loop
 *
 * better-sqlite3 is synchronous by design, which can block Node.js when
 * queries take >100ms. This wrapper uses setImmediate() to yield control
 * back to the event loop, allowing other requests to be processed.
 */

import type Database from "better-sqlite3";

/**
 * Run a database query asynchronously without blocking the event loop
 *
 * This wraps the synchronous query in setImmediate(), which:
 * 1. Yields control back to Node.js event loop
 * 2. Allows other requests to be processed
 * 3. Prevents one slow query from freezing the entire server
 */
export function asyncQuery<T>(
  stmt: Database.Statement,
  ...params: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    // Use setImmediate to prevent blocking
    setImmediate(() => {
      try {
        const results = stmt.all(...params) as T[];
        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Run a single-row database query asynchronously
 */
export function asyncQueryOne<T>(
  stmt: Database.Statement,
  ...params: unknown[]
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const result = stmt.get(...params) as T | undefined;
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Execute a database statement asynchronously
 */
export function asyncExec(
  stmt: Database.Statement,
  ...params: unknown[]
): Promise<Database.RunResult> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const result = stmt.run(...params);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
