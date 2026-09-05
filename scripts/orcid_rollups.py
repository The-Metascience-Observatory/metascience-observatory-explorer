#!/usr/bin/env python3
"""Build the precomputed Trends rollups from identity.db (run after orcid_import.py).

The Trends charts must never scan the per-author tables at request time, so this
writes small aggregate tables the API can read whole. Follows the *_yearly_stats
precedent in journals.db.

Rollups produced:
  mobility_flows(from_country, to_country, year, n)  -- one row per observed move
  mobility_country_totals(country, year, inflow, outflow, net)
  career_age_stats(career_age, n_authors, median_works, median_citations)
  phd_year_stats(phd_year, n_authors)

BIAS WARNING (must be surfaced in the UI, not just here): ORCID employment is
self-reported and covers ~2M of 100.4M authors, skewed young, Global-North and
ORCID-adopting. These aggregates describe ORCID-profile-completing researchers,
NOT science as a whole. Charts must show denominators.

Usage:
  python3 scripts/orcid_rollups.py --db-path data/identity.db \
    --journals-db data/journals.db
"""

import argparse
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

# A "move" needs both endpoints dated and in different countries. Employment rows
# with no start_year sort last and are skipped -- an undated row cannot be placed
# in a sequence without inventing an order.
DDL = """
DROP TABLE IF EXISTS mobility_flows;
DROP TABLE IF EXISTS mobility_country_totals;
DROP TABLE IF EXISTS career_age_stats;
DROP TABLE IF EXISTS phd_year_stats;

CREATE TABLE mobility_flows (
  from_country TEXT NOT NULL, to_country TEXT NOT NULL,
  year INTEGER NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (from_country, to_country, year)
) WITHOUT ROWID;

CREATE TABLE mobility_country_totals (
  country TEXT NOT NULL, year INTEGER NOT NULL,
  inflow INTEGER NOT NULL, outflow INTEGER NOT NULL, net INTEGER NOT NULL,
  PRIMARY KEY (country, year)
) WITHOUT ROWID;

CREATE TABLE career_age_stats (
  career_age INTEGER PRIMARY KEY,     -- years since phd_year
  n_authors INTEGER NOT NULL,
  median_works REAL, median_citations REAL
) WITHOUT ROWID;

CREATE TABLE phd_year_stats (
  phd_year INTEGER PRIMARY KEY, n_authors INTEGER NOT NULL
) WITHOUT ROWID;
"""

# Sanity bounds. A "move" dated outside this window is a data-entry error, and a
# single bad row would otherwise put a visible spike on the mobility chart.
MIN_YEAR, MAX_YEAR = 1950, 2026
MAX_CAREER_AGE = 60


def build_mobility(out):
    print("building mobility flows ...", flush=True)
    t0 = time.time()
    flows = defaultdict(int)
    cur = out.execute(
        "SELECT authorid, country, start_year FROM author_employment "
        "WHERE country IS NOT NULL AND start_year IS NOT NULL "
        "ORDER BY authorid, start_year, rank"
    )
    prev_author = None
    prev_country = None
    moves = 0
    for authorid, country, year in cur:
        if authorid != prev_author:
            prev_author, prev_country = authorid, country
            continue
        if country != prev_country and MIN_YEAR <= year <= MAX_YEAR:
            flows[(prev_country, country, year)] += 1
            moves += 1
        prev_country = country

    out.executemany(
        "INSERT INTO mobility_flows VALUES (?,?,?,?)",
        [(f, t, y, n) for (f, t, y), n in flows.items()],
    )
    out.commit()

    # Country-level in/out/net, derived from the flow table so the two can never disagree.
    out.execute(
        """INSERT INTO mobility_country_totals
           SELECT c.country, c.year,
                  COALESCE(i.inflow, 0), COALESCE(o.outflow, 0),
                  COALESCE(i.inflow, 0) - COALESCE(o.outflow, 0)
           FROM (SELECT to_country AS country, year FROM mobility_flows
                 UNION SELECT from_country, year FROM mobility_flows) c
           LEFT JOIN (SELECT to_country AS country, year, SUM(n) AS inflow
                      FROM mobility_flows GROUP BY 1,2) i
                  ON i.country = c.country AND i.year = c.year
           LEFT JOIN (SELECT from_country AS country, year, SUM(n) AS outflow
                      FROM mobility_flows GROUP BY 1,2) o
                  ON o.country = c.country AND o.year = c.year"""
    )
    out.commit()
    print(f"  {moves:,} moves -> {len(flows):,} flow rows in {time.time() - t0:,.0f}s", flush=True)


