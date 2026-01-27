#!/usr/bin/env python3
"""
Import hijacked journals from Retraction Watch Excel file.

This script:
1. Reads the Retraction Watch Hijacked Journal Checker Excel file
2. Matches journals to existing entries by ISSN
3. Creates minimal entries for journals not in the database
4. Creates a hijacked_journals table linking to journal_summary

Usage:
    python scripts/import_hijacked_journals.py [--excel-path PATH] [--db-path PATH]
"""

import argparse
import sqlite3
import json
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("Error: openpyxl is required. Install with: pip install openpyxl")
    sys.exit(1)


def log(msg: str):
    """Print log message."""
    print(f"[INFO] {msg}", flush=True)


def parse_issns(issn_str: str | None) -> list[str]:
    """Parse ISSN string into list of normalized ISSNs."""
    if not issn_str:
        return []
    # Handle various separators: comma, semicolon, space
    issns = []
    for part in issn_str.replace(';', ',').split(','):
        issn = part.strip().upper()
        if issn and len(issn) >= 8:  # Valid ISSN is 8+ chars (e.g., 1234-5678)
            issns.append(issn)
    return issns


def build_issn_index(conn: sqlite3.Connection) -> dict[str, str]:
    """Build mapping from ISSN to sourceid."""
    log("Building ISSN index from journal_summary...")
    issn_to_sourceid = {}

    cur = conn.execute('SELECT sourceid, issn FROM journal_summary WHERE issn IS NOT NULL')
    for row in cur:
        sourceid, issn_json = row
        if not issn_json:
            continue
        try:
            # Handle JSON array format
            if issn_json.startswith('['):
                issns = json.loads(issn_json)
            else:
                issns = [issn_json]

            for issn in issns:
                issn_clean = issn.strip().upper()
                if issn_clean:
                    issn_to_sourceid[issn_clean] = sourceid
        except (json.JSONDecodeError, TypeError):
            pass

    log(f"Indexed {len(issn_to_sourceid)} ISSNs from database")
    return issn_to_sourceid


def read_hijacked_journals(excel_path: Path) -> list[dict]:
    """Read hijacked journals from Excel file."""
    log(f"Reading Excel file: {excel_path}")

    wb = openpyxl.load_workbook(excel_path, read_only=True)
    sheet = wb.active

    hijacked = []
    for row in sheet.iter_rows(min_row=3, max_col=7, values_only=True):
        # Column A is row number - skip if empty
        if row[0] is None or not isinstance(row[0], (int, float)):
            continue

        hijacked.append({
            'hijacked_title': row[1],
            'hijacked_url': row[2],
            'hijacked_issn': row[3],
            'original_title': row[4],
            'original_issn': row[5],
            'original_url': row[6]
        })

    wb.close()
    log(f"Read {len(hijacked)} hijacked journal entries")
    return hijacked


def create_tables(conn: sqlite3.Connection):
    """Create the hijacked_journals table."""
    log("Creating hijacked_journals table...")

    conn.execute("DROP TABLE IF EXISTS hijacked_journals")
    conn.execute("""
        CREATE TABLE hijacked_journals (
            sourceid TEXT PRIMARY KEY,
            hijacked_title TEXT,
            hijacked_url TEXT,
            hijacked_issn TEXT,
            original_title TEXT,
            original_issn TEXT,
            original_url TEXT,
            date_added TEXT DEFAULT CURRENT_DATE
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_hijacked_issn ON hijacked_journals(hijacked_issn)")
    conn.commit()


def import_hijacked_journals(
    conn: sqlite3.Connection,
    hijacked: list[dict],
    issn_to_sourceid: dict[str, str]
) -> tuple[int, int]:
    """Import hijacked journals, matching to existing or creating new entries."""

    matched = 0
    created = 0
    next_id = 1

    # Track which sourceids we've already added (some journals appear multiple times)
    seen_sourceids = set()

    for entry in hijacked:
        # Try to match by ISSN (check both hijacked and original ISSNs)
        issns_to_check = parse_issns(entry['hijacked_issn']) + parse_issns(entry['original_issn'])

        sourceid = None
        for issn in issns_to_check:
            if issn in issn_to_sourceid:
                sourceid = issn_to_sourceid[issn]
                break

        if sourceid:
            matched += 1
        else:
            # Create new minimal journal entry
            sourceid = f"HIJACKED_{next_id:04d}"
            next_id += 1

            # Format ISSN as JSON array for consistency
            issns = parse_issns(entry['hijacked_issn'])
            issn_json = json.dumps(issns) if issns else None

            conn.execute("""
                INSERT OR IGNORE INTO journal_summary
                (sourceid, display_name, issn, publisher, homepage_url, is_oa,
                 total_papers, total_citations, first_year, last_year)
                VALUES (?, ?, ?, ?, ?, NULL, 0, 0, NULL, NULL)
            """, (
                sourceid,
                entry['hijacked_title'],
                issn_json,
                'HIJACKED JOURNAL',
                entry['hijacked_url']
            ))
            created += 1

        # Skip if we've already added this sourceid (duplicate entries for same journal)
        if sourceid in seen_sourceids:
            continue
        seen_sourceids.add(sourceid)

        # Insert into hijacked_journals
        conn.execute("""
            INSERT OR REPLACE INTO hijacked_journals
            (sourceid, hijacked_title, hijacked_url, hijacked_issn,
             original_title, original_issn, original_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            sourceid,
            entry['hijacked_title'],
            entry['hijacked_url'],
            entry['hijacked_issn'],
            entry['original_title'],
            entry['original_issn'],
            entry['original_url']
        ))

    conn.commit()
    return matched, created


def main():
    parser = argparse.ArgumentParser(description='Import hijacked journals from Retraction Watch')
    parser.add_argument('--excel-path', type=Path,
                        default=Path('/media/dan/metascience/Retraction Watch Hijacked Journals Checker_1_25_2026.xlsx'),
                        help='Path to Excel file')
    parser.add_argument('--db-path', type=Path,
                        default=Path('data/journals.db'),
                        help='Path to journals.db')
    args = parser.parse_args()

    if not args.excel_path.exists():
        print(f"Error: Excel file not found: {args.excel_path}")
        sys.exit(1)

    if not args.db_path.exists():
        print(f"Error: Database not found: {args.db_path}")
        sys.exit(1)

    # Connect to database
    conn = sqlite3.connect(args.db_path)

    # Build ISSN index
    issn_to_sourceid = build_issn_index(conn)

    # Read hijacked journals from Excel
    hijacked = read_hijacked_journals(args.excel_path)

    # Create tables
    create_tables(conn)

    # Import data
    matched, created = import_hijacked_journals(conn, hijacked, issn_to_sourceid)

    # Get final count
    cur = conn.execute("SELECT COUNT(*) FROM hijacked_journals")
    total = cur.fetchone()[0]

    conn.close()

    log("=" * 50)
    log(f"Import complete!")
    log(f"  Total hijacked journal entries: {len(hijacked)}")
    log(f"  Matched to existing journals: {matched}")
    log(f"  Created new minimal entries: {created}")
    log(f"  Total in hijacked_journals table: {total}")
    log("=" * 50)


if __name__ == '__main__':
    main()
