import { describe, expect, it } from "vitest";
import { parsePagination, validateQueryLength } from "@/lib/api-utils";

const params = (qs: string) => new URLSearchParams(qs);

describe("parsePagination", () => {
  it("applies the documented defaults", () => {
    expect(parsePagination(params(""))).toEqual({ offset: 0, limit: 50 });
  });

  it("reads offset and limit", () => {
    expect(parsePagination(params("offset=20&limit=10"))).toEqual({ offset: 20, limit: 10 });
  });

  it("clamps limit to maxLimit", () => {
    expect(parsePagination(params("limit=5000")).limit).toBe(100);
    expect(parsePagination(params("limit=5000"), { maxLimit: 200 }).limit).toBe(200);
  });

  it("floors limit at 1 and offset at 0", () => {
    expect(parsePagination(params("limit=-10&offset=-5"))).toEqual({ offset: 0, limit: 1 });
  });

  it("treats limit=0 as absent, not as a floor case", () => {
    // parseInt("0") is 0, which is falsy, so the `|| defaultLimit` guard sends
    // it to the default rather than clamping to 1. Surprising but intentional
    // enough to pin: a caller asking for 0 rows gets 50.
    expect(parsePagination(params("limit=0")).limit).toBe(50);
  });

  it("falls back to the default limit on garbage input", () => {
    // parseInt("abc") is NaN, which the `|| defaultLimit` guard absorbs.
    expect(parsePagination(params("limit=abc&offset=abc"))).toEqual({ offset: 0, limit: 50 });
  });

  it("honours a custom default limit", () => {
    expect(parsePagination(params(""), { limit: 25 }).limit).toBe(25);
  });
});

describe("validateQueryLength", () => {
  it("passes null, empty, and short queries", () => {
    expect(validateQueryLength(null)).toBeNull();
    expect(validateQueryLength("")).toBeNull();
    expect(validateQueryLength("cancer")).toBeNull();
  });

  it("passes a query exactly at the limit", () => {
    expect(validateQueryLength("x".repeat(200))).toBeNull();
  });

  it("rejects a query one character over the limit", () => {
    expect(validateQueryLength("x".repeat(201))).not.toBeNull();
  });

  it("honours a custom limit", () => {
    expect(validateQueryLength("abcdef", 5)).not.toBeNull();
    expect(validateQueryLength("abcde", 5)).toBeNull();
  });
});
