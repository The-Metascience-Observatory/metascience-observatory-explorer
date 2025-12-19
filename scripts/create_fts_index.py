#!/usr/bin/env python3
"""
Create FTS5 full-text search index for authors in SQLite database.

This enables fast server-side search across millions of authors.

Usage:
    python scripts/create_fts_index.py
"""

import sqlite3
import time
from pathlib import Path


def main():
    db_path = Path("data/journals.db")

    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        return

    print(f"Opening database: {db_path}")
    conn = sqlite3.connect(str(db_path))

    # Check if person_summary exists
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='person_summary'"
    )
    if not cursor.fetchone():
        print("Error: person_summary table not found")
        conn.close()
        return

    # Get author count
    count = conn.execute("SELECT COUNT(*) FROM person_summary").fetchone()[0]
    print(f"Found {count:,} authors in person_summary")

    # Drop existing FTS table if it exists
    print("Dropping existing FTS table if any...")
    conn.execute("DROP TABLE IF EXISTS person_fts")

    # Create FTS5 virtual table
    print("Creating FTS5 virtual table...")
    start = time.time()

    conn.execute("""
        CREATE VIRTUAL TABLE person_fts USING fts5(
            authorid UNINDEXED,
            display_name,
            orcid,
            last_known_institution,
            h_index UNINDEXED,
            productivity UNINDEXED,
            content='person_summary',
            content_rowid='rowid'
        )
    """)

    # Populate FTS table from person_summary
    print("Populating FTS index (this may take a few minutes)...")
    conn.execute("""
        INSERT INTO person_fts(rowid, authorid, display_name, orcid, last_known_institution, h_index, productivity)
        SELECT rowid, authorid, display_name, orcid, last_known_institution, h_index, productivity
        FROM person_summary
    """)

    conn.commit()
    elapsed = time.time() - start

    # Verify
    fts_count = conn.execute("SELECT COUNT(*) FROM person_fts").fetchone()[0]
    print(f"FTS index created with {fts_count:,} entries in {elapsed:.1f}s")

    # Test search
    print("\nTesting search for 'einstein'...")
    results = conn.execute("""
        SELECT authorid, display_name, h_index, productivity
        FROM person_fts
        WHERE person_fts MATCH 'einstein'
        ORDER BY rank
        LIMIT 5
    """).fetchall()

    for row in results:
        print(f"  - {row[1]} (h-index: {row[2]}, papers: {row[3]})")

    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
