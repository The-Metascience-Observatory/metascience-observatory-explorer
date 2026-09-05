#!/usr/bin/env python3
"""Backfill BiP! impact indicators for first-class OpenAIRE papers — Phase 1.

The original Pass 3 (openaire_import_publications.py) streamed all 218.4M
publication records but never read `indicators.citationImpact`, so the 33.5M
OpenAIRE-only papers shipped with no citation count at all. This re-streams the
same tars -- already on disk, no download -- and extracts only that field.

Indicators come from BiP! (Bibliometric Indicators, ATHENA Research Center),
redistributed inside the OpenAIRE Graph under CC-BY:
    citationCount  raw citations       + citationClass   C1..C5 percentile band
    influence      long-term impact    + influenceClass    (PageRank-family)
    popularity     current attention   + popularityClass   (AttRank, time-aware)
    impulse        early momentum      + impulseClass      (fixed 3-year window)

Classes are percentile bands: C1 top 0.01%, C2 top 0.1%, C3 top 1%, C4 top 10%,
C5 bottom 90%.

Only rows with citation_count > 0 are stored (~13.0M of 33.5M); absence means
zero. The table is keyed by the STABLE TEXT id, not openaire_papers.rowid, so a
stale table degrades to misses rather than to wrong numbers on the wrong papers.

Counts for the 140.9M SciSciNet-MATCHED papers are deliberately NOT stored:
paper_summary.cited_by_count is authoritative for those and a second,
differently-derived number on the same page invites "which one is right?".
Pass --include-matched only for an explicit coverage comparison.

Usage:
  python3 openaire_import_citation_counts.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --keymap-dir /media/dan/metascience/openaire-build/keymap \
    --db-path /media/dan/metascience/openaire-build/openaire_citations.db \
    --workers 8 [--rebuild] [--limit-members N]
"""

import argparse
import glob
import gzip
import multiprocessing as mp
import re
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import stream_tar_members

try:
    import orjson

    def json_loads(b):
        return orjson.loads(b)
except ImportError:
    import json

    def json_loads(b):
        return json.loads(b)

BATCH = 10_000

DDL = """
CREATE TABLE IF NOT EXISTS openaire_paper_impact (
  id               TEXT PRIMARY KEY,   -- 'OA' + 32hex == openaire_papers.id
  citation_count   INTEGER NOT NULL,
  citation_class   TEXT,
  influence        REAL,
  influence_class  TEXT,
  popularity       REAL,
  popularity_class TEXT,
  impulse          INTEGER,
  impulse_class    TEXT
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT);
"""

# Merge duplicates (a dedup record and its non-dedup twin can both carry
# indicators for the same DOI) by keeping the larger count.
UPSERT = """
INSERT INTO openaire_paper_impact VALUES (?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  citation_count=excluded.citation_count, citation_class=excluded.citation_class,
  influence=excluded.influence, influence_class=excluded.influence_class,
  popularity=excluded.popularity, popularity_class=excluded.popularity_class,
  impulse=excluded.impulse, impulse_class=excluded.impulse_class
WHERE excluded.citation_count > openaire_paper_impact.citation_count
"""

# `citationImpact` is a flat object (verified across the dump), so a non-greedy
# brace-free match is safe and ~6x faster than json.loads on the whole record.
RCI = re.compile(rb'"citationImpact":\{([^{}]*)\}')
RID = re.compile(rb'"id":"[A-Za-z0-9_.\-]+::([0-9a-f]{32})"')
CC_KEY = b'"citationCount":'

# Set in each forked worker by _init (see main); mmap-backed so all workers
# share one page-cache copy of the ~4.2 GB map instead of 4.2 GB each.
MAP_LO = MAP_HI = MAP_VAL = None
INCLUDE_MATCHED = False


def _init(keymap_dir, include_matched):
    global MAP_LO, MAP_HI, MAP_VAL, INCLUDE_MATCHED
    d = Path(keymap_dir)
    MAP_LO = np.load(d / "map_lo.npy", mmap_mode="r")
    MAP_HI = np.load(d / "map_hi.npy", mmap_mode="r")
    MAP_VAL = np.load(d / "map_val.npy", mmap_mode="r")
    INCLUDE_MATCHED = include_matched


def _hex_to_u64(hexbytes):
    """16 ASCII hex bytes -> int. Local (non-vectorized) fast path."""
    return int(hexbytes, 16)


