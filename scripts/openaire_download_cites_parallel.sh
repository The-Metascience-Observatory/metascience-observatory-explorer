#!/bin/bash
# Segmented, resumable downloader for the OpenAIRE product_Cites tars.
#
# WHY THIS EXISTS: Zenodo throttles each CONNECTION to ~1.2 MB/s once you've
# pulled a few tens of GB. Measured: 4 concurrent connections each sustained
# ~1.2-1.4 MB/s (~5.3 MB/s aggregate) while a separate wget kept its own
# 1.2 MB/s -- so the cap is per-connection, not per-IP. Splitting each file into
# N byte ranges therefore multiplies throughput ~Nx, turning a 12-hour serial
# download into roughly 90 minutes.
#
# Resumable at segment granularity: re-running continues each partial part file
# and skips any tar that is already complete and correctly sized.
#
# Usage: openaire_download_cites_parallel.sh [dest-dir] [segments]

set -uo pipefail

DEST="${1:-/media/dan/metascience/openaire-cites}"
SEGMENTS="${2:-10}"
# Optional comma-separated file allowlist, so two instances can split the work
# without ever touching the same part files (concurrent writes would corrupt them).
ONLY="${3:-}"
RECORD=20428976
LOG="$DEST/download_cites.log"

mkdir -p "$DEST"
cd "$DEST" || exit 1

# Exact sizes straight from the Zenodo record, so we can verify each result.
echo "fetching file manifest..."
MANIFEST=$(curl -s "https://zenodo.org/api/records/$RECORD" |
  python3 -c "
import json,sys
for f in json.load(sys.stdin).get('files', []):
    if f['key'].startswith('product_Cites_'):
        print(f['key'], f['size'])
")
if [ -z "$MANIFEST" ]; then
  echo "ERROR: could not fetch manifest" | tee -a "$LOG"
  exit 1
fi

while read -r NAME SIZE; do
  [ -n "$NAME" ] || continue
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$NAME,"* ]]; then
    continue
  fi
  URL="https://zenodo.org/api/records/$RECORD/files/$NAME/content"

  if [ -f "$NAME" ] && [ "$(stat -c%s "$NAME")" = "$SIZE" ]; then
    echo "skip $NAME (complete, $((SIZE / 1000000)) MB)"
    continue
  fi

  # Segment boundaries are a function of SEGMENTS, so resuming with a different
  # count would append correct-length but WRONG-OFFSET data to existing parts.
  # The size check at assembly cannot catch that (the totals still add up), so it
  # would silently yield a corrupt tar. Stamp the count and wipe on any change.
  STAMP="$NAME.segments"
  if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" != "$SEGMENTS" ]; then
    echo "  segment count changed ($(cat "$STAMP") -> $SEGMENTS); discarding stale parts" | tee -a "$LOG"
    rm -f "$NAME".part*
  fi
  echo "$SEGMENTS" > "$STAMP"

  echo "$(date -Is) start $NAME ($((SIZE / 1000000)) MB, $SEGMENTS segments)" | tee -a "$LOG"
  CHUNK=$(( (SIZE + SEGMENTS - 1) / SEGMENTS ))

  for i in $(seq 0 $((SEGMENTS - 1))); do
    START=$((i * CHUNK))
    END=$((START + CHUNK - 1))
    [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
    PART="$NAME.part$i"
    HAVE=0
    [ -f "$PART" ] && HAVE=$(stat -c%s "$PART")
    WANT=$((END - START + 1))
    if [ "$HAVE" -ge "$WANT" ]; then
      continue  # segment already complete
    fi
    # Resume this segment from wherever it stopped.
    (
      curl -s --retry 5 --retry-delay 5 --retry-all-errors \
        -r "$((START + HAVE))-$END" "$URL" >> "$PART"
    ) &
  done
  wait

  # Verify every segment reached its expected length before assembling.
  OK=1
  for i in $(seq 0 $((SEGMENTS - 1))); do
    START=$((i * CHUNK))
    END=$((START + CHUNK - 1))
    [ "$END" -ge "$SIZE" ] && END=$((SIZE - 1))
    WANT=$((END - START + 1))
    HAVE=0
    [ -f "$NAME.part$i" ] && HAVE=$(stat -c%s "$NAME.part$i")
    if [ "$HAVE" -ne "$WANT" ]; then
      echo "  segment $i incomplete: $HAVE / $WANT" | tee -a "$LOG"
      OK=0
    fi
  done
  if [ "$OK" -ne 1 ]; then
    echo "$(date -Is) INCOMPLETE $NAME -- re-run to resume" | tee -a "$LOG"
    continue
  fi

  # Assemble in numeric segment order -- a glob would sort part10 before part2.
  ORDERED=""
  for i in $(seq 0 $((SEGMENTS - 1))); do ORDERED="$ORDERED $NAME.part$i"; done
  # shellcheck disable=SC2086
  cat $ORDERED > "$NAME" && rm -f "$NAME".part* "$STAMP"
  FINAL=$(stat -c%s "$NAME")
  if [ "$FINAL" = "$SIZE" ]; then
    echo "$(date -Is) done $NAME $((FINAL / 1000000))MB" | tee -a "$LOG"
  else
    echo "$(date -Is) SIZE MISMATCH $NAME: $FINAL != $SIZE" | tee -a "$LOG"
  fi
done <<< "$MANIFEST"

echo "$(date -Is) ALL DONE" | tee -a "$LOG"
