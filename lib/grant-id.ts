/**
 * Grant-number normalization, shared by the grants.db build (mirrored in
 * scripts/grant_id.py), the lookup API and the client pages.
 *
 * The same award is written many ways across the four sources: SciSciNet's NIH
 * link file has `R01CA123456`, PubMed has `1 R01 CA 12345-01`, `CA-12,345` and
 * `MH RCSA MH-47,808`, OpenAIRE has `5R01CA123456-07`. All of them must land on
 * one key so a single lookup finds every linked paper. Keys are funder-scoped:
 * a bare `1907207` is an NSF award and could equally be some other funder's
 * number, so the caller keeps `funder` beside `key`.
 *
 * Both implementations are checked against lib/grant-id.vectors.json; change
 * the rules in both files and extend the vectors.
 *
 * This module imports nothing so client components can use it.
 */

export type GrantSource = "nih_exporter" | "nsf" | "pubmed" | "openaire";

/** Bit values of grant_papers.sources in grants.db. */
export const GRANT_SOURCE_BITS: Record<GrantSource, number> = {
  nih_exporter: 1,
  nsf: 2,
  pubmed: 4,
  openaire: 8,
};

/** "Reported by the funder" vs "acknowledged in the paper". */
export const GRANT_SOURCE_MASKS = {
  all: 15,
  reported: GRANT_SOURCE_BITS.nih_exporter | GRANT_SOURCE_BITS.nsf,
  acknowledged: GRANT_SOURCE_BITS.pubmed | GRANT_SOURCE_BITS.openaire,
} as const;

export type GrantSourceFilter = keyof typeof GRANT_SOURCE_MASKS;

export interface NormalizedGrantId {
  /** Funder family (`NIH`, `NSF`, `EC`, `UKRI`, ...). Null when the string itself gives no evidence. */
  funder: string | null;
  /** Funder-scoped lookup key: uppercase alphanumerics only. */
  key: string;
  /** NIH only: institute code + 6-digit serial (`AG066215`), shared by every activity code on the same project. */
  serial: string | null;
  /** NIH only: activity code (`R01`), null for serial-only ids. */
  activity: string | null;
  /** Human-readable form. */
  display: string;
}

const NIH_LIKE_HINTS = new Set([null, undefined, "NIH"]);

// Separators dropped before pattern matching. Commas are removed earlier (they
// appear inside old PubMed serials like `MH-29,206`).
const SEPARATORS = /[\s\-_./]/g;

// Full NIH project number once separators are gone:
//   [type digit][activity][IC][serial 5-6][year 2][A1 / S1 ... suffix]
// The serial/year split is decided by backtracking: 7 digits after the IC is
// serial 5 + year 2 (old PubMed), 8 is serial 6 + year 2, 6 is serial only.
const NIH_FULL = /^(\d)?([A-Z][A-Z0-9]{2})([A-Z]{2})(\d{5,6})(?:\d{2}(?:[A-Z]\d{1,2})*)?$/;
// IC + serial with no activity code: `AG066215`, `AG 00344-01`.
const NIH_SERIAL = /^([A-Z]{2})(\d{5,6})(?:\d{2}(?:[A-Z]\d{1,2})*)?$/;
// Last resort for messy PubMed strings such as `MH RCSA MH-47,808`.
const NIH_SERIAL_ANYWHERE = /(?<![A-Z])([A-Z]{2})-?(\d{5,6})(?!\d)/;

// Matched on the spaced form: a directorate prefix (`DMR-1234567`) must be
// separated from the digits, otherwise `MR/K501396/1` would collapse into one.
const NSF = /^(?:(NSF)[-\s]?|([A-Z]{3,4})[-\s])?(\d{7})$/;
const EC_PREFIX = /^(H2020|HORIZON|FP7|ERC|HEU)\b/;

function pad6(serial: string): string {
  return serial.padStart(6, "0");
}

