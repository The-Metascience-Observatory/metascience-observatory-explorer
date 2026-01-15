#!/bin/bash
# Import ClinicalTrials.gov data into SQLite
# Creates ctg_studies table with trial metadata

CSV_PATH="/media/dan/metascience/data/ctg-studies_12_23_2025_data.csv"
SQLITE_PATH="/media/dan/metascience/sciscinet-dashboard/data/journals.db"

echo "Importing ClinicalTrials.gov data..."
echo "  Source: $CSV_PATH"
echo "  Target: $SQLITE_PATH"

# Step 1: Use DuckDB to select and clean columns, export to CSV
echo ""
echo "Step 1: Processing CSV with DuckDB..."

duckdb -csv -c "
SELECT
    \"NCT Number\" as nct_id,
    \"Study Title\" as title,
    \"Study Status\" as status,
    \"Phases\" as phase,
    \"Study Type\" as study_type,
    \"Conditions\" as conditions,
    \"Interventions\" as interventions,
    \"Sponsor\" as sponsor,
    \"Enrollment\" as enrollment,
    \"Start Date\" as start_date,
    \"Completion Date\" as completion_date,
    \"Brief Summary\" as brief_summary,
    \"Study URL\" as study_url
FROM read_csv('$CSV_PATH', header=true, quote='\"', escape='\"')
" > /tmp/ctg_studies.csv

echo "  Exported to /tmp/ctg_studies.csv"
wc -l /tmp/ctg_studies.csv

# Step 2: Import into SQLite
echo ""
echo "Step 2: Importing into SQLite..."

sqlite3 "$SQLITE_PATH" <<'EOF'
.mode csv

DROP TABLE IF EXISTS ctg_studies;

CREATE TABLE ctg_studies (
    nct_id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT,
    phase TEXT,
    study_type TEXT,
    conditions TEXT,
    interventions TEXT,
    sponsor TEXT,
    enrollment INTEGER,
    start_date TEXT,
    completion_date TEXT,
    brief_summary TEXT,
    study_url TEXT
);

.import --skip 1 /tmp/ctg_studies.csv ctg_studies

-- Create indexes for search
CREATE INDEX idx_ctg_studies_status ON ctg_studies(status);
CREATE INDEX idx_ctg_studies_sponsor ON ctg_studies(sponsor);

SELECT 'ctg_studies: ' || COUNT(*) || ' rows imported' FROM ctg_studies;
EOF

# Clean up
rm -f /tmp/ctg_studies.csv

echo ""
echo "Done!"
