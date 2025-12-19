#!/usr/bin/env python3
"""
Preprocess SciSciNet parquet data using DuckDB for memory-efficient processing.

DuckDB handles large parquet files with out-of-core processing, making it
suitable for machines with limited RAM.

Usage:
    pip install duckdb
    python preprocess_duckdb.py --data-dir /media/dan/metascience/sciscinet-v2 --output-dir ../data
"""

import argparse
import json
import sqlite3
import time
import threading
import duckdb
import pandas as pd
from pathlib import Path
from tqdm import tqdm


def load_progress(progress_path: Path) -> dict:
    """Load progress from JSON file."""
    if progress_path.exists():
        with open(progress_path) as f:
            return json.load(f)
    return {}


def save_progress(progress_path: Path, progress: dict):
    """Save progress to JSON file."""
    with open(progress_path, "w") as f:
        json.dump(progress, f, indent=2)


def table_exists(con, table_name: str) -> bool:
    """Check if a table exists in DuckDB (not in attached SQLite)."""
    result = con.execute(f"""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = '{table_name}'
        AND table_catalog = 'journals_temp'
    """).fetchone()
    return result[0] > 0


# Global cache for SQLite table names
_sqlite_tables_cache: set | None = None

def load_sqlite_tables_cache(con, force_refresh: bool = False) -> set:
    """Load all SQLite table names into cache (call once after ATTACH)."""
    global _sqlite_tables_cache
    if _sqlite_tables_cache is not None and not force_refresh:
        return _sqlite_tables_cache
    try:
        # Use SHOW TABLES which works with attached SQLite databases in DuckDB
        result = con.execute("SHOW TABLES FROM sqlite_db").fetchall()
        _sqlite_tables_cache = {row[0] for row in result}
        print(f"  Found {len(_sqlite_tables_cache)} existing tables in SQLite")
    except Exception as e:
        print(f"  Warning: Could not list SQLite tables: {e}")
        _sqlite_tables_cache = set()
    return _sqlite_tables_cache

def sqlite_table_exists(con, table_name: str) -> bool:
    """Check if a table exists in the attached SQLite database (uses cache)."""
    global _sqlite_tables_cache
    if _sqlite_tables_cache is None:
        load_sqlite_tables_cache(con)
    return table_name in _sqlite_tables_cache


def drop_table_if_exists(con, table_name: str):
    """Drop a table if it exists."""
    con.execute(f"DROP TABLE IF EXISTS {table_name}")


def run_with_progress(con, sql: str, description: str):
    """Run a SQL query with a tqdm spinner showing elapsed time."""
    result = [None]
    error = [None]
    done = threading.Event()

    def run_query():
        try:
            con.execute(sql)
        except Exception as e:
            error[0] = e
        finally:
            done.set()

    thread = threading.Thread(target=run_query)
    thread.start()

    with tqdm(desc=description, bar_format='{desc}: {elapsed}', leave=True) as pbar:
        while not done.is_set():
            done.wait(timeout=1.0)
            pbar.update(0)  # Just to refresh the elapsed time

    thread.join()
    if error[0]:
        raise error[0]


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


def parse_args():
    parser = argparse.ArgumentParser(description="Preprocess SciSciNet data using DuckDB")
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
        "--skip-authors",
        action="store_true",
        help="Skip computing author tables (faster for testing)",
    )
    parser.add_argument(
        "--skip-affiliations",
        action="store_true",
        help="Skip computing affiliation/institution tables (faster for testing)",
    )
    parser.add_argument(
        "--memory-limit",
        type=str,
        default="16GB",
        help="Memory limit for DuckDB (e.g., '8GB', '16GB')",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=2,
        help="Number of threads for DuckDB (lower = less memory, default=2)",
    )
    parser.add_argument(
        "--temp-dir",
        type=Path,
        default=None,
        help="Directory for DuckDB temp files (use if running out of disk space)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from last checkpoint instead of starting fresh",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Reset progress and start fresh (deletes existing temp files)",
    )
    return parser.parse_args()


def process_journals(con, args, paths):
    """Process journal-related tables."""
    sources_path = paths["sources"]
    papers_path = paths["papers"]
    papersources_path = paths["papersources"]
    fields_path = paths["fields"]
    paperfields_path = paths["paperfields"]

    # Drop existing tables if re-running this step
    for table in ["journal_summary", "journal_yearly_stats", "journal_fields"]:
        drop_table_if_exists(con, table)

    # Step 1: Create search index JSON from sources
    print("Creating journal search index JSON...")
    sources_df = con.execute(f"""
        SELECT sourceid, display_name, issn, publisher, is_oa
        FROM read_parquet('{sources_path}')
    """).fetchdf()

    search_data = sources_df.to_dict(orient='records')
    search_index_path = args.output_dir / "journal_search_index.json"
    with open(search_index_path, "w") as f:
        json.dump(search_data, f)
    print(f"  Written {len(search_data):,} journals to {search_index_path}")

    # Step 2: Create journal_summary table
    print("Creating journal_summary table...")
    con.execute(f"""
        CREATE TABLE journal_summary AS
        SELECT
            sourceid,
            display_name,
            issn,
            publisher,
            homepage_url,
            is_oa,
            NULL::BIGINT as total_papers,
            NULL::BIGINT as total_citations,
            NULL::INTEGER as first_year,
            NULL::INTEGER as last_year,
            NULL::VARCHAR as primary_field_l0_id,
            NULL::VARCHAR as primary_field_l0_name,
            NULL::VARCHAR as primary_field_l1_id,
            NULL::VARCHAR as primary_field_l1_name
        FROM read_parquet('{sources_path}')
    """)
    print(f"  Created journal_summary with {con.execute('SELECT COUNT(*) FROM journal_summary').fetchone()[0]:,} rows")

    # Step 3: Compute yearly statistics
    print("Computing yearly statistics per journal...")
    print("  This may take 10-30 minutes with limited memory...")

    con.execute(f"""
        CREATE TABLE journal_yearly_stats AS
        SELECT
            ps.sourceid,
            p.year,
            COUNT(*) as paper_count,
            COALESCE(SUM(p.cited_by_count), 0) as total_citations
        FROM read_parquet('{papersources_path}') ps
        JOIN read_parquet('{papers_path}') p ON ps.paperid = p.paperid
        WHERE p.year IS NOT NULL AND p.year > 1800 AND p.year < 2100
        GROUP BY ps.sourceid, p.year
        ORDER BY ps.sourceid, p.year
    """)

    stats_count = con.execute("SELECT COUNT(*) FROM journal_yearly_stats").fetchone()[0]
    unique_journals = con.execute("SELECT COUNT(DISTINCT sourceid) FROM journal_yearly_stats").fetchone()[0]
    print(f"  Computed {stats_count:,} yearly stats for {unique_journals:,} journals")

    # Step 4: Update journal_summary with aggregated stats
    print("Updating journal_summary with aggregated statistics...")
    con.execute("""
        UPDATE journal_summary
        SET
            total_papers = stats.total_papers,
            total_citations = stats.total_citations,
            first_year = stats.first_year,
            last_year = stats.last_year
        FROM (
            SELECT
                sourceid,
                SUM(paper_count) as total_papers,
                SUM(total_citations) as total_citations,
                MIN(year) as first_year,
                MAX(year) as last_year
            FROM journal_yearly_stats
            GROUP BY sourceid
        ) stats
        WHERE journal_summary.sourceid = stats.sourceid
    """)

    # Step 5: Compute journal-field associations (optional)
    if not args.skip_fields:
        print("Computing journal-field associations...")
        print("  This is the slowest step - may take 1-3 hours...")

        con.execute(f"""
            CREATE TABLE journal_fields AS
            SELECT
                ps.sourceid,
                pf.fieldid,
                f.display_name as field_name,
                f.level,
                COUNT(*) as paper_count,
                COALESCE(SUM(pf.score_openalex), 0) as score_sum
            FROM read_parquet('{papersources_path}') ps
            JOIN read_parquet('{paperfields_path}') pf ON ps.paperid = pf.paperid
            LEFT JOIN read_parquet('{fields_path}') f ON pf.fieldid = f.fieldid
            GROUP BY ps.sourceid, pf.fieldid, f.display_name, f.level
        """)

        fields_count = con.execute("SELECT COUNT(*) FROM journal_fields").fetchone()[0]
        print(f"  Computed {fields_count:,} journal-field associations")

        # Update journal_summary with primary fields using window functions
        print("Updating journal_summary with primary fields...")

        # Primary level 0 field
        con.execute("""
            UPDATE journal_summary
            SET
                primary_field_l0_id = pf.fieldid,
                primary_field_l0_name = pf.field_name
            FROM (
                SELECT sourceid, fieldid, field_name
                FROM (
                    SELECT sourceid, fieldid, field_name,
                           ROW_NUMBER() OVER (PARTITION BY sourceid ORDER BY paper_count DESC) as rn
                    FROM journal_fields
                    WHERE level = 0
                ) ranked
                WHERE rn = 1
            ) pf
            WHERE journal_summary.sourceid = pf.sourceid
        """)

        # Primary level 1 field
        con.execute("""
            UPDATE journal_summary
            SET
                primary_field_l1_id = pf.fieldid,
                primary_field_l1_name = pf.field_name
            FROM (
                SELECT sourceid, fieldid, field_name
                FROM (
                    SELECT sourceid, fieldid, field_name,
                           ROW_NUMBER() OVER (PARTITION BY sourceid ORDER BY paper_count DESC) as rn
                    FROM journal_fields
                    WHERE level = 1
                ) ranked
                WHERE rn = 1
            ) pf
            WHERE journal_summary.sourceid = pf.sourceid
        """)
    else:
        print("Skipping journal-field computation (--skip-fields)")

    # Note: Indexes are created in SQLite at the end, not in DuckDB
    # DuckDB indexes would be thrown away when we export to SQLite
    print("Journal tables created (indexes will be added to SQLite later)")


