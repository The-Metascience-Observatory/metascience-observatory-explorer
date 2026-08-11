# HANDOFF: OpenAIRE Graph Bulk Integration

Status: **DATA PIPELINE COMPLETE + APP INTEGRATION BUILT** (2026-08-11). All import passes have run on the dev machine; all app surfaces are coded and tested against the real data. What remains: prod deployment (see "Deployment" below).

Final build artifacts (dev machine, `~/openaire-build/`):
- `openaire.db` **50.3 GB** — projects 3.9M; paper_openaire 140.9M (enrichment); openaire_papers 33.5M (first-class, FTS-indexed); paper_projects 7.86M; paper_linked_products 8.13M; org_openaire 110.1K; org_projects 1.09M
- `openaire_abstracts.db` **45.3 GB** — 14.7M abstracts (optional ship)
- `lookup.db` (8 GB) + `stage.db` (54 GB) — build artifacts, safe to delete after prod ships
- Dev `data/` uses symlinks into `~/openaire-build/` and the Seagate backup; the `data/` dir carries the `user.com.dropbox.ignored=1` xattr so Dropbox won't sync it

## Deployment to prod
1. rsync `openaire.db` (50.3 GB) to prod `data/` (check headroom first); optionally `openaire_abstracts.db` (45.3 GB) — everything degrades gracefully without it
2. Deploy the code (all changes are in the repo: lib/db.ts, lib/worker-pool.ts, lib/db-worker.js, lib/types.ts, lib/counts.ts, grants/search/by-doi/doi routes, papers+affiliations pages, components/OpenairePanels.tsx, PaperCard.tsx, new /papers/openaire/[id] + /api/papers/openaire/[id](+/abstract) + /api/papers/[paperid]/openaire + /api/affiliations/[institutionid]/openaire)
3. Warm note: first FTS query against openaire_title_fts is cold-slow; consider adding one openaire search to the cache-warm list

Known post-launch gaps (acceptable, documented): papers added to prod after the 2026-01-29 backup aren't matched; refresh by re-running the pipeline against the next OpenAIRE dump release (scripts are all in scripts/, resumable, with a chain runner pattern in ~/openaire-build/run_chain.sh).

---

The original plan follows (kept for the next dump-version refresh; all passes below have been executed — see import_meta table in openaire.db for timestamps).

## Goal

Integrate the OpenAIRE Graph (https://graph.openaire.eu) into the Metascience Observatory Explorer via a **bulk-dump import** into a new `data/openaire.db`, surfacing five features (all chosen by Dan):

1. **Paper detail page**: open-access status (gold/green/bronze/hybrid, diamond) + linked projects/grants incl. EU/Horizon funding
2. **Paper detail page**: linked datasets & software
3. **Grants API**: resolve EU/EC grant codes locally (alongside the existing NIH/NSF live lookups)
4. **Affiliation pages**: organization enrichment (OpenAIRE org record + project portfolio), joined via ROR
5. **NEW PAPERS**: ingest DOI-bearing OpenAIRE publications that SciSciNet lacks (~20–50M) as **first-class papers** — searchable (FTS), own detail pages, journal links via ISSN, author links via ORCID, with abstracts. See **"EXTENSION: First-class OpenAIRE papers"** at the bottom — it AMENDS several passes and sizes in the base plan (openaire.db grows to ~55–60 GB; Pass 1/3/4 change; Phases 6–7 added). Read the base plan first, then the extension.

**Affiliation-data scope note** (decided): keep OpenAIRE org entities + funder-declared project→org participant links; do NOT import OpenAIRE's paper→org affiliation links (SciSciNet's OpenAlex-derived affiliations are better) — and author lists are stored as display strings, linked only via validated ORCID.

## Background research (already done — trust this)

**OpenAIRE Graph**: EU-funded open scholarly knowledge graph. ~387M research products (publications, datasets, software) linked to 3.9M projects/grants, 494K organizations, funders, data sources. **License: CC-BY 4.0** — add attribution/citation to the About page and README.

**What it adds that SciSciNet-V2 lacks**: EU/European grant links (the local `person_funding` table has only NIH/NSF/blank funders — verified), per-paper OA color, linked datasets/software (Scholix-style), ROR-keyed org records.

**Bulk dump**: Zenodo DOI `10.5281/zenodo.3516917`, v11.1.1 (June 2026), tar archives of gzipped JSON-lines (one JSON object per line), 378 GB total, split by entity:

