#!/usr/bin/env python3
"""Build the md5-hex -> app-key translation map — Phase 0 of the citation pipeline.

Every downstream pass needs to turn an OpenAIRE product id (`namespace::md5hex`,
as it appears in the relation dumps and publication records) into an app key.
This script builds that map once as sorted numpy arrays that later passes mmap.

WHY THE HEX AND NOT THE FULL ID: `doi_dedup___::<hex>` and `doi_________::<hex>`
are the SAME DOI -- the hex is md5(normalized_doi) in both namespaces.
openaire_papers stores 66% of its ids under `doi_________::` while the relation
dumps reference 87% under `doi_dedup___::`, so the existing full-string matching
in openaire_import_relations.translate_targets() silently under-matches. All new
code keys on the hex alone. We keep both 64-bit halves so lookups verify the
full 128 bits and cannot false-positive.

App key encoding (signed int64, one namespace for the whole feature):
    k > 0   SciSciNet paper, paperid = 'W' || k
    k < 0   OpenAIRE-only paper, openaire_papers.rowid = -k
    k = 0   unresolved (sentinel; never stored)

Outputs (--out-dir):
    map_lo.npy    uint64, SORTED   first 64 bits of the md5   (the search key)
    map_hi.npy    uint64, parallel last 64 bits of the md5    (verification)
    map_val.npy   int64,  parallel app key
    wcnt_keys.npy uint64, SORTED   W numeric id
    wcnt_vals.npy int32,  parallel paper_summary.cited_by_count

Usage:
  python3 openaire_build_keymap.py \
    --openaire-db data/openaire.db --journals-db data/journals.db \
    --out-dir /media/dan/metascience/openaire-build/keymap [--rebuild] [--skip-wcnt]
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import hex16_to_u64

FETCH = 500_000

# rowids to sample for the epoch guard (see --- epoch --- below)
EPOCH_PROBES = (1, 16_777_216, 33_509_044)


def _connect_ro(path):
    con = sqlite3.connect(f"file:{Path(path).expanduser()}?mode=ro", uri=True)
    con.execute("PRAGMA cache_size=-500000")
    con.execute("PRAGMA mmap_size=4294967296")
    return con


def _hex_halves(hex_chunk: str):
    """A concatenation of N 32-char hex strings -> (lo uint64[N], hi uint64[N])."""
    raw = hex_chunk.encode("ascii")
    a = np.frombuffer(raw, np.uint8).reshape(-1, 32)
    lo = hex16_to_u64(a[:, :16].tobytes())
    hi = hex16_to_u64(a[:, 16:].tobytes())
    return lo, hi


def load_openaire_papers(con):
    """openaire_papers.id ('OA'+32hex) -> -rowid. Uses the covering index."""
    los, his, vals = [], [], []
    t0, n = time.time(), 0
    cur = con.execute("SELECT id, rowid FROM openaire_papers ORDER BY id")
    while True:
        rows = cur.fetchmany(FETCH)
        if not rows:
            break
        lo, hi = _hex_halves("".join(r[0][2:] for r in rows))  # strip the 'OA' prefix
        los.append(lo)
        his.append(hi)
        vals.append(np.fromiter((-r[1] for r in rows), np.int64, len(rows)))
        n += len(rows)
        print(f"  openaire_papers {n:,} ({n / (time.time() - t0):,.0f}/s)", end="\r", flush=True)
    print(f"  openaire_papers {n:,} rows in {time.time() - t0:.0f}s" + " " * 20)
    return los, his, vals, n


def load_paper_openaire(con):
    """paper_openaire.openaire_id -> +W numeric. Uses the covering index."""
    los, his, vals = [], [], []
    t0, n, bad = time.time(), 0, 0
    cur = con.execute("SELECT openaire_id, paperid FROM paper_openaire ORDER BY openaire_id")
    while True:
        rows = cur.fetchmany(FETCH)
        if not rows:
            break
        # Namespace prefixes are fixed-width, so the md5 is always the last 32 chars.
        # Anything else (a malformed id) is dropped and counted.
        good = [r for r in rows if len(r[0]) >= 34 and r[0][-33] == ":"]
        bad += len(rows) - len(good)
        if good:
            lo, hi = _hex_halves("".join(r[0][-32:] for r in good))
            los.append(lo)
            his.append(hi)
            vals.append(np.fromiter((int(r[1][1:]) for r in good), np.int64, len(good)))
        n += len(rows)
        print(f"  paper_openaire {n:,} ({n / (time.time() - t0):,.0f}/s)", end="\r", flush=True)
    print(f"  paper_openaire {n:,} rows in {time.time() - t0:.0f}s, {bad:,} malformed" + " " * 12)
    return los, his, vals, n


def build_wcnt(con, out_dir):
    """paper_summary.paperid -> cited_by_count, for neighbor ranking in Pass B2."""
    keys, vals = [], []
    t0, n = time.time(), 0
    cur = con.execute("SELECT paperid, cited_by_count FROM paper_summary")
    while True:
        rows = cur.fetchmany(FETCH)
        if not rows:
            break
        keys.append(np.fromiter((int(r[0][1:]) for r in rows), np.uint64, len(rows)))
        vals.append(np.fromiter(((r[1] or 0) for r in rows), np.int32, len(rows)))
        n += len(rows)
        print(f"  paper_summary {n:,} ({n / (time.time() - t0):,.0f}/s)", end="\r", flush=True)
    print(f"  paper_summary {n:,} rows in {time.time() - t0:.0f}s" + " " * 20)

    k = np.concatenate(keys)
    del keys
    v = np.concatenate(vals)
    del vals
    order = np.argsort(k, kind="stable")
    k, v = k[order], v[order]
    del order
    np.save(out_dir / "wcnt_keys.npy", k)
    np.save(out_dir / "wcnt_vals.npy", v)
    print(f"  wrote wcnt_{{keys,vals}}.npy: {len(k):,} rows, "
          f"{(k.nbytes + v.nbytes) / 1e9:.2f} GB")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--openaire-db", required=True)
    ap.add_argument("--journals-db", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--skip-wcnt", action="store_true",
                    help="skip the paper_summary count map (only Pass B2 needs it)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    if (out_dir / "map_lo.npy").exists() and not args.rebuild:
        sys.exit(f"{out_dir}/map_lo.npy exists; pass --rebuild")

    oa_con = _connect_ro(args.openaire_db)
    t_all = time.time()

    print("loading id maps...")
    a_lo, a_hi, a_val, n_oa = load_openaire_papers(oa_con)
    b_lo, b_hi, b_val, n_w = load_paper_openaire(oa_con)

    lo = np.concatenate(a_lo + b_lo)
    hi = np.concatenate(a_hi + b_hi)
    val = np.concatenate(a_val + b_val)
    del a_lo, a_hi, a_val, b_lo, b_hi, b_val
    print(f"  combined {len(lo):,} keys ({lo.nbytes * 3 / 1e9:.2f} GB)")

    # Sort by (lo, val): with val descending on ties, W (+) sorts before OA (-),
    # so the dedupe below keeps the SciSciNet id -- its metadata is richer.
    print("sorting...")
    t0 = time.time()
    order = np.lexsort((-val, lo))
    lo, hi, val = lo[order], hi[order], val[order]
    del order
    print(f"  sorted in {time.time() - t0:.0f}s")

    # --- collision report ---
    # A duplicate `lo` is either a true 128-bit duplicate (the same product listed
    # in both id spaces) or a 64-bit truncation collision. searchsorted returns one
    # position, so duplicates must be removed; we keep the first (W-preferred).
    dup = np.flatnonzero(lo[1:] == lo[:-1])
    if len(dup):
        full_dup = int(np.count_nonzero(hi[dup] == hi[dup + 1]))
        trunc = len(dup) - full_dup
        print(f"  WARNING {len(dup):,} duplicate lo keys "
              f"({full_dup:,} full 128-bit, {trunc:,} 64-bit truncation collisions)")
        cross = int(np.count_nonzero((val[dup] > 0) & (val[dup + 1] < 0)))
        print(f"          {cross:,} are W/OA overlaps (expected ~0; W wins)")
        if trunc > 10_000:
            sys.exit("ERROR: >10k truncation collisions -- 64-bit keying is unsafe, investigate")
        keep = np.ones(len(lo), bool)
        keep[dup + 1] = False
        lo, hi, val = lo[keep], hi[keep], val[keep]
        del keep
        print(f"  deduped to {len(lo):,} keys")
    else:
        print("  0 duplicate keys")

    np.save(out_dir / "map_lo.npy", lo)
    np.save(out_dir / "map_hi.npy", hi)
    np.save(out_dir / "map_val.npy", val)
    n_oa_kept = int(np.count_nonzero(val < 0))
    print(f"  wrote map_{{lo,hi,val}}.npy: {len(lo):,} keys "
          f"({n_oa_kept:,} OpenAIRE-only, {len(lo) - n_oa_kept:,} SciSciNet)")

    # --- epoch ---
    # The edge tables key OpenAIRE papers by openaire_papers.rowid, so a rebuild of
    # openaire.db that renumbers rowids would silently corrupt them. Every consumer
    # re-derives this string and refuses to run on a mismatch. NEVER VACUUM openaire.db.
    probes = []
    for rid in EPOCH_PROBES:
        r = oa_con.execute("SELECT id FROM openaire_papers WHERE rowid = ?", (rid,)).fetchone()
        probes.append(r[0] if r else "-")
    max_rowid = oa_con.execute("SELECT MAX(rowid) FROM openaire_papers").fetchone()[0]
    epoch = f"{max_rowid}:" + ":".join(probes)
    (out_dir / "epoch.txt").write_text(epoch + "\n")
    print(f"  epoch: {epoch}")

    del lo, hi, val

    if not args.skip_wcnt:
        print("building paper_summary count map...")
        build_wcnt(_connect_ro(args.journals_db), out_dir)

    print(f"\nDone in {(time.time() - t_all) / 60:.1f} min "
          f"({n_oa:,} OpenAIRE-only + {n_w:,} matched papers)")


if __name__ == "__main__":
    main()
