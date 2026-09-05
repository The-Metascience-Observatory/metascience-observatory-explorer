#!/usr/bin/env node
/**
 * Generate the sitemap set into data/sitemaps/.
 *
 * Run on the HOST, outside the container, after a data refresh:
 *
 *   nice -n 10 ionice -c3 node scripts/generate-sitemaps.mjs
 *
 * Why offline rather than app/sitemap.ts + generateSitemaps():
 *   - In a standalone deployment those shards are computed per request. A
 *     crawler pulling ~40 shards would run ~40 `ORDER BY ... LIMIT/OFFSET`
 *     queries, and the persons query is a full scan of 100M rows with no usable
 *     index — repeated for every shard.
 *   - better-sqlite3 is synchronous, so one shard request blocks the event loop
 *     for the entire site.
 *   - MetadataRoute.Sitemap materialises the whole array before serialising:
 *     ~50k objects per shard inside a 4GB container that already asks SQLite
 *     for an 8GB cache.
 *   - The databases are refreshed manually a few times a year, so per-request
 *     freshness buys nothing.
 *
 * Output goes to data/sitemaps/ because data/ is the bind mount — publishing a
 * new set needs no image rebuild and no restart. (public/ is baked into the
 * image at build time, so it would.)
 *
 * Also refreshes the rank_* tables in cache.db, which back the "top N" hub
 * pages. They come free from queries this script already runs, and let those
 * pages serve from a few thousand small rows instead of scanning journals.db.
 */

import Database from "better-sqlite3";
import { createGzip } from "node:zlib";
import { createWriteStream, existsSync, statSync, readFileSync } from "node:fs";
import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const OUT = join(DATA, "sitemaps");
const TMP = join(DATA, "sitemaps.tmp");

const SITE_URL = (process.env.SITE_URL ?? "https://explore.metascienceobservatory.org")
  .replace(/\/$/, "");

/** Sitemaps.org caps a file at 50,000 URLs / 50MB uncompressed. */
const URLS_PER_SHARD = 50_000;

/** How deep to go into the unbounded entity types. */
const MAX_PAPERS = 500_000;
const MAX_PERSONS = 250_000;

/** Rows kept in each cache.db rank_* table (hub pages show 50/page, 100 pages). */
const RANK_LIMIT = 5_000;

// ---------------------------------------------------------------------------
// database access
// ---------------------------------------------------------------------------

/**
 * Open a database for bulk reads.
 *
 * These pragmas deliberately differ from lib/db.ts. That module sets
 * temp_store=MEMORY with a multi-GB cache, which is right for serving small
 * indexed lookups but catastrophic here: sorting 100M rows of person_summary
 * would try to build the sorter in RAM. Spill to disk instead, and keep the
 * page cache small so this job can run alongside the live server.
 */
function openForBulkRead(file) {
  const path = join(DATA, file);
  if (!existsSync(path)) return null;

  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("temp_store = FILE");
  db.pragma("cache_size = -262144"); // 256MB
  db.pragma("mmap_size = 0");
  return db;
}

// ---------------------------------------------------------------------------
// XML writing
// ---------------------------------------------------------------------------

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Write one gzipped urlset.
 *
 * changefreq and priority are omitted on purpose: Google states it ignores
 * both, and at ~1.8M URLs they would add tens of megabytes of noise.
 */
async function writeShard(filename, paths, lastmod) {
  const out = createWriteStream(join(TMP, filename));
  const gzip = createGzip({ level: 9 });

  async function* body() {
    yield '<?xml version="1.0" encoding="UTF-8"?>\n';
    yield '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    // Chunked so we make one write per 1000 URLs rather than one per URL.
    let buf = "";
    let n = 0;
    for (const path of paths) {
      buf += `<url><loc>${xmlEscape(SITE_URL + path)}</loc><lastmod>${lastmod}</lastmod></url>\n`;
      if (++n % 1000 === 0) {
        yield buf;
        buf = "";
      }
    }
    if (buf) yield buf;
    yield "</urlset>\n";
  }

  await pipeline(Readable.from(body()), gzip, out);
}