| File(s) | Size | Contents |
|---|---|---|
| `publication_1..15.tar` | ~156 GB | 218.4M publications |
| `dataset_1..3.tar` | ~25 GB | 101.8M datasets |
| `software.tar` | 258 MB | 730K software records |
| `otherresearchproduct_1..2.tar` | — | 37.8M records |
| `project.tar` | 722 MB | 3.9M projects (grant code, funder, stream, dates, budget) |
| `project_produces.tar` | 432 MB | project→result relations |
| `project_hasParticipant.tar` | 159 MB | project→org relations |
| `organization.tar` (+IsChildOf, provides) | ~45 MB | 494K orgs (ROR, names, country) |
| `product_Cites_*` | ~76 GB | **SKIP** — SciSciNet already has citations |
| `datasource_*` | ~24 GB | **SKIP** |
| `person*` | ~12 GB | skip for now |

Download ~280 GB (everything except Cites/datasource/person). Phased: project/org/relation tars (~2 GB) first — unblocks Phase 1 immediately.

**Live API (not used here, for reference/fallback)**: `https://api.openaire.eu/graph/v3/` — `researchProducts` (searchable by `pid` = DOI/PMID), `projects`, `organizations`, `dataSources`. 60 req/hr anonymous, 7,200 req/hr with free registration (OAuth token).

## Machine / disk layout (decided with Dan)

**All heavy work runs on the DEV machine** (this one), not prod:

- Raw dumps → `/media/dan/Seagate Portable Drive/openaire-graph-v11/` (NTFS rw, 934 GB free). **CHANGED from /media/dan/3C10A98A10A94C28**: that drive is stuck read-only (NTFS unsafe-state flag) AND logged MFT I/O errors — don't use it without an `ntfsfix`/SMART check.
- Zenodo record id for v11.1.1 is **20428976**; file URLs are `https://zenodo.org/api/records/20428976/files/<name>/content` (use `wget -c` for resume).
- **Pass-0 finding (confirmed from file inventory)**: result↔result relations ship as SEPARATE relation tars (`product_IsSupplementedBy.tar` 120 MB, `product_References.tar` 230 MB, `product_HasPart.tar` 270 MB, `product_IsRelatedTo_1.tar` 9.7 GB…) → Pass 4b runs in relation-files mode.
- SQLite builds (`lookup.db` ~12 GB, `openaire.db` ~30 GB) → internal NVMe, e.g. `~/openaire-build/` (370 GB free). Do NOT build SQLite on the NTFS drive (ntfs-3g/FUSE random-write performance is terrible).
- Pass-1 source DBs → backup at `/media/dan/Seagate Portable Drive/sciscinet-dashboard_database_backup_01_29_2026/data/` (`journals.db`, `papers_extra.db` both present). Scripts must take `--journals-db`/`--papers-extra-db` path args so they also run on prod later.
- Ship: rsync the finished `openaire.db` (~25–30 GB) to prod's `data/`. Confirm prod disk headroom first.
- Known gap: the backup is dated 2026-01-29 → papers added to prod since then won't match. Acceptable; self-heals on the next dump-version refresh.

## Verified codebase facts (checked against the backup DBs — don't re-derive)

- `paper_summary.doi`: lowercase, stored **WITH** `https://doi.org/` prefix (158.6M of 249.8M rows have DOI). `paperid` is OpenAlex-style text, e.g. `W2427290012`.
- `papers_extra.db` → `paper_pubmed(paperid, pmid, pmcid)` for PMID fallback matching (index on paperid only — build your own pmid-keyed lookup).
- `affiliation_summary.ror`: populated on 110,552/110,553 rows, stored as **bare ROR id** (e.g. `032k75171`, no URL prefix) → org join via ROR is nearly total; skip name-matching fallback.
- `app/api/grants/route.ts`: `identifyFunderType()` (line ~102) returns `'NIH' | 'NSF' | 'OTHER'`; EU funders currently only get a CORDIS search URL via `getFunderUrl()`. GET branch ~line 227, POST branch ~line 312.
- Paper detail page (`app/papers/[paperid]/page.tsx`) is a client component with one fail-soft `useEffect` per enrichment source (retraction effect ~lines 305–320 is the shape to copy). It has no funding section today.
- Optional-DB pattern: `getMeshDb()` in `lib/db.ts:179–190` — lazy, readonly, `fileMustExist`, catch → return null; API routes degrade gracefully.
- CLAUDE.md convention: independently-updatable sources get their **own DB** → hence `data/openaire.db`.

