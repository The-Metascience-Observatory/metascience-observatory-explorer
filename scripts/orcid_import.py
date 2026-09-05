#!/usr/bin/env python3
"""Import ORCID employment/education history -> data/identity.db.

WHY THIS EXISTS: person_summary carries a single `last_known_institution`, and
person_affiliations *infers* affiliation from publications -- so neither can see
non-publishing periods, role titles, or PhD dates. ORCID's self-reported
employment and education summaries are the only source for real career
trajectories, which unlock career-age normalisation and mobility analysis.

COVERAGE (measured, don't re-derive): 7,648,321 of 100.4M person_summary rows
carry an ORCID (7.62%); ~27% of ORCID records have employment and ~21.7% have
education. So expect roughly 2M authors with a usable trajectory.

BIAS WARNING: this data is self-reported and skews younger, Global-North and
ORCID-adopting. Anything built on it must say so -- see the plan's open risks.

PERFORMANCE: the ORCID id is in each member's filename, so records whose ORCID
is not in the lookup are skipped WITHOUT decoding or parsing their XML.

MEASURED (2026-08-28, not estimated): walking the tar alone runs ~21,400 members/s
(665 MB/s uncompressed), but with XML parsing of the matched subset the real
end-to-end rate is **~2,500 members/s**, i.e. roughly 2.5 h for the full ~22M-record
file. ET.fromstring on ~30 KB records dominates; an earlier note here claimed "well
under an hour", which was the walk-only figure and wrong. If this ever needs to be
faster, dispatch parse_record() to a multiprocessing pool -- the tar read is
sequential but the parsing is embarrassingly parallel.

Usage:
  python3 scripts/orcid_import.py \
    --orcid-tar /mnt/metascience/datasets/orcid_public-data-file_2025/ORCID_2025_10_summaries.tar.gz \
    --lookup-db /mnt/metascience/openaire-build/lookup.db \
    --db-path data/identity.db --rebuild
"""

import argparse
import re
import sqlite3
import sys
import tarfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    "common": "http://www.orcid.org/ns/common",
    "employment": "http://www.orcid.org/ns/employment",
    "education": "http://www.orcid.org/ns/education",
    "qualification": "http://www.orcid.org/ns/qualification",
}

