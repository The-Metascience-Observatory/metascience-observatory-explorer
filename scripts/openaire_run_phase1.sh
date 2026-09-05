#!/bin/bash
# Phase 1: re-run OpenAIRE passes 4a/4b/5 with hex-keyed id translation.
#
# WHAT THIS FIXES: translate_targets()/translate_sources() and pass 4b's sub-pass B
# all matched OpenAIRE product ids on the FULL id string. The relation dumps
# reference products under `doi_dedup___::<hex>` while openaire_papers /
# paper_openaire / the dataset tars use other namespaces for the SAME product,
# so paper_projects and paper_linked_products were silently under-populated.
# Everything now keys on the bare md5 hex.
#
# WHY THIS IS SAFE: the paper corpus is NOT rebuilt (there is no dump version
# newer than the imported v11.1.1), so openaire_papers.rowid never moves and
# both openaire_title_fts and openaire_citations.db stay valid.
#
# Builds against a COPY and swaps atomically, so a bad run is a no-op and the
# live app never reads a half-written table.
#
# Usage: scripts/openaire_run_phase1.sh [dump-dir]

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DUMP="${1:-$(ls -d "${DATASETS_ROOT:-/mnt/metascience/datasets}"/openaire_graph_v* 2>/dev/null | tail -1)}"
KEYMAP=/mnt/metascience/openaire-build/keymap
BUILD=/mnt/metascience/openaire-build
LIVE=data/openaire.db
WORK="$BUILD/openaire.phase1.db"
LOG="$BUILD/phase1_$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$LOG") 2>&1
echo "=== Phase 1 start $(date -Is) ==="
echo "dump   : $DUMP"
echo "keymap : $KEYMAP"
echo "log    : $LOG"

# --- preconditions -----------------------------------------------------------
[ -d "$DUMP" ] || { echo "FATAL: dump dir not found: $DUMP"; exit 1; }
if [ ! -f "$DUMP/COMPLETE" ]; then
  echo "FATAL: $DUMP has no COMPLETE marker -- partial download, refusing to run."
  exit 1
fi
for f in map_lo.npy map_hi.npy map_val.npy epoch.txt; do
  [ -f "$KEYMAP/$f" ] || { echo "FATAL: missing $KEYMAP/$f"; exit 1; }
done

# The keymap encodes openaire_papers rowids. If the corpus were ever rebuilt the
# map would silently point at the wrong papers, so re-check the epoch guard.
echo "--- epoch guard ---"
python3 - "$LIVE" "$KEYMAP/epoch.txt" <<'PYEOF'
import sqlite3, sys
db, epoch_file = sys.argv[1], sys.argv[2]
parts = open(epoch_file).read().strip().split(":")
count, probes = int(parts[0]), parts[1:]
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
live = con.execute("SELECT COUNT(*) FROM openaire_papers").fetchone()[0]
if live != count:
    sys.exit(f"EPOCH FAIL: openaire_papers has {live:,}, keymap was built at {count:,}")
for rowid, want in zip((1, 16_777_216, 33_509_044), probes):
    got = con.execute("SELECT id FROM openaire_papers WHERE rowid=?", (rowid,)).fetchone()
    got = got[0] if got else None
    if got != want:
        sys.exit(f"EPOCH FAIL: rowid {rowid} is {got}, keymap expected {want}")
print(f"epoch OK: {live:,} papers, 3/3 probe rowids match")
PYEOF
[ $? -eq 0 ] || { echo "FATAL: keymap does not match the live openaire.db"; exit 1; }

# --- baseline ----------------------------------------------------------------
echo "--- baseline (before) ---"
sqlite3 -readonly "$LIVE" \
  "SELECT 'paper_projects', COUNT(*) FROM paper_projects
   UNION ALL SELECT 'paper_linked_products', COUNT(*) FROM paper_linked_products
   UNION ALL SELECT 'org_projects', COUNT(*) FROM org_projects;"

# --- working copy ------------------------------------------------------------
# Same filesystem as data/, so the final swap is an atomic rename.
echo "--- copying $LIVE -> $WORK ($(du -h "$LIVE" | cut -f1)) ---"
rm -f "$WORK"
cp "$LIVE" "$WORK" || { echo "FATAL: copy failed"; exit 1; }

run_pass() {
  echo; echo "=== $1 === $(date -Is)"; shift
  "$@" || { echo "FATAL: pass failed: $*"; exit 1; }
}

run_pass "Pass 4a - paper_projects" \
  python3 scripts/openaire_import_relations.py \
    --dump-dir "$DUMP" --db-path "$WORK" --keymap-dir "$KEYMAP" --rebuild

run_pass "Pass 4b - paper_linked_products" \
  python3 scripts/openaire_import_linked_products.py \
    --dump-dir "$DUMP" --db-path "$WORK" --keymap-dir "$KEYMAP" \
    --links-db "$BUILD/links.db" --rebuild

run_pass "Pass 5 - organizations" \
  python3 scripts/openaire_import_organizations.py \
    --dump-dir "$DUMP" --db-path "$WORK" --journals-db data/journals.db --rebuild

# --- gate --------------------------------------------------------------------
echo; echo "--- result (after) ---"
sqlite3 "$WORK" \
  "SELECT 'paper_projects', COUNT(*) FROM paper_projects
   UNION ALL SELECT 'paper_linked_products', COUNT(*) FROM paper_linked_products
   UNION ALL SELECT 'org_projects', COUNT(*) FROM org_projects;"

echo
echo "Working DB: $WORK"
echo "NOT swapped in automatically. Review the before/after above, then:"
echo "    mv $WORK $LIVE     # atomic, same filesystem"
echo "and restart the app. If the counts did NOT rise materially above"
echo "7,856,475 / 8,126,715, the hex theory is wrong -- do not ship."
echo "=== Phase 1 end $(date -Is) ==="
