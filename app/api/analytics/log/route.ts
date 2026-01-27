import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { logVisitor } from "@/lib/analytics";

// Simple in-memory rate limiting for this endpoint
const recentLogs = new Map<string, number>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // Max 60 logs per minute per IP (1 per second)

// Beacon endpoint for logging page visits
// Security: We extract the real IP/country/UA from server headers (Cloudflare),
// not from client-submitted data, so clients can't spoof their identity.
// They can only submit which path they visited.
export async function POST(request: Request) {
  try {
    const headersList = await headers();

    // Get real IP from Cloudflare or proxy headers (cannot be spoofed by client)
    const ip =
      headersList.get("cf-connecting-ip") ||
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip") ||
      "unknown";

    // Rate limiting: prevent spam
    const now = Date.now();
    const lastLog = recentLogs.get(ip) || 0;

    // Simple sliding window rate limit
    if (now - lastLog < RATE_LIMIT_WINDOW / RATE_LIMIT_MAX) {
      // Too fast - silently accept but don't log (don't reveal rate limiting to attacker)
      return NextResponse.json({ success: true });
    }
    recentLogs.set(ip, now);

    // Cleanup old entries periodically
    if (Math.random() < 0.01) {
      const cutoff = now - RATE_LIMIT_WINDOW;
      for (const [key, value] of recentLogs.entries()) {
        if (value < cutoff) recentLogs.delete(key);
      }
    }

    const body = await request.json();

    // Get country from Cloudflare (cannot be spoofed by client)
    const country = headersList.get("cf-ipcountry") || "unknown";

    // Get user agent from request headers (cannot be easily spoofed)
    const userAgent = headersList.get("user-agent") || "unknown";

    // Path comes from client (the page they're on)
    const path = body.path || "/";

    // Validate path to prevent injection/abuse
    if (typeof path !== "string" || path.length > 500 || path.includes("<") || path.includes(">")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    logVisitor({
      ip,
      timestamp: now,
      path,
      userAgent,
      country,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to log visitor:", error);
    return NextResponse.json({ error: "Failed to log" }, { status: 500 });
  }
}
