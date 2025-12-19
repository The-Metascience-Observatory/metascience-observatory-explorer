#!/usr/bin/env python3
"""
Create paper_citation_history table from existing paper_citations in SQLite.

This is a one-time script to backfill the citation history table without
re-running the full preprocessing pipeline.

Usage:
    python create_citation_history.py
"""

import sqlite3
import time
from pathlib import Path


def format_duration(seconds: float) -> str:
    """Format duration in human-readable form."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}m {secs}s"
    else:
        hours = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        return f"{hours}h {mins}m"


def main():
    db_path = Path(__file__).parent.parent / "data" / "journals.db"

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        return

    print(f"Connecting to {db_path}...")
    con = sqlite3.connect(str(db_path))

    # Check if table already exists
    cursor = con.execute("""
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='paper_citation_history'
    """)
    if cursor.fetchone():
        print("paper_citation_history table already exists!")
        count = con.execute("SELECT COUNT(*) FROM paper_citation_history").fetchone()[0]
        print(f"  Contains {count:,} rows")
        con.close()
        return

    # Check if paper_citations exists
    cursor = con.execute("""
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='paper_citations'
    """)
    if not cursor.fetchone():
        print("paper_citations table not found!")
        con.close()
        return

    print("Creating paper_citation_history table...")
    print("  This will aggregate 2.5B citation records - may take 30-60 minutes...")

    start_time = time.time()

    # Create table with aggregated citation counts by year
    con.execute("""
        CREATE TABLE paper_citation_history AS
        SELECT
            paperid,
            citing_year as year,
            COUNT(*) as citation_count
        FROM paper_citations
        WHERE citing_year IS NOT NULL
        GROUP BY paperid, citing_year
        ORDER BY paperid, citing_year
    """)
    con.commit()

    create_time = time.time() - start_time
    print(f"  Table created in {format_duration(create_time)}")

    # Get row count
    count = con.execute("SELECT COUNT(*) FROM paper_citation_history").fetchone()[0]
    print(f"  Created {count:,} rows")

    # Create index
    print("Creating index on paperid...")
    start_time = time.time()
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_paper_citation_history_paperid
        ON paper_citation_history(paperid)
    """)
    con.commit()
    index_time = time.time() - start_time
    print(f"  Index created in {format_duration(index_time)}")

    # Sample data to verify
    print("\nSample data:")
    cursor = con.execute("""
        SELECT * FROM paper_citation_history
        WHERE paperid = 'W2971690404'
        ORDER BY year
    """)
    for row in cursor:
        print(f"  {row}")

    con.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
