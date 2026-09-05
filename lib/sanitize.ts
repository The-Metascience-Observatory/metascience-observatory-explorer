/**
 * Server-safe sanitizing for the inline markup that appears in scholarly
 * titles and abstracts (`<i>`, `<sub>`, `<sup>`, ...).
 *
 * DOMPurify cannot be used here: it is browser-only and silently no-ops
 * without a DOM, so anything rendered on the server must not depend on it.
 *
 * Strategy: escape *everything*, then re-allow a fixed, attribute-free set of
 * tags. Because the allowlist is applied to already-escaped text, no attribute,
 * no unbalanced bracket and no `<script>` can survive — the output can only
 * ever contain the exact tags listed in ALLOWED_TAGS.
 */

const ALLOWED_TAGS = ["i", "b", "em", "strong", "sub", "sup"] as const;

const ALLOWED_RE = new RegExp(
  `&lt;(/?)(${ALLOWED_TAGS.join("|")})&gt;`,
  "gi",
);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape all HTML, then restore a small allowlist of inline formatting tags.
 * Safe to feed to dangerouslySetInnerHTML on the server or the client.
 */
export function sanitizeInlineHtml(input: string | null | undefined): string {
  if (!input) return "";
  return escapeHtml(input).replace(
    ALLOWED_RE,
    (_match, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`,
  );
}

/**
 * Strip all markup and collapse whitespace. Use for <title>, meta
 * descriptions, JSON-LD values and anything else that must be plain text.
 */
export function stripInlineHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate on a word boundary, for meta descriptions. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const cut = input.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
