/**
 * Whether a request originated on this host rather than arriving through the
 * Cloudflare tunnel.
 *
 * Used to gate /api/cache/warm, whose only legitimate caller is
 * scripts/start-with-cache.sh fetching localhost after startup.
 *
 * Header-based rather than socket-based because a Next route handler does not
 * get the peer address. Two things make that sound here:
 *
 *  - Behind the tunnel `cf-connecting-ip` is always set (see middleware.ts), so
 *    its presence means the request came from outside.
 *  - `x-forwarded-for` cannot be used by absence: Next populates it for route
 *    handlers even on a direct local connection. So the test is that every hop
 *    in the chain is a loopback address — a real proxy in front contributes a
 *    non-loopback value.
 *
 * This is defence in depth, not the primary control. The primary control is
 * binding the server to 127.0.0.1 so the origin is unreachable directly.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", ""]);

export function isLocalRequest(headers: {
  get(name: string): string | null;
}): boolean {
  if (headers.get("cf-connecting-ip")) return false;

  const xff = headers.get("x-forwarded-for");
  if (!xff) return true;

  return xff
    .split(",")
    .map((v) => v.trim().replace(/^\[|\]$/g, "").toLowerCase())
    .every((ip) => LOOPBACK.has(ip));
}