## Part 1 — `data/openaire.db` schema

All tables drop-and-recreated by scripts; DB opened readonly by the app. Target size ~25–30 GB.

```sql
-- One row per SciSciNet paper matched to an OpenAIRE product (openaire_id is the
-- relation-translation key, so ALL matched papers are stored, not just OA ones)
CREATE TABLE paper_openaire (
  paperid TEXT PRIMARY KEY, openaire_id TEXT NOT NULL, matched_via TEXT, -- 'doi'|'pmid'
  oa_color TEXT, best_access_right TEXT,
  is_green INTEGER, is_diamond INTEGER, publicly_funded INTEGER
) WITHOUT ROWID;
CREATE INDEX idx_paper_openaire_oaid ON paper_openaire(openaire_id);

-- FULL projects table (3.9M rows) for grant-code lookup
CREATE TABLE projects (
  openaire_project_id TEXT PRIMARY KEY, code TEXT, acronym TEXT, title TEXT,
  funder_shortname TEXT, funder_name TEXT, funding_stream TEXT, jurisdiction TEXT,
  start_date TEXT, end_date TEXT, total_cost REAL, funded_amount REAL,
  currency TEXT, website_url TEXT
) WITHOUT ROWID;
CREATE INDEX idx_projects_funder_code ON projects(funder_shortname, code);
CREATE INDEX idx_projects_code ON projects(code);

-- Denormalized paper→project (query by paperid)
CREATE TABLE paper_projects (
  paperid TEXT NOT NULL, openaire_project_id TEXT NOT NULL,
  code TEXT, acronym TEXT, title TEXT, funder_shortname TEXT, funding_stream TEXT,
  PRIMARY KEY (paperid, openaire_project_id)
) WITHOUT ROWID;

-- Denormalized paper→linked dataset/software
CREATE TABLE paper_linked_products (
  paperid TEXT NOT NULL, target_openaire_id TEXT NOT NULL,
  relation TEXT, product_type TEXT, -- 'dataset'|'software'|'other'
  title TEXT, doi TEXT, publisher TEXT, year INTEGER,
  PRIMARY KEY (paperid, target_openaire_id)
) WITHOUT ROWID;

-- Org enrichment keyed by SciSciNet institution id (matched via ROR)
CREATE TABLE org_openaire (
  institution_id TEXT PRIMARY KEY, openaire_org_id TEXT NOT NULL, ror TEXT,
  legal_name TEXT, legal_shortname TEXT, country_code TEXT, project_count INTEGER
) WITHOUT ROWID;
CREATE INDEX idx_org_openaire_oaid ON org_openaire(openaire_org_id);

CREATE TABLE org_projects (
  institution_id TEXT NOT NULL, openaire_project_id TEXT NOT NULL,
  PRIMARY KEY (institution_id, openaire_project_id)
) WITHOUT ROWID; -- details joined from projects at query time

CREATE TABLE import_meta (key TEXT PRIMARY KEY, value TEXT); -- dump version, completed tars, counts
```

If `paper_openaire` size becomes a problem: store only the 32-hex md5 suffix of OpenAIRE ids (relations translate via the same suffix) — saves ~8 GB. Only do this if needed.

## Part 2 — Import pipeline (`scripts/`, Python)

Follow existing conventions (`scripts/process_papers_extra.py` is the template): argparse (`--dump-dir`, `--db-path`, `--rebuild`), drop-and-recreate own tables, `PRAGMA journal_mode=OFF; synchronous=OFF` during load, create indexes after load, print verification stats. Add `orjson` to `scripts/requirements.txt`.

**Shared helper `scripts/openaire_common.py`**:
- `stream_tar_jsonl(tar_path)` — `tarfile.open(mode='r|')` → per-member `gzip.GzipFile(fileobj=...)` → per-line `orjson.loads`; never extracts to disk
- `normalize_doi(raw)` — lowercase, strip `https://doi.org/` / `http://dx.doi.org/`, require it starts with `10.`, else None
- `extract_pids(record)` — pid list → `{'doi': [...], 'pmid': [...]}`

**Pass 0 — schema verification (cheap, DO FIRST before coding Pass 3+)**:
```bash
tar -xOf publication_1.tar --wildcards '*.gz' | head -c 2M | zcat 2>/dev/null | head -1 | python3 -m json.tool | less
```
Confirm: (a) exact JSON paths for `bestAccessRight` and OA color / `isGreen` / `isInDiamondJournal` / `publiclyFunded` (v11 model expected top-level on Result, but dump schema has drifted across versions — see schema DOI `10.5281/zenodo.4238938`); (b) whether result↔result relations are **embedded in records or separate relation tars** (check the Zenodo file list for `product_IsSupplementedBy`-style names) — Pass 4b is dual-mode on this answer.

