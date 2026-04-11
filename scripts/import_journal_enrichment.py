#!/usr/bin/env python3
"""
Import journal enrichment data from Scopus and DOAJ.

This script:
1. Reads Scopus journal list for languages, publisher, discontinued status, ASJC codes,
   coverage dates, source type, title history, related titles, Medline flag
2. Reads DOAJ CSV for license, APC, LCC codes, subjects
3. Matches to journals by ISSN
4. Creates/updates journal_enrichment table

Usage:
    python scripts/import_journal_enrichment.py [--rebuild] [--db-path PATH]
"""

import argparse
import sqlite3
import json
import csv
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
    # Remove all non-alphanumeric characters
    clean = re.sub(r'[^0-9Xx]', '', str(issn).upper())
    if len(clean) == 8:
        return f"{clean[:4]}-{clean[4:]}"
    return None


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
                issn_norm = normalize_issn(issn)
                if issn_norm:
                    issn_to_sourceid[issn_norm] = sourceid
        except (json.JSONDecodeError, TypeError):
            pass

    log(f"Indexed {len(issn_to_sourceid)} ISSNs from database")
    return issn_to_sourceid


def read_scopus_data(excel_path: Path) -> dict[str, dict]:
    """Read Scopus data and organize by ISSN."""
    log(f"Reading Scopus Excel file: {excel_path}")

    wb = openpyxl.load_workbook(excel_path, read_only=True)
    sheet = wb['Scopus Sources Nov. 2025']

    # Column indices (0-based) - verified against actual Excel structure
    COL_SOURCE_ID = 0           # Sourcerecord ID
    COL_TITLE = 1               # Source Title
    COL_ISSN = 2                # ISSN
    COL_EISSN = 3               # EISSN
    COL_ACTIVE = 4              # Active or Inactive
    COL_COVERAGE = 5            # Coverage (e.g., "1959-2001")
    COL_DISCONTINUED_QUALITY = 6  # Titles Discontinued by Scopus Due to Quality Issues
    COL_LANGUAGES = 7           # Article Language in Source (ISO codes)
    COL_MEDLINE = 8             # Medline-sourced Title?
    COL_OPEN_ACCESS = 9         # Open Access Status
    COL_ARTICLES_IN_PRESS = 10  # Articles in Press Included?
    # COL_ADDED_DATE = 11       # Added to List Nov. 2025 (not used)
    COL_SOURCE_TYPE = 12        # Source Type (Journal, Book Series, etc.)
    COL_TITLE_HISTORY = 13      # Title History Indication (Continued as, Formerly known as)
    COL_RELATED_1 = 14          # Related Title 1
    COL_RELATED_2 = 15          # Other Related Title 2
    COL_RELATED_3 = 16          # Other Related Title 3
    COL_RELATED_4 = 17          # Other Related Title 4
    COL_PUBLISHER = 18          # Publisher
    # COL_PUBLISHER_IMPRINTS = 19  # Publisher Imprints (not used)
    COL_ASJC = 20               # All Science Journal Classification Codes (ASJC)
    COL_TOP_LIFE = 21           # Top level: Life Sciences
    COL_TOP_SOCIAL = 22         # Top level: Social Sciences
    COL_TOP_PHYSICAL = 23       # Top level: Physical Sciences
    COL_TOP_HEALTH = 24         # Top level: Health Sciences

    scopus_data = {}  # keyed by normalized ISSN
    row_count = 0

    for row in sheet.iter_rows(min_row=2, values_only=True):
        row_count += 1
        if row_count % 10000 == 0:
            log(f"  Processed {row_count} Scopus rows...")

        # Ensure row has enough columns
        if len(row) < 21:
            continue

        source_id = str(row[COL_SOURCE_ID]) if row[COL_SOURCE_ID] else None
        title = row[COL_TITLE]
        issn = normalize_issn(row[COL_ISSN])
        eissn_raw = row[COL_EISSN]
        eissn = normalize_issn(eissn_raw)
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

        # Handle ASJC codes - may be int or string
        asjc_list = None
        if asjc:
            asjc_str = str(asjc)
            asjc_list = json.dumps([x.strip() for x in asjc_str.split('; ') if x.strip()])

        # Handle languages
        lang_list = None
        if languages:
            lang_str = str(languages)
            lang_list = json.dumps([x.strip() for x in lang_str.split('; ') if x.strip()])

        # Build related titles array (only non-empty titles)
        related_titles = [t for t in [related_1, related_2, related_3, related_4] if t]
        related_titles_json = json.dumps(related_titles) if related_titles else None

        # Build top-level categories object
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

        # Parse boolean flags
        is_medline = 1 if medline and 'medline' in str(medline).lower() else 0
        has_articles_in_press = 1 if articles_in_press and 'articles in press' in str(articles_in_press).lower() else 0

        data = {
            'scopus_source_id': source_id,
            'title': title,
            'publisher_scopus': publisher,
            'is_discontinued': 1 if active == 'Inactive' else 0,
            'discontinued_for_quality': 1 if discontinued_quality and ('discontinue' in str(discontinued_quality).lower() or 'quality' in str(discontinued_quality).lower()) else 0,
            'languages': lang_list,
            'open_access_scopus': open_access,
            'asjc_codes': asjc_list,
            # New fields
            'eissn': eissn_raw if eissn_raw else None,  # Store original format
            'coverage': coverage,
            'source_type': source_type,
            'is_medline': is_medline,
            'articles_in_press': has_articles_in_press,
            'title_history': title_history,
            'related_titles': related_titles_json,
            'top_level_categories': top_categories_json,
        }

        # Store under both ISSN and EISSN for matching
        if issn:
            scopus_data[issn] = data
        if eissn:
            scopus_data[eissn] = data

    wb.close()
    log(f"Read {row_count} Scopus entries, {len(scopus_data)} unique ISSNs")
    return scopus_data


