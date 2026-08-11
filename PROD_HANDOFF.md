# PROD DEPLOYMENT: OpenAIRE Graph Integration

**Audience**: the Claude agent (or human) deploying on the **production machine**.
**Status**: code is merged on `main`; the two database files are arriving on the Seagate portable drive. Everything below was built and verified end-to-end on the dev machine on 2026-08-11.

## What this deployment adds

The app gains five features, all backed by a new read-only SQLite database built from the OpenAIRE Graph bulk dump (v11.1.1, June 2026, CC-BY 4.0 — attribution already added to README + About page):

1. **EU/national grant resolution** — `/api/grants` resolves European Commission grant codes locally (instant, no API key), alongside the existing NIH/NSF live lookups. 3.9M projects from ~40 funders.
2. **Paper OA status + funding** — paper detail pages show open-access badges (gold/green/bronze/hybrid/diamond) and a Funding card with linked grants (140.9M SciSciNet papers enriched; 1.07M papers have EC funding links).
3. **Linked datasets & software** — paper pages list related research datasets/software (8.1M links).
4. **33.5M new first-class papers** — OpenAIRE papers not in SciSciNet, searchable (appended to paper search with an "OpenAIRE" badge) with their own detail pages at `/papers/openaire/[id]`, DOI resolution, ORCID-linked authors, ISSN-linked journals, and abstracts.
5. **Affiliation project portfolios** — institution pages show funder-declared project participation (110K institutions matched via ROR).

Everything **degrades gracefully** if the database files are absent (verified): endpoints return nulls/empty, pages render without the new sections. There is no schema or data change to any existing database.

For how the data was built (pipeline, scripts, refresh procedure), see `HANDOFF.md`.

## Files arriving on the Seagate drive

Under `<seagate mount>/openaire-deploy/` (find it with `ls /media/*/Seagate*/openaire-deploy` or similar):

| File | Size | Contents |
|---|---|---|
| `openaire.db` | 50.3 GB | projects, paper enrichment, first-class papers + FTS, funding/product links, orgs |
| `openaire_abstracts.db` | 45.3 GB | abstracts for 14.7M of the first-class papers |
| `SHA256SUMS` | — | checksums for both, computed after the copy to the drive |
| `copy.log` | — | must end with `COPY VERIFIED OK`; if it says `CHECKSUM MISMATCH - DO NOT SHIP`, stop and report |

## Preconditions (check before copying)

1. **Disk**: ≥ 110 GB free on the volume holding the app's `data/` directory (`df -h`).
2. **Seagate mounted** and `copy.log` ends with `COPY VERIFIED OK`.
3. **Sync safety**: prod `data/` already holds ~200+ GB of DBs — confirm whatever holds it (Dropbox exclusion, plain disk) won't try to sync/back up 95 GB of new files. The new files follow the exact pattern of the existing ones.

### RESOLVED on prod (2026-08-11): dirty NTFS volume, kernel ntfs3 refused the mount

The actual cause on the production machine — neither of the two guesses below. `ntfs-3g` **was**
installed and the drive **was** healthy; udisks mounted via the kernel `ntfs3` driver, which
refuses a volume whose dirty flag is set:

```
ntfs3(sda2): volume is dirty and "force" flag is not set!
ntfs3(sda2): It is recommended to use chkdsk.
```

(The drive was not cleanly ejected on the dev machine, contrary to the note below.) The generic
`wrong fs type, bad option, bad superblock …` message from udisks/Caja hides this — get the real
error from `journalctl -b | grep -i ntfs` (no sudo needed) rather than `sudo dmesg`.

Fix, now scripted as **`scripts/mount_seagate.sh`** (run it without sudo; it sudos internally):

```bash
sudo mount -t ntfs3 -o ro,force,uid=$(id -u),gid=$(id -g) /dev/sdX2 "/media/$USER/Seagate Portable Drive"
```

`ro` makes `force` safe — the deployment only reads. Do NOT run `ntfsfix`: it writes to the drive
and isn't needed. The script finds the partition by UUID/fstype (note: `lsblk -r` escapes spaces
in labels as `\x20`, so label matching silently fails), falls back to `ntfs-3g`, and verifies
`copy.log`.

