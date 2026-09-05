#!/usr/bin/env python3
"""Pack Cites edge shards into adjacency lists — Phase 2 B2.

Turns the raw (key, neighbor) int64 pair shards written by
openaire_import_cites.py into one row per paper:

    openaire_refs (k, total, neighbors)   what this paper cites
    openaire_cites(k, total, neighbors)   what cites this paper

`neighbors` is a little-endian int64 array PRE-SORTED by the neighbor's citation
count descending and truncated to --cap. Sorting at build time is the whole point:
the app can then serve any page with one INTEGER PRIMARY KEY seek plus a buffer
slice, and only has to resolve the <=100 ids actually on screen. `total` keeps the
true pre-cap degree so the UI can say "showing 1,000 of N".

Neighbor citation counts come from paper_summary (W neighbors, via the keymap's
wcnt arrays) and openaire_paper_impact (OA neighbors) -- so Phase 1 must run first.

Usage:
  python3 openaire_pack_citations.py \
    --shard-dir /media/dan/metascience/openaire-build/cites-shards \
    --keymap-dir /media/dan/metascience/openaire-build/keymap \
    --db-path /media/dan/metascience/openaire-build/openaire_citations.db \
    --cap 1000 [--rebuild]
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import hex16_to_u64

INSERT_BATCH = 50_000
# How many adjacency groups to materialize as Python lists at a time (see pack_direction)
GROUP_CHUNK = 1_000_000

DDL = """
CREATE TABLE IF NOT EXISTS {table} (
  k         INTEGER PRIMARY KEY,  -- +W_numeric | -(openaire_papers.rowid)
  total     INTEGER NOT NULL,     -- true degree, before the cap
  neighbors BLOB    NOT NULL      -- little-endian int64[], citation-count DESC
);
"""

DIRECTIONS = [("fwd", "openaire_refs"), ("rev", "openaire_cites")]


def load_oa_counts(con, keymap_dir, max_rowid):
    """openaire_papers.rowid -> BIP! citation count, as a dense int32 array.

    openaire_paper_impact is keyed by the TEXT id, so we translate id -> rowid
    through the same md5 key map everything else uses.
    """
    counts = np.zeros(max_rowid + 1, np.int32)
    try:
        rows = con.execute("SELECT id, citation_count FROM openaire_paper_impact").fetchall()
    except sqlite3.OperationalError:
        rows = []
    if not rows:
        print("  WARNING: openaire_paper_impact missing/empty -- run Phase 1 first, or")
        print("           OpenAIRE neighbors will all rank last within their lists")
        return counts

    d = Path(keymap_dir)
    map_lo = np.load(d / "map_lo.npy", mmap_mode="r")
    map_hi = np.load(d / "map_hi.npy", mmap_mode="r")
    map_val = np.load(d / "map_val.npy", mmap_mode="r")

    hexes = "".join(r[0][2:] for r in rows)  # strip 'OA'
    a = np.frombuffer(hexes.encode("ascii"), np.uint8).reshape(-1, 32)
    lo = hex16_to_u64(a[:, :16].tobytes())
    hi = hex16_to_u64(a[:, 16:].tobytes())
    pos = np.searchsorted(map_lo, lo)
    np.clip(pos, 0, len(map_lo) - 1, out=pos)
    ok = (map_lo[pos] == lo) & (map_hi[pos] == hi)
    val = np.where(ok, map_val[pos], 0)
    rowids = np.where(val < 0, -val, 0)

    cc = np.fromiter((r[1] for r in rows), np.int32, len(rows))
    sel = (rowids > 0) & (rowids <= max_rowid)
    counts[rowids[sel]] = cc[sel]
    print(f"  loaded {int(sel.sum()):,} / {len(rows):,} impact rows into the rowid map")
    return counts


def neighbor_counts(nbr, wcnt_keys, wcnt_vals, oa_counts):
    """Citation count for each neighbor key (0 when unknown)."""
    out = np.zeros(len(nbr), np.int32)

    w = nbr > 0
    if w.any():
        keys = nbr[w].astype(np.uint64)
        pos = np.searchsorted(wcnt_keys, keys)
        np.clip(pos, 0, len(wcnt_keys) - 1, out=pos)
        hit = wcnt_keys[pos] == keys
        out[w] = np.where(hit, wcnt_vals[pos], 0)

    o = nbr < 0
    if o.any():
        rid = (-nbr[o]).astype(np.int64)
        rid[rid >= len(oa_counts)] = 0
        out[o] = oa_counts[rid]
    return out


def pack_direction(con, shard_dir, direction, table, cap, wcnt_keys, wcnt_vals, oa_counts):
    files = sorted((shard_dir / direction).glob("*.bin"))
    if not files:
        print(f"  {direction}: no shards, skipping")
        return 0, 0
    nbytes = sum(f.stat().st_size for f in files)
    print(f"  {direction}: {len(files)} shard files, {nbytes / 1e9:.2f} GB")

    t0 = time.time()
    parts = [np.fromfile(f, np.int64).reshape(-1, 2) for f in files]
    a = np.concatenate(parts)
    del parts
    print(f"    loaded {len(a):,} pairs in {time.time() - t0:.0f}s")

    key, nbr = a[:, 0].copy(), a[:, 1].copy()
    del a

    t0 = time.time()
    cnt = neighbor_counts(nbr, wcnt_keys, wcnt_vals, oa_counts)
    # ONE sort, not two. Priority (np.lexsort takes keys least-significant first):
    #   1. key ascending          -> inserts are sequential b-tree appends
    #   2. citation count DESC    -> the ranking the app serves pages from
    #   3. neighbor ascending     -> REQUIRED for the dedupe below, and makes the
    #                                build deterministic
    # Without (3), duplicate (key, neighbor) pairs are NOT guaranteed adjacent: a
    # stable sort leaves other neighbors sharing the same count interleaved between
    # them, so an adjacent-only dedupe would silently miss duplicates. np.unique
    # (axis=0) would also work but costs a second full sort and a void-view copy.
    order = np.lexsort((nbr, -cnt.astype(np.int64), key))
    key, nbr = key[order], nbr[order]
    del order, cnt
    print(f"    ranked + sorted in {time.time() - t0:.0f}s")

    # Dedupe adjacent identical pairs: the dump repeats some (src,dst) edges and
    # product_References overlaps product_Cites.
    t0 = time.time()
    dup = np.concatenate(([False], (key[1:] == key[:-1]) & (nbr[1:] == nbr[:-1])))
    n_dup = int(dup.sum())
    if n_dup:
        keep = ~dup
        key, nbr = key[keep], nbr[keep]
        del keep
    del dup
    print(f"    dropped {n_dup:,} duplicate pairs in {time.time() - t0:.0f}s "
          f"-> {len(key):,} edges")

    starts = np.flatnonzero(np.concatenate(([True], key[1:] != key[:-1])))
    ends = np.concatenate((starts[1:], [len(key)]))
    print(f"    {len(starts):,} distinct keys")

    con.executescript(DDL.format(table=table))
    t0 = time.time()
    rows, n_rows, n_capped = [], 0, 0
    n_groups = len(starts)
    # Convert group bounds to Python lists in chunks. A whole-array .tolist() on
    # ~100M groups would allocate GBs of int objects (~32 B each, x3 arrays) on
    # top of the sort buffers; chunking caps that at a few hundred MB while
    # keeping the per-row loop off slow numpy scalar indexing.
    for g0 in range(0, n_groups, GROUP_CHUNK):
        g1 = min(g0 + GROUP_CHUNK, n_groups)
        ks = key[starts[g0:g1]].tolist()
        ss = starts[g0:g1].tolist()
        es = ends[g0:g1].tolist()
        for i in range(len(ss)):
            s, e = ss[i], es[i]
            total = e - s
            if total > cap:
                n_capped += 1
                e = s + cap
            rows.append((ks[i], total, nbr[s:e].tobytes()))
            if len(rows) >= INSERT_BATCH:
                con.executemany(f"INSERT OR REPLACE INTO {table} VALUES (?,?,?)", rows)
                n_rows += len(rows)
                rows.clear()
        print(f"      {n_rows:,} rows ({n_rows / max(time.time() - t0, 0.001):,.0f}/s)",
              end="\r", flush=True)
    if rows:
        con.executemany(f"INSERT OR REPLACE INTO {table} VALUES (?,?,?)", rows)
        n_rows += len(rows)
    con.commit()
    print(f"    inserted {n_rows:,} rows ({n_capped:,} capped) "
          f"in {(time.time() - t0) / 60:.1f} min" + " " * 15)
    return n_rows, n_capped


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shard-dir", required=True)
    ap.add_argument("--keymap-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--cap", type=int, default=1000)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    shard_dir = Path(args.shard_dir)
    con = sqlite3.connect(Path(args.db_path).expanduser())
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-4000000;")
    con.execute("CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT)")
    if args.rebuild:
        for _, table in DIRECTIONS:
            con.execute(f"DROP TABLE IF EXISTS {table}")
        con.commit()
    else:
        for _, table in DIRECTIONS:
            if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                           (table,)).fetchone():
                sys.exit(f"{table} exists; pass --rebuild")

    max_rowid = int(con.execute(
        "SELECT COALESCE(MAX(CAST(value AS INTEGER)), 0) FROM import_meta WHERE key='oa_max_rowid'"
    ).fetchone()[0] or 0)
    if not max_rowid:
        epoch = (Path(args.keymap_dir) / "epoch.txt").read_text().strip()
        max_rowid = int(epoch.split(":")[0])
    print(f"openaire_papers max rowid: {max_rowid:,}")

    print("loading neighbor citation counts...")
    d = Path(args.keymap_dir)
    wcnt_keys = np.load(d / "wcnt_keys.npy", mmap_mode="r")
    wcnt_vals = np.load(d / "wcnt_vals.npy", mmap_mode="r")
    oa_counts = load_oa_counts(con, args.keymap_dir, max_rowid)

    t_all = time.time()
    totals = {}
    for direction, table in DIRECTIONS:
        print(f"packing {table}...")
        n, capped = pack_direction(con, shard_dir, direction, table, args.cap,
                                   wcnt_keys, wcnt_vals, oa_counts)
        totals[table] = (n, capped)

    for table, (n, capped) in totals.items():
        con.execute("INSERT OR REPLACE INTO import_meta VALUES (?,?)", (f"{table}_rows", str(n)))
        con.execute("INSERT OR REPLACE INTO import_meta VALUES (?,?)",
                    (f"{table}_capped", str(capped)))
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('cap', ?)", (str(args.cap),))
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('oa_max_rowid', ?)", (str(max_rowid),))
    epoch = (Path(args.keymap_dir) / "epoch.txt").read_text().strip()
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('openaire_rowid_epoch', ?)", (epoch,))
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('packed_at', datetime('now'))")
    con.commit()
    print("ANALYZE...")
    con.execute("ANALYZE")
    con.commit()
    con.close()
    print(f"\nDone in {(time.time() - t_all) / 60:.1f} min")
    for table, (n, capped) in totals.items():
        print(f"  {table}: {n:,} rows, {capped:,} hit the {args.cap} cap")


if __name__ == "__main__":
    main()