# ORCID is the member's basename: .../000/0000-0001-5088-1000.xml
ORCID_FROM_NAME = re.compile(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\.xml$")

# Degrees that imply a doctorate, for the career-age signal. Matched case-insensitively
# against the education/qualification role-title.
PHD_RE = re.compile(
    r"\b(ph\.?\s?d|d\.?phil|doctor(al|ate)?|dr\.?\s?rer|dr\.?\s?med|dsc|sc\.?d|md-phd)\b",
    re.IGNORECASE,
)

# A postdoc is NOT a doctorate award, but "Post Doctoral Fellow" matches `doctoral`
# above. Observed in the real data and it would corrupt phd_year -- the career-age
# anchor -- for anyone who lists a postdoc but not their PhD. Checked first, wins.
NOT_PHD_RE = re.compile(r"post[\s.\-]?doc|postdoctoral|post[\s.\-]?graduate", re.IGNORECASE)


def is_doctorate(role_title):
    if not role_title:
        return False
    if NOT_PHD_RE.search(role_title):
        return False
    return bool(PHD_RE.search(role_title))

BATCH = 20_000

DDL = """
DROP TABLE IF EXISTS author_identity;
DROP TABLE IF EXISTS author_employment;
DROP TABLE IF EXISTS author_education;

CREATE TABLE author_identity (
  authorid TEXT PRIMARY KEY,
  orcid TEXT NOT NULL,
  phd_year INTEGER,                 -- earliest doctorate end-year, NULL if none stated
  first_employment_year INTEGER,
  n_employments INTEGER NOT NULL,
  n_orgs INTEGER NOT NULL,
  n_countries INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE author_employment (
  authorid TEXT NOT NULL,
  rank INTEGER NOT NULL,            -- chronological, 0-based
  org_name TEXT, ror TEXT, country TEXT, role_title TEXT,
  start_year INTEGER, end_year INTEGER,
  PRIMARY KEY (authorid, rank)
) WITHOUT ROWID;

CREATE TABLE author_education (
  authorid TEXT NOT NULL,
  rank INTEGER NOT NULL,
  org_name TEXT, ror TEXT, country TEXT, role_title TEXT,
  start_year INTEGER, end_year INTEGER, is_doctorate INTEGER,
  PRIMARY KEY (authorid, rank)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT);
"""

INDEXES = """
CREATE INDEX idx_ai_orcid    ON author_identity(orcid);
CREATE INDEX idx_ai_phd      ON author_identity(phd_year) WHERE phd_year IS NOT NULL;
CREATE INDEX idx_aemp_ror    ON author_employment(ror) WHERE ror IS NOT NULL;
CREATE INDEX idx_aemp_country ON author_employment(country) WHERE country IS NOT NULL;
"""


def load_orcid_lookup(lookup_db):
    """orcid (bare 19-char) -> authorid. ~7.65M entries, ~1.1 GB resident."""
    print("loading orcid_lookup ...", flush=True)
    t0 = time.time()
    con = sqlite3.connect(f"file:{lookup_db}?mode=ro", uri=True)
    m = dict(con.execute("SELECT orcid, authorid FROM orcid_lookup"))
    con.close()
    print(f"  {len(m):,} ORCIDs in {time.time() - t0:,.0f}s", flush=True)
    return m


def _year(el):
    """<common:start-date><common:year>2018</...> -> 2018, or None."""
    if el is None:
        return None
    y = el.find("common:year", NS)
    if y is None or not (y.text or "").strip():
        return None
    try:
        v = int(y.text.strip())
    except ValueError:
        return None
    # Guard against typos like 20222 / 202 that would wreck the trend charts.
    return v if 1900 <= v <= 2100 else None


def _affiliation(node):
    """One employment/education/qualification summary -> a flat dict."""
    org = node.find("common:organization", NS)
    name = ror = country = None
    if org is not None:
        n = org.find("common:name", NS)
        name = (n.text or "").strip() if n is not None else None
        addr = org.find("common:address", NS)
        if addr is not None:
            c = addr.find("common:country", NS)
            country = (c.text or "").strip() if c is not None else None
        dis = org.find("common:disambiguated-organization", NS)
        if dis is not None:
            src = dis.find("common:disambiguation-source", NS)
            ident = dis.find("common:disambiguated-organization-identifier", NS)
            if src is not None and (src.text or "").strip().upper() == "ROR" and ident is not None:
                # Stored bare, matching affiliation_summary.ror in journals.db
                # (e.g. '032k75171', no URL prefix).
                ror = re.sub(r"^https?://(?:www\.)?ror\.org/", "", (ident.text or "").strip())
    role = node.find("common:role-title", NS)
    return {
        "org_name": name,
        "ror": ror,
        "country": country,
        "role_title": (role.text or "").strip() if role is not None else None,
        "start_year": _year(node.find("common:start-date", NS)),
        "end_year": _year(node.find("common:end-date", NS)),
    }


def parse_record(xml_bytes):
    """-> (employments, educations) as chronologically sorted lists of dicts."""
    root = ET.fromstring(xml_bytes)
    emps = [_affiliation(n) for n in root.iter(f"{{{NS['employment']}}}employment-summary")]
    edus = [_affiliation(n) for n in root.iter(f"{{{NS['education']}}}education-summary")]
    # Qualifications carry doctorates too (common outside the US/UK), so fold them in.
    edus += [_affiliation(n) for n in root.iter(f"{{{NS['qualification']}}}qualification-summary")]

    def key(a):
        # Undated entries sort last rather than pretending to be year 0.
        return (a["start_year"] is None, a["start_year"] or 0)

    return sorted(emps, key=key), sorted(edus, key=key)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--orcid-tar", required=True)
    ap.add_argument("--lookup-db", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="stop after N matched records (testing)")
    args = ap.parse_args()

    out_path = Path(args.db_path).expanduser()
    if out_path.exists() and not args.rebuild:
        sys.exit(f"{out_path} exists; pass --rebuild")

    lookup = load_orcid_lookup(args.lookup_db)

    out = sqlite3.connect(out_path)
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-2000000;")
    out.executescript(DDL)

    ident_rows, emp_rows, edu_rows = [], [], []
    seen = walked = matched = parse_errors = 0
    with_emp = with_edu = with_phd = 0
    t0 = time.time()

    def flush():
        if ident_rows:
            out.executemany("INSERT OR REPLACE INTO author_identity VALUES (?,?,?,?,?,?,?)", ident_rows)
            ident_rows.clear()
        if emp_rows:
            out.executemany("INSERT OR REPLACE INTO author_employment VALUES (?,?,?,?,?,?,?,?)", emp_rows)
            emp_rows.clear()
        if edu_rows:
            out.executemany("INSERT OR REPLACE INTO author_education VALUES (?,?,?,?,?,?,?,?,?)", edu_rows)
            edu_rows.clear()
        # Commit per batch, NOT once at the end. Without this the whole import
        # accumulates in SQLite's 2 GB page cache and the .db file stays 0 bytes
        # until the final commit -- observed on the first full run, which reached
        # 1.34M authors with nothing on disk and an 8.1 GB RSS. A crash or power
        # loss at that point would discard hours of work. Committing per batch
        # bounds memory and makes the run resumable in practice.
        out.commit()

    tar = tarfile.open(args.orcid_tar, mode="r|gz")
    for member in tar:
        if not member.isfile():
            continue
        m = ORCID_FROM_NAME.search(member.name)
        if not m:
            continue
        walked += 1
        orcid = m.group(1)
        authorid = lookup.get(orcid)
        if authorid is None:
            continue  # not one of our authors -- never decode or parse it
        seen += 1

        try:
            emps, edus = parse_record(tar.extractfile(member).read())
        except ET.ParseError:
            parse_errors += 1
            continue

        if not emps and not edus:
            continue
        matched += 1
        if emps:
            with_emp += 1
        if edus:
            with_edu += 1

        for i, e in enumerate(emps):
            emp_rows.append((authorid, i, e["org_name"], e["ror"], e["country"],
                             e["role_title"], e["start_year"], e["end_year"]))

        phd_year = None
        for i, e in enumerate(edus):
            doc = 1 if is_doctorate(e["role_title"]) else 0
            if doc:
                # Earliest stated doctorate end-year is the career-age anchor.
                y = e["end_year"] or e["start_year"]
                if y and (phd_year is None or y < phd_year):
                    phd_year = y
            edu_rows.append((authorid, i, e["org_name"], e["ror"], e["country"],
                             e["role_title"], e["start_year"], e["end_year"], doc))
        if phd_year:
            with_phd += 1

        starts = [e["start_year"] for e in emps if e["start_year"]]
        ident_rows.append((
            authorid, orcid, phd_year, min(starts) if starts else None,
            len(emps),
            len({e["org_name"] for e in emps if e["org_name"]}),
            len({e["country"] for e in emps if e["country"]}),
        ))

        if len(ident_rows) >= BATCH:
            flush()
            el = time.time() - t0
            print(f"  walked {walked:,} | matched {matched:,} | {walked / el:,.0f} members/s", flush=True)
        if args.limit and matched >= args.limit:
            break
    tar.close()
    flush()
    out.commit()

    print("creating indexes ...", flush=True)
    out.executescript(INDEXES)
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('orcid_imported_at', datetime('now'))")
    out.execute("INSERT OR REPLACE INTO import_meta VALUES ('orcid_source', ?)", (str(args.orcid_tar),))
    out.commit()
    out.execute("ANALYZE")
    out.commit()

    n_ident = out.execute("SELECT COUNT(*) FROM author_identity").fetchone()[0]
    n_emp = out.execute("SELECT COUNT(*) FROM author_employment").fetchone()[0]
    n_edu = out.execute("SELECT COUNT(*) FROM author_education").fetchone()[0]
    n_ror = out.execute("SELECT COUNT(*) FROM author_employment WHERE ror IS NOT NULL").fetchone()[0]
    print(f"\nDone in {(time.time() - t0) / 60:,.1f} min")
    print(f"  tar members walked      : {walked:,}")
    print(f"  matched our authors     : {seen:,}")
    print(f"  with employment OR edu  : {n_ident:,}")
    print(f"    ... with employment   : {with_emp:,}")
    print(f"    ... with education    : {with_edu:,}")
    print(f"    ... with a PhD year   : {with_phd:,}")
    print(f"  employment rows         : {n_emp:,} ({n_ror:,} ROR-identified)")
    print(f"  education rows          : {n_edu:,}")
    print(f"  XML parse errors        : {parse_errors:,}")
    out.close()


if __name__ == "__main__":
    main()