### Older triage (kept for other machines): drive won't mount ("wrong fs type, bad option, bad superblock … missing codepage or helper program")

The Seagate drive is **NTFS**. This error on a machine that hasn't mounted NTFS before almost always means the NTFS userspace driver is missing — it does NOT mean the drive is damaged. The drive was cleanly unmounted on the dev machine after the copy was checksum-verified. Work through these in order:

```bash
# 1. Confirm the partition is detected and intact.
#    The data partition is the ~3.7 TB NTFS one, labeled "Seagate Portable Drive".
#    The device name varies by machine (it was sdc2 on dev; may be sda2/sdb2 here).
lsblk -f
sudo blkid /dev/sdX2        # replace X — expect: TYPE="ntfs"

# 2. If TYPE="ntfs" shows up, it's a driver problem. Install ntfs-3g:
dpkg -l | grep ntfs         # likely empty
sudo apt install ntfs-3g

# 3. Unplug/replug the drive (or: sudo udisksctl mount -b /dev/sdX2).
#    It should now mount under /media/<user>/Seagate Portable Drive/.
```

### If ntfs-3g IS installed and it still won't mount

**CONFIRMED SITUATION ON PROD (2026-08-11)**: ntfs-3g is installed, Caja still fails. The most likely cause is the kernel's built-in `ntfs3` driver intercepting the mount — udisks/Caja prefers it on newer kernels, and it rejects volumes (dirty-flag, unsupported features) that ntfs-3g mounts fine. Work through this decision tree:

```bash
# 1. Confirm you're mounting the RIGHT partition. On many machines /dev/sda is
#    the INTERNAL disk — Caja's error naming sda2 may not even be the Seagate.
#    The Seagate data partition is the ~3.7 TB NTFS one labeled "Seagate Portable Drive".
lsblk -f -o NAME,FSTYPE,LABEL,SIZE,MOUNTPOINT

# 2. Get the real kernel error (look for lines from ntfs3 or ntfs-3g):
sudo dmesg | tail -20

# 3. Bypass the kernel driver: mount explicitly with ntfs-3g, READ-ONLY.
#    (ro is deliberate — deployment only reads from the drive, and ro sidesteps
#    every dirty-flag complication.)
sudo mkdir -p /mnt/seagate
sudo mount -t ntfs-3g -o ro /dev/sdX2 /mnt/seagate    # sdX2 from step 1
ls /mnt/seagate/openaire-deploy/                       # expect the two .db files + SHA256SUMS
```

If the explicit ntfs-3g mount ALSO fails, interpret its error + dmesg:

- **Unclean/dirty volume or Windows hibernation message**: `sudo ntfsfix /dev/sdX2`, then retry step 3.
- **I/O errors** (hardware-level read failures): STOP — do not run repair tools. Report back; the original database files are intact on the dev machine (`~/openaire-build/`) and can be re-copied to another drive or rsynced over the network instead.

**Note**: if you mounted manually at `/mnt/seagate`, use `DEPLOY="/mnt/seagate/openaire-deploy"` in the Deployment steps below instead of the `/media/...` glob.

After mounting by any route, always run the checksum verification (step 2 of Deployment steps below) before using the files.

## Deployment steps

```bash
# 1. Copy (app can keep serving; it ignores unknown files in data/)
DEPLOY="$(echo /media/*/Seagate*/openaire-deploy)"   # adjust if needed
cp "$DEPLOY/openaire.db" "$DEPLOY/openaire_abstracts.db" data/    # ~30-60 min from USB

# 2. Verify integrity
cd data && sha256sum -c "$DEPLOY/SHA256SUMS" && cd ..   # both must say OK

# 3. Sanity-check contents (expected exact counts)
sqlite3 data/openaire.db "SELECT 'projects', COUNT(*) FROM projects
  UNION ALL SELECT 'paper_openaire', COUNT(*) FROM paper_openaire
  UNION ALL SELECT 'openaire_papers', COUNT(*) FROM openaire_papers
  UNION ALL SELECT 'paper_projects', COUNT(*) FROM paper_projects
  UNION ALL SELECT 'paper_linked_products', COUNT(*) FROM paper_linked_products
  UNION ALL SELECT 'org_openaire', COUNT(*) FROM org_openaire;"
# projects              3909902
# paper_openaire        140937050
# openaire_papers       33509044
# paper_projects        7856475
# paper_linked_products 8126715
# org_openaire          110105

# 4. Deploy code
git pull                      # the OpenAIRE integration commit on main
npm install
npm run build                 # must complete with no type errors
# if better-sqlite3 segfaults at startup: npm rebuild better-sqlite3 (per CLAUDE.md)

# 5. Restart
npm start                     # prod server + cache warming
```

