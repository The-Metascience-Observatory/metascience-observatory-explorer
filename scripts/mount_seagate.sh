#!/usr/bin/env bash
# Mount the Seagate deploy drive read-only.
#
# The drive is NTFS and its dirty flag is set (it wasn't cleanly ejected on the
# dev machine), so the kernel ntfs3 driver refuses a normal mount:
#     ntfs3(sda2): volume is dirty and "force" flag is not set!
# The deployment only READS from this drive, so we force a read-only mount
# instead of repairing it. Nothing is ever written to the drive.
#
# Usage:  bash scripts/mount_seagate.sh
# Undo:   sudo umount "/media/dan/Seagate Portable Drive"

set -uo pipefail

MNT="/media/dan/Seagate Portable Drive"
DRIVE_UUID="18B4B35AB4B33958"    # the Seagate deploy drive

# Run as your normal user; the script sudos where it needs to. If it was
# launched under sudo anyway, own the files by the invoking user, not root.
UID_OPT="${SUDO_UID:-$(id -u)}"
GID_OPT="${SUDO_GID:-$(id -g)}"

# --- locate the partition (don't hardcode sda2 -- it moves between plugs) ----
# NOTE: lsblk -r escapes spaces in labels as \x20, so match on UUID/FSTYPE.
DEV="$(lsblk -rno NAME,FSTYPE,UUID | awk -v u="$DRIVE_UUID" '$2=="ntfs" && $3==u {print "/dev/"$1; exit}')"
if [ -z "$DEV" ]; then
  # Fallback: the only NTFS partition attached.
  DEV="$(lsblk -rno NAME,FSTYPE | awk '$2=="ntfs"{print "/dev/"$1; exit}')"
fi
if [ -z "$DEV" ]; then
  echo "ERROR: no NTFS partition found. Is the drive plugged in?"
  lsblk -f
  exit 1
fi
echo "==> Partition: $DEV  (uid=$UID_OPT gid=$GID_OPT)"

# --- already mounted? -------------------------------------------------------
if findmnt -rno TARGET "$DEV" >/dev/null 2>&1; then
  echo "==> Already mounted at: $(findmnt -rno TARGET "$DEV")"
else
  sudo mkdir -p "$MNT"

  echo "==> Trying kernel ntfs3 driver (fast), read-only + force..."
  if ! sudo mount -t ntfs3 -o ro,force,uid="$UID_OPT",gid="$GID_OPT" "$DEV" "$MNT"; then
    echo "==> ntfs3 refused. Falling back to ntfs-3g (FUSE, slower but tolerant)..."
    if ! sudo mount -t ntfs-3g -o ro,force,uid="$UID_OPT",gid="$GID_OPT" "$DEV" "$MNT"; then
      echo
      echo "ERROR: both drivers failed. Real kernel error:"
      journalctl -b --no-pager 2>/dev/null | grep -iE 'ntfs' | tail -10
      echo
      echo "If you see I/O errors above, STOP -- do not run repair tools."
      echo "Re-copy or rsync the two DBs from the dev machine (~/openaire-build/) instead."
      exit 1
    fi
  fi
  echo "==> Mounted: $(findmnt -rno TARGET,FSTYPE,OPTIONS "$DEV")"
fi

# --- verify the deploy payload ---------------------------------------------
echo
DEPLOY="$MNT/openaire-deploy"
if [ ! -d "$DEPLOY" ]; then
  echo "WARNING: $DEPLOY not found. Top level of the drive:"
  ls -la "$MNT"
  exit 1
fi

echo "==> Contents of openaire-deploy:"
ls -lh "$DEPLOY"

echo
echo "==> Tail of copy.log (must end with 'COPY VERIFIED OK'):"
tail -3 "$DEPLOY/copy.log" 2>&1

echo
if tail -5 "$DEPLOY/copy.log" 2>/dev/null | grep -q 'COPY VERIFIED OK'; then
  echo "==> OK. Drive is ready. Next: PROD_HANDOFF.md 'Deployment steps'."
  echo "    Free space on the data/ volume:"
  df -h "$(dirname "$(readlink -f "$(dirname "$0")")")/data" 2>/dev/null || df -h .
else
  echo "==> copy.log does NOT confirm 'COPY VERIFIED OK'. Stop and report before copying."
fi