def process_authors(con, args, paths):
    """Process author/person-related tables."""
    authors_path = paths["authors"]
    author_details_path = paths["author_details"]
    authors_paperid_path = paths["authors_paperid"]
    paper_author_affiliation_path = paths["paper_author_affiliation"]
    affiliations_path = paths["affiliations"]
    papers_path = paths["papers"]
    paperdetails_path = paths["paperdetails"]
    papersources_path = paths["papersources"]
    sources_path = paths["sources"]
    link_nih_path = paths["link_nih"]
    nih_metadata_path = paths["nih_metadata"]
    link_nsf_path = paths["link_nsf"]
    nsf_metadata_path = paths["nsf_metadata"]
    link_twitter_path = paths["link_twitter"]
    twitter_metadata_path = paths["twitter_metadata"]

    # Drop existing tables if re-running this step
    for table in ["person_summary", "person_yearly_stats", "person_affiliations",
                  "person_funding", "person_twitter", "person_publications"]:
        drop_table_if_exists(con, table)

    # Step 1: Create author search index JSON
    print("Creating author search index JSON...")
    # Only include authors with at least some publications for search
    authors_df = con.execute(f"""
        SELECT
            a.authorid,
            a.display_name,
            ad.orcid,
            a.h_index,
            a.productivity,
            ad.last_known_institution
        FROM read_parquet('{authors_path}') a
        LEFT JOIN read_parquet('{author_details_path}') ad ON a.authorid = ad.authorid
        WHERE a.productivity >= 1
        ORDER BY a.h_index DESC NULLS LAST
        LIMIT 5000000
    """).fetchdf()

    # Convert to list of dicts, handling NaN/NA values
    search_data = []
    for _, row in authors_df.iterrows():
        search_data.append({
            "authorid": row["authorid"],
            "display_name": row["display_name"],
            "orcid": row["orcid"] if pd.notna(row["orcid"]) else None,
            "h_index": int(row["h_index"]) if pd.notna(row["h_index"]) else None,
            "productivity": int(row["productivity"]) if pd.notna(row["productivity"]) else None,
            "last_known_institution": row["last_known_institution"] if pd.notna(row["last_known_institution"]) else None,
        })

    search_index_path = args.output_dir / "author_search_index.json"
    with open(search_index_path, "w") as f:
        json.dump(search_data, f)
    print(f"  Written {len(search_data):,} authors to {search_index_path}")

    # Step 2: Create person_summary table
    print("Creating person_summary table...")
    con.execute(f"""
        CREATE TABLE person_summary AS
        SELECT
            a.authorid,
            a.display_name,
            ad.display_name_alternatives,
            ad.orcid,
            a.h_index,
            a.productivity,
            ad.cited_by_count,
            ad.works_count,
            ad.last_known_institution,
            NULL::INTEGER as first_year,
            NULL::INTEGER as last_year
        FROM read_parquet('{authors_path}') a
        LEFT JOIN read_parquet('{author_details_path}') ad ON a.authorid = ad.authorid
    """)
    print(f"  Created person_summary with {con.execute('SELECT COUNT(*) FROM person_summary').fetchone()[0]:,} rows")

    # Step 3: Compute yearly statistics per author
    print("Computing yearly statistics per author...")
    print("  This may take 30-60 minutes...")

    con.execute(f"""
        CREATE TABLE person_yearly_stats AS
        SELECT
            ap.authorid,
            p.year,
            COUNT(*) as paper_count,
            COALESCE(SUM(p.cited_by_count), 0) as total_citations
        FROM read_parquet('{authors_paperid_path}') ap
        JOIN read_parquet('{papers_path}') p ON ap.paperid = p.paperid
        WHERE p.year IS NOT NULL AND p.year > 1800 AND p.year < 2100
        GROUP BY ap.authorid, p.year
        ORDER BY ap.authorid, p.year
    """)

    stats_count = con.execute("SELECT COUNT(*) FROM person_yearly_stats").fetchone()[0]
    unique_authors = con.execute("SELECT COUNT(DISTINCT authorid) FROM person_yearly_stats").fetchone()[0]
    print(f"  Computed {stats_count:,} yearly stats for {unique_authors:,} authors")

    # Update person_summary with first/last year
    print("Updating person_summary with year range...")
    con.execute("""
        UPDATE person_summary
        SET
            first_year = stats.first_year,
            last_year = stats.last_year
        FROM (
            SELECT
                authorid,
                MIN(year) as first_year,
                MAX(year) as last_year
            FROM person_yearly_stats
            GROUP BY authorid
        ) stats
        WHERE person_summary.authorid = stats.authorid
    """)

    # Step 4: Compute author affiliations
    print("Computing author affiliations...")
    con.execute(f"""
        CREATE TABLE person_affiliations AS
        SELECT
            paa.authorid,
            paa.institutionid,
            aff.display_name as institution_name,
            aff.country_code,
            COUNT(*) as paper_count,
            MIN(p.year) as first_year,
            MAX(p.year) as last_year
        FROM read_parquet('{paper_author_affiliation_path}') paa
        JOIN read_parquet('{papers_path}') p ON paa.paperid = p.paperid
        LEFT JOIN read_parquet('{affiliations_path}') aff ON paa.institutionid = aff.institution_id
        WHERE paa.institutionid IS NOT NULL
        GROUP BY paa.authorid, paa.institutionid, aff.display_name, aff.country_code
    """)

    aff_count = con.execute("SELECT COUNT(*) FROM person_affiliations").fetchone()[0]
    print(f"  Computed {aff_count:,} author-affiliation associations")

    # Step 5: Compute author funding (NIH + NSF)
    print("Computing author funding...")
    con.execute(f"""
        CREATE TABLE person_funding AS
        SELECT
            ap.authorid,
            nm.funder_display_name as funder_name,
            ln.award_id,
            COUNT(DISTINCT ap.paperid) as paper_count
        FROM read_parquet('{authors_paperid_path}') ap
        JOIN read_parquet('{link_nih_path}') ln ON ap.paperid = ln.paperid
        LEFT JOIN read_parquet('{nih_metadata_path}') nm ON ap.paperid = nm.paperid
        GROUP BY ap.authorid, nm.funder_display_name, ln.award_id

        UNION ALL

        SELECT
            ap.authorid,
            nm.funder_display_name as funder_name,
            ln.award_id,
            COUNT(DISTINCT ap.paperid) as paper_count
        FROM read_parquet('{authors_paperid_path}') ap
        JOIN read_parquet('{link_nsf_path}') ln ON ap.paperid = ln.paperid
        LEFT JOIN read_parquet('{nsf_metadata_path}') nm ON ap.paperid = nm.paperid
        GROUP BY ap.authorid, nm.funder_display_name, ln.award_id
    """)

    funding_count = con.execute("SELECT COUNT(*) FROM person_funding").fetchone()[0]
    print(f"  Computed {funding_count:,} author-funding associations")

    # Step 6: Compute author twitter stats
    print("Computing author twitter stats...")
    con.execute(f"""
        CREATE TABLE person_twitter AS
        SELECT
            ap.authorid,
            COUNT(DISTINCT lt.tweet_id) as tweet_count,
            MIN(tm.occurred_time) as first_tweet_date,
            MAX(tm.occurred_time) as last_tweet_date
        FROM read_parquet('{authors_paperid_path}') ap
        JOIN read_parquet('{link_twitter_path}') lt ON ap.paperid = lt.paperid
        LEFT JOIN read_parquet('{twitter_metadata_path}') tm ON lt.tweet_id = tm.tweet_id
        GROUP BY ap.authorid
        HAVING COUNT(DISTINCT lt.tweet_id) > 0
    """)

    twitter_count = con.execute("SELECT COUNT(*) FROM person_twitter").fetchone()[0]
    print(f"  Computed twitter stats for {twitter_count:,} authors")

    # Step 6b: Create individual tweets table (25 most recent per author)
    print("Creating individual tweets table...")
    con.execute(f"""
        CREATE TABLE person_tweets AS
        WITH ranked_tweets AS (
            SELECT
                ap.authorid,
                lt.tweet_id,
                tm.occurred_time,
                tm.original_tweet_url,
                tm.doi,
                ROW_NUMBER() OVER (PARTITION BY ap.authorid ORDER BY tm.occurred_time DESC) as rn
            FROM read_parquet('{authors_paperid_path}') ap
            JOIN read_parquet('{link_twitter_path}') lt ON ap.paperid = lt.paperid
            LEFT JOIN read_parquet('{twitter_metadata_path}') tm ON lt.tweet_id = tm.tweet_id
            WHERE tm.original_tweet_url IS NOT NULL
        )
        SELECT authorid, tweet_id, occurred_time, original_tweet_url, doi
        FROM ranked_tweets
        WHERE rn <= 25
    """)

    tweets_count = con.execute("SELECT COUNT(*) FROM person_tweets").fetchone()[0]
    print(f"  Created individual tweets table with {tweets_count:,} rows")

    # Step 7: Create author publications lookup table (recent only for performance)
    # Use DISTINCT to avoid duplicates from multiple affiliations per paper
    print("Creating author publications lookup...")
    con.execute(f"""
        CREATE TABLE person_publications AS
        SELECT DISTINCT
            ap.authorid,
            ap.paperid,
            pd.title,
            p.year,
            p.cited_by_count,
            paa.author_position,
            ps.sourceid,
            s.display_name as source_name
        FROM read_parquet('{authors_paperid_path}') ap
        JOIN read_parquet('{papers_path}') p ON ap.paperid = p.paperid
        LEFT JOIN read_parquet('{paperdetails_path}') pd ON ap.paperid = pd.paperid
        LEFT JOIN read_parquet('{paper_author_affiliation_path}') paa
            ON ap.paperid = paa.paperid AND ap.authorid = paa.authorid
        LEFT JOIN read_parquet('{papersources_path}') ps ON ap.paperid = ps.paperid
        LEFT JOIN read_parquet('{sources_path}') s ON ps.sourceid = s.sourceid
    """)

    pub_count = con.execute("SELECT COUNT(*) FROM person_publications").fetchone()[0]
    print(f"  Created publications table with {pub_count:,} rows")

    # Note: Indexes are created in SQLite at the end, not in DuckDB
    # DuckDB indexes would be thrown away when we export to SQLite
    print("Author tables created (indexes will be added to SQLite later)")