**Pass 1 — `openaire_build_lookup.py`** (`--journals-db`, `--papers-extra-db`, `--output`): staging `lookup.db` (NVMe, not shipped): `doi_lookup(doi PK, paperid)` from `paper_summary` (normalized; first-wins on collisions, print dupe counts) + `pmid_lookup(pmid PK, paperid)` from `paper_pubmed`. ~190M rows, ~30–45 min, ~12 GB.

**Pass 2 — `openaire_import_projects.py`**: stream `project.tar` → full `projects` table. Minutes. Verify: funder distribution (`EC` should be prominent), spot-check a known ERC grant code.

**Pass 3 — `openaire_import_publications.py`**: stream `publication_*.tar` (218M records) in ~10K batches: extract pids → DOI match first, PMID fallback against attached `lookup.db` → insert slim rows into `paper_openaire`. Resumable per-tar via `import_meta`. Est. 3–8 h. Verify: matched count (expect ~100–150M), oa_color distribution, spot-check 5 DOIs against OpenAIRE Explore.

**Pass 4a — `openaire_import_relations.py`**: stream `project_produces.tar`: translate result id via `idx_paper_openaire_oaid`; if matched, join project details from `projects` → `paper_projects`. <1 h.

**Pass 4b — `openaire_import_linked_products.py`** (`--mode relation-files|embedded`, per Pass 0): resolve result→result relations whose source matches `paper_openaire`, collect target-id set (temp SQLite table if >~50M), then stream `dataset_*.tar` + `software.tar` + `otherresearchproduct_*.tar` keeping only referenced targets → `paper_linked_products`. 1–3 h.

**Pass 5 — `openaire_import_organizations.py`**: stream `organization.tar`: ROR pid → bare id (strip `https://ror.org/`) → join in-memory `affiliation_summary.ror → institution_id` map (110K rows from journals.db) → `org_openaire`. Then `project_hasParticipant.tar` → `org_projects` + `project_count` update. Minutes.

Finally: `ANALYZE;`, copy `openaire.db` into `data/` (dev), rsync to prod `data/` when ready.

## Part 3 — lib changes

- **`lib/db.ts`**: add `getOpenaireDb(): Database.Database | null` — copy `getMeshDb()` pattern exactly (lib/db.ts:179–190).
- **`lib/types.ts`**: add `OpenairePaperInfo` (oaColor, bestAccessRight, isGreen, isDiamond, publiclyFunded), `OpenaireProject` (code, acronym, title, funderShortname, fundingStream, startDate, endDate, fundedAmount, currency), `OpenaireLinkedProduct` (productType, title, doi, relation, year), `OpenaireOrgInfo` (legalName, countryCode, projectCount, projects). No `any` (strict TS).

## Part 4 — API routes

- **`app/api/papers/[paperid]/openaire/route.ts`** (new; template: `app/api/papers/[paperid]/mesh/route.ts`): if `getOpenaireDb()` is null → `{ openaire: null, projects: [], linkedProducts: [] }`; else three indexed lookups (limit ~50 each). Wrap in `errorResponse(error, "papers/[paperid]/openaire")` from `lib/api-utils.ts`.
- **`app/api/grants/route.ts`** (extend in place):
  - `identifyFunderType()` → add `'EC'` return for `/european commission|european research council|horizon|h2020|fp7|erc|european union/i`
  - New `lookupEcProject(awardId)`: extract the 5–7-digit run (EC codes look like `695402`, `101017441`), query `projects WHERE funder_shortname='EC' AND code=?`; on multi-hit prefer latest `start_date`; null-safe fall-through to the existing CORDIS-URL behavior. Wire into both GET and POST branches before the `OTHER` fallback. Local lookup → no `grant_cache` writes.
  - Map to `GrantDetails`: title/funded_amount/start_date/end_date, `url = https://cordis.europa.eu/project/id/{code}`.
- **`app/api/affiliations/[institutionid]/openaire/route.ts`** (new sub-route; leave main route untouched): `{ org: OpenaireOrgInfo | null }` — `org_openaire` row + top ~25 projects (`org_projects JOIN projects` ordered by `funded_amount DESC, start_date DESC`).

