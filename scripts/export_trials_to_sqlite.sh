#!/bin/bash
# Export clinical trials data from parquet files to SQLite

DATA_DIR="/media/dan/metascience/sciscinet-v2"
SQLITE_PATH="/media/dan/metascience/sciscinet-dashboard/data/journals.db"

echo "Exporting clinical trials data to SQLite..."
echo "  Source: $DATA_DIR"
echo "  Target: $SQLITE_PATH"

# Process with DuckDB and export to CSV
echo ""
echo "Step 1: Processing parquet files with DuckDB..."

duckdb -csv -c "
SELECT
    lt.nct_id,
    COUNT(DISTINCT lt.paperid) as paper_count,
    COUNT(DISTINCT CASE WHEN cm.reference_type = 'result' THEN lt.paperid END) as result_paper_count,
    COUNT(DISTINCT CASE WHEN cm.reference_type = 'derived' THEN lt.paperid END) as derived_paper_count,
    COUNT(DISTINCT CASE WHEN cm.reference_type = 'background' THEN lt.paperid END) as background_paper_count
FROM read_parquet('$DATA_DIR/sciscinet_link_clinicaltrials.parquet') lt
LEFT JOIN read_parquet('$DATA_DIR/sciscinet_clinicaltrials_metadata.parquet') cm
    ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
GROUP BY lt.nct_id
" > /tmp/trial_summary.csv
echo "  trial_summary.csv created"

duckdb -csv -c "
SELECT
    lt.nct_id,
    lt.paperid,
    cm.reference_type
FROM read_parquet('$DATA_DIR/sciscinet_link_clinicaltrials.parquet') lt
LEFT JOIN read_parquet('$DATA_DIR/sciscinet_clinicaltrials_metadata.parquet') cm
    ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
" > /tmp/trial_papers.csv
echo "  trial_papers.csv created"

duckdb -csv -c "
SELECT
    lt.paperid,
    lt.nct_id,
    cm.reference_type
FROM read_parquet('$DATA_DIR/sciscinet_link_clinicaltrials.parquet') lt
LEFT JOIN read_parquet('$DATA_DIR/sciscinet_clinicaltrials_metadata.parquet') cm
    ON lt.nct_id = cm.nct_id AND lt.paperid = cm.paperid
" > /tmp/paper_trials.csv
echo "  paper_trials.csv created"

echo ""
echo "  CSV row counts:"
wc -l /tmp/trial_summary.csv /tmp/trial_papers.csv /tmp/paper_trials.csv

# Import into SQLite
echo ""
echo "Step 2: Importing into SQLite..."
sqlite3 "$SQLITE_PATH" <<'EOF'
.mode csv

DROP TABLE IF EXISTS trial_summary;
DROP TABLE IF EXISTS trial_papers;
DROP TABLE IF EXISTS paper_trials;

CREATE TABLE trial_summary (
    nct_id TEXT PRIMARY KEY,
    paper_count INTEGER,
    result_paper_count INTEGER,
    derived_paper_count INTEGER,
    background_paper_count INTEGER
);

CREATE TABLE trial_papers (
    nct_id TEXT,
    paperid TEXT,
    reference_type TEXT
);

CREATE TABLE paper_trials (
    paperid TEXT,
    nct_id TEXT,
    reference_type TEXT
);

.import --skip 1 /tmp/trial_summary.csv trial_summary
.import --skip 1 /tmp/trial_papers.csv trial_papers
.import --skip 1 /tmp/paper_trials.csv paper_trials

CREATE INDEX idx_trial_summary_nctid ON trial_summary(nct_id);
CREATE INDEX idx_trial_papers_nctid ON trial_papers(nct_id);
CREATE INDEX idx_paper_trials_paperid ON paper_trials(paperid);

SELECT 'trial_summary: ' || COUNT(*) || ' rows' FROM trial_summary;
SELECT 'trial_papers: ' || COUNT(*) || ' rows' FROM trial_papers;
SELECT 'paper_trials: ' || COUNT(*) || ' rows' FROM paper_trials;
EOF

# Clean up
rm -f /tmp/trial_summary.csv /tmp/trial_papers.csv /tmp/paper_trials.csv

echo ""
echo "Done!"
