#!/usr/bin/env python3
"""Build the precomputed /trends rollups from pubmed.db (run after pubmed_import.py).

Charts must never scan the ~62M-row per-article tables at request time, so this
collapses them to a few thousand rows the API can read whole. Same pattern as the
*_yearly_stats tables in journals.db and the ORCID mobility rollups.

EVERY ROW CARRIES ITS OWN DENOMINATOR (`year_total`). A share is meaningless without
the base it came from, and 1950 has orders of magnitude fewer indexed articles than
2015 — shipping the denominator alongside the count makes it impossible for a chart
to render a rate while hiding how thin it is.

Year attribution: COALESCE(e_year, pub_year). The electronic ArticleDate exists on only
51.5% of articles, while the journal PubDate year is near-universal, so the fallback is
what makes the early decades usable at all.

All publication types are rolled up, not just the study designs. The curation to a
defensible evidence-hierarchy set happens in the API/UI, so the DB stays reusable —
e.g. the `Research Support, *` types are a legitimate funding signal for a separate
panel, they simply must not appear on an evidence chart.

Usage:
  python3 scripts/pubmed_rollups.py --db-path data/pubmed.db
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

# Outside this window a year is a data-entry error, and one bad row would put a
# visible spike on the chart.
MIN_YEAR, MAX_YEAR = 1900, 2026

DDL = """
DROP TABLE IF EXISTS design_stats;
DROP TABLE IF EXISTS databank_stats;

CREATE TABLE design_stats (
  year INTEGER NOT NULL, type_ui TEXT NOT NULL,
  n INTEGER NOT NULL, year_total INTEGER NOT NULL,
  PRIMARY KEY (year, type_ui)
) WITHOUT ROWID;

CREATE TABLE databank_stats (
  year INTEGER NOT NULL, databank TEXT NOT NULL,
  n INTEGER NOT NULL, year_total INTEGER NOT NULL,
  PRIMARY KEY (year, databank)
) WITHOUT ROWID;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db-path", required=True)
    args = ap.parse_args()

    p = Path(args.db_path).expanduser()
    if not p.exists():
        sys.exit(f"{p} not found -- run pubmed_import.py first")

    con = sqlite3.connect(p)
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    con.executescript(DDL)
    t0 = time.time()

    # Denominator first: articles per year, over everything we have a year for.
    print("computing per-year totals ...", flush=True)
    con.execute("DROP TABLE IF EXISTS _year_totals")
    con.execute(
        """CREATE TEMP TABLE _year_totals AS
           SELECT COALESCE(e_year, pub_year) AS year, COUNT(*) AS total
           FROM article_dates
           WHERE COALESCE(e_year, pub_year) BETWEEN ? AND ?
           GROUP BY 1""",
        (MIN_YEAR, MAX_YEAR),
    )
    nyears = con.execute("SELECT COUNT(*) FROM _year_totals").fetchone()[0]
    print(f"  {nyears} years with articles ({time.time()-t0:,.0f}s)", flush=True)

    print("building design_stats ...", flush=True)
    con.execute(
        """INSERT INTO design_stats (year, type_ui, n, year_total)
           SELECT y.year, p.type_ui, COUNT(*), t.total
           FROM article_dates a
           JOIN (SELECT pmid, COALESCE(e_year, pub_year) AS year FROM article_dates) y
             ON y.pmid = a.pmid
           JOIN paper_pubtypes p ON p.pmid = a.pmid
           JOIN _year_totals t ON t.year = y.year
           WHERE y.year BETWEEN ? AND ?
           GROUP BY y.year, p.type_ui""",
        (MIN_YEAR, MAX_YEAR),
    )
    con.commit()
    print(f"  {con.execute('SELECT COUNT(*) FROM design_stats').fetchone()[0]:,} rows "
          f"({time.time()-t0:,.0f}s)", flush=True)

    print("building databank_stats ...", flush=True)
    con.execute(
        """INSERT INTO databank_stats (year, databank, n, year_total)
           SELECT y.year, d.databank, COUNT(DISTINCT d.pmid), t.total
           FROM (SELECT pmid, COALESCE(e_year, pub_year) AS year FROM article_dates) y
           JOIN paper_databanks d ON d.pmid = y.pmid
           JOIN _year_totals t ON t.year = y.year
           WHERE y.year BETWEEN ? AND ?
           GROUP BY y.year, d.databank""",
        (MIN_YEAR, MAX_YEAR),
    )
    con.commit()
    con.execute("INSERT OR REPLACE INTO import_meta VALUES ('rollups_built_at', datetime('now'))")
    con.commit()
    con.execute("ANALYZE")
    con.commit()

    print(f"\n--- rollup summary ({(time.time()-t0)/60:,.1f} min) ---")
    for t in ("design_stats", "databank_stats"):
        print(f"  {t:16} {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:>8,} rows")

    # The phase gate: RCT reporting demonstrably grew over these decades. A flat or
    # falling line means the pubtype extraction or year attribution is broken.
    print("\n  GATE - Randomized Controlled Trial share by decade:")
    for row in con.execute(
        """SELECT (d.year/10)*10 AS decade,
                  SUM(d.n) AS rct,
                  SUM(d.year_total) AS base,
                  ROUND(100.0*SUM(d.n)/NULLIF(SUM(d.year_total),0), 3) AS pct
           FROM design_stats d JOIN pubtype_terms t USING(type_ui)
           WHERE t.type_name = 'Randomized Controlled Trial'
             AND d.year BETWEEN 1960 AND 2019
           GROUP BY decade ORDER BY decade"""
    ):
        print(f"    {row[0]}s  {row[1]:>9,} / {row[2]:>11,}  = {row[3]}%")
    con.close()


if __name__ == "__main__":
    main()