Note: `openaire.db` is NOT in the worker pool — use `getOpenaireDb()` directly (same as mesh/retractions).

## Part 5 — UI

- **`app/papers/[paperid]/page.tsx`**: one new fail-soft `useEffect` fetching `/api/papers/{id}/openaire` (copy the retraction effect ~lines 305–320; works off paperid alone, no chaining). Render, each guarded on non-empty data:
  - **OA badge** pill next to existing metadata badges (gold/green/bronze/hybrid colors + "Diamond OA" tag)
  - **Funding card**: projects styled like the persons-page grant cards; EC entries link to `https://cordis.europa.eu/project/id/{code}`
  - **Linked datasets & software card**: type icon, title, `https://doi.org/{doi}` link with lucide `ExternalLink`
  - Extract into `components/OpenairePanels.tsx` if the page bloats
- **Persons page**: no change — the grants-route EC branch upgrades EU-funder cards automatically.
- **`app/affiliations/[institutionid]/page.tsx`**: fail-soft effect → "EU & national projects (OpenAIRE)" section (project count + top-projects table: funder, code, acronym, title, amount, years). Hidden when null.
- **About page + README data-sources table**: add OpenAIRE Graph CC-BY attribution and citation (Manghi et al., OpenAIRE Graph, Zenodo, DOI 10.5281/zenodo.3516917).

## Part 6 — Phasing (each independently shippable)

1. **EU grant lookup** — Pass 0 + `openaire_common.py` + Pass 2 (only 722 MB of data needed!) + `getOpenaireDb()` + grants-route EC branch
2. **OA status** — Pass 1 + Pass 3; paper `/openaire` sub-route (projects/linkedProducts empty for now); OA badge
3. **Paper funding cards** — Pass 4a; Funding card UI
4. **Linked datasets/software** — Pass 4b; card UI
5. **Org enrichment** — Pass 5; affiliations sub-route + page section

## Verification

1. After Pass 2: `sqlite3 openaire.db "SELECT funder_shortname, COUNT(*) FROM projects GROUP BY 1 ORDER BY 2 DESC LIMIT 15"`; check a known ERC code exists.
2. Pick 2–3 DOIs from a CORDIS project's "results" page → `curl localhost:3000/api/papers/by-doi/10.xxxx/yyyy` → get paperid → `curl localhost:3000/api/papers/{paperid}/openaire` → expect oaColor + the EC project (+ linked datasets after Phase 4).
3. `curl -X POST localhost:3000/api/grants -H 'Content-Type: application/json' -d '{"grants":[{"award_id":"101017441","funder":"European Commission"}]}'` → title/amount populated from local DB.
4. `curl localhost:3000/api/affiliations/{id}/openaire` for a large EU university (find id via `/api/affiliations/search?q=ETH`).
5. Negative test: rename `data/openaire.db` → all three endpoints return empty/null gracefully; pages render without the panels.
6. `npm run lint` && `npm run build`.

## Open risks

- **JSON field-path drift** across dump versions — Pass 0 must confirm paths before Pass 3 is coded.
- **Result-result relation location** (embedded vs separate tars) unknown until Pass 0 — Pass 4b is dual-mode; worst case, linked products fall back to the live API (`pid` search, 7,200 req/hr authenticated).
- **Download time**: ~280 GB from Zenodo can take a day with throttling; use `wget -c` or `zenodo_get` with resume; download the small tars first.
- **Disk**: dev layout verified; `openaire.db` adds ~25–30 GB to prod's `data/` — confirm prod headroom before rsync.
- **EC code ambiguity** across FP7/H2020/Horizon Europe (same numeric code space): constrain by `funder_shortname='EC'`, prefer latest `start_date`.
- **Malformed/duplicate DOIs** in `paper_summary` (observed, e.g. `10.0/123.873.3`): first-wins + dupe counters in Pass 1 output.
- **Stale backup**: dev matching runs against the 2026-01-29 backup → papers added to prod since then stay unmatched until the next dump refresh.

---

# EXTENSION: First-class OpenAIRE papers

Ingest OpenAIRE publications SciSciNet doesn't have (DOI-bearing only, deduped by normalized DOI + PMID fallback) as first-class papers: searchable, own detail pages, journal links via ISSN, author links via validated ORCID only (no name matching), abstracts stored. This section AMENDS the base plan above.

## Verified codebase facts (checked against the Seagate backup — trust these)

