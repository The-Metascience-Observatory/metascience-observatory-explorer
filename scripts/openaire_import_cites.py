#!/usr/bin/env python3
"""Scan the OpenAIRE Cites relation dumps into partitioned edge shards — Phase 2 B1.

The v11 dump ships result-to-result citations as `product_Cites_1..8.tar`
(75.6 GB, ~1.85B edges). The original integration skipped them (the segmented downloader, scripts/openaire_download_cites_parallel.sh)
on the grounds that SciSciNet already has citations -- true for the 140.9M
matched papers, false for the 33.5M OpenAIRE-only ones, which is why their
detail pages have no references or citations at all.

We keep an edge only if BOTH endpoints resolve AND at least one is an
OpenAIRE-only paper. Dropping W<->W edges (already in journals.db
paper_references / paper_citations) is what makes this ~500M rows instead of
~1.85B, and it gives the result set a useful property: for a SciSciNet paper,
every stored edge is a citation SciSciNet does NOT have.

Output is raw int64 pair shards, partitioned by key, in both directions:
    <shard-dir>/fwd/p<P>.<tar>.w<pid>.bin   pairs of (source_key, target_key)
    <shard-dir>/rev/p<P>.<tar>.w<pid>.bin   pairs of (target_key, source_key)
openaire_pack_citations.py turns these into packed adjacency lists.

Usage:
  # cheap probe first -- product_Cites_8.tar is only 74 MB
  python3 openaire_import_cites.py --probe \
    --cites-dir /media/dan/metascience/openaire-cites \
    --tars product_Cites_8.tar \
    --keymap-dir /media/dan/metascience/openaire-build/keymap \
    --journals-db data/journals.db

  # full run
  python3 openaire_import_cites.py \
    --cites-dir /media/dan/metascience/openaire-cites --tar-glob "product_Cites_*.tar" \
    --extra-tars "/media/dan/Seagate Portable Drive/openaire-graph-v11/product_References.tar" \
    --keymap-dir /media/dan/metascience/openaire-build/keymap \
    --shard-dir /media/dan/metascience/openaire-build/cites-shards \
    --db-path /media/dan/metascience/openaire-build/openaire_citations.db \
    --partitions 8 --workers 8
"""

import argparse
import collections
import glob
import gzip
import multiprocessing as mp
import os
import random
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import hex16_to_u64, stream_tar_members

try:
    import orjson

    def json_loads(b):
        return orjson.loads(b)
except ImportError:
    import json

    def json_loads(b):
        return json.loads(b)

SRC = b'"source":"'
TGT = b'"target":"'

MAP_LO = MAP_HI = MAP_VAL = None
SHARD_DIR = None
PARTITIONS = 8


def _init(keymap_dir, shard_dir, partitions):
    global MAP_LO, MAP_HI, MAP_VAL, SHARD_DIR, PARTITIONS
    d = Path(keymap_dir)
    # mmap so all workers share one page-cache copy of the ~4.2 GB map
    MAP_LO = np.load(d / "map_lo.npy", mmap_mode="r")
    MAP_HI = np.load(d / "map_hi.npy", mmap_mode="r")
    MAP_VAL = np.load(d / "map_val.npy", mmap_mode="r")
    SHARD_DIR = Path(shard_dir) if shard_dir else None
    PARTITIONS = partitions


def extract_pairs(blob):
    """Byte-level source/target extraction -- ~2.2M lines/s vs 0.47M for json.loads.

    Returns (n_lines, src_hex_buf, tgt_hex_buf) where each buf is packed 32-char
    ASCII md5 hex. Namespace prefixes are fixed-width, so the md5 is always the
    32 chars immediately before the closing quote.
    """
    n = 0
    bs = bytearray()
    bt = bytearray()
    for line in gzip.decompress(blob).split(b"\n"):
        if not line:
            continue
        i = line.find(SRC)
        if i < 0:
            continue
        j = line.find(b'"', i + len(SRC))
        k = line.find(TGT, j)
        if k < 0:
            continue
        q = line.find(b'"', k + len(TGT))
        if j < 32 or q < 32:
            continue
        bs += line[j - 32 : j]
        bt += line[q - 32 : q]
        n += 1
    return n, bytes(bs), bytes(bt)


