#!/usr/bin/env python3
"""
Import Scopus-only journals (journals in Scopus that don't exist in OpenAlex).

This script:
1. Reads Scopus journal list
2. Identifies journals not matched to existing OpenAlex journals by ISSN
3. Creates scopus_only_journals table with basic metadata

Usage:
    python scripts/import_scopus_only_journals.py [--db-path PATH]
"""

import argparse
import sqlite3
import json
import re
import sys
from pathlib import Path
from datetime import date

try:
    import openpyxl
except ImportError:
    print("Error: openpyxl is required. Install with: pip install openpyxl")
    sys.exit(1)


def log(msg: str):
    """Print log message."""
    print(f"[INFO] {msg}", flush=True)


def normalize_issn(issn: str | None) -> str | None:
    """Normalize ISSN to standard format (XXXX-XXXX)."""
    if not issn:
        return None
    clean = re.sub(r'[^0-9Xx]', '', str(issn).upper())
    if len(clean) == 8:
        return f"{clean[:4]}-{clean[4:]}"
    return None


def build_existing_issn_set(conn: sqlite3.Connection) -> set[str]:
    """Build set of ISSNs that already exist in journal_summary."""
    log("Building existing ISSN set from journal_summary...")
    existing_issns = set()

    cur = conn.execute('SELECT issn FROM journal_summary WHERE issn IS NOT NULL')
    for (issn_json,) in cur:
        if not issn_json:
            continue
        try:
            if issn_json.startswith('['):
                issns = json.loads(issn_json)
            else:
                issns = [issn_json]

            for issn in issns:
                issn_norm = normalize_issn(issn)
                if issn_norm:
                    existing_issns.add(issn_norm)
        except (json.JSONDecodeError, TypeError):
            pass

    log(f"Found {len(existing_issns)} existing ISSNs")
    return existing_issns


def create_table(conn: sqlite3.Connection):
    """Create the scopus_only_journals table."""
    log("Creating scopus_only_journals table...")

    conn.execute("DROP TABLE IF EXISTS scopus_only_journals")
    conn.execute("""
        CREATE TABLE scopus_only_journals (
            scopus_source_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            publisher TEXT,
            issn TEXT,
            eissn TEXT,

            -- Status
            is_active INTEGER DEFAULT 1,
            is_discontinued INTEGER DEFAULT 0,
            discontinued_for_quality INTEGER DEFAULT 0,

            -- Metadata
            coverage TEXT,
            source_type TEXT,
            is_medline INTEGER DEFAULT 0,
            articles_in_press INTEGER DEFAULT 0,
            languages TEXT,
            open_access_status TEXT,

            -- Title history
            title_history TEXT,
            related_titles TEXT,

            -- Subject classification
            asjc_codes TEXT,
            top_level_categories TEXT,

            -- Import metadata
            import_date TEXT
        )
    """)

    # Create FTS5 table for search
    conn.execute("DROP TABLE IF EXISTS scopus_only_journals_fts")
    conn.execute("""
        CREATE VIRTUAL TABLE scopus_only_journals_fts USING fts5(
            scopus_source_id,
            display_name,
            publisher,
            issn,
            eissn,
            content='scopus_only_journals',
            content_rowid='rowid'
        )
    """)

    conn.commit()


