#!/usr/bin/env python3
"""
Add paper_patents table to SQLite database.

Reads from sciscinet_link_patents.parquet and creates a table linking papers to patents.
Memory efficient - uses DuckDB streaming and batch inserts.

Usage:
    python add_paper_patents.py
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
    parquet_path = Path("/media/dan/metascience/sciscinet-v2/sciscinet_link_patents.parquet")
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name='paper_patents'"
    )
    if cursor.fetchone():
        print("paper_patents table already exists. Drop it first if you want to recreate.")
        print("  DROP TABLE paper_patents;")
        sqlite_con.close()
        return

    # Create table
    print("Creating paper_patents table...")
    sqlite_con.execute("""
        CREATE TABLE paper_patents (
            paperid TEXT NOT NULL,
            patent TEXT NOT NULL,
            is_uspto INTEGER NOT NULL DEFAULT 0
        )
    """)
    sqlite_con.commit()
    print("  Table created")

    # Connect to DuckDB for reading parquet
    print("\nConnecting to DuckDB...")
    duck_con = duckdb.connect()
    duck_con.execute("SET memory_limit = '500MB'")
    duck_con.execute("SET threads = 2")

    # Count total rows for progress
    print("Counting rows in parquet...")
    total_rows = duck_con.execute(f"""
        SELECT COUNT(*) FROM '{parquet_path}'
    """).fetchone()[0]
    print(f"  {total_rows:,} rows")

    # Process in batches
    batch_size = 100_000
    offset = 0
    inserted = 0
    start_time = time.time()

    print(f"\nInserting data in batches of {batch_size:,}...")

    while offset < total_rows:
        # Fetch batch from parquet
        batch = duck_con.execute(f"""
            SELECT paperid, patent, uspto
            FROM '{parquet_path}'
            LIMIT {batch_size} OFFSET {offset}
        """).fetchall()

        if not batch:
            break

        # Insert into SQLite
        sqlite_con.executemany(
            "INSERT INTO paper_patents (paperid, patent, is_uspto) VALUES (?, ?, ?)",
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

    # Create index on paperid for fast lookups
    print("\nCreating index on paperid...")
    index_start = time.time()
    sqlite_con.execute("CREATE INDEX idx_paper_patents_paperid ON paper_patents(paperid)")
    sqlite_con.commit()
    print(f"  Index created in {format_duration(time.time() - index_start)}")

    # Verify
    print("\nVerifying...")
    result = sqlite_con.execute("SELECT COUNT(*) FROM paper_patents").fetchone()[0]
    print(f"  {result:,} total patent links")

    # Count unique papers with patents
    unique_papers = sqlite_con.execute(
        "SELECT COUNT(DISTINCT paperid) FROM paper_patents"
    ).fetchone()[0]
    print(f"  {unique_papers:,} unique papers have patent citations")

    # Count USPTO vs non-USPTO
    uspto_count = sqlite_con.execute(
        "SELECT COUNT(*) FROM paper_patents WHERE is_uspto = 1"
    ).fetchone()[0]
    print(f"  {uspto_count:,} USPTO patents ({100*uspto_count/result:.1f}%)")

    # Sample
    print("\nSample data:")
    samples = sqlite_con.execute("""
        SELECT pp.paperid, ps.title, pp.patent, pp.is_uspto
        FROM paper_patents pp
        LEFT JOIN paper_summary ps ON pp.paperid = ps.paperid
        WHERE ps.title IS NOT NULL
        LIMIT 5
    """).fetchall()
    for row in samples:
        title = row[1][:50] + "..." if row[1] and len(row[1]) > 50 else row[1]
        print(f"  {row[0]}: {title}")
        print(f"    -> Patent: {row[2]} (USPTO: {row[3]})")

    sqlite_con.close()
    duck_con.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