def _halves(buf):
    a = np.frombuffer(buf, np.uint8).reshape(-1, 32)
    return hex16_to_u64(a[:, :16].tobytes()), hex16_to_u64(a[:, 16:].tobytes())


def translate(buf):
    """Packed 32-hex buffer -> (app_key int64[], resolved bool[]). 0 = unresolved."""
    lo, hi = _halves(buf)
    pos = np.searchsorted(MAP_LO, lo)
    np.clip(pos, 0, len(MAP_LO) - 1, out=pos)
    ok = (MAP_LO[pos] == lo) & (MAP_HI[pos] == hi)
    return np.where(ok, MAP_VAL[pos], 0), ok


def classify(task):
    """Worker: translate one member's edges and write shards. Returns counters.

    task is (tar_stem, blob) -- the stem travels with each member so shard files
    stay attributable to their tar (needed for per-tar resumability) without
    relying on broadcasting state to every worker.
    """
    stem, blob = task
    n_lines, bs, bt = extract_pairs(blob)
    if n_lines == 0:
        return {"lines": 0, "kept": 0, "oa_oa": 0, "oa_w": 0, "w_w": 0, "unresolved": 0}

    vs, oks = translate(bs)
    vd, okd = translate(bt)
    both = oks & okd
    is_oa_s, is_oa_d = vs < 0, vd < 0
    keep = both & (is_oa_s | is_oa_d) & (vs != vd)  # >=1 OA endpoint, no self-loops

    counts = {
        "lines": n_lines,
        "kept": int(np.count_nonzero(keep)),
        "oa_oa": int(np.count_nonzero(both & is_oa_s & is_oa_d)),
        "oa_w": int(np.count_nonzero(both & (is_oa_s ^ is_oa_d))),
        "w_w": int(np.count_nonzero(both & ~is_oa_s & ~is_oa_d)),
        "unresolved": int(np.count_nonzero(~both)),
    }
    if SHARD_DIR is None or not counts["kept"]:
        return counts

    ks, kd = vs[keep], vd[keep]
    pid = os.getpid()
    mask = np.uint64(PARTITIONS - 1)
    for direction, key, other in (("fwd", ks, kd), ("rev", kd, ks)):
        part = (np.abs(key).astype(np.uint64) & mask).astype(np.int64)
        for p in range(PARTITIONS):
            sel = part == p
            if not sel.any():
                continue
            pairs = np.stack([key[sel], other[sel]], axis=1)
            path = SHARD_DIR / direction / f"p{p}.{stem}.w{pid}.bin"
            with open(path, "ab") as f:
                pairs.tofile(f)
    return counts


