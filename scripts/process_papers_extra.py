#!/usr/bin/env python3
"""
Process extra paper metadata to SQLite database.

Includes:
- Newsfeed/media mentions
- PMID/PMCID mappings
- Papers raw metadata (publication_date, type, is_retracted, is_paratext, language)
- Patents
- Lite paper data for papers not in journals.db:
  - paper_core: title, doi, publication_date, etc.
  - paper_authors: author links with positions
  - paper_fields: field classifications
  - paper_sources: journal/source info

Creates a separate papers_extra.db file for lazy-loading additional paper data.

Usage:
    python scripts/process_papers_extra.py --data-dir /path/to/sciscinet-v2 --output-dir data

    # To also process lite paper data (delta only - papers not in journals.db):
    python scripts/process_papers_extra.py --data-dir /path/to/sciscinet-v2 --output-dir data --lite
"""

import argparse
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Process extra paper data to SQLite")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("/media/dan/metascience/sciscinet-v2"),
        help="Directory containing parquet files",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data"),
        help="Output directory for papers_extra.db",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing papers_extra.db and start fresh",
    )
    parser.add_argument(
        "--lite",
        action="store_true",
        help="Also process lite paper data (paper_core, paper_authors, paper_fields, paper_sources) for papers not in journals.db",
    )
    parser.add_argument(
        "--journals-db",
        type=Path,
        default=None,
        help="Path to journals.db (for delta processing). Default: output-dir/journals.db",
    )
    return parser.parse_args()