def parse_apc_amount(apc_str: str | None) -> tuple[int | None, str | None]:
    """Parse APC amount string like '1500 USD' into (amount, currency)."""
    if not apc_str:
        return None, None

    # Common patterns: "1500 USD", "EUR 500", "$1,500", "1500"
    apc_str = str(apc_str).strip()

    # Extract currency
    currency = None
    for curr in ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'INR', 'BRL', 'AUD', 'CAD']:
        if curr in apc_str.upper():
            currency = curr
            break
    if '$' in apc_str and not currency:
        currency = 'USD'
    if '€' in apc_str and not currency:
        currency = 'EUR'
    if '£' in apc_str and not currency:
        currency = 'GBP'

    # Extract amount (first number found)
    nums = re.findall(r'[\d,]+(?:\.\d+)?', apc_str)
    if nums:
        try:
            amount = int(float(nums[0].replace(',', '')))
            return amount, currency
        except ValueError:
            pass

    return None, None


def read_doaj_data(csv_path: Path) -> dict[str, dict]:
    """Read DOAJ data and organize by ISSN."""
    log(f"Reading DOAJ CSV file: {csv_path}")

    # Column indices (0-based) based on header
    COL_TITLE = 0
    COL_PRINT_ISSN = 5
    COL_EISSN = 6
    COL_LANGUAGES = 8
    COL_LICENSE = 13
    COL_APC = 26
    COL_APC_AMOUNT = 28
    COL_LCC = 42
    COL_SUBJECTS = 44

    doaj_data = {}
    row_count = 0

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader)  # Skip header

        for row in reader:
            row_count += 1
            if row_count % 5000 == 0:
                log(f"  Processed {row_count} DOAJ rows...")

            if len(row) < 45:
                continue

            print_issn = normalize_issn(row[COL_PRINT_ISSN])
            eissn = normalize_issn(row[COL_EISSN])

            license_type = row[COL_LICENSE] if len(row) > COL_LICENSE else None
            apc_has = row[COL_APC] if len(row) > COL_APC else None
            apc_amount_str = row[COL_APC_AMOUNT] if len(row) > COL_APC_AMOUNT else None
            lcc_codes = row[COL_LCC] if len(row) > COL_LCC else None
            subjects = row[COL_SUBJECTS] if len(row) > COL_SUBJECTS else None
            languages = row[COL_LANGUAGES] if len(row) > COL_LANGUAGES else None

            # Parse APC
            apc_amount, apc_currency = None, None
            if apc_has and apc_has.lower() == 'yes' and apc_amount_str:
                apc_amount, apc_currency = parse_apc_amount(apc_amount_str)

            data = {
                'license_type': license_type,
                'apc_amount': apc_amount,
                'apc_currency': apc_currency,
                'apc_year': 2025,
                'lcc_codes': json.dumps(lcc_codes.split('|')) if lcc_codes else None,
                'subjects_doaj': subjects,
                'languages_doaj': json.dumps(languages.split(', ')) if languages else None,
            }

            if print_issn:
                doaj_data[print_issn] = data
            if eissn:
                doaj_data[eissn] = data

    log(f"Read {row_count} DOAJ entries, {len(doaj_data)} unique ISSNs")
    return doaj_data


