#!/usr/bin/env python3
"""Build the staging lookup.db for the OpenAIRE import pipeline (Pass 1).

Creates four lookup tables used when streaming the OpenAIRE publication dump:
  doi_lookup(doi PK, paperid)     from journals.db paper_summary
                                  (DOI stored there as https://doi.org/... — normalized here)
  pmid_lookup(pmid PK, paperid)   from papers_extra.db paper_pubmed
  orcid_lookup(orcid PK, authorid, works_count)
                                  from journals.db person_summary (full-URL orcid, no index
                                  on the column → full scan; collisions keep highest works_count)
  issn_lookup(issn PK, sourceid)  from journals.db journal_summary (issn is a JSON array
                                  of hyphenated ISSNs; normalized to bare 8 chars, first-wins)

lookup.db is a build artifact — keep it on fast local disk (NVMe), never ship it.

Usage:
  python3 openaire_build_lookup.py \
    --journals-db "/media/dan/Seagate Portable Drive/sciscinet-dashboard_database_backup_01_29_2026/data/journals.db" \
    --papers-extra-db "/media/dan/Seagate Portable Drive/sciscinet-dashboard_database_backup_01_29_2026/data/papers_extra.db" \
    --output ~/openaire-build/lookup.db --rebuild
"""

import argparse
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import normalize_doi, normalize_orcid

BATCH = 100_000


def normalize_issn(raw):
    """Normalize an ISSN to bare 8 uppercase chars (digits + X), or None."""
    if not raw:
        return None
    issn = re.sub(r"[^0-9Xx]", "", str(raw)).upper()
    return issn if len(issn) == 8 else None


def build_doi_lookup(out, journals):
    print("building doi_lookup from paper_summary...")
    t0 = time.time()
    out.execute("DROP TABLE IF EXISTS doi_lookup")
    out.execute(
        "CREATE TABLE doi_lookup (doi TEXT PRIMARY KEY, paperid TEXT) WITHOUT ROWID"
    )
    cur = journals.execute(
        "SELECT doi, paperid FROM paper_summary WHERE doi IS NOT NULL AND doi != ''"
    )
    total, dupes, malformed = 0, 0, 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        batch = []
        for doi, paperid in rows:
            norm = normalize_doi(doi)
            if norm is None:
                malformed += 1
                continue
            batch.append((norm, paperid))
        # first-wins on collisions (INSERT OR IGNORE)
        before = out.total_changes
        out.executemany("INSERT OR IGNORE INTO doi_lookup VALUES (?,?)", batch)
        inserted = out.total_changes - before
        dupes += len(batch) - inserted
        total += len(rows)
        if total % 20_000_000 == 0:
            print(f"  {total:,} scanned ({total / (time.time() - t0):,.0f}/s)")
    out.commit()
    n = out.execute("SELECT COUNT(*) FROM doi_lookup").fetchone()[0]
    print(
        f"  done: {n:,} unique DOIs from {total:,} rows "
        f"({dupes:,} dupes, {malformed:,} malformed) in {time.time() - t0:,.0f}s"
    )


def build_pmid_lookup(out, extra):
    print("building pmid_lookup from paper_pubmed...")
    t0 = time.time()
    out.execute("DROP TABLE IF EXISTS pmid_lookup")
    out.execute(
        "CREATE TABLE pmid_lookup (pmid INTEGER PRIMARY KEY, paperid TEXT) WITHOUT ROWID"
    )
    cur = extra.execute("SELECT pmid, paperid FROM paper_pubmed WHERE pmid IS NOT NULL")
    total = 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        out.executemany("INSERT OR IGNORE INTO pmid_lookup VALUES (?,?)", rows)
        total += len(rows)
    out.commit()
    n = out.execute("SELECT COUNT(*) FROM pmid_lookup").fetchone()[0]
    print(f"  done: {n:,} PMIDs from {total:,} rows in {time.time() - t0:,.0f}s")


