#!/usr/bin/env python3
"""Import PubMed publication types, grants and databank accessions -> data/pubmed.db.

WHY: journals.db classifies papers by field and citation count, but says nothing about
STUDY DESIGN. PubMed's PublicationType is the only large-scale source for "is this an
RCT, a review, a meta-analysis, a case report" — which is what makes evidence-hierarchy
trends measurable. It also carries grant links (13.8% of articles, better than Crossref's
2.6%) and DataBank accessions, a concrete open-science indicator.

SCOPE: this does NOT touch mesh.db. That database holds MeSH from the 2025 baseline and
backs a working feature; rebuilding it is a separate, optional job. We only add the
non-MeSH PubMed fields, in their own database.

MEASURED (90,000 real articles across 3 baseline files, 2026-08-28):
  publication types  1.63 rows/article -> ~62M
  grants             0.52 rows/article -> ~20M
  databank accession 0.054 rows/article -> ~2.1M
  ArticleDate present on 51.5%, hence the PubDate year fallback below.

Parsing follows scripts/download_mesh.py:137 (extract_mesh_from_xml), which has run over
1,274 of these files: gzip -> ET.iterparse(end events) -> clear() each article.

Usage:
  python3 scripts/pubmed_import.py \
    --baseline-dir /mnt/metascience/datasets/ncbi_pubmed_baseline-2026 \
    --db-path data/pubmed.db --rebuild
"""

import argparse
import gzip
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

BATCH = 50_000

# <MedlineDate>2017 May - Jun</MedlineDate> -- take the leading 4-digit year.
MEDLINE_YEAR = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\b")

DDL = """
DROP TABLE IF EXISTS paper_pubtypes;
DROP TABLE IF EXISTS pubtype_terms;
DROP TABLE IF EXISTS paper_grants;
DROP TABLE IF EXISTS paper_databanks;
DROP TABLE IF EXISTS article_dates;

CREATE TABLE paper_pubtypes (
  pmid INTEGER NOT NULL,
  type_ui TEXT NOT NULL,
  PRIMARY KEY (pmid, type_ui)
) WITHOUT ROWID;

-- Names live here once, not repeated across ~62M rows.
CREATE TABLE pubtype_terms (type_ui TEXT PRIMARY KEY, type_name TEXT NOT NULL);

CREATE TABLE paper_grants (
  pmid INTEGER NOT NULL, rank INTEGER NOT NULL,
  grant_id TEXT, acronym TEXT, agency TEXT, country TEXT,
  PRIMARY KEY (pmid, rank)
) WITHOUT ROWID;

CREATE TABLE paper_databanks (
  pmid INTEGER NOT NULL, rank INTEGER NOT NULL,
  databank TEXT NOT NULL, accession TEXT NOT NULL,
  PRIMARY KEY (pmid, rank)
) WITHOUT ROWID;

-- e_* is the electronic ArticleDate (51.5% coverage); pub_year is the journal PubDate
-- year, which is near-universal. Rollups use COALESCE(e_year, pub_year).
CREATE TABLE article_dates (
  pmid INTEGER PRIMARY KEY,
  e_year INTEGER, e_month INTEGER, e_day INTEGER,
  pub_year INTEGER
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS processed_files (filename TEXT PRIMARY KEY, processed_at TEXT);
"""

INDEXES = """
CREATE INDEX IF NOT EXISTS idx_grants_agency  ON paper_grants(agency);
CREATE INDEX IF NOT EXISTS idx_databanks_acc  ON paper_databanks(accession);
CREATE INDEX IF NOT EXISTS idx_databanks_name ON paper_databanks(databank);
CREATE INDEX IF NOT EXISTS idx_pubtypes_ui    ON paper_pubtypes(type_ui);
CREATE INDEX IF NOT EXISTS idx_dates_pubyear  ON article_dates(pub_year);
"""


def _int(text):
    try:
        return int((text or "").strip())
    except (TypeError, ValueError):
        return None


def pub_year_of(article):
    """Journal PubDate year. 96.6% use <Year>; 3.4% only a free-text <MedlineDate>."""
    pd = article.find(".//JournalIssue/PubDate")
    if pd is None:
        return None
    y = pd.find("Year")
    if y is not None:
        return _int(y.text)
    md = pd.find("MedlineDate")
    if md is not None and md.text:
        m = MEDLINE_YEAR.search(md.text)
        if m:
            return int(m.group(1))
    return None


def parse_article(elem):
    """One <PubmedArticle> -> (pmid, pubtypes, grants, databanks, dates) or None."""
    pmid_el = elem.find(".//PMID")
    pmid = _int(pmid_el.text) if pmid_el is not None else None
    if pmid is None:
        return None

    pubtypes = []
    for pt in elem.findall(".//PublicationType"):
        ui = (pt.get("UI") or "").strip()
        if ui:
            pubtypes.append((ui, (pt.text or "").strip()))

    grants = []
    for i, g in enumerate(elem.findall(".//Grant")):
        def t(tag):
            e = g.find(tag)
            return (e.text or "").strip() if e is not None and e.text else None
        grants.append((i, t("GrantID"), t("Acronym"), t("Agency"), t("Country")))

    databanks = []
    rank = 0
    for db in elem.findall(".//DataBank"):
        name_el = db.find("DataBankName")
        name = (name_el.text or "").strip() if name_el is not None else None
        if not name:
            continue
        for acc in db.findall(".//AccessionNumber"):
            if acc.text and acc.text.strip():
                databanks.append((rank, name, acc.text.strip()))
                rank += 1

    ad = elem.find(".//ArticleDate")
    e_y = e_m = e_d = None
    if ad is not None:
        e_y = _int(ad.findtext("Year"))
        e_m = _int(ad.findtext("Month"))
        e_d = _int(ad.findtext("Day"))

    return pmid, pubtypes, grants, databanks, (e_y, e_m, e_d, pub_year_of(elem))


