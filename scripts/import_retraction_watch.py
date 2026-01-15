#!/usr/bin/env python3
"""
Import Retraction Watch CSV data into SQLite database.

Usage:
    python scripts/import_retraction_watch.py \
        --input /media/dan/metascience/retraction-watch-data/retraction_watch.csv \
        --output data/retractions.db \
        --journals-db data/journals.db \
        --papers-extra-db data/papers_extra.db

This script:
1. Parses the Retraction Watch CSV
2. Normalizes DOIs and dates
3. Matches papers to our database by DOI or PMID (using SQLite queries, not in-memory)
4. Creates retractions.db with full data and pre-computed stats
5. Uses atomic file replacement for zero-downtime updates
"""

import argparse
import csv
import os
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


def normalize_doi(doi: str) -> str:
    """Normalize DOI to bare format (10.xxxx/xxxxx), lowercase."""
    if not doi:
        return ""
    doi = doi.strip().lower()
    # Remove common prefixes
    doi = re.sub(r'^https?://(dx\.)?doi\.org/', '', doi)
    doi = re.sub(r'^doi:\s*', '', doi)
    # Check if it looks like a DOI
    if doi.startswith('10.'):
        return doi
    return ""


def parse_date(date_str: str) -> str:
    """Parse date from MM/DD/YYYY H:MM format to ISO format YYYY-MM-DD."""
    if not date_str or date_str.strip() == "":
        return ""
    try:
        # Handle "1/6/2025 0:00" format
        date_part = date_str.strip().split()[0]
        parts = date_part.split('/')
        if len(parts) == 3:
            month, day, year = int(parts[0]), int(parts[1]), int(parts[2])
            if 1970 < year < 2100:
                return f"{year:04d}-{month:02d}-{day:02d}"
    except (ValueError, IndexError):
        pass
    return ""


def parse_pmid(pmid_str: str) -> int:
    """Parse PubMed ID, return 0 if invalid."""
    if not pmid_str:
        return 0
    try:
        pmid = int(pmid_str.strip())
        return pmid if pmid > 0 else 0
    except ValueError:
        return 0


def get_year_from_date(date_str: str) -> int:
    """Extract year from ISO date string."""
    if date_str and len(date_str) >= 4:
        try:
            return int(date_str[:4])
        except ValueError:
            pass
    return 0


