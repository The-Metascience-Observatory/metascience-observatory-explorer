#!/bin/bash
# Resumable driver for every bulk dump we pull onto /mnt/metascience/datasets.
#
# Usage:  scripts/fetch_dumps.sh <target> [target...]
#         scripts/fetch_dumps.sh list
#         scripts/fetch_dumps.sh index          # regenerate the top-level README
#
# Targets: openaire  pubmed  pmc  ror  crossref  orcid  grants
#
# Every target lands in a self-describing folder named
#   <provider>_<dataset>_<version-or-release>_<snapshot-date>
# carrying DATASET.md + SHA256SUMS + COMPLETE. See scripts/dump_lib.sh.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/dump_lib.sh
source scripts/dump_lib.sh

ROOT="${DATASETS_ROOT:-/mnt/metascience/datasets}"
mkdir -p "$ROOT"

# OpenAIRE: the concept DOI 10.5281/zenodo.3516917 redirects to the newest
# record. Resolve it rather than hardcoding, so a future release is picked up.
resolve_openaire_record() {
  curl -sL --retry 3 "https://zenodo.org/api/records/3516917" |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'], d['metadata']['version'], d['metadata']['publication_date'])"
}

# ---------------------------------------------------------------------------
fetch_openaire() {
  read -r REC VER PUB <<< "$(resolve_openaire_record)"
  [ -n "${REC:-}" ] || { echo "ERROR: could not resolve OpenAIRE record"; return 1; }
  echo "OpenAIRE Graph record=$REC version=$VER published=$PUB"

  local DEST="$ROOT/openaire_graph_v${VER}_${PUB}"

  # ONLY the tars passes 4a/4b/5 consume. Deliberately excluded:
  #   publication_*      (156 GB) - already imported; re-importing would renumber
  #                       openaire_papers.rowid and invalidate openaire_title_fts
  #                       AND every openaire_citations.db edge key.
  #   product_Cites_*     (76 GB) - already packed into openaire_citations.db.
  #   datasource_*, person_*, product_IsSourceOf_*, product_hasAuthorInstitution_*
  #                              - no consumer (OpenAIRE paper->org affiliation links were deliberately scoped out;
  #                              SciSciNet's OpenAlex-derived affiliations are better).
  local REGEX='^(project_produces\.tar|project_hasParticipant\.tar|organization.*\.tar|dataset_[0-9]+\.tar|software\.tar|otherresearchproduct_[0-9]+\.tar|product_(?!Cites|IsSourceOf|hasAuthorInstitution).*\.tar)$'

  zenodo_fetch "$REC" "$DEST" 10 "$REGEX" || return 1

  write_dataset_md "$DEST" \
    "OpenAIRE Graph v$VER (relation + product tars)" \
    "OpenAIRE" \
    "https://doi.org/10.5281/zenodo.3516917 (record $REC)" \
    "$VER" "$PUB" \
    "CC-BY 4.0 -- cite: Manghi, P., Atzori, C., Bardi, A., et al. OpenAIRE Graph Dataset. Zenodo. https://doi.org/10.5281/zenodo.3516917" \
    "tar archives of gzipped JSON-lines (one JSON object per line)" \
    "scripts/fetch_dumps.sh openaire" \
    "## Subset note

This is a **partial** mirror of the OpenAIRE dump: only the project, organization,
dataset/software/otherresearchproduct, and result-result relation tars. The
\`publication_*\`, \`product_Cites_*\`, \`datasource_*\`, \`person_*\`,
\`product_IsSourceOf_*\`, and \`product_hasAuthorInstitution_*\` tars were
deliberately skipped -- see the comment in \`scripts/fetch_dumps.sh\`.
Consumers needing the full corpus should pull the remaining files from the same
Zenodo record."

  finalize_dataset "$DEST"
}

# ---------------------------------------------------------------------------
fetch_pubmed() {
  # Baseline year is encoded in the filenames (pubmed26n0001.xml.gz -> 2026).
  local YEAR; YEAR=$(curl -sL --retry 3 "https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/" \
    | grep -oE 'pubmed([0-9]{2})n' | head -1 | grep -oE '[0-9]{2}')
  [ -n "$YEAR" ] || { echo "ERROR: could not determine PubMed baseline year"; return 1; }
  local DEST="$ROOT/ncbi_pubmed_baseline-20${YEAR}"

  httpdir_fetch "https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/" "$DEST" '\.xml\.gz$' 8 || return 1

  write_dataset_md "$DEST" \
    "PubMed Annual Baseline 20$YEAR" \
    "NCBI / U.S. National Library of Medicine" \
    "https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/" \
    "baseline-20$YEAR" "20$YEAR" \
    "Public domain (U.S. Government work). See https://www.nlm.nih.gov/databases/download/terms_and_conditions.html" \
    "MEDLINE XML, gzipped" \
    "scripts/fetch_dumps.sh pubmed" \
    "## Scope warning

This is **citations + abstracts only -- NOT full text**. For open-access full-text
JATS XML see the \`europepmc_oa_fulltext-xml_*\` dataset alongside this one."

  finalize_dataset "$DEST"
}

# ---------------------------------------------------------------------------
fetch_pmc() {
  # NCBI retired its PMC bulk FTP packages in Aug 2026 (see /pub/pmc/readme.txt)
  # in favour of a per-article S3 layout with no tarballs and no manifest.
  # Europe PMC still publishes true bulk archives of the same publisher JATS.
  local URL="https://europepmc.org/ftp/oa/"
  local SNAP; SNAP=$(curl -sL --retry 3 "$URL" \
    | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort -u | tail -1)
  [ -n "$SNAP" ] || SNAP=$(date +%F)
  local DEST="$ROOT/europepmc_oa_fulltext-xml_${SNAP}"

  httpdir_fetch "$URL" "$DEST" '^PMC[0-9]+_PMC[0-9]+\.xml\.gz$' 6 || return 1

  write_dataset_md "$DEST" \
    "Europe PMC Open Access Subset -- full-text JATS XML" \
    "Europe PMC (EMBL-EBI)" \
    "$URL" \
    "OA bulk snapshot" "$SNAP" \
    "Per-article: each record carries its own <license> element (CC-BY, CC-BY-NC, etc). NOT uniformly redistributable -- see note below." \
    "JATS full-text XML, gzipped, batched by PMCID range" \
    "scripts/fetch_dumps.sh pmc" \
    "## Why Europe PMC and not NCBI

NCBI **retired the PMC bulk FTP packages in August 2026**
(\`ftp.ncbi.nlm.nih.gov/pub/pmc/readme.txt\`, updated 2026-08-25: *\"All legacy
files for the PMC Article Datasets are in the process of being removed from the
FTP Service... All files are now available via the updated PMC Cloud Service.\"*).
\`/pub/pmc/\` now serves only \`PMC-ids.csv.gz\`; \`oa_bulk/oa_comm/xml/\` 404s.
The replacement, \`s3://pmc-oa-opendata/\`, is laid out **per article**
(\`PMC<id>.<ver>/PMC<id>.<ver>.xml\` plus PDF, txt, JSON and figure images) with
no tarballs and no root manifest, so a full pull means millions of individual
GETs. Europe PMC still ships true bulk archives of the same publisher-supplied
JATS. Use \`s3://pmc-oa-opendata/\` for targeted top-ups and incrementals.

## LICENSING -- READ BEFORE REDISTRIBUTING

Unlike NCBI's old \`oa_comm\` / \`oa_noncomm\` split, Europe PMC does **not**
partition this archive by reuse terms. Licences vary per article. Before any
commercial or redistributive use, read each record's \`<license>\` element (or
join against the per-article \`.json\` in \`s3://pmc-oa-opendata/\`).

## Size

Keep these gzipped. ~161 GB compressed expands to roughly 700 GB - 1 TB."

  finalize_dataset "$DEST"
}

# ---------------------------------------------------------------------------
fetch_ror() {
  local DEST="$ROOT/ror_registry_$(date +%Y-%m)"
  mkdir -p "$DEST"
  # ROR publishes to a Zenodo community; the concept record is 6347574.
  read -r REC VER PUB <<< "$(curl -sL --retry 3 "https://zenodo.org/api/records/6347574" |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'], d['metadata'].get('version','?'), d['metadata']['publication_date'])" 2>/dev/null)"
  [ -n "${REC:-}" ] || { echo "ERROR: could not resolve ROR record"; return 1; }
  echo "ROR record=$REC version=$VER published=$PUB"
  zenodo_fetch "$REC" "$DEST" 4 '\.zip$' || return 1

  write_dataset_md "$DEST" \
    "Research Organization Registry (ROR) data dump" \
    "ROR / Datacite" \
    "https://doi.org/10.5281/zenodo.6347574 (record $REC)" \
    "$VER" "$PUB" \
    "CC0 1.0 (public domain dedication)" \
    "JSON + CSV, zipped" \
    "scripts/fetch_dumps.sh ror" \
    "Joins to \`affiliation_summary.ror\` in journals.db, which stores **bare** ROR ids (e.g. \`032k75171\`, no URL prefix) on 110,552 of 110,553 rows."

  finalize_dataset "$DEST"
}


# ---------------------------------------------------------------------------
fetch_orcid() {
  # ORCID publishes annually (~October). 2026 does not exist yet; 2025 is current.
  # Article 30375589 = "ORCID Public Data File 2025" (CC0), 237.7 GB across 12 files.
  # We take ONLY the summaries tar (46.3 GB): it carries personal details,
  # employments, educations and activity summaries. The eleven activities_* tars
  # (191 GB) hold full per-work detail we have no consumer for.
  local ART=30375589
  local DEST="$ROOT/orcid_public-data-file_2025"
  figshare_fetch "$ART" "$DEST" 'summaries' 8 || return 1

  write_dataset_md "$DEST" \
    "ORCID Public Data File 2025 (summaries only)" \
    "ORCID" \
    "https://doi.org/10.23640/07243.30375589.v1 (Figshare article $ART)" \
    "2025" "2025-10-20" \
    "CC0 1.0 (public domain dedication)" \
    "tar.gz of per-record XML summaries" \
    "scripts/fetch_dumps.sh orcid" \
    "## Subset note

Only \`ORCID_2025_10_summaries.tar.gz\` (46.3 GB) is mirrored. The eleven
\`ORCID_2025_10_activities_*.tar.gz\` files (191 GB) are available from the same
Figshare article if full per-work detail is ever needed.

## Joining to this project

\`person_summary.orcid\` in journals.db stores the **full URL** form
(\`https://orcid.org/0000-...\`) and has **no index**, so a join needs a full scan --
use \`openaire_build_lookup.py --only orcid\`."

  finalize_dataset "$DEST"
}

# ---------------------------------------------------------------------------
fetch_crossref() {
  # The AWS S3 mirror is Requester Pays (paid egress); BitTorrent is the free route.
  command -v aria2c >/dev/null || { echo "ERROR: aria2c not installed (sudo apt install aria2)"; return 1; }
  local HASH=b5ee0e102689b3e67023dd024694c0f5f124646f
  local DEST="$ROOT/crossref_public-data-file_2026-03"
  mkdir -p "$DEST"
  [ -f "$DEST/source.torrent" ] || \
    curl -sL --retry 3 "https://academictorrents.com/download/$HASH.torrent" -o "$DEST/source.torrent" || return 1

  # --seed-time=0: aria2 otherwise seeds to ratio 1.0, pushing 223 GB back out
  # over the uplink unannounced.
  aria2c --dir="$DEST" --seed-time=0 --continue=true --file-allocation=falloc \
         --check-integrity=true --max-concurrent-downloads=1 --bt-max-peers=80 \
         --summary-interval=120 --console-log-level=warn --log-level=warn \
         --log="$DEST/aria2.log" "$DEST/source.torrent" || return 1

  write_dataset_md "$DEST" \
    "Crossref Public Data File, March 2026" \
    "Crossref" \
    "https://doi.org/10.13003/nggf-vt1j (Academic Torrents $HASH)" \
    "March 2026" "2026-03" \
    "Free reuse; see https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-metadata-license-information/" \
    "gzipped JSON-lines (.jsonl.gz), one Crossref record per line" \
    "scripts/fetch_dumps.sh crossref" \
    "## Contents

35,909 files: 35,908 \`.jsonl.gz\` shards plus \`a.py\`, a helper script Crossref ships
inside the torrent. ~180M records covering all Crossref-registered DOIs. The payload sits
in the subdirectory \`March 2026 Public Data File from Crossref/\` -- the torrent's own
directory name, preserved so the data stays verifiable against \`source.torrent\`.

## Integrity

aria2 verified every 2.1 MB piece against the torrent's SHA-1 piece hashes during
download; \`SHA256SUMS\` is a second, independent record."

  finalize_dataset "$DEST"
}

# ---------------------------------------------------------------------------
case "${1:-}" in
  list)  echo "targets: openaire pubmed pmc ror crossref orcid grants"; exit 0 ;;
  index) regen_index "$ROOT"; exit 0 ;;
  "")    echo "usage: $0 <target|list|index> [target...]"; exit 1 ;;
esac

for T in "$@"; do
  echo "=============================================================="
  echo "TARGET: $T   $(date -Is)"
  echo "=============================================================="
  case "$T" in
    openaire) fetch_openaire ;;
    pubmed)   fetch_pubmed ;;
    pmc)      fetch_pmc ;;
    ror)      fetch_ror ;;
    orcid)    fetch_orcid ;;
    crossref) fetch_crossref ;;
    grants)
      echo "NOT YET IMPLEMENTED: NIH ExPORTER and NSF moved their bulk endpoints."
      echo "  exporter.nih.gov no longer resolves; reporter.nih.gov serves an SPA shell;"
      echo "  NSF's POST /awardsearch/download now redirects to simple-search."
      echo "  Capture the real XHR from browser devtools, or use RePORTER API v2." ;;
    *) echo "unknown target: $T" ;;
  esac
done

regen_index "$ROOT"