## Verification checklist

Run these against the live server (replace port if not 3000). Expected outputs were all confirmed on dev with this exact data.

```bash
# EC grant resolution (feature 1)
curl -s "localhost:3000/api/grants?award_id=101017441&funder=European%20Commission"
# → title "iHELP: Personalised Health Monitoring…", amount 5997990,
#   url https://cordis.europa.eu/project/id/101017441

# Paper enrichment (features 2+3)
curl -s "localhost:3000/api/papers/W1012602378/openaire"
# → openaire.oaColor "hybrid", projects[0].acronym "GLOBAQUA" (EC),
#   linkedProducts: figshare datasets

# First-class paper (feature 4)
curl -s "localhost:3000/api/papers/openaire/OAa5c3fb7ade9460405b71c4c72e20be42"
# → title "Challenges to Excellence in Child Health Research", journal JAMA,
#   3 authors (1 with matchedAuthorid)
curl -s "localhost:3000/api/papers/openaire/OAa5c3fb7ade9460405b71c4c72e20be42/abstract"
# → non-null abstract text

# DOI fallback (feature 4)
curl -s "localhost:3000/api/papers/by-doi/10.1001/2012.jama.10982"
# → {"paperid":"OAa5c3fb7ade9460405b71c4c72e20be42","openaire":true}

# Search merge (feature 4) — first run after restart is cold, may take seconds; retry
curl -s "localhost:3000/api/papers/search?q=machine+learning+crop+yield"
# → 60 results total: 50 SciSciNet + 10 with "openaire": true

# Affiliation portfolio (feature 5)
curl -s "localhost:3000/api/affiliations/I97018004/openaire"
# → Stanford University, projectCount 37451
```

Browser spot-checks:
- `/papers/W1012602378` — OA badge next to metadata badges; "Funding" card with GLOBAQUA; "Linked Datasets & Software" card
- `/papers/openaire/OAa5c3fb7ade9460405b71c4c72e20be42` — full page with source banner, JAMA journal link, abstract
- Paper search for "machine learning crop yield" — OpenAIRE-badged results at the bottom linking to `/papers/openaire/...`
- Any large EU university's affiliation page — "Funded Projects" section

## Operational notes

- **Cold-start latency**: the first search hitting the OpenAIRE FTS after a restart is slow (cold page cache over a 50 GB file). The search route has a **2-second timeout guard** — main SciSciNet results are never delayed; OpenAIRE results just appear once warm. Optional improvement: add one query that matches OpenAIRE titles to the cache-warm list invoked by `scripts/start-with-cache.sh`.
- **Worker pools**: OpenAIRE search runs on a dedicated 2-worker pool (512 MB cache each) — separate from the main 4-worker journals.db pool. If `data/openaire.db` is missing at process start, the pool marks itself unavailable until restart.
- **Known data gap**: papers added to SciSciNet after 2026-01-29 (the dev backup date) have no OpenAIRE enrichment. Self-heals at the next dump-version refresh (procedure in `HANDOFF.md`; all import scripts are in `scripts/openaire_*.py`).
- **Abstracts DB is optional**: if it must be deferred, everything else works; the abstract endpoint returns `{abstract: null}`.

## Rollback

- Data only: `rm data/openaire.db data/openaire_abstracts.db` and restart — all features disappear gracefully.
- Code: `git revert` the OpenAIRE integration commit and rebuild. No other database or config is touched by this deployment.

## Report back

After deploying, report: the six curl results (pass/fail), build output status, and remaining disk free. If any sanity count differs or `sha256sum -c` fails, stop before switching anything and report — the dev copy of both DBs still exists at `~/openaire-build/` on the dev machine.
