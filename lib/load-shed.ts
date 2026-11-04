/**
 * Event-loop-lag load shedding for middleware.
 *
 * Under a flood the server accepts every connection, queues hundreds of them,
 * and the main thread (React SSR) saturates until the tunnel sees connection
 * resets — measured 2026-10-28: ~750 established loopback sockets, main
 * thread at 92% CPU, cloudflared logging "connection reset by peer" on every
 * request. A reset is the worst outcome: it costs a full render's worth of
 * queueing and still returns nothing, and Cloudflare reports it as a 502.
 *
 * Shedding replaces that with a cheap 503 + Retry-After sent from middleware
 * before any rendering, as soon as the loop is measurably behind. Capacity is
 * then spent on the requests that do get through, Cloudflare's stale cache
 * covers the rest, and crawlers get the documented "overloaded, retry later"
 * signal instead of a broken socket.
 *
 * The decision is a pure function of the last window's worst (max) lag so it
 * can be tested; the sampling lives in a tiny process-wide monitor started on
 * first import. Max, not a percentile: at 20 ms resolution a 5 s window holds
 * ~250 samples, so one multi-second stall — a synchronous disk read on the
 * main thread — is a single sample that p50 or even p99 never sees. Measured
 * 2026-11-03: 52 minutes of a frozen origin, 0 shed decisions. Middleware runs on the Node runtime in this project (see
 * middleware.ts), so perf_hooks is available and the lag measured is that of
 * the thread that renders pages.
 */

import { monitorEventLoopDelay } from "perf_hooks";

/** Default worst-sample lag (ms) in a window above which non-essential requests are shed. */
export const DEFAULT_LAG_BUDGET_MS = 250;

/** Histogram sampling resolution, ms. */
const RESOLUTION_MS = 20;

/** Window after which the histogram is reset so it tracks recent load. */
const WINDOW_MS = 5_000;

/** True when the measured lag exceeds the budget. A budget of 0 disables. */
export function exceedsLagBudget(lagMs: number, budgetMs: number): boolean {
  if (!(budgetMs > 0)) return false;
  return lagMs > budgetMs;
}

/**
 * Read `LOAD_SHED_LAG_MS` once. Unset or malformed → default; `0` disables.
 * Negative values are treated as 0 rather than as a tiny positive budget.
 */
export function lagBudgetFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LAG_BUDGET_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LAG_BUDGET_MS;
  return Math.max(0, n);
}

const budgetMs = lagBudgetFromEnv(process.env.LOAD_SHED_LAG_MS);

// Only pay for the monitor when shedding is enabled.
const histogram = budgetMs > 0 ? monitorEventLoopDelay({ resolution: RESOLUTION_MS }) : null;
histogram?.enable();

/** Max lag of the last completed window, ms. Starts at 0 so a cold server never sheds. */
let lastWindowMaxMs = 0;

if (histogram) {
  const timer = setInterval(() => {
    // Histogram values are in nanoseconds. A window with no samples reports 0.
    const max = histogram.max / 1e6;
    lastWindowMaxMs = Number.isFinite(max) ? max : 0;
    histogram.reset();
  }, WINDOW_MS);
  // Never keep the process alive on account of the monitor.
  timer.unref();
}

/** Worst lag sample of the last window, ms — for log lines. */
export function currentLagMs(): number {
  return lastWindowMaxMs;
}

/** Configured budget, ms (0 = shedding disabled). */
export function lagBudgetMs(): number {
  return budgetMs;
}

/** Whether a non-essential request should be refused right now. */
export function shouldShed(): boolean {
  return exceedsLagBudget(lastWindowMaxMs, budgetMs);
}
