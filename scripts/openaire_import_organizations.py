#!/usr/bin/env python3
"""Import OpenAIRE organizations + project participation — Pass 5 of the pipeline.

Streams organization.tar, matches orgs to SciSciNet institutions via ROR
(affiliation_summary.ror stores bare ROR ids; OpenAIRE pids carry
scheme 'ROR' with https://ror.org/ URLs), then streams
project_hasParticipant.tar (source=project, target=organization) into
org_projects and computes per-institution project counts.

Usage:
  python3 openaire_import_organizations.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --journals-db "/media/dan/Seagate Portable Drive/sciscinet-dashboard_database_backup_01_29_2026/data/journals.db" \
    --db-path ~/openaire-build/openaire.db --rebuild
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import stream_tar_jsonl, normalize_ror

DDL = """
DROP TABLE IF EXISTS org_openaire;
CREATE TABLE org_openaire (
  institution_id TEXT PRIMARY KEY,
  openaire_org_id TEXT NOT NULL,
  ror TEXT,
  legal_name TEXT,
  legal_shortname TEXT,
  country_code TEXT,
  project_count INTEGER DEFAULT 0
) WITHOUT ROWID;
DROP TABLE IF EXISTS org_projects;
CREATE TABLE org_projects (
  institution_id TEXT NOT NULL,
  openaire_project_id TEXT NOT NULL,
  PRIMARY KEY (institution_id, openaire_project_id)
) WITHOUT ROWID;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--journals-db", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    dump = Path(args.dump_dir)
    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    if not args.rebuild:
        exists = out.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='org_openaire'"
        ).fetchone()
        if exists:
            sys.exit("org tables exist; pass --rebuild to recreate")
    out.executescript(DDL)

    # ROR (bare id) -> institution_id map from SciSciNet
    journals = sqlite3.connect(f"file:{args.journals_db}?mode=ro&immutable=1", uri=True)
    ror_map = {}
    for institution_id, ror in journals.execute(
        "SELECT institution_id, ror FROM affiliation_summary WHERE ror IS NOT NULL AND ror != ''"
    ):
        norm = normalize_ror(ror)
        if norm:
            ror_map[norm] = institution_id
    journals.close()
    print(f"loaded {len(ror_map):,} SciSciNet institutions with ROR")

    # Pass A: organizations
    t0 = time.time()
    total = matched = 0
    org_to_institution = {}  # openaire org id -> institution_id (matched only)
    for rec in stream_tar_jsonl(dump / "organization.tar"):
        total += 1
        ror = None
        for pid in rec.get("pids") or []:
            if str(pid.get("scheme", "")).upper() == "ROR":
                ror = normalize_ror(pid.get("value"))
                if ror:
                    break
        if not ror:
            continue
        institution_id = ror_map.get(ror)
        if not institution_id:
            continue
        country = rec.get("country") or {}
        # first-wins if multiple OpenAIRE orgs share a ROR (dedup artifacts)
        before = out.total_changes
        out.execute(
            "INSERT OR IGNORE INTO org_openaire VALUES (?,?,?,?,?,?,0)",
            (
                institution_id,
                rec.get("id"),
                ror,
                rec.get("legalName"),
                rec.get("legalShortName"),
                country.get("code"),
            ),
        )
        if out.total_changes > before:
            matched += 1
            org_to_institution[rec.get("id")] = institution_id
    out.commit()
    print(
        f"organizations: {total:,} scanned, {matched:,} matched to institutions "
        f"in {time.time() - t0:,.0f}s"
    )

    # Pass B: project participation (source=project, target=organization)
    t0 = time.time()
    rels = kept = 0
    batch = []
    for rec in stream_tar_jsonl(dump / "project_hasParticipant.tar"):
        rels += 1
        institution_id = org_to_institution.get(rec.get("target"))
        if institution_id:
            batch.append((institution_id, rec.get("source")))
            if len(batch) >= 10_000:
                out.executemany("INSERT OR IGNORE INTO org_projects VALUES (?,?)", batch)
                kept += len(batch)
                batch = []
    if batch:
        out.executemany("INSERT OR IGNORE INTO org_projects VALUES (?,?)", batch)
        kept += len(batch)
    out.commit()
    print(f"participation: {rels:,} relations scanned, {kept:,} kept in {time.time() - t0:,.0f}s")

    out.execute(
        """UPDATE org_openaire SET project_count =
           (SELECT COUNT(*) FROM org_projects WHERE org_projects.institution_id = org_openaire.institution_id)"""
    )
    out.execute(
        "CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT)"
    )
    out.execute(
        "INSERT OR REPLACE INTO import_meta VALUES ('orgs_imported_at', datetime('now'))"
    )
    out.commit()
    out.execute("ANALYZE")
    out.commit()

    n_orgs = out.execute("SELECT COUNT(*) FROM org_openaire").fetchone()[0]
    n_links = out.execute("SELECT COUNT(*) FROM org_projects").fetchone()[0]
    print(f"\nDone: {n_orgs:,} orgs, {n_links:,} org-project links")
    print("top orgs by project count:")
    for name, cc, n in out.execute(
        "SELECT legal_name, country_code, project_count FROM org_openaire ORDER BY project_count DESC LIMIT 8"
    ):
        print(f"  {n:7,d}  {name} ({cc})")
    out.close()


if __name__ == "__main__":
    main()
