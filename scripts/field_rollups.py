#!/usr/bin/env python3
"""Build the per-field "top" tables behind /fields/[fieldid] in journals.db.

lib/queries/fields.ts reads four precomputed tables that the original
preprocess_duckdb.py never produced: its top-papers/top-authors steps were
disabled after an OOM at 26 GB, and its normalized-citations step never ran.
This script builds them as a one-off add-on, in the same spirit as
add_avg_c10.py: read the parquets with DuckDB, write small result tables into
journals.db with plain sqlite3 while prod keeps serving (WAL mode allows one
writer alongside the readonly workers).

Tables produced (~35k rows in total):
  field_top_cited_papers_level0 / _level1   top 20 per field by normalized_citations
  field_top_papers                          top 50 per field by raw citation count
  field_top_authors                         top 50 per field by distinct paper count

WHY THE OLD QUERIES DIED AND THIS ONE DOESN'T
  The originals joined titles/sources onto billions of rows and then ranked with
  ROW_NUMBER() OVER (PARTITION BY fieldid). Here the ranking happens first, with
  DuckDB's bounded top-N aggregate max_by(x, score, n) over only 303 groups, and
  titles/names are looked up afterwards for the few thousand winners from the
  already-indexed SQLite tables paper_summary / person_summary.

  Top authors still need paperfields (1.27B rows) joined to author-paper pairs
  (773M rows). Instead of one enormous GROUP BY (fieldid, authorid), the script
  runs passes with a falling threshold T on each author's total paper count: an
  author with fewer than T papers in total cannot have more than T in any field,
  so once a field's 50th-ranked count is >= T its top-50 is provably exact and
  the field is dropped from later passes. Pass 1 (T=200) keeps the hash-join
  build side in memory and streams the probe; later passes touch only leftovers.

Usage:
  mkdir -p /mnt/metascience/field_rollups_work
  nice -n 19 ionice -c2 -n7 nohup python3 scripts/field_rollups.py \
      > /mnt/metascience/field_rollups_work/run.log 2>&1 &

THIS MACHINE HOSTS THE SITE. Defaults are deliberately frugal (6 GB DuckDB
buffer, 2 threads) and everything large spills to --work-dir on disk instead
of RAM. Keep it that way; raising --threads or --memory-limit buys speed by
taking it from prod.

  --skip-papers / --skip-authors run one half; --force replaces existing tables;
  --verify-fields C41008148,C86803240 recomputes those fields with no threshold
  and asserts the result matches (proof the threshold trick lost nothing).

Do not run alongside scripts/backup_to_seagate.sh. Never VACUUM journals.db.
"""

import argparse
import shutil
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import duckdb

THRESHOLDS = [200, 50, 15, 5, 1]
TOP_NORMALIZED = 20
TOP_RAW = 50
TOP_AUTHORS = 50
MAX_MISS_RATE = 0.01  # a higher lookup miss rate means an id-format mismatch, not missing rows

DDL = {
    "field_top_cited_papers_level0": """
        CREATE TABLE field_top_cited_papers_level0(
            fieldid TEXT NOT NULL, paperid TEXT NOT NULL, title TEXT, year INTEGER,
            citation_count INTEGER NOT NULL, normalized_citations REAL NOT NULL, source_name TEXT)""",
    "field_top_cited_papers_level1": """
        CREATE TABLE field_top_cited_papers_level1(
            fieldid TEXT NOT NULL, paperid TEXT NOT NULL, title TEXT, year INTEGER,
            citation_count INTEGER NOT NULL, normalized_citations REAL NOT NULL, source_name TEXT)""",
    "field_top_papers": """
        CREATE TABLE field_top_papers(
            fieldid TEXT NOT NULL, paperid TEXT NOT NULL, title TEXT, year INTEGER,
            cited_by_count INTEGER NOT NULL, source_name TEXT)""",
    "field_top_authors": """
        CREATE TABLE field_top_authors(
            fieldid TEXT NOT NULL, authorid TEXT NOT NULL, display_name TEXT NOT NULL,
            h_index INTEGER, paper_count INTEGER NOT NULL)""",
}
PAPER_TABLES = ["field_top_cited_papers_level0", "field_top_cited_papers_level1", "field_top_papers"]
AUTHOR_TABLES = ["field_top_authors"]


