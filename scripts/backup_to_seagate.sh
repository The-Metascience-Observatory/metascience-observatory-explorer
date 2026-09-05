#!/usr/bin/env bash
# Refresh the SciSciNet database backup on the Seagate portable drive.
#
# Strategy: the drive already holds sciscinet-dashboard_database_backup_01_29_2026/data/.
# Most files are byte-for-byte unchanged since then, so this only refreshes the
# delta. journals.db (1.5 TB) is the exception -- there is not enough free space
# for a side-by-side copy, so the stale copy is DELETED and replaced. That leaves
# a multi-hour window with no journals.db backup; it is a deliberate, accepted
# tradeoff (Dan, 2026-08-11).
#
#   sudo bash scripts/backup_to_seagate.sh prep   # health check + repair + remount rw
#        bash scripts/backup_to_seagate.sh run    # the actual backup (no sudo)
#
# 'run' is safe to re-run: rsync resumes, and each step is idempotent.

set -uo pipefail

SRC="/media/dan/metascience/sciscinet-dashboard/data"
MNT="/media/dan/Seagate Portable Drive"
DEST="$MNT/sciscinet-dashboard_database_backup_01_29_2026/data"
DEPLOY="$MNT/openaire-deploy"
DEV="/dev/sda2"
LOG="$MNT/backup_$(date +%Y%m%d).log"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG" 2>/dev/null || echo "[$(date +%H:%M:%S)] $*"; }

# ── prep: needs root ────────────────────────────────────────────────────────
if [ "${1:-}" = "prep" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "prep must run under sudo"; exit 1; }

  echo "==> SMART health (this drive is the only backup target -- check before writing 1.5 TB)"
  if ! command -v smartctl >/dev/null; then
    echo "    installing smartmontools..."
    apt-get install -y smartmontools >/dev/null 2>&1 || echo "    WARNING: install failed, skipping SMART"
  fi
  if command -v smartctl >/dev/null; then
    # USB bridges reject plain ATA commands ("Read Device Identity failed").
    # Try SCSI-ATA passthrough variants until one answers.
    SMARTDEV=""
    for t in sat "sat,12" "sat,16" usbjmicron usbsunplus scsi; do
      if smartctl -d "$t" -i /dev/sda >/dev/null 2>&1; then SMARTDEV="$t"; break; fi
    done
    if [ -n "$SMARTDEV" ]; then
      echo "    (using -d $SMARTDEV)"
      smartctl -d "$SMARTDEV" -H /dev/sda || true
      smartctl -d "$SMARTDEV" -A /dev/sda 2>/dev/null |
        grep -iE 'Reallocated|Pending|Uncorrect|CRC|Power_On' || true
    else
      echo "    WARNING: this USB bridge does not expose SMART at all."
      echo "    Drive health cannot be verified here. Consider checking it on"
      echo "    another machine before deleting the only journals.db backup."
    fi
    echo
    echo "    If PASSED and no growing reallocated/pending sectors, continue."
    echo "    If FAILED or sectors are reallocating, STOP -- do not delete the old backup."
    read -r -p "    Continue? [y/N] " ok
    [ "$ok" = "y" ] || { echo "aborted"; exit 1; }
  fi

  echo "==> Repairing and remounting read-write"
  umount "$MNT" 2>/dev/null || umount "$DEV" 2>/dev/null
  # ntfsfix repairs $MFT/$MFTMirr and the boot sector, but by design it then SETS
  # the dirty flag to schedule a Windows chkdsk -- it can never leave the volume
  # clean for Linux. So the rw mount always needs 'force' afterwards.
  ntfsfix "$DEV" || { echo "ntfsfix failed -- do not proceed"; exit 1; }
  mkdir -p "$MNT"
  mount -t ntfs3 -o rw,force,uid="${SUDO_UID:-1000}",gid="${SUDO_GID:-1000}" "$DEV" "$MNT" || {
    echo "rw mount failed -- check: journalctl --since '5 min ago' | grep -i ntfs"; exit 1; }
  # Prove it is actually writable before reporting success.
  touch "$MNT/.rwtest" 2>/dev/null && rm -f "$MNT/.rwtest" \
    || { echo "mounted but NOT writable"; exit 1; }
  findmnt -rno TARGET,FSTYPE,OPTIONS "$DEV"
  echo "==> Ready. Now run WITHOUT sudo:  bash scripts/backup_to_seagate.sh run"
  exit 0
fi

[ "${1:-}" = "run" ] || { echo "usage: $0 prep|run"; exit 1; }

# ── preflight ───────────────────────────────────────────────────────────────
findmnt -rno OPTIONS "$DEV" | grep -q '\brw\b' || {
  echo "ERROR: $MNT is not mounted read-write. Run: sudo bash $0 prep"; exit 1; }