def process_affiliations(con, args, paths, progress, progress_path):
    """Process affiliation/institution-related tables."""
    affiliations_path = paths["affiliations"]
    paper_author_affiliation_path = paths["paper_author_affiliation"]
    papers_path = paths["papers"]
    authors_path = paths["authors"]

    # Step 1: Create affiliation search index JSON
    if not progress.get("affiliation_search_index_done"):
        print("Creating affiliation search index JSON...")
        affiliations_df = con.execute(f"""
            SELECT
                institution_id,
                display_name,
                country_code,
                type,
                h_index,
                productivity
            FROM read_parquet('{affiliations_path}')
            WHERE display_name IS NOT NULL
            ORDER BY h_index DESC NULLS LAST
        """).fetchdf()

        # Convert to list of dicts, handling NaN/NA values
        search_data = []
        for _, row in affiliations_df.iterrows():
            search_data.append({
                "institution_id": row["institution_id"],
                "display_name": row["display_name"],
                "country_code": row["country_code"] if pd.notna(row["country_code"]) else None,
                "type": row["type"] if pd.notna(row["type"]) else None,
                "h_index": int(row["h_index"]) if pd.notna(row["h_index"]) else None,
                "productivity": int(row["productivity"]) if pd.notna(row["productivity"]) else None,
            })

        search_index_path = args.output_dir / "affiliation_search_index.json"
        with open(search_index_path, "w") as f:
            json.dump(search_data, f)
        print(f"  Written {len(search_data):,} affiliations to {search_index_path}")
        progress["affiliation_search_index_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating affiliation search index JSON (skipping - already done)")

    # Step 2: Create affiliation_summary table
    if not progress.get("affiliation_summary_done"):
        drop_table_if_exists(con, "affiliation_summary")
        print("Creating affiliation_summary table...")
        con.execute(f"""
            CREATE TABLE affiliation_summary AS
            SELECT
                institution_id,
                display_name,
                country_code,
                type,
                ror,
                homepage_url,
                h_index,
                productivity,
                NULL::BIGINT as total_citations,
                NULL::BIGINT as researcher_count,
                NULL::INTEGER as first_year,
                NULL::INTEGER as last_year
            FROM read_parquet('{affiliations_path}')
        """)
        print(f"  Created affiliation_summary with {con.execute('SELECT COUNT(*) FROM affiliation_summary').fetchone()[0]:,} rows")
        progress["affiliation_summary_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating affiliation_summary table (skipping - already done)")

    # Step 3: Compute yearly statistics per affiliation (DISABLED - data not accurate)
    # The yearly stats aggregate by institution but don't account for author mobility,
    # leading to inflated/inaccurate numbers
    print("Computing yearly statistics per affiliation (DISABLED - data not accurate)")

    # Step 4: Update affiliation_summary with aggregated stats
    if not progress.get("affiliation_summary_updated_done"):
        run_with_progress(con, f"""
            UPDATE affiliation_summary
            SET
                total_citations = stats.total_citations,
                researcher_count = stats.researcher_count,
                first_year = stats.first_year,
                last_year = stats.last_year
            FROM (
                SELECT
                    paa.institutionid as institution_id,
                    SUM(p.cited_by_count) as total_citations,
                    COUNT(DISTINCT paa.authorid) as researcher_count,
                    MIN(p.year) as first_year,
                    MAX(p.year) as last_year
                FROM read_parquet('{paper_author_affiliation_path}') paa
                JOIN read_parquet('{papers_path}') p ON paa.paperid = p.paperid
                WHERE p.year IS NOT NULL AND p.year > 1800 AND p.year < 2100
                GROUP BY paa.institutionid
            ) stats
            WHERE affiliation_summary.institution_id = stats.institution_id
        """, "Updating affiliation_summary with aggregated stats")
        progress["affiliation_summary_updated_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Updating affiliation_summary with aggregated statistics (skipping - already done)")

    # Step 5: Compute top researchers per affiliation
    if not progress.get("affiliation_researchers_done"):
        drop_table_if_exists(con, "affiliation_researchers")
        run_with_progress(con, f"""
            CREATE TABLE affiliation_researchers AS
            SELECT
                institution_id,
                authorid,
                display_name,
                h_index,
                paper_count,
                first_year,
                last_year
            FROM (
                SELECT
                    paa.institutionid as institution_id,
                    paa.authorid,
                    a.display_name,
                    a.h_index,
                    COUNT(DISTINCT paa.paperid) as paper_count,
                    MIN(p.year) as first_year,
                    MAX(p.year) as last_year,
                    ROW_NUMBER() OVER (PARTITION BY paa.institutionid ORDER BY a.h_index DESC NULLS LAST) as rn
                FROM read_parquet('{paper_author_affiliation_path}') paa
                JOIN read_parquet('{papers_path}') p ON paa.paperid = p.paperid
                LEFT JOIN read_parquet('{authors_path}') a ON paa.authorid = a.authorid
                WHERE p.year IS NOT NULL AND p.year > 1800 AND p.year < 2100
                GROUP BY paa.institutionid, paa.authorid, a.display_name, a.h_index
            ) ranked
            WHERE rn <= 50
        """, "Computing top researchers per affiliation")

        researchers_count = con.execute("SELECT COUNT(*) FROM affiliation_researchers").fetchone()[0]
        print(f"  Computed top researchers for affiliations ({researchers_count:,} rows)")
        progress["affiliation_researchers_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Computing top researchers per affiliation (skipping - already done)")

    # Step 6: Compute top collaborating institutions
    if not progress.get("affiliation_collaborators_done"):
        drop_table_if_exists(con, "affiliation_collaborators")
        run_with_progress(con, f"""
            CREATE TABLE affiliation_collaborators AS
            SELECT
                institution_id,
                collaborator_id,
                display_name,
                country_code,
                joint_papers
            FROM (
                SELECT
                    paa1.institutionid as institution_id,
                    paa2.institutionid as collaborator_id,
                    a.display_name,
                    a.country_code,
                    COUNT(DISTINCT paa1.paperid) as joint_papers,
                    ROW_NUMBER() OVER (PARTITION BY paa1.institutionid ORDER BY COUNT(DISTINCT paa1.paperid) DESC) as rn
                FROM read_parquet('{paper_author_affiliation_path}') paa1
                JOIN read_parquet('{paper_author_affiliation_path}') paa2
                    ON paa1.paperid = paa2.paperid AND paa1.institutionid != paa2.institutionid
                LEFT JOIN read_parquet('{affiliations_path}') a ON paa2.institutionid = a.institution_id
                WHERE paa1.institutionid IS NOT NULL AND paa2.institutionid IS NOT NULL
                GROUP BY paa1.institutionid, paa2.institutionid, a.display_name, a.country_code
            ) ranked
            WHERE rn <= 20
        """, "Computing top collaborating institutions")

        collaborators_count = con.execute("SELECT COUNT(*) FROM affiliation_collaborators").fetchone()[0]
        print(f"  Computed top collaborators for affiliations ({collaborators_count:,} rows)")
        progress["affiliation_collaborators_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Computing top collaborating institutions (skipping - already done)")

    # Note: Indexes are created in SQLite at the end, not in DuckDB
    # DuckDB indexes would be thrown away when we export to SQLite
    print("Affiliation tables created (indexes will be added to SQLite later)")


def process_papers(con, args, paths, progress, progress_path):
    """Process paper-related tables for paper detail pages and citation graph."""
    papers_path = paths["papers"]
    paperdetails_path = paths["paperdetails"]
    papersources_path = paths["papersources"]
    sources_path = paths["sources"]
    paperfields_path = paths["paperfields"]
    fields_path = paths["fields"]
    paper_author_affiliation_path = paths["paper_author_affiliation"]
    authors_path = paths["authors"]
    affiliations_path = paths["affiliations"]
    paperrefs_path = paths["paperrefs"]

    # Step 1: Create journal_publications table (papers per journal)
    if not progress.get("journal_publications_done"):
        drop_table_if_exists(con, "journal_publications")
        print("Creating journal_publications table...")
        run_with_progress(con, f"""
            CREATE TABLE journal_publications AS
            SELECT DISTINCT
                ps.sourceid,
                ps.paperid,
                pd.title,
                p.year,
                p.cited_by_count
            FROM read_parquet('{papersources_path}') ps
            JOIN read_parquet('{papers_path}') p ON ps.paperid = p.paperid
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON ps.paperid = pd.paperid
        """, "Creating journal_publications table")
        count = con.execute("SELECT COUNT(*) FROM journal_publications").fetchone()[0]
        print(f"  Created journal_publications with {count:,} rows")
        progress["journal_publications_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating journal_publications table (skipping - already done)")

    # Step 2: Create journal_field_papers table (papers per journal+field)
    if not progress.get("journal_field_papers_done"):
        drop_table_if_exists(con, "journal_field_papers")
        print("Creating journal_field_papers table...")
        print("  This may take a while due to paperfields join...")
        run_with_progress(con, f"""
            CREATE TABLE journal_field_papers AS
            SELECT
                ps.sourceid,
                pf.fieldid,
                ps.paperid,
                pd.title,
                p.year,
                p.cited_by_count,
                pf.score_openalex as field_score
            FROM read_parquet('{papersources_path}') ps
            JOIN read_parquet('{papers_path}') p ON ps.paperid = p.paperid
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON ps.paperid = pd.paperid
            JOIN read_parquet('{paperfields_path}') pf ON ps.paperid = pf.paperid
        """, "Creating journal_field_papers table")
        count = con.execute("SELECT COUNT(*) FROM journal_field_papers").fetchone()[0]
        print(f"  Created journal_field_papers with {count:,} rows")
        progress["journal_field_papers_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating journal_field_papers table (skipping - already done)")

    # Step 3: Create paper_summary table (for paper detail pages)
    if not progress.get("paper_summary_done"):
        drop_table_if_exists(con, "paper_summary")
        print("Creating paper_summary table...")
        run_with_progress(con, f"""
            CREATE TABLE paper_summary AS
            SELECT
                p.paperid,
                pd.title,
                pd.doi,
                p.year,
                p.cited_by_count,
                ps.sourceid,
                s.display_name as source_name
            FROM read_parquet('{papers_path}') p
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON p.paperid = pd.paperid
            LEFT JOIN read_parquet('{papersources_path}') ps ON p.paperid = ps.paperid
            LEFT JOIN read_parquet('{sources_path}') s ON ps.sourceid = s.sourceid
        """, "Creating paper_summary table")
        count = con.execute("SELECT COUNT(*) FROM paper_summary").fetchone()[0]
        print(f"  Created paper_summary with {count:,} rows")
        progress["paper_summary_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_summary table (skipping - already done)")

    # Step 4: Create paper_authors table
    if not progress.get("paper_authors_done"):
        drop_table_if_exists(con, "paper_authors")
        print("Creating paper_authors table...")
        run_with_progress(con, f"""
            CREATE TABLE paper_authors AS
            SELECT
                paa.paperid,
                paa.authorid,
                a.display_name,
                paa.author_position,
                paa.institutionid,
                aff.display_name as institution_name
            FROM read_parquet('{paper_author_affiliation_path}') paa
            LEFT JOIN read_parquet('{authors_path}') a ON paa.authorid = a.authorid
            LEFT JOIN read_parquet('{affiliations_path}') aff ON paa.institutionid = aff.institution_id
        """, "Creating paper_authors table")
        count = con.execute("SELECT COUNT(*) FROM paper_authors").fetchone()[0]
        print(f"  Created paper_authors with {count:,} rows")
        progress["paper_authors_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_authors table (skipping - already done)")

    # Step 5: Create paper_fields table
    if not progress.get("paper_fields_done"):
        drop_table_if_exists(con, "paper_fields")
        print("Creating paper_fields table...")
        run_with_progress(con, f"""
            CREATE TABLE paper_fields AS
            SELECT
                pf.paperid,
                pf.fieldid,
                f.display_name as field_name,
                f.level,
                pf.score_openalex
            FROM read_parquet('{paperfields_path}') pf
            JOIN read_parquet('{fields_path}') f ON pf.fieldid = f.fieldid
        """, "Creating paper_fields table")
        count = con.execute("SELECT COUNT(*) FROM paper_fields").fetchone()[0]
        print(f"  Created paper_fields with {count:,} rows")
        progress["paper_fields_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_fields table (skipping - already done)")

    # Step 6: Create paper_references table (papers this paper cites)
    if not progress.get("paper_references_done"):
        drop_table_if_exists(con, "paper_references")
        print("Creating paper_references table (papers cited by each paper)...")
        print("  This will process 2.5B citation relationships...")
        run_with_progress(con, f"""
            CREATE TABLE paper_references AS
            SELECT
                pr.citing_paperid as paperid,
                pr.cited_paperid as ref_paperid,
                pd.title as ref_title,
                p.year as ref_year,
                p.cited_by_count as ref_cited_by_count
            FROM read_parquet('{paperrefs_path}') pr
            JOIN read_parquet('{papers_path}') p ON pr.cited_paperid = p.paperid
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON pr.cited_paperid = pd.paperid
        """, "Creating paper_references table")
        count = con.execute("SELECT COUNT(*) FROM paper_references").fetchone()[0]
        print(f"  Created paper_references with {count:,} rows")
        progress["paper_references_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_references table (skipping - already done)")

    # Step 7: Create paper_citations table (papers that cite this paper)
    if not progress.get("paper_citations_done"):
        drop_table_if_exists(con, "paper_citations")
        print("Creating paper_citations table (papers citing each paper)...")
        print("  This will process 2.5B citation relationships...")
        run_with_progress(con, f"""
            CREATE TABLE paper_citations AS
            SELECT
                pr.cited_paperid as paperid,
                pr.citing_paperid as citing_paperid,
                pd.title as citing_title,
                p.year as citing_year,
                p.cited_by_count as citing_cited_by_count
            FROM read_parquet('{paperrefs_path}') pr
            JOIN read_parquet('{papers_path}') p ON pr.citing_paperid = p.paperid
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON pr.citing_paperid = pd.paperid
        """, "Creating paper_citations table")
        count = con.execute("SELECT COUNT(*) FROM paper_citations").fetchone()[0]
        print(f"  Created paper_citations with {count:,} rows")
        progress["paper_citations_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_citations table (skipping - already done)")

    # Step 8: Create paper_citation_history table (citations per year for each paper)
    if not progress.get("paper_citation_history_done"):
        drop_table_if_exists(con, "paper_citation_history")
        print("Creating paper_citation_history table (citations by year)...")
        print("  Aggregating citation counts by year from paper_citations...")

        # Check if paper_citations exists
        if table_exists(con, "paper_citations"):
            run_with_progress(con, """
                CREATE TABLE paper_citation_history AS
                SELECT
                    paperid,
                    citing_year as year,
                    COUNT(*) as citation_count
                FROM paper_citations
                WHERE citing_year IS NOT NULL
                GROUP BY paperid, citing_year
                ORDER BY paperid, citing_year
            """, "Creating paper_citation_history table")
            count = con.execute("SELECT COUNT(*) FROM paper_citation_history").fetchone()[0]
            print(f"  Created paper_citation_history with {count:,} rows")
        else:
            print("  Skipping - paper_citations table not found")
        progress["paper_citation_history_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_citation_history table (skipping - already done)")

    print("Paper tables created (indexes will be added to SQLite later)")