export function normalizeGrantId(
  raw: string | null | undefined,
  funderHint: string | null = null
): NormalizedGrantId | null {
  if (!raw) return null;
  let s = raw
    .trim()
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/,/g, "")
    .replace(/^(?:GRANT|AWARD)?\s*(?:NO\.?|NUMBER|#)\s*:?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const hint = funderHint ? funderHint.toUpperCase() : null;
  const digitCount = (s.match(/\d/g) || []).length;
  if (digitCount < 3 || s.length > 40) return null;

  const c = s.replace(SEPARATORS, "");

  if (NIH_LIKE_HINTS.has(hint)) {
    const full = c.match(NIH_FULL);
    if (full) {
      const [, , activity, ic, serial] = full;
      const serial6 = pad6(serial);
      const key = activity + ic + serial6;
      return { funder: "NIH", key, serial: ic + serial6, activity, display: key };
    }
    const serialOnly = c.match(NIH_SERIAL);
    if (serialOnly) {
      const key = serialOnly[1] + pad6(serialOnly[2]);
      return { funder: "NIH", key, serial: key, activity: null, display: key };
    }
    if (hint === "NIH") {
      const anywhere = s.match(NIH_SERIAL_ANYWHERE);
      if (anywhere) {
        const key = anywhere[1] + pad6(anywhere[2]);
        return { funder: "NIH", key, serial: key, activity: null, display: key };
      }
    }
  }

  if (hint === null || hint === "NSF") {
    const nsf = s.match(NSF);
    if (nsf) {
      const key = nsf[3];
      const funder = hint === "NSF" || nsf[1] || nsf[2] ? "NSF" : null;
      return { funder, key, serial: null, activity: null, display: key };
    }
  }

  if (hint === "EC" || EC_PREFIX.test(s)) {
    const runs = s.match(/\d+/g) || [];
    const code = runs.find((r) => r.length === 9) ?? runs.find((r) => r.length === 6);
    if (code) {
      return { funder: "EC", key: code, serial: null, activity: null, display: code };
    }
  }

  const key = c.replace(/[^A-Z0-9]/g, "");
  if (!key) return null;
  return { funder: hint, key, serial: null, activity: null, display: s };
}

/**
 * Map a PubMed <Agency> string onto a funder family. Every HHS agency (NIH
 * institutes, PHS, AHRQ, CDC, FDA) uses PHS-style project numbers that
 * RePORTER resolves, so they all count as `NIH`.
 */
export function funderFromPubmedAgency(agency: string | null | undefined): string {
  if (!agency) return "OTHER";
  const a = agency.toLowerCase();
  if (/\bhhs$/.test(a)) return "NIH";
  if (a.includes("national institutes of health")) return "NIH";
  if (a.includes("national science foundation") && !a.includes("china")) return "NSF";
  if (a.includes("national health and medical research council")) return "NHMRC";
  if (a.includes("australian research council")) return "ARC";
  if (
    /research council/.test(a) &&
    /medical|biotechnology|engineering and physical|natural environment|economic and social|science and technology facilities|arts and humanities/.test(a)
  ) {
    return "UKRI";
  }
  if (a.includes("innovate uk") || a.includes("uk research and innovation") || a === "ukri") return "UKRI";
  if (a.includes("wellcome")) return "WT";
  if (/european research council|european commission|european union|horizon 2020|horizon europe/.test(a)) return "EC";
  if (a.includes("natural science foundation of china") || a === "nsfc") return "NSFC";
  if (a.includes("canadian institutes of health research") || a === "cihr") return "CIHR";
  if (a.includes("deutsche forschungsgemeinschaft") || a.includes("german research foundation")) return "DFG";
  if (a.includes("japan society for the promotion of science") || a === "jsps") return "JSPS";
  if (a.includes("national research foundation of korea")) return "NRF";
  if (a.includes("austrian science fund")) return "FWF";
  if (a.includes("swiss national science foundation")) return "SNSF";
  if (a.includes("cancer research uk")) return "CRUK";
  if (a.includes("british heart foundation")) return "BHF";
  if (a.includes("howard hughes")) return "HHMI";
  return "OTHER";
}

/** OpenAIRE funder_shortname is already a family code; only the null case needs a home. */
export function funderFromOpenaireShortname(shortname: string | null | undefined): string {
  const s = (shortname || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || "OTHER";
}

export function decodeSources(mask: number): GrantSource[] {
  return (Object.keys(GRANT_SOURCE_BITS) as GrantSource[]).filter(
    (s) => (mask & GRANT_SOURCE_BITS[s]) !== 0
  );
}

export function grantPath(funder: string, key: string): string {
  return `/grants/${funder.toLowerCase()}/${encodeURIComponent(key)}`;
}

/** Link to the funder's own record where one exists. */
export function grantExternalUrl(funder: string, key: string, display: string): string | null {
  switch (funder.toUpperCase()) {
    case "NIH":
      return `https://reporter.nih.gov/quickSearch/${encodeURIComponent(key)}`;
    case "NSF":
      return `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${encodeURIComponent(key)}`;
    case "EC":
      return `https://cordis.europa.eu/project/id/${encodeURIComponent(key)}`;
    case "UKRI":
      return `https://gtr.ukri.org/search/project?term=${encodeURIComponent(display)}`;
    default:
      return null;
  }
}

export const FUNDER_LABELS: Record<string, string> = {
  NIH: "National Institutes of Health",
  NSF: "National Science Foundation",
  EC: "European Commission",
  UKRI: "UK Research and Innovation",
  WT: "Wellcome Trust",
  NSFC: "National Natural Science Foundation of China",
  CIHR: "Canadian Institutes of Health Research",
  DFG: "Deutsche Forschungsgemeinschaft",
  JSPS: "Japan Society for the Promotion of Science",
  NRF: "National Research Foundation of Korea",
  FWF: "Austrian Science Fund",
  SNSF: "Swiss National Science Foundation",
  NHMRC: "National Health and Medical Research Council",
  ARC: "Australian Research Council",
  NWO: "Dutch Research Council",
  ANR: "Agence Nationale de la Recherche",
  FCT: "Fundação para a Ciência e a Tecnologia",
  CRUK: "Cancer Research UK",
  BHF: "British Heart Foundation",
  HHMI: "Howard Hughes Medical Institute",
  OTHER: "Other funder",
};

export function funderLabel(funder: string): string {
  return FUNDER_LABELS[funder.toUpperCase()] ?? funder.toUpperCase();
}

export const GRANT_SOURCE_LABELS: Record<GrantSource, string> = {
  nih_exporter: "NIH RePORTER",
  nsf: "NSF",
  pubmed: "PubMed",
  openaire: "OpenAIRE",
};

/** NIH activity code descriptions (display only; parsing does not validate against this). */
export const NIH_ACTIVITY_CODES: Record<string, string> = {
  // R — Research Project Grants
  R01: "Research project grant",
  R03: "Small research grant",
  R15: "Academic Research Enhancement Award",
  R21: "Exploratory/developmental grant",
  R22: "Phased innovation grant",
  R24: "Resource-related research project",
  R25: "Education project grant",
  R29: "FIRST Award (early-career)",
  R33: "Exploratory phase II grant",
  R34: "Clinical trial planning grant",
  R35: "Outstanding Investigator Award",
  R36: "Dissertation research grant",
  R37: "MERIT Award",
  R38: "StARR residency research",
  R41: "STTR Phase I",
  R42: "STTR Phase II",
  R43: "SBIR Phase I",
  R44: "SBIR Phase II",
  R56: "High priority short-term award",
  R61: "Exploratory clinical trial",
  R00: "Pathway to Independence (independent phase)",
  // K — Career Development Awards
  K01: "Mentored research scientist award",
  K02: "Independent scientist award",
  K05: "Senior scientist award",
  K07: "Academic career award",
  K08: "Mentored clinical scientist award",
  K12: "Institutional career development",
  K18: "Career enhancement award",
  K22: "Career transition award",
  K23: "Mentored patient-oriented research",
  K24: "Midcareer investigator award",
  K25: "Mentored quantitative research",
  K26: "Midcareer quantitative research",
  K99: "Pathway to Independence (mentored phase)",
  // P — Program Project / Center Grants
  P01: "Program project grant",
  P20: "Exploratory center planning grant",
  P30: "Center core grant",
  P40: "Animal/biological resource center",
  P41: "Biomedical technology resource",
  P50: "Specialized center grant",
  P51: "Primate research center",
  P60: "Comprehensive center grant",
  P17: "Research program grant",
  P42: "Superfund research center",
  // U — Cooperative Agreements
  U01: "Cooperative agreement",
  U10: "Cooperative clinical research",
  U13: "Conference cooperative agreement",
  U19: "Multi-project cooperative agreement",
  U24: "Resource cooperative agreement",
  U41: "Informatics resource cooperative",
  U42: "SBIR/STTR cooperative",
  U54: "Specialized center cooperative",
  U56: "Exploratory cooperative agreement",
  UM1: "Multi-component clinical trial",
  UG1: "Clinical trial cooperative",
  UG3: "Planning phase cooperative",
  UH2: "Exploratory cooperative",
  UH3: "Implementation cooperative",
  // T — Training Grants
  T15: "Short-term training grant",
  T32: "Institutional training grant",
  T34: "Undergraduate training grant",
  T35: "Short-term institutional training",
  T90: "Interdisciplinary training grant",
  TL1: "CTSA predoc/postdoc training",
  // F — Fellowships
  F30: "Predoctoral dual-degree fellowship",
  F31: "Predoctoral fellowship",
  F32: "Postdoctoral fellowship",
  F33: "Senior fellowship",
  // N — R&D Contracts
  N01: "R&D contract",
  N02: "Intramural research contract",
  N43: "SBIR contract Phase I",
  N44: "SBIR contract Phase II",
  // M — Clinical Research Infrastructure
  M01: "General Clinical Research Center",
  M02: "Clinical research construction",
  // S — Supplements & Other
  S10: "Shared instrumentation grant",
  S15: "Small instrumentation grant",
  S21: "Research education grant",
  SC1: "Research project (minority-serving)",
  SC2: "Pilot research (minority-serving)",
  SC3: "Small research (minority-serving)",
  // Z — Intramural Research
  ZIA: "NIH intramural research",
  ZIC: "NIH intramural center support",
  ZIR: "NIH intramural resource",
  // DP — Director's Programs
  DP1: "Director's Pioneer Award",
  DP2: "Director's New Innovator Award",
  DP3: "Director's Type 1 Diabetes Award",
  DP4: "Director's Pathfinder Award",
  DP5: "Director's Early Independence Award",
};

export function describeNihActivity(code: string | null | undefined): string | null {
  if (!code) return null;
  return NIH_ACTIVITY_CODES[code.toUpperCase()] ?? null;
}
