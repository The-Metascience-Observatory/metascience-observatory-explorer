#!/usr/bin/env python3
"""
Import predatory journal/publisher lists from stop-predatory-journals GitHub repo.

This script:
1. Reads journals.csv and publishers.csv (based on Beall's List)
2. Stores raw lists in predatory_list_journals / predatory_list_publishers tables
3. Matches journal names and publisher names against journal_summary
4. Creates predatory_journals table with matched sourceids

Usage:
    python scripts/import_predatory_journals.py [--db-path PATH]
"""

import argparse
import sqlite3
import csv
import sys
from pathlib import Path
from datetime import date


def log(msg: str):
    print(f"[INFO] {msg}", flush=True)


def read_csv(csv_path: Path) -> list[dict]:
    """Read a CSV file and return list of dicts."""
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def normalize_name(name: str) -> str:
    """Normalize a journal/publisher name for matching."""
    return name.strip().lower()


def create_tables(conn: sqlite3.Connection):
    """Create predatory list tables."""
    conn.execute("DROP TABLE IF EXISTS predatory_journals")
    conn.execute("DROP TABLE IF EXISTS predatory_list_journals")
    conn.execute("DROP TABLE IF EXISTS predatory_list_publishers")

    conn.execute("""
        CREATE TABLE predatory_list_journals (
            name TEXT PRIMARY KEY,
            url TEXT,
            abbreviation TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE predatory_list_publishers (
            name TEXT PRIMARY KEY,
            url TEXT,
            abbreviation TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE predatory_journals (
            sourceid TEXT PRIMARY KEY,
            predatory_source TEXT NOT NULL,
            matched_name TEXT,
            matched_publisher TEXT,
            predatory_url TEXT,
            confidence TEXT DEFAULT 'exact',
            import_date TEXT
        )
    """)

    conn.commit()


def import_raw_lists(conn: sqlite3.Connection, journals_path: Path, publishers_path: Path):
    """Import raw CSV data into reference tables."""
    journals = read_csv(journals_path)
    publishers = read_csv(publishers_path)

    for j in journals:
        conn.execute(
            "INSERT OR IGNORE INTO predatory_list_journals (name, url, abbreviation) VALUES (?, ?, ?)",
            (j.get('name', '').strip(), j.get('url', '').strip(), j.get('abbr', '').strip() or None)
        )

    for p in publishers:
        conn.execute(
            "INSERT OR IGNORE INTO predatory_list_publishers (name, url, abbreviation) VALUES (?, ?, ?)",
            (p.get('name', '').strip(), p.get('url', '').strip(), p.get('abbr', '').strip() or None)
        )

    conn.commit()
    log(f"Imported {len(journals)} predatory journals and {len(publishers)} predatory publishers into raw tables")


def build_name_index(conn: sqlite3.Connection) -> dict[str, list[str]]:
    """Build mapping from normalized display_name to list of sourceids."""
    name_to_sourceids: dict[str, list[str]] = {}
    cur = conn.execute("SELECT sourceid, display_name FROM journal_summary WHERE display_name IS NOT NULL")
    for sourceid, display_name in cur:
        key = normalize_name(display_name)
        if key not in name_to_sourceids:
            name_to_sourceids[key] = []
        name_to_sourceids[key].append(sourceid)
    log(f"Built name index with {len(name_to_sourceids)} unique names from {sum(len(v) for v in name_to_sourceids.values())} journals")
    return name_to_sourceids


def build_publisher_index(conn: sqlite3.Connection) -> dict[str, list[tuple[str, str]]]:
    """Build mapping from normalized publisher name to list of (sourceid, display_name)."""
    pub_to_journals: dict[str, list[tuple[str, str]]] = {}
    cur = conn.execute("SELECT sourceid, display_name, publisher FROM journal_summary WHERE publisher IS NOT NULL")
    for sourceid, display_name, publisher in cur:
        key = normalize_name(publisher)
        if key not in pub_to_journals:
            pub_to_journals[key] = []
        pub_to_journals[key].append((sourceid, display_name))
    log(f"Built publisher index with {len(pub_to_journals)} unique publishers")
    return pub_to_journals