def process_fields(con, args, paths, progress, progress_path):
    """Process field/discipline-related tables for field detail pages."""
    fields_path = paths["fields"]
    paperfields_path = paths["paperfields"]
    papers_path = paths["papers"]
    paperdetails_path = paths["paperdetails"]
    papersources_path = paths["papersources"]
    sources_path = paths["sources"]
    authors_paperid_path = paths["authors_paperid"]
    authors_path = paths["authors"]

    # Step 1: Create field list JSON for home page display
    if not progress.get("field_list_json_done"):
        print("Creating field list JSON...")
        fields_df = con.execute(f"""
            SELECT
                fieldid,
                display_name,
                level
            FROM read_parquet('{fields_path}')
            ORDER BY level, display_name
        """).fetchdf()

        field_list = []
        for _, row in fields_df.iterrows():
            field_list.append({
                "fieldid": row["fieldid"],
                "display_name": row["display_name"],
                "level": int(row["level"]),
            })

        field_list_path = args.output_dir / "field_list.json"
        with open(field_list_path, "w") as f:
            json.dump(field_list, f)
        print(f"  Written {len(field_list):,} fields to {field_list_path}")
        progress["field_list_json_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating field list JSON (skipping - already done)")

    # Step 2: Create field_summary table with aggregated stats
    if not progress.get("field_summary_done"):
        drop_table_if_exists(con, "field_summary")
        print("Creating field_summary table with paper/citation counts...")
        print("  This may take 30-60 minutes due to paperfields join...")

        run_with_progress(con, f"""
            CREATE TABLE field_summary AS
            SELECT
                f.fieldid,
                f.display_name,
                f.level,
                COALESCE(stats.paper_count, 0) as paper_count,
                COALESCE(stats.total_citations, 0) as total_citations
            FROM read_parquet('{fields_path}') f
            LEFT JOIN (
                SELECT
                    pf.fieldid,
                    COUNT(DISTINCT pf.paperid) as paper_count,
                    SUM(p.cited_by_count) as total_citations
                FROM read_parquet('{paperfields_path}') pf
                JOIN read_parquet('{papers_path}') p ON pf.paperid = p.paperid
                GROUP BY pf.fieldid
            ) stats ON f.fieldid = stats.fieldid
        """, "Creating field_summary table")
        print(f"  Created field_summary with {con.execute('SELECT COUNT(*) FROM field_summary').fetchone()[0]:,} rows")
        progress["field_summary_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating field_summary table (skipping - already done)")

    # Step 3: Compute top 50 most-cited papers per field
    # DISABLED: This query is too memory-intensive (OOM with 26GB)
    # TODO: Re-enable when we have a more memory-efficient approach
    # if not progress.get("field_top_papers_done"):
    #     drop_table_if_exists(con, "field_top_papers")
    #     print("Computing top papers per field...")
    #     print("  This is a slow operation...")
    #
    #     run_with_progress(con, f"""
    #         CREATE TABLE field_top_papers AS
    #         SELECT
    #             fieldid,
    #             paperid,
    #             title,
    #             year,
    #             cited_by_count,
    #             source_name
    #         FROM (
    #             SELECT
    #                 pf.fieldid,
    #                 pf.paperid,
    #                 pd.title,
    #                 p.year,
    #                 p.cited_by_count,
    #                 s.display_name as source_name,
    #                 ROW_NUMBER() OVER (PARTITION BY pf.fieldid ORDER BY p.cited_by_count DESC NULLS LAST) as rn
    #             FROM read_parquet('{paperfields_path}') pf
    #             JOIN read_parquet('{papers_path}') p ON pf.paperid = p.paperid
    #             LEFT JOIN read_parquet('{paperdetails_path}') pd ON pf.paperid = pd.paperid
    #             LEFT JOIN read_parquet('{papersources_path}') ps ON pf.paperid = ps.paperid
    #             LEFT JOIN read_parquet('{sources_path}') s ON ps.sourceid = s.sourceid
    #             WHERE p.cited_by_count > 0
    #         ) ranked
    #         WHERE rn <= 50
    #     """, "Computing top papers per field")
    #
    #     papers_count = con.execute("SELECT COUNT(*) FROM field_top_papers").fetchone()[0]
    #     print(f"  Computed top papers for fields ({papers_count:,} rows)")
    #     progress["field_top_papers_done"] = True
    #     save_progress(progress_path, progress)
    # else:
    #     print("Computing top papers per field (skipping - already done)")
    print("Computing top papers per field (DISABLED - too memory intensive)")

    # Step 4: Compute top 50 authors per field by paper count
    # DISABLED: This query is too memory-intensive (OOM with 26GB)
    # TODO: Re-enable when we have a more memory-efficient approach
    # if not progress.get("field_top_authors_done"):
    #     drop_table_if_exists(con, "field_top_authors")
    #     print("Computing top authors per field...")
    #     print("  This is a slow operation...")
    #
    #     run_with_progress(con, f"""
    #         CREATE TABLE field_top_authors AS
    #         SELECT
    #             fieldid,
    #             authorid,
    #             display_name,
    #             h_index,
    #             paper_count
    #         FROM (
    #             SELECT
    #                 pf.fieldid,
    #                 ap.authorid,
    #                 a.display_name,
    #                 a.h_index,
    #                 COUNT(DISTINCT pf.paperid) as paper_count,
    #                 ROW_NUMBER() OVER (PARTITION BY pf.fieldid ORDER BY COUNT(DISTINCT pf.paperid) DESC) as rn
    #             FROM read_parquet('{paperfields_path}') pf
    #             JOIN read_parquet('{authors_paperid_path}') ap ON pf.paperid = ap.paperid
    #             LEFT JOIN read_parquet('{authors_path}') a ON ap.authorid = a.authorid
    #             GROUP BY pf.fieldid, ap.authorid, a.display_name, a.h_index
    #         ) ranked
    #         WHERE rn <= 50
    #     """, "Computing top authors per field")
    #
    #     authors_count = con.execute("SELECT COUNT(*) FROM field_top_authors").fetchone()[0]
    #     print(f"  Computed top authors for fields ({authors_count:,} rows)")
    #     progress["field_top_authors_done"] = True
    #     save_progress(progress_path, progress)
    # else:
    #     print("Computing top authors per field (skipping - already done)")
    print("Computing top authors per field (DISABLED - too memory intensive)")

    # Note: Indexes are created in SQLite at the end, not in DuckDB
    # DuckDB indexes would be thrown away when we export to SQLite
    print("Field tables created (indexes will be added to SQLite later)")


