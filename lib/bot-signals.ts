/**
 * Cheap, header-only bot signals for middleware.
 *
 * Context: on 2026-10-28 a residential-proxy scraper hit the origin at
 * 65–100 req/s from ~500 IPs per 6 s with NO address ever reused. Every
 * address-keyed control (per-IP cap, per-/24 cap, blocklist CIDRs) was blind
 * to it. What it did have in common was the costume: generic desktop
 * Chrome/Firefox User-Agents on requests that were not made by a browser.
 *
 * Real browsers send Fetch Metadata on every request, over HTTPS, without
 * exception: `sec-fetch-mode`/`sec-fetch-dest`/`sec-fetch-site` from
 * Chrome 76, Firefox 90 and Safari 16.4; and every Chromium build from 89 also
 * sends the low-entropy client hint `sec-ch-ua`. Cloudflare and the tunnel
 * forward request headers unchanged, so their absence at the origin means the
 * client is a script, not the browser its UA claims.
 *
 * Pure: no I/O, no process state. The enforcement mode lives in
 * data/blocklist.json (see lib/blocklist.ts) so it can be flipped without a
 * restart.
 */

/** Minimal header accessor so both Headers and plain objects work in tests. */
export interface HeaderReader {
  get(name: string): string | null;
}

export type HeaderGateMode = "off" | "log" | "enforce";

export const HEADER_GATE_MODES: readonly HeaderGateMode[] = ["off", "log", "enforce"];

export function isHeaderGateMode(value: unknown): value is HeaderGateMode {
  return typeof value === "string" && (HEADER_GATE_MODES as readonly string[]).includes(value);
}

/**
 * Minimum major versions from which Fetch Metadata is always sent. Anything
 * older is left alone: the point is to catch a lie, not to punish old
 * browsers, and nobody scraping at scale claims to be Chrome 60.
 */
const FETCH_METADATA_MIN = {
  chrome: 76,
  firefox: 90,
  safari: 16.4,
  edge: 79,
};

/** Chromium sends `sec-ch-ua` by default from this major on. */
const CLIENT_HINTS_MIN_CHROME = 89;

interface BrowserClaim {
  family: "chrome" | "firefox" | "safari" | "edge";
  version: number;
}

/**
 * What browser the UA claims to be, or null if it doesn't claim one. Only
 * families whose header behaviour is well established are recognised; other
 * `Mozilla/5.0` strings (crawlers, in-app webviews, exotic forks) are null.
 */
export function parseBrowserClaim(userAgent: string): BrowserClaim | null {
  if (!userAgent.startsWith("Mozilla/")) return null;

  // Edge is Chromium and sends everything Chrome does, but check it first so
  // the "Chrome/" token in its UA doesn't mislabel it.
  const edge = /\bEdg(?:e|A|iOS)?\/(\d+)/.exec(userAgent);
  if (edge) return { family: "edge", version: Number(edge[1]) };

  // Other Chromium derivatives (Opera, Brave, Samsung Internet, Vivaldi,
  // Yandex) all carry a Chrome/ token and inherit its header behaviour. Opera
  // and Yandex send sec-ch-ua too. Brave strips the brand but keeps the
  // header, so the presence check still holds.
  const chrome = /\bChrome\/(\d+)/.exec(userAgent);
  if (chrome) return { family: "chrome", version: Number(chrome[1]) };

  const firefox = /\bFirefox\/(\d+)/.exec(userAgent);
  if (firefox) return { family: "firefox", version: Number(firefox[1]) };

  // Safari: Version/X.Y ... Safari/NNN, and nothing above matched. Safari
  // reports the browser version in `Version/`, not `Safari/` (WebKit build).
  if (/\bSafari\/\d/.test(userAgent)) {
    const version = /\bVersion\/(\d+(?:\.\d+)?)/.exec(userAgent);
    if (version) return { family: "safari", version: Number(version[1]) };
  }

  return null;
}

/**
 * Why this request is inconsistent with the browser its UA claims, or null.
 *
 *  - "no-fetch-metadata": claims a browser version that always sends
 *    `sec-fetch-mode`, but didn't.
 *  - "chrome-without-client-hints": claims Chromium ≥ 89 but no `sec-ch-ua`.
 *
 * The caller decides whether to log or block; see middleware.ts.
 */
export function getHeaderMismatch(userAgent: string, headers: HeaderReader): string | null {
  const claim = parseBrowserClaim(userAgent);
  if (!claim) return null;

  if (claim.version >= FETCH_METADATA_MIN[claim.family] && !headers.get("sec-fetch-mode")) {
    return "no-fetch-metadata";
  }

  if (
    (claim.family === "chrome" || claim.family === "edge") &&
    claim.version >= CLIENT_HINTS_MIN_CHROME &&
    !headers.get("sec-ch-ua")
  ) {
    return "chrome-without-client-hints";
  }

  return null;
}
