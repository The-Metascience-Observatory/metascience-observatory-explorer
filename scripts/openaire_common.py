"""Shared helpers for the OpenAIRE Graph dump import pipeline.

The OpenAIRE Graph bulk dump (Zenodo record 20428976, v11.1.1) ships as tar
archives containing gzipped JSON-lines files (one JSON object per line).
These helpers stream records without extracting anything to disk.

See CLAUDE.md ('Verified column shapes', 'OpenAIRE citation edges') for the
data shapes this pipeline depends on.
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


def stream_tar_members(tar_path: Path) -> Iterator[bytes]:
    """Yield the raw (still-gzipped) bytes of each .gz member of a tar.

    Companion to stream_tar_jsonl(): keeps the tar read strictly sequential in
    one process while a worker pool does gunzip + parse in parallel. Each
    member is an independent gzip stream, so handing them to workers is safe.
    Members are ~10-14 MB gz for publications, ~0.4 MB gz for relations.
    """
    with tarfile.open(tar_path, mode="r|") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".gz"):
                continue
            fileobj = tar.extractfile(member)
            if fileobj is not None:
                yield fileobj.read()


# --- md5-hex join key -------------------------------------------------------
#
# IMPORTANT: the join key between OpenAIRE ids is the bare md5 hex, NOT the full
# `namespace::hex` string. `doi_dedup___::<hex>` and `doi_________::<hex>` are the
# same DOI -- the hex is md5(normalized_doi) in both. openaire_papers stores 66% of
# its ids under `doi_________::` while the relation dumps reference 87% under
# `doi_dedup___::`, so matching on the full string silently under-matches.
#
# We truncate the 128-bit md5 to its first 64 bits (16 hex chars). For 174.4M keys
# the expected self-collision count is ~8e-4 and false positives over 3.7e9 probes
# ~3.5e-2 -- both negligible.


def hex16(openaire_id: str) -> Optional[bytes]:
    """First 16 hex chars of an OpenAIRE id's md5 suffix -- the 64-bit join key."""
    h = openaire_hex(openaire_id)
    return h[:16].encode() if h else None


def _hex_lut():
    """256-entry uint64 lookup table mapping an ASCII hex digit to its value."""
    import numpy as np

    lut = np.zeros(256, dtype=np.uint64)
    for i, c in enumerate(b"0123456789abcdef"):
        lut[c] = i
    for i, c in enumerate(b"ABCDEF"):
        lut[c] = 10 + i
    return lut


def hex16_to_u64(buf: bytes):
    """Vectorized: a bytes buffer of N packed 16-char hex keys -> uint64[N].

    Requires numpy. This is the hot conversion in both the keymap build and the
    Cites edge scan, so it avoids per-row int(x, 16) (~1 us each).
    """
    import numpy as np

    global _LUT
    try:
        _LUT
    except NameError:
        _LUT = _hex_lut()
    a = np.frombuffer(buf, np.uint8).reshape(-1, 16)
    nib = _LUT[a]
    k = np.zeros(a.shape[0], np.uint64)
    four = np.uint64(4)
    for c in range(16):
        k = (k << four) | nib[:, c]
    return k


class KeymapTranslator:
    """OpenAIRE product id -> app paper id ('W123' or 'OA<hex>'), keyed on the md5 hex.

    WHY THIS EXISTS: the relation dumps reference products under
    `doi_dedup___::<hex>` (87-90% of rows) while `openaire_papers` and
    `paper_openaire` store them mostly under `doi_________::<hex>` (66%).
    Those are the SAME DOI -- the hex is md5(normalized_doi) in both namespaces --
    so matching on the full id string silently under-matches. This translator
    keys on the hex alone, which is what openaire_build_keymap.py already
    indexes for the citation pipeline.

    Both 64-bit halves of the md5 are verified, so a lookup cannot false-positive
    on a truncated-key collision.

    The negative branch relies on `openaire_papers.id == 'OA' || <hex>`, which is
    how openaire_build_keymap.load_openaire_papers() derives the key in the first
    place (it strips the 'OA' prefix). That means an OpenAIRE-only hit needs no
    rowid lookup -- and therefore this pass never depends on rowid stability.
    """

    def __init__(self, keymap_dir):
        import numpy as np

        d = Path(keymap_dir)
        # mmap: the three arrays total ~4.2 GB and are read sparsely.
        self._np = np
        self.lo = np.load(d / "map_lo.npy", mmap_mode="r")
        self.hi = np.load(d / "map_hi.npy", mmap_mode="r")
        self.val = np.load(d / "map_val.npy", mmap_mode="r")
        if not (len(self.lo) == len(self.hi) == len(self.val)):
            raise ValueError(f"keymap arrays disagree in length under {d}")

    def __len__(self):
        return len(self.lo)

    def translate(self, openaire_ids):
        """iterable of full OpenAIRE ids -> {openaire_id: app paper id}.

        Ids without a well-formed 32-hex suffix, and ids the map does not
        resolve, are simply absent from the result.
        """
        np = self._np
        pairs = []
        for oaid in openaire_ids:
            h = openaire_hex(oaid)
            if h:
                pairs.append((oaid, h))
        if not pairs:
            return {}

        buf = "".join(h for _, h in pairs).encode("ascii")
        a = np.frombuffer(buf, np.uint8).reshape(-1, 32)
        lo = hex16_to_u64(a[:, :16].tobytes())
        hi = hex16_to_u64(a[:, 16:].tobytes())

        pos = np.searchsorted(self.lo, lo)
        np.clip(pos, 0, len(self.lo) - 1, out=pos)
        ok = (self.lo[pos] == lo) & (self.hi[pos] == hi)
        vals = np.where(ok, self.val[pos], 0)

        out = {}
        for (oaid, h), v, good in zip(pairs, vals.tolist(), ok.tolist()):
            if not good or v == 0:
                continue
            out[oaid] = ("W%d" % v) if v > 0 else ("OA" + h)
        return out