def process_field_top_cited_papers(con, args, paths, progress, progress_path):
    """
    Process top-cited papers per field using pre-computed normalized citation scores.
    This uses the normalized_citations parquet files which are much more memory-efficient
    than computing from scratch via paperfields joins.
    """
    normalized_level0_path = paths["normalized_citations_level0"]
    normalized_level1_path = paths["normalized_citations_level1"]
    paperdetails_path = paths["paperdetails"]
    papersources_path = paths["papersources"]
    sources_path = paths["sources"]

    # Check if normalized citations files exist
    if not normalized_level0_path.exists():
        print(f"  Skipping - {normalized_level0_path} not found")
        return
    if not normalized_level1_path.exists():
        print(f"  Skipping - {normalized_level1_path} not found")
        return

    # Step 1: Create top papers for level 0 fields (broad fields like "Computer Science")
    if not progress.get("field_top_cited_papers_level0_done"):
        drop_table_if_exists(con, "field_top_cited_papers_level0")
        print("Creating field_top_cited_papers_level0 (top 20 papers per broad field)...")

        run_with_progress(con, f"""
            CREATE TABLE field_top_cited_papers_level0 AS
            WITH ranked AS (
                SELECT
                    nc.fieldid,
                    nc.paperid,
                    nc.year,
                    nc.citation_count,
                    nc.normalized_citations,
                    ROW_NUMBER() OVER (PARTITION BY nc.fieldid ORDER BY nc.normalized_citations DESC) as rn
                FROM read_parquet('{normalized_level0_path}') nc
                WHERE nc.normalized_citations > 0
            )
            SELECT
                r.fieldid,
                r.paperid,
                pd.title,
                r.year,
                CAST(r.citation_count AS BIGINT) as citation_count,
                r.normalized_citations,
                s.display_name as source_name
            FROM ranked r
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON r.paperid = pd.paperid
            LEFT JOIN read_parquet('{papersources_path}') ps ON r.paperid = ps.paperid
            LEFT JOIN read_parquet('{sources_path}') s ON ps.sourceid = s.sourceid
            WHERE r.rn <= 20
        """, "Creating field_top_cited_papers_level0")

        count = con.execute("SELECT COUNT(*) FROM field_top_cited_papers_level0").fetchone()[0]
        print(f"  Created field_top_cited_papers_level0 with {count:,} rows")
        progress["field_top_cited_papers_level0_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating field_top_cited_papers_level0 (skipping - already done)")

    # Step 2: Create top papers for level 1 fields (narrower subfields)
    if not progress.get("field_top_cited_papers_level1_done"):
        drop_table_if_exists(con, "field_top_cited_papers_level1")
        print("Creating field_top_cited_papers_level1 (top 20 papers per subfield)...")

        run_with_progress(con, f"""
            CREATE TABLE field_top_cited_papers_level1 AS
            WITH ranked AS (
                SELECT
                    nc.fieldid,
                    nc.paperid,
                    nc.year,
                    nc.citation_count,
                    nc.normalized_citations,
                    ROW_NUMBER() OVER (PARTITION BY nc.fieldid ORDER BY nc.normalized_citations DESC) as rn
                FROM read_parquet('{normalized_level1_path}') nc
                WHERE nc.normalized_citations > 0
            )
            SELECT
                r.fieldid,
                r.paperid,
                pd.title,
                r.year,
                CAST(r.citation_count AS BIGINT) as citation_count,
                r.normalized_citations,
                s.display_name as source_name
            FROM ranked r
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON r.paperid = pd.paperid
            LEFT JOIN read_parquet('{papersources_path}') ps ON r.paperid = ps.paperid
            LEFT JOIN read_parquet('{sources_path}') s ON ps.sourceid = s.sourceid
            WHERE r.rn <= 20
        """, "Creating field_top_cited_papers_level1")

        count = con.execute("SELECT COUNT(*) FROM field_top_cited_papers_level1").fetchone()[0]
        print(f"  Created field_top_cited_papers_level1 with {count:,} rows")
        progress["field_top_cited_papers_level1_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating field_top_cited_papers_level1 (skipping - already done)")

    print("Field top cited papers tables created")


def process_funders(con, args, paths, progress, progress_path):
    """Process funder-related tables for funder detail pages."""
    funders_path = paths["funders"]

    # Step 1: Create funder search index JSON
    if not progress.get("funder_search_index_done"):
        print("Creating funder search index JSON...")
        funders_df = con.execute(f"""
            SELECT
                id as funderid,
                display_name,
                country_code,
                works_count,
                cited_by_count,
                summary_stats.h_index as h_index
            FROM read_parquet('{funders_path}')
            WHERE display_name IS NOT NULL
            ORDER BY cited_by_count DESC NULLS LAST
        """).fetchdf()

        # Convert to list of dicts, handling NaN/NA values
        search_data = []
        for _, row in funders_df.iterrows():
            # Extract funder ID from OpenAlex URL (e.g., "https://openalex.org/F4320321001" -> "F4320321001")
            funderid = row["funderid"]
            if funderid and funderid.startswith("https://openalex.org/"):
                funderid = funderid.replace("https://openalex.org/", "")
            search_data.append({
                "funderid": funderid,
                "display_name": row["display_name"],
                "country_code": row["country_code"] if pd.notna(row["country_code"]) else None,
                "works_count": int(row["works_count"]) if pd.notna(row["works_count"]) else None,
                "cited_by_count": int(row["cited_by_count"]) if pd.notna(row["cited_by_count"]) else None,
                "h_index": int(row["h_index"]) if pd.notna(row["h_index"]) else None,
            })

        search_index_path = args.output_dir / "funder_search_index.json"
        with open(search_index_path, "w") as f:
            json.dump(search_data, f)
        print(f"  Written {len(search_data):,} funders to {search_index_path}")
        progress["funder_search_index_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating funder search index JSON (skipping - already done)")

    # Step 2: Create funder_summary table
    if not progress.get("funder_summary_done"):
        drop_table_if_exists(con, "funder_summary")
        print("Creating funder_summary table...")
        con.execute(f"""
            CREATE TABLE funder_summary AS
            SELECT
                REPLACE(id, 'https://openalex.org/', '') as funderid,
                display_name,
                country_code,
                description,
                homepage_url,
                grants_count,
                works_count,
                cited_by_count,
                summary_stats.h_index as h_index,
                summary_stats.i10_index as i10_index,
                summary_stats.oa_percent as oa_percent
            FROM read_parquet('{funders_path}')
        """)
        count = con.execute("SELECT COUNT(*) FROM funder_summary").fetchone()[0]
        print(f"  Created funder_summary with {count:,} rows")
        progress["funder_summary_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating funder_summary table (skipping - already done)")

    # Step 3: Create funder_yearly_stats table from counts_by_year JSON array
    if not progress.get("funder_yearly_stats_done"):
        drop_table_if_exists(con, "funder_yearly_stats")
        print("Creating funder_yearly_stats table...")
        con.execute(f"""
            CREATE TABLE funder_yearly_stats AS
            SELECT
                REPLACE(f.id, 'https://openalex.org/', '') as funderid,
                u.unnest.year::INTEGER as year,
                u.unnest.works_count::BIGINT as works_count,
                u.unnest.cited_by_count::BIGINT as cited_by_count
            FROM read_parquet('{funders_path}') f,
            LATERAL UNNEST(f.counts_by_year) as u
            WHERE u.unnest.year IS NOT NULL
            ORDER BY funderid, year
        """)
        count = con.execute("SELECT COUNT(*) FROM funder_yearly_stats").fetchone()[0]
        print(f"  Created funder_yearly_stats with {count:,} rows")
        progress["funder_yearly_stats_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating funder_yearly_stats table (skipping - already done)")

    # Step 4: Create funder_concepts table from x_concepts JSON array
    if not progress.get("funder_concepts_done"):
        drop_table_if_exists(con, "funder_concepts")
        print("Creating funder_concepts table...")
        con.execute(f"""
            CREATE TABLE funder_concepts AS
            SELECT
                REPLACE(f.id, 'https://openalex.org/', '') as funderid,
                REPLACE(u.unnest.id, 'https://openalex.org/', '') as fieldid,
                u.unnest.display_name as field_name,
                u.unnest.level::INTEGER as level,
                u.unnest.score::DOUBLE as score
            FROM read_parquet('{funders_path}') f,
            LATERAL UNNEST(f.x_concepts) as u
            WHERE u.unnest.id IS NOT NULL
            ORDER BY funderid, score DESC
        """)
        count = con.execute("SELECT COUNT(*) FROM funder_concepts").fetchone()[0]
        print(f"  Created funder_concepts with {count:,} rows")
        progress["funder_concepts_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating funder_concepts table (skipping - already done)")

    print("Funder tables created (indexes will be added to SQLite later)")


def process_clinical_trials(con, args, paths, progress, progress_path):
    """Process clinical trial-related tables for trial detail pages."""
    link_clinicaltrials_path = paths["link_clinicaltrials"]
    clinicaltrials_metadata_path = paths["clinicaltrials_metadata"]
    papers_path = paths["papers"]
    paperdetails_path = paths["paperdetails"]
    authors_paperid_path = paths["authors_paperid"]

    # Step 1: Create trial_summary table (aggregate stats per trial)
    if not progress.get("trial_summary_done"):
        drop_table_if_exists(con, "trial_summary")
        print("Creating trial_summary table...")
        run_with_progress(con, f"""
            CREATE TABLE trial_summary AS
            SELECT
                lt.nct_id,
                COUNT(DISTINCT lt.paperid) as paper_count,
                COUNT(DISTINCT CASE WHEN cm.reference_type = 'RESULT' THEN lt.paperid END) as result_paper_count,
                COUNT(DISTINCT CASE WHEN cm.reference_type = 'DERIVED' THEN lt.paperid END) as derived_paper_count,
                COUNT(DISTINCT CASE WHEN cm.reference_type = 'BACKGROUND' THEN lt.paperid END) as background_paper_count,
                SUM(p.cited_by_count) as total_citations,
                MIN(p.year) as first_year,
                MAX(p.year) as last_year
            FROM read_parquet('{link_clinicaltrials_path}') lt
            LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
                ON lt.paperid = cm.paperid AND lt.nct_id = cm.nct_id
            LEFT JOIN read_parquet('{papers_path}') p ON lt.paperid = p.paperid
            GROUP BY lt.nct_id
        """, "Creating trial_summary table")
        count = con.execute("SELECT COUNT(*) FROM trial_summary").fetchone()[0]
        print(f"  Created trial_summary with {count:,} rows")
        progress["trial_summary_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating trial_summary table (skipping - already done)")

    # Step 2: Create trial_papers table (papers linked to each trial)
    if not progress.get("trial_papers_done"):
        drop_table_if_exists(con, "trial_papers")
        print("Creating trial_papers table...")
        run_with_progress(con, f"""
            CREATE TABLE trial_papers AS
            SELECT DISTINCT
                lt.nct_id,
                lt.paperid,
                pd.title,
                p.year,
                p.cited_by_count,
                cm.reference_type
            FROM read_parquet('{link_clinicaltrials_path}') lt
            LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
                ON lt.paperid = cm.paperid AND lt.nct_id = cm.nct_id
            LEFT JOIN read_parquet('{papers_path}') p ON lt.paperid = p.paperid
            LEFT JOIN read_parquet('{paperdetails_path}') pd ON lt.paperid = pd.paperid
        """, "Creating trial_papers table")
        count = con.execute("SELECT COUNT(*) FROM trial_papers").fetchone()[0]
        print(f"  Created trial_papers with {count:,} rows")
        progress["trial_papers_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating trial_papers table (skipping - already done)")

    # Step 3: Create paper_trials table (trials linked to each paper, for paper detail page)
    if not progress.get("paper_trials_done"):
        drop_table_if_exists(con, "paper_trials")
        print("Creating paper_trials table...")
        run_with_progress(con, f"""
            CREATE TABLE paper_trials AS
            SELECT DISTINCT
                lt.paperid,
                lt.nct_id,
                cm.reference_type
            FROM read_parquet('{link_clinicaltrials_path}') lt
            LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
                ON lt.paperid = cm.paperid AND lt.nct_id = cm.nct_id
        """, "Creating paper_trials table")
        count = con.execute("SELECT COUNT(*) FROM paper_trials").fetchone()[0]
        print(f"  Created paper_trials with {count:,} rows")
        progress["paper_trials_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating paper_trials table (skipping - already done)")

    # Step 4: Create person_trials table (trials linked to authors via their papers)
    if not progress.get("person_trials_done"):
        drop_table_if_exists(con, "person_trials")
        print("Creating person_trials table...")
        run_with_progress(con, f"""
            CREATE TABLE person_trials AS
            SELECT
                ap.authorid,
                lt.nct_id,
                COUNT(DISTINCT lt.paperid) as paper_count
            FROM read_parquet('{authors_paperid_path}') ap
            JOIN read_parquet('{link_clinicaltrials_path}') lt ON ap.paperid = lt.paperid
            GROUP BY ap.authorid, lt.nct_id
        """, "Creating person_trials table")
        count = con.execute("SELECT COUNT(*) FROM person_trials").fetchone()[0]
        print(f"  Created person_trials with {count:,} rows")
        progress["person_trials_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating person_trials table (skipping - already done)")

    print("Clinical trial tables created (indexes will be added to SQLite later)")


