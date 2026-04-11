# Predatory Journal Data

## Source

Data from the [stop-predatory-journals](https://github.com/stop-predatory-journals/stop-predatory-journals.github.io) GitHub project, which maintains an updated version of **Beall's List** — the original list of potential predatory journals and publishers created by librarian Jeffrey Beall.

- **Website:** https://beallslist.net/
- **License:** The list is publicly maintained and community-curated
- **Last downloaded:** 2026-03-06

## Files

### `journals.csv`
- **Contents:** 1,317 standalone predatory journals
- **Columns:** `url, name, abbr`
- **Description:** Individual journals identified as potentially predatory based on Beall's criteria

### `publishers.csv`
- **Contents:** 1,176 predatory publishers
- **Columns:** `url, name, abbr`
- **Description:** Publishers whose practices meet Beall's criteria for predatory publishing. All journals from these publishers are flagged.

## Import

Run the import script to match these lists against the journal database:

```bash
python scripts/import_predatory_journals.py
```

This creates three tables in `data/journals.db`:
- `predatory_list_journals` — raw journal list
- `predatory_list_publishers` — raw publisher list
- `predatory_journals` — matched journals with confidence level (`exact` for journal name match, `publisher` for publisher-level match)

## Matching Results (2026-03-06)

- **588** exact journal name matches
- **3,485** additional journals flagged via publisher match
- **4,073** total journals flagged

## Limitations

- No ISSNs in source data — matching is by name only (case-insensitive)
- Some predatory journals may not appear in OpenAlex and thus can't be matched
- Publisher-level matches flag all journals from a publisher, which may include some legitimate journals
- Beall's List is not universally accepted; some listed journals dispute their inclusion