def match_journals(conn: sqlite3.Connection):
    """Match predatory lists against journal_summary."""
    import_dt = date.today().isoformat()

    name_index = build_name_index(conn)
    pub_index = build_publisher_index(conn)

    # Track matched sourceids to avoid duplicates (journal match takes priority)
    matched_sourceids: set[str] = set()

    # 1. Match by journal name (high confidence)
    journal_matches = 0
    journal_unmatched = []

    cur = conn.execute("SELECT name, url FROM predatory_list_journals")
    for name, url in cur:
        key = normalize_name(name)
        if key in name_index:
            for sourceid in name_index[key]:
                if sourceid not in matched_sourceids:
                    conn.execute(
                        "INSERT OR IGNORE INTO predatory_journals (sourceid, predatory_source, matched_name, predatory_url, confidence, import_date) VALUES (?, ?, ?, ?, ?, ?)",
                        (sourceid, 'bealls_journal', name, url, 'exact', import_dt)
                    )
                    matched_sourceids.add(sourceid)
                    journal_matches += 1
        else:
            journal_unmatched.append(name)

    log(f"Journal name matches: {journal_matches} (from {journal_matches} list entries)")
    log(f"Unmatched journal names: {len(journal_unmatched)}")

    # 2. Match by publisher name (medium confidence)
    publisher_matches = 0
    publisher_journals_flagged = 0
    publisher_unmatched = []

    cur = conn.execute("SELECT name, url FROM predatory_list_publishers")
    for name, url in cur:
        key = normalize_name(name)
        if key in pub_index:
            publisher_matches += 1
            for sourceid, journal_name in pub_index[key]:
                if sourceid not in matched_sourceids:
                    conn.execute(
                        "INSERT OR IGNORE INTO predatory_journals (sourceid, predatory_source, matched_name, matched_publisher, predatory_url, confidence, import_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (sourceid, 'bealls_publisher', journal_name, name, url, 'publisher', import_dt)
                    )
                    matched_sourceids.add(sourceid)
                    publisher_journals_flagged += 1
        else:
            publisher_unmatched.append(name)

    conn.commit()

    log(f"Publisher matches: {publisher_matches} publishers matched, {publisher_journals_flagged} additional journals flagged")
    log(f"Unmatched publisher names: {len(publisher_unmatched)}")

    # Print some unmatched journal names for review
    if journal_unmatched:
        log(f"\nSample unmatched journal names (first 20):")
        for name in sorted(journal_unmatched)[:20]:
            log(f"  - {name}")

    if publisher_unmatched:
        log(f"\nSample unmatched publisher names (first 20):")
        for name in sorted(publisher_unmatched)[:20]:
            log(f"  - {name}")

    return len(matched_sourceids)


def main():
    parser = argparse.ArgumentParser(description='Import predatory journal lists')
    parser.add_argument('--db-path', type=Path,
                        default=Path('data/journals.db'),
                        help='Path to journals.db')
    parser.add_argument('--journals-csv', type=Path,
                        default=Path('journals_data/predatory/journals.csv'),
                        help='Path to predatory journals CSV')
    parser.add_argument('--publishers-csv', type=Path,
                        default=Path('journals_data/predatory/publishers.csv'),
                        help='Path to predatory publishers CSV')
    args = parser.parse_args()

    if not args.db_path.exists():
        print(f"Error: Database not found: {args.db_path}")
        sys.exit(1)
    if not args.journals_csv.exists():
        print(f"Error: Journals CSV not found: {args.journals_csv}")
        sys.exit(1)
    if not args.publishers_csv.exists():
        print(f"Error: Publishers CSV not found: {args.publishers_csv}")
        sys.exit(1)

    conn = sqlite3.connect(args.db_path)

    log("Creating tables...")
    create_tables(conn)

    log("Importing raw predatory lists...")
    import_raw_lists(conn, args.journals_csv, args.publishers_csv)

    log("Matching against journal_summary...")
    total_matched = match_journals(conn)

    # Final stats
    cur = conn.execute("SELECT confidence, COUNT(*) FROM predatory_journals GROUP BY confidence")
    confidence_counts = dict(cur.fetchall())

    conn.close()

    log("=" * 50)
    log("Import complete!")
    log(f"  Total journals flagged: {total_matched}")
    log(f"    Exact name matches: {confidence_counts.get('exact', 0)}")
    log(f"    Publisher matches: {confidence_counts.get('publisher', 0)}")
    log("=" * 50)


if __name__ == '__main__':
    main()
