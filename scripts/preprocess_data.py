#!/usr/bin/env python3
"""
Preprocess SciSciNet parquet data into SQLite database and JSON search index.

This script processes ~250M papers and 1.27B paper-field associations to create:
1. journal_search_index.json - For fast client-side search (~5MB)
2. journals.db - SQLite database with pre-computed aggregations (~50-100MB)

Usage:
    pip install -r requirements.txt
    python preprocess_data.py --data-dir /media/dan/metascience/sciscinet-v2 --output-dir ../data

Expected runtime: 1-4 hours depending on hardware (1.27B paperfield rows is the bottleneck)
"""

import argparse
import json
import sqlite3
import gc
from pathlib import Path
from typing import Optional

import polars as pl
from tqdm import tqdm


def parse_args():
    parser = argparse.ArgumentParser(description="Preprocess SciSciNet data for journal dashboard")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("/media/dan/metascience/sciscinet-v2"),
        help="Directory containing parquet files",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent.parent / "data",
        help="Output directory for SQLite and JSON files",
    )
    parser.add_argument(
        "--skip-fields",
        action="store_true",
        help="Skip computing journal-field associations (faster for testing)",
    )
    parser.add_argument(
        "--low-memory",
        action="store_true",
        help="Use low-memory mode with streaming (slower but uses less RAM)",
    )
    return parser.parse_args()


def load_sources(data_dir: Path) -> pl.DataFrame:
    """Load journal/source metadata - small enough to fit in memory."""
    print("Loading sources...")
    sources = pl.read_parquet(data_dir / "sciscinet_sources.parquet")
    print(f"  Loaded {len(sources):,} sources")
    return sources


def load_fields(data_dir: Path) -> pl.DataFrame:
    """Load field metadata - very small (303 rows)."""
    print("Loading fields...")
    fields = pl.read_parquet(data_dir / "sciscinet_fields.parquet")
    print(f"  Loaded {len(fields):,} fields")
    return fields


