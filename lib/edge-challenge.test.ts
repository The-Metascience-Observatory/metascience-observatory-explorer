import { describe, it, expect } from "vitest";
import { isEdgeChallenge, shouldReload, RELOAD_WINDOW_MS } from "./edge-challenge";

describe("isEdgeChallenge", () => {
  it("matches a 403 carrying cf-mitigated: challenge", () => {
    expect(isEdgeChallenge(403, "challenge")).toBe(true);
  });

  it("ignores origin 403s, which have no cf-mitigated header", () => {
    expect(isEdgeChallenge(403, null)).toBe(false);
  });

  it("ignores other statuses even with the header", () => {
    expect(isEdgeChallenge(503, "challenge")).toBe(false);
    expect(isEdgeChallenge(200, "challenge")).toBe(false);
  });

  it("ignores other mitigations", () => {
    expect(isEdgeChallenge(403, "block")).toBe(false);
  });
});

describe("shouldReload", () => {
  const now = 1_700_000_000_000;

  it("allows the first reload", () => {
    expect(shouldReload(now, null)).toBe(true);
  });

  it("blocks a second reload inside the window", () => {
    expect(shouldReload(now, now - 1_000)).toBe(false);
    expect(shouldReload(now, now - RELOAD_WINDOW_MS + 1)).toBe(false);
  });

  it("allows a reload once the window has passed", () => {
    expect(shouldReload(now, now - RELOAD_WINDOW_MS)).toBe(true);
    expect(shouldReload(now, now - RELOAD_WINDOW_MS * 10)).toBe(true);
  });

  it("treats a corrupt stamp as no stamp", () => {
    expect(shouldReload(now, Number.NaN)).toBe(true);
  });

  it("honours a custom window", () => {
    expect(shouldReload(now, now - 5_000, 10_000)).toBe(false);
    expect(shouldReload(now, now - 15_000, 10_000)).toBe(true);
  });
});
