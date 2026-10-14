# Journal enrichment inputs

**Nothing in this directory is committed** (see `.gitignore`), for two reasons:

1. **Licensing.** The Scopus files are Elsevier's copyrighted compilations.
   Elsevier lets you download them, which is not the same as a right to
   republish them — and this repo is public. Redistributing them here would
   likely breach their terms.
2. **Size.** The two workbooks are 22 MB each and the DOAJ dump is 23 MB.
   They had previously grown `.git` to 353 MB; purging them brought it to
   2.3 MB.

This file exists so the database can be rebuilt from scratch without having to
rediscover where each input came from. Restore the files to the paths below and
the importers will find them.

## Files

### `scopus_source_title_list.xlsx` — **required**

The Scopus Source List: every title Scopus indexes, with ISSN/EISSN, coverage
years, CiteScore metrics, ASJC subject codes and Medline flags.

- **Source:** Elsevier — the Scopus content page at
  <https://www.elsevier.com/products/scopus/content>, under "Scopus Source
  List". Elsevier reorganises these pages periodically; if the link has moved,
  search their site for "Scopus Source List".
- **Terms:** © Elsevier. Free to download, **not** free to redistribute.
- **Edition in use:** `Nov. 2025` (48,094 sources).
- **Consumed by:**
  - `scripts/import_journal_enrichment.py` — CiteScore, SJR, SNIP, subject
    areas, Medline flags into `journal_enrichment`
  - `scripts/import_scopus_only_journals.py` — journals absent from OpenAlex
    into `scopus_only_journals` + its FTS index

> **Gotcha when you re-download.** Both scripts hardcode the worksheet name
> `'Scopus Sources Nov. 2025'` (`import_journal_enrichment.py:81`,
> `import_scopus_only_journals.py:135`). A newer edition ships a differently
> dated sheet (e.g. `Scopus Sources Jan. 2027`) and both will fail with a
> `KeyError`. Update both constants, and re-check the column indices just
> below them — they are positional, not looked up by header.

The workbook's other sheets (`Accepted Titles`, `Discontinued Titles`,
`ASJC Classification Codes`, conference proceedings) are not read by anything.

### `journalcsv__doaj_<timestamp>_utf8.csv` — **required**

DOAJ's full journal metadata dump: open-access status, APCs, licences, peer
review process.

- **Source:** <https://doaj.org/csv> (public data dump documented at
  <https://doaj.org/docs/public-data-dump/>)
- **Terms:** DOAJ metadata is CC0. Redistributable — it is excluded here only
  for size.
- **Version in use:** `journalcsv__doaj_20251211_1429_utf8.csv`, 22,325 rows,
  downloaded 2025-12-11.
- **Consumed by:** `scripts/import_journal_enrichment.py`
- **Note:** the filename carries the download timestamp and the importer's
  default path names that exact file, so pass `--doaj-path <path>` or rename
  after re-downloading.

### `predatory/`

Beall's List derivatives. Has its own [README](predatory/README.md) with
source, licence and matching statistics.

- **Consumed by:** `scripts/import_predatory_journals.py`

## Present locally but unused

These sit in the directory and are read by no script. Kept because they were
part of earlier work; safe to delete if you are rebuilding from scratch.

| File | Size | Notes |
|---|---|---|
| `scopus_journals_data_ext_list_Nov_2025.xlsx` | 22 MB | A second Scopus export. Not referenced anywhere. This is the one that most inflated the old history. |
| `scopus_discontinued_titles.csv` | 4.7 MB | 16,591 rows. Appears to be an extract of the workbook's `Discontinued Titles` sheet; provenance not recorded. |
| `journal.categories_2014.csv` | 360 KB | 2,502 rows, dated 2014. Provenance not recorded. |

## Rebuilding

```bash
pip install openpyxl                       # both Scopus importers need it
python scripts/import_journal_enrichment.py      # --scopus-path / --doaj-path to override
python scripts/import_scopus_only_journals.py
python scripts/import_predatory_journals.py
```

Each writes into `data/journals.db`. Verify afterwards with the coverage counts
recorded in `CLAUDE.md` under "Verified column shapes" — notably that
`journal_summary.issn` is a JSON array and that 147,672 of 260,918 journals
carry a real ISSN.