def compute_yearly_stats_streaming(data_dir: Path, output_dir: Path) -> pl.DataFrame:
    """
    Compute yearly statistics per journal using streaming to minimize memory.
    """
    print("Computing yearly statistics per journal (streaming mode)...")
    print("  This may take 20-60 minutes...")

    db_path = output_dir / "journals.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create temp table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS journal_yearly_stats (
            sourceid TEXT,
            year INTEGER,
            paper_count INTEGER,
            total_citations INTEGER,
            PRIMARY KEY (sourceid, year)
        )
    """)
    conn.commit()

    # Process using polars lazy evaluation
    print("  Processing papersources and papers...")

    yearly_stats = (
        pl.scan_parquet(data_dir / "sciscinet_papersources.parquet")
        .select(["paperid", "sourceid"])
        .join(
            pl.scan_parquet(data_dir / "sciscinet_papers.parquet")
            .select(["paperid", "year", "cited_by_count"]),
            on="paperid",
            how="inner"
        )
        .filter(pl.col("year").is_not_null() & (pl.col("year") > 1800) & (pl.col("year") < 2100))
        .group_by(["sourceid", "year"])
        .agg([
            pl.len().alias("paper_count"),
            pl.col("cited_by_count").sum().alias("total_citations"),
        ])
        .sort(["sourceid", "year"])
        .collect()
    )

    print(f"  Computed stats for {yearly_stats.n_unique('sourceid'):,} journals")
    return yearly_stats


def compute_yearly_stats(data_dir: Path) -> pl.DataFrame:
    """
    Compute yearly statistics per journal by joining papers with papersources.
    """
    print("Computing yearly statistics per journal...")
    print("  This may take 10-30 minutes...")

    yearly_stats = (
        pl.scan_parquet(data_dir / "sciscinet_papersources.parquet")
        .select(["paperid", "sourceid"])
        .join(
            pl.scan_parquet(data_dir / "sciscinet_papers.parquet")
            .select(["paperid", "year", "cited_by_count"]),
            on="paperid",
            how="inner"
        )
        .filter(pl.col("year").is_not_null() & (pl.col("year") > 1800) & (pl.col("year") < 2100))
        .group_by(["sourceid", "year"])
        .agg([
            pl.len().alias("paper_count"),
            pl.col("cited_by_count").sum().alias("total_citations"),
        ])
        .sort(["sourceid", "year"])
        .collect()
    )

    print(f"  Computed stats for {yearly_stats.n_unique('sourceid'):,} journals across {len(yearly_stats):,} journal-year combinations")
    return yearly_stats


def compute_journal_fields(data_dir: Path, fields_df: pl.DataFrame, low_memory: bool = False) -> pl.DataFrame:
    """
    Compute field associations per journal by aggregating through papers.
    """
    print("Computing journal-field associations...")
    print("  This is the slowest step - may take 1-3 hours...")

    journal_fields = (
        pl.scan_parquet(data_dir / "sciscinet_papersources.parquet")
        .select(["paperid", "sourceid"])
        .join(
            pl.scan_parquet(data_dir / "sciscinet_paperfields.parquet")
            .select(["paperid", "fieldid", "score_openalex"]),
            on="paperid",
            how="inner"
        )
        .group_by(["sourceid", "fieldid"])
        .agg([
            pl.len().alias("paper_count"),
            pl.col("score_openalex").sum().alias("score_sum"),
        ])
        .collect()
    )

    # Join with field metadata to get names and levels
    journal_fields = journal_fields.join(
        fields_df.select(["fieldid", "display_name", "level"]),
        on="fieldid",
        how="left",
    ).rename({"display_name": "field_name"})

    print(f"  Computed {len(journal_fields):,} journal-field associations")
    return journal_fields


def compute_journal_summary(
    sources: pl.DataFrame,
    yearly_stats: pl.DataFrame,
    journal_fields: Optional[pl.DataFrame],
) -> pl.DataFrame:
    """
    Create summary table with one row per journal.
    """
    print("Computing journal summary...")

    # Aggregate yearly stats to journal level
    journal_totals = (
        yearly_stats
        .group_by("sourceid")
        .agg([
            pl.col("paper_count").sum().alias("total_papers"),
            pl.col("total_citations").sum().alias("total_citations"),
            pl.col("year").min().alias("first_year"),
            pl.col("year").max().alias("last_year"),
        ])
    )

    # Start with sources and join totals
    summary = sources.join(journal_totals, on="sourceid", how="left")

    # Add primary fields if available
    if journal_fields is not None:
        # Get primary level 0 field (most papers)
        primary_l0 = (
            journal_fields
            .filter(pl.col("level") == 0)
            .sort(["sourceid", "paper_count"], descending=[False, True])
            .group_by("sourceid")
            .first()
            .select([
                "sourceid",
                pl.col("fieldid").alias("primary_field_l0_id"),
                pl.col("field_name").alias("primary_field_l0_name"),
            ])
        )

        # Get primary level 1 field (most papers)
        primary_l1 = (
            journal_fields
            .filter(pl.col("level") == 1)
            .sort(["sourceid", "paper_count"], descending=[False, True])
            .group_by("sourceid")
            .first()
            .select([
                "sourceid",
                pl.col("fieldid").alias("primary_field_l1_id"),
                pl.col("field_name").alias("primary_field_l1_name"),
            ])
        )

        summary = summary.join(primary_l0, on="sourceid", how="left")
        summary = summary.join(primary_l1, on="sourceid", how="left")
    else:
        # Add null columns for fields
        summary = summary.with_columns([
            pl.lit(None).alias("primary_field_l0_id"),
            pl.lit(None).alias("primary_field_l0_name"),
            pl.lit(None).alias("primary_field_l1_id"),
            pl.lit(None).alias("primary_field_l1_name"),
        ])

    print(f"  Created summary for {len(summary):,} journals")
    return summary


def create_search_index(sources: pl.DataFrame, output_dir: Path):
    """Export lightweight JSON for client-side Fuse.js search."""
    print("Creating search index JSON...")

    search_data = sources.select([
        "sourceid",
        "display_name",
        "issn",
        "publisher",
        "is_oa",
    ]).to_dicts()

    output_path = output_dir / "journal_search_index.json"
    with open(output_path, "w") as f:
        json.dump(search_data, f)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"  Written {len(search_data):,} journals to {output_path} ({size_mb:.1f} MB)")


def create_sqlite_db(
    summary: pl.DataFrame,
    yearly_stats: pl.DataFrame,
    journal_fields: Optional[pl.DataFrame],
    output_dir: Path,
):
    """Write aggregated data to SQLite database with indexes."""
    print("Creating SQLite database...")

    db_path = output_dir / "journals.db"

    # Remove existing database
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)

    # Write journal_summary table
    print("  Writing journal_summary table...")
    summary_cols = [
        "sourceid", "display_name", "issn", "publisher", "homepage_url", "is_oa",
        "total_papers", "total_citations", "first_year", "last_year",
        "primary_field_l0_id", "primary_field_l0_name",
        "primary_field_l1_id", "primary_field_l1_name",
    ]
    # Only include columns that exist
    available_cols = [c for c in summary_cols if c in summary.columns]
    summary.select(available_cols).write_database(
        "journal_summary",
        f"sqlite:///{db_path}",
        if_table_exists="replace",
    )

    # Write journal_yearly_stats table
    print("  Writing journal_yearly_stats table...")
    yearly_stats.write_database(
        "journal_yearly_stats",
        f"sqlite:///{db_path}",
        if_table_exists="replace",
    )

    # Write journal_fields table if available
    if journal_fields is not None:
        print("  Writing journal_fields table...")
        journal_fields.write_database(
            "journal_fields",
            f"sqlite:///{db_path}",
            if_table_exists="replace",
        )

    # Create indexes for fast queries
    print("  Creating indexes...")
    cursor = conn.cursor()
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_summary_sourceid ON journal_summary(sourceid)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_yearly_sourceid ON journal_yearly_stats(sourceid)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_yearly_sourceid_year ON journal_yearly_stats(sourceid, year)")
    if journal_fields is not None:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fields_sourceid ON journal_fields(sourceid)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fields_fieldid ON journal_fields(fieldid)")
    conn.commit()
    conn.close()

    size_mb = db_path.stat().st_size / (1024 * 1024)
    print(f"  Database created at {db_path} ({size_mb:.1f} MB)")


def main():
    args = parse_args()

    # Validate data directory
    if not args.data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {args.data_dir}")

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Data directory: {args.data_dir}")
    print(f"Output directory: {args.output_dir}")
    print(f"Low memory mode: {args.low_memory}")
    print()

    # Load small reference data
    sources = load_sources(args.data_dir)
    fields = load_fields(args.data_dir)

    # Create search index first (doesn't need aggregations)
    create_search_index(sources, args.output_dir)

    # Force garbage collection
    gc.collect()

    # Compute aggregations
    if args.low_memory:
        yearly_stats = compute_yearly_stats_streaming(args.data_dir, args.output_dir)
    else:
        yearly_stats = compute_yearly_stats(args.data_dir)

    gc.collect()

    journal_fields = None
    if not args.skip_fields:
        journal_fields = compute_journal_fields(args.data_dir, fields, args.low_memory)
        gc.collect()
    else:
        print("Skipping journal-field computation (--skip-fields)")

    # Create summary
    summary = compute_journal_summary(sources, yearly_stats, journal_fields)

    # Export to SQLite
    create_sqlite_db(summary, yearly_stats, journal_fields, args.output_dir)

    print()
    print("Preprocessing complete!")


if __name__ == "__main__":
    main()
