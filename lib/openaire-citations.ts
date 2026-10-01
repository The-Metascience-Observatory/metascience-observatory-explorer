import { getOpenaireCitationsDb } from "@/lib/db";
import { workerQuery, openaireWorkerQuery } from "@/lib/worker-pool";
import type { OpenaireRelatedPaper, PaperCitationHistory } from "@/lib/types";
import { EDGE_CAP } from "@/lib/constants";

// Re-exported so server callers can keep importing it from here.
export { EDGE_CAP };


/** SQLite variable limit is 32766; 500 keeps the worker stmt cache small. */
const BATCH = 500;

export type EdgeTable = "openaire_refs" | "openaire_cites";

interface EdgeRow {
  total: number;
  neighbors: Buffer;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Decode a slice of the packed int64 neighbor blob.
 *
 * Returned as plain numbers, not bigints: every key fits exactly in a double
 * (largest W id is ~1e10, largest rowid 33.5M, both far under 2^53), and
 * keeping them as numbers avoids an ES2020 target bump for BigInt literals.
 */
function decodeKeys(blob: Buffer, offset: number, limit: number): number[] {
  const count = Math.floor(blob.length / 8);
  const start = Math.min(offset, count);
  const end = Math.min(start + limit, count);
  const keys: number[] = [];
  for (let i = start; i < end; i++) keys.push(Number(blob.readBigInt64LE(i * 8)));
  return keys;
}

/**
 * Resolve a mixed list of int64 app keys to displayable papers.
 *
 * The two corpora live in different databases with differently-tuned worker
 * pools, so the legs run concurrently and each fails soft: a dead pool or a
 * missing table yields an unresolved entry (null title) rather than a 500.
 * Never query journals.db or openaire.db on the main thread here - 100 index
 * probes into a cold 1.5TB/50GB file would stall every other request.
 */
async function resolveKeys(keys: number[]): Promise<OpenaireRelatedPaper[]> {
  const wIds: string[] = [];
  const oaRowids: number[] = [];
  for (const k of keys) {
    if (k > 0) wIds.push(`W${k}`);
    else if (k < 0) oaRowids.push(-k);
  }

  const oaPromise = Promise.all(
    chunk(oaRowids, BATCH).map((c) =>
      openaireWorkerQuery<{ rowid: number; id: string; title: string | null; year: number | null }>(
        `SELECT rowid, id, title, year FROM openaire_papers
          WHERE rowid IN (${c.map(() => "?").join(",")})`,
        ...c
      )
    )
  )
    .then((r) => r.flat())
    .catch(() => []);

  const wPromise = Promise.all(
    chunk(wIds, BATCH).map((c) =>
      workerQuery<{
        paperid: string;
        title: string | null;
        year: number | null;
        cited_by_count: number | null;
      }>(
        `SELECT paperid, title, year, cited_by_count FROM paper_summary
          WHERE paperid IN (${c.map(() => "?").join(",")})`,
        ...c
      )
    )
  )
    .then((r) => r.flat())
    .catch(() => []);

  const [oaRows, wRows] = await Promise.all([oaPromise, wPromise]);

  // BIP! counts for the OpenAIRE neighbors: one batched WITHOUT ROWID PK probe
  // per chunk against a small file, safe on the main thread.
  const oaCounts = new Map<string, number>();
  const cdb = getOpenaireCitationsDb();
  // Track whether the lookup actually ran: if it did, a missing row means zero
  // (only nonzero rows are stored). If it didn't, the count is genuinely unknown
  // and must not be rendered as "0 citations".
  let impactAvailable = false;
  if (cdb && oaRows.length) {
    try {
      for (const c of chunk(oaRows.map((r) => r.id), BATCH)) {
        const rows = cdb
          .prepare(
            `SELECT id, citation_count FROM openaire_paper_impact
              WHERE id IN (${c.map(() => "?").join(",")})`
          )
          .all(...c) as { id: string; citation_count: number }[];
        for (const r of rows) oaCounts.set(r.id, r.citation_count);
      }
      impactAvailable = true;
    } catch {
      // impact table is optional; fall through with unknown counts
    }
  }

  const byOaRowid = new Map(oaRows.map((r) => [r.rowid, r]));
  const byWId = new Map(wRows.map((r) => [r.paperid, r]));

  // Preserve the stored order - it is the citation-count ranking from build time.
  // Entries are kept 1:1 with `keys` even when unresolvable, because callers
  // paginate by items.length; dropping any would re-fetch and duplicate.
  return keys.map((k): OpenaireRelatedPaper => {
    if (k < 0) {
      const row = byOaRowid.get(-k);
      if (!row) {
        // No id to build a URL from, so mark it unresolved rather than emit a
        // link that would 404. Should be ~impossible unless the rowid epoch drifted.
        return {
          paperid: `oa-rowid-${-k}`,
          title: null,
          year: null,
          cited_by_count: null,
          openaire: true,
          unresolved: true,
        };
      }
      return {
        paperid: row.id,
        title: row.title,
        year: row.year,
        cited_by_count: impactAvailable ? oaCounts.get(row.id) ?? 0 : null,
        openaire: true,
      };
    }
    const paperid = `W${k}`;
    const row = byWId.get(paperid);
    return {
      paperid,
      title: row?.title ?? null,
      year: row?.year ?? null,
      cited_by_count: row?.cited_by_count ?? null,
      openaire: false,
      ...(row ? {} : { unresolved: true }),
    };
  });
}

/**
 * Whether citation edges are deployed at all.
 *
 * Routes check this FIRST so that, when the feature isn't installed, they return
 * an empty payload without translating the paper id — which would otherwise cost
 * a worker round trip (and hang if the worker pool can't start) purely to look up
 * data we already know is absent.
 */
export function citationsAvailable(): boolean {
  return getOpenaireCitationsDb() !== null;
}

export interface NeighborPage {
  items: OpenaireRelatedPaper[];
  total: number;
  stored: number;
  truncated: boolean;
}

/**
 * Look up one page of a paper's neighbors. Returns null when the citation DB
 * isn't deployed, so callers can degrade to an empty section.
 */
export async function loadNeighborPage(
  table: EdgeTable,
  key: number,
  offset: number,
  limit: number
): Promise<NeighborPage | null> {
  const cdb = getOpenaireCitationsDb();
  if (!cdb) return null;

  let row: EdgeRow | undefined;
  try {
    row = cdb
      .prepare(`SELECT total, neighbors FROM ${table} WHERE k = ?`)
      .get(key) as EdgeRow | undefined;
  } catch {
    return null; // table not built yet
  }
  if (!row) return { items: [], total: 0, stored: 0, truncated: false };

  const stored = Math.floor(row.neighbors.length / 8);
  const items = await resolveKeys(decodeKeys(row.neighbors, offset, limit));
  return { items, total: row.total, stored, truncated: row.total > stored };
}

/**
 * Citation history for an OpenAIRE paper, derived exactly from the full citing
 * list. Returns null when the list is truncated, because the stored subset is
 * the top-N by citation count and therefore skews old - charting it would draw a
 * confidently wrong curve. Better no chart than a misleading one.
 */
export async function citationHistoryIfExact(
  key: number,
  total: number,
  stored: number
): Promise<PaperCitationHistory[] | undefined> {
  if (total === 0 || total > stored) return undefined;
  const page = await loadNeighborPage("openaire_cites", key, 0, EDGE_CAP);
  if (!page) return undefined;
  const byYear = new Map<number, number>();
  for (const p of page.items) {
    if (p.year == null) continue;
    byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);
  }
  if (byYear.size === 0) return undefined;
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, citation_count]) => ({ year, citation_count }));
}

/**
 * App id -> the int64 edge key. 'OA…' ids need a rowid lookup in openaire.db;
 * 'W…' ids encode directly. Returns null for anything unrecognized.
 */
export async function keyForPaperId(paperid: string): Promise<number | null> {
  if (/^W\d+$/.test(paperid)) return Number(paperid.slice(1));
  if (!/^OA[0-9a-f]{32}$/.test(paperid)) return null;
  try {
    const rows = await openaireWorkerQuery<{ rowid: number }>(
      "SELECT rowid FROM openaire_papers WHERE id = ?",
      paperid
    );
    return rows.length ? -rows[0].rowid : null;
  } catch {
    return null;
  }
}
