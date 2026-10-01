import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "@/lib/fts";

// The implementations lib/fts.ts replaced, transcribed verbatim from git HEAD,
// so we can assert the shared builder is behaviourally identical for
// papers/journals/persons rather than merely "looks right".

function papersOld(query: string): string {
  const sanitize = (w: string) => w.replace(/[^a-zA-Z0-9]/g, "").trim();
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";
  return words
    .flatMap((word) => {
      const parts = word.split("-").filter((p) => p.length > 0);
      return parts.map((part) => {
        const s = sanitize(part);
        if (!s || s.length < 2) return "";
        return `"${s}"*`;
      });
    })
    .filter((w) => w.length > 0)
    .join(" ");
}

function personsOld(query: string): string {
  const sanitize = (w: string) => w.replace(/[^a-zA-Z0-9'.]/g, "").trim();
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";
  return words
    .map((word) => {
      if (word.includes("-")) {
        const parts = word.split("-").filter((p) => p.length > 0);
        return parts
          .map((p) => sanitize(p))
          .filter((p) => p.length > 0)
          .map((p) => `"${p}"*`)
          .join(" ");
      }
      const s = sanitize(word);
      if (!s) return "";
      return `"${s}"*`;
    })
    .filter((w) => w.length > 0)
    .join(" ");
}

const NAME_FTS = { allowChars: "'.", minWordLength: 1 };

const CORPUS = [
  "cancer", "machine learning", "  spaced   out  ", "", "   ",
  "CRISPR-Cas9", "multi-word-hyphen-chain", "-leading", "trailing-",
  "O'Brien", "J.R. Smith", "van der Waals", "d'Alembert",
  'can"cer', "can*cer", "can(cer)", "can:cer", "can^cer", "can-cer",
  "***", "a", "a b", "ab", "x1", "COVID-19", "SARS-CoV-2",
  "AND OR NOT NEAR", "foo AND bar", "uber cafe", "ubér café", "北京大学",
  "1234", "a1-b2", "...", "'''", "e.e. cummings",
];

describe("buildFtsQuery matches the implementations it replaced", () => {
  it("is identical to the old papers/journals builder", () => {
    // papers and journals had byte-identical bodies at HEAD.
    for (const q of CORPUS) {
      expect(buildFtsQuery(q), `input: ${JSON.stringify(q)}`).toBe(papersOld(q));
    }
  });

  it("is identical to the old persons builder", () => {
    for (const q of CORPUS) {
      expect(buildFtsQuery(q, NAME_FTS), `input: ${JSON.stringify(q)}`).toBe(personsOld(q));
    }
  });
});
