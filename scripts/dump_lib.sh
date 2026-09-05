#!/bin/bash
# Shared helpers for fetching bulk research-data dumps into /mnt/metascience/datasets.
#
# The dumps on that drive have consumers beyond this dashboard, so every dataset
# folder must be self-describing: a DATASET.md recording provenance and license,
# a SHA256SUMS, and a COMPLETE marker written only after verification passes.
# A folder without COMPLETE is a partial download and must be ignored.
#
# Source this file; do not execute it.

DATASETS_ROOT="${DATASETS_ROOT:-/mnt/metascience/datasets}"

# ---------------------------------------------------------------------------
# Segmented Zenodo downloader.
#
# WHY: Zenodo throttles each CONNECTION to ~1.2 MB/s, not each IP (measured
# during the OpenAIRE cites pull -- see scripts/openaire_download_cites_parallel.sh,
# which this generalizes). Splitting a file into N byte ranges multiplies
# throughput ~Nx. Resumable at segment granularity.
#
# Usage: zenodo_fetch RECORD DEST SEGMENTS FILE_REGEX
# ---------------------------------------------------------------------------
zenodo_fetch() {
  local RECORD="$1" DEST="$2" SEGMENTS="$3" REGEX="$4"
  local LOG="$DEST/download.log"
  mkdir -p "$DEST" || return 1

  echo "fetching manifest for record $RECORD..."
  local MANIFEST
  MANIFEST=$(curl -sL --retry 3 "https://zenodo.org/api/records/$RECORD" |
    REGEX="$REGEX" python3 -c "
import json,os,re,sys
rx=re.compile(os.environ['REGEX'])
for f in json.load(sys.stdin).get('files', []):
    if rx.search(f['key']):
        print(f['key'], f['size'])
")
  if [ -z "$MANIFEST" ]; then
    echo "ERROR: empty manifest for record $RECORD regex $REGEX" | tee -a "$LOG"
    return 1
  fi

  local NAME SIZE URL STAMP CHUNK START END PART HAVE WANT OK i ORDERED FINAL
  while read -r NAME SIZE; do
    [ -n "$NAME" ] || continue
    URL="https://zenodo.org/api/records/$RECORD/files/$NAME/content"

    if [ -f "$DEST/$NAME" ] && [ "$(stat -c%s "$DEST/$NAME")" = "$SIZE" ]; then
      echo "skip $NAME (complete, $((SIZE / 1000000)) MB)"
      continue
    fi

    # Segment boundaries depend on SEGMENTS, so resuming with a different count
    # would append correct-length but WRONG-OFFSET data. Totals would still add
    # up, so the size check cannot catch it -- stamp the count and wipe on change.
    STAMP="$DEST/$NAME.segments"
    if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" != "$SEGMENTS" ]; then
      echo "  segment count changed; discarding stale parts" | tee -a "$LOG"
      rm -f "$DEST/$NAME".part*
    fi
    echo "$SEGMENTS" > "$STAMP"

    echo "$(date -Is) start $NAME ($((SIZE / 1000000)) MB, $SEGMENTS segments)" | tee -a "$LOG"
    CHUNK=$(( (SIZE + SEGMENTS - 1) / SEGMENTS ))

    for i in $(seq 0 $((SEGMENTS - 1))); do
      START=$((i * CHUNK)); END=$((START + CHUNK - 1))
      [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
      PART="$DEST/$NAME.part$i"; HAVE=0
      [ -f "$PART" ] && HAVE=$(stat -c%s "$PART")
      WANT=$((END - START + 1))
      [ "$HAVE" -ge "$WANT" ] && continue
      ( curl -s --retry 5 --retry-delay 5 --retry-all-errors \
          -r "$((START + HAVE))-$END" "$URL" >> "$PART" ) &
    done
    wait

    OK=1
    for i in $(seq 0 $((SEGMENTS - 1))); do
      START=$((i * CHUNK)); END=$((START + CHUNK - 1))
      [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
      WANT=$((END - START + 1)); HAVE=0
      [ -f "$DEST/$NAME.part$i" ] && HAVE=$(stat -c%s "$DEST/$NAME.part$i")
      if [ "$HAVE" -ne "$WANT" ]; then
        echo "  segment $i incomplete: $HAVE / $WANT" | tee -a "$LOG"; OK=0
      fi
    done
    if [ "$OK" -ne 1 ]; then
      echo "$(date -Is) INCOMPLETE $NAME -- re-run to resume" | tee -a "$LOG"; continue
    fi

    # Assemble in numeric order -- a glob sorts part10 before part2.
    ORDERED=""
    for i in $(seq 0 $((SEGMENTS - 1))); do ORDERED="$ORDERED $DEST/$NAME.part$i"; done
    # shellcheck disable=SC2086
    cat $ORDERED > "$DEST/$NAME" && rm -f "$DEST/$NAME".part* "$STAMP"
    FINAL=$(stat -c%s "$DEST/$NAME")
    if [ "$FINAL" = "$SIZE" ]; then
      echo "$(date -Is) done $NAME $((FINAL / 1000000))MB" | tee -a "$LOG"
    else
      echo "$(date -Is) SIZE MISMATCH $NAME: $FINAL != $SIZE" | tee -a "$LOG"
    fi
  done <<< "$MANIFEST"
}

# ---------------------------------------------------------------------------
# Mirror a plain HTTPS directory listing (NCBI FTP-over-HTTPS, Europe PMC).
# Usage: httpdir_fetch URL DEST ACCEPT_GLOB [PARALLEL]
# ---------------------------------------------------------------------------
httpdir_fetch() {
  local URL="$1" DEST="$2" ACCEPT="$3" PAR="${4:-8}"
  mkdir -p "$DEST" || return 1
  echo "listing $URL ..."
  curl -sL --retry 3 "$URL" \
    | grep -oE 'href="[^"]+"' | sed -e 's/^href="//' -e 's/"$//' \
    | grep -E "$ACCEPT" | sort -u | tr -d '\r' > "$DEST/.filelist"
  local N; N=$(wc -l < "$DEST/.filelist")
  if [ "$N" -eq 0 ]; then echo "ERROR: no files matched $ACCEPT at $URL"; return 1; fi
  echo "  $N files to mirror (-c resume, $PAR parallel)"

  # Retry rounds: NCBI throttles bursts of parallel connections and drops a
  # handful of files per pass (observed: 9 of 1,334 in one contiguous band).
  # A single xargs pass exits 123 on any failure, which previously propagated
  # as a bare `return 1` -- silently skipping metadata AND finalize with no
  # message at all. Now we re-derive what is actually missing and retry it.
  local ROUND MISSING
  for ROUND in 1 2 3; do
    MISSING=$(comm -23 "$DEST/.filelist" <(cd "$DEST" && ls | sort -u))
    [ -z "$MISSING" ] && break
    local NM; NM=$(printf '%s\n' "$MISSING" | grep -c .)
    echo "  round $ROUND: fetching $NM file(s)"
    printf '%s\n' "$MISSING" | xargs -P "$PAR" -I{} \
      wget -q -c -N -P "$DEST" "$URL{}" || true
  done

  MISSING=$(comm -23 "$DEST/.filelist" <(cd "$DEST" && ls | sort -u))
  if [ -n "$MISSING" ]; then
    echo "INCOMPLETE: $(printf '%s\n' "$MISSING" | grep -c .) of $N file(s) still missing after 3 rounds:"
    printf '    %s\n' $MISSING | head -20
    return 1
  fi
  echo "  all $N files present"
}

# ---------------------------------------------------------------------------
# write_dataset_md DEST NAME PROVIDER UPSTREAM VERSION SNAPSHOT LICENSE FORMAT CMD [NOTES]
# ---------------------------------------------------------------------------
write_dataset_md() {
  local DEST="$1" NAME="$2" PROVIDER="$3" UPSTREAM="$4" VERSION="$5" \
        SNAPSHOT="$6" LICENSE="$7" FORMAT="$8" CMD="$9" NOTES="${10:-}"
  local NFILES BYTES HUMAN
  # Recurse: torrent payloads land in a subdirectory, so -maxdepth 1 reported
  # only source.torrent (3.6 MB) for a 223 GB dataset. Must match the file set
  # finalize_dataset checksums, or the two disagree.
  NFILES=$(find "$DEST" -type f \
            ! -name 'DATASET.md' ! -name 'SHA256SUMS' ! -name 'COMPLETE' \
            ! -name 'download.log' ! -name 'aria2.log' ! -name '.filelist' | wc -l)
  BYTES=$(find "$DEST" -type f \
            ! -name 'DATASET.md' ! -name 'SHA256SUMS' ! -name 'COMPLETE' \
            ! -name 'download.log' ! -name 'aria2.log' ! -name '.filelist' -printf '%s\n' \
          | awk '{s+=$1} END{print s+0}')
  HUMAN=$(numfmt --to=iec --suffix=B "$BYTES" 2>/dev/null || echo "$BYTES bytes")

  cat > "$DEST/DATASET.md" <<EOF
# $NAME

| Field | Value |
|---|---|
| Provider | $PROVIDER |
| Upstream | $UPSTREAM |
| Version | $VERSION |
| Snapshot date | $SNAPSHOT |
| Downloaded | $(date -Is) |
| License | $LICENSE |
| Format | $FORMAT |
| Files | $NFILES |
| Size | $HUMAN ($BYTES bytes) |

## Retrieval

\`\`\`bash
$CMD
\`\`\`

## Integrity

\`SHA256SUMS\` covers every data file in this directory. Verify with:

\`\`\`bash
cd "$DEST" && sha256sum -c SHA256SUMS
\`\`\`

A \`COMPLETE\` file is present only if the download finished and checksums were
generated. **If \`COMPLETE\` is absent, this directory is a partial download --
do not consume it.**

$NOTES
EOF
  echo "wrote $DEST/DATASET.md"
}

# ---------------------------------------------------------------------------
# finalize_dataset DEST -- checksum every data file, then mark COMPLETE.
# ---------------------------------------------------------------------------
finalize_dataset() {
  local DEST="$1"
  echo "checksumming $DEST (this can take a while on large dumps)..."
  # -print0/-0 is load-bearing: payload directories can contain spaces (the
  # Crossref torrent unpacks into "March 2026 Public Data File from Crossref"),
  # and plain `xargs` splits on whitespace -- which silently checksummed 1 file
  # out of 35,910 and still wrote COMPLETE. Recurse, so nested payloads count.
  ( cd "$DEST" && find . -type f \
      ! -name 'DATASET.md' ! -name 'SHA256SUMS' ! -name 'COMPLETE' \
      ! -name 'download.log' ! -name 'aria2.log' ! -name '.filelist' -print0 \
    | sort -z | xargs -0 -r sha256sum > SHA256SUMS )

  # COMPLETE is a promise that SHA256SUMS covers the payload. Verify the counts
  # agree before making it, or a partial checksum reads as a verified dataset.
  local WANT HAVE
  WANT=$(find "$DEST" -type f \
      ! -name 'DATASET.md' ! -name 'SHA256SUMS' ! -name 'COMPLETE' \
      ! -name 'download.log' ! -name 'aria2.log' ! -name '.filelist' | wc -l)
  HAVE=$(wc -l < "$DEST/SHA256SUMS")
  if [ "$WANT" -ne "$HAVE" ]; then
    rm -f "$DEST/COMPLETE"
    echo "REFUSING to mark COMPLETE: SHA256SUMS covers $HAVE of $WANT files in $DEST"
    return 1
  fi
  date -Is > "$DEST/COMPLETE"
  echo "$DEST marked COMPLETE ($HAVE files checksummed)"
}

# ---------------------------------------------------------------------------
# regen_index -- rebuild the top-level README from the DATASET.md files on disk,
# so the index can never drift from what is actually there.
# ---------------------------------------------------------------------------
regen_index() {
  local ROOT="${1:-$DATASETS_ROOT}"
  python3 - "$ROOT" <<'PYEOF'
import os, re, sys
root = sys.argv[1]
rows = []
for d in sorted(os.listdir(root)):
    p = os.path.join(root, d)
    if not os.path.isdir(p):
        continue
    md = os.path.join(p, 'DATASET.md')
    fields = {}
    if os.path.exists(md):
        for line in open(md):
            m = re.match(r'\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$', line)
            if m and m.group(1) not in ('Field', '---'):
                fields[m.group(1)] = m.group(2)
    status = 'COMPLETE' if os.path.exists(os.path.join(p, 'COMPLETE')) else '**PARTIAL**'
    rows.append((d, fields.get('Provider', '?'), fields.get('Snapshot date', '?'),
                 fields.get('Size', '?'), fields.get('License', '?'), status))

out = [
    '# Bulk research-data dumps',
    '',
    'Generated by `scripts/fetch_dumps.sh` -- do not edit by hand.',
    'Each folder carries a `DATASET.md` (provenance, license, retrieval command)',
    'and a `SHA256SUMS`. **Only consume folders marked COMPLETE.**',
    '',
    '| Folder | Provider | Snapshot | Size | License | Status |',
    '|---|---|---|---|---|---|',
]
for r in rows:
    out.append('| `%s` | %s | %s | %s | %s | %s |' % r)
out.append('')
open(os.path.join(root, 'README.md'), 'w').write('\n'.join(out))
print('regenerated %s/README.md (%d datasets)' % (root, len(rows)))
PYEOF
}

# ---------------------------------------------------------------------------
# Segmented downloader for any range-capable HTTPS host (Figshare/ORCID, etc).
# Same rationale and resume semantics as zenodo_fetch, but takes an explicit
# URL + expected size rather than a Zenodo record manifest.
#
# Figshare 302-redirects to a signed S3 URL that honours Range (verified: two
# disjoint 1 KiB slices returned HTTP 206 with different content), so -L is
# required on every segment request.
#
# Usage: ranged_download URL OUTFILE SIZE [SEGMENTS]
# ---------------------------------------------------------------------------
ranged_download() {
  local URL="$1" OUT="$2" SIZE="$3" SEGMENTS="${4:-8}"
  local DIR; DIR=$(dirname "$OUT")
  local NAME; NAME=$(basename "$OUT")
  mkdir -p "$DIR" || return 1

  if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT")" = "$SIZE" ]; then
    echo "skip $NAME (complete, $((SIZE / 1000000)) MB)"; return 0
  fi

  local STAMP="$OUT.segments"
  if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" != "$SEGMENTS" ]; then
    echo "  segment count changed; discarding stale parts"; rm -f "$OUT".part*
  fi
  echo "$SEGMENTS" > "$STAMP"

  echo "$(date -Is) start $NAME ($((SIZE / 1000000)) MB, $SEGMENTS segments)"
  local CHUNK=$(( (SIZE + SEGMENTS - 1) / SEGMENTS )) i START END PART HAVE WANT
  for i in $(seq 0 $((SEGMENTS - 1))); do
    START=$((i * CHUNK)); END=$((START + CHUNK - 1))
    [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
    PART="$OUT.part$i"; HAVE=0
    [ -f "$PART" ] && HAVE=$(stat -c%s "$PART")
    WANT=$((END - START + 1))
    [ "$HAVE" -ge "$WANT" ] && continue
    ( curl -sL --retry 5 --retry-delay 5 --retry-all-errors \
        -r "$((START + HAVE))-$END" "$URL" >> "$PART" ) &
  done
  wait

  local OK=1
  for i in $(seq 0 $((SEGMENTS - 1))); do
    START=$((i * CHUNK)); END=$((START + CHUNK - 1))
    [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
    WANT=$((END - START + 1)); HAVE=0
    [ -f "$OUT.part$i" ] && HAVE=$(stat -c%s "$OUT.part$i")
    [ "$HAVE" -ne "$WANT" ] && { echo "  segment $i incomplete: $HAVE / $WANT"; OK=0; }
  done
  [ "$OK" -ne 1 ] && { echo "$(date -Is) INCOMPLETE $NAME -- re-run to resume"; return 1; }

  local ORDERED=""
  for i in $(seq 0 $((SEGMENTS - 1))); do ORDERED="$ORDERED $OUT.part$i"; done
  # shellcheck disable=SC2086
  cat $ORDERED > "$OUT" && rm -f "$OUT".part* "$STAMP"
  local FINAL; FINAL=$(stat -c%s "$OUT")
  [ "$FINAL" = "$SIZE" ] && echo "$(date -Is) done $NAME" \
    || { echo "$(date -Is) SIZE MISMATCH $NAME: $FINAL != $SIZE"; return 1; }
}

# ---------------------------------------------------------------------------
# figshare_fetch ARTICLE_ID DEST NAME_REGEX [SEGMENTS]
# Downloads matching files from a Figshare article and verifies supplied md5s.
# ---------------------------------------------------------------------------
figshare_fetch() {
  local ART="$1" DEST="$2" REGEX="$3" SEG="${4:-8}"
  mkdir -p "$DEST" || return 1
  local MANIFEST
  MANIFEST=$(curl -sL --retry 3 "https://api.figshare.com/v2/articles/$ART" |
    REGEX="$REGEX" python3 -c "
import json,os,re,sys
rx=re.compile(os.environ['REGEX'])
for f in json.load(sys.stdin).get('files', []):
    if rx.search(f['name']):
        print(f['name'], f['size'], f['download_url'], f.get('supplied_md5') or f.get('computed_md5') or '-')
")
  [ -z "$MANIFEST" ] && { echo "ERROR: no figshare files matched $REGEX on article $ART"; return 1; }

  local NAME SIZE URL MD5 GOT
  while read -r NAME SIZE URL MD5; do
    [ -n "$NAME" ] || continue
    ranged_download "$URL" "$DEST/$NAME" "$SIZE" "$SEG" || continue
    if [ "$MD5" != "-" ]; then
      echo "  verifying md5 of $NAME ..."
      GOT=$(md5sum "$DEST/$NAME" | cut -d' ' -f1)
      if [ "$GOT" != "$MD5" ]; then
        echo "  MD5 MISMATCH $NAME: got $GOT want $MD5 -- deleting"; rm -f "$DEST/$NAME"
      else
        echo "  md5 OK $NAME"
      fi
    fi
  done <<< "$MANIFEST"
}
