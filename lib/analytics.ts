import { getAnalyticsDb } from "./db";

// Sanitize string input to prevent injection attacks
// Removes null bytes, control characters, and limits length
function sanitizeString(input: string, maxLength: number = 500): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\x00-\x1f\x7f]/g, "") // Remove control characters
    .replace(/[<>'"`;]/g, "") // Remove common injection chars
    .slice(0, maxLength)
    .trim();
}

// Validate IP address format (basic check)
function isValidIP(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  // IPv4 or IPv6 basic pattern (not exhaustive but catches obvious fakes)
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;
  return ip === "unknown" || ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

// User-agent parsing utilities
export interface ParsedUserAgent {
  os: string;
  deviceType: "mobile" | "desktop";
  browser: string;
}

export function parseUserAgent(ua: string): ParsedUserAgent {
  const uaLower = ua.toLowerCase();

  // Detect OS
  let os = "Other";
  if (uaLower.includes("windows")) {
    os = "Windows";
  } else if (uaLower.includes("mac os x") || uaLower.includes("macintosh")) {
    os = "macOS";
  } else if (uaLower.includes("iphone") || uaLower.includes("ipad")) {
    os = "iOS";
  } else if (uaLower.includes("android")) {
    os = "Android";
  } else if (uaLower.includes("linux")) {
    os = "Linux";
  } else if (uaLower.includes("cros")) {
    os = "ChromeOS";
  }

  // Detect device type
  const isMobile =
    uaLower.includes("mobile") ||
    uaLower.includes("android") ||
    uaLower.includes("iphone") ||
    uaLower.includes("ipad") ||
    uaLower.includes("ipod");
  const deviceType: "mobile" | "desktop" = isMobile ? "mobile" : "desktop";

  // Detect browser (order matters - check more specific first)
  let browser = "Other";
  if (uaLower.includes("edg/") || uaLower.includes("edge/")) {
    browser = "Edge";
  } else if (uaLower.includes("opr/") || uaLower.includes("opera")) {
    browser = "Opera";
  } else if (uaLower.includes("chrome") && !uaLower.includes("chromium")) {
    browser = "Chrome";
  } else if (uaLower.includes("safari") && !uaLower.includes("chrome")) {
    browser = "Safari";
  } else if (uaLower.includes("firefox")) {
    browser = "Firefox";
  } else if (uaLower.includes("msie") || uaLower.includes("trident")) {
    browser = "IE";
  }

  return { os, deviceType, browser };
}

// Visitor data interface
export interface VisitorData {
  ip: string;
  timestamp: number;
  path: string;
  userAgent: string;
  country: string;
}

// Log a visitor to the database
export function logVisitor(data: VisitorData): void {
  try {
    // Validate and sanitize all inputs
    const ip = isValidIP(data.ip) ? data.ip : "invalid";
    const timestamp = typeof data.timestamp === "number" && data.timestamp > 0 ? data.timestamp : Date.now();
    const path = sanitizeString(data.path, 500);
    const userAgent = sanitizeString(data.userAgent, 500);
    const country = sanitizeString(data.country, 50);

    // Skip obviously invalid entries
    if (!path || ip === "invalid") {
      return;
    }

    const db = getAnalyticsDb();
    const parsed = parseUserAgent(userAgent);

    // Using parameterized queries (prepared statements) prevents SQL injection
    db.prepare(`
      INSERT INTO visitor_logs (ip, timestamp, path, user_agent, country, os, device_type, browser)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ip,
      timestamp,
      path,
      userAgent,
      country,
      parsed.os,
      parsed.deviceType,
      parsed.browser
    );
  } catch (error) {
    console.error("Failed to log visitor:", error);
  }
}

// IP Geolocation cache TTL: 30 days
const GEO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface GeoLocation {
  country: string;
  city: string;
  lat: number;
  lon: number;
}

// Get cached geolocation for an IP
export function getCachedGeoLocation(ip: string): GeoLocation | null {
  try {
    const db = getAnalyticsDb();
    const row = db
      .prepare("SELECT country, city, lat, lon, cached_at FROM ip_geo_cache WHERE ip = ?")
      .get(ip) as { country: string; city: string; lat: number; lon: number; cached_at: number } | undefined;

    if (!row) return null;

    // Check TTL
    if (Date.now() - row.cached_at > GEO_CACHE_TTL_MS) {
      db.prepare("DELETE FROM ip_geo_cache WHERE ip = ?").run(ip);
      return null;
    }

    return { country: row.country, city: row.city, lat: row.lat, lon: row.lon };
  } catch {
    return null;
  }
}

// Cache geolocation for an IP
export function setCachedGeoLocation(ip: string, geo: GeoLocation): void {
  try {
    // Validate inputs
    if (!isValidIP(ip)) return;

    const db = getAnalyticsDb();
    db.prepare(`
      INSERT OR REPLACE INTO ip_geo_cache (ip, country, city, lat, lon, cached_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ip,
      sanitizeString(geo.country, 100),
      sanitizeString(geo.city, 100),
      typeof geo.lat === "number" ? geo.lat : 0,
      typeof geo.lon === "number" ? geo.lon : 0,
      Date.now()
    );
  } catch (error) {
    console.error("Failed to cache geolocation:", error);
  }
}

// Fetch geolocation from ip-api.com
export async function fetchGeoLocation(ip: string): Promise<GeoLocation | null> {
  // Validate IP format first to prevent SSRF
  if (!isValidIP(ip)) return null;

  // Don't lookup private/local IPs
  if (ip === "unknown" || ip.startsWith("192.168.") || ip.startsWith("10.") || ip === "127.0.0.1" || ip === "::1") {
    return null;
  }

  // Additional check: don't lookup internal/reserved ranges
  if (ip.startsWith("172.") || ip.startsWith("169.254.") || ip.startsWith("0.") || ip.startsWith("224.")) {
    return null;
  }

  try {
    // URL encode the IP to prevent injection in the URL
    const encodedIP = encodeURIComponent(ip);
    const response = await fetch(`http://ip-api.com/json/${encodedIP}?fields=status,country,city,lat,lon`, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== "success") return null;

    // Sanitize returned data
    return {
      country: sanitizeString(String(data.country || "Unknown"), 100),
      city: sanitizeString(String(data.city || "Unknown"), 100),
      lat: typeof data.lat === "number" ? data.lat : 0,
      lon: typeof data.lon === "number" ? data.lon : 0,
    };
  } catch {
    return null;
  }
}

// Get IPs that need geolocation lookup
export function getIPsNeedingGeoLookup(limit: number = 40): string[] {
  try {
    const db = getAnalyticsDb();
    const rows = db
      .prepare(`
        SELECT DISTINCT v.ip
        FROM visitor_logs v
        LEFT JOIN ip_geo_cache g ON v.ip = g.ip
        WHERE g.ip IS NULL
          AND v.ip != 'unknown'
          AND v.ip NOT LIKE '192.168.%'
          AND v.ip NOT LIKE '10.%'
          AND v.ip != '127.0.0.1'
          AND v.ip != '::1'
        LIMIT ?
      `)
      .all(limit) as { ip: string }[];

    return rows.map((r) => r.ip);
  } catch {
    return [];
  }
}

// Update visitor logs with geolocation data
export function updateVisitorGeoLocation(ip: string, geo: GeoLocation): void {
  try {
    // Validate IP
    if (!isValidIP(ip)) return;

    const db = getAnalyticsDb();
    db.prepare(`
      UPDATE visitor_logs
      SET city = ?, lat = ?, lon = ?
      WHERE ip = ? AND city IS NULL
    `).run(
      sanitizeString(geo.city, 100),
      typeof geo.lat === "number" ? geo.lat : 0,
      typeof geo.lon === "number" ? geo.lon : 0,
      ip
    );
  } catch (error) {
    console.error("Failed to update visitor geolocation:", error);
  }
}

// Batch process geolocation lookups (respects rate limits)
export async function processGeoLocationBatch(): Promise<number> {
  const ips = getIPsNeedingGeoLookup(40); // ip-api allows 45/min, leave buffer
  let processed = 0;

  for (const ip of ips) {
    // Check cache first
    let geo = getCachedGeoLocation(ip);

    if (!geo) {
      geo = await fetchGeoLocation(ip);
      if (geo) {
        setCachedGeoLocation(ip, geo);
      }
    }

    if (geo) {
      updateVisitorGeoLocation(ip, geo);
      processed++;
    }

    // Small delay to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return processed;
}
