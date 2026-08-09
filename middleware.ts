import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getBlockReason, subnetKey } from "@/lib/blocklist";

// ANSI color codes for console output
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Simple in-memory rate limiting (resets on server restart)
// For production, consider Redis or a proper rate limiting service
const requestCounts = new Map<string, { count: number; windowStart: number }>();
// Second tier keyed by /24 (v4) or /48 (v6) so a pool rotating through many
// addresses in one network can't get a fresh per-IP budget for each one.
const subnetCounts = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 1000; // max requests per window per IP (high to allow citation-heavy pages)
const RATE_LIMIT_MAX_SEARCH = 120; // stricter limit for search endpoints
// Subnet caps are deliberately well above the per-IP caps: a shared campus or
// carrier NAT legitimately puts many users on one /24.
const SUBNET_LIMIT_MAX = 3000;
const SUBNET_LIMIT_MAX_SEARCH = 600;
let requestCounter = 0;
const CLEANUP_INTERVAL = 1000;

// Track suspicious patterns
const suspiciousPatterns = [
  /['";<>].*(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR\s+1\s*=\s*1)/i, // SQL injection
  /<script|javascript:|on\w+\s*=/i, // XSS
  /\.\.[\/\\]/,  // Path traversal
  /\${|`.*`/,    // Template injection
];

function detectSuspiciousInput(url: string, query: string | null): string | null {
  const fullInput = `${url} ${query || ''}`;

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullInput)) {
      return pattern.toString();
    }
  }
  return null;
}

/**
 * Count a request against a bucket and report whether it exceeded the limit.
 * Windows are fixed, not sliding, matching the original behaviour.
 */
function overLimit(
  buckets: Map<string, { count: number; windowStart: number }>,
  key: string,
  limit: number,
  now: number
): { exceeded: boolean; count: number; windowStart: number } {
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
    buckets.set(key, { count: 1, windowStart: now });
    return { exceeded: false, count: 1, windowStart: now };
  }

  bucket.count++;
  return { exceeded: bucket.count > limit, count: bucket.count, windowStart: bucket.windowStart };
}

function tooManyRequests(limit: number, windowStart: number): NextResponse {
  return new NextResponse('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': '60',
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil((windowStart + RATE_LIMIT_WINDOW) / 1000)),
    },
  });
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const searchParams = request.nextUrl.search;

  // Get IP from headers (Cloudflare sets CF-Connecting-IP, or use x-forwarded-for)
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Get other useful headers for security monitoring
  // Sanitize to prevent log injection (remove newlines, control chars)
  const sanitize = (s: string) => s.replace(/[\r\n\x00-\x1f]/g, "");
  const userAgent = sanitize(request.headers.get("user-agent") || "unknown");
  const country = sanitize(request.headers.get("cf-ipcountry") || "unknown");

  const timestamp = new Date().toISOString();
  const now = Date.now();

  // Blocklist check first — cheapest possible rejection, and it should apply
  // even to requests that would otherwise look well-formed.
  const blockReason = getBlockReason(ip, userAgent);
  if (blockReason) {
    console.error(`${RED}[${timestamp}] [BLOCKED] [${country}] ${ip} -> ${pathname} (${blockReason})${RESET}`);
    // Generic body: don't tell the client which rule matched.
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Check for suspicious patterns in the request
  const query = request.nextUrl.searchParams.get("q");
  const suspiciousMatch = detectSuspiciousInput(pathname + searchParams, query);
  if (suspiciousMatch) {
    console.error(`${RED}[${timestamp}] [SECURITY] [${country}] ${ip} -> SUSPICIOUS REQUEST blocked${RESET}`);
    console.error(`${RED}  Pattern: ${suspiciousMatch}${RESET}`);
    console.error(`${RED}  URL: ${pathname}${searchParams}${RESET}`);
    console.error(`${RED}  User-Agent: ${userAgent}${RESET}`);
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Rate limiting check
  const isSearchEndpoint = pathname.includes('/api/') && pathname.includes('/search');
  const rateLimit = isSearchEndpoint ? RATE_LIMIT_MAX_SEARCH : RATE_LIMIT_MAX;
  const subnetLimit = isSearchEndpoint ? SUBNET_LIMIT_MAX_SEARCH : SUBNET_LIMIT_MAX;

  const perIp = overLimit(requestCounts, ip, rateLimit, now);
  if (perIp.exceeded) {
    const severity = perIp.count > rateLimit * 2 ? 'SEVERE' : 'BLOCKED';
    const color = perIp.count > rateLimit * 2 ? RED : YELLOW;
    console.error(`${color}[${timestamp}] [RATE-LIMIT] [${country}] ${ip} ${severity}: ${perIp.count} requests/min (limit: ${rateLimit})${RESET}`);
    console.error(`${color}  User-Agent: ${userAgent}${RESET}`);
    return tooManyRequests(rateLimit, perIp.windowStart);
  }

  // Second tier: aggregate by network. Skip when the IP didn't parse, since
  // subnetKey() falls back to the raw string and would just duplicate tier one.
  const netKey = subnetKey(ip);
  if (netKey !== ip) {
    const perSubnet = overLimit(subnetCounts, netKey, subnetLimit, now);
    if (perSubnet.exceeded) {
      console.error(`${RED}[${timestamp}] [RATE-LIMIT-SUBNET] [${country}] ${ip} (${netKey}) BLOCKED: ${perSubnet.count} requests/min (limit: ${subnetLimit})${RESET}`);
      console.error(`${RED}  User-Agent: ${userAgent}${RESET}`);
      return tooManyRequests(subnetLimit, perSubnet.windowStart);
    }
  }

  // Clean up old entries every 1000 requests
  requestCounter++;
  if (requestCounter >= CLEANUP_INTERVAL) {
    requestCounter = 0;
    const cutoff = now - RATE_LIMIT_WINDOW * 2;
    for (const buckets of [requestCounts, subnetCounts]) {
      for (const [key, value] of buckets.entries()) {
        if (value.windowStart < cutoff) {
          buckets.delete(key);
        }
      }
    }
  }

  // Log all page visits (not static assets)
  console.log(`[${timestamp}] [${country}] ${ip} -> ${pathname} | ${userAgent.slice(0, 80)}`);

  return NextResponse.next();
}

export const config = {
  // Node.js runtime is required so the blocklist can be read from disk and
  // hot-reloaded; the Edge runtime has no filesystem access.
  runtime: 'nodejs',
  // Match all pages but exclude static assets, api routes, and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|assets/).*)",
  ],
};
