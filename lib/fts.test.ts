import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "@/lib/fts";

const NAMES = { allowChars: "'.", minWordLength: 1 };

describe("buildFtsQuery", () => {
  it("turns words into lowercased prefix terms", () => {
    expect(buildFtsQuery("machine learning")).toBe('"machine"* "learning"*');
    expect(buildFtsQuery("Machine Learning")).toBe('"machine"* "learning"*');
  });

  it("splits hyphenated input into separate terms", () => {
    expect(buildFtsQuery("Cerebrolysin-Improved")).toBe('"cerebrolysin"* "improved"*');
  });

  it("returns empty for blank input", () => {
    expect(buildFtsQuery("")).toBe("");
    expect(buildFtsQuery("   ")).toBe("");
  });

  it("strips FTS5 metacharacters so they cannot reach MATCH", () => {
    // The regression this module exists to prevent.
    for (const q of ['can"cer', "can*cer", "can(cer)", "can:cer", "can^cer"]) {
      const out = buildFtsQuery(q);
      expect(out).toBe('"cancer"*');
    }
  });

  it("neutralises a quote-and-operator injection attempt", () => {
    const out = buildFtsQuery('foo" OR bar:(baz');
    // The output must be nothing but well-formed `"term"*` atoms, so no quote
    // or operator from the input can escape into FTS5 syntax.
    expect(out).toMatch(/^"[a-z0-9]+"\*( "[a-z0-9]+"\*)*$/);
    // Note stripping joins rather than splits: `bar:(baz` becomes one token.
    // Only whitespace and hyphens separate terms.
    expect(out).toBe('"foo"* "or"* "barbaz"*');
  });

  it("drops sub-minimum-length words by default", () => {
    expect(buildFtsQuery("a cancer")).toBe('"cancer"*');
  });

  it("keeps single characters when minWordLength is 1", () => {
    expect(buildFtsQuery("j smith", NAMES)).toBe('"j"* "smith"*');
  });

  it("preserves apostrophes and periods for names", () => {
    expect(buildFtsQuery("O'Brien", NAMES)).toBe(`"o'brien"*`);
    expect(buildFtsQuery("J.R.", NAMES)).toBe('"j.r."*');
  });

  it("still strips metacharacters when extra characters are allowed", () => {
    expect(buildFtsQuery('O"Brien*', NAMES)).toBe(`"obrien"*`);
  });

  it("keeps single-character qualifiers for trials", () => {
    // Trial titles turn on these: dropping the qualifier would make
    // "hepatitis b" and "hepatitis c" the same query. The trials route passes
    // minWordLength 1 for exactly this reason.
    const TRIALS = { minWordLength: 1 };
    expect(buildFtsQuery("hepatitis b", TRIALS)).toBe('"hepatitis"* "b"*');
    expect(buildFtsQuery("vitamin d", TRIALS)).toBe('"vitamin"* "d"*');
    expect(buildFtsQuery("type 1 diabetes", TRIALS)).toBe('"type"* "1"* "diabetes"*');
    // ...while still sanitizing, which is what the route previously lacked.
    expect(buildFtsQuery('can"cer', TRIALS)).toBe('"cancer"*');
  });

  it("drops a word that sanitizes away entirely", () => {
    expect(buildFtsQuery("*** cancer")).toBe('"cancer"*');
    expect(buildFtsQuery("***")).toBe("");
  });
});
