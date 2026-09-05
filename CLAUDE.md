# CLAUDE.md

## Project: Metascience Observatory Explorer

A Next.js dashboard for exploring the SciSciNet-V2 dataset — a large-scale science-of-science data lake. Provides search and detail views across papers, researchers, journals, institutions, funders, research fields, MeSH terms, retractions, and clinical trials.

Citation: Lin, Z., Yin, Y., Liu, L. et al. *SciSciNet: A large-scale open data lake for the science of science research.* Sci Data 10, 315 (2023).

## Tech stack

- **Framework**: Next.js 15 (App Router) + React 18 + TypeScript 5 (strict)
- **Database**: SQLite via `better-sqlite3` (readonly, memory-mapped)
- **Styling**: Tailwind CSS
- **Viz**: Recharts, D3, react-simple-maps
- **Runtime**: Node.js, Linux (native module)

## Commands

```bash
npm run dev          # Next.js dev server (hot reload)
npm run build        # Production build
npm start            # Prod server + cache warming (runs scripts/start-with-cache.sh)
npm run start:no-warm # Prod server without cache warming
npm run warm-cache   # Manual cache warming (curl /api/cache/warm)
npm run lint         # ESLint
```

If `better-sqlite3` segfaults at startup, run `npm rebuild better-sqlite3` — the prebuilt native binary can go stale after Node/system updates.

## Data architecture

All databases live in [data/](data/) and are opened read-only (except `cache.db` and `analytics.db`).

| DB | Purpose |
|---|---|
| `journals.db` | **Main dataset** — papers, authors, journals, institutions, fields, citations, trials (`ctg_studies`), FTS indexes |
| `abstracts.db` | Full paper abstracts (~197GB) |
| `papers_extra.db` | PMID/PMCID mappings, newsfeed mentions |
| `mesh.db` | MeSH term hierarchy and paper-MeSH mappings |
| `retractions.db` | Retraction Watch data |
| `openaire.db` | OpenAIRE Graph — projects/grants, per-paper OA status, linked datasets/software, orgs, and 33.5M first-class OpenAIRE-only papers (`openaire_papers` + `openaire_title_fts`) |
| `openaire_abstracts.db` | Abstracts for first-class OpenAIRE papers |
| `openaire_citations.db` | BIP! impact indicators (`openaire_paper_impact`) + packed citation edges (`openaire_refs`, `openaire_cites`) |
| `cache.db` | **Writable** — grant (NIH/NSF) and ORCID API response cache with TTL |
| `analytics.db` | **Writable** — visitor logs and IP geolocation cache |

Optional databases (`abstracts`, `papers_extra`, `mesh`, `retractions`, `openaire`, `openaire_abstracts`, `openaire_citations`) return `null` from their getters if missing — APIs should handle this gracefully.

**Never `VACUUM` `openaire.db`.** Both `openaire_title_fts` and the citation edge
keys reference `openaire_papers.rowid`, which a vacuum may renumber. The rowid
epoch recorded in `openaire_citations.db.import_meta` guards against this;
`scripts/openaire_verify_citations.py` checks it.

### Verified column shapes — don't re-derive these

Measured against the live databases; each cost a multi-minute scan to establish, and
getting one wrong silently breaks a join rather than erroring.

| Column | Shape | Consequence |
|---|---|---|
| `paper_summary.doi` | lowercase, **WITH** the `https://doi.org/` prefix (158.6M of 249.8M rows) | normalize before joining to any external DOI |
| `paper_summary` | has **only `year`** — no month/day, no license, no type | publication-date work needs an external source |
| `affiliation_summary.ror` | **bare** id (`032k75171`, no URL prefix), on 110,552 of 110,553 rows | strip `https://ror.org/` from external ROR before joining |
| `journal_summary.issn` | **JSON array** of hyphenated ISSNs, sometimes the literal string `'null'`; 147,672 of 260,918 have a real one | reuse `build_issn_index` in `scripts/import_journal_enrichment.py:37-73` |
| `person_summary.orcid` | **full URL** (`https://orcid.org/0000-...`), **NO INDEX**, 7,648,321 of 100.4M rows (7.62%) | joining requires a full scan; use `openaire_build_lookup.py --only orcid` |
| `person_summary` | has only `last_known_institution`; `person_affiliations` *infers* history from papers | cannot see non-publishing periods, role titles, or PhD dates |
| `paper_references` | 2,494,545,461 rows; measured **6.4% coverage gap** vs Crossref | gap is real, but backfilling costs ~2.8B rows — measured, not stored |
| OpenAIRE ids | `namespace::md5hex`; `doi_dedup___::<hex>` and `doi_________::<hex>` are the SAME DOI | match on the bare hex (`openaire_hex()`), never the full string — but hex only bridges the *same* identifier kind, never `pdb`/`uniprot`/repo-local namespaces |