def main():
    parser = argparse.ArgumentParser(description='Import Retraction Watch data to SQLite')
    parser.add_argument('--input', '-i', required=True, help='Path to retraction_watch.csv')
    parser.add_argument('--output', '-o', required=True, help='Output SQLite database path')
    parser.add_argument('--journals-db', help='Path to journals.db for paper matching')
    parser.add_argument('--papers-extra-db', help='Path to papers_extra.db for PMID matching')
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    temp_path = output_path.with_suffix('.db.new')
    backup_path = output_path.with_suffix('.db.bak')

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        return 1

    print(f"Reading {input_path}...")

    # Open connections to source databases for querying (not loading into memory)
    journals_conn = None
    papers_extra_conn = None

    if args.journals_db and Path(args.journals_db).exists():
        print(f"Connecting to {args.journals_db}...")
        journals_conn = sqlite3.connect(args.journals_db)
        journals_conn.row_factory = sqlite3.Row

    if args.papers_extra_db and Path(args.papers_extra_db).exists():
        print(f"Connecting to {args.papers_extra_db}...")
        papers_extra_conn = sqlite3.connect(args.papers_extra_db)
        papers_extra_conn.row_factory = sqlite3.Row

    # Create new database
    print(f"Creating {temp_path}...")
    if temp_path.exists():
        os.remove(temp_path)

    conn = sqlite3.connect(temp_path)
    cursor = conn.cursor()

    # Create tables
    cursor.executescript("""
        -- Main retractions table
        CREATE TABLE retractions (
            record_id INTEGER PRIMARY KEY,
            title TEXT,
            journal TEXT,
            publisher TEXT,
            retraction_date TEXT,
            retraction_doi TEXT,
            retraction_pmid INTEGER,
            original_paper_date TEXT,
            original_paper_doi TEXT,
            original_paper_pmid INTEGER,
            retraction_nature TEXT,
            reasons TEXT,
            paywalled TEXT,
            notes TEXT,
            subjects TEXT,
            countries TEXT,
            authors TEXT,
            -- Linked data from our database
            paperid TEXT,
            sourceid TEXT
        );

        -- Indexes for lookups
        CREATE INDEX idx_retractions_doi ON retractions(original_paper_doi);
        CREATE INDEX idx_retractions_pmid ON retractions(original_paper_pmid);
        CREATE INDEX idx_retractions_paperid ON retractions(paperid);
        CREATE INDEX idx_retractions_sourceid ON retractions(sourceid);
        CREATE INDEX idx_retractions_journal ON retractions(journal);
        CREATE INDEX idx_retractions_date ON retractions(retraction_date);
        CREATE INDEX idx_retractions_nature ON retractions(retraction_nature);

        -- Pre-computed journal stats by sourceid
        CREATE TABLE journal_retraction_stats (
            sourceid TEXT PRIMARY KEY,
            journal_name TEXT,
            total_retractions INTEGER DEFAULT 0,
            total_concerns INTEGER DEFAULT 0,
            total_corrections INTEGER DEFAULT 0,
            total_reinstatements INTEGER DEFAULT 0,
            total_papers INTEGER DEFAULT 0,
            papers_since_2010 INTEGER DEFAULT 0,
            first_retraction_year INTEGER,
            last_retraction_year INTEGER
        );

        -- Author retraction stats (by authorid from our DB)
        CREATE TABLE author_retraction_stats (
            authorid TEXT PRIMARY KEY,
            total_retractions INTEGER DEFAULT 0,
            total_concerns INTEGER DEFAULT 0,
            total_corrections INTEGER DEFAULT 0,
            total_reinstatements INTEGER DEFAULT 0
        );

        -- Link table: paperid -> retraction record_id (for efficient lookups)
        CREATE TABLE paper_retractions (
            paperid TEXT,
            record_id INTEGER,
            retraction_nature TEXT,
            PRIMARY KEY (paperid, record_id)
        );
        CREATE INDEX idx_paper_retractions_paperid ON paper_retractions(paperid);
    """)

    # Collect all unique DOIs and PMIDs from CSV first (small set ~68K)
    print("Collecting DOIs and PMIDs from Retraction Watch data...")
    csv_dois = set()
    csv_pmids = set()

    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            doi = normalize_doi(row.get('OriginalPaperDOI', ''))
            if doi:
                csv_dois.add(doi)
            pmid = parse_pmid(row.get('OriginalPaperPubMedID', ''))
            if pmid:
                csv_pmids.add(pmid)

    print(f"  Found {len(csv_dois):,} unique DOIs and {len(csv_pmids):,} unique PMIDs")

    # Build lookup tables for just these DOIs/PMIDs (query in batches)
    doi_to_paper = {}
    pmid_to_paperid = {}

    if journals_conn:
        print("Looking up DOIs in journals.db (batched queries)...")
        journals_cursor = journals_conn.cursor()

        # Query in batches of 1000
        doi_list = list(csv_dois)
        batch_size = 1000
        for i in range(0, len(doi_list), batch_size):
            batch = doi_list[i:i + batch_size]
            # Build query with full DOI URLs (as stored in DB)
            full_dois = [f"https://doi.org/{d}" for d in batch]
            placeholders = ','.join(['?'] * len(full_dois))

            journals_cursor.execute(f"""
                SELECT doi, paperid, sourceid, year
                FROM paper_summary
                WHERE doi IN ({placeholders})
            """, full_dois)

            for row in journals_cursor.fetchall():
                doi = normalize_doi(row[0])
                if doi:
                    doi_to_paper[doi] = {
                        "paperid": row[1],
                        "sourceid": row[2],
                        "year": row[3] or 0
                    }

            if (i + batch_size) % 10000 == 0:
                print(f"  Processed {i + batch_size:,} DOIs...")

        print(f"  Matched {len(doi_to_paper):,} DOIs")

    if papers_extra_conn:
        print("Looking up PMIDs in papers_extra.db (batched queries)...")
        extra_cursor = papers_extra_conn.cursor()

        pmid_list = list(csv_pmids)
        batch_size = 1000
        for i in range(0, len(pmid_list), batch_size):
            batch = pmid_list[i:i + batch_size]
            placeholders = ','.join(['?'] * len(batch))

            extra_cursor.execute(f"""
                SELECT pmid, paperid
                FROM paper_pubmed
                WHERE pmid IN ({placeholders})
            """, batch)

            for row in extra_cursor.fetchall():
                pmid_to_paperid[row[0]] = row[1]

        print(f"  Matched {len(pmid_to_paperid):,} PMIDs")

    # For PMID matches, we need to get sourceid from journals.db
    # Build a set of paperids we need to look up
    if journals_conn and pmid_to_paperid:
        print("Looking up sourceids for PMID-matched papers...")
        paperids_to_lookup = set(pmid_to_paperid.values()) - set(p["paperid"] for p in doi_to_paper.values())

        if paperids_to_lookup:
            paperid_to_sourceid = {}
            journals_cursor = journals_conn.cursor()
            paperid_list = list(paperids_to_lookup)
            batch_size = 1000

            for i in range(0, len(paperid_list), batch_size):
                batch = paperid_list[i:i + batch_size]
                placeholders = ','.join(['?'] * len(batch))

                journals_cursor.execute(f"""
                    SELECT paperid, sourceid
                    FROM paper_summary
                    WHERE paperid IN ({placeholders})
                """, batch)

                for row in journals_cursor.fetchall():
                    paperid_to_sourceid[row[0]] = row[1]

            print(f"  Found sourceids for {len(paperid_to_sourceid):,} PMID-matched papers")

    # Load journal paper counts
    journal_paper_counts = {}
    if journals_conn:
        print("Loading journal paper counts...")
        journals_cursor = journals_conn.cursor()
        journals_cursor.execute("""
            SELECT sourceid, SUM(paper_count), SUM(CASE WHEN year >= 2010 THEN paper_count ELSE 0 END)
            FROM journal_yearly_stats
            GROUP BY sourceid
        """)
        for row in journals_cursor.fetchall():
            journal_paper_counts[row[0]] = {
                "total": row[1] or 0,
                "since_2010": row[2] or 0
            }
        print(f"  Loaded counts for {len(journal_paper_counts):,} journals")

    # Now process CSV and insert records
    print("Processing CSV and inserting records...")
    records_inserted = 0
    records_matched = 0
    journal_stats = defaultdict(lambda: {
        "retractions": 0, "concerns": 0, "corrections": 0, "reinstatements": 0,
        "first_year": 9999, "last_year": 0, "journal_name": ""
    })
    paper_retractions = []

    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            record_id_str = row.get('Record ID', '').strip()
            if not record_id_str:
                continue  # Skip rows with empty record ID
            try:
                record_id = int(record_id_str)
            except ValueError:
                continue  # Skip rows with invalid record ID
            title = row.get('Title', '').strip()
            journal = row.get('Journal', '').strip()
            publisher = row.get('Publisher', '').strip()

            retraction_date = parse_date(row.get('RetractionDate', ''))
            retraction_doi = normalize_doi(row.get('RetractionDOI', ''))
            retraction_pmid = parse_pmid(row.get('RetractionPubMedID', ''))

            original_date = parse_date(row.get('OriginalPaperDate', ''))
            original_doi = normalize_doi(row.get('OriginalPaperDOI', ''))
            original_pmid = parse_pmid(row.get('OriginalPaperPubMedID', ''))

            retraction_nature = row.get('RetractionNature', '').strip()
            reasons = row.get('Reason', '').strip()
            paywalled = row.get('Paywalled', '').strip()
            notes = row.get('Notes', '').strip()
            subjects = row.get('Subject', '').strip()
            countries = row.get('Country', '').strip()
            authors = row.get('Author', '').strip()

            # Try to match to our database
            paperid = None
            sourceid = None

            if original_doi and original_doi in doi_to_paper:
                paper_info = doi_to_paper[original_doi]
                paperid = paper_info["paperid"]
                sourceid = paper_info["sourceid"]
                records_matched += 1
            elif original_pmid and original_pmid in pmid_to_paperid:
                paperid = pmid_to_paperid[original_pmid]
                sourceid = paperid_to_sourceid.get(paperid) if 'paperid_to_sourceid' in dir() else None
                records_matched += 1

            # Insert record
            cursor.execute("""
                INSERT INTO retractions (
                    record_id, title, journal, publisher,
                    retraction_date, retraction_doi, retraction_pmid,
                    original_paper_date, original_paper_doi, original_paper_pmid,
                    retraction_nature, reasons, paywalled, notes,
                    subjects, countries, authors, paperid, sourceid
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record_id, title, journal, publisher,
                retraction_date, retraction_doi, retraction_pmid,
                original_date, original_doi, original_pmid,
                retraction_nature, reasons, paywalled, notes,
                subjects, countries, authors, paperid, sourceid
            ))
            records_inserted += 1

            # Track paper_retractions
            if paperid:
                paper_retractions.append((paperid, record_id, retraction_nature))

            # Update journal stats if we have sourceid
            if sourceid:
                year = get_year_from_date(retraction_date)
                stats = journal_stats[sourceid]
                stats["journal_name"] = journal

                if retraction_nature == "Retraction":
                    stats["retractions"] += 1
                elif retraction_nature == "Expression of concern":
                    stats["concerns"] += 1
                elif retraction_nature == "Correction":
                    stats["corrections"] += 1
                elif retraction_nature == "Reinstatement":
                    stats["reinstatements"] += 1

                if year > 0:
                    stats["first_year"] = min(stats["first_year"], year)
                    stats["last_year"] = max(stats["last_year"], year)

            if records_inserted % 10000 == 0:
                print(f"  Processed {records_inserted:,} records...")

    print(f"Inserted {records_inserted:,} records ({records_matched:,} matched to our database)")

    # Insert paper_retractions
    print(f"Inserting {len(paper_retractions):,} paper-retraction links...")
    cursor.executemany(
        "INSERT OR IGNORE INTO paper_retractions (paperid, record_id, retraction_nature) VALUES (?, ?, ?)",
        paper_retractions
    )

    # Insert journal stats
    print(f"Computing stats for {len(journal_stats):,} journals...")
    for sourceid, stats in journal_stats.items():
        counts = journal_paper_counts.get(sourceid, {"total": 0, "since_2010": 0})
        cursor.execute("""
            INSERT INTO journal_retraction_stats (
                sourceid, journal_name,
                total_retractions, total_concerns, total_corrections, total_reinstatements,
                total_papers, papers_since_2010,
                first_retraction_year, last_retraction_year
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sourceid, stats["journal_name"],
            stats["retractions"], stats["concerns"], stats["corrections"], stats["reinstatements"],
            counts["total"], counts["since_2010"],
            stats["first_year"] if stats["first_year"] < 9999 else None,
            stats["last_year"] if stats["last_year"] > 0 else None
        ))

    # Compute author stats
    print("Computing author retraction stats...")
    author_stats = defaultdict(lambda: {
        "retractions": 0, "concerns": 0, "corrections": 0, "reinstatements": 0
    })

    if journals_conn and paper_retractions:
        # Get all paperids that are retracted
        retracted_papers = {pr[0]: pr[2] for pr in paper_retractions}  # paperid -> nature

        # Query author-paper links from journals.db in batches
        journals_cursor = journals_conn.cursor()
        paperid_list = list(retracted_papers.keys())
        batch_size = 1000

        for i in range(0, len(paperid_list), batch_size):
            batch = paperid_list[i:i + batch_size]
            placeholders = ','.join(['?'] * len(batch))

            journals_cursor.execute(f"""
                SELECT authorid, paperid
                FROM person_publications
                WHERE paperid IN ({placeholders})
            """, batch)

            for row in journals_cursor.fetchall():
                authorid, paperid = row
                nature = retracted_papers.get(paperid, "")
                if nature == "Retraction":
                    author_stats[authorid]["retractions"] += 1
                elif nature == "Expression of concern":
                    author_stats[authorid]["concerns"] += 1
                elif nature == "Correction":
                    author_stats[authorid]["corrections"] += 1
                elif nature == "Reinstatement":
                    author_stats[authorid]["reinstatements"] += 1

            if (i + batch_size) % 10000 == 0:
                print(f"  Processed {i + batch_size:,} papers for author stats...")

        print(f"  Found {len(author_stats):,} authors with retractions")

        for authorid, stats in author_stats.items():
            cursor.execute("""
                INSERT INTO author_retraction_stats (
                    authorid, total_retractions, total_concerns,
                    total_corrections, total_reinstatements
                ) VALUES (?, ?, ?, ?, ?)
            """, (
                authorid, stats["retractions"], stats["concerns"],
                stats["corrections"], stats["reinstatements"]
            ))

    conn.commit()

    # Verify integrity
    cursor.execute("SELECT COUNT(*) FROM retractions")
    count = cursor.fetchone()[0]
    print(f"Verification: {count:,} records in database")

    cursor.execute("SELECT COUNT(*) FROM journal_retraction_stats")
    journal_count = cursor.fetchone()[0]
    print(f"Verification: {journal_count:,} journals with stats")

    cursor.execute("SELECT COUNT(*) FROM author_retraction_stats")
    author_count = cursor.fetchone()[0]
    print(f"Verification: {author_count:,} authors with retractions")

    conn.close()

    if journals_conn:
        journals_conn.close()
    if papers_extra_conn:
        papers_extra_conn.close()

    # Atomic replacement
    print("Performing atomic file replacement...")
    if output_path.exists():
        if backup_path.exists():
            os.remove(backup_path)
        os.rename(output_path, backup_path)

    os.rename(temp_path, output_path)

    if backup_path.exists():
        os.remove(backup_path)

    print(f"Done! Database created at {output_path}")
    return 0


if __name__ == '__main__':
    exit(main())
