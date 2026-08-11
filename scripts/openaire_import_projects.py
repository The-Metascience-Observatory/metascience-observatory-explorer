#!/usr/bin/env python3
"""Import OpenAIRE Graph projects into openaire.db (Pass 2 of the pipeline).

Streams project.tar from the OpenAIRE Graph bulk dump (Zenodo record 20428976)
and builds the full `projects` table used for EU/national grant-code lookup.

Dump record shape (verified against v11.1.1):
  id: 'corda_______::<32-hex>'  (no '40|' prefix in dumps, unlike the API)
  fundings: [{shortName, name, jurisdiction, fundingStream: {id, description}}]
  granted: {currency, fundedAmount, totalCost}

Usage:
  python3 openaire_import_projects.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --db-path ~/openaire-build/openaire.db --rebuild
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import stream_tar_jsonl

BATCH_SIZE = 5000

DDL = """
DROP TABLE IF EXISTS projects;
CREATE TABLE projects (
  openaire_project_id TEXT PRIMARY KEY,
  code TEXT,
  acronym TEXT,
  title TEXT,
  funder_shortname TEXT,
  funder_name TEXT,
  funding_stream TEXT,
  jurisdiction TEXT,
  start_date TEXT,
  end_date TEXT,
  total_cost REAL,
  funded_amount REAL,
  currency TEXT,
  website_url TEXT
) WITHOUT ROWID;
"""


def extract_row(rec: dict):
    pid = rec.get("id")
    if not pid:
        return None
    funding = (rec.get("fundings") or [{}])[0] or {}
    stream = funding.get("fundingStream") or {}
    granted = rec.get("granted") or {}
    return (
        pid,
        rec.get("code"),
        rec.get("acronym"),
        rec.get("title"),
        funding.get("shortName"),
        funding.get("name"),
        stream.get("id"),
        funding.get("jurisdiction"),
        rec.get("startDate"),
        rec.get("endDate"),
        granted.get("totalCost"),
        granted.get("fundedAmount"),
        granted.get("currency"),
        rec.get("websiteUrl"),
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    tar_path = Path(args.dump_dir) / "project.tar"
    if not tar_path.exists():
        sys.exit(f"missing {tar_path}")

    db_path = Path(args.db_path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if not args.rebuild and db_path.exists():
        con = sqlite3.connect(db_path)
        exists = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        con.close()
        if exists:
            sys.exit("projects table already exists; pass --rebuild to recreate")

    con = sqlite3.connect(db_path)
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    con.executescript(DDL)

    t0 = time.time()
    total, skipped = 0, 0
    batch = []
    for rec in stream_tar_jsonl(tar_path):
        row = extract_row(rec)
        if row is None:
            skipped += 1
            continue
        batch.append(row)
        if len(batch) >= BATCH_SIZE:
            con.executemany(
                "INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch
            )
            total += len(batch)
            batch = []
            if total % 500_000 == 0:
                print(f"  {total:,} projects ({total / (time.time() - t0):,.0f}/s)")
    if batch:
        con.executemany(
            "INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch
        )
        total += len(batch)
    con.commit()

    print("creating indexes...")
    con.executescript(
        """
        CREATE INDEX idx_projects_funder_code ON projects(funder_shortname, code);
        CREATE INDEX idx_projects_code ON projects(code);
        """
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT)"
    )
    con.execute(
        "INSERT OR REPLACE INTO import_meta VALUES ('projects_imported_at', datetime('now'))"
    )
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('dump_version', '11.1.1')")
    con.commit()
    con.execute("ANALYZE")
    con.commit()

    print(f"\nDone: {total:,} projects in {time.time() - t0:,.0f}s (skipped {skipped})")
    print("\nTop funders:")
    for short, name, n in con.execute(
        """SELECT funder_shortname, funder_name, COUNT(*) FROM projects
           GROUP BY funder_shortname ORDER BY COUNT(*) DESC LIMIT 15"""
    ):
        print(f"  {n:9,d}  {short or '?'}  ({name or ''})")
    ec = con.execute(
        "SELECT COUNT(*) FROM projects WHERE funder_shortname='EC'"
    ).fetchone()[0]
    print(f"\nEC projects: {ec:,}")
    sample = con.execute(
        """SELECT code, acronym, title FROM projects
           WHERE funder_shortname='EC' AND acronym IS NOT NULL LIMIT 3"""
    ).fetchall()
    for row in sample:
        print("  sample EC:", row)
    con.close()


if __name__ == "__main__":
    main()
