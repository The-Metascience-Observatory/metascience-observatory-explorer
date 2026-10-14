import { describe, expect, it } from "vitest";
import { isLocalRequest } from "@/lib/local-request";

const h = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

describe("isLocalRequest", () => {
  it("accepts a direct local call with no forwarding headers", () => {
    expect(isLocalRequest(h({}))).toBe(true);
  });

  it("accepts the x-forwarded-for Next adds for local route-handler calls", () => {
    // This is the case that 404'd the real caller twice: absence cannot be
    // required, because Next sets this even for a direct local connection.
    expect(isLocalRequest(h({ "x-forwarded-for": "127.0.0.1" }))).toBe(true);
    expect(isLocalRequest(h({ "x-forwarded-for": "::1" }))).toBe(true);
    expect(isLocalRequest(h({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe(true);
  });

  it("rejects anything carrying cf-connecting-ip", () => {
    // Behind the tunnel this is always set, so it means the request came from
    // outside — even if the forwarded chain claims to be loopback.
    expect(isLocalRequest(h({ "cf-connecting-ip": "1.2.3.4" }))).toBe(false);
    expect(
      isLocalRequest(h({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "127.0.0.1" }))
    ).toBe(false);
  });

  it("rejects a non-loopback forwarded chain", () => {
    expect(isLocalRequest(h({ "x-forwarded-for": "203.0.113.7" }))).toBe(false);
    expect(isLocalRequest(h({ "x-forwarded-for": "203.0.113.7, 127.0.0.1" }))).toBe(false);
    expect(isLocalRequest(h({ "x-forwarded-for": "127.0.0.1, 203.0.113.7" }))).toBe(false);
  });

  it("is case-insensitive about header names", () => {
    expect(isLocalRequest(h({ "cf-connecting-ip": "1.2.3.4" }))).toBe(false);
  });
});
