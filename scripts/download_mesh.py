#!/usr/bin/env python3
"""
Download MEDLINE baseline XML files and extract MeSH terms for each PMID.

MEDLINE baseline contains ~36 million PubMed records with MeSH annotations.
Files are ~350GB compressed total, extracted XML is much larger.

Usage:
    python scripts/download_mesh.py --download        # Download XML files
    python scripts/download_mesh.py --extract         # Extract MeSH to SQLite
    python scripts/download_mesh.py --import-mapping  # Import PMID mapping + precompute aggregates
    python scripts/download_mesh.py --all             # All steps
"""

import argparse
import csv
import gzip
import os
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlretrieve
from urllib.error import URLError
import hashlib
import time

# MEDLINE baseline FTP location
BASE_URL = "https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/"
# Number of baseline files (typically ~1200+ files, numbered pubmed24n0001.xml.gz to pubmed24nXXXX.xml.gz)
# Check the FTP site for the current year's count

# Download to /media/dan/metascience (larger disk), DB goes to dashboard data dir
DOWNLOAD_DIR = Path("/media/dan/metascience/medline_baseline")
DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DATA_DIR / "mesh.db"
JOURNALS_DB_PATH = DATA_DIR / "journals.db"
PMID_TSV_PATH = DATA_DIR / "df_magid_pubmedid.tsv"


def get_baseline_file_list():
    """Get list of baseline files to download."""
    # For 2025 baseline, files are named pubmed25n0001.xml.gz through pubmed25n0XXX.xml.gz
    # Adjust the year prefix and count as needed
    year_prefix = "pubmed25n"
    # Start with a reasonable estimate, script will handle 404s gracefully
    max_files = 1300

    files = []
    for i in range(1, max_files + 1):
        filename = f"{year_prefix}{i:04d}.xml.gz"
        files.append(filename)

    return files


def download_file(filename: str, retries: int = 3) -> bool:
    """Download a single baseline file with retries."""
    url = BASE_URL + filename
    dest = DOWNLOAD_DIR / filename

    if dest.exists():
        print(f"  Skipping {filename} (already exists)")
        return True

    for attempt in range(retries):
        try:
            print(f"  Downloading {filename}...")
            urlretrieve(url, dest)
            return True
        except URLError as e:
            if "404" in str(e) or "Not Found" in str(e):
                print(f"  {filename} not found (end of baseline)")
                return False
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt < retries - 1:
                time.sleep(5)

    return False


