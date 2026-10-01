/**
 * FTS5 query construction, shared by the search routes.
 *
 * This existed as three near-copies (papers, journals, persons) plus one inline
 * variant in the trials route that did no sanitization at all — so FTS5
 * metacharacters reached MATCH. The whole point of the other three was to stop
 * exactly that, which is the argument for having one.
 */

/** Escape a character so it is literal inside a regex character class. */
function escapeForClass(ch: string): string {
  return ch.replace(/[\\\]^-]/g, "\\$&");
}

export interface FtsQueryOptions {
  /**
   * Characters preserved in addition to [a-zA-Z0-9]. Person names need
   * apostrophes and periods ("O'Brien", "J.R."); titles do not.
   */
  allowChars?: string;
  /**
   * Sanitized parts shorter than this are dropped. Titles use 2 to avoid
   * matching a huge slice of the corpus on a single letter; names use 1 because
   * initials are meaningful.
   */
  minWordLength?: number;
}

/**
 * Turn user input into an FTS5 prefix query.
 *
 *   "machine learning"      -> "machine"* "learning"*
 *   "Cerebrolysin-Improved" -> "cerebrolysin"* "improved"*
 *
 * Hyphenated input is split, so a hyphenated name matches either half. Every
 * FTS5 special character (`" * - ^ ( ) :` and the AND/OR/NOT/NEAR operators) is
 * stripped rather than escaped — none of them are meaningful in a user's query
 * here, and stripping cannot be got subtly wrong the way escaping can.
 */
export function buildFtsQuery(query: string, opts: FtsQueryOptions = {}): string {
  const { allowChars = "", minWordLength = 2 } = opts;
  const extra = [...allowChars].map(escapeForClass).join("");
  const strip = new RegExp(`[^a-zA-Z0-9${extra}]`, "g");

  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";

  return words
    .flatMap((word) => word.split("-").filter((p) => p.length > 0))
    .map((part) => part.replace(strip, "").trim())
    .filter((part) => part.length >= minWordLength)
    .map((part) => `"${part}"*`)
    .join(" ");
}
