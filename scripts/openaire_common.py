"""Shared helpers for the OpenAIRE Graph dump import pipeline.

The OpenAIRE Graph bulk dump (Zenodo record 20428976, v11.1.1) ships as tar
archives containing gzipped JSON-lines files (one JSON object per line).
These helpers stream records without extracting anything to disk.

See HANDOFF.md at the repo root for the full pipeline design.
"""

import gzip
import re
import tarfile
from pathlib import Path
from typing import Iterator, Optional

try:
    import orjson as _json

    def json_loads(b):
        return _json.loads(b)
except ImportError:
    import json as _json

    def json_loads(b):
        return _json.loads(b)


DOI_PREFIX_RE = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.IGNORECASE)
ORCID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
ROR_PREFIX_RE = re.compile(r"^https?://ror\.org/", re.IGNORECASE)


def stream_tar_jsonl(tar_path: Path) -> Iterator[dict]:
    """Yield one dict per JSON line from a tar of gzipped JSONL files.

    Uses streaming mode ('r|') so the tar is read sequentially — required for
    good throughput on USB/NTFS drives and never materializes members on disk.
    """
    with tarfile.open(tar_path, mode="r|") as tar:
        for member in tar:
            if not member.isfile():
                continue
            fileobj = tar.extractfile(member)
            if fileobj is None:
                continue
            if member.name.endswith(".gz"):
                fileobj = gzip.GzipFile(fileobj=fileobj)
            for line in fileobj:
                line = line.strip()
                if line:
                    yield json_loads(line)


def normalize_doi(raw: Optional[str]) -> Optional[str]:
    """Lowercase, strip doi.org URL prefixes and whitespace; None unless it
    looks like a DOI (starts with '10.')."""
    if not raw:
        return None
    doi = DOI_PREFIX_RE.sub("", raw.strip()).lower()
    if doi.startswith("doi:"):
        doi = doi[4:]
    return doi if doi.startswith("10.") and len(doi) > 3 else None


def normalize_orcid(raw: Optional[str]) -> Optional[str]:
    """Strip orcid.org URL prefix; return the bare 19-char id or None."""
    if not raw:
        return None
    orcid = re.sub(r"^https?://(?:www\.)?orcid\.org/", "", raw.strip(), flags=re.IGNORECASE)
    return orcid if ORCID_RE.match(orcid) else None


def normalize_ror(raw: Optional[str]) -> Optional[str]:
    """Strip ror.org URL prefix; return the bare id (matches affiliation_summary.ror)."""
    if not raw:
        return None
    ror = ROR_PREFIX_RE.sub("", raw.strip()).lower()
    return ror or None


def extract_pids(record: dict) -> dict:
    """Collect persistent ids from a research-product record.

    Dump field is `pids: [{scheme, value}]` (verified against v11.1.1).
    Returns {'doi': [...], 'pmid': [...], 'pmc': [...]} with DOIs normalized.
    """
    out = {"doi": [], "pmid": [], "pmc": []}
    for pid in record.get("pids") or []:
        scheme = (pid.get("scheme") or "").lower()
        value = pid.get("value")
        if not value:
            continue
        if scheme == "doi":
            doi = normalize_doi(value)
            if doi:
                out["doi"].append(doi)
        elif scheme == "pmid":
            v = str(value).strip().lstrip("pmid:").strip()
            if v.isdigit():
                out["pmid"].append(v)
        elif scheme == "pmc":
            out["pmc"].append(str(value).strip())
    return out


def openaire_hex(openaire_id: str) -> Optional[str]:
    """Return the 32-hex suffix of an OpenAIRE id like '50|doi_________::<hex>'."""
    if "::" in openaire_id:
        suffix = openaire_id.rsplit("::", 1)[1]
        if len(suffix) == 32 and all(c in "0123456789abcdef" for c in suffix):
            return suffix
    return None