def format_duration(seconds: float) -> str:
    """Format duration in human-readable form."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds / 60:.1f}m"
    else:
        return f"{seconds / 3600:.1f}h"


def main():
    args = parse_args()

    # Validate paths
    newsfeed_path = args.data_dir / "sciscinet_newsfeed_metadata.parquet"
    pmid_path = args.data_dir / "sciscinet_papers_pmid_pmcid.parquet"
    papers_raw_path = args.data_dir / "papers_raw.parquet"
    patents_path = args.data_dir / "sciscinet_link_patents.parquet"

    # Lite paper data sources
    authors_paperid_path = args.data_dir / "sciscinet_authors_paperid.parquet"
    paper_author_affiliation_path = args.data_dir / "sciscinet_paper_author_affiliation.parquet"
    paperfields_path = args.data_dir / "sciscinet_paperfields.parquet"
    papersources_path = args.data_dir / "sciscinet_papersources.parquet"

    if not newsfeed_path.exists():
        print(f"Warning: Newsfeed file not found: {newsfeed_path}")
    if not pmid_path.exists():
        print(f"Warning: PMID/PMCID file not found: {pmid_path}")
    if not papers_raw_path.exists():
        print(f"Warning: Papers raw file not found: {papers_raw_path}")
    if not patents_path.exists():
        print(f"Warning: Patents file not found: {patents_path}")

    # Journals.db path for delta processing
    journals_db_path = args.journals_db or (args.output_dir / "journals.db")
    if args.lite and not journals_db_path.exists():
        print(f"Error: --lite requires journals.db at {journals_db_path}")
        print("Use --journals-db to specify a different path")
        return

    args.output_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = args.output_dir / "papers_extra.db"

    if args.reset and sqlite_path.exists():
        print(f"Deleting existing {sqlite_path}...")
        sqlite_path.unlink()

    # Import DuckDB here to avoid startup cost if args are invalid
    import duckdb

    print(f"Output database: {sqlite_path}")
    print()

    start_time = time.time()

    # Connect to DuckDB (in-memory)
    con = duckdb.connect(":memory:")

    # Install and load SQLite extension
    print("Setting up DuckDB with SQLite extension...")
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute(f"ATTACH '{sqlite_path}' AS sqlite_db (TYPE SQLITE)")

    # Process newsfeed data
    if newsfeed_path.exists():
        print()
        print("=" * 60)
        print("PROCESSING NEWSFEED MENTIONS")
        print("=" * 60)

        # Check if table already exists
        existing_tables = {row[0] for row in con.execute("SHOW TABLES FROM sqlite_db").fetchall()}

        if "paper_newsfeed" not in existing_tables:
            step_start = time.time()

            # Count rows
            total = con.execute(f"SELECT COUNT(*) FROM read_parquet('{newsfeed_path}')").fetchone()[0]
            print(f"Processing {total:,} newsfeed mentions...")

            # Create table directly in SQLite
            con.execute(f"""
                CREATE TABLE sqlite_db.paper_newsfeed AS
                SELECT
                    paperid,
                    subj_id as url,
                    timestamp
                FROM read_parquet('{newsfeed_path}')
                WHERE paperid IS NOT NULL
                ORDER BY paperid, timestamp DESC
            """)

            count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_newsfeed").fetchone()[0]
            unique_papers = con.execute("SELECT COUNT(DISTINCT paperid) FROM sqlite_db.paper_newsfeed").fetchone()[0]
            print(f"  Created paper_newsfeed with {count:,} rows for {unique_papers:,} papers")

            print(f"  Completed in {format_duration(time.time() - step_start)}")
        else:
            print("paper_newsfeed table already exists, skipping...")

    # Process PMID/PMCID data
    if pmid_path.exists():
        print()
        print("=" * 60)
        print("PROCESSING PMID/PMCID")
        print("=" * 60)

        existing_tables = {row[0] for row in con.execute("SHOW TABLES FROM sqlite_db").fetchall()}

        if "paper_pubmed" not in existing_tables:
            step_start = time.time()

            # Count rows
            total = con.execute(f"SELECT COUNT(*) FROM read_parquet('{pmid_path}')").fetchone()[0]
            print(f"Processing {total:,} PubMed ID mappings...")

            # Create table directly in SQLite
            con.execute(f"""
                CREATE TABLE sqlite_db.paper_pubmed AS
                SELECT
                    paperid,
                    pmid,
                    pmcid
                FROM read_parquet('{pmid_path}')
                WHERE paperid IS NOT NULL
                    AND (pmid IS NOT NULL OR pmcid IS NOT NULL)
            """)

            count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_pubmed").fetchone()[0]
            print(f"  Created paper_pubmed with {count:,} rows")

            print(f"  Completed in {format_duration(time.time() - step_start)}")
        else:
            print("paper_pubmed table already exists, skipping...")

    # Process papers_raw metadata
    if papers_raw_path.exists():
        print()
        print("=" * 60)
        print("PROCESSING PAPERS RAW METADATA")
        print("=" * 60)

        existing_tables = {row[0] for row in con.execute("SHOW TABLES FROM sqlite_db").fetchall()}

        if "paper_metadata" not in existing_tables:
            step_start = time.time()

            # Count rows
            total = con.execute(f"SELECT COUNT(*) FROM read_parquet('{papers_raw_path}')").fetchone()[0]
            print(f"Processing {total:,} papers...")

            # Create table directly in SQLite
            # Extract paperid from full OpenAlex URL (id field)
            con.execute(f"""
                CREATE TABLE sqlite_db.paper_metadata AS
                SELECT
                    REPLACE(id, 'https://openalex.org/', '') as paperid,
                    publication_date,
                    type as doc_type,
                    cited_by_count as openalex_cited_by_count,
                    is_retracted,
                    is_paratext,
                    language
                FROM read_parquet('{papers_raw_path}')
                WHERE id IS NOT NULL
            """)

            count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_metadata").fetchone()[0]
            print(f"  Created paper_metadata with {count:,} rows")

            print(f"  Completed in {format_duration(time.time() - step_start)}")
        else:
            print("paper_metadata table already exists, skipping...")

    # Process patents data
    if patents_path.exists():
        print()
        print("=" * 60)
        print("PROCESSING PATENTS")
        print("=" * 60)

        existing_tables = {row[0] for row in con.execute("SHOW TABLES FROM sqlite_db").fetchall()}

        if "paper_patents" not in existing_tables:
            step_start = time.time()

            # Count rows
            total = con.execute(f"SELECT COUNT(*) FROM read_parquet('{patents_path}')").fetchone()[0]
            print(f"Processing {total:,} paper-patent links...")

            # Create table directly in SQLite
            con.execute(f"""
                CREATE TABLE sqlite_db.paper_patents AS
                SELECT
                    paperid,
                    patent,
                    uspto
                FROM read_parquet('{patents_path}')
                WHERE paperid IS NOT NULL AND patent IS NOT NULL
                ORDER BY paperid, patent
            """)

            count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_patents").fetchone()[0]
            unique_papers = con.execute("SELECT COUNT(DISTINCT paperid) FROM sqlite_db.paper_patents").fetchone()[0]
            print(f"  Created paper_patents with {count:,} rows for {unique_papers:,} papers")

            print(f"  Completed in {format_duration(time.time() - step_start)}")
        else:
            print("paper_patents table already exists, skipping...")

    # Process lite paper data (delta only - papers not in journals.db)
    if args.lite:
        print()
        print("=" * 60)
        print("PROCESSING LITE PAPER DATA (DELTA ONLY)")
        print("=" * 60)
        print(f"Using journals.db at: {journals_db_path}")

        # Attach journals.db to get list of papers to exclude
        con.execute(f"ATTACH '{journals_db_path}' AS journals_db (TYPE SQLITE, READ_ONLY)")

        # Get count of papers in journals.db for reference
        journals_paper_count = con.execute("SELECT COUNT(*) FROM journals_db.paper_summary").fetchone()[0]
        print(f"Papers in journals.db: {journals_paper_count:,}")

        existing_tables = {row[0] for row in con.execute("SHOW TABLES FROM sqlite_db").fetchall()}

        # Process paper_core (title, doi, dates, etc.) for delta papers
        if papers_raw_path.exists():
            if "paper_core" not in existing_tables:
                print()
                print("-" * 40)
                print("Processing paper_core (delta)...")
                step_start = time.time()

                # Count delta papers (not in journals.db)
                delta_count = con.execute(f"""
                    SELECT COUNT(*)
                    FROM read_parquet('{papers_raw_path}') p
                    WHERE REPLACE(p.id, 'https://openalex.org/', '') NOT IN (
                        SELECT paperid FROM journals_db.paper_summary
                    )
                """).fetchone()[0]
                print(f"  Delta papers to process: {delta_count:,}")

                # Create paper_core table with delta papers only
                con.execute(f"""
                    CREATE TABLE sqlite_db.paper_core AS
                    SELECT
                        REPLACE(p.id, 'https://openalex.org/', '') as paperid,
                        p.title,
                        p.doi,
                        p.publication_date,
                        p.type as doc_type,
                        p.language,
                        p.cited_by_count,
                        p.is_retracted
                    FROM read_parquet('{papers_raw_path}') p
                    WHERE p.id IS NOT NULL
                        AND REPLACE(p.id, 'https://openalex.org/', '') NOT IN (
                            SELECT paperid FROM journals_db.paper_summary
                        )
                """)

                count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_core").fetchone()[0]
                print(f"  Created paper_core with {count:,} rows")
                print(f"  Completed in {format_duration(time.time() - step_start)}")
            else:
                print("paper_core table already exists, skipping...")

        # Process paper_authors for delta papers
        if authors_paperid_path.exists() and paper_author_affiliation_path.exists():
            if "paper_authors" not in existing_tables:
                print()
                print("-" * 40)
                print("Processing paper_authors (delta)...")
                step_start = time.time()

                # Join author name with affiliation data, filter to delta papers
                con.execute(f"""
                    CREATE TABLE sqlite_db.paper_authors AS
                    SELECT
                        a.paperid,
                        a.authorid,
                        a.display_name,
                        aff.author_position,
                        aff.institutionid,
                        aff.raw_affiliation_string as raw_affiliation
                    FROM read_parquet('{authors_paperid_path}') a
                    LEFT JOIN read_parquet('{paper_author_affiliation_path}') aff
                        ON a.paperid = aff.paperid AND a.authorid = aff.authorid
                    WHERE a.paperid NOT IN (
                        SELECT paperid FROM journals_db.paper_summary
                    )
                    ORDER BY a.paperid, aff.author_position
                """)

                count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_authors").fetchone()[0]
                unique_papers = con.execute("SELECT COUNT(DISTINCT paperid) FROM sqlite_db.paper_authors").fetchone()[0]
                print(f"  Created paper_authors with {count:,} rows for {unique_papers:,} papers")
                print(f"  Completed in {format_duration(time.time() - step_start)}")
            else:
                print("paper_authors table already exists, skipping...")

        # Process paper_fields for delta papers
        if paperfields_path.exists():
            if "paper_fields" not in existing_tables:
                print()
                print("-" * 40)
                print("Processing paper_fields (delta)...")
                step_start = time.time()

                con.execute(f"""
                    CREATE TABLE sqlite_db.paper_fields AS
                    SELECT
                        paperid,
                        fieldid,
                        score_openalex as score
                    FROM read_parquet('{paperfields_path}')
                    WHERE paperid NOT IN (
                        SELECT paperid FROM journals_db.paper_summary
                    )
                    ORDER BY paperid, score DESC
                """)

                count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_fields").fetchone()[0]
                unique_papers = con.execute("SELECT COUNT(DISTINCT paperid) FROM sqlite_db.paper_fields").fetchone()[0]
                print(f"  Created paper_fields with {count:,} rows for {unique_papers:,} papers")
                print(f"  Completed in {format_duration(time.time() - step_start)}")
            else:
                print("paper_fields table already exists, skipping...")

        # Process paper_sources for delta papers
        if papersources_path.exists():
            if "paper_sources" not in existing_tables:
                print()
                print("-" * 40)
                print("Processing paper_sources (delta)...")
                step_start = time.time()

                con.execute(f"""
                    CREATE TABLE sqlite_db.paper_sources AS
                    SELECT
                        paperid,
                        sourceid,
                        landing_page_url,
                        pdf_url,
                        is_oa,
                        version,
                        license
                    FROM read_parquet('{papersources_path}')
                    WHERE paperid NOT IN (
                        SELECT paperid FROM journals_db.paper_summary
                    )
                """)

                count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_sources").fetchone()[0]
                print(f"  Created paper_sources with {count:,} rows")
                print(f"  Completed in {format_duration(time.time() - step_start)}")
            else:
                print("paper_sources table already exists, skipping...")

        # Detach journals.db
        con.execute("DETACH journals_db")

    # Clean up DuckDB
    con.execute("DETACH sqlite_db")
    con.close()

    # Create indexes using native sqlite3 (DuckDB's SQLite extension doesn't support CREATE INDEX well)
    print()
    print("=" * 60)
    print("CREATING INDEXES")
    print("=" * 60)

    import sqlite3
    sqlite_con = sqlite3.connect(sqlite_path)
    cursor = sqlite_con.cursor()

    # Get list of existing indexes
    existing_indexes = {row[0] for row in cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    ).fetchall()}

    indexes_to_create = [
        ("idx_paper_newsfeed_paperid", "paper_newsfeed", "paperid"),
        ("idx_paper_pubmed_paperid", "paper_pubmed", "paperid"),
        ("idx_paper_metadata_paperid", "paper_metadata", "paperid"),
        ("idx_paper_patents_paperid", "paper_patents", "paperid"),
        # Lite paper indexes
        ("idx_paper_core_paperid", "paper_core", "paperid"),
        ("idx_paper_authors_paperid", "paper_authors", "paperid"),
        ("idx_paper_fields_paperid", "paper_fields", "paperid"),
        ("idx_paper_sources_paperid", "paper_sources", "paperid"),
    ]

    for idx_name, table, column in indexes_to_create:
        if idx_name not in existing_indexes:
            # Check if table exists
            table_exists = cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if table_exists:
                print(f"  Creating index {idx_name} on {table}({column})...")
                cursor.execute(f"CREATE INDEX {idx_name} ON {table}({column})")

    sqlite_con.commit()
    sqlite_con.close()

    elapsed = time.time() - start_time
    db_size = sqlite_path.stat().st_size / (1024 ** 2)

    print()
    print("=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Total time: {format_duration(elapsed)}")
    print(f"Database size: {db_size:.1f} MB")
    print(f"Output: {sqlite_path}")


if __name__ == "__main__":
    main()
