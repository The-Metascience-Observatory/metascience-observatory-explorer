#!/usr/bin/env python3
"""Finalize staged OpenAIRE candidates into first-class papers — Pass 3b.

Reads stage.db (written by openaire_import_publications.py), picks one winner
per DOI (highest metadata score), resolves journal links via ISSN and author
links via validated ORCID (from lookup.db), and builds:
  openaire.db:            openaire_papers, openaire_paper_authors, openaire_title_fts
  openaire_abstracts.db:  openaire_abstracts

App-facing id is 'OA' + the 32-hex suffix of the OpenAIRE record id.

Usage:
  python3 openaire_finalize_new_papers.py \
    --stage-db ~/openaire-build/stage.db \
    --lookup-db ~/openaire-build/lookup.db \
    --db-path ~/openaire-build/openaire.db \
    --abstracts-db-path ~/openaire-build/openaire_abstracts.db --rebuild
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import normalize_orcid

try:
    import orjson

    def json_loads(b):
        return orjson.loads(b)
except ImportError:
    import json

    def json_loads(b):
        return json.loads(b)

BATCH = 20_000

DDL = """
DROP TABLE IF EXISTS openaire_papers;
CREATE TABLE openaire_papers (
  id TEXT NOT NULL,
  openaire_id TEXT NOT NULL,
  doi TEXT NOT NULL,
  pmid TEXT,
  title TEXT, subtitle TEXT,
  publication_date TEXT, year INTEGER,
  type TEXT, language TEXT, publisher TEXT,
  journal_name TEXT, issn_printed TEXT, issn_online TEXT,
  matched_sourceid TEXT,
  volume TEXT, issue TEXT, start_page TEXT, end_page TEXT,
  best_access_right TEXT, oa_color TEXT,
  is_green INTEGER, is_diamond INTEGER, publicly_funded INTEGER,
  author_count INTEGER,
  has_abstract INTEGER
);
DROP TABLE IF EXISTS openaire_paper_authors;
CREATE TABLE openaire_paper_authors (
  id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  full_name TEXT,
  orcid TEXT,
  matched_authorid TEXT,
  PRIMARY KEY (id, rank)
) WITHOUT ROWID;
DROP TABLE IF EXISTS openaire_title_fts;
"""

ABSTRACTS_DDL = """
DROP TABLE IF EXISTS openaire_abstracts;
CREATE TABLE openaire_abstracts (
  id TEXT PRIMARY KEY,
  abstract TEXT,
  language TEXT
) WITHOUT ROWID;
"""


def norm_issn(raw):
    if not raw:
        return None
    issn = "".join(c for c in str(raw).upper() if c.isdigit() or c == "X")
    return issn if len(issn) == 8 else None


def parse_year(date_str):
    if not date_str or len(date_str) < 4:
        return None
    try:
        y = int(date_str[:4])
        return y if 1400 <= y <= 2100 else None
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stage-db", required=True)
    ap.add_argument("--lookup-db", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--abstracts-db-path", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--keep-stage", action="store_true", help="don't drop stage.db when done")
    args = ap.parse_args()

    stage = sqlite3.connect(Path(args.stage_db).expanduser())
    stage.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-4000000;")

    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    if not args.rebuild:
        exists = out.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='openaire_papers'"
        ).fetchone()
        if exists:
            sys.exit("openaire_papers exists; pass --rebuild")
    out.executescript(DDL)

    ab = sqlite3.connect(Path(args.abstracts_db_path).expanduser())
    ab.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    ab.executescript(ABSTRACTS_DDL)

    # in-RAM resolution maps (~2 GB)
    lookup = sqlite3.connect(f"file:{Path(args.lookup_db).expanduser()}?mode=ro&immutable=1", uri=True)
    t0 = time.time()
    issn_map = dict(lookup.execute("SELECT issn, sourceid FROM issn_lookup"))
    orcid_map = dict(lookup.execute("SELECT orcid, authorid FROM orcid_lookup"))
    lookup.close()
    print(f"loaded {len(issn_map):,} ISSNs, {len(orcid_map):,} ORCIDs in {time.time() - t0:,.0f}s")

    print("indexing stage (doi, score DESC)...")
    t0 = time.time()
    stage.execute("CREATE INDEX IF NOT EXISTS idx_stage_doi ON stage_candidates(doi, score DESC)")
    stage.commit()
    n_stage = stage.execute("SELECT COUNT(*) FROM stage_candidates").fetchone()[0]
    print(f"  {n_stage:,} staged candidates, indexed in {time.time() - t0:,.0f}s")

    print("selecting winners per DOI and writing final tables...")
    t0 = time.time()
    cur = stage.execute(
        """SELECT hex, doi, payload FROM (
             SELECT hex, doi, payload,
                    ROW_NUMBER() OVER (PARTITION BY doi ORDER BY score DESC, hex) AS rn
             FROM stage_candidates
           ) WHERE rn = 1"""
    )
    papers, authors, abstracts = [], [], []
    n = dupes_discarded = journal_matched = author_rows = orcid_matched = with_abstract = 0

    def flush():
        if papers:
            out.executemany(
                "INSERT INTO openaire_papers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                papers,
            )
        if authors:
            out.executemany(
                "INSERT OR IGNORE INTO openaire_paper_authors VALUES (?,?,?,?,?)", authors
            )
        if abstracts:
            ab.executemany("INSERT OR IGNORE INTO openaire_abstracts VALUES (?,?,?)", abstracts)
        papers.clear()
        authors.clear()
        abstracts.clear()

    for hex_part, doi, payload in cur:
        p = json_loads(payload)
        app_id = f"OA{hex_part}"
        sourceid = None
        for raw in (p.get("issn_p"), p.get("issn_o"), p.get("issn_l")):
            ni = norm_issn(raw)
            if ni and ni in issn_map:
                sourceid = issn_map[ni]
                break
        if sourceid:
            journal_matched += 1
        alist = p.get("authors") or []
        papers.append(
            (
                app_id,
                p.get("id"),
                doi,
                p.get("pmid"),
                p.get("title"),
                p.get("subtitle"),
                p.get("date"),
                parse_year(p.get("date")),
                p.get("type"),
                p.get("lang"),
                p.get("publisher"),
                p.get("journal"),
                p.get("issn_p"),
                p.get("issn_o"),
                sourceid,
                p.get("vol"),
                p.get("iss"),
                p.get("sp"),
                p.get("ep"),
                p.get("bar"),
                p.get("oac"),
                p.get("green"),
                p.get("diamond"),
                p.get("funded"),
                len(alist),
            )
            + ((1 if p.get("abstract") else 0),)
        )
        for a in alist:
            orcid = normalize_orcid(a.get("o"))
            matched = orcid_map.get(orcid) if orcid else None
            if matched:
                orcid_matched += 1
            authors.append((app_id, a.get("r") or 0, a.get("n"), orcid, matched))
            author_rows += 1
        if p.get("abstract"):
            abstracts.append((app_id, p["abstract"], p.get("lang")))
            with_abstract += 1
        n += 1
        if len(papers) >= BATCH:
            flush()
            if n % 2_000_000 == 0:
                print(f"  {n:,} papers ({n / (time.time() - t0):,.0f}/s)")
    flush()
    dupes_discarded = n_stage - n
    out.commit()
    ab.commit()
    print(f"  wrote {n:,} papers ({dupes_discarded:,} lower-scored DOI dupes discarded) in {(time.time() - t0) / 60:,.1f} min")

    print("creating indexes + FTS...")
    t0 = time.time()
    out.executescript(
        """
        CREATE UNIQUE INDEX idx_oap_id  ON openaire_papers(id);
        CREATE UNIQUE INDEX idx_oap_doi ON openaire_papers(doi);
        CREATE INDEX idx_oap_oaid ON openaire_papers(openaire_id);
        CREATE INDEX idx_oap_pmid ON openaire_papers(pmid) WHERE pmid IS NOT NULL;
        CREATE INDEX idx_oapa_matched ON openaire_paper_authors(matched_authorid)
          WHERE matched_authorid IS NOT NULL;
        CREATE VIRTUAL TABLE openaire_title_fts USING fts5(
          title, content='openaire_papers', content_rowid='rowid'
        );
        INSERT INTO openaire_title_fts(rowid, title)
          SELECT rowid, title FROM openaire_papers WHERE title IS NOT NULL;
        """
    )
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('new_papers_count', ?)", (str(n),))
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('new_papers_finalized_at', datetime('now'))")
    out.commit()
    out.execute("ANALYZE")
    out.commit()
    print(f"  done in {(time.time() - t0) / 60:,.1f} min")

    print(f"""
Verification:
  new papers:        {n:,}
  journal-matched:   {journal_matched:,} ({100 * journal_matched / max(n, 1):.1f}%)
  author rows:       {author_rows:,}
  ORCID-matched:     {orcid_matched:,} ({100 * orcid_matched / max(author_rows, 1):.1f}% of author rows)
  with abstract:     {with_abstract:,} ({100 * with_abstract / max(n, 1):.1f}%)
""")
    out.close()
    ab.close()
    stage.close()
    if not args.keep_stage:
        Path(args.stage_db).expanduser().unlink()
        print(f"dropped {args.stage_db}")


if __name__ == "__main__":
    main()
