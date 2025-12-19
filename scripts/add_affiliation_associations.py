#!/usr/bin/env python3
"""
Add affiliation_associations table to SQLite database.

Reads from sciscinet_affl_assoc_affl.parquet and creates a table linking
institutions to their parent/child/related institutions.

Usage:
    python add_affiliation_associations.py
"""

import sqlite3
import time
from pathlib import Path

import duckdb


def format_duration(seconds: float) -> str:
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
    data_dir = Path(__file__).parent.parent / "data"
    parquet_path = Path("/media/dan/metascience/sciscinet-v2/sciscinet_affl_assoc_affl.parquet")
    sqlite_path = data_dir / "journals.db"

    if not parquet_path.exists():
        print(f"Parquet file not found: {parquet_path}")
        return

    if not sqlite_path.exists():
        print(f"SQLite database not found: {sqlite_path}")
        return

    print(f"Parquet: {parquet_path}")
    print(f"SQLite: {sqlite_path}")
    print()

    # Connect to SQLite
    print("Connecting to SQLite...")
    sqlite_con = sqlite3.connect(str(sqlite_path))

    # Check if table already exists
    cursor = sqlite_con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='affiliation_associations'"
    )
    if cursor.fetchone():
        print("affiliation_associations table already exists. Drop it first if you want to recreate.")
        print("  DROP TABLE affiliation_associations;")
        sqlite_con.close()
        return

    # Create table
    print("Creating affiliation_associations table...")
    sqlite_con.execute("""
        CREATE TABLE affiliation_associations (
            institution_id TEXT NOT NULL,
            associated_institution_id TEXT NOT NULL,
            relationship TEXT NOT NULL
        )
    """)
    sqlite_con.commit()
    print("  Table created")

    # Connect to DuckDB for reading parquet
    print("\nConnecting to DuckDB...")
    duck_con = duckdb.connect()
    duck_con.execute("SET memory_limit = '300MB'")
    duck_con.execute("SET threads = 1")

    # Count total rows for progress
    print("Counting rows in parquet...")
    total_rows = duck_con.execute(f"""
        SELECT COUNT(*) FROM '{parquet_path}'
    """).fetchone()[0]
    print(f"  {total_rows:,} rows")

    # Process in batches
    batch_size = 10_000
    offset = 0
    inserted = 0
    start_time = time.time()

    print(f"\nInserting data in batches of {batch_size:,}...")

    while offset < total_rows:
        # Fetch batch from parquet
        batch = duck_con.execute(f"""
            SELECT institution_id, associated_institution_id, relationship
            FROM '{parquet_path}'
            LIMIT {batch_size} OFFSET {offset}
        """).fetchall()

        if not batch:
            break

        # Insert into SQLite
        sqlite_con.executemany(
            "INSERT INTO affiliation_associations (institution_id, associated_institution_id, relationship) VALUES (?, ?, ?)",
            batch
        )
        sqlite_con.commit()

        inserted += len(batch)
        offset += batch_size

        # Progress
        elapsed = time.time() - start_time
        rate = inserted / elapsed if elapsed > 0 else 0
        eta = (total_rows - offset) / rate if rate > 0 else 0
        pct = (offset / total_rows) * 100
        print(f"  {offset:,}/{total_rows:,} ({pct:.1f}%) inserted, "
              f"{rate:.0f}/s, ETA: {format_duration(eta)}", end="\r")

    print()
    print(f"\nInserted {inserted:,} rows in {format_duration(time.time() - start_time)}")

    # Create index on institution_id for fast lookups
    print("\nCreating index on institution_id...")
    index_start = time.time()
    sqlite_con.execute("CREATE INDEX idx_affiliation_associations_institution_id ON affiliation_associations(institution_id)")
    sqlite_con.commit()
    print(f"  Index created in {format_duration(time.time() - index_start)}")

    # Verify
    print("\nVerifying...")
    result = sqlite_con.execute("SELECT COUNT(*) FROM affiliation_associations").fetchone()[0]
    print(f"  {result:,} total associations")

    # Count by relationship type
    print("\nRelationship types:")
    types = sqlite_con.execute("""
        SELECT relationship, COUNT(*) as cnt
        FROM affiliation_associations
        GROUP BY relationship
        ORDER BY cnt DESC
    """).fetchall()
    for rel_type, count in types:
        print(f"  {rel_type}: {count:,}")

    # Sample
    print("\nSample data:")
    samples = sqlite_con.execute("""
        SELECT aa.institution_id, s1.display_name, aa.relationship, aa.associated_institution_id, s2.display_name
        FROM affiliation_associations aa
        LEFT JOIN affiliation_summary s1 ON aa.institution_id = s1.institution_id
        LEFT JOIN affiliation_summary s2 ON aa.associated_institution_id = s2.institution_id
        WHERE s1.display_name IS NOT NULL AND s2.display_name IS NOT NULL
        LIMIT 5
    """).fetchall()
    for row in samples:
        print(f"  {row[1]} ({row[0]})")
        print(f"    -> {row[2]}: {row[4]} ({row[3]})")

    sqlite_con.close()
    duck_con.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