- `person_summary` HAS an `orcid` column stored as full URL (`https://orcid.org/0000-...`); est. **~7–9M of ~100.4M rows** have one; **no index on orcid** → Pass 1 must full-scan. Persons route queries `person_summary WHERE authorid = ?` (`app/api/persons/[authorid]/route.ts:38–40`) so ORCID-matched authors link straight to `/persons/{authorid}`.
- `journal_summary.issn` is a **JSON array of hyphenated ISSNs** (sometimes literal string `null`); 147,672/260,918 journals have a real ISSN. Port `normalize_issn`/`build_issn_index` from `scripts/import_journal_enrichment.py:37–73` (handles JSON-array + bare + `'null'`, first-wins).
- Search-merge precedent: `app/api/journals/search/route.ts:128–186` — main results via workerQuery, then Scopus-only FTS via `getDb()` in try/catch, tagged `scopus_only: true`, appended after main, sliced, cached combined. `components/JournalCard.tsx:16,37` branches href + renders badge.
- Lite-paper precedent: `app/papers/[paperid]/page.tsx:224–235` (404 → `/lite` fallback); scopus journal namespace precedent: `/journals/scopus/[scopusid]`.
- DOI resolution: `app/api/papers/by-doi/[...doi]/route.ts:18–22` and `app/doi/[...doi]/page.tsx:15–27` try prefixed + bare DOI then redirect to doi.org.
- **`lib/db-worker.js:15` already reads `workerData.dbPath`** but `lib/worker-pool.ts:44–45` hardcodes journals.db → a second pool needs only a `dbPath` constructor param.
- `abstracts.db` schema: `paper_abstracts(paperid PK, title, abstract, language)`; abstract route degrades to `{abstract: null}`.
- `PaperSearchItem` = `{paperid, title, doi, year, cited_by_count, source_name}` (`lib/types.ts:353–360`); `components/PaperCard.tsx:18` hardcodes `/papers/${paperid}` href.

## Key decisions

- **ID scheme**: `OA` + 32-hex md5 (suffix of the OpenAIRE `50|...::<hex>` id), regex `^OA[0-9a-f]{32}$`. No collision with SciSciNet `W\d+` ids.
- **Own route namespace** `/papers/openaire/[id]` + `/api/papers/openaire/[id]` (Scopus-journal precedent) — do NOT prefix-dispatch inside the hot 1,099-line `/papers/[paperid]` page. Enrichment tables (`paper_projects`, `paper_linked_products`) store `OA…` strings in their paperid column, so the base plan's `/api/papers/[paperid]/openaire` sub-route works for both ID kinds untouched.
- **Abstracts in a separate `data/openaire_abstracts.db`** (~25–40 GB, optionally shipped; mirrors the abstracts.db precedent; keeps openaire.db rsync-able).
- **Search threading**: FTS over ~30M titles is 100–500 ms cold — never on the main thread. Parameterize `DatabaseWorkerPool` with `dbPath`, add a **2-worker pool** on openaire.db (`getOpenaireWorkerPool()` / `openaireWorkerQuery()`); init failure (file absent) → cached failed state, search route catches per-request and skips OpenAIRE results.
- **Dedup (OpenAIRE-internal DOI dupes)**: stage-then-finalize. Metadata score = `4*has_abstract + 2*(author_count>0) + 1*has_issn + 1*has_journal_name + min(len(title),200)/200`; winner per DOI via `ROW_NUMBER() OVER (PARTITION BY doi ORDER BY score DESC)`.

## DDL additions

### openaire.db (note: `openaire_papers` is a NORMAL rowid table so FTS can be external-content)

