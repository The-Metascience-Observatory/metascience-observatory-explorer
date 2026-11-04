#!/usr/bin/env python3
"""Check scripts/grant_id.py against lib/grant-id.vectors.json (shared with vitest)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grant_id import funder_from_pubmed_agency, normalize_grant_id  # noqa: E402

VECTORS = Path(__file__).resolve().parent.parent / "lib" / "grant-id.vectors.json"


def main() -> int:
    data = json.loads(VECTORS.read_text())
    failures = 0
    for v in data["normalize"]:
        out = normalize_grant_id(v["raw"], v["hint"])
        exp = v["expect"]
        got = None if out is None else {
            "funder": out.funder, "key": out.key, "serial": out.serial, "activity": out.activity,
        }
        if got != exp:
            failures += 1
            print(f"FAIL normalize {v['raw']!r} hint={v['hint']}: expected {exp}, got {got}")
        elif exp is not None:
            again = normalize_grant_id(exp["key"], exp["funder"])
            if again is None or again.key != exp["key"]:
                failures += 1
                print(f"FAIL idempotence {exp['key']!r}: got {again}")
    for v in data["pubmedAgency"]:
        got = funder_from_pubmed_agency(v["agency"])
        if got != v["expect"]:
            failures += 1
            print(f"FAIL agency {v['agency']!r}: expected {v['expect']}, got {got}")
    n = len(data["normalize"]) + len(data["pubmedAgency"])
    print(f"{n - failures}/{n} vectors pass")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