def fmt(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    return f"{int(seconds // 3600)}h {int((seconds % 3600) // 60)}m"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def sql_list(ids) -> str:
    return ",".join("'" + i.replace("'", "''") + "'" for i in ids)


# --------------------------------------------------------------------------- SQLite

def open_ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def open_rw(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path), isolation_level=None, timeout=60)
    con.execute("PRAGMA busy_timeout = 60000")
    return con


def sqlite_table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def write_table(db_path: Path, name: str, rows, force: bool) -> None:
    """One table per transaction: readers see the old state or the complete new one."""
    con = open_rw(db_path)
    try:
        t0 = time.time()
        con.execute("BEGIN IMMEDIATE")
        if sqlite_table_exists(con, name):
            if not force:
                raise SystemExit(f"{name} already exists in {db_path}; rerun with --force to replace it")
            con.execute(f"DROP TABLE {name}")
        con.execute(DDL[name])
        placeholders = ",".join("?" * len(rows[0]))
        con.executemany(f"INSERT INTO {name} VALUES ({placeholders})", rows)
        con.execute(f"CREATE INDEX idx_{name}_fieldid ON {name}(fieldid)")
        con.execute("COMMIT")
        log(f"  wrote {name}: {len(rows):,} rows in {fmt(time.time() - t0)}")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def refuse_if_present(db_path: Path, names, force: bool) -> None:
    con = open_ro(db_path)
    try:
        present = [n for n in names if sqlite_table_exists(con, n)]
    finally:
        con.close()
    if present and not force:
        raise SystemExit(
            f"Already present in {db_path}: {', '.join(present)}. Rerun with --force to replace them."
        )


def load_fields(db_path: Path):
    con = open_ro(db_path)
    try:
        rows = con.execute(
            "SELECT fieldid, level FROM field_summary WHERE level <= 1 ORDER BY level, fieldid"
        ).fetchall()
    finally:
        con.close()
    if not rows:
        raise SystemExit("field_summary has no level<=1 rows")
    return rows


# --------------------------------------------------------------------------- DuckDB

def connect_duck(args) -> duckdb.DuckDBPyConnection:
    major, minor = (int(x) for x in duckdb.__version__.split(".")[:2])
    if (major, minor) < (1, 1):
        raise SystemExit(f"duckdb {duckdb.__version__} is too old; max_by(x, score, n) needs >= 1.1")
    tmp = args.work_dir / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(args.work_dir / "field_rollups.duckdb"))
    con.execute(f"SET memory_limit = '{args.memory_limit}'")
    con.execute(f"SET threads = {args.threads}")
    con.execute(f"SET temp_directory = '{tmp}'")
    con.execute("SET max_temp_directory_size = '150GB'")
    con.execute("SET preserve_insertion_order = false")
    return con


def duck_table_exists(con, name: str) -> bool:
    return con.execute(
        "SELECT count(*) FROM duckdb_tables() WHERE table_name = ?", [name]
    ).fetchone()[0] > 0


def timed(con, label: str, sql: str, params=None):
    t0 = time.time()
    log(f"  {label} ...")
    cur = con.execute(sql, params or [])
    log(f"  {label} done in {fmt(time.time() - t0)}")
    return cur


# --------------------------------------------------------------------------- papers

