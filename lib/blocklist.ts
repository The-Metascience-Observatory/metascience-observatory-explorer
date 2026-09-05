import { readFileSync, statSync } from "fs";
import { join } from "path";

// Blocklist for abusive clients, checked in middleware before any DB work.
//
// Source of truth is data/blocklist.json, re-read whenever its mtime changes
// (checked at most once every RELOAD_CHECK_MS), so you can ban an IP without
// a rebuild or restart. Requires Node.js middleware runtime — see middleware.ts.
//
// Addresses are represented as plain octet arrays (4 bytes for IPv4, 16 for
// IPv6) rather than BigInt, because the project targets ES2017.

const BLOCKLIST_PATH = join(process.cwd(), "data", "blocklist.json");
const ALLOWLIST_PATH = join(process.cwd(), "data", "allowlist.json");
const RELOAD_CHECK_MS = 30 * 1000;

/**
 * User-Agent substrings that must never be blockable.
 *
 * getBlockReason() matches UA patterns as case-insensitive *substrings*, so a
 * well-meaning entry like "bot" in data/blocklist.json would 403 Googlebot
 * within 30 seconds, with no rebuild and no obvious cause. Any configured
 * pattern that is a substring of one of these is rejected at load time.
 */
const PROTECTED_UA_TOKENS = [
  "googlebot",
  "google-inspectiontool",
  "storebot-google",
  "bingbot",
  "adidxbot",
  "applebot",
  "duckduckbot",
  "yandexbot",
  "baiduspider",
  "slurp",
  "oai-searchbot",
  "chatgpt-user",
  "perplexitybot",
  "claudebot",
  "claude-searchbot",
  "claude-user",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "ia_archiver",
];

/** Shortest UA pattern we will accept; below this, false positives dominate. */
const MIN_UA_PATTERN_LENGTH = 5;

export interface BlocklistFile {
  /** Exact IP matches, v4 or v6. */
  ips?: string[];
  /** CIDR ranges, e.g. "116.204.0.0/16" or "2a03:2880::/32". */
  cidrs?: string[];
  /** Case-insensitive substrings matched against the User-Agent header. */
  userAgents?: string[];
}

/**
 * Published crawler ranges, e.g. Google's googlebot.json / special-crawlers.json
 * and Bing's bingbot.json. Used to confirm a crawler User-Agent actually comes
 * from the network it claims, before granting it a higher rate limit.
 */
export interface AllowlistFile {
  ips?: string[];
  cidrs?: string[];
}

/** An address as octets: length 4 for IPv4, 16 for IPv6. */
type Octets = number[];

interface ParsedCidr {
  /** Original text, kept for log messages. */
  source: string;
  /** Network address, already masked. Its length also encodes the family. */
  network: Octets;
  prefix: number;
}

interface CompiledBlocklist {
  ips: Set<string>;
  cidrs: ParsedCidr[];
  userAgents: string[];
}

const EMPTY: CompiledBlocklist = { ips: new Set(), cidrs: [], userAgents: [] };

// --- address parsing -------------------------------------------------------

