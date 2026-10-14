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

// Performance tuning (overridable per pool via workerData)
db.pragma(`cache_size = ${workerData?.cacheSize || -2000000}`); // default 2GB per worker
db.pragma(`mmap_size = ${workerData?.mmapSize || 4294967296}`); // default 4GB mmap
db.pragma('temp_store = MEMORY');
try {
  // Switching journal mode fails with SQLITE_READONLY on readonly connections
  // unless the db is already in WAL mode (journals.db is; openaire.db is not).
  db.pragma('journal_mode = WAL');
} catch {
  // keep the db's existing journal mode
}

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
