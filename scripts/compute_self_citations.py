#!/usr/bin/env python3
"""
Compute self-citation rates for all authors (memory-safe version).

Self-citation rate = (citations to author's papers from author's own papers) / (total citations to author's papers)

This script uses disk-based processing to avoid memory issues:
1. Creates a temp lookup table (paper → authors) in SQLite
2. Streams through citations in batches
3. Writes results directly to SQLite (no in-memory accumulation)

Usage:
    python scripts/compute_self_citations.py [--db-path data/journals.db]
"""

import argparse
import sqlite3
import time
import sys
from pathlib import Path


def log(msg: str):
    """Print timestamped log message."""
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    """Check if a table exists."""
    cursor = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    )
    return cursor.fetchone() is not None


def index_exists(conn: sqlite3.Connection, index_name: str) -> bool:
    """Check if an index exists."""
    cursor = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,)
    )
    return cursor.fetchone() is not None


def get_row_count(conn: sqlite3.Connection, table_name: str) -> int:
    """Get row count for a table."""
    cursor = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cursor.fetchone()[0]


def create_paper_authors_lookup(conn: sqlite3.Connection):
    """
    Create a lookup table mapping paperid -> comma-separated list of authorids.
    This is used for fast lookup during citation processing.
    """
    if table_exists(conn, "temp_paper_to_authors"):
        count = get_row_count(conn, "temp_paper_to_authors")
        log(f"Lookup table temp_paper_to_authors already exists ({count:,} papers)")
        return

    log("Creating paper→authors lookup table from person_publications...")
    log("This may take 30-60 minutes. Do not interrupt.")

    start = time.time()

    # Create the lookup table with GROUP_CONCAT
    conn.execute("""
        CREATE TABLE temp_paper_to_authors AS
        SELECT paperid, GROUP_CONCAT(DISTINCT authorid) as authors
        FROM person_publications
        GROUP BY paperid
    """)
    conn.commit()

    elapsed = time.time() - start
    count = get_row_count(conn, "temp_paper_to_authors")
    log(f"Lookup table created in {elapsed/60:.1f} minutes ({count:,} papers)")

    # Create index
    log("Creating index on lookup table...")
    start = time.time()
    conn.execute("CREATE INDEX idx_temp_paper_authors ON temp_paper_to_authors(paperid)")
    conn.commit()
    elapsed = time.time() - start
    log(f"Index created in {elapsed/60:.1f} minutes")


def create_temp_counts_table(conn: sqlite3.Connection):
    """Create a temporary table to accumulate counts on disk."""
    log("Creating/resetting temp_author_counts table...")
    conn.execute("DROP TABLE IF EXISTS temp_author_counts")
    conn.execute("""
        CREATE TABLE temp_author_counts (
            authorid TEXT PRIMARY KEY,
            self_cites INTEGER DEFAULT 0,
            total_cites INTEGER DEFAULT 0
        )
    """)
    conn.commit()


def create_output_table(conn: sqlite3.Connection):
    """Create the output table if it doesn't exist."""
    conn.execute("DROP TABLE IF EXISTS person_self_citations")
    log("Creating output table person_self_citations...")
    conn.execute("""
        CREATE TABLE person_self_citations (
            authorid TEXT PRIMARY KEY,
            self_citation_count INTEGER NOT NULL,
            total_citation_count INTEGER NOT NULL,
            self_citation_rate REAL
        )
    """)
    conn.commit()


def get_checkpoint_offset(conn: sqlite3.Connection) -> int:
    """Get the last processed offset from checkpoint table."""
    if not table_exists(conn, "temp_self_cite_checkpoint"):
        conn.execute("""
            CREATE TABLE temp_self_cite_checkpoint (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                offset INTEGER NOT NULL
            )
        """)
        conn.execute("INSERT INTO temp_self_cite_checkpoint (id, offset) VALUES (1, 0)")
        conn.commit()
        return 0

    cursor = conn.execute("SELECT offset FROM temp_self_cite_checkpoint WHERE id = 1")
    row = cursor.fetchone()
    return row[0] if row else 0


def save_checkpoint_offset(conn: sqlite3.Connection, offset: int):
    """Save the current offset to checkpoint table."""
    conn.execute("UPDATE temp_self_cite_checkpoint SET offset = ? WHERE id = 1", (offset,))
    conn.commit()