### OpenAIRE citation edges — [lib/openaire-citations.ts](lib/openaire-citations.ts)

`openaire_refs` / `openaire_cites` store one row per paper: a BLOB of little-endian
int64 neighbor keys, pre-sorted at build time by the neighbor's citation count
descending and capped at 1,000, plus the true pre-cap `total`. A key is
`+W_numeric` for a SciSciNet paper or `-openaire_papers.rowid` for an OpenAIRE-only
one, so lists mix both corpora — items carry an `openaire` flag so they link to the
right route. Because the blob is pre-sorted, a page is one PK seek plus a buffer
slice, and only the ≤100 ids on screen get resolved to titles. Resolution must go
through the worker pools (`workerQuery` for `journals.db`, `openaireWorkerQuery` for
`openaire.db`), never the main thread.

SciSciNet↔SciSciNet edges are deliberately dropped at import, so anything stored
against a `W…` key is a citation `journals.db` does *not* have.

### Connection patterns — [lib/db.ts](lib/db.ts)

Main DB uses aggressive performance pragmas: 8GB cache, 8GB mmap, WAL mode, `temp_store=MEMORY`. Grant cache TTL = 365 days; ORCID cache TTL = 90 days.

### Worker pool — [lib/worker-pool.ts](lib/worker-pool.ts), [lib/db-worker.js](lib/db-worker.js)

Because Next.js runs single-threaded, synchronous SQLite calls would block the event loop. The app uses a pool of **4 worker threads**, each with its own read-only connection to `journals.db` (2GB cache + 4GB mmap per worker). Queries are dispatched round-robin via `workerQuery()` / `workerQueryOne()`. Each worker caches prepared statements.

**When to use which**: Use `workerQuery`/`workerQueryOne` for queries against `journals.db` on hot paths (search, detail pages). Use `getDb()` directly only for synchronous startup work or small lookups. Use the other DB getters (`getAbstractsDb`, `getMeshDb`, etc.) directly — they're not in the worker pool.

### Search cache — [lib/search-cache.ts](lib/search-cache.ts)

In-memory LRU caches per entity type (papers, persons, journals, affiliations, funders, trials) with 10–15 min TTL. Cache keys are generated via `generateCacheKey(query, params)`. Total allocation ~10GB. Auto-cleanup every 5 min.

Search routes follow this pattern: build cache key → check cache → run worker query → store result → return. See [app/api/papers/search/route.ts](app/api/papers/search/route.ts) as the canonical example.

### Cache warming

`/api/cache/warm` pre-populates caches with common queries on server startup. Invoked by [scripts/start-with-cache.sh](scripts/start-with-cache.sh) after the server is ready.

### Full-text search (FTS5)

Several FTS5 virtual tables exist in `journals.db`:
- `paper_title_fts` — paper titles
- `person_fts` — author names
- `ctg_title_fts` — clinical trial titles
- `scopus_only_journals_fts` — Scopus-only journals

FTS query sanitization pattern (from [app/api/papers/search/route.ts](app/api/papers/search/route.ts)): split on whitespace, wrap each term as `"word"*` for prefix match, strip FTS special chars (`" * - ^ ( ) : AND OR NOT NEAR`).

**Perf gotcha**: `LIKE` with `LOWER()` forces a full table scan. Prefer FTS5, `=`, or range comparisons (`>= / <`) for prefix matches on indexed text columns.

## Entity routes

| Entity | Detail page | API detail | Search API |
|---|---|---|---|
| Papers | `/papers/[paperid]` | `/api/papers/[paperid]` (+`/abstract`, `/citations`, `/extra`, `/mesh`, `/retraction`, `/lite`) | `/api/papers/search`, `/api/papers/by-doi/[...doi]` |
| Persons | `/persons/[authorid]` | `/api/persons/[authorid]` (+`/publications`) | `/api/persons/search` |
| Journals | `/journals/[sourceid]`, `/journals/scopus/[scopusid]`, `/journals/top` | `/api/journals/[sourceid]` (+`/mesh`, `/publications`), `/api/journals/scopus/[scopusid]`, `/api/journals/top` | `/api/journals/search` |
| Affiliations | `/affiliations/[institutionid]` | `/api/affiliations/[institutionid]` | `/api/affiliations/search` |
| Funders | `/funders/[funderid]`, `/funders-map`, `/funders-map/[countryCode]` | `/api/funders/*`, `/api/grants` | `/api/funders/search` |
| Fields | `/fields/[fieldid]` | `/api/fields`, `/api/fields/[fieldid]`, `/api/fields/hierarchy` | — |
| Trials | `/trials/[nctid]` | `/api/trials/[nctid]` | `/api/trials/search` |
| MeSH | `/mesh/[meshui]` | `/api/mesh/[meshui]` (+`/papers`) | — |
| Retractions | `/retractions`, `/retractions/search` | `/api/retractions`, `/api/retractions/stats` | — |
| DOI redirect | `/doi/[...doi]` | — | — |

