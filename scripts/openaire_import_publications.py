#!/usr/bin/env python3
"""Stream OpenAIRE publication tars — Pass 3 of the pipeline (ONE stream, TWO outputs).

For each of the 218M publication records:
  * pids match a SciSciNet paper (DOI first, PMID fallback, via lookup.db)
      → slim enrichment row in openaire.db `paper_openaire`
  * no match but has a valid DOI
      → full candidate payload staged in stage.db `stage_candidates`
        (finalized into first-class `openaire_papers` by openaire_finalize_new_papers.py)
  * no match, no DOI → dropped (scope decision: DOI-bearing only)

Field paths verified against dump v11.1.1 (see CLAUDE.md):
  id (no '50|' prefix), pids[{scheme,value}], bestAccessRight.label, openAccessColor,
  isGreen, isInDiamondJournal, publiclyFunded, mainTitle/subTitle, container.*,
  authors[{fullName,rank,pid.id.{scheme,value}}] (link only scheme=='orcid';
  'orcid_pending' stays display-only), descriptions[str], language.code, instances[].

Resumable per-tar: completed tar names are recorded in openaire.db import_meta.
Re-running a partially-processed tar may duplicate staged candidates; the
finalize step dedupes per DOI by score, so that's harmless.

Usage:
  python3 openaire_import_publications.py \
    --dump-dir "/media/dan/Seagate Portable Drive/openaire-graph-v11" \
    --db-path ~/openaire-build/openaire.db \
    --stage-db ~/openaire-build/stage.db \
    --lookup-db ~/openaire-build/lookup.db
"""

import argparse
import glob
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openaire_common import stream_tar_jsonl, extract_pids

try:
    import orjson

    def json_dumps(o):
        return orjson.dumps(o)
except ImportError:
    import json

    def json_dumps(o):
        return json.dumps(o).encode()

BATCH = 10_000
MAX_AUTHORS = 500

PAPER_OPENAIRE_DDL = """
CREATE TABLE IF NOT EXISTS paper_openaire (
  paperid TEXT PRIMARY KEY,
  openaire_id TEXT NOT NULL,
  matched_via TEXT,
  oa_color TEXT,
  best_access_right TEXT,
  is_green INTEGER,
  is_diamond INTEGER,
  publicly_funded INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_paper_openaire_oaid ON paper_openaire(openaire_id);
"""

STAGE_DDL = """
CREATE TABLE IF NOT EXISTS stage_candidates (
  hex TEXT NOT NULL,
  doi TEXT NOT NULL,
  score REAL NOT NULL,
  payload BLOB NOT NULL
);
"""


def bool_int(v):
    return None if v is None else (1 if v else 0)


def slim_payload(rec, dois, pmids):
    """Extract the fields needed to build a first-class openaire_papers row."""
    container = rec.get("container") or {}
    lang = rec.get("language") or {}
    best = rec.get("bestAccessRight") or {}
    authors = []
    for a in (rec.get("authors") or [])[:MAX_AUTHORS]:
        pid = ((a.get("pid") or {}).get("id")) or {}
        authors.append(
            {
                "n": a.get("fullName"),
                "r": a.get("rank"),
                # validated ORCID only; orcid_pending is rendered as plain text
                "o": pid.get("value") if pid.get("scheme") == "orcid" else None,
            }
        )
    abstract = None
    for d in rec.get("descriptions") or []:
        if isinstance(d, str) and d.strip():
            abstract = d.strip()
            break
    return {
        "id": rec.get("id"),
        "doi": dois[0],
        "pmid": pmids[0] if pmids else None,
        "title": rec.get("mainTitle"),
        "subtitle": rec.get("subTitle"),
        "date": rec.get("publicationDate"),
        "type": rec.get("type"),
        "lang": lang.get("code"),
        "publisher": rec.get("publisher"),
        "journal": container.get("name"),
        "issn_p": container.get("issnPrinted"),
        "issn_o": container.get("issnOnline"),
        "issn_l": container.get("issnLinking"),
        "vol": container.get("vol"),
        "iss": container.get("iss"),
        "sp": container.get("sp"),
        "ep": container.get("ep"),
        "bar": best.get("label"),
        "oac": rec.get("openAccessColor"),
        "green": bool_int(rec.get("isGreen")),
        "diamond": bool_int(rec.get("isInDiamondJournal")),
        "funded": bool_int(rec.get("publiclyFunded")),
        "authors": authors,
        "abstract": abstract,
    }


def score_candidate(p):
    title_len = len(p["title"] or "")
    return (
        4 * (1 if p["abstract"] else 0)
        + 2 * (1 if p["authors"] else 0)
        + (1 if (p["issn_p"] or p["issn_o"] or p["issn_l"]) else 0)
        + (1 if p["journal"] else 0)
        + min(title_len, 200) / 200.0
    )