def build_orcid_lookup(out, journals):
    print("building orcid_lookup from person_summary (full scan, no orcid index)...")
    t0 = time.time()
    out.execute("DROP TABLE IF EXISTS orcid_lookup")
    out.execute(
        "CREATE TABLE orcid_lookup (orcid TEXT PRIMARY KEY, authorid TEXT, works_count INTEGER) WITHOUT ROWID"
    )
    cur = journals.execute(
        "SELECT orcid, authorid, works_count FROM person_summary "
        "WHERE orcid IS NOT NULL AND orcid != ''"
    )
    total, collisions, invalid = 0, 0, 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for orcid, authorid, works in rows:
            norm = normalize_orcid(orcid)
            if norm is None:
                invalid += 1
                continue
            # collisions keep the author with the most works
            existing = out.execute(
                "SELECT works_count FROM orcid_lookup WHERE orcid = ?", (norm,)
            ).fetchone()
            if existing is None:
                out.execute(
                    "INSERT INTO orcid_lookup VALUES (?,?,?)", (norm, authorid, works or 0)
                )
            else:
                collisions += 1
                if (works or 0) > (existing[0] or 0):
                    out.execute(
                        "UPDATE orcid_lookup SET authorid=?, works_count=? WHERE orcid=?",
                        (authorid, works or 0, norm),
                    )
        total += len(rows)
        if total % 2_000_000 == 0:
            print(f"  {total:,} orcid rows ({total / (time.time() - t0):,.0f}/s)")
    out.commit()
    n = out.execute("SELECT COUNT(*) FROM orcid_lookup").fetchone()[0]
    print(
        f"  done: {n:,} unique ORCIDs from {total:,} rows "
        f"({collisions:,} collisions, {invalid:,} invalid) in {time.time() - t0:,.0f}s"
    )


def build_issn_lookup(out, journals):
    print("building issn_lookup from journal_summary...")
    t0 = time.time()
    out.execute("DROP TABLE IF EXISTS issn_lookup")
    out.execute(
        "CREATE TABLE issn_lookup (issn TEXT PRIMARY KEY, sourceid TEXT) WITHOUT ROWID"
    )
    total, collisions = 0, 0
    for sourceid, issn_raw in journals.execute(
        "SELECT sourceid, issn FROM journal_summary WHERE issn IS NOT NULL AND issn != '' AND issn != 'null'"
    ):
        issns = []
        raw = str(issn_raw).strip()
        if raw.startswith("["):
            try:
                issns = [x for x in json.loads(raw) if x]
            except json.JSONDecodeError:
                issns = [raw]
        else:
            issns = [raw]
        for issn in issns:
            norm = normalize_issn(issn)
            if not norm:
                continue
            before = out.total_changes
            out.execute("INSERT OR IGNORE INTO issn_lookup VALUES (?,?)", (norm, sourceid))
            if out.total_changes == before:
                collisions += 1
            else:
                total += 1
    out.commit()
    print(
        f"  done: {total:,} ISSN mappings ({collisions:,} collisions, first-wins) "
        f"in {time.time() - t0:,.0f}s"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--journals-db", required=True)
    ap.add_argument("--papers-extra-db", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument(
        "--only",
        choices=["doi", "pmid", "orcid", "issn"],
        help="rebuild a single table",
    )
    args = ap.parse_args()

    out_path = Path(args.output).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and not args.rebuild and not args.only:
        sys.exit(f"{out_path} exists; pass --rebuild (or --only <table>)")

    out = sqlite3.connect(out_path)
    out.executescript(
        "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;"
    )
    journals = sqlite3.connect(f"file:{args.journals_db}?mode=ro&immutable=1", uri=True)
    extra = sqlite3.connect(f"file:{args.papers_extra_db}?mode=ro&immutable=1", uri=True)

    t0 = time.time()
    tables = [args.only] if args.only else ["issn", "orcid", "pmid", "doi"]
    if "issn" in tables:
        build_issn_lookup(out, journals)
    if "orcid" in tables:
        build_orcid_lookup(out, journals)
    if "pmid" in tables:
        build_pmid_lookup(out, extra)
    if "doi" in tables:
        build_doi_lookup(out, journals)

    print(f"\nAll done in {(time.time() - t0) / 60:,.1f} min → {out_path}")
    out.close()


if __name__ == "__main__":
    main()