def build_career_age(out, journals_db):
    """Career age = year - phd_year, against works/citations from person_summary.

    Requires journals.db. Without it the table is left empty rather than faked --
    the API treats an empty rollup exactly like a missing one.
    """
    if not journals_db or not Path(journals_db).exists():
        print("  no journals-db given; skipping career_age_stats", flush=True)
        return
    print("building career-age stats ...", flush=True)
    t0 = time.time()

    phd = dict(
        out.execute(
            "SELECT authorid, phd_year FROM author_identity "
            "WHERE phd_year IS NOT NULL AND phd_year BETWEEN ? AND ?",
            (MIN_YEAR, MAX_YEAR),
        )
    )
    print(f"  {len(phd):,} authors with a usable phd_year", flush=True)
    if not phd:
        return

    jc = sqlite3.connect(f"file:{journals_db}?mode=ro", uri=True)
    buckets = defaultdict(lambda: ([], []))
    n = 0
    # One pass over person_summary; filter in Python against the phd map rather
    # than issuing 2M point queries.
    for authorid, works, cites, last_year in jc.execute(
        "SELECT authorid, works_count, cited_by_count, last_year FROM person_summary"
    ):
        py = phd.get(authorid)
        if py is None or not last_year:
            continue
        age = last_year - py
        if not (0 <= age <= MAX_CAREER_AGE):
            continue
        w, c = buckets[age]
        w.append(works or 0)
        c.append(cites or 0)
        n += 1
    jc.close()

    rows = [
        (age, len(w), statistics.median(w) if w else None, statistics.median(c) if c else None)
        for age, (w, c) in sorted(buckets.items())
    ]
    out.executemany("INSERT INTO career_age_stats VALUES (?,?,?,?)", rows)
    out.execute(
        "INSERT INTO phd_year_stats SELECT phd_year, COUNT(*) FROM author_identity "
        "WHERE phd_year IS NOT NULL AND phd_year BETWEEN ? AND ? GROUP BY phd_year",
        (MIN_YEAR, MAX_YEAR),
    )
    out.commit()
    print(f"  {n:,} authors bucketed into {len(rows)} career ages in {time.time() - t0:,.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--journals-db")
    args = ap.parse_args()

    p = Path(args.db_path).expanduser()
    if not p.exists():
        sys.exit(f"{p} not found -- run orcid_import.py first")

    out = sqlite3.connect(p)
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    out.executescript(DDL)

    build_mobility(out)
    build_career_age(out, args.journals_db)

    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('rollups_built_at', datetime('now'))")
    out.commit()
    out.execute("ANALYZE")
    out.commit()

    print("\n--- rollup summary ---")
    for t in ("mobility_flows", "mobility_country_totals", "career_age_stats", "phd_year_stats"):
        n = out.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:26} {n:>10,}")
    print("\n  top 8 country flows (all years):")
    for f, t, n in out.execute(
        "SELECT from_country, to_country, SUM(n) s FROM mobility_flows "
        "GROUP BY 1,2 ORDER BY s DESC LIMIT 8"
    ):
        print(f"    {f} -> {t}: {n:,}")
    out.close()


if __name__ == "__main__":
    main()