def download_baseline():
    """Download all MEDLINE baseline files."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    files = get_baseline_file_list()
    print(f"Attempting to download up to {len(files)} baseline files...")
    print(f"Download directory: {DOWNLOAD_DIR}")

    downloaded = 0
    for filename in files:
        if download_file(filename):
            downloaded += 1
        else:
            # Stop if we hit a 404 (end of baseline)
            break

    print(f"\nDownloaded {downloaded} files")


def init_db():
    """Initialize SQLite database for MeSH data."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Table for PMID -> MeSH term mappings
    cur.execute("""
        CREATE TABLE IF NOT EXISTS pmid_mesh (
            pmid INTEGER,
            mesh_ui TEXT,
            mesh_name TEXT,
            is_major INTEGER,
            qualifier_ui TEXT,
            qualifier_name TEXT
        )
    """)

    # Table for MeSH term metadata (optional, for lookups)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mesh_terms (
            mesh_ui TEXT PRIMARY KEY,
            mesh_name TEXT
        )
    """)

    # Track processed files
    cur.execute("""
        CREATE TABLE IF NOT EXISTS processed_files (
            filename TEXT PRIMARY KEY,
            processed_at TEXT
        )
    """)

    conn.commit()
    return conn


def extract_mesh_from_xml(xml_path: Path, conn: sqlite3.Connection):
    """Extract MeSH terms from a MEDLINE XML file."""
    cur = conn.cursor()

    # Check if already processed
    cur.execute("SELECT 1 FROM processed_files WHERE filename = ?", (xml_path.name,))
    if cur.fetchone():
        print(f"  Skipping {xml_path.name} (already processed)")
        return 0

    count = 0
    batch = []
    mesh_terms = {}

    # Parse gzipped XML
    open_func = gzip.open if xml_path.suffix == '.gz' else open

    with open_func(xml_path, 'rt', encoding='utf-8') as f:
        # Use iterparse for memory efficiency
        context = ET.iterparse(f, events=('end',))

        for event, elem in context:
            if elem.tag == 'PubmedArticle':
                # Extract PMID
                pmid_elem = elem.find('.//PMID')
                if pmid_elem is None:
                    elem.clear()
                    continue

                pmid = int(pmid_elem.text)

                # Extract MeSH headings
                for mesh_heading in elem.findall('.//MeshHeading'):
                    descriptor = mesh_heading.find('DescriptorName')
                    if descriptor is None:
                        continue

                    mesh_ui = descriptor.get('UI', '')
                    mesh_name = descriptor.text or ''
                    is_major = 1 if descriptor.get('MajorTopicYN') == 'Y' else 0

                    # Store term metadata
                    if mesh_ui and mesh_ui not in mesh_terms:
                        mesh_terms[mesh_ui] = mesh_name

                    # Check for qualifiers
                    qualifiers = mesh_heading.findall('QualifierName')
                    if qualifiers:
                        for qual in qualifiers:
                            qual_ui = qual.get('UI', '')
                            qual_name = qual.text or ''
                            qual_major = 1 if qual.get('MajorTopicYN') == 'Y' else 0
                            batch.append((pmid, mesh_ui, mesh_name, qual_major or is_major, qual_ui, qual_name))
                            count += 1
                    else:
                        batch.append((pmid, mesh_ui, mesh_name, is_major, None, None))
                        count += 1

                # Clear element to free memory
                elem.clear()

                # Batch insert
                if len(batch) >= 10000:
                    cur.executemany(
                        "INSERT INTO pmid_mesh (pmid, mesh_ui, mesh_name, is_major, qualifier_ui, qualifier_name) VALUES (?, ?, ?, ?, ?, ?)",
                        batch
                    )
                    batch = []

    # Insert remaining batch
    if batch:
        cur.executemany(
            "INSERT INTO pmid_mesh (pmid, mesh_ui, mesh_name, is_major, qualifier_ui, qualifier_name) VALUES (?, ?, ?, ?, ?, ?)",
            batch
        )

    # Insert mesh terms
    cur.executemany(
        "INSERT OR IGNORE INTO mesh_terms (mesh_ui, mesh_name) VALUES (?, ?)",
        mesh_terms.items()
    )

    # Mark as processed
    cur.execute(
        "INSERT INTO processed_files (filename, processed_at) VALUES (?, datetime('now'))",
        (xml_path.name,)
    )

    conn.commit()
    return count


def extract_all_mesh():
    """Extract MeSH terms from all downloaded baseline files."""
    conn = init_db()

    xml_files = sorted(DOWNLOAD_DIR.glob("*.xml.gz"))
    if not xml_files:
        print(f"No XML files found in {DOWNLOAD_DIR}")
        print("Run with --download first")
        return

    print(f"Processing {len(xml_files)} XML files...")

    total_count = 0
    for i, xml_path in enumerate(xml_files, 1):
        print(f"[{i}/{len(xml_files)}] Processing {xml_path.name}...")
        count = extract_mesh_from_xml(xml_path, conn)
        total_count += count
        print(f"  Extracted {count:,} MeSH assignments")

    # Create indexes for fast lookups
    print("\nCreating indexes...")
    cur = conn.cursor()
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pmid_mesh_pmid ON pmid_mesh(pmid)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pmid_mesh_ui ON pmid_mesh(mesh_ui)")
    conn.commit()

    # Print stats
    cur.execute("SELECT COUNT(*) FROM pmid_mesh")
    total_rows = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT pmid) FROM pmid_mesh")
    unique_pmids = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM mesh_terms")
    unique_terms = cur.fetchone()[0]

    print(f"\nDone! Database: {DB_PATH}")
    print(f"  Total MeSH assignments: {total_rows:,}")
    print(f"  Unique PMIDs with MeSH: {unique_pmids:,}")
    print(f"  Unique MeSH terms: {unique_terms:,}")

    conn.close()


def import_mapping_and_precompute():
    """Import PMID-to-paperid mapping and precompute aggregate tables."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Conservative memory settings - system has ~14GB available with website running
    cur.execute("PRAGMA cache_size = -1000000")  # 1GB cache
    cur.execute("PRAGMA temp_store = FILE")       # Use disk for temp tables to save RAM
    cur.execute("PRAGMA journal_mode = WAL")

    # Step 1a: Import PMID mapping from TSV
    print("=== Step 1a: Importing PMID mapping ===")
    cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='paperid_pmid'")
    if cur.fetchone()[0]:
        cur.execute("SELECT COUNT(*) FROM paperid_pmid")
        existing = cur.fetchone()[0]
        if existing > 0:
            print(f"  paperid_pmid already has {existing:,} rows, skipping import")
        else:
            _import_tsv(cur, conn)
    else:
        _import_tsv(cur, conn)

    # Attach journals.db for precomputation
    print(f"\nAttaching journals.db from {JOURNALS_DB_PATH}...")
    cur.execute(f"ATTACH DATABASE ? AS journals", (str(JOURNALS_DB_PATH),))

    # Step 1b: Precompute yearly stats per MeSH term
    print("\n=== Step 1b: Precomputing yearly paper counts per MeSH term ===")
    cur.execute("DROP TABLE IF EXISTS mesh_yearly_stats")
    cur.execute("""
        CREATE TABLE mesh_yearly_stats (
            mesh_ui TEXT,
            year INTEGER,
            paper_count INTEGER
        )
    """)
    print("  Running aggregation query (this may take a while)...")
    cur.execute("""
        INSERT INTO mesh_yearly_stats (mesh_ui, year, paper_count)
        SELECT pm.mesh_ui, ps.year, COUNT(DISTINCT pm.pmid)
        FROM pmid_mesh pm
        JOIN paperid_pmid pp ON pm.pmid = pp.pmid
        JOIN journals.paper_summary ps ON pp.paperid = ps.paperid
        WHERE ps.year IS NOT NULL AND ps.year >= 1900 AND ps.year <= 2025
        GROUP BY pm.mesh_ui, ps.year
    """)
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM mesh_yearly_stats")
    print(f"  Created {cur.fetchone()[0]:,} yearly stat rows")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mesh_yearly_ui ON mesh_yearly_stats(mesh_ui)")
    conn.commit()

    # Step 1c: Precompute top journals per MeSH term
    print("\n=== Step 1c: Precomputing top journals per MeSH term ===")
    cur.execute("DROP TABLE IF EXISTS mesh_top_journals")
    cur.execute("""
        CREATE TABLE mesh_top_journals (
            mesh_ui TEXT,
            sourceid TEXT,
            source_name TEXT,
            paper_count INTEGER
        )
    """)
    print("  Running aggregation query (this may take a while)...")
    # Use a window function to get top 20 per mesh_ui
    cur.execute("""
        INSERT INTO mesh_top_journals (mesh_ui, sourceid, source_name, paper_count)
        SELECT mesh_ui, sourceid, source_name, paper_count
        FROM (
            SELECT
                pm.mesh_ui,
                ps.sourceid,
                ps.source_name,
                COUNT(DISTINCT pm.pmid) as paper_count,
                ROW_NUMBER() OVER (PARTITION BY pm.mesh_ui ORDER BY COUNT(DISTINCT pm.pmid) DESC) as rn
            FROM pmid_mesh pm
            JOIN paperid_pmid pp ON pm.pmid = pp.pmid
            JOIN journals.paper_summary ps ON pp.paperid = ps.paperid
            WHERE ps.sourceid IS NOT NULL
            GROUP BY pm.mesh_ui, ps.sourceid, ps.source_name
        )
        WHERE rn <= 20
    """)
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM mesh_top_journals")
    print(f"  Created {cur.fetchone()[0]:,} top journal rows")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mesh_top_journals_ui ON mesh_top_journals(mesh_ui)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mesh_top_journals_sourceid ON mesh_top_journals(sourceid)")
    conn.commit()

    # Step 1d: Precompute MeSH term summary stats
    print("\n=== Step 1d: Precomputing MeSH term summary stats ===")
    cur.execute("DROP TABLE IF EXISTS mesh_summary")
    cur.execute("""
        CREATE TABLE mesh_summary (
            mesh_ui TEXT PRIMARY KEY,
            mesh_name TEXT,
            total_papers INTEGER,
            total_citations INTEGER
        )
    """)
    print("  Running aggregation query (this may take a while)...")
    cur.execute("""
        INSERT INTO mesh_summary (mesh_ui, mesh_name, total_papers, total_citations)
        SELECT
            pm.mesh_ui,
            mt.mesh_name,
            COUNT(DISTINCT pm.pmid) as total_papers,
            COALESCE(SUM(ps.cited_by_count), 0) as total_citations
        FROM pmid_mesh pm
        JOIN mesh_terms mt ON pm.mesh_ui = mt.mesh_ui
        JOIN paperid_pmid pp ON pm.pmid = pp.pmid
        JOIN journals.paper_summary ps ON pp.paperid = ps.paperid
        GROUP BY pm.mesh_ui, mt.mesh_name
    """)
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM mesh_summary")
    print(f"  Created {cur.fetchone()[0]:,} MeSH summary rows")

    cur.execute("DETACH DATABASE journals")
    conn.close()
    print("\nDone! All precomputed tables created.")