/** IPv4 dotted quad -> 4 octets, or null if malformed. */
function parseIPv4(ip: string): Octets | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  const octets: Octets = [];
  for (const part of parts) {
    // Reject empty, non-numeric, and out-of-range octets. Leading zeros are
    // read as octal by some parsers, so treat them as malformed rather than
    // risk disagreeing with whatever assigned the address.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part[0] === "0") return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** IPv6 (including :: compression and trailing IPv4) -> 16 octets. */
function parseIPv6(ip: string): Octets | null {
  // Strip zone index ("fe80::1%eth0") — irrelevant for matching.
  const zoneAt = ip.indexOf("%");
  if (zoneAt !== -1) ip = ip.slice(0, zoneAt);

  if (ip.includes(".")) {
    // Trailing IPv4 form, e.g. "::ffff:192.0.2.1". Rewrite the tail as two
    // hex groups so the rest of the parser only deals with hextets.
    const lastColon = ip.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(new Array(fill).fill(0), tail);
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const octets: Octets = [];
  for (const g of groups) {
    octets.push((g >> 8) & 0xff, g & 0xff);
  }
  return octets;
}

/** Parse an address of either family. Length of the result identifies it. */
function parseIP(ip: string): Octets | null {
  return ip.includes(":") ? parseIPv6(ip) : parseIPv4(ip);
}

/** Zero every bit below the prefix, in place. */
function maskInPlace(octets: Octets, prefix: number): void {
  const fullBytes = prefix >> 3;
  const remainderBits = prefix & 7;

  if (remainderBits !== 0 && fullBytes < octets.length) {
    octets[fullBytes] &= (0xff << (8 - remainderBits)) & 0xff;
  }
  for (let i = fullBytes + (remainderBits === 0 ? 0 : 1); i < octets.length; i++) {
    octets[i] = 0;
  }
}

function parseCidr(entry: string): ParsedCidr | null {
  const slash = entry.lastIndexOf("/");
  if (slash === -1) return null;

  const network = parseIP(entry.slice(0, slash).trim());
  if (!network) return null;

  const prefixText = entry.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > network.length * 8) return null;

  maskInPlace(network, prefix);
  return { source: entry, network, prefix };
}

/** True if `addr` falls inside `cidr`. Families must match. */
function inCidr(addr: Octets, cidr: ParsedCidr): boolean {
  // A 4-octet address can never be inside a 16-octet range, and vice versa.
  if (addr.length !== cidr.network.length) return false;

  const fullBytes = cidr.prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (addr[i] !== cidr.network[i]) return false;
  }

  const remainderBits = cidr.prefix & 7;
  if (remainderBits !== 0) {
    const mask = (0xff << (8 - remainderBits)) & 0xff;
    if ((addr[fullBytes] & mask) !== cidr.network[fullBytes]) return false;
  }

  return true;
}

// --- loading ---------------------------------------------------------------

function compileCidrs(entries: string[] | undefined, label: string): ParsedCidr[] {
  const cidrs: ParsedCidr[] = [];
  for (const entry of entries ?? []) {
    const parsed = parseCidr(entry);
    if (parsed) {
      cidrs.push(parsed);
    } else {
      console.error(`[${label}] ignoring malformed CIDR: ${entry}`);
    }
  }
  return cidrs;
}

/**
 * Reject UA patterns that would collaterally block a crawler we depend on.
 * Enforced here, at load time, so a bad entry never reaches request handling.
 */
function safeUserAgentPatterns(entries: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of entries ?? []) {
    const pattern = raw.toLowerCase().trim();
    if (!pattern) continue;

    if (pattern.length < MIN_UA_PATTERN_LENGTH) {
      console.error(
        `[blocklist] refusing UA pattern "${pattern}": shorter than ${MIN_UA_PATTERN_LENGTH} characters`
      );
      continue;
    }

    const clash = PROTECTED_UA_TOKENS.find((token) => token.includes(pattern));
    if (clash) {
      console.error(
        `[blocklist] refusing UA pattern "${pattern}": it would also match "${clash}"`
      );
      continue;
    }

    out.push(pattern);
  }
  return out;
}

function compile(raw: BlocklistFile): CompiledBlocklist {
  return {
    ips: new Set((raw.ips ?? []).map((s) => s.trim()).filter(Boolean)),
    cidrs: compileCidrs(raw.cidrs, "blocklist"),
    userAgents: safeUserAgentPatterns(raw.userAgents),
  };
}

function compileAllowlist(raw: AllowlistFile): CompiledBlocklist {
  return {
    ips: new Set((raw.ips ?? []).map((s) => s.trim()).filter(Boolean)),
    cidrs: compileCidrs(raw.cidrs, "allowlist"),
    userAgents: [],
  };
}