def process_impact_factors(con, args, paths, progress, progress_path, sqlite_path):
    """Compute journal impact factors (2-yr IF, 5-yr IF, CiteScore) for all journals.

    This is a standalone step that can run after papers are processed.
    It requires: journal_publications, paper_citations, journal_yearly_stats tables.
    These may exist in DuckDB (if just processed) or in SQLite (from previous run).
    """
    if not progress.get("journal_impact_factors_done"):
        drop_table_if_exists(con, "journal_impact_factors")
        print("Creating journal_impact_factors table...")
        print("  This computes 2-year IF, 5-year IF, and CiteScore for all journals...")
        print("  Requires joining journal_publications with paper_citations (may take 30-90 min)...")

        # Check if required tables exist in DuckDB first
        tables_in_duckdb = (
            table_exists(con, "journal_publications") and
            table_exists(con, "paper_citations") and
            table_exists(con, "journal_yearly_stats")
        )

        # If not in DuckDB, check SQLite and attach if needed
        use_sqlite = False
        if not tables_in_duckdb:
            print("  Tables not in DuckDB, checking SQLite...")
            # Install and load SQLite extension if needed
            con.execute("INSTALL sqlite; LOAD sqlite;")

            # Check if SQLite DB exists
            if sqlite_path.exists():
                # Attach SQLite to check for tables
                con.execute(f"ATTACH '{sqlite_path}' AS sqlite_db (TYPE SQLITE)")
                load_sqlite_tables_cache(con, force_refresh=True)

                if (sqlite_table_exists(con, "journal_publications") and
                    sqlite_table_exists(con, "paper_citations") and
                    sqlite_table_exists(con, "journal_yearly_stats")):
                    print("  Found required tables in SQLite, will read from there")
                    use_sqlite = True
                else:
                    print("  Required tables not found in SQLite either")
                    con.execute("DETACH sqlite_db")
            else:
                print(f"  SQLite database not found at {sqlite_path}")

        # Determine table prefix based on source
        prefix = "sqlite_db." if use_sqlite else ""

        if tables_in_duckdb or use_sqlite:
            run_with_progress(con, f"""
                CREATE TABLE journal_impact_factors AS
                WITH paper_years AS (
                    -- Get publication year for each paper in each journal
                    SELECT sourceid, paperid, year as pub_year
                    FROM {prefix}journal_publications
                    WHERE year IS NOT NULL
                ),
                citation_counts AS (
                    -- Count citations by citing year and paper publication year
                    SELECT
                        py.sourceid,
                        pc.citing_year as cite_year,
                        py.pub_year,
                        COUNT(*) as citation_count
                    FROM paper_years py
                    JOIN {prefix}paper_citations pc ON py.paperid = pc.paperid
                    WHERE pc.citing_year IS NOT NULL
                    GROUP BY py.sourceid, pc.citing_year, py.pub_year
                ),
                aggregated AS (
                    SELECT
                        sourceid,
                        cite_year as year,
                        -- 2-year IF window: papers from Y-1 and Y-2
                        SUM(CASE WHEN cite_year - pub_year BETWEEN 1 AND 2
                            THEN citation_count ELSE 0 END) as citations_2yr,
                        -- 5-year IF window: papers from Y-1 to Y-5
                        SUM(CASE WHEN cite_year - pub_year BETWEEN 1 AND 5
                            THEN citation_count ELSE 0 END) as citations_5yr,
                        -- CiteScore window: papers from Y to Y-3 (includes current year)
                        SUM(CASE WHEN cite_year - pub_year BETWEEN 0 AND 3
                            THEN citation_count ELSE 0 END) as citations_citescore
                    FROM citation_counts
                    GROUP BY sourceid, cite_year
                ),
                paper_windows AS (
                    -- Compute paper counts for 2-year, 5-year, and CiteScore windows
                    SELECT
                        j1.sourceid,
                        j1.year as target_year,
                        -- 2-year: Y-1 and Y-2
                        COALESCE(j2.paper_count, 0) + COALESCE(j3.paper_count, 0) as papers_2yr,
                        -- 5-year: Y-1 to Y-5
                        COALESCE(j2.paper_count, 0) + COALESCE(j3.paper_count, 0) +
                        COALESCE(j4.paper_count, 0) + COALESCE(j5.paper_count, 0) +
                        COALESCE(j6.paper_count, 0) as papers_5yr,
                        -- CiteScore: Y to Y-3
                        COALESCE(j1.paper_count, 0) + COALESCE(j2.paper_count, 0) +
                        COALESCE(j3.paper_count, 0) + COALESCE(j4.paper_count, 0) as papers_citescore
                    FROM {prefix}journal_yearly_stats j1
                    LEFT JOIN {prefix}journal_yearly_stats j2
                        ON j1.sourceid = j2.sourceid AND j1.year - 1 = j2.year
                    LEFT JOIN {prefix}journal_yearly_stats j3
                        ON j1.sourceid = j3.sourceid AND j1.year - 2 = j3.year
                    LEFT JOIN {prefix}journal_yearly_stats j4
                        ON j1.sourceid = j4.sourceid AND j1.year - 3 = j4.year
                    LEFT JOIN {prefix}journal_yearly_stats j5
                        ON j1.sourceid = j5.sourceid AND j1.year - 4 = j5.year
                    LEFT JOIN {prefix}journal_yearly_stats j6
                        ON j1.sourceid = j6.sourceid AND j1.year - 5 = j6.year
                )
                SELECT
                    a.sourceid,
                    a.year,
                    a.citations_2yr,
                    pw.papers_2yr,
                    CASE WHEN pw.papers_2yr > 0
                         THEN ROUND(a.citations_2yr * 1.0 / pw.papers_2yr, 3)
                         ELSE NULL END as impact_factor_2yr,
                    a.citations_5yr,
                    pw.papers_5yr,
                    CASE WHEN pw.papers_5yr > 0
                         THEN ROUND(a.citations_5yr * 1.0 / pw.papers_5yr, 3)
                         ELSE NULL END as impact_factor_5yr,
                    a.citations_citescore,
                    pw.papers_citescore,
                    CASE WHEN pw.papers_citescore > 0
                         THEN ROUND(a.citations_citescore * 1.0 / pw.papers_citescore, 3)
                         ELSE NULL END as citescore
                FROM aggregated a
                JOIN paper_windows pw ON a.sourceid = pw.sourceid AND a.year = pw.target_year
                ORDER BY a.sourceid, a.year
            """, "Creating journal_impact_factors table")
            count = con.execute("SELECT COUNT(*) FROM journal_impact_factors").fetchone()[0]
            unique_journals = con.execute("SELECT COUNT(DISTINCT sourceid) FROM journal_impact_factors").fetchone()[0]
            print(f"  Created journal_impact_factors with {count:,} rows for {unique_journals:,} journals")

            # If we read from SQLite, export the result back to SQLite now
            if use_sqlite:
                print("  Exporting journal_impact_factors to SQLite...")
                con.execute("DROP TABLE IF EXISTS sqlite_db.journal_impact_factors")
                con.execute("CREATE TABLE sqlite_db.journal_impact_factors AS SELECT * FROM journal_impact_factors")
                print("  Creating index on journal_impact_factors...")
                # Note: SQLite index syntax requires table prefix but not index name prefix
                con.execute("CREATE INDEX idx_journal_impact_factors_sourceid ON sqlite_db.journal_impact_factors(sourceid)")
                con.execute("DETACH sqlite_db")
                print("  Done exporting to SQLite")
        else:
            print("  Skipping - required tables (journal_publications, paper_citations, journal_yearly_stats) not found")
        progress["journal_impact_factors_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating journal_impact_factors table (skipping - already done)")


