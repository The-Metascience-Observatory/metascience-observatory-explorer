#!/usr/bin/env python3
"""Import project→paper funding links — Pass 4a of the pipeline.

Streams project_produces.tar (source=project, target=product) and writes
denormalized paper_projects rows for every target that matches either:
  * a SciSciNet-matched paper (paper_openaire.openaire_id → paperid), or
  * a first-class OpenAIRE paper  (openaire_papers.openaire_id → 'OA…' id)

Run AFTER openaire_finalize_new_papers.py so both translations exist.

Usage:
  python3 openaire_import_relations.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --db-path ~/openaire-build/openaire.db --rebuild
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import KeymapTranslator, stream_tar_jsonl

BATCH = 20_000

DDL = """
DROP TABLE IF EXISTS paper_projects;
CREATE TABLE paper_projects (
  paperid TEXT NOT NULL,
  openaire_project_id TEXT NOT NULL,
  code TEXT, acronym TEXT, title TEXT,
  funder_shortname TEXT, funding_stream TEXT,
  PRIMARY KEY (paperid, openaire_project_id)
) WITHOUT ROWID;
"""


def translate_targets(keymap, targets):
    """openaire product id -> app paper key (SciSciNet paperid or 'OA…' id).

    Keys on the md5 hex, NOT the full id string. `doi_dedup___::<hex>` (how the
    relation dumps overwhelmingly reference products) and `doi_________::<hex>`
    (how openaire_papers/paper_openaire mostly store them) are the same DOI, so
    the previous full-string `openaire_id IN (...)` matching here silently
    under-matched. See KeymapTranslator in openaire_common.py.
    """
    return keymap.translate(targets)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument(
        "--keymap-dir",
        required=True,
        help="directory of map_lo/map_hi/map_val .npy built by openaire_build_keymap.py",
    )
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    keymap = KeymapTranslator(Path(args.keymap_dir).expanduser())
    print(f"loaded keymap: {len(keymap):,} md5 keys")

    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    if not args.rebuild:
        exists = out.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='paper_projects'"
        ).fetchone()
        if exists:
            sys.exit("paper_projects exists; pass --rebuild")
    out.executescript(DDL)

    # project details in RAM (3.9M rows, small columns)
    projects = {
        row[0]: row[1:]
        for row in out.execute(
            "SELECT openaire_project_id, code, acronym, title, funder_shortname, funding_stream FROM projects"
        )
    }
    print(f"loaded {len(projects):,} projects")

    t0 = time.time()
    total = kept = missing_project = 0
    batch = []  # (project_id, target_id)
    rows = []

    def process(batch):
        nonlocal kept, missing_project
        translated = translate_targets(keymap, {t for _, t in batch})
        for proj_id, target in batch:
            paper_key = translated.get(target)
            if not paper_key:
                continue
            details = projects.get(proj_id)
            if details is None:
                missing_project += 1
                continue
            rows.append((paper_key, proj_id) + details)
        if rows:
            out.executemany(
                "INSERT OR IGNORE INTO paper_projects VALUES (?,?,?,?,?,?,?)", rows
            )
            kept += len(rows)
            rows.clear()

    for rec in stream_tar_jsonl(Path(args.dump_dir) / "project_produces.tar"):
        total += 1
        batch.append((rec.get("source"), rec.get("target")))
        if len(batch) >= BATCH:
            process(batch)
            batch = []
            if total % 2_000_000 == 0:
                print(f"  {total:,} relations ({total / (time.time() - t0):,.0f}/s), kept={kept:,}")
    if batch:
        process(batch)
    out.commit()

    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('paper_projects_imported_at', datetime('now'))")
    out.commit()
    out.execute("ANALYZE")
    out.commit()

    n = out.execute("SELECT COUNT(*) FROM paper_projects").fetchone()[0]
    ec = out.execute("SELECT COUNT(DISTINCT paperid) FROM paper_projects WHERE funder_shortname='EC'").fetchone()[0]
    print(
        f"\nDone: {total:,} relations scanned, {n:,} paper-project links "
        f"({missing_project:,} unknown projects) in {(time.time() - t0) / 60:,.1f} min"
    )
    print(f"papers with EC funding: {ec:,}")
    print("links by funder:")
    for f, c in out.execute(
        "SELECT funder_shortname, COUNT(*) FROM paper_projects GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
    ):
        print(f"  {c:10,d}  {f}")
    out.close()


if __name__ == "__main__":
    main()
