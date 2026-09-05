#!/usr/bin/env python3
"""Verify data/openaire_citations.db before it goes live.

Checks, in order of how badly a failure would mislead users:
  1. rowid epoch matches the live openaire.db (a mismatch means every edge
     points at the WRONG paper -- this is the one that must be fatal)
  2. edge `total` <= BIP! citation_count (a systematic excess is the signature
     of Cites/IsCitedBy direction double-counting)
  3. reverse consistency: every (a,b) in openaire_refs has (b,a) in openaire_cites
  4. degree distribution and cap saturation
  5. impact table sanity
  6. PRAGMA integrity_check

Usage:
  python3 openaire_verify_citations.py \
    --db-path data/openaire_citations.db --openaire-db data/openaire.db
"""

import argparse
import random
import sqlite3
import struct
import sys
from pathlib import Path

EPOCH_PROBES = (1, 16_777_216, 33_509_044)


def unpack(blob):
    return list(struct.unpack(f"<{len(blob) // 8}q", blob))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--openaire-db", required=True)
    ap.add_argument("--sample", type=int, default=100_000)
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{Path(args.db_path).expanduser()}?mode=ro", uri=True)
    oa = sqlite3.connect(f"file:{Path(args.openaire_db).expanduser()}?mode=ro", uri=True)
    con.execute("PRAGMA cache_size=-1000000")
    failures = []
    random.seed(23)

    def check(ok, label, detail=""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}")
        if not ok:
            failures.append(label)

    meta = dict(con.execute("SELECT key, value FROM import_meta"))
    cap = int(meta.get("cap", 1000))
    print(f"cap={cap}  packed_at={meta.get('packed_at')}  dump={meta.get('source_dump', '?')}\n")

    # 1. epoch
    print("1. rowid epoch guard")
    stored = meta.get("openaire_rowid_epoch")
    probes = []
    for rid in EPOCH_PROBES:
        r = oa.execute("SELECT id FROM openaire_papers WHERE rowid = ?", (rid,)).fetchone()
        probes.append(r[0] if r else "-")
    max_rowid = oa.execute("SELECT MAX(rowid) FROM openaire_papers").fetchone()[0]
    live = f"{max_rowid}:" + ":".join(probes)
    check(stored == live, "epoch matches live openaire.db",
          "" if stored == live else f"stored={stored} live={live}")

    # 2. direction sanity
    print("\n2. direction check (total must not exceed BIP! citation_count)")
    # k < 0 means -rowid into openaire_papers, so the id comes from a rowid seek.
    sample = con.execute(
        "SELECT k, total FROM openaire_cites WHERE k < 0 ORDER BY total DESC LIMIT 200"
    ).fetchall()
    over = checked = 0
    worst = None
    for k, total in sample:
        r = oa.execute("SELECT id FROM openaire_papers WHERE rowid = ?", (-k,)).fetchone()
        if not r:
            continue
        cc = con.execute(
            "SELECT citation_count FROM openaire_paper_impact WHERE id = ?", (r[0],)
        ).fetchone()
        cc = cc[0] if cc else 0
        checked += 1
        if total > cc * 1.05 and total > cc + 5:
            over += 1
            if worst is None or total - cc > worst[1] - worst[2]:
                worst = (r[0], total, cc)
    ratio = over / checked if checked else 0
    check(ratio < 0.25, f"{over}/{checked} top-cited papers have total > citation_count",
          f"worst: {worst}" if worst else "")
    print("       (some excess is expected: BIP! counts and Cites edges are")
    print("        derived from different snapshots; a LARGE systematic excess")
    print("        would indicate Cites/IsCitedBy double-counting)")

    # 3. reverse consistency
    print("\n3. reverse consistency (refs[a] contains b  <=>  cites[b] contains a)")
    # A few range scans from random start points beats 2000 point queries and
    # still spreads the sample across both the OA (k<0) and SciSciNet (k>0) halves.
    tested = mismatched = 0
    starts = [-33_000_000, -1_000_000, 1, 100_000_000, 2_000_000_000]
    for start in starts:
        for k, blob in con.execute(
            "SELECT k, neighbors FROM openaire_refs WHERE k >= ? LIMIT 400", (start,)
        ):
            nbrs = unpack(blob)
            if not nbrs:
                continue
            b = random.choice(nbrs)
            rev = con.execute(
                "SELECT total, neighbors FROM openaire_cites WHERE k = ?", (b,)
            ).fetchone()
            tested += 1
            # Only a real mismatch when the reverse list wasn't capped: a capped
            # list legitimately drops low-cited citers.
            if not rev:
                mismatched += 1
            elif k not in unpack(rev[1]) and rev[0] <= cap:
                mismatched += 1
    check(mismatched == 0, f"{mismatched}/{tested} uncapped reverse lookups missing")

    # 4. degrees
    print("\n4. degree distribution")
    for table in ("openaire_refs", "openaire_cites"):
        n, mx, avg, capped = con.execute(
            f"SELECT COUNT(*), MAX(total), AVG(total), SUM(total > {cap}) FROM {table}"
        ).fetchone()
        print(f"  {table}: {n:,} rows, max {mx:,}, mean {avg:.1f}, {capped or 0:,} capped")
        bad = con.execute(
            f"SELECT COUNT(*) FROM {table} WHERE LENGTH(neighbors) % 8 != 0"
        ).fetchone()[0]
        check(bad == 0, f"{table} blobs are whole int64s")
        bad2 = con.execute(
            f"SELECT COUNT(*) FROM {table} WHERE LENGTH(neighbors)/8 > {cap}"
        ).fetchone()[0]
        check(bad2 == 0, f"{table} respects the {cap} cap")

    # 5. impact
    print("\n5. impact table")
    n_imp, mx = con.execute(
        "SELECT COUNT(*), MAX(citation_count) FROM openaire_paper_impact"
    ).fetchone()
    print(f"  {n_imp:,} rows, max citation_count {mx:,}")
    zero = con.execute(
        "SELECT COUNT(*) FROM openaire_paper_impact WHERE citation_count <= 0"
    ).fetchone()[0]
    check(zero == 0, "no zero/negative counts stored (absence means zero)")
    badcls = con.execute(
        "SELECT COUNT(*) FROM openaire_paper_impact "
        "WHERE citation_class NOT IN ('C1','C2','C3','C4','C5') AND citation_class IS NOT NULL"
    ).fetchone()[0]
    check(badcls == 0, "citation_class values are all C1..C5")
    print("  class distribution:")
    for cls, n in con.execute(
        "SELECT citation_class, COUNT(*) FROM openaire_paper_impact GROUP BY 1 ORDER BY 1"
    ):
        print(f"     {cls}: {n:,}")

    # 6. integrity
    print("\n6. integrity_check")
    r = con.execute("PRAGMA integrity_check").fetchone()[0]
    check(r == "ok", "sqlite integrity", r if r != "ok" else "")

    print()
    if failures:
        print(f"FAILED {len(failures)} check(s): {failures}")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