```sql
CREATE TABLE openaire_papers (
  id TEXT NOT NULL,              -- 'OA' + 32-hex (canonical app id)
  openaire_id TEXT NOT NULL,     -- full '50|...' id (relation translation key)
  doi TEXT NOT NULL,             -- normalized: lowercase, bare, starts '10.'
  pmid TEXT,
  title TEXT, subtitle TEXT,
  publication_date TEXT, year INTEGER,
  type TEXT, language TEXT, publisher TEXT,
  journal_name TEXT, issn_printed TEXT, issn_online TEXT,
  matched_sourceid TEXT,         -- journal_summary.sourceid via ISSN, nullable
  volume TEXT, issue TEXT, start_page TEXT, end_page TEXT,
  best_access_right TEXT, oa_color TEXT,
  is_green INTEGER, is_diamond INTEGER, publicly_funded INTEGER,
  author_count INTEGER, has_abstract INTEGER
);
CREATE UNIQUE INDEX idx_oap_id  ON openaire_papers(id);
CREATE UNIQUE INDEX idx_oap_doi ON openaire_papers(doi);
CREATE INDEX idx_oap_oaid ON openaire_papers(openaire_id);
CREATE INDEX idx_oap_pmid ON openaire_papers(pmid) WHERE pmid IS NOT NULL;

CREATE TABLE openaire_paper_authors (
  id TEXT NOT NULL, rank INTEGER NOT NULL,   -- authors capped at 500/paper
  full_name TEXT, orcid TEXT,                -- bare 19-char, validated scheme only
  matched_authorid TEXT,                     -- person_summary.authorid via ORCID
  PRIMARY KEY (id, rank)
) WITHOUT ROWID;
CREATE INDEX idx_oapa_matched ON openaire_paper_authors(matched_authorid)
  WHERE matched_authorid IS NOT NULL;

CREATE VIRTUAL TABLE openaire_title_fts USING fts5(
  title, content='openaire_papers', content_rowid='rowid'
); -- populated after load from the content table
```

### openaire_abstracts.db
```sql
CREATE TABLE openaire_abstracts (id TEXT PRIMARY KEY, abstract TEXT, language TEXT) WITHOUT ROWID;
```

### lookup.db additions (Pass 1)
```sql
CREATE TABLE orcid_lookup (orcid TEXT PRIMARY KEY, authorid TEXT, works_count INTEGER) WITHOUT ROWID;
CREATE TABLE issn_lookup  (issn  TEXT PRIMARY KEY, sourceid TEXT) WITHOUT ROWID;
```

### stage.db (NVMe scratch, ~65 GB, deleted after finalize)
```sql
CREATE TABLE stage_candidates (
  hex TEXT NOT NULL, doi TEXT NOT NULL, score REAL NOT NULL,
  payload BLOB NOT NULL   -- orjson slim fields incl. authors[<=500] + abstract
); -- index (doi, score DESC) after stream
```

## Pipeline AMENDMENTS to the base plan

- **Pass 0 additions**: confirm author array path + pid scheme names — link on validated `orcid` scheme ONLY, treat `orcid_pending` as plain text; confirm container/journal field names (`container.issnPrinted/issnOnline/issnLinking`, vol/iss/sp/ep) and the `descriptions` path for abstracts.
- **Pass 1 additions**: `build_orcid_lookup()` — full scan `person_summary WHERE orcid IS NOT NULL` (no index; +15–40 min from USB), strip URL prefix, collisions keep highest `works_count`, print collision count. `build_issn_lookup()` — port `build_issn_index` verbatim. lookup.db 12 → ~13 GB.
- **Pass 3 REDESIGN — one stream, two outputs**: per record: matched → slim `paper_openaire` row (as before); unmatched AND has valid DOI → extract payload (title, subtitle, date, type, language, publisher, container, OA fields, authors≤500 with orcid, first English-ish description) → score → append `stage_candidates`; unmatched without DOI → drop. ISSN/ORCID resolution deferred to finalize (keeps 218M-iteration loop lean). Runtime 3–8 h → **4–10 h**.
- **Pass 3b NEW — `scripts/openaire_finalize_new_papers.py`** (`--stage-db --lookup-db --db-path --abstracts-db-path --rebuild`): index staging → per-DOI winners → load issn/orcid lookups into RAM (~2 GB) → resolve `matched_sourceid` (printed→online→linking) + per-author `matched_authorid` → insert papers/authors/abstracts → build FTS from content table → index → ANALYZE → stats (new-paper count, % journal-matched, % authors ORCID-matched, dupes discarded, abstract coverage) → drop stage.db. ~1.5–3 h.
- **Pass 4a/4b CHANGE**: run AFTER Pass 3b; result-id translation consults BOTH `paper_openaire(openaire_id→paperid)` AND `openaire_papers(openaire_id→id)`, writing whichever matches.

## App changes