def process_batch(records, lookup, out, stage, stats):
    """Match a batch against DOI then PMID lookups; write both outputs."""
    # collect ids for batch lookup
    doi_map = {}   # doi -> [record indexes]
    pmid_map = {}
    extracted = []
    for i, rec in enumerate(records):
        pids = extract_pids(rec)
        extracted.append(pids)
        for d in pids["doi"]:
            doi_map.setdefault(d, []).append(i)
        for p in pids["pmid"]:
            pmid_map.setdefault(int(p), []).append(i)

    matched = {}  # record index -> (paperid, via)
    if doi_map:
        keys = list(doi_map.keys())
        for chunk_start in range(0, len(keys), 500):
            chunk = keys[chunk_start : chunk_start + 500]
            q = f"SELECT doi, paperid FROM doi_lookup WHERE doi IN ({','.join('?' * len(chunk))})"
            for doi, paperid in lookup.execute(q, chunk):
                for i in doi_map[doi]:
                    matched.setdefault(i, (paperid, "doi"))
    if pmid_map:
        keys = [k for k in pmid_map if not any(i in matched for i in pmid_map[k])]
        for chunk_start in range(0, len(keys), 500):
            chunk = keys[chunk_start : chunk_start + 500]
            q = f"SELECT pmid, paperid FROM pmid_lookup WHERE pmid IN ({','.join('?' * len(chunk))})"
            for pmid, paperid in lookup.execute(q, chunk):
                for i in pmid_map[pmid]:
                    matched.setdefault(i, (paperid, "pmid"))

    enrich_rows = []
    stage_rows = []
    for i, rec in enumerate(records):
        if i in matched:
            paperid, via = matched[i]
            best = rec.get("bestAccessRight") or {}
            enrich_rows.append(
                (
                    paperid,
                    rec.get("id"),
                    via,
                    rec.get("openAccessColor"),
                    best.get("label"),
                    bool_int(rec.get("isGreen")),
                    bool_int(rec.get("isInDiamondJournal")),
                    bool_int(rec.get("publiclyFunded")),
                )
            )
        elif extracted[i]["doi"]:
            p = slim_payload(rec, extracted[i]["doi"], extracted[i]["pmid"])
            hex_part = (rec.get("id") or "").rsplit("::", 1)[-1]
            stage_rows.append((hex_part, p["doi"], score_candidate(p), json_dumps(p)))
        else:
            stats["dropped"] += 1

    if enrich_rows:
        out.executemany(
            "INSERT OR IGNORE INTO paper_openaire VALUES (?,?,?,?,?,?,?,?)", enrich_rows
        )
        stats["matched"] += len(enrich_rows)
    if stage_rows:
        stage.executemany("INSERT INTO stage_candidates VALUES (?,?,?,?)", stage_rows)
        stats["staged"] += len(stage_rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump-dir", required=True)
    ap.add_argument("--db-path", required=True)
    ap.add_argument("--stage-db", required=True)
    ap.add_argument("--lookup-db", required=True)
    ap.add_argument("--tar-glob", default="publication_*.tar")
    args = ap.parse_args()

    tars = sorted(
        glob.glob(str(Path(args.dump_dir) / args.tar_glob)),
        key=lambda p: (len(p), p),  # publication_2 before publication_10
    )
    if not tars:
        sys.exit(f"no tars matching {args.tar_glob} in {args.dump_dir}")

    out = sqlite3.connect(Path(args.db_path).expanduser())
    out.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    out.executescript(PAPER_OPENAIRE_DDL)
    out.execute("CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY, value TEXT)")

    stage = sqlite3.connect(Path(args.stage_db).expanduser())
    stage.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    stage.executescript(STAGE_DDL)

    lookup = sqlite3.connect(
        f"file:{Path(args.lookup_db).expanduser()}?mode=ro&immutable=1", uri=True
    )
    lookup.executescript("PRAGMA cache_size=-4000000; PRAGMA mmap_size=17179869184;")

    done_tars = {
        row[0]
        for row in out.execute(
            "SELECT value FROM import_meta WHERE key LIKE 'pub_tar_done:%'"
        )
    }

    grand = {"matched": 0, "staged": 0, "dropped": 0, "records": 0}
    t_all = time.time()
    for tar_path in tars:
        name = Path(tar_path).name
        if name in done_tars:
            print(f"skip {name} (already done)")
            continue
        print(f"processing {name}...")
        t0 = time.time()
        stats = {"matched": 0, "staged": 0, "dropped": 0}
        batch = []
        n = 0
        for rec in stream_tar_jsonl(Path(tar_path)):
            batch.append(rec)
            if len(batch) >= BATCH:
                process_batch(batch, lookup, out, stage, stats)
                n += len(batch)
                batch = []
                if n % 1_000_000 == 0:
                    rate = n / (time.time() - t0)
                    print(
                        f"  {name}: {n:,} recs ({rate:,.0f}/s) "
                        f"matched={stats['matched']:,} staged={stats['staged']:,}"
                    )
        if batch:
            process_batch(batch, lookup, out, stage, stats)
            n += len(batch)
        out.commit()
        stage.commit()
        out.execute(
            "INSERT OR REPLACE INTO import_meta VALUES (?, ?)",
            (f"pub_tar_done:{name}", name),
        )
        out.commit()
        for k in stats:
            grand[k] += stats[k]
        grand["records"] += n
        print(
            f"  {name} done: {n:,} recs in {(time.time() - t0) / 60:,.1f} min — "
            f"matched={stats['matched']:,} staged={stats['staged']:,} dropped={stats['dropped']:,}"
        )

    print(
        f"\nALL DONE in {(time.time() - t_all) / 3600:,.2f} h: "
        f"{grand['records']:,} records, matched={grand['matched']:,}, "
        f"staged={grand['staged']:,}, dropped(no-DOI)={grand['dropped']:,}"
    )
    n = out.execute("SELECT COUNT(*) FROM paper_openaire").fetchone()[0]
    print(f"paper_openaire rows: {n:,}")
    print("oa_color distribution:")
    for color, cnt in out.execute(
        "SELECT COALESCE(oa_color,'(none)'), COUNT(*) FROM paper_openaire GROUP BY 1 ORDER BY 2 DESC"
    ):
        print(f"  {cnt:12,d}  {color}")
    out.close()
    stage.close()
    lookup.close()


if __name__ == "__main__":
    main()