def build_papers(duck, args, fields):
    level_ids = defaultdict(list)
    for fieldid, level in fields:
        level_ids[level].append(fieldid)

    norm_rows = {0: [], 1: []}   # (fieldid, paperid, year, citation_count, normalized_citations)
    raw_rows = []                # (fieldid, paperid, citation_count)
    for level in (0, 1):
        path = args.data_dir / f"normalized_citations_level{level}.parquet"
        if not path.exists():
            raise SystemExit(f"missing {path}")
        # NaN sorts above every number in DuckDB and NaN > 0 is true, hence isfinite().
        sql = f"""
            WITH src AS (
                SELECT fieldid, paperid, year, citation_count, normalized_citations
                FROM read_parquet('{path}')
                WHERE fieldid IN ({sql_list(level_ids[level])})
                  AND isfinite(normalized_citations) AND normalized_citations > 0
            ),
            agg AS (
                SELECT fieldid,
                       max_by({{'paperid': paperid, 'year': year, 'cc': citation_count, 'nc': normalized_citations}},
                              normalized_citations, {TOP_NORMALIZED}) AS top_norm,
                       max_by({{'paperid': paperid, 'cc': citation_count}}, citation_count, {TOP_RAW}) AS top_raw
                FROM src GROUP BY fieldid
            )
            SELECT 'norm' AS kind, fieldid, u.paperid, u.year, u.cc, u.nc
            FROM (SELECT fieldid, unnest(top_norm) AS u FROM agg)
            UNION ALL
            SELECT 'raw', fieldid, u.paperid, NULL, u.cc, NULL
            FROM (SELECT fieldid, unnest(top_raw) AS u FROM agg)
        """
        rows = timed(duck, f"scan normalized_citations_level{level}", sql).fetchall()
        for kind, fieldid, paperid, year, cc, nc in rows:
            if kind == "norm":
                norm_rows[level].append((fieldid, paperid, year, cc, nc))
            else:
                raw_rows.append((fieldid, paperid, cc))
        covered = {r[0] for r in norm_rows[level]}
        missing = set(level_ids[level]) - covered
        log(f"  level {level}: {len(covered)}/{len(level_ids[level])} fields covered"
            + (f"; MISSING {sorted(missing)}" if missing else ""))

    paper_ids = {r[1] for r in norm_rows[0]} | {r[1] for r in norm_rows[1]} | {r[1] for r in raw_rows}
    log(f"  looking up {len(paper_ids):,} papers in paper_summary")
    ro = open_ro(args.db)
    info = {}
    try:
        for pid in paper_ids:
            row = ro.execute(
                "SELECT title, year, cited_by_count, source_name FROM paper_summary WHERE paperid = ?",
                (pid,),
            ).fetchone()
            if row:
                info[pid] = row
    finally:
        ro.close()
    miss = 1 - len(info) / len(paper_ids)
    log(f"  paper_summary misses: {len(paper_ids) - len(info):,} ({miss:.2%})")
    if miss > MAX_MISS_RATE:
        raise SystemExit("too many paper_summary misses -- id format mismatch?")

    out = {}
    for level in (0, 1):
        out[f"field_top_cited_papers_level{level}"] = [
            (fieldid, pid, (info.get(pid) or (None,))[0], year if year is not None else (info.get(pid) or (None, None))[1],
             int(cc), float(nc), (info.get(pid) or (None, None, None, None))[3])
            for fieldid, pid, year, cc, nc in norm_rows[level]
        ]
    out["field_top_papers"] = [
        (fieldid, pid, (info.get(pid) or (None,))[0], (info.get(pid) or (None, None))[1],
         int((info.get(pid) or (None, None, cc))[2] if info.get(pid) and info[pid][2] is not None else cc),
         (info.get(pid) or (None, None, None, None))[3])
        for fieldid, pid, cc in raw_rows
    ]
    return out


# --------------------------------------------------------------------------- authors

