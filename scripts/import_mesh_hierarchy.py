#!/usr/bin/env python3
"""
Download MeSH descriptor XML and extract hierarchy (tree numbers) and scope notes.

Usage:
    python scripts/import_mesh_hierarchy.py
"""

import gzip
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlretrieve
import os

# MeSH descriptor file URL (updated annually)
MESH_DESC_URL = "https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.xml"
DOWNLOAD_DIR = Path("/media/dan/metascience/mesh_descriptors")
DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DATA_DIR / "mesh.db"


def download_descriptor_file():
    """Download the MeSH descriptor XML file."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    filename = "desc2026.xml"
    dest = DOWNLOAD_DIR / filename

    if dest.exists():
        print(f"Descriptor file already exists: {dest}")
        return dest

    print(f"Downloading MeSH descriptor file...")
    print(f"  URL: {MESH_DESC_URL}")
    print(f"  Destination: {dest}")
    urlretrieve(MESH_DESC_URL, dest)
    print(f"  Done! Size: {dest.stat().st_size / 1024 / 1024:.1f} MB")

    return dest


def parse_and_import(xml_path: Path):
    """Parse MeSH descriptor XML and import hierarchy + scope notes."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Create tables for hierarchy and scope notes
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mesh_tree (
            mesh_ui TEXT,
            tree_number TEXT,
            PRIMARY KEY (mesh_ui, tree_number)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS mesh_scope (
            mesh_ui TEXT PRIMARY KEY,
            scope_note TEXT
        )
    """)

    # Check if already populated
    cur.execute("SELECT COUNT(*) FROM mesh_tree")
    existing_tree = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM mesh_scope")
    existing_scope = cur.fetchone()[0]

    if existing_tree > 0 and existing_scope > 0:
        print(f"Tables already populated: {existing_tree:,} tree entries, {existing_scope:,} scope notes")
        print("To reimport, drop the tables first: DROP TABLE mesh_tree; DROP TABLE mesh_scope;")
        conn.close()
        return

    print(f"Parsing {xml_path}...")

    tree_batch = []
    scope_batch = []
    descriptor_count = 0

    # Parse XML - it's not huge (~300MB) so we can use iterparse
    context = ET.iterparse(xml_path, events=('end',))

    for event, elem in context:
        if elem.tag == 'DescriptorRecord':
            descriptor_count += 1

            # Get descriptor UI
            ui_elem = elem.find('DescriptorUI')
            if ui_elem is None:
                elem.clear()
                continue

            mesh_ui = ui_elem.text

            # Get tree numbers
            tree_list = elem.find('TreeNumberList')
            if tree_list is not None:
                for tree_elem in tree_list.findall('TreeNumber'):
                    if tree_elem.text:
                        tree_batch.append((mesh_ui, tree_elem.text))

            # Get scope note (concept -> scope note)
            # Scope notes are in ConceptList/Concept/ScopeNote
            concept_list = elem.find('ConceptList')
            if concept_list is not None:
                # Get the preferred concept (first one, or one marked PreferredConceptYN="Y")
                for concept in concept_list.findall('Concept'):
                    scope_elem = concept.find('ScopeNote')
                    if scope_elem is not None and scope_elem.text:
                        scope_batch.append((mesh_ui, scope_elem.text.strip()))
                        break  # Only take first scope note

            elem.clear()

            if descriptor_count % 5000 == 0:
                print(f"  Processed {descriptor_count:,} descriptors...")

    print(f"\nTotal descriptors: {descriptor_count:,}")
    print(f"Tree number entries: {len(tree_batch):,}")
    print(f"Scope notes: {len(scope_batch):,}")

    # Insert batches
    print("\nInserting tree numbers...")
    cur.executemany("INSERT OR IGNORE INTO mesh_tree (mesh_ui, tree_number) VALUES (?, ?)", tree_batch)

    print("Inserting scope notes...")
    cur.executemany("INSERT OR REPLACE INTO mesh_scope (mesh_ui, scope_note) VALUES (?, ?)", scope_batch)

    # Create indexes
    print("Creating indexes...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mesh_tree_ui ON mesh_tree(mesh_ui)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mesh_tree_number ON mesh_tree(tree_number)")

    conn.commit()

    # Verify
    cur.execute("SELECT COUNT(*) FROM mesh_tree")
    print(f"\nFinal tree entries: {cur.fetchone()[0]:,}")
    cur.execute("SELECT COUNT(*) FROM mesh_scope")
    print(f"Final scope notes: {cur.fetchone()[0]:,}")

    conn.close()
    print("\nDone!")


def main():
    xml_path = download_descriptor_file()
    parse_and_import(xml_path)


if __name__ == "__main__":
    main()
