import { cleanDoi } from "@/lib/format";

/**
 * Quote a CSV field only when RFC 4180 requires it. DOIs may legally contain
 * commas and quotes, so bare output is not always safe.
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build a single-column CSV of bare DOIs (`10.xxxx/...`), one per line, with a
 * `DOI` header. Null and empty inputs are skipped, URL prefixes are stripped
 * via `cleanDoi`, and duplicates are dropped while keeping first-seen order.
 */
export function buildDoiCsv(rawDois: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const lines = ["DOI"];
  for (const raw of rawDois) {
    const doi = cleanDoi(raw)?.trim();
    if (!doi || seen.has(doi)) continue;
    seen.add(doi);
    lines.push(csvField(doi));
  }
  return lines.join("\n") + "\n";
}