def import_scopus_only_journals(
    conn: sqlite3.Connection,
    excel_path: Path,
    existing_issns: set[str]
) -> int:
    """Import journals from Scopus that don't exist in OpenAlex."""
    log(f"Reading Scopus Excel file: {excel_path}")

    wb = openpyxl.load_workbook(excel_path, read_only=True)
    sheet = wb['Scopus Sources Nov. 2025']

    # Column indices (0-based)
    COL_SOURCE_ID = 0
    COL_TITLE = 1
    COL_ISSN = 2
    COL_EISSN = 3
    COL_ACTIVE = 4
    COL_COVERAGE = 5
    COL_DISCONTINUED_QUALITY = 6
    COL_LANGUAGES = 7
    COL_MEDLINE = 8
    COL_OPEN_ACCESS = 9
    COL_ARTICLES_IN_PRESS = 10
    COL_SOURCE_TYPE = 12
    COL_TITLE_HISTORY = 13
    COL_RELATED_1 = 14
    COL_RELATED_2 = 15
    COL_RELATED_3 = 16
    COL_RELATED_4 = 17
    COL_PUBLISHER = 18
    COL_ASJC = 20
    COL_TOP_LIFE = 21
    COL_TOP_SOCIAL = 22
    COL_TOP_PHYSICAL = 23
    COL_TOP_HEALTH = 24

    import_date = date.today().isoformat()
    imported = 0
    row_count = 0

    for row in sheet.iter_rows(min_row=2, values_only=True):
        row_count += 1
        if row_count % 10000 == 0:
            log(f"  Processed {row_count} rows, imported {imported} Scopus-only journals...")

        if len(row) < 21:
            continue

        source_id = str(row[COL_SOURCE_ID]) if row[COL_SOURCE_ID] else None
        if not source_id:
            continue

        title = row[COL_TITLE]
        if not title:
            continue

        issn = normalize_issn(row[COL_ISSN])
        eissn = normalize_issn(row[COL_EISSN])

        # Check if this journal already exists (by ISSN match)
        if (issn and issn in existing_issns) or (eissn and eissn in existing_issns):
            continue  # Skip - already exists in OpenAlex

        # Extract all fields
        active = row[COL_ACTIVE]
        coverage = str(row[COL_COVERAGE]).strip() if row[COL_COVERAGE] else None
        discontinued_quality = row[COL_DISCONTINUED_QUALITY]
        languages = row[COL_LANGUAGES]
        medline = row[COL_MEDLINE] if len(row) > COL_MEDLINE else None
        open_access = row[COL_OPEN_ACCESS] if len(row) > COL_OPEN_ACCESS else None
        articles_in_press = row[COL_ARTICLES_IN_PRESS] if len(row) > COL_ARTICLES_IN_PRESS else None
        source_type = str(row[COL_SOURCE_TYPE]).strip() if len(row) > COL_SOURCE_TYPE and row[COL_SOURCE_TYPE] else None
        title_history = str(row[COL_TITLE_HISTORY]).strip() if len(row) > COL_TITLE_HISTORY and row[COL_TITLE_HISTORY] else None
        related_1 = str(row[COL_RELATED_1]).strip() if len(row) > COL_RELATED_1 and row[COL_RELATED_1] else None
        related_2 = str(row[COL_RELATED_2]).strip() if len(row) > COL_RELATED_2 and row[COL_RELATED_2] else None
        related_3 = str(row[COL_RELATED_3]).strip() if len(row) > COL_RELATED_3 and row[COL_RELATED_3] else None
        related_4 = str(row[COL_RELATED_4]).strip() if len(row) > COL_RELATED_4 and row[COL_RELATED_4] else None
        publisher = row[COL_PUBLISHER] if len(row) > COL_PUBLISHER else None
        asjc = row[COL_ASJC] if len(row) > COL_ASJC else None

        # Get top-level categories
        top_life = row[COL_TOP_LIFE] if len(row) > COL_TOP_LIFE else None
        top_social = row[COL_TOP_SOCIAL] if len(row) > COL_TOP_SOCIAL else None
        top_physical = row[COL_TOP_PHYSICAL] if len(row) > COL_TOP_PHYSICAL else None
        top_health = row[COL_TOP_HEALTH] if len(row) > COL_TOP_HEALTH else None

        # Process fields
        is_active = 1 if active != 'Inactive' else 0
        is_discontinued = 1 if active == 'Inactive' else 0
        disc_quality = 1 if discontinued_quality and ('discontinue' in str(discontinued_quality).lower() or 'quality' in str(discontinued_quality).lower()) else 0
        is_medline = 1 if medline and 'medline' in str(medline).lower() else 0
        has_aip = 1 if articles_in_press and 'articles in press' in str(articles_in_press).lower() else 0

        # Languages as JSON
        lang_list = None
        if languages:
            lang_str = str(languages)
            lang_list = json.dumps([x.strip() for x in lang_str.split('; ') if x.strip()])

        # ASJC codes as JSON
        asjc_list = None
        if asjc:
            asjc_str = str(asjc)
            asjc_list = json.dumps([x.strip() for x in asjc_str.split('; ') if x.strip()])

        # Related titles as JSON
        related_titles = [t for t in [related_1, related_2, related_3, related_4] if t]
        related_titles_json = json.dumps(related_titles) if related_titles else None

        # Top-level categories
        top_categories = {}
        if top_life:
            top_categories['life_sciences'] = True
        if top_social:
            top_categories['social_sciences'] = True
        if top_physical:
            top_categories['physical_sciences'] = True
        if top_health:
            top_categories['health_sciences'] = True
        top_categories_json = json.dumps(top_categories) if top_categories else None

        # Insert record
        conn.execute("""
            INSERT INTO scopus_only_journals (
                scopus_source_id, display_name, publisher, issn, eissn,
                is_active, is_discontinued, discontinued_for_quality,
                coverage, source_type, is_medline, articles_in_press, languages, open_access_status,
                title_history, related_titles, asjc_codes, top_level_categories, import_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            source_id,
            title,
            publisher,
            row[COL_ISSN] if row[COL_ISSN] else None,  # Store original format
            row[COL_EISSN] if row[COL_EISSN] else None,
            is_active,
            is_discontinued,
            disc_quality,
            coverage,
            source_type,
            is_medline,
            has_aip,
            lang_list,
            str(open_access) if open_access else None,
            title_history,
            related_titles_json,
            asjc_list,
            top_categories_json,
            import_date
        ))
        imported += 1

    wb.close()
    conn.commit()

    # Populate FTS index
    log("Building search index...")
    conn.execute("""
        INSERT INTO scopus_only_journals_fts(scopus_source_id, display_name, publisher, issn, eissn)
        SELECT scopus_source_id, display_name, publisher, issn, eissn
        FROM scopus_only_journals
    """)
    conn.commit()

    log(f"Processed {row_count} total rows, imported {imported} Scopus-only journals")
    return imported


def main():
    parser = argparse.ArgumentParser(description='Import Scopus-only journals')
    parser.add_argument('--db-path', type=Path,
                        default=Path('data/journals.db'),
                        help='Path to journals.db')
    parser.add_argument('--scopus-path', type=Path,
                        default=Path('journals_data/scopus_source_title_list.xlsx'),
                        help='Path to Scopus Excel file')
    args = parser.parse_args()

    if not args.db_path.exists():
        print(f"Error: Database not found: {args.db_path}")
        sys.exit(1)

    if not args.scopus_path.exists():
        print(f"Error: Scopus file not found: {args.scopus_path}")
        sys.exit(1)

    conn = sqlite3.connect(args.db_path)

    # Build set of existing ISSNs
    existing_issns = build_existing_issn_set(conn)

    # Create table
    create_table(conn)

    # Import Scopus-only journals
    imported = import_scopus_only_journals(conn, args.scopus_path, existing_issns)

    # Get stats
    cur = conn.execute("SELECT COUNT(*) FROM scopus_only_journals WHERE is_discontinued = 1")
    discontinued = cur.fetchone()[0]

    cur = conn.execute("SELECT source_type, COUNT(*) FROM scopus_only_journals GROUP BY source_type")
    source_types = dict(cur.fetchall())

    conn.close()

    log("=" * 50)
    log("Import complete!")
    log(f"  Total Scopus-only journals: {imported}")
    log(f"  Discontinued: {discontinued}")
    log(f"  By source type: {source_types}")
    log("=" * 50)


if __name__ == '__main__':
    main()
