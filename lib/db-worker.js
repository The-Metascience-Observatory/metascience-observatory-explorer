/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * SQLite Worker Thread for non-blocking database queries
 * This runs in a separate thread so it doesn't block the main event loop
 *
 * NOTE: This file uses CommonJS require() because worker_threads
 * run in a separate context and need CommonJS modules.
 */

const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const path = require('path');

// Initialize database in worker thread
const dbPath = workerData?.dbPath || path.join(process.cwd(), 'data', 'journals.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Performance tuning
db.pragma('cache_size = -2000000'); // 2GB per worker
db.pragma('mmap_size = 4294967296'); // 4GB mmap
db.pragma('temp_store = MEMORY');
db.pragma('journal_mode = WAL');

// Prepared statement cache
const stmtCache = new Map();

function getStatement(sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql);
}

// Handle messages from main thread
parentPort.on('message', (msg) => {
  try {
    const stmt = getStatement(msg.sql);
    let result;

    if (msg.type === 'all') {
      result = stmt.all(...msg.params);
    } else if (msg.type === 'get') {
      result = stmt.get(...msg.params);
    } else if (msg.type === 'run') {
      result = stmt.run(...msg.params);
    }

    parentPort.postMessage({ id: msg.id, result });
  } catch (error) {
    parentPort.postMessage({
      id: msg.id,
      error: error.message || 'Unknown error'
    });
  }
});

// Cleanup on exit
process.on('exit', () => {
  db.close();
});
