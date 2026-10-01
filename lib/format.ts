/**
 * Display formatting shared across pages.
 *
 * Everything here was previously duplicated in two or three components, and had
 * begun to drift — the language map existed in a 53-entry and a 14-entry
 * version, and `cleanDoi` in a variant that stripped `dx.doi.org` and one that
 * did not. Each function below is the superset of what the copies did.
 */

/** Strip a DOI URL prefix, leaving the bare `10.xxxx/...` form. */
export function cleanDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  // The dx. host is the legacy form and still appears in older records.
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

/** Google Patents URL for a patent id like `us-11426570-b2`. */
export function getPatentUrl(patentId: string): string {
  return `https://patents.google.com/patent/${patentId.toUpperCase().replace(/-/g, "")}`;
}

/** `us-11426570-b2` -> `US 11,426,570 B2`. */
export function formatPatentId(patentId: string): string {
  const parts = patentId.split("-");
  if (parts.length < 2) return patentId.toUpperCase();

  const country = parts[0].toUpperCase();
  const number = parts[1];
  const kind = parts[2]?.toUpperCase() || "";
  const formattedNumber =
    country === "US" && /^\d+$/.test(number) ? parseInt(number, 10).toLocaleString() : number;
  return `${country} ${formattedNumber}${kind ? " " + kind : ""}`;
}

/** snake_case / kebab-case -> Title Case. */
export function formatDocType(docType: string | null | undefined): string {
  if (!docType) return "Unknown";
  return docType.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Clinical trial status for display.
 *
 * `fallback` exists because the trials detail page formats status into
 * `generateMetadata`, where a literal "Unknown" would end up in the page title
 * and description. It passes "" instead.
 */
export function formatTrialStatus(
  status: string | null | undefined,
  fallback = "Unknown"
): string {
  if (!status) return fallback;
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Hostname without `www.`, or the input unchanged when it isn't a URL. */
export function getRootUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Superset of the two maps that previously existed; the Lite page carried only
// 14 of these and rendered raw codes for the rest.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese",
  es: "Spanish",
  de: "German",
  fr: "French",
  ja: "Japanese",
  pt: "Portuguese",
  ru: "Russian",
  ko: "Korean",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  ar: "Arabic",
  cs: "Czech",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  hu: "Hungarian",
  el: "Greek",
  he: "Hebrew",
  th: "Thai",
  vi: "Vietnamese",
  uk: "Ukrainian",
  id: "Indonesian",
  ms: "Malay",
  ro: "Romanian",
  sk: "Slovak",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  fa: "Persian",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  ca: "Catalan",
  eu: "Basque",
  gl: "Galician",
  af: "Afrikaans",
  sw: "Swahili",
  la: "Latin",
};

/** ISO 639-1 code -> language name; falls back to the upper-cased code. */
export function getLanguageName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase();
}