def build_author_inputs(duck, args, fields):
    ids = [f for f, _ in fields]
    duck.execute("CREATE OR REPLACE TABLE fields(fieldid VARCHAR, level INTEGER)")
    duck.executemany("INSERT INTO fields VALUES (?, ?)", [(f, int(l)) for f, l in fields])

    ap_path = args.data_dir / "sciscinet_authors_paperid.parquet"
    pf_path = args.data_dir / "sciscinet_paperfields.parquet"
    for p in (ap_path, pf_path):
        if not p.exists():
            raise SystemExit(f"missing {p}")

    if duck_table_exists(duck, "ap"):
        log("  ap exists (skipping)")
    else:
        timed(duck, "materialize ap (author-paper pairs, integer keys)", f"""
            CREATE TABLE ap AS
            SELECT TRY_CAST(substr(authorid, 2) AS BIGINT) AS aid,
                   TRY_CAST(substr(paperid, 2) AS BIGINT) AS pid
            FROM read_parquet('{ap_path}')
        """)
    null_pid = duck.execute("SELECT count(*) FROM ap WHERE pid IS NULL").fetchone()[0]
    if null_pid:
        raise SystemExit(f"{null_pid:,} ap rows have non-numeric paper ids")
    # ~1.7M authorship rows (0.2%) carry a NULL authorid in the source parquet. They
    # cannot be credited to anyone, so they are dropped rather than treated as an error.
    null_aid = duck.execute("SELECT count(*) FROM ap WHERE aid IS NULL").fetchone()[0]
    if null_aid:
        duck.execute("DELETE FROM ap WHERE aid IS NULL")
        log(f"  dropped {null_aid:,} ap rows with NULL authorid")
    # count(*) downstream must be a distinct-paper count. A full DISTINCT over 773M
    # rows would spill tens of GB, so only pay for it if a 1/997 sample finds dups.
    dups = duck.execute("""
        SELECT count(*) FROM (
            SELECT aid, pid FROM ap WHERE pid % 997 = 0 GROUP BY ALL HAVING count(*) > 1)
    """).fetchone()[0]
    if dups:
        log(f"  ap has duplicate (author, paper) rows ({dups:,} in sample); deduplicating")
        timed(duck, "dedupe ap", "CREATE OR REPLACE TABLE ap AS SELECT DISTINCT aid, pid FROM ap")

    if duck_table_exists(duck, "pf"):
        log("  pf exists (skipping)")
    else:
        timed(duck, "materialize pf (paper-field pairs, level<=1)", f"""
            CREATE TABLE pf AS
            SELECT TRY_CAST(substr(paperid, 2) AS BIGINT) AS pid, fieldid
            FROM read_parquet('{pf_path}')
            WHERE fieldid IN ({sql_list(ids)})
        """)
    nulls = duck.execute("SELECT count(*) FROM pf WHERE pid IS NULL").fetchone()[0]
    if nulls:
        raise SystemExit(f"{nulls:,} pf rows have non-numeric ids")
    dups = duck.execute("""
        SELECT count(*) FROM (
            SELECT pid, fieldid FROM pf WHERE pid % 997 = 0 GROUP BY ALL HAVING count(*) > 1)
    """).fetchone()[0]
    if dups:
        raise SystemExit(f"pf has duplicate (paper, field) rows ({dups:,} in a 1/997 sample); add DISTINCT")

    if duck_table_exists(duck, "author_n"):
        log("  author_n exists (skipping)")
    else:
        timed(duck, "materialize author_n (total papers per author)",
              "CREATE TABLE author_n AS SELECT aid, count(*) AS n FROM ap GROUP BY aid")
    n_ap, n_pf, n_au = (duck.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("ap", "pf", "author_n"))
    log(f"  ap={n_ap:,} pf={n_pf:,} author_n={n_au:,}")


def top_authors_pass(duck, pf_src: str, threshold: int):
    timed(duck, f"build side: authors with >= {threshold} papers", """
        CREATE OR REPLACE TABLE big_ap AS
        SELECT a.aid, a.pid FROM ap a JOIN author_n USING (aid) WHERE n >= ?
    """, [threshold])
    rows = timed(duck, f"top-{TOP_AUTHORS} per field at T={threshold}", f"""
        SELECT fieldid, u.aid, u.n
        FROM (
            SELECT fieldid, unnest(max_by({{'aid': aid, 'n': n}}, n, {TOP_AUTHORS})) AS u
            FROM (SELECT p.fieldid, b.aid, count(*) AS n
                  FROM {pf_src} p JOIN big_ap b USING (pid)
                  GROUP BY 1, 2)
            GROUP BY fieldid)
    """).fetchall()
    by_field = defaultdict(list)
    for fieldid, aid, n in rows:
        by_field[fieldid].append((int(aid), int(n)))
    return by_field


def build_authors(duck, args, fields):
    build_author_inputs(duck, args, fields)
    ids = [f for f, _ in fields]
    remaining = set(ids)
    final = {}
    pf_src = "pf"
    for threshold in THRESHOLDS:
        if not remaining:
            break
        if len(remaining) < len(ids):
            # Shrink the probe side to the unresolved fields so later passes are cheap.
            timed(duck, f"materialize pf_r for {len(remaining)} unresolved fields", f"""
                CREATE OR REPLACE TABLE pf_r AS
                SELECT * FROM {pf_src} WHERE fieldid IN ({sql_list(sorted(remaining))})
            """)
            pf_src = "pf_r"
        by_field = top_authors_pass(duck, pf_src, threshold)
        resolved = 0
        for fieldid in sorted(remaining):
            top = sorted(by_field.get(fieldid, []), key=lambda r: -r[1])
            if top and (threshold == 1 or (len(top) == TOP_AUTHORS and top[-1][1] >= threshold)):
                final[fieldid] = top
                resolved += 1
        remaining -= set(final)
        log(f"  T={threshold}: resolved {resolved} fields, {len(remaining)} left")
    missing = set(ids) - set(final)
    if missing:
        raise SystemExit(f"no authors found for fields {sorted(missing)}")

    if args.verify_fields:
        verify_authors(duck, args.verify_fields, final)

    author_ids = {aid for top in final.values() for aid, _ in top}
    log(f"  looking up {len(author_ids):,} authors in person_summary")
    ro = open_ro(args.db)
    info = {}
    try:
        for aid in author_ids:
            row = ro.execute(
                "SELECT display_name, h_index FROM person_summary WHERE authorid = ?", (f"A{aid}",)
            ).fetchone()
            if row:
                info[aid] = row
    finally:
        ro.close()
    miss = 1 - len(info) / len(author_ids)
    log(f"  person_summary misses: {len(author_ids) - len(info):,} ({miss:.2%})")
    if miss > MAX_MISS_RATE:
        raise SystemExit("too many person_summary misses -- id format mismatch?")

    rows = []
    for fieldid in ids:
        for aid, n in final[fieldid]:
            name, h = info.get(aid, (None, None))
            rows.append((fieldid, f"A{aid}", name or f"A{aid}", h, n))
    return {"field_top_authors": rows}


