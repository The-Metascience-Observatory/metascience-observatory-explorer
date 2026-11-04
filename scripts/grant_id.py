"""Grant-number normalization — Python mirror of lib/grant-id.ts.

Used by scripts/build_grants_db.py so the keys written into grants.db are the
same ones the app computes at lookup time. Keep the two in step: both are
checked against lib/grant-id.vectors.json (run scripts/test_grant_id.py).
"""

import re
from dataclasses import dataclass
from typing import Optional

SOURCE_BITS = {"nih_exporter": 1, "nsf": 2, "pubmed": 4, "openaire": 8}

_SEPARATORS = re.compile(r"[\s\-_./]")
_UNICODE_DASH = re.compile("[‐-―−]")
_PREFIX = re.compile(r"^(?:GRANT|AWARD)?\s*(?:NO\.?|NUMBER|#)\s*:?\s*")
_NIH_FULL = re.compile(r"^(\d)?([A-Z][A-Z0-9]{2})([A-Z]{2})(\d{5,6})(?:\d{2}(?:[A-Z]\d{1,2})*)?$")
_NIH_SERIAL = re.compile(r"^([A-Z]{2})(\d{5,6})(?:\d{2}(?:[A-Z]\d{1,2})*)?$")
_NIH_SERIAL_ANYWHERE = re.compile(r"(?<![A-Z])([A-Z]{2})-?(\d{5,6})(?!\d)")
_NSF = re.compile(r"^(?:(NSF)[-\s]?|([A-Z]{3,4})[-\s])?(\d{7})$")
_EC_PREFIX = re.compile(r"^(H2020|HORIZON|FP7|ERC|HEU)\b")
_DIGITS = re.compile(r"\d+")


@dataclass(frozen=True)
class NormalizedGrantId:
    funder: Optional[str]
    key: str
    serial: Optional[str]
    activity: Optional[str]
    display: str


def _pad6(serial: str) -> str:
    return serial.zfill(6)


def normalize_grant_id(raw: Optional[str], funder_hint: Optional[str] = None) -> Optional[NormalizedGrantId]:
    if not raw:
        return None
    s = raw.strip().upper()
    s = _UNICODE_DASH.sub("-", s)
    s = s.replace(",", "")
    s = _PREFIX.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    hint = funder_hint.upper() if funder_hint else None
    if sum(ch.isdigit() for ch in s) < 3 or len(s) > 40:
        return None

    c = _SEPARATORS.sub("", s)

    if hint is None or hint == "NIH":
        m = _NIH_FULL.match(c)
        if m:
            _, activity, ic, serial = m.groups()
            serial6 = _pad6(serial)
            key = activity + ic + serial6
            return NormalizedGrantId("NIH", key, ic + serial6, activity, key)
        m = _NIH_SERIAL.match(c)
        if m:
            key = m.group(1) + _pad6(m.group(2))
            return NormalizedGrantId("NIH", key, key, None, key)
        if hint == "NIH":
            m = _NIH_SERIAL_ANYWHERE.search(s)
            if m:
                key = m.group(1) + _pad6(m.group(2))
                return NormalizedGrantId("NIH", key, key, None, key)

    if hint is None or hint == "NSF":
        m = _NSF.match(s)
        if m:
            key = m.group(3)
            funder = "NSF" if (hint == "NSF" or m.group(1) or m.group(2)) else None
            return NormalizedGrantId(funder, key, None, None, key)

    if hint == "EC" or _EC_PREFIX.match(s):
        runs = _DIGITS.findall(s)
        code = next((r for r in runs if len(r) == 9), None) or next((r for r in runs if len(r) == 6), None)
        if code:
            return NormalizedGrantId("EC", code, None, None, code)

    key = re.sub(r"[^A-Z0-9]", "", c)
    if not key:
        return None
    return NormalizedGrantId(hint, key, None, None, s)


_UKRI_COUNCILS = re.compile(
    r"medical|biotechnology|engineering and physical|natural environment|economic and social|"
    r"science and technology facilities|arts and humanities"
)


def funder_from_pubmed_agency(agency: Optional[str]) -> str:
    if not agency:
        return "OTHER"
    a = agency.lower()
    if re.search(r"\bhhs$", a):
        return "NIH"
    if "national institutes of health" in a:
        return "NIH"
    if "national science foundation" in a and "china" not in a:
        return "NSF"
    if "national health and medical research council" in a:
        return "NHMRC"
    if "australian research council" in a:
        return "ARC"
    if "research council" in a and _UKRI_COUNCILS.search(a):
        return "UKRI"
    if "innovate uk" in a or "uk research and innovation" in a or a == "ukri":
        return "UKRI"
    if "wellcome" in a:
        return "WT"
    if re.search(r"european research council|european commission|european union|horizon 2020|horizon europe", a):
        return "EC"
    if "natural science foundation of china" in a or a == "nsfc":
        return "NSFC"
    if "canadian institutes of health research" in a or a == "cihr":
        return "CIHR"
    if "deutsche forschungsgemeinschaft" in a or "german research foundation" in a:
        return "DFG"
    if "japan society for the promotion of science" in a or a == "jsps":
        return "JSPS"
    if "national research foundation of korea" in a:
        return "NRF"
    if "austrian science fund" in a:
        return "FWF"
    if "swiss national science foundation" in a:
        return "SNSF"
    if "cancer research uk" in a:
        return "CRUK"
    if "british heart foundation" in a:
        return "BHF"
    if "howard hughes" in a:
        return "HHMI"
    return "OTHER"


def funder_from_openaire_shortname(shortname: Optional[str]) -> str:
    s = re.sub(r"[^A-Z0-9]", "", (shortname or "").strip().upper())
    return s or "OTHER"