async function writeIndex(shards) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const s of shards) {
    lines.push(
      `  <sitemap><loc>${xmlEscape(`${SITE_URL}/sitemaps/${s.file}`)}</loc>` +
        `<lastmod>${s.lastmod}</lastmod></sitemap>`
    );
  }
  lines.push("</sitemapindex>", "");
  await writeFile(join(TMP, "sitemap-index.xml"), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// lastmod
// ---------------------------------------------------------------------------

/**
 * Carry forward the previous run's lastmod when a shard's contents are
 * unchanged.
 *
 * Stamping today's date on 1.8M URLs at every run teaches Google the field is
 * meaningless, and it then gets ignored site-wide. The hash covers both the
 * URL list and the metric that drives each page's content, so a shard's date
 * moves only when something a reader would notice actually changed.
 */
function loadPreviousManifest() {
  const path = join(OUT, "manifest.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")).shards ?? {};
  } catch {
    return {};
  }
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

/**
 * Each source yields { path, sig } — the URL path, and a signature capturing
 * the field that drives the page's content, used for change detection.
 */
function buildSources(dbs) {
  const { journals, mesh, retractions } = dbs;
  const sources = [];

  const staticPaths = [
    "/", "/about", "/papers", "/persons", "/journals", "/journals/top",
    "/affiliations", "/funders", "/funders-map", "/fields", "/trials",
    "/retractions", "/retractions/search",
  ];
  sources.push({
    name: "hubs",
    rows: () => staticPaths.map((p) => ({ path: p, sig: "" })),
  });

  if (journals) {
    sources.push({
      name: "fields",
      rows: () =>
        journals
          .prepare(
            `SELECT fieldid, paper_count FROM field_summary
              WHERE level <= 1 ORDER BY paper_count DESC`
          )
          .iterate(),
      map: (r) => ({ path: `/fields/${r.fieldid}`, sig: r.paper_count }),
    });

    sources.push({
      name: "journals",
      rows: () =>
        journals
          .prepare(
            // Excludes the ~107 HIJACKED_* rows, which are flags rather than
            // real journal pages.
            `SELECT sourceid, total_papers, total_citations FROM journal_summary
              WHERE total_papers > 0 AND sourceid LIKE 'S%'
              ORDER BY total_citations DESC`
          )
          .iterate(),
      map: (r) => ({
        path: `/journals/${r.sourceid}`,
        sig: `${r.total_papers}:${r.total_citations}`,
      }),
    });

    sources.push({
      name: "journals-scopus",
      rows: () =>
        journals
          .prepare(
            // Includes the 4,337 discontinued titles. Their pages are real
            // content — "is journal X still indexed in Scopus" is exactly the
            // question this data answers — so they belong in the index.
            `SELECT scopus_source_id, is_active FROM scopus_only_journals
              WHERE scopus_source_id IS NOT NULL AND scopus_source_id <> ''`
          )
          .iterate(),
      map: (r) => ({
        path: `/journals/scopus/${r.scopus_source_id}`,
        sig: String(r.is_active ?? ""),
      }),
    });

    sources.push({
      name: "affiliations",
      rows: () =>
        journals
          .prepare(
            `SELECT institution_id, productivity, total_citations FROM affiliation_summary
              WHERE productivity > 0 ORDER BY total_citations DESC`
          )
          .iterate(),
      map: (r) => ({
        path: `/affiliations/${r.institution_id}`,
        sig: `${r.productivity}:${r.total_citations}`,
      }),
    });

    sources.push({
      name: "funders",
      rows: () =>
        journals
          .prepare(
            `SELECT funderid, works_count, cited_by_count FROM funder_summary
              WHERE works_count > 0 ORDER BY cited_by_count DESC`
          )
          .iterate(),
      map: (r) => ({
        path: `/funders/${r.funderid}`,
        sig: `${r.works_count}:${r.cited_by_count}`,
      }),
    });

    sources.push({
      name: "trials",
      rows: () =>
        journals
          .prepare(
            `SELECT nct_id, status, completion_date FROM ctg_studies
              WHERE nct_id IS NOT NULL AND nct_id <> ''`
          )
          .iterate(),
      map: (r) => ({
        path: `/trials/${r.nct_id}`,
        sig: `${r.status ?? ""}:${r.completion_date ?? ""}`,
      }),
    });

    // Cheap: idx_paper_summary_cited_by_count is DESC, so this is an index walk.
    sources.push({
      name: "papers",
      rows: () =>
        journals
          .prepare(
            `SELECT paperid, cited_by_count FROM paper_summary
              WHERE cited_by_count IS NOT NULL
              ORDER BY cited_by_count DESC LIMIT ?`
          )
          .iterate(MAX_PAPERS),
      map: (r) => ({ path: `/papers/${r.paperid}`, sig: r.cited_by_count }),
    });

    // The expensive one: person_summary has no index on cited_by_count, so this
    // is a full scan of ~100M rows (a few minutes). It is exactly why this
    // script runs offline rather than inside a request.
    sources.push({
      name: "persons",
      rows: () =>
        journals
          .prepare(
            `SELECT authorid, cited_by_count, works_count FROM person_summary
              WHERE cited_by_count IS NOT NULL AND works_count >= 5
              ORDER BY cited_by_count DESC LIMIT ?`
          )
          .iterate(MAX_PERSONS),
      map: (r) => ({ path: `/persons/${r.authorid}`, sig: r.cited_by_count }),
    });
  }

  if (mesh) {
    sources.push({
      name: "mesh",
      rows: () =>
        mesh
          .prepare(
            `SELECT mesh_ui, total_papers FROM mesh_summary
              WHERE total_papers > 0 ORDER BY total_papers DESC`
          )
          .iterate(),
      map: (r) => ({ path: `/mesh/${r.mesh_ui}`, sig: r.total_papers }),
    });
  }

  if (retractions) {
    // High public interest and mostly below the citation cut, so these are
    // largely net-new URLs rather than duplicates of the papers shard.
    sources.push({
      name: "retracted-papers",
      rows: () =>
        retractions
          .prepare(
            `SELECT DISTINCT paperid FROM retractions
              WHERE paperid IS NOT NULL AND paperid <> ''`
          )
          .iterate(),
      map: (r) => ({ path: `/papers/${r.paperid}`, sig: "retracted" }),
    });
  }

  return sources;
}

