import { describe, expect, it } from "vitest";
import { cn, formatCompactNumber, formatNumber, getCountryName } from "@/lib/utils";

describe("formatNumber", () => {
  it("renders an em dash for null and undefined, but not for zero", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
    expect(formatNumber(0)).toBe("0");
  });

  it("groups thousands", () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });
});

describe("getCountryName", () => {
  it("resolves known codes case-insensitively", () => {
    expect(getCountryName("US")).toBe("United States");
    expect(getCountryName("us")).toBe("United States");
  });

  it("returns Unknown for empty input", () => {
    expect(getCountryName(null)).toBe("Unknown");
    expect(getCountryName(undefined)).toBe("Unknown");
    expect(getCountryName("")).toBe("Unknown");
  });

  it("echoes an unrecognised code rather than dropping it", () => {
    expect(getCountryName("ZZ")).toBe("ZZ");
  });
});

describe("cn", () => {
  it("merges conflicting tailwind classes last-wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });
});

describe("formatCompactNumber", () => {
  it("abbreviates millions and thousands", () => {
    expect(formatCompactNumber(1_200_000)).toBe("1.2M");
    expect(formatCompactNumber(3_400)).toBe("3K");
  });

  it("leaves values under a thousand alone", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(0)).toBe("0");
  });

  it("is distinct from formatNumber, which groups instead of abbreviating", () => {
    // These two used to share a name in different files, which is why the
    // compact one is now explicitly named.
    expect(formatCompactNumber(1_200_000)).not.toBe(formatNumber(1_200_000));
  });
});
