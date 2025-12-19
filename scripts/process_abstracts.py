#!/usr/bin/env python3
"""
Process paper abstracts from parquet to SQLite database.

Creates a separate abstracts.db file for lazy-loading abstracts on paper pages.
Uses DuckDB for memory-efficient processing of the 92GB parquet file.

Usage:
    python scripts/process_abstracts.py --data-dir /path/to/sciscinet-v2 --output-dir data
"""

import argparse
import json
import sqlite3
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Process paper abstracts to SQLite")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("/media/dan/metascience/sciscinet-v2"),
        help="Directory containing sciscinet_papertitleabstract.parquet",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data"),
        help="Output directory for abstracts.db",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100000,
        help="Number of rows to process per batch",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing abstracts.db and start fresh",
    )
    return parser.parse_args()


def decode_abstract(inverted_index_json: str) -> str | None:
    """Decode OpenAlex inverted index format to plain text.

    OpenAlex stores abstracts as inverted indexes like:
    {"The": [0], "quick": [1], "brown": [2], "fox": [3]}

    This reconstructs: "The quick brown fox"
    """
    if not inverted_index_json:
        return None

    try:
        idx = json.loads(inverted_index_json)
        if not idx:
            return None

        # Find max position to size the array
        max_pos = max(max(positions) for positions in idx.values())
        words = [''] * (max_pos + 1)

        for word, positions in idx.items():
            for pos in positions:
                words[pos] = word

        return ' '.join(words)
    except (json.JSONDecodeError, ValueError, TypeError):
        return None


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
    parquet_path = args.data_dir / "sciscinet_papertitleabstract.parquet"
    if not parquet_path.exists():
        raise FileNotFoundError(f"Parquet file not found: {parquet_path}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = args.output_dir / "abstracts.db"

    if args.reset and sqlite_path.exists():
        print(f"Deleting existing {sqlite_path}...")
        sqlite_path.unlink()

    # Import DuckDB here to avoid startup cost if args are invalid
    import duckdb

    print(f"Processing abstracts from: {parquet_path}")
    print(f"Output database: {sqlite_path}")
    print(f"Batch size: {args.batch_size:,}")
    print()

    start_time = time.time()

    # Connect to DuckDB (in-memory, we'll stream results)
    con = duckdb.connect(":memory:")

    # Get total row count first
    print("Counting rows...")
    total_rows = con.execute(f"""
        SELECT COUNT(*) FROM read_parquet('{parquet_path}')
    """).fetchone()[0]
    print(f"Total rows: {total_rows:,}")
    print()

    # Create SQLite database and table
    print("Creating SQLite database...")
    sqlite_con = sqlite3.connect(sqlite_path)
    sqlite_con.execute("PRAGMA journal_mode=WAL")
    sqlite_con.execute("PRAGMA synchronous=NORMAL")
    sqlite_con.execute("""
        CREATE TABLE IF NOT EXISTS paper_abstracts (
            paperid TEXT PRIMARY KEY,
            title TEXT,
            abstract TEXT,
            language TEXT
        )
    """)
    sqlite_con.commit()

    # Check if we're resuming
    existing_count = sqlite_con.execute("SELECT COUNT(*) FROM paper_abstracts").fetchone()[0]
    if existing_count > 0:
        print(f"Resuming from {existing_count:,} existing rows...")

    # Process in batches using DuckDB's efficient parquet reading
    processed = existing_count
    inserted = 0
    skipped_no_abstract = 0
    batch_num = 0

    print("Processing abstracts...")

    # Use DuckDB to read parquet in chunks
    # We'll use OFFSET/LIMIT for resumable processing
    while processed < total_rows:
        batch_start = time.time()

        # Read batch from parquet
        rows = con.execute(f"""
            SELECT paperid, title, abstract_inverted_index, language
            FROM read_parquet('{parquet_path}')
            LIMIT {args.batch_size}
            OFFSET {processed}
        """).fetchall()

        if not rows:
            break

        # Process and insert batch
        batch_data = []
        for paperid, title, abstract_idx, language in rows:
            abstract = decode_abstract(abstract_idx)
            if abstract:
                batch_data.append((paperid, title, abstract, language))
            else:
                skipped_no_abstract += 1

        if batch_data:
            sqlite_con.executemany(
                "INSERT OR REPLACE INTO paper_abstracts (paperid, title, abstract, language) VALUES (?, ?, ?, ?)",
                batch_data
            )
            sqlite_con.commit()
            inserted += len(batch_data)

        processed += len(rows)
        batch_num += 1

        # Progress update
        elapsed = time.time() - start_time
        rate = processed / elapsed if elapsed > 0 else 0
        eta = (total_rows - processed) / rate if rate > 0 else 0

        print(f"  Batch {batch_num}: {processed:,}/{total_rows:,} ({100*processed/total_rows:.1f}%) | "
              f"Inserted: {inserted:,} | Skipped: {skipped_no_abstract:,} | "
              f"Rate: {rate:,.0f}/s | ETA: {format_duration(eta)}")

    print()
    print("Creating index...")
    sqlite_con.execute("CREATE INDEX IF NOT EXISTS idx_paper_abstracts_paperid ON paper_abstracts(paperid)")
    sqlite_con.commit()

    # Final stats
    final_count = sqlite_con.execute("SELECT COUNT(*) FROM paper_abstracts").fetchone()[0]
    sqlite_con.close()
    con.close()

    elapsed = time.time() - start_time
    db_size = sqlite_path.stat().st_size / (1024 ** 3)

    print()
    print("=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Total time: {format_duration(elapsed)}")
    print(f"Papers with abstracts: {final_count:,}")
    print(f"Papers without abstracts: {skipped_no_abstract:,}")
    print(f"Database size: {db_size:.2f} GB")
    print(f"Output: {sqlite_path}")


if __name__ == "__main__":
    main()
