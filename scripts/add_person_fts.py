#!/usr/bin/env python3
"""
Add FTS5 (Full-Text Search) index to person_summary table for fast author search.
This makes searches like "daniel elton" nearly instant instead of 1+ second.
"""

import sqlite3
import sys
import time
from pathlib import Path

def main():
    db_path = Path(__file__).parent.parent / "data" / "journals.db"

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)

    print(f"Adding FTS5 index to {db_path}")
    print("This may take a few minutes for 100M+ rows...")

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # Check if FTS table already exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='person_fts'")
    if cursor.fetchone():
        print("FTS table already exists. Dropping and recreating...")
        cursor.execute("DROP TABLE person_fts")
        conn.commit()

    start = time.time()

    # Create FTS5 virtual table
    # We index display_name for search, and store authorid for joining back
    print("Creating FTS5 virtual table...")
    cursor.execute("""
        CREATE VIRTUAL TABLE person_fts USING fts5(
            authorid UNINDEXED,
            display_name,
            tokenize='porter unicode61'
        )
    """)
    conn.commit()

    # Populate from person_summary
    print("Populating FTS table from person_summary (this takes a while)...")
    cursor.execute("""
        INSERT INTO person_fts (authorid, display_name)
        SELECT authorid, display_name FROM person_summary
    """)
    conn.commit()

    elapsed = time.time() - start
    print(f"FTS table created in {elapsed:.1f} seconds")

    # Verify
    cursor.execute("SELECT COUNT(*) FROM person_fts")
    count = cursor.fetchone()[0]
    print(f"FTS table has {count:,} rows")

    # Test search performance
    print("\nTesting search performance...")

    test_queries = [
        ("elton", "Elton"),
        ("daniel elton", "Daniel Elton"),
        ("fernandez-serra", "Fernandez-Serra"),
        ("smith", "Smith (common name)"),
    ]

    for query, desc in test_queries:
        start = time.time()
        # FTS5 search - use quotes for phrase search, * for prefix
        fts_query = ' '.join(f'"{word}"*' for word in query.split())
        cursor.execute(f"""
            SELECT p.authorid, p.display_name, p.h_index
            FROM person_fts f
            JOIN person_summary p ON f.authorid = p.authorid
            WHERE person_fts MATCH ?
            ORDER BY p.h_index DESC
            LIMIT 20
        """, (fts_query,))
        results = cursor.fetchall()
        elapsed = time.time() - start
        print(f"  '{query}' ({desc}): {len(results)} results in {elapsed*1000:.1f}ms")
        if results:
            print(f"    Top: {results[0][1]} (h={results[0][2]})")

    conn.close()
    print("\nDone! FTS5 index is ready.")

if __name__ == "__main__":
    main()
