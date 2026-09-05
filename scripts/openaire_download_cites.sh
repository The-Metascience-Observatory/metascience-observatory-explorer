#!/bin/bash
# OpenAIRE product_Cites downloader (resumable; re-run safe).
#
# Downloads the citation-edge relation tars that the original integration skipped
# (openaire_download_cites_parallel.sh. ~75.6 GB total, Zenodo record 20428976 (OpenAIRE Graph v11.1.1).
#
# Target is the internal ext4 NVMe, NOT the Seagate: that drive is mounted ro
# because its NTFS dirty flag is set (see mount_seagate.sh), and reading the
# tars from NVMe drops Pass B's I/O floor from ~12 min to ~1 min.
#
# product_Cites_8.tar is only 0.08 GB and is downloaded FIRST so the probe
# (openaire_import_cites.py --probe) can run while the rest is still streaming.

DEST="${1:-/media/dan/metascience/openaire-cites}"
mkdir -p "$DEST"
cd "$DEST" || exit 1

# _8 first (tiny, unblocks the probe), then _1 (a solid estimate), then the rest.
FILES="product_Cites_8.tar product_Cites_1.tar product_Cites_2.tar product_Cites_3.tar \
product_Cites_4.tar product_Cites_5.tar product_Cites_6.tar product_Cites_7.tar"

for f in $FILES; do
  for attempt in 1 2 3 4 5; do
    wget -c -q --tries=3 --timeout=60 \
      "https://zenodo.org/api/records/20428976/files/$f/content" -O "$f" && break
    echo "$(date -Is) retry $attempt for $f" >> download_cites.log
    sleep 30
  done
  echo "$(date -Is) done $f $(du -h "$f" 2>/dev/null | cut -f1)" >> download_cites.log
done
echo "$(date -Is) ALL DONE" >> download_cites.log
