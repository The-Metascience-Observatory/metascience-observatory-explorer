import { describe, expect, it } from "vitest";
import { getHeaderMismatch, isHeaderGateMode, parseBrowserClaim } from "@/lib/bot-signals";

const CHROME_156 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const FIREFOX_156 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0";
const SAFARI_17 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const EDGE_130 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const GOOGLEBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36";
const CURL = "curl/8.5.0";

function headers(h: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

const REAL_CHROME_HEADERS = headers({
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-site": "none",
  "sec-ch-ua": '"Chromium";v="156", "Google Chrome";v="156"',
});
const REAL_FIREFOX_HEADERS = headers({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
const NOTHING = headers({});

describe("parseBrowserClaim", () => {
  it("recognises the major families", () => {
    expect(parseBrowserClaim(CHROME_156)).toEqual({ family: "chrome", version: 156 });
    expect(parseBrowserClaim(FIREFOX_156)).toEqual({ family: "firefox", version: 156 });
    expect(parseBrowserClaim(SAFARI_17)).toEqual({ family: "safari", version: 17.4 });
    expect(parseBrowserClaim(EDGE_130)).toEqual({ family: "edge", version: 130 });
  });

  it("does not claim a browser for non-browser or unfamiliar UAs", () => {
    expect(parseBrowserClaim(CURL)).toBeNull();
    expect(parseBrowserClaim("")).toBeNull();
    expect(parseBrowserClaim("Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)")).toBeNull();
  });
});

describe("getHeaderMismatch", () => {
  it("passes a real Chrome request", () => {
    expect(getHeaderMismatch(CHROME_156, REAL_CHROME_HEADERS)).toBeNull();
  });

  it("passes a real Firefox request (Firefox sends no sec-ch-ua)", () => {
    expect(getHeaderMismatch(FIREFOX_156, REAL_FIREFOX_HEADERS)).toBeNull();
  });

  it("passes a real Safari request", () => {
    expect(getHeaderMismatch(SAFARI_17, REAL_FIREFOX_HEADERS)).toBeNull();
  });

  it("flags the 2026-10-28 scraper shape: modern Chrome UA, no fetch metadata", () => {
    expect(getHeaderMismatch(CHROME_156, NOTHING)).toBe("no-fetch-metadata");
    expect(getHeaderMismatch(FIREFOX_156, NOTHING)).toBe("no-fetch-metadata");
    expect(getHeaderMismatch(SAFARI_17, NOTHING)).toBe("no-fetch-metadata");
    expect(getHeaderMismatch(EDGE_130, NOTHING)).toBe("no-fetch-metadata");
  });

  it("flags Chromium that sends fetch metadata but no client hints", () => {
    const partial = headers({ "sec-fetch-mode": "navigate" });
    expect(getHeaderMismatch(CHROME_156, partial)).toBe("chrome-without-client-hints");
    expect(getHeaderMismatch(EDGE_130, partial)).toBe("chrome-without-client-hints");
  });

  it("leaves old browser versions alone — the goal is to catch a lie, not age", () => {
    const chrome70 =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36";
    const firefox78 = "Mozilla/5.0 (X11; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0";
    const safari15 =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";
    expect(getHeaderMismatch(chrome70, NOTHING)).toBeNull();
    expect(getHeaderMismatch(firefox78, NOTHING)).toBeNull();
    expect(getHeaderMismatch(safari15, NOTHING)).toBeNull();
  });

  it("does not flag Chrome 80–88, which sent fetch metadata but not client hints", () => {
    const chrome85 =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36";
    expect(getHeaderMismatch(chrome85, headers({ "sec-fetch-mode": "navigate" }))).toBeNull();
  });

  it("never flags self-identified crawlers or non-browser clients", () => {
    // Googlebot carries a Chrome token but is handled by the allowlist, and
    // its UA starts with Mozilla/5.0 AppleWebKit — still a "chrome" claim here.
    // It is exempted in middleware via isCrawler, not here; this test pins the
    // parse so a future change to that exemption is deliberate.
    expect(parseBrowserClaim(GOOGLEBOT)?.family).toBe("chrome");
    expect(getHeaderMismatch(CURL, NOTHING)).toBeNull();
  });

  it("accepts headers case-insensitively", () => {
    const h = headers({ "Sec-Fetch-Mode": "cors", "Sec-CH-UA": '"Chromium";v="156"' });
    expect(getHeaderMismatch(CHROME_156, h)).toBeNull();
  });
});

describe("isHeaderGateMode", () => {
  it("accepts exactly the three modes", () => {
    expect(isHeaderGateMode("off")).toBe(true);
    expect(isHeaderGateMode("log")).toBe(true);
    expect(isHeaderGateMode("enforce")).toBe(true);
    expect(isHeaderGateMode("block")).toBe(false);
    expect(isHeaderGateMode(undefined)).toBe(false);
    expect(isHeaderGateMode(1)).toBe(false);
  });
});
