/**
 * Recovery for fetch() calls that Cloudflare answers with a Managed Challenge.
 *
 * The WAF rule in docs/SEO-RUNBOOK.md §3.7 challenges unverified clients. A
 * challenge can only be rendered on a navigation; when it fires on a fetch(),
 * Cloudflare returns 403 with `cf-mitigated: challenge` and no body the page
 * can use. That happens whenever the `cf_clearance` cookie is missing or has
 * expired while a page that fetches from `/api/` is open — the symptom is a
 * dead autocomplete and a red "HTTP 403" on the hub pages.
 *
 * `apiFetch` detects that response and reloads the page once, so the reload
 * (a navigation) carries the challenge and issues the cookie. A guard in
 * sessionStorage stops a reload loop if the challenge keeps failing.
 *
 * This module imports nothing so client components can use it.
 */

export const RELOAD_GUARD_KEY = "edge-challenge-reload";
export const RELOAD_WINDOW_MS = 60_000;

/** True when a response is Cloudflare refusing to challenge a non-navigation. */
export function isEdgeChallenge(status: number, mitigated: string | null): boolean {
  return status === 403 && mitigated === "challenge";
}

/**
 * Loop guard: allow a reload only if none happened inside `windowMs`.
 * `lastReload` is the epoch-ms stamp of the previous reload, or null.
 */
export function shouldReload(
  now: number,
  lastReload: number | null,
  windowMs: number = RELOAD_WINDOW_MS
): boolean {
  if (lastReload === null || !Number.isFinite(lastReload)) return true;
  return now - lastReload >= windowMs;
}

function readLastReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function stampReload(now: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // Storage unavailable (private mode, blocked). Reload anyway; the guard
    // just can't protect against a loop in that case.
  }
}

/**
 * Drop-in replacement for fetch() on client pages that call `/api/…`.
 * Resolves exactly like fetch unless the edge answered with a challenge.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!isEdgeChallenge(res.status, res.headers.get("cf-mitigated"))) return res;

  const now = Date.now();
  if (typeof window !== "undefined" && shouldReload(now, readLastReload())) {
    stampReload(now);
    window.location.reload();
    throw new Error("Verifying your browser, reloading…");
  }
  throw new Error("Browser verification required. Please reload the page.");
}