- **lib/db.ts**: add `getOpenaireAbstractsDb()` (getMeshDb pattern).
- **lib/worker-pool.ts**: `constructor(poolSize = 4, dbPath?)` → pass `dbPath` via workerData (db-worker.js already reads it); add `getOpenaireWorkerPool()` (2 workers) + `openaireWorkerQuery<T>()`; failed init must cache the failure, not retry-spin.
- **lib/types.ts**: `OpenairePaperSummary`, `OpenairePaperAuthor`, `OpenairePaperDetails`; add optional `openaire?: boolean` to `PaperSearchItem`; `cited_by_count` becomes nullable.
- **app/api/papers/search/route.ts**: alongside the main workerQuery (Promise.all), when `offset === 0`: try `openaireWorkerQuery` — `SELECT p.id AS paperid, p.title, p.doi, p.year, NULL AS cited_by_count, p.journal_name AS source_name FROM openaire_title_fts f JOIN openaire_papers p ON p.rowid = f.rowid WHERE openaire_title_fts MATCH ? ORDER BY rank LIMIT 10` — tag `openaire: true`, append AFTER SciSciNet results, catch → skip. Existing cache key covers the combined response.
- **components/PaperCard.tsx**: href branch (`/papers/openaire/` + id when `openaire`), "OpenAIRE" pill (JournalCard.tsx:37 badge style), hide citation row when `cited_by_count == null`.
- **app/api/papers/openaire/[id]/route.ts** NEW: validate id regex → 400; `getOpenaireDb()` null → 404; paper + authors (ORDER BY rank LIMIT 500); resolve `journal_summary.display_name` via `getDb()` when `matched_sourceid`; `errorResponse`.
- **app/api/papers/openaire/[id]/abstract/route.ts** NEW: copy existing abstract route shape against `openaire_abstracts`.
- **app/papers/openaire/[id]/page.tsx** NEW client page (model: lite-branch of the paper page + scopus journal banner): "Source: OpenAIRE Graph" banner; journal line links to `/journals/{sourceid}` when matched else plain name+ISSN; authors link to `/persons/{authorid}` when ORCID-matched else plain text (ORCID icon → orcid.org when present); DOI link; OA badges; fail-soft effects for `/api/papers/OA…/openaire` (funding + linked products work as-is) and the abstract sub-route.
- **by-doi route + /doi page**: on `paper_summary` miss, one indexed `openaire_papers WHERE doi = ?` lookup → `{paperid: id, openaire: true}` / redirect to `/papers/openaire/{id}`; else doi.org as today.
- **lib/counts.ts**: add `openairePapers: <count from import stats>`; update search-UI copy to "SciSciNet + OpenAIRE Graph".

## Revised sizes / runtimes

| Item | Estimate |
|---|---|
| New papers | 20–50M (plan ~30–35M) |
| openaire.db TOTAL (was 25–30 GB) | **~55–60 GB** |
|   └ openaire_papers + idx / authors / FTS | ~14–18 / ~8–10 / ~4–5 GB |
| openaire_abstracts.db (optional ship) | ~25–40 GB |
| stage.db (temp NVMe) | ~65 GB |
| Pass 3 unified stream | 4–10 h |
| Pass 3b finalize | 1.5–3 h |

## Phasing (replaces base Part 6 numbering from Phase 2 on)

The 156 GB publications set is streamed ONCE — the dual-output Pass 3 must be in place before the base plan's Phase 2 runs:

1. **Phase 1** — EU grant lookup (unchanged)
2. **Phase 2'** — OA status: Pass 1 (now incl. orcid/issn lookups) + unified Pass 3 (staging written, not yet consumed); ships OA badges
3. **Phases 3–5** — as base plan, except Pass 4a/4b run after Phase 6 and translate against both tables
4. **Phase 6 NEW** — OpenAIRE papers core: Pass 3b; `getOpenaireAbstractsDb`; worker-pool `dbPath` + openaire pool; detail page + API + abstract route; by-doi + /doi fallbacks. Independently shippable (papers DOI-reachable before search exposes them)
5. **Phase 7 NEW** — search merge + PaperCard badge + counts/copy. Verify: search a niche EU-repository title; open an OA paper page; ORCID author link lands on the right `/persons/` page; negative test (rename openaire.db → search returns SciSciNet-only, `/papers/openaire/*` 404s gracefully); `npm run lint && npm run build`

## Additional risks

- **Prod disk**: openaire.db ~doubles vs base plan (~60 GB) + optional 40 GB abstracts — confirm headroom before rsync; abstracts DB can be deferred indefinitely (null-graceful).
- **Residual duplicates**: SciSciNet papers with malformed/missing DOIs will reappear as OpenAIRE papers (accepted; PMID fallback trims some).
- **Ranking**: OpenAIRE results have no citation counts → appended after SciSciNet results rather than merged by relevance (orderings incomparable: cited_by_count vs bm25).
- **ISSN collisions**: multiple sourceids per ISSN → first-wins with printed counts (same as import_journal_enrichment.py).
