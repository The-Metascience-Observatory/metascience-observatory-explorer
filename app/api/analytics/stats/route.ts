import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAnalyticsDb } from "@/lib/db";
import { processGeoLocationBatch } from "@/lib/analytics";
import { errorResponse } from "@/lib/api-utils";

// Simple rate limiting for stats endpoint
const statsRequests = new Map<string, number>();
const STATS_RATE_LIMIT = 10; // 10 requests per minute per IP

interface VisitorStats {
  totalVisitors: number;
  totalPageViews: number;
  visitorsByLocation: { city: string; country: string; lat: number; lon: number; count: number }[];
  visitorsOverTime: { date: string; visitors: number; pageViews: number }[];
  osBreakdown: { os: string; count: number }[];
  deviceBreakdown: { device: string; count: number }[];
  browserBreakdown: { browser: string; count: number }[];
  topPages: { path: string; count: number }[];
  topCountries: { country: string; count: number }[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const headersList = await headers();

    // Auth check: require token via query param or header
    const token = searchParams.get("token") || headersList.get("x-analytics-token");
    const expectedToken = process.env.ANALYTICS_TOKEN;
    if (expectedToken && token !== expectedToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting
    const ip = headersList.get("cf-connecting-ip") || headersList.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const now = Date.now();
    const lastRequest = statsRequests.get(ip) || 0;
    if (now - lastRequest < 60000 / STATS_RATE_LIMIT) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    statsRequests.set(ip, now);

    const days = Math.min(365, Math.max(1, parseInt(searchParams.get("days") || "30", 10)));
    const processGeo = searchParams.get("processGeo") === "true";

    let db;
    try {
      db = getAnalyticsDb();
    } catch {
      return NextResponse.json({ error: "Analytics database not available" }, { status: 503 });
    }
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // processGeo only allowed with valid token
    if (processGeo && token === expectedToken) {
      await processGeoLocationBatch();
    }

    // Total unique visitors (unique IPs)
    const totalVisitors = (
      db
        .prepare("SELECT COUNT(DISTINCT ip) as count FROM visitor_logs WHERE timestamp >= ?")
        .get(cutoffTime) as { count: number }
    ).count;

    // Total page views
    const totalPageViews = (
      db.prepare("SELECT COUNT(*) as count FROM visitor_logs WHERE timestamp >= ?").get(cutoffTime) as {
        count: number;
      }
    ).count;

    // Visitors by location (with coordinates for map)
    const visitorsByLocation = db
      .prepare(
        `
        SELECT
          COALESCE(g.city, 'Unknown') as city,
          COALESCE(g.country, v.country, 'Unknown') as country,
          COALESCE(g.lat, 0) as lat,
          COALESCE(g.lon, 0) as lon,
          COUNT(DISTINCT v.ip) as count
        FROM visitor_logs v
        LEFT JOIN ip_geo_cache g ON v.ip = g.ip
        WHERE v.timestamp >= ?
        GROUP BY g.city, g.country, g.lat, g.lon
        HAVING g.lat != 0 AND g.lon != 0
        ORDER BY count DESC
        LIMIT 500
      `
      )
      .all(cutoffTime) as { city: string; country: string; lat: number; lon: number; count: number }[];

    // Visitors over time (daily)
    const visitorsOverTime = db
      .prepare(
        `
        SELECT
          DATE(timestamp / 1000, 'unixepoch') as date,
          COUNT(DISTINCT ip) as visitors,
          COUNT(*) as pageViews
        FROM visitor_logs
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
      `
      )
      .all(cutoffTime) as { date: string; visitors: number; pageViews: number }[];

    // OS breakdown
    const osBreakdown = db
      .prepare(
        `
        SELECT os, COUNT(DISTINCT ip) as count
        FROM visitor_logs
        WHERE timestamp >= ? AND os IS NOT NULL
        GROUP BY os
        ORDER BY count DESC
      `
      )
      .all(cutoffTime) as { os: string; count: number }[];

    // Device breakdown (mobile vs desktop)
    const deviceBreakdown = db
      .prepare(
        `
        SELECT device_type as device, COUNT(DISTINCT ip) as count
        FROM visitor_logs
        WHERE timestamp >= ? AND device_type IS NOT NULL
        GROUP BY device_type
        ORDER BY count DESC
      `
      )
      .all(cutoffTime) as { device: string; count: number }[];

    // Browser breakdown
    const browserBreakdown = db
      .prepare(
        `
        SELECT browser, COUNT(DISTINCT ip) as count
        FROM visitor_logs
        WHERE timestamp >= ? AND browser IS NOT NULL
        GROUP BY browser
        ORDER BY count DESC
      `
      )
      .all(cutoffTime) as { browser: string; count: number }[];

    // Top pages
    const topPages = db
      .prepare(
        `
        SELECT path, COUNT(*) as count
        FROM visitor_logs
        WHERE timestamp >= ?
        GROUP BY path
        ORDER BY count DESC
        LIMIT 20
      `
      )
      .all(cutoffTime) as { path: string; count: number }[];

    // Top countries
    const topCountries = db
      .prepare(
        `
        SELECT country, COUNT(DISTINCT ip) as count
        FROM visitor_logs
        WHERE timestamp >= ? AND country IS NOT NULL AND country != 'unknown'
        GROUP BY country
        ORDER BY count DESC
        LIMIT 20
      `
      )
      .all(cutoffTime) as { country: string; count: number }[];

    // Count IPs needing geo lookup
    const pendingGeoCount = (
      db
        .prepare(
          `
        SELECT COUNT(DISTINCT v.ip) as count
        FROM visitor_logs v
        LEFT JOIN ip_geo_cache g ON v.ip = g.ip
        WHERE g.ip IS NULL
          AND v.ip != 'unknown'
          AND v.ip NOT LIKE '192.168.%'
          AND v.ip NOT LIKE '10.%'
          AND v.ip != '127.0.0.1'
      `
        )
        .get() as { count: number }
    ).count;

    const stats: VisitorStats & { pendingGeoCount: number } = {
      totalVisitors,
      totalPageViews,
      visitorsByLocation,
      visitorsOverTime,
      osBreakdown,
      deviceBreakdown,
      browserBreakdown,
      topPages,
      topCountries,
      pendingGeoCount,
    };

    return NextResponse.json(stats);
  } catch (error) {
    return errorResponse(error, "analytics/stats");
  }
}