def run_probe(tars, keymap_dir, journals_db, sample_edges):
    """Measure before committing to the 75.6 GB download + full run."""
    _init(keymap_dir, None, 8)
    reltypes = collections.Counter()
    types = collections.Counter()
    namespaces = collections.Counter()
    totals = collections.Counter()
    indeg = collections.Counter()
    seen_pairs = set()
    dup = 0
    ww_sample = []
    t0 = time.time()
    n_bytes = 0

    for tar in tars:
        n_bytes += Path(tar).stat().st_size
        for blob in stream_tar_members(Path(tar)):
            lines = gzip.decompress(blob).split(b"\n")
            # full JSON parse is affordable at probe scale and validates the
            # byte-level extractor's assumptions
            for raw in lines:
                if not raw:
                    continue
                try:
                    r = json_loads(raw)
                except Exception:
                    continue
                rt = (r.get("relType") or {}).get("name")
                reltypes[rt] += 1
                types[f"{r.get('sourceType')}->{r.get('targetType')}"] += 1
                s, t = r.get("source") or "", r.get("target") or ""
                namespaces["src:" + s.split("::")[0]] += 1
                namespaces["tgt:" + t.split("::")[0]] += 1

            n, bs, bt = extract_pairs(blob)
            totals["lines"] += n
            vs, oks = translate(bs)
            vd, okd = translate(bt)
            both = oks & okd
            is_oa_s, is_oa_d = vs < 0, vd < 0
            keep = both & (is_oa_s | is_oa_d) & (vs != vd)
            totals["src_oa"] += int(np.count_nonzero(is_oa_s))
            totals["src_w"] += int(np.count_nonzero(oks & ~is_oa_s))
            totals["src_unres"] += int(np.count_nonzero(~oks))
            totals["tgt_oa"] += int(np.count_nonzero(is_oa_d))
            totals["tgt_w"] += int(np.count_nonzero(okd & ~is_oa_d))
            totals["tgt_unres"] += int(np.count_nonzero(~okd))
            totals["kept"] += int(np.count_nonzero(keep))
            totals["oa_oa"] += int(np.count_nonzero(both & is_oa_s & is_oa_d))
            totals["oa_w"] += int(np.count_nonzero(both & (is_oa_s ^ is_oa_d)))
            totals["w_w"] += int(np.count_nonzero(both & ~is_oa_s & ~is_oa_d))

            for a, b in zip(vd[keep].tolist(), vs[keep].tolist()):
                indeg[a] += 1
            for a, b in zip(vs.tolist(), vd.tolist()):
                if a and b and a > 0 and b > 0 and len(ww_sample) < sample_edges:
                    ww_sample.append((a, b))
                pr = (a, b)
                if pr in seen_pairs:
                    dup += 1
                elif len(seen_pairs) < 5_000_000:
                    seen_pairs.add(pr)

    el = time.time() - t0
    print(f"\n=== PROBE: {len(tars)} tar(s), {n_bytes / 1e6:.0f} MB, {el:.0f}s ===\n")

    print("1. relType histogram (Cites/IsCitedBy double-counting check):")
    for k, v in reltypes.most_common(10):
        print(f"     {v:12,d}  {k}")
    if len([k for k in reltypes if k in ("Cites", "IsCitedBy")]) > 1:
        print("   *** BOTH Cites AND IsCitedBy PRESENT -- must canonicalize direction ***")

    print("\n2. sourceType->targetType:")
    for k, v in types.most_common(6):
        print(f"     {v:12,d}  {k}")

    print("\n3. scale:")
    lines = totals["lines"]
    bpl = n_bytes / lines if lines else 0
    print(f"     {lines:,} lines, {bpl:.1f} gz bytes/line")
    print(f"     -> product_Cites_1..8 (75.6 GB) implies ~{75.6e9 / bpl / 1e9:.2f}B edges")

    print("\n4. endpoint namespaces (top 6):")
    for k, v in namespaces.most_common(6):
        print(f"     {v:12,d}  {k}")

    print("\n5. resolution:")
    for side in ("src", "tgt"):
        o, w, u = totals[f"{side}_oa"], totals[f"{side}_w"], totals[f"{side}_unres"]
        tot = o + w + u
        if tot:
            print(f"     {side}: OA {o / tot:6.2%}  W {w / tot:6.2%}  unresolved {u / tot:6.2%}")

    print("\n6. keep rate (both resolve AND >=1 OA, no self-loops):")
    kr = totals["kept"] / lines if lines else 0
    print(f"     {totals['kept']:,} / {lines:,} = {kr:.4%}")
    print(f"     classes: OA-OA {totals['oa_oa']:,}  OA-W {totals['oa_w']:,}  "
          f"W-W {totals['w_w']:,} (dropped)  unresolved {lines - totals['oa_oa'] - totals['oa_w'] - totals['w_w']:,}")
    est_edges = 75.6e9 / bpl if bpl else 0
    K = est_edges * kr
    print(f"     ==> K ~= {K / 1e6:,.0f}M edges kept")
    blob_gb = K * 2 * 8 * 1.15 / 1e9
    print(f"     ==> packed blobs ~{blob_gb:.1f} GB (both directions, before the 1000-cap)")
    if K > 800e6:
        print("     *** K > 800M: drop --cap to 500 before the full run ***")

    print("\n7. duplicate (src,dst) pairs:")
    print(f"     {dup:,} dups in {len(seen_pairs):,} distinct")

    print("\n8. in-degree of kept edges:")
    if indeg:
        degs = np.array(sorted(indeg.values()))
        print(f"     max {degs.max():,}  p99 {np.percentile(degs, 99):.0f}  "
              f"p99.9 {np.percentile(degs, 99.9):.0f}  mean {degs.mean():.1f}")
        print(f"     (note: single-tar sample, so true degrees are ~8x these)")

    # --- SciSciNet crosscheck ---
    print(f"\n9. SciSciNet crosscheck on W->W edges (n={len(ww_sample):,}):")
    if not ww_sample or not journals_db:
        print("     skipped (no W-W sample or no --journals-db)")
        return
    con = sqlite3.connect(f"file:{Path(journals_db).expanduser()}?mode=ro", uri=True)
    con.execute("PRAGMA cache_size=-500000")
    random.seed(17)
    sample = random.sample(ww_sample, min(len(ww_sample), 20_000))
    present = absent = 0
    t1 = time.time()
    for a, b in sample:
        row = con.execute(
            "SELECT 1 FROM paper_references WHERE paperid=? AND ref_paperid=? LIMIT 1",
            (f"W{a}", f"W{b}"),
        ).fetchone()
        if row:
            present += 1
        else:
            absent += 1
    tot = present + absent
    print(f"     checked {tot:,} in {time.time() - t1:.0f}s")
    print(f"     present in journals.db paper_references: {present:,} ({present / tot:.1%})")
    print(f"     MISSING from SciSciNet:                  {absent:,} ({absent / tot:.1%})")
    # truncation check: is paper_references capped per paper?
    srcs = list({a for a, _ in sample})[:2000]
    counts = [
        con.execute("SELECT COUNT(*) FROM paper_references WHERE paperid=?", (f"W{s}",)).fetchone()[0]
        for s in srcs
    ]
    counts = [c for c in counts if c]
    if counts:
        cc = collections.Counter(counts)
        print(f"     refs/paper: max {max(counts)}, mean {sum(counts) / len(counts):.1f}")
        print(f"     most common counts (a spike at a round number = upstream truncation):")
        for v, k in cc.most_common(5):
            print(f"        {k:6,d} papers have exactly {v} refs")
    print("\n     If the missing rate is low (<5%) this is just a coverage footnote.")
    print("     If high (>15%), the follow-up is to store only the MISSES, not all W-W edges.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cites-dir", required=True)
    ap.add_argument("--tar-glob", default="product_Cites_*.tar")
    ap.add_argument("--tars", help="explicit comma-separated tar names (overrides --tar-glob)")
    ap.add_argument("--extra-tars", default="", help="comma-separated extra relation tars")
    ap.add_argument("--keymap-dir", required=True)
    ap.add_argument("--shard-dir")
    ap.add_argument("--db-path")
    ap.add_argument("--journals-db", help="for the probe's SciSciNet crosscheck")
    ap.add_argument("--partitions", type=int, default=8)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--sample-edges", type=int, default=200_000)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    if args.tars:
        tars = [str(Path(args.cites_dir) / t.strip()) for t in args.tars.split(",")]
    else:
        tars = sorted(glob.glob(str(Path(args.cites_dir) / args.tar_glob)),
                      key=lambda p: (len(p), p))
    tars += [t.strip() for t in args.extra_tars.split(",") if t.strip()]
    missing = [t for t in tars if not Path(t).exists()]
    if missing:
        sys.exit(f"missing tars: {missing}")
    if not tars:
        sys.exit("no tars found")

    if args.probe:
        run_probe(tars, args.keymap_dir, args.journals_db, args.sample_edges)
        return

    if not args.shard_dir or not args.db_path:
        sys.exit("--shard-dir and --db-path are required for a full run")
    if args.partitions & (args.partitions - 1):
        sys.exit("--partitions must be a power of 2")

    shard_dir = Path(args.shard_dir)
    for d in ("fwd", "rev"):
        (shard_dir / d).mkdir(parents=True, exist_ok=True)

    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    out.execute("CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT)")
    if args.rebuild:
        out.execute("DELETE FROM import_meta WHERE key LIKE 'cites_%'")
        out.commit()
        for d in ("fwd", "rev"):
            for f in (shard_dir / d).glob("*.bin"):
                f.unlink()
    done = {r[0] for r in out.execute("SELECT value FROM import_meta WHERE key LIKE 'cites_tar_done:%'")}

    grand = collections.Counter()
    t_all = time.time()
    ctx = mp.get_context("fork")
    with ctx.Pool(args.workers, initializer=_init,
                  initargs=(args.keymap_dir, str(shard_dir), args.partitions)) as pool:
        for tar in tars:
            name = Path(tar).name
            if name in done:
                print(f"skip {name} (already done)")
                continue
            stem = name.replace(".tar", "")
            # re-running one tar must overwrite only its own shards
            for d in ("fwd", "rev"):
                for f in (shard_dir / d).glob(f"*.{stem}.w*.bin"):
                    f.unlink()
            print(f"processing {name}...")
            t0 = time.time()
            stats = collections.Counter()
            k = 0
            tasks = ((stem, blob) for blob in stream_tar_members(Path(tar)))
            for c in pool.imap_unordered(classify, tasks, chunksize=1):
                stats.update(c)
                k += 1
                if k % 200 == 0:
                    el = time.time() - t0
                    print(f"  {stats['lines']:,} lines ({stats['lines'] / el:,.0f}/s) "
                          f"kept={stats['kept']:,}", end="\r", flush=True)
            out.execute("INSERT OR REPLACE INTO import_meta VALUES (?,?)",
                        (f"cites_tar_done:{name}", name))
            out.commit()
            grand.update(stats)
            print(f"  {name}: {stats['lines']:,} lines, {stats['kept']:,} kept "
                  f"in {(time.time() - t0) / 60:.1f} min" + " " * 15)

    # Accumulate across invocations: the chain runner calls this once per batch of
    # tars, so plain overwrites would leave only the last batch's numbers behind.
    for key, val in [("cites_lines_scanned", grand["lines"]), ("cites_edges_kept", grand["kept"]),
                     ("cites_oa_oa", grand["oa_oa"]), ("cites_oa_w", grand["oa_w"]),
                     ("cites_dropped_ww", grand["w_w"]),
                     ("cites_dropped_unresolved", grand["unresolved"])]:
        prev = out.execute("SELECT value FROM import_meta WHERE key=?", (key,)).fetchone()
        total = int(prev[0]) + val if prev else val
        out.execute("INSERT OR REPLACE INTO import_meta VALUES (?,?)", (key, str(total)))
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('cites_imported_at', datetime('now'))")
    out.commit()
    shard_bytes = sum(f.stat().st_size for d in ("fwd", "rev") for f in (shard_dir / d).glob("*.bin"))
    print(f"\nDone: {grand['lines']:,} lines scanned, {grand['kept']:,} edges kept "
          f"({grand['w_w']:,} W-W dropped, {grand['unresolved']:,} unresolved) "
          f"in {(time.time() - t_all) / 60:.1f} min")
    print(f"shards: {shard_bytes / 1e9:.1f} GB in {shard_dir}")


if __name__ == "__main__":
    main()
