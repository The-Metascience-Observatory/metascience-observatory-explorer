#!/usr/bin/env python3
"""Build data/grants.db: grant number -> linked papers, from four sources.

WHY: nothing in the data lake is indexed by grant number. Grant ids sit in four
places with four spellings of the same award, and none of them has an index on
the id:
  * SciSciNet's NIH link file     R01CA123456          "reported by the funder"
  * SciSciNet's NSF link file     NSF-1907207          "reported by the funder"
  * PubMed's <Grant> field        1 R01 CA 12345-01    "acknowledged in the paper"
  * OpenAIRE paper_projects       5R01CA123456-07      "acknowledged in the paper"
This script normalizes every id with scripts/grant_id.py (the mirror of
lib/grant-id.ts, both checked against lib/grant-id.vectors.json), dedupes to
one row per (funder, key, paper) with a bitmask of sources, snapshots each
paper's citation count so the API can page a grant's papers by impact without
touching journals.db, and writes a per-grant summary with title/dates/amount
from OpenAIRE's projects table.

TABLES (data/grants.db)
  grant_papers (funder, key, paperid, sources, cited_by_count, year)
      sources bits: 1 nih_exporter, 2 nsf, 4 pubmed, 8 openaire
  grant_summary (funder, key, serial, activity, display, raw_ids, counts..., title...)
  import_meta

MEMORY: THIS MACHINE HOSTS THE SITE. DuckDB is capped at --memory-limit (4 GB)
on --threads (2) and spills to --work-dir; the Python side streams every source
in 200k-row batches. pmid -> paperid comes from mesh.db's paperid_pmid table
(NOT sciscinet_papers_pmid_pmcid.parquet, which holds only 6.3M rows).
openaire.db is only read. Never VACUUM it.

Usage:
  mkdir -p /mnt/metascience/grants_work
  python3 scripts/test_grant_id.py                       # gate: vectors must pass
  python3 scripts/build_grants_db.py --limit 200000 \
      --work-dir /mnt/metascience/grants_work --out /mnt/metascience/grants_work/sample.db
  nice -n 19 ionice -c2 -n7 nohup python3 scripts/build_grants_db.py \
      --work-dir /mnt/metascience/grants_work > /mnt/metascience/grants_work/run.log 2>&1 &

Do not run alongside scripts/backup_to_seagate.sh.

MEASURED (full run, 2026-11-03): 6m 13s wall, 1.86 GB output, 17.6M grant_papers
rows and 2.05M grants (873k with an OpenAIRE title). PubMed -> SciSciNet pmid
miss rate 29%; 3.0% of PubMed NIH rows keep an exact-string key because they
are pre-1990 formats (`AG 00367`-style parse fine; `AID9648`, `271-77-3410`
do not) or HHSN contracts, which is intended.
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grant_id import (  # noqa: E402
    SOURCE_BITS,
    funder_from_openaire_shortname,
    funder_from_pubmed_agency,
    normalize_grant_id,
)

BATCH = 200_000
LINK_COLS = ["funder", "key", "serial", "activity", "display", "paperid", "src", "raw", "title", "acronym", "stream"]

SQLITE_DDL = """
CREATE TABLE grant_papers (
  funder TEXT NOT NULL, key TEXT NOT NULL, paperid TEXT NOT NULL,
  sources INTEGER NOT NULL,
  cited_by_count INTEGER NOT NULL DEFAULT 0,
  year INTEGER,
  PRIMARY KEY (funder, key, paperid)
) WITHOUT ROWID;