def create_table(conn: sqlite3.Connection):
    """Create the journal_enrichment table."""
    log("Creating journal_enrichment table...")

    conn.execute("DROP TABLE IF EXISTS journal_enrichment")
    conn.execute("""
        CREATE TABLE journal_enrichment (
            sourceid TEXT PRIMARY KEY,
            scopus_source_id TEXT,

            -- Publisher
            publisher_scopus TEXT,

            -- Open Access & Licensing
            license_type TEXT,
            apc_amount INTEGER,
            apc_currency TEXT,
            apc_year INTEGER,

            -- Languages
            languages TEXT,

            -- Status
            is_discontinued INTEGER DEFAULT 0,
            discontinued_for_quality INTEGER DEFAULT 0,

            -- Subject classifications
            asjc_codes TEXT,
            lcc_codes TEXT,
            subjects_doaj TEXT,

            -- New fields from Scopus
            eissn TEXT,
            coverage TEXT,
            source_type TEXT,
            is_medline INTEGER DEFAULT 0,
            articles_in_press INTEGER DEFAULT 0,
            title_history TEXT,
            related_titles TEXT,
            top_level_categories TEXT,

            -- Metadata
            data_source TEXT,
            import_date TEXT
        )
    """)
    conn.commit()


def import_enrichment_data(
    conn: sqlite3.Connection,
    issn_to_sourceid: dict[str, str],
    scopus_data: dict[str, dict],
    doaj_data: dict[str, dict]
) -> tuple[int, int, int]:
    """Import enrichment data, matching by ISSN."""

    log("Matching and importing enrichment data...")

    # Track which sourceids we've processed
    enrichment_records = {}  # sourceid -> merged data

    # Process Scopus data
    scopus_matched = 0
    for issn, data in scopus_data.items():
        if issn in issn_to_sourceid:
            sourceid = issn_to_sourceid[issn]
            if sourceid not in enrichment_records:
                enrichment_records[sourceid] = {
                    'sourceid': sourceid,
                    'data_source': 'scopus',
                }
            record = enrichment_records[sourceid]
            record['scopus_source_id'] = data['scopus_source_id']
            record['publisher_scopus'] = data['publisher_scopus']
            record['is_discontinued'] = data['is_discontinued']
            record['discontinued_for_quality'] = data['discontinued_for_quality']
            record['languages'] = data['languages']
            record['asjc_codes'] = data['asjc_codes']
            # New fields
            record['eissn'] = data.get('eissn')
            record['coverage'] = data.get('coverage')
            record['source_type'] = data.get('source_type')
            record['is_medline'] = data.get('is_medline', 0)
            record['articles_in_press'] = data.get('articles_in_press', 0)
            record['title_history'] = data.get('title_history')
            record['related_titles'] = data.get('related_titles')
            record['top_level_categories'] = data.get('top_level_categories')
            scopus_matched += 1

    log(f"  Matched {scopus_matched} Scopus ISSNs to {len(enrichment_records)} journals")

    # Process DOAJ data
    doaj_matched = 0
    doaj_new = 0
    for issn, data in doaj_data.items():
        if issn in issn_to_sourceid:
            sourceid = issn_to_sourceid[issn]
            if sourceid not in enrichment_records:
                enrichment_records[sourceid] = {
                    'sourceid': sourceid,
                    'data_source': 'doaj',
                }
                doaj_new += 1
            else:
                # Update source to 'both' if already had Scopus data
                if enrichment_records[sourceid]['data_source'] == 'scopus':
                    enrichment_records[sourceid]['data_source'] = 'both'
            record = enrichment_records[sourceid]
            record['license_type'] = data['license_type']
            record['apc_amount'] = data['apc_amount']
            record['apc_currency'] = data['apc_currency']
            record['apc_year'] = data['apc_year']
            record['lcc_codes'] = data['lcc_codes']
            record['subjects_doaj'] = data['subjects_doaj']
            # Prefer DOAJ languages if we don't have Scopus languages
            if not record.get('languages') and data.get('languages_doaj'):
                record['languages'] = data['languages_doaj']
            doaj_matched += 1

    log(f"  Matched {doaj_matched} DOAJ ISSNs ({doaj_new} new journals)")

    # Insert all records
    import_date = date.today().isoformat()
    inserted = 0

    for sourceid, record in enrichment_records.items():
        conn.execute("""
            INSERT INTO journal_enrichment (
                sourceid, scopus_source_id, publisher_scopus,
                license_type, apc_amount, apc_currency, apc_year,
                languages, is_discontinued, discontinued_for_quality,
                asjc_codes, lcc_codes, subjects_doaj,
                eissn, coverage, source_type, is_medline, articles_in_press,
                title_history, related_titles, top_level_categories,
                data_source, import_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sourceid,
            record.get('scopus_source_id'),
            record.get('publisher_scopus'),
            record.get('license_type'),
            record.get('apc_amount'),
            record.get('apc_currency'),
            record.get('apc_year'),
            record.get('languages'),
            record.get('is_discontinued', 0),
            record.get('discontinued_for_quality', 0),
            record.get('asjc_codes'),
            record.get('lcc_codes'),
            record.get('subjects_doaj'),
            record.get('eissn'),
            record.get('coverage'),
            record.get('source_type'),
            record.get('is_medline', 0),
            record.get('articles_in_press', 0),
            record.get('title_history'),
            record.get('related_titles'),
            record.get('top_level_categories'),
            record.get('data_source'),
            import_date
        ))
        inserted += 1

    conn.commit()

    # Count by source
    cur = conn.execute("SELECT data_source, COUNT(*) FROM journal_enrichment GROUP BY data_source")
    source_counts = dict(cur.fetchall())

    return (
        source_counts.get('scopus', 0),
        source_counts.get('doaj', 0),
        source_counts.get('both', 0)
    )


def main():
    parser = argparse.ArgumentParser(description='Import journal enrichment data')
    parser.add_argument('--rebuild', action='store_true',
                        help='Drop and recreate table (default behavior)')
    parser.add_argument('--db-path', type=Path,
                        default=Path('data/journals.db'),
                        help='Path to journals.db')
    parser.add_argument('--scopus-path', type=Path,
                        default=Path('journals_data/scopus_source_title_list.xlsx'),
                        help='Path to Scopus Excel file')
    parser.add_argument('--doaj-path', type=Path,
                        default=Path('journals_data/journalcsv__doaj_20251211_1429_utf8.csv'),
                        help='Path to DOAJ CSV file')
    args = parser.parse_args()

    if not args.db_path.exists():
        print(f"Error: Database not found: {args.db_path}")
        sys.exit(1)

    if not args.scopus_path.exists():
        print(f"Error: Scopus file not found: {args.scopus_path}")
        sys.exit(1)

    if not args.doaj_path.exists():
        print(f"Error: DOAJ file not found: {args.doaj_path}")
        sys.exit(1)

    # Connect to database
    conn = sqlite3.connect(args.db_path)

    # Build ISSN index
    issn_to_sourceid = build_issn_index(conn)

    # Read source data
    scopus_data = read_scopus_data(args.scopus_path)
    doaj_data = read_doaj_data(args.doaj_path)

    # Create table
    create_table(conn)

    # Import data
    scopus_only, doaj_only, both = import_enrichment_data(
        conn, issn_to_sourceid, scopus_data, doaj_data
    )

    # Get final count
    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment")
    total = cur.fetchone()[0]

    # Count discontinued
    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE is_discontinued = 1")
    discontinued = cur.fetchone()[0]

    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE discontinued_for_quality = 1")
    discontinued_quality = cur.fetchone()[0]

    # Count with APC
    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE apc_amount IS NOT NULL")
    with_apc = cur.fetchone()[0]

    # Count new fields
    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE coverage IS NOT NULL")
    with_coverage = cur.fetchone()[0]

    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE source_type IS NOT NULL")
    with_source_type = cur.fetchone()[0]

    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE title_history IS NOT NULL")
    with_title_history = cur.fetchone()[0]

    cur = conn.execute("SELECT COUNT(*) FROM journal_enrichment WHERE is_medline = 1")
    medline_count = cur.fetchone()[0]

    cur = conn.execute("SELECT DISTINCT source_type FROM journal_enrichment WHERE source_type IS NOT NULL")
    source_types = [r[0] for r in cur.fetchall()]

    conn.close()

    log("=" * 50)
    log("Import complete!")
    log(f"  Total enriched journals: {total}")
    log(f"  From Scopus only: {scopus_only}")
    log(f"  From DOAJ only: {doaj_only}")
    log(f"  From both sources: {both}")
    log(f"  Discontinued: {discontinued}")
    log(f"  Discontinued for quality: {discontinued_quality}")
    log(f"  With APC info: {with_apc}")
    log(f"  With coverage dates: {with_coverage}")
    log(f"  With source type: {with_source_type}")
    log(f"  With title history: {with_title_history}")
    log(f"  Medline-sourced: {medline_count}")
    log(f"  Source types found: {source_types}")
    log("=" * 50)


if __name__ == '__main__':
    main()