def worker(blob):
    """Parse one gzipped tar member; return impact rows for OpenAIRE-only papers.

    Returns (n_lines, n_with_impact, [(id, cc, cclass, infl, iclass, pop, pclass, imp, mclass)]).
    """
    n_lines = n_impact = 0
    hexes, payloads = [], []
    for line in gzip.decompress(blob).split(b"\n"):
        if not line:
            continue
        n_lines += 1
        m = RCI.search(line)
        if m is None:
            continue
        body = m.group(1)
        # Reject the ~61% with no citations BEFORE the id regex, which has to
        # scan ~40% into a 4 KB line. Order matters for throughput.
        i = body.find(CC_KEY)
        if i < 0:
            continue
        j = body.find(b",", i)
        try:
            cc = int(float(body[i + len(CC_KEY) : j if j > 0 else len(body)]))
        except ValueError:
            continue
        if cc <= 0:
            continue
        mid = RID.search(line)
        if mid is None:
            continue
        n_impact += 1
        hexes.append(mid.group(1))
        payloads.append((body, cc))

    if not hexes:
        return n_lines, n_impact, []

    # Vectorized membership: exact 128-bit match against the key map.
    lo = np.fromiter((_hex_to_u64(h[:16]) for h in hexes), np.uint64, len(hexes))
    hi = np.fromiter((_hex_to_u64(h[16:]) for h in hexes), np.uint64, len(hexes))
    pos = np.searchsorted(MAP_LO, lo)
    np.clip(pos, 0, len(MAP_LO) - 1, out=pos)
    ok = (MAP_LO[pos] == lo) & (MAP_HI[pos] == hi)
    val = np.where(ok, MAP_VAL[pos], 0)
    keep = val < 0 if not INCLUDE_MATCHED else val != 0

    rows = []
    for idx in np.flatnonzero(keep):
        body, cc = payloads[idx]
        try:
            d = json_loads(b"{" + body + b"}")
        except Exception:
            continue
        imp = d.get("impulse")
        rows.append(
            (
                "OA" + hexes[idx].decode(),
                cc,
                d.get("citationClass"),
                d.get("influence"),
                d.get("influenceClass"),
                d.get("popularity"),
                d.get("popularityClass"),
                int(imp) if imp is not None else None,
                d.get("impulseClass"),
            )
        )
    return n_lines, n_impact, rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--keymap-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--tar-glob", default="publication_*.tar")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--include-matched", action="store_true",
                    help="also store counts for SciSciNet-matched papers (NOT the default)")
    ap.add_argument("--limit-members", type=int, default=0, help="testing: stop after N members")
    args = ap.parse_args()

    tars = sorted(
        glob.glob(str(Path(args.dump_dir) / args.tar_glob)),
        key=lambda p: (len(p), p),  # publication_2 before publication_10
    )
    if not tars:
        sys.exit(f"no tars matching {args.tar_glob} in {args.dump_dir}")

    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    if args.rebuild:
        out.execute("DROP TABLE IF EXISTS openaire_paper_impact")
        out.execute("DELETE FROM import_meta WHERE key LIKE 'impact_%'")
    out.executescript(DDL)

    done_tars = {
        r[0] for r in out.execute("SELECT value FROM import_meta WHERE key LIKE 'impact_tar_done:%'")
    }

    grand = {"lines": 0, "impact": 0, "kept": 0, "members": 0}
    t_all = time.time()

    ctx = mp.get_context("fork")
    with ctx.Pool(args.workers, initializer=_init,
                  initargs=(args.keymap_dir, args.include_matched)) as pool:
        for tar_path in tars:
            name = Path(tar_path).name
            if name in done_tars:
                print(f"skip {name} (already done)")
                continue
            print(f"processing {name}...")
            t0 = time.time()
            stats = {"lines": 0, "impact": 0, "kept": 0}
            buf = []

            def members():
                for i, blob in enumerate(stream_tar_members(Path(tar_path))):
                    if args.limit_members and i >= args.limit_members:
                        return
                    yield blob

            for n_lines, n_impact, rows in pool.imap_unordered(worker, members(), chunksize=1):
                stats["lines"] += n_lines
                stats["impact"] += n_impact
                grand["members"] += 1
                buf.extend(rows)
                if len(buf) >= BATCH:
                    out.executemany(UPSERT, buf)
                    stats["kept"] += len(buf)
                    buf.clear()
                if grand["members"] % 100 == 0:
                    el = time.time() - t0
                    print(f"  {stats['lines']:,} lines ({stats['lines'] / el:,.0f}/s), "
                          f"kept={stats['kept']:,}", end="\r", flush=True)
            if buf:
                out.executemany(UPSERT, buf)
                stats["kept"] += len(buf)
            out.execute("INSERT OR REPLACE INTO import_meta VALUES (?, ?)",
                        (f"impact_tar_done:{name}", name))
            out.commit()
            for k in stats:
                grand[k] += stats[k]
            print(f"  {name}: {stats['lines']:,} lines, {stats['impact']:,} with citations, "
                  f"{stats['kept']:,} kept in {(time.time() - t0) / 60:.1f} min" + " " * 12)

    n = out.execute("SELECT COUNT(*) FROM openaire_paper_impact").fetchone()[0]
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('impact_rows', ?)", (str(n),))
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('impact_scanned_records', ?)",
                (str(grand["lines"]),))
    out.execute("INSERT OR REPLACE INTO import_meta VALUES "
                "('impact_imported_at', datetime('now'))")
    out.commit()
    print("ANALYZE...")
    out.execute("ANALYZE")
    out.commit()

    print(f"\nDone: {grand['lines']:,} records scanned, {grand['impact']:,} with citations>0, "
          f"{n:,} impact rows in {(time.time() - t_all) / 60:.1f} min")
    for label, q in [
        ("citation_count distribution", "SELECT citation_class, COUNT(*), MAX(citation_count) "
                                        "FROM openaire_paper_impact GROUP BY 1 ORDER BY 1"),
    ]:
        print(f"{label}:")
        for row in out.execute(q):
            print("   ", row)
    out.close()


if __name__ == "__main__":
    main()
