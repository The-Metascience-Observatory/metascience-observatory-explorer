import { describe, expect, it } from "vitest";
import { subnetKey } from "@/lib/blocklist";

// Only subnetKey is covered here. The CIDR and user-agent matchers are module
// internals that read blocklist files from disk; exporting them purely to test
// them would widen the public API for the test's convenience. They are worth
// covering, but behind a fixture-loading seam rather than this.
describe("subnetKey", () => {
  it("collapses IPv4 to a /24 bucket", () => {
    expect(subnetKey("203.0.113.7")).toBe("v4/203.0.113");
  });

  it("gives every address in a /24 the same rate-limit budget", () => {
    // The whole point: a pool rotating addresses must not get a fresh allowance
    // per address.
    expect(subnetKey("203.0.113.1")).toBe(subnetKey("203.0.113.254"));
  });

  it("separates adjacent /24s", () => {
    expect(subnetKey("203.0.113.1")).not.toBe(subnetKey("203.0.114.1"));
  });

  it("collapses IPv6 to a /48 bucket", () => {
    expect(subnetKey("2001:db8:1234:5678::1")).toBe(subnetKey("2001:db8:1234:ffff::9"));
  });

  it("keeps v4 and v6 in separate namespaces", () => {
    expect(subnetKey("203.0.113.7").startsWith("v4/")).toBe(true);
    expect(subnetKey("2001:db8::1").startsWith("v6/")).toBe(true);
  });

  it("returns unparseable input unchanged rather than throwing", () => {
    // Callers use the result as a map key, so a bad value must degrade to its
    // own bucket instead of collapsing every bad value together.
    expect(subnetKey("not-an-ip")).toBe("not-an-ip");
    expect(subnetKey("")).toBe("");
  });
});