// ---------------------------------------------------------------------------
// rank_* tables
// ---------------------------------------------------------------------------

/**
 * Materialise small "top N" tables into cache.db.
 *
 * /persons/top cannot be served live (a 100M-row scan per page), so the hub
 * pages read these instead: a rank BETWEEN ? AND ? against a few thousand rows.
 */
function buildRankTables(journals) {
  const cachePath = join(DATA, "cache.db");
  const cache = new Database(cachePath);
  cache.pragma("journal_mode = WAL");

  const specs = [
    {
      table: "rank_papers",
      ddl: `CREATE TABLE IF NOT EXISTS rank_papers (
              rank INTEGER PRIMARY KEY, paperid TEXT NOT NULL, title TEXT,
              year INTEGER, cited_by_count INTEGER, source_name TEXT)`,
      select: `SELECT paperid, title, year, cited_by_count, source_name
                 FROM paper_summary WHERE cited_by_count IS NOT NULL
                ORDER BY cited_by_count DESC LIMIT ?`,
      cols: ["paperid", "title", "year", "cited_by_count", "source_name"],
    },
    {
      table: "rank_persons",
      ddl: `CREATE TABLE IF NOT EXISTS rank_persons (
              rank INTEGER PRIMARY KEY, authorid TEXT NOT NULL, display_name TEXT,
              cited_by_count INTEGER, h_index INTEGER, works_count INTEGER,
              last_known_institution TEXT)`,
      select: `SELECT authorid, display_name, cited_by_count, h_index, works_count,
                      last_known_institution
                 FROM person_summary WHERE cited_by_count IS NOT NULL
                ORDER BY cited_by_count DESC LIMIT ?`,
      cols: ["authorid", "display_name", "cited_by_count", "h_index",
             "works_count", "last_known_institution"],
    },
    {
      table: "rank_affiliations",
      ddl: `CREATE TABLE IF NOT EXISTS rank_affiliations (
              rank INTEGER PRIMARY KEY, institution_id TEXT NOT NULL,
              display_name TEXT, country_code TEXT, total_citations INTEGER,
              researcher_count INTEGER)`,
      select: `SELECT institution_id, display_name, country_code, total_citations,
                      researcher_count
                 FROM affiliation_summary WHERE productivity > 0
                ORDER BY total_citations DESC LIMIT ?`,
      cols: ["institution_id", "display_name", "country_code", "total_citations",
             "researcher_count"],
    },
  ];

  for (const spec of specs) {
    cache.exec(spec.ddl);
    const insert = cache.prepare(
      `INSERT INTO ${spec.table} (rank, ${spec.cols.join(", ")})
       VALUES (@rank, ${spec.cols.map((c) => `@${c}`).join(", ")})`
    );

    // Rebuild in a transaction so readers never see a half-populated table.
    const rebuild = cache.transaction((rows) => {
      cache.prepare(`DELETE FROM ${spec.table}`).run();
      let rank = 0;
      for (const row of rows) insert.run({ ...row, rank: ++rank });
      return rank;
    });

    const n = rebuild(journals.prepare(spec.select).iterate(RANK_LIMIT));
    console.log(`  ${spec.table.padEnd(20)} ${n.toLocaleString()} rows`);
  }

  cache.close();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const skipRanks = process.argv.includes("--skip-ranks");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

  const dbs = {
    journals: openForBulkRead("journals.db"),
    mesh: openForBulkRead("mesh.db"),
    retractions: openForBulkRead("retractions.db"),
  };
  for (const [name, db] of Object.entries(dbs)) {
    if (!db) console.warn(`! ${name}.db not found — its URLs will be skipped`);
  }
  if (!dbs.journals) throw new Error("journals.db is required");

  // Fallback date for shards whose contents changed since the last run.
  const dbDate = isoDate(statSync(join(DATA, "journals.db")).mtime);
  const previous = loadPreviousManifest();

  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const shards = [];
  const manifest = {};
  let totalUrls = 0;

  let sources = buildSources(dbs);
  if (only) sources = sources.filter((s) => only.split(",").includes(s.name));

  for (const source of sources) {
    const t0 = Date.now();
    let shardIndex = 0;
    let count = 0;
    let batch = [];
    let hash = createHash("sha256");

    const flush = async (isLast) => {
      if (batch.length === 0 && !(isLast && shardIndex === 0)) return;
      shardIndex++;
      // Multi-shard sources get a numeric suffix; single-shard ones stay bare.
      const file = `${source.name}${
        shardIndex > 1 || batch.length === URLS_PER_SHARD ? `-${shardIndex}` : ""
      }.xml.gz`;

      const digest = hash.digest("hex");
      const prev = previous[file];
      const lastmod = prev && prev.hash === digest ? prev.lastmod : dbDate;

      await writeShard(file, batch, lastmod);
      shards.push({ file, lastmod });
      manifest[file] = { count: batch.length, hash: digest, lastmod };
      totalUrls += batch.length;

      batch = [];
      hash = createHash("sha256");
    };

    for (const raw of source.rows()) {
      const { path, sig } = source.map ? source.map(raw) : raw;
      batch.push(path);
      hash.update(`${path}|${sig}\n`);
      count++;
      if (batch.length >= URLS_PER_SHARD) await flush(false);
    }
    await flush(true);

    console.log(
      `  ${source.name.padEnd(18)} ${String(count).padStart(9)} URLs ` +
        `in ${shardIndex} shard(s)  ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }

  await writeIndex(shards);
  await writeFile(
    join(TMP, "manifest.json"),
    `${JSON.stringify(
      { generated_at: new Date().toISOString(), site_url: SITE_URL, shards: manifest },
      null,
      2
    )}\n`
  );

  if (only) {
    // --only builds a deliberately partial set. Publishing it would silently
    // drop every other entity type from the index, so leave it in the temp
    // directory for inspection instead.
    console.log(`\nPartial run (--only=${only}) — NOT published.`);
    console.log(`  Inspect at ${TMP}, then re-run without --only to publish.`);
    for (const db of Object.values(dbs)) db?.close();
    return;
  }

  // Swap atomically so the serving route never reads a half-written set.
  await rm(OUT, { recursive: true, force: true });
  await rename(TMP, OUT);

  if (!skipRanks) {
    console.log("\nRebuilding rank tables in cache.db...");
    buildRankTables(dbs.journals);
  }

  for (const db of Object.values(dbs)) db?.close();

  console.log(
    `\n${totalUrls.toLocaleString()} URLs across ${shards.length} shards ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  console.log(`  -> ${OUT}`);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