CREATE TABLE grant_summary (
  funder TEXT NOT NULL, key TEXT NOT NULL,
  serial TEXT, activity TEXT, display TEXT NOT NULL,
  raw_ids TEXT,
  paper_count INTEGER NOT NULL, reported_count INTEGER NOT NULL, acknowledged_count INTEGER NOT NULL,
  src_nih INTEGER NOT NULL, src_nsf INTEGER NOT NULL, src_pubmed INTEGER NOT NULL, src_openaire INTEGER NOT NULL,
  first_year INTEGER, last_year INTEGER,
  title TEXT, acronym TEXT, funding_stream TEXT, funder_name TEXT,
  start_date TEXT, end_date TEXT, funded_amount REAL, currency TEXT, project_count INTEGER,
  PRIMARY KEY (funder, key)
) WITHOUT ROWID;

CREATE TABLE import_meta (key TEXT PRIMARY KEY, value TEXT);
"""

SQLITE_INDEXES = """
CREATE INDEX idx_gp_rank ON grant_papers(funder, key, cited_by_count DESC, sources);
CREATE INDEX idx_gs_key ON grant_summary(key);
CREATE INDEX idx_gs_serial ON grant_summary(serial) WHERE serial IS NOT NULL;
CREATE INDEX idx_gs_top ON grant_summary(paper_count DESC);
"""


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fmt(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    return f"{int(seconds // 3600)}h {int((seconds % 3600) // 60)}m"


def open_ro(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"missing {path}")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


class Stats:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def add(self, k: str, n: int = 1) -> None:
        self.counts[k] = self.counts.get(k, 0) + n


class LinkWriter:
    """Buffers normalized link rows and flushes them into DuckDB via Arrow."""

    def __init__(self, con: duckdb.DuckDBPyConnection, table: str, cols: list[str]):
        self.con, self.table, self.cols = con, table, cols
        self.rows: list[tuple] = []
        self.total = 0

    def add(self, row: tuple) -> None:
        self.rows.append(row)
        if len(self.rows) >= BATCH:
            self.flush()

    def flush(self) -> None:
        if not self.rows:
            return
        columns = list(zip(*self.rows))
        tbl = pa.table({c: pa.array(v) for c, v in zip(self.cols, columns)})
        self.con.register("_batch", tbl)
        self.con.execute(f"INSERT INTO {self.table} SELECT * FROM _batch")
        self.con.unregister("_batch")
        self.total += len(self.rows)
        self.rows.clear()


def link_row(n, paperid: str, src: int, raw: str, title=None, acronym=None, stream=None) -> tuple:
    return (n.funder, n.key, n.serial, n.activity, n.display, paperid, src, raw, title, acronym, stream)


# --------------------------------------------------------------------------- stages

def stage_parquet_links(con, path: Path, hint: str, src_name: str, stats: Stats, limit: int) -> None:
    t0 = time.time()
    w = LinkWriter(con, "links", LINK_COLS)
    src = SOURCE_BITS[src_name]
    read = 0
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(batch_size=BATCH, columns=["paperid", "award_id"]):
        for paperid, award in zip(batch.column("paperid").to_pylist(), batch.column("award_id").to_pylist()):
            read += 1
            n = normalize_grant_id(award, hint)
            if n is None:
                stats.add(f"{src_name}_unparsed")
                continue
            if hint == "NIH" and n.serial is None:
                stats.add("nih_parse_fallback")
            w.add(link_row(n, paperid, src, award))
        if limit and read >= limit:
            break
    w.flush()
    stats.add(f"{src_name}_rows_read", read)
    stats.add(f"{src_name}_links", w.total)
    log(f"  {src_name}: {read:,} rows -> {w.total:,} links in {fmt(time.time() - t0)}")


def stage_pubmed(con, pubmed_db: Path, mesh_db: Path, stats: Stats, limit: int) -> None:
    t0 = time.time()
    con.execute("""CREATE TABLE pubmed_stage (pmid BIGINT, funder VARCHAR, key VARCHAR, serial VARCHAR,
                   activity VARCHAR, display VARCHAR, raw VARCHAR)""")
    w = LinkWriter(con, "pubmed_stage", ["pmid", "funder", "key", "serial", "activity", "display", "raw"])
    src_con = open_ro(pubmed_db)
    cur = src_con.execute("SELECT pmid, grant_id, agency FROM paper_grants")
    read = 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for pmid, grant_id, agency in rows:
            read += 1
            funder = funder_from_pubmed_agency(agency)
            n = normalize_grant_id(grant_id, funder)
            if n is None:
                stats.add("pubmed_unparsed")
                continue
            if funder == "NIH" and n.serial is None:
                stats.add("nih_parse_fallback")
                stats.add("pubmed_nih_fallback")
            if funder == "NIH":
                stats.add("pubmed_nih_rows")
            w.add((pmid, n.funder, n.key, n.serial, n.activity, n.display, grant_id))
        if limit and read >= limit:
            break
    w.flush()
    src_con.close()
    stats.add("pubmed_rows_read", read)
    log(f"  pubmed grants: {read:,} rows -> {w.total:,} parsed in {fmt(time.time() - t0)}")

    # pmid -> paperid from mesh.db (sequential scan; both columns are indexed there
    # but we need the whole mapping, so a scan beats 14M index probes).
    t1 = time.time()
    con.execute("CREATE TABLE pmid_map (paperid VARCHAR, pmid BIGINT)")
    mw = LinkWriter(con, "pmid_map", ["paperid", "pmid"])
    mcon = open_ro(mesh_db)
    mcur = mcon.execute("SELECT paperid, pmid FROM paperid_pmid WHERE pmid IS NOT NULL")
    mread = 0
    while True:
        rows = mcur.fetchmany(BATCH)
        if not rows:
            break
        mread += len(rows)
        for r in rows:
            mw.add(r)
        if limit and mread >= limit * 10:
            break
    mw.flush()
    mcon.close()
    log(f"  pmid map: {mw.total:,} rows in {fmt(time.time() - t1)}")

    con.execute(f"""
        INSERT INTO links
        SELECT p.funder, p.key, p.serial, p.activity, p.display, m.paperid, {SOURCE_BITS['pubmed']},
               p.raw, NULL, NULL, NULL
        FROM pubmed_stage p JOIN pmid_map m USING (pmid)
    """)
    matched = con.execute("SELECT COUNT(*) FROM pubmed_stage p WHERE EXISTS (SELECT 1 FROM pmid_map m WHERE m.pmid = p.pmid)").fetchone()[0]
    stats.add("pubmed_links_matched", matched)
    stats.add("pubmed_links_unmatched", w.total - matched)
    log(f"  pubmed -> paperid: {matched:,} matched, {w.total - matched:,} unmatched "
        f"({(w.total - matched) / max(w.total, 1):.1%} miss)")
    con.execute("DROP TABLE pubmed_stage")
    con.execute("DROP TABLE pmid_map")


def stage_openaire(con, openaire_db: Path, stats: Stats, limit: int) -> None:
    t0 = time.time()
    w = LinkWriter(con, "links", LINK_COLS)
    src = SOURCE_BITS["openaire"]
    ocon = open_ro(openaire_db)
    cur = ocon.execute("SELECT paperid, code, acronym, title, funder_shortname, funding_stream FROM paper_projects")
    read = 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for paperid, code, acronym, title, shortname, stream in rows:
            read += 1
            funder = funder_from_openaire_shortname(shortname)
            n = normalize_grant_id(code, funder)
            if n is None:
                stats.add("openaire_unparsed")
                continue
            if funder == "NIH" and n.serial is None:
                stats.add("nih_parse_fallback")
            w.add(link_row(n, paperid, src, code, title, acronym, stream))
        if limit and read >= limit:
            break
    w.flush()
    stats.add("openaire_rows_read", read)
    stats.add("openaire_links", w.total)
    log(f"  openaire paper_projects: {read:,} rows -> {w.total:,} links in {fmt(time.time() - t0)}")

    t1 = time.time()
    con.execute("""CREATE TABLE project_rows (funder VARCHAR, key VARCHAR, title VARCHAR, acronym VARCHAR,
                   funder_name VARCHAR, stream VARCHAR, start_date VARCHAR, end_date VARCHAR,
                   funded_amount DOUBLE, currency VARCHAR)""")
    pw = LinkWriter(con, "project_rows", ["funder", "key", "title", "acronym", "funder_name", "stream",
                                          "start_date", "end_date", "funded_amount", "currency"])
    cur = ocon.execute("""SELECT code, acronym, title, funder_shortname, funder_name, funding_stream,
                          start_date, end_date, funded_amount, currency FROM projects""")
    pread = 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for code, acronym, title, shortname, funder_name, stream, sd, ed, amt, cur_ in rows:
            pread += 1
            funder = funder_from_openaire_shortname(shortname)
            n = normalize_grant_id(code, funder)
            if n is None:
                continue
            pw.add((n.funder, n.key, title, acronym, funder_name, stream, sd, ed, amt, cur_))
        if limit and pread >= limit:
            break
    pw.flush()
    ocon.close()
    # One NIH project has a row per budget year; collapse them.
    con.execute("""
        CREATE TABLE project_meta AS
        SELECT funder, key,
               arg_max(title, length(coalesce(title, ''))) AS title,
               any_value(acronym) AS acronym,
               any_value(funder_name) AS funder_name,
               any_value(stream) AS funding_stream,
               min(start_date) AS start_date, max(end_date) AS end_date,
               sum(funded_amount) AS funded_amount,
               any_value(currency) AS currency,
               count(*) AS project_count
        FROM project_rows GROUP BY 1, 2
    """)
    con.execute("DROP TABLE project_rows")
    n_meta = con.execute("SELECT COUNT(*) FROM project_meta").fetchone()[0]
    stats.add("openaire_projects_read", pread)
    stats.add("project_meta_rows", n_meta)
    log(f"  openaire projects: {pread:,} rows -> {n_meta:,} grants with metadata in {fmt(time.time() - t1)}")


def stage_papers(con, papers_parquet: Path, citations_db: Path, stats: Stats) -> None:
    t0 = time.time()
    con.execute("""
        CREATE TABLE gp AS
        SELECT funder, key, paperid, bit_or(src)::INTEGER AS sources
        FROM links GROUP BY 1, 2, 3
    """)
    n_gp = con.execute("SELECT COUNT(*) FROM gp").fetchone()[0]
    log(f"  deduped links: {n_gp:,} (funder, key, paper) rows in {fmt(time.time() - t0)}")

    # BIP! counts for OpenAIRE-only papers: one PK seek each in openaire_citations.db.
    t1 = time.time()
    con.execute("CREATE TABLE oa_cites (paperid VARCHAR, cited_by_count INTEGER)")
    oa_ids = [r[0] for r in con.execute("SELECT DISTINCT paperid FROM gp WHERE paperid LIKE 'OA%'").fetchall()]
    found = 0
    if oa_ids and citations_db.exists():
        ccon = open_ro(citations_db)
        stmt = "SELECT citation_count FROM openaire_paper_impact WHERE id = ?"
        ow = LinkWriter(con, "oa_cites", ["paperid", "cited_by_count"])
        for pid in oa_ids:
            row = ccon.execute(stmt, (pid,)).fetchone()
            if row:
                found += 1
                ow.add((pid, int(row[0])))
        ow.flush()
        ccon.close()
    stats.add("oa_ids", len(oa_ids))
    stats.add("oa_ids_with_citations", found)
    log(f"  OpenAIRE-only ids: {len(oa_ids):,}, {found:,} with BIP! counts in {fmt(time.time() - t1)}")

    t2 = time.time()
    con.execute(f"""
        CREATE TABLE grant_papers AS
        SELECT g.funder, g.key, g.paperid, g.sources,
               coalesce(p.cited_by_count, o.cited_by_count, 0)::INTEGER AS cited_by_count,
               p.year::INTEGER AS year
        FROM gp g
        LEFT JOIN (SELECT paperid, year, cited_by_count FROM read_parquet('{papers_parquet}')) p
               ON g.paperid = p.paperid
        LEFT JOIN oa_cites o ON g.paperid = o.paperid
    """)
    con.execute("DROP TABLE gp")
    con.execute("DROP TABLE oa_cites")
    n_final, n_year = con.execute("SELECT COUNT(*), COUNT(year) FROM grant_papers").fetchone()
    stats.add("grant_papers_rows", n_final)
    stats.add("grant_papers_with_year", n_year)
    log(f"  grant_papers: {n_final:,} rows, {n_year:,} with a SciSciNet year, in {fmt(time.time() - t2)}")


def stage_summary(con, stats: Stats) -> None:
    t0 = time.time()
    con.execute("""
        CREATE TABLE raw_top AS
        SELECT funder, key, to_json(list(raw ORDER BY c DESC, raw)) AS raw_ids
        FROM (
            SELECT funder, key, raw, COUNT(*) AS c
            FROM links WHERE raw IS NOT NULL
            GROUP BY 1, 2, 3
            QUALIFY row_number() OVER (PARTITION BY funder, key ORDER BY c DESC, raw) <= 5
        ) GROUP BY 1, 2
    """)
    con.execute("""
        CREATE TABLE link_meta AS
        SELECT funder, key,
               any_value(serial) AS serial, any_value(activity) AS activity,
               mode(display) AS display,
               arg_max(title, length(coalesce(title, ''))) AS oa_title,
               any_value(acronym) AS oa_acronym,
               any_value(stream) AS oa_stream
        FROM links GROUP BY 1, 2
    """)
    con.execute("""
        CREATE TABLE paper_agg AS
        SELECT funder, key,
               COUNT(*) AS paper_count,
               COUNT(*) FILTER (WHERE (sources & 3) != 0) AS reported_count,
               COUNT(*) FILTER (WHERE (sources & 12) != 0) AS acknowledged_count,
               max((sources & 1) != 0)::INTEGER AS src_nih,
               max((sources & 2) != 0)::INTEGER AS src_nsf,
               max((sources & 4) != 0)::INTEGER AS src_pubmed,
               max((sources & 8) != 0)::INTEGER AS src_openaire,
               min(year) AS first_year, max(year) AS last_year
        FROM grant_papers GROUP BY 1, 2
    """)
    con.execute("""
        CREATE TABLE grant_summary AS
        SELECT a.funder, a.key, m.serial, m.activity, m.display, r.raw_ids,
               a.paper_count, a.reported_count, a.acknowledged_count,
               a.src_nih, a.src_nsf, a.src_pubmed, a.src_openaire,
               a.first_year, a.last_year,
               coalesce(pm.title, m.oa_title) AS title,
               coalesce(pm.acronym, m.oa_acronym) AS acronym,
               coalesce(pm.funding_stream, m.oa_stream) AS funding_stream,
               pm.funder_name, pm.start_date, pm.end_date, pm.funded_amount, pm.currency, pm.project_count
        FROM paper_agg a
        JOIN link_meta m USING (funder, key)
        LEFT JOIN raw_top r USING (funder, key)
        LEFT JOIN project_meta pm USING (funder, key)
    """)
    for t in ("raw_top", "link_meta", "paper_agg"):
        con.execute(f"DROP TABLE {t}")
    n = con.execute("SELECT COUNT(*) FROM grant_summary").fetchone()[0]
    titled = con.execute("SELECT COUNT(*) FROM grant_summary WHERE title IS NOT NULL").fetchone()[0]
    stats.add("grant_summary_rows", n)
    stats.add("grant_summary_with_title", titled)
    log(f"  grant_summary: {n:,} grants, {titled:,} with a title, in {fmt(time.time() - t0)}")


def stage_write_sqlite(con, out: Path, stats: Stats, started: float) -> None:
    t0 = time.time()
    build = out.with_suffix(out.suffix + ".build")
    if build.exists():
        build.unlink()
    db = sqlite3.connect(str(build), isolation_level=None)
    db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1000000; PRAGMA page_size=4096;")
    db.executescript(SQLITE_DDL)

    def copy(select_sql: str, insert_sql: str, label: str) -> None:
        t = time.time()
        cur = con.execute(select_sql)
        n = 0
        db.execute("BEGIN")
        while True:
            rows = cur.fetchmany(100_000)
            if not rows:
                break
            db.executemany(insert_sql, rows)
            n += len(rows)
            if n % 2_000_000 == 0:
                log(f"    {label}: {n:,} rows")
        db.execute("COMMIT")
        log(f"  wrote {label}: {n:,} rows in {fmt(time.time() - t)}")

    copy("SELECT funder, key, paperid, sources, cited_by_count, year FROM grant_papers ORDER BY funder, key, paperid",
         "INSERT INTO grant_papers VALUES (?,?,?,?,?,?)", "grant_papers")
    copy("""SELECT funder, key, serial, activity, display, raw_ids, paper_count, reported_count, acknowledged_count,
                   src_nih, src_nsf, src_pubmed, src_openaire, first_year, last_year,
                   title, acronym, funding_stream, funder_name, start_date, end_date, funded_amount, currency, project_count
            FROM grant_summary ORDER BY funder, key""",
         "INSERT INTO grant_summary VALUES (" + ",".join("?" * 24) + ")", "grant_summary")

    t = time.time()
    db.executescript(SQLITE_INDEXES)
    db.execute("ANALYZE")
    log(f"  indexes + ANALYZE in {fmt(time.time() - t)}")

    meta = {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "build_seconds": str(int(time.time() - started)),
        **{k: str(v) for k, v in sorted(stats.counts.items())},
    }
    nih_rows = stats.counts.get("pubmed_nih_rows", 0)
    if nih_rows:
        meta["pubmed_nih_fallback_rate"] = f"{stats.counts.get('pubmed_nih_fallback', 0) / nih_rows:.4f}"
    db.executemany("INSERT INTO import_meta VALUES (?, ?)", list(meta.items()))
    ok = db.execute("PRAGMA quick_check").fetchone()[0]
    db.close()
    if ok != "ok":
        sys.exit(f"quick_check failed: {ok}")
    os.replace(build, out)
    log(f"  {out} ({out.stat().st_size / 1e9:.2f} GB) written in {fmt(time.time() - t0)}")


def print_checks(out: Path) -> None:
    db = open_ro(out)
    print("\nspot checks:")
    for label, sql in [
        ("grant_papers rows", "SELECT COUNT(*) FROM grant_papers"),
        ("grant_summary rows", "SELECT COUNT(*) FROM grant_summary"),
        ("NIH R25MH101072", "SELECT paper_count, reported_count, acknowledged_count, title FROM grant_summary WHERE funder='NIH' AND key='R25MH101072'"),
        ("serial AG066215", "SELECT funder, key, paper_count FROM grant_summary WHERE serial='AG066215'"),
        ("key 1907207", "SELECT funder, key, paper_count FROM grant_summary WHERE key='1907207'"),
        ("EC 733280", "SELECT paper_count, title FROM grant_summary WHERE funder='EC' AND key='733280'"),
        ("UKRI STW0018451", "SELECT paper_count, display, title FROM grant_summary WHERE funder='UKRI' AND key='STW0018451'"),
        ("top funders", "SELECT funder, COUNT(*) FROM grant_summary GROUP BY 1 ORDER BY 2 DESC LIMIT 12"),
        ("largest grants", "SELECT funder, key, paper_count FROM grant_summary ORDER BY paper_count DESC LIMIT 5"),
        ("page plan", "EXPLAIN QUERY PLAN SELECT paperid FROM grant_papers WHERE funder='NIH' AND key='R25MH101072' AND (sources & 3) != 0 ORDER BY cited_by_count DESC LIMIT 50 OFFSET 100"),
    ]:
        try:
            rows = db.execute(sql).fetchall()
        except sqlite3.Error as e:
            rows = [(f"error: {e}",)]
        print(f"  {label}:")
        for r in rows:
            print(f"    {r}")
    db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = Path(__file__).resolve().parent.parent
    ap.add_argument("--data-dir", type=Path, default=Path("/mnt/metascience/sciscinet-v2"))
    ap.add_argument("--db-dir", type=Path, default=root / "data")
    ap.add_argument("--out", type=Path, default=None, help="default: <db-dir>/grants.db")
    ap.add_argument("--work-dir", type=Path, required=True)
    ap.add_argument("--memory-limit", default="4GB")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="rows per source (dry run; pmid map gets 10x)")
    ap.add_argument("--skip-pubmed", action="store_true")
    ap.add_argument("--skip-openaire", action="store_true")
    ap.add_argument("--force", action="store_true", help="overwrite an existing output file")
    args = ap.parse_args()

    out = args.out or (args.db_dir / "grants.db")
    if out.exists() and not args.force:
        sys.exit(f"{out} exists; pass --force to replace it")
    args.work_dir.mkdir(parents=True, exist_ok=True)
    (args.work_dir / "tmp").mkdir(exist_ok=True)
    work_db = args.work_dir / "grants_work.duckdb"
    if work_db.exists():
        work_db.unlink()

    started = time.time()
    stats = Stats()
    con = duckdb.connect(str(work_db))
    con.execute(f"SET memory_limit='{args.memory_limit}'")
    con.execute(f"SET threads={args.threads}")
    con.execute(f"SET temp_directory='{args.work_dir / 'tmp'}'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("""CREATE TABLE links (funder VARCHAR, key VARCHAR, serial VARCHAR, activity VARCHAR, display VARCHAR,
                   paperid VARCHAR, src INTEGER, raw VARCHAR, title VARCHAR, acronym VARCHAR, stream VARCHAR)""")
    con.execute("""CREATE TABLE project_meta (funder VARCHAR, key VARCHAR, title VARCHAR, acronym VARCHAR,
                   funder_name VARCHAR, funding_stream VARCHAR, start_date VARCHAR, end_date VARCHAR,
                   funded_amount DOUBLE, currency VARCHAR, project_count BIGINT)""")

    log(f"stage 1/5: SciSciNet link files (limit={args.limit or 'none'})")
    stage_parquet_links(con, args.data_dir / "sciscinet_link_nih.parquet", "NIH", "nih_exporter", stats, args.limit)
    stage_parquet_links(con, args.data_dir / "sciscinet_link_nsf.parquet", "NSF", "nsf", stats, args.limit)

    if args.skip_pubmed:
        log("stage 2/5: pubmed skipped")
    else:
        log("stage 2/5: PubMed grant field")
        stage_pubmed(con, args.db_dir / "pubmed.db", args.db_dir / "mesh.db", stats, args.limit)

    if args.skip_openaire:
        log("stage 3/5: openaire skipped")
    else:
        log("stage 3/5: OpenAIRE projects")
        con.execute("DROP TABLE project_meta")
        stage_openaire(con, args.db_dir / "openaire.db", stats, args.limit)

    log("stage 4/5: dedupe + citation snapshot + summary")
    stage_papers(con, args.data_dir / "sciscinet_papers.parquet", args.db_dir / "openaire_citations.db", stats)
    stage_summary(con, stats)

    log("stage 5/5: write SQLite")
    stage_write_sqlite(con, out, stats, started)
    con.close()
    work_db.unlink(missing_ok=True)

    log(f"done in {fmt(time.time() - started)}")
    for k, v in sorted(stats.counts.items()):
        print(f"  {k:32} {v:>14,}")
    print_checks(out)


if __name__ == "__main__":
    main()
