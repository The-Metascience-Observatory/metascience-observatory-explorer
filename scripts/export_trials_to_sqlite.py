#!/usr/bin/env python3
"""
Export clinical trials data from parquet files to SQLite.
This is a standalone script that doesn't require running the full preprocessing.
"""

import duckdb
import sqlite3
from pathlib import Path

# Paths
DATA_DIR = Path("/media/dan/metascience/sciscinet-v2")
SQLITE_PATH = Path("/media/dan/metascience/sciscinet-dashboard/data/journals.db")

link_clinicaltrials_path = DATA_DIR / "sciscinet_link_clinicaltrials.parquet"
clinicaltrials_metadata_path = DATA_DIR / "sciscinet_clinicaltrials_metadata.parquet"

print("Exporting clinical trials data to SQLite...")
print(f"  Source: {DATA_DIR}")
print(f"  Target: {SQLITE_PATH}")

# Connect to DuckDB (in-memory) and attach SQLite
con = duckdb.connect()
con.execute(f"ATTACH '{SQLITE_PATH}' AS sqlite_db (TYPE SQLITE)")

# Create trial_summary table
print("\nCreating trial_summary table...")
con.execute("DROP TABLE IF EXISTS sqlite_db.trial_summary")
con.execute(f"""
    CREATE TABLE sqlite_db.trial_summary AS
    SELECT
        lt.nct_id,
        COUNT(DISTINCT lt.paperid) as paper_count,
        COUNT(DISTINCT CASE WHEN cm.reference_type = 'result' THEN lt.paperid END) as result_paper_count,
        COUNT(DISTINCT CASE WHEN cm.reference_type = 'derived' THEN lt.paperid END) as derived_paper_count,
        COUNT(DISTINCT CASE WHEN cm.reference_type = 'background' THEN lt.paperid END) as background_paper_count,
        NULL as total_citations,
        NULL as first_year,
        NULL as last_year
    FROM read_parquet('{link_clinicaltrials_path}') lt
    LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
        ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
    GROUP BY lt.nct_id
""")
count = con.execute("SELECT COUNT(*) FROM sqlite_db.trial_summary").fetchone()[0]
print(f"  Created trial_summary with {count:,} rows")

# Create trial_papers table
print("\nCreating trial_papers table...")
con.execute("DROP TABLE IF EXISTS sqlite_db.trial_papers")
con.execute(f"""
    CREATE TABLE sqlite_db.trial_papers AS
    SELECT
        lt.nct_id,
        lt.paperid,
        NULL as title,
        NULL as year,
        NULL as cited_by_count,
        cm.reference_type
    FROM read_parquet('{link_clinicaltrials_path}') lt
    LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
        ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
""")
count = con.execute("SELECT COUNT(*) FROM sqlite_db.trial_papers").fetchone()[0]
print(f"  Created trial_papers with {count:,} rows")

# Create paper_trials table
print("\nCreating paper_trials table...")
con.execute("DROP TABLE IF EXISTS sqlite_db.paper_trials")
con.execute(f"""
    CREATE TABLE sqlite_db.paper_trials AS
    SELECT
        lt.paperid,
        lt.nct_id,
        cm.reference_type
    FROM read_parquet('{link_clinicaltrials_path}') lt
    LEFT JOIN read_parquet('{clinicaltrials_metadata_path}') cm
        ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
""")
count = con.execute("SELECT COUNT(*) FROM sqlite_db.paper_trials").fetchone()[0]
print(f"  Created paper_trials with {count:,} rows")

# Create person_trials table (join with paper_authors)
print("\nCreating person_trials table...")
con.execute("DROP TABLE IF EXISTS sqlite_db.person_trials")
con.execute(f"""
    CREATE TABLE sqlite_db.person_trials AS
    SELECT
        ap.authorid,
        lt.nct_id,
        COUNT(DISTINCT lt.paperid) as paper_count
    FROM sqlite_db.paper_authors ap
    JOIN read_parquet('{link_clinicaltrials_path}') lt ON ap.paperid = lt.paperid
    GROUP BY ap.authorid, lt.nct_id
""")
count = con.execute("SELECT COUNT(*) FROM sqlite_db.person_trials").fetchone()[0]
print(f"  Created person_trials with {count:,} rows")

con.close()

# Create indexes using sqlite3
print("\nCreating indexes...")
sqlite_con = sqlite3.connect(str(SQLITE_PATH))
sqlite_con.execute("CREATE INDEX IF NOT EXISTS idx_trial_summary_nctid ON trial_summary(nct_id)")
sqlite_con.execute("CREATE INDEX IF NOT EXISTS idx_trial_papers_nctid ON trial_papers(nct_id)")
sqlite_con.execute("CREATE INDEX IF NOT EXISTS idx_paper_trials_paperid ON paper_trials(paperid)")
sqlite_con.execute("CREATE INDEX IF NOT EXISTS idx_person_trials_authorid ON person_trials(authorid)")
sqlite_con.commit()
sqlite_con.close()

print("\nDone! Clinical trials tables exported to SQLite.")