def process_citations(conn: sqlite3.Connection, batch_size: int = 500_000):
    """
    Stream through all citations and accumulate counts in SQLite.

    This version writes to disk instead of keeping counts in memory.
    """
    # Get resume point
    offset = get_checkpoint_offset(conn)

    if offset > 0:
        log(f"Resuming from offset {offset:,}")
    else:
        # Fresh start - create temp counts table
        create_temp_counts_table(conn)

    # Get total citation count for progress
    total_citations = get_row_count(conn, "paper_citations")
    log(f"Processing {total_citations:,} citations...")

    # Cache for paper authors (smaller cache to save memory)
    author_cache = {}
    cache_max_size = 100_000  # ~10MB of cache
    cache_hits = 0
    cache_misses = 0

    def get_authors(paperid: str) -> set:
        nonlocal cache_hits, cache_misses
        if paperid in author_cache:
            cache_hits += 1
            return author_cache[paperid]

        cache_misses += 1
        cursor = conn.execute(
            "SELECT authors FROM temp_paper_to_authors WHERE paperid = ?",
            (paperid,)
        )
        row = cursor.fetchone()
        if row and row[0]:
            authors = set(row[0].split(','))
        else:
            authors = set()

        # Add to cache, evict if too large
        if len(author_cache) >= cache_max_size:
            # Clear entire cache (simpler than LRU)
            author_cache.clear()

        author_cache[paperid] = authors
        return authors

    start_time = time.time()

    # Prepare upsert statement for SQLite
    upsert_sql = """
        INSERT INTO temp_author_counts (authorid, self_cites, total_cites)
        VALUES (?, ?, ?)
        ON CONFLICT(authorid) DO UPDATE SET
            self_cites = self_cites + excluded.self_cites,
            total_cites = total_cites + excluded.total_cites
    """

    while offset < total_citations:
        # Fetch batch of citations
        cursor = conn.execute(
            "SELECT paperid, citing_paperid FROM paper_citations LIMIT ? OFFSET ?",
            (batch_size, offset)
        )
        batch = cursor.fetchall()

        if not batch:
            break

        # Accumulate updates for this batch in memory (small)
        batch_updates = {}  # authorid -> [self_cites, total_cites]

        for paperid, citing_paperid in batch:
            # Get authors of the cited paper
            cited_authors = get_authors(paperid)
            if not cited_authors:
                continue

            # Get authors of the citing paper
            citing_authors = get_authors(citing_paperid)

            # Update counts for each author of the cited paper
            for author in cited_authors:
                if author not in batch_updates:
                    batch_updates[author] = [0, 0]
                batch_updates[author][1] += 1  # total citations
                if author in citing_authors:
                    batch_updates[author][0] += 1  # self-citation

        # Write batch updates to disk
        conn.executemany(upsert_sql, [
            (authorid, counts[0], counts[1])
            for authorid, counts in batch_updates.items()
        ])

        offset += len(batch)

        # Save checkpoint
        save_checkpoint_offset(conn, offset)

        # Progress logging
        elapsed = time.time() - start_time
        rate = (offset - get_checkpoint_offset(conn) + len(batch)) / elapsed if elapsed > 0 else 0
        # Recalculate from start for accurate rate
        rate = offset / elapsed if elapsed > 0 else 0
        remaining = total_citations - offset
        eta_hours = remaining / rate / 3600 if rate > 0 else 0
        cache_rate = cache_hits / (cache_hits + cache_misses) * 100 if (cache_hits + cache_misses) > 0 else 0

        log(f"Processed {offset:,}/{total_citations:,} citations "
            f"({100*offset/total_citations:.1f}%) - "
            f"{rate:,.0f}/sec - ETA: {eta_hours:.1f}h - "
            f"Cache hit: {cache_rate:.1f}%")

    log(f"Citation processing complete.")


def finalize_results(conn: sqlite3.Connection):
    """Copy results from temp table to final table with rate calculation."""
    log("Finalizing results...")

    create_output_table(conn)

    conn.execute("""
        INSERT INTO person_self_citations (authorid, self_citation_count, total_citation_count, self_citation_rate)
        SELECT
            authorid,
            self_cites,
            total_cites,
            CASE WHEN total_cites > 0 THEN CAST(self_cites AS REAL) / total_cites ELSE NULL END
        FROM temp_author_counts
    """)
    conn.commit()

    count = get_row_count(conn, "person_self_citations")
    log(f"Wrote {count:,} author records")

    # Create index
    log("Creating index on person_self_citations...")
    conn.execute("CREATE INDEX idx_person_self_citations_authorid ON person_self_citations(authorid)")
    conn.commit()


def cleanup_temp_tables(conn: sqlite3.Connection):
    """Remove temporary tables."""
    log("Cleaning up temporary tables...")
    conn.execute("DROP TABLE IF EXISTS temp_author_counts")
    conn.execute("DROP TABLE IF EXISTS temp_self_cite_checkpoint")
    # Keep temp_paper_to_authors - it's useful and expensive to recreate
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Compute self-citation rates (memory-safe)")
    parser.add_argument("--db-path", default="data/journals.db", help="Path to journals.db")
    parser.add_argument("--batch-size", type=int, default=500_000, help="Citation batch size")
    parser.add_argument("--clean", action="store_true", help="Start fresh, delete all temp tables")
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    log(f"Opening database: {db_path}")
    conn = sqlite3.connect(str(db_path))

    # Optimize for this workload - but keep memory usage bounded
    conn.execute("PRAGMA cache_size = -500000")  # 500MB cache (reduced from 2GB)
    conn.execute("PRAGMA temp_store = FILE")  # Use disk for temp, not memory
    conn.execute("PRAGMA mmap_size = 4294967296")  # 4GB mmap
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")

    try:
        if args.clean:
            log("Cleaning all temporary tables...")
            conn.execute("DROP TABLE IF EXISTS temp_author_counts")
            conn.execute("DROP TABLE IF EXISTS temp_self_cite_checkpoint")
            conn.execute("DROP TABLE IF EXISTS temp_paper_to_authors")
            conn.commit()

        # Step 1: Create lookup table
        create_paper_authors_lookup(conn)

        # Step 2: Process citations (writes to temp_author_counts)
        process_citations(conn, args.batch_size)

        # Step 3: Finalize results
        finalize_results(conn)

        # Step 4: Clean up
        cleanup_temp_tables(conn)

        log("Done!")

    except KeyboardInterrupt:
        log("Interrupted. Run again to resume from checkpoint.")
        sys.exit(1)
    except Exception as e:
        log(f"Error: {e}")
        log("Run again to resume from checkpoint.")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
