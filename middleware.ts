import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ANSI color codes for console output
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Simple in-memory rate limiting (resets on server restart)
// For production, consider Redis or a proper rate limiting service
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 1000; // max requests per window per IP (high to allow citation-heavy pages)
const RATE_LIMIT_MAX_SEARCH = 120; // stricter limit for search endpoints
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

  const ipData = requestCounts.get(ip);
  if (ipData) {
    if (now - ipData.windowStart > RATE_LIMIT_WINDOW) {
      // Reset window
      requestCounts.set(ip, { count: 1, windowStart: now });
    } else {
      ipData.count++;
      // Block requests that exceed rate limit
      if (ipData.count > rateLimit) {
        const severity = ipData.count > rateLimit * 2 ? 'SEVERE' : 'BLOCKED';
        const color = ipData.count > rateLimit * 2 ? RED : YELLOW;
        console.error(`${color}[${timestamp}] [RATE-LIMIT] [${country}] ${ip} ${severity}: ${ipData.count} requests/min (limit: ${rateLimit})${RESET}`);
        console.error(`${color}  User-Agent: ${userAgent}${RESET}`);
        return new NextResponse('Too Many Requests', {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': String(rateLimit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil((ipData.windowStart + RATE_LIMIT_WINDOW) / 1000)),
          },
        });
      }
    }
  } else {
    requestCounts.set(ip, { count: 1, windowStart: now });
  }

  // Clean up old entries every 1000 requests
  requestCounter++;
  if (requestCounter >= CLEANUP_INTERVAL) {
    requestCounter = 0;
    const cutoff = now - RATE_LIMIT_WINDOW * 2;
    for (const [key, value] of requestCounts.entries()) {
      if (value.windowStart < cutoff) {
        requestCounts.delete(key);
      }
    }
  }

  // Log all page visits (not static assets)
  console.log(`[${timestamp}] [${country}] ${ip} -> ${pathname} | ${userAgent.slice(0, 80)}`);

  return NextResponse.next();
}

export const config = {
  // Match all pages but exclude static assets, api routes, and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|assets/).*)",
  ],
};
