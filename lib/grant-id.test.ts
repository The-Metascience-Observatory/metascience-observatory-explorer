import { describe, expect, it } from "vitest";
import vectors from "./grant-id.vectors.json";
import {
  decodeSources,
  funderFromOpenaireShortname,
  funderFromPubmedAgency,
  grantExternalUrl,
  grantPath,
  normalizeGrantId,
} from "@/lib/grant-id";

interface NormalizeVector {
  raw: string;
  hint: string | null;
  expect: { funder: string | null; key: string; serial: string | null; activity: string | null } | null;
}

describe("normalizeGrantId", () => {
  // The vector file is the contract shared with scripts/grant_id.py.
  for (const v of vectors.normalize as NormalizeVector[]) {
    it(`${JSON.stringify(v.raw)} (hint ${v.hint ?? "none"})`, () => {
      const out = normalizeGrantId(v.raw, v.hint);
      if (v.expect === null) {
        expect(out).toBeNull();
        return;
      }
      expect(out).not.toBeNull();
      expect({ funder: out!.funder, key: out!.key, serial: out!.serial, activity: out!.activity }).toEqual(v.expect);
      expect(out!.key).toMatch(/^[A-Z0-9]+$/);
      expect(out!.display.length).toBeGreaterThan(0);
    });
  }

  it("keeps the human form for ids that are only alnum-stripped", () => {
    expect(normalizeGrantId("ST/W001845/1", "UKRI")!.display).toBe("ST/W001845/1");
    expect(normalizeGrantId("5R25MH101072-02")!.display).toBe("R25MH101072");
  });

  it("is idempotent on its own keys", () => {
    for (const v of vectors.normalize as NormalizeVector[]) {
      if (!v.expect) continue;
      const again = normalizeGrantId(v.expect.key, v.expect.funder);
      expect(again?.key).toBe(v.expect.key);
    }
  });
});

describe("funderFromPubmedAgency", () => {
  for (const v of vectors.pubmedAgency as { agency: string | null; expect: string }[]) {
    it(`${v.agency ?? "null"} -> ${v.expect}`, () => {
      expect(funderFromPubmedAgency(v.agency)).toBe(v.expect);
    });
  }
});

describe("helpers", () => {
  it("funderFromOpenaireShortname", () => {
    expect(funderFromOpenaireShortname("NIH")).toBe("NIH");
    expect(funderFromOpenaireShortname("ec")).toBe("EC");
    expect(funderFromOpenaireShortname(null)).toBe("OTHER");
    expect(funderFromOpenaireShortname("")).toBe("OTHER");
  });

  it("decodeSources", () => {
    expect(decodeSources(0)).toEqual([]);
    expect(decodeSources(5)).toEqual(["nih_exporter", "pubmed"]);
    expect(decodeSources(15)).toEqual(["nih_exporter", "nsf", "pubmed", "openaire"]);
  });

  it("grantPath and grantExternalUrl", () => {
    expect(grantPath("NIH", "R56AG066215")).toBe("/grants/nih/R56AG066215");
    expect(grantExternalUrl("NIH", "R56AG066215", "R56AG066215")).toContain("reporter.nih.gov");
    expect(grantExternalUrl("NSF", "1907207", "1907207")).toContain("AWD_ID=1907207");
    expect(grantExternalUrl("EC", "733280", "733280")).toBe("https://cordis.europa.eu/project/id/733280");
    expect(grantExternalUrl("WT", "212980", "212980")).toBeNull();
  });
});
