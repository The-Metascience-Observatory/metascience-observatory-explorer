#!/usr/bin/env python3
"""
Add avg_c10 (average citations at 10 years) to person_summary table.

Reads from sciscinet_authors_bq.parquet and updates SQLite in batches.
Memory efficient - uses DuckDB streaming and batch updates.

Usage:
    python add_avg_c10.py
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
    parquet_path = Path("/media/dan/metascience/sciscinet-v2/sciscinet_authors_bq.parquet")
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

    # Check if column already exists
    cursor = sqlite_con.execute("PRAGMA table_info(person_summary)")
    columns = [row[1] for row in cursor.fetchall()]

    if "avg_c10" not in columns:
        print("Adding avg_c10 column to person_summary...")
        sqlite_con.execute("ALTER TABLE person_summary ADD COLUMN avg_c10 REAL")
        sqlite_con.commit()
        print("  Column added")
    else:
        print("avg_c10 column already exists")

    # Connect to DuckDB for reading parquet
    print("\nConnecting to DuckDB...")
    duck_con = duckdb.connect()
    duck_con.execute("SET memory_limit = '500MB'")

    # Count total rows for progress
    print("Counting rows in parquet...")
    total_rows = duck_con.execute(f"""
        SELECT COUNT(*) FROM '{parquet_path}'
    """).fetchone()[0]
    print(f"  {total_rows:,} rows")

    # Process in batches
    batch_size = 100_000
    offset = 0
    updated = 0
    start_time = time.time()

    print(f"\nUpdating person_summary in batches of {batch_size:,}...")

    # Prepare update statement
    update_stmt = sqlite_con.cursor()

    while offset < total_rows:
        # Fetch batch from parquet
        batch = duck_con.execute(f"""
            SELECT authorid, avg_c10
            FROM '{parquet_path}'
            WHERE avg_c10 IS NOT NULL
            LIMIT {batch_size} OFFSET {offset}
        """).fetchall()

        if not batch:
            break

        # Update SQLite in batch
        sqlite_con.executemany(
            "UPDATE person_summary SET avg_c10 = ? WHERE authorid = ?",
            [(row[1], row[0]) for row in batch]
        )
        sqlite_con.commit()

        updated += len(batch)
        offset += batch_size

        # Progress
        elapsed = time.time() - start_time
        rate = updated / elapsed if elapsed > 0 else 0
        eta = (total_rows - offset) / rate if rate > 0 else 0
        print(f"  {offset:,}/{total_rows:,} processed, {updated:,} updated, "
              f"{rate:.0f}/s, ETA: {format_duration(eta)}", end="\r")

    print()
    print(f"\nDone! Updated {updated:,} rows in {format_duration(time.time() - start_time)}")

    # Verify
    print("\nVerifying...")
    result = sqlite_con.execute("""
        SELECT COUNT(*) FROM person_summary WHERE avg_c10 IS NOT NULL
    """).fetchone()[0]
    print(f"  {result:,} authors now have avg_c10 values")

    # Sample
    print("\nSample data:")
    samples = sqlite_con.execute("""
        SELECT authorid, display_name, h_index, avg_c10
        FROM person_summary
        WHERE avg_c10 IS NOT NULL
        ORDER BY avg_c10 DESC
        LIMIT 5
    """).fetchall()
    for row in samples:
        print(f"  {row[1]}: h={row[2]}, avg_c10={row[3]:.1f}")

    sqlite_con.close()
    duck_con.close()


if __name__ == "__main__":
    main()