**Static counts** in [lib/counts.ts](lib/counts.ts) (`ENTITY_COUNTS`) are displayed in the UI immediately without an API call.

## Key libs

- [lib/db.ts](lib/db.ts) — DB initializers, grant/ORCID cache helpers
- [lib/worker-pool.ts](lib/worker-pool.ts) — `workerQuery`, `workerQueryOne`
- [lib/search-cache.ts](lib/search-cache.ts) — `searchCaches`, `generateCacheKey`, `getAllCacheStats`, `clearAllCaches`
- [lib/types.ts](lib/types.ts) — all entity TypeScript interfaces
- [lib/api-utils.ts](lib/api-utils.ts) — `errorResponse`, `parsePagination`, `validateQueryLength`, `fetchWithTimeout`
- [lib/analytics.ts](lib/analytics.ts) — `logVisitor`, `parseUserAgent`, `sanitizeString`
- [lib/counts.ts](lib/counts.ts) — `ENTITY_COUNTS` constants
- [lib/scopus.ts](lib/scopus.ts) — Scopus API integration for journal enrichment

## Middleware — [middleware.ts](middleware.ts)

- Rate limits: 1000 req/min per IP globally, 120 req/min on search endpoints (in-memory, resets on restart)
- Detects suspicious input (SQLi, XSS, path traversal patterns)
- Logs visitor metadata for analytics
- Sets security headers (also configured in [next.config.ts](next.config.ts): CSP, HSTS, X-Frame-Options, etc.)

## Environment variables — `.env.local`

| Var | Purpose |
|---|---|
| `SCOPUS_API_KEY` | Required for Scopus CiteScore enrichment |
| `SCOPUS_INST_TOKEN` | Optional Scopus institutional token |
| `ANALYTICS_TOKEN` | Required to access `/analytics?token=...` and `/api/analytics/stats` |
| `PORT` | Server port (default 3000) |

Analytics page usage: `http://localhost:3000/analytics?token=YOUR_TOKEN` — token is sent as `Authorization: Bearer` to `/api/analytics/stats` and compared timing-safely against `ANALYTICS_TOKEN`.

## Scripts — [scripts/](scripts/)

Import/preprocessing scripts are mostly Python and run against the SQLite databases. Notable ones:
- `import_journal_enrichment.py` — Scopus/DOAJ journal metadata
- `import_predatory_journals.py` — Beall's List
- `import_scopus_only_journals.py` — Scopus-exclusive journals
- `import_mesh_hierarchy.py`, `download_mesh.py` — MeSH data
- `export_trials_to_sqlite.py` — ClinicalTrials.gov import
- `create_fts_index.py`, `add_person_fts.py` — FTS5 index builders
- `compute_self_citations.py`, `create_citation_history.py` — derived metrics
- `start-with-cache.sh` — production start wrapper

## Conventions

- **API error handling**: Use `errorResponse(error, context)` from [lib/api-utils.ts](lib/api-utils.ts) — logs full error server-side, returns generic client message. SQLite busy errors become 503 with retry-after.
- **Pagination**: Use `parsePagination(searchParams, { limit, maxLimit })`. Standard cap is 100.
- **Query validation**: Use `validateQueryLength(query, maxLen)` before running searches.
- **Types**: All entity shapes live in [lib/types.ts](lib/types.ts). No `any`.
- **Readonly assumption**: Never write to `journals.db` from API routes. Writes belong in scripts, and the DB is opened `readonly: true` anyway.
- **DB choice**: When adding a new table, pick the database domain that matches (don't dump everything into `journals.db` if it can be updated independently — e.g. retractions, mesh, abstracts each live separately).
- **New search endpoint**: Follow the cache-key → cache-check → worker-query → cache-store → response pattern from [app/api/papers/search/route.ts](app/api/papers/search/route.ts).
