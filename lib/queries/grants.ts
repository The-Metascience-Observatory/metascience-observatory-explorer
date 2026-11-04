import { cache } from "react";
import { getGrantsDb } from "@/lib/db";
import { workerQuery, openaireWorkerQuery } from "@/lib/worker-pool";
import { decodeSources, normalizeGrantId } from "@/lib/grant-id";
import type { GrantMatch, GrantPaperItem, GrantSummary } from "@/lib/types";

/**
 * Read paths for grants.db (scripts/build_grants_db.py).
 *
 * Every query here is a WITHOUT ROWID PK seek or a bounded walk of one index,
 * so the main-thread connection is fine. Turning the resulting paper ids into
 * titles is NOT — that goes through the worker pools, in chunks, exactly like
 * lib/openaire-citations.ts.
 */

const BATCH = 500;

interface SummaryRow {
  funder: string;
  key: string;
  serial: string | null;
  activity: string | null;
  display: string;
  raw_ids: string | null;
  paper_count: number;
  reported_count: number;
  acknowledged_count: number;
  src_nih: number;
  src_nsf: number;
  src_pubmed: number;
  src_openaire: number;
  first_year: number | null;
  last_year: number | null;
  title: string | null;
  acronym: string | null;
  funding_stream: string | null;
  funder_name: string | null;
  start_date: string | null;
  end_date: string | null;
  funded_amount: number | null;
  currency: string | null;
  project_count: number | null;
}

const SUMMARY_COLS = `funder, key, serial, activity, display, raw_ids,
  paper_count, reported_count, acknowledged_count,
  src_nih, src_nsf, src_pubmed, src_openaire, first_year, last_year,
  title, acronym, funding_stream, funder_name, start_date, end_date,
  funded_amount, currency, project_count`;

function toSummary(r: SummaryRow): GrantSummary {
  let rawIds: string[] = [];
  if (r.raw_ids) {
    try {
      const parsed = JSON.parse(r.raw_ids);
      if (Array.isArray(parsed)) rawIds = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // malformed JSON from the build is not worth failing a page over
    }
  }
  return {
    funder: r.funder,
    key: r.key,
    serial: r.serial,
    activity: r.activity,
    display: r.display,
    raw_ids: rawIds,
    paper_count: r.paper_count,
    reported_count: r.reported_count,
    acknowledged_count: r.acknowledged_count,
    sources: decodeSources(
      (r.src_nih ? 1 : 0) | (r.src_nsf ? 2 : 0) | (r.src_pubmed ? 4 : 0) | (r.src_openaire ? 8 : 0)
    ),
    first_year: r.first_year,
    last_year: r.last_year,
    title: r.title,
    acronym: r.acronym,
    funding_stream: r.funding_stream,
    funder_name: r.funder_name,
    start_date: r.start_date,
    end_date: r.end_date,
    funded_amount: r.funded_amount,
    currency: r.currency,
    project_count: r.project_count,
  };
}

export function grantsAvailable(): boolean {
  return getGrantsDb() !== null;
}

