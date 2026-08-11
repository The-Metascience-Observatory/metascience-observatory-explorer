#!/usr/bin/env python3
"""Import paper→dataset/software links — Pass 4b of the pipeline (relation-files mode).

Two sub-passes:
  A) stream result↔result relation tars (IsSupplementedBy, HasPart, References),
     keep relations whose SOURCE is a known paper (SciSciNet-matched or first-class
     OpenAIRE), staging (paper_key, target_id, relation) into a scratch links.db.
  B) stream dataset_*.tar, software.tar, otherresearchproduct_*.tar; records whose
     id appears as a staged target contribute title/doi/year metadata →
     paper_linked_products. Targets that are publications simply never resolve,
     which filters the links down to datasets/software/other automatically.

Run AFTER openaire_finalize_new_papers.py (needs both id translations).

Usage:
  python3 openaire_import_linked_products.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --db-path ~/openaire-build/openaire.db \
    --links-db ~/openaire-build/links.db --rebuild
"""

import argparse
import glob
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import stream_tar_jsonl, extract_pids

RELATION_TARS = [
    "product_IsSupplementedBy.tar",
    "product_HasPart.tar",
    "product_References.tar",
]

PRODUCT_TAR_TYPES = [
    ("dataset_*.tar", "dataset"),
    ("software.tar", "software"),
    ("otherresearchproduct_*.tar", "other"),
]

BATCH = 20_000

DDL = """
DROP TABLE IF EXISTS paper_linked_products;
CREATE TABLE paper_linked_products (
  paperid TEXT NOT NULL,
  target_openaire_id TEXT NOT NULL,
  relation TEXT,
  product_type TEXT,
  title TEXT, doi TEXT, publisher TEXT, year INTEGER,
  PRIMARY KEY (paperid, target_openaire_id)
) WITHOUT ROWID;
"""


def parse_year(date_str):
    if not date_str or len(str(date_str)) < 4:
        return None
    try:
        y = int(str(date_str)[:4])
        return y if 1400 <= y <= 2100 else None
    except ValueError:
        return None


def translate_sources(out, sources):
    result = {}
    ids = list(sources)
    for i in range(0, len(ids), 500):
        chunk = ids[i : i + 500]
        ph = ",".join("?" * len(chunk))
        for oaid, paperid in out.execute(
            f"SELECT openaire_id, paperid FROM paper_openaire WHERE openaire_id IN ({ph})", chunk
        ):
            result[oaid] = paperid
        for oaid, appid in out.execute(
            f"SELECT openaire_id, id FROM openaire_papers WHERE openaire_id IN ({ph})", chunk
        ):
            result.setdefault(oaid, appid)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--links-db", required=True)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    dump = Path(args.dump_dir)
    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    if not args.rebuild:
        exists = out.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='paper_linked_products'"
        ).fetchone()
        if exists:
            sys.exit("paper_linked_products exists; pass --rebuild")
    out.executescript(DDL)

    links_path = Path(args.links_db).expanduser()
    if links_path.exists():
        links_path.unlink()
    links = sqlite3.connect(links_path)
    links.executescript(
        """PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
           CREATE TABLE links (paper_key TEXT, target TEXT, relation TEXT);"""
    )

    # Sub-pass A: relations with a known-paper source
    for tar_name in RELATION_TARS:
        tar_path = dump / tar_name
        if not tar_path.exists():
            print(f"skip {tar_name} (not downloaded)")
            continue
        t0 = time.time()
        total = kept = 0
        batch = []

        def process(batch):
            nonlocal kept
            translated = translate_sources(out, {s for s, _, _ in batch})
            rows = [
                (translated[s], t, r) for s, t, r in batch if s in translated
            ]
            if rows:
                links.executemany("INSERT INTO links VALUES (?,?,?)", rows)
                kept += len(rows)

        for rec in stream_tar_jsonl(tar_path):
            total += 1
            if rec.get("targetType") != "product":
                continue
            batch.append(
                (rec.get("source"), rec.get("target"), (rec.get("relType") or {}).get("name"))
            )
            if len(batch) >= BATCH:
                process(batch)
                batch = []
        if batch:
            process(batch)
        links.commit()
        print(f"{tar_name}: {total:,} relations, {kept:,} from known papers ({time.time() - t0:,.0f}s)")

    links.execute("CREATE INDEX idx_links_target ON links(target)")
    links.commit()
    n_links = links.execute("SELECT COUNT(*) FROM links").fetchone()[0]
    n_targets = links.execute("SELECT COUNT(DISTINCT target) FROM links").fetchone()[0]
    print(f"staged {n_links:,} links to {n_targets:,} distinct targets")

    # Sub-pass B: resolve target metadata from dataset/software/other tars
    for pattern, ptype in PRODUCT_TAR_TYPES:
        for tar_path in sorted(glob.glob(str(dump / pattern))):
            t0 = time.time()
            total = resolved = 0
            rows = []
            for rec in stream_tar_jsonl(Path(tar_path)):
                total += 1
                rid = rec.get("id")
                if not rid:
                    continue
                hits = links.execute(
                    "SELECT paper_key, relation FROM links WHERE target = ?", (rid,)
                ).fetchall()
                if not hits:
                    continue
                pids = extract_pids(rec)
                doi = pids["doi"][0] if pids["doi"] else None
                title = rec.get("mainTitle")
                publisher = rec.get("publisher")
                year = parse_year(rec.get("publicationDate"))
                for paper_key, relation in hits:
                    rows.append((paper_key, rid, relation, ptype, title, doi, publisher, year))
                resolved += 1
                if len(rows) >= BATCH:
                    out.executemany(
                        "INSERT OR IGNORE INTO paper_linked_products VALUES (?,?,?,?,?,?,?,?)", rows
                    )
                    rows = []
            if rows:
                out.executemany(
                    "INSERT OR IGNORE INTO paper_linked_products VALUES (?,?,?,?,?,?,?,?)", rows
                )
            out.commit()
            print(
                f"{Path(tar_path).name}: {total:,} records, {resolved:,} linked targets "
                f"({(time.time() - t0) / 60:,.1f} min)"
            )

    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('linked_products_imported_at', datetime('now'))")
    out.commit()
    out.execute("ANALYZE")
    out.commit()

    n = out.execute("SELECT COUNT(*) FROM paper_linked_products").fetchone()[0]
    print(f"\nDone: {n:,} paper→product links")
    for t, c in out.execute(
        "SELECT product_type, COUNT(*) FROM paper_linked_products GROUP BY 1 ORDER BY 2 DESC"
    ):
        print(f"  {c:10,d}  {t}")
    out.close()
    links.close()
    links_path.unlink()
    print(f"dropped {links_path}")


if __name__ == "__main__":
    main()