def _import_tsv(cur, conn):
    """Import the magid-to-pubmedid TSV into paperid_pmid table."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS paperid_pmid (
            paperid TEXT,
            pmid INTEGER
        )
    """)

    print(f"  Reading {PMID_TSV_PATH}...")
    batch = []
    count = 0
    with open(PMID_TSV_PATH, 'r') as f:
        reader = csv.reader(f, delimiter='\t')
        for row in reader:
            if len(row) < 2:
                continue
            magid, pubmedid = row[0], row[1]
            if not pubmedid.isdigit():
                continue
            batch.append((f"W{magid}", int(pubmedid)))
            count += 1
            if len(batch) >= 100000:
                cur.executemany("INSERT INTO paperid_pmid (paperid, pmid) VALUES (?, ?)", batch)
                batch = []
                if count % 5000000 == 0:
                    print(f"    Imported {count:,} rows...")
                    conn.commit()

    if batch:
        cur.executemany("INSERT INTO paperid_pmid (paperid, pmid) VALUES (?, ?)", batch)

    conn.commit()
    print(f"  Imported {count:,} PMID mappings")

    print("  Creating indexes...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_paperid_pmid_paperid ON paperid_pmid(paperid)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_paperid_pmid_pmid ON paperid_pmid(pmid)")
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Download and process MEDLINE MeSH data")
    parser.add_argument("--download", action="store_true", help="Download baseline XML files")
    parser.add_argument("--extract", action="store_true", help="Extract MeSH terms to SQLite")
    parser.add_argument("--import-mapping", action="store_true", help="Import PMID mapping and precompute aggregates")
    parser.add_argument("--all", action="store_true", help="All steps: download, extract, import-mapping")

    args = parser.parse_args()

    if not any([args.download, args.extract, args.import_mapping, args.all]):
        parser.print_help()
        return

    if args.download or args.all:
        print("=== Downloading MEDLINE baseline ===")
        print("Note: This will download ~350GB of compressed XML files")
        print(f"Files will be saved to: {DOWNLOAD_DIR}\n")
        download_baseline()

    if args.extract or args.all:
        print("\n=== Extracting MeSH terms ===")
        extract_all_mesh()

    if args.import_mapping or args.all:
        print("\n=== Importing mapping and precomputing ===")
        import_mapping_and_precompute()


if __name__ == "__main__":
    main()