def main():
    args = parse_args()
    total_start = time.time()

    # Validate data directory
    if not args.data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {args.data_dir}")

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Setup paths
    temp_db_path = args.output_dir / "journals_temp.duckdb"
    sqlite_path = args.output_dir / "journals.db"
    progress_path = args.output_dir / "preprocess_progress.json"

    # Handle --reset flag
    if args.reset:
        print("Resetting progress and starting fresh...")
        if temp_db_path.exists():
            temp_db_path.unlink()
        if sqlite_path.exists():
            sqlite_path.unlink()
        if progress_path.exists():
            progress_path.unlink()

    # Load progress for resume capability
    progress = load_progress(progress_path) if args.resume else {}

    if args.resume and progress:
        print(f"Resuming from checkpoint. Completed steps: {list(progress.keys())}")
    elif args.resume:
        print("No previous progress found, starting fresh.")

    print(f"Data directory: {args.data_dir}")
    print(f"Output directory: {args.output_dir}")
    print(f"Memory limit: {args.memory_limit}")
    print(f"Threads: {args.threads}")
    if args.temp_dir:
        print(f"Temp directory: {args.temp_dir}")
    print()

    # Initialize DuckDB with memory limit
    # If resuming, don't delete existing temp DB
    if not args.resume and temp_db_path.exists():
        temp_db_path.unlink()
    if not args.resume and sqlite_path.exists():
        sqlite_path.unlink()

    con = duckdb.connect(str(temp_db_path))
    con.execute(f"SET memory_limit = '{args.memory_limit}'")
    con.execute(f"SET threads = {args.threads}")  # Lower threads = less memory pressure
    con.execute("SET preserve_insertion_order = false")  # Reduces memory usage
    if args.temp_dir:
        args.temp_dir.mkdir(parents=True, exist_ok=True)
        con.execute(f"SET temp_directory = '{args.temp_dir}'")

    # Define all parquet paths
    paths = {
        "sources": args.data_dir / "sciscinet_sources.parquet",
        "papers": args.data_dir / "sciscinet_papers.parquet",
        "paperdetails": args.data_dir / "sciscinet_paperdetails.parquet",
        "papersources": args.data_dir / "sciscinet_papersources.parquet",
        "fields": args.data_dir / "sciscinet_fields.parquet",
        "paperfields": args.data_dir / "sciscinet_paperfields.parquet",
        "authors": args.data_dir / "sciscinet_authors.parquet",
        "author_details": args.data_dir / "sciscinet_author_details.parquet",
        "authors_paperid": args.data_dir / "sciscinet_authors_paperid.parquet",
        "paper_author_affiliation": args.data_dir / "sciscinet_paper_author_affiliation.parquet",
        "affiliations": args.data_dir / "sciscinet_affiliations.parquet",
        "link_nih": args.data_dir / "sciscinet_link_nih.parquet",
        "nih_metadata": args.data_dir / "sciscinet_nih_metadata.parquet",
        "link_nsf": args.data_dir / "sciscinet_link_nsf.parquet",
        "nsf_metadata": args.data_dir / "sciscinet_nsf_metadata.parquet",
        "link_twitter": args.data_dir / "sciscinet_link_twitter.parquet",
        "twitter_metadata": args.data_dir / "sciscinet_twitter_metadata.parquet",
        "paperrefs": args.data_dir / "sciscinet_paperrefs.parquet",
        "funders": args.data_dir / "funders.parquet",
        "link_clinicaltrials": args.data_dir / "sciscinet_link_clinicaltrials.parquet",
        "clinicaltrials_metadata": args.data_dir / "sciscinet_clinicaltrials_metadata.parquet",
        "normalized_citations_level0": args.data_dir / "normalized_citations_level0.parquet",
        "normalized_citations_level1": args.data_dir / "normalized_citations_level1.parquet",
    }

    # Process journals
    if not progress.get("journals_done"):
        print("=" * 60)
        print("PROCESSING JOURNALS")
        print("=" * 60)
        step_start = time.time()
        process_journals(con, args, paths)
        print(f"  Journals completed in {format_duration(time.time() - step_start)}")
        progress["journals_done"] = True
        save_progress(progress_path, progress)
    else:
        print("=" * 60)
        print("PROCESSING JOURNALS (skipping - already done)")
        print("=" * 60)

    # Process authors
    if not args.skip_authors:
        if not progress.get("authors_done"):
            print()
            print("=" * 60)
            print("PROCESSING AUTHORS")
            print("=" * 60)
            step_start = time.time()
            process_authors(con, args, paths)
            print(f"  Authors completed in {format_duration(time.time() - step_start)}")
            progress["authors_done"] = True
            save_progress(progress_path, progress)
        else:
            print()
            print("=" * 60)
            print("PROCESSING AUTHORS (skipping - already done)")
            print("=" * 60)
    else:
        print("\nSkipping author computation (--skip-authors)")

    # Process affiliations
    if not args.skip_affiliations:
        if not progress.get("affiliations_done"):
            print()
            print("=" * 60)
            print("PROCESSING AFFILIATIONS")
            print("=" * 60)
            step_start = time.time()
            process_affiliations(con, args, paths, progress, progress_path)
            print(f"  Affiliations completed in {format_duration(time.time() - step_start)}")
            progress["affiliations_done"] = True
            save_progress(progress_path, progress)
        else:
            print()
            print("=" * 60)
            print("PROCESSING AFFILIATIONS (skipping - already done)")
            print("=" * 60)
    else:
        print("\nSkipping affiliation computation (--skip-affiliations)")

    # Process papers (for paper detail pages and citation graph)
    if not progress.get("papers_done"):
        print()
        print("=" * 60)
        print("PROCESSING PAPERS")
        print("=" * 60)
        step_start = time.time()
        process_papers(con, args, paths, progress, progress_path)
        print(f"  Papers completed in {format_duration(time.time() - step_start)}")
        progress["papers_done"] = True
        save_progress(progress_path, progress)
    else:
        print()
        print("=" * 60)
        print("PROCESSING PAPERS (skipping - already done)")
        print("=" * 60)

    # Process fields (for field detail pages)
    if not args.skip_fields:
        if not progress.get("fields_done"):
            print()
            print("=" * 60)
            print("PROCESSING FIELDS")
            print("=" * 60)
            step_start = time.time()
            process_fields(con, args, paths, progress, progress_path)
            print(f"  Fields completed in {format_duration(time.time() - step_start)}")
            progress["fields_done"] = True
            save_progress(progress_path, progress)
        else:
            print()
            print("=" * 60)
            print("PROCESSING FIELDS (skipping - already done)")
            print("=" * 60)
    else:
        print("\nSkipping field computation (--skip-fields)")

    # Process field top cited papers (using normalized citations parquet files)
    if not args.skip_fields:
        if not progress.get("field_top_cited_papers_done"):
            print()
            print("=" * 60)
            print("PROCESSING FIELD TOP CITED PAPERS")
            print("=" * 60)
            step_start = time.time()
            process_field_top_cited_papers(con, args, paths, progress, progress_path)
            print(f"  Field top cited papers completed in {format_duration(time.time() - step_start)}")
            progress["field_top_cited_papers_done"] = True
            save_progress(progress_path, progress)
        else:
            print()
            print("=" * 60)
            print("PROCESSING FIELD TOP CITED PAPERS (skipping - already done)")
            print("=" * 60)

    # Process funders
    if not progress.get("funders_done"):
        print()
        print("=" * 60)
        print("PROCESSING FUNDERS")
        print("=" * 60)
        step_start = time.time()
        process_funders(con, args, paths, progress, progress_path)
        print(f"  Funders completed in {format_duration(time.time() - step_start)}")
        progress["funders_done"] = True
        save_progress(progress_path, progress)
    else:
        print()
        print("=" * 60)
        print("PROCESSING FUNDERS (skipping - already done)")
        print("=" * 60)

    # Process clinical trials
    if not progress.get("clinical_trials_done"):
        print()
        print("=" * 60)
        print("PROCESSING CLINICAL TRIALS")
        print("=" * 60)
        step_start = time.time()
        process_clinical_trials(con, args, paths, progress, progress_path)
        print(f"  Clinical trials completed in {format_duration(time.time() - step_start)}")
        progress["clinical_trials_done"] = True
        save_progress(progress_path, progress)
    else:
        print()
        print("=" * 60)
        print("PROCESSING CLINICAL TRIALS (skipping - already done)")
        print("=" * 60)

    # Process journal impact factors (standalone step, runs after papers are done)
    if not progress.get("journal_impact_factors_done"):
        print()
        print("=" * 60)
        print("PROCESSING JOURNAL IMPACT FACTORS")
        print("=" * 60)
        step_start = time.time()
        process_impact_factors(con, args, paths, progress, progress_path, sqlite_path)
        print(f"  Impact factors completed in {format_duration(time.time() - step_start)}")
    else:
        print()
        print("=" * 60)
        print("PROCESSING JOURNAL IMPACT FACTORS (skipping - already done)")
        print("=" * 60)

    # Export to SQLite format (the web app uses better-sqlite3 which requires SQLite format)
    if not progress.get("sqlite_export_done"):
        print()
        print("=" * 60)
        print("EXPORTING TO SQLITE")
        print("=" * 60)
        step_start = time.time()

        # Note: We no longer delete the SQLite DB on rerun.
        # Instead, we check if each table already exists and skip it.
        # This allows adding new tables without re-exporting everything.

        print("Installing SQLite extension...")
        con.execute("INSTALL sqlite; LOAD sqlite;")

        print(f"Attaching SQLite database at {sqlite_path}...")
        con.execute(f"ATTACH '{sqlite_path}' AS sqlite_db (TYPE SQLITE)")

        # Load all existing table names into cache for fast skip checks
        load_sqlite_tables_cache(con)

        # Export journal tables
        if table_exists(con, "journal_summary"):
            if not sqlite_table_exists(con, "journal_summary"):
                print("Exporting journal_summary...")
                con.execute("CREATE TABLE sqlite_db.journal_summary AS SELECT * FROM journal_summary")
            else:
                print("Exporting journal_summary (skipping - already in SQLite)")
        if table_exists(con, "journal_yearly_stats"):
            if not sqlite_table_exists(con, "journal_yearly_stats"):
                print("Exporting journal_yearly_stats...")
                con.execute("CREATE TABLE sqlite_db.journal_yearly_stats AS SELECT * FROM journal_yearly_stats")
            else:
                print("Exporting journal_yearly_stats (skipping - already in SQLite)")

        if table_exists(con, "journal_impact_factors"):
            if not sqlite_table_exists(con, "journal_impact_factors"):
                print("Exporting journal_impact_factors...")
                con.execute("CREATE TABLE sqlite_db.journal_impact_factors AS SELECT * FROM journal_impact_factors")
            else:
                print("Exporting journal_impact_factors (skipping - already in SQLite)")

        if not args.skip_fields and table_exists(con, "journal_fields"):
            if not sqlite_table_exists(con, "journal_fields"):
                print("Exporting journal_fields...")
                con.execute("CREATE TABLE sqlite_db.journal_fields AS SELECT * FROM journal_fields")
            else:
                print("Exporting journal_fields (skipping - already in SQLite)")

        # Export author tables if they exist
        if not args.skip_authors:
            if table_exists(con, "person_summary"):
                if not sqlite_table_exists(con, "person_summary"):
                    print("Exporting person_summary...")
                    con.execute("CREATE TABLE sqlite_db.person_summary AS SELECT * FROM person_summary")
                else:
                    print("Exporting person_summary (skipping - already in SQLite)")
            if table_exists(con, "person_yearly_stats"):
                if not sqlite_table_exists(con, "person_yearly_stats"):
                    print("Exporting person_yearly_stats...")
                    con.execute("CREATE TABLE sqlite_db.person_yearly_stats AS SELECT * FROM person_yearly_stats")
                else:
                    print("Exporting person_yearly_stats (skipping - already in SQLite)")
            if table_exists(con, "person_affiliations"):
                if not sqlite_table_exists(con, "person_affiliations"):
                    print("Exporting person_affiliations...")
                    con.execute("CREATE TABLE sqlite_db.person_affiliations AS SELECT * FROM person_affiliations")
                else:
                    print("Exporting person_affiliations (skipping - already in SQLite)")
            if table_exists(con, "person_funding"):
                if not sqlite_table_exists(con, "person_funding"):
                    print("Exporting person_funding...")
                    con.execute("CREATE TABLE sqlite_db.person_funding AS SELECT * FROM person_funding")
                else:
                    print("Exporting person_funding (skipping - already in SQLite)")
            if table_exists(con, "person_twitter"):
                if not sqlite_table_exists(con, "person_twitter"):
                    print("Exporting person_twitter...")
                    con.execute("CREATE TABLE sqlite_db.person_twitter AS SELECT * FROM person_twitter")
                else:
                    print("Exporting person_twitter (skipping - already in SQLite)")
            if table_exists(con, "person_tweets"):
                if not sqlite_table_exists(con, "person_tweets"):
                    print("Exporting person_tweets...")
                    con.execute("CREATE TABLE sqlite_db.person_tweets AS SELECT * FROM person_tweets")
                else:
                    print("Exporting person_tweets (skipping - already in SQLite)")
            if table_exists(con, "person_publications"):
                if not sqlite_table_exists(con, "person_publications"):
                    run_with_progress(con,
                        "CREATE TABLE sqlite_db.person_publications AS SELECT * FROM person_publications",
                        "Exporting person_publications")
                else:
                    print("Exporting person_publications (skipping - already in SQLite)")

        # Export affiliation tables if they exist
        if not args.skip_affiliations:
            if table_exists(con, "affiliation_summary"):
                if not sqlite_table_exists(con, "affiliation_summary"):
                    print("Exporting affiliation_summary...")
                    con.execute("CREATE TABLE sqlite_db.affiliation_summary AS SELECT * FROM affiliation_summary")
                else:
                    print("Exporting affiliation_summary (skipping - already in SQLite)")
            # affiliation_yearly_stats export DISABLED - data not accurate
            if table_exists(con, "affiliation_researchers"):
                if not sqlite_table_exists(con, "affiliation_researchers"):
                    print("Exporting affiliation_researchers...")
                    con.execute("CREATE TABLE sqlite_db.affiliation_researchers AS SELECT * FROM affiliation_researchers")
                else:
                    print("Exporting affiliation_researchers (skipping - already in SQLite)")
            if table_exists(con, "affiliation_collaborators"):
                if not sqlite_table_exists(con, "affiliation_collaborators"):
                    print("Exporting affiliation_collaborators...")
                    con.execute("CREATE TABLE sqlite_db.affiliation_collaborators AS SELECT * FROM affiliation_collaborators")
                else:
                    print("Exporting affiliation_collaborators (skipping - already in SQLite)")

        # Helper to export and optionally drop large tables to save disk space
        def export_and_drop(table_name: str, drop_after: bool = False):
            """Export table to SQLite, optionally drop from DuckDB to free space."""
            if table_exists(con, table_name):
                if not sqlite_table_exists(con, table_name):
                    run_with_progress(con,
                        f"CREATE TABLE sqlite_db.{table_name} AS SELECT * FROM {table_name}",
                        f"Exporting {table_name}")
                    if drop_after:
                        print(f"    Dropping {table_name} from DuckDB to free space...")
                        con.execute(f"DROP TABLE {table_name}")
                else:
                    print(f"Exporting {table_name} (skipping - already in SQLite)")
                    if drop_after and table_exists(con, table_name):
                        print(f"    Dropping {table_name} from DuckDB to free space...")
                        con.execute(f"DROP TABLE {table_name}")

        # Export paper tables (drop large ones after export to save space)
        export_and_drop("journal_publications", drop_after=True)
        export_and_drop("journal_field_papers", drop_after=True)
        export_and_drop("paper_summary", drop_after=True)
        export_and_drop("paper_authors", drop_after=True)
        export_and_drop("paper_fields", drop_after=True)
        export_and_drop("paper_references", drop_after=True)
        export_and_drop("paper_citations", drop_after=True)
        export_and_drop("paper_citation_history", drop_after=True)

        # Checkpoint to reclaim space from dropped tables
        print("  Running CHECKPOINT to reclaim disk space...")
        con.execute("CHECKPOINT")

        # Export field tables if they exist
        if not args.skip_fields:
            if table_exists(con, "field_summary"):
                if not sqlite_table_exists(con, "field_summary"):
                    print("Exporting field_summary...")
                    con.execute("CREATE TABLE sqlite_db.field_summary AS SELECT * FROM field_summary")
                else:
                    print("Exporting field_summary (skipping - already in SQLite)")
            # Export field top cited papers tables (from normalized citations)
            if table_exists(con, "field_top_cited_papers_level0"):
                if not sqlite_table_exists(con, "field_top_cited_papers_level0"):
                    print("Exporting field_top_cited_papers_level0...")
                    con.execute("CREATE TABLE sqlite_db.field_top_cited_papers_level0 AS SELECT * FROM field_top_cited_papers_level0")
                else:
                    print("Exporting field_top_cited_papers_level0 (skipping - already in SQLite)")
            if table_exists(con, "field_top_cited_papers_level1"):
                if not sqlite_table_exists(con, "field_top_cited_papers_level1"):
                    print("Exporting field_top_cited_papers_level1...")
                    con.execute("CREATE TABLE sqlite_db.field_top_cited_papers_level1 AS SELECT * FROM field_top_cited_papers_level1")
                else:
                    print("Exporting field_top_cited_papers_level1 (skipping - already in SQLite)")

        # Export funder tables
        if table_exists(con, "funder_summary"):
            if not sqlite_table_exists(con, "funder_summary"):
                print("Exporting funder_summary...")
                con.execute("CREATE TABLE sqlite_db.funder_summary AS SELECT * FROM funder_summary")
            else:
                print("Exporting funder_summary (skipping - already in SQLite)")
        if table_exists(con, "funder_yearly_stats"):
            if not sqlite_table_exists(con, "funder_yearly_stats"):
                print("Exporting funder_yearly_stats...")
                con.execute("CREATE TABLE sqlite_db.funder_yearly_stats AS SELECT * FROM funder_yearly_stats")
            else:
                print("Exporting funder_yearly_stats (skipping - already in SQLite)")
        if table_exists(con, "funder_concepts"):
            if not sqlite_table_exists(con, "funder_concepts"):
                print("Exporting funder_concepts...")
                con.execute("CREATE TABLE sqlite_db.funder_concepts AS SELECT * FROM funder_concepts")
            else:
                print("Exporting funder_concepts (skipping - already in SQLite)")

        # Export clinical trial tables
        if table_exists(con, "trial_summary"):
            if not sqlite_table_exists(con, "trial_summary"):
                print("Exporting trial_summary...")
                con.execute("CREATE TABLE sqlite_db.trial_summary AS SELECT * FROM trial_summary")
            else:
                print("Exporting trial_summary (skipping - already in SQLite)")
        export_and_drop("trial_papers", drop_after=True)
        export_and_drop("paper_trials", drop_after=True)
        export_and_drop("person_trials", drop_after=True)

        print(f"  SQLite export completed in {format_duration(time.time() - step_start)}")
        progress["sqlite_export_done"] = True
        save_progress(progress_path, progress)
    else:
        print()
        print("=" * 60)
        print("EXPORTING TO SQLITE (skipping - already done)")
        print("=" * 60)

    # Close DuckDB connection
    con.close()

    # Create indexes using Python's sqlite3 (DuckDB's SQLite attachment doesn't support index creation)
    if not progress.get("sqlite_indexes_done"):
        print("Creating SQLite indexes...")
        step_start = time.time()
        sqlite_con = sqlite3.connect(str(sqlite_path))

        # Helper to create index if table exists
        def create_index_if_table_exists(index_sql, table_name):
            try:
                sqlite_con.execute(f"SELECT 1 FROM {table_name} LIMIT 1")
                sqlite_con.execute(index_sql)
            except sqlite3.OperationalError:
                pass  # Table doesn't exist

        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_journal_summary_sourceid ON journal_summary(sourceid)",
            "journal_summary")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_journal_yearly_sourceid ON journal_yearly_stats(sourceid)",
            "journal_yearly_stats")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_journal_impact_factors_sourceid ON journal_impact_factors(sourceid)",
            "journal_impact_factors")

        if not args.skip_fields:
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_journal_fields_sourceid ON journal_fields(sourceid)",
                "journal_fields")

        if not args.skip_authors:
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_summary_authorid ON person_summary(authorid)",
                "person_summary")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_yearly_authorid ON person_yearly_stats(authorid)",
                "person_yearly_stats")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_affiliations_authorid ON person_affiliations(authorid)",
                "person_affiliations")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_funding_authorid ON person_funding(authorid)",
                "person_funding")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_twitter_authorid ON person_twitter(authorid)",
                "person_twitter")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_tweets_authorid ON person_tweets(authorid)",
                "person_tweets")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_person_publications_authorid ON person_publications(authorid)",
                "person_publications")

        if not args.skip_affiliations:
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_affiliation_summary_id ON affiliation_summary(institution_id)",
                "affiliation_summary")
            # affiliation_yearly_stats index DISABLED - table not created
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_affiliation_researchers_id ON affiliation_researchers(institution_id)",
                "affiliation_researchers")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_affiliation_collaborators_id ON affiliation_collaborators(institution_id)",
                "affiliation_collaborators")

        # Paper table indexes
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_journal_publications_sourceid ON journal_publications(sourceid)",
            "journal_publications")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_journal_field_papers_sourceid_fieldid ON journal_field_papers(sourceid, fieldid)",
            "journal_field_papers")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_summary_paperid ON paper_summary(paperid)",
            "paper_summary")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_authors_paperid ON paper_authors(paperid)",
            "paper_authors")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_fields_paperid ON paper_fields(paperid)",
            "paper_fields")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_references_paperid ON paper_references(paperid)",
            "paper_references")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_citations_paperid ON paper_citations(paperid)",
            "paper_citations")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_citation_history_paperid ON paper_citation_history(paperid)",
            "paper_citation_history")

        if not args.skip_fields:
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_field_summary_fieldid ON field_summary(fieldid)",
                "field_summary")
            # Field top cited papers indexes
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_field_top_cited_papers_level0_fieldid ON field_top_cited_papers_level0(fieldid)",
                "field_top_cited_papers_level0")
            create_index_if_table_exists(
                "CREATE INDEX IF NOT EXISTS idx_field_top_cited_papers_level1_fieldid ON field_top_cited_papers_level1(fieldid)",
                "field_top_cited_papers_level1")

        # Funder table indexes
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_funder_summary_funderid ON funder_summary(funderid)",
            "funder_summary")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_funder_yearly_stats_funderid ON funder_yearly_stats(funderid)",
            "funder_yearly_stats")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_funder_concepts_funderid ON funder_concepts(funderid)",
            "funder_concepts")

        # Clinical trial table indexes
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_trial_summary_nctid ON trial_summary(nct_id)",
            "trial_summary")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_trial_papers_nctid ON trial_papers(nct_id)",
            "trial_papers")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_paper_trials_paperid ON paper_trials(paperid)",
            "paper_trials")
        create_index_if_table_exists(
            "CREATE INDEX IF NOT EXISTS idx_person_trials_authorid ON person_trials(authorid)",
            "person_trials")

        sqlite_con.commit()
        sqlite_con.close()
        print(f"  Indexes created in {format_duration(time.time() - step_start)}")

        progress["sqlite_indexes_done"] = True
        save_progress(progress_path, progress)
    else:
        print("Creating SQLite indexes (skipping - already done)")

    # Clean up temporary DuckDB file only after everything is complete
    if temp_db_path.exists():
        print("Cleaning up temporary DuckDB file...")
        temp_db_path.unlink()

    # Keep progress file so --resume works for incremental updates
    # To start fresh, use --reset flag

    # Report final size and total time
    total_duration = time.time() - total_start
    size_mb = sqlite_path.stat().st_size / (1024 * 1024)
    print(f"\nSQLite database created at {sqlite_path} ({size_mb:.1f} MB)")
    print(f"Total preprocessing time: {format_duration(total_duration)}")
    print("\nPreprocessing complete!")


if __name__ == "__main__":
    main()
