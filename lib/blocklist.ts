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
const RELOAD_CHECK_MS = 30 * 1000;

export interface BlocklistFile {
  /** Exact IP matches, v4 or v6. */
  ips?: string[];
  /** CIDR ranges, e.g. "116.204.0.0/16" or "2a03:2880::/32". */
  cidrs?: string[];
  /** Case-insensitive substrings matched against the User-Agent header. */
  userAgents?: string[];
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

let compiled: CompiledBlocklist = EMPTY;
let lastMtimeMs = -1;
let lastCheckedAt = 0;

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

function compile(raw: BlocklistFile): CompiledBlocklist {
  const cidrs: ParsedCidr[] = [];
  for (const entry of raw.cidrs ?? []) {
    const parsed = parseCidr(entry);
    if (parsed) {
      cidrs.push(parsed);
    } else {
      console.error(`[blocklist] ignoring malformed CIDR: ${entry}`);
    }
  }

  return {
    ips: new Set((raw.ips ?? []).map((s) => s.trim()).filter(Boolean)),
    cidrs,
    userAgents: (raw.userAgents ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
  };
}

/**
 * Return the current blocklist, reloading from disk if the file changed.
 * A missing file means "nothing blocked" and is not an error.
 */
function load(): CompiledBlocklist {
  const now = Date.now();
  if (now - lastCheckedAt < RELOAD_CHECK_MS) return compiled;
  lastCheckedAt = now;

  try {
    const mtimeMs = statSync(BLOCKLIST_PATH).mtimeMs;
    if (mtimeMs === lastMtimeMs) return compiled;

    const parsed = JSON.parse(readFileSync(BLOCKLIST_PATH, "utf8")) as BlocklistFile;
    compiled = compile(parsed);
    lastMtimeMs = mtimeMs;
    console.log(
      `[blocklist] loaded ${compiled.ips.size} IPs, ${compiled.cidrs.length} CIDRs, ` +
        `${compiled.userAgents.length} UA patterns`
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // No blocklist configured. Only reset if we had one loaded before.
      if (compiled !== EMPTY) {
        console.log("[blocklist] file removed, blocklist cleared");
        compiled = EMPTY;
        lastMtimeMs = -1;
      }
    } else {
      // Malformed JSON or unreadable file: keep the last good list rather than
      // failing open, and retry on the next check.
      console.error("[blocklist] failed to load, keeping previous list:", error);
      lastMtimeMs = -1;
    }
  }

  return compiled;
}

// --- matching --------------------------------------------------------------

/**
 * Reason this request is blocked, or null to allow it.
 * The string is for server-side logging only — never return it to the client,
 * since it reveals the blocking rule.
 */
export function getBlockReason(ip: string, userAgent: string): string | null {
  const list = load();

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