def verify_authors(duck, fieldids, final):
    """Recompute named fields with no threshold; the top-50 must agree (ties at rank 50 aside)."""
    for fieldid in fieldids:
        if fieldid not in final:
            raise SystemExit(f"--verify-fields: {fieldid} is not a level<=1 field")
        rows = timed(duck, f"verify {fieldid} without threshold", f"""
            SELECT aid, count(*) AS n FROM pf p JOIN ap USING (pid)
            WHERE p.fieldid = ? GROUP BY aid ORDER BY n DESC LIMIT {TOP_AUTHORS}
        """, [fieldid]).fetchall()
        exact = [(int(a), int(n)) for a, n in rows]
        got = final[fieldid]
        counts_match = [n for _, n in exact] == [n for _, n in got]
        cutoff = exact[-1][1]
        above_exact = {a for a, n in exact if n > cutoff}
        above_got = {a for a, n in got if n > cutoff}
        if not counts_match or above_exact != above_got:
            raise SystemExit(f"VERIFY FAILED for {fieldid}: threshold result differs from exact computation")
        log(f"  verify {fieldid}: OK ({len(exact)} rows, 50th count = {cutoff})")


# --------------------------------------------------------------------------- main

def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=Path("/mnt/metascience/sciscinet-v2"))
    ap.add_argument("--db", type=Path, default=repo / "data" / "journals.db")
    ap.add_argument("--work-dir", type=Path, default=Path("/mnt/metascience/field_rollups_work"),
                    help="file-backed DuckDB db + spill directory; NOT /tmp (tmpfs)")
    ap.add_argument("--memory-limit", default="6GB",
                    help="DuckDB buffer cap; everything larger spills to --work-dir")
    ap.add_argument("--threads", type=int, default=2, help="keep low: prod runs on this box")
    ap.add_argument("--skip-papers", action="store_true")
    ap.add_argument("--skip-authors", action="store_true")
    ap.add_argument("--force", action="store_true", help="replace tables that already exist")
    ap.add_argument("--keep-work", action="store_true", help="keep the DuckDB work db after success")
    ap.add_argument("--verify-fields", default="",
                    help="comma-separated fieldids to recompute without the threshold trick")
    args = ap.parse_args()
    args.verify_fields = [f for f in args.verify_fields.split(",") if f]

    if not args.db.exists():
        raise SystemExit(f"missing {args.db}")
    targets = ([] if args.skip_papers else PAPER_TABLES) + ([] if args.skip_authors else AUTHOR_TABLES)
    if not targets:
        raise SystemExit("nothing to do")
    refuse_if_present(args.db, targets, args.force)

    fields = load_fields(args.db)
    log(f"{len(fields)} fields (level<=1); db={args.db}; data={args.data_dir}; work={args.work_dir}")
    duck = connect_duck(args)
    t_all = time.time()

    if not args.skip_papers:
        log("== top papers")
        tables = build_papers(duck, args, fields)
        for name in PAPER_TABLES:
            write_table(args.db, name, tables[name], args.force)

    if not args.skip_authors:
        log("== top authors")
        tables = build_authors(duck, args, fields)
        write_table(args.db, "field_top_authors", tables["field_top_authors"], args.force)

    duck.close()
    con = open_rw(args.db)
    try:
        con.execute("PRAGMA wal_checkpoint(PASSIVE)")
    finally:
        con.close()

    if not args.keep_work:
        shutil.rmtree(args.work_dir, ignore_errors=True)
        log(f"removed {args.work_dir}")
    log(f"done in {fmt(time.time() - t_all)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