[ -d "$DEST" ] || { echo "ERROR: $DEST not found"; exit 1; }

say "=== backup start ==="
say "free before: $(df -h "$MNT" | awk 'NR==2{print $4}')"

# ── STEP 1: small + irreplaceable FIRST, before anything is deleted ─────────
# analytics.db and cache.db are written by the live app -- a plain cp can catch a
# torn write, so use SQLite's online backup API instead.
say "STEP 1: live databases (online backup)"
for db in analytics cache; do
  if [ -f "$SRC/$db.db" ]; then
    sqlite3 "$SRC/$db.db" ".backup '$DEST/$db.db.tmp'" \
      && mv -f "$DEST/$db.db.tmp" "$DEST/$db.db" \
      && say "  $db.db OK ($(du -h "$DEST/$db.db" | cut -f1))" \
      || say "  $db.db FAILED"
  fi
done

say "STEP 2: small static files"
rsync -rt --no-perms --no-owner --no-group --size-only --progress \
  "$SRC"/*.json "$SRC"/*.tsv "$SRC"/retractions.db "$DEST"/ 2>&1 | tail -3 | tee -a "$LOG"

# ── STEP 3: openaire DBs -- already on this drive, so MOVE (instant rename) ──
say "STEP 3: openaire databases (rename within the same filesystem, no copy)"
for f in openaire.db openaire_abstracts.db; do
  if [ -f "$DEPLOY/$f" ] && [ ! -f "$DEST/$f" ]; then
    mv "$DEPLOY/$f" "$DEST/$f" && say "  moved $f"
  else
    say "  $f: already in place or source gone, skipping"
  fi
done
[ -f "$DEPLOY/SHA256SUMS" ] && cp -f "$DEPLOY/SHA256SUMS" "$DEST/SHA256SUMS.openaire"

# ── STEP 4: mesh.db (changed Feb 13) ────────────────────────────────────────
# Opened readonly by the app, so .db + -wal is a consistent snapshot. -shm is
# deliberately NOT copied: readers mutate it, and SQLite regenerates it.
say "STEP 4: mesh.db (~31 GB)"
rsync -t --no-perms --no-owner --no-group --partial --inplace \
  "$SRC/mesh.db" "$SRC/mesh.db-wal" "$DEST"/ && say "  mesh.db OK"
rm -f "$DEST/mesh.db-shm"

# ── STEP 5: journals.db -- delete stale copy, then replace ──────────────────
say "STEP 5: journals.db (1.5 TB) -- THE RISK WINDOW STARTS HERE"
if [ -f "$DEST/journals.db" ]; then
  say "  deleting stale journals.db ($(du -h --apparent-size "$DEST/journals.db" | cut -f1), dated $(date -r "$DEST/journals.db" +%F))"
  rm -f "$DEST/journals.db" "$DEST/journals.db-wal" "$DEST/journals.db-shm"
  say "  free now: $(df -h "$MNT" | awk 'NR==2{print $4}')"
fi
say "  copying current journals.db -- expect 7-9 hours"
rsync -t --no-perms --no-owner --no-group --partial --inplace --info=progress2 \
  "$SRC/journals.db" "$SRC/journals.db-wal" "$DEST"/ 2>&1 | tail -5 | tee -a "$LOG"

# ── STEP 6: verify ──────────────────────────────────────────────────────────
say "STEP 6: verification"
# Static files: a size match proves the transfer was not truncated.
for f in journals.db mesh.db openaire.db openaire_abstracts.db; do
  if [ -f "$DEST/$f" ] && [ -f "$SRC/$f" ]; then
    s=$(stat -c %s "$SRC/$f"); d=$(stat -c %s "$DEST/$f")
    [ "$s" = "$d" ] && say "  $f size match ($s)" || say "  $f SIZE MISMATCH src=$s dest=$d"
  fi
done
# analytics.db and cache.db are written continuously by the live app, so their
# size ALWAYS drifts from a snapshot taken earlier -- comparing is meaningless
# and produces false alarms. The meaningful test is that the snapshot itself is
# a valid, self-consistent database.
for f in analytics.db cache.db; do
  if [ -f "$DEST/$f" ]; then
    r=$(sqlite3 "$DEST/$f" "PRAGMA integrity_check;" 2>&1 | head -1)
    [ "$r" = "ok" ] && say "  $f snapshot integrity ok ($(stat -c %s "$DEST/$f") bytes, live source has since grown)" \
                    || say "  $f SNAPSHOT CORRUPT: $r"
  fi
done
say "  integrity check on the replaced journals.db (reads 1.5 TB, ~1h):"
sqlite3 "$DEST/journals.db" "PRAGMA quick_check;" 2>&1 | head -3 | tee -a "$LOG"

say "free after: $(df -h "$MNT" | awk 'NR==2{print $4}')"
say "=== backup complete ==="