/**
 * Build a loader that returns a compiled list, re-reading from disk only when
 * the file's mtime changes (checked at most once per RELOAD_CHECK_MS).
 *
 * A missing file means "empty list" and is not an error; a malformed one keeps
 * the last good list rather than failing open.
 */
function makeLoader<T>(
  path: string,
  label: string,
  compileFn: (raw: T) => CompiledBlocklist
): () => CompiledBlocklist {
  let current: CompiledBlocklist = EMPTY;
  let mtime = -1;
  let checkedAt = 0;

  return function load(): CompiledBlocklist {
    const now = Date.now();
    if (now - checkedAt < RELOAD_CHECK_MS) return current;
    checkedAt = now;

    try {
      const mtimeMs = statSync(path).mtimeMs;
      if (mtimeMs === mtime) return current;

      current = compileFn(JSON.parse(readFileSync(path, "utf8")) as T);
      mtime = mtimeMs;
      console.log(
        `[${label}] loaded ${current.ips.size} IPs, ${current.cidrs.length} CIDRs, ` +
          `${current.userAgents.length} UA patterns`
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        if (current !== EMPTY) {
          console.log(`[${label}] file removed, list cleared`);
          current = EMPTY;
          mtime = -1;
        }
      } else {
        console.error(`[${label}] failed to load, keeping previous list:`, error);
        mtime = -1;
      }
    }

    return current;
  };
}

const load = makeLoader<BlocklistFile>(BLOCKLIST_PATH, "blocklist", compile);
const loadAllowlist = makeLoader<AllowlistFile>(
  ALLOWLIST_PATH,
  "allowlist",
  compileAllowlist
);

// --- matching --------------------------------------------------------------

/**
 * Reason this request is blocked, or null to allow it.
 * The string is for server-side logging only — never return it to the client,
 * since it reveals the blocking rule.
 */
export function getBlockReason(ip: string, userAgent: string): string | null {
  const list = load();

  // A request from a published search-engine range is never blocked. Without
  // this, a broad CIDR or UA rule aimed at abusive traffic can silently
  // de-index the site.
  if (isAllowlisted(ip)) return null;

  if (list.ips.has(ip)) return `ip:${ip}`;

  if (list.cidrs.length > 0) {
    const addr = parseIP(ip);
    if (addr) {
      for (const cidr of list.cidrs) {
        if (inCidr(addr, cidr)) return `cidr:${cidr.source}`;
      }
    }
  }

  if (list.userAgents.length > 0) {
    const ua = userAgent.toLowerCase();
    for (const pattern of list.userAgents) {
      if (ua.includes(pattern)) return `ua:${pattern}`;
    }
  }

  return null;
}

/**
 * True if `ip` falls in a published crawler range listed in data/allowlist.json.
 *
 * Used to verify a crawler User-Agent before granting it a raised rate limit —
 * the UA header alone is trivially forged, so it must never be the only check.
 * A missing allowlist file returns false everywhere, which degrades to the
 * normal rate limit rather than opening anything up.
 */
export function isAllowlisted(ip: string): boolean {
  const list = loadAllowlist();
  if (list.ips.size === 0 && list.cidrs.length === 0) return false;

  if (list.ips.has(ip)) return true;

  const addr = parseIP(ip);
  if (!addr) return false;
  for (const cidr of list.cidrs) {
    if (inCidr(addr, cidr)) return true;
  }
  return false;
}

/**
 * Rate-limit bucket key. Collapsing to a /24 (v4) or /48 (v6) means a pool
 * rotating through many addresses in one network shares a single budget
 * instead of getting a fresh allowance per address. Returns the input
 * unchanged when it isn't a parseable address.
 */
export function subnetKey(ip: string): string {
  const addr = parseIP(ip);
  if (!addr) return ip;

  // Family prefix keeps v4 and v6 keys in separate namespaces.
  return addr.length === 4
    ? `v4/${addr.slice(0, 3).join(".")}`
    : `v6/${addr.slice(0, 6).join(".")}`;
}