/** PK seek on grant_summary. */
export const getGrantSummary = cache(
  async (funder: string, key: string): Promise<GrantSummary | null> => {
    const db = getGrantsDb();
    if (!db) return null;
    const row = db
      .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE funder = ? AND key = ?`)
      .get(funder.toUpperCase(), key.toUpperCase()) as SummaryRow | undefined;
    return row ? toSummary(row) : null;
  }
);

export interface GrantLookup {
  normalized: { funder: string | null; key: string; serial: string | null } | null;
  matches: GrantMatch[];
}

/**
 * Resolve free text to grants. Three bounded probes: the exact (funder, key)
 * when the string names its funder, the same key under any funder (a bare
 * number), and — for NIH — every activity code sharing the serial, so
 * `AG066215` finds R56AG066215 and R01AG066215.
 */
export const lookupGrantMatches = cache(async (q: string): Promise<GrantLookup> => {
  const n = normalizeGrantId(q);
  if (!n) return { normalized: null, matches: [] };
  const db = getGrantsDb();
  const normalized = { funder: n.funder, key: n.key, serial: n.serial };
  if (!db) return { normalized, matches: [] };

  const found = new Map<string, SummaryRow>();
  const collect = (rows: SummaryRow[]) => {
    for (const r of rows) found.set(`${r.funder}\u0000${r.key}`, r);
  };

  if (n.funder) {
    const row = db
      .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE funder = ? AND key = ?`)
      .get(n.funder, n.key) as SummaryRow | undefined;
    if (row) collect([row]);
  }
  collect(
    db
      .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE key = ? ORDER BY paper_count DESC LIMIT 50`)
      .all(n.key) as SummaryRow[]
  );
  if (n.serial) {
    collect(
      db
        .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE serial = ? ORDER BY paper_count DESC LIMIT 50`)
        .all(n.serial) as SummaryRow[]
    );
  }

  // A pasted PubMed string like `MH RCSA MH-47,808` only parses with the NIH
  // hint; retry that way before giving up, since NIH is where messy ids live.
  if (found.size === 0 && n.funder === null) {
    const nih = normalizeGrantId(q, "NIH");
    if (nih && nih.funder === "NIH" && nih.key !== n.key) {
      const row = db
        .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE funder = 'NIH' AND key = ?`)
        .get(nih.key) as SummaryRow | undefined;
      if (row) collect([row]);
      if (nih.serial) {
        collect(
          db
            .prepare(`SELECT ${SUMMARY_COLS} FROM grant_summary WHERE serial = ? ORDER BY paper_count DESC LIMIT 50`)
            .all(nih.serial) as SummaryRow[]
        );
      }
      if (found.size > 0) {
        normalized.funder = "NIH";
        normalized.key = nih.key;
        normalized.serial = nih.serial;
      }
    }
  }

  const matches: GrantMatch[] = [...found.values()].map((r) => ({
    ...toSummary(r),
    exact: r.key === normalized.key && (normalized.funder === null || r.funder === normalized.funder),
  }));
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || b.paper_count - a.paper_count);
  return { normalized, matches };
});

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface LinkRow {
  paperid: string;
  sources: number;
  cited_by_count: number;
  year: number | null;
}

const OA_ID = /^OA[0-9a-f]{32}$/;

/**
 * One page of a grant's papers, in the citation order fixed at build time.
 * `mask` selects sources (see GRANT_SOURCE_MASKS). Titles for the page come
 * from paper_summary (W ids) and openaire_papers (OA ids) via the worker
 * pools; a paper that fails to resolve keeps its id as the title rather than
 * being dropped, so paging by offset stays consistent.
 */
export async function getGrantPapersPage(
  funder: string,
  key: string,
  mask: number,
  offset: number,
  limit: number
): Promise<{ results: GrantPaperItem[]; total: number }> {
  const db = getGrantsDb();
  if (!db) return { results: [], total: 0 };
  const f = funder.toUpperCase();
  const k = key.toUpperCase();

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM grant_papers WHERE funder = ? AND key = ? AND (sources & ?) != 0`)
      .get(f, k, mask) as { c: number }
  ).c;
  if (total === 0 || offset >= total) return { results: [], total };

  const rows = db
    .prepare(
      `SELECT paperid, sources, cited_by_count, year FROM grant_papers
        WHERE funder = ? AND key = ? AND (sources & ?) != 0
        ORDER BY cited_by_count DESC, paperid
        LIMIT ? OFFSET ?`
    )
    .all(f, k, mask, limit, offset) as LinkRow[];

  const oaIds = rows.map((r) => r.paperid).filter((id) => OA_ID.test(id));
  const wIds = rows.map((r) => r.paperid).filter((id) => !OA_ID.test(id));

  const wPromise = Promise.all(
    chunk(wIds, BATCH).map((c) =>
      workerQuery<{
        paperid: string;
        title: string | null;
        doi: string | null;
        year: number | null;
        cited_by_count: number | null;
        source_name: string | null;
      }>(
        `SELECT paperid, title, doi, year, cited_by_count, source_name FROM paper_summary
          WHERE paperid IN (${c.map(() => "?").join(",")})`,
        ...c
      )
    )
  )
    .then((r) => r.flat())
    .catch(() => []);

  const oaPromise = Promise.all(
    chunk(oaIds, BATCH).map((c) =>
      openaireWorkerQuery<{
        id: string;
        title: string | null;
        doi: string | null;
        year: number | null;
        journal_name: string | null;
      }>(
        `SELECT id, title, doi, year, journal_name FROM openaire_papers
          WHERE id IN (${c.map(() => "?").join(",")})`,
        ...c
      )
    )
  )
    .then((r) => r.flat())
    .catch(() => []);

  const [wRows, oaRows] = await Promise.all([wPromise, oaPromise]);
  const byW = new Map(wRows.map((r) => [r.paperid, r]));
  const byOa = new Map(oaRows.map((r) => [r.id, r]));

  const results: GrantPaperItem[] = rows.map((r) => {
    const sources = decodeSources(r.sources);
    if (OA_ID.test(r.paperid)) {
      const o = byOa.get(r.paperid);
      return {
        paperid: r.paperid,
        title: o?.title || r.paperid,
        doi: o?.doi ?? null,
        year: o?.year ?? null,
        cited_by_count: r.cited_by_count, // BIP! snapshot; only nonzero rows are stored
        source_name: o?.journal_name ?? null,
        openaire: true,
        sources,
      };
    }
    const w = byW.get(r.paperid);
    return {
      paperid: r.paperid,
      title: w?.title || r.paperid,
      doi: w?.doi ?? null,
      year: w?.year ?? r.year,
      cited_by_count: w?.cited_by_count ?? r.cited_by_count,
      source_name: w?.source_name ?? null,
      sources,
    };
  });

  return { results, total };
}
