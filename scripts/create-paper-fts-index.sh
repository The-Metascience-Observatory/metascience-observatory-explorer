#!/bin/bash
# Create FTS5 index for paper title search
# This will take several hours for 250M papers

DB_PATH="${1:-data/journals.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    echo "Usage: $0 [path/to/journals.db]"
    exit 1
fi

echo "Creating FTS5 index for paper titles in $DB_PATH"
echo "This will take several hours for 250M papers..."
echo ""

# Check if FTS table already exists
EXISTS=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='paper_title_fts';" 2>/dev/null)

if [ -n "$EXISTS" ]; then
    echo "Warning: paper_title_fts table already exists."
    read -p "Do you want to rebuild it? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    echo "Dropping existing table..."
    sqlite3 "$DB_PATH" "DROP TABLE paper_title_fts;"
fi

echo "Creating FTS5 virtual table..."
sqlite3 "$DB_PATH" <<'EOF'
CREATE VIRTUAL TABLE paper_title_fts USING fts5(
  paperid,
  title,
  content='paper_summary',
  content_rowid='rowid'
);
EOF

if [ $? -ne 0 ]; then
    echo "Error: Failed to create FTS5 table"
    exit 1
fi

echo "Populating FTS index (this is the slow part)..."
echo "Started at: $(date)"

sqlite3 "$DB_PATH" "INSERT INTO paper_title_fts(paper_title_fts) VALUES('rebuild');"

if [ $? -eq 0 ]; then
    echo ""
    echo "Completed at: $(date)"
    echo "FTS5 index created successfully!"
    echo ""
    echo "You can now search papers by title on the dashboard."
else
    echo "Error: Failed to populate FTS index"
    exit 1
fi