def process_file(path, con, terms):
    """Returns counts; commits at the end so a crash costs at most one file."""
    cur = con.cursor()
    if cur.execute("SELECT 1 FROM processed_files WHERE filename=?", (path.name,)).fetchone():
        return None

    pt_rows, gr_rows, db_rows, dt_rows = [], [], [], []
    n = 0

    def flush():
        if pt_rows:
            cur.executemany("INSERT OR IGNORE INTO paper_pubtypes VALUES (?,?)", pt_rows); pt_rows.clear()
        if gr_rows:
            cur.executemany("INSERT OR IGNORE INTO paper_grants VALUES (?,?,?,?,?,?)", gr_rows); gr_rows.clear()
        if db_rows:
            cur.executemany("INSERT OR IGNORE INTO paper_databanks VALUES (?,?,?,?)", db_rows); db_rows.clear()
        if dt_rows:
            cur.executemany("INSERT OR REPLACE INTO article_dates VALUES (?,?,?,?,?)", dt_rows); dt_rows.clear()

    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        # iterparse + clear(): a baseline file holds ~30k articles and reaches 272 MB
        # compressed, so the whole tree must never be materialised.
        for _, elem in ET.iterparse(f, events=("end",)):
            if elem.tag != "PubmedArticle":
                continue
            parsed = parse_article(elem)
            elem.clear()
            if parsed is None:
                continue
            pmid, pubtypes, grants, databanks, dates = parsed
            n += 1
            for ui, name in pubtypes:
                pt_rows.append((pmid, ui))
                if ui not in terms:
                    terms[ui] = name
            for rank, gid, acr, agency, country in grants:
                gr_rows.append((pmid, rank, gid, acr, agency, country))
            for rank, name, acc in databanks:
                db_rows.append((pmid, rank, name, acc))
            if any(d is not None for d in dates):
                dt_rows.append((pmid, *dates))
            if len(pt_rows) >= BATCH:
                flush()

    flush()
    # Write the UI->name map with EVERY file, not once at the end. It is tiny (66
    # distinct types across the whole corpus) and paper_pubtypes is useless without
    # it: the API and charts filter on type_name, so an interrupted import would
    # leave tens of millions of rows of bare D0164xx codes and silently empty
    # charts. Deferring this was the same mistake as the ORCID importer's single
    # final commit.
    cur.executemany("INSERT OR REPLACE INTO pubtype_terms VALUES (?,?)", terms.items())
    cur.execute("INSERT OR REPLACE INTO processed_files VALUES (?, datetime('now'))", (path.name,))
    # Commit per FILE. The ORCID importer deferred every write to a single final commit
    # and sat at 0 bytes on disk for hours, so a crash would have cost the whole run.
    con.commit()
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--limit-files", type=int, default=0, help="stop after N files (testing)")
    args = ap.parse_args()

    files = sorted(Path(args.baseline_dir).expanduser().glob("*.xml.gz"))
    if not files:
        sys.exit(f"no *.xml.gz under {args.baseline_dir}")

    out_path = Path(args.db_path).expanduser()
    if out_path.exists() and not args.rebuild:
        sys.exit(f"{out_path} exists; pass --rebuild")

    con = sqlite3.connect(out_path)
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    if args.rebuild:
        con.executescript(DDL)
        con.execute("DELETE FROM processed_files")
        con.commit()

    terms = dict(con.execute("SELECT type_ui, type_name FROM pubtype_terms"))
    t0 = time.time()
    total_articles = done = skipped = 0

    for i, path in enumerate(files, 1):
        if args.limit_files and done >= args.limit_files:
            break
        n = process_file(path, con, terms)
        if n is None:
            skipped += 1
            continue
        done += 1
        total_articles += n
        if done % 25 == 0 or done == 1:
            el = time.time() - t0
            rate = done / el * 60 if el else 0
            print(f"  {done}/{len(files)} files | {total_articles:,} articles | "
                  f"{rate:,.0f} files/min | {el/60:,.1f} min", flush=True)

    con.executemany("INSERT OR REPLACE INTO pubtype_terms VALUES (?,?)", terms.items())
    con.commit()
    print("creating indexes ...", flush=True)
    con.executescript(INDEXES)
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('pubmed_imported_at', datetime('now'))")
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('baseline_dir', ?)", (str(args.baseline_dir),))
    con.commit()
    con.execute("ANALYZE")
    con.commit()

    print(f"\nDone in {(time.time()-t0)/60:,.1f} min ({done} files, {skipped} already done)")
    for label, sql in [
        ("articles with dates", "SELECT COUNT(*) FROM article_dates"),
        ("pubtype rows", "SELECT COUNT(*) FROM paper_pubtypes"),
        ("distinct pubtypes", "SELECT COUNT(*) FROM pubtype_terms"),
        ("grant rows", "SELECT COUNT(*) FROM paper_grants"),
        ("databank rows", "SELECT COUNT(*) FROM paper_databanks"),
    ]:
        print(f"  {label:22} {con.execute(sql).fetchone()[0]:>12,}")
    print("\n  top publication types:")
    for name, c in con.execute(
        "SELECT t.type_name, COUNT(*) c FROM paper_pubtypes p JOIN pubtype_terms t "
        "USING(type_ui) GROUP BY 1 ORDER BY c DESC LIMIT 10"
    ):
        print(f"    {c:>10,}  {name}")
    con.close()


if __name__ == "__main__":
    main()
